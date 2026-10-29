import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { InputError } from './validation';
import { FACTORY_ROLES } from './security';

// Writes to an inspection need a factory account; the login itself is checked before any /api route (security.ts).
@Injectable()
export class FactoryUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const role = context.switchToHttp().getRequest<Request>().session.user?.role;
    if (role && FACTORY_ROLES.includes(role)) return true;
    throw new InputError('공장 사용자 권한이 필요합니다.', 403);
  }
}
