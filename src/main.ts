/**
 * Local server (default port 4185, PORT changes it)
 */

import crypto from 'node:crypto';
import { createNestApp } from './app';

async function bootstrap() {
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

  const app = await createNestApp();
  await app.listen(port, '127.0.0.1');
  console.log(`품질 대시보드 서버 실행 중: ${process.env.APP_ORIGIN}`);
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
