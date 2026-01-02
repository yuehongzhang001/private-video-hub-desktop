// 全局类型定义，用于 Electron API
export {};

declare global {
  interface Window {
    electronAPI?: {
      openDirectory: () => Promise<string[] | null>;
      openDirectoryFiles?: (extensions: string[]) => Promise<Array<{
        path: string;
        url: string;
        name: string;
        size: number;
        lastModified: number;
      }> | null>;
      playWithMpv?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      mpvInit?: () => { ok: boolean; error?: string };
      mpvLoad?: (filePath: string) => { ok: boolean; error?: string };
      mpvStop?: () => { ok: boolean; error?: string };
      mpvCommand?: (args: string[]) => { ok: boolean; error?: string };
      mpvGetProperty?: (name: string, type: string) => { ok: boolean; error?: string; value: string | number | boolean | null };
      mpvRenderFrame?: (width: number, height: number) => { ok: boolean; error?: string; frame: Uint8Array | null };
      mpvDestroy?: () => { ok: boolean; error?: string };
      mpvDebug?: () => { addonPath: string | null; addonError: string | null; libPath: string | undefined };
    };
  }
}
