import { Module } from '@nestjs/common';
import { SessionController } from './session.controller';
import { PagesController } from './pages.controller';

// PagesController matches every path, so it stays last.
@Module({ controllers: [SessionController, PagesController] })
export class AppModule {}
