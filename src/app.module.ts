import { Module } from '@nestjs/common';
import { ApiFallbackController } from './api-fallback.controller';
import { AuthController } from './auth.controller';
import { CatalogController } from './catalog.controller';
import { InspectionsController } from './inspections.controller';
import { InspectionStore } from './inspection.store';
import { HomeController } from './home.controller';
import { OperationsController } from './operations.controller';
import { GoogleWebAppClient } from './google-web-app.client';
import { DrivePhotoController } from './drive-photo.controller';
import { PromptsController } from './prompts.controller';
import { GeminiResultStore } from './gemini-result.store';
import { EvidenceQueryStore } from './evidence-query.store';
import { NotebookLMClient } from './notebooklm.client';
import { EvidenceLinkStore } from './evidence-link.store';

@Module({
  controllers: [AuthController, CatalogController, InspectionsController, HomeController, OperationsController, DrivePhotoController, PromptsController, ApiFallbackController],
  providers: [InspectionStore, GoogleWebAppClient, GeminiResultStore, EvidenceQueryStore, EvidenceLinkStore, NotebookLMClient],
})
export class AppModule {}
