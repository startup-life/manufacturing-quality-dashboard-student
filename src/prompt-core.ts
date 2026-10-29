// prompts/prompt-core.cjs is plain JavaScript shared with the Apps Script code, so it is loaded with require.
export const promptCore = require('../prompts/prompt-core.cjs') as {
  NOTEBOOK_SAFETY: string;
  naturalInspection(info: Record<string, unknown>): string;
  notebookSourceReference(revision: string): string;
  sourceStandard(text: string, rules: unknown): string;
  assemblePrompt(kind: string, text: string, inspection: Record<string, unknown>, standard: unknown, sourceText: string): Record<string, unknown>;
};
