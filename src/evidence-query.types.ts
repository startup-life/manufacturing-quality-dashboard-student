export interface EvidenceQueryRecord {
  query_id: string;
  inspection_id: string;
  draft_id: string;
  created_at: string;
  mode: 'mock' | 'live';
  revision: 'Rev.A' | 'Rev.B';
  prompt_name: string;
  question: string;
  answer: string;
  sources: unknown[];
}
