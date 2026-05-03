// Background service worker for Private Video Hub extension.
// Separates hover preview state from page-bound candidate state.

const STORAGE_KEYS = {
  autoTrackEnabled: 'autoTrackCandidateVideoInfoEnabled',
  hoverPreviewVisible: 'hoverPreviewVisibleEnabled',
  hoverPreview: 'hoverPreviewVideoInfo',
  pendingNavigationCandidate: 'pendingNavigationCandidateVideoInfo',
  pageContexts: 'pageBoundCandidateContexts',
  debugLogs: 'candidateTrackingDebugLogs'
};

const MAX_DEBUG_LOGS = 200;

function sanitizeDebugValue(value, depth = 0) {
  if (depth > 3) return '[MaxDepth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > 400 ? `${value.slice(0, 397)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeDebugValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const next = {};
    Object.entries(value).slice(0, 20).forEach(([key, nested]) => {
      next[key] = sanitizeDebugValue(nested, depth + 1);
    });
    return next;
  }
  return String(value);
}

function appendDebugLog(logs, source, event, data) {
  const nextLogs = Array.isArray(logs) ? [...logs] : [];
  nextLogs.push({
    ts: new Date().toISOString(),
    source,
    event,
    data: sanitizeDebugValue(data)
  });
  return nextLogs.slice(-MAX_DEBUG_LOGS);
}

function summarizeVideoInfo(video) {
  if (!video) return null;
  return sanitizeDebugValue({
    title: video.title || '',
    detailPageUrl: video.detailPageUrl || video.url || '',
    thumbnailUrl: video.thumbnailUrl || '',
    duration: video.duration || '',
    matchKey: video.matchKey || '',
    looseMatchKey: video.looseMatchKey || '',
    navigationTargetIdentityKey: video.navigationTargetIdentityKey || '',
    capturedFromPageUrl: video.capturedFromPageUrl || ''
  });
}

function normalizePageUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(String(url).trim());
    parsed.hash = '';
    return parsed.href;
  } catch (error) {
    return null;
  }
}

function normalizePageIdentityUrl(url) {
  if (!url) return null;

  try {
    return new URL(String(url).trim()).href;
  } catch (error) {
    return null;
  }
}

function buildPageMatchKeys(url) {
  const normalized = normalizePageUrl(url);
  if (!normalized) return { matchKey: null, looseMatchKey: null };

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

function candidateMatchesPage(candidate, pageUrl) {
  if (!candidate || !pageUrl) return false;

  const candidateKeys = {
    matchKey: candidate.matchKey || buildPageMatchKeys(candidate.detailPageUrl || candidate.url).matchKey,
    looseMatchKey: candidate.looseMatchKey || buildPageMatchKeys(candidate.detailPageUrl || candidate.url).looseMatchKey
  };
  const pageKeys = buildPageMatchKeys(pageUrl);

  if (!candidateKeys.matchKey || !pageKeys.matchKey) return false;
  if (candidateKeys.matchKey === pageKeys.matchKey) return true;
  if (candidateKeys.looseMatchKey && candidateKeys.looseMatchKey === pageKeys.looseMatchKey) return true;
  return false;
}

function sanitizePageContexts(raw) {
  if (!Array.isArray(raw)) return [];

  return raw.filter((entry) =>
    entry &&
    typeof entry.pageIdentityKey === 'string' &&
    typeof entry.pageMatchKey === 'string' &&
    typeof entry.pageLooseMatchKey === 'string' &&
    typeof entry.sourcePreference === 'string'
  );
}

function findPageContextIndex(pageContexts, pageUrl) {
  const pageIdentityKey = normalizePageIdentityUrl(pageUrl);
  const pageKeys = buildPageMatchKeys(pageUrl);
  if (!pageIdentityKey || !pageKeys.matchKey) {
    return { index: -1, pageIdentityKey, pageKeys };
  }

  const exactIndex = pageContexts.findIndex((entry) =>
    entry.pageIdentityKey === pageIdentityKey
  );

  if (exactIndex >= 0) {
    return { index: exactIndex, pageIdentityKey, pageKeys };
  }

  const index = pageContexts.findIndex((entry) =>
    !entry.pageIdentityKey &&
    (
      entry.pageMatchKey === pageKeys.matchKey ||
      (entry.pageLooseMatchKey && entry.pageLooseMatchKey === pageKeys.looseMatchKey)
    )
  );

  return { index, pageIdentityKey, pageKeys };
}

function resolvePageContext(pageUrl, pendingNavigationCandidate, pageContexts) {
  const nextContexts = [...pageContexts];
  const { index, pageIdentityKey, pageKeys } = findPageContextIndex(nextContexts, pageUrl);

  if (!pageIdentityKey || !pageKeys.matchKey) {
    return {
      didMutate: false,
      didConsumePending: false,
      pageContexts: nextContexts,
      pageContext: null
    };
  }

  const pendingTargetIdentityKey =
    pendingNavigationCandidate?.navigationTargetIdentityKey ||
    normalizePageIdentityUrl(pendingNavigationCandidate?.detailPageUrl || pendingNavigationCandidate?.url);

  const shouldBindPending =
    pendingNavigationCandidate &&
    pendingTargetIdentityKey &&
    pendingTargetIdentityKey === pageIdentityKey;
  const shouldRebindExistingContext =
    pendingNavigationCandidate &&
    (shouldBindPending || candidateMatchesPage(pendingNavigationCandidate, pageUrl));

  if (index >= 0) {
    const existingContext = nextContexts[index];

    if (shouldRebindExistingContext && existingContext?.sourcePreference !== 'candidate') {
      const reboundContext = {
        ...existingContext,
        pageIdentityKey,
        pageMatchKey: pageKeys.matchKey,
        pageLooseMatchKey: pageKeys.looseMatchKey,
        sourcePreference: 'candidate',
        boundCandidateVideoInfo: {
          ...pendingNavigationCandidate,
          boundAt: Date.now()
        },
        updatedAt: Date.now()
      };
      nextContexts[index] = reboundContext;
      return {
        didMutate: true,
        didConsumePending: true,
        pageContexts: nextContexts,
        pageContext: reboundContext
      };
    }

    return {
      didMutate: false,
      didConsumePending: false,
      pageContexts: nextContexts,
      pageContext: existingContext
    };
  }

  if (shouldBindPending || (pendingNavigationCandidate && candidateMatchesPage(pendingNavigationCandidate, pageUrl))) {
    const boundContext = {
      pageIdentityKey,
      pageMatchKey: pageKeys.matchKey,
      pageLooseMatchKey: pageKeys.looseMatchKey,
      sourcePreference: 'candidate',
      boundCandidateVideoInfo: {
        ...pendingNavigationCandidate,
        boundAt: Date.now()
      },
      createdAt: Date.now()
    };
    nextContexts.push(boundContext);
    return {
      didMutate: true,
      didConsumePending: true,
      pageContexts: nextContexts,
      pageContext: boundContext
    };
  }

  return {
    didMutate: false,
    didConsumePending: false,
    pageContexts: nextContexts,
    pageContext: null
  };
}

function upsertPageContext(pageUrl, pageContexts, patch) {
  const nextContexts = [...pageContexts];
  const { index, pageIdentityKey, pageKeys } = findPageContextIndex(nextContexts, pageUrl);

  if (!pageIdentityKey || !pageKeys.matchKey) {
    return nextContexts;
  }

  const nextValue = {
    pageIdentityKey,
    pageMatchKey: pageKeys.matchKey,
    pageLooseMatchKey: pageKeys.looseMatchKey,
    sourcePreference: 'none',
    boundCandidateVideoInfo: null,
    updatedAt: Date.now(),
    ...patch
  };

  if (index >= 0) {
    nextContexts[index] = {
      ...nextContexts[index],
      ...nextValue
    };
  } else {
    nextContexts.push(nextValue);
  }

  return nextContexts;
}

async function getAutoTrackEnabled() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.autoTrackEnabled);
  return Boolean(stored[STORAGE_KEYS.autoTrackEnabled]);
}

async function getHoverPreviewVisibleEnabled() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.hoverPreviewVisible);
  return stored[STORAGE_KEYS.hoverPreviewVisible] !== false;
}

async function getSessionState(keys) {
  return chrome.storage.session.get(keys);
}

function findPageContext(pageContexts, pageUrl) {
  const { index } = findPageContextIndex(pageContexts, pageUrl);
  return index >= 0 ? pageContexts[index] : null;
}

function buildPageSourcePreferencePatch(pageUrl, pageContexts, preference) {
  const existingContext = findPageContext(pageContexts, pageUrl);
  return {
    sourcePreference: preference,
    boundCandidateVideoInfo: preference === 'none'
      ? null
      : (existingContext?.boundCandidateVideoInfo || null),
    updatedAt: Date.now()
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Private Video Hub extension installed');

  const stored = await chrome.storage.local.get(STORAGE_KEYS.autoTrackEnabled);
  const hoverPreviewStored = await chrome.storage.local.get(STORAGE_KEYS.hoverPreviewVisible);
  if (typeof stored[STORAGE_KEYS.autoTrackEnabled] !== 'boolean') {
    await chrome.storage.local.set({ [STORAGE_KEYS.autoTrackEnabled]: false });
  }
  if (typeof hoverPreviewStored[STORAGE_KEYS.hoverPreviewVisible] !== 'boolean') {
    await chrome.storage.local.set({ [STORAGE_KEYS.hoverPreviewVisible]: true });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  (async () => {
    switch (request.action) {
      case 'getExtensionState': {
        const autoTrackEnabled = await getAutoTrackEnabled();
        const hoverPreviewVisible = await getHoverPreviewVisibleEnabled();
        const sessionState = await getSessionState([
          STORAGE_KEYS.hoverPreview,
          STORAGE_KEYS.pageContexts,
          STORAGE_KEYS.debugLogs
        ]);
        const pageContexts = sanitizePageContexts(sessionState[STORAGE_KEYS.pageContexts]);
        const pageContext = findPageContext(pageContexts, request.pageUrl || '');
        const nextLogs = appendDebugLog(
          sessionState[STORAGE_KEYS.debugLogs],
          'background',
          'get-extension-state',
          {
            pageUrl: request.pageUrl || '',
            autoTrackEnabled,
            hoverPreviewVisible,
            pageSourcePreference: pageContext?.sourcePreference || null,
            pageBoundCandidateVideoInfo: summarizeVideoInfo(pageContext?.boundCandidateVideoInfo)
          }
        );
        await chrome.storage.session.set({ [STORAGE_KEYS.debugLogs]: nextLogs });

        sendResponse({
          ok: true,
          autoTrackEnabled,
          hoverPreviewVisible,
          pageBoundCandidateVideoInfo: pageContext?.boundCandidateVideoInfo || null,
          pageSourcePreference: pageContext?.sourcePreference || null
        });
        return;
      }
      case 'resolvePageBoundCandidateForPage': {
        const autoTrackEnabled = await getAutoTrackEnabled();
        const sessionState = await getSessionState([
          STORAGE_KEYS.pendingNavigationCandidate,
          STORAGE_KEYS.pageContexts,
          STORAGE_KEYS.debugLogs
        ]);
        const pendingNavigationCandidate = sessionState[STORAGE_KEYS.pendingNavigationCandidate] || null;
        const pageContexts = sanitizePageContexts(sessionState[STORAGE_KEYS.pageContexts]);

        if (!autoTrackEnabled) {
          const nextLogs = appendDebugLog(
            sessionState[STORAGE_KEYS.debugLogs],
            'background',
            'resolve-page-bound-skipped',
            {
              reason: 'auto-track-disabled',
              pageUrl: request.pageUrl || ''
            }
          );
          await chrome.storage.session.set({ [STORAGE_KEYS.debugLogs]: nextLogs });
          sendResponse({ ok: true, pageBoundCandidateVideoInfo: null, pageSourcePreference: null });
          return;
        }

        const resolved = resolvePageContext(
          request.pageUrl || '',
          pendingNavigationCandidate,
          pageContexts
        );

        const nextSessionPatch = {};
        if (resolved.didMutate || resolved.didConsumePending) {
          if (resolved.didMutate) {
            nextSessionPatch[STORAGE_KEYS.pageContexts] = resolved.pageContexts;
          }
          if (resolved.didConsumePending) {
            nextSessionPatch[STORAGE_KEYS.pendingNavigationCandidate] = null;
          }
        }
        nextSessionPatch[STORAGE_KEYS.debugLogs] = appendDebugLog(
          sessionState[STORAGE_KEYS.debugLogs],
          'background',
          'resolve-page-bound',
          {
            pageUrl: request.pageUrl || '',
            pendingNavigationCandidate: summarizeVideoInfo(pendingNavigationCandidate),
            didMutate: resolved.didMutate,
            didConsumePending: resolved.didConsumePending,
            pageSourcePreference: resolved.pageContext?.sourcePreference || null,
            pageBoundCandidateVideoInfo: summarizeVideoInfo(resolved.pageContext?.boundCandidateVideoInfo)
          }
        );
        await chrome.storage.session.set(nextSessionPatch);

        sendResponse({
          ok: true,
          pageBoundCandidateVideoInfo: resolved.pageContext?.boundCandidateVideoInfo || null,
          pageSourcePreference: resolved.pageContext?.sourcePreference || null
        });
        return;
      }
      case 'setAutoTrackEnabled': {
        const enabled = Boolean(request.enabled);
        await chrome.storage.local.set({ [STORAGE_KEYS.autoTrackEnabled]: enabled });
        if (!enabled) {
          await chrome.storage.session.remove([
            STORAGE_KEYS.hoverPreview,
            STORAGE_KEYS.pendingNavigationCandidate,
            STORAGE_KEYS.pageContexts,
            STORAGE_KEYS.debugLogs
          ]);
        } else {
          const sessionState = await getSessionState(STORAGE_KEYS.debugLogs);
          await chrome.storage.session.set({
            [STORAGE_KEYS.debugLogs]: appendDebugLog(
              sessionState[STORAGE_KEYS.debugLogs],
              'background',
              'set-auto-track-enabled',
              { enabled }
            )
          });
        }
        sendResponse({ ok: true, autoTrackEnabled: enabled });
        return;
      }
      case 'setHoverPreviewVisibilityEnabled': {
        const enabled = Boolean(request.enabled);
        await chrome.storage.local.set({ [STORAGE_KEYS.hoverPreviewVisible]: enabled });
        const sessionState = await getSessionState(STORAGE_KEYS.debugLogs);
        await chrome.storage.session.set({
          [STORAGE_KEYS.debugLogs]: appendDebugLog(
            sessionState[STORAGE_KEYS.debugLogs],
            'background',
            'set-hover-preview-visibility-enabled',
            { enabled }
          )
        });
        sendResponse({ ok: true, hoverPreviewVisible: enabled });
        return;
      }
      case 'appendDebugLog': {
        const sessionState = await getSessionState(STORAGE_KEYS.debugLogs);
        const nextLogs = appendDebugLog(
          sessionState[STORAGE_KEYS.debugLogs],
          request.source || 'unknown',
          request.event || 'unknown',
          request.data || null
        );
        await chrome.storage.session.set({ [STORAGE_KEYS.debugLogs]: nextLogs });
        sendResponse({ ok: true, size: nextLogs.length });
        return;
      }
      case 'getDebugLogs': {
        const sessionState = await getSessionState(STORAGE_KEYS.debugLogs);
        sendResponse({
          ok: true,
          logs: Array.isArray(sessionState[STORAGE_KEYS.debugLogs]) ? sessionState[STORAGE_KEYS.debugLogs] : []
        });
        return;
      }
      case 'clearDebugLogs': {
        await chrome.storage.session.set({ [STORAGE_KEYS.debugLogs]: [] });
        sendResponse({ ok: true });
        return;
      }
      case 'storeHoverPreviewVideoInfo': {
        const enabled = await getAutoTrackEnabled();

        if (!enabled) {
          sendResponse({ ok: false, ignored: true, reason: 'auto-track-disabled' });
          return;
        }

        if (!request.hoverPreviewVideoInfo) {
          sendResponse({ ok: false, error: 'missing-hover-preview' });
          return;
        }

        await chrome.storage.session.set({
          [STORAGE_KEYS.hoverPreview]: request.hoverPreviewVideoInfo
        });
        sendResponse({ ok: true });
        return;
      }
      case 'storePendingNavigationCandidateVideoInfo': {
        const enabled = await getAutoTrackEnabled();

        if (!enabled) {
          sendResponse({ ok: false, ignored: true, reason: 'auto-track-disabled' });
          return;
        }

        if (!request.pendingNavigationCandidateVideoInfo) {
          sendResponse({ ok: false, error: 'missing-pending-navigation-candidate' });
          return;
        }

        const sessionState = await getSessionState(STORAGE_KEYS.debugLogs);
        await chrome.storage.session.set({
          [STORAGE_KEYS.pendingNavigationCandidate]: request.pendingNavigationCandidateVideoInfo,
          [STORAGE_KEYS.debugLogs]: appendDebugLog(
            sessionState[STORAGE_KEYS.debugLogs],
            'background',
            'store-pending-navigation-candidate',
            {
              pendingNavigationCandidateVideoInfo: summarizeVideoInfo(request.pendingNavigationCandidateVideoInfo)
            }
          )
        });
        sendResponse({ ok: true });
        return;
      }
      case 'clearPageBoundCandidateVideoInfo': {
        const sessionState = await getSessionState(STORAGE_KEYS.pageContexts);
        const pageContexts = sanitizePageContexts(sessionState[STORAGE_KEYS.pageContexts]);
        const nextContexts = upsertPageContext(request.pageUrl || '', pageContexts, {
          sourcePreference: 'none',
          boundCandidateVideoInfo: null,
          clearedAt: Date.now()
        });

        await chrome.storage.session.set({
          [STORAGE_KEYS.pageContexts]: nextContexts
        });
        sendResponse({ ok: true });
        return;
      }
      case 'setPageSourcePreference': {
        const preference = request.sourcePreference;
        if (!['page', 'none'].includes(preference)) {
          sendResponse({ ok: false, error: 'invalid-source-preference' });
          return;
        }

        const sessionState = await getSessionState(STORAGE_KEYS.pageContexts);
        const pageContexts = sanitizePageContexts(sessionState[STORAGE_KEYS.pageContexts]);
        const nextContexts = upsertPageContext(
          request.pageUrl || '',
          pageContexts,
          buildPageSourcePreferencePatch(request.pageUrl || '', pageContexts, preference)
        );

        await chrome.storage.session.set({
          [STORAGE_KEYS.pageContexts]: nextContexts
        });
        sendResponse({ ok: true });
        return;
      }
      default: {
        sendResponse({ ok: false, error: 'unknown-action' });
      }
    }
  })().catch((error) => {
    console.error('Background message handling failed:', error);
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return true;
});
