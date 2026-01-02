import * as React from 'react';
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { VideoItem, SortMode } from './types';
import { SUPPORTED_VIDEO_EXTENSIONS } from './constants';
import { VideoCard } from './components/VideoCard';
import { VideoPlayer } from './components/VideoPlayer';
import { translations, Language } from './translations';
import { thumbnailService } from './services/ThumbnailService';

const GRID_COLUMNS_STORAGE_KEY = 'vhub-column-count';
const LANG_STORAGE_KEY = 'vhub-lang';
const PAGE_SIZE = 24; 

const App: React.FC = () => {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(SortMode.NEWEST);
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return (saved as Language) || 'en';
  });
  
  const t = translations[lang];

  const [columnCount, setColumnCount] = useState<number>(() => {
    const saved = localStorage.getItem(GRID_COLUMNS_STORAGE_KEY);
    const val = saved ? parseInt(saved, 10) : 4;
    return (val === 4 || val === 6) ? val : 4;
  });

  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const lastTime = useRef(performance.now());
  const [randomSeed, setRandomSeed] = useState<number>(Date.now());

  useEffect(() => {
    localStorage.setItem(GRID_COLUMNS_STORAGE_KEY, columnCount.toString());
  }, [columnCount]);

  useEffect(() => {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  }, [lang]);

  useEffect(() => {
    const updateFps = () => {
      frames.current++;
      const now = performance.now();
      if (now >= lastTime.current + 1000) {
        setFps(Math.round((frames.current * 1000) / (now - lastTime.current)));
        frames.current = 0;
        lastTime.current = now;
      }
      requestAnimationFrame(updateFps);
    };
    const id = requestAnimationFrame(updateFps);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortMode]);

  const activeVideo = useMemo(() => 
    videos.find(v => v.id === activeVideoId) || null
  , [videos, activeVideoId]);

  const clearLibrary = useCallback(() => {
    if (!isConfirmingClear) {
      setIsConfirmingClear(true);
      setTimeout(() => setIsConfirmingClear(false), 4000);
      return;
    }
    videos.forEach(v => {
      if (v.url.startsWith('blob:')) URL.revokeObjectURL(v.url);
    });
    thumbnailService.clearCache();
    setVideos([]);
    setActiveVideoId(null);
    setIsConfirmingClear(false);
    setCurrentPage(1);
  }, [videos, isConfirmingClear]);

  const handleFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    setIsProcessing(true);
    const newVideos: VideoItem[] = [];
    const batchSize = 100;
    const files = (Array.from(fileList) as File[]).filter(file => {
      const ext = file.name.slice((file.name.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();
      return SUPPORTED_VIDEO_EXTENSIONS.includes(`.${ext}`);
    });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = (file as { path?: string }).path;
      const url = URL.createObjectURL(file);
      newVideos.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${i}`,
        file,
        path: typeof filePath === 'string' ? filePath : undefined,
        url,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      });
      if (i % batchSize === 0) await new Promise(r => requestAnimationFrame(r));
    }

    setVideos(prev => {
      prev.forEach(v => {
        if (v.url.startsWith('blob:')) URL.revokeObjectURL(v.url);
      });
      return newVideos;
    });
    setIsProcessing(false);
    setCurrentPage(1);
    e.target.value = '';
  }, []);

  // 为 Electron 添加处理文件夹选择的函数
  const handleFolderSelect = useCallback(async () => {
    if (window.electronAPI) {
      // 如果在 Electron 环境中，使用 Electron API 选择目录
      try {
        const entries = await window.electronAPI.openDirectoryFiles?.(SUPPORTED_VIDEO_EXTENSIONS);
        if (!entries || entries.length === 0) return;
        setIsProcessing(true);
        const newVideos: VideoItem[] = entries.map((entry, idx) => ({
          id: `${entry.name}-${entry.size}-${entry.lastModified}-${idx}`,
          path: entry.path,
          url: entry.url,
          name: entry.name,
          size: entry.size,
          lastModified: entry.lastModified
        }));
        setVideos(prev => {
          prev.forEach(v => {
            if (v.url.startsWith('blob:')) URL.revokeObjectURL(v.url);
          });
          return newVideos;
        });
        setActiveVideoId(null);
        setCurrentPage(1);
        setIsProcessing(false);
      } catch (error) {
        console.error('Error selecting directory:', error);
        setIsProcessing(false);
      }
    } else {
      // 如果不在 Electron 环境中，触发文件选择器（保持现有行为）
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.multiple = true;
      (fileInput as any).webkitdirectory = true;
      (fileInput as any).directory = '';
      fileInput.onchange = (e: any) => {
        handleFiles(e);
      };
      fileInput.click();
    }
  }, [handleFiles]);

  const filteredAndSortedVideos = useMemo(() => {
    let result = [...videos];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(v => v.name.toLowerCase().includes(q));
    }
    switch (sortMode) {
      case SortMode.NEWEST: result.sort((a, b) => b.lastModified - a.lastModified); break;
      case SortMode.SIZE: result.sort((a, b) => b.size - a.size); break;
      case SortMode.RANDOM: 
        result.sort((a, b) => {
          // Use a seeded random based on video IDs and a stable random seed
          const seedA = a.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + randomSeed;
          const seedB = b.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + randomSeed;
          const pseudoRandom = (seed: number) => (seed * 9301 + 49297) % 233280;
          return pseudoRandom(seedA) / 233280 - pseudoRandom(seedB) / 233280;
        });
        break;
    }
    return result;
  }, [videos, sortMode, searchQuery, randomSeed]);

  const totalPages = Math.ceil(filteredAndSortedVideos.length / PAGE_SIZE);
  const paginatedVideos = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredAndSortedVideos.slice(start, start + PAGE_SIZE);
  }, [filteredAndSortedVideos, currentPage]);

  const updateMetadata = useCallback((id: string, thumbnail: string, duration: number) => {
    setVideos(prev => {
      const idx = prev.findIndex(v => v.id === id);
      if (idx === -1 || (prev[idx].thumbnail === thumbnail && prev[idx].duration === duration)) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], thumbnail, duration };
      return updated;
    });
  }, []);

  const gridDesktopClass = useMemo(() => {
    switch (columnCount) {
      case 4: return 'md:grid-cols-4';
      case 6: return 'md:grid-cols-6';
      default: return 'md:grid-cols-4';
    }
  }, [columnCount]);

  const handleSortChange = (newSortMode: SortMode) => {
    if (newSortMode === SortMode.RANDOM && sortMode !== SortMode.RANDOM) {
      // Generate a new random seed when switching to random mode
      setRandomSeed(Date.now());
    } else if (newSortMode === SortMode.RANDOM && sortMode === SortMode.RANDOM) {
      // Generate a new random seed when clicking random again while already in random mode
      setRandomSeed(Date.now());
    }
    setSortMode(newSortMode);
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950 select-none overflow-hidden font-sans">
      <header className="h-20 border-b border-zinc-800 flex items-center px-8 gap-8 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" /></svg>
          </div>
          <h1 className="text-xl font-black tracking-tighter text-white hidden sm:block italic text-nowrap">PRIVATE VIDEO HUB</h1>
        </div>

        <div className="flex-1 max-w-2xs relative group/search">
          <input 
            type="text" placeholder={t.searchPlaceholder} 
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-800/50 border border-zinc-700/50 rounded-full pl-12 pr-12 py-3 text-base text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 transition-all outline-none placeholder:text-zinc-600"
          />
          <svg className="w-5 h-5 text-zinc-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 text-zinc-500 hover:text-white transition-all rounded-full hover:bg-zinc-700/50">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            className="px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest bg-zinc-800/50 border border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all shadow-lg"
          >
            {lang === 'zh' ? 'EN' : '中'}
          </button>
          {videos.length > 0 && (
            <button 
              onClick={clearLibrary}
              className={`px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 whitespace-nowrap shadow-lg border ${
                isConfirmingClear ? 'bg-red-600 border-red-400 text-white animate-pulse' : 'bg-zinc-800/50 border-zinc-700 hover:bg-zinc-700 text-zinc-400 hover:text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6" /></svg>
              {isConfirmingClear ? t.confirmClear : t.clearList}
            </button>
          )}
          <div className="flex flex-col items-end">
            <button
              onClick={handleFolderSelect}
              className="cursor-pointer bg-white hover:bg-zinc-200 text-black px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2 shadow-xl shadow-white/5 whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
              {t.importFolder}
            </button>
            <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-wider mt-1 mr-1">{t.localPlayback}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-black">
        {isProcessing ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="w-16 h-16 border-4 border-zinc-800 border-t-indigo-500 rounded-full animate-spin shadow-lg shadow-indigo-500/20" />
            <div className="text-center">
               <p className="text-zinc-200 font-black text-sm uppercase tracking-widest animate-pulse">{t.organizing}</p>
               <p className="text-zinc-600 text-xs mt-1 uppercase">{t.localOnly}</p>
            </div>
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-10">
            <div className="relative">
              <div className="w-40 h-40 bg-zinc-900/50 rounded-full flex items-center justify-center border border-zinc-800 shadow-inner">
                 <svg className="w-16 h-16 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2-2v8a2 2 0 002 2z" /></svg>
              </div>
              <div className="absolute -bottom-3 -right-3 bg-indigo-600 rounded-full p-3 border-4 border-zinc-950">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2-2v8a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </div>
            </div>
            
            <div className="max-w-2xl space-y-8">
              <div className="space-y-3">
                <h2 className="text-4xl sm:text-6xl font-black text-white tracking-tighter uppercase italic leading-tight">
                  {t.landingHeader}
                </h2>
                <p className="text-indigo-500 text-sm font-black uppercase tracking-[0.4em] mt-4">
                  {t.landingSubtitle}
                </p>
              </div>

              <div className="bg-white/5 p-8 rounded-2xl text-left border border-white/5 shadow-2xl backdrop-blur-sm">
                 <p className="text-zinc-400 text-sm leading-relaxed">
                   <span className="text-white font-bold block mb-3 underline decoration-indigo-500 underline-offset-4 text-base">{t.instructionsTitle}</span>
                   {t.instructionsDesc}
                 </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800/50 hover:bg-zinc-800/50 transition-colors">
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M2.166 4.9L10 1.55l7.834 3.35a1 1 0 01.666.92v6.57a1 1 0 01-.544.894l-7.5 3.75a1 1 0 01-.912 0l-7.5-3.75A1 1 0 012 12.42V5.82a1 1 0 01.666-.92z" /></svg>
                  </div>
                  <h4 className="text-white text-sm font-black uppercase tracking-wider mb-2">{t.privacyTitle}</h4>
                  <p className="text-zinc-500 text-xs leading-relaxed">{t.privacyDesc}</p>
                </div>
                <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800/50 hover:bg-zinc-800/50 transition-colors">
                  <div className="w-10 h-10 bg-indigo-500/10 rounded-lg flex items-center justify-center mb-4">
                    <svg className="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
                  </div>
                  <h4 className="text-white text-sm font-black uppercase tracking-wider mb-2">{t.previewTitle}</h4>
                  <p className="text-zinc-500 text-xs leading-relaxed">{t.previewDesc}</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-zinc-800 pb-6 gap-6">
              <div className="flex items-center gap-4">
                <span className="text-zinc-600 text-xs font-bold uppercase tracking-widest">
                  {t.videoCount(filteredAndSortedVideos.length, currentPage, totalPages)}
                </span>
              </div>
              <div className="flex items-center gap-8">
                <div className="hidden md:flex items-center gap-3">
                  <span className="text-zinc-600 text-xs font-black uppercase tracking-widest">{t.displaySize}</span>
                  <div className="flex bg-zinc-900 rounded-full p-1.5 border border-zinc-800 shadow-inner">
                    {[
                      { num: 4, label: t.sizeLarge },
                      { num: 6, label: t.sizeSmall }
                    ].map(option => (
                      <button key={option.num} onClick={() => setColumnCount(option.num)}
                        className={`px-5 py-1.5 text-xs font-black rounded-full transition-all ${columnCount === option.num ? 'bg-indigo-600 text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-300'}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-zinc-600 text-xs font-black uppercase tracking-widest">{t.sort}</span>
                  <select value={sortMode} onChange={(e) => handleSortChange(e.target.value as SortMode)}
                    className="bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs font-bold uppercase tracking-wider rounded px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 hover:text-white transition-colors cursor-pointer"
                  >
                    <option value={SortMode.NEWEST}>{t.sortByDate}</option>
                    <option value={SortMode.SIZE}>{t.sortBySize}</option>
                    <option value={SortMode.RANDOM}>{t.sortByRandom}</option>
                  </select>
                </div>
              </div>
            </div>

            <div className={`grid grid-cols-1 sm:grid-cols-2 ${gridDesktopClass} gap-8`}>
              {paginatedVideos.map((video) => (
                <VideoCard 
                  key={video.id} 
                  video={video} 
                  onClick={(v: { id: React.SetStateAction<string | null>; }) => setActiveVideoId(v.id)}
                  onMetadataLoaded={updateMetadata}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-6 mt-16 py-10 border-t border-zinc-800/50">
                <button
                  disabled={currentPage === 1}
                  onClick={() => { setCurrentPage(prev => Math.max(1, prev - 1)); document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="p-4 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 transition-all shadow-lg"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className="flex items-center gap-2">
                  {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 7) pageNum = i + 1;
                    else if (currentPage <= 4) pageNum = i + 1;
                    else if (currentPage >= totalPages - 3) pageNum = totalPages - 6 + i;
                    else pageNum = currentPage - 3 + i;
                    
                    return (
                      <button key={pageNum} onClick={() => { setCurrentPage(pageNum); document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className={`w-12 h-12 rounded-xl text-sm font-black transition-all ${currentPage === pageNum ? 'bg-indigo-600 text-white shadow-lg scale-110' : 'bg-zinc-900 text-zinc-500 hover:text-white'}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  disabled={currentPage === totalPages}
                  onClick={() => { setCurrentPage(prev => Math.min(totalPages, prev + 1)); document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  className="p-4 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white disabled:opacity-30 transition-all shadow-lg"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="h-10 bg-black border-t border-zinc-900 px-8 flex items-center justify-between text-xs text-zinc-700 font-bold uppercase tracking-[0.2em]">
        <div className="flex items-center gap-8">
          <span className="flex items-center gap-2 text-emerald-500"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/> {t.localReady}</span>
          <span className="flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2-2v8a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg> {t.privacyProtected}</span>
          <span>FPS: <span className={fps < 30 ? 'text-red-900' : 'text-zinc-500'}>{fps}</span></span>
        </div>
        <div className="hidden sm:block">LOCAL-FIRST MEDIA CORE</div>
      </footer>

      {activeVideo && (
        <VideoPlayer 
          video={activeVideo} 
          allVideos={filteredAndSortedVideos}
          lang={lang}
          onClose={() => setActiveVideoId(null)}
          onSelectVideo={(v: { id: React.SetStateAction<string | null>; }) => setActiveVideoId(v.id)}
          onMetadataLoaded={updateMetadata}
        />
      )}
    </div>
  );
};

export default App;
