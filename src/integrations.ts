/**
 * Integration switches read once at startup: storage (live|mock), Gemini and NotebookLM (off|mock|live).
 * Messages name the setting and the fix; they never include the web app URL.
 * A mock result is used only when its switch says mock; a live failure is never replaced by one.
 */

import { redact } from './log';
import { geminiModelText } from './gemini';

type Env = Record<string, string | undefined>;
type Mode = { mode: string };
export type Integrations = { storage: Mode & { webAppUrl?: string }; gemini: Mode; notebooklm: Mode };
export type GeminiModels = { model?: string | null; fallback_model?: string | null } | null | undefined;

// A refused setting: the server does not start and prints this one-line message.
// warnings holds the startup warnings collected before the refusal (e.g. an old name), printed first.
export class IntegrationSettingError extends Error {
  warnings: string[];
  constructor(message: string) { super(message); this.warnings = []; }
}

const STORAGE_MODES = ['live', 'mock'];
const FEATURE_MODES = ['off', 'mock', 'live'];
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

// Shown when the route is called with the switch off: a 409 with guidance, not an empty success.
export const GEMINI_OFF_MESSAGE = 'Gemini 판독이 꺼져 있습니다(GEMINI_MODE=off). 4번 탭에서 직접 판단을 기록하세요.';
export const NOTEBOOKLM_OFF_MESSAGE = 'NotebookLM 근거 대조가 꺼져 있습니다(NOTEBOOKLM_MODE=off). 기준 원문을 직접 읽고 판단하세요.';

const GEMINI_MOCK_MESSAGE = '모의 초안입니다(GEMINI_MODE=mock). 사진을 분석하지 않았고 실제 판독 횟수에 들어가지 않습니다.';
// Read once at startup, so it asks for a restart after the key is set.
const GEMINI_NOT_READY = 'GAS 스크립트 속성에 GEMINI_API_KEY가 없어 판독 요청이 실패합니다. .env에 키를 넣고 npm.cmd run gas:init(macOS: npm run gas:init)을 실행한 뒤 서버를 다시 시작하세요.';
export { GEMINI_NOT_READY };
// connection.status reports null models when the stored GEMINI_MODEL or GEMINI_FALLBACK_MODEL is not allowed
// (e.g. a 2.5 model kept from before); an older GAS reports no model field at all and gets no warning.
export const GEMINI_SETTINGS_INVALID = 'GAS 스크립트 속성의 GEMINI_MODEL 또는 GEMINI_FALLBACK_MODEL이 허용 모델이 아니어서 판독 요청이 실패합니다. .env의 값을 고치거나 지운 뒤 npm.cmd run gas:init(macOS: npm run gas:init)을 실행하고 서버를 다시 시작하세요.';
export function geminiSettingsWarning(connection: any) {
  return connection?.gemini_model === null ? GEMINI_SETTINGS_INVALID : '';
}

const defaults = (storage: string) => ({ gemini: storage === 'live' ? 'live' : 'off', notebooklm: storage === 'live' ? 'off' : 'mock' });

function featureMode(env: Env, name: string) {
  const current = value(env, name);
  if (current !== undefined && !FEATURE_MODES.includes(current)) refuse(`${name}는 off, mock, live 중 하나여야 합니다(지금 값: ${current}).`);
  return current;
}

function notebookLmMode(env: Env) {
  const current = featureMode(env, 'NOTEBOOKLM_MODE');
  const legacy = value(env, 'NOTEBOOKLM_MCP_MODE');
  if (legacy !== undefined && !['live', 'mock'].includes(legacy)) refuse(`옛 이름 NOTEBOOKLM_MCP_MODE는 live 또는 mock만 받습니다(지금 값: ${legacy}). NOTEBOOKLM_MODE=off, mock, live 중 하나로 바꾸세요.`);
  if (current !== undefined && legacy !== undefined && current !== legacy) refuse('NOTEBOOKLM_MODE와 옛 이름 NOTEBOOKLM_MCP_MODE의 값이 다릅니다. NOTEBOOKLM_MODE 하나만 남기세요.');
  return { mode: current ?? legacy, legacy: current === undefined && legacy !== undefined };
}

// The three refused combinations; off is allowed with either storage.
// names: how the user wrote the storage switch and whether NotebookLM came from its old name (readIntegrations).
export function checkModes(storage: string, gemini: string, notebooklm: string, names: { storage?: string; notebooklmLegacy?: boolean } = {}) {
  const storageName = names.storage ?? `STORAGE_MODE=${storage}`;
  if (storage === 'live' && gemini === 'mock') refuse(`${storageName}에서는 GEMINI_MODE=mock을 쓸 수 없습니다(모의 결과가 실제 기록에 섞입니다). GEMINI_MODE를 live 또는 off로 바꾸세요.`);
  if (storage === 'live' && notebooklm === 'mock') refuse(names.notebooklmLegacy
    ? `${storageName}에서는 옛 이름 NOTEBOOKLM_MCP_MODE=mock을 쓸 수 없습니다(모의 근거가 실제 기록에 섞입니다). NOTEBOOKLM_MCP_MODE 줄을 지우고 NOTEBOOKLM_MODE를 live 또는 off로 넣으세요.`
    : `${storageName}에서는 NOTEBOOKLM_MODE=mock을 쓸 수 없습니다(모의 근거가 실제 기록에 섞입니다). NOTEBOOKLM_MODE를 live 또는 off로 바꾸세요.`);
  if (storage === 'mock' && gemini === 'live') refuse(`${storageName}에서는 GEMINI_MODE=live를 쓸 수 없습니다(Gemini는 GAS 안에서만 호출합니다). STORAGE_MODE=live로 GAS에 연결하거나 GEMINI_MODE를 off 또는 mock으로 바꾸세요.`);
}

// createApp's modes: storage follows the transport, missing switches take the storage defaults.
export function appIntegrations(given: Partial<Integrations> = {}, storage: string): Integrations {
  const fallback = defaults(storage);
  const gemini = given.gemini?.mode ?? fallback.gemini, notebooklm = given.notebooklm?.mode ?? fallback.notebooklm;
  if (!FEATURE_MODES.includes(gemini) || !FEATURE_MODES.includes(notebooklm)) refuse(`GEMINI_MODE와 NOTEBOOKLM_MODE는 off, mock, live 중 하나여야 합니다(지금 값: ${gemini}, ${notebooklm}).`);
  checkModes(storage, gemini, notebooklm);
  return { storage: { mode: storage }, gemini: { mode: gemini }, notebooklm: { mode: notebooklm } };
}

// GET /api/operations: each switch with whether it can run now. mcpClient reports the live NotebookLM launch check.
// geminiModels: the models GAS reported at startup ({ model, fallback_model }, '' for no fallback); live only.
export function integrationStatus({ storage, gemini, notebooklm }: Integrations, { geminiReady = false, mcpClient, geminiModels }: { geminiReady?: boolean; mcpClient?: { liveProblem?(): string | null; liveVerified?: boolean }; geminiModels?: GeminiModels } = {}) {
  const liveProblem = notebooklm.mode === 'live' ? mcpClient?.liveProblem?.() ?? null : null;
  const verified = notebooklm.mode === 'live' && mcpClient?.liveVerified === true;
  return {
    storage: { mode: storage.mode },
    gemini: {
      mode: gemini.mode,
      ready: gemini.mode === 'mock' || (gemini.mode === 'live' && geminiReady === true),
      message: gemini.mode === 'off' ? GEMINI_OFF_MESSAGE : gemini.mode === 'mock' ? GEMINI_MOCK_MESSAGE : geminiReady === true ? 'GAS에서 Gemini 판독을 호출합니다.' : GEMINI_NOT_READY,
      ...liveModels(gemini.mode, geminiModels)
    },
    notebooklm: {
      mode: notebooklm.mode,
      ready: notebooklm.mode === 'mock' || (notebooklm.mode === 'live' && !liveProblem),
      verified,
      message: notebooklm.mode === 'off' ? NOTEBOOKLM_OFF_MESSAGE
        : notebooklm.mode === 'mock' ? '로컬 모의 응답입니다. 실제 NotebookLM에 질의하지 않습니다.'
        : liveProblem || (verified ? 'NotebookLM MCP 서버가 연결되었습니다.' : '실행 설정을 확인했습니다. 실제 연결은 근거 확인을 누를 때 확인합니다.')
    }
  };
}

const LABELS: Record<string, Record<string, string>> = {
  storage: { live: 'GAS 웹앱', mock: '로컬 파일' },
  gemini: { off: '사람이 직접 판정', mock: '모의 초안', live: 'GAS에서 Gemini 호출' },
  notebooklm: { off: '근거 대조 꺼짐', mock: '모의 응답', live: '실제 질의' }
};
// A GAS deployed before the model fields reports none; then no model is shown rather than a guess from .env.
function liveModels(mode: string, models: GeminiModels): { model?: string; fallback_model?: string } {
  if (mode !== 'live' || typeof models?.model !== 'string' || !models.model) return {};
  return { model: models.model, fallback_model: typeof models.fallback_model === 'string' ? models.fallback_model : '' };
}

// One startup log line, e.g. "연동 상태: 저장소=mock(로컬 파일) · Gemini=off(사람이 직접 판정) · NotebookLM=mock(모의 응답)".
// With the models GAS reported, live Gemini names them: "Gemini=live(gemini-3.8-flash, 대체 gemini-3.5-flash-lite)".
// A GAS that reports null (stored values not allowed) reads differently from an older GAS without the fields.
export function integrationSummary({ storage, gemini, notebooklm }: Integrations, { geminiModels }: { geminiModels?: GeminiModels } = {}) {
  const models = liveModels(gemini.mode, geminiModels);
  const invalid = gemini.mode === 'live' && geminiModels?.model === null;
  const geminiLabel = models.model ? geminiModelText(models.model, models.fallback_model) : invalid ? '모델 설정 확인 필요' : LABELS.gemini[gemini.mode];
  return `연동 상태: 저장소=${storage.mode}(${LABELS.storage[storage.mode]}) · Gemini=${gemini.mode}(${geminiLabel}) · NotebookLM=${notebooklm.mode}(${LABELS.notebooklm[notebooklm.mode]})`;
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
// liveOnly: the GAS scripts refuse a mock storage anyway, so its startup warnings (no AI draft, …) are not printed.
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
  const fallback = defaults(mode);
  const gemini = featureMode(env, 'GEMINI_MODE') ?? fallback.gemini;
  const notebook = notebookLmMode(env);
  const notebooklm = notebook.mode ?? fallback.notebooklm;
  checkModes(mode, gemini, notebooklm, { storage: storageName, notebooklmLegacy: notebook.legacy });
  let storage: Integrations['storage'] = { mode };
  if (mode === 'live') storage = { mode, ...webAppSettings(env, storageName) };
  if (gemini === 'off' && notebooklm !== 'off') warnings.push('Gemini가 꺼져 있어 NotebookLM 대조에 쓸 AI 초안이 생기지 않습니다.');
  if (notebooklm !== 'live' && value(env, 'NOTEBOOKLM_NOTEBOOK_ID') !== undefined) warnings.push(`노트북 ID가 있지만 NOTEBOOKLM_MODE=${notebooklm} 설정에서는 실제 질의를 하지 않습니다.`);
  if (mode === 'mock' && value(env, 'GAS_WEBAPP_URL') !== undefined) warnings.push('GAS_WEBAPP_URL이 있지만 STORAGE_MODE=mock이라 로컬 저장소를 씁니다.');
  return { storage, gemini: { mode: gemini }, notebooklm: { mode: notebooklm }, warnings };
}
