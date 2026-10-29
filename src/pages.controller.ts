import { All, Controller, Next, Req, Res } from '@nestjs/common';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { requireLogin } from './security';

const root = path.join(__dirname, '..');
export const indexPath = path.join(root, 'public/index.html');
// The route below matches every request no API route took.
const PAGES_ROUTE = '{*path}';
// How the logs name a request's route: Express's route path, or 'static' (fallback) for the pages and the middleware.
export const routeName = (req: Request, fallback: string) => {
  const route = req.route?.path;
  return route && route !== '/' + PAGES_ROUTE ? route : fallback;
};

// Everything that is not an API route, in the original order: the removed about page, the /api 404,
// the photos (login required), the screen files and the screen's own addresses.
function pages() {
  const router = express.Router();
  // Return 404 for removed about.html (do not fallback to SPA index.html)
  router.get('/about.html', (req, res) => { res.status(404).send('Not Found'); });
  router.use('/api', (req, res) => { res.status(404).json({ error: 'API를 찾을 수 없습니다.' }); });
  router.use('/media', requireLogin, express.static(path.join(root, 'runtime/images'), { dotfiles: 'deny', index: false }));
  router.use('/uploads', requireLogin, express.static(path.join(root, 'runtime/uploads'), { dotfiles: 'deny', index: false }));
  router.use(express.static(path.join(root, 'public'), { dotfiles: 'deny' }));
  router.get(['/', '/inspections', '/inspections/new', '/inspections/:id', '/settings'], (req, res) => res.sendFile(indexPath));
  router.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) return res.sendFile(indexPath);
    next();
  });
  return router;
}

// Registered last (app.module.ts), so every API route is tried first.
@Controller()
export class PagesController {
  private readonly pages = pages();

  @All(PAGES_ROUTE)
  serve(@Req() req: Request, @Res() res: Response, @Next() next: NextFunction) {
    this.pages(req, res, next);
  }
}
