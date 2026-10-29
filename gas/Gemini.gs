/**
 * Gemini API Multi-modal Quality Assessment in GAS
 * The key in Script Properties is used as is; its limits and costs are Google's (429 from Google, budgets in the Cloud console).
 */

// Reviewed models only; never switch providers or synthesize a result. A model fallback is recorded with the run and the draft.
// Must equal GEMINI_MODELS in src/gemini.ts.
const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
// Missing Script Properties fall back to these so GAS deployed before the settings existed keeps working.
// GEMINI_FALLBACK_MODEL is tried once when the main model is busy (503) or limited (429); 'off' turns it off.
const GEMINI_DEFAULTS = {GEMINI_MODEL: 'gemini-3.8-flash', GEMINI_FALLBACK_MODEL: 'gemini-3.5-flash-lite'};
// Google's own limit is the only one: a 429 or RESOURCE_EXHAUSTED becomes a failed run with this guidance (no key or numbers).
const GEMINI_QUOTA_MESSAGE = 'Gemini API 한도에 걸렸습니다. 잠시 뒤 다시 하거나 강사에게 다른 API 키를 받으세요.';
// A 503 or UNAVAILABLE means Google's servers are overloaded; the provider's English text is replaced by this guidance.
const GEMINI_BUSY_MESSAGE = 'Gemini 서버가 붐벼 판독하지 못했습니다. 잠시 뒤 다시 판독을 요청하세요.';
const GEMINI_INVALID_MESSAGE = 'Gemini가 유효한 6항목 응답을 반환하지 않았습니다.';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
// The output limit also counts the model's thinking tokens, so it leaves room beyond the six-field JSON.
const GEMINI_MAX_OUTPUT_TOKENS = 16384;

// Fills only unset values from the defaults.
function geminiResolveSettings(values) {
  return {
    GEMINI_MODEL: values.GEMINI_MODEL || GEMINI_DEFAULTS.GEMINI_MODEL,
    GEMINI_FALLBACK_MODEL: values.GEMINI_FALLBACK_MODEL || GEMINI_DEFAULTS.GEMINI_FALLBACK_MODEL
  };
}

// Checks resolved values; returns a Korean message or ''. Invalid values are never replaced by defaults.
function geminiSettingsError(values) {
  if (GEMINI_MODELS.indexOf(values.GEMINI_MODEL) < 0) return 'GEMINI_MODEL은 ' + GEMINI_MODELS.join(', ') + ' 중 하나여야 합니다.';
  if (values.GEMINI_FALLBACK_MODEL !== 'off' && GEMINI_MODELS.indexOf(values.GEMINI_FALLBACK_MODEL) < 0) return 'GEMINI_FALLBACK_MODEL은 off 또는 ' + GEMINI_MODELS.join(', ') + ' 중 하나여야 합니다.';
  return '';
}

function geminiScriptSettings(props) {
  const values = geminiResolveSettings({GEMINI_MODEL: props.getProperty('GEMINI_MODEL'), GEMINI_FALLBACK_MODEL: props.getProperty('GEMINI_FALLBACK_MODEL')});
  const invalid = geminiSettingsError(values);
  if (invalid) throw Object.assign(Error(invalid + ' Script Properties를 확인하세요.'),{code:'SETUP_REQUIRED'});
  return {model: values.GEMINI_MODEL, fallback_model: values.GEMINI_FALLBACK_MODEL};
}

// The model actually tried after the main one, or '' when off or the same as the main model.
function geminiFallbackModel(settings) {
  return settings.fallback_model === 'off' || settings.fallback_model === settings.model ? '' : settings.fallback_model;
}

// Ready means a key is set in Script Properties.
function geminiKeyReady(props) {
  return !!props.getProperty('GEMINI_API_KEY');
}

// Provider messages can echo a key; mask key-shaped text before it is stored or logged.
function redactGeminiKey(text) {
  return String(text || '').replace(/(?:AIza|AQ\.)[A-Za-z0-9_.-]+/g, '[REDACTED]');
}

function callGeminiInference(imagesBase64, inspectionData) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('GEMINI_API_KEY');

  if (!geminiKeyReady(props)) {
    return {success: false, error_type: 'NOT_CONFIGURED', error: 'Gemini API 키가 설정되지 않았습니다.'};
  }

  // The run uses the models captured when it was queued; a call without a model uses the default one.
  // A snapshot without fallback_model (queued before the fallback existed) tries no other model.
  const model = inspectionData.model || GEMINI_DEFAULTS.GEMINI_MODEL;
  const fallback = inspectionData.fallback_model || '';
  const invalid = geminiSettingsError(geminiResolveSettings({GEMINI_MODEL: model, GEMINI_FALLBACK_MODEL: fallback || 'off'}));
  if (invalid) return {success:false,error_type:'NOT_CONFIGURED',error:invalid};

  const parts = [];

  // 1. Text Prompt
  if (!inspectionData.prompt?.text || !inspectionData.standard_natural_text) {
    return {success:false,error_type:'NOT_CONFIGURED',error:'저장된 프롬프트와 자연어 검사기준을 확인하세요.'};
  }
  parts.push({text:'[판독 지시문]\n'+inspectionData.prompt.text});
  parts.push({text:'[검사 정보]\n'+naturalInspection(inspectionData)});
  parts.push({text:'[적용 검사기준]\n'+inspectionData.standard_natural_text});

  // 2. Images (Base64 JPEG inline data)
  for (let i = 0; i < imagesBase64.length; i++) {
    const b64 = imagesBase64[i];
    parts.push({
      inline_data: {
        mime_type: b64.mime || 'image/jpeg',
        data: typeof b64 === 'string' ? b64 : b64.data
      }
    });
  }

  const payload = {
    systemInstruction:{parts:[{text:inspectionData.safety_text||GEMINI_SAFETY}]},
    contents: [{ parts: parts }],
    generationConfig: {
      temperature: 1,
      responseMimeType: 'application/json',
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS
    }
  };

  // A busy (503) or limited (429) main model is tried once more on the fallback model; any other failure is final.
  // If the fallback fails too, the run shows the main model's guidance.
  const first = geminiCallModel(model, payload, apiKey, inspectionData);
  if (!first.success && first.retry && fallback) {
    const second = geminiCallModel(fallback, payload, apiKey, inspectionData);
    if (second.success) return withModel(second, fallback, model);
  }
  return withModel(first, model, null);
}

// The model that answered and, after a fallback, the main model it replaced; the draft result carries both too.
function withModel(answer, model, fallbackFrom) {
  if (answer.success) Object.assign(answer.result, {model: model, fallback_from: fallbackFrom});
  return Object.assign(answer, {model: model, fallback_from: fallbackFrom});
}

// One generateContent call. retry is set only for 503/UNAVAILABLE and 429/RESOURCE_EXHAUSTED.
function geminiCallModel(model, payload, apiKey, inspectionData) {
  const url = `${GEMINI_ENDPOINT}${model}:generateContent`;
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const body = response.getContentText();

    let provider = {};
    if (code !== 200) { try { provider = JSON.parse(body).error || {}; } catch (_) {} }
    // The provider text can carry quota numbers, so a limit answer gets the fixed guidance only.
    if (code === 429 || provider.status === 'RESOURCE_EXHAUSTED') {
      return {success: false, error_type: 'QUOTA_EXCEEDED', error: GEMINI_QUOTA_MESSAGE, retry: true};
    }
    if (code === 503 || provider.status === 'UNAVAILABLE') {
      return {success: false, error_type: 'UPSTREAM_FAILED', error: GEMINI_BUSY_MESSAGE, retry: true};
    }

    if (code !== 200) {
      const safeMessage = redactGeminiKey(provider.message).slice(0, 600);
      return {
        success: false,
        error_type: 'UPSTREAM_FAILED',
        error: `Gemini API 호출 실패 (HTTP ${code}, ${String(provider.status || 'UNKNOWN')}). ${safeMessage || '공급자 응답을 확인할 수 없습니다.'}`
      };
    }

    // A body that is not JSON, an answer cut at the output limit or text that is not JSON is the same failure.
    let parsed;
    try {
      const parts = JSON.parse(body).candidates[0].content.parts;
      parsed = JSON.parse(parts.filter(p => p.text && !p.thought).map(p => p.text).join(''));
    } catch (_) {
      return {success: false, error_type: 'PARSING_FAILED', error: GEMINI_INVALID_MESSAGE};
    }

    // 6항목 유효성 검증
    const validDecisions = ['OK', 'NG', 'HOLD'];
    const required = ['불량유형', '관찰·수치 근거', '적용 기준과 출처', '권고 조치', '사람 승인 필요 여부'];
    if (!validDecisions.includes(parsed['판정']) || required.some(k => typeof parsed[k] !== 'string' || !parsed[k].trim())) {
      return { success: false, error_type: 'PARSING_FAILED', error: GEMINI_INVALID_MESSAGE };
    }
    if (parsed['판정'] === 'OK' && (inspectionData.weight_g === null || inspectionData.weight_g === undefined)) {
      return { success: false, error_type: 'INVALID_RESULT', error: '미측정 중량으로 정상 판정을 반환해 응답을 채택하지 않았습니다.' };
    }
    const range=inspectionData.standard_rules?.weight?.[inspectionData.product_id];
    if (parsed['판정']==='OK' && (!range || inspectionData.weight_g<range[0] || inspectionData.weight_g>range[1])) {
      return {success:false,error_type:'INVALID_RESULT',error:'적용 중량 기준과 충돌하는 정상 판정은 채택하지 않습니다.'};
    }

    return {
      success: true,
      result: {
        ...parsed,
        decision: parsed['판정'],
        human_approval_required: true,
        is_mock: false,
        model: model,
        generated_at: new Date().toISOString()
      }
    };
  } catch (err) {
    return {
      success: false,
      error_type: 'NETWORK_ERROR',
      error: 'Gemini 통신 또는 응답 처리에 실패했습니다. 자동 재시도하지 않습니다.'
    };
  }
}
