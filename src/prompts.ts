import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { InputError } from './validation';
import type { GasTransport } from './gas-transport';
const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
export const promptDefaults = ['gemini', 'notebooklm'].flatMap(kind => ['v1', 'v2', 'v3'].map(base_version => {
  const text = fs.readFileSync(path.join(__dirname, `../prompts/${kind}-${base_version}.md`), 'utf8').trim();
  return { kind, base_version, text, sha256: sha(text), prompt_version_id: 'BASE-' + kind + '-' + base_version + '-' + sha(text).slice(0, 12), is_default: true, created_by: '교재 기본 원문' };
}));
export class PromptStore {
  constructor(private readonly transport: Pick<GasTransport, 'dispatch'>) {}
  async list(kind?: unknown) {
    if (kind && !['gemini', 'notebooklm'].includes(kind as string)) throw new InputError('지시문 종류를 확인하세요.');
    const rows = await this.transport.dispatch('prompts.list', { kind });
    if (!Array.isArray(rows) || !rows.length) throw new InputError('프롬프트 자료 준비가 필요합니다. 설정을 확인한 뒤 다시 조회하세요.', 503);
    return rows;
  }
  async resolve(kind: string, id?: unknown) {
    const rows = await this.list(kind);
    const row = id ? rows.find(p => p.prompt_version_id === id) : rows.find(p => p.is_default === true && p.base_version === 'v3');
    if (!row || row.kind !== kind || row.sha256 !== sha(row.text || '')) throw new InputError('저장된 프롬프트 버전이나 원문을 확인하세요.', 422);
    return row;
  }
  async save(kind: string, body: any, user: { username: string }, requestId: string | undefined) {
    if (!['gemini', 'notebooklm'].includes(kind) || !['v1', 'v2', 'v3'].includes(body?.base_version)) throw new InputError('기본 버전을 선택하세요.');
    if (typeof body?.text !== 'string') throw new InputError('지시문은 1~5,000자의 문장으로 작성하세요.');
    const text = body.text.trim();
    if (!text || text.length > 5000) throw new InputError('지시문은 1~5,000자로 작성하세요.');
    if (!requestId || requestId.length > 100) throw new InputError('저장 요청 번호가 필요합니다.');
    const payload = { kind, base_version: body.base_version, text, sha256: sha(text), prompt_version_id: 'PV-' + sha(kind + ':' + requestId).slice(0, 24), created_by: user.username, is_default: false };
    return this.transport.dispatch('prompts.save', payload, { request_id: requestId });
  }
}
