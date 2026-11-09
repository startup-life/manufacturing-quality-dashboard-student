import { HttpException, Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Inspection } from './inspection.types';
import type { GeminiResultFields, GeminiResultRecord, GeminiRunState, GeminiRunStatus } from './gemini-result.types';
import type { EvidenceLinkRecord } from './evidence-link.types';
import { GoogleWebAppClient } from './google-web-app.client';
import { getGeminiInfo, getStorageInfo } from './storage-mode';

const { normalizeGeminiResult } = require(path.join(__dirname, '..', 'shared', 'gemini-result.js')) as {
  normalizeGeminiResult: (value: unknown) => GeminiResultFields | null;
};

interface RunState {
  state: GeminiRunState;
  error?: string;
}

interface GoogleGeminiResults {
  results: GoogleGeminiResultRecord[];
}

interface GoogleGeminiResultRecord extends Omit<GeminiResultRecord, 'weight_g' | 'images' | 'result'> {
  weight_g: number | string | null;
  images: unknown;
  result: unknown;
}

interface GoogleStatusData {
  gemini_results: GoogleGeminiResultRecord[];
  evidence_links: EvidenceLinkRecord[];
}

@Injectable()
export class GeminiResultStore {
  private readonly filePath = path.join(process.cwd(), 'runtime', 'gemini-results.json');
  private readonly runStates = new Map<string, RunState>();

  constructor(private readonly google: GoogleWebAppClient) {}

  async getReviewPendingInspectionIds(inspections: Inspection[]): Promise<Set<string>> {
    let results: GeminiResultRecord[];
    let links: EvidenceLinkRecord[];
    if (getStorageInfo().storage === 'live') {
      const response = await this.google.call<GoogleStatusData>('read', {
        tabs: ['gemini_results', 'evidence_links'],
      });
      results = this.normalizeGoogleResults(response.gemini_results ?? []);
      links = response.evidence_links ?? [];
    } else {
      results = this.readLocalResults();
      links = this.readLocalEvidenceLinks();
    }

    const inspectionsById = new Map(inspections.map((inspection) => [inspection.inspection_id, inspection]));
    const latestByInspection = new Map<string, GeminiResultRecord>();
    for (const result of results) {
      const current = latestByInspection.get(result.inspection_id);
      if (!current || result.created_at.localeCompare(current.created_at) > 0) {
        latestByInspection.set(result.inspection_id, result);
      }
    }

    const pending = new Set<string>();
    for (const [inspectionId, latest] of latestByInspection) {
      const inspection = inspectionsById.get(inspectionId);
      if (!inspection) continue;
      const stale = latest.product_id !== inspection.product_id ||
        latest.weight_g !== inspection.weight_g ||
        JSON.stringify(latest.images) !== JSON.stringify(inspection.images);
      const latestLink = links
        .filter((record) => record.inspection_id === inspectionId && record.draft_id === latest.result_id)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
      const reviewedAsMatch = latestLink?.status === 'VERIFIED_BY_USER' ||
        latestLink?.status === 'MOCK_USER_REVIEWED';
      if (stale || !reviewedAsMatch) pending.add(inspectionId);
    }
    return pending;
  }

  async getStatus(inspection: Inspection): Promise<GeminiRunStatus> {
    let results: GeminiResultRecord[];
    let links: EvidenceLinkRecord[];
    if (getStorageInfo().storage === 'live') {
      const response = await this.google.call<GoogleStatusData>('read', {
        tabs: ['gemini_results', 'evidence_links'],
      });
      results = this.normalizeGoogleResults(response.gemini_results ?? [])
        .filter((record) => record.inspection_id === inspection.inspection_id);
      links = (response.evidence_links ?? [])
        .filter((record) => record.inspection_id === inspection.inspection_id);
    } else {
      results = this.readLocalResults().filter((record) => record.inspection_id === inspection.inspection_id);
      links = this.readLocalEvidenceLinks().filter((record) => record.inspection_id === inspection.inspection_id);
    }
    results = results
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    const current = this.runStates.get(inspection.inspection_id) ?? { state: 'idle' as const };
    const latest = results[0];
    const stale = Boolean(
      latest &&
        (latest.product_id !== inspection.product_id ||
          latest.weight_g !== inspection.weight_g ||
          JSON.stringify(latest.images) !== JSON.stringify(inspection.images)),
    );
    const link = latest
      ? links
          .filter((record) => record.draft_id === latest.result_id)
          .reverse()
          .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null
      : null;

    return {
      mode: getGeminiInfo().gemini_mode,
      state: current.state,
      ...(current.state === 'failed' && current.error ? { error: current.error } : {}),
      results,
      stale,
      link,
    };
  }

  async startMock(
    inspection: Inspection,
    revision: 'Rev.A' | 'Rev.B',
    instructionName: string,
    instructionText: string,
  ): Promise<GeminiRunStatus> {
    this.runStates.set(inspection.inspection_id, { state: 'running' });
    const snapshot = { ...inspection, images: [...inspection.images] };

    setTimeout(() => {
      void this.completeMock(snapshot, revision, instructionName, instructionText);
    }, 1500);

    return this.getStatus(snapshot);
  }

  async startLive(
    inspection: Inspection,
    revision: 'Rev.A' | 'Rev.B',
    instructionName: string,
    instructionText: string,
  ): Promise<GeminiRunStatus> {
    this.runStates.set(inspection.inspection_id, { state: 'running' });
    const snapshot = { ...inspection, images: [...inspection.images] };
    void this.completeLive(snapshot, revision, instructionName, instructionText);
    return {
      mode: 'live',
      state: 'running',
      results: [],
      stale: false,
    };
  }

  private async completeMock(
    inspection: Inspection,
    revision: 'Rev.A' | 'Rev.B',
    instructionName: string,
    instructionText: string,
  ): Promise<void> {
    try {
      await this.save(this.makeMockResult(inspection, revision, instructionName, instructionText));
      this.runStates.set(inspection.inspection_id, { state: 'idle' });
    } catch {
      this.runStates.set(inspection.inspection_id, {
        state: 'failed',
        error: '판독 결과를 저장하지 못했습니다.',
      });
    }
  }

  private async completeLive(
    inspection: Inspection,
    revision: 'Rev.A' | 'Rev.B',
    instructionName: string,
    instructionText: string,
  ): Promise<void> {
    try {
      const standard = readFileSync(
        path.join(process.cwd(), 'standards', `notebooklm-${revision}.md`),
        'utf8',
      );
      const imageIds = inspection.images.map((image) => {
        const match = /^\/api\/drive\/([^/?#]+)$/.exec(image);
        if (!match) throw new Error('등록된 사진 주소를 확인하세요.');
        return decodeURIComponent(match[1]);
      });
      const productNames: Record<string, string> = {
        'P-SILVER': '텀블러 실버',
        'P-WHITE': '텀블러 화이트',
        'P-BLACK': '텀블러 블랙',
      };
      const rawResult = await this.google.call<unknown>('runGemini', {
        instruction: instructionText,
        product_name: productNames[inspection.product_id] ?? '제품 미지정',
        weight: inspection.weight_g === null ? '미측정' : `${inspection.weight_g}g`,
        revision,
        standard,
        imageIds,
      });
      const result = normalizeGeminiResult(rawResult);
      if (!result) throw new Error('AI 응답 형식이 올바르지 않아 판독하지 못했습니다.');

      const record: GeminiResultRecord = {
        result_id: `GR-${randomBytes(4).toString('hex')}`,
        inspection_id: inspection.inspection_id,
        created_at: this.koreanDateTime(),
        mode: 'live',
        revision,
        instruction_name: instructionName,
        instruction_text: instructionText,
        product_id: inspection.product_id,
        weight_g: inspection.weight_g,
        images: inspection.images,
        result,
      };
      await this.save(record);
      this.runStates.set(inspection.inspection_id, { state: 'idle' });
    } catch (error) {
      this.runStates.set(inspection.inspection_id, {
        state: 'failed',
        error: this.readErrorMessage(error),
      });
    }
  }

  private makeMockResult(
    inspection: Inspection,
    revision: 'Rev.A' | 'Rev.B',
    instructionName: string,
    instructionText: string,
  ): GeminiResultRecord {
    const weight = inspection.weight_g === null ? '미측정' : `${inspection.weight_g}g`;
    const draft = `[모의 테스트 초안] 현재 중량: ${weight}.`;
    return {
      result_id: `GR-${randomBytes(4).toString('hex')}`,
      inspection_id: inspection.inspection_id,
      created_at: this.koreanDateTime(),
      mode: 'mock',
      revision,
      instruction_name: instructionName,
      instruction_text: instructionText,
      product_id: inspection.product_id,
      weight_g: inspection.weight_g,
      images: inspection.images,
      result: {
        판정: 'HOLD',
        불량유형: `${draft} 모의 판독에서는 불량 유형을 확정하지 않습니다.`,
        '관찰·수치 근거': `${draft} 사진과 검사 기록은 실제 분석하지 않았습니다.`,
        '적용 기준과 출처': `${draft} 선택한 검사기준: ${revision}.`,
        '권고 조치': `${draft} 담당자가 사진과 측정값을 직접 확인해 주세요.`,
        '사람 승인 필요 여부': `${draft} 사람이 결과를 확인해야 합니다.`,
      },
    };
  }

  private async readResults(inspectionId?: string): Promise<GeminiResultRecord[]> {
    if (getStorageInfo().storage === 'live') {
      const values = inspectionId ? { inspection_id: inspectionId } : {};
      const response = await this.google.call<GoogleGeminiResults>('listGeminiResults', values);
      return this.normalizeGoogleResults(response.results ?? []);
    }

    const records = this.readLocalResults();
    return inspectionId
      ? records.filter((record) => record.inspection_id === inspectionId)
      : records;
  }

  private normalizeGoogleResults(records: GoogleGeminiResultRecord[]): GeminiResultRecord[] {
    return records.map((record) => {
      const result = normalizeGeminiResult(this.parseGoogleCell(record.result));
      if (!result) throw new Error('저장된 판독 결과를 읽을 수 없습니다.');
      const images = this.parseGoogleCell(record.images);
      return {
        ...record,
        weight_g: record.weight_g === null || record.weight_g === '' ? null : Number(record.weight_g),
        images: Array.isArray(images)
          ? images.filter((image): image is string => typeof image === 'string')
          : [],
        result,
      };
    });
  }

  private parseGoogleCell(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }

  private readLocalResults(): GeminiResultRecord[] {
    if (!existsSync(this.filePath)) return [];
    const value: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
    return Array.isArray(value) ? (value as GeminiResultRecord[]) : [];
  }

  private readLocalEvidenceLinks(): EvidenceLinkRecord[] {
    const filePath = path.join(process.cwd(), 'runtime', 'evidence-links.json');
    if (!existsSync(filePath)) return [];
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(value) ? value as EvidenceLinkRecord[] : [];
  }

  private async save(record: GeminiResultRecord): Promise<void> {
    if (getStorageInfo().storage === 'live') {
      const result = await this.google.call<{ saved: number }>('saveGeminiResult', {
        record: {
          ...record,
          images: JSON.stringify(record.images),
          result: JSON.stringify(record.result),
        },
      });
      if (result.saved !== 1) throw new Error('판독 결과를 저장하지 못했습니다.');
      return;
    }

    const records = this.readLocalResults();
    records.push(record);
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    renameSync(temporaryPath, this.filePath);
  }

  private readErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      if (typeof response === 'object' && response !== null) {
        const body = response as { message?: unknown; error?: unknown };
        if (typeof body.message === 'string') return body.message;
        if (Array.isArray(body.message)) return body.message.join(' ');
        if (typeof body.error === 'string') return body.error;
      }
    }
    return error instanceof Error ? error.message : '판독하지 못했습니다.';
  }

  private koreanDateTime(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }
}
