// GAS web app preparation from the local side. The web app itself is made in the editor or with clasp (docs/LOCAL_SETUP.md).
//   npm run gas:init    makes the spreadsheet and the Drive photo folder, then sends the products
import { realpathSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GasTransport } from '../dist/gas-transport.js';
import { readIntegrationsWithWarnings, IntegrationSettingError } from '../dist/integrations.js';
import { envFileBomError } from '../dist/env-file.js';
import { InputError } from '../dist/validation.js';
import { redact } from '../dist/log.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const PRODUCTS = [
  { product_id: 'P-SILVER', product_name: '텀블러 실버', color: '은색', capacity_ml: 500 },
  { product_id: 'P-WHITE', product_name: '텀블러 화이트', color: '흰색', capacity_ml: 500 },
  { product_id: 'P-BLACK', product_name: '텀블러 블랙', color: '검정', capacity_ml: 500 }
];

export function initializeRequests() {
  return { configure: { products: PRODUCTS } };
}

export async function initialize({ env = process.env, root = repoRoot, transport, log = console.log, warn = console.warn } = {}) {
  const bom = envFileBomError(path.join(root, '.env'));
  if (bom) throw Error(bom);
  const { storage } = readIntegrationsWithWarnings(env, warn, { liveOnly: true });
  if (storage.mode !== 'live') throw Error('initialize는 .env에 STORAGE_MODE=live와 GAS_WEBAPP_URL을 넣은 뒤 실행합니다.');
  const requests = initializeRequests();
  transport ||= new GasTransport({ mode: 'live', webAppUrl: storage.webAppUrl });
  // The spreadsheet and the Drive photo folder first; an existing one is reused.
  await transport.dispatch('setup.resources', {}, { request_id: crypto.randomUUID() });
  const status = await transport.dispatch('init.configure', requests.configure, { request_id: crypto.randomUUID() });
  log('Sheets와 Drive 사진 폴더를 준비하고 제품을 보냈습니다.');
  return { status };
}

// Codes the web app (gas/*.gs) attaches; the transport adds GAS_*. Any other code is a local failure.
const GAS_CODES = ['VALIDATION', 'NOT_FOUND', 'CONFLICT', 'QUOTA_EXCEEDED', 'SETUP_REQUIRED', 'UPSTREAM_FAILED'];
// What each command was doing when a local (file system) error stops it.
export const LOCAL_TASKS = { initialize: '로컬 파일을 읽지 못했습니다' };

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
