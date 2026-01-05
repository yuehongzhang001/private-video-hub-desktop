import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TranslationBundle } from '../translations';

type FavoriteItem = {
  id: string;
  title: string;
  url: string;
  duration?: string;
  note?: string;
  siteName?: string;
  siteIconUrl?: string;
  thumbnailUrl?: string;
  thumbnailDataUrl?: string;
  createdAt: number;
  lastAccessedAt?: number;
};

type SortMode = 'recent' | 'accessed';
type ViewMode = 'grid' | 'list';

type FormState = {
  title: string;
  url: string;
  duration: string;
  note: string;
  siteName: string;
  siteIconUrl: string;
  thumbnailUrl: string;
  thumbnailDataUrl: string;
};

const FAVORITES_STORAGE_KEY = 'vhub-favorites';
const FAVORITES_VIEW_KEY = 'vhub-favorites-view';
const FAVORITES_SORT_KEY = 'vhub-favorites-sort';

const emptyForm: FormState = {
  title: '',
  url: '',
  duration: '',
  note: '',
  siteName: '',
  siteIconUrl: '',
  thumbnailUrl: '',
  thumbnailDataUrl: ''
};

const parseFavorites = (raw: string | null): FavoriteItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map((item) => normalizeFavorite(item))
      .filter((item): item is FavoriteItem => Boolean(item));
  } catch {
    return [];
  }
};

const sanitizeJsonInput = (raw: string) => {
  const trimmed = raw.trim().replace(/^\uFEFF/, '');
  const withoutFences = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  return withoutFences.replace(/,\s*([}\]])/g, '$1');
};

const getFallbackTitle = (rawUrl: string) => {
  if (!rawUrl) return 'Untitled';
  const clean = rawUrl.split('#')[0];
  const withoutQuery = clean.split('?')[0];
  const trimmed = withoutQuery.replace(/\/+$/, '');
  const last = trimmed.split('/').pop() || trimmed;
  return last || 'Untitled';
};

const getSiteNameFromUrl = (rawUrl: string) => {
  if (!rawUrl) return '';
  try {
    const hostname = new URL(rawUrl).hostname;
    const trimmed = hostname.replace(/^www\./i, '');
    return trimmed;
  } catch {
    return '';
  }
};

const normalizeFavorite = (item: any): FavoriteItem | null => {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.url ?? item.link ?? item.href ?? '').trim();
  if (!url) return null;
  const titleRaw = item.title ?? item.name;
  const title =
    titleRaw != null && String(titleRaw).trim()
      ? String(titleRaw).trim()
      : getFallbackTitle(url);

  const createdAt = typeof item.createdAt === 'number' ? item.createdAt : Date.now();
  const lastAccessedAt = typeof item.lastAccessedAt === 'number' ? item.lastAccessedAt : undefined;
  const duration = item.duration != null ? String(item.duration).trim() : '';
  const note = item.note != null ? String(item.note).trim() : '';
  const siteName = item.siteName ?? item.site ?? item.site_name ?? item.siteTitle ?? '';
  const siteIconUrl = item.siteIconUrl ?? item.siteIcon ?? item.icon ?? item.favicon ?? '';
  const siteNameText = siteName != null ? String(siteName).trim() : '';
  const derivedSiteName = siteNameText || getSiteNameFromUrl(url);
  const siteIconText = siteIconUrl != null ? String(siteIconUrl).trim() : '';
  const thumbnailUrl = item.thumbnailUrl != null ? String(item.thumbnailUrl).trim() : '';
  const thumbnailDataUrl = item.thumbnailDataUrl != null ? String(item.thumbnailDataUrl).trim() : '';

  return {
    id: String(item.id ?? `fav-${createdAt}-${Math.random().toString(16).slice(2)}`),
    title,
    url,
    duration: duration || undefined,
    note: note || undefined,
    siteName: derivedSiteName || undefined,
    siteIconUrl: siteIconText || undefined,
    thumbnailUrl: thumbnailUrl || undefined,
    thumbnailDataUrl: thumbnailDataUrl || undefined,
    createdAt,
    lastAccessedAt
  };
};

const useLocalStorageState = <T,>(key: string, fallback: T, parse?: (raw: string | null) => T) => {
  const [state, setState] = useState<T>(() => {
    if (parse) return parse(localStorage.getItem(key));
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw as unknown as T;
  });

  useEffect(() => {
    if (typeof state === 'string') {
      localStorage.setItem(key, state);
    } else {
      localStorage.setItem(key, JSON.stringify(state));
    }
  }, [key, state]);

  return [state, setState] as const;
};

const formatTime = (ts?: number) => {
  if (!ts) return '';
  const date = new Date(ts);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const FavoriteCard: React.FC<{
  item: FavoriteItem;
  viewMode: ViewMode;
  onOpen: (item: FavoriteItem) => void;
  onEdit: (item: FavoriteItem) => void;
  onDelete: (item: FavoriteItem) => void;
  t: TranslationBundle;
}> = ({ item, viewMode, onOpen, onEdit, onDelete, t }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const imageSrc = item.thumbnailDataUrl || item.thumbnailUrl;
  const showImage = Boolean(imageSrc) && !imageFailed;
  const showSiteIcon = Boolean(item.siteIconUrl);

  return (
    <div
      onClick={() => onOpen(item)}
      className={`group cursor-pointer rounded-2xl border border-zinc-800/60 bg-zinc-900/40 hover:bg-zinc-900/70 transition-all shadow-lg h-full ${
        viewMode === 'list' ? 'flex gap-6 p-5' : 'p-5'
      }`}
    >
      <div className={`${viewMode === 'list' ? 'w-44 shrink-0' : 'w-full'} relative`}>
        <div className="aspect-video rounded-xl overflow-hidden border border-zinc-800/60 bg-zinc-950">
          {showImage ? (
            <img
              src={imageSrc}
              alt={item.title}
              className="w-full h-full object-cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(79,70,229,0.35),_rgba(9,9,11,0.9))]">
              <svg className="w-10 h-10 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2zm4 10l3-3 4 4 5-5" />
              </svg>
            </div>
          )}
        </div>
        {item.duration && (
          <span className="absolute right-2 bottom-2 px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-black/70 text-zinc-200">
            {item.duration}
          </span>
        )}
      </div>

      <div className={`${viewMode === 'list' ? 'flex-1' : 'mt-4'} flex flex-col h-full space-y-3`}>
        <div>
          <h3 className="text-white text-sm font-black uppercase tracking-wide line-clamp-2">{item.title}</h3>
          {(item.siteName || showSiteIcon) && (
            <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
              {showSiteIcon && (
                <img
                  src={item.siteIconUrl}
                  alt={item.siteName || item.title}
                  className="w-4 h-4 rounded-sm border border-zinc-800/60 bg-zinc-900"
                />
              )}
              {item.siteName && <span>{item.siteName}</span>}
            </div>
          )}
        </div>
        {item.note && (
          <p className="text-zinc-400 text-xs leading-relaxed line-clamp-2">{item.note}</p>
        )}
        <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest text-zinc-600">
          <span>{t.favoritesSortRecent}: {formatTime(item.createdAt)}</span>
          {item.lastAccessedAt && <span>{t.favoritesSortAccessed}: {formatTime(item.lastAccessedAt)}</span>}
        </div>
        <div className="flex items-center gap-3 pt-2 mt-auto">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpen(item);
            }}
            className="p-2 rounded-full bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
            aria-label={t.favoritesOpen}
            title={t.favoritesOpen}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M10 14L21 3m0 0h-7m7 0v7M21 14v6a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h6" />
            </svg>
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onEdit(item);
            }}
            className="p-2 rounded-full bg-zinc-800 text-zinc-300 hover:text-white transition-colors"
            aria-label={t.favoritesEdit}
            title={t.favoritesEdit}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15.232 5.232l3.536 3.536M9 13l7.232-7.232a2.5 2.5 0 013.536 3.536L12.536 16.536a2 2 0 01-.848.51L8 18l.954-3.688a2 2 0 01.51-.848L9 13z" />
            </svg>
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDelete(item);
            }}
            className="p-2 rounded-full bg-zinc-900 text-zinc-500 hover:text-white border border-zinc-800 transition-colors"
            aria-label={t.favoritesDelete}
            title={t.favoritesDelete}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0h8m-8 0V5a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export const FavoritesModule: React.FC<{
  t: TranslationBundle;
  openAddSignal?: number;
  searchQuery: string;
}> = ({ t, openAddSignal, searchQuery }) => {
  const [favorites, setFavorites] = useLocalStorageState<FavoriteItem[]>(
    FAVORITES_STORAGE_KEY,
    [],
    parseFavorites
  );
  const [viewMode, setViewMode] = useLocalStorageState<ViewMode>(FAVORITES_VIEW_KEY, 'grid');
  const [sortMode, setSortMode] = useLocalStorageState<SortMode>(FAVORITES_SORT_KEY, 'recent');
  const [formMode, setFormMode] = useState<'manual' | 'json'>('manual');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<FavoriteItem[] | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [jsonInput, setJsonInput] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [jsonSuccess, setJsonSuccess] = useState('');
  const lastOpenAddSignalRef = useRef<number | null>(null);

  useEffect(() => {
    lastOpenAddSignalRef.current = typeof openAddSignal === 'number' ? openAddSignal : null;
  }, []);

  const handleOpen = useCallback((item: FavoriteItem) => {
    setFavorites((prev) =>
      prev.map((entry) =>
        entry.id === item.id ? { ...entry, lastAccessedAt: Date.now() } : entry
      )
    );
    window.open(item.url, '_blank', 'noopener,noreferrer');
  }, [setFavorites]);

  const handleDelete = useCallback((item: FavoriteItem) => {
    if (!window.confirm(t.favoritesDeleteConfirm)) return;
    setFavorites((prev) => prev.filter((entry) => entry.id !== item.id));
    if (editingId === item.id) {
      setEditingId(null);
      setForm(emptyForm);
    }
  }, [editingId, setFavorites, t.favoritesDeleteConfirm]);

  const handleEdit = useCallback((item: FavoriteItem) => {
    setEditingId(item.id);
    setPendingImport(null);
    setFormMode('manual');
    setJsonError('');
    setJsonSuccess('');
    setFetchError('');
    setIsFetchingMeta(false);
    setJsonInput(JSON.stringify({
      title: item.title,
      url: item.url,
      duration: item.duration,
      note: item.note,
      siteName: item.siteName,
      siteIconUrl: item.siteIconUrl,
      thumbnailUrl: item.thumbnailUrl,
      thumbnailDataUrl: item.thumbnailDataUrl
    }, null, 2));
    setForm({
      title: item.title,
      url: item.url,
      duration: item.duration || '',
      note: item.note || '',
      siteName: item.siteName || '',
      siteIconUrl: item.siteIconUrl || '',
      thumbnailUrl: item.thumbnailUrl || '',
      thumbnailDataUrl: item.thumbnailDataUrl || ''
    });
    setIsFormOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!form.title.trim() || !form.url.trim()) return;

    if (editingId) {
      setFavorites((prev) =>
        prev.map((entry) =>
          entry.id === editingId
            ? {
                ...entry,
                title: form.title.trim(),
                url: form.url.trim(),
                duration: form.duration.trim() || undefined,
                note: form.note.trim() || undefined,
                siteName: form.siteName.trim() || undefined,
                siteIconUrl: form.siteIconUrl.trim() || undefined,
                thumbnailUrl: form.thumbnailUrl.trim() || undefined,
                thumbnailDataUrl: form.thumbnailDataUrl || undefined
              }
            : entry
        )
      );
    } else {
      const now = Date.now();
      const manualEntry: FavoriteItem = {
        id: `fav-${now}-${Math.random().toString(16).slice(2)}`,
        title: form.title.trim(),
        url: form.url.trim(),
        duration: form.duration.trim() || undefined,
        note: form.note.trim() || undefined,
        siteName: form.siteName.trim() || undefined,
        siteIconUrl: form.siteIconUrl.trim() || undefined,
        thumbnailUrl: form.thumbnailUrl.trim() || undefined,
        thumbnailDataUrl: form.thumbnailDataUrl || undefined,
        createdAt: now
      };
      const nextItems = pendingImport?.length
        ? [
            {
              ...pendingImport[0],
              title: manualEntry.title,
              url: manualEntry.url,
              duration: manualEntry.duration,
              note: manualEntry.note,
              siteName: manualEntry.siteName,
              siteIconUrl: manualEntry.siteIconUrl,
              thumbnailUrl: manualEntry.thumbnailUrl,
              thumbnailDataUrl: manualEntry.thumbnailDataUrl
            },
            ...pendingImport.slice(1)
          ]
        : [manualEntry];
      setFavorites((prev) => [...nextItems, ...prev]);
    }

    setEditingId(null);
    setPendingImport(null);
    setForm(emptyForm);
    setFetchError('');
    setIsFetchingMeta(false);
    setIsFormOpen(false);
  }, [editingId, form, pendingImport, setFavorites]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setPendingImport(null);
    setForm(emptyForm);
    setFetchError('');
    setIsFetchingMeta(false);
    setIsFormOpen(false);
  }, []);

  const handleOpenAdd = useCallback(() => {
    setEditingId(null);
    setPendingImport(null);
    setForm(emptyForm);
    setFormMode('manual');
    setJsonInput('');
    setJsonError('');
    setJsonSuccess('');
    setFetchError('');
    setIsFetchingMeta(false);
    setIsFormOpen(true);
  }, []);

  useEffect(() => {
    if (typeof openAddSignal === 'number' && openAddSignal > 0 && openAddSignal !== lastOpenAddSignalRef.current) {
      lastOpenAddSignalRef.current = openAddSignal;
      handleOpenAdd();
    }
  }, [openAddSignal, handleOpenAdd]);

  useEffect(() => {
    if (formMode !== 'json') {
      setJsonError('');
      setJsonSuccess('');
    }
  }, [formMode]);

  const handleFetchMeta = useCallback(async () => {
    const url = form.url.trim();
    if (!url) {
      setFetchError(t.favoritesFetchMissingUrl);
      return;
    }
    if (!window.electronAPI?.favoritesFetchMeta) {
      setFetchError(t.favoritesFetchUnavailable);
      return;
    }

    setFetchError('');
    setIsFetchingMeta(true);
    try {
      const result = await window.electronAPI.favoritesFetchMeta(url);
      if (!result?.ok || !result.data) {
        setFetchError(t.favoritesFetchFailed);
        return;
      }

      const { title, duration, image } = result.data;
      const { siteName, siteIconUrl } = result.data;
      if (!title && !duration && !image && !siteName && !siteIconUrl) {
        setFetchError(t.favoritesFetchFailed);
        return;
      }

      setForm((prev) => ({
        ...prev,
        title: title || prev.title,
        duration: duration || prev.duration,
        thumbnailUrl: image || prev.thumbnailUrl,
        siteName: siteName || prev.siteName,
        siteIconUrl: siteIconUrl || prev.siteIconUrl
      }));
      if (!title || !duration || !image || !siteName || !siteIconUrl) {
        setFetchError(t.favoritesFetchPartial);
      }
    } catch {
      setFetchError(t.favoritesFetchFailed);
    } finally {
      setIsFetchingMeta(false);
    }
  }, [form.url, t.favoritesFetchFailed, t.favoritesFetchMissingUrl, t.favoritesFetchUnavailable]);

  const handleJsonImport = useCallback(() => {
    const cleaned = sanitizeJsonInput(jsonInput);
    if (!cleaned) return;
    try {
      const parsed = JSON.parse(cleaned);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const normalized = list
        .map((item) => normalizeFavorite(item))
        .filter((item): item is FavoriteItem => Boolean(item));

      if (normalized.length === 0) {
        setJsonError(t.favoritesInvalidJson);
        return;
      }
      const first = normalized[0];
      setJsonError('');
      setJsonSuccess(t.favoritesJsonSuccess);
      setPendingImport(normalized);
      setFormMode('manual');
      setForm({
        title: first.title,
        url: first.url,
        duration: first.duration || '',
        note: first.note || '',
        siteName: first.siteName || '',
        siteIconUrl: first.siteIconUrl || '',
        thumbnailUrl: first.thumbnailUrl || '',
        thumbnailDataUrl: first.thumbnailDataUrl || ''
      });
      setEditingId(null);
      setFetchError('');
      setIsFetchingMeta(false);
    } catch {
      setJsonError(t.favoritesInvalidJson);
    }
  }, [jsonInput, t.favoritesInvalidJson, t.favoritesJsonSuccess]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      setForm((prev) => ({
        ...prev,
        thumbnailDataUrl: result,
        thumbnailUrl: ''
      }));
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const filteredFavorites = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? favorites.filter((item) =>
          item.title.toLowerCase().includes(query) ||
          (item.note || '').toLowerCase().includes(query)
        )
      : favorites;

    return [...filtered].sort((a, b) => {
      if (sortMode === 'accessed') {
        return (b.lastAccessedAt || 0) - (a.lastAccessedAt || 0);
      }
      return b.createdAt - a.createdAt;
    });
  }, [favorites, searchQuery, sortMode]);

  return (
    <div className="space-y-10">
      <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-3xl p-6 space-y-0">
        <div className="flex flex-col xl:flex-row xl:items-center gap-6">
          <div className="flex-1 min-w-0" />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="bg-zinc-950 border border-zinc-800 text-zinc-400 text-xs font-bold uppercase tracking-wider rounded-full px-4 py-2 outline-none focus:ring-2 focus:ring-indigo-500/50 hover:text-white transition-colors cursor-pointer"
          >
            <option value="recent">{t.favoritesSortRecent}</option>
            <option value="accessed">{t.favoritesSortAccessed}</option>
          </select>
          <div className="flex bg-zinc-950 border border-zinc-800 rounded-full p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-full transition-colors ${
                viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-white'
              }`}
            >
              {t.favoritesViewGrid}
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-full transition-colors ${
                viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-white'
              }`}
            >
              {t.favoritesViewList}
            </button>
          </div>
        </div>
      </div>

      {filteredFavorites.length === 0 ? (
        <div className="text-center py-24 bg-zinc-900/30 border border-zinc-800/60 rounded-3xl">
          <h3 className="text-white text-2xl font-black uppercase tracking-widest">{t.favoritesEmptyTitle}</h3>
          <p className="text-zinc-500 text-sm mt-4">{t.favoritesEmptyDesc}</p>
        </div>
      ) : (
        <div
          className={`grid gap-6 ${
            viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'
          }`}
        >
          {filteredFavorites.map((item) => (
            <FavoriteCard
              key={item.id}
              item={item}
              viewMode={viewMode}
              onOpen={handleOpen}
              onEdit={handleEdit}
              onDelete={handleDelete}
              t={t}
            />
          ))}
        </div>
      )}

      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-4xl bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-white text-lg font-black uppercase tracking-widest">
                  {editingId ? t.favoritesEditTitle : t.favoritesAddTitle}
                </h2>
                <p className="text-zinc-500 text-xs uppercase tracking-[0.3em] mt-2">
                  {t.favoritesDesc}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex bg-zinc-950/60 border border-zinc-800 rounded-full p-1">
                  <button
                    onClick={() => setFormMode('manual')}
                    className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-full transition-colors ${
                      formMode === 'manual' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-white'
                    }`}
                  >
                    {t.favoritesManualTab}
                  </button>
                  <button
                    onClick={() => setFormMode('json')}
                    className={`px-4 py-1.5 text-[11px] font-black uppercase tracking-widest rounded-full transition-colors ${
                      formMode === 'json' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-white'
                    }`}
                  >
                    {t.favoritesJsonTab}
                  </button>
                </div>
                <button
                  onClick={handleCancelEdit}
                  className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  aria-label={t.favoritesCancel}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {formMode === 'manual' ? (
              <div className="space-y-4 mt-6">
                <div>
                  <label className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                    {t.favoritesUrlLabel}
                    <div className="mt-2 flex flex-col sm:flex-row gap-3">
                      <input
                        value={form.url}
                        onChange={(event) => {
                          setForm((prev) => ({ ...prev, url: event.target.value }));
                          if (fetchError) setFetchError('');
                        }}
                        placeholder="https://"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                      />
                      <button
                        onClick={handleFetchMeta}
                        disabled={isFetchingMeta}
                        className="px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {isFetchingMeta ? t.favoritesFetchLoading : t.favoritesFetchButton}
                      </button>
                    </div>
                  </label>
                  {fetchError && (
                    <p className="text-red-400 text-xs font-bold uppercase tracking-widest mt-2">{fetchError}</p>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                    {t.favoritesTitleLabel}
                    <input
                      value={form.title}
                      onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                      placeholder={t.favoritesTitleLabel}
                      className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                    />
                  </label>
                  <label className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                    {t.favoritesDurationLabel}
                    <input
                      value={form.duration}
                      onChange={(event) => setForm((prev) => ({ ...prev, duration: event.target.value }))}
                      placeholder="01:32:10"
                      className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                    {t.favoritesNoteLabel}
                    <input
                      value={form.note}
                      onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
                      placeholder={t.favoritesNoteLabel}
                      className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                    />
                  </label>
                  <label className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                    {t.favoritesThumbUrlLabel}
                    <input
                      value={form.thumbnailUrl}
                      onChange={(event) => setForm((prev) => ({ ...prev, thumbnailUrl: event.target.value }))}
                      placeholder="https://image..."
                      className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                    {t.favoritesSiteNameLabel}
                    <input
                      value={form.siteName}
                      onChange={(event) => setForm((prev) => ({ ...prev, siteName: event.target.value }))}
                      placeholder={t.favoritesSiteNameLabel}
                      className="mt-2 w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                    />
                  </label>
                  <label className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                    {t.favoritesSiteIconLabel}
                    <div className="mt-2 flex items-center gap-3">
                      <input
                        value={form.siteIconUrl}
                        onChange={(event) => setForm((prev) => ({ ...prev, siteIconUrl: event.target.value }))}
                        placeholder="https://favicon..."
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 outline-none"
                      />
                      {form.siteIconUrl && (
                        <img
                          src={form.siteIconUrl}
                          alt={form.siteName || t.favoritesSiteIconLabel}
                          className="w-9 h-9 rounded-lg border border-zinc-800 object-cover"
                        />
                      )}
                    </div>
                  </label>
                </div>
                <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                  {t.favoritesThumbUploadLabel}
                  <div className="mt-2 flex items-center gap-3">
                    <label className="cursor-pointer px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest bg-zinc-800 text-zinc-300 hover:text-white transition-colors">
                      {t.favoritesThumbUploadLabel}
                      <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                    </label>
                    {form.thumbnailDataUrl && (
                      <button
                        onClick={() => setForm((prev) => ({ ...prev, thumbnailDataUrl: '' }))}
                        className="text-[11px] font-black uppercase tracking-widest text-zinc-400 hover:text-white"
                      >
                        {t.favoritesClearThumb}
                      </button>
                    )}
                  </div>
                  {form.thumbnailDataUrl && (
                    <img
                      src={form.thumbnailDataUrl}
                      alt={t.favoritesThumbUploadLabel}
                      className="mt-3 h-20 rounded-lg border border-zinc-800 object-cover"
                    />
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSave}
                    disabled={!form.title.trim() || !form.url.trim()}
                    className="px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
                  >
                    {editingId ? t.favoritesUpdate : t.favoritesSave}
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800 transition-colors"
                  >
                    {t.favoritesCancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 mt-6">
                <textarea
                  value={jsonInput}
                  onChange={(event) => {
                    setJsonInput(event.target.value);
                    if (jsonError) setJsonError('');
                    if (jsonSuccess) setJsonSuccess('');
                  }}
                  placeholder={t.favoritesJsonPlaceholder}
                  className="w-full min-h-[220px] bg-zinc-950 border border-zinc-800 rounded-2xl px-5 py-4 text-sm text-zinc-200 focus:ring-2 focus:ring-indigo-500/50 outline-none resize-none"
                />
                {jsonError && <p className="text-red-400 text-xs font-bold uppercase tracking-widest">{jsonError}</p>}
                {jsonSuccess && <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">{jsonSuccess}</p>}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleJsonImport}
                    className="px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
                  >
                    {t.favoritesJsonImport}
                  </button>
                  <span className="text-zinc-500 text-xs uppercase tracking-widest">{t.favoritesJsonHint}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
