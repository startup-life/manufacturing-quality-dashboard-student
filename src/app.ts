import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'node:crypto';
import { AppModule } from './app.module';
import { AppOptions, AppService } from './app.service';
import { ErrorFilter } from './error.filter';
import { routeName } from './pages.controller';
import { security } from './security';
import { InputError } from './validation';
import { safeEvent } from './log';

// The registration form (public/app.js) sends up to 8 photos of up to 4MB each as base64 data URLs in one JSON body.
// base64 is 4/3 of the bytes; 1MB more covers the data URL prefixes, file names and the other form fields.
const PHOTO_MAX = 8, PHOTO_BYTES = 4 * 1024 * 1024;
const PHOTO_JSON_LIMIT = PHOTO_MAX * Math.ceil(PHOTO_BYTES / 3) * 4 + 1024 * 1024;
const TOO_LARGE = `요청 크기가 한도를 넘었습니다. 사진은 최대 ${PHOTO_MAX}장, 장당 ${PHOTO_BYTES / 1024 / 1024}MB까지 보낼 수 있습니다.`;

// A JSON body that does not parse or is too large answers with guidance; Nest would otherwise turn the parse error into its own 400.
function json(limit: number | string): RequestHandler {
  const parse = express.json({ limit });
  return (req, res, next) => parse(req, res, (err?: any) => {
    if (err?.type === 'entity.parse.failed') return next(new InputError('JSON 형식을 확인하세요.', 400));
    if (err?.type === 'entity.too.large') return next(new InputError(TOO_LARGE, 413));
    next(err);
  });
}

function requestLog(req: Request, res: Response, next: NextFunction) {
  const request_id = crypto.randomUUID();
  res.set('X-Request-Id', request_id);
  res.on('finish', () =>
    console.log(safeEvent('http', {
      request_id,
      method: req.method,
      route: routeName(req, 'static'),
      status: res.statusCode
    }))
  );
  next();
}

// The Nest app, ready to listen. A refused combination of switches throws before Nest starts (AppService).
export async function createNestApp(options: AppOptions = {}) {
  const service = new AppService(options);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(service), { bodyParser: false, logger: ['error', 'warn'], abortOnError: false });
  const instance: express.Express = app.getHttpAdapter().getInstance();
  app.disable('x-powered-by');
  // Only registration carries several photos; every other body keeps the smaller limit.
  const photoJson = json(PHOTO_JSON_LIMIT), otherJson = json('10mb');
  app.use((req: Request, res: Response, next: NextFunction) => (req.method === 'POST' && req.path.toLowerCase().replace(/\/$/, '') === '/api/inspections' ? photoJson : otherJson)(req, res, next));
  // After the body, as in the Express server: a body that does not parse gets no request ID.
  app.use(requestLog);
  // Before the session and the security headers, as in the Express server: a health check carries neither.
  instance.get('/healthz', (req, res) => { res.json({ status: 'ok' }); });
  security(app);
  app.useGlobalFilters(new ErrorFilter());
  instance.locals.waitAiIdle = () => service.waitAiIdle();
  instance.locals.scheduleLiveAi = (id: string, runId: string) => service.scheduleLiveAi(id, runId);
  instance.locals.promptStore = service.promptStore;
  await app.init();
  return app;
}

// The Express app inside, for tests that serve it with http.createServer; app.locals carries waitAiIdle and scheduleLiveAi.
export async function createApp(options: AppOptions = {}): Promise<express.Express> {
  return (await createNestApp(options)).getHttpAdapter().getInstance();
}
