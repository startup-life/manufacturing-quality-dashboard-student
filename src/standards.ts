import fs from 'node:fs/promises'; import path from 'node:path'; import { InputError } from './validation';
const standards = path.join(__dirname, '../standards');
export const PRODUCTS = [
  { product_id: 'P-SILVER', product_name: '텀블러 실버', color: '은색' },
  { product_id: 'P-WHITE', product_name: '텀블러 화이트', color: '흰색' },
  { product_id: 'P-BLACK', product_name: '텀블러 블랙', color: '검정' }
];
export async function standardFor(revision: string) {
  if (!['Rev.A', 'Rev.B'].includes(revision)) throw new InputError('기준 버전을 확인하세요.');
  const { title, scope, weight } = JSON.parse(await fs.readFile(path.join(standards, revision + '.json'), 'utf8'));
  return { revision, title, scope, weight };
}
