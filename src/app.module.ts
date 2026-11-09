import { Module } from '@nestjs/common';
import { ApiFallbackController } from './api-fallback.controller';
import { AuthController } from './auth.controller';

@Module({ controllers: [AuthController, ApiFallbackController] })
export class AppModule {}
