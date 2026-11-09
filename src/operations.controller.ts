import { Controller, Get } from '@nestjs/common';
import { getStorageInfo, type StorageInfo } from './storage-mode';

@Controller('api/operations')
export class OperationsController {
  @Get()
  getOperations(): StorageInfo {
    return getStorageInfo();
  }
}
