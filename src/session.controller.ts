import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { InputError } from './validation';
import { ACCOUNTS, endSession, SessionUser } from './security';

@Controller('api')
export class SessionController {
  private readonly dummyHash = bcrypt.hashSync(crypto.randomBytes(20).toString('hex'), 12);
  // Hashed once when the server starts.
  private readonly users = Object.fromEntries(Object.entries(ACCOUNTS).map(([name, a]) => [name, { id: a.id, role: a.role, hash: bcrypt.hashSync(a.password, 10) }]));

  @Get('session')
  session(@Req() req: Request) {
    req.session.csrf ??= crypto.randomBytes(32).toString('hex');
    return { user: req.session.user ?? null, csrfToken: req.session.csrf };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Req() req: Request, @Body() body: any) {
    const { username, password } = body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || Buffer.byteLength(password) > 72) throw new InputError('로그인 정보를 확인하세요.', 401);
    let user: SessionUser | null = null;
    // Own keys only: a name like constructor or __proto__ would otherwise find Object's own members and fail with a 500.
    // An unknown name is still compared once, against a random hash.
    const account = Object.hasOwn(this.users, username) ? this.users[username] : null;
    const match = account ? await bcrypt.compare(password, account.hash) : await bcrypt.compare(password, this.dummyHash);
    if (account && match) {
      user = { id: account.id, username, role: account.role };
    }
    if (!user) throw new InputError('로그인 정보를 확인하세요.', 401);
    endSession(req.sessionID);
    await new Promise<void>((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
    req.session.user = user; req.session.csrf = crypto.randomBytes(32).toString('hex');
    return { user: req.session.user, csrfToken: req.session.csrf };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    endSession(req.sessionID);
    await new Promise<void>((resolve, reject) => req.session.destroy(e => e ? reject(e) : resolve()));
    res.clearCookie('qc.sid', { path: '/' });
    return { ok: true };
  }
}
