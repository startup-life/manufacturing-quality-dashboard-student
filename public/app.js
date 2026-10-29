import {loadPromptSettings,promptChoice,draftComparison,resetPromptEditors,savedEvidenceFor,kstTime} from './prompts.js';
function polyfillNode(n) {
  if (!n) return n;
  if (!n.querySelector) n.querySelector = () => null;
  if (!n.querySelectorAll) n.querySelectorAll = () => [];
  if (!n.classList) {
    n.classList = {
      add: (...cls) => { n.className = ((n.className || '') + ' ' + cls.join(' ')).trim(); },
      remove: (...cls) => { n.className = (n.className || '').split(/\s+/).filter(c => !cls.includes(c)).join(' ').trim(); },
      toggle: (c, force) => {
        const has = (n.className || '').split(/\s+/).includes(c);
        const shouldHave = force !== undefined ? force : !has;
        if (shouldHave) n.classList.add(c); else n.classList.remove(c);
      },
      contains: c => (n.className || '').split(/\s+/).includes(c)
    };
  }
  return n;
}

const byId = id => typeof document !== 'undefined' ? polyfillNode(document.getElementById(id)) : null;

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(typeof window !== 'undefined' && window.csrfToken ? { 'X-CSRF-Token': window.csrfToken } : {}),
    ...options?.headers
  };
  const r = await fetch(path, { ...options, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
  return data;
}

export function el(tag, text, className) {
  const n = polyfillNode(document.createElement(tag));
  if (text !== undefined && text !== null) n.textContent = text;
  if (className) n.className = className;
  return n;
}

// Render only a small, safe Markdown subset. Model output is never executable HTML.
export function evidenceInline(parent, text, depth = 0) {
  if (depth > 5) { parent.append(el('span', text)); return; }
  const tokens = /(`[^`\n]+`|\*\*[^\n]+?\*\*|__[^\n]+?__|\[[^\]\n]+\]\([^\s)]+\)|\*[^*\n]+\*)/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    if (match.index > offset) parent.append(el('span', text.slice(offset, match.index)));
    const value = match[0];
    let node;
    if (value.startsWith('`')) node = el('code', value.slice(1, -1));
    else if (value.startsWith('**') || value.startsWith('__')) {
      node = el('strong'); evidenceInline(node, value.slice(2, -2), depth + 1);
    } else if (value.startsWith('*')) {
      node = el('em'); evidenceInline(node, value.slice(1, -1), depth + 1);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(value);
      let safe = false;
      try { safe = ['https:', 'http:'].includes(new URL(link[2]).protocol); } catch (_) {}
      node = el(safe ? 'a' : 'span', link[1]);
      if (safe) { node.href = link[2]; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    }
    parent.append(node); offset = match.index + value.length;
  }
  if (offset < text.length) parent.append(el('span', text.slice(offset)));
}

export function renderEvidenceMarkdown(text) {
  const root = el('div', undefined, 'evidence-cite-quote evidence-markdown');
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let paragraph = [], list = null, item = null, quote = null, fenced = null;
  const flush = () => {
    if (!paragraph.length) return;
    const p = el('p');
    paragraph.forEach((line, index) => { if (index) p.append(el('br')); evidenceInline(p, line); });
    root.append(p); paragraph = [];
  };
  // A "> " quote becomes a blockquote without its markers; consecutive quote lines stay in one block.
  const quoteLine = (parent, text) => {
    if (quote?.parent !== parent) { quote = { parent, node: el('blockquote', undefined, 'evidence-quote') }; parent.append(quote.node); }
    else quote.node.append(el('br'));
    evidenceInline(quote.node, text);
  };
  // ">=" is a comparison, not a quote marker.
  const QUOTE = /^(\s*)(?:>(?!=)\s*)+(.*)$/;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flush(); list = null; quote = null;
      if (fenced !== null) { const pre = el('pre'); pre.append(el('code', fenced.join('\n'))); root.append(pre); fenced = null; }
      else fenced = [];
      continue;
    }
    if (fenced !== null) { fenced.push(line); continue; }
    if (!line.trim()) { flush(); list = null; quote = null; continue; }
    const quoted = QUOTE.exec(line);
    if (quoted) {
      // An indented quote under a list item (NotebookLM puts the source sentence there) belongs to that item.
      flush(); const inItem = !!quoted[1] && !!list;
      if (!inItem) list = null;
      if (quoted[2].trim()) quoteLine(inItem ? item : root, quoted[2]); else quote = null;
      continue;
    }
    quote = null;
    const heading = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line);
    const listItem = /^\s*(?:[-*+]\s+|(\d+)[.)]\s+)(.+)$/.exec(line);
    if (heading) {
      flush(); list = null; const h = el(heading[1].length > 3 ? 'h6' : 'h5'); evidenceInline(h, heading[2]); root.append(h);
    } else if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      flush(); list = null; root.append(el('hr'));
    } else if (listItem) {
      flush(); const tag = listItem[1] ? 'ol' : 'ul';
      if (!list || list.tagName?.toLowerCase() !== tag) { list = el(tag); if (listItem[1]) list.setAttribute('start', listItem[1]); root.append(list); }
      item = el('li'); list.append(item);
      const inner = QUOTE.exec(listItem[2]);
      if (!inner) evidenceInline(item, listItem[2]); else if (inner[2].trim()) quoteLine(item, inner[2]);
    } else { list = null; paragraph.push(line); }
  }
  flush();
  if (fenced !== null) { const pre = el('pre'); pre.append(el('code', fenced.join('\n'))); root.append(pre); }
  return root;
}

function photo(url, alt) {
  const img = el('img');
  img.src = url;
  img.alt = alt || '텀블러 외관 검사 사진';
  img.addEventListener('error', () => {
    img.replaceWith(el('p', '사진을 불러오지 못했습니다.', 'photo-error error'));
  }, { once: true });
  return img;
}

let page = 1, listDate = '', listRequest = 0, detailRequest = 0, workspaceVersion = 0, workspaceActive = true;
let isFormDirty = false;
let lastRenderedUrl = '/';

export function setFormDirty(dirty) {
  isFormDirty = dirty;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', (e) => {
    if (isFormDirty) {
      e.preventDefault();
      e.returnValue = '저장되지 않은 변경사항이 있습니다. 페이지를 벗어나시겠습니까?';
      return e.returnValue;
    }
  });
}

export function resetWorkspace(active = false) {
  resetPromptEditors();
  workspaceActive = active;
  workspaceVersion++;
  listRequest++;
  detailRequest++;
  page = 1;
  listDate = '';
  isFormDirty = false;

  for (const id of ['search', 'decision-filter', 'review-filter']) {
    const item = byId(id);
    if (item) item.value = '';
  }
  for (const id of ['records', 'detail']) {
    const item = byId(id);
    if (item) item.replaceChildren();
  }
  const detail = byId('detail');
  if (detail) {
    detail.setAttribute('data-inspection-id', '');
    detail.hidden = true;
  }
  const count = byId('count');
  if (count) count.textContent = '—';
  const scope = byId('list-scope');
  if (scope) scope.textContent = '';
  const msg = byId('message');
  if (msg) msg.textContent = '';
  const pageStatus = byId('page-status');
  if (pageStatus) pageStatus.textContent = '';
  const prev = byId('prev');
  if (prev) prev.disabled = true;
  const next = byId('next');
  if (next) next.disabled = true;
  syncMetricSelection();
}

export function syncMetricSelection(filters) {
  if (!filters) {
    const searchEl = byId('search'), decEl = byId('decision-filter'), revEl = byId('review-filter');
    filters = { search: searchEl ? searchEl.value : '', decision: decEl ? decEl.value : '', review: revEl ? revEl.value : '' };
  }
  const metric = filters.search || (filters.decision && filters.review) ? '' : filters.review === 'pending' ? 'pending' : filters.decision === 'NG' ? 'ng' : filters.decision === 'HOLD' ? 'hold' : filters.decision ? '' : 'total';
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    for (const button of document.querySelectorAll('[data-metric]')) {
      button.setAttribute('aria-pressed', String(button.dataset.metric === metric && workspaceActive));
    }
  }
}

export function setListDate(date) {
  if (listDate !== date) listRequest++;
  listDate = date;
}

export async function filterRecords() {
  page = 1;
  await load();
}

export async function load() {
  if (!workspaceActive) return;
  const current = ++listRequest;
  const searchEl = byId('search'), decEl = byId('decision-filter'), revEl = byId('review-filter');
  const filters = {
    search: searchEl ? searchEl.value : '',
    decision: decEl ? decEl.value : '',
    date: listDate,
    review: revEl ? revEl.value : '',
    page,
    pageSize: 12
  };
  syncMetricSelection(filters);
  const msg = byId('message');
  if (msg) msg.textContent = '검사 기록을 불러오는 중입니다.';
  const list = byId('records');
  if (list) { list.replaceChildren(el('p', '검사 기록을 불러오는 중입니다.', 'loading-placeholder')); list.setAttribute('aria-busy', 'true'); }
  if (byId('count')) byId('count').textContent = '—';
  for (const id of ['prev', 'next']) if (byId(id)) byId(id).disabled = true;
  try {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== '' && v !== undefined) q.set(k, v);
    }
    const data = await api('/api/inspections?' + q.toString());
    if (current !== listRequest || !workspaceActive) return;
    const scope = byId('list-scope');
    if (scope) scope.textContent = (filters.date || '전체 날짜') + ' · ' + (filters.decision || '전체 판정') + ' · ' + (filters.review ? '검토 대기' : '전체 보고서');
    const records = byId('records');
    if (records) {
      records.replaceChildren();
      for (const r of data.rows) {
        const card = el('article', undefined, 'product recent-product-card');
        if (r.image_url) card.append(photo(r.image_url, r.inspection_id + ' 외관 사진'));
        const btn = el('button', '상세 보기');
        btn.setAttribute('type', 'button');
        btn.setAttribute('aria-label', r.inspection_id + ' 상세 보기');
        btn.onclick = () => navigate('/inspections/' + encodeURIComponent(r.inspection_id));
        const title = el('h3', r.inspection_id);
        const statusText = r.decision === 'OK' ? '적합 (OK)' :
          r.decision === 'NG' ? '부적합 (NG)' :
          r.decision === 'HOLD' ? '보류 (HOLD)' : '미판정';
        const statusClass = r.decision === 'OK' ? 'badge ok' :
          r.decision === 'NG' ? 'badge ng' :
          r.decision === 'HOLD' ? 'badge hold' : 'badge unjudged';
        const statusBadge = el('span', statusText, statusClass);
        const weightText = el('p', r.weight_g !== null && r.weight_g !== undefined ? `실측: ${r.weight_g}g` : '중량 미측정');
        const body = el('div');
        const prodInfo = el('p', r.product_name);
        body.append(title, prodInfo, statusBadge, weightText, btn);
        card.append(body);
        records.append(card);
      }
    }
    const count = byId('count');
    if (count) count.textContent = data.total;
    const pageStatus = byId('page-status');
    const totalPages = Math.ceil(data.total / 12) || 1;
    if (pageStatus) pageStatus.textContent = `${page} / ${totalPages} 페이지`;
    const prev = byId('prev'), next = byId('next');
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= totalPages;
    if (msg) msg.textContent = data.total ? '' : '조건에 맞는 검사 기록이 없습니다.';
  } catch (err) {
    if (current !== listRequest) return;
    if (msg) msg.textContent = '검사 기록 조회 실패: ' + err.message;
    if (list) {
      const retry = el('button', '다시 조회'); retry.onclick = () => load();
      list.replaceChildren(retry);
    }
  } finally {
    if (current === listRequest && list) list.setAttribute('aria-busy', 'false');
  }
}

/* =========================================================
   Router & Navigation
   ========================================================= */
export function parseRoute() {
  if (typeof window === 'undefined' || !window.location) return { view: 'home', id: '' };
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  if (path === '/' || path === '/index.html') return { view: 'home', params };
  if (path === '/inspections') return { view: 'home', params, redirect: '/' };
  if (path === '/inspections/new') return { view: 'register', params };
  if (path === '/settings') return { view: 'settings', params };
  const m = path.match(/^\/inspections\/([^/]+)$/);
  if (m) {
    try {
      return { view: 'detail', id: decodeURIComponent(m[1]), params };
    } catch (_) {
      return { view: 'not-found', path, params };
    }
  }
  return { view: 'not-found', path, params };
}

function updateNav(view) {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  const links = document.querySelectorAll('nav a, .mobile-nav-menu a, a.nav-settings-link');
  for (const a of links) {
    if (!a || !a.classList) continue;
    const href = a.getAttribute ? (a.getAttribute('data-path') || a.getAttribute('href')) : '';
    const isActive = (view === 'home' && href === '/') ||
      (view === 'settings' && href === '/settings');
    if (isActive) {
      a.classList.add('active');
      a.setAttribute('aria-current', 'page');
    } else {
      a.classList.remove('active');
      a.removeAttribute('aria-current');
    }
  }
}

export function navigate(url) {
  if (isFormDirty) {
    if (!confirm('저장되지 않은 변경사항이 있습니다. 이동하시겠습니까?')) {
      return;
    }
    isFormDirty = false;
  }
  if (typeof history !== 'undefined' && history.pushState) {
    history.pushState(null, '', url);
  }
  renderRoute().catch(console.error);
}

export async function renderRoute() {
  if (!workspaceActive) return;
  const route = parseRoute();
  if (route.redirect) window.history?.replaceState(null, '', route.redirect);
  if(typeof window!=='undefined'&&window.location)lastRenderedUrl=window.location.pathname+(window.location.search||'');
  if(route.view!=='settings')resetPromptEditors();
  listRequest++; // Invalidate list responses when leaving a page.
  updateNav(route.view);

  // If leaving detail view, invalidate pending detail requests and clean up detail DOM
  if (route.view !== 'detail') {
    detailRequest++;
    workspaceVersion++;
    if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('inspection-opening'));
    const detail = byId('detail');
    if (detail) {
      detail.setAttribute('data-inspection-id', '');
      detail.hidden = true;
      detail.replaceChildren();
    }
  }

  // Hide mobile menu
  const mobileMenu = byId('mobile-nav-menu');
  if (mobileMenu) mobileMenu.hidden = true;
  const toggleBtn = byId('menu-toggle');
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');

  const home = byId('home-panel');
  const records = byId('records-panel');
  const reg = byId('register-panel');
  const detail = byId('detail');
  const settings = byId('settings-panel');
  const notFound = byId('not-found-panel');

  if (notFound) notFound.hidden = true;

  if (route.view === 'home') {
    if (records) records.hidden = true;
    if (reg) reg.hidden = true;
    if (detail) detail.hidden = true;
    if (settings) settings.hidden = true;
    if (home && workspaceActive) home.hidden = false;
    if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('home-opening'));
  } else if (route.view === 'register') {
    if (home) home.hidden = true;
    if (records) records.hidden = true;
    if (detail) detail.hidden = true;
    if (settings) settings.hidden = true;
    if (reg && workspaceActive) {
      reg.hidden = false;
      await initRegistrationForm();
    }
  } else if (route.view === 'detail') {
    if (home) home.hidden = true;
    if (records) records.hidden = true;
    if (reg) reg.hidden = true;
    if (settings) settings.hidden = true;
    if (detail && workspaceActive) detail.hidden = false;
    if (route.id) await show(route.id);
  } else if (route.view === 'settings') {
    if (home) home.hidden = true;
    if (records) records.hidden = true;
    if (reg) reg.hidden = true;
    if (detail) detail.hidden = true;
    if (settings && workspaceActive) {
      settings.hidden = false;
      await loadSettings();
    }
  } else {
    if (home) home.hidden = true;
    if (records) records.hidden = true;
    if (reg) reg.hidden = true;
    if (detail) detail.hidden = true;
    if (settings) settings.hidden = true;
    if (notFound) notFound.hidden = false;
  }
}

/* =========================================================
   Single Inspection Registration Form
   ========================================================= */
let regSelectedPhotos = [];
let cachedStandards = {};

async function fetchStandard(revision) {
  if (cachedStandards[revision]) return cachedStandards[revision];
  try {
    const data = await api('/api/standards/' + revision);
    cachedStandards[revision] = data;
    return data;
  } catch (_) { return null; }
}

async function updateWeightGuidance() {
  const prodSelect = byId('reg-product-select');
  const revSelect = byId('reg-revision-select');
  const rangeText = byId('reg-weight-range-text');
  const stdSummary = byId('reg-standard-summary');

  if (!prodSelect || !revSelect) return;
  const prodId = prodSelect.value;
  const rev = revSelect.value;

  const std = await fetchStandard(rev);
  if (prodSelect.value !== prodId || revSelect.value !== rev) return;
  if (!std) {
    if (rangeText) rangeText.textContent = '검사기준 조회 실패. 중량은 실제 측정값만 입력하세요.';
    if (stdSummary) stdSummary.textContent = '기준을 확인하지 못했습니다. 기준 선택을 다시 바꾸어 조회해 주세요.';
    return;
  }
  const range = std.weight?.[prodId];
  if (rangeText) {
    if (range) {
      rangeText.textContent = `교육용 중량 기준: ${range[0]}–${range[1]}g · ${std.revision}. 사진만으로 중량을 알 수 없습니다.`;
    } else {
      rangeText.textContent = prodId ? '중량 기준을 불러올 수 없습니다.' : '제품을 선택하면 중량 기준이 표시됩니다.';
    }
  }
  if (stdSummary) {
    stdSummary.textContent = `${std.title || '교육용 텀블러 검사기준'} (${std.revision}) — ${std.scope || '외관 및 중량 검사 규격'}`;
  }
}

function updateRegistrationSummary() {
  const summary = byId('reg-save-summary');
  const product = byId('reg-product-select');
  const weight = byId('reg-weight-input')?.value;
  if (summary) summary.textContent = `검사 1건 · 사진 ${regSelectedPhotos.length}장 · ${product?.selectedOptions?.[0]?.textContent || '제품 미선택'} · ${weight ? `중량 ${weight}g` : '중량 미측정'}`;
}

function renderPhotoPreviews() {
  const grid = byId('reg-photo-preview-grid');
  const clearBtn = byId('reg-clear-photo-btn');
  if (!grid) return;
  grid.replaceChildren();
  updateRegistrationSummary();

  if (regSelectedPhotos.length === 0) {
    grid.append(el('div', '사진을 선택하면 여기에 미리보기가 표시됩니다.', 'empty-photo-notice'));
    if (clearBtn) clearBtn.hidden = true;
    return;
  }

  if (clearBtn) clearBtn.hidden = false;

  regSelectedPhotos.forEach((item, idx) => {
    const previewWrap = el('div', undefined, 'photo-preview-item' + (idx === 0 ? ' main-photo' : ''));
    const img = el('img');
    img.src = item.url || item.data_base64;
    img.alt = item.name || `사진 ${idx + 1}`;
    const tag = el('span', idx === 0 ? '대표 사진' : `각도 ${idx + 1}`, 'photo-tag');
    const name = el('p', item.name || `사진 ${idx + 1}`, 'photo-filename');
    const remove = el('button', '사진 제거', 'photo-remove secondary');
    remove.type = 'button';
    remove.setAttribute('aria-label', `${item.name || `사진 ${idx + 1}`} 제거`);
    remove.onclick = () => {
      regSelectedPhotos.splice(idx, 1);
      setFormDirty(true);
      renderPhotoPreviews();
      const status = byId('reg-status-message');
      if (status) status.textContent = `사진 ${regSelectedPhotos.length}장을 선택했습니다.`;
    };
    previewWrap.append(img, tag, name, remove);
    grid.append(previewWrap);
  });
}

async function initRegistrationForm() {
  regSelectedPhotos = [];
  isFormDirty = false;
  let submittedPayload = '', registrationRequestId = '';
  let busy = false;

  const fileInput = byId('reg-file-input');
  const clearBtn = byId('reg-clear-photo-btn');
  const prodSelect = byId('reg-product-select');
  const revSelect = byId('reg-revision-select');
  const inspectedAtInput = byId('reg-inspected-at');
  const weightInput = byId('reg-weight-input');
  const memoInput = byId('reg-memo-input');
  const form = byId('single-register-form');
  const statusMsg = byId('reg-status-message');
  const submitBtn = byId('reg-submit-btn');
  const setBusy = (value) => {
    busy = value;
    for (const control of form.querySelectorAll('input, select, textarea, button')) control.disabled = value;
    form.setAttribute('aria-busy', String(value));
  };
  const showError = (message) => {
    if (statusMsg) { statusMsg.className = 'error'; statusMsg.textContent = message; }
  };

  if (inspectedAtInput) {
    const now = new Date();
    inspectedAtInput.value = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now).replace(' ', 'T');
  }
  if (weightInput) weightInput.value = '';
  if (memoInput) memoInput.value = '';
  if (statusMsg) statusMsg.textContent = '';
  if (prodSelect) prodSelect.value = '';
  if (submitBtn) submitBtn.disabled = false;

  renderPhotoPreviews();
  void updateWeightGuidance(); // Bind upload and form controls without waiting for standards.

  const changed = () => { setFormDirty(true); updateRegistrationSummary(); };
  for (const input of [weightInput, memoInput, inspectedAtInput]) if (input) input.oninput = changed;
  for (const input of [prodSelect, revSelect]) if (input) input.onchange = () => { changed(); void updateWeightGuidance(); };

  if (fileInput) {
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files || []);
      if (busy || !files.length) return;
      if (regSelectedPhotos.length + files.length > 8) {
        showError('사진은 최대 8장입니다. 선택한 사진을 제거한 뒤 다시 선택하세요.');
        fileInput.value = '';
        return;
      }
      setBusy(true);
      if (statusMsg) { statusMsg.className = 'muted'; statusMsg.textContent = '선택한 사진을 읽는 중입니다.'; }
      const errors = [];
      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
          errors.push(`${file.name}: JPG·PNG·WebP 파일을 선택하세요.`);
          continue;
        }
        if(file.size>4*1024*1024){errors.push(`${file.name}: 4MB 이하로 줄여 주세요.`);continue;}
        let base64;
        try{base64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });}catch(_){errors.push(`${file.name}: 읽지 못했습니다. 파일을 다시 선택하세요.`);continue;}
        regSelectedPhotos.push({
          name: file.name,
          mime: file.type,
          data_base64: base64
        });
      }
      fileInput.value = '';
      setFormDirty(true);
      renderPhotoPreviews();
      setBusy(false);
      if (errors.length) showError(errors.join(' '));
      else if (statusMsg) statusMsg.textContent = `사진 ${regSelectedPhotos.length}장을 선택했습니다. 제품과 검사일시를 확인하세요.`;
    };
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (busy) return;
      regSelectedPhotos = [];
      setFormDirty(true);
      renderPhotoPreviews();
      if (statusMsg) statusMsg.textContent = '사진을 모두 제거했습니다. 등록할 사진을 선택하세요.';
    };
  }

  if (form) {
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (busy || !form.reportValidity()) return;
      if (regSelectedPhotos.length === 0) {
        showError('사진을 1장 이상 선택해 주세요.');
        fileInput.focus();
        return;
      }

      setBusy(true);
      if (statusMsg) {
        statusMsg.className = 'muted';
        statusMsg.textContent = '사진 업로드 및 검사 등록을 처리 중입니다...';
      }

      try {
        const weightVal = weightInput.value.trim();
        const weightNum = weightVal ? Number(weightVal) : null;
        const payload = {
          product_id: prodSelect.value,
          inspected_at: inspectedAtInput.value.trim().replace('T', ' ').replace(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/, '$1:00'),
          weight_g: weightNum,
          memo: memoInput.value.trim(),
          photos: regSelectedPhotos,
          revision: revSelect.value,
          decision: null
        };
        const serialized = JSON.stringify(payload);
        if (submittedPayload !== serialized) {
          submittedPayload = serialized;
          registrationRequestId = crypto.randomUUID();
        }
        const res = await api('/api/inspections', {
          method: 'POST',
          headers: { 'X-Request-Id': registrationRequestId },
          body: serialized
        });

        isFormDirty = false;
        if (statusMsg) {
          statusMsg.className = 'badge success';
          statusMsg.textContent = '검사 접수 완료! 상세 화면으로 이동합니다.';
        }

        setTimeout(() => {
          currentStep = 2;
          navigate('/inspections/' + encodeURIComponent(res.inspection_id));
        }, 300);
      } catch (err) {
        if (statusMsg) {
          statusMsg.className = 'error';
          statusMsg.textContent = '등록 실패: ' + err.message;
        }
        setBusy(false);
      }
    };
  }
}

/* =========================================================
   Inspection Detail View (3-Step View)
   ========================================================= */
let currentStep = 1;

export async function show(id) {
  if (!workspaceActive) return;
  const current = ++detailRequest, version = workspaceVersion;
  const detail = byId('detail');
  if (detail) {
    detail.setAttribute('data-inspection-id', '');
    detail.replaceChildren();
    detail.hidden = false;
    detail.setAttribute('aria-busy', 'true');
    const steps = el('p', '① 사진·측정값 → ② AI 결과 확인 → ③ 검사기준과 비교하기 → ④ 내 판단 기록', 'muted');
    const shell = el('div', undefined, 'detail-loading-grid');
    shell.append(el('div', '사진을 불러오는 중입니다.', 'loading-placeholder'), el('div', '제품·측정값을 불러오는 중입니다.', 'loading-placeholder'));
    detail.append(el('h2', '검사 상세 · ' + id), steps, shell);
  }
  const notFound = byId('not-found-panel');
  if (notFound) notFound.hidden = true;
  if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('inspection-opening'));

  try {
    const insp = await api('/api/inspections/' + encodeURIComponent(id));
    if (!workspaceActive || current !== detailRequest || version !== workspaceVersion) return;
    const hasLoc = typeof window !== 'undefined' && window.location && window.location.pathname;
    if (hasLoc) {
      const curRoute = parseRoute();
      if (curRoute.view !== 'detail' || curRoute.id !== id) return;
    }
    if (!detail) return;
    detail.setAttribute('data-inspection-id', insp.inspection_id);
    detail.hidden = false;

    renderDetailView(detail, id, insp, insp.drafts || [], undefined, { loading: true });
    if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('inspection-selected', { detail: insp })); } catch (_) {}
    }
    if (typeof window !== 'undefined' && window.location && window.location.pathname) {
      const loadDrafts = () => api('/api/inspections/' + encodeURIComponent(id) + '/drafts')
        .then(drafts => {
          if (!workspaceActive || current !== detailRequest || version !== workspaceVersion) return;
          const pane2 = detail.querySelector('.step-pane[data-step="2"]');
          if (pane2) {
            const list = Array.isArray(drafts) ? drafts : (drafts ? [drafts] : []);
            const finalDrafts = list.length > 0 ? list : (insp.drafts || []);
            renderStep2(pane2, id, insp, finalDrafts, {}, detail.querySelector('.step-pane[data-step="3"]'));
          }
        })
        .catch(err => {
          if (!workspaceActive || current !== detailRequest || version !== workspaceVersion) return;
          const pane2 = detail.querySelector('.step-pane[data-step="2"]');
          if (pane2) renderStep2(pane2, id, insp, insp.drafts || [], { error: err.message, retry: loadDrafts }, detail.querySelector('.step-pane[data-step="3"]'));
        });
      loadDrafts();
    }
  } catch (err) {
    if (!workspaceActive || current !== detailRequest || version !== workspaceVersion) return;
    if (detail) {
      detail.hidden = false;
      detail.replaceChildren(
        el('h2', '검사 기록을 불러올 수 없습니다.'),
        el('p', err.message, 'error')
      );
      const retry = el('button', '다시 조회'); retry.onclick = () => show(id); detail.append(retry);
    }
  } finally {
    if (current === detailRequest && detail) detail.setAttribute('aria-busy', 'false');
  }
}

function renderDetailView(host, id, insp, drafts, standards, draftState = {}) {
  host.replaceChildren();

  // 1. Top Header Bar
  const headerBar = el('div', undefined, 'detail-header-bar');
  const infoGroup = el('div', undefined, 'detail-header-info');
  infoGroup.append(
    el('span', insp.inspection_id, 'detail-insp-id'),
    el('span', `${insp.product_name} (${insp.color || '은색'})`, 'chip'),
    el('span',
      insp.decision === 'OK' ? '적합 (OK)' :
      insp.decision === 'NG' ? '부적합 (NG)' :
      insp.decision === 'HOLD' ? '보류 (HOLD)' : '미판정',
      'badge ' + (insp.decision === 'OK' ? 'ok' : insp.decision === 'NG' ? 'ng' : insp.decision === 'HOLD' ? 'hold' : 'unjudged')
    ),
    el('span', `검사 기록 버전: ${insp.content_version}`, 'chip')
  );
  headerBar.append(infoGroup);
  host.append(headerBar);

  // 2. Step Navigation Bar
  const stepNavBar = el('div', undefined, 'step-nav-bar');
  stepNavBar.setAttribute('role', 'tablist');

  const steps = [
    { num: 1, title: '① 사진·측정값' },
    { num: 2, title: '② AI 결과 확인' },
    { num: 3, title: '③ 검사기준과 비교하기' },
    { num: 4, title: '④ 내 판단 기록' }
  ];

  steps.forEach(s => {
    const btn = el('button', s.title, 'step-nav-btn' + (currentStep === s.num ? ' active' : ''));
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(currentStep === s.num));
    btn.id = `step-tab-${s.num}`;
    btn.setAttribute('aria-controls',`step-panel-${s.num}`);
    btn.onclick = () => switchStep(s.num);
    stepNavBar.append(btn);
  });
  host.append(stepNavBar);

  // 3. Step Containers
  const pane1 = el('div', undefined, 'step-pane step1-layout' + (currentStep === 1 ? ' active' : ''));
  const pane2 = el('div', undefined, 'step-pane' + (currentStep === 2 ? ' active' : ''));
  const pane3 = el('div', undefined, 'step-pane' + (currentStep === 3 ? ' active' : ''));
  const pane4 = el('div', undefined, 'step-pane' + (currentStep === 4 ? ' active' : ''));
  pane1.setAttribute('data-step', '1');
  pane2.setAttribute('data-step', '2');
  pane3.setAttribute('data-step', '3');
  pane4.setAttribute('data-step', '4');
  [pane1,pane2,pane3,pane4].forEach((pane,index)=>{
    pane.id='step-panel-'+(index+1);pane.setAttribute('role','tabpanel');
    pane.setAttribute('aria-labelledby','step-tab-'+(index+1));
  });

  renderStep1(pane1, id, insp);
  renderStep2(pane2, id, insp, drafts, draftState, pane3);
  renderStep3(pane4, id, insp);

  host.append(pane1, pane2, pane3, pane4);

  // 4. Tech Details collapsible at bottom
  renderBottomTechDetails(host, id, insp);

  switchStep(currentStep || 1);
}

export function switchStep(stepNum) {
  currentStep = [1,2,3,4].includes(Number(stepNum)) ? Number(stepNum) : 1;
  if (typeof document === 'undefined') return;
  for (let i = 1; i <= 4; i++) {
    const btn = document.getElementById(`step-tab-${i}`);
    if (btn) {
      const active = (i === currentStep);
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
  }
  document.querySelectorAll('.step-pane').forEach((pane, idx) => {
    pane.classList.toggle('active', idx + 1 === currentStep);
  });
}
if (typeof window !== 'undefined') {
  window.switchStep = switchStep;
}

/* =========================================================
   Step 1: 사진·측정값 (조회 및 수정)
   ========================================================= */
function renderStep1(container, id, insp) {
  container.replaceChildren();

  // Photo viewer
  const viewer = el('div', undefined, 'photo-detail-viewer');
  const frame = el('div', undefined, 'main-photo-frame detail-main-photo');
  const images = Array.isArray(insp.images) && insp.images.length ? insp.images : [{ image_url: '/media/sample.jpg' }];
  const mainImg = photo(images[0].image_url, insp.inspection_id + ' 대표 사진');
  frame.append(mainImg);
  viewer.append(frame);

  if (images.length > 1) {
    const strip = el('div', undefined, 'thumb-strip');
    images.forEach((imgItem, idx) => {
      const thumb = photo(imgItem.image_url, `각도 ${idx + 1}`);
      if (idx === 0) thumb.classList.add('selected');
      thumb.onclick = () => {
        strip.querySelectorAll('img').forEach(i => i.classList.remove('selected'));
        thumb.classList.add('selected');
        mainImg.src = imgItem.image_url;
      };
      strip.append(thumb);
    });
    viewer.append(strip);
  }
  container.append(viewer);

  // Edit / Details Form
  const formCard = el('div', undefined, 'panel form-section');
  formCard.append(el('h3', '검사 기본 정보 및 측정값 확인·수정', 'form-section-title'));

  const form = el('form');
  const grid = el('div', undefined, 'grid-2');

  const prodLabel = el('label', '제품 모델');
  const prodSelect = el('select');
  [
    { id: 'P-SILVER', name: '보온 텀블러 실버 (P-SILVER)' },
    { id: 'P-WHITE', name: '보온 텀블러 화이트 (P-WHITE)' },
    { id: 'P-BLACK', name: '보온 텀블러 블랙 (P-BLACK)' }
  ].forEach(p => {
    const opt = el('option', p.name);
    opt.value = p.id;
    if (p.id === insp.product_id) opt.selected = true;
    prodSelect.append(opt);
  });
  prodLabel.append(prodSelect);

  const dateLabel = el('label', '검사일시');
  const dateInput = el('input');
  dateInput.value = insp.inspected_at || '';
  dateLabel.append(dateInput);

  grid.append(prodLabel, dateLabel);

  const weightLabel = el('label', '실측 중량 (g)');
  const weightInput = el('input');
  weightInput.name = 'weight_g';
  weightInput.type = 'number';
  weightInput.step = '0.1';
  weightInput.value = insp.weight_g !== null && insp.weight_g !== undefined ? insp.weight_g : '';
  weightInput.placeholder = '미측정 시 공란 (HOLD 유지)';
  weightLabel.append(weightInput);

  const guidanceBox = el('div', undefined, 'weight-guidance');
  const guidanceText = el('span', '중량 허용 범위 조회 중...');
  guidanceBox.append(el('span', 'ℹ️'), guidanceText);

  const updateGuidance = async () => {
    const std = await fetchStandard('Rev.A');
    const range = std.weight?.[prodSelect.value];
    if (range) {
      guidanceText.textContent = `${prodSelect.value} 규격 허용 중량: ${range[0]}g ~ ${range[1]}g (미측정 시 OK 불가)`;
    }
  };
  prodSelect.onchange = updateGuidance;
  updateGuidance();

  const saveBtn = el('button', '수정 내용 저장', 'btn-action primary');
  saveBtn.type = 'submit';
  const saveMsg = el('p', '', 'muted');

  form.append(grid, weightLabel, guidanceBox, el('p', '⚠️ 중량·제품 정보를 변경하면 기존 AI 초안은 stale(재판독 필요) 상태로 변경됩니다. 검사일시만 바꾸거나 판단을 저장하면 그대로입니다.', 'alert-text'), saveBtn, saveMsg);

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    saveBtn.disabled = true;
    saveMsg.textContent = '수정 내용을 저장 중입니다...';

    try {
      const weightVal = weightInput.value.trim();
      await api('/api/inspections/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify({
          product_id: prodSelect.value,
          inspected_at: dateInput.value.trim(),
          weight_g: weightVal ? Number(weightVal) : null,
          expected_version: insp.content_version
        })
      });

      saveMsg.className = 'badge success';
      saveMsg.textContent = '수정 완료! 검사 버전이 갱신되었습니다.';
      setTimeout(() => show(id), 500);
    } catch (err) {
      saveMsg.className = 'error';
      saveMsg.textContent = '수정 실패: ' + err.message;
      saveBtn.disabled = false;
    }
  };

  formCard.append(form);
  container.append(formCard);

  // Step Actions
  const actions = el('div', undefined, 'step-actions');
  const nextBtn = el('button', '다음: AI 결과 확인 →', 'btn-action primary step-next');
  nextBtn.onclick = () => switchStep(2);
  actions.append(nextBtn);
  container.append(actions);
}

/* =========================================================
   Step 2: AI 결과·근거 (6항목 초안 & MCP 표준서 확인)
   ========================================================= */
function renderStep2(container, id, insp, drafts, draftState = {}, evidenceContainer = container) {
  container.replaceChildren();
  if(evidenceContainer !== container)evidenceContainer.replaceChildren();
  container.classList.add('review-step');
  evidenceContainer.classList.add('review-step');

  const draftList = Array.isArray(drafts) ? drafts : (drafts ? [drafts] : (insp?.drafts || []));
  const latestDraft = draftList.length ? draftList[0] : null;
  const isMockDraft = latestDraft && (latestDraft.is_mock || latestDraft.result?.is_mock || latestDraft.status === 'MOCK_COMPLETED');
  let nextStepButton;
  const intro = el('div', undefined, 'review-intro');
  intro.append(el('h2', 'AI가 제안한 결과를 확인하세요'));
  intro.append(el('p', '결과와 이유를 확인한 뒤, 다음 탭에서 검사기준과 비교합니다.', 'muted'));
  container.append(intro);

  const context = el('div', undefined, 'review-context');
  const imageUrl = insp.images?.[0]?.image_url || insp.image_url;
  if (imageUrl) context.append(photo(imageUrl, insp.product_name + ' 검사 사진'));
  const contextText = el('div');
  contextText.append(el('strong', insp.product_name), el('p', '등록 중량: ' + (insp.weight_g == null ? '미측정' : insp.weight_g + 'g') + ' · 내 판단: ' + ({OK:'정상',NG:'불량',HOLD:'보류'}[insp.decision] || '아직 기록하지 않음')));
  context.append(contextText);
  container.append(context);
  const layout = el('div', undefined, 'review-single');
  container.append(layout);
  const confirmationHost = el('div', undefined, 'review-confirmation-host');

  // 1. AI Analysis Status Card
  const aiCard = el('section', undefined, 'review-panel review-result');
  const aiHead = el('div', undefined, 'section-head');
  aiHead.append(el('h3', '1. AI 결과 확인'));

  // A current draft waits for its saved source checks (tab 3) before it says 검토 필요 or 확인할 결과.
  const checkingBadge = !draftState.loading && !draftState.error && latestDraft && !latestDraft.stale;
  const statusBadge = el('span',
    draftState.loading ? 'AI 초안 조회 중' : draftState.error ? 'AI 초안 조회 실패' :
    !latestDraft ? '결과 없음' : latestDraft.stale ? '다시 판독 필요' : '대조 기록 확인 중',
    !latestDraft || isMockDraft || checkingBadge ? 'badge warning' : 'badge success'
  );
  const showResultBadge = () => { statusBadge.textContent = '확인할 결과'; statusBadge.className = isMockDraft ? 'badge warning' : 'badge success'; };
  aiHead.append(statusBadge);
  aiCard.append(aiHead);
  aiCard.setAttribute('aria-busy', String(!!draftState.loading));
  let emptyHelp = null;

  if (draftState.loading) {
    aiCard.append(el('p', '저장된 AI 판독 결과를 불러오는 중입니다.', 'muted'));
  } else if (draftState.error) {
    const error = el('p', 'AI 초안을 조회하지 못했습니다: ' + draftState.error, 'error');
    error.setAttribute('role', 'alert');
    const retry = el('button', 'AI 초안 다시 조회', 'btn-action secondary');
    retry.onclick = () => { retry.disabled = true; draftState.retry?.(); };
    aiCard.append(error, retry);
  } else if (!latestDraft) {
    aiCard.append(
      el('h4', '아직 판독한 결과가 없습니다.', 'review-empty-title'),
      emptyHelp = el('p', '「AI 판독 요청」을 누르면 등록한 사진과 측정값으로 초안을 만듭니다.', 'form-help')
    );
  } else {
    if (isMockDraft) {
      aiCard.append(el('p', '모의 초안입니다(GEMINI_MODE=mock). 사진을 분석하지 않았고 실제 판독 횟수에 들어가지 않습니다.', 'review-simulation'));
    }
    // A mock draft already says it is not a real model; a real draft names the model that wrote it.
    const modelLine = isMockDraft ? '' : draftModelLine(latestDraft);
    if (modelLine) aiCard.append(el('p', modelLine, 'muted review-model'));
    if (latestDraft.stale) {
      aiCard.append(el('div', '검사 기록이 변경되기 전의 결과입니다. 현재 기록으로 다시 판독한 뒤 기준을 확인하세요.', 'notice warning'));
    }
    const decision = latestDraft.result?.['판정'] || latestDraft.result?.decision;
    const decisionTitle = {OK:'정상 제안',NG:'불량 제안',HOLD:'보류 · 추가 확인 필요'}[decision] || '판정 확인 필요';
    const verdict = el('div', undefined, 'review-verdict ' + (latestDraft.stale ? 'stale' : {OK:'ok',NG:'ng',HOLD:'hold'}[decision] || 'hold'));
    verdict.append(el('span', latestDraft.stale ? '이전 결과' : '판독 결과 · 내 판단과 별도', 'review-eyebrow'), el('strong', decisionTitle));
    verdict.append(el('p', insp.weight_g == null ? '중량이 미측정입니다. 종합 정상 여부를 판단하려면 실제 중량을 확인해야 합니다.' : decision === 'HOLD' ? '중량만으로 전체 품질을 확정할 수 없습니다. 부족한 근거를 확인한 뒤 내 판단을 기록하세요.' : '이 결과를 참고해 검사기준을 확인하세요. 내 판단은 4번 탭에서 따로 저장합니다.'));
    aiCard.append(verdict);
    const reportGrid = el('dl', undefined, 'review-findings');
    const fields = [
      { key: '불량유형', label: '확인할 항목' },
      { key: '관찰·수치 근거', label: '이 결과가 나온 이유' },
      { key: '권고 조치', label: '권장하는 다음 행동' }
    ];
    fields.forEach(f => {
      const box = el('div');
      const val = latestDraft.result?.[f.key] || (f.key === '판정' ? latestDraft.result?.decision : null) || '기록 없음';
      const description = el('dd'); evidenceInline(description, val);
      box.append(el('dt', f.label), description);
      reportGrid.append(box);
    });
    aiCard.append(reportGrid);
    const reportDetails = el('details', undefined, 'review-fold');
    reportDetails.append(el('summary', '적용 기준·담당자 확인·실행 지시문'));
    for (const key of ['적용 기준과 출처', '사람 승인 필요 여부']) reportDetails.append(el('h4', key), el('p', latestDraft.result?.[key] || '기록 없음'));
    if(latestDraft.prompt) reportDetails.append(el('h4', '사용한 지시문 · ' + latestDraft.prompt.base_version), el('p',latestDraft.prompt.text,'prompt-natural-text'));
    aiCard.append(reportDetails);
  }

  const runAiBtn = el('button', latestDraft ? 'AI 재판독 요청' : 'AI 판독 요청', 'btn-action ' + (!latestDraft || latestDraft.stale ? 'primary' : 'secondary'));
  runAiBtn.disabled = !!(draftState.loading || draftState.error);
  const runAiStatus = el('span', '', 'muted');
  runAiStatus.setAttribute('role', 'status');
  const version=workspaceVersion;
  const current=()=>workspaceActive && version===workspaceVersion && container.isConnected!==false && byId('detail')?.getAttribute('data-inspection-id')===id;
  const revisionSelect=el('select');revisionSelect.setAttribute('aria-label','판독에 적용할 검사기준');
  for(const revision of ['Rev.A','Rev.B']){const option=el('option',revision);option.value=revision;revisionSelect.append(option);}
  revisionSelect.value=latestDraft?.standard_revision||'Rev.A';
  const runOptions=el('details', undefined, 'review-fold review-run-options');
  runOptions.open = !!latestDraft?.stale;
  runOptions.append(el('summary', '판독 조건 · 검사기준과 프롬프트'));
  const revisionLabel=el('label','다음 판독에 적용할 검사기준');revisionLabel.append(revisionSelect);runOptions.append(revisionLabel);
  aiCard.append(runOptions);
  let geminiChoice=null,notebookChoice=null,geminiOff=false;
  // show() draws this tab again once the drafts arrive, so the loading draw does not ask for prompts, runs, the standard or saved checks.
  if(!draftState.loading)void promptChoice(runOptions,'gemini',{api,el,inspectionId:id,getRevision:()=>revisionSelect.value,expectedVersion:insp.content_version,current}).then(choice=>{if(current())geminiChoice=choice;});
  revisionSelect.onchange=()=>geminiChoice?.refresh();
  const badgeBeforeRun=statusBadge.textContent;
  async function followRun(run,attempt=0) {
    if(!current())return;
    // GEMINI_MODE=off never executes a queued run, so following it would only repeat '판독 대기 중'.
    if(geminiOff&&['QUEUED','PROCESSING'].includes(run.status)){runAiStatus.textContent=GEMINI_OFF_TEXT;statusBadge.textContent=badgeBeforeRun;runAiBtn.disabled=true;return;}
    const labels={QUEUED:'판독 대기 중',PROCESSING:'사진 판독 중',SUCCEEDED:'실제 AI 판독 완료',MOCK_COMPLETED:'모의 초안 준비 완료 — 실제 AI 아님',FAILED:'판독 실패',UNKNOWN:'실행 결과 확인 필요'};
    runAiStatus.textContent=labels[run.status]||'실행 상태 확인 중';
    statusBadge.textContent=runAiStatus.textContent;
    if(['SUCCEEDED','MOCK_COMPLETED'].includes(run.status)) {
      const result=await api('/api/inspections/'+encodeURIComponent(id)+'/drafts');
      if(current())renderStep2(container,id,insp,result,{},evidenceContainer);
      return;
    }
    if(['FAILED','UNKNOWN'].includes(run.status)) {
      runAiStatus.textContent+=': '+(run.error_message||'자동 재호출하지 않습니다. 연결 상태를 확인하세요.');
      runAiBtn.disabled=geminiOff;return;
    }
    runAiBtn.disabled=true;
    if(attempt>=RUN_FOLLOW_POLLS) {runAiStatus.textContent='조회 대기 시간이 길어졌습니다. 결과를 확인한 뒤 다시 요청하세요.';return;}
    await new Promise(resolve=>setTimeout(resolve,2000));
    if(!current())return;
    if(geminiOff)return followRun(run,attempt);
    const next=await api('/api/inspections/'+encodeURIComponent(id)+'/ai-runs/'+encodeURIComponent(run.run_id));
    await followRun(next,attempt+1);
  }
  runAiBtn.onclick = async () => {
    if(!geminiChoice?.id()){runAiStatus.textContent='저장된 판독 지시문을 먼저 조회·선택해 주세요.';return;}
    runAiBtn.disabled = true;
    runAiStatus.textContent = '판독 요청 중...';
    try {
      const run=await api('/api/inspections/' + encodeURIComponent(id) + '/ai-runs', {
        method: 'POST',
        headers: {'X-Request-Id':crypto.randomUUID()},
        body: JSON.stringify({ revision: revisionSelect.value, prompt_version_id:geminiChoice.id(),expected_version:insp.content_version })
      });
      if(current())await followRun(run);
    } catch (e) {
      runAiStatus.textContent = '호출 실패: ' + e.message;
      runAiBtn.disabled = false;
    }
  };
  const btnRow = el('div', undefined, 'row');
  btnRow.style.marginTop = '12px';
  btnRow.append(runAiBtn, runAiStatus);
  (latestDraft ? runOptions : aiCard).append(btnRow);
  layout.append(aiCard);
  const resultNext = el('div', undefined, 'step-actions');
  const compareBtn = el('button','다음: 검사기준과 비교하기 →','btn-action primary step-next');
  compareBtn.onclick=()=>switchStep(3);
  resultNext.append(compareBtn);
  container.append(resultNext);
  if(!draftState.loading)api('/api/inspections/'+encodeURIComponent(id)+'/ai-runs').then(runs=>{
    if(!current())return;
    const latest=runs[0];
    if(latest && ['QUEUED','PROCESSING','FAILED','UNKNOWN'].includes(latest.status))return followRun(latest);
  }).catch(()=>{if(current())runAiStatus.textContent='판독 실행 상태를 조회하지 못했습니다.';});
  // GEMINI_MODE from the server: off turns the button off, mock and an unready live say so.
  api('/api/operations').then(ops=>{
    const gemini=ops?.integrations?.gemini;
    if(!current()||!gemini?.mode)return;
    geminiOff=gemini.mode==='off';
    if(geminiOff)runAiBtn.disabled=true;
    // The empty-state help would otherwise point at a button that is off.
    if(geminiOff&&emptyHelp)emptyHelp.textContent=GEMINI_OFF_TEXT;
    // Tab 3 would send the person to tab 2's button, which is off. NotebookLM off keeps its own guidance there.
    if(geminiOff&&!latestDraft&&notebookMode!=='off'){queryHelp.textContent=GEMINI_OFF_EVIDENCE_TEXT;queryHelp.hidden=false;}
    if(gemini.mode!=='live'||!gemini.ready)runAiStatus.textContent=gemini.message||'';
  }).catch(()=>{});

  // 2. NotebookLM MCP Evidence Card
  const mcpCard = el('section', undefined, 'review-panel review-standard');
  const mcpHead = el('div', undefined, 'evidence-mcp-header');
  mcpHead.append(el('h3', '2. 검사기준과 비교하기'));

  const mcpBadge = el('span', '연결 상태 확인 중', 'muted');
  // NOTEBOOKLM_MODE off or mock from the status response; the mode badge then stays whatever loads after it.
  let notebookMode = null;
  // Set once a query answer (saved or new) is on screen; a later status response then leaves its badge alone.
  let evidenceShown = false;
  mcpCard.append(mcpHead);

  api('/api/notebooklm/status').then(st => {
    if (!current()) return;
    if (st.mode === 'off' || st.mode === 'mock') {
      notebookMode = st.mode;
      showNotebookMode(st.mode, mcpBadge, queryBtn, queryHelp);
    } else if (evidenceShown) {
      return;
    } else if (st.connected) {
      mcpBadge.textContent = 'NotebookLM 연결됨';
    } else {
      mcpBadge.textContent = 'NotebookLM 연결 여부는 근거 조회 시 확인합니다.';
    }
  }).catch(() => {mcpBadge.textContent='연결 상태 조회 실패';});

  mcpCard.append(
    el('p', '여기서 말하는 「근거」는 정상·불량을 나누는 검사기준 문서입니다. 결과의 설명이 이 기준과 맞는지 확인하세요.', 'review-explanation')
  );
  const standardArea = el('div', undefined, 'review-standard-preview');
  const standardRevision = latestDraft?.standard_revision || 'Rev.A';
  let updateConfirmation = () => {};
  async function loadStandard() {
    standardArea.replaceChildren(el('p', '검사기준을 불러오는 중입니다.', 'muted'));
    updateConfirmation();
    try {
      const std = await api('/api/standards/' + encodeURIComponent(standardRevision));
      if (!current()) return;
      if (std.revision !== standardRevision || !std.natural_text) throw Error('기준 문서의 버전이나 내용을 확인할 수 없습니다.');
      standardArea.replaceChildren();
      standardArea.append(el('p', (latestDraft ? '이 결과에 적용한 기준 · ' : '기준 미리보기 · ') + standardRevision, 'review-eyebrow'));
      const range = std.weight?.[insp.product_id];
      if (Array.isArray(range) && range.length === 2 && range.every(Number.isFinite)) {
        const rows = el('dl', undefined, 'review-measurements');
        for (const [label,value] of [
          ['중량 허용 범위', range[0] + '–' + range[1] + 'g'],
          ['등록한 중량', insp.weight_g == null ? '미측정' : insp.weight_g + 'g'],
          ['수치 비교', insp.weight_g == null ? '측정값이 없어 비교할 수 없습니다.' : insp.weight_g >= range[0] && insp.weight_g <= range[1] ? '중량은 기준 범위 안에 있습니다.' : '중량이 기준 범위를 벗어났습니다.']
        ]) {const row = el('div'); row.append(el('dt',label),el('dd',value)); rows.append(row);}
        standardArea.append(rows);
      }
      const source = el('details', undefined, 'review-fold review-standard-source');
      source.append(el('summary', '검사기준 원문 읽기 · ' + standardRevision), el('p', std.natural_text, 'prompt-natural-text'));
      standardArea.append(source);
      updateConfirmation();
    } catch (error) {
      if (!current()) return;
      const retry = el('button','검사기준 다시 불러오기','btn-action secondary');retry.onclick=loadStandard;
      standardArea.replaceChildren(el('p','검사기준을 불러오지 못했습니다. ' + error.message,'error'),retry);
    }
  }
  mcpCard.append(standardArea);
  if (draftState.loading) standardArea.append(el('p', '검사기준을 불러오는 중입니다.', 'muted'));
  else void loadStandard();
  const queryOptions = el('details', undefined, 'review-fold');
  queryOptions.append(el('summary', '근거 질문·연결 정보'));
  // A click before the saved questions have loaded waits for them (below) instead of asking the person to choose one.
  const notebookChoiceTask=draftState.loading?null:promptChoice(queryOptions,'notebooklm',{api,el,inspectionId:id,revision:standardRevision,expectedVersion:insp.content_version,current}).then(choice=>{if(current())notebookChoice=choice;});

  const queryBtn = el('button', '근거 확인', 'btn-action primary');
  queryBtn.disabled = !latestDraft || !!latestDraft.stale || !!draftState.loading || !!draftState.error;
  const queryHelp = el('p', !latestDraft ? '2번 탭에서 판독 결과를 먼저 준비하세요. 결과가 생기면 근거를 볼 수 있습니다.' : latestDraft.stale ? '2번 탭에서 다시 판독해 주세요. 이전 결과로는 근거를 확인할 수 없습니다.' : '', 'form-help');
  queryHelp.hidden = !queryHelp.textContent;
  const queryStatus = el('p', '', 'muted');
  queryStatus.setAttribute('role', 'status');
  const resultArea = el('div', undefined, 'evidence-results');
  let evidenceViewRequest=0;

  queryBtn.onclick = async () => {
    if(!latestDraft || latestDraft.stale){queryStatus.textContent='최신 자료로 판독한 AI 초안을 먼저 준비해 주세요.';return;}
    queryBtn.disabled = true;
    if(!notebookChoice){
      queryStatus.textContent='저장된 근거 질문을 불러오는 중입니다. 불러오면 이어서 근거를 확인합니다.';
      await notebookChoiceTask;
      if(!current())return;
      // NOTEBOOKLM_MODE=off may have arrived meanwhile; it keeps the button off.
      if(notebookMode==='off'){queryStatus.textContent='';return;}
    }
    if(!notebookChoice?.id()){queryStatus.textContent='저장된 근거 질문을 먼저 조회·선택해 주세요.';queryBtn.disabled=false;return;}
    evidenceViewRequest++;
    queryStatus.textContent = 'NotebookLM에서 검사기준을 찾는 중입니다.';
    resultArea.replaceChildren();
    confirmationHost.replaceChildren();

    try {
      const qRes = await api('/api/inspections/' + encodeURIComponent(id) + '/evidence-queries', {
        method: 'POST',
        body: JSON.stringify({
          expected_version: insp.content_version,
          revision: latestDraft.standard_revision,
          draft_id:latestDraft.draft_id,
          prompt_version_id:notebookChoice.id()
        })
      });
      if(current())showEvidence(qRes);
    } catch (e) {
      queryStatus.textContent = '근거 확인 실패: ' + e.message;
    } finally {
      queryBtn.disabled = false;
    }
  };
  function showEvidence(qRes,saved=false){
      resultArea.replaceChildren();
      confirmationHost.replaceChildren();
      if (nextStepButton) nextStepButton.className = 'btn-action primary step-next';
      queryStatus.textContent = saved ? '저장된 근거를 불러왔습니다.' : '근거를 불러왔습니다. 원문과 일치하는지 확인하세요.';
      // With NOTEBOOKLM_MODE off or mock the mode badge stays; off also keeps its guidance, and 「근거 확인」 remains off.
      queryHelp.hidden = notebookMode !== 'off';
      queryBtn.textContent = '근거 다시 조회';
      queryBtn.className = 'btn-action secondary';
      evidenceShown = true;
      if (!notebookMode) {
        mcpBadge.textContent=qRes.is_mock?'모의 응답 — 실제 연결 아님':saved?'저장된 실제 NotebookLM 답변':'실제 NotebookLM 질의 완료';
        mcpBadge.className=qRes.is_mock?'status-badge warning':'status-badge success';
      }
      const card = el('div', undefined, 'review-evidence-answer');
      const queryDetails = el('details', undefined, 'evidence-query-details');
      queryDetails.append(el('summary', 'NotebookLM에 보낸 질문 보기'), el('p', qRes.query_prompt || qRes.query_text || '질의문 확인 필요'));
      card.append(el('h4', '이 결과와 비교할 검사기준'));
      card.append(el('p', qRes.source_document || '문서명 미확인 · ' + (qRes.standard_revision || '버전 미확인'), 'review-source-name'));
      // A real answer's name and version are the standard queried, not read from the answer: Rev.A and Rev.B share the
      // title and number in the notebook, and source IDs do not say which file was cited (src/mcp-client.ts).
      if (qRes.is_mock === false) card.append(el('p', SOURCE_NAME_HINT, 'review-source-hint muted'));
      card.append(renderEvidenceMarkdown(qRes.evidence_excerpt || qRes.response_text || '응답 근거가 없습니다. 확인 완료로 저장하지 마세요.'));
      if(qRes.prompt)queryDetails.append(el('p','사용한 근거 질문: '+qRes.prompt.base_version+(qRes.prompt.is_default?' · 기본 원문':' · 저장한 수정본'),'muted'));
      card.append(queryDetails);

      // Confirmation Form
      const form = el('form', undefined, 'evidence-confirm-form review-confirmation');
      form.append(el('h5', '기준 원문과 답변이 일치하나요?'), el('p', '원문을 열어 문서명·버전·내용을 답변과 비교하세요. 일치할 때만 아래 항목에 체크합니다.', 'muted'));
      if (/^[a-f0-9-]{36}$/i.test(qRes.notebook_id || '')) {
        const sourceLink = el('a', 'NotebookLM에서 원문 열기', 'evidence-source-link');
        sourceLink.href = 'https://notebook.google.com/notebook/' + qRes.notebook_id;
        sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer'; form.append(sourceLink);
      }
      const checkLabel = el('label', undefined, 'evidence-confirm-check');
      const check = el('input');
      check.type = 'checkbox';
      check.required = true;
      checkLabel.append(check, el('span', '검사기준 원문을 읽었으며, 위 답변과 일치합니다.'));
      // Optional and after the first check box: the person marks an AI result that does not fit this standard.
      const reviewLabel = el('label', undefined, 'evidence-confirm-check');
      const reviewCheck = el('input');
      reviewCheck.type = 'checkbox';
      reviewLabel.append(reviewCheck, el('span', 'AI 판정이 이 기준과 맞지 않습니다(검토 필요)'));
      // The two boxes check different things, so a review mark still needs the first one (src/evidence.controller.ts).
      const reviewHelp = el('p', REVIEW_HELP_TEXT, 'evidence-confirm-help muted');

      const noteLabel = el('label', '대조 메모 (선택)');
      const note = el('textarea'); note.rows = 2; note.maxLength = 1000;
      note.placeholder = '어느 항목을 확인했나요? 예: 중량 기준의 범위가 답변과 일치함';
      noteLabel.append(note);

      const confirmBtn = el('button', '출처 대조 기록 저장', 'btn-action secondary');
      confirmBtn.type = 'submit';
      confirmBtn.disabled = true;
      let confirmationSaved = qRes.confirmation?.verified === true;
      let confirmationSaving = false;
      updateConfirmation = () => { confirmBtn.disabled = !check.checked || confirmationSaved || confirmationSaving; };
      check.onchange = updateConfirmation;
      const confirmStatus = el('p', '체크하면 「출처 대조 기록 저장」 버튼을 누를 수 있습니다.', 'muted');
      confirmStatus.setAttribute('role', 'status'); confirmStatus.setAttribute('aria-live', 'polite');
      const showConfirmed = reviewNeeded => {
        confirmationSaved = true;
        check.checked = true; check.disabled = true; note.disabled = true;
        reviewCheck.checked = !!reviewNeeded; reviewCheck.disabled = true;
        confirmBtn.textContent = '기준 확인 기록 저장됨';
        confirmStatus.textContent = reviewNeeded
          ? '검토 필요로 저장했습니다. AI 판정이 기준과 맞지 않는다는 표시입니다. 제품에 대한 내 판단은 아래 「내 판단 기록하기」에서 따로 저장하세요.'
          : '기준 확인은 저장됐습니다. 제품에 대한 내 판단은 아래 「내 판단 기록하기」에서 따로 저장하세요.';
        // The tab 2 badge follows this last saved check: 검토 필요, or back to the result after a later 일치.
        if (reviewNeeded) { statusBadge.textContent = '검토 필요'; statusBadge.className = 'badge warning'; }
        else if (['검토 필요', '대조 기록 확인 중', '대조 기록 확인 실패'].includes(statusBadge.textContent)) showResultBadge();
        updateConfirmation();
      };
      if (confirmationSaved) { note.value = qRes.confirmation.note || ''; showConfirmed(qRes.confirmation.review_needed === true); }

      form.append(checkLabel, reviewLabel, reviewHelp, noteLabel, el('p', '저장되는 것은 출처를 대조했다는 기록입니다. 제품의 정상·불량 판정이나 출하 승인은 변경되지 않습니다.', 'evidence-confirm-help muted'), confirmBtn, confirmStatus);
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (confirmationSaved || confirmationSaving) return;
        if (!check.checked) { confirmStatus.textContent = '원문을 먼저 대조한 뒤 확인 항목에 체크해 주세요.'; return; }
        confirmBtn.disabled = true;
        confirmationSaving = true;
        check.disabled = true; reviewCheck.disabled = true;
        const reviewNeeded = reviewCheck.checked === true;
        try {
          await api('/api/inspections/' + encodeURIComponent(id) + '/evidence-confirmation', {
            method: 'POST',
            body: JSON.stringify({
              verified: true,
              draft_id:qRes.draft_id,
              note: note.value,
              expected_version: insp.content_version,
              ...(reviewNeeded ? { review_needed: true } : {})
            })
          });
          showConfirmed(reviewNeeded);
        } catch (err) {
          confirmStatus.textContent = '저장 실패: ' + err.message;
          check.disabled = false; reviewCheck.disabled = false;
        } finally {
          confirmationSaving = false;
          updateConfirmation();
        }
      };

      confirmationHost.append(form);
      resultArea.append(card);
  }
  if(latestDraft&&!draftState.loading){
    const historyRequest=evidenceViewRequest;
    api('/api/inspections/'+encodeURIComponent(id)+'/evidence-queries').then(({queries})=>{
      if(!current())return;
      // Any saved review mark on this draft, from any of its queries or an earlier inspection version.
      const reviewBadge=reviewNeededBadge(queries,latestDraft);
      if(reviewBadge){statusBadge.textContent=reviewBadge;statusBadge.className='badge warning';}
      else if(statusBadge.textContent==='대조 기록 확인 중')showResultBadge();
      if(historyRequest!==evidenceViewRequest)return;
      const saved=savedEvidenceFor(queries,latestDraft,insp.content_version);
      if(saved)showEvidence(saved,true);
    }).catch(()=>{
      // 409, no answer or a timeout: say the saved checks did not load instead of showing the result. Reopening the detail asks again.
      if(current()&&statusBadge.textContent==='대조 기록 확인 중'){statusBadge.textContent='대조 기록 확인 실패';statusBadge.className='badge warning';}
      if(current()&&historyRequest===evidenceViewRequest)queryStatus.textContent='저장된 근거 이력을 조회하지 못했습니다. 근거 질문을 실행하기 전 연결 상태를 확인해 주세요.';
    });
  }

  const queryActions = el('div', undefined, 'evidence-query-actions');
  queryActions.append(queryBtn);
  mcpCard.append(queryActions, queryHelp, queryStatus, resultArea, queryOptions);
  queryOptions.append(mcpBadge);
  evidenceContainer.append(mcpCard,confirmationHost);

  if(draftList.length > 1)draftComparison(container,draftList,{el});

  // Step Actions
  const actions = el('div', undefined, 'step-actions review-next');
  const prevBtn = el('button', '← 이전: AI 결과 확인', 'btn-action secondary step-prev');
  prevBtn.onclick = () => switchStep(2);
  const nextBtn = el('button', '내 판단 기록하기 →', 'btn-action secondary step-next');
  nextStepButton = nextBtn;
  nextBtn.onclick = () => switchStep(4);
  const nextHelp = el('div');
  nextHelp.append(el('strong', '다음: 내 판단 기록'),el('p', '4번 탭에서 정상·불량·보류와 조치를 직접 선택합니다. 근거가 부족하면 보류로 기록할 수 있습니다.', 'muted'));
  actions.append(nextHelp, prevBtn, nextBtn);
  evidenceContainer.append(actions);
}

// NOTEBOOKLM_MODE from /api/notebooklm/status. off turns 「근거 확인」 off; the standard source above stays readable.
const NOTEBOOK_MODE_TEXT = {off:'근거 대조 꺼짐', mock:'모의 응답 — 실제 NotebookLM 연결 아님', live:'실제 NotebookLM 질의'};
const notebookModeText = mode => NOTEBOOK_MODE_TEXT[mode] + '(NOTEBOOKLM_MODE=' + mode + ')';
function showNotebookMode(mode, badge, button, help) {
  // Text and colour together, so the badge is the same whichever response arrives first.
  badge.textContent = notebookModeText(mode);
  badge.className = 'status-badge warning';
  if (mode !== 'off') return;
  button.disabled = true;
  help.textContent = 'NotebookLM 근거 대조가 꺼져 있습니다(NOTEBOOKLM_MODE=off). 기준 원문을 직접 읽고 판단하세요.';
  help.hidden = false;
}
// Tab 2 badge when the draft's last saved source check is '검토 필요' (the rule the home and the list use), or null.
// A stale draft says it was an earlier version.
function reviewNeededBadge(queries, draft) {
  if (!draft || !Array.isArray(queries)) return null;
  const last = queries.filter(q => String(q.draft_id) === String(draft.draft_id) && q.confirmation).at(-1);
  if (last?.confirmation.review_needed !== true) return null;
  return draft.stale ? '검토 필요(이전 버전)' : '검토 필요';
}
const SOURCE_NAME_HINT = '질의한 기준입니다. 답변이 인용한 원문의 판(Rev.A/B)은 아래 인용과 대조해 확인하세요.';
const REVIEW_HELP_TEXT = '첫 번째 칸은 위 답변이 기준 원문과 같을 때 체크합니다. AI 판정이 이 기준과 맞지 않으면 두 번째 칸을 체크하고, 이때도 첫 번째 칸을 먼저 체크하세요.';
const GEMINI_OFF_TEXT = 'Gemini 판독이 꺼져 있습니다(GEMINI_MODE=off). 4번 탭에서 직접 판단을 기록하세요.';
const GEMINI_OFF_EVIDENCE_TEXT = 'Gemini 판독이 꺼져 있습니다(GEMINI_MODE=off). 근거 대조는 AI 초안이 있어야 할 수 있습니다. 검사기준 원문을 직접 읽고 4번 탭에서 판단을 기록하세요.';
const GEMINI_MODE_TEXT = {off:'꺼짐 — 사람이 직접 판정', mock:'모의 초안 — 실제 AI 아님', live:'실제 Gemini 판독(GAS)'};
// Settings card: the main model and the one tried when it is overloaded or rate-limited ('' when none).
function geminiModelLine(model, fallback) {
  return '모델: ' + model + (fallback ? ' (과부하·한도 초과 때 ' + fallback + ')' : ' (대체 모델 없음)');
}
// 150 polls 2 s apart (5 min or more), well past a GAS run with a fallback (about 165 s, gas/Live.gs).
const RUN_FOLLOW_POLLS = 150;
// Tab 2: the model that wrote the draft, and the main model it replaced after a 503 or 429.
function draftModelLine(draft) {
  const model = draft?.result?.model || draft?.model;
  if (typeof model !== 'string' || !model) return '';
  const from = draft.result?.fallback_from;
  return '판독 모델: ' + model + (from ? ' · 기본 모델 ' + from + ' 대신 대체 판독' : '');
}

/* =========================================================
   Step 4: 내 판단 기록 (OK/NG/HOLD, 불량 칩, 미측정 OK 차단)
   ========================================================= */
function renderStep3(container, id, insp) {
  container.replaceChildren();

  const card = el('div', undefined, 'panel form-section');
  card.append(el('h3', '확인한 내용을 바탕으로 내 판단을 저장하세요', 'form-section-title'));
  card.append(el('p', 'AI 결과는 참고 자료입니다. 아래에서 직접 선택하고 저장해야 내 판단이 기록됩니다. 출하 승인은 별도입니다.', 'form-help'));

  const form = el('form');

  // 1. Decision Radio Group
  const decLabel = el('fieldset', undefined, 'judgment-choice');
  decLabel.append(el('legend', '내 판단 선택 (필수)'));
  const radioGroup = el('div', undefined, 'decision-radio-group');

  const isWeightNull = insp.weight_g === null || insp.weight_g === undefined;

  const decisions = [
    { val: 'OK', text: '정상 (OK - 적합)', cls: 'ok' },
    { val: 'NG', text: '불량 (NG - 부적합)', cls: 'ng' },
    { val: 'HOLD', text: '보류 (HOLD - 확인 필요)', cls: 'hold' }
  ];

  let currentSelectedDecision = (insp.decision === 'OK' || insp.decision === 'NG' || insp.decision === 'HOLD') ? insp.decision : null;
  if (isWeightNull && currentSelectedDecision === 'OK') {
    currentSelectedDecision = 'HOLD';
  }

  decisions.forEach(d => {
    const lbl = el('label', undefined, `decision-radio-label ${d.cls}`);
    const r = el('input');
    r.type = 'radio';
    r.name = 'decision';
    r.required = true;
    r.value = d.val;
    r.checked = currentSelectedDecision === d.val;

    if (d.val === 'OK' && isWeightNull) {
      r.disabled = true;
      lbl.classList.add('disabled');
      lbl.title = '중량 미측정 상태에서는 적합(OK)을 확정할 수 없습니다.';
    }

    r.onchange = () => {
      setFormDirty(true);
      updateSummary();
    };

    lbl.append(r, ' ' + d.text);
    radioGroup.append(lbl);
  });
  decLabel.append(radioGroup);

  if (isWeightNull) {
    const warningText = el('p', '중량을 측정하지 않아 정상은 선택할 수 없습니다. 명확한 불량을 확인했다면 불량, 판단 근거가 부족하면 보류를 선택하세요.', 'alert-text');
    decLabel.append(warningText);
  }
  form.append(decLabel);

  // 2. Defect Chips
  const defectLabel = el('fieldset', undefined, 'judgment-choice');
  defectLabel.append(el('legend', '확인한 불량 (선택 · 여러 항목 선택 가능)'));
  const chipGroup = el('div', undefined, 'defect-chip-group');
  const defectItems = [
    { code: 'D01', name: '스크래치' },
    { code: 'D02', name: '찍힘' },
    { code: 'D03', name: '라벨 오류' },
    { code: 'D04', name: '뚜껑 조립 오류' }
  ];

  const existingDefectCodes = new Set((insp.defects || []).map(d => typeof d === 'string' ? d : d.defect_code));

  defectItems.forEach(d => {
    const chip = el('label', undefined, 'defect-chip' + (existingDefectCodes.has(d.code) ? ' checked' : ''));
    const chk = el('input');
    chk.type = 'checkbox';
    chk.value = d.code;
    chk.checked = existingDefectCodes.has(d.code);
    chk.onchange = () => {
      chip.classList.toggle('checked', chk.checked);
      setFormDirty(true);
      updateSummary();
    };
    chip.append(chk, d.name);
    chipGroup.append(chip);
  });
  defectLabel.append(chipGroup);
  defectLabel.append(el('p', '직접 확인한 불량만 선택하세요. 확인하지 못했다면 선택하지 않아도 됩니다.', 'form-help'));
  form.append(defectLabel);

  // 3. Memo & Reason
  const memoLabel = el('label', '조치 사항 및 작업 메모');
  const memoInput = el('textarea');
  memoInput.rows = 3;
  memoInput.placeholder = '판정 근거 및 후속 조치 내용을 구체적으로 기재하세요.';
  memoInput.value = insp.memo || '';
  memoInput.oninput = () => { setFormDirty(true); updateSummary(); };
  memoLabel.append(memoInput);

  const reasonLabel = el('label', '변경 사유');
  const reasonInput = el('input');
  reasonInput.placeholder = '판정 또는 메모 등록/수정 사유를 입력하세요 (예: 1차 육안 검사 완료)';
  reasonInput.value = '담당자 대조 판정 기록';
  reasonInput.required = true;
  reasonInput.oninput = () => setFormDirty(true);
  reasonLabel.append(reasonInput);

  form.append(memoLabel, reasonLabel);

  // 4. Pre-save Summary Box
  const summaryBox = el('div', undefined, 'summary-box');
  const summaryTitle = el('h4', '📋 저장 전 판정 요약');
  const summaryList = el('ul');
  summaryBox.append(summaryTitle, summaryList);
  form.append(summaryBox);

  const updateSummary = () => {
    summaryList.replaceChildren();
    const selDec = form.querySelector('input[name="decision"]:checked')?.value;
    const decText = selDec === 'OK' ? '정상(OK)' : selDec === 'NG' ? '부적합(NG)' : selDec === 'HOLD' ? '보류(HOLD)' : '(미선택 - 판정을 선택하세요)';
    const checkedDefects = Array.from(chipGroup.querySelectorAll('input:checked')).map(c => {
      const item = defectItems.find(d => d.code === c.value);
      return item ? item.name : c.value;
    });

    summaryList.append(
      el('li', `최종 판정: ${decText}`),
      el('li', `실측 중량: ${insp.weight_g !== null && insp.weight_g !== undefined ? insp.weight_g + 'g' : '미측정'}`),
      el('li', `선택된 불량 항목: ${checkedDefects.length ? checkedDefects.join(', ') : '없음'}`),
      el('li', `작업 메모: ${memoInput.value.trim() || '(입력 안 됨)'}`)
    );
  };
  updateSummary();

  // Submit Button
  const submitBtn = el('button', '내 판단 저장', 'btn-action primary btn-lg');
  submitBtn.type = 'submit';
  const saveStatus = el('p', '', 'muted');
  saveStatus.setAttribute('role', 'status');

  form.append(submitBtn, saveStatus);

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;
    const selDec = form.querySelector('input[name="decision"]:checked')?.value;
    if (!selDec) {
      alert('판정을 선택하세요.');
      return;
    }
    if (selDec === 'OK' && isWeightNull) {
      alert('중량이 미측정된 검사는 적합(OK)으로 확정할 수 없습니다. 보류(HOLD)를 선택하세요.');
      return;
    }

    submitBtn.disabled = true;
    saveStatus.textContent = '판정 기록을 저장하는 중입니다...';

    const selectedCodes = Array.from(chipGroup.querySelectorAll('input:checked')).map(c => c.value);

    try {
      await api('/api/inspections/' + encodeURIComponent(id) + '/records', {
        method: 'POST',
        body: JSON.stringify({
          decision: selDec,
          weight_g: insp.weight_g,
          memo: memoInput.value.trim(),
          change_reason: reasonInput.value.trim(),
          expected_version: insp.content_version,
          expected_record_id: insp.current_record_id || null,
          defects: selectedCodes
        })
      });

      isFormDirty = false;
      saveStatus.className = 'badge success';
      saveStatus.textContent = '판정이 정상적으로 저장되었습니다.';
      setTimeout(() => show(id), 600);
    } catch (err) {
      saveStatus.className = 'error';
      saveStatus.textContent = '저장 실패: ' + err.message;
      submitBtn.disabled = false;
    }
  };

  card.append(form);
  container.append(card);

  // Step Actions
  const actions = el('div', undefined, 'step-actions');
  const prevBtn = el('button', '← 이전: 검사기준과 비교하기', 'btn-action secondary step-prev');
  prevBtn.onclick = () => switchStep(3);
  actions.append(prevBtn);
  container.append(actions);
}

/* =========================================================
   Bottom Collapsible Tech Details
   ========================================================= */
// History is shown in Korean time (kstTime, public/prompts.js).
// Records keep the account's number (the session's user id); the screen names the account it belongs to, or shows the number.
// The ids of the classroom accounts in src/security.ts.
const ACCOUNT_NAMES = { 1: 'writer', 2: 'reviewer', 3: 'factory-user' };
function accountName(record) {
  if (record.username) return record.username;
  return ACCOUNT_NAMES[record.user_id] || record.user_id;
}
// The judgment memo after the history line: up to HISTORY_MEMO_CHARS characters as is, a longer one cut there with
// the whole text in a fold. Plain text only.
const HISTORY_MEMO_CHARS = 60;
function appendHistoryMemo(li, memo) {
  const text = String(memo ?? '').trim();
  if (!text) return;
  const chars = [...text.replace(/\s+/g, ' ')];
  if (chars.length <= HISTORY_MEMO_CHARS && !/\n/.test(text)) { li.append(el('span', ', 메모: ' + chars.join(''))); return; }
  const fold = el('details', undefined, 'history-memo');
  fold.append(el('summary', '메모: ' + chars.slice(0, HISTORY_MEMO_CHARS).join('') + (chars.length > HISTORY_MEMO_CHARS ? '…' : '')), el('p', text, 'history-memo-text'));
  li.append(fold);
}
function renderBottomTechDetails(host, id, insp) {
  const details = el('details', undefined, 'tech-details');
  const summary = el('summary', '🔍 검사 수정 이력 및 기술 정보 (펼치기)');
  details.append(summary);

  const content = el('div');
  content.style.marginTop = '12px';

  // A failed read says so with a retry, like the AI draft read, instead of leaving the fold empty.
  const loadHistory = () => api('/api/inspections/' + encodeURIComponent(id) + '/records').then(history => {
    if (history && history.length) {
      content.append(el('h4', '기록 변경 이력'));
      const ul = el('ul');
      history.forEach(h => {
        const li = el('li', `[${kstTime(h.recorded_at || h.created_at)}] v${h.content_version} - 판정: ${h.decision}, 중량: ${h.weight_g == null ? '미측정' : h.weight_g + 'g'}, 작성자: ${accountName(h)}, 사유: ${h.change_reason || '-'}`);
        appendHistoryMemo(li, h.memo);
        ul.append(li);
      });
      content.append(ul);
    } else {
      content.append(el('p', '과거 수정 이력이 없습니다. 최초 등록 상태입니다.', 'muted'));
    }
  }).catch(err => {
    const failure = el('div');
    const error = el('p', '수정 이력을 조회하지 못했습니다: ' + err.message, 'error');
    error.setAttribute('role', 'alert');
    const retry = el('button', '수정 이력 다시 조회', 'btn-action secondary');
    retry.onclick = () => { retry.disabled = true; failure.remove(); loadHistory(); };
    failure.append(error, retry);
    content.append(failure);
  });
  loadHistory();

  details.append(content);
  host.append(details);
}

/* =========================================================
   Settings View
   ========================================================= */
// STORAGE_MODE=mock keeps records in a local file, so the footer and the storage card do not say Google Sheets.
// Live storage and a reply without the field keep the page's own text.
const MOCK_STORAGE_FOOTER = '텀블러 공장 품질관리 시스템입니다. 지금은 모의 저장소(이 PC의 로컬 파일)에 품질 기록을 저장하며 담당자가 직접 검토합니다.';
const MOCK_STORAGE_NOTE = '지금은 모의 저장소(STORAGE_MODE=mock)라 검사, 판정, 이력을 이 PC의 로컬 파일에 저장합니다. Google Sheets에는 쓰지 않습니다.';
export function applyStorageMode(ops) {
  if (ops?.integrations?.storage?.mode !== 'mock' || typeof document === 'undefined') return;
  const footer = document.querySelector('main > footer');
  if (footer) footer.textContent = MOCK_STORAGE_FOOTER;
  const note = document.getElementById('settings-storage-provider')?.nextElementSibling;
  if (note) note.textContent = MOCK_STORAGE_NOTE;
}

let settingsRequest = 0;
async function loadSettings() {
  const current = ++settingsRequest;
  const version = workspaceVersion;
  const active = () => current === settingsRequest && version === workspaceVersion && workspaceActive;
  const promptHost=byId('prompt-settings');
  if(promptHost)void loadPromptSettings(promptHost,{api,el,setFormDirty});
  const mcpBadge = byId('settings-mcp-status');
  const aiMode = byId('settings-ai-mode');
  const aiModel = byId('settings-ai-model');
  const storageEl = byId('settings-storage-provider');

  for (const node of [mcpBadge, aiMode, storageEl]) if (node) node.textContent = '연결 상태 조회 중…';
  const mcpTask = api('/api/notebooklm/status').then(mcp => {
    if (!active()) return;
    if (mcpBadge) {
      if (mcp.mode === 'off' || mcp.mode === 'mock') {
        mcpBadge.textContent = notebookModeText(mcp.mode);
        mcpBadge.className = 'status-badge warning';
      } else if (mcp.connected) {
        mcpBadge.textContent = '정상 연결';
        mcpBadge.className = 'status-badge success';
      } else {
        mcpBadge.textContent = '연결 준비 필요';
        mcpBadge.className = 'status-badge warning';
      }
    }

  }).catch(() => {
    if (active() && mcpBadge) { mcpBadge.textContent = 'NotebookLM 상태 조회 실패'; mcpBadge.className = 'status-badge warning'; }
  });
  const operationsTask = api('/api/operations').then(ops => {
    if (!active()) return;
    if (aiMode) {
      const gemini = ops.integrations?.gemini;
      aiMode.textContent = gemini?.mode ? '판독 연결: '+GEMINI_MODE_TEXT[gemini.mode]+'(GEMINI_MODE='+gemini.mode+')'+(gemini.mode==='live'&&!gemini.ready?' · '+gemini.message:'')
        : '판독 연결: '+(ops.external_api_enabled ? '실제 Gemini API 사용 설정' : '미연결 — 실제 판독 준비 필요');
    }
    if (aiModel) {
      // Only live Gemini reports models (the ones GAS uses); off, mock and an older GAS show no line.
      const gemini = ops.integrations?.gemini;
      aiModel.textContent = gemini?.model ? geminiModelLine(gemini.model, gemini.fallback_model) : '';
      aiModel.hidden = !aiModel.textContent;
    }

    if (storageEl) {
      const storageMode = ops.integrations?.storage?.mode;
      storageEl.textContent = '저장소: '+({gas:'Google Apps Script / Sheets / Drive','local-simulation':'로컬 파일 — Google 저장소 미연결'}[ops.storage_provider]||'상태 확인 필요')+(storageMode?'(STORAGE_MODE='+storageMode+')':'');
    }
  }).catch(() => {
    if (!active()) return;
    if (aiMode) aiMode.textContent = '판독 상태 조회 실패';
    if (storageEl) storageEl.textContent = '저장소 상태 조회 실패';
  });
  await Promise.all([operationsTask, mcpTask]);
}

/* =========================================================
   Global Init & Mobile Menu
   ========================================================= */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('DOMContentLoaded', () => {
    // Mobile menu toggle
    const toggleBtn = byId('menu-toggle');
    const mobileMenu = byId('mobile-nav-menu');
    if (toggleBtn && mobileMenu) {
      toggleBtn.onclick = () => {
        const open = !mobileMenu.hidden;
        mobileMenu.hidden = open;
        toggleBtn.setAttribute('aria-expanded', String(!open));
      };
    }

    // Intercept links for SPA navigation
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (href && href.startsWith('/') && !href.startsWith('//') && !a.hasAttribute('download') && a.target !== '_blank') {
          e.preventDefault();
          navigate(href);
        }
      });
    }

    // History popstate
    window.addEventListener('popstate', () => {
      if(isFormDirty && !confirm('저장되지 않은 변경사항이 있습니다. 이동하시겠습니까?')){
        history.pushState(null,'',lastRenderedUrl);return;
      }
      isFormDirty=false;
      renderRoute().catch(console.error);
    });
  });
}
