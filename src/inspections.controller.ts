import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppService } from './app.service';
import { FactoryUserGuard } from './factory-user.guard';
import { InputError, inspectionInput, listInput } from './validation';
import { normalizePhoto } from './photo';

const root = path.join(__dirname, '..');
const imageLock = JSON.parse(fs.readFileSync(path.join(root, 'assets/image-lock.json'), 'utf8'));
export const learningImages: { id: string; url: string }[] = imageLock.assets
  .map((x: { id: string }) => ({ id: x.id, url: '/media/' + x.id + '.jpg' }));

// No JSON answer from the web app (an HTML error page, a timeout, a dropped connection or a Google 5xx) does not mean
// nothing was saved: GAS may have stored the photos and the inspection before the answer was lost.
// The registration form resends the same X-Request-Id for unchanged input, and GAS answers that from its requests tab.
const UNKNOWN_OUTCOME = /^GAS_(NOT_JSON|TIMEOUT|UNREACHABLE|HTTP_5\d\d)$/;
export const REGISTRATION_UNKNOWN = '등록 응답을 받지 못해 저장됐는지 확인하지 못했습니다. 이 화면은 그대로 두고 새 탭에서 검사 목록을 열어 이 검사가 있는지 먼저 확인하세요. 목록에 있으면 다시 등록하지 마세요. 없을 때만 이 화면에서 내용을 바꾸지 않고 다시 등록하세요. 같은 내용으로 다시 보내면 두 번 저장되지 않습니다.';

@Controller('api/inspections')
export class InspectionsController {
  constructor(private readonly app: AppService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.app.repo.list(listInput(query));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const row = await this.app.repo.detail(id);
    if (!row) throw new InputError('검사 기록이 없습니다.', 404);
    return row;
  }

  @Patch(':id')
  @UseGuards(FactoryUserGuard)
  update(@Param('id') id: string, @Body() body: any) {
    return this.app.repo.update(id, body || {});
  }

  @Post()
  @UseGuards(FactoryUserGuard)
  async create(@Req() req: Request, @Body() reqBody: any) {
    const { repo } = this.app;
    try {
      const requestId = req.get('X-Request-Id') || crypto.randomUUID();
      const body = { ...reqBody };
      if (!body.inspection_id) {
        body.inspection_id = `INSP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.createHash('sha256').update(requestId).digest('hex').slice(0, 8)}`;
      }
      if (!body.inspected_at) {
        body.inspected_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
      }
      if (body.decision === undefined || body.decision === '') {
        body.decision = null;
      }

      if (Array.isArray(body.photos) && body.photos.length > 0) {
        body.images = Array.isArray(body.images) ? [...body.images] : [];
        for (const [photoIndex, p] of body.photos.entries()) {
          if (p && p.data_base64) {
            const bytes = Buffer.from(p.data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
            const normalized = await normalizePhoto(bytes, p.mime || 'image/jpeg');
            if (repo.live) {
              const stored = await repo.storePhoto(normalized, requestId + ':photo:' + photoIndex);
              body.images.push(stored.image_url);
              continue;
            }
            const id = crypto.randomUUID();
            const uploadsDir = path.join(root, 'runtime/uploads');
            await fs.promises.mkdir(uploadsDir, { recursive: true });
            await fs.promises.writeFile(path.join(uploadsDir, `${id}.jpg`), normalized);
            body.images.push(`/uploads/${id}.jpg`);
          } else if (typeof p === 'string' && (p.startsWith('/media/') || p.startsWith('/uploads/'))) {
            body.images.push(p);
          } else if (p && p.url) {
            body.images.push(p.url);
          }
        }
      }

      if (repo.live && Array.isArray(body.images)) {
        for (let index = 0; index < body.images.length; index++) {
          const url = body.images[index];
          const match = /^\/(media|uploads)\/([A-Za-z0-9-]+)\.jpg$/.exec(url);
          if (match) {
            const local = await fs.promises.readFile(path.join(root, 'runtime', match[1] === 'media' ? 'images' : 'uploads', match[2] + '.jpg'));
            const normalized = await normalizePhoto(local, 'image/jpeg');
            body.images[index] = (await repo.storePhoto(normalized, requestId + ':linked:' + index)).image_url;
          }
        }
      }

      const allowedImageUrls = new Set([...learningImages.map(x => x.url)]);
      if (Array.isArray(body.images)) {
        for (const img of body.images) {
          if (typeof img === 'string' && (/^\/(uploads|media)\/[A-Za-z0-9-]+\.jpg$/.test(img) || (repo.live && /^\/api\/drive-photos\/PHOTO-[a-f0-9]{32}$/.test(img)))) {
            allowedImageUrls.add(img);
          }
        }
      }

      const r = inspectionInput(body, allowedImageUrls);
      return await repo.create(r, requestId);
    } catch (err: any) {
      throw UNKNOWN_OUTCOME.test(err?.code || '') ? Object.assign(new InputError(REGISTRATION_UNKNOWN, 503), { code: err.code, cause: err }) : err;
    }
  }
}
