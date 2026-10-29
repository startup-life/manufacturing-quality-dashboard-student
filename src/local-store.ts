import fs from 'node:fs';
import path from 'node:path';
import { InputError } from './validation';
import { PRODUCTS } from './standards';

type Row = Record<string, any>;
type Db = { inspections: Row[]; images: Row[] };

// Records live in one JSON file on this computer (Git ignores runtime/); uploaded photos sit next to it in runtime/uploads.
const root = path.join(__dirname, '..');
export const STATE_FILE = path.join(root, 'runtime/local-state.json');

let db: Db | null = null;
function load(): Db {
  if (db) return db;
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (saved.schema_version !== 1 || !Array.isArray(saved.db?.inspections) || !Array.isArray(saved.db?.images)) throw new Error('로컬 저장 파일 형식 오류');
    db = saved.db as Db;
  } else db = { inspections: [], images: [] };
  return db;
}
// Write a temporary file and rename it, so a stopped server never leaves half a file.
function persist() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${STATE_FILE}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ schema_version: 1, db }));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, STATE_FILE);
}
// One change at a time; a change that fails puts the records back as they were.
let queue: Promise<unknown> = Promise.resolve();
function change<T>(work: (db: Db) => T): Promise<T> {
  const operation = queue.then(() => {
    const before = structuredClone(load());
    try { const result = work(db as Db); persist(); return result; }
    catch (err) { db = before; throw err; }
  });
  queue = operation.catch(() => {});
  return operation;
}

const product = (id: string) => PRODUCTS.find(p => p.product_id === id) || { product_name: '텀블러', color: '은색' };
function toDetail(d: Db, insp: Row) {
  const { product_name, color } = product(insp.product_id);
  return {
    inspection_id: insp.inspection_id, product_id: insp.product_id, product_name, color,
    inspected_at: insp.inspected_at, weight_g: insp.weight_g, decision: insp.decision, memo: insp.memo,
    revision: insp.revision, content_version: insp.content_version,
    images: d.images.filter(img => img.inspection_id === insp.inspection_id).map(img => ({ image_id: img.image_id, image_url: img.image_url })),
    created_at: insp.created_at, updated_at: insp.updated_at
  };
}
// A card of the list: the detail without the photo list, with the first photo.
function toCard(d: Db, insp: Row) {
  const { images, memo, revision, created_at, updated_at, ...card } = toDetail(d, insp);
  return { ...card, image_url: images[0]?.image_url || null, images_count: images.length, is_pending: false };
}

export async function detail(id: string) {
  await queue;
  const d = load(), insp = d.inspections.find(i => i.inspection_id === id);
  return insp ? toDetail(d, insp) : null;
}

// Saving the same inspection_id again (the form resends one request ID for unchanged input) keeps the first one.
export function create(r: Row) {
  return change(d => {
    const now = new Date().toISOString();
    if (!d.inspections.some(i => i.inspection_id === r.inspection_id)) {
      d.inspections.push({
        inspection_id: r.inspection_id, product_id: r.product_id, inspected_at: r.inspected_at,
        weight_g: r.weight_g, decision: null, memo: r.memo, revision: r.revision,
        content_version: 0, created_at: now, updated_at: ''
      });
      r.images.forEach((url: string, index: number) => d.images.push({ image_id: `IMG-${r.inspection_id}-${index + 1}`, inspection_id: r.inspection_id, image_url: url, created_at: now }));
    }
    return toDetail(d, d.inspections.find(i => i.inspection_id === r.inspection_id) as Row);
  });
}

export function update(id: string, input: { product_id: string; inspected_at: string; weight_g: number | null; expected_version: number }) {
  return change(d => {
    const insp = d.inspections.find(i => i.inspection_id === id);
    if (!insp) throw new InputError('검사 기록이 없습니다.', 404);
    if (input.expected_version !== insp.content_version) throw new InputError('자료가 이미 변경되었습니다. 최신 화면을 확인 후 다시 시도하세요.', 409);
    Object.assign(insp, { product_id: input.product_id, inspected_at: input.inspected_at, weight_g: input.weight_g, content_version: insp.content_version + 1, updated_at: new Date().toISOString() });
    return toDetail(d, insp);
  });
}

export async function list({ search = '', decision = '', date = '', review = '', page = 1, pageSize = 12 }: Row = {}) {
  await queue;
  const d = load();
  // Newest inspection time first; for the same time, the later saved one first.
  let rows = d.inspections.map(i => toCard(d, i)).reverse();
  if (date) rows = rows.filter(i => (i.inspected_at || '').startsWith(date));
  if (decision) rows = rows.filter(i => i.decision === decision);
  if (review === 'pending') rows = rows.filter(i => i.is_pending);
  if (search) {
    const q = String(search).toLowerCase();
    rows = rows.filter(i => i.inspection_id.toLowerCase().includes(q) || i.product_name.toLowerCase().includes(q) || i.color.toLowerCase().includes(q));
  }
  rows.sort((a, b) => String(b.inspected_at).localeCompare(String(a.inspected_at)));
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total: rows.length, page, pageSize };
}

// The figures of one day (the latest inspection day when none is given) and its first card page.
export async function home(date: string) {
  await queue;
  const d = load();
  if (!date) date = d.inspections.map(i => String(i.inspected_at || '').slice(0, 10)).filter(Boolean).sort().pop() || '';
  if (!date) return { date: '', counts: { total: 0, ng: 0, hold: 0, pending: 0 }, firstPage: { rows: [], total: 0, page: 1, pageSize: 6 } };
  const day = d.inspections.filter(i => String(i.inspected_at || '').startsWith(date));
  return {
    date,
    counts: { total: day.length, ng: day.filter(i => i.decision === 'NG').length, hold: day.filter(i => i.decision === 'HOLD').length, pending: 0 },
    firstPage: await list({ date, page: 1, pageSize: 6 })
  };
}
