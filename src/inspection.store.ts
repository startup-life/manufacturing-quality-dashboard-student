import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Inspection, LocalState } from './inspection.types';
import {
  inspectionDefectNames,
  type InspectionRecord,
  type InspectionRecordDefect,
  type InspectionRecordWithDefects,
  type InspectionView,
} from './inspection-record.types';
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
  inspection_records: Array<Omit<InspectionRecord, 'weight_g' | 'content_version' | 'notes' | 'change_reason'> & {
    weight_g: number | string | null;
    content_version: number | string;
    notes: string | null;
    change_reason: string | null;
  }>;
  record_defects: InspectionRecordDefect[];
}

interface GoogleInspectionRecordData {
  records: Array<Omit<InspectionRecord, 'weight_g' | 'content_version'> & {
    weight_g: number | string | null;
    content_version: number | string;
  }>;
  defects: InspectionRecordDefect[];
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

  async getAll(): Promise<InspectionView[]> {
    if (getStorageInfo().storage === 'live') return this.getGoogleInspections();
    return this.withLatestRecords(this.getLocalState());
  }

  private async getGoogleInspections(): Promise<InspectionView[]> {
    const result = await this.google.call<GoogleInspectionData>('read', {
      tabs: ['inspections', 'images', 'inspection_records', 'record_defects'],
    });
    const imagesByInspection = new Map<string, GoogleImageRow[]>();
    for (const image of result.images ?? []) {
      const images = imagesByInspection.get(image.inspection_id) ?? [];
      images.push(image);
      imagesByInspection.set(image.inspection_id, images);
    }

    const inspections = (result.inspections ?? []).map((row) => ({
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
    const inspection_records: InspectionRecord[] = (result.inspection_records ?? []).map((row) => ({
      ...row,
      weight_g: row.weight_g === '' || row.weight_g === null ? null : Number(row.weight_g),
      content_version: Number(row.content_version) || 0,
      notes: row.notes ?? '',
      change_reason: row.change_reason ?? '',
    }));

    return this.withLatestRecords({
      inspections,
      inspection_records,
      record_defects: result.record_defects ?? [],
    });
  }

  saveLocal(inspection: Inspection): void {
    const state = this.getLocalState();
    const inspections = state.inspections;
    const index = inspections.findIndex((item) => item.inspection_id === inspection.inspection_id);
    const { defects: _defects, ...storedInspection } = inspection as InspectionView;
    const previousInspection = inspections[index];
    if (
      previousInspection &&
      state.inspection_records!.some((record) => record.inspection_id === inspection.inspection_id)
    ) {
      storedInspection.decision = previousInspection.decision;
      storedInspection.memo = previousInspection.memo;
    }
    if (index < 0) inspections.push(storedInspection);
    else inspections[index] = storedInspection;

    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf8');
    renameSync(temporaryPath, this.filePath);
  }

  async saveRecord(
    inspection: Inspection,
    record: InspectionRecord,
    defects: string[],
  ): Promise<void> {
    if (getStorageInfo().storage === 'live') {
      const result = await this.google.call<{ saved: number }>('saveInspectionRecord', {
        record,
        defects,
      });
      if (result.saved !== 1) throw new Error('판단을 저장하지 못했습니다.');
      return;
    }

    const state = this.getLocalState();
    state.inspection_records!.push(record);
    state.record_defects!.push(
      ...defects.map((defect_code): InspectionRecordDefect => ({
        record_id: record.record_id,
        defect_code,
      })),
    );
    const storedInspection = state.inspections.find(
      (item) => item.inspection_id === inspection.inspection_id,
    );
    if (!storedInspection) throw new Error('검사를 찾을 수 없습니다.');
    storedInspection.content_version = record.content_version;

    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), 'utf8');
    renameSync(temporaryPath, this.filePath);
  }

  async getRecords(inspectionId: string): Promise<InspectionRecordWithDefects[]> {
    let records: InspectionRecord[];
    let defects: InspectionRecordDefect[];
    if (getStorageInfo().storage === 'live') {
      const response = await this.google.call<GoogleInspectionRecordData>('listInspectionRecords', {
        inspection_id: inspectionId,
      });
      records = (response.records ?? []).map((record) => ({
        ...record,
        weight_g: record.weight_g === '' || record.weight_g === null
          ? null
          : Number(record.weight_g),
        content_version: Number(record.content_version) || 0,
        notes: record.notes ?? '',
        change_reason: record.change_reason ?? '',
      }));
      defects = response.defects ?? [];
    } else {
      const state = this.getLocalState();
      records = state.inspection_records!.filter((record) => record.inspection_id === inspectionId);
      defects = state.record_defects!;
    }

    const defectsByRecord = new Map<string, InspectionRecordDefect[]>();
    for (const defect of defects) {
      const items = defectsByRecord.get(defect.record_id) ?? [];
      items.push(defect);
      defectsByRecord.set(defect.record_id, items);
    }

    return records
      .map((record, originalIndex) => ({
        ...record,
        originalIndex,
        defects: (defectsByRecord.get(record.record_id) ?? []).map(({ defect_code }) => ({
          defect_code,
          defect_name: inspectionDefectNames[defect_code] ?? defect_code,
        })),
      }))
      .sort((left, right) =>
        right.content_version - left.content_version ||
        right.recorded_at.localeCompare(left.recorded_at) ||
        right.originalIndex - left.originalIndex,
      )
      .map(({ originalIndex: _originalIndex, ...record }) => record);
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

  async find(inspectionId: string): Promise<InspectionView | undefined> {
    return (await this.getAll()).find((item) => item.inspection_id === inspectionId);
  }

  private getLocalState(): LocalState {
    if (!existsSync(this.filePath)) {
      return { inspections: [], inspection_records: [], record_defects: [] };
    }
    const state = JSON.parse(readFileSync(this.filePath, 'utf8')) as LocalState;
    state.inspections = Array.isArray(state.inspections) ? state.inspections : [];
    state.inspection_records = Array.isArray(state.inspection_records) ? state.inspection_records : [];
    state.record_defects = Array.isArray(state.record_defects) ? state.record_defects : [];
    return state;
  }

  private withLatestRecords(state: LocalState): InspectionView[] {
    const latestByInspection = new Map<string, InspectionRecord>();
    for (const record of state.inspection_records ?? []) {
      const current = latestByInspection.get(record.inspection_id);
      if (
        !current ||
        record.content_version > current.content_version ||
        (record.content_version === current.content_version &&
          record.recorded_at.localeCompare(current.recorded_at) >= 0)
      ) {
        latestByInspection.set(record.inspection_id, record);
      }
    }

    const defectsByRecord = new Map<string, InspectionRecordDefect[]>();
    for (const defect of state.record_defects ?? []) {
      const items = defectsByRecord.get(defect.record_id) ?? [];
      items.push(defect);
      defectsByRecord.set(defect.record_id, items);
    }

    return state.inspections.map((inspection) => {
      const latest = latestByInspection.get(inspection.inspection_id);
      if (!latest) return { ...inspection, defects: [] };
      return {
        ...inspection,
        decision: latest.decision,
        memo: latest.notes,
        defects: (defectsByRecord.get(latest.record_id) ?? []).map(({ defect_code }) => ({
          defect_code,
          defect_name: inspectionDefectNames[defect_code] ?? defect_code,
        })),
      };
    });
  }
}
