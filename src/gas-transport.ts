/**
 * GAS Transport Layer: Google Apps Script web app client (live) & in-memory mock transport (mock)
 */

import crypto from 'node:crypto';
import { setupError, gasHttpError } from './validation';

// Rows of the local mock store, in the GAS sheet column names.
type Row = Record<string, any>;
type MockDb = Record<string, Row[]>;
export type DispatchOptions = { request_id?: string | null; expected_version?: number | null };

// GAS setup messages (Script Properties, Drive folder) are guidance for the operator, not internal failures.
const GAS_SETUP_MESSAGE=/설정(?: 확인)?이 필요합니다|설정이 없습니다|Script Properties를 확인하세요/;

// What a failed web app call met, for the server log only (log.ts errorEvent): which action, how long, and for an
// answer its status, content type, HTML <title> and the start of its visible text. Not enumerable, so it never
// reaches a JSON copy of the error; the screen gets only the message.
export type GasDiagnostic = { action: string; ms: number; status?: number; content_type?: string; title?: string; text?: string };
function withDiagnostic<T extends object>(err: T, diagnostic: GasDiagnostic) {
  Object.defineProperty(err, 'gas', { value: diagnostic, enumerable: false });
  return err;
}
// Google's pages may carry the web app URL, the deployment ID (AKfyc…), the signed-in account's mail and other script.google.com links.
function maskPage(text: string, webAppUrl: string) {
  if (webAppUrl) text = text.split(webAppUrl).join('[주소 가림]');
  return text
    .replace(/(?:https?:)?\/\/[^\s"'<>]+/gi, '[주소 가림]')
    .replace(/\b[\w.-]*script\.google(?:usercontent)?\.com[^\s"'<>]*/gi, '[주소 가림]')
    .replace(/\/macros\/[^\s"'<>]*/g, '[주소 가림]')
    .replace(/AKfyc[\w-]*/g, '[ID 가림]')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[메일 가림]');
}
const decodeEntities = (text: string) => text.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, name) => ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name as string] as string);
const clip = (text: string, length: number) => text.length > length ? text.slice(0, length) + '…' : text;
function answerDiagnostic(action: string, started: number, res: Response, text: string, webAppUrl: string): GasDiagnostic {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
  const visible = decodeEntities(text.replace(/<(script|style|title|head)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return {
    action, ms: Date.now() - started, status: res.status, content_type: res.headers.get('content-type') || '',
    ...(title !== undefined ? { title: clip(maskPage(decodeEntities(title).replace(/\s+/g, ' ').trim(), webAppUrl), 120) } : {}),
    text: clip(maskPage(visible, webAppUrl), 120)
  };
}

export class GasTransport {
  mode: string;
  webAppUrl: string;
  timeoutMs: number;
  mockDb: MockDb;

  constructor(options: { mode?: string; webAppUrl?: string; timeoutMs?: number } = {}) {
    this.mode = options.mode || 'mock';
    if (!['live', 'mock'].includes(this.mode)) throw new Error(`GAS 전송 모드는 live 또는 mock입니다: ${this.mode}`);
    // The web app URL lets anyone call the web app, so it is never logged or echoed.
    this.webAppUrl = options.webAppUrl || '';
    // Longer than the 6-minute Apps Script limit; tests pass a short value.
    this.timeoutMs = options.timeoutMs || 380000;

    // In-memory mock database state for tests and offline loopback execution
    this.mockDb = {
      products: [
        { product_id: 'P-SILVER', product_name: '텀블러 실버', color: '은색', capacity_ml: 500 },
        { product_id: 'P-WHITE', product_name: '텀블러 화이트', color: '흰색', capacity_ml: 500 },
        { product_id: 'P-BLACK', product_name: '텀블러 블랙', color: '검정', capacity_ml: 500 }
      ],
      inspections: [],
      inspection_images: [],
      inspection_updates: [],
      requests: []
    };
  }

  // The current weight: the latest edit's, else the registered one.
  _currentWeight(insp: Row) {
    return 'current_weight_g' in insp ? insp.current_weight_g : insp.initial_weight_g;
  }

  sanitizeFormula(val: unknown) {
    if (typeof val === 'string' && /^[=+\-@]/.test(val)) {
      return "'" + val;
    }
    return val;
  }

  async dispatch(action: string, payload: Row = {}, { request_id = null, expected_version = null }: DispatchOptions = {}): Promise<any> {
    const ALLOWED_ACTIONS = new Set([
      'products.list',
      'home.get',
      'inspections.list',
      'inspections.get',
      'inspections.createBatch',
      'inspections.update',
      'connection.status',
      'setup.resources',
      'init.configure',
      'photos.store',
      'photos.get'
    ]);

    if (!ALLOWED_ACTIONS.has(action)) {
      throw new Error(`허용되지 않은 GAS 요청(action)입니다: ${action}`);
    }

    const reqId = request_id || crypto.randomUUID();

    // Both paths map GAS error codes to HTTP status the same way.
    try {
      if (this.mode === 'live') {
        return await this._callWebApp(action, payload, reqId, expected_version);
      }
      return await this._callMockDispatch(action, payload, reqId, expected_version);
    } catch (err) {
      throw gasHttpError(err);
    }
  }

  async _callWebApp(action: string, payload: Row, requestId: string, expectedVersion: number | null) {
    if (!this.webAppUrl) {
      throw setupError('GAS 웹앱 주소(GAS_WEBAPP_URL)가 설정되지 않았습니다.', 'GAS_NOT_CONFIGURED');
    }
    const body = JSON.stringify({
      schema_version: 1,
      action,
      request_id: requestId,
      expected_version: expectedVersion,
      payload
    });

    let res, text;
    const started = Date.now();
    try {
      // Google answers the POST with a 302 to the result; the default redirect: 'follow' fetches it with GET.
      res = await fetch(this.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      text = await res.text();
    } catch (e: any) {
      const diagnostic = { action, ms: Date.now() - started };
      if (e?.name === 'TimeoutError') throw withDiagnostic(setupError('Google Apps Script 응답 시간이 초과되었습니다. 처리 결과를 확인한 뒤 다시 시도하세요.', 'GAS_TIMEOUT', e), diagnostic);
      throw withDiagnostic(setupError('Google Apps Script에 연결하지 못했습니다. 네트워크 연결을 확인하세요.', 'GAS_UNREACHABLE', e), diagnostic);
    }

    // The URL carries the deployment ID, so no message includes it.
    if (!res.ok) {
      const diagnostic = answerDiagnostic(action, started, res, text, this.webAppUrl);
      // Before the first authorization (or with the wrong access setting) Google refuses the call with 403.
      if (res.status === 403) throw withDiagnostic(setupError("GAS 웹앱이 요청을 거절했습니다(HTTP 403). 배포한 계정으로 웹앱 주소를 한 번 열어 권한을 승인했는지(npm.cmd run gas:open, macOS: npm run gas:open), 웹앱 액세스가 '모든 사용자'인지 확인하세요.", 'GAS_HTTP_403'), diagnostic);
      throw withDiagnostic(setupError(`GAS 웹앱 HTTP 오류 (${res.status}). 웹앱 배포 주소와 접근 설정을 확인하세요.`, 'GAS_HTTP_' + res.status), diagnostic);
    }

    // An HTML page here means the request never reached doPost's JSON answer (authorization, access setting, platform error).
    let data;
    try {
      if (!/json/i.test(res.headers.get('content-type') || '')) throw new Error('not json');
      data = JSON.parse(text);
    } catch {
      throw withDiagnostic(setupError("GAS 웹앱이 JSON이 아닌 응답을 돌려줬습니다. 웹앱 주소를 브라우저에서 한 번 열어 허용하세요(npm.cmd run gas:open, macOS: npm run gas:open). 안 되면 npm.cmd run gas:editor(macOS: npm run gas:editor)로 편집기를 열고 setupTumblerResources를 한 번 실행하세요.", 'GAS_NOT_JSON'), answerDiagnostic(action, started, res, text, this.webAppUrl));
    }

    if (!data || data.success !== true) {
      const message = data?.error?.message || 'GAS 실행 실패';
      const err = Object.assign(new Error(message), { code: data?.error?.code || 'UPSTREAM_FAILED' });
      const mapped = gasHttpError(err);
      if (mapped !== err) throw mapped;
      // Fallback for setup wording that arrives without a mapped code (older GAS or a wrapped failure).
      throw GAS_SETUP_MESSAGE.test(message) ? setupError(message, err.code) : err;
    }

    return data.result;
  }

  async _callMockDispatch(action: string, payload: Row, requestId: string, expectedVersion: number | null) {
    // Formula injection check on string values
    this._checkFormulaInjection(payload);

    // Idempotency check
    if (requestId && this._isMutating(action)) {
      const cached = this.mockDb.requests.find(r => r.request_id === requestId);
      if (cached) {
        const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        if (cached.payload_hash && cached.payload_hash !== payloadHash) {
          const err: any = new Error('동일한 요청 ID에 서로 다른 내용이 제출되었습니다.');
          err.code = 'CONFLICT';
          throw err;
        }
        return cached.result;
      }
    }

    let result: any;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');

    switch (action) {
      case 'init.resources':
        result = { status: 'INITIALIZED', spreadsheet_id: 'mock-spreadsheet-id' };
        break;

      case 'products.list':
        result = [...this.mockDb.products];
        break;

      case 'home.get': {
        let date = payload.date;
        if (!date) {
          const dates = this.mockDb.inspections
            .map(i => ((i.current_inspected_at || i.initial_inspected_at || i.inspected_at) || '').slice(0, 10))
            .filter(Boolean)
            .sort();
          date = dates[dates.length - 1] || '2026-10-01';
        }
        const dayInsps = this.mockDb.inspections.filter(i => ((i.current_inspected_at || i.initial_inspected_at || i.inspected_at) || '').startsWith(date));
        let ng = 0, hold = 0;
        // Report review starts with the AI reading, so nothing waits for review yet.
        const pending = 0;

        for (const i of dayInsps) {
          const dec = 'current_decision' in i ? i.current_decision : i.initial_decision;
          if (dec === 'NG') ng++;
          if (dec === 'HOLD') hold++;
        }

        result = {
          latest_date: date,
          date,
          metrics: {
            total: dayInsps.length,
            ng,
            hold,
            pending
          },
          scope: '교육용; 출하 승인 아님'
        };
        break;
      }

      case 'inspections.createBatch': {
        const items = Array.isArray(payload.items) ? payload.items : [payload];
        if (items.length === 0) {
          const err: any = new Error('등록할 검사 항목이 없습니다.');
          err.code = 'VALIDATION';
          throw err;
        }

        const created: Row[] = [];
        for (let idx = 0; idx < items.length; idx++) {
          const item = items[idx];
          const randomSuffix = crypto.randomBytes(2).toString('hex').toUpperCase();
          const inspectionId = item.inspection_id || `INSP-${dateStr}-${randomSuffix}${items.length > 1 ? ('-' + (idx + 1)) : ''}`;

          const weightG = item.weight_g !== undefined && item.weight_g !== null && item.weight_g !== '' ? Number(item.weight_g) : null;
          const initialDecision = item.decision !== undefined && item.decision !== '' ? item.decision : null;
          const inspectedAt = item.inspected_at || now.toISOString();
          const productId = item.product_id || 'P-SILVER';
          const insp = {
            inspection_id: inspectionId,
            product_id: productId,
            initial_product_id: productId,
            current_product_id: productId,
            inspected_at: inspectedAt,
            initial_inspected_at: inspectedAt,
            current_inspected_at: inspectedAt,
            initial_weight_g: weightG,
            current_weight_g: weightG,
            initial_decision: initialDecision,
            current_decision: initialDecision,
            memo: item.memo || '',
            content_version: 0,
            created_at: now.toISOString()
          };
          this.mockDb.inspections.push(insp);

          const images = Array.isArray(item.images) ? item.images : (item.images ? [item.images] : []);
          for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
            const img = images[imgIdx];
            const imgUrl = typeof img === 'string' ? img : (img.url || `/media/IMG-${inspectionId}-${imgIdx + 1}.jpg`);
            this.mockDb.inspection_images.push({
              image_id: `IMG-${inspectionId}-${imgIdx + 1}`,
              inspection_id: inspectionId,
              image_url: imgUrl,
              drive_file_id: `drive-${inspectionId}-${imgIdx + 1}`,
              sha256: typeof img === 'object' ? img.sha256 : '',
              active: 1,
              created_at: now.toISOString()
            });
          }

          created.push({
            inspection_id: inspectionId,
            product_id: insp.product_id,
            inspected_at: insp.inspected_at,
            weight_g: weightG,
            decision: insp.initial_decision,
            content_version: 0,
            images_count: images.length
          });
        }

        result = {
          created_count: created.length,
          count: created.length,
          inspections: created
        };
        break;
      }

      case 'inspections.list': {
        let list = this.mockDb.inspections.map(i => {
          const prodId = i.current_product_id || i.initial_product_id || i.product_id;
          const inspectedAt = i.current_inspected_at || i.initial_inspected_at || i.inspected_at;
          const prod = this.mockDb.products.find(p => p.product_id === prodId) || { product_name: '텀블러', color: '은색' };
          const imgs = this.mockDb.inspection_images.filter(img => img.inspection_id === i.inspection_id && img.active);
          const currentWeight = this._currentWeight(i);
          const currentDecision = 'current_decision' in i ? i.current_decision : i.initial_decision;

          return {
            inspection_id: i.inspection_id,
            product_id: prodId,
            product_name: prod.product_name,
            color: prod.color,
            inspected_at: inspectedAt,
            weight_g: currentWeight,
            decision: currentDecision,
            content_version: i.content_version,
            image_url: imgs[0]?.image_url || '/media/sample.jpg',
            images_count: imgs.length,
            is_pending: false
          };
        });

        if (payload.date) {
          list = list.filter(i => (i.inspected_at || '').startsWith(payload.date));
        }
        if (payload.decision) {
          if (payload.decision === 'UNJUDGED' || payload.decision === 'null') {
            list = list.filter(i => i.decision === null || i.decision === undefined || i.decision === '');
          } else {
            list = list.filter(i => i.decision === payload.decision);
          }
        }
        if (payload.review === 'pending') {
          list = list.filter(i => i.is_pending);
        }
        if (payload.search) {
          const q = payload.search.toLowerCase();
          list = list.filter(i =>
            i.inspection_id.toLowerCase().includes(q) ||
            i.product_name.toLowerCase().includes(q) ||
            i.color.toLowerCase().includes(q)
          );
        }

        list.sort((a, b) => String(b.inspected_at).localeCompare(String(a.inspected_at)));

        const page = Math.max(1, Number(payload.page) || 1);
        const pageSize = Math.max(1, Number(payload.pageSize) || 12);
        const total = list.length;
        const start = (page - 1) * pageSize;

        result = {
          items: list.slice(start, start + pageSize),
          totalCount: total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize) || 1
        };
        break;
      }

      case 'inspections.get': {
        const id = payload.id;
        const insp = this.mockDb.inspections.find(i => i.inspection_id === id);
        if (!insp) {
          const err: any = new Error(`검사 기록(${id})이 없습니다.`);
          err.code = 'NOT_FOUND';
          throw err;
        }
        // The current product (after an edit), as the list uses.
        const prod = this.mockDb.products.find(p => p.product_id === (insp.current_product_id || insp.initial_product_id || insp.product_id)) || { product_name: '텀블러', color: '은색' };
        const imgs = this.mockDb.inspection_images.filter(img => img.inspection_id === id && img.active);

        result = {
          inspection_id: insp.inspection_id,
          product_id: insp.current_product_id || insp.initial_product_id || insp.product_id,
          product_name: prod.product_name,
          color: prod.color,
          inspected_at: insp.current_inspected_at || insp.initial_inspected_at || insp.inspected_at,
          weight_g: this._currentWeight(insp),
          decision: 'current_decision' in insp ? insp.current_decision : insp.initial_decision,
          memo: 'current_memo' in insp ? insp.current_memo : (insp.memo || ''),
          content_version: insp.content_version,
          original: {
            inspection_id: insp.inspection_id,
            product_id: insp.initial_product_id || insp.product_id,
            inspected_at: insp.initial_inspected_at || insp.inspected_at,
            weight_g: insp.initial_weight_g,
            decision: insp.initial_decision
          },
          images: imgs.map(img => ({
            image_id: img.image_id,
            image_url: img.image_url,
            drive_file_id: img.drive_file_id
          })),
          defects: [],
          created_at: insp.created_at
        };
        break;
      }

      case 'inspections.update': {
        const id = payload.id || payload.inspection_id;
        const insp = this.mockDb.inspections.find(i => i.inspection_id === id);
        if (!insp) {
          const err: any = new Error('검사 기록이 없습니다.');
          err.code = 'NOT_FOUND';
          throw err;
        }

        if (expectedVersion !== null && expectedVersion !== undefined && Number(expectedVersion) !== insp.content_version) {
          const err: any = new Error('자료가 이미 변경되었습니다. 최신 화면을 확인 후 다시 시도하세요.');
          err.code = 'CONFLICT';
          throw err;
        }

        this.mockDb.inspection_updates.push({
          inspection_id: id,
          previous_version: insp.content_version,
          updated_at: now.toISOString(),
          changes: { ...payload }
        });

        if (payload.product_id) insp.current_product_id = payload.product_id;
        if (payload.inspected_at) insp.current_inspected_at = payload.inspected_at;
        // Every edit records its memo, an empty one when none is sent, as GAS updateLiveInspection does.
        insp.current_memo = payload.memo || '';
        if (payload.weight_g !== undefined) {
          insp.current_weight_g = payload.weight_g !== null && payload.weight_g !== '' ? Number(payload.weight_g) : null;
        }
        if (payload.decision !== undefined) {
          insp.current_decision = payload.decision !== '' ? payload.decision : null;
        }
        insp.content_version++;

        const currentWeight = ('current_weight_g' in insp) ? insp.current_weight_g : insp.initial_weight_g;
        const currentDecision = ('current_decision' in insp) ? insp.current_decision : insp.initial_decision;

        result = {
          inspection_id: insp.inspection_id,
          product_id: insp.current_product_id || insp.initial_product_id || insp.product_id,
          inspected_at: insp.current_inspected_at || insp.initial_inspected_at || insp.inspected_at,
          weight_g: currentWeight,
          decision: currentDecision,
          content_version: insp.content_version
        };
        break;
      }

      default:
        throw new Error(`지원되지 않는 mock action입니다: ${action}`);
    }

    if (requestId && this._isMutating(action)) {
      this.mockDb.requests.push({
        request_id: requestId,
        action,
        payload_hash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
        status: 'COMPLETED',
        result
      });
    }

    return result;
  }

  _isMutating(action: string) {
    return [
      'inspections.createBatch',
      'inspections.update',
      'init.resources'
    ].includes(action);
  }

  _checkFormulaInjection(val: unknown): void {
    if (!val) return;
    if (typeof val === 'string') {
      if (/^[=+\-@\t\r]/.test(val)) {
        // Formula injection detected: in GAS sanitize() handles this by prepending single quote
      }
    } else if (typeof val === 'object') {
      for (const k of Object.keys(val)) {
        this._checkFormulaInjection((val as Row)[k]);
      }
    }
  }
}
