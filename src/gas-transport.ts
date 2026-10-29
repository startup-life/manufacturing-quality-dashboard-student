/**
 * GAS Transport Layer: Google Apps Script web app client (live) & in-memory mock transport (mock)
 */

import crypto from 'node:crypto';
import { promptDefaults } from './prompts';
import { setupError, gasHttpError } from './validation';
import { repositoryStandard } from './reports';

// Rows of the local mock store, in the GAS sheet column names.
type Row = Record<string, any>;
type MockDb = Record<string, Row[]>;
export type DispatchOptions = { request_id?: string | null; expected_version?: number | null };

// GAS setup messages (Script Properties, Drive folder, Gemini key) are guidance for the operator, not internal failures.
// Source-check statuses (evidence.save status) the 3번 탭 saves, as src/evidence.controller.ts names them.
const REVIEW_NEEDED_STATUSES = ['REVIEW_NEEDED_BY_USER', 'MOCK_REVIEW_NEEDED'];
const REVIEWED_STATUSES = ['VERIFIED_BY_USER', 'MOCK_USER_REVIEWED', 'VERIFIED'];
// 다시 판독 필요(stale): the product, weight or photos the AI saw differ from the inspection now. Same as gas/Code.gs.
function draftOutdated(seen: Row, now: Row) {
  const weight = (w: unknown) => w === null || w === undefined || w === '' ? null : Number(w);
  const photos = (list: Row[] | undefined) => (list || []).map(i => String(i.image_id)).sort().join(',');
  return seen.product_id !== now.product_id || weight(seen.weight_g) !== weight(now.weight_g) || photos(seen.images) !== photos(now.images);
}
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
      prompt_versions: structuredClone(promptDefaults),
      products: [
        { product_id: 'P-SILVER', product_name: '텀블러 실버', color: '은색', capacity_ml: 500 },
        { product_id: 'P-WHITE', product_name: '텀블러 화이트', color: '흰색', capacity_ml: 500 },
        { product_id: 'P-BLACK', product_name: '텀블러 블랙', color: '검정', capacity_ml: 500 }
      ],
      inspections: [],
      inspection_images: [],
      defect_codes: [
        { defect_code: 'D01', defect_name: '스크래치', severity: '경미' },
        { defect_code: 'D02', defect_name: '찍힘', severity: '중대' },
        { defect_code: 'D03', defect_name: '라벨 오류', severity: '치명' },
        { defect_code: 'D04', defect_name: '뚜껑 조립 오류', severity: '중대' }
      ],
      inspection_defects: [],
      inspection_records: [],
      inspection_record_defects: [],
      inspection_updates: [],
      // Not read: standards.get serves the repository files. Saved local state files still carry this old placeholder copy.
      standards: [
        { standard_id: 'STD-01', revision: 'Rev.A', standard_text: '텀블러 품질 기준 Rev.A', sha256: 'a1b2c3d4' },
        { standard_id: 'STD-02', revision: 'Rev.B', standard_text: '텀블러 품질 기준 Rev.B', sha256: 'b2c3d4e5' }
      ],
      ai_runs: [],
      ai_drafts: [],
      review_events: [],
      evidence_links: [],
      evidence_queries: [],
      requests: []
    };
  }

  // The current weight, as GAS handleInspectionsGet decides it: the latest judgment's unless an edit came after it
  // (an edit's version is the version before it plus 1), else the latest edit's, else the registered one.
  _currentWeight(insp: Row, latestRec: Row | undefined) {
    const updates = this.mockDb.inspection_updates.filter(u => u.inspection_id === insp.inspection_id);
    const update = updates[updates.length - 1];
    const updateVersion = update ? update.previous_version + 1 : -1;
    if (latestRec && latestRec.content_version >= updateVersion) return latestRec.weight_g;
    return 'current_weight_g' in insp ? insp.current_weight_g : insp.initial_weight_g;
  }

  // The product, weight and photos of an inspection now: what a draft records, and what draftOutdated compares.
  _aiInput(insp: Row) {
    const recs = this.mockDb.inspection_records.filter(r => r.inspection_id === insp.inspection_id);
    return {
      product_id: insp.current_product_id || insp.initial_product_id || insp.product_id,
      weight_g: this._currentWeight(insp, recs[recs.length - 1]),
      images: this.mockDb.inspection_images.filter(img => img.inspection_id === insp.inspection_id && img.active).map(img => ({ image_id: img.image_id }))
    };
  }

  // Report review state of an inspection's latest draft, the same rule as GAS reviewState (gas/Code.gs): the 3번 탭
  // source check (evidence.save) saved for that draft is the review, and a judgment saved after it keeps it.
  _reviewState(insp: Row) {
    const drafts = this.mockDb.ai_drafts.filter(d => d.inspection_id === insp.inspection_id);
    const draft = drafts[drafts.length - 1];
    if (!draft) return { review_state: 'no_draft', is_pending: false };
    if (draftOutdated(draft, this._aiInput(insp))) return { review_state: 'stale', is_pending: true };
    const checks = this.mockDb.evidence_links.filter(l => String(l.draft_id) === String(draft.draft_id) && String(l.inspection_id) === String(insp.inspection_id) &&
      (REVIEW_NEEDED_STATUSES.includes(l.status) || REVIEWED_STATUSES.includes(l.status)));
    const last = checks[checks.length - 1];
    if (!last) return { review_state: 'pending', is_pending: true };
    if (REVIEW_NEEDED_STATUSES.includes(last.status)) return { review_state: 'needs_check', is_pending: true };
    return { review_state: 'reviewed', is_pending: false };
  }

  sanitizeFormula(val: unknown) {
    if (typeof val === 'string' && /^[=+\-@]/.test(val)) {
      return "'" + val;
    }
    return val;
  }

  async dispatch(action: string, payload: Row = {}, { request_id = null, expected_version = null }: DispatchOptions = {}): Promise<any> {
    const ALLOWED_ACTIONS = new Set([
      'prompts.list','prompts.save','prompts.seed',
      'products.list',
      'home.get',
      'inspections.list',
      'inspections.get',
      'inspections.history',
      'inspections.saveRecord',
      'inspections.createBatch',
      'inspections.update',
      'standards.get',
      'connection.status',
      'setup.resources',
      'init.configure',
      'photos.store',
      'photos.get',
      'ai.runQueue',
      'ai.execute',
      'ai.runs',
      'evidence.save',
      'evidence.queries.save',
      'evidence.queries.list',
      'drafts.get',
      'drafts.reviews.list',
      'drafts.evidence.list'
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
      case 'prompts.list':
        result=(this.mockDb.prompt_versions||[]).filter(p=>!payload.kind||p.kind===payload.kind);break;
      case 'prompts.save': {
        this.mockDb.prompt_versions??=[];
        const old=this.mockDb.prompt_versions.find(p=>p.prompt_version_id===payload.prompt_version_id);
        if(old && old.sha256!==payload.sha256)throw Object.assign(Error('같은 저장 번호의 내용이 다릅니다.'),{code:'CONFLICT'});
        result=old||{...payload,created_at:now.toISOString()};
        if(!old)this.mockDb.prompt_versions.push(result);break;
      }
      case 'prompts.seed':
        this.mockDb.prompt_versions??=[];
        for(const row of payload.versions||[])if(!this.mockDb.prompt_versions.some(p=>p.prompt_version_id===row.prompt_version_id))this.mockDb.prompt_versions.push({...row,created_at:now.toISOString()});
        result={count:this.mockDb.prompt_versions.length};break;
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
        let ng = 0, hold = 0, pending = 0;

        for (const i of dayInsps) {
          const recs = this.mockDb.inspection_records.filter(r => r.inspection_id === i.inspection_id);
          const latest = recs[recs.length - 1];
          const dec = latest ? latest.decision : ('current_decision' in i ? i.current_decision : i.initial_decision);
          if (dec === 'NG') ng++;
          if (dec === 'HOLD') hold++;

          // Waiting for review, by the list's rule (stale, needs_check or no source check yet).
          if (this._reviewState(i).is_pending) pending++;
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
            revision: item.revision || 'Rev.A',
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

          const defects = Array.isArray(item.defects) ? item.defects : [];
          for (const d of defects) {
            const code = typeof d === 'string' ? d : d.defect_code;
            const defCodeObj = this.mockDb.defect_codes.find(c => c.defect_code === code);
            this.mockDb.inspection_defects.push({
              inspection_id: inspectionId,
              defect_code: code,
              defect_name: defCodeObj?.defect_name || (code === 'D01' ? '스크래치' : code === 'D02' ? '찍힘' : code === 'D03' ? '라벨 오류' : '뚜껑 조립 오류'),
              observation_note: '작성자가 등록한 관찰'
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
          const recs = this.mockDb.inspection_records.filter(r => r.inspection_id === i.inspection_id);
          const latestRec = recs[recs.length - 1];
          const imgs = this.mockDb.inspection_images.filter(img => img.inspection_id === i.inspection_id && img.active);
          const drafts = this.mockDb.ai_drafts.filter(d => d.inspection_id === i.inspection_id);
          const latestDraft = drafts[drafts.length - 1];

          const { review_state: reviewState, is_pending: isPending } = this._reviewState(i);

          let aiStatus = '미판독';
          if (latestDraft) {
            if (latestDraft.is_mock) {
              aiStatus = `[모의 초안] ${latestDraft.result?.['판정'] || latestDraft.result?.decision || '완료'}`;
            } else {
              aiStatus = latestDraft.result?.decision ? `AI ${latestDraft.result.decision}` : (latestDraft.result?.['판정'] ? `AI ${latestDraft.result['판정']}` : '판독 완료');
            }
          }

          const currentWeight = this._currentWeight(i, latestRec);
          const currentDecision = latestRec ? latestRec.decision : ('current_decision' in i ? i.current_decision : i.initial_decision);

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
            ai_status: aiStatus,
            review_state: reviewState,
            is_pending: isPending
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
        const recs = this.mockDb.inspection_records.filter(r => r.inspection_id === id);
        const latestRec = recs[recs.length - 1];
        const imgs = this.mockDb.inspection_images.filter(img => img.inspection_id === id && img.active);
        const origDefects = this.mockDb.inspection_defects.filter(d => d.inspection_id === id);

        let currentDefects = origDefects.map(d => {
          const codeObj = this.mockDb.defect_codes.find(c => c.defect_code === d.defect_code);
          return { defect_code: d.defect_code, defect_name: codeObj?.defect_name || d.defect_name };
        });

        if (latestRec) {
          const recDefs = this.mockDb.inspection_record_defects.filter(d => d.record_id === latestRec.record_id);
          currentDefects = recDefs.map(d => {
            const codeObj = this.mockDb.defect_codes.find(c => c.defect_code === d.defect_code);
            return { defect_code: d.defect_code, defect_name: codeObj?.defect_name || d.defect_name || d.defect_code };
          });
        }

        result = {
          inspection_id: insp.inspection_id,
          product_id: insp.current_product_id || insp.initial_product_id || insp.product_id,
          product_name: prod.product_name,
          color: prod.color,
          inspected_at: insp.current_inspected_at || insp.initial_inspected_at || insp.inspected_at,
          weight_g: this._currentWeight(insp, latestRec),
          decision: latestRec ? latestRec.decision : ('current_decision' in insp ? insp.current_decision : insp.initial_decision),
          memo: latestRec ? (latestRec.memo || latestRec.notes || '') : ('current_memo' in insp ? insp.current_memo : (insp.memo || '')),
          revision: insp.revision || null,
          change_reason: latestRec ? (latestRec.change_reason || '') : '',
          current_record_id: latestRec ? latestRec.record_id : null,
          content_version: insp.content_version,
          original: {
            inspection_id: insp.inspection_id,
            product_id: insp.initial_product_id || insp.product_id,
            inspected_at: insp.initial_inspected_at || insp.inspected_at,
            weight_g: insp.initial_weight_g,
            decision: insp.initial_decision,
            defects: origDefects.map(d => ({ defect_code: d.defect_code, defect_name: d.defect_name }))
          },
          images: imgs.map(img => ({
            image_id: img.image_id,
            image_url: img.image_url,
            drive_file_id: img.drive_file_id
          })),
          defects: currentDefects,
          drafts: this.mockDb.ai_drafts.filter(d => d.inspection_id === id).slice().reverse().map(d => ({
            draft_id: d.draft_id,
            run_id: d.run_id,
            inspection_id: d.inspection_id,
            created_at: d.created_at,
            standard_revision: d.standard_revision,
            provider: d.provider || 'mock-offline-fixture',
            model: d.model,
            result: d.result,
            content_version: d.content_version || 0,
            stale: !insp || draftOutdated(d, this._aiInput(insp)),
            is_mock: d.is_mock || false,
            status: d.status || (d.is_mock ? 'MOCK_COMPLETED' : undefined)
          })),
          created_at: insp.created_at
        };
        break;
      }

      case 'inspections.saveRecord': {
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

        const existingRecs = this.mockDb.inspection_records.filter(r => r.inspection_id === id);
        const lastRec = existingRecs[existingRecs.length - 1];
        // Same rule as gas/Code.gs: null means "no record yet", only undefined skips the check.
        if (payload.expected_record_id !== undefined) {
          if ((lastRec?.record_id || null) !== payload.expected_record_id) {
            const err: any = new Error('다른 변경이 저장됐습니다. 최신 검사와 기록을 다시 조회하세요.');
            err.code = 'CONFLICT';
            throw err;
          }
        }

        insp.content_version++;
        const rec = {
          record_id: `REC-${id}-${insp.content_version}`,
          inspection_id: id,
          user_id: payload.user_id || 'factory-user',
          recorded_at: now.toISOString(),
          decision: payload.decision || 'HOLD',
          weight_g: payload.weight_g !== undefined && payload.weight_g !== null && payload.weight_g !== '' ? Number(payload.weight_g) : null,
          memo: payload.memo || payload.notes || '',
          notes: payload.notes || payload.memo || '',
          change_reason: payload.change_reason || '',
          content_version: insp.content_version
        };
        this.mockDb.inspection_records.push(rec);

        insp.current_decision = rec.decision;
        if (payload.weight_g !== undefined) {
          insp.current_weight_g = rec.weight_g;
        }

        const recDefects = Array.isArray(payload.defects) ? payload.defects : [];
        for (const d of recDefects) {
          const code = typeof d === 'string' ? d : d.defect_code;
          const defCodeObj = this.mockDb.defect_codes.find(c => c.defect_code === code);
          this.mockDb.inspection_record_defects.push({
            record_id: rec.record_id,
            defect_code: code,
            defect_name: defCodeObj?.defect_name || code
          });
        }

        result = {
          record_id: rec.record_id,
          content_version: insp.content_version,
          recorded_at: rec.recorded_at
        };
        break;
      }

      case 'inspections.history': {
        const id = payload.id;
        const recs = this.mockDb.inspection_records.filter(r => r.inspection_id === id);
        const resultList = recs.map(r => {
          const recDefs = this.mockDb.inspection_record_defects.filter(d => d.record_id === r.record_id);
          return {
            ...r,
            defects: recDefs.map(d => d.defect_code)
          };
        });
        result = [...resultList].reverse();
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
        // An edit without a memo keeps the current one, as GAS updateLiveInspection does.
        if (payload.memo !== undefined) insp.current_memo = payload.memo || '';
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

      case 'ai.runQueue': {
        const id = payload.inspection_id;
        const insp = this.mockDb.inspections.find(i => i.inspection_id === id);
        if (!insp) {
          const err: any = new Error('검사 기록이 없습니다.');
          err.code = 'NOT_FOUND';
          throw err;
        }

        // Same version check as the deployed queueLiveAi: a draft is made only for the inspection the screen showed.
        if (expectedVersion !== null && expectedVersion !== undefined && expectedVersion !== insp.content_version) {
          const err: any = new Error('검사 자료가 변경됐습니다. 최신 기록을 확인한 뒤 다시 판독하세요.');
          err.code = 'CONFLICT';
          throw err;
        }

        const runId = `RUN-${id}-${Date.now()}`;
        const run = {
          run_id: runId,
          request_id: requestId || runId,
          inspection_id: id,
          content_version: insp.content_version,
          standard_version: payload.revision || 'Rev.A',
          status: 'MOCK_COMPLETED',
          is_mock: true,
          // Same model fields as a GAS run (gas/Live.gs liveAiRuns); the mock never falls back.
          model: 'mock-simulation',
          fallback_from: null,
          created_at: now.toISOString()
        };
        this.mockDb.ai_runs.push(run);

        const currentWeight = ('current_weight_g' in insp ? insp.current_weight_g : insp.initial_weight_g);
        const hasWeight = currentWeight !== null && currentWeight !== undefined;

        const mockKoreanResult = {
          '판정': 'HOLD',
          '불량유형': '모의 분석 초안 (실제 AI 판독 미실행)',
          '관찰·수치 근거': `[모의 테스트 초안] 외부 Gemini API 미연결 상태의 로컬 모의 결과입니다. 중량: ${hasWeight ? currentWeight + 'g' : '미측정'}. 실제 모델 호출 및 사진 분석이 수행되지 않았으므로 담당자 전수 대조가 필수적입니다.`,
          '적용 기준과 출처': `로컬 모의 시뮬레이터 (교육용 Rev.A 기준 / 외부 AI API 미연결; standards/${payload.revision || 'Rev.A'}.json)`,
          '권고 조치': '모의 초안입니다. 실제 사진 및 중량 실측값을 기반으로 품질 담당자가 직접 대조하고 최종 판단을 기록하세요. (출하 승인 없음)',
          '사람 승인 필요 여부': '필수 — 외부 AI 미연결 모의 초안이며 출하 승인이 아닙니다.',
          // Metadata and backward-compatibility fields
          is_mock: true,
          decision: 'HOLD',
          defects: [],
          human_approval_required: true,
          model: 'mock-simulation',
          // Same field as a GAS result (gas/Gemini.gs withModel): the main model a fallback replaced.
          fallback_from: null,
          generated_at: now.toISOString()
        };

        const draft = {
          draft_id: this.mockDb.ai_drafts.length + 1,
          run_id: runId,
          inspection_id: id,
          standard_revision: payload.revision || 'Rev.A',
          model: 'mock-simulation',
          is_mock: true,
          status: 'MOCK_COMPLETED',
          content_version: insp.content_version || 0,
          // What the AI saw (product_id, weight_g, images), with the names of the GAS input_snapshot.
          ...this._aiInput(insp),
          result: mockKoreanResult,
          created_at: now.toISOString()
        };
        this.mockDb.ai_drafts.push(draft);

        result = {
          run_id: runId,
          draft_id: draft.draft_id,
          status: 'MOCK_COMPLETED',
          is_mock: true,
          notice: '[모의 테스트 초안] 외부 AI 미연결 상태의 로컬 테스트 결과입니다.',
          result: draft.result
        };
        break;
      }

      case 'drafts.get': {
        const id = payload.id || payload.inspection_id;
        const insp = this.mockDb.inspections.find(i => i.inspection_id === id);
        const drafts = this.mockDb.ai_drafts.filter(d => d.inspection_id === id);
        const list = drafts.slice().reverse().map(d => ({
          draft_id: d.draft_id,
          run_id: d.run_id,
          inspection_id: d.inspection_id,
          created_at: d.created_at,
          standard_revision: d.standard_revision,
          provider: d.provider || 'mock-offline-fixture',
          model: d.model,
          result: d.result,
          content_version: d.content_version || 0,
          stale: !insp || draftOutdated(d, this._aiInput(insp)),
          is_mock: d.is_mock || false,
          status: d.status || (d.is_mock ? 'MOCK_COMPLETED' : undefined)
        }));
        if (list.length > 0) {
          Object.assign(list, list[0]);
        }
        result = list;
        break;
      }

      case 'drafts.reviews.list': {
        // Compared as strings like the GAS, as in drafts.evidence.list.
        result = this.mockDb.review_events.filter(r => String(r.draft_id) === String(payload.draft_id));
        break;
      }

      case 'drafts.evidence.list': {
        // Compared as strings like the GAS: draft IDs are numbers in the mock and strings in Sheets.
        result = this.mockDb.evidence_links.filter(e => String(e.draft_id) === String(payload.draft_id));
        break;
      }

      case 'evidence.queries.save': {
        const old=this.mockDb.evidence_queries.find(q=>q.query_id===payload.query_id);
        if(!old)this.mockDb.evidence_queries.push(structuredClone(payload));
        result=old||payload;break;
      }
      case 'evidence.queries.list': result=this.mockDb.evidence_queries.filter(q=>q.inspection_id===payload.inspection_id);break;
      case 'evidence.save': {
        const id = payload.inspection_id;
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

        // The GAS evidence_links columns (status, note, verified_at and the source fields) plus the mock's own.
        const confirmedAt = new Date().toISOString();
        const entry = {
          evidence_id: `EVI-${id}-${Date.now()}`,
          inspection_id: id,
          // No draft is an empty draft_id, as GAS handleEvidenceSave stores it.
          draft_id: payload.draft_id || '',
          // The query this confirmation answers (GET evidence-queries attaches it by this ID).
          query_id: payload.query_id || '',
          content_version: insp.content_version,
          standard_revision: payload.standard_revision || 'Rev.A',
          notebook_id: payload.notebook_id || '',
          source_id: payload.source_id || '',
          quote: payload.quote || '',
          verified: !!payload.verified,
          status: payload.status || (payload.verified === true ? 'VERIFIED' : 'EXTRACTED_UNVERIFIED'),
          note: payload.note || '',
          confirmed_by: payload.confirmed_by || 'factory-user',
          verified_at: confirmedAt,
          created_at: confirmedAt
        };
        this.mockDb.evidence_links.push(entry);
        result = { success: true, evidence_id: entry.evidence_id, entry };
        break;
      }

      case 'standards.get': {
        // Same row as the GAS seed, read from standards/ rather than mockDb; a missing revision is not replaced by another.
        const found = await repositoryStandard(payload.revision || 'Rev.A');
        if (!found) throw Object.assign(new Error('적용 기준 원문이 없습니다.'), { code: 'SETUP_REQUIRED' });
        result = found;
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
    if(['prompts.save','prompts.seed'].includes(action))return true;
    return [
      'inspections.createBatch',
      'inspections.saveRecord',
      'inspections.update',
      'ai.runQueue',
      'evidence.save',
      'evidence.queries.save',
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
