export class InputError extends Error {
  status: number;
  declare code?: string;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
// Setup, sign-in and connection guidance: shown to the user as 503 with a code for the server log.
export const setupError = (message: string, code: string, cause?: unknown) => Object.assign(new InputError(message, 503), { code }, cause ? { cause } : {});
// GAS error codes decide the HTTP status. UPSTREAM_FAILED and unknown or missing codes stay plain errors: a hidden 500, logged.
const GAS_STATUS: Record<string, number> = { VALIDATION: 400, NOT_FOUND: 404, CONFLICT: 409, QUOTA_EXCEEDED: 429, SETUP_REQUIRED: 503 };
export function gasHttpError(err: any) {
  if (err instanceof InputError || !Object.hasOwn(GAS_STATUS, err?.code)) return err;
  return Object.assign(new InputError(err.message, GAS_STATUS[err.code]), { code: err.code }, err.cause ? { cause: err.cause } : {});
}
const DEFECT_CODES = ['D01', 'D02', 'D03', 'D04'];
const badDefects = (defects: unknown) => !Array.isArray(defects) || defects.length > 4 || new Set(defects).size !== defects.length || defects.some(x => !DEFECT_CODES.includes(x));
const badWeight = (weight_g: unknown) => weight_g !== null && (typeof weight_g !== 'number' || !Number.isFinite(weight_g) || weight_g < 0 || weight_g > 9999999);
export function inspectionInput(body: any, imageIds: Set<string>) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('입력 객체가 필요합니다.');
  const { inspection_id, product_id, inspected_at, decision } = body;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(inspection_id || '')) throw new InputError('검사번호 형식 오류');
  if (!/^P-(SILVER|WHITE|BLACK)$/.test(product_id || '')) throw new InputError('등록된 제품을 선택하세요.');
  const date = new Date(String(inspected_at).replace(' ', 'T') + 'Z');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(inspected_at || '') || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 19).replace('T', ' ') !== inspected_at) throw new InputError('유효한 검사일시가 필요합니다.');
  if (decision !== null && decision !== undefined && decision !== '' && !['OK', 'NG', 'HOLD'].includes(decision)) throw new InputError('판정은 OK/NG/HOLD입니다.');
  const weight_g = body.weight_g;
  if (badWeight(weight_g)) throw new InputError('중량은 수치 또는 NULL입니다.');
  const images = body.images ?? [], defects = body.defects ?? [];
  if (!Array.isArray(images) || images.length > 8 || new Set(images).size !== images.length || images.some(x => typeof x !== 'string' || !imageIds.has(x))) throw new InputError('제공된 학습 이미지 URL을 선택하세요.');
  if (badDefects(defects)) throw new InputError('불량코드 형식 오류');
  return { inspection_id, product_id, inspected_at, weight_g, decision: weight_g === null && decision === 'OK' ? 'HOLD' : (decision || null), images, defects };
}
export function dateInput(date: unknown) {
  if (date === undefined || date === '') return '';
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new InputError('집계일은 유효한 YYYY-MM-DD 날짜입니다.');
  return date;
}
// GAS (and its local mock) keys records by a REC-… string.
const validRecordId = (id: unknown) => typeof id === 'string' && !!id.trim() && id.length <= 200;
export function recordInput(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('최종 기록 객체가 필요합니다.');
  const { decision, weight_g, memo, change_reason, expected_version, expected_record_id } = body;
  if (!['OK', 'NG', 'HOLD'].includes(decision)) throw new InputError('최종 판정은 OK/NG/HOLD입니다.');
  if (badWeight(weight_g)) throw new InputError('중량은 수치 또는 NULL입니다.');
  if (decision === 'OK' && weight_g === null) throw new InputError('중량 미측정 상태는 OK로 확정할 수 없습니다. HOLD를 선택하세요.');
  if (typeof memo !== 'string' || memo.length > 2000 || typeof change_reason !== 'string' || !change_reason.trim() || change_reason.length > 1000) throw new InputError('메모(2000자 이하)와 변경 사유(1~1000자)를 확인하세요.');
  if (!Number.isSafeInteger(expected_version) || expected_version < 0 || (expected_record_id !== null && !validRecordId(expected_record_id))) throw new InputError('최신 검사 버전과 기록을 다시 조회하세요.');
  const defects = body.defects;
  if (badDefects(defects)) throw new InputError('불량코드를 확인하세요.');
  return { decision, weight_g, memo: memo.trim(), change_reason: change_reason.trim(), expected_version, expected_record_id, defects: [...defects].sort() };
}
export function listInput(q: any) {
  const page = q.page === undefined ? 1 : Number(q.page), pageSize = q.pageSize === undefined ? 12 : Number(q.pageSize);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new InputError('페이지 범위 오류');
  if (q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 100)) throw new InputError('검색어 길이 오류');
  if (q.decision !== undefined && !['', 'OK', 'NG', 'HOLD'].includes(q.decision)) throw new InputError('판정 필터 오류');
  if (q.review !== undefined && !['', 'pending'].includes(q.review)) throw new InputError('검토 필터 오류');
  return { page, pageSize, search: q.search || '', decision: q.decision || '', date: dateInput(q.date), review: q.review || '' };
}
