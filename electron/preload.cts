import { contextBridge, ipcRenderer } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';

type MpvAddon = {
  init: (libPath?: string) => boolean;
  createPlayer: () => boolean;
  loadFile: (filePath: string) => boolean;
  stop: () => boolean;
  command: (args: string[]) => boolean;
  getProperty: (name: string, type: string) => string | number | boolean | null;
  renderFrame: (width: number, height: number) => Uint8Array;
  destroy: () => boolean;
};

const report = (channel: string, payload: unknown) => {
  try {
    ipcRenderer.send(channel, payload);
  } catch {
    // ignore
  }
};

console.log('[preload] begin', { sandboxed: process.sandboxed, contextIsolated: process.contextIsolated });
report('preload:begin', { sandboxed: process.sandboxed, contextIsolated: process.contextIsolated });

const nodeRequire = createRequire(__filename);

const resolveAddonPath = () => {
  const candidates = [
    path.join(process.cwd(), 'native', 'mpv', 'build', 'Release', 'mpvaddon.node'),
    path.join(process.resourcesPath, 'mpv', 'mpvaddon.node')
  ];

  return candidates.find(candidate => fs.existsSync(candidate));
};

const resolveLibmpvPath = () => {
  const candidates = [
    process.env.LIBMPV_PATH,
    path.join(process.cwd(), 'libmpv', 'win', 'libmpv-2.dll'),
    path.join(process.cwd(), 'libmpv', 'win', 'mpv-2.dll'),
    path.join(process.cwd(), 'libmpv', 'mac', 'libmpv.2.dylib'),
    path.join(process.cwd(), 'libmpv', 'mac', 'libmpv.dylib'),
    path.join(process.resourcesPath, 'libmpv', 'libmpv-2.dll'),
    path.join(process.resourcesPath, 'libmpv', 'mpv-2.dll'),
    path.join(process.resourcesPath, 'Frameworks', 'libmpv.2.dylib'),
    path.join(process.resourcesPath, 'Frameworks', 'libmpv.dylib')
  ].filter(Boolean) as string[];

  return candidates.find(candidate => fs.existsSync(candidate));
};

let mpvAddon: MpvAddon | null = null;
let mpvAddonPath: string | null = null;
let mpvAddonError: string | null = null;
try {
  mpvAddonPath = resolveAddonPath() || null;
  if (mpvAddonPath) {
    mpvAddon = nodeRequire(mpvAddonPath) as MpvAddon;
  }
} catch (err) {
  mpvAddonError = err instanceof Error ? err.message : String(err);
  mpvAddon = null;
}

try {
  // Expose protected methods that allow the renderer process to use
  // the ipcRenderer without exposing the entire object
  contextBridge.exposeInMainWorld('electronAPI', {
    openDirectory: () => {
      console.log('[preload] openDirectory');
      return ipcRenderer.invoke('dialog:openDirectory');
    },
    openDirectoryFiles: (extensions: string[]) => {
      console.log('[preload] openDirectoryFiles', extensions);
      return ipcRenderer.invoke('dialog:openDirectoryFiles', extensions);
    },
    createThumbnail: (inputPath: string, options?: { outputPath?: string; width?: number; height?: number; quality?: number }) => {
      return ipcRenderer.invoke('ffmpeg:thumbnail', { inputPath, ...(options || {}) });
    },
    playWithMpv: (filePath: string) => ipcRenderer.invoke('mpv:play', filePath),
    mpvInit: () => {
      if (!mpvAddon) return { ok: false, error: 'addon_missing' };
      try {
        const libPath = resolveLibmpvPath();
        mpvAddon.init(libPath);
        mpvAddon.createPlayer();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    mpvLoad: (filePath: string) => {
      if (!mpvAddon) return { ok: false, error: 'addon_missing' };
      try {
        mpvAddon.loadFile(filePath);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    mpvStop: () => {
      if (!mpvAddon) return { ok: false, error: 'addon_missing' };
      try {
        mpvAddon.stop();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    mpvCommand: (args: string[]) => {
      if (!mpvAddon) return { ok: false, error: 'addon_missing' };
      try {
        mpvAddon.command(args);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    mpvGetProperty: (name: string, type: string) => {
      if (!mpvAddon) return { ok: false, error: 'addon_missing', value: null };
      try {
        const value = mpvAddon.getProperty(name, type);
        return { ok: true, value };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), value: null };
      }
    },
    mpvRenderFrame: (width: number, height: number) => {
      if (!mpvAddon) return { ok: false, error: 'addon_missing', frame: null };
      try {
        const frame = mpvAddon.renderFrame(width, height);
        return { ok: true, frame };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), frame: null };
      }
    },
    mpvDestroy: () => {
      if (!mpvAddon) return { ok: false, error: 'addon_missing' };
      try {
        mpvAddon.destroy();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    mpvDebug: () => ({
      addonPath: mpvAddonPath,
      addonError: mpvAddonError,
      libPath: resolveLibmpvPath()
    }),
    // 可以在这里添加更多的 API
  });

  report('preload:ready', {
    ok: true,
    addonPath: mpvAddonPath,
    addonError: mpvAddonError,
    libPath: resolveLibmpvPath(),
    sandboxed: process.sandboxed
  });
  console.log('[preload] exposed');
} catch (err) {
  report('preload:error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : null
  });
}
