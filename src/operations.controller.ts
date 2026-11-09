import { Controller, Get } from '@nestjs/common';
import { getOperationsInfo, type OperationsInfo } from './storage-mode';

@Controller('api/operations')
export class OperationsController {
  @Get()
  getOperations(): OperationsInfo {
    return getOperationsInfo();
  }
}
