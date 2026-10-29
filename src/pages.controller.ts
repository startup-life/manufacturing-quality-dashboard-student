import { All, Controller, Next, Req, Res } from '@nestjs/common';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'public/index.html');
// The route below matches every request no API route took.
const PAGES_ROUTE = '{*path}';
// How the logs name a request's route: Express's route path, or 'static' (fallback) for the pages and the middleware.
export const routeName = (req: Request, fallback: string) => {
  const route = req.route?.path;
  return route && route !== '/' + PAGES_ROUTE ? route : fallback;
};

// Everything that is not an API route, in order: the /api 404, the screen files and the screen's own addresses.
function pages() {
  const router = express.Router();
  router.use('/api', (req, res) => { res.status(404).json({ error: 'API를 찾을 수 없습니다.' }); });
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
