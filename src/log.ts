import os from 'node:os';
const allowed = ['status', 'route', 'method', 'request_id', 'event', 'error_name', 'error_code', 'cause', 'message'];
// Key and token shapes are masked; request bodies, headers and cookies never become fields.
const secretShapes = [/AIza[0-9A-Za-z_-]{10,}/g, /ya29\.[0-9A-Za-z._-]+/g, /GOCSPX-[0-9A-Za-z_-]+/g, /\b1\/\/[0-9A-Za-z_-]{10,}/g, /eyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\.[0-9A-Za-z_-]*/g, /(Bearer\s+)[^\s"',]+/gi, /\b[a-f0-9]{16,}\b/gi, /\b[0-9A-Za-z_-]{32,}\b/g];
export function redact(value: unknown) {
  let text = String(value ?? ''); const home = os.homedir(); if (home) text = text.split(home).join('~');
  for (const shape of secretShapes) text = text.replace(shape, (_: string, prefix: unknown) => (typeof prefix === 'string' ? prefix : '') + '[가림]');
  return text.length > 500 ? text.slice(0, 500) + '…' : text;
}
export function safeEvent(event: string, fields: Record<string, unknown> = {}) { return JSON.stringify({ time: new Date().toISOString(), event, ...Object.fromEntries(Object.entries(fields).filter(([k, v]) => allowed.includes(k) && v !== undefined && v !== null).map(([k, v]) => [k, typeof v === 'string' && k !== 'request_id' ? redact(v) : v])) }); }
// Name, code and a masked message only; a cause contributes its name and code, never its text.
export function errorEvent(err: any, fields: Record<string, unknown> = {}) { const cause = err?.cause; return safeEvent('error', { ...fields, error_name: err?.name, error_code: err?.code === undefined ? undefined : String(err.code), cause: cause ? [cause.name, cause.code].filter(Boolean).join(':') : undefined, message: err?.message }); }
