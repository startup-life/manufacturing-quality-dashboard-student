export type EvidenceLinkStatus =
  | 'VERIFIED_BY_USER'
  | 'REVIEW_NEEDED_BY_USER'
  | 'MOCK_USER_REVIEWED'
  | 'MOCK_REVIEW_NEEDED';

export interface EvidenceLinkRecord {
  link_id: string;
  query_id: string;
  inspection_id: string;
  draft_id: string;
  status: EvidenceLinkStatus;
  memo: string;
  user: string;
  created_at: string;
}
