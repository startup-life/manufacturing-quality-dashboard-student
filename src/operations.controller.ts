import { Controller, Get } from '@nestjs/common';

@Controller('api/operations')
export class OperationsController {
  @Get()
  getOperations(): { storage: 'mock'; label: string } {
    return { storage: 'mock', label: '내 컴퓨터' };
  }
}
