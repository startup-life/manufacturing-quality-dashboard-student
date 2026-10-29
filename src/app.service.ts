import { GasRepository } from './gas-repository';
import type { GasTransport } from './gas-transport';

export type AppOptions = {
  transport?: GasTransport;
  [option: string]: unknown;
};

// What every controller shares: the storage. createApp (app.ts) makes it before Nest starts.
export class AppService {
  readonly repo: GasRepository;

  constructor(readonly options: AppOptions = {}) {
    this.repo = new GasRepository(options);
  }
}
