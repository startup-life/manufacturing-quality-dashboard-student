import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import crypto from 'node:crypto';
import { AppModule } from './app.module';
import { ErrorFilter } from './error.filter';
import { routeName } from './pages.controller';
import { security } from './security';
import { InputError } from './validation';
import { safeEvent } from './log';

// A JSON body that does not parse or is too large answers with guidance; Nest would otherwise turn the parse error into its own 400.
function json(limit: number | string): RequestHandler {
  const parse = express.json({ limit });
  return (req, res, next) => parse(req, res, (err?: any) => {
    if (err?.type === 'entity.parse.failed') return next(new InputError('JSON 형식을 확인하세요.', 400));
    if (err?.type === 'entity.too.large') return next(new InputError('요청 크기가 한도를 넘었습니다.', 413));
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

// The Nest app, ready to listen.
export async function createNestApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: ['error', 'warn'], abortOnError: false });
  const instance: express.Express = app.getHttpAdapter().getInstance();
  app.disable('x-powered-by');
  app.use(json('10mb'));
  // After the body: a body that does not parse gets no request ID.
  app.use(requestLog);
  // Before the session and the security headers: a health check carries neither.
  instance.get('/healthz', (req, res) => { res.json({ status: 'ok' }); });
  security(app);
  app.useGlobalFilters(new ErrorFilter());
  await app.init();
  return app;
}

// The Express app inside, for tests that serve it with http.createServer.
export async function createApp(): Promise<express.Express> {
  return (await createNestApp()).getHttpAdapter().getInstance();
}
