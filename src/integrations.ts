/**
 * The storage switch read once at startup: live (GAS web app) or mock (local file).
 * Messages name the setting and the fix; they never include the web app URL.
 */

import { redact } from './log';

type Env = Record<string, string | undefined>;
export type Integrations = { storage: { mode: string; webAppUrl?: string } };

// A refused setting: the server does not start and prints this one-line message.
// warnings holds the startup warnings collected before the refusal (e.g. an old name), printed first.
export class IntegrationSettingError extends Error {
  warnings: string[];
  constructor(message: string) { super(message); this.warnings = []; }
}

const STORAGE_MODES = ['live', 'mock'];
// Old GAS_TRANSPORT_MODE values and what they mean now.
const LEGACY_STORAGE: Record<string, string> = { oauth: 'live', mock: 'mock' };
// Deployed web app address (consumer or Workspace account). /dev addresses need a signed-in browser.
const WEBAPP_URL = /^https:\/\/script\.google\.com\/(?:a\/macros\/[A-Za-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;
const PLACEHOLDER = /[<>]/;

const value = (env: Env, name: string) => (env[name] === undefined || env[name] === '' ? undefined : String(env[name]));
const refuse: (message: string) => never = message => { throw new IntegrationSettingError(message); };

function storageMode(env: Env, warnings: string[]) {
  const current = value(env, 'STORAGE_MODE');
  const legacy = value(env, 'GAS_TRANSPORT_MODE');
  if (current !== undefined && !STORAGE_MODES.includes(current)) refuse(`STORAGE_MODE는 live, mock 중 하나여야 합니다(지금 값: ${current}).`);
  let legacyMode;
  if (legacy !== undefined) {
    if (!Object.hasOwn(LEGACY_STORAGE, legacy)) refuse(`옛 이름 GAS_TRANSPORT_MODE는 oauth 또는 mock만 받습니다(지금 값: ${legacy}). STORAGE_MODE=live 또는 STORAGE_MODE=mock으로 바꾸세요.`);
    legacyMode = LEGACY_STORAGE[legacy];
    if (legacy === 'oauth') warnings.push('GAS_TRANSPORT_MODE=oauth는 STORAGE_MODE=live로 읽습니다. OAuth 연결은 없어졌고 GAS 웹앱을 씁니다(docs/LOCAL_SETUP.md).');
  }
  if (current !== undefined && legacyMode !== undefined && current !== legacyMode) refuse('STORAGE_MODE와 옛 이름 GAS_TRANSPORT_MODE의 값이 다릅니다. STORAGE_MODE 하나만 남기세요.');
  const mode = current ?? legacyMode ?? 'mock';
  // Refusals name the setting the user wrote, so a value read from the old name says so.
  return { mode, name: current === undefined && legacy !== undefined ? `GAS_TRANSPORT_MODE=${legacy}(STORAGE_MODE=${mode})` : `STORAGE_MODE=${mode}` };
}

// GET /api/operations: the storage the server uses now.
export function integrationStatus(storage: string) {
  return { storage: { mode: storage } };
}

const LABELS: Record<string, string> = { live: 'GAS 웹앱', mock: '로컬 파일' };

// One startup log line, e.g. "연동 상태: 저장소=mock(로컬 파일)".
export function integrationSummary({ storage }: Integrations) {
  return `연동 상태: 저장소=${storage.mode}(${LABELS[storage.mode]})`;
}

function webAppSettings(env: Env, storageName: string) {
  const webAppUrl = value(env, 'GAS_WEBAPP_URL');
  if (!webAppUrl) refuse(`${storageName}에는 GAS_WEBAPP_URL이 필요합니다. docs/LOCAL_SETUP.md를 보세요.`);
  if (PLACEHOLDER.test(webAppUrl)) refuse('GAS_WEBAPP_URL이 예시의 <…> 자리표시 그대로입니다. 편집기의 배포 관리에서 웹앱 URL을 복사해 넣으세요.');
  if (/\/dev\/?$/.test(webAppUrl)) refuse('GAS_WEBAPP_URL이 /dev 주소입니다. /dev는 로그인한 브라우저에서만 열려 서버가 부를 수 없습니다. 배포 관리의 웹앱 URL(/exec로 끝남)을 넣으세요.');
  if (!WEBAPP_URL.test(webAppUrl)) refuse('GAS_WEBAPP_URL은 https://script.google.com/macros/s/<배포 ID>/exec 꼴이어야 합니다. 편집기의 배포 관리에서 웹앱 URL을 복사해 넣으세요.');
  return { webAppUrl };
}

// env is a plain object so tests do not depend on the developer's shell.
export function readIntegrations(env: Env = process.env) {
  const warnings: string[] = [];
  try {
    return readSwitches(env, warnings);
  } catch (e) {
    if (e instanceof IntegrationSettingError) e.warnings = warnings.slice();
    throw e;
  }
}

// npm start's check before opening the port: a failure is one line with its code, not a stack trace.
// Transport messages never carry the web app URL; a platform message (UPSTREAM_FAILED) can carry
// internal IDs such as a sheet ID, so the message is masked the way the server log masks it.
export async function checkGasConnection(transport: { dispatch(action: string): Promise<any> }) {
  try { return await transport.dispatch('connection.status'); }
  catch (e: any) { throw new IntegrationSettingError(`GAS 연결 확인에 실패했습니다(${e?.code || 'UPSTREAM_FAILED'}). ${redact(e?.message || '')}`.trim()); }
}

// For the server and the scripts: warnings go out first, also when the settings are then refused.
// liveOnly: the GAS scripts refuse a mock storage anyway, so its startup warnings are not printed.
export function readIntegrationsWithWarnings(env: Env = process.env, warn: (message: string) => void = console.warn, { liveOnly = false } = {}) {
  let result;
  try { result = readIntegrations(env); } catch (e) {
    if (e instanceof IntegrationSettingError) for (const warning of e.warnings) warn(warning);
    throw e;
  }
  if (!liveOnly || result.storage.mode === 'live') for (const warning of result.warnings) warn(warning);
  return result;
}

function readSwitches(env: Env, warnings: string[]) {
  const { mode, name: storageName } = storageMode(env, warnings);
  let storage: Integrations['storage'] = { mode };
  if (mode === 'live') storage = { mode, ...webAppSettings(env, storageName) };
  if (mode === 'mock' && value(env, 'GAS_WEBAPP_URL') !== undefined) warnings.push('GAS_WEBAPP_URL이 있지만 STORAGE_MODE=mock이라 로컬 저장소를 씁니다.');
  return { storage, warnings };
}
