
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { VideoItem, SortMode, DisplaySize } from '../types';
import { PREVIEW_DELAY } from '../constants';
import { thumbnailService } from '../services/ThumbnailService';
import { translations, Language } from '../translations';

interface VideoPlayerProps {
  video: VideoItem;
  allVideos: VideoItem[];
  lang: Language;
  onClose: () => void;
  onSelectVideo: (video: VideoItem) => void;
  onMetadataLoaded: (id: string, thumbnail: string, duration: number) => void;
}

const PLAYLIST_SORT_STORAGE_KEY = 'playlist-sort-mode';
const DISPLAY_SIZE_STORAGE_KEY = 'vhub-display-size';
const AUTO_HIDE_TIMEOUT = 3000;

const PlaylistItem = React.memo(({
  v, isActive, onClick, formatDuration, onMetadataLoaded 
}: {
  v: VideoItem;
  isActive: boolean;
  onClick: () => void;
  formatDuration: (s?: number) => string;
  onMetadataLoaded: (id: string, thumbnail: string, duration: number) => void;
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [progressWidth, setProgressWidth] = useState(0);
  const hoverTimer = useRef<number | null>(null);
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (v.thumbnail) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          thumbnailService.generate(v.url, v.id, (dataUrl, duration) => {
            onMetadataLoaded(v.id, dataUrl, duration);
          });
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );
    if (itemRef.current) observer.observe(itemRef.current);
    return () => observer.disconnect();
  }, [v.id, v.thumbnail, v.url]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    setTimeout(() => { if (hoverTimer.current) setProgressWidth(100); }, 10);
    hoverTimer.current = window.setTimeout(() => setShowPreview(true), PREVIEW_DELAY);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShowPreview(false);
    setProgressWidth(0);
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };

  const previewUrl = useMemo(() => {
    const startTime = (v.duration !== undefined && v.duration < 10) ? 0 : 10;
    return `${v.url}#t=${startTime}`;
  }, [v.url, v.duration]);

  return (
    <div 
      ref={itemRef}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex flex-col p-2 cursor-pointer transition-all border-b border-zinc-900/30 group ${isActive ? 'bg-indigo-600/10 border-l-4 border-l-indigo-500' : 'hover:bg-white/5'}`}
    >
      <div className="aspect-video bg-black rounded-lg overflow-hidden relative border border-zinc-900 shadow-md">
        {v.thumbnail ? (
          <img 
            src={v.thumbnail} 
            loading="lazy"
            decoding="async"
            className={`w-full h-full object-cover transition-opacity duration-300 ${showPreview ? 'opacity-0' : (isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-100')}`} 
            alt="" 
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-zinc-800 border-t-zinc-600 rounded-full animate-spin"/>
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
        {showPreview && (
          <video src={previewUrl} autoPlay muted loop className="absolute inset-0 w-full h-full object-cover" />
        )}
        {isActive && !showPreview && (
          <div className="absolute inset-0 bg-indigo-600/20 flex items-center justify-center pointer-events-none">
            <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center shadow-lg">
               <div className="w-0 h-0 border-t-[5px] border-t-transparent border-l-[9px] border-l-white border-b-[5px] border-b-transparent ml-1" />
            </div>
          </div>
        )}
        <div className="absolute bottom-1 right-1 text-[8px] bg-black/80 px-1 rounded text-zinc-300 font-mono font-black tracking-tighter z-10">
          {formatDuration(v.duration)}
        </div>
      </div>
      <div className="mt-2 px-1">
        <p className={`text-[10px] font-bold truncate tracking-tight ${isActive ? 'text-indigo-400' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
          {v.name}
        </p>
        <p className="text-[8px] text-zinc-700 mt-0.5 uppercase font-black tracking-widest">
          {(v.size / (1024 * 1024)).toFixed(1)} MB
        </p>
      </div>
    </div>
  );
});

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ video, allVideos, lang, onClose, onSelectVideo, onMetadataLoaded }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideControlsTimer = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const t = translations[lang];
  
  const [displaySize, setDisplaySize] = useState<DisplaySize>(() => {
    const saved = localStorage.getItem(DISPLAY_SIZE_STORAGE_KEY);
    return (saved as DisplaySize) || 'large';
  });

  const [playlistSortMode, setPlaylistSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem(PLAYLIST_SORT_STORAGE_KEY);
    return (saved as SortMode) || SortMode.AFTER_CURRENT;
  });

  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);

  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimer.current) window.clearTimeout(hideControlsTimer.current);
    if (isPlaying) {
      hideControlsTimer.current = window.setTimeout(() => {
        setShowControls(false);
        setIsSortMenuOpen(false);
      }, AUTO_HIDE_TIMEOUT);
    }
  }, [isPlaying]);

  useEffect(() => {
    resetHideTimer();
    return () => { if (hideControlsTimer.current) window.clearTimeout(hideControlsTimer.current); };
  }, [resetHideTimer]);

  useEffect(() => {
    setProgress(0);
    setIsPlaying(true);
    resetHideTimer();
  }, [video.id, resetHideTimer]);

  useEffect(() => {
    localStorage.setItem(PLAYLIST_SORT_STORAGE_KEY, playlistSortMode);
  }, [playlistSortMode]);

  useEffect(() => {
    localStorage.setItem(DISPLAY_SIZE_STORAGE_KEY, displaySize);
  }, [displaySize]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
    resetHideTimer();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
    resetHideTimer();
  };

  const sortedPlaylist = useMemo(() => {
    const result = [...allVideos];
    switch (playlistSortMode) {
      case SortMode.AFTER_CURRENT:
        const idx = allVideos.findIndex(v => v.id === video.id);
        return idx !== -1 ? [...allVideos.slice(idx + 1), ...allVideos.slice(0, idx + 1)] : allVideos;
      case SortMode.NEWEST: result.sort((a, b) => b.lastModified - a.lastModified); break;
      case SortMode.SIZE: result.sort((a, b) => b.size - a.size); break;
      case SortMode.RANDOM: result.sort(() => Math.random() - 0.5); break;
    }
    return result;
  }, [allVideos, playlistSortMode, video.id]);

  const handleNext = () => {
    const idx = sortedPlaylist.findIndex(v => v.id === video.id);
    onSelectVideo(sortedPlaylist[(idx + 1) % sortedPlaylist.length]);
  };

  const handlePrev = () => {
    const idx = sortedPlaylist.findIndex(v => v.id === video.id);
    onSelectVideo(sortedPlaylist[(idx - 1 + sortedPlaylist.length) % sortedPlaylist.length]);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getSortLabel = (mode: SortMode) => {
    switch (mode) {
      case SortMode.AFTER_CURRENT: return t.upNext;
      case SortMode.NEWEST: return t.newestFirst;
      case SortMode.SIZE: return t.fileSize;
      case SortMode.RANDOM: return t.randomOrder;
      default: return mode;
    }
  };

  // 关键优化：使用 transform 实现极其明显的缩放效果，并辅以阴影增强视觉分离度
  const videoStyle = useMemo(() => {
    switch (displaySize) {
      case 'small': 
        return { 
          transform: 'scale(0.4)', 
          boxShadow: '0 0 100px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.1)' 
        };
      case 'medium': 
        return { 
          transform: 'scale(0.7)', 
          boxShadow: '0 0 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)' 
        };
      case 'large': 
      default: 
        return { transform: 'scale(1)', boxShadow: 'none' };
    }
  }, [displaySize]);

  return (
    <div 
      ref={containerRef} 
      onMouseMove={resetHideTimer}
      onClick={resetHideTimer}
      className={`fixed inset-0 z-50 bg-zinc-950 flex flex-col md:flex-row overflow-hidden transition-all duration-300 ${!showControls && isPlaying ? 'cursor-none' : ''}`}
    >
      <div className="flex-1 flex flex-col relative h-full bg-black group/main overflow-hidden">
        {/* Header Overlay */}
        <div className={`absolute top-0 left-0 right-0 z-40 flex items-center justify-between p-4 bg-gradient-to-b from-black/95 via-black/40 to-transparent transition-all duration-500 ease-in-out ${showControls || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full'}`}>
          <button onClick={onClose} className="flex items-center gap-2 px-4 py-2 bg-white text-black hover:bg-zinc-200 rounded-full transition-all text-[10px] font-black uppercase tracking-widest shadow-2xl">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            {t.back}
          </button>
          <h2 className="text-white text-xs font-bold truncate drop-shadow-lg uppercase tracking-widest italic flex-1 mx-8 text-center">{video.name}</h2>
          <div className="w-24" />
        </div>

        {/* Video Surface */}
        <div className="flex-1 flex items-center justify-center relative bg-zinc-950/20 overflow-hidden">
          <video 
            ref={videoRef} 
            src={video.url} 
            style={videoStyle}
            className="w-full h-full object-contain cursor-pointer transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]" 
            autoPlay 
            onTimeUpdate={() => setProgress(videoRef.current ? (videoRef.current.currentTime / videoRef.current.duration) * 100 : 0)} 
            onEnded={handleNext} 
            onClick={togglePlay} 
          />
          {!isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
              <div className="bg-white/10 p-8 rounded-full backdrop-blur-xl border border-white/20">
                <svg className="w-16 h-16 text-white fill-current" viewBox="0 0 20 20"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </div>
          )}
        </div>

        {/* Control Bar */}
        <div className={`p-4 bg-zinc-950/90 backdrop-blur-md border-t border-zinc-900 space-y-4 transition-all duration-500 ease-in-out absolute bottom-0 left-0 right-0 z-40 ${showControls || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full'}`}>
          <input type="range" min="0" max="100" step="0.1" value={progress} onChange={(e) => { if(videoRef.current) videoRef.current.currentTime = (parseFloat(e.target.value)/100)*videoRef.current.duration; }} className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all" />
          <div className="flex items-center gap-6 text-zinc-300">
            <div className="flex items-center gap-6">
              <button onClick={handlePrev} className="hover:text-white transition-colors"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
              <button onClick={togglePlay} className="hover:text-white transition-colors">{isPlaying ? <svg className="w-9 h-9" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg className="w-9 h-9" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}</button>
              <button onClick={handleNext} className="hover:text-white transition-colors"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>
            </div>
            
            <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 p-1 rounded-full shadow-inner">
              <span className="text-[8px] font-black uppercase text-zinc-600 px-2 tracking-widest">{t.displaySize}</span>
              {(['small', 'medium', 'large'] as DisplaySize[]).map((size) => (
                <button
                  key={size}
                  onClick={() => setDisplaySize(size)}
                  className={`px-3 py-1 text-[9px] font-black uppercase rounded-full transition-all ${displaySize === size ? 'bg-indigo-600 text-white shadow-xl scale-105' : 'text-zinc-500 hover:text-zinc-200'}`}
                >
                  {t[`size${size.charAt(0).toUpperCase() + size.slice(1)}` as keyof typeof t]}
                </button>
              ))}
            </div>

            <div className="flex-1" />
            <div className="text-[10px] font-mono text-zinc-500 font-black bg-zinc-900/50 px-2 py-1 rounded border border-zinc-800 tracking-tighter">
              {videoRef.current ? formatDuration(videoRef.current.currentTime) : '0:00'} / {formatDuration(video.duration)}
            </div>
            <button onClick={toggleFullscreen} className="bg-white text-black hover:bg-zinc-200 p-2.5 rounded-full transition-all shadow-xl">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar (Playlist) */}
      <div className={`bg-zinc-950 border-l border-zinc-900 flex flex-col transition-all duration-300 ease-in-out relative ${isSidebarOpen ? 'w-full md:w-80' : 'w-0 overflow-hidden border-none opacity-0'}`}>
        <div className="p-4 border-b border-zinc-900 flex items-center justify-between sticky top-0 bg-zinc-950 z-20 min-w-[320px]">
          <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">{t.playlist}</h3>
          <button onClick={() => setIsSidebarOpen(false)} className="text-zinc-600 hover:text-white"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg></button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar min-w-[320px]">
          {sortedPlaylist.map((v) => (
            <PlaylistItem key={v.id} v={v} isActive={v.id === video.id} onClick={() => onSelectVideo(v)} formatDuration={formatDuration} onMetadataLoaded={onMetadataLoaded} />
          ))}
        </div>
      </div>
      {!isSidebarOpen && (
        <button onClick={() => setIsSidebarOpen(true)} className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-zinc-900 border border-zinc-800 p-2 rounded-l-xl hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all shadow-2xl">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
        </button>
      )}
    </div>
  );
};
