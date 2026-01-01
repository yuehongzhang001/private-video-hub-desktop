
import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, MAX_CONCURRENT_THUMBNAILS } from '../constants';

type ThumbnailCallback = (dataUrl: string, duration: number) => void;

class ThumbnailService {
  private queue: Array<{ url: string; fileKey: string; callback: ThumbnailCallback }> = [];
  private activeCount = 0;
  private cache = new Map<string, { dataUrl: string; duration: number }>();
  private pendingKeys = new Set<string>();

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
      // 使用更短的超时逻辑加速处理过程
      const result = await this.createThumbnail(task.url);
      task.callback(result.dataUrl, result.duration);
    } catch (err) {
      console.warn(`Thumbnail failed: ${task.fileKey}`, err instanceof Error ? err.message : err);
      task.callback('', 0);
    } finally {
      this.activeCount--;
      // 这里的 setTimeout 给主线程喘息机会，防止连续任务导致 UI 掉帧
      setTimeout(() => this.processQueue(), 0);
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
      }, 10000); // 缩短为10秒

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

          const dataUrl = canvas.toDataURL('image/jpeg', 0.5); // 降低质量进一步节省内存
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
