
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { VideoItem } from '../types';
import { PREVIEW_DELAY } from '../constants';
import { thumbnailService } from '../services/ThumbnailService';

interface VideoCardProps {
  video: VideoItem;
  onClick: (video: VideoItem) => void;
  onMetadataLoaded: (id: string, thumbnail: string, duration: number) => void;
}

export const VideoCard: React.FC<VideoCardProps> = ({ video, onClick, onMetadataLoaded }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [progressWidth, setProgressWidth] = useState(0);
  const hoverTimer = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!video.thumbnail) {
      thumbnailService.generate(video.url, video.id, (dataUrl, duration) => {
        onMetadataLoaded(video.id, dataUrl, duration);
      });
    }
  }, [video.id, video.thumbnail, video.url]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    // Use a small timeout to ensure the transition from 0% to 100% is visible
    setTimeout(() => {
      if (hoverTimer.current) setProgressWidth(100);
    }, 10);
    
    hoverTimer.current = window.setTimeout(() => {
      setShowPreview(true);
    }, PREVIEW_DELAY);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShowPreview(false);
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

  // Preview start time logic: 10s if duration >= 10s, else 0s
  const previewUrl = useMemo(() => {
    // If duration is not yet available, we default to 10s fragment (browser handles gracefully)
    // or use 0 if we know it's a short clip.
    const startTime = (video.duration !== undefined && video.duration < 10) ? 0 : 10;
    return `${video.url}#t=${startTime}`;
  }, [video.url, video.duration]);

  return (
    <div 
      className="group relative flex flex-col bg-zinc-900 rounded-lg overflow-hidden cursor-pointer transition-transform duration-200 hover:scale-[1.02] hover:shadow-xl hover:shadow-black/50 border border-zinc-800"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => onClick(video)}
    >
      <div className="aspect-video relative bg-black overflow-hidden">
        {video.thumbnail ? (
          <img 
            src={video.thumbnail} 
            alt={video.name}
            className={`w-full h-full object-cover transition-opacity duration-300 ${showPreview ? 'opacity-0' : 'opacity-100'}`}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-200 rounded-full animate-spin" />
          </div>
        )}

        {/* Preview Progress Bar (Visible during hover delay) */}
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

        {showPreview && (
          <video
            ref={videoRef}
            src={previewUrl}
            autoPlay
            muted
            loop
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        <div className="absolute bottom-2 right-2 bg-black/70 px-1.5 py-0.5 rounded text-[10px] font-medium text-white backdrop-blur-sm z-10">
          {formatDuration(video.duration)}
        </div>
      </div>

      <div className="p-3">
        <h3 className="text-sm font-medium text-zinc-200 truncate group-hover:text-white" title={video.name}>
          {video.name}
        </h3>
        <p className="text-[11px] text-zinc-500 mt-1 uppercase">
          {(video.size / (1024 * 1024)).toFixed(1)} MB
        </p>
      </div>
    </div>
  );
};
