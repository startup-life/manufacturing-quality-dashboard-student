import { NestFactory } from '@nestjs/core';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import path from 'node:path';
import { ApiExceptionFilter } from './api-exception.filter';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const publicDirectory = path.join(process.cwd(), 'public');

  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? 'tumbler-factory-training-session',
      resave: false,
      saveUninitialized: false,
    }),
  );
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const isApi = request.path === '/api' || request.path.startsWith('/api/');
    if (!isApi) {
      next();
      return;
    }

    const publicEndpoint =
      (request.method === 'GET' && request.path === '/api/session') ||
      (request.method === 'POST' && request.path === '/api/login') ||
      (request.method === 'POST' && request.path === '/api/logout');

    if (publicEndpoint || request.session.user) {
      next();
      return;
    }

    response.status(401).json({ error: '로그인이 필요합니다.' });
  });
  app.use(express.static(publicDirectory));
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path.startsWith('/api')) {
      next();
      return;
    }

    response.sendFile(path.join(publicDirectory, 'index.html'), (error?: Error) => {
      if (error) next(error);
    });
  });

  app.useGlobalFilters(new ApiExceptionFilter());
  const port = Number(process.env.PORT ?? 4185);
  await app.listen(port, '127.0.0.1');
  console.log(`품질 대시보드 서버 실행 중: http://127.0.0.1:${port}`);
}

void bootstrap();
