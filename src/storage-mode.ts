export type StorageMode = 'mock' | 'live';

export interface StorageInfo {
  storage: StorageMode;
  label: string;
}

export function getStorageInfo(): StorageInfo {
  if (process.env.STORAGE_MODE === 'live') {
    return { storage: 'live', label: 'Google 시트·드라이브(live)' };
  }

  return { storage: 'mock', label: '내 컴퓨터(mock)' };
}
