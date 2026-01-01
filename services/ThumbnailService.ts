
import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, MAX_CONCURRENT_THUMBNAILS } from '../constants';

type ThumbnailCallback = (dataUrl: string, duration: number) => void;

class ThumbnailService {
  private queue: Array<{ url: string; fileKey: string; callback: ThumbnailCallback }> = [];
  private activeCount = 0;
  private cache = new Map<string, { dataUrl: string; duration: number }>();
  private pendingKeys = new Set<string>();
  private readonly MAX_CACHE_SIZE = 1000;

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
        // 简单的 LRU：如果缓存满了，清理最旧的一项
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
      setTimeout(() => this.processQueue(), 10); // 微调延迟，给予 UI 更多响应空间
    }
  }

  private createThumbnail(url: string): Promise<{ dataUrl: string; duration: number }> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.style.display = 'none';
      video.muted = true;
      video.src = url;
      video.preload = 'metadata';

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout"));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        video.onloadedmetadata = null;
        video.onloadeddata = null;
        video.onseeked = null;
        video.onerror = null;
        video.pause();
        video.src = "";
        video.load();
        video.remove();
      };

      video.onloadedmetadata = () => {
        const seekTime = Math.min(1, video.duration > 0 ? video.duration / 2 : 0);
        video.currentTime = seekTime;
      };

      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = THUMBNAIL_WIDTH;
        canvas.height = THUMBNAIL_HEIGHT;
        const ctx = canvas.getContext('2d', { alpha: false });

        if (!ctx) {
          cleanup();
          return reject(new Error("Canvas context failed"));
        }

        try {
          const videoWidth = video.videoWidth;
          const videoHeight = video.videoHeight;
          if (videoWidth === 0 || videoHeight === 0) {
            cleanup();
            return reject(new Error("Dimensions 0"));
          }

          const videoRatio = videoWidth / videoHeight;
          const canvasRatio = canvas.width / canvas.height;
          let drawWidth, drawHeight, offsetX, offsetY;

          if (videoRatio > canvasRatio) {
            drawHeight = canvas.height;
            drawWidth = drawHeight * videoRatio;
            offsetX = (canvas.width - drawWidth) / 2;
            offsetY = 0;
          } else {
            drawWidth = canvas.width;
            drawHeight = drawWidth / videoRatio;
            offsetX = 0;
            offsetY = (canvas.height - drawHeight) / 2;
          }

          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

          const dataUrl = canvas.toDataURL('image/jpeg', 0.5); 
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
        reject(new Error(`Video error`));
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
