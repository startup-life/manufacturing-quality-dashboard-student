var GEMINI_RESULT_FIELDS = [
  '판정',
  '불량유형',
  '관찰·수치 근거',
  '적용 기준과 출처',
  '권고 조치',
  '사람 승인 필요 여부',
];

function normalizeGeminiResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const result = {};
  for (let index = 0; index < GEMINI_RESULT_FIELDS.length; index += 1) {
    const field = GEMINI_RESULT_FIELDS[index];
    if (typeof value[field] !== 'string') return null;
    result[field] = value[field];
  }

  if (!['OK', 'NG', 'HOLD'].includes(result['판정'])) return null;
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GEMINI_RESULT_FIELDS, normalizeGeminiResult };
}
