
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
  const hoverTimer = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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
            src={previewUrl}
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            onPlaying={() => setPreviewReady(true)}
            className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-700 z-10 ${showPreview && previewReady ? 'opacity-100' : 'opacity-0'}`}
          />
        )}

        <div className="absolute bottom-3 right-3 bg-black/80 px-3 py-1 rounded-lg text-xs font-bold text-white backdrop-blur-md z-20 border border-white/10">
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
