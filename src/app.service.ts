import { GasRepository } from './gas-repository';
import type { GasTransport } from './gas-transport';
import { NotebookLmMcpClient } from './mcp-client';
import { appIntegrations, GeminiModels, Integrations } from './integrations';
import { PromptStore } from './prompts';
import { repositoryStandard } from './reports';
import { errorEvent } from './log';

export type AppOptions = {
  transport?: GasTransport;
  // The GEMINI_MODE and NOTEBOOKLM_MODE read at startup; storage follows the transport.
  integrations?: Partial<Integrations>;
  mcpClient?: NotebookLmMcpClient;
  geminiReady?: boolean;
  geminiModels?: GeminiModels;
  // Reads the standard source row for /api/standards; tests pass their own to check the 503 paths.
  readStandardSource?: (revision: string) => Promise<{ standard_text: string } | null>;
  [option: string]: unknown;
};

// What every controller shares: the storage, the switches, the clients and the queue of live Gemini runs.
// createApp (app.ts) makes it before Nest starts, so a refused combination of switches stops there.
export class AppService {
  readonly repo: GasRepository;
  readonly integrations: Integrations;
  readonly geminiMode: string;
  readonly readStandardSource: NonNullable<AppOptions['readStandardSource']>;
  readonly mcpClient: NotebookLmMcpClient;
  readonly promptStore: PromptStore;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly active = new Set<string>();

  constructor(readonly options: AppOptions = {}) {
    this.repo = new GasRepository(options);
    this.integrations = appIntegrations(options.integrations, this.repo.live ? 'live' : 'mock');
    this.geminiMode = this.integrations.gemini.mode;
    this.readStandardSource = options.readStandardSource || repositoryStandard;
    this.mcpClient = options.mcpClient || new NotebookLmMcpClient({ ...options, mode: this.integrations.notebooklm.mode === 'live' ? 'live' : 'mock' });
    this.promptStore = new PromptStore(this.repo.transport);
  }

  // One live Gemini run at a time, each run once.
  scheduleLiveAi(id: string, runId: string) {
    if (this.active.has(runId)) return;
    this.active.add(runId);
    this.queue = this.queue.then(() => this.repo.executeAi(id, runId)).catch(err => {
      // A lost response is not permission to repeat an inference call; the run turns UNKNOWN in GAS instead.
      console.error(errorEvent(err, { route: 'ai.execute' }));
    }).finally(() => this.active.delete(runId));
  }

  waitAiIdle() { return this.queue; }
}
