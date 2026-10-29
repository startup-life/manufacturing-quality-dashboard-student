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
  const links = document.querySelectorAll('nav a, .mobile-nav-menu a');
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
          currentStep = 1;
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

    renderDetailView(detail, id, insp);
    if (typeof window !== 'undefined' && window.dispatchEvent && typeof CustomEvent !== 'undefined') {
      try { window.dispatchEvent(new CustomEvent('inspection-selected', { detail: insp })); } catch (_) {}
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

function renderDetailView(host, id, insp) {
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
  // Tabs 2-4 are built in later steps (29, 41, 52).
  pane2.append(el('p', '이 탭은 4회차에서 만듭니다.', 'muted'));
  pane3.append(el('p', '이 탭은 5회차에서 만듭니다.', 'muted'));
  pane4.append(el('p', '이 탭은 6회차에서 만듭니다.', 'muted'));

  host.append(pane1, pane2, pane3, pane4);

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
  const storageEl = byId('settings-storage-provider');

  if (storageEl) storageEl.textContent = '연결 상태 조회 중…';
  try {
    const ops = await api('/api/operations');
    if (!active() || !storageEl) return;
    const storageMode = ops.integrations?.storage?.mode;
    storageEl.textContent = '저장소: '+({live:'Google Apps Script / Sheets / Drive',mock:'로컬 파일 — Google 저장소 미연결'}[storageMode]||'상태 확인 필요')+(storageMode?'(STORAGE_MODE='+storageMode+')':'');
  } catch (_) {
    if (active() && storageEl) storageEl.textContent = '저장소 상태 조회 실패';
  }
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
