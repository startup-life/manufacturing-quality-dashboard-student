// Shared with GAS: must equal GEMINI_MODELS in gas/Gemini.gs.
export const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
// GAS path settings sent by initialize; defaults match gas/Gemini.gs. Invalid values stop initialize, never fall back.
// fallback_model is tried once when the main model is overloaded (503) or rate-limited (429); 'off' turns it off.
export function gasGeminiSettings(env: NodeJS.ProcessEnv = process.env) {
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  if (!GEMINI_MODELS.includes(model)) throw Error('GEMINI_MODEL은 ' + GEMINI_MODELS.join(', ') + ' 중 하나여야 합니다.');
  const fallback_model = env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite';
  if (fallback_model !== 'off' && !GEMINI_MODELS.includes(fallback_model)) throw Error('GEMINI_FALLBACK_MODEL은 off 또는 ' + GEMINI_MODELS.join(', ') + ' 중 하나여야 합니다.');
  return { model, fallback_model };
}
// The model actually tried after the main one: '' when off or the same as the main model (geminiFallbackModel in GAS).
export function geminiFallbackModel({ model, fallback_model }: { model: string; fallback_model: string }) {
  return fallback_model === 'off' || fallback_model === model ? '' : fallback_model;
}
// How the models read in the startup line and the gas:init message.
// fallback '' or null means no other model is tried (off, or the same as the main model).
export function geminiModelText(model: string, fallback?: string | null) {
  return model + (fallback ? ', 대체 ' + fallback : ', 대체 없음');
}
