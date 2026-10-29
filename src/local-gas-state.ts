import fs from 'node:fs';
import path from 'node:path';
import { GasTransport } from './gas-transport';

type Row = Record<string, any>;

// Local offline storage only. This is not a successful Google Sheets connection.
export function restoreApiSnapshot(snapshot: Row) {
  const transport = new GasTransport({ mode: 'mock' });
  const db = transport.mockDb;
  for (const item of snapshot.inspections) {
    const d = item.detail, o = d.original || d;
    db.inspections.push({
      inspection_id: d.inspection_id, product_id: o.product_id,
      initial_product_id: o.product_id, current_product_id: d.product_id,
      inspected_at: o.inspected_at, initial_inspected_at: o.inspected_at,
      current_inspected_at: d.inspected_at, initial_weight_g: o.weight_g,
      current_weight_g: d.weight_g, initial_decision: o.decision,
      current_decision: d.decision, memo: d.memo,
      content_version: d.content_version, created_at: d.created_at
    });
    db.inspection_images.push(...d.images.map((img: Row) => ({ ...img, inspection_id: d.inspection_id, active: 1 })));
    db.ai_drafts.push(...[...(item.drafts || [])].reverse());
  }
  db.evidence_links = snapshot.evidence_links || [];
  return transport;
}

export function openLocalTransport(stateFile: string, bootstrapFile?: string) {
  let transport: GasTransport;
  if (fs.existsSync(stateFile)) {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (saved.schema_version !== 1 || !Array.isArray(saved.db?.inspections)) throw new Error('로컬 저장 파일 형식 오류');
    transport = new GasTransport({ mode: 'mock' });
    transport.mockDb = saved.db;
  } else if (bootstrapFile) {
    transport = restoreApiSnapshot(JSON.parse(fs.readFileSync(bootstrapFile, 'utf8')));
  } else {
    transport = new GasTransport({ mode: 'mock' });
  }
  const persist = () => {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    const tmp = `${stateFile}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify({ schema_version: 1, db: transport.mockDb }));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, stateFile);
    fs.chmodSync(stateFile, 0o600);
  };
  persist();
  const dispatch = transport.dispatch.bind(transport);
  let queue: Promise<unknown> = Promise.resolve();
  transport.dispatch = (...args: Parameters<GasTransport['dispatch']>) => {
    const operation = queue.then(async () => {
      const before = structuredClone(transport.mockDb);
      try {
        const result = await dispatch(...args);
        persist();
        return result;
      } catch (err) {
        transport.mockDb = before;
        throw err;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  };
  return transport;
}
