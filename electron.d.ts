// 全局类型定义，用于 Electron API
export {};

declare global {
  interface Window {
    electronAPI?: {
      openDirectory: () => Promise<string[] | null>;
      playWithMpv?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
