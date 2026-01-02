
import { MAX_CONCURRENT_THUMBNAILS } from '../constants';

type ThumbnailCallback = (dataUrl: string, duration: number) => void;

class ThumbnailService {
  private queue: Array<{ url: string; fileKey: string; callback: ThumbnailCallback }> = [];
  private activeCount = 0;
  private cache = new Map<string, { dataUrl: string; duration: number }>();
  private pendingKeys = new Set<string>();
  private readonly MAX_CACHE_SIZE = 500;
  async generate(url: string, fileKey: string, callback: ThumbnailCallback) {
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
      const result = await this.createThumbnail(task.url);
      task.callback(result.dataUrl, result.duration);
    } catch (err) {
      console.warn(`Thumbnail failed: ${task.fileKey}`, err instanceof Error ? err.message : err);
      task.callback('', 0);
    } finally {
      this.activeCount--;
      requestAnimationFrame(() => this.processQueue());
    }
  }

  private createThumbnail(url: string): Promise<{ dataUrl: string; duration: number }> {
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
        reject(new Error("Timeout"));
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
          return reject(new Error("Dimensions 0"));
        }

        // 核心变更：固定高度，计算宽度，实现按高度填充
        const TARGET_HEIGHT = 360;
        const targetH = TARGET_HEIGHT;
        const targetW = (videoWidth * TARGET_HEIGHT) / videoHeight;

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(targetW);
        canvas.height = Math.round(targetH);
        
        const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!ctx) {
          cleanup();
          return reject(new Error("Canvas context failed"));
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
        reject(new Error(`Video load error`));
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
