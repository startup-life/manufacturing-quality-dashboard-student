/**
 * Evidence routes: evidence verification through the NotebookLM MCP client
 */

import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AppService } from './app.service';
import { citedStandardName } from './mcp-client';
import { InputError } from './validation';
import { NOTEBOOKLM_OFF_MESSAGE } from './integrations';

type Row = Record<string, any>;
// Statuses written by the confirmation route below; the GAS default 'VERIFIED' counts as confirmed too.
const REVIEW_NEEDED = ['REVIEW_NEEDED_BY_USER', 'MOCK_REVIEW_NEEDED'];
const CONFIRMED = ['VERIFIED_BY_USER', 'MOCK_USER_REVIEWED', 'VERIFIED', ...REVIEW_NEEDED];
const time = (value: unknown) => { const t = Date.parse(String(value || '')); return Number.isFinite(t) ? t : Infinity; };

// A saved confirmation row (GAS evidence_links or the mock) belongs to the query it names by query_id, so a newer query
// of the same draft starts unconfirmed whatever the clocks say. Older rows without query_id fall back to the last query of
// the same draft and inspection version made before the row was saved (GAS and PC clocks compared).
export function attachConfirmations(queries: Row[], links: Row[], inspectionId: string) {
  const key = (x: Row) => String(x.draft_id) + '|' + Number(x.content_version);
  const owners = new Map<Row, Row>();
  for (const link of links) {
    if (link.inspection_id !== undefined && link.inspection_id !== inspectionId) continue;
    let owner;
    if (link.query_id) owner = queries.find(q => q.query_id === link.query_id);
    else {
      const at = time(link.verified_at || link.created_at);
      owner = queries.filter(q => key(q) === key(link) && time(q.queried_at) <= at).at(-1);
    }
    if (owner) owners.set(owner, link);
  }
  return queries.map(q => {
    const link = owners.get(q);
    if (!link) return q;
    const verified = typeof link.verified === 'boolean' ? link.verified : CONFIRMED.includes(link.status);
    // The shape the screen reads (verified, note, confirmed_at) plus its review mark.
    return { ...q, confirmation: { verified, review_needed: REVIEW_NEEDED.includes(link.status), note: link.note || '', confirmed_at: link.verified_at || link.created_at || '' } };
  });
}

// Real answers saved before source_document was recorded get the same cited-standard name a new query gets.
const withStandardName = (q: Row) => q.is_mock === false && !q.source_document ? { ...q, source_document: citedStandardName(q, q.standard_revision) } : q;

@Controller('api')
export class EvidenceController {
  constructor(private readonly app: AppService) {}

  // 1. NotebookLM MCP Server & Connection Status
  @Get('notebooklm/status')
  status() {
    return { ...this.app.mcpClient.getStatus(), mode: this.app.integrations.notebooklm.mode };
  }

  // 2. Query Evidence via MCP Client
  @Post('inspections/:id/evidence-queries')
  async query(@Param('id') id: string, @Body() body: any) {
    const { repo, mcpClient, promptStore } = this.app;
    if (this.app.integrations.notebooklm.mode === 'off') throw new InputError(NOTEBOOKLM_OFF_MESSAGE, 409);
    const { draft_id, expected_version } = body || {};

    const inspection = await repo.detail(id);
    if (!inspection) {
      throw new InputError('검사 기록이 없습니다.', 404);
    }

    if (expected_version !== undefined && expected_version !== null && Number(expected_version) !== inspection.content_version) {
      throw new InputError('검사 자료(사진/수치)가 변경되었습니다. 최신 버전을 확인 후 다시 시도하세요.', 409);
    }
    const drafts = await repo.drafts(id);
    const draft = draft_id === undefined ? drafts[0] : drafts.find(d => String(d.draft_id) === String(draft_id));
    if (!draft) throw new InputError('근거를 확인할 AI 초안을 먼저 선택하세요.', 409);
    // stale means the AI input (photos, weight, product) changed since the draft; a judgment saved since keeps it.
    if (draft.stale) throw new InputError('변경 전 초안입니다. 최신 자료로 판독한 뒤 근거를 확인하세요.', 409);
    if (body?.revision && body.revision !== draft.standard_revision) throw new InputError('초안에 적용한 검사기준 버전과 다릅니다.', 409);
    const prompt = await promptStore.resolve('notebooklm', body?.prompt_version_id);

    const queryResult = await mcpClient.queryEvidence({
      inspectionId: id,
      draftId: draft.draft_id,
      productName: inspection.product_name,
      defects: inspection.defects,
      standardRevision: draft.standard_revision,
      contentVersion: inspection.content_version,
      prompt, weightG: inspection.weight_g
    });

    await repo.transport.dispatch('evidence.queries.save', queryResult, { request_id: queryResult.query_id });

    return queryResult;
  }

  // 3. Get Query History
  @Get('inspections/:id/evidence-queries')
  async history(@Param('id') id: string) {
    const { repo } = this.app;
    const history: Row[] = await repo.transport.dispatch('evidence.queries.list', { inspection_id: id });
    // The saved confirmations come back with their query, so a reload keeps the check and the review-needed mark.
    const links = [];
    for (const draftId of new Set(history.map(q => String(q.draft_id)))) links.push(...await repo.transport.dispatch('drafts.evidence.list', { draft_id: draftId }));
    return {
      inspection_id: id,
      queries: attachConfirmations(history.map(withStandardName), links, id)
    };
  }

  // 4. Save Human Evidence Confirmation
  @Post('inspections/:id/evidence-confirmation')
  async confirm(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const { repo } = this.app;
    const { draft_id, verified, note, expected_version } = body || {};
    const reviewNeeded = body?.review_needed === true;
    // The review mark is part of a source check; without it the GAS row (no verified column) would restore as checked.
    if (reviewNeeded && verified !== true) throw new InputError('검토 필요는 기준 원문을 대조한 확인과 함께 저장합니다. 확인 항목에 체크하세요.');

    const inspection = await repo.detail(id);
    if (!inspection) {
      throw new InputError('검사 기록이 없습니다.', 404);
    }

    if (Number(expected_version) !== inspection.content_version) throw new InputError('검사 자료가 변경되었습니다. 최신 근거를 다시 확인하세요.', 409);
    // The check belongs to a current draft (the detail carries them, newest first) and its last query, made at any
    // inspection version: a judgment saved after the query does not outdate the draft.
    const drafts: Row[] = inspection.drafts || [];
    const draft = draft_id === undefined ? drafts[0] : drafts.find(d => String(d.draft_id) === String(draft_id));
    if (!draft || draft.stale) throw new InputError('변경 전 초안입니다. 최신 자료로 판독한 뒤 근거를 확인하세요.', 409);
    const savedQueries: Row[] = await repo.transport.dispatch('evidence.queries.list', { inspection_id: id });
    const latest = savedQueries.filter(q => String(q.draft_id) === String(draft.draft_id)).at(-1);
    if (!latest) throw new InputError('현재 판독 결과의 근거 질의를 먼저 실행하세요.', 409);
    const confirmation = {
      inspection_id: id,
      draft_id: draft_id ?? latest.draft_id,
      content_version: inspection.content_version,
      verified: !!verified,
      query_id: latest.query_id,
      notebook_id: latest.notebook_id,
      source_id: latest.references?.[0]?.source_id || latest.sources?.[0]?.source_id || '',
      standard_revision: latest.standard_revision,
      quote: latest.references?.[0]?.cited_text || latest.evidence_excerpt || '',
      // The person's "AI 판정이 이 기준과 맞지 않습니다" mark; the GAS stores the status as given.
      status: latest.is_mock ? (reviewNeeded ? 'MOCK_REVIEW_NEEDED' : 'MOCK_USER_REVIEWED') : reviewNeeded ? 'REVIEW_NEEDED_BY_USER' : verified ? 'VERIFIED_BY_USER' : 'EXTRACTED_UNVERIFIED',
      note: note || '',
      confirmed_by: req.session?.user?.username || 'factory-user',
      confirmed_at: new Date().toISOString()
    };

    // The version checked above, as a number; a failed save is the route's error.
    await repo.saveEvidence(confirmation, inspection.content_version);

    return {
      success: true,
      confirmation
    };
  }
}
