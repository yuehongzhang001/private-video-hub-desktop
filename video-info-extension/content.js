// Content script for extracting video metadata from the current page
// Enhanced with candidate scoring system based on Python reference implementation

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Normalize text: unescape HTML entities and collapse whitespace
 */
function normalizeText(text) {
    if (!text) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    const decoded = textarea.value;
    return decoded.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize URL relative to base URL
 */
function normalizeUrl(url, baseUrl) {
    if (!url) return null;
    url = url.trim();
    if (!url) return null;

    // Handle comma-separated or space-separated URLs
    if (url.includes(',') || url.includes(' ')) {
        url = url.split(',')[0].split(' ')[0];
    }

    try {
        return new URL(url, baseUrl).href;
    } catch (e) {
        return null;
    }
}

/**
 * Add a URL candidate with score and reason
 */
function addCandidate(candidates, url, score, reason) {
    const normalized = normalizeUrl(url, window.location.href);
    if (!normalized) return;
    candidates.push({ url: normalized, score, reason });
}

/**
 * Add a text candidate with score and reason
 */
function addTextCandidate(candidates, text, score, reason) {
    const value = normalizeText(text);
    if (!value) return;
    candidates.push({ value, score, reason });
}

// ============================================================================
// JSON-LD EXTRACTION
// ============================================================================

/**
 * Extract all JSON-LD scripts from the page
 */
function extractJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const items = [];

    scripts.forEach(script => {
        try {
            const data = JSON.parse(script.textContent);
            items.push(data);
        } catch (e) {
            // Ignore parsing errors
        }
    });

    return items;
}

/**
 * Recursively find all VideoObject items in JSON-LD data
 */
function* findVideoObjects(obj) {
    if (!obj) return;

    if (typeof obj === 'object' && !Array.isArray(obj)) {
        const types = obj['@type'] || obj['type'];

        // Check if this is a VideoObject
        if (Array.isArray(types)) {
            if (types.some(t => String(t).toLowerCase() === 'videoobject')) {
                yield obj;
            }
        } else if (typeof types === 'string' && types.toLowerCase() === 'videoobject') {
            yield obj;
        }

        // Check @graph
        const graph = obj['@graph'];
        if (Array.isArray(graph)) {
            for (const item of graph) {
                yield* findVideoObjects(item);
            }
        }

        // Recursively check other properties
        for (const value of Object.values(obj)) {
            if (typeof value === 'object') {
                yield* findVideoObjects(value);
            }
        }
    } else if (Array.isArray(obj)) {
        for (const item of obj) {
            yield* findVideoObjects(item);
        }
    }
}

// ============================================================================
// DURATION PARSING
// ============================================================================

/**
 * Parse duration from various formats to seconds
 */
function parseDurationSeconds(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;

    // ISO 8601 format: PT1H2M3S or P1DT2H3M4S
    const isoMatch = text.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (isoMatch) {
        const days = parseInt(isoMatch[1]) || 0;
        const hours = parseInt(isoMatch[2]) || 0;
        const minutes = parseInt(isoMatch[3]) || 0;
        const seconds = parseFloat(isoMatch[4]) || 0;
        return days * 86400 + hours * 3600 + minutes * 60 + seconds;
    }

    // Plain number (seconds)
    if (/^\d+(\.\d+)?$/.test(text)) {
        return parseFloat(text);
    }

    // Time format: HH:MM:SS or MM:SS
    if (text.includes(':')) {
        const parts = text.split(':');
        if (parts.length >= 2 && parts.length <= 3) {
            const nums = parts.map(p => parseFloat(p.trim()));
            if (nums.every(n => !isNaN(n))) {
                if (nums.length === 2) {
                    return nums[0] * 60 + nums[1];
                } else {
                    return nums[0] * 3600 + nums[1] * 60 + nums[2];
                }
            }
        }
    }

    return null;
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return null;
    const total = Math.round(seconds);
    if (total < 0) return null;

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Normalize duration value (parse and format)
 */
function normalizeDuration(value) {
    const seconds = parseDurationSeconds(value);
    if (seconds == null) return value;
    return formatDuration(seconds);
}

// ============================================================================
// TITLE EXTRACTION
// ============================================================================

/**
 * Split title by common separators and filter out site names
 */
function splitTitleParts(titleText, siteNames) {
    if (!titleText) return [];

    let parts = [titleText];
    const separators = [' | ', ' - ', ' :: ', ' / ', ' : '];

    for (const sep of separators) {
        if (titleText.includes(sep)) {
            parts = titleText.split(sep).map(p => p.trim()).filter(p => p);
            break;
        }
    }

    if (!parts.length) return [];

    // Filter out site names
    if (siteNames.size > 0) {
        const filtered = parts.filter(p => !siteNames.has(normalizeText(p).toLowerCase()));
        if (filtered.length > 0) {
            parts = filtered;
        }
    }

    return parts;
}

/**
 * Extract title candidates from all sources
 */
function extractTitleCandidates() {
    const metaCandidates = [];
    const otherCandidates = [];
    const siteNames = new Set();

    // Extract from meta tags
    const metaTags = document.querySelectorAll('meta');
    metaTags.forEach(meta => {
        const property = meta.getAttribute('property') || meta.getAttribute('name') || meta.getAttribute('itemprop');
        const content = meta.getAttribute('content');
        if (!property || !content) return;

        const key = property.toLowerCase();
        if (key === 'og:title') {
            addTextCandidate(metaCandidates, content, 90, key);
        } else if (key === 'twitter:title') {
            addTextCandidate(metaCandidates, content, 85, key);
        } else if (['title', 'headline', 'name'].includes(key)) {
            addTextCandidate(metaCandidates, content, 70, key);
        } else if (['og:site_name', 'application-name', 'site_name'].includes(key)) {
            siteNames.add(normalizeText(content).toLowerCase());
        }
    });

    // Extract from <title> tag
    const titleTag = document.querySelector('title');
    if (titleTag) {
        const titleText = normalizeText(titleTag.textContent);
        const parts = splitTitleParts(titleText, siteNames);
        if (parts.length > 0) {
            addTextCandidate(otherCandidates, parts[0], 60, 'title:tag:trimmed');
        } else {
            addTextCandidate(otherCandidates, titleText, 60, 'title:tag');
        }
    }

    // Extract from JSON-LD VideoObject
    const jsonLdItems = extractJsonLd();
    for (const item of jsonLdItems) {
        for (const video of findVideoObjects(item)) {
            const name = video.name || video.headline;
            addTextCandidate(otherCandidates, name, 95, 'jsonld:name');
        }
    }

    const candidates = [...metaCandidates, ...otherCandidates];
    if (candidates.length === 0) return { best: null, candidates: [], source: null };

    // Prefer meta candidates
    if (metaCandidates.length > 0) {
        const best = metaCandidates.reduce((a, b) => a.score > b.score ? a : b);
        return { best, candidates, source: 'meta' };
    }

    const best = otherCandidates.reduce((a, b) => a.score > b.score ? a : b);
    return { best, candidates, source: 'body' };
}

// ============================================================================
// THUMBNAIL EXTRACTION
// ============================================================================

/**
 * Extract thumbnail candidates from all sources
 */
function extractThumbnailCandidates() {
    const metaCandidates = [];
    const otherCandidates = [];

    // Extract from meta tags
    const metaTags = document.querySelectorAll('meta');
    metaTags.forEach(meta => {
        const property = meta.getAttribute('property') || meta.getAttribute('name') || meta.getAttribute('itemprop');
        const content = meta.getAttribute('content');
        if (!property || !content) return;

        const key = property.toLowerCase();
        if (['og:image', 'og:image:url'].includes(key)) {
            addCandidate(metaCandidates, content, 90, key);
        } else if (key === 'og:image:secure_url') {
            addCandidate(metaCandidates, content, 88, key);
        } else if (['twitter:image', 'twitter:image:src'].includes(key)) {
            addCandidate(metaCandidates, content, 80, key);
        } else if (['thumbnail', 'thumbnailurl', 'thumbnail_url'].includes(key)) {
            addCandidate(metaCandidates, content, 85, key);
        } else if (key === 'image') {
            addCandidate(metaCandidates, content, 50, key);
        }
        // Support custom meta tags with cover/poster/thumbnail patterns
        else if (key.includes('cover') && key.includes('image')) {
            // Matches patterns like: lark:url:video_cover_image_url, video_cover_image, etc.
            addCandidate(metaCandidates, content, 87, key);
        } else if (key.includes('poster') && (key.includes('url') || key.includes('image'))) {
            // Matches patterns like: poster_url, video_poster_image, etc.
            addCandidate(metaCandidates, content, 86, key);
        } else if (key.includes('cover') && key.includes('url')) {
            // Matches patterns like: cover_url, video_cover_url, etc.
            addCandidate(metaCandidates, content, 84, key);
        }
    });

    // Extract from <link> tags
    const links = document.querySelectorAll('link');
    links.forEach(link => {
        const rel = link.getAttribute('rel');
        const href = link.getAttribute('href');
        if (!rel || !href) return;

        if (rel.toLowerCase().includes('image_src')) {
            addCandidate(otherCandidates, href, 75, 'link:rel=image_src');
        }
    });

    // Extract from <video> poster attributes
    const videos = document.querySelectorAll('video[poster]');
    videos.forEach(video => {
        const poster = video.getAttribute('poster');
        if (poster) {
            addCandidate(otherCandidates, poster, 70, 'video:poster');
        }
    });

    // Extract from images with thumb/poster class
    const images = document.querySelectorAll('img');
    images.forEach(img => {
        const src = img.getAttribute('src') || img.getAttribute('data-src');
        const className = img.getAttribute('class') || '';
        const classLower = className.toLowerCase();

        if (src && (classLower.includes('thumb') || classLower.includes('poster'))) {
            addCandidate(otherCandidates, src, 35, 'img:class');
        }
    });

    // Extract from JSON-LD VideoObject
    const jsonLdItems = extractJsonLd();
    for (const item of jsonLdItems) {
        for (const video of findVideoObjects(item)) {
            const thumb = video.thumbnailUrl || video.thumbnailURL || video.thumbnail;
            if (Array.isArray(thumb)) {
                thumb.forEach(t => addCandidate(otherCandidates, t, 95, 'jsonld:thumbnailUrl'));
            } else {
                addCandidate(otherCandidates, thumb, 95, 'jsonld:thumbnailUrl');
            }
        }
    }

    const candidates = [...metaCandidates, ...otherCandidates];
    if (candidates.length === 0) return { best: null, candidates: [], source: null };

    // Prefer meta candidates
    if (metaCandidates.length > 0) {
        const best = metaCandidates.reduce((a, b) => a.score > b.score ? a : b);
        return { best, candidates, source: 'meta' };
    }

    const best = otherCandidates.reduce((a, b) => a.score > b.score ? a : b);
    return { best, candidates, source: 'body' };
}

// ============================================================================
// PAGE IMAGE EXTRACTION
// ============================================================================

/**
 * Extract all page images in top-to-bottom order
 */
function extractPageImages() {
    const images = Array.from(document.querySelectorAll('img'));
    const seen = new Set();
    const collected = [];

    images.forEach((img, order) => {
        const src =
            img.currentSrc ||
            img.getAttribute('src') ||
            img.getAttribute('data-src') ||
            img.getAttribute('data-original') ||
            img.getAttribute('data-lazy-src');

        const normalized = normalizeUrl(src, window.location.href);
        if (!normalized || seen.has(normalized)) return;

        const rect = img.getBoundingClientRect();
        const top = rect.top + window.scrollY;

        seen.add(normalized);
        collected.push({ url: normalized, top, order });
    });

    collected.sort((a, b) => {
        if (a.top === b.top) return a.order - b.order;
        return a.top - b.top;
    });

    return collected.map(item => item.url);
}

// ============================================================================
// DURATION EXTRACTION
// ============================================================================

/**
 * Extract duration candidates from all sources
 */
function extractDurationCandidates() {
    const metaCandidates = [];
    const otherCandidates = [];

    // Extract from meta tags
    const metaTags = document.querySelectorAll('meta');
    metaTags.forEach(meta => {
        const property = meta.getAttribute('property') || meta.getAttribute('name') || meta.getAttribute('itemprop');
        const content = meta.getAttribute('content');
        if (!property || !content) return;

        const key = property.toLowerCase();
        if (['og:video:duration', 'video:duration'].includes(key)) {
            addTextCandidate(metaCandidates, content, 90, key);
        } else if (['duration', 'twitter:player:stream:duration'].includes(key)) {
            addTextCandidate(metaCandidates, content, 80, key);
        }
    });

    // Extract from JSON-LD VideoObject
    const jsonLdItems = extractJsonLd();
    for (const item of jsonLdItems) {
        for (const video of findVideoObjects(item)) {
            const duration = video.duration;
            addTextCandidate(otherCandidates, duration, 95, 'jsonld:duration');
        }
    }

    // Extract from video elements
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        if (video.duration && !isNaN(video.duration) && video.duration !== Infinity) {
            addTextCandidate(otherCandidates, String(Math.floor(video.duration)), 85, 'video:duration');
        }

        // Also check the container of the video for text duration
        const container = video.closest('div, article, section, li') || video.parentElement;
        if (container) {
            const text = normalizeText(container.innerText); // use innerText to get visible text

            // Pattern: Keyword ... Time (e.g. "Duration: 12:30", "Time: 5:00")
            // Matches: duration/time/length followed by optional charuacters and then a time string
            const keywordPattern = /(?:duration|time|length|时长|时间)[\s\S]{0,20}?(\d+(?::\d+){1,2})/i;
            const match = text.match(keywordPattern);
            if (match) {
                addTextCandidate(otherCandidates, match[1], 60, 'text:keyword+time');
            }
        }
    });

    // Scan specific elements likely to contain duration
    // Elements with class/id containing 'duration', 'time', 'length'
    const potentialDurationEls = document.querySelectorAll('[class*="duration"], [class*="time"], [class*="length"], [id*="duration"], [id*="time"]');
    potentialDurationEls.forEach(el => {
        // Skip if too large (likely a container, not a label)
        if (el.innerText.length > 20) return;

        const text = normalizeText(el.innerText);
        // Strict time match: MM:SS or HH:MM:SS
        const timeMatch = text.match(/^(\d+(?::\d+){1,2})$/);
        if (timeMatch) {
            addTextCandidate(otherCandidates, timeMatch[1], 55, 'element:class+time');
        }
    });

    const candidates = [...metaCandidates, ...otherCandidates];
    if (candidates.length === 0) return { best: null, candidates: [], source: null };

    // Prefer meta candidates
    if (metaCandidates.length > 0) {
        const best = metaCandidates.reduce((a, b) => a.score > b.score ? a : b);
        return { best, candidates, source: 'meta' };
    }

    const best = otherCandidates.reduce((a, b) => a.score > b.score ? a : b);
    return { best, candidates, source: 'body' };
}

// ============================================================================
// IFRAME EXTRACTION
// ============================================================================

/**
 * Find the best iframe (likely video embed)
 */
function extractBestIframe() {
    const iframes = document.querySelectorAll('iframe');
    if (iframes.length === 0) return null;

    const baseHost = window.location.hostname.toLowerCase();
    const scored = [];

    iframes.forEach(iframe => {
        const src = iframe.getAttribute('src');
        if (!src) return;

        const normalized = normalizeUrl(src, window.location.href);
        if (!normalized) return;

        let score = 0;
        const lower = normalized.toLowerCase();

        if (lower.includes('embed')) score += 10;
        if (lower.includes('player')) score += 5;

        try {
            const url = new URL(normalized);
            if (url.hostname.toLowerCase() === baseHost) {
                score += 8;
            }
        } catch (e) {
            // Ignore URL parsing errors
        }

        scored.push({ url: normalized, score });
    });

    if (scored.length === 0) return null;

    scored.sort((a, b) => b.score - a.score);
    return scored[0].url;
}

// ============================================================================
// SITE INFO EXTRACTION
// ============================================================================

/**
 * Extract site name candidates
 */
function extractSiteNameCandidates() {
    const metaCandidates = [];
    const otherCandidates = [];

    // Extract from meta tags
    const metaTags = document.querySelectorAll('meta');
    metaTags.forEach(meta => {
        const property = meta.getAttribute('property') || meta.getAttribute('name') || meta.getAttribute('itemprop');
        const content = meta.getAttribute('content');
        if (!property || !content) return;

        const key = property.toLowerCase();
        if (['og:site_name', 'application-name', 'site_name'].includes(key)) {
            addTextCandidate(metaCandidates, content, 90, key);
        } else if (['publisher', 'creator'].includes(key)) {
            addTextCandidate(metaCandidates, content, 60, key);
        }
    });

    // Extract from JSON-LD
    const jsonLdItems = extractJsonLd();
    for (const item of jsonLdItems) {
        // Look for publisher / provider
        const publisher = item.publisher || item.provider;
        if (publisher && publisher.name) {
            addTextCandidate(otherCandidates, publisher.name, 95, 'jsonld:publisher');
        }
    }

    // Extract from title (Suffix: "Title - SiteName")
    const title = document.title;
    if (title) {
        const parts = title.split(/ [-|] /);
        if (parts.length > 1) {
            addTextCandidate(otherCandidates, parts[parts.length - 1], 40, 'title:suffix');
        }
    }

    const candidates = [...metaCandidates, ...otherCandidates];
    if (candidates.length === 0) return { best: null, candidates: [], source: null };

    // Prefer meta candidates
    if (metaCandidates.length > 0) {
        const best = metaCandidates.reduce((a, b) => a.score > b.score ? a : b);
        return { best, candidates, source: 'meta' };
    }

    const best = otherCandidates.reduce((a, b) => a.score > b.score ? a : b);
    return { best, candidates, source: 'body' };
}

/**
 * Extract site icon candidates
 */
function extractSiteIconCandidates() {
    const candidates = [];

    // Extract from link tags (highest priority)
    const links = document.querySelectorAll('link');
    links.forEach(link => {
        const rel = (link.getAttribute('rel') || '').toLowerCase();
        const href = link.getAttribute('href');
        if (!href) return;

        if (rel.includes('apple-touch-icon')) {
            addCandidate(candidates, href, 90, 'link:apple-touch-icon');
        } else if (rel.includes('shortcut icon')) {
            addCandidate(candidates, href, 85, 'link:shortcut-icon');
        } else if (rel === 'icon') {
            addCandidate(candidates, href, 80, 'link:icon');
        }
    });

    // Extract from JSON-LD
    const jsonLdItems = extractJsonLd();
    for (const item of jsonLdItems) {
        const publisher = item.publisher || item.provider;
        if (publisher && publisher.logo) {
            const logoUrl = typeof publisher.logo === 'string' ? publisher.logo : publisher.logo.url;
            if (logoUrl) {
                addCandidate(candidates, logoUrl, 95, 'jsonld:publisher:logo');
            }
        }

    }

    // Default favicon (lowest priority)
    try {
        const favicon = new URL('/favicon.ico', window.location.href).href;
        addCandidate(candidates, favicon, 10, 'default:favicon');
    } catch (e) { }

    if (candidates.length === 0) return { best: null, candidates: [], source: null };

    const best = candidates.reduce((a, b) => a.score > b.score ? a : b);
    return { best, candidates, source: best.reason.split(':')[0] };
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

// Store the best results found so far to handle cases where data disappears
// (e.g., poster image removed after video starts playing)
let g_bestResult = {
    url: window.location.href,
    title: null,
    thumbnailUrl: null,
    duration: null,
    iframe: null,
    siteName: null,
    siteIconUrl: null,
    score: 0
};

/**
 * Merge new results with existing best results
 * Preserves high-quality data (like thumbnails) even if they disappear from DOM
 */
function mergeResult(newResult) {
    if (!newResult) return g_bestResult;

    // Helper: is this duration likely an ad? (Short duration < 120s when we previously saw a long one)
    const isLikelyAd = (durStr) => {
        const sec = parseDurationSeconds(durStr);
        return sec && sec < 120; // Assume ads are < 2 mins usually
    };

    // Update URL if changed (SPA navigation)
    if (newResult.url !== g_bestResult.url) {
        g_bestResult = newResult; // Reset if URL changed completely
        return g_bestResult;
    }

    // 1. Title
    if (newResult.title) {
        g_bestResult.title = newResult.title;
    }

    // 2. Thumbnail
    if (newResult.thumbnailUrl) {
        g_bestResult.thumbnailUrl = newResult.thumbnailUrl;
    }

    // 3. Duration
    if (newResult.duration) {
        if (!g_bestResult.duration) {
            g_bestResult.duration = newResult.duration;
        }
        else if (isLikelyAd(g_bestResult.duration) && !isLikelyAd(newResult.duration)) {
            g_bestResult.duration = newResult.duration;
        }
        else if (normalizeDuration(newResult.duration) !== normalizeDuration(g_bestResult.duration)) {
            g_bestResult.duration = newResult.duration;
        }
    }

    // 4. Iframe
    if (newResult.iframe) {
        g_bestResult.iframe = newResult.iframe;
    }

    // 5. Site Name
    if (newResult.siteName) {
        g_bestResult.siteName = newResult.siteName;
    }

    // 6. Site Icon
    if (newResult.siteIconUrl) {
        g_bestResult.siteIconUrl = newResult.siteIconUrl;
    }

    return g_bestResult;
}

/**
 * Extract all video information using candidate scoring system
 */
function extractVideoInfo() {
    const titleResult = extractTitleCandidates();
    const thumbnailResult = extractThumbnailCandidates();
    const durationResult = extractDurationCandidates();
    const iframe = extractBestIframe();
    const siteNameResult = extractSiteNameCandidates();
    const siteIconResult = extractSiteIconCandidates();

    // Build the current status result
    const currentResult = {
        url: window.location.href,
        title: titleResult.best ? titleResult.best.value : null,
        thumbnailUrl: thumbnailResult.best ? thumbnailResult.best.url : null,
        duration: durationResult.best ? normalizeDuration(durationResult.best.value) : null,
        iframe: iframe,
        siteName: siteNameResult.best ? siteNameResult.best.value : null,
        siteIconUrl: siteIconResult.best ? siteIconResult.best.url : null,
        source: 'enhanced-extraction',
        timestamp: Date.now()
    };

    // Log sources for debugging (only if something changed)
    // console.log('[Video Info Parser] Extracted:', currentResult);

    return [mergeResult(currentResult)];
}

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractVideoInfo') {
        const videoInfo = extractVideoInfo();
        const pageImages = extractPageImages();
        sendResponse({ videos: videoInfo, pageImages });
    }
    return true;
});

// Initial extraction to capture data on load (for merging later)
setTimeout(() => {
    extractVideoInfo();
}, 1000);

console.log('Video Info Parser content script loaded (Manual Mode)');
