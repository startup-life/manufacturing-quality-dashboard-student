import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EvidenceLinkRecord } from './evidence-link.types';
import { GoogleWebAppClient } from './google-web-app.client';
import { getStorageInfo } from './storage-mode';

interface GoogleEvidenceLinks {
  links: EvidenceLinkRecord[];
}

@Injectable()
export class EvidenceLinkStore {
  private readonly filePath = path.join(process.cwd(), 'runtime', 'evidence-links.json');

  constructor(private readonly google: GoogleWebAppClient) {}

  async getLatestForQuery(queryId: string): Promise<EvidenceLinkRecord | null> {
    const records = (await this.read())
      .filter((record) => record.query_id === queryId)
      .reverse()
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    return records[0] ?? null;
  }

  async getLatestForDraft(inspectionId: string, draftId: string): Promise<EvidenceLinkRecord | null> {
    const records = (await this.read(inspectionId))
      .filter((record) => record.draft_id === draftId)
      .reverse()
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    return records[0] ?? null;
  }

  async save(record: EvidenceLinkRecord): Promise<void> {
    if (getStorageInfo().storage === 'live') {
      const result = await this.google.call<{ saved: number }>('saveEvidenceLink', { record });
      if (result.saved !== 1) throw new Error('대조 기록을 저장하지 못했습니다.');
      return;
    }

    const records = this.readLocal();
    records.push(record);
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    renameSync(temporaryPath, this.filePath);
  }

  private async read(inspectionId?: string): Promise<EvidenceLinkRecord[]> {
    if (getStorageInfo().storage === 'live') {
      const values = inspectionId === undefined ? {} : { inspection_id: inspectionId };
      const response = await this.google.call<GoogleEvidenceLinks>('listEvidenceLinks', values);
      return response.links ?? [];
    }
    const records = this.readLocal();
    return inspectionId === undefined
      ? records
      : records.filter((record) => record.inspection_id === inspectionId);
  }

  private readLocal(): EvidenceLinkRecord[] {
    if (!existsSync(this.filePath)) return [];
    const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
    return Array.isArray(value) ? value as EvidenceLinkRecord[] : [];
  }
}
