import session from 'express-session';
import crypto from 'node:crypto';
import helmet from 'helmet';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { InputError } from './validation';

export type SessionUser = { id: number; username: string; role: string };
declare module 'express-session' {
  interface SessionData { user?: SessionUser; csrf?: string }
}
// The three classroom accounts. They are fixed training logins on a local server, not access control:
// the login card shows the writer and reviewer passwords. Records keep the id (public/app.js names it again).
export const ACCOUNTS: Record<string, { id: number; role: string; password: string }> = {
  writer: { id: 1, role: 'writer', password: 'writer1234!' },
  reviewer: { id: 2, role: 'reviewer', password: 'reviewer1234!' },
  'factory-user': { id: 3, role: 'factory-user', password: 'factory1234!' }
};

// After a logout or a restart in another tab the open page still shows; a reload brings the login screen back.
const LOGIN_REQUIRED = '로그인이 필요합니다. 페이지를 새로고침한 뒤 다시 로그인하세요.';
export const requireLogin: RequestHandler = (req, res, next) => req.session.user ? next() : next(new InputError(LOGIN_REQUIRED, 401));
// Both legacy account labels and factory-user have full factory permissions (factory-user.guard.ts).
export const FACTORY_ROLES = ['writer', 'reviewer', 'factory-user'];
// The page may be opened as 127.0.0.1 or localhost, on the configured port or the port this server listens on.
const loopbackOrigins = (origin: string) => { let u; try { u = new URL(origin); } catch { return []; } if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(u.hostname)) return []; return ['127.0.0.1', 'localhost'].map(h => 'http://' + h + (u.port ? ':' + u.port : '')); };
export function allowedOrigins({ configured = process.env.APP_ORIGIN || 'http://127.0.0.1:4185', localPort }: { configured?: string; localPort?: number } = {}) {
  return [...new Set([configured, ...loopbackOrigins(configured), ...(localPort ? loopbackOrigins('http://127.0.0.1:' + localPort) : [])])];
}
// No secret is written in code: without a 32+ character SESSION_SECRET each process makes its own.
let processSecret: string | null = null;
export function resolveSessionSecret(value = process.env.SESSION_SECRET) {
  if (value && value.length >= 32) return value;
  if (!processSecret) { processSecret = crypto.randomBytes(32).toString('hex'); console.warn('SESSION_SECRET이 없거나 32자 미만이라 이 프로세스에서만 쓰는 임의 값을 만들었습니다. 서버를 다시 시작하면 로그인이 풀립니다.'); }
  return processSecret;
}

const SESSION_MAX_AGE = 3600000;
// Sessions a logout or a login (regenerate) ended, with when. A request sent before that (a photo, the home figures on
// a slow GAS) still holds the old session and, with rolling, answers with its cookie. Arriving after the new session's
// cookie it would replace it, and the login form's token would then fail the CSRF check on every try until a reload.
const endedSessions = new Map<string, number>();
export function endSession(sessionID: string) {
  const now = Date.now();
  for (const [id, at] of endedSessions) if (now - at > SESSION_MAX_AGE) endedSessions.delete(id);
  endedSessions.set(sessionID, now);
}
// Registered before express-session, so this runs after it has set the cookie: an ended session's cookie is dropped.
// The logout's own clearing cookie (qc.sid= with no value) stays.
function dropEndedSessionCookie(req: Request, res: Response, next: NextFunction) {
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...args: any[]) {
    if (req.sessionID && endedSessions.has(req.sessionID)) {
      const cookies = ([] as unknown[]).concat(res.getHeader('Set-Cookie') ?? []).map(String);
      const kept = cookies.filter(c => !/^qc\.sid=[^;]/.test(c));
      if (kept.length !== cookies.length) { if (kept.length) res.setHeader('Set-Cookie', kept); else res.removeHeader('Set-Cookie'); }
    }
    return (writeHead as any).apply(this, args);
  } as any;
  next();
}

// The session, login and logout routes (session.controller.ts) work without a login; every other /api path,
// a route or not, needs one, so an unknown path answers 401 before 404. Express matches paths without case or a trailing slash.
const OPEN_ROUTES: Record<string, string[]> = { GET: ['/session'], HEAD: ['/session'], POST: ['/login', '/logout'] };
const openRoute = (req: Request) => (OPEN_ROUTES[req.method] || []).includes(req.path.toLowerCase().replace(/\/$/, ''));

function csrfCheck(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Without a login a write can do nothing, so say that first; login and logout keep their own checks below.
  if (!req.session.user && !['/login', '/logout'].includes(req.path)) return next(new InputError(LOGIN_REQUIRED, 401));
  const supplied = req.get('X-CSRF-Token') || '', expected = req.session.csrf || '';
  // A token from before a login in another tab no longer matches the session.
  if (!/^[a-f0-9]{64}$/.test(supplied) || !expected || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return next(new InputError('보안 확인 값이 바뀌었습니다. 페이지를 새로고침한 뒤 다시 시도하세요.', 403));
  if (req.get('Origin') && !allowedOrigins({ localPort: req.socket.localPort }).includes(req.get('Origin') as string)) return next(new InputError('허용되지 않은 요청 출처', 403));
  next();
}

// Local server only (127.0.0.1 over http): no production branch, no request-rate limits.
// Express middleware in the original order; Nest's routes come after all of it.
export function security(app: NestExpressApplication) {
  const sessionSecret = resolveSessionSecret();
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'"], upgradeInsecureRequests: null } } }));
  app.use(dropEndedSessionCookie);
  app.use(session({ name: 'qc.sid', secret: sessionSecret, store: new session.MemoryStore(), resave: false, saveUninitialized: false, rolling: true, cookie: { httpOnly: true, sameSite: 'strict', maxAge: SESSION_MAX_AGE } }));
  app.use('/api', (req: Request, res: Response, next: NextFunction) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', csrfCheck);
  app.use('/api', (req: Request, res: Response, next: NextFunction) => openRoute(req) ? next() : requireLogin(req, res, next));
}
