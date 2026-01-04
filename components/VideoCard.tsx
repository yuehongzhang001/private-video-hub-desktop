
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { VideoItem } from '../types';
import { PREVIEW_DELAY } from '../constants';
import { thumbnailService } from '../services/ThumbnailService';

interface VideoCardProps {
  video: VideoItem;
  onClick: (video: VideoItem) => void;
  onMetadataLoaded: (id: string, thumbnail: string, duration: number) => void;
}

export const VideoCard = React.memo(({ video, onClick, onMetadataLoaded }: VideoCardProps) => {
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
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const previewUrl = useMemo(() => {
    if (!isHovered) return "";
    const startTime = (video.duration !== undefined && video.duration < 15) ? 1 : 10;
    return `${video.url}#t=${startTime}`;
  }, [video.url, video.duration, isHovered]);

  const handlePreviewLoadedMetadata = () => {
    const el = previewVideoRef.current;
    if (el && isFinite(el.duration)) {
      setPreviewDuration(el.duration);
    }
  };

  const handlePreviewTimeUpdate = () => {
    if (isPreviewScrubbing.current) return;
    const el = previewVideoRef.current;
    if (!el || !isFinite(el.duration) || el.duration <= 0) return;
    setPreviewProgress((el.currentTime / el.duration) * 100);
  };

  const handlePreviewSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setPreviewProgress(val);
    const el = previewVideoRef.current;
    if (el && isFinite(el.duration) && el.duration > 0) {
      el.currentTime = (val / 100) * el.duration;
    }
  };

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
      onClick={() => onClick(video)}
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

        {isHovered && previewUrl && (
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
          <p className="text-xs text-zinc-500 font-bold uppercase tracking-tight">
            {(video.size / (1024 * 1024)).toFixed(1)} MB
          </p>
          <div className="text-[10px] text-zinc-600 font-black uppercase tracking-widest">MP4</div>
        </div>
      </div>
    </div>
  );
});
