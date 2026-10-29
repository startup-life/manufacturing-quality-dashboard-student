import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';
import { InputError, dateInput, gasHttpError } from './validation';
import { standardFor } from './reports';
import { integrationStatus } from './integrations';
import { promptCore } from './prompt-core';

@Controller('api')
export class AppController {
  constructor(private readonly app: AppService) {}

  @Get('drive-photos/:imageId')
  async drivePhoto(@Param('imageId') imageId: string, @Res() res: Response) {
    if (!this.app.repo.live) throw new InputError('Google 사진 연결이 필요합니다.', 503);
    const photo = await this.app.repo.photo(imageId);
    const bytes = Buffer.from(photo.data_base64, 'base64');
    res.type(photo.mime);
    // The bytes of an image_id never change (Live.gs storeLivePhoto), so the browser keeps them for an hour.
    // Set last: a missing photo or any failure above keeps the no-store every /api answer gets (security.ts).
    res.set('Cache-Control', 'private, max-age=3600').send(bytes);
  }

  @Get('home')
  home(@Query('date') date: unknown) {
    return this.app.repo.home(dateInput(date));
  }

  @Get('health')
  health() {
    const live = this.app.repo.live;
    return { status: 'ok', database: live ? 'google-sheets' : 'local-json', provider: live ? 'gas' : 'local-simulation', scope: '교육용; 출하 승인 아님' };
  }

  @Get('products')
  products() {
    return this.app.repo.products();
  }

  @Get('standards/:revision')
  async standard(@Param('revision') revision: string) {
    try {
      const standard = await standardFor(revision);
      // The criteria text built from the source document, the same text the GAS sends to Gemini.
      const source = await this.app.readStandardSource(revision);
      if (!source) throw new InputError('적용 기준 원문이 없습니다.', 503);
      return { ...standard, natural_text: promptCore.sourceStandard(source.standard_text, standard) };
    } catch (err) {
      throw gasHttpError(err);
    }
  }

  // The source checks saved for a draft (read only); tab 2's badge reads them.
  @Get('drafts/:id/evidence')
  draftEvidence(@Param('id') id: string) {
    return this.app.repo.transport.dispatch('drafts.evidence.list', { draft_id: id });
  }

  @Get('operations')
  operations() {
    const { repo, geminiMode, integrations, options } = this.app;
    return {
      // Older fields, kept by name; with GEMINI_MODE off or mock they no longer claim the GAS Gemini call.
      ai_mode: repo.live && geminiMode === 'live' ? 'gas-gemini-free-api' : 'not-configured',
      external_api_enabled: repo.live && geminiMode === 'live' && options.geminiReady === true,
      revisions: ['Rev.A', 'Rev.B'],
      scope: '교육용·출하 승인 없음',
      storage_provider: repo.live ? 'gas' : 'local-simulation',
      integrations: integrationStatus(integrations, { geminiReady: options.geminiReady, geminiModels: options.geminiModels })
    };
  }
}
