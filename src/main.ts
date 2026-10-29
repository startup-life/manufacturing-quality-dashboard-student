/**
 * Local server (default port 4185, PORT changes it)
 * Keeps the records in a file on this computer (src/local-store.ts).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createNestApp } from './app';
import { envFileBomError } from './env-file';
import { STATE_FILE } from './local-store';

const root = path.join(__dirname, '..');

async function bootstrap() {
  // npm start가 --env-file-if-exists=.env로 읽는 파일과 같은 파일(작업 폴더의 .env)을 확인한다.
  const bomError = envFileBomError('.env');
  if (bomError) { console.error(bomError); process.exit(1); }

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

  const app = await createNestApp();
  await app.listen(port, '127.0.0.1');
  console.log(`품질 대시보드 서버 실행 중: ${process.env.APP_ORIGIN}`);
  console.log('저장소: 내 컴퓨터(' + path.relative(root, STATE_FILE) + ')');
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
