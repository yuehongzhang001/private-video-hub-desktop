// Popup script for Private Video Hub extension.
// Hover preview is separate from the page-bound candidate used for bookmarking.

const NATIVE_HOST_NAME = 'com.private_video_hub.desktop';
const STORAGE_KEYS = {
    autoTrackEnabled: 'autoTrackCandidateVideoInfoEnabled',
    hoverPreviewVisible: 'hoverPreviewVisibleEnabled',
    hoverPreview: 'hoverPreviewVideoInfo'
};

const state = {
    activeTab: null,
    restrictedPage: false,
    autoTrackEnabled: false,
    hoverPreviewVisible: true,
    pageBoundCandidateVideoInfo: null,
    pageSourcePreference: null,
    pageVideoInfo: null,
    pageImages: [],
    currentVideoInfo: null,
    activeSource: null,
    dirty: false
};

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
    cacheElements();
    bindEvents();
    bindStorageListeners();
    await initializePopup();
});

function cacheElements() {
    els.loading = document.getElementById('loading');
    els.error = document.getElementById('error');
    els.empty = document.getElementById('empty');
    els.refreshBtn = document.getElementById('refresh-btn');
    els.autoTrackToggle = document.getElementById('auto-track-toggle');
    els.hoverPreviewVisibilityToggle = document.getElementById('hover-preview-visibility-toggle');

    els.editorPanel = document.getElementById('editor-panel');
    els.activeSourceText = document.getElementById('active-source-text');
    els.dirtyBadge = document.getElementById('dirty-badge');
    els.editorThumbPreview = document.getElementById('editor-thumb-preview');
    els.editorThumbPlaceholder = document.getElementById('editor-thumb-placeholder');

    els.fieldTitle = document.getElementById('field-title');
    els.fieldDuration = document.getElementById('field-duration');
    els.fieldUrl = document.getElementById('field-url');
    els.fieldThumbnail = document.getElementById('field-thumbnail');

    els.bookmarkBtn = document.getElementById('bookmark-btn');
    els.parseBtn = document.getElementById('parse-btn');
    els.clearCandidateBtn = document.getElementById('clear-candidate-btn');
    els.copyJsonBtn = document.getElementById('copy-json-btn');
    els.openUrlBtn = document.getElementById('open-url-btn');
    els.copyDebugLogsBtn = document.getElementById('copy-debug-logs-btn');
    els.clearDebugLogsBtn = document.getElementById('clear-debug-logs-btn');

    els.imagesSection = document.getElementById('images-section');
    els.toggleImagesBtn = document.getElementById('toggle-images');
    els.imageList = document.getElementById('image-list');
}

function setActiveTabState(tab) {
    state.activeTab = tab || null;
    state.restrictedPage = isRestrictedUrl(tab?.url || '');
}

function applyExtensionState(extensionState) {
    state.autoTrackEnabled = Boolean(extensionState?.autoTrackEnabled);
    state.hoverPreviewVisible = extensionState?.hoverPreviewVisible !== false;
    state.pageBoundCandidateVideoInfo = extensionState?.pageBoundCandidateVideoInfo || null;
    state.pageSourcePreference = extensionState?.pageSourcePreference || null;
    els.autoTrackToggle.checked = state.autoTrackEnabled;
    els.hoverPreviewVisibilityToggle.checked = state.hoverPreviewVisible;
}

function resetPageExtractionState() {
    state.pageVideoInfo = null;
    state.pageImages = [];
}

function setAutoTrackDisabledState() {
    state.pageBoundCandidateVideoInfo = null;
    state.pageSourcePreference = null;
}

function shouldUsePageVideoByDefault() {
    return !state.autoTrackEnabled || state.activeSource === 'page';
}

function bindEvents() {
    els.refreshBtn.addEventListener('click', () => {
        initializePopup({ preserveDirtyForm: false });
    });

    els.autoTrackToggle.addEventListener('change', async () => {
        const enabled = Boolean(els.autoTrackToggle.checked);
        const previous = state.autoTrackEnabled;

        try {
            await sendRuntimeMessage({ action: 'setAutoTrackEnabled', enabled });

            state.autoTrackEnabled = enabled;
            if (!enabled) {
                setAutoTrackDisabledState();
            }

            if (!state.dirty) {
                applyPreferredSource();
            }

            render();
        } catch (error) {
            console.error('Failed to update auto-track toggle:', error);
            state.autoTrackEnabled = previous;
            els.autoTrackToggle.checked = previous;
            showToast('❌ 开关更新失败');
        }
    });

    els.hoverPreviewVisibilityToggle.addEventListener('change', async () => {
        const enabled = Boolean(els.hoverPreviewVisibilityToggle.checked);
        const previous = state.hoverPreviewVisible;

        try {
            await sendRuntimeMessage({ action: 'setHoverPreviewVisibilityEnabled', enabled });
            state.hoverPreviewVisible = enabled;
            await appendDebugLog('popup-set-hover-preview-visibility', {
                activeTabUrl: state.activeTab?.url || '',
                enabled
            });
            render();
        } catch (error) {
            console.error('Failed to update hover preview visibility toggle:', error);
            state.hoverPreviewVisible = previous;
            els.hoverPreviewVisibilityToggle.checked = previous;
            showToast('❌ Hover Preview 开关更新失败');
        }
    });

    [els.fieldTitle, els.fieldDuration, els.fieldUrl, els.fieldThumbnail].forEach((input) => {
        input.addEventListener('input', handleFieldInput);
    });

    els.bookmarkBtn.addEventListener('click', handleBookmark);
    els.parseBtn.addEventListener('click', handleParseCurrentPage);
    els.clearCandidateBtn.addEventListener('click', handleClearPageBoundCandidate);
    els.copyJsonBtn.addEventListener('click', handleCopyJson);
    els.copyDebugLogsBtn.addEventListener('click', handleCopyDebugLogs);
    els.clearDebugLogsBtn.addEventListener('click', handleClearDebugLogs);
    els.openUrlBtn.addEventListener('click', () => {
        const url = normalizeUrl(state.currentVideoInfo?.url);
        if (!url) {
            showToast('❌ 当前没有可打开的链接');
            return;
        }
        chrome.tabs.create({ url });
    });

    els.toggleImagesBtn.addEventListener('click', () => {
        const expanded = els.toggleImagesBtn.getAttribute('aria-expanded') === 'true';
        els.toggleImagesBtn.setAttribute('aria-expanded', String(!expanded));
        els.imageList.classList.toggle('hidden', expanded);
    });
}

function bindStorageListeners() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes[STORAGE_KEYS.autoTrackEnabled]) {
            state.autoTrackEnabled = Boolean(changes[STORAGE_KEYS.autoTrackEnabled].newValue);
            els.autoTrackToggle.checked = state.autoTrackEnabled;

            if (!state.autoTrackEnabled) {
                setAutoTrackDisabledState();
                if (!state.dirty) {
                    applyPreferredSource();
                }
            }

            render();
        }

        if (areaName === 'local' && changes[STORAGE_KEYS.hoverPreviewVisible]) {
            state.hoverPreviewVisible = changes[STORAGE_KEYS.hoverPreviewVisible].newValue !== false;
            els.hoverPreviewVisibilityToggle.checked = state.hoverPreviewVisible;
            render();
        }
    });
}

async function initializePopup(options = {}) {
    const { preserveDirtyForm = false } = options;

    showLoading();

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        setActiveTabState(tab);

        const extensionState = await sendRuntimeMessage({
            action: 'getExtensionState',
            pageUrl: tab?.url || ''
        });
        applyExtensionState(extensionState);

        if (!state.restrictedPage && tab?.id) {
            try {
                const response = await extractCurrentPageVideoInfo(tab.id);
                const firstVideo = Array.isArray(response?.videos) ? response.videos[0] : null;
                state.pageVideoInfo = firstVideo ? normalizeVideoInfo(firstVideo, 'page') : null;
                state.pageImages = Array.isArray(response?.pageImages) ? response.pageImages : [];
            } catch (error) {
                console.warn('Current page extraction failed, continuing with extension state only:', error);
                resetPageExtractionState();
            }
        } else {
            resetPageExtractionState();
        }

        if (!preserveDirtyForm || !state.dirty) {
            applyPreferredSource();
        }

        await appendDebugLog('popup-initialize', {
            activeTabUrl: tab?.url || '',
            autoTrackEnabled: state.autoTrackEnabled,
            hoverPreviewVisible: state.hoverPreviewVisible,
            pageSourcePreference: state.pageSourcePreference,
            pageBoundCandidateVideoInfo: summarizeVideoInfo(state.pageBoundCandidateVideoInfo),
            pageVideoInfo: summarizeVideoInfo(state.pageVideoInfo),
            currentVideoInfo: summarizeVideoInfo(state.currentVideoInfo)
        });

        render();
    } catch (error) {
        console.error('Failed to initialize popup:', error);
        showError('❌ 无法读取扩展状态或当前页面');
    }
}

function isRestrictedUrl(url) {
    return Boolean(url) && (
        url.startsWith('chrome://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:') ||
        url.startsWith('chrome-extension://')
    );
}

function normalizeUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        return parsed.href;
    } catch (error) {
        return String(url).trim();
    }
}

function buildPageMatchKeys(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) return { matchKey: '', looseMatchKey: '' };

    try {
        const parsed = new URL(normalized);
        return {
            matchKey: `${parsed.origin}${parsed.pathname}${parsed.search}`,
            looseMatchKey: `${parsed.origin}${parsed.pathname}`
        };
    } catch (error) {
        return { matchKey: normalized, looseMatchKey: normalized };
    }
}

function normalizeVideoInfo(video, source) {
    if (!video) return null;
    return {
        title: video.title || '',
        url: video.url || video.detailPageUrl || '',
        detailPageUrl: video.detailPageUrl || video.url || '',
        thumbnailUrl: video.thumbnailUrl || '',
        duration: video.duration || '',
        siteName: video.siteName || '',
        siteIconUrl: video.siteIconUrl || '',
        rating: Number.isFinite(Number(video.rating)) ? Math.max(0, Math.min(5, Math.round(Number(video.rating)))) : 0,
        source
    };
}

function summarizeVideoInfo(video) {
    if (!video) return null;
    return {
        title: video.title || '',
        detailPageUrl: video.detailPageUrl || video.url || '',
        thumbnailUrl: video.thumbnailUrl || '',
        duration: video.duration || '',
        source: video.source || '',
        sourceLabel: video.sourceLabel || ''
    };
}

async function appendDebugLog(event, data) {
    try {
        await sendRuntimeMessage({
            action: 'appendDebugLog',
            source: 'popup',
            event,
            data
        });
    } catch (error) {
        console.debug('Failed to append popup debug log:', error);
    }
}

function cloneVideoInfo(video) {
    return video ? { ...video } : null;
}

function getPageBoundCandidateAsVideoInfo() {
    return normalizeVideoInfo(state.pageBoundCandidateVideoInfo, 'candidate');
}

function applyPreferredSource() {
    const boundCandidateVideo = getPageBoundCandidateAsVideoInfo();
    const pageVideo = state.pageVideoInfo ? cloneVideoInfo(state.pageVideoInfo) : null;

    if (!state.autoTrackEnabled) {
        state.currentVideoInfo = pageVideo;
        state.activeSource = state.currentVideoInfo ? 'page' : null;
        state.dirty = false;
        return;
    }

    if (state.pageSourcePreference === 'candidate' && boundCandidateVideo) {
        state.currentVideoInfo = cloneVideoInfo(boundCandidateVideo);
        state.activeSource = 'candidate';
    } else if (state.pageSourcePreference === 'page') {
        state.currentVideoInfo = pageVideo;
        state.activeSource = 'page';
    } else if (state.pageSourcePreference === 'none') {
        state.currentVideoInfo = null;
        state.activeSource = 'none';
    } else if (boundCandidateVideo) {
        state.currentVideoInfo = cloneVideoInfo(boundCandidateVideo);
        state.activeSource = 'candidate';
    } else if (pageVideo) {
        state.currentVideoInfo = pageVideo;
        state.activeSource = 'page';
    } else {
        state.currentVideoInfo = null;
        state.activeSource = null;
    }

    state.dirty = false;
}

function syncCurrentVideoFromFields() {
    if (!state.currentVideoInfo) {
        state.currentVideoInfo = normalizeVideoInfo({}, state.activeSource || 'manual');
    }

    state.currentVideoInfo.title = els.fieldTitle.value.trim();
    state.currentVideoInfo.duration = els.fieldDuration.value.trim();
    state.currentVideoInfo.url = els.fieldUrl.value.trim();
    state.currentVideoInfo.detailPageUrl = state.currentVideoInfo.url;
    state.currentVideoInfo.thumbnailUrl = els.fieldThumbnail.value.trim();
}

function handleFieldInput() {
    syncCurrentVideoFromFields();
    state.dirty = true;
    renderEditorMeta();
    renderThumbnailPreview();
    renderActionStates();
}

async function handleParseCurrentPage() {
    if (state.restrictedPage || !state.activeTab?.id) {
        showToast('❌ 当前页面无法重新解析');
        return;
    }

    els.parseBtn.disabled = true;

    try {
        const response = await extractCurrentPageVideoInfo(state.activeTab.id);
        const firstVideo = Array.isArray(response?.videos) ? response.videos[0] : null;
        state.pageVideoInfo = firstVideo ? normalizeVideoInfo(firstVideo, 'page') : null;
        state.pageImages = Array.isArray(response?.pageImages) ? response.pageImages : [];

        if (!state.pageVideoInfo) {
            showToast('❌ 当前页面没有解析到可用视频信息');
            render();
            return;
        }

        if (state.autoTrackEnabled && state.activeTab?.url) {
            await sendRuntimeMessage({
                action: 'setPageSourcePreference',
                pageUrl: state.activeTab.url,
                sourcePreference: 'page'
            });
            state.pageSourcePreference = 'page';
        }

        state.currentVideoInfo = cloneVideoInfo(state.pageVideoInfo);
        state.activeSource = 'page';
        state.dirty = false;
        await appendDebugLog('parse-current-page', {
            activeTabUrl: state.activeTab?.url || '',
            pageVideoInfo: summarizeVideoInfo(state.pageVideoInfo)
        });
        render();
        showToast('✅ 已切换为当前页面解析结果');
    } catch (error) {
        console.error('Failed to parse current page:', error);
        showToast('❌ 当前页面解析失败');
    } finally {
        els.parseBtn.disabled = false;
    }
}

async function handleClearPageBoundCandidate() {
    if (!state.activeTab?.url) {
        return;
    }

    try {
        await sendRuntimeMessage({
            action: 'clearPageBoundCandidateVideoInfo',
            pageUrl: state.activeTab.url
        });

        state.pageBoundCandidateVideoInfo = null;

        if (state.activeSource === 'page') {
            state.pageSourcePreference = 'page';
        } else {
            state.pageSourcePreference = 'none';
            state.currentVideoInfo = null;
            state.activeSource = 'none';
            state.dirty = false;
        }

        render();
        await appendDebugLog('clear-page-bound-candidate', {
            activeTabUrl: state.activeTab?.url || '',
            activeSource: state.activeSource
        });
        showToast('✅ 已清除当前页面候选绑定');
    } catch (error) {
        console.error('Failed to clear page-bound candidate:', error);
        showToast('❌ 清除候选绑定失败');
    }
}

function handleCopyJson() {
    if (!state.currentVideoInfo) {
        showToast('❌ 当前没有可复制的内容');
        return;
    }

    syncCurrentVideoFromFields();
    const json = JSON.stringify({
        title: state.currentVideoInfo.title,
        url: state.currentVideoInfo.url,
        duration: state.currentVideoInfo.duration,
        thumbnailUrl: state.currentVideoInfo.thumbnailUrl
    }, null, 2);

    navigator.clipboard.writeText(json).then(() => {
        showToast('✅ JSON已复制到剪贴板');
    }).catch((error) => {
        console.error('Failed to copy JSON:', error);
        showToast('❌ 复制失败');
    });
}

async function handleCopyDebugLogs() {
    try {
        const response = await sendRuntimeMessage({ action: 'getDebugLogs' });
        const payload = {
            exportedAt: new Date().toISOString(),
            activeTabUrl: state.activeTab?.url || '',
            autoTrackEnabled: state.autoTrackEnabled,
            hoverPreviewVisible: state.hoverPreviewVisible,
            pageSourcePreference: state.pageSourcePreference,
            pageBoundCandidateVideoInfo: summarizeVideoInfo(state.pageBoundCandidateVideoInfo),
            pageVideoInfo: summarizeVideoInfo(state.pageVideoInfo),
            currentVideoInfo: summarizeVideoInfo(state.currentVideoInfo),
            logs: Array.isArray(response?.logs) ? response.logs : []
        };

        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        showToast('✅ 调试日志已复制到剪贴板');
    } catch (error) {
        console.error('Failed to copy debug logs:', error);
        showToast('❌ 复制调试日志失败');
    }
}

async function handleClearDebugLogs() {
    try {
        await sendRuntimeMessage({ action: 'clearDebugLogs' });
        showToast('✅ 调试日志已清空');
    } catch (error) {
        console.error('Failed to clear debug logs:', error);
        showToast('❌ 清空调试日志失败');
    }
}

function handleBookmark() {
    if (!state.currentVideoInfo) {
        showToast('❌ 当前没有可收藏的视频信息');
        return;
    }

    syncCurrentVideoFromFields();

    const payload = {
        title: state.currentVideoInfo.title,
        url: state.currentVideoInfo.url,
        duration: state.currentVideoInfo.duration,
        thumbnailUrl: state.currentVideoInfo.thumbnailUrl
    };

    if (!payload.url) {
        showToast('❌ 收藏前请先确认链接');
        return;
    }

    chrome.runtime.sendNativeMessage(
        NATIVE_HOST_NAME,
        { type: 'favorite', favorite: payload },
        async (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
                console.error('Native messaging failed:', lastError.message);
                await appendDebugLog('bookmark-native-error', {
                    activeTabUrl: state.activeTab?.url || '',
                    activeSource: state.activeSource,
                    payload: summarizeVideoInfo(payload),
                    error: lastError.message
                });
                showToast('❌ 未连接到本地应用');
                return;
            }

            if (response && response.ok) {
                await appendDebugLog('bookmark-sent', {
                    activeTabUrl: state.activeTab?.url || '',
                    activeSource: state.activeSource,
                    payload: summarizeVideoInfo(payload),
                    response
                });
                showToast('✅ 已发送到应用');
            } else {
                await appendDebugLog('bookmark-failed', {
                    activeTabUrl: state.activeTab?.url || '',
                    activeSource: state.activeSource,
                    payload: summarizeVideoInfo(payload),
                    response
                });
                showToast('❌ 发送失败');
            }
        }
    );
}

function render() {
    hideMessages();

    els.autoTrackToggle.checked = state.autoTrackEnabled;
    els.hoverPreviewVisibilityToggle.checked = state.hoverPreviewVisible;
    els.hoverPreviewVisibilityToggle.disabled = false;

    els.editorPanel.classList.remove('hidden');
    populateEditorFields();
    renderEditorMeta();
    renderThumbnailPreview();
    renderImageSection();
    renderActionStates();

    const shouldShowEmpty = !state.currentVideoInfo;
    const emptyText = state.autoTrackEnabled
        ? '当前页面还没有绑定候选信息。你可以继续 hover 列表视频，或点击“从本页面解析”。'
        : '自动追踪关闭时，当前页面默认使用“从本页面解析”结果。';

    if (shouldShowEmpty) {
        showEmpty(emptyText);
    }

    els.loading.classList.add('hidden');
}

function populateEditorFields() {
    const video = state.currentVideoInfo || {};
    els.fieldTitle.value = video.title || '';
    els.fieldDuration.value = video.duration || '';
    els.fieldUrl.value = video.url || '';
    els.fieldThumbnail.value = video.thumbnailUrl || '';
}

function renderEditorMeta() {
    const dirtySuffix = state.dirty ? '（已手动修改）' : '';
    let sourceLabel = '来源：当前页面尚未绑定候选信息';

    if (shouldUsePageVideoByDefault()) {
        sourceLabel = '来源：当前页面解析结果';
    } else if (state.activeSource === 'candidate') {
        sourceLabel = '来源：当前页面绑定的候选信息';
    } else if (state.activeSource === 'none') {
        sourceLabel = '来源：当前页面暂无绑定候选信息';
    }

    els.activeSourceText.textContent = `${sourceLabel}${dirtySuffix}`;
    els.dirtyBadge.classList.toggle('hidden', !state.dirty);
}

function renderThumbnailPreview() {
    renderImageOrPlaceholder(
        state.currentVideoInfo?.thumbnailUrl,
        els.editorThumbPreview,
        els.editorThumbPlaceholder
    );
}

function renderImageSection() {
    const hasImages = Array.isArray(state.pageImages) && state.pageImages.length > 0;
    els.imagesSection.classList.toggle('hidden', !hasImages);

    if (!hasImages) {
        els.imageList.innerHTML = '';
        els.imageList.classList.add('hidden');
        els.toggleImagesBtn.setAttribute('aria-expanded', 'false');
        return;
    }

    els.imageList.innerHTML = '';
    const fragment = document.createDocumentFragment();

    state.pageImages.forEach((url, index) => {
        const item = document.createElement('div');
        item.className = 'page-image';
        item.tabIndex = 0;

        const img = document.createElement('img');
        img.src = url;
        img.alt = `Page image ${index + 1}`;
        img.loading = 'lazy';
        img.onerror = () => {
            item.style.display = 'none';
        };

        item.appendChild(img);
        item.addEventListener('click', () => {
            els.fieldThumbnail.value = url;
            handleFieldInput();
            showToast('✅ 已将当前图片设置为缩略图');
        });
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                item.click();
            }
        });

        fragment.appendChild(item);
    });

    els.imageList.appendChild(fragment);
}

function renderActionStates() {
    const hasCurrentVideo = Boolean(state.currentVideoInfo);
    const hasCurrentUrl = Boolean(state.currentVideoInfo?.url);
    const hasPageBoundCandidate = Boolean(state.pageBoundCandidateVideoInfo);

    els.bookmarkBtn.disabled = !hasCurrentVideo || !hasCurrentUrl;
    els.copyJsonBtn.disabled = !hasCurrentVideo;
    els.openUrlBtn.disabled = !hasCurrentUrl;
    els.copyDebugLogsBtn.disabled = false;
    els.clearDebugLogsBtn.disabled = false;
    els.clearCandidateBtn.disabled = !hasPageBoundCandidate;
    els.parseBtn.disabled = state.restrictedPage || !state.activeTab?.id;
}

function renderImageOrPlaceholder(url, imageEl, placeholderEl) {
    if (url) {
        imageEl.src = url;
        imageEl.classList.remove('hidden');
        placeholderEl.classList.add('hidden');
        imageEl.onerror = () => {
            imageEl.classList.add('hidden');
            placeholderEl.classList.remove('hidden');
        };
    } else {
        imageEl.removeAttribute('src');
        imageEl.classList.add('hidden');
        placeholderEl.classList.remove('hidden');
    }
}

function showLoading() {
    els.loading.classList.remove('hidden');
    els.error.classList.add('hidden');
    els.empty.classList.add('hidden');
    els.editorPanel.classList.add('hidden');
    els.imagesSection.classList.add('hidden');
}

function hideMessages() {
    els.error.classList.add('hidden');
    els.empty.classList.add('hidden');
}

function showError(message) {
    els.loading.classList.add('hidden');
    els.error.classList.remove('hidden');
    els.error.textContent = message;
}

function showEmpty(message) {
    els.empty.classList.remove('hidden');
    els.empty.textContent = message;
}

function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
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
}

function extractCurrentPageVideoInfo(tabId) {
    return new Promise((resolve, reject) => {
        sendMessageToTab(tabId, 0, resolve, reject);
    });
}

function sendMessageToTab(tabId, retryCount, resolve, reject) {
    chrome.tabs.sendMessage(
        tabId,
        { action: 'extractVideoInfo' },
        (response) => {
            const lastError = chrome.runtime.lastError;

            if (lastError) {
                if (retryCount === 0) {
                    setTimeout(() => sendMessageToTab(tabId, retryCount + 1, resolve, reject), 120);
                    return;
                }

                reject(new Error(lastError.message));
                return;
            }

            resolve(response || { videos: [], pageImages: [] });
        }
    );
}

function showToast(message) {
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 220);
    }, 2200);
}
