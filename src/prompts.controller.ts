import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AppService } from './app.service';
import { InputError, gasHttpError, setupError } from './validation';
import { standardFor } from './reports';
import { promptCore } from './prompt-core';

@Controller('api')
export class PromptsController {
  constructor(private readonly app: AppService) {}

  @Get('prompts')
  async list(@Query('kind') kind: unknown) {
    return { versions: await this.app.promptStore.list(kind) };
  }

  @Post('prompts/:kind/versions')
  save(@Param('kind') kind: string, @Body() body: any, @Req() req: Request, @Headers('x-request-id') requestId: string | undefined) {
    return this.app.promptStore.save(kind, body, req.session.user!, requestId);
  }

  @Get('inspections/:id/prompt-preview')
  async preview(@Param('id') id: string, @Query() query: Record<string, any>) {
    const { repo, promptStore } = this.app;
    const kind = query.kind; if (!['gemini', 'notebooklm'].includes(kind)) throw new InputError('지시문 종류를 확인하세요.');
    const inspection = await repo.detail(id); if (!inspection) throw new InputError('검사 기록이 없습니다.', 404);
    if (query.expected_version !== undefined) {
      const expected = Number(query.expected_version);
      if (!/^\d+$/.test(query.expected_version) || !Number.isSafeInteger(expected)) throw new InputError('최신 검사 버전을 확인하세요.');
      if (expected !== inspection.content_version) throw new InputError('검사 자료가 변경됐습니다. 최신 검사 내용을 다시 조회하세요.', 409);
    }
    const revision = query.revision || 'Rev.A', standard = await standardFor(revision), prompt = await promptStore.resolve(kind, query.prompt_version_id);
    const source = await repo.transport.dispatch('standards.get', { revision });
    if (!source?.rules_json || JSON.stringify(JSON.parse(source.rules_json)) !== JSON.stringify(standard)) throw new InputError('Google 검사기준과 로컬 기준이 일치하지 않습니다.', 409);
    // The stored source text, so the preview shows the criteria the GAS sends to Gemini. A source that does not match rules_json is a 503 setup error.
    // Without the source text assemblePrompt would fall back to the built-in criteria text.
    if (typeof source.standard_text !== 'string') throw setupError('검사기준 원문 설정 확인이 필요합니다. 저장된 기준 원문이 없습니다.', 'SETUP_REQUIRED');
    let assembled;
    try { assembled = promptCore.assemblePrompt(kind, prompt.text, { ...inspection, standard_revision: revision }, standard, source.standard_text); } catch (e) { throw gasHttpError(e); }
    return { ...assembled, prompt, content_version: inspection.content_version, revision };
  }
}
