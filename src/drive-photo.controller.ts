import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import { GoogleWebAppClient } from './google-web-app.client';

interface GooglePhoto {
  mimeType: string;
  base64: string;
}

@Controller('api/drive')
export class DrivePhotoController {
  constructor(private readonly google: GoogleWebAppClient) {}

  @Get(':fileId')
  async getPhoto(@Param('fileId') fileId: string): Promise<StreamableFile> {
    const photo = await this.google.call<GooglePhoto>('getPhoto', { id: fileId });
    return new StreamableFile(Buffer.from(photo.base64, 'base64'), { type: photo.mimeType });
  }
}
