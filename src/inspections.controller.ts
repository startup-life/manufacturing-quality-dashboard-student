import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { FactoryUserGuard } from './factory-user.guard';
import { InputError, inspectionInput, listInput, updateInput } from './validation';
import { normalizePhoto } from './photo';
import * as store from './local-store';

const root = path.join(__dirname, '..');
const imageLock = JSON.parse(fs.readFileSync(path.join(root, 'assets/image-lock.json'), 'utf8'));
export const learningImages: { id: string; url: string }[] = imageLock.assets
  .map((x: { id: string }) => ({ id: x.id, url: '/media/' + x.id + '.jpg' }));

@Controller('api/inspections')
export class InspectionsController {
  @Get()
  list(@Query() query: Record<string, unknown>) {
    return store.list(listInput(query));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const row = await store.detail(id);
    if (!row) throw new InputError('검사 기록이 없습니다.', 404);
    return row;
  }

  @Patch(':id')
  @UseGuards(FactoryUserGuard)
  update(@Param('id') id: string, @Body() body: any) {
    return store.update(id, updateInput(body));
  }

  @Post()
  @UseGuards(FactoryUserGuard)
  async create(@Req() req: Request, @Body() reqBody: any) {
    // The same X-Request-Id (the form resends it for unchanged input) gives the same inspection number.
    const requestId = req.get('X-Request-Id') || crypto.randomUUID();
    const body = { ...reqBody };
    if (!body.inspection_id) {
      body.inspection_id = `INSP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.createHash('sha256').update(requestId).digest('hex').slice(0, 8)}`;
    }
    if (!body.inspected_at) {
      body.inspected_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    const existing = typeof body.inspection_id === 'string' ? await store.detail(body.inspection_id) : null;
    if (existing) return existing;

    if (Array.isArray(body.photos) && body.photos.length > 0) {
      body.images = Array.isArray(body.images) ? [...body.images] : [];
      for (const p of body.photos) {
        if (p && p.data_base64) {
          const bytes = Buffer.from(p.data_base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
          const normalized = await normalizePhoto(bytes, p.mime || 'image/jpeg');
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

    const allowedImageUrls = new Set([...learningImages.map(x => x.url)]);
    if (Array.isArray(body.images)) {
      for (const img of body.images) {
        if (typeof img === 'string' && /^\/(uploads|media)\/[A-Za-z0-9-]+\.jpg$/.test(img)) allowedImageUrls.add(img);
      }
    }
    return store.create(inspectionInput(body, allowedImageUrls));
  }
}
