import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface PromptRecord {
  name: string;
  text: string;
  custom: boolean;
}

interface SavedPrompt {
  name: string;
  text: string;
}

const defaultPromptNames = ['v1', 'v2', 'v3'] as const;

function getDefaultPrompts(): PromptRecord[] {
  return defaultPromptNames.map((name) => ({
    name,
    text: readFileSync(path.join(process.cwd(), 'prompts', `gemini-${name}.md`), 'utf8'),
    custom: false,
  }));
}

function getCustomPromptsPath(): string {
  return path.join(process.cwd(), 'runtime', 'custom-prompts.json');
}

function readCustomPrompts(): SavedPrompt[] {
  const filePath = getCustomPromptsPath();
  if (!existsSync(filePath)) return [];

  const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is SavedPrompt =>
      typeof item?.name === 'string' && typeof item?.text === 'string',
  );
}

export function findPrompt(name: string): SavedPrompt | undefined {
  const defaults = getDefaultPrompts().map(({ name: promptName, text }) => ({ name: promptName, text }));
  return [...defaults, ...readCustomPrompts()].find((prompt) => prompt.name === name);
}

function getKoreanTimestamp(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

@Controller('api/prompts')
export class PromptsController {
  @Get()
  getPrompts(): { default: string; prompts: PromptRecord[] } {
    const prompts = [
      ...getDefaultPrompts(),
      ...readCustomPrompts().map((prompt) => ({ ...prompt, custom: true })),
    ];
    return { default: 'v3', prompts };
  }

  @Post()
  savePrompt(@Body() body: { base?: unknown; text?: unknown }): PromptRecord {
    if (
      typeof body?.base !== 'string' ||
      !defaultPromptNames.includes(body.base as (typeof defaultPromptNames)[number]) ||
      typeof body.text !== 'string'
    ) {
      throw new BadRequestException('지시문 버전과 내용을 확인하세요.');
    }

    const saved: SavedPrompt = {
      name: `${body.base} · 수정본 ${getKoreanTimestamp()}`,
      text: body.text,
    };
    const filePath = getCustomPromptsPath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    const customPrompts = readCustomPrompts();
    customPrompts.push({ name: saved.name, text: saved.text });
    writeFileSync(filePath, `${JSON.stringify(customPrompts, null, 2)}\n`, 'utf8');

    return { ...saved, custom: true };
  }
}
