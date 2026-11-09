export type StorageMode = 'mock' | 'live';

export interface StorageInfo {
  storage: StorageMode;
  label: string;
}

export type GeminiMode = 'off' | 'mock' | 'live';
export type NotebookLMMode = 'off' | 'mock' | 'live';

export interface OperationsInfo extends StorageInfo {
  gemini_mode: GeminiMode;
  gemini_label: string;
}

export interface NotebookLMInfo {
  notebooklm_mode: NotebookLMMode;
  notebooklm_label: string;
}

export function getStorageInfo(): StorageInfo {
  if (process.env.STORAGE_MODE === 'live') {
    return { storage: 'live', label: 'Google 시트·드라이브(live)' };
  }

  return { storage: 'mock', label: '내 컴퓨터(mock)' };
}

export function getGeminiInfo(): Pick<OperationsInfo, 'gemini_mode' | 'gemini_label'> {
  const storage = getStorageInfo().storage;
  const configuredMode = process.env.GEMINI_MODE;
  const mode: GeminiMode = configuredMode
    ? (configuredMode as GeminiMode)
    : storage === 'live'
      ? 'live'
      : 'off';
  const labels: Record<GeminiMode, string> = {
    off: '꺼짐(off)',
    mock: '연습용(mock)',
    live: '실제 Gemini(live)',
  };

  return { gemini_mode: mode, gemini_label: labels[mode] };
}

export function getNotebookLMInfo(): NotebookLMInfo {
  const storage = getStorageInfo().storage;
  const configuredMode = process.env.NOTEBOOKLM_MODE;
  const mode: NotebookLMMode = configuredMode
    ? (configuredMode as NotebookLMMode)
    : storage === 'mock'
      ? 'mock'
      : 'off';
  const labels: Record<NotebookLMMode, string> = {
    off: '근거 대조 꺼짐(off)',
    mock: '모의 응답(mock)',
    live: '실제 질의(live)',
  };

  return { notebooklm_mode: mode, notebooklm_label: labels[mode] };
}

export function validateNotebookLMMode(): void {
  const storage = getStorageInfo().storage;
  const mode = process.env.NOTEBOOKLM_MODE;
  const resolvedMode = mode || (storage === 'mock' ? 'mock' : 'off');
  const validModes = ['off', 'mock', 'live'];
  const compatible = storage === 'mock' || resolvedMode !== 'mock';

  if (!validModes.includes(resolvedMode) || !compatible) {
    throw new Error(
      'NOTEBOOKLM_MODE 설정을 확인하세요. STORAGE_MODE=mock에는 off, mock, live를, STORAGE_MODE=live에는 off 또는 live를 사용할 수 있습니다.',
    );
  }
}

export function validateGeminiMode(): void {
  const storage = getStorageInfo().storage;
  const mode = process.env.GEMINI_MODE;
  const resolvedMode = mode || (storage === 'live' ? 'live' : 'off');
  const validModes = ['off', 'mock', 'live'];
  const compatible =
    resolvedMode === 'off' ||
    (storage === 'mock' && resolvedMode === 'mock') ||
    (storage === 'live' && resolvedMode === 'live');

  if (!validModes.includes(resolvedMode) || !compatible) {
    throw new Error(
      'GEMINI_MODE 설정을 확인하세요. STORAGE_MODE=mock에는 off 또는 mock, STORAGE_MODE=live에는 off 또는 live를 사용할 수 있습니다.',
    );
  }
}

export function getOperationsInfo(): OperationsInfo {
  return { ...getStorageInfo(), ...getGeminiInfo() };
}
