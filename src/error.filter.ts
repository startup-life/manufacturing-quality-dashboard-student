import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InputError } from './validation';
import { errorEvent } from './log';
import { indexPath, routeName } from './pages.controller';

// encodeurl 2: characters a URL may not carry are percent-encoded, an existing %XX is kept.
const encodeUrl = (url: string) => url.replace(/(?:[^\x21\x23-\x3B\x3D\x3F-\x5F\x61-\x7A\x7C\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g, encodeURI);
// Express's own answer when nothing handled a request (finalhandler): the pages route passes on non-GET requests
// and requests that do not accept HTML, and Nest turns that into a NotFoundException.
function notFoundPage(req: Request, res: Response) {
  const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
  const body = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>'
    + escape('Cannot ' + req.method + ' ' + encodeUrl(req.originalUrl.split('?')[0])) + '</pre>\n</body>\n</html>\n';
  res.removeHeader('Content-Encoding'); res.removeHeader('Content-Language'); res.removeHeader('Content-Range');
  res.status(404);
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));
  res.end(req.method === 'HEAD' ? undefined : body);
}

const undecodable = (urlPath: string) => { try { decodeURIComponent(urlPath); return false; } catch { return true; } };

// Every failure answers { error } with its status. Only InputError carries guidance written for the user; any other 500 says 서버 처리 실패 and goes to the log.
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>(), res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) { req.socket.destroy(); return; }
    if (err instanceof NotFoundException) return notFoundPage(req, res);
    // A screen address that cannot be decoded (e.g. /inspections/%E0%A4%A) gets the screen, which shows its not-found page.
    // Nest turns Express's URIError into a BadRequestException, so the path itself is checked.
    if (err instanceof BadRequestException && req.method === 'GET' && !/^\/api(\/|$)/.test(req.path) && req.accepts('html') && undecodable(req.path)) return res.sendFile(indexPath);
    const status = err instanceof HttpException ? err.getStatus() : err?.status || 500;
    if (status >= 500) console.error(errorEvent(err, { route: routeName(req, req.path), method: req.method, status, request_id: res.get('X-Request-Id') }));
    res.status(status).json({ error: status >= 500 ? (err instanceof InputError ? err.message : '서버 처리 실패') : err.message });
  }
}
