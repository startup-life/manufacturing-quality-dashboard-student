/**
 * GAS-backed local server (default port 4185, PORT changes it)
 * Uses the Google Apps Script / Sheets abstraction.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createNestApp } from './app';
import { openLocalTransport } from './local-gas-state';
import { GasTransport } from './gas-transport';
import { readIntegrationsWithWarnings, IntegrationSettingError, integrationSummary, GEMINI_NOT_READY, checkGasConnection, geminiSettingsWarning, Integrations, GeminiModels } from './integrations';
import { envFileBomError } from './env-file';

const root = path.join(__dirname, '..');

async function bootstrap() {
  // npm start가 --env-file-if-exists=.env로 읽는 파일과 같은 파일(작업 폴더의 .env)을 확인한다.
  const bomError = envFileBomError('.env');
  if (bomError) { console.error(bomError); process.exit(1); }

  // A refused setting stops here with one line after any warnings; the web app URL is never printed.
  let integrations: Integrations & { warnings: string[] };
  try { integrations = readIntegrationsWithWarnings(); }
  catch (e) { if (e instanceof IntegrationSettingError) { console.error(e.message); process.exit(1); } throw e; }

  // A missing secret gets a per-process value (logins end when the server restarts).
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = crypto.randomBytes(40).toString('hex');
  }

  const port = Number(process.env.PORT || 4185);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('유효하지 않은 포트 번호입니다: ' + port);
  }

  // The origin follows the port: the server only listens on 127.0.0.1.
  process.env.APP_ORIGIN = `http://127.0.0.1:${port}`;

  await fs.mkdir(path.join(root, 'runtime'), { recursive: true });

  let transport: GasTransport;
  let geminiReady = false, geminiModels: GeminiModels = null;
  if (integrations.storage.mode === 'live') {
    transport = new GasTransport({ mode: 'live', webAppUrl: integrations.storage.webAppUrl });
    // Fail before opening the port rather than silently reverting to simulated data.
    let connection;
    try { connection = await checkGasConnection(transport); }
    catch (e: any) { console.error(e.message); process.exit(1); }
    geminiReady = connection.gemini_ready === true;
    // The models the deployed GAS will use; an older GAS reports none and the line keeps its label.
    geminiModels = { model: connection.gemini_model, fallback_model: connection.gemini_fallback_model };
    if (integrations.gemini.mode === 'live' && !geminiReady) console.warn(GEMINI_NOT_READY);
    if (integrations.gemini.mode === 'live' && geminiSettingsWarning(connection)) console.warn(geminiSettingsWarning(connection));
  } else transport = openLocalTransport(
    process.env.LOCAL_STATE_FILE || path.join(root, 'runtime/local-gas-state.json'),
    process.env.LOCAL_BOOTSTRAP_SNAPSHOT
  );
  // Only the modes go to the app; the web app URL stays with the transport.
  // createNestApp refuses mixed switches with one line, like the settings refused above.
  let app;
  try { app = await createNestApp({ geminiReady, geminiModels, integrations: { gemini: integrations.gemini }, transport }); }
  catch (e: any) { console.error(e.message); process.exit(1); }
  await app.listen(port, '127.0.0.1');
  console.log(`GAS 품질 대시보드 서버 실행 중: ${process.env.APP_ORIGIN}`);
  console.log(integrationSummary(integrations, { geminiModels }));
  console.log('기본 로그인 계정: writer, reviewer, factory-user');

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(`서버 종료 신호 (${signal}) 수신. 종료 중...`);
      app.close().then(() => {
        console.log('서버가 안전하게 종료되었습니다.');
        process.exit(0);
      });
    });
  }
}

bootstrap().catch((error) => { console.error(error); process.exitCode = 1; });
