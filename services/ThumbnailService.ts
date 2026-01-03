import { MAX_CONCURRENT_THUMBNAILS, THUMBNAIL_GENERATOR } from '../constants';

type ThumbnailCallback = (dataUrl: string, duration: number) => void;

type ThumbnailTask = {
  url: string;
  fileKey: string;
  filePath?: string;
  callback: ThumbnailCallback;
};

class ThumbnailService {
  private queue: ThumbnailTask[] = [];
  private activeCount = 0;
  private cache = new Map<string, { dataUrl: string; duration: number }>();
  private pendingKeys = new Set<string>();
  private readonly MAX_CACHE_SIZE = 500;
  private readonly TARGET_HEIGHT = 360;

  async generate(url: string, fileKey: string, callback: ThumbnailCallback, filePath?: string) {
    if (this.cache.has(fileKey)) {
      const cached = this.cache.get(fileKey)!;
      callback(cached.dataUrl, cached.duration);
      return;
    }

    if (this.pendingKeys.has(fileKey)) {
      return;
    }

    this.pendingKeys.add(fileKey);
    this.queue.push({
      url,
      fileKey,
      filePath,
      callback: (data, dur) => {
        if (this.cache.size >= this.MAX_CACHE_SIZE) {
          const firstKey = this.cache.keys().next().value;
          if (firstKey) this.cache.delete(firstKey);
        }

        this.cache.set(fileKey, { dataUrl: data, duration: dur });
        this.pendingKeys.delete(fileKey);
        callback(data, dur);
      }
    });
    this.processQueue();
  }

  private async processQueue() {
    if (this.activeCount >= MAX_CONCURRENT_THUMBNAILS || this.queue.length === 0) return;

    const task = this.queue.shift();
    if (!task) return;

    this.activeCount++;

    try {
      const result = await this.createThumbnail(task.url, task.filePath);
      task.callback(result.dataUrl, result.duration);
    } catch (err) {
      console.warn(`Thumbnail failed: ${task.fileKey}`, err instanceof Error ? err.message : err);
      task.callback('', 0);
    } finally {
      this.activeCount--;
      requestAnimationFrame(() => this.processQueue());
    }
  }

  private async createThumbnail(url: string, filePath?: string): Promise<{ dataUrl: string; duration: number }> {
    if (THUMBNAIL_GENERATOR === 'ffmpeg') {
      const ffmpegResult = await this.createThumbnailWithFfmpeg(url, filePath);
      if (ffmpegResult) return ffmpegResult;
    }

    return await this.createThumbnailInBrowser(url);
  }

  private async createThumbnailWithFfmpeg(url: string, filePath?: string) {
    if (!filePath || !window.electronAPI?.createThumbnail) return null;

    const durationPromise = this.getDurationFromMetadata(url);

    try {
      const result = await window.electronAPI.createThumbnail(filePath, {
        height: this.TARGET_HEIGHT,
        quality: 2
      });
      const duration = typeof result?.duration === 'number' ? result.duration : await durationPromise;

      if (!result?.ok || !result.dataUrl) return null;
      return { dataUrl: result.dataUrl, duration };
    } catch (err) {
      console.warn('FFmpeg thumbnail failed', err instanceof Error ? err.message : err);
      return null;
    }
  }

  private getDurationFromMetadata(url: string): Promise<number> {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.style.display = 'none';
      video.preload = 'metadata';
      video.muted = true;
      video.setAttribute('webkit-playsinline', 'true');
      video.setAttribute('playsinline', 'true');
      video.src = url;

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve(0);
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
        video.remove();
      };

      video.onloadedmetadata = () => {
        const duration = isFinite(video.duration) ? video.duration : 0;
        cleanup();
        resolve(duration);
      };

      video.onerror = () => {
        cleanup();
        resolve(0);
      };
    });
  }

  private createThumbnailInBrowser(url: string): Promise<{ dataUrl: string; duration: number }> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.style.display = 'none';
      video.muted = true;
      video.setAttribute('webkit-playsinline', 'true');
      video.setAttribute('playsinline', 'true');
      video.src = url;
      video.preload = 'auto';

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout'));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        video.onloadeddata = null;
        video.onseeked = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.remove();
      };

      video.onloadeddata = () => {
        setTimeout(() => {
          const seekTime = Math.min(1.5, video.duration > 3 ? 1.5 : 0);
          video.currentTime = seekTime;
        }, 100);
      };

      video.onseeked = () => {
        const videoWidth = video.videoWidth;
        const videoHeight = video.videoHeight;

        if (videoWidth === 0 || videoHeight === 0) {
          cleanup();
          return reject(new Error('Dimensions 0'));
        }

        const targetH = this.TARGET_HEIGHT;
        const targetW = (videoWidth * targetH) / videoHeight;

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(targetW);
        canvas.height = Math.round(targetH);

        const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!ctx) {
          cleanup();
          return reject(new Error('Canvas context failed'));
        }

        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
          const duration = video.duration;

          cleanup();
          resolve({ dataUrl, duration });
        } catch (e) {
          cleanup();
          reject(e);
        }
      };

      video.onerror = () => {
        cleanup();
        reject(new Error('Video load error'));
      };
    });
  }

  clearCache() {
    this.cache.clear();
    this.pendingKeys.clear();
    this.queue = [];
  }
}

export const thumbnailService = new ThumbnailService();
