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
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Inspection } from './inspection.types';
import { InspectionStore, type PreparedPhoto } from './inspection.store';
import { GeminiResultStore } from './gemini-result.store';
import { findPrompt } from './prompts.controller';
import { getGeminiInfo } from './storage-mode';

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

@Controller('api/inspections')
export class InspectionsController {
  constructor(
    private readonly store: InspectionStore,
    private readonly geminiResults: GeminiResultStore,
  ) {}

  @Get()
  async getMany(
    @Query('date') date?: string,
    @Query('decision') decision?: string,
    @Query('review') review?: string,
  ): Promise<Inspection[]> {
    let inspections = await this.store.getAll();
    if (date) inspections = inspections.filter((item) => item.inspected_at.slice(0, 10) === date);
    if (decision) inspections = inspections.filter((item) => item.decision === decision);
    if (review === 'pending') {
      const inspectionIdsWithResults = await this.geminiResults.getInspectionIdsWithResults();
      inspections = inspections.filter((item) => inspectionIdsWithResults.has(item.inspection_id));
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
  async getOne(@Param('inspectionId') inspectionId: string): Promise<Inspection> {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');
    return inspection;
  }

  @Patch(':inspectionId')
  async update(
    @Param('inspectionId') inspectionId: string,
    @Body() body: Partial<Pick<Inspection, 'product_id' | 'inspected_at' | 'weight_g'>>,
  ): Promise<Inspection> {
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

    if (mode === 'live') {
      return this.geminiResults.startLive(inspection, revision, prompt.name, prompt.text);
    }
    return this.geminiResults.startMock(inspection, revision, prompt.name, prompt.text);
  }

  @Get(':inspectionId/gemini')
  async getGeminiStatus(@Param('inspectionId') inspectionId: string) {
    const inspection = await this.store.find(inspectionId);
    if (!inspection) throw new NotFoundException('검사를 찾을 수 없습니다.');
    return this.geminiResults.getStatus(inspection);
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
