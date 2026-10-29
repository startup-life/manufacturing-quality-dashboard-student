import { api, el, resetWorkspace, renderRoute, navigate } from './app.js';
import { initializeHome, clearHome } from './home.js';

let user = null;
const auth = document.getElementById('auth-panel');
const primaryNav = document.getElementById('primary-navigation');
const headerActions = document.getElementById('header-actions');
const userInfo = document.getElementById('user-info');
const logoutBtn = document.getElementById('logout-btn');

export function getCurrentUser() {
  return user;
}

export async function checkSession() {
  const pending = document.getElementById('session-loading');
  const content = document.getElementById('content-container');
  if (pending) pending.hidden = false;
  if (content) content.hidden = true;
  try {
    const state = await api('/api/session');
    window.csrfToken = state.csrfToken;
    user = state.user;
  } catch (_) {
    if (pending) {
      pending.replaceChildren(el('p', '로그인 상태를 확인하지 못했습니다.', 'error'));
      const retry = el('button', '다시 확인');
      retry.onclick = () => checkSession();
      pending.append(retry);
    }
    return;
  }
  if (pending) pending.hidden = true;
  if (content) content.hidden = !user;

  if (user) {
    document.body.classList.remove('unauthenticated');
    document.body.classList.add('authenticated');
    if (primaryNav) primaryNav.hidden = false;
    if (headerActions) headerActions.hidden = false;
    if (userInfo) userInfo.textContent = `${user.username} (${user.role === 'writer' ? '작성자' : user.role === 'reviewer' ? '검토자' : '품질관리'})`;
    if (auth) auth.hidden = true;
  } else {
    document.body.classList.add('unauthenticated');
    document.body.classList.remove('authenticated');
    if (primaryNav) primaryNav.hidden = true;
    if (headerActions) headerActions.hidden = true;
    if (auth) auth.hidden = false;
    drawLoginForm();
  }

  resetWorkspace(!!user);

  if (user) {
    initializeHome(user, { load: false });
    await renderRoute();
  } else {
    clearHome();
    await renderRoute();
  }
}

function drawLoginForm() {
  if (!auth) return;
  auth.replaceChildren();

  const card = el('div', undefined, 'panel auth-card');
  const header = el('div', undefined, 'login-header');
  const brandTitle = el('div', '텀블러 공장', 'login-brand');
  brandTitle.append(el('span', '제조품질관리 시스템'));
  const desc = el('p', '로그인 후 검사 접수 및 품질 관리를 진행하세요.', 'login-desc');
  header.append(brandTitle, desc);

  const form = el('form', undefined, 'auth-form');

  const nameLabel = el('label', '작업자 계정');
  const nameInput = el('input');
  nameInput.name = 'username';
  nameInput.type = 'text';
  nameInput.required = true;
  nameInput.autocomplete = 'username';
  nameInput.value = 'writer';
  nameLabel.append(nameInput);

  const pwLabel = el('label', '비밀번호');
  const pwInput = el('input');
  pwInput.name = 'password';
  pwInput.type = 'password';
  pwInput.required = true;
  pwInput.autocomplete = 'current-password';
  pwInput.value = 'writer1234!';
  pwLabel.append(pwInput);

  const submitBtn = el('button', '로그인', 'btn-action primary btn-lg');
  submitBtn.type = 'submit';

  const message = el('p', '', 'auth-message');
  message.setAttribute('role', 'status');

  const hint = el('div', undefined, 'auth-hint');
  // The classroom accounts (src/security.ts). The third one, factory-user, is not listed.
  hint.innerHTML = '<strong>교육용 계정:</strong><br>작성자: <code>writer</code> / <code>writer1234!</code><br>검토자: <code>reviewer</code> / <code>reviewer1234!</code>';

  form.append(nameLabel, pwLabel, submitBtn);
  card.append(header, form, message, hint);
  auth.append(card);

  form.onsubmit = async (e) => {
    e.preventDefault();
    message.className = 'auth-message muted';
    message.textContent = '로그인 정보를 확인하는 중입니다...';
    submitBtn.disabled = true;

    try {
      const res = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({
          username: nameInput.value.trim(),
          password: pwInput.value
        })
      });
      window.csrfToken = res.csrfToken;
      message.className = 'auth-message success';
      message.textContent = '로그인 성공! 화면을 준비합니다.';
      await checkSession();
    } catch (err) {
      message.className = 'auth-message error';
      message.textContent = '로그인 실패: ' + (err.message || '아이디 또는 비밀번호가 올바르지 않습니다.');
    } finally {
      submitBtn.disabled = false;
    }
  };
}

if (logoutBtn) {
  logoutBtn.onclick = async () => {
    try {
      await api('/api/logout', { method: 'POST', body: '{}' });
    } catch (_) {}
    user = null;
    navigate('/');
    await checkSession();
  };
}

// Check session on startup
checkSession().catch(console.error);
