type MpvCommandResult = { ok: boolean; error?: string };
type MpvLoadResult = MpvCommandResult & { debug?: string | null };
type MpvPropertyResult = { ok: boolean; error?: string; value: string | number | boolean | null };
type MpvRenderResult = { ok: boolean; error?: string; frame: Uint8Array | null };

class MpvController {
  private static instance: MpvController | null = null;
  private ownerId: string | null = null;
  private initialized = false;

  static getInstance() {
    if (!MpvController.instance) {
      MpvController.instance = new MpvController();
    }
    return MpvController.instance;
  }

  canUse() {
    return Boolean(window.electronAPI?.mpvInit);
  }

  getDebugString() {
    const debug = window.electronAPI?.mpvDebug?.();
    if (!debug) return null;
    const addon = debug.addonPath || 'none';
    const addonErr = debug.addonError || 'none';
    const lib = debug.libPath || 'none';
    return `addon=${addon} err=${addonErr} lib=${lib}`;
  }

  acquire(ownerId: string, filePath?: string, opts?: { force?: boolean }): MpvLoadResult {
    if (!this.canUse()) {
      return { ok: false, error: 'addon_missing', debug: this.getDebugString() };
    }
    if (!filePath) {
      return { ok: false, error: 'missing_path', debug: this.getDebugString() };
    }
    if (this.ownerId && this.ownerId !== ownerId) {
      if (opts?.force) {
        this.stopInternal();
      } else {
        return { ok: false, error: 'busy', debug: this.getDebugString() };
      }
    }

    if (!this.initialized) {
      const initResult = window.electronAPI?.mpvInit?.();
      if (!initResult?.ok) {
        this.initialized = false;
        return { ok: false, error: initResult?.error || 'init_failed', debug: this.getDebugString() };
      }
      this.initialized = true;
    }

    const loadResult = window.electronAPI?.mpvLoad?.(filePath);
    if (!loadResult?.ok) {
      return { ok: false, error: loadResult?.error || 'load_failed', debug: this.getDebugString() };
    }

    this.ownerId = ownerId;
    return { ok: true };
  }

  command(ownerId: string, args: string[]): MpvCommandResult {
    if (!this.initialized) return { ok: false, error: 'not_ready' };
    if (this.ownerId !== ownerId) return { ok: false, error: 'not_owner' };
    return window.electronAPI?.mpvCommand?.(args) || { ok: false, error: 'addon_missing' };
  }

  getProperty(ownerId: string, name: string, type: string): MpvPropertyResult {
    if (!this.initialized) return { ok: false, error: 'not_ready', value: null };
    if (this.ownerId !== ownerId) return { ok: false, error: 'not_owner', value: null };
    return window.electronAPI?.mpvGetProperty?.(name, type) || { ok: false, error: 'addon_missing', value: null };
  }

  renderFrame(ownerId: string, width: number, height: number): MpvRenderResult {
    if (!this.initialized) return { ok: false, error: 'not_ready', frame: null };
    if (this.ownerId !== ownerId) return { ok: false, error: 'not_owner', frame: null };
    return window.electronAPI?.mpvRenderFrame?.(width, height) || { ok: false, error: 'addon_missing', frame: null };
  }

  release(ownerId: string) {
    if (this.ownerId !== ownerId) return { ok: false, error: 'not_owner' };
    this.stopInternal();
    return { ok: true };
  }

  stopAll() {
    this.stopInternal();
  }

  private stopInternal() {
    window.electronAPI?.mpvStop?.();
    this.ownerId = null;
  }
}

export const mpvController = MpvController.getInstance();
