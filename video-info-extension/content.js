// Content script for extracting video metadata from the current page.
// Also supports opt-in hover tracking for candidate video info on list pages.

;(() => {
    const existingController = globalThis.__vhubContentScriptController;
    if (existingController && typeof existingController.deactivate === 'function') {
        try {
            existingController.deactivate();
        } catch (error) {
            console.debug('Previous content script deactivate failed:', error);
        }
    }

    const STORAGE_KEYS = {
        autoTrackEnabled: 'autoTrackCandidateVideoInfoEnabled',
        hoverPreviewVisible: 'hoverPreviewVisibleEnabled',
        hoverPreview: 'hoverPreviewVideoInfo',
        pendingNavigationCandidate: 'pendingNavigationCandidateVideoInfo'
    };

const HOVER_TRACK_DELAY_MS = 140;
const HOVER_PREVIEW_OVERLAY_ID = 'vhub-hover-preview-overlay';
const HOVER_PREVIEW_STYLE_ID = 'vhub-hover-preview-style';

let g_autoTrackEnabled = false;
let g_hoverPreviewVisible = true;
let g_hoverTimer = null;
let g_lastHoverTarget = null;
let g_lastCandidateSignature = '';
let g_hoverPreviewOverlay = null;
let g_hoverPreviewOverlayEls = null;
let g_lastResolvedPageUrl = '';
let g_navigationPollTimer = null;
let g_extensionContextActive = true;
let g_lastHoverCandidate = null;

function isExtensionContextInvalidatedError(error) {
    return String(error?.message || error || '').includes('Extension context invalidated');
}

function deactivateExtensionContext() {
    if (!g_extensionContextActive) return;
    g_extensionContextActive = false;
    g_autoTrackEnabled = false;
    g_lastHoverTarget = null;
    g_lastHoverCandidate = null;

    if (g_hoverTimer) {
        clearTimeout(g_hoverTimer);
        g_hoverTimer = null;
    }

    if (g_navigationPollTimer) {
        clearInterval(g_navigationPollTimer);
        g_navigationPollTimer = null;
    }

    hideHoverPreviewOverlay();
}

    globalThis.__vhubContentScriptController = {
        deactivate: deactivateExtensionContext
    };

function isExtensionContextActive() {
    if (!g_extensionContextActive) return false;

    try {
        return Boolean(chrome?.runtime?.id);
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
            deactivateExtensionContext();
            return false;
        }
        throw error;
    }
}

function runWithExtensionContext(task) {
    if (!isExtensionContextActive()) return false;

    try {
        task();
        return true;
    } catch (error) {
        if (isExtensionContextInvalidatedError(error)) {
            deactivateExtensionContext();
            return false;
        }
        throw error;
    }
}

function setSessionStorageValue(key, value, debugLabel) {
    return runWithExtensionContext(() => {
        chrome.storage.session.set(
            { [key]: value },
            () => {
                if (!isExtensionContextActive()) return;
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    console.debug(`${debugLabel} storage write failed:`, lastError.message);
                }
            }
        );
    });
}

function summarizeVideoInfo(video) {
    if (!video) return null;
    return {
        title: video.title || '',
        detailPageUrl: video.detailPageUrl || video.url || '',
        thumbnailUrl: video.thumbnailUrl || '',
        duration: video.duration || '',
        matchKey: video.matchKey || '',
        looseMatchKey: video.looseMatchKey || '',
        navigationTargetIdentityKey: video.navigationTargetIdentityKey || '',
        capturedFromPageUrl: video.capturedFromPageUrl || ''
    };
}

function appendDebugLog(event, data) {
    return runWithExtensionContext(() => {
        chrome.runtime.sendMessage(
            {
                action: 'appendDebugLog',
                source: 'content',
                event,
                data
            },
            () => {
                if (!isExtensionContextActive()) return;
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    console.debug(`Debug log send failed (${event}):`, lastError.message);
                }
            }
        );
    });
}

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        const didRun = runWithExtensionContext(() => {
            chrome.runtime.sendMessage(message, (response) => {
                if (!isExtensionContextActive()) {
                    reject(new Error('Extension context inactive'));
                    return;
                }

                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    reject(new Error(lastError.message));
                    return;
                }

                if (response && response.ok === false) {
                    reject(new Error(response.error || 'Extension message failed'));
                    return;
                }

                resolve(response);
            });
        });

        if (!didRun) {
            reject(new Error('Extension context inactive'));
        }
    });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Normalize text: unescape HTML entities and collapse whitespace.
 */
function normalizeText(text) {
    if (!text) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    const decoded = textarea.value;
    return decoded.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize URL relative to base URL.
 */
function normalizeUrl(url, baseUrl) {
    if (!url) return null;
    url = url.trim();
    if (!url) return null;

    if (url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('tel:')) {
        return null;
    }

    // Handle comma-separated or space-separated URLs.
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
 * Normalize page URL for matching.
 */
function normalizePageUrl(url) {
    const normalized = normalizeUrl(url, window.location.href);
    if (!normalized) return null;

    try {
        const parsed = new URL(normalized);
        parsed.hash = '';
        return parsed.href;
    } catch (e) {
        return normalized;
    }
}

/**
 * Build strict/loose page match keys for candidate matching.
 */
function buildPageMatchKeys(url) {
    const normalized = normalizePageUrl(url);
    if (!normalized) return { matchKey: null, looseMatchKey: null };

    try {
        const parsed = new URL(normalized);
        return {
            matchKey: `${parsed.origin}${parsed.pathname}${parsed.search}`,
            looseMatchKey: `${parsed.origin}${parsed.pathname}`
        };
    } catch (e) {
        return { matchKey: normalized, looseMatchKey: normalized };
    }
}

/**
 * Add a URL candidate with score and reason.
 */
function addCandidate(candidates, url, score, reason) {
    const normalized = normalizeUrl(url, window.location.href);
    if (!normalized) return;
    candidates.push({ url: normalized, score, reason });
}

/**
 * Add a text candidate with score and reason.
 */
function addTextCandidate(candidates, text, score, reason) {
    const value = normalizeText(text);
    if (!value) return;
    candidates.push({ value, score, reason });
}

/**
 * Resolve the most likely image source for an image element.
 */
function getImageSource(img) {
    if (!img) return null;
    return (
        img.currentSrc ||
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-thumb') ||
        img.getAttribute('data-thumbnail')
    );
}

/**
 * Extract a single line text candidate from a container.
 */
function pickReadableText(text) {
    const normalized = normalizeText(text);
    if (!normalized) return null;
    if (/^\d+(?::\d+){1,2}$/.test(normalized)) return null;
    if (normalized.length > 160) {
        return normalized.slice(0, 157).trimEnd() + '...';
    }
    return normalized;
}

// ============================================================================
// JSON-LD EXTRACTION
// ============================================================================

/**
 * Extract all JSON-LD scripts from the page.
 */
function extractJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const items = [];

    scripts.forEach(script => {
        try {
            const data = JSON.parse(script.textContent);
            items.push(data);
        } catch (e) {
            // Ignore parsing errors.
        }
    });

    return items;
}

/**
 * Recursively find all VideoObject items in JSON-LD data.
 */
function* findVideoObjects(obj) {
    if (!obj) return;

    if (typeof obj === 'object' && !Array.isArray(obj)) {
        const types = obj['@type'] || obj.type;

        if (Array.isArray(types)) {
            if (types.some(t => String(t).toLowerCase() === 'videoobject')) {
                yield obj;
            }
        } else if (typeof types === 'string' && types.toLowerCase() === 'videoobject') {
            yield obj;
        }

        const graph = obj['@graph'];
        if (Array.isArray(graph)) {
            for (const item of graph) {
                yield* findVideoObjects(item);
            }
        }

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
 * Parse duration from various formats to seconds.
 */
function parseDurationSeconds(value) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;

    const isoMatch = text.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (isoMatch) {
        const days = parseInt(isoMatch[1]) || 0;
        const hours = parseInt(isoMatch[2]) || 0;
        const minutes = parseInt(isoMatch[3]) || 0;
        const seconds = parseFloat(isoMatch[4]) || 0;
        return days * 86400 + hours * 3600 + minutes * 60 + seconds;
    }

    if (/^\d+(\.\d+)?$/.test(text)) {
        return parseFloat(text);
    }

    if (text.includes(':')) {
        const parts = text.split(':');
        if (parts.length >= 2 && parts.length <= 3) {
            const nums = parts.map(p => parseFloat(p.trim()));
            if (nums.every(n => !isNaN(n))) {
                if (nums.length === 2) {
                    return nums[0] * 60 + nums[1];
                }
                return nums[0] * 3600 + nums[1] * 60 + nums[2];
            }
        }
    }

    return null;
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS.
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
 * Normalize duration value (parse and format).
 */
function normalizeDuration(value) {
    const seconds = parseDurationSeconds(value);
    if (seconds == null) {
        const trimmed = normalizeText(value);
        return trimmed || null;
    }
    return formatDuration(seconds);
}

function isLikelyVideoDetailUrl(url) {
    if (!url) return false;

    try {
        const parsed = new URL(url);
        if (/\/vodplay\/\d+-\d+-\d+\/?$/i.test(parsed.pathname)) {
            return true;
        }

        if (/\/view_video\.php$/i.test(parsed.pathname) && parsed.searchParams.has('viewkey')) {
            return true;
        }

        return false;
    } catch (error) {
        return false;
    }
}

function isLikelyGenericCardTitle(title) {
    const normalized = normalizeText(title).toLowerCase();
    if (!normalized) return true;

    const exactBlockedTitles = new Set([
        'missav',
        'tabs',
        '显示更多',
        'show more',
        '上一页',
        '下一页',
        'previous page',
        'next page'
    ]);

    if (exactBlockedTitles.has(normalized)) {
        return true;
    }

    if (normalized.startsWith('搜寻') || normalized.startsWith('search')) {
        return true;
    }

    return false;
}

function collectContainerDetailUrls(container) {
    if (!(container instanceof Element)) return [];

    const seen = new Set();
    const urls = [];
    const anchors = container.querySelectorAll('a[href]');

    anchors.forEach((anchor) => {
        const normalized = normalizePageUrl(anchor.href);
        if (!normalized) return;
        if (normalized === normalizePageUrl(window.location.href)) return;
        if (seen.has(normalized)) return;
        seen.add(normalized);
        urls.push(normalized);
    });

    return urls;
}

// ============================================================================
// TITLE EXTRACTION
// ============================================================================

/**
 * Split title by common separators and filter out site names.
 */
function splitTitleParts(titleText, siteNames) {
    if (!titleText) return [];

    let parts = [titleText];
    const separators = [' | ', ' - ', ' :: ', ' / ', ' : '];

    for (const sep of separators) {
        if (titleText.includes(sep)) {
            parts = titleText.split(sep).map(p => p.trim()).filter(Boolean);
            break;
        }
    }

    if (!parts.length) return [];

    if (siteNames.size > 0) {
        const filtered = parts.filter(p => !siteNames.has(normalizeText(p).toLowerCase()));
        if (filtered.length > 0) {
            parts = filtered;
        }
    }

    return parts;
}

/**
 * Extract title candidates from all sources.
 */
function extractTitleCandidates() {
    const metaCandidates = [];
    const otherCandidates = [];
    const siteNames = new Set();

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

    const jsonLdItems = extractJsonLd();
    for (const item of jsonLdItems) {
        for (const video of findVideoObjects(item)) {
            const name = video.name || video.headline;
            addTextCandidate(otherCandidates, name, 95, 'jsonld:name');
        }
    }

    const candidates = [...metaCandidates, ...otherCandidates];
    if (candidates.length === 0) return { best: null, candidates: [], source: null };

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
 * Extract thumbnail candidates from all sources.
 */
function extractThumbnailCandidates() {
    const metaCandidates = [];
    const otherCandidates = [];

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
        } else if (key.includes('cover') && key.includes('image')) {
            addCandidate(metaCandidates, content, 87, key);
        } else if (key.includes('poster') && (key.includes('url') || key.includes('image'))) {
            addCandidate(metaCandidates, content, 86, key);
        } else if (key.includes('cover') && key.includes('url')) {
            addCandidate(metaCandidates, content, 84, key);
        }
    });

    const links = document.querySelectorAll('link');
    links.forEach(link => {
        const rel = link.getAttribute('rel');
        const href = link.getAttribute('href');
        if (!rel || !href) return;

        if (rel.toLowerCase().includes('image_src')) {
            addCandidate(otherCandidates, href, 75, 'link:rel=image_src');
        }
    });

    const videos = document.querySelectorAll('video[poster]');
    videos.forEach(video => {
        const poster = video.getAttribute('poster');
        if (poster) {
            addCandidate(otherCandidates, poster, 70, 'video:poster');
        }
    });

    const images = document.querySelectorAll('img');
    images.forEach(img => {
        const src = getImageSource(img);
        const className = img.getAttribute('class') || '';
        const classLower = className.toLowerCase();

        if (src && (classLower.includes('thumb') || classLower.includes('poster'))) {
            addCandidate(otherCandidates, src, 35, 'img:class');
        }
    });

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
 * Extract all page images in top-to-bottom order.
 */
function extractPageImages() {
    const images = Array.from(document.querySelectorAll('img'));
    const seen = new Set();
    const collected = [];

    images.forEach((img, order) => {
        const normalized = normalizeUrl(getImageSource(img), window.location.href);
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
 * Extract duration candidates from all sources.
 */
function extractDurationCandidates() {
    const metaCandidates = [];
    const otherCandidates = [];

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

    const jsonLdItems = extractJsonLd();
    for (const item of jsonLdItems) {
        for (const video of findVideoObjects(item)) {
            addTextCandidate(otherCandidates, video.duration, 95, 'jsonld:duration');
        }
    }

    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        if (video.duration && !isNaN(video.duration) && video.duration !== Infinity) {
            addTextCandidate(otherCandidates, String(Math.floor(video.duration)), 85, 'video:duration');
        }

        const container = video.closest('div, article, section, li') || video.parentElement;
        if (container) {
            const text = normalizeText(container.innerText);
            const keywordPattern = /(?:duration|time|length|时长|时间)[\s\S]{0,20}?(\d+(?::\d+){1,2})/i;
            const match = text.match(keywordPattern);
            if (match) {
                addTextCandidate(otherCandidates, match[1], 60, 'text:keyword+time');
            }
        }
    });

    const potentialDurationEls = document.querySelectorAll('[class*="duration"], [class*="time"], [class*="length"], [id*="duration"], [id*="time"]');
    potentialDurationEls.forEach(el => {
        const rawText = typeof el.innerText === 'string' ? el.innerText : '';
        if (!rawText || rawText.length > 20) return;

        const text = normalizeText(rawText);
        const timeMatch = text.match(/^(\d+(?::\d+){1,2})$/);
        if (timeMatch) {
            addTextCandidate(otherCandidates, timeMatch[1], 55, 'element:class+time');
        }
    });

    const candidates = [...metaCandidates, ...otherCandidates];
    if (candidates.length === 0) return { best: null, candidates: [], source: null };

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
 * Find the best iframe (likely video embed).
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
            // Ignore URL parsing errors.
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
 * Extract site name candidates.
 */
function extractSiteNameCandidates() {
    const metaCandidates = [];
    const otherCandidates = [];

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

    const jsonLdItems = extractJsonLd();
    for (const item of jsonLdItems) {
        const publisher = item.publisher || item.provider;
        if (publisher && publisher.name) {
            addTextCandidate(otherCandidates, publisher.name, 95, 'jsonld:publisher');
        }
    }

    const title = document.title;
    if (title) {
        const parts = title.split(/ [-|] /);
        if (parts.length > 1) {
            addTextCandidate(otherCandidates, parts[parts.length - 1], 40, 'title:suffix');
        }
    }

    const candidates = [...metaCandidates, ...otherCandidates];
    if (candidates.length === 0) return { best: null, candidates: [], source: null };

    if (metaCandidates.length > 0) {
        const best = metaCandidates.reduce((a, b) => a.score > b.score ? a : b);
        return { best, candidates, source: 'meta' };
    }

    const best = otherCandidates.reduce((a, b) => a.score > b.score ? a : b);
    return { best, candidates, source: 'body' };
}

/**
 * Extract site icon candidates.
 */
function extractSiteIconCandidates() {
    const candidates = [];

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

    try {
        const favicon = new URL('/favicon.ico', window.location.href).href;
        addCandidate(candidates, favicon, 10, 'default:favicon');
    } catch (e) {
        // Ignore URL parsing errors.
    }

    if (candidates.length === 0) return { best: null, candidates: [], source: null };

    const best = candidates.reduce((a, b) => a.score > b.score ? a : b);
    return { best, candidates, source: best.reason.split(':')[0] };
}

// ============================================================================
// HOVER CANDIDATE TRACKING
// ============================================================================

/**
 * Find a likely title inside a hovered card container.
 */
function extractCardTitle(container, preferredAnchor, preferredImage) {
    const attributeCandidates = [
        preferredAnchor?.getAttribute('aria-label'),
        preferredAnchor?.getAttribute('title'),
        preferredImage?.getAttribute('alt'),
        container.getAttribute('aria-label'),
        container.getAttribute('title')
    ];

    for (const value of attributeCandidates) {
        const readable = pickReadableText(value);
        if (readable) return readable;
    }

    const titleSelectors = [
        'h1',
        'h2',
        'h3',
        'h4',
        '[class*="title"]',
        '[class*="name"]',
        '[data-title]'
    ];

    for (const selector of titleSelectors) {
        const el = container.querySelector(selector);
        const readable = pickReadableText(el?.textContent || el?.getAttribute?.('data-title'));
        if (readable) return readable;
    }

    if (preferredAnchor) {
        const anchorText = pickReadableText(preferredAnchor.textContent);
        if (anchorText) return anchorText;
    }

    const lines = (container.innerText || '')
        .split('\n')
        .map(line => pickReadableText(line))
        .filter(Boolean);

    return lines.find(line => String(line).length >= 3) || null;
}

/**
 * Find a likely duration inside a hovered card container.
 */
function extractCardDuration(container) {
    const timeEl = container.querySelector('time');
    if (timeEl) {
        const timeValue = timeEl.getAttribute('datetime') || timeEl.textContent;
        const normalized = normalizeDuration(timeValue);
        if (normalized) return normalized;
    }

    const durationSelectors = [
        '[class*="duration"]',
        '[class*="time"]',
        '[class*="length"]',
        '[aria-label*="duration"]',
        '[data-duration]'
    ];

    for (const selector of durationSelectors) {
        const el = container.querySelector(selector);
        if (!el) continue;

        const raw = el.getAttribute('data-duration') || el.getAttribute('datetime') || el.textContent;
        const normalized = normalizeDuration(raw);
        if (normalized) return normalized;
    }

    const text = normalizeText(container.innerText || '');
    const match = text.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
    if (match) {
        return normalizeDuration(match[1]);
    }

    return null;
}

/**
 * Pick the best detail anchor inside a hovered card container.
 */
function extractCardAnchor(container, target) {
    const directAnchor = target.closest('a[href]');
    if (directAnchor && container.contains(directAnchor)) {
        const directUrl = normalizePageUrl(directAnchor.href);
        if (directUrl && isLikelyVideoDetailUrl(directUrl)) return directAnchor;
    }

    const anchors = Array.from(container.querySelectorAll('a[href]')).slice(0, 8);
    if (anchors.length === 0) return null;

    let best = null;
    let bestScore = -1;

    anchors.forEach(anchor => {
        const normalized = normalizePageUrl(anchor.href);
        if (!normalized) return;

        let score = 0;
        if (isLikelyVideoDetailUrl(normalized)) score += 8;
        if (anchor.querySelector('img')) score += 3;
        if (normalizeText(anchor.textContent).length > 3) score += 2;
        if (anchor.getAttribute('title') || anchor.getAttribute('aria-label')) score += 2;
        if (normalized !== normalizePageUrl(window.location.href)) score += 1;
        if (/\/vodtype\/|\/vodsearch\//i.test(normalized)) score -= 6;

        if (score > bestScore) {
            bestScore = score;
            best = anchor;
        }
    });

    return best;
}

/**
 * Extract a candidate video info record from a likely card container.
 */
function extractCandidateFromContainer(container, target) {
    if (!(container instanceof Element)) return null;

    const rawText = container.innerText || '';
    if (!rawText.trim()) return null;
    if (rawText.length > 500) return null;

    const detailUrls = collectContainerDetailUrls(container);
    const uniqueVideoDetailUrls = detailUrls.filter((url) => isLikelyVideoDetailUrl(url));
    if (detailUrls.length > 6) return null;
    if (uniqueVideoDetailUrls.length > 2) return null;

    const anchor = extractCardAnchor(container, target);
    if (!anchor) return null;

    const detailPageUrl = normalizePageUrl(anchor.href);
    if (!detailPageUrl) return null;
    if (!isLikelyVideoDetailUrl(detailPageUrl)) return null;

    const image = anchor.querySelector('img') || container.querySelector('img');
    const thumbnailUrl = normalizeUrl(getImageSource(image), window.location.href);
    const title = extractCardTitle(container, anchor, image);
    const duration = extractCardDuration(container);
    if (isLikelyGenericCardTitle(title)) return null;

    const completenessScore =
        (detailPageUrl ? 4 : 0) +
        (title ? 3 : 0) +
        (thumbnailUrl ? 2 : 0) +
        (duration ? 1 : 0);

    if (!detailPageUrl || !thumbnailUrl || completenessScore < 8) {
        return null;
    }

    const matchKeys = buildPageMatchKeys(detailPageUrl);

    return {
        title: title || '',
        url: detailPageUrl,
        detailPageUrl,
        thumbnailUrl: thumbnailUrl || '',
        duration: duration || '',
        source: 'list-page-candidate',
        sourceLabel: '列表页候选信息',
        capturedAt: Date.now(),
        capturedFromPageUrl: normalizePageUrl(window.location.href),
        matchKey: matchKeys.matchKey,
        looseMatchKey: matchKeys.looseMatchKey
    };
}

/**
 * Search up the ancestor chain for the best candidate card.
 */
function extractHoverCandidate(target) {
    let current = target;
    let depth = 0;
    let best = null;
    let bestScore = -1;

    while (current && current instanceof Element && current !== document.body && depth < 8) {
        const candidate = extractCandidateFromContainer(current, target);
        if (candidate) {
            const score =
                (candidate.title ? 3 : 0) +
                (candidate.thumbnailUrl ? 2 : 0) +
                (candidate.duration ? 1 : 0) +
                (candidate.url ? 4 : 0);

            if (score > bestScore) {
                bestScore = score;
                best = candidate;
            }
        }

        current = current.parentElement;
        depth += 1;
    }

    return best;
}

/**
 * Build a stable signature so repeated hovers do not spam storage writes.
 */
function buildCandidateSignature(candidate) {
    if (!candidate) return '';
    return JSON.stringify([
        candidate.url || '',
        candidate.title || '',
        candidate.thumbnailUrl || '',
        candidate.duration || ''
    ]);
}

/**
 * Create a dedicated snapshot for next-page binding at navigation time.
 */
function createPendingNavigationCandidateSnapshot(candidate) {
    if (!candidate) return null;

    const navigationTargetIdentityKey =
        normalizeUrl(candidate.detailPageUrl || candidate.url, window.location.href) ||
        candidate.detailPageUrl ||
        candidate.url ||
        '';

    return {
        ...candidate,
        source: 'pending-navigation-candidate',
        sourceLabel: '点击跳转时锁定的候选信息',
        capturedAt: Date.now(),
        navigationSnapshotAt: Date.now(),
        navigationTargetIdentityKey,
        capturedFromPageUrl: normalizePageUrl(window.location.href)
    };
}

function createPendingNavigationCandidateSnapshotForUrl(candidate, targetUrl) {
    const snapshot = createPendingNavigationCandidateSnapshot(candidate);
    if (!snapshot) return null;

    const normalizedTargetUrl = normalizeUrl(targetUrl, window.location.href);
    if (!normalizedTargetUrl) {
        return snapshot;
    }

    const matchKeys = buildPageMatchKeys(normalizedTargetUrl);
    return {
        ...snapshot,
        url: normalizedTargetUrl,
        detailPageUrl: normalizedTargetUrl,
        navigationTargetIdentityKey: normalizedTargetUrl,
        matchKey: matchKeys.matchKey,
        looseMatchKey: matchKeys.looseMatchKey
    };
}

function isPrimaryUnmodifiedClick(event) {
    return event.button === 0 &&
        !event.defaultPrevented &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey;
}

function getNavigationAnchor(target) {
    if (!(target instanceof Element)) return null;
    const anchor = target.closest('a[href]');
    if (!anchor) return null;
    if (anchor.hasAttribute('download')) return null;

    const targetAttr = (anchor.getAttribute('target') || '').trim().toLowerCase();
    if (targetAttr && targetAttr !== '_self') return null;

    const href = normalizeUrl(anchor.href, window.location.href);
    if (!href) return null;

    return anchor;
}

function persistPendingNavigationSnapshot(snapshot, metadata = {}) {
    if (!snapshot) return Promise.resolve(false);

    appendDebugLog('pending-navigation-store-requested', {
        pageUrl: normalizePageUrl(window.location.href),
        metadata,
        snapshot: summarizeVideoInfo(snapshot)
    });

    return sendRuntimeMessage({
        action: 'storePendingNavigationCandidateVideoInfo',
        pendingNavigationCandidateVideoInfo: snapshot
    }).then(() => {
        appendDebugLog('pending-navigation-store-succeeded', {
            pageUrl: normalizePageUrl(window.location.href),
            metadata,
            snapshot: summarizeVideoInfo(snapshot)
        });
        return true;
    }).catch((error) => {
        appendDebugLog('pending-navigation-store-failed', {
            pageUrl: normalizePageUrl(window.location.href),
            metadata,
            snapshot: summarizeVideoInfo(snapshot),
            error: error.message
        });
        return false;
    });
}

/**
 * Ensure the on-page hover preview overlay exists.
 */
function ensureHoverPreviewOverlay() {
    if (g_hoverPreviewOverlay && g_hoverPreviewOverlayEls) {
        return g_hoverPreviewOverlayEls;
    }

    if (!document.documentElement) {
        return null;
    }

    if (!document.getElementById(HOVER_PREVIEW_STYLE_ID)) {
        const style = document.createElement('style');
        style.id = HOVER_PREVIEW_STYLE_ID;
        style.textContent = `
#${HOVER_PREVIEW_OVERLAY_ID} {
    position: fixed;
    top: 16px;
    right: 16px;
    width: 220px;
    padding: 12px;
    border-radius: 16px;
    background: rgba(16, 22, 23, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 16px 42px rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(16px);
    color: #f3f6f2;
    z-index: 2147483647;
    font-family: "Segoe UI", Arial, sans-serif;
    line-height: 1.4;
    pointer-events: none;
}

#${HOVER_PREVIEW_OVERLAY_ID}.vhub-hidden {
    display: none !important;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hidden {
    display: none !important;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-title {
    font-size: 12px;
    font-weight: 700;
    color: #ffffff;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-badge {
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(216, 99, 42, 0.18);
    color: #ffd7c7;
    font-size: 10px;
    white-space: nowrap;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-thumb-wrap {
    width: 100%;
    margin-bottom: 10px;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-thumb,
#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-thumb-placeholder {
    width: 100%;
    height: 120px;
    border-radius: 12px;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-thumb {
    object-fit: cover;
    display: block;
    background: #1b2425;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-thumb-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(216, 99, 42, 0.14), rgba(59, 130, 246, 0.10));
    border: 1px dashed rgba(255, 255, 255, 0.14);
    color: rgba(243, 246, 242, 0.72);
    font-size: 11px;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-label {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(243, 246, 242, 0.56);
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-value {
    font-size: 12px;
    color: #f3f6f2;
    word-break: break-word;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-value.vhub-title-value {
    -webkit-line-clamp: 2;
}

#${HOVER_PREVIEW_OVERLAY_ID} .vhub-hover-value.vhub-link-value {
    -webkit-line-clamp: 1;
    color: rgba(213, 227, 220, 0.92);
}
        `;
        document.documentElement.appendChild(style);
    }

    const overlay = document.createElement('div');
    overlay.id = HOVER_PREVIEW_OVERLAY_ID;
    overlay.className = 'vhub-hidden';
    overlay.innerHTML = `
<div class="vhub-hover-header">
  <span class="vhub-hover-title">Hover Preview</span>
  <span class="vhub-hover-badge">当前网页预览</span>
</div>
<div class="vhub-hover-thumb-wrap">
  <img class="vhub-hover-thumb vhub-hidden" alt="Hover preview thumbnail">
  <div class="vhub-hover-thumb-placeholder">暂无封面</div>
</div>
<div class="vhub-hover-field">
  <span class="vhub-hover-label">标题</span>
  <span class="vhub-hover-value vhub-title-value">-</span>
</div>
<div class="vhub-hover-field">
  <span class="vhub-hover-label">时长</span>
  <span class="vhub-hover-value vhub-duration-value">-</span>
</div>
<div class="vhub-hover-field">
  <span class="vhub-hover-label">链接</span>
  <span class="vhub-hover-value vhub-link-value">-</span>
</div>
    `;

    document.documentElement.appendChild(overlay);

    g_hoverPreviewOverlay = overlay;
    g_hoverPreviewOverlayEls = {
        overlay,
        thumb: overlay.querySelector('.vhub-hover-thumb'),
        thumbPlaceholder: overlay.querySelector('.vhub-hover-thumb-placeholder'),
        title: overlay.querySelector('.vhub-title-value'),
        duration: overlay.querySelector('.vhub-duration-value'),
        link: overlay.querySelector('.vhub-link-value')
    };

    return g_hoverPreviewOverlayEls;
}

/**
 * Render the on-page hover preview overlay.
 */
function renderHoverPreviewOverlay(candidate) {
    if (!g_hoverPreviewVisible) {
        appendDebugLog('hover-preview-render-skipped', {
            pageUrl: normalizePageUrl(window.location.href),
            reason: 'visibility-disabled',
            candidate: summarizeVideoInfo(candidate)
        });
        hideHoverPreviewOverlay();
        return;
    }

    const overlayEls = ensureHoverPreviewOverlay();
    if (!overlayEls) return;

    overlayEls.title.textContent = candidate?.title || '-';
    overlayEls.duration.textContent = candidate?.duration || '-';
    overlayEls.link.textContent = candidate?.detailPageUrl || candidate?.url || '-';

    const thumbnailUrl = candidate?.thumbnailUrl || '';
    if (thumbnailUrl) {
        overlayEls.thumb.src = thumbnailUrl;
        overlayEls.thumb.classList.remove('vhub-hidden');
        overlayEls.thumbPlaceholder.classList.add('vhub-hidden');
        overlayEls.thumb.onerror = () => {
            overlayEls.thumb.classList.add('vhub-hidden');
            overlayEls.thumbPlaceholder.classList.remove('vhub-hidden');
        };
    } else {
        overlayEls.thumb.removeAttribute('src');
        overlayEls.thumb.classList.add('vhub-hidden');
        overlayEls.thumbPlaceholder.classList.remove('vhub-hidden');
    }

    overlayEls.overlay.classList.remove('vhub-hidden');
}

/**
 * Hide the on-page hover preview overlay.
 */
function hideHoverPreviewOverlay() {
    if (g_hoverPreviewOverlay) {
        g_hoverPreviewOverlay.classList.add('vhub-hidden');
    }
}

/**
 * Ask the background worker to resolve and lock a page-bound candidate for the current page.
 */
function resolvePageBoundCandidateForCurrentPage() {
    if (!g_autoTrackEnabled) return;

    const currentPageUrl = normalizePageUrl(window.location.href);
    if (!currentPageUrl || currentPageUrl === g_lastResolvedPageUrl) return;

    g_lastResolvedPageUrl = currentPageUrl;
    appendDebugLog('resolve-page-bound-requested', {
        pageUrl: currentPageUrl
    });

    runWithExtensionContext(() => {
        chrome.runtime.sendMessage(
            {
                action: 'resolvePageBoundCandidateForPage',
                pageUrl: currentPageUrl
            },
            (response) => {
                if (!isExtensionContextActive()) return;
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    console.debug('Resolve page-bound candidate failed:', lastError.message);
                    appendDebugLog('resolve-page-bound-failed', {
                        pageUrl: currentPageUrl,
                        error: lastError.message
                    });
                    return;
                }
                appendDebugLog('resolve-page-bound-response', {
                    pageUrl: currentPageUrl,
                    pageSourcePreference: response?.pageSourcePreference || null,
                    pageBoundCandidateVideoInfo: summarizeVideoInfo(response?.pageBoundCandidateVideoInfo)
                });
            }
        );
    });
}

/**
 * Track hard/SPA navigation so current page binding happens at page-entry time.
 */
function initializePageBindingTracking() {
    resolvePageBoundCandidateForCurrentPage();
    g_navigationPollTimer = window.setInterval(() => {
        if (!isExtensionContextActive()) return;
        const currentUrl = normalizePageUrl(window.location.href) || '';
        if (currentUrl && currentUrl !== g_lastResolvedPageUrl) {
            resolvePageBoundCandidateForCurrentPage();
        }
    }, 500);
}

/**
 * Persist the current hover preview if auto-tracking is enabled.
 */
function persistHoverPreview(target) {
    if (!g_autoTrackEnabled || !(target instanceof Element)) return;

    runWithExtensionContext(() => {
        const candidate = extractHoverCandidate(target);
        if (!candidate) {
            appendDebugLog('hover-preview-missed', {
                pageUrl: normalizePageUrl(window.location.href),
                targetTag: target.tagName,
                targetClass: target.className || ''
            });
            return;
        }

        g_lastHoverCandidate = { ...candidate };

        const signature = buildCandidateSignature(candidate);
        if (signature === g_lastCandidateSignature) return;
        g_lastCandidateSignature = signature;

        setSessionStorageValue(STORAGE_KEYS.hoverPreview, candidate, 'Hover preview');
        appendDebugLog('hover-preview-updated', {
            pageUrl: normalizePageUrl(window.location.href),
            candidate: summarizeVideoInfo(candidate)
        });
        renderHoverPreviewOverlay(candidate);
    });
}

/**
 * Persist a navigation-time snapshot for the next page binding flow.
 */
function persistPendingNavigationCandidate(target) {
    if (!g_autoTrackEnabled || !(target instanceof Element)) return;

    runWithExtensionContext(() => {
        const candidate = g_lastHoverCandidate
            ? { ...g_lastHoverCandidate }
            : extractHoverCandidate(target);
        if (!candidate) {
            appendDebugLog('pending-navigation-missed', {
                pageUrl: normalizePageUrl(window.location.href),
                targetTag: target.tagName,
                targetClass: target.className || '',
                usedLastHoverCandidate: Boolean(g_lastHoverCandidate)
            });
            return;
        }

        const anchor = getNavigationAnchor(target);
        const snapshot = createPendingNavigationCandidateSnapshotForUrl(
            candidate,
            anchor?.href || candidate.detailPageUrl || candidate.url
        );
        if (!snapshot) return;

        appendDebugLog('pending-navigation-captured', {
            pageUrl: normalizePageUrl(window.location.href),
            targetTag: target.tagName,
            targetClass: target.className || '',
            usedLastHoverCandidate: Boolean(g_lastHoverCandidate),
            snapshot: summarizeVideoInfo(snapshot)
        });
        void persistPendingNavigationSnapshot(snapshot, {
            reason: 'mousedown',
            targetTag: target.tagName,
            targetClass: target.className || ''
        });
    });
}

/**
 * Debounce hover preview tracking during pointer movement.
 */
function scheduleHoverTracking(target) {
    if (!g_autoTrackEnabled || !(target instanceof Element)) return;

    g_lastHoverTarget = target;

    if (g_hoverTimer) {
        clearTimeout(g_hoverTimer);
    }

    g_hoverTimer = setTimeout(() => {
        g_hoverTimer = null;

        if (!isExtensionContextActive()) return;
        if (!g_autoTrackEnabled || !g_lastHoverTarget) return;
        persistHoverPreview(g_lastHoverTarget);
    }, HOVER_TRACK_DELAY_MS);
}

/**
 * Initialize hover candidate tracking state.
 */
function initializeAutoTrackState() {
    runWithExtensionContext(() => {
        chrome.storage.local.get([STORAGE_KEYS.autoTrackEnabled, STORAGE_KEYS.hoverPreviewVisible], (stored) => {
            if (!isExtensionContextActive()) return;
            g_autoTrackEnabled = Boolean(stored[STORAGE_KEYS.autoTrackEnabled]);
            g_hoverPreviewVisible = stored[STORAGE_KEYS.hoverPreviewVisible] !== false;
            if (g_autoTrackEnabled) {
                resolvePageBoundCandidateForCurrentPage();
            } else {
                hideHoverPreviewOverlay();
            }
            if (!g_hoverPreviewVisible) {
                hideHoverPreviewOverlay();
            }
        });

        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (!isExtensionContextActive()) return;
            if (areaName !== 'local') return;

            if (changes[STORAGE_KEYS.autoTrackEnabled]) {
                g_autoTrackEnabled = Boolean(changes[STORAGE_KEYS.autoTrackEnabled].newValue);
                appendDebugLog('auto-track-storage-changed', {
                    pageUrl: normalizePageUrl(window.location.href),
                    enabled: g_autoTrackEnabled
                });
                if (!g_autoTrackEnabled) {
                    g_lastCandidateSignature = '';
                    g_lastResolvedPageUrl = '';
                    g_lastHoverCandidate = null;
                    hideHoverPreviewOverlay();
                } else {
                    resolvePageBoundCandidateForCurrentPage();
                }
            }

            if (changes[STORAGE_KEYS.hoverPreviewVisible]) {
                g_hoverPreviewVisible = changes[STORAGE_KEYS.hoverPreviewVisible].newValue !== false;
                appendDebugLog('hover-preview-visibility-storage-changed', {
                    pageUrl: normalizePageUrl(window.location.href),
                    enabled: g_hoverPreviewVisible
                });
                if (!g_hoverPreviewVisible) {
                    hideHoverPreviewOverlay();
                } else if (g_autoTrackEnabled && g_lastHoverCandidate) {
                    renderHoverPreviewOverlay(g_lastHoverCandidate);
                }
            }
        });
    });

    document.addEventListener(
        'mouseover',
        (event) => {
            if (!isExtensionContextActive()) return;
            if (!g_autoTrackEnabled) return;
            if (!(event.target instanceof Element)) return;
            scheduleHoverTracking(event.target);
        },
        true
    );

    // Capture the card being entered before navigation so list-page intent is preserved.
    document.addEventListener(
        'mousedown',
        (event) => {
            if (!isExtensionContextActive()) return;
            if (!g_autoTrackEnabled) return;
            if (!(event.target instanceof Element)) return;
            persistHoverPreview(event.target);
            persistPendingNavigationCandidate(event.target);
        },
        true
    );

    document.addEventListener(
        'click',
        (event) => {
            if (!isExtensionContextActive()) return;
            if (!g_autoTrackEnabled) return;
            if (!(event.target instanceof Element)) return;
            if (!isPrimaryUnmodifiedClick(event)) return;

            const anchor = getNavigationAnchor(event.target);
            if (!anchor) return;

            const targetUrl = normalizeUrl(anchor.href, window.location.href);
            if (!targetUrl) return;

            const candidate = g_lastHoverCandidate
                ? { ...g_lastHoverCandidate }
                : extractHoverCandidate(event.target);
            if (!candidate) return;

            const snapshot = createPendingNavigationCandidateSnapshotForUrl(candidate, targetUrl);
            if (!snapshot) return;

            appendDebugLog('navigation-click-observed', {
                pageUrl: normalizePageUrl(window.location.href),
                targetUrl,
                snapshot: summarizeVideoInfo(snapshot)
            });

            void persistPendingNavigationSnapshot(snapshot, {
                reason: 'click-observed',
                targetUrl,
                targetTag: event.target.tagName,
                targetClass: event.target.className || ''
            });
        },
        true
    );
}

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

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
 * Merge new results with existing best results.
 */
function mergeResult(newResult) {
    if (!newResult) return g_bestResult;

    const isLikelyAd = (durStr) => {
        const sec = parseDurationSeconds(durStr);
        return sec && sec < 120;
    };

    if (newResult.url !== g_bestResult.url) {
        g_bestResult = newResult;
        return g_bestResult;
    }

    if (newResult.title) {
        g_bestResult.title = newResult.title;
    }

    if (newResult.thumbnailUrl) {
        g_bestResult.thumbnailUrl = newResult.thumbnailUrl;
    }

    if (newResult.duration) {
        if (!g_bestResult.duration) {
            g_bestResult.duration = newResult.duration;
        } else if (isLikelyAd(g_bestResult.duration) && !isLikelyAd(newResult.duration)) {
            g_bestResult.duration = newResult.duration;
        } else if (normalizeDuration(newResult.duration) !== normalizeDuration(g_bestResult.duration)) {
            g_bestResult.duration = newResult.duration;
        }
    }

    if (newResult.iframe) {
        g_bestResult.iframe = newResult.iframe;
    }

    if (newResult.siteName) {
        g_bestResult.siteName = newResult.siteName;
    }

    if (newResult.siteIconUrl) {
        g_bestResult.siteIconUrl = newResult.siteIconUrl;
    }

    return g_bestResult;
}

/**
 * Extract all video information using candidate scoring system.
 */
function extractVideoInfo() {
    const titleResult = extractTitleCandidates();
    const thumbnailResult = extractThumbnailCandidates();
    const durationResult = extractDurationCandidates();
    const iframe = extractBestIframe();
    const siteNameResult = extractSiteNameCandidates();
    const siteIconResult = extractSiteIconCandidates();

    const currentResult = {
        url: window.location.href,
        title: titleResult.best ? titleResult.best.value : null,
        thumbnailUrl: thumbnailResult.best ? thumbnailResult.best.url : null,
        duration: durationResult.best ? normalizeDuration(durationResult.best.value) : null,
        iframe,
        siteName: siteNameResult.best ? siteNameResult.best.value : null,
        siteIconUrl: siteIconResult.best ? siteIconResult.best.url : null,
        source: 'enhanced-extraction',
        sourceLabel: '当前页面解析结果',
        timestamp: Date.now()
    };

    return [mergeResult(currentResult)];
}

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!isExtensionContextActive()) return false;
    if (request.action === 'extractVideoInfo') {
        const videoInfo = extractVideoInfo();
        const pageImages = extractPageImages();
        sendResponse({ videos: videoInfo, pageImages });
    }
    return true;
});

initializeAutoTrackState();
initializePageBindingTracking();

setTimeout(() => {
    if (!isExtensionContextActive()) return;
    extractVideoInfo();
}, 1000);

console.log('Video Info Parser content script loaded with candidate tracking support');
})();
