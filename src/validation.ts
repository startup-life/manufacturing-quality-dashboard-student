export class InputError extends Error {
  status: number;
  declare code?: string;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const badWeight = (weight_g: unknown) => weight_g !== null && (typeof weight_g !== 'number' || !Number.isFinite(weight_g) || weight_g < 0 || weight_g > 9999999);
function checkProduct(product_id: unknown) {
  if (!/^P-(SILVER|WHITE|BLACK)$/.test(typeof product_id === 'string' ? product_id : '')) throw new InputError('등록된 제품을 선택하세요.');
}
function checkInspectedAt(inspected_at: unknown) {
  const date = new Date(String(inspected_at).replace(' ', 'T') + 'Z');
  if (typeof inspected_at !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(inspected_at) || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 19).replace('T', ' ') !== inspected_at) throw new InputError('유효한 검사일시가 필요합니다.');
}
export function inspectionInput(body: any, imageIds: Set<string>) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('입력 객체가 필요합니다.');
  const { inspection_id, product_id, inspected_at, revision } = body;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(inspection_id || '')) throw new InputError('검사번호 형식 오류');
  checkProduct(product_id);
  checkInspectedAt(inspected_at);
  if (!['Rev.A', 'Rev.B'].includes(revision ?? 'Rev.A')) throw new InputError('기준 버전을 확인하세요.');
  const weight_g = body.weight_g ?? null;
  if (badWeight(weight_g)) throw new InputError('중량은 수치 또는 NULL입니다.');
  const memo = body.memo ?? '';
  if (typeof memo !== 'string' || memo.length > 2000) throw new InputError('메모는 2000자 이하로 적어 주세요.');
  const images = body.images ?? [];
  if (!Array.isArray(images) || images.length > 8 || new Set(images).size !== images.length || images.some(x => typeof x !== 'string' || !imageIds.has(x))) throw new InputError('제공된 학습 이미지 URL을 선택하세요.');
  return { inspection_id, product_id, inspected_at, weight_g, memo: memo.trim(), revision: revision ?? 'Rev.A', images };
}
// The detail screen's edit: product, inspection time and weight, against the version the screen showed.
export function updateInput(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('입력 객체가 필요합니다.');
  const { product_id, inspected_at, expected_version } = body;
  if (!Number.isSafeInteger(expected_version) || expected_version < 0) throw new InputError('최신 검사 버전을 확인한 뒤 다시 시도하세요.');
  checkProduct(product_id);
  checkInspectedAt(inspected_at);
  const weight_g = body.weight_g ?? null;
  if (badWeight(weight_g)) throw new InputError('중량은 수치 또는 NULL입니다.');
  return { product_id, inspected_at, weight_g, expected_version };
}
export function dateInput(date: unknown) {
  if (date === undefined || date === '') return '';
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new InputError('집계일은 유효한 YYYY-MM-DD 날짜입니다.');
  return date;
}
export function listInput(q: any) {
  const page = q.page === undefined ? 1 : Number(q.page), pageSize = q.pageSize === undefined ? 12 : Number(q.pageSize);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new InputError('페이지 범위 오류');
  if (q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 100)) throw new InputError('검색어 길이 오류');
  if (q.decision !== undefined && !['', 'OK', 'NG', 'HOLD'].includes(q.decision)) throw new InputError('판정 필터 오류');
  if (q.review !== undefined && !['', 'pending'].includes(q.review)) throw new InputError('검토 필터 오류');
  return { page, pageSize, search: q.search || '', decision: q.decision || '', date: dateInput(q.date), review: q.review || '' };
}
