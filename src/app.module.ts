import { DynamicModule, Module } from '@nestjs/common';
import { AppService } from './app.service';
import { AppController } from './app.controller';
import { SessionController } from './session.controller';
import { PromptsController } from './prompts.controller';
import { InspectionsController } from './inspections.controller';
import { PagesController } from './pages.controller';
import { FactoryUserGuard } from './factory-user.guard';

@Module({})
export class AppModule {
  // The service is made by createApp (app.ts) from the transport and switches it was given.
  static register(service: AppService): DynamicModule {
    return {
      module: AppModule,
      // PagesController matches every path, so it stays last.
      controllers: [SessionController, PromptsController, InspectionsController, AppController, PagesController],
      providers: [{ provide: AppService, useValue: service }, FactoryUserGuard]
    };
  }
}
