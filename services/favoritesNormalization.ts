export type FavoriteItem = {
  id: string;
  title: string;
  url: string;
  duration?: string;
  note?: string;
  siteName?: string;
  siteIconUrl?: string;
  thumbnailUrl?: string;
  thumbnailDataUrl?: string;
  rating?: number;
  createdAt: number;
  lastAccessedAt?: number;
  clickCount: number;
};

export const FAVORITES_STORAGE_KEY = 'vhub-favorites';

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

const normalizeRating = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded >= 1 && rounded <= 5) return rounded;
    return undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const rounded = Math.round(parsed);
      if (rounded >= 1 && rounded <= 5) return rounded;
    }
  }
  return undefined;
};

const normalizeClickCount = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return 0;
};

export const normalizeFavorite = (item: any): FavoriteItem | null => {
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
  const rating = normalizeRating(item.rating ?? item.stars ?? item.score);
  const clickCount = normalizeClickCount(item.clickCount ?? item.clicks ?? item.openCount);

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
    rating,
    createdAt,
    lastAccessedAt,
    clickCount
  };
};

export const parseFavorites = (raw: string | null): FavoriteItem[] => {
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

export const normalizeIncomingFavorites = (payload: unknown) => {
  if (payload == null) return [];
  let data: unknown = payload;

  if (typeof payload === 'string') {
    try {
      data = JSON.parse(payload);
    } catch {
      return [];
    }
  }

  if (data && typeof data === 'object') {
    const candidate = data as Record<string, unknown>;
    data = candidate.favorites ?? candidate.favorite ?? candidate.data ?? candidate.payload ?? data;
    if (data && typeof data === 'object') {
      const nested = data as Record<string, unknown>;
      data = nested.favorites ?? nested.favorite ?? nested.data ?? nested.payload ?? data;
    }
  }

  const list = Array.isArray(data) ? data : [data];
  return list
    .map((item) => normalizeFavorite(item))
    .filter((item): item is FavoriteItem => Boolean(item));
};
