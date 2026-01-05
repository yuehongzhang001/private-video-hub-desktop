type MetaResult = { title?: string; duration?: string; image?: string };

const META_MAX_BYTES = 512 * 1024;

const extractTitle = (html: string) => {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : '';
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

const parseMetaFromHtml = (html: string): MetaResult => {
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
      map.set(key.toLowerCase(), content.trim());
    }
  }

  const title =
    map.get('og:title') ||
    map.get('twitter:title') ||
    map.get('title') ||
    extractTitle(html);

  const image =
    map.get('og:image') ||
    map.get('twitter:image') ||
    map.get('twitter:image:src') ||
    map.get('image');

  let duration: string | undefined;
  const durationRaw =
    map.get('og:video:duration') ||
    map.get('duration') ||
    map.get('video:duration') ||
    map.get('video_duration');

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
    title: title || undefined,
    duration,
    image: image || undefined
  };
};

export const fetchFavoritesMeta = async (targetUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { ok: false, error: 'invalid_url' } as const;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'invalid_protocol' } as const;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(parsed.toString(), {
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
    const meta = parseMetaFromHtml(html);

    if (!meta.title && !meta.duration && !meta.image) {
      return { ok: false, error: 'no_meta' } as const;
    }

    return { ok: true, data: meta } as const;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message } as const;
  } finally {
    clearTimeout(timeout);
  }
};
