export type InspectionRecordDecision = 'OK' | 'NG' | 'HOLD';

export interface InspectionRecord {
  record_id: string;
  inspection_id: string;
  user_id: string;
  recorded_at: string;
  decision: InspectionRecordDecision;
  weight_g: number | null;
  notes: string;
  content_version: number;
  change_reason: string;
}

export interface InspectionRecordDefect {
  record_id: string;
  defect_code: string;
}

export interface InspectionRecordDefectView {
  defect_code: string;
  defect_name: string;
}

export type InspectionView = import('./inspection.types').Inspection & {
  defects: InspectionRecordDefectView[];
};

export type InspectionRecordWithDefects = InspectionRecord & {
  defects: InspectionRecordDefectView[];
};

export const inspectionDefectNames: Record<string, string> = {
  D01: '스크래치',
  D02: '찍힘',
  D03: '라벨 오류',
  D04: '뚜껑 조립 오류',
};
