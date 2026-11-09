import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const products = [
  { product_id: 'P-SILVER', name: '텀블러 실버', color: '은색', label: '은색 텀블러' },
  { product_id: 'P-WHITE', name: '텀블러 화이트', color: '흰색', label: '흰색 텀블러' },
  { product_id: 'P-BLACK', name: '텀블러 블랙', color: '검정', label: '검정 텀블러' },
];

@Controller('api')
export class CatalogController {
  @Get('products')
  getProducts(): typeof products {
    return products;
  }

  @Get('standards/:revision')
  getStandard(@Param('revision') revision: string): unknown {
    if (revision !== 'Rev.A' && revision !== 'Rev.B') {
      throw new NotFoundException('검사기준을 찾을 수 없습니다.');
    }

    const filePath = path.join(process.cwd(), 'standards', `${revision}.json`);
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  }
}
