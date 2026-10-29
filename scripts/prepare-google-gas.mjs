// GAS web app preparation from the local side. The web app itself is made in the editor or with clasp (docs/LOCAL_SETUP.md).
//   npm run gas:init    sends settings, standards, products, defect codes and the default prompts to the web app
// GEMINI_API_KEY from .env is sent to the GAS Script Properties; it is never printed. Without it the stored key stays.
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GasTransport } from '../dist/gas-transport.js';
import { gasGeminiSettings, geminiFallbackModel, geminiModelText } from '../dist/gemini.js';
import { readIntegrationsWithWarnings, IntegrationSettingError } from '../dist/integrations.js';
import { envFileBomError } from '../dist/env-file.js';
import { promptDefaults } from '../dist/prompts.js';
import { InputError } from '../dist/validation.js';
import { redact } from '../dist/log.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const PRODUCTS = [
  { product_id: 'P-SILVER', product_name: '텀블러 실버', color: '은색', capacity_ml: 500 },
  { product_id: 'P-WHITE', product_name: '텀블러 화이트', color: '흰색', capacity_ml: 500 },
  { product_id: 'P-BLACK', product_name: '텀블러 블랙', color: '검정', capacity_ml: 500 }
];
// The defect choices the judgment form offers (D01~D04). Must equal the local mock.
const DEFECT_CODES = [
  { defect_code: 'D01', defect_name: '스크래치', severity: '경미' },
  { defect_code: 'D02', defect_name: '찍힘', severity: '중대' },
  { defect_code: 'D03', defect_name: '라벨 오류', severity: '치명' },
  { defect_code: 'D04', defect_name: '뚜껑 조립 오류', severity: '중대' }
];
// Same ID for the same defaults, so running initialize again does not add rows.
export const PROMPT_SEED_REQUEST_ID = 'prompt-defaults-' + sha(JSON.stringify(promptDefaults)).slice(0, 20);

// The key goes to GAS as typed in .env. An empty value, a <…> placeholder or one with spaces or line breaks is not sent.
export function apiKeyFromEnv(env) {
  const value = env.GEMINI_API_KEY;
  if (value === undefined) return { key: null, problem: null };
  if (!value || /[\s<>]/.test(value)) return { key: null, problem: '.env의 GEMINI_API_KEY가 비어 있거나 자리표시·공백이 섞여 있어 보내지 않았습니다. 스크립트 속성의 키는 그대로 둡니다.' };
  return { key: value, problem: null };
}

export async function initializeRequests({ env = process.env, root = repoRoot } = {}) {
  const gemini = gasGeminiSettings(env);
  const apiKey = apiKeyFromEnv(env);
  const standards = [];
  for (const revision of ['Rev.A', 'Rev.B']) {
    const text = await fs.readFile(path.join(root, 'standards', 'notebooklm-' + revision + '.md'), 'utf8');
    const rules = JSON.parse(await fs.readFile(path.join(root, 'standards', revision + '.json'), 'utf8'));
    standards.push({ standard_id: 'STD-' + revision, revision, standard_text: text, rules_json: JSON.stringify(rules), sha256: sha(text) });
  }
  return {
    gemini,
    keyProblem: apiKey.problem,
    configure: { gemini_model: gemini.model, gemini_fallback_model: gemini.fallback_model, ...(apiKey.key ? { gemini_api_key: apiKey.key } : {}), standards, products: PRODUCTS, defect_codes: DEFECT_CODES },
    seed: { versions: promptDefaults }
  };
}

export async function initialize({ env = process.env, root = repoRoot, transport, log = console.log, warn = console.warn } = {}) {
  const bom = envFileBomError(path.join(root, '.env'));
  if (bom) throw Error(bom);
  const { storage } = readIntegrationsWithWarnings(env, warn, { liveOnly: true });
  if (storage.mode !== 'live') throw Error('initialize는 .env에 STORAGE_MODE=live와 GAS_WEBAPP_URL을 넣은 뒤 실행합니다.');
  const requests = await initializeRequests({ env, root });
  if (requests.keyProblem) warn(requests.keyProblem);
  transport ||= new GasTransport({ mode: 'live', webAppUrl: storage.webAppUrl });
  // The spreadsheet and the Drive photo folder first; an existing one is reused.
  await transport.dispatch('setup.resources', {}, { request_id: crypto.randomUUID() });
  const status = await transport.dispatch('init.configure', requests.configure, { request_id: crypto.randomUUID() });
  const seeded = await transport.dispatch('prompts.seed', requests.seed, { request_id: PROMPT_SEED_REQUEST_ID });
  log('GAS 웹앱에 판독 설정·기준 원문·제품·불량 코드·기본 지시문 ' + promptDefaults.length + '개를 보냈습니다(지시문 전체 ' + seeded.count + '개).');
  if (status.gemini_ready) log('Gemini 판독 준비가 끝났습니다(' + geminiModelText(requests.gemini.model, geminiFallbackModel(requests.gemini)) + ').');
  else log('다음 할 일: .env에 GEMINI_API_KEY를 넣고 npm.cmd run gas:init(macOS: npm run gas:init)을 다시 실행합니다.');
  return { status, seeded };
}

// Codes the web app (gas/*.gs) attaches; the transport adds GAS_*. Any other code is a local failure.
const GAS_CODES = ['VALIDATION', 'NOT_FOUND', 'CONFLICT', 'QUOTA_EXCEEDED', 'SETUP_REQUIRED', 'UPSTREAM_FAILED'];
// What each command was doing when a local (file system) error stops it.
export const LOCAL_TASKS = { initialize: '기준 원문 등 로컬 파일을 읽지 못했습니다' };

export function failureLine(e, localTask = '로컬 파일을 다루지 못했습니다') {
  if (e instanceof IntegrationSettingError) return e.message;
  const code = typeof e?.code === 'string' ? e.code : '';
  // A platform message (UPSTREAM_FAILED) can carry internal IDs such as a sheet ID; mask it as the server log does.
  if (e instanceof InputError || code.startsWith('GAS_') || GAS_CODES.includes(code)) return `GAS 요청에 실패했습니다${code ? `(${code})` : ''}. ${redact(e.message)}`;
  // System errors (ENOENT, EACCES, …) carry local paths with the user name, so only the task and the code are printed.
  if (code) return `${localTask}(${code}).`;
  return String(e?.message || e);
}

async function main(command) {
  if (command === 'initialize') {
    await initialize();
  } else {
    throw Error('initialize를 지정하세요.');
  }
}

// Importing for tests must not read .env or call the web app; realpath keeps symlinked paths (e.g. /tmp) running.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Any failure is one line, like npm start: the GAS error code when there is one, then the message.
  // Transport and setting messages never carry the web app URL.
  try { await main(process.argv[2]); }
  catch (e) { console.error(failureLine(e, LOCAL_TASKS[process.argv[2]])); process.exitCode = 1; }
}
