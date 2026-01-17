
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { VideoItem } from '../types';
import { PREVIEW_DELAY, HTML_VIDEO_PREVIEW_EXTENSIONS } from '../constants';
import { thumbnailService } from '../services/ThumbnailService';
import { mpvController } from '../services/MpvController';

interface VideoCardProps {
  video: VideoItem;
  clickCount: number;
  onClick: (video: VideoItem) => void;
  onMetadataLoaded: (id: string, thumbnail: string, duration: number) => void;
}

export const VideoCard = React.memo(({ video, clickCount, onClick, onMetadataLoaded }: VideoCardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [progressWidth, setProgressWidth] = useState(0);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const isPreviewScrubbing = useRef(false);
  const mpvCanvasRef = useRef<HTMLCanvasElement>(null);
  const mpvPreviewRafRef = useRef<number | null>(null);
  const mpvPreviewPollRef = useRef<number | null>(null);
  const mpvOwnerRef = useRef<string>(`grid-preview-${video.id}-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (video.thumbnail) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        thumbnailService.generate(video.url, video.id, (dataUrl, duration) => {
          onMetadataLoaded(video.id, dataUrl, duration);
        }, video.path);
        observer.disconnect();
      }
    }, { 
      threshold: 0.01, 
      rootMargin: '400px'
    });

    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [video.id, video.thumbnail, video.url, onMetadataLoaded]);

  const stopMpvPreview = useCallback(() => {
    if (mpvPreviewRafRef.current) {
      cancelAnimationFrame(mpvPreviewRafRef.current);
      mpvPreviewRafRef.current = null;
    }
    if (mpvPreviewPollRef.current) {
      window.clearInterval(mpvPreviewPollRef.current);
      mpvPreviewPollRef.current = null;
    }
    mpvController.release(mpvOwnerRef.current);
  }, []);

  const handleMouseEnter = () => {
    setIsHovered(true);
    setPreviewReady(false);
    requestAnimationFrame(() => setProgressWidth(100));
    hoverTimer.current = window.setTimeout(() => {
      setShowPreview(true);
    }, PREVIEW_DELAY);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShowPreview(false);
    setPreviewReady(false);
    setProgressWidth(0);
    setPreviewProgress(0);
    setPreviewDuration(null);
    isPreviewScrubbing.current = false;
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    stopMpvPreview();
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getExtension = (value?: string) => {
    if (!value) return 'VIDEO';
    const lastSegment = value.split(/[\\/]/).pop() || value;
    const dotIndex = lastSegment.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return 'VIDEO';
    return lastSegment.slice(dotIndex + 1).toUpperCase();
  };

  const videoExt = useMemo(() => getExtension(video.name || video.path), [video.name, video.path]);
  const getExtensionKey = (value?: string) => {
    if (!value) return '';
    const lastSegment = value.split(/[\\/]/).pop() || value;
    const dotIndex = lastSegment.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return '';
    return lastSegment.slice(dotIndex).toLowerCase();
  };
  const videoExtKey = useMemo(() => getExtensionKey(video.name || video.path), [video.name, video.path]);
  const preferMpvPreview = useMemo(
    () => !HTML_VIDEO_PREVIEW_EXTENSIONS.has(videoExtKey) && mpvController.canUse() && Boolean(video.path),
    [videoExtKey, video.path]
  );

  const previewUrl = useMemo(() => {
    if (!isHovered || preferMpvPreview) return "";
    const startTime = (video.duration !== undefined && video.duration < 15) ? 1 : 10;
    return `${video.url}#t=${startTime}`;
  }, [video.url, video.duration, isHovered, preferMpvPreview]);

  const handlePreviewLoadedMetadata = () => {
    if (preferMpvPreview) return;
    const el = previewVideoRef.current;
    if (el && isFinite(el.duration)) {
      setPreviewDuration(el.duration);
    }
  };

  const handlePreviewTimeUpdate = () => {
    if (isPreviewScrubbing.current || preferMpvPreview) return;
    const el = previewVideoRef.current;
    if (!el || !isFinite(el.duration) || el.duration <= 0) return;
    setPreviewProgress((el.currentTime / el.duration) * 100);
  };

  const handlePreviewSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setPreviewProgress(val);
    if (preferMpvPreview) {
      if (previewDuration && previewDuration > 0) {
        const target = (val / 100) * previewDuration;
        mpvController.command(mpvOwnerRef.current, ['seek', target.toString(), 'absolute', 'keyframes']);
      }
      return;
    }
    const el = previewVideoRef.current;
    if (el && isFinite(el.duration) && el.duration > 0) {
      el.currentTime = (val / 100) * el.duration;
    }
  };

  useEffect(() => {
    if (!preferMpvPreview || !showPreview || !video.path) {
      stopMpvPreview();
      return;
    }

    const acquireResult = mpvController.acquire(mpvOwnerRef.current, video.path, { force: false });
    if (!acquireResult.ok) {
      setPreviewReady(false);
      return () => stopMpvPreview();
    }

    mpvController.command(mpvOwnerRef.current, ['set', 'mute', 'yes']);
    mpvController.command(mpvOwnerRef.current, ['set', 'pause', 'no']);

    const canvas = mpvCanvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !ctx) {
      stopMpvPreview();
      return;
    }

    let imageData: ImageData | null = null;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      const result = mpvController.renderFrame(mpvOwnerRef.current, width, height);
      if (result?.ok && result.frame && result.frame.length === width * height * 4) {
        if (!imageData || imageData.width !== width || imageData.height !== height) {
          imageData = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
        }
        imageData.data.set(result.frame);
        ctx.putImageData(imageData, 0, 0);
        setPreviewReady(true);
      }

      mpvPreviewRafRef.current = requestAnimationFrame(render);
    };

    mpvPreviewRafRef.current = requestAnimationFrame(render);
    mpvPreviewPollRef.current = window.setInterval(() => {
      const durationRes = mpvController.getProperty(mpvOwnerRef.current, 'duration', 'double');
      if (durationRes?.ok && typeof durationRes.value === 'number' && durationRes.value > 0) {
        setPreviewDuration(durationRes.value);
      }
      const timeRes = mpvController.getProperty(mpvOwnerRef.current, 'time-pos', 'double');
      if (
        !isPreviewScrubbing.current &&
        durationRes?.ok &&
        typeof durationRes.value === 'number' &&
        durationRes.value > 0 &&
        timeRes?.ok &&
        typeof timeRes.value === 'number'
      ) {
        setPreviewProgress((timeRes.value / durationRes.value) * 100);
      }
    }, 200);

    return () => {
      stopMpvPreview();
      setPreviewReady(false);
    };
  }, [preferMpvPreview, showPreview, video.path, stopMpvPreview]);

  useEffect(() => () => stopMpvPreview(), [stopMpvPreview]);

  const handleCardClick = useCallback(() => {
    if (preferMpvPreview) {
      // Ensure playback state is reset before entering the player page.
      mpvController.command(mpvOwnerRef.current, ['seek', '0', 'absolute', 'keyframes']);
      mpvController.command(mpvOwnerRef.current, ['set', 'pause', 'yes']);
      stopMpvPreview();
    }
    onClick(video);
  }, [preferMpvPreview, stopMpvPreview, onClick, video]);

  return (
    <div 
      ref={cardRef}
      style={{ 
        contentVisibility: 'auto',
        containIntrinsicSize: '0 280px',
        transform: 'translateZ(0)',
      }}
      className="group relative flex flex-col bg-zinc-900 rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover:scale-[1.03] hover:shadow-2xl hover:shadow-black/60 border border-zinc-800 hover:border-indigo-500/50"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleCardClick}
    >
      <div className="relative bg-black overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
        {video.thumbnail ? (
          <img 
            src={video.thumbnail} 
            alt={video.name}
            loading="lazy"
            decoding="async"
            className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ${(showPreview && previewReady) ? 'opacity-30' : 'opacity-100'}`}
          />
        ) : (
          <div className="absolute inset-0 w-full h-full flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-200 rounded-full animate-spin" />
          </div>
        )}

        {isHovered && !showPreview && (
          <div className="absolute top-0 left-0 w-full h-1 bg-zinc-800/50 z-20">
            <div 
              className="h-full bg-indigo-500 transition-all ease-linear"
              style={{ 
                width: `${progressWidth}%`,
                transitionDuration: progressWidth > 0 ? `${PREVIEW_DELAY}ms` : '0ms' 
              }}
            />
          </div>
        )}

        {isHovered && preferMpvPreview && (
          <canvas
            ref={mpvCanvasRef}
            className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-700 z-10 ${(showPreview && previewReady) ? 'opacity-100' : 'opacity-0'}`}
          />
        )}

        {isHovered && !preferMpvPreview && previewUrl && (
          <video
            ref={previewVideoRef}
            src={previewUrl}
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            onPlaying={() => setPreviewReady(true)}
            onLoadedMetadata={handlePreviewLoadedMetadata}
            onTimeUpdate={handlePreviewTimeUpdate}
            className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-700 z-10 ${showPreview && previewReady ? 'opacity-100' : 'opacity-0'}`}
          />
        )}

        {isHovered && showPreview && previewReady && previewDuration && (
          <div className="absolute bottom-0 left-0 right-0 px-2 pb-2 pt-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent z-20">
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={previewProgress}
              onChange={handlePreviewSeek}
              onPointerDown={(e) => { e.stopPropagation(); isPreviewScrubbing.current = true; }}
              onPointerUp={(e) => { e.stopPropagation(); isPreviewScrubbing.current = false; (e.currentTarget as HTMLInputElement).blur(); }}
              onPointerCancel={(e) => { e.stopPropagation(); isPreviewScrubbing.current = false; }}
              onClick={(e) => e.stopPropagation()}
              className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-indigo-500 bg-zinc-700/60 outline-none focus:outline-none"
            />
          </div>
        )}

        <div className="absolute top-3 right-3 bg-black/80 px-3 py-1 rounded-lg text-xs font-bold text-white backdrop-blur-md z-20 border border-white/10">
          {formatDuration(video.duration)}
        </div>
      </div>
      <div className="p-4 bg-gradient-to-b from-zinc-900 to-zinc-950">
        <h3 className="text-base font-bold text-zinc-200 truncate group-hover:text-white transition-colors" title={video.name}>
          {video.name}
        </h3>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-zinc-500 font-bold uppercase tracking-tight flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
              <circle cx="12" cy="12" r="3" strokeWidth={2.5} />
            </svg>
            {clickCount}
          </p>
          <div className="text-[10px] text-zinc-600 font-black uppercase tracking-widest">{videoExt}</div>
        </div>
      </div>
    </div>
  );
});
