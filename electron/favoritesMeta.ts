type MetaResult = {
  title?: string;
  duration?: string;
  image?: string;
  siteName?: string;
  siteIconUrl?: string;
};
type MetaParseResult = {
  meta: MetaResult;
  keys: string[];
  candidates: {
    title: string[];
    image: string[];
    duration: string[];
    siteName: string[];
    siteIconUrl: string[];
  };
};

const META_MAX_BYTES = 512 * 1024;

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));

const resolveUrl = (raw: string, base: string) => {
  if (!raw) return raw;
  if (raw.startsWith('data:')) return raw;
  try {
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
};

const isYouTubeHost = (hostname: string) =>
  hostname === 'youtube.com' ||
  hostname.endsWith('.youtube.com') ||
  hostname === 'youtu.be';

const fetchYouTubeOEmbed = async (targetUrl: string, signal: AbortSignal) => {
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', targetUrl);
  endpoint.searchParams.set('format', 'json');
  const response = await fetch(endpoint.toString(), { signal });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    title?: string;
    thumbnail_url?: string;
    provider_name?: string;
  };
  return {
    title: data.title,
    image: data.thumbnail_url,
    siteName: data.provider_name
  };
};

const normalizeSiteName = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

const siteNameFromTitle = (title?: string) => {
  if (!title) return undefined;
  const separators = [' - ', ' | ', ' · ', ' – ', ' — ', ' — '];
  for (const separator of separators) {
    if (title.includes(separator)) {
      const parts = title.split(separator).map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const candidate = parts[parts.length - 1];
        if (candidate && candidate.length <= 50) return candidate;
      }
    }
  }
  return undefined;
};

const siteNameFromHost = (hostname: string) => {
  const host = hostname.replace(/^www\./i, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length === 0) return undefined;
  let root = parts[0];
  if (parts.length >= 3) {
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    if (tld.length === 2 && sld.length <= 3 && parts.length >= 3) {
      root = parts[parts.length - 3];
    } else {
      root = sld;
    }
  } else if (parts.length === 2) {
    root = parts[0];
  }
  return normalizeSiteName(root);
};

const extractTitle = (html: string) => {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).trim() : '';
};

const parseIsoDuration = (value: string) => {
  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return hours * 3600 + minutes * 60 + seconds;
};

const formatDurationSeconds = (seconds: number) => {
  if (!isFinite(seconds) || seconds <= 0) return '';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const parseMetaFromHtml = (html: string, baseUrl: string): MetaParseResult => {
  const metaTags = html.match(/<meta\s+[^>]*>/gi) || [];
  const map = new Map<string, string>();

  for (const tag of metaTags) {
    const attrs = new Map<string, string>();
    const attrRegex = /([^\s=]+)\s*=\s*["']([^"']*)["']/g;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(tag)) !== null) {
      attrs.set(match[1].toLowerCase(), match[2]);
    }
    const key = attrs.get('property') || attrs.get('name') || attrs.get('itemprop');
    const content = attrs.get('content') || '';
    if (key && content) {
      map.set(key.toLowerCase(), decodeHtmlEntities(content).trim());
    }
  }

  const title =
    map.get('og:title') ||
    map.get('twitter:title') ||
    map.get('title') ||
    extractTitle(html);

  const siteNameCandidates = [
    map.get('og:site_name'),
    map.get('application-name'),
    map.get('apple-mobile-web-app-title'),
    map.get('twitter:site')
  ].filter((value): value is string => Boolean(value));
  const siteName = siteNameCandidates[0];

  const imageCandidates = [
    map.get('og:image'),
    map.get('twitter:image'),
    map.get('twitter:image:src'),
    map.get('lark:url:video_cover_image_url'),
    map.get('image')
  ].filter((value): value is string => Boolean(value));
  const image = imageCandidates[0];

  const linkTags = html.match(/<link\s+[^>]*>/gi) || [];
  const iconCandidates: string[] = [];
  for (const tag of linkTags) {
    const attrs = new Map<string, string>();
    const attrRegex = /([^\s=]+)\s*=\s*["']([^"']*)["']/g;
    let match: RegExpExecArray | null;
    while ((match = attrRegex.exec(tag)) !== null) {
      attrs.set(match[1].toLowerCase(), match[2]);
    }
    const relRaw = attrs.get('rel');
    const hrefRaw = attrs.get('href');
    if (!relRaw || !hrefRaw) continue;
    const rel = relRaw.toLowerCase();
    if (
      rel.includes('icon') ||
      rel.includes('shortcut') ||
      rel.includes('apple-touch-icon') ||
      rel.includes('mask-icon')
    ) {
      iconCandidates.push(resolveUrl(decodeHtmlEntities(hrefRaw), baseUrl));
    }
  }
  const siteIconUrl = iconCandidates[0];

  let duration: string | undefined;
  const durationCandidates = [
    map.get('og:video:duration'),
    map.get('duration'),
    map.get('video:duration'),
    map.get('video_duration')
  ].filter((value): value is string => Boolean(value));
  const durationRaw = durationCandidates[0];

  if (durationRaw) {
    const numeric = Number(durationRaw);
    if (Number.isFinite(numeric)) {
      duration = formatDurationSeconds(numeric);
    } else {
      const iso = parseIsoDuration(durationRaw);
      if (iso != null) duration = formatDurationSeconds(iso);
    }
  } else {
    const iso = map.get('duration');
    if (iso) {
      const parsed = parseIsoDuration(iso);
      if (parsed != null) duration = formatDurationSeconds(parsed);
    }
  }

  return {
    meta: {
      title: title || undefined,
      duration,
      image: image || undefined,
      siteName: siteName || undefined,
      siteIconUrl: siteIconUrl || undefined
    },
    keys: Array.from(map.keys()),
    candidates: {
      title: [
        map.get('og:title'),
        map.get('twitter:title'),
        map.get('title')
      ].filter((value): value is string => Boolean(value)),
      image: imageCandidates,
      duration: durationCandidates,
      siteName: siteNameCandidates,
      siteIconUrl: iconCandidates
    }
  };
};

export const fetchFavoritesMeta = async (targetUrl: string) => {
  let urlParsed: URL;
  try {
    urlParsed = new URL(targetUrl);
  } catch {
    return { ok: false, error: 'invalid_url' } as const;
  }

  if (!['http:', 'https:'].includes(urlParsed.protocol)) {
    return { ok: false, error: 'invalid_protocol' } as const;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(urlParsed.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PrivateVideoHub/1.0'
      }
    });

    if (!response.ok) {
      return { ok: false, error: `status_${response.status}` } as const;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const html = buffer.subarray(0, META_MAX_BYTES).toString('utf8');
    const parsed = parseMetaFromHtml(html, urlParsed.toString());
    const meta = parsed.meta;
    let resolvedMeta: MetaResult = {
      ...meta,
      siteIconUrl: meta.siteIconUrl ? resolveUrl(meta.siteIconUrl, urlParsed.toString()) : undefined
    };

    if (isYouTubeHost(urlParsed.hostname) && (!resolvedMeta.title || !resolvedMeta.image)) {
      try {
        const oembed = await fetchYouTubeOEmbed(urlParsed.toString(), controller.signal);
        if (oembed) {
          resolvedMeta = {
            ...resolvedMeta,
            title: resolvedMeta.title || oembed.title,
            image: resolvedMeta.image || oembed.image,
            siteName: resolvedMeta.siteName || oembed.siteName
          };
        }
      } catch {
        // Keep meta-only results if oEmbed fails.
      }
    }

    if (!resolvedMeta.siteName) {
      const titleCandidate = siteNameFromTitle(resolvedMeta.title);
      resolvedMeta = {
        ...resolvedMeta,
        siteName: titleCandidate || siteNameFromHost(urlParsed.hostname)
      };
    }

    if (!resolvedMeta.title && !resolvedMeta.duration && !resolvedMeta.image) {
      const missing: string[] = [];
      if (!resolvedMeta.title) missing.push('title');
      if (!resolvedMeta.duration) missing.push('duration');
      if (!resolvedMeta.image) missing.push('image');
      const keys = parsed.keys.join(', ') || 'none';
      const titleCandidates = parsed.candidates.title.join(' | ') || 'none';
      const imageCandidates = parsed.candidates.image.join(' | ') || 'none';
      const durationCandidates = parsed.candidates.duration.join(' | ') || 'none';
      const siteNameCandidates = parsed.candidates.siteName.join(' | ') || 'none';
      const siteIconCandidates = parsed.candidates.siteIconUrl.join(' | ') || 'none';
      console.warn(
        `[favoritesMeta] parse failed: url=${targetUrl} missing=${missing.join(', ')} keys=${keys}`
      );
      console.warn(
        `[favoritesMeta] candidates: title=${titleCandidates} image=${imageCandidates} duration=${durationCandidates} siteName=${siteNameCandidates} siteIconUrl=${siteIconCandidates}`
      );
      return { ok: false, error: 'no_meta' } as const;
    }

    return { ok: true, data: resolvedMeta } as const;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message } as const;
  } finally {
    clearTimeout(timeout);
  }
};
