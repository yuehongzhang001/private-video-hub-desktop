// Popup script for Private Video Hub extension
// Handles UI rendering and user interactions

let g_videos = [];
const NATIVE_HOST_NAME = 'com.private_video_hub.desktop';

document.addEventListener('DOMContentLoaded', async () => {
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const emptyEl = document.getElementById('empty');
    const resultsEl = document.getElementById('results');
    const imagesSectionEl = document.getElementById('images-section');
    const imageListEl = document.getElementById('image-list');
    const toggleImagesBtn = document.getElementById('toggle-images');

    try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.id) {
            showError();
            return;
        }

        // Check for restricted URLs (chrome://, edge://, about:, etc.)
        if (tab.url && (
            tab.url.startsWith('chrome://') ||
            tab.url.startsWith('edge://') ||
            tab.url.startsWith('about:') ||
            tab.url.startsWith('chrome-extension://')
        )) {
            showRestrictedUrlError();
            return;
        }

        // Try to send message directly first
        sendMessageToTab(tab.id);

        // Bind refresh button
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                // Reset UI
                loadingEl.classList.remove('hidden');
                errorEl.classList.add('hidden');
                emptyEl.classList.add('hidden');
                resultsEl.classList.add('hidden');
                resultsEl.innerHTML = ''; // Clear previous results
                if (imagesSectionEl) {
                    imagesSectionEl.classList.add('hidden');
                }
                if (imageListEl) {
                    imageListEl.innerHTML = '';
                    imageListEl.classList.add('hidden');
                }
                if (toggleImagesBtn) {
                    toggleImagesBtn.classList.remove('expanded');
                    toggleImagesBtn.setAttribute('aria-expanded', 'false');
                }

                sendMessageToTab(tab.id);
            });
        }

        if (toggleImagesBtn) {
            toggleImagesBtn.addEventListener('click', () => {
                const isExpanded = toggleImagesBtn.classList.toggle('expanded');
                toggleImagesBtn.setAttribute('aria-expanded', String(isExpanded));
                if (imageListEl) {
                    imageListEl.classList.toggle('hidden', !isExpanded);
                }
            });
        }

    } catch (error) {
        console.error('Error initializing popup:', error);
        showError();
    }
});

/**
 * Send message to tab with retry logic and script injection
 */
function sendMessageToTab(tabId, retryCount = 0) {
    chrome.tabs.sendMessage(
        tabId,
        { action: 'extractVideoInfo' },
        (response) => {
            const lastError = chrome.runtime.lastError;

            if (lastError) {
                console.log('Message failed, attempting to inject script:', lastError.message);

                // If we haven't retried yet, try injecting the script
                if (retryCount === 0) {
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ['content.js']
                    }).then(() => {
                        // Retry sending message after injection
                        setTimeout(() => sendMessageToTab(tabId, retryCount + 1), 100);
                    }).catch(err => {
                        console.error('Script injection failed:', err);
                        showError();
                    });
                    return;
                }

                // If we already retried or injection failed
                showError();
                return;
            }

            if (response && response.videos && response.videos.length > 0) {
                displayVideos(response.videos);
            } else {
                showEmpty();
            }

            if (response && response.pageImages) {
                updateImageSection(response.pageImages);
            }
        }
    );
}

/**
 * Show error specifically for restricted URLs
 */
function showRestrictedUrlError() {
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    loadingEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorEl.innerHTML = '<p>❌ 此页面不支持扩展程序<br><small>系统页面无法注入脚本</small></p>';
    hideImageSection();
}

/**
 * Display video candidates
 */
function displayVideos(videos) {
    const loadingEl = document.getElementById('loading');
    const resultsEl = document.getElementById('results');

    loadingEl.classList.add('hidden');
    resultsEl.classList.remove('hidden');

    g_videos = Array.isArray(videos) ? videos : [];

    videos.forEach((video, index) => {
        const card = createVideoCard(video, index);
        resultsEl.appendChild(card);
    });
}

/**
 * Create a video card element
 */
function createVideoCard(video, index) {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.dataset.videoIndex = String(index);

    // Debug logging
    console.log('Creating card for video:', video);

    // Priority badge
    const priorityBadge = video.priority === 1 ? '<div class="priority-badge">推荐</div>' : '';

    // Thumbnail
    const thumbnailHtml = video.thumbnailUrl
        ? `<img src="${escapeHtml(video.thumbnailUrl)}" alt="Video thumbnail" class="video-thumbnail" onerror="this.style.display='none'">`
        : `<div class="video-thumbnail placeholder">🎬</div>`;

    // Duration - always show, with placeholder if not available
    const durationHtml = video.duration
        ? `<div class="video-duration">⏱️ ${escapeHtml(video.duration)}</div>`
        : `<div class="video-duration" style="opacity: 0.5;">⏱️ 未知</div>`;

    // Source badge
    const sourceLabels = {
        'meta-tags': 'Meta标签',
        'video-element': 'Video元素',
        'player-structure': '播放器'
    };
    const sourceLabel = sourceLabels[video.source] || '未知';

    card.innerHTML = `
    ${priorityBadge}
    ${thumbnailHtml}
    <div class="video-info">
      <h3 class="video-title">${escapeHtml(video.title || '未知标题')}</h3>
      <div class="video-meta">
        ${durationHtml}
        <div class="video-source">📍 ${sourceLabel}</div>
      </div>
      <div class="video-url">${escapeHtml(video.url || '')}</div>
      <div class="video-actions">
        <button class="btn btn-primary" data-action="copy-json" data-index="${index}">
          复制JSON
        </button>
        <button class="btn btn-accent" data-action="send-app" data-index="${index}">
          发送到应用
        </button>
        <button class="btn btn-secondary" data-action="open-url" data-index="${index}">
          打开链接
        </button>
      </div>
    </div>
  `;

    // Add event listeners
    const copyBtn = card.querySelector('[data-action="copy-json"]');
    const sendBtn = card.querySelector('[data-action="send-app"]');
    const openBtn = card.querySelector('[data-action="open-url"]');

    copyBtn.addEventListener('click', () => copyVideoJson(video));
    sendBtn.addEventListener('click', () => sendVideoInfoToApp(video));
    openBtn.addEventListener('click', () => openVideoUrl(video.url));

    return card;
}

function getTargetVideoIndex() {
    if (!g_videos.length) return -1;
    const preferredIndex = g_videos.findIndex(video => video && video.priority === 1);
    return preferredIndex >= 0 ? preferredIndex : 0;
}

function updateVideoThumbnail(index, imageUrl) {
    if (index < 0 || index >= g_videos.length) return;
    g_videos[index].thumbnailUrl = imageUrl;

    const resultsEl = document.getElementById('results');
    if (!resultsEl) return;

    const card = resultsEl.querySelector(`[data-video-index="${index}"]`);
    if (!card) return;

    const existingThumb = card.querySelector('.video-thumbnail');
    if (existingThumb && existingThumb.tagName.toLowerCase() === 'img') {
        existingThumb.src = imageUrl;
        existingThumb.style.display = '';
    } else {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = 'Video thumbnail';
        img.className = 'video-thumbnail';
        img.onerror = () => {
            img.style.display = 'none';
        };

        if (existingThumb) {
            existingThumb.replaceWith(img);
        } else {
            card.prepend(img);
        }
    }
}

/**
 * Copy video data as JSON to clipboard
 */
function copyVideoJson(video) {
    const jsonData = {
        title: video.title,
        url: video.url,
        duration: video.duration,
        thumbnailUrl: video.thumbnailUrl,
        siteName: video.siteName,
        siteIconUrl: video.siteIconUrl
    };

    const jsonString = JSON.stringify(jsonData, null, 2);

    navigator.clipboard.writeText(jsonString).then(() => {
        showToast('✅ JSON已复制到剪贴板');
    }).catch(err => {
        console.error('Failed to copy:', err);
        showToast('❌ 复制失败');
    });
}

/**
 * Open video URL in new tab
 */
function openVideoUrl(url) {
    if (url) {
        chrome.tabs.create({ url: url });
    }
}

/**
 * Show error state
 */
function showError() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error').classList.remove('hidden');
    hideImageSection();
}

/**
 * Show empty state
 */
function showEmpty() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('empty').classList.remove('hidden');
}

/**
 * Send video data to desktop app via native messaging
 */
function sendVideoInfoToApp(video) {
    const payload = {
        title: video.title,
        url: video.url,
        duration: video.duration,
        thumbnailUrl: video.thumbnailUrl,
        siteName: video.siteName,
        siteIconUrl: video.siteIconUrl
    };

    chrome.runtime.sendNativeMessage(
        NATIVE_HOST_NAME,
        { type: 'favorite', favorite: payload },
        (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
                console.error('Native messaging failed:', lastError.message);
                showToast('❌ 未连接到本地应用');
                return;
            }
            if (response && response.ok) {
                showToast('✅ 已发送到应用');
            } else {
                showToast('❌ 发送失败');
            }
        }
    );
}

/**
 * Update page images section
 */
function updateImageSection(images) {
    const imagesSectionEl = document.getElementById('images-section');
    const imageListEl = document.getElementById('image-list');
    const toggleImagesBtn = document.getElementById('toggle-images');

    if (!imagesSectionEl || !imageListEl || !toggleImagesBtn) return;

    if (!images || images.length === 0) {
        imagesSectionEl.classList.add('hidden');
        imageListEl.classList.add('hidden');
        toggleImagesBtn.classList.remove('expanded');
        toggleImagesBtn.setAttribute('aria-expanded', 'false');
        return;
    }

    imagesSectionEl.classList.remove('hidden');
    imageListEl.innerHTML = '';
    imageListEl.classList.add('hidden');
    toggleImagesBtn.classList.remove('expanded');
    toggleImagesBtn.setAttribute('aria-expanded', 'false');

    const fragment = document.createDocumentFragment();
    images.forEach((url, index) => {
        const item = document.createElement('div');
        item.className = 'page-image';
        item.tabIndex = 0;

        const img = document.createElement('img');
        img.src = url;
        img.alt = `Image ${index + 1}`;
        img.loading = 'lazy';
        img.onerror = () => {
            item.style.display = 'none';
        };

        item.appendChild(img);
        item.addEventListener('click', () => {
            const targetIndex = getTargetVideoIndex();
            updateVideoThumbnail(targetIndex, url);
            if (imageListEl) {
                imageListEl.classList.add('hidden');
            }
            if (toggleImagesBtn) {
                toggleImagesBtn.classList.remove('expanded');
                toggleImagesBtn.setAttribute('aria-expanded', 'false');
            }
        });
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                item.click();
            }
        });
        fragment.appendChild(item);
    });

    imageListEl.appendChild(fragment);
}

function hideImageSection() {
    const imagesSectionEl = document.getElementById('images-section');
    const imageListEl = document.getElementById('image-list');
    const toggleImagesBtn = document.getElementById('toggle-images');

    if (imagesSectionEl) imagesSectionEl.classList.add('hidden');
    if (imageListEl) {
        imageListEl.innerHTML = '';
        imageListEl.classList.add('hidden');
    }
    if (toggleImagesBtn) {
        toggleImagesBtn.classList.remove('expanded');
        toggleImagesBtn.setAttribute('aria-expanded', 'false');
    }
}

/**
 * Show toast notification
 */
function showToast(message) {
    // Remove existing toast if any
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 2 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
