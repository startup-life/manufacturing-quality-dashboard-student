import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SessionController } from './session.controller';
import { InspectionsController } from './inspections.controller';
import { PagesController } from './pages.controller';
import { FactoryUserGuard } from './factory-user.guard';

@Module({
  // PagesController matches every path, so it stays last.
  controllers: [SessionController, InspectionsController, AppController, PagesController],
  providers: [FactoryUserGuard]
})
export class AppModule {}
