/**
 * GasRepository: Implements the InspectionRepository interface via GasTransport (Google Sheets/Drive)
 */

import { GasTransport } from './gas-transport';
import { gasHttpError } from './validation';

type Row = Record<string, any>;

// One page of inspections.list (also home.get's first_page) in the /api/inspections shape.
const listPage = (res: Row) => ({
  rows: res.items || [],
  total: res.totalCount || 0,
  page: res.page || 1,
  pageSize: res.pageSize || 12
});

export class GasRepository {
  transport: GasTransport;

  constructor(options: { transport?: GasTransport; mode?: string; webAppUrl?: string; timeoutMs?: number } = {}) {
    this.transport = options.transport || new GasTransport(options);
  }

  async products() {
    return await this.transport.dispatch('products.list');
  }

  async home(date: string) {
    const res = await this.transport.dispatch('home.get', { date });
    return {
      date: res.latest_date,
      counts: res.metrics || { total: 0, ng: 0, hold: 0, pending: 0 },
      // A GAS deployed before first_page and the mock store leave it out; the screen then asks /api/inspections.
      ...(res.first_page ? { firstPage: listPage(res.first_page) } : {})
    };
  }

  async list({ search = '', decision: filterDecision = '', date = '', review = '', page = 1, pageSize = 12 }: Row = {}) {
    const res = await this.transport.dispatch('inspections.list', {
      search,
      decision: filterDecision,
      date,
      review,
      page,
      pageSize
    });

    return listPage(res);
  }

  async detail(id: string) {
    try {
      const res = await this.transport.dispatch('inspections.get', { id });
      return res;
    } catch (err: any) {
      // Only a missing inspection is "no row"; setup errors that also say '없습니다' keep their 503.
      if (err.code === 'NOT_FOUND') {
        return null;
      }
      throw gasHttpError(err);
    }
  }

  async update(id: string, input: Row) {
    try {
      await this.transport.dispatch('inspections.update', { id, ...input }, {
        expected_version: input.expected_version
      });
    } catch (err) {
      throw gasHttpError(err);
    }
    return await this.detail(id);
  }

  async create(r: Row, requestId: string | null = null) {
    const batchRes = await this.createBatch([r], requestId);
    const createdId = batchRes.inspections?.[0]?.inspection_id || r.inspection_id;
    return await this.detail(createdId);
  }

  async createBatch(items: Row[], requestId: string | null = null) {
    return await this.transport.dispatch('inspections.createBatch', { items }, { request_id: requestId });
  }

  get live() { return this.transport.mode === 'live'; }
  async storePhoto(bytes: Buffer, requestId: string) {
    return this.transport.dispatch('photos.store', { data_base64: bytes.toString('base64'), mime: 'image/jpeg' }, { request_id: requestId });
  }
  async photo(imageId: string) { return this.transport.dispatch('photos.get', { image_id: imageId }); }
}
