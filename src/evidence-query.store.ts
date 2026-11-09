import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EvidenceQueryRecord } from './evidence-query.types';
import { GoogleWebAppClient } from './google-web-app.client';
import { getStorageInfo } from './storage-mode';

interface GoogleEvidenceQueries {
  queries: Array<Omit<EvidenceQueryRecord, 'sources'> & { sources: unknown }>;
}

@Injectable()
export class EvidenceQueryStore {
  private readonly filePath = path.join(process.cwd(), 'runtime', 'evidence-queries.json');

  constructor(private readonly google: GoogleWebAppClient) {}

  async getLatestForDraft(inspectionId: string, draftId: string): Promise<EvidenceQueryRecord | null> {
    const records = (await this.read(inspectionId))
      .filter((record) => record.draft_id === draftId)
      .reverse()
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    return records[0] ?? null;
  }

  async save(record: EvidenceQueryRecord): Promise<void> {
    if (getStorageInfo().storage === 'live') {
      const result = await this.google.call<{ saved: number }>('saveEvidenceQuery', {
        record: { ...record, sources: JSON.stringify(record.sources) },
      });
      if (result.saved !== 1) throw new Error('근거 답을 저장하지 못했습니다.');
      return;
    }

    const records = this.readLocal();
    records.push(record);
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    renameSync(temporaryPath, this.filePath);
  }

  private async read(inspectionId: string): Promise<EvidenceQueryRecord[]> {
    if (getStorageInfo().storage === 'live') {
      const response = await this.google.call<GoogleEvidenceQueries>('listEvidenceQueries', {
        inspection_id: inspectionId,
      });
      return (response.queries ?? []).map((record) => ({
        ...record,
        sources: this.parseSources(record.sources),
      }));
    }
    return this.readLocal().filter((record) => record.inspection_id === inspectionId);
  }

  private readLocal(): EvidenceQueryRecord[] {
    if (!existsSync(this.filePath)) return [];
    const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
    return Array.isArray(value) ? value as EvidenceQueryRecord[] : [];
  }

  private parseSources(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }
}
