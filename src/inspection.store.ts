import { Injectable } from '@nestjs/common';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Inspection, LocalState } from './inspection.types';

@Injectable()
export class InspectionStore {
  private readonly filePath = path.join(process.cwd(), 'runtime', 'local-state.json');

  getAll(): Inspection[] {
    if (!existsSync(this.filePath)) return [];
    const state = JSON.parse(readFileSync(this.filePath, 'utf8')) as LocalState;
    return Array.isArray(state.inspections) ? state.inspections : [];
  }

  save(inspection: Inspection): void {
    const inspections = this.getAll();
    const index = inspections.findIndex((item) => item.inspection_id === inspection.inspection_id);
    if (index < 0) inspections.push(inspection);
    else inspections[index] = inspection;

    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ inspections }, null, 2), 'utf8');
    renameSync(temporaryPath, this.filePath);
  }

  find(inspectionId: string): Inspection | undefined {
    return this.getAll().find((item) => item.inspection_id === inspectionId);
  }
}
