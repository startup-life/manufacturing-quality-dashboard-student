import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';
import { InputError, dateInput } from './validation';
import { standardFor } from './reports';
import { integrationStatus } from './integrations';

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
  standard(@Param('revision') revision: string) {
    return standardFor(revision);
  }

  @Get('operations')
  operations() {
    return { integrations: integrationStatus(this.app.repo.live ? 'live' : 'mock') };
  }
}
