
import { THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, MAX_CONCURRENT_THUMBNAILS } from '../constants';

type ThumbnailCallback = (dataUrl: string, duration: number) => void;

class ThumbnailService {
  private queue: Array<{ url: string; fileKey: string; callback: ThumbnailCallback }> = [];
  private activeCount = 0;
  private cache = new Map<string, { dataUrl: string; duration: number }>();
  private pendingKeys = new Set<string>();
  private readonly MAX_CACHE_SIZE = 500; // 减小缓存限制，缓解超大库时的内存占用

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
      // 给主线程喘息机会
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
      video.preload = 'metadata';

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout"));
      }, 8000);

      const cleanup = () => {
        clearTimeout(timeoutId);
        video.onloadedmetadata = null;
        video.onseeked = null;
        video.onerror = null;
        video.pause();
        video.removeAttribute('src'); // 强制释放资源
        video.load();
        video.remove();
      };

      video.onloadedmetadata = () => {
        // 取中间帧，但稍微避开开头
        const seekTime = Math.min(1.5, video.duration > 3 ? 1.5 : 0);
        video.currentTime = seekTime;
      };

      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = THUMBNAIL_WIDTH;
        canvas.height = THUMBNAIL_HEIGHT;
        const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

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

          // 进一步降低质量以提高超大库时的性能 (0.5 -> 0.4)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.4); 
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
