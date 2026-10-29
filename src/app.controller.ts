import { Controller, Get, Param, Query } from '@nestjs/common';
import { dateInput } from './validation';
import { PRODUCTS, standardFor } from './standards';
import * as store from './local-store';

@Controller('api')
export class AppController {
  @Get('home')
  home(@Query('date') date: unknown) {
    return store.home(dateInput(date));
  }

  @Get('health')
  health() {
    return { status: 'ok', database: 'local-json', scope: '교육용; 출하 승인 아님' };
  }

  @Get('products')
  products() {
    return PRODUCTS;
  }

  @Get('standards/:revision')
  standard(@Param('revision') revision: string) {
    return standardFor(revision);
  }

  // The settings screen shows where records are kept: a file on this computer.
  @Get('operations')
  operations() {
    return { revisions: ['Rev.A', 'Rev.B'], scope: '교육용·출하 승인 없음', integrations: { storage: { mode: 'local' } } };
  }
}
