import fs from 'node:fs/promises'; import crypto from 'node:crypto'; import path from 'node:path'; import { InputError } from './validation';
const standards = path.join(__dirname, '../standards');
export async function standardFor(revision: string) {
  if (!['Rev.A', 'Rev.B'].includes(revision)) throw new InputError('기준 버전을 확인하세요.');
  return JSON.parse(await fs.readFile(path.join(standards, revision + '.json'), 'utf8'));
}
// The repository's standard as a GAS standards row (same shape as the initialize seed), or null when the revision has no files.
export async function repositoryStandard(revision: unknown) {
  if (typeof revision !== 'string' || !/^Rev\.[A-Z0-9]+$/.test(revision)) return null;
  let text, rules;
  try {
    text = await fs.readFile(path.join(standards, 'notebooklm-' + revision + '.md'), 'utf8');
    rules = JSON.parse(await fs.readFile(path.join(standards, revision + '.json'), 'utf8'));
  } catch (e: any) { if (e.code === 'ENOENT') return null; throw e; }
  return { standard_id: 'STD-' + revision, revision, standard_text: text, rules_json: JSON.stringify(rules), sha256: crypto.createHash('sha256').update(text).digest('hex') };
}
