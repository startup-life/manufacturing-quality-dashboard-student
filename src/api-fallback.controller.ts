import { All, Controller, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller('api')
export class ApiFallbackController {
  @All()
  notFoundAtApiRoot(@Res() response: Response): void {
    response
      .status(HttpStatus.NOT_FOUND)
      .json({ error: '요청한 주소를 찾을 수 없습니다.' });
  }

  @All('{*path}')
  notFoundUnderApi(@Res() response: Response): void {
    response
      .status(HttpStatus.NOT_FOUND)
      .json({ error: '요청한 주소를 찾을 수 없습니다.' });
  }
}
