
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
  const [previewReady, setPreviewReady] = useState(false);
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
          }, v.path);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );
    if (itemRef.current) observer.observe(itemRef.current);
    return () => observer.disconnect();
  }, [v.id, v.thumbnail, v.url, onMetadataLoaded]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    setPreviewReady(false);
    setTimeout(() => { if (hoverTimer.current) setProgressWidth(100); }, 10);
    hoverTimer.current = window.setTimeout(() => setShowPreview(true), PREVIEW_DELAY);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setShowPreview(false);
    setPreviewReady(false);
    setProgressWidth(0);
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };

  const previewUrl = useMemo(() => {
    if (!isHovered) return "";
    const startTime = (v.duration !== undefined && v.duration < 15) ? 1 : 10;
    return `${v.url}#t=${startTime}`;
  }, [v.url, v.duration, isHovered]);

  return (
    <div 
      ref={itemRef}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 100px', transform: 'translateZ(0)' }}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex flex-col p-4 cursor-pointer transition-all border-b border-zinc-900/50 group ${isActive ? 'bg-indigo-600/15 border-l-4 border-l-indigo-500' : 'hover:bg-white/5'}`}
    >
      <div className="bg-black rounded-xl overflow-hidden relative border border-zinc-800 shadow-md" style={{ aspectRatio: '16 / 9' }}>
        {v.thumbnail ? (
          <img src={v.thumbnail} loading="lazy" decoding="async" className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ${(showPreview && previewReady) ? 'opacity-30' : (isActive ? 'opacity-100' : 'opacity-70 group-hover:opacity-100')}`} alt="" />
        ) : (
          <div className="absolute inset-0 w-full h-full flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-zinc-800 border-t-zinc-600 rounded-full animate-spin"/>
          </div>
        )}
        
        {isHovered && !showPreview && (
          <div className="absolute top-0 left-0 w-full h-1 bg-zinc-800/50 z-20">
            <div className="h-full bg-indigo-500 transition-all ease-linear" style={{ width: `${progressWidth}%`, transitionDuration: progressWidth > 0 ? `${PREVIEW_DELAY}ms` : '0ms' }} />
          </div>
        )}
        
        {isHovered && previewUrl && (
          <video 
            src={previewUrl} 
            autoPlay 
            muted 
            loop 
            playsInline
            onPlaying={() => setPreviewReady(true)}
            className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-700 z-10 ${(showPreview && previewReady) ? 'opacity-100' : 'opacity-0'}`} 
          />
        )}
        
        <div className="absolute bottom-2 right-2 text-[10px] bg-black/90 px-2 py-0.5 rounded text-zinc-200 font-black tracking-tighter z-20 border border-white/5">
          {formatDuration(v.duration)}
        </div>
      </div>
      <div className="mt-3 px-1">
        <p className={`text-xs font-bold truncate tracking-tight ${isActive ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-200'}`}>
          {v.name}
        </p>
      </div>
    </div>
  );
});

export const VideoPlayer: React.FC<VideoPlayerProps> = (props) => {
  const { video, allVideos, lang, onClose, onSelectVideo, onMetadataLoaded } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mpvCanvasRef = useRef<HTMLCanvasElement>(null);
  const hideControlsTimer = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  
  const isUserSeeking = useRef(false);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const t = translations[lang];
  const [useMpv, setUseMpv] = useState(false);
  const [mpvStatus, setMpvStatus] = useState<'idle' | 'ready' | 'error'>('idle');
  const [mpvError, setMpvError] = useState<string | null>(null);
  const [mpvDebug, setMpvDebug] = useState<string | null>(null);
  const [mpvTime, setMpvTime] = useState<number | null>(null);
  const [mpvDuration, setMpvDuration] = useState<number | null>(null);
  const electronAPI = window.electronAPI;
  const preferMpv = Boolean(electronAPI?.mpvInit);
  
  const [displaySize, setDisplaySize] = useState<DisplaySize>(() => {
    const saved = localStorage.getItem(DISPLAY_SIZE_STORAGE_KEY);
    return (saved as DisplaySize) || 'large';
  });

  const [playlistSortMode, setPlaylistSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem(PLAYLIST_SORT_STORAGE_KEY);
    return (saved as SortMode) || SortMode.AFTER_CURRENT;
  });

  // Add effect to detect mobile devices and hide sidebar when playing
  useEffect(() => {
    const isMobile = window.innerWidth < 768; // Using md breakpoint as reference
    if (isMobile && isPlaying) {
      setIsSidebarOpen(false);
    }
  }, [isPlaying]);

  // Add resize listener to handle orientation/device changes
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < 768;
      if (isMobile) {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const resetHideTimer = useCallback((forceShow = true) => {
    if (forceShow) {
      setShowControls(true);
    }
    
    if (hideControlsTimer.current) window.clearTimeout(hideControlsTimer.current);
    
    if (isPlaying) {
      hideControlsTimer.current = window.setTimeout(() => {
        setShowControls(false);
      }, AUTO_HIDE_TIMEOUT);
    }
  }, [isPlaying]);

  const updateLoop = useCallback(() => {
    if (useMpv && mpvStatus === 'ready') {
      const timeRes = electronAPI?.mpvGetProperty?.('time-pos', 'double');
      const durRes = electronAPI?.mpvGetProperty?.('duration', 'double');
      const pauseRes = electronAPI?.mpvGetProperty?.('pause', 'bool');
      if (timeRes?.ok && typeof timeRes.value === 'number') {
        setMpvTime(timeRes.value);
      }
      if (durRes?.ok && typeof durRes.value === 'number') {
        setMpvDuration(durRes.value);
        if (!isUserSeeking.current && durRes.value > 0 && timeRes?.ok && typeof timeRes.value === 'number') {
          setDisplayProgress((timeRes.value / durRes.value) * 100);
        }
      }
      if (pauseRes?.ok && typeof pauseRes.value === 'boolean') {
        setIsPlaying(!pauseRes.value);
      }
    } else {
      const v = videoRef.current;
      if (v && !isUserSeeking.current && v.duration > 0 && isFinite(v.duration)) {
        setDisplayProgress((v.currentTime / v.duration) * 100);
      }
    }
    rafRef.current = requestAnimationFrame(updateLoop);
  }, [useMpv, mpvStatus, electronAPI]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateLoop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [updateLoop]);

  useEffect(() => {
    resetHideTimer(true);
    return () => { if (hideControlsTimer.current) window.clearTimeout(hideControlsTimer.current); };
  }, [resetHideTimer, isPlaying]);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  const togglePlay = useCallback(() => {
    if (useMpv) {
      if (mpvStatus !== 'ready') return;
      window.electronAPI?.mpvCommand?.(['cycle', 'pause']);
      setIsPlaying(prev => !prev);
      return;
    }
    if (!videoRef.current) return;
    if (videoRef.current.paused) videoRef.current.play().catch(() => {});
    else videoRef.current.pause();
  }, [useMpv, mpvStatus]);

  const syncMediaState = () => {
    if (videoRef.current) {
      setIsPlaying(!videoRef.current.paused);
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    isUserSeeking.current = true;
    setDisplayProgress(val);
    if (useMpv) {
      if (mpvDuration && mpvDuration > 0) {
        const target = (val / 100) * mpvDuration;
        electronAPI?.mpvCommand?.(['set', 'time-pos', target.toString()]);
      }
      return;
    }
    if (videoRef.current && isFinite(videoRef.current.duration)) {
      videoRef.current.currentTime = (val / 100) * videoRef.current.duration;
    }
  };

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  }, []);

  const toggleMute = useCallback(() => {
    if (useMpv) {
      if (mpvStatus !== 'ready') return;
      const next = !isMuted;
      window.electronAPI?.mpvCommand?.(['set', 'mute', next ? 'yes' : 'no']);
      setIsMuted(next);
      return;
    }
    setIsMuted(prev => !prev);
  }, [useMpv, isMuted, mpvStatus]);

  const seek = useCallback((seconds: number) => {
    if (useMpv) {
      if (mpvStatus !== 'ready') return;
      window.electronAPI?.mpvCommand?.(['seek', seconds.toString(), 'relative']);
      return;
    }
    if (videoRef.current && isFinite(videoRef.current.duration)) {
      videoRef.current.currentTime = Math.max(0, Math.min(videoRef.current.duration, videoRef.current.currentTime + seconds));
    }
  }, [useMpv, mpvStatus]);

  const adjustVolume = useCallback((delta: number) => {
    setVolume(prev => {
      const newVal = Math.max(0, Math.min(1, prev + delta));
      if (newVal > 0) setIsMuted(false);
      if (useMpv && mpvStatus === 'ready') {
        const mpvVolume = Math.round(newVal * 100);
        window.electronAPI?.mpvCommand?.(['set', 'volume', mpvVolume.toString()]);
      }
      return newVal;
    });
  }, [useMpv, mpvStatus]);

  useEffect(() => {
    if (!preferMpv) {
      setUseMpv(true);
      setMpvStatus('error');
      setMpvError('addon_missing');
      const debug = electronAPI?.mpvDebug?.();
      if (debug) {
        setMpvDebug(`addon=${debug.addonPath || 'none'} err=${debug.addonError || 'none'} lib=${debug.libPath || 'none'}`);
      }
      console.warn('[mpv] missing addon', debug);
      return;
    }
    if (!video.path) {
      setUseMpv(true);
      setMpvStatus('error');
      setMpvError('missing_path');
      setMpvDebug(null);
      console.warn('[mpv] missing file path');
      return;
    }
    setUseMpv(true);
    const initResult = electronAPI?.mpvInit?.();
    if (!initResult?.ok) {
      setUseMpv(true);
      setMpvStatus('error');
      setMpvError(initResult?.error || 'init_failed');
      const debug = electronAPI?.mpvDebug?.();
      if (debug) {
        setMpvDebug(`addon=${debug.addonPath || 'none'} err=${debug.addonError || 'none'} lib=${debug.libPath || 'none'}`);
      } else {
        setMpvDebug(null);
      }
      console.warn('[mpv] init failed', initResult, debug);
      return;
    }
    const loadResult = electronAPI?.mpvLoad?.(video.path);
    if (!loadResult?.ok) {
      setUseMpv(true);
      setMpvStatus('error');
      setMpvError(loadResult?.error || 'load_failed');
      const debug = electronAPI?.mpvDebug?.();
      if (debug) {
        setMpvDebug(`addon=${debug.addonPath || 'none'} err=${debug.addonError || 'none'} lib=${debug.libPath || 'none'}`);
      } else {
        setMpvDebug(null);
      }
      console.warn('[mpv] load failed', loadResult, debug);
      return;
    }
    setIsMuted(false);
    setVolume(1);
    electronAPI?.mpvCommand?.(['set', 'volume', '100']);
    electronAPI?.mpvCommand?.(['set', 'mute', 'no']);
    setUseMpv(true);
    setIsPlaying(true);
    setMpvStatus('ready');
    setMpvError(null);
    setMpvDebug(null);
    return () => {
      window.electronAPI?.mpvStop?.();
    };
  }, [video.id, video.path, preferMpv]);

  useEffect(() => {
    if (!useMpv) return;
    const canvas = mpvCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    let rafId = 0;
    let imageData: ImageData | null = null;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      const result = window.electronAPI?.mpvRenderFrame?.(width, height);
      if (result?.ok && result.frame && result.frame.length === width * height * 4) {
        if (!imageData || imageData.width !== width || imageData.height !== height) {
          imageData = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
        }
        imageData.data.set(result.frame);
        ctx.putImageData(imageData, 0, 0);
      }
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [useMpv]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const keysToHandle = [' ', 'k', 'f', 'm', 'arrowright', 'arrowleft', 'l', 'j', 'arrowup', 'arrowdown', 'escape'];
      if (!keysToHandle.includes(e.key.toLowerCase())) return;

      const performAction = () => {
        switch (e.key.toLowerCase()) {
          case ' ':
          case 'k':
            e.preventDefault();
            togglePlay();
            break;
          case 'f':
            e.preventDefault();
            toggleFullscreen();
            break;
          case 'm':
            e.preventDefault();
            toggleMute();
            break;
          case 'arrowright':
            e.preventDefault();
            seek(5);
            break;
          case 'arrowleft':
            e.preventDefault();
            seek(-5);
            break;
          case 'l':
            e.preventDefault();
            seek(10);
            break;
          case 'j':
            e.preventDefault();
            seek(-10);
            break;
          case 'arrowup':
            e.preventDefault();
            adjustVolume(0.1);
            break;
          case 'arrowdown':
            e.preventDefault();
            adjustVolume(-0.1);
            break;
          case 'escape':
            if (!document.fullscreenElement) {
              onClose();
            }
            break;
        }
        resetHideTimer(false);
      };

      performAction();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleFullscreen, toggleMute, seek, adjustVolume, onClose, resetHideTimer]);

  const sortedPlaylist = useMemo(() => {
    const result = [...allVideos];
    switch (playlistSortMode) {
      case SortMode.AFTER_CURRENT:
        const idx = allVideos.findIndex((v: { id: any; }) => v.id === video.id);
        return idx !== -1 ? [...allVideos.slice(idx + 1), ...allVideos.slice(0, idx + 1)] : allVideos;
      case SortMode.NEWEST: return result.sort((a, b) => b.lastModified - a.lastModified);
      case SortMode.SIZE: return result.sort((a, b) => b.size - a.size);
      case SortMode.RANDOM: return result.sort(() => Math.random() - 0.5);
      default: return result;
    }
  }, [allVideos, playlistSortMode, video.id]);

  const handleNext = () => onSelectVideo(sortedPlaylist[(sortedPlaylist.findIndex((v: { id: any; }) => v.id === video.id) + 1) % sortedPlaylist.length]);
  const handlePrev = () => onSelectVideo(sortedPlaylist[(sortedPlaylist.findIndex((v: { id: any; }) => v.id === video.id) - 1 + sortedPlaylist.length) % sortedPlaylist.length]);

  const formatDuration = (seconds?: number) => {
    if (seconds === undefined || isNaN(seconds) || !isFinite(seconds)) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const videoStyle = useMemo(() => {
    switch (displaySize) {
      case 'small': return { transform: 'scale(0.5)', boxShadow: '0 0 100px rgba(0,0,0,0.8)' };
      case 'medium': return { transform: 'scale(0.75)', boxShadow: '0 0 80px rgba(0,0,0,0.6)' };
      default: return { transform: 'scale(1)', boxShadow: 'none' };
    }
  }, [displaySize]);

  return (
    <div 
      ref={containerRef} 
      onMouseMove={() => resetHideTimer(true)} 
      className={`fixed inset-0 z-50 bg-zinc-950 flex overflow-hidden transition-all duration-300 ${!showControls && isPlaying ? 'cursor-none' : ''}`}
    >
      <div className="flex-1 flex flex-col relative h-full bg-black overflow-hidden aspect-video md:aspect-auto">
        {/* Header */}
        <div className={`absolute top-0 left-0 right-0 z-40 flex items-center justify-between p-6 bg-gradient-to-b from-black/95 via-black/50 to-transparent transition-all duration-500 ${showControls || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full'}`}>
          <button onClick={onClose} className="flex items-center gap-3 px-6 py-3 bg-white text-black hover:bg-zinc-200 rounded-full transition-all text-xs font-black uppercase tracking-widest shadow-2xl">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            {t.back}
          </button>
          <h2 className="text-white text-base font-bold truncate tracking-widest italic flex-1 mx-12 text-center">{video.name}</h2>
          <div className="w-32 flex items-center justify-end gap-2">
            <span
              className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
              useMpv ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-zinc-900/80 text-zinc-400 border-zinc-700'
            }`} title={mpvStatus === 'error' && mpvError ? `mpv: ${mpvError}` : undefined}>
              {useMpv ? 'MPV' : 'HTML5'}
            </span>
            
          </div>
        </div>

        {/* Video Surface */}
        <div className="flex-1 flex items-center justify-center relative bg-zinc-950/20 overflow-hidden aspect-video md:aspect-auto">
          {useMpv ? (
            <div className="w-full h-full relative">
              <canvas
                ref={mpvCanvasRef}
                style={videoStyle}
                className="w-full h-full object-contain cursor-pointer transition-transform duration-500"
                onClick={() => { togglePlay(); resetHideTimer(true); }}
              />
              {mpvStatus === 'error' && (
                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/70 text-zinc-200 text-sm font-bold tracking-widest uppercase gap-2 px-6 text-center">
                  <div>MPV ERROR {mpvError ? `(${mpvError})` : ''}</div>
                  {mpvDebug && (
                    <div className="text-[10px] font-mono text-zinc-400 normal-case tracking-normal break-all">
                      {mpvDebug}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <video 
              ref={videoRef} src={video.url} style={videoStyle}
              className="w-full h-full object-contain cursor-pointer transition-transform duration-500" 
              autoPlay 
              onPlay={syncMediaState} 
              onPause={syncMediaState}
              onPlaying={syncMediaState}
              onWaiting={syncMediaState}
              onRateChange={syncMediaState}
              onLoadedData={syncMediaState}
              onSeeking={() => { isUserSeeking.current = true; }}
              onSeeked={() => { isUserSeeking.current = false; }}
              onEnded={handleNext} 
              onClick={() => { togglePlay(); resetHideTimer(true); }} 
            />
          )}
        </div>

        {/* Control Bar */}
        <div className={`p-4 bg-gray-800/15 border-t border-gray-700/20 space-y-4 transition-all duration-500 absolute bottom-0 left-0 right-0 z-40 ${showControls || !isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full'}`}>
          <div className="px-4">
            <input 
              type="range" min="0" max="100" step="0.01" 
              value={displayProgress} 
              onMouseDown={() => { isUserSeeking.current = true; }}
              onMouseUp={(e) => { 
                isUserSeeking.current = false; 
                resetHideTimer(true); 
                (e.target as HTMLInputElement).blur();
              }}
              onChange={handleProgressChange}
              className="w-full h-1.5 bg-gray-600/25 rounded-lg appearance-none cursor-pointer accent-indigo-500 transition-all hover:h-2 outline-none focus:outline-none" 
            />
          </div>
          <div className="flex items-center gap-6 text-zinc-300">
            <div className="flex items-center gap-4">
              <button onClick={() => { handlePrev(); resetHideTimer(true); }} className="hover:text-white transition-colors"><svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>
              <button onClick={() => { togglePlay(); resetHideTimer(true); }} className="hover:text-white transition-colors">
                {isPlaying ? (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V6h-4z"/></svg>
                ) : (
                  <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                )}
              </button>
              <button onClick={() => { handleNext(); resetHideTimer(true); }} className="hover:text-white transition-colors"><svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><g transform="rotate(180 12 12)"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></g></svg></button>
              
              <div className="flex items-center gap-2 group/volume ml-4">
                <button onClick={() => { toggleMute(); resetHideTimer(true); }} className="hover:text-white transition-colors">
                  {isMuted || volume === 0 ? (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6l4 4h.001M12 18l4-4h.001M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 5.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                  )}
                </button>
                <input 
                  type="range" min="0" max="1" step="0.01" 
                  value={isMuted ? 0 : volume} 
                  onChange={(e) => {
                    const next = parseFloat(e.target.value);
                    setVolume(next);
                    setIsMuted(false);
                    if (useMpv && mpvStatus === 'ready') {
                      const mpvVolume = Math.round(next * 100);
                      window.electronAPI?.mpvCommand?.(['set', 'volume', mpvVolume.toString()]);
                      window.electronAPI?.mpvCommand?.(['set', 'mute', next === 0 ? 'yes' : 'no']);
                    }
                    resetHideTimer(true);
                  }} 
                  onMouseUp={(e) => (e.target as HTMLInputElement).blur()}
                  className="w-20 h-1.5 bg-gray-600/25 rounded-lg appearance-none cursor-pointer accent-indigo-500 transition-all opacity-0 group-hover/volume:opacity-100 focus:opacity-100 outline-none focus:outline-none" 
                />
              </div>
            </div>
            
            <div className="flex items-center gap-2 bg-gray-800/15 border border-gray-700/15 p-1 rounded-full shadow-inner">
              {(['small', 'medium', 'large'] as DisplaySize[]).map((size) => (
                <button key={size} onClick={() => { setDisplaySize(size); resetHideTimer(true); }} className={`px-3 py-1.5 text-[10px] font-black uppercase rounded-full transition-all ${displaySize === size ? 'bg-indigo-600 text-white shadow-xl scale-105' : 'text-zinc-500 hover:text-zinc-200'}`}>
                  {t[`size${size.charAt(0).toUpperCase() + size.slice(1)}` as keyof typeof t] as string}
                </button>
              ))}
            </div>

            <div className="flex-1" />
            <div className="text-sm font-mono text-zinc-400 font-bold bg-zinc-900 px-5 py-2.5 rounded-full border border-zinc-800 tracking-tighter shadow-lg">
              {useMpv ? formatDuration(mpvTime || 0) : formatDuration(videoRef.current?.currentTime)} <span className="text-zinc-700 mx-1">/</span> {useMpv ? formatDuration(mpvDuration || 0) : formatDuration(video.duration)}
            </div>
            <button onClick={() => { toggleFullscreen(); resetHideTimer(true); }} className="bg-white text-black hover:bg-zinc-200 p-3.5 rounded-full transition-all shadow-xl">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isFullscreen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className={`bg-zinc-950 border-l border-zinc-900 flex flex-col transition-all duration-300 ease-in-out relative z-50 overflow-visible ${isSidebarOpen ? 'w-full md:w-80' : 'w-0 border-transparent'}`}>
        <button onClick={() => { setIsSidebarOpen(!isSidebarOpen); resetHideTimer(true); }} className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-[100] bg-zinc-900 border border-zinc-800 p-5 rounded-l-3xl hover:bg-indigo-600 text-zinc-400 hover:text-white transition-all border-r-0 group flex justify-center items-center shadow-2xl ${showControls || !isPlaying ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}>
          <svg className={`w-7 h-7 transition-transform duration-300 ${isSidebarOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg>
        </button>

        <div className={`flex flex-col h-full w-full min-w-[320px] transition-opacity duration-300 ${!isSidebarOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="p-6 border-b border-zinc-900 flex flex-col gap-4 sticky top-0 bg-zinc-950 z-20">
            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-[0.2em]">{t.playlist}</h3>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-zinc-700 uppercase tracking-widest whitespace-nowrap">{t.sort}</span>
              <select value={playlistSortMode} onChange={(e) => { setPlaylistSortMode(e.target.value as SortMode); localStorage.setItem(PLAYLIST_SORT_STORAGE_KEY, e.target.value); resetHideTimer(true); }} className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-black uppercase tracking-tighter rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 hover:text-white transition-colors cursor-pointer">
                <option value={SortMode.AFTER_CURRENT}>{t.upNext}</option>
                <option value={SortMode.NEWEST}>{t.newestFirst}</option>
                <option value={SortMode.SIZE}>{t.fileSize}</option>
                <option value={SortMode.RANDOM}>{t.randomOrder}</option>
              </select>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {sortedPlaylist.map((v: VideoItem) => (
              <PlaylistItem key={v.id} v={v} isActive={v.id === video.id} onClick={() => onSelectVideo(v)} formatDuration={formatDuration} onMetadataLoaded={onMetadataLoaded} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
