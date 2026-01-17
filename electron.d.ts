// 全局类型定义，用于 Electron API
export {};

declare global {
  interface Window {
    electronAPI?: {
      openDirectory: () => Promise<string[] | null>;
      openDirectoryFiles?: (extensions: string[]) => Promise<{
        dirs: string[];
        files: Array<{
          path: string;
          url: string;
          name: string;
          size: number;
          lastModified: number;
        }>;
      } | null>;
      scanDirectoryFiles?: (dirs: string[], extensions: string[]) => Promise<{
        ok: boolean;
        files?: Array<{
          path: string;
          url: string;
          name: string;
          size: number;
          lastModified: number;
        }>;
        error?: string;
      }>;
      createThumbnail?: (inputPath: string, options?: { outputPath?: string; width?: number; height?: number; quality?: number }) => Promise<{ ok: boolean; error?: string; outputPath?: string; dataUrl?: string; duration?: number }>;
      trashItem?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      toggleAppFullscreen?: () => Promise<{ ok: boolean; isFullscreen: boolean }>;
      getAppFullscreen?: () => Promise<{ ok: boolean; isFullscreen: boolean }>;
      playWithMpv?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      mpvInit?: () => { ok: boolean; error?: string };
      mpvLoad?: (filePath: string) => { ok: boolean; error?: string };
      mpvStop?: () => { ok: boolean; error?: string };
      mpvCommand?: (args: string[]) => { ok: boolean; error?: string };
      mpvGetProperty?: (name: string, type: string) => { ok: boolean; error?: string; value: string | number | boolean | null };
      mpvRenderFrame?: (width: number, height: number) => { ok: boolean; error?: string; frame: Uint8Array | null };
      mpvDestroy?: () => { ok: boolean; error?: string };
      mpvDebug?: () => { addonPath: string | null; addonError: string | null; libPath: string | undefined };
      favoritesFetchMeta?: (url: string) => Promise<{
        ok: boolean;
        error?: string;
        data?: {
          title?: string;
          duration?: string;
          image?: string;
          siteName?: string;
          siteIconUrl?: string;
        };
      }>;
      favoritesImportCover?: (sourcePath: string) => Promise<{
        ok: boolean;
        error?: string;
        path?: string;
        url?: string;
      }>;
      getAppState?: () => Promise<{
        ok: boolean;
        state?: {
          lastImportDirs?: string[];
          videoStats?: Record<string, { clicks: number; lastOpenedAt?: number }>;
        };
        error?: string;
      }>;
      setLastImportDirs?: (dirs: string[]) => Promise<{ ok: boolean; error?: string }>;
      setVideoStats?: (stats: Record<string, { clicks: number; lastOpenedAt?: number }>) => Promise<{ ok: boolean; error?: string }>;
      onFavoritesImport?: (handler: (payload: unknown) => void) => () => void;
      onAppFullscreenChange?: (handler: (isFullscreen: boolean) => void) => () => void;
    };
  }
}
