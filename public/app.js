const byId = id => document.getElementById(id);

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(window.csrfToken ? { 'X-CSRF-Token': window.csrfToken } : {}),
    ...options?.headers
  };
  const r = await fetch(path, { ...options, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
  return data;
}

export function el(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = text;
  if (className) n.className = className;
  return n;
}

let workspaceActive = true;
let isFormDirty = false;
let lastRenderedUrl = '/';

export function setFormDirty(dirty) {
  isFormDirty = dirty;
}

// Asks before leaving unsaved changes; true when the move may go ahead.
function confirmLeave() {
  if (!isFormDirty) return true;
  if (!confirm('저장되지 않은 변경사항이 있습니다. 이동하시겠습니까?')) return false;
  isFormDirty = false;
  return true;
}

window.addEventListener('beforeunload', (e) => {
  if (isFormDirty) {
    e.preventDefault();
    e.returnValue = '저장되지 않은 변경사항이 있습니다. 페이지를 벗어나시겠습니까?';
    return e.returnValue;
  }
});

export function resetWorkspace(active = false) {
  workspaceActive = active;
  isFormDirty = false;
}

/* =========================================================
   Router & Navigation
   ========================================================= */
export function parseRoute() {
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
  for (const a of document.querySelectorAll('nav a, .mobile-nav-menu a')) {
    const href = a.getAttribute('data-path') || a.getAttribute('href');
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
  if (!confirmLeave()) return;
  history.pushState(null, '', url);
  renderRoute().catch(console.error);
}

// The screen panels, by route view. Only the panel of the current view is shown.
const PANELS = { home: 'home-panel', register: 'register-panel', detail: 'detail', settings: 'settings-panel', 'not-found': 'not-found-panel' };

export async function renderRoute() {
  if (!workspaceActive) return;
  const route = parseRoute();
  if (route.redirect) history.replaceState(null, '', route.redirect);
  lastRenderedUrl = window.location.pathname + (window.location.search || '');
  updateNav(route.view);

  // Hide mobile menu
  const mobileMenu = byId('mobile-nav-menu');
  if (mobileMenu) mobileMenu.hidden = true;
  const toggleBtn = byId('menu-toggle');
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');

  for (const [view, id] of Object.entries(PANELS)) {
    const panel = byId(id);
    if (panel) panel.hidden = view !== route.view;
  }
}

/* =========================================================
   Global Init & Mobile Menu
   ========================================================= */
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
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href && href.startsWith('/') && !href.startsWith('//') && !a.hasAttribute('download') && a.target !== '_blank') {
      e.preventDefault();
      navigate(href);
    }
  });

  // History popstate
  window.addEventListener('popstate', () => {
    if (!confirmLeave()) {
      history.pushState(null, '', lastRenderedUrl);
      return;
    }
    renderRoute().catch(console.error);
  });
});
