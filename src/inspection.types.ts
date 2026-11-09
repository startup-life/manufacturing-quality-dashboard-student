export type InspectionDecision = 'OK' | 'NG' | 'HOLD' | null;

export interface Inspection {
  inspection_id: string;
  product_id: string;
  inspected_at: string;
  revision: 'Rev.A' | 'Rev.B';
  weight_g: number | null;
  memo: string;
  decision: InspectionDecision;
  content_version: number;
  images: string[];
}

export interface LocalState {
  inspections: Inspection[];
  inspection_records?: import('./inspection-record.types').InspectionRecord[];
  record_defects?: import('./inspection-record.types').InspectionRecordDefect[];
}
