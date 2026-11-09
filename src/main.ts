import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';
import { mkdirSync } from 'node:fs';
import session from 'express-session';
import path from 'node:path';
import { ApiExceptionFilter } from './api-exception.filter';
import { AppModule } from './app.module';
import {
  getGeminiInfo,
  getNotebookLMInfo,
  getStorageInfo,
  validateGeminiMode,
  validateNotebookLMMode,
} from './storage-mode';

async function bootstrap(): Promise<void> {
  try {
    validateGeminiMode();
    validateNotebookLMMode();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'GEMINI_MODE 설정을 확인하세요.');
    process.exit(1);
  }
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const publicDirectory = path.join(process.cwd(), 'public');
  const runtimeDirectory = path.join(process.cwd(), 'runtime');
  const uploadsDirectory = path.join(runtimeDirectory, 'uploads');
  mkdirSync(uploadsDirectory, { recursive: true });
  app.useBodyParser('json', { limit: '50mb' });

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
  app.use('/uploads', express.static(uploadsDirectory));
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
  console.log(`저장소: ${getStorageInfo().label}`);
  console.log(`Gemini 판독: ${getGeminiInfo().gemini_label}`);
  const storage = getStorageInfo();
  const gemini = getGeminiInfo();
  const notebookLM = getNotebookLMInfo();
  const storageStatus = storage.storage === 'mock' ? '로컬 파일' : 'GAS 웹앱';
  const geminiStatus: Record<string, string> = {
    off: '사람이 직접 판정',
    mock: '모의 초안',
    live: 'GAS에서 OnePort로 Gemini 호출',
  };
  const notebookLMStatus: Record<string, string> = {
    off: '근거 대조 꺼짐',
    mock: '모의 응답',
    live: '실제 질의',
  };
  console.log(
    `연동 상태: 저장소=${storage.storage}(${storageStatus}) · Gemini=${gemini.gemini_mode}(${geminiStatus[gemini.gemini_mode]}) · NotebookLM=${notebookLM.notebooklm_mode}(${notebookLMStatus[notebookLM.notebooklm_mode]})`,
  );
}

void bootstrap();
