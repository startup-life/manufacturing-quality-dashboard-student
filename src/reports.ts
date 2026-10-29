import fs from 'node:fs/promises'; import path from 'node:path'; import { InputError } from './validation';
const standards = path.join(__dirname, '../standards');
export async function standardFor(revision: string) {
  if (!['Rev.A', 'Rev.B'].includes(revision)) throw new InputError('기준 버전을 확인하세요.');
  return JSON.parse(await fs.readFile(path.join(standards, revision + '.json'), 'utf8'));
}
