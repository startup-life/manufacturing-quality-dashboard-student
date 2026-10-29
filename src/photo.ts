import sharp from 'sharp';
import { InputError } from './validation';

export async function normalizePhoto(bytes: Buffer, mime: string) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime) || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 4 * 1024 * 1024) throw new InputError('JPEG·PNG·WebP 사진을 4MB 이하로 업로드하세요.', 415);
  try {
    const image = sharp(bytes, { limitInputPixels: 20000000, animated: false });
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages || 1) > 1) throw Error('not a still photo');
    // Decode, rotate, re-encode, strip EXIF; do not serve arbitrary submitted bytes.
    return await image.rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).toColourspace('srgb').jpeg({ quality: 88 }).toBuffer();
  } catch { throw new InputError('읽을 수 있는 단일 사진 파일을 선택하세요.', 415); }
}
