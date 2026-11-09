import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Inspection } from './inspection.types';
import { InspectionStore, type PreparedPhoto } from './inspection.store';
import { GeminiResultStore } from './gemini-result.store';
import { EvidenceQueryStore } from './evidence-query.store';
import type { EvidenceQueryRecord } from './evidence-query.types';
import { EvidenceLinkStore } from './evidence-link.store';
import type { EvidenceLinkRecord, EvidenceLinkStatus } from './evidence-link.types';
import {
  inspectionDefectNames,
  type InspectionRecord,
  type InspectionRecordDecision,
  type InspectionRecordWithDefects,
  type InspectionView,
} from './inspection-record.types';
import { NotebookLMClient } from './notebooklm.client';
import { findPrompt } from './prompts.controller';
import { getGeminiInfo, getNotebookLMInfo } from './storage-mode';

const productIds = new Set(['P-SILVER', 'P-WHITE', 'P-BLACK']);
interface CreateInspectionBody {
  product_id?: unknown;
  inspected_at?: unknown;
  revision?: unknown;
  weight_g?: unknown;
  memo?: unknown;
  images?: unknown;
}

interface StartGeminiBody {
  revision?: unknown;
  prompt?: unknown;
}

interface AskEvidenceBody {
  prompt?: unknown;
}

interface SaveEvidenceLinkBody {
  verdict?: unknown;
  memo?: unknown;
}

interface SaveInspectionRecordBody {
  decision?: unknown;
  defects?: unknown;
  memo?: unknown;
  change_reason?: unknown;
}

const productNames: Record<string, string> = {
  'P-SILVER': '텀블러 실버',
  'P-WHITE': '텀블러 화이트',
  'P-BLACK': '텀블러 블랙',
};

@Controller('api/inspections')
export class InspectionsController {
  constructor(
    private readonly store: InspectionStore,
    private readonly geminiResults: GeminiResultStore,
    private readonly evidenceQueries: EvidenceQueryStore,
    private readonly evidenceLinks: EvidenceLinkStore,
    private readonly notebookLM: NotebookLMClient,
  ) {}

  @Get()
  async getMany(
    @Query('date') date?: string,
    @Query('decision') decision?: string,
    @Query('review') review?: string,
  ): Promise<InspectionView[]> {
    let inspections = await this.store.getAll();
    if (date) inspections = inspections.filter((item) => item.inspected_at.slice(0, 10) === date);
    if (decision) inspections = inspections.filter((item) => item.decision === decision);
    if (review === 'pending') {
      const pendingIds = await this.geminiResults.getReviewPendingInspectionIds(inspections);
      inspections = inspections.filter((item) => pendingIds.has(item.inspection_id));
    }
    return inspections.sort((a, b) => b.inspected_at.localeCompare(a.inspected_at));
  }

  @Post()
  async create(@Body() body: CreateInspectionBody): Promise<Inspection> {
    if (!Array.isArray(body?.images) || body.images.length === 0) {
      throw new BadRequestException('사진을 골라 주세요.');
    }
    if (typeof body.product_id !== 'string' || !productIds.has(body.product_id)) {
      throw new BadRequestException('제품을 확인하세요.');
    }
    if (typeof body.inspected_at !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(body.inspected_at)) {
      throw new BadRequestException('검사일시를 확인하세요.');
    }
    if (body.revision !== 'Rev.A' && body.revision !== 'Rev.B') {
      throw new BadRequestException('검사기준을 확인하세요.');
    }
    const weight = this.readWeight(body.weight_g);
    if (typeof body.memo !== 'string' && body.memo !== undefined) {
      throw new BadRequestException('메모를 확인하세요.');
    }
    const photos = body.images.map((image) => this.readImage(image));

    const inspectionId = `INSP-${this.koreanDate()}-${randomBytes(4).toString('hex')}`;
    const inspection: Inspection = {
      inspection_id: inspectionId,
      product_id: body.product_id,
      inspected_at: body.inspected_at,
      revision: body.revision,
      weight_g: weight,
      memo: typeof body.memo === 'string' ? body.memo : '',
      decision: null,
      content_version: 0,
      images: [],
    };
    return this.store.register(inspection, photos);
  }

  @Get(':inspectionId')
  async getOne(@Param('inspectionId') inspectionId: string): Promise<InspectionView> {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');
    return inspection;
  }

  @Patch(':inspectionId')
  async update(
    @Param('inspectionId') inspectionId: string,
    @Body() body: Partial<Pick<Inspection, 'product_id' | 'inspected_at' | 'weight_g'>>,
  ): Promise<InspectionView> {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');

    if (body.product_id !== undefined) {
      if (typeof body.product_id !== 'string' || !productIds.has(body.product_id)) {
        throw new BadRequestException('제품을 확인하세요.');
      }
      inspection.product_id = body.product_id;
    }
    if (body.inspected_at !== undefined) {
      if (typeof body.inspected_at !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(body.inspected_at)) {
        throw new BadRequestException('검사일시를 확인하세요.');
      }
      inspection.inspected_at = body.inspected_at;
    }
    if (body.weight_g !== undefined) inspection.weight_g = this.readWeight(body.weight_g);
    inspection.content_version += 1;
    await this.store.update(inspection);
    return inspection;
  }

  @Post(':inspectionId/records')
  async saveInspectionRecord(
    @Param('inspectionId') inspectionId: string,
    @Body() body: SaveInspectionRecordBody,
    @Req() request: Request,
  ): Promise<InspectionRecordWithDefects> {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');

    if (body?.decision !== 'OK' && body?.decision !== 'NG' && body?.decision !== 'HOLD') {
      throw new BadRequestException('판정을 골라 주세요.');
    }
    if (typeof body.change_reason !== 'string' || body.change_reason.trim() === '') {
      throw new BadRequestException('변경 사유를 적어 주세요.');
    }
    if (inspection.weight_g === null && body.decision === 'OK') {
      throw new BadRequestException('중량이 없는 검사는 정상(OK)으로 저장할 수 없습니다.');
    }
    if (body.memo !== undefined && typeof body.memo !== 'string') {
      throw new BadRequestException('메모를 확인하세요.');
    }
    const defects = body.defects === undefined ? [] : body.defects;
    if (
      !Array.isArray(defects) ||
      defects.some(
        (defect) =>
          typeof defect !== 'string' || !Object.prototype.hasOwnProperty.call(inspectionDefectNames, defect),
      ) ||
      new Set(defects).size !== defects.length
    ) {
      throw new BadRequestException('불량을 확인하세요.');
    }

    const record: InspectionRecord = {
      record_id: `REC-${randomBytes(4).toString('hex')}`,
      inspection_id: inspection.inspection_id,
      user_id: request.session.user?.username ?? '',
      recorded_at: this.koreanDateTime(),
      decision: body.decision as InspectionRecordDecision,
      weight_g: inspection.weight_g,
      notes: typeof body.memo === 'string' ? body.memo : '',
      content_version: inspection.content_version + 1,
      change_reason: body.change_reason,
    };
    await this.store.saveRecord(inspection, record, defects as string[]);
    return {
      ...record,
      defects: (defects as string[]).map((defect_code) => ({
        defect_code,
        defect_name: inspectionDefectNames[defect_code],
      })),
    };
  }

  @Get(':inspectionId/records')
  async getInspectionRecords(
    @Param('inspectionId') inspectionId: string,
  ): Promise<InspectionRecordWithDefects[]> {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');
    return this.store.getRecords(inspectionId);
  }

  @Post(':inspectionId/gemini')
  async startGemini(
    @Param('inspectionId') inspectionId: string,
    @Body() body: StartGeminiBody,
  ) {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');

    const mode = getGeminiInfo().gemini_mode;
    if (mode === 'off') throw new BadRequestException('Gemini 판독이 꺼져 있습니다.');

    const revision = body?.revision === undefined ? inspection.revision : body.revision;
    if (revision !== 'Rev.A' && revision !== 'Rev.B') {
      throw new BadRequestException('검사기준을 확인하세요.');
    }
    const promptName = body?.prompt === undefined ? 'v3' : body.prompt;
    if (typeof promptName !== 'string') {
      throw new BadRequestException('지시문 버전을 확인하세요.');
    }
    const prompt = findPrompt(promptName);
    if (!prompt) throw new BadRequestException('지시문 버전을 찾을 수 없습니다.');

    const beforeRun = await this.geminiResults.getStatus(inspection);
    const link = beforeRun.link ?? null;

    if (mode === 'live') {
      return {
        ...(await this.geminiResults.startLive(inspection, revision, prompt.name, prompt.text)),
        link,
      };
    }
    return {
      ...(await this.geminiResults.startMock(inspection, revision, prompt.name, prompt.text)),
      link,
    };
  }

  @Get(':inspectionId/gemini')
  async getGeminiStatus(@Param('inspectionId') inspectionId: string) {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');
    return this.geminiResults.getStatus(inspection);
  }

  @Get(':inspectionId/evidence')
  async getEvidenceStatus(@Param('inspectionId') inspectionId: string) {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');

    const geminiStatus = await this.geminiResults.getStatus(inspection);
    const latest = geminiStatus.results[0] ?? null;
    const query = latest
      ? await this.evidenceQueries.getLatestForDraft(inspectionId, latest.result_id)
      : null;
    const link = query ? await this.evidenceLinks.getLatestForQuery(query.query_id) : null;
    return {
      mode: getNotebookLMInfo().notebooklm_mode,
      revision: latest?.revision ?? inspection.revision,
      has_result: Boolean(latest),
      stale: geminiStatus.stale,
      query,
      link,
    };
  }

  @Post(':inspectionId/evidence')
  async askEvidence(
    @Param('inspectionId') inspectionId: string,
    @Body() body: AskEvidenceBody,
  ): Promise<EvidenceQueryRecord> {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');

    const mode = getNotebookLMInfo().notebooklm_mode;
    if (mode === 'off') throw new BadRequestException('NotebookLM 근거 대조가 꺼져 있습니다.');

    const geminiStatus = await this.geminiResults.getStatus(inspection);
    const latest = geminiStatus.results[0];
    if (!latest) throw new BadRequestException('2번 탭에서 판독 결과를 먼저 준비하세요.');
    if (geminiStatus.stale) throw new BadRequestException('2번 탭에서 다시 판독해 주세요.');

    const promptName = body?.prompt === undefined ? 'v3' : body.prompt;
    if (typeof promptName !== 'string') {
      throw new BadRequestException('근거 질문 버전을 확인하세요.');
    }
    const prompt = findPrompt(promptName, 'notebooklm');
    if (!prompt) throw new BadRequestException('근거 질문 버전을 찾을 수 없습니다.');

    const fixedText = readFileSync(
      path.join(process.cwd(), 'docs', 'guide', 'files', 'reference', 'notebooklm-fixed-text.md'),
      'utf8',
    );
    const safety = fixedText.match(/^안전 문구: (.+)$/m)?.[1];
    const queryLine = fixedText.match(/^조회 줄: (.+)$/m)?.[1];
    if (!safety || !queryLine) throw new Error('NotebookLM 질문 문구를 읽을 수 없습니다.');

    const revision = latest.revision;
    const weight = latest.weight_g === null ? '미측정' : `${latest.weight_g}g`;
    const question = [
      safety,
      `[근거 질문]\n\n${prompt.text.trim()}`,
      `[검사 정보]\n\n제품: ${productNames[latest.product_id] ?? '제품 미지정'} (${latest.product_id}) / 중량: ${weight} / 적용 검사기준 버전: ${revision}`,
      queryLine.replace(/Rev\.[AB]/, revision),
    ].join('\n\n');

    const standard = readFileSync(
      path.join(process.cwd(), 'standards', `notebooklm-${revision}.md`),
      'utf8',
    );
    let answer: string;
    let sources: unknown[];
    if (mode === 'mock') {
      answer = this.makeMockEvidenceAnswer(revision, standard);
      sources = [];
    } else {
      const response = await this.notebookLM.query(question);
      answer = response.text;
      sources = response.sources;
    }

    const record: EvidenceQueryRecord = {
      query_id: `EQ-${randomBytes(4).toString('hex')}`,
      inspection_id: inspection.inspection_id,
      draft_id: latest.result_id,
      created_at: this.koreanDateTime(),
      mode,
      revision,
      prompt_name: prompt.name,
      question,
      answer,
      sources,
    };
    await this.evidenceQueries.save(record);
    return record;
  }

  @Post(':inspectionId/evidence-link')
  async saveEvidenceLink(
    @Param('inspectionId') inspectionId: string,
    @Body() body: SaveEvidenceLinkBody,
    @Req() request: Request,
  ): Promise<EvidenceLinkRecord> {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');

    const status = await this.geminiResults.getStatus(inspection);
    const latest = status.results[0];
    const query = latest
      ? await this.evidenceQueries.getLatestForDraft(inspectionId, latest.result_id)
      : null;
    if (!query) throw new BadRequestException('근거 확인을 먼저 하세요.');
    if (body?.verdict !== 'match' && body?.verdict !== 'review') {
      throw new BadRequestException('대조 결과를 확인하세요.');
    }
    if (body.memo !== undefined && typeof body.memo !== 'string') {
      throw new BadRequestException('메모를 확인하세요.');
    }

    const linkStatus: EvidenceLinkStatus = query.mode === 'mock'
      ? body.verdict === 'match' ? 'MOCK_USER_REVIEWED' : 'MOCK_REVIEW_NEEDED'
      : body.verdict === 'match' ? 'VERIFIED_BY_USER' : 'REVIEW_NEEDED_BY_USER';
    const record: EvidenceLinkRecord = {
      link_id: `EL-${randomBytes(4).toString('hex')}`,
      query_id: query.query_id,
      inspection_id: inspection.inspection_id,
      draft_id: latest!.result_id,
      status: linkStatus,
      memo: typeof body.memo === 'string' ? body.memo : '',
      user: request.session.user?.username ?? '',
      created_at: this.koreanDateTime(),
    };
    await this.evidenceLinks.save(record);
    return record;
  }

  private makeMockEvidenceAnswer(revision: string, standard: string): string {
    const section = standard.split(/^## 2\. 외관 기준\s*$/m)[1]?.split(/^## /m)[0] ?? '';
    const firstSentence = section
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#'))
      ?.match(/^.+?[.!?](?:\s|$)/)?.[0]
      ?.trim();
    if (!firstSentence) throw new Error('검사기준 원문을 읽을 수 없습니다.');
    return `${revision} 표준서 원문: "${firstSentence}" (출하 승인 없음, 담당자 대조 확인 필요)`;
  }

  private koreanDateTime(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
  }

  private readWeight(value: unknown): number | null {
    if (value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException('중량을 확인하세요.');
    }
    return value;
  }

  private readImage(value: unknown): PreparedPhoto {
    if (typeof value !== 'string') throw new BadRequestException('사진을 확인하세요.');
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(value);
    if (!match) throw new BadRequestException('사진을 확인하세요.');

    const extension = match[1].split('/')[1].replace('jpeg', 'jpg');
    return {
      name: `${randomUUID()}.${extension}`,
      mimeType: match[1],
      base64: match[2],
    };
  }

  private koreanDate(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date()).replaceAll('-', '');
  }
}
