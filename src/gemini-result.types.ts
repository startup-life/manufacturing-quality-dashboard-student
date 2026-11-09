import type { GeminiMode } from './storage-mode';

export interface GeminiResultFields {
  판정: 'OK' | 'NG' | 'HOLD';
  불량유형: string;
  '관찰·수치 근거': string;
  '적용 기준과 출처': string;
  '권고 조치': string;
  '사람 승인 필요 여부': string;
}

export interface GeminiResultRecord {
  result_id: string;
  inspection_id: string;
  created_at: string;
  mode: 'mock' | 'live';
  revision: 'Rev.A' | 'Rev.B';
  instruction_name: string;
  instruction_text: string;
  product_id: string;
  weight_g: number | null;
  images: string[];
  result: GeminiResultFields;
}

export type GeminiRunState = 'idle' | 'running' | 'failed';

export interface GeminiRunStatus {
  mode: GeminiMode;
  state: GeminiRunState;
  error?: string;
  results: GeminiResultRecord[];
  stale: boolean;
}
