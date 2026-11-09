import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Inspection, LocalState } from './inspection.types';
import { GoogleWebAppClient } from './google-web-app.client';
import { getStorageInfo } from './storage-mode';

interface GoogleInspectionRow {
  inspection_id: string;
  product_id: string;
  inspected_at: string;
  revision: 'Rev.A' | 'Rev.B';
  weight_g: number | string | null;
  memo: string | null;
  decision: Inspection['decision'] | '';
  content_version: number | string;
}

interface GoogleImageRow {
  inspection_id: string;
  position: number | string;
  image_url: string;
}

interface GoogleInspectionData {
  inspections: GoogleInspectionRow[];
  images: GoogleImageRow[];
}

export interface PreparedPhoto {
  name: string;
  mimeType: string;
  base64: string;
}

@Injectable()
export class InspectionStore {
  private readonly filePath = path.join(process.cwd(), 'runtime', 'local-state.json');

  constructor(private readonly google: GoogleWebAppClient) {}

  async getAll(): Promise<Inspection[]> {
    if (getStorageInfo().storage === 'live') return this.getGoogleInspections();
    return this.getLocalInspections();
  }

  private getLocalInspections(): Inspection[] {
    if (!existsSync(this.filePath)) return [];
    const state = JSON.parse(readFileSync(this.filePath, 'utf8')) as LocalState;
    return Array.isArray(state.inspections) ? state.inspections : [];
  }

  private async getGoogleInspections(): Promise<Inspection[]> {
    const result = await this.google.call<GoogleInspectionData>('read', {
      tabs: ['inspections', 'images'],
    });
    const imagesByInspection = new Map<string, GoogleImageRow[]>();
    for (const image of result.images ?? []) {
      const images = imagesByInspection.get(image.inspection_id) ?? [];
      images.push(image);
      imagesByInspection.set(image.inspection_id, images);
    }

    return (result.inspections ?? []).map((row) => ({
      inspection_id: row.inspection_id,
      product_id: row.product_id,
      inspected_at: row.inspected_at,
      revision: row.revision,
      weight_g: row.weight_g === '' || row.weight_g === null ? null : Number(row.weight_g),
      memo: row.memo ?? '',
      decision: row.decision === '' ? null : row.decision,
      content_version: Number(row.content_version) || 0,
      images: (imagesByInspection.get(row.inspection_id) ?? [])
        .sort((left, right) => Number(left.position) - Number(right.position))
        .map((image) => image.image_url),
    }));
  }

  saveLocal(inspection: Inspection): void {
    const inspections = this.getLocalInspections();
    const index = inspections.findIndex((item) => item.inspection_id === inspection.inspection_id);
    if (index < 0) inspections.push(inspection);
    else inspections[index] = inspection;

    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ inspections }, null, 2), 'utf8');
    renameSync(temporaryPath, this.filePath);
  }

  async register(inspection: Inspection, photos: PreparedPhoto[]): Promise<Inspection> {
    if (photos.length === 0) throw new BadRequestException('사진을 골라 주세요.');

    if (getStorageInfo().storage === 'live') {
      if (inspection.weight_g !== null && inspection.weight_g < 0) {
        throw new BadRequestException('중량은 0 이상의 숫자로 적어 주세요.');
      }

      const uploadedPhotos: Array<{ id: string }> = [];
      for (const photo of photos) {
        uploadedPhotos.push(await this.google.call<{ id: string }>('savePhoto', {
          name: photo.name,
          mimeType: photo.mimeType,
          base64: photo.base64,
        }));
      }

      const savedInspection: Inspection = {
        ...inspection,
        images: uploadedPhotos.map(({ id }) => `/api/drive/${id}`),
      };
      await this.google.call('append', {
        rows: {
          inspections: [
            {
              inspection_id: savedInspection.inspection_id,
              product_id: savedInspection.product_id,
              inspected_at: savedInspection.inspected_at,
              revision: savedInspection.revision,
              weight_g: savedInspection.weight_g,
              memo: savedInspection.memo,
              decision: savedInspection.decision,
              content_version: savedInspection.content_version,
            },
          ],
          images: savedInspection.images.map((image_url, index) => ({
            inspection_id: savedInspection.inspection_id,
            position: index + 1,
            image_url,
          })),
        },
      });
      return savedInspection;
    }

    const savedInspection: Inspection = {
      ...inspection,
      images: photos.map((photo) => this.saveLocalPhoto(photo)),
    };
    this.saveLocal(savedInspection);
    return savedInspection;
  }

  private saveLocalPhoto(photo: PreparedPhoto): string {
    const uploadsDirectory = path.join(process.cwd(), 'runtime', 'uploads');
    mkdirSync(uploadsDirectory, { recursive: true });
    writeFileSync(path.join(uploadsDirectory, photo.name), Buffer.from(photo.base64, 'base64'));
    return `/uploads/${photo.name}`;
  }

  async update(inspection: Inspection): Promise<void> {
    if (getStorageInfo().storage === 'live') {
      await this.google.call('update', {
        tab: 'inspections',
        key: 'inspection_id',
        value: inspection.inspection_id,
        changes: {
          product_id: inspection.product_id,
          inspected_at: inspection.inspected_at,
          weight_g: inspection.weight_g,
          content_version: inspection.content_version,
        },
      });
      return;
    }

    this.saveLocal(inspection);
  }

  async find(inspectionId: string): Promise<Inspection | undefined> {
    return (await this.getAll()).find((item) => item.inspection_id === inspectionId);
  }
}
