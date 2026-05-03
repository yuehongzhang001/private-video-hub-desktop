import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadBackgroundHelpers() {
  const backgroundPath = path.resolve('video-info-extension/background.js');
  const source = fs.readFileSync(backgroundPath, 'utf8');

  const context = {
    console,
    URL,
    chrome: {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {}
        },
        session: {
          get: async () => ({}),
          set: async () => {},
          remove: async () => {}
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(source, context, { filename: backgroundPath });

  return {
    normalizePageUrl: context.normalizePageUrl,
    normalizePageIdentityUrl: context.normalizePageIdentityUrl,
    buildPageMatchKeys: context.buildPageMatchKeys,
    candidateMatchesPage: context.candidateMatchesPage,
    findPageContextIndex: context.findPageContextIndex,
    resolvePageContext: context.resolvePageContext,
    upsertPageContext: context.upsertPageContext
  };
}

const helpers = loadBackgroundHelpers();

function createCandidate(detailPageUrl, overrides = {}) {
  const keys = helpers.buildPageMatchKeys(detailPageUrl);
  return {
    title: 'Example Video',
    url: detailPageUrl,
    detailPageUrl,
    thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
    duration: '12:34',
    navigationTargetIdentityKey: helpers.normalizePageIdentityUrl(detailPageUrl),
    matchKey: keys.matchKey,
    looseMatchKey: keys.looseMatchKey,
    ...overrides
  };
}

const tests = [
  [
    'binds the clicked snapshot to the exact destination page',
    () => {
      const pending = createCandidate('https://site.example/watch/abc?from=list');
      const resolved = helpers.resolvePageContext(
        'https://site.example/watch/abc?from=list',
        pending,
        []
      );

      assert.equal(resolved.didMutate, true);
      assert.equal(resolved.didConsumePending, true);
      assert.equal(resolved.pageContexts.length, 1);
      assert.equal(
        resolved.pageContext.boundCandidateVideoInfo.navigationTargetIdentityKey,
        'https://site.example/watch/abc?from=list'
      );
      assert.equal(
        resolved.pageContext.boundCandidateVideoInfo.thumbnailUrl,
        'https://cdn.example.com/thumb.jpg'
      );
    }
  ],
  [
    'does not reuse the first page binding for a second exact destination',
    () => {
      const firstPage = 'https://site.example/watch/abc';
      const secondPage = 'https://site.example/watch/xyz';

      const firstResolved = helpers.resolvePageContext(firstPage, createCandidate(firstPage), []);
      const secondResolved = helpers.resolvePageContext(
        secondPage,
        createCandidate(secondPage, {
          title: 'Second Video',
          thumbnailUrl: 'https://cdn.example.com/second.jpg'
        }),
        firstResolved.pageContexts
      );

      assert.equal(secondResolved.pageContexts.length, 2);

      const firstIndex = helpers.findPageContextIndex(secondResolved.pageContexts, firstPage).index;
      const secondIndex = helpers.findPageContextIndex(secondResolved.pageContexts, secondPage).index;

      assert.notEqual(firstIndex, secondIndex);
      assert.equal(
        secondResolved.pageContexts[secondIndex].boundCandidateVideoInfo.title,
        'Second Video'
      );
      assert.equal(
        secondResolved.pageContexts[secondIndex].boundCandidateVideoInfo.thumbnailUrl,
        'https://cdn.example.com/second.jpg'
      );
    }
  ],
  [
    'prefers exact identity matching over loose path matching',
    () => {
      const pageContexts = [
        {
          pageIdentityKey: 'https://site.example/watch/abc?ref=one',
          pageMatchKey: 'https://site.example/watch/abc?ref=one',
          pageLooseMatchKey: 'https://site.example/watch/abc',
          sourcePreference: 'candidate',
          boundCandidateVideoInfo: createCandidate('https://site.example/watch/abc?ref=one')
        }
      ];

      const exactSecond = helpers.findPageContextIndex(
        pageContexts,
        'https://site.example/watch/abc?ref=two'
      );

      assert.equal(exactSecond.index, -1);
    }
  ],
  [
    'keeps an existing page binding stable even if a new candidate arrives later',
    () => {
      const pageUrl = 'https://site.example/watch/locked';
      const existing = helpers.resolvePageContext(
        pageUrl,
        createCandidate(pageUrl, { title: 'Locked' }),
        []
      );

      const laterCandidate = createCandidate(pageUrl, {
        title: 'Should Not Override',
        thumbnailUrl: 'https://cdn.example.com/new.jpg'
      });

      const resolved = helpers.resolvePageContext(pageUrl, laterCandidate, existing.pageContexts);

      assert.equal(resolved.didMutate, false);
      assert.equal(resolved.pageContext.boundCandidateVideoInfo.title, 'Locked');
      assert.equal(
        resolved.pageContext.boundCandidateVideoInfo.thumbnailUrl,
        'https://cdn.example.com/thumb.jpg'
      );
    }
  ],
  [
    'rebinds an exact navigation candidate over a stale page-preference context',
    () => {
      const pageUrl = 'https://site.example/watch/revisit';
      const staleContexts = helpers.upsertPageContext(pageUrl, [], {
        sourcePreference: 'page',
        boundCandidateVideoInfo: null
      });

      const incoming = createCandidate(pageUrl, {
        title: 'Fresh Candidate',
        thumbnailUrl: 'https://cdn.example.com/fresh.jpg'
      });

      const resolved = helpers.resolvePageContext(pageUrl, incoming, staleContexts);

      assert.equal(resolved.didMutate, true);
      assert.equal(resolved.didConsumePending, true);
      assert.equal(resolved.pageContext.sourcePreference, 'candidate');
      assert.equal(resolved.pageContext.boundCandidateVideoInfo.title, 'Fresh Candidate');
      assert.equal(
        resolved.pageContext.boundCandidateVideoInfo.thumbnailUrl,
        'https://cdn.example.com/fresh.jpg'
      );
    }
  ],
  [
    'rebinds a stale page-preference context when pending candidate matches by matchKey fallback',
    () => {
      const stalePageUrl = 'https://site.example/watch/revisit#player';
      const navigationUrl = 'https://site.example/watch/revisit';
      const staleContexts = helpers.upsertPageContext(stalePageUrl, [], {
        sourcePreference: 'page',
        boundCandidateVideoInfo: null
      });

      const incoming = createCandidate(navigationUrl, {
        navigationTargetIdentityKey: '',
        title: 'Fallback Candidate',
        thumbnailUrl: 'https://cdn.example.com/fallback.jpg'
      });

      const resolved = helpers.resolvePageContext(stalePageUrl, incoming, staleContexts);

      assert.equal(resolved.didMutate, true);
      assert.equal(resolved.didConsumePending, true);
      assert.equal(resolved.pageContext.sourcePreference, 'candidate');
      assert.equal(resolved.pageContext.boundCandidateVideoInfo.title, 'Fallback Candidate');
      assert.equal(
        resolved.pageContext.boundCandidateVideoInfo.thumbnailUrl,
        'https://cdn.example.com/fallback.jpg'
      );
    }
  ],
  [
    'falls back to matchKey/looseMatchKey when pending snapshot lacks identity key',
    () => {
      const pending = createCandidate('https://site.example/watch/fallback', {
        navigationTargetIdentityKey: ''
      });

      const resolved = helpers.resolvePageContext(
        'https://site.example/watch/fallback#player',
        pending,
        []
      );

      assert.equal(resolved.didMutate, true);
      assert.equal(
        resolved.pageContext.boundCandidateVideoInfo.detailPageUrl,
        'https://site.example/watch/fallback'
      );
    }
  ],
  [
    'clears only the targeted page context',
    () => {
      const firstPage = 'https://site.example/watch/abc';
      const secondPage = 'https://site.example/watch/xyz';

      const firstResolved = helpers.resolvePageContext(firstPage, createCandidate(firstPage), []);
      const secondResolved = helpers.resolvePageContext(
        secondPage,
        createCandidate(secondPage),
        firstResolved.pageContexts
      );

      const cleared = helpers.upsertPageContext(firstPage, secondResolved.pageContexts, {
        sourcePreference: 'none',
        boundCandidateVideoInfo: null
      });

      const firstIndex = helpers.findPageContextIndex(cleared, firstPage).index;
      const secondIndex = helpers.findPageContextIndex(cleared, secondPage).index;

      assert.equal(cleared[firstIndex].sourcePreference, 'none');
      assert.equal(cleared[firstIndex].boundCandidateVideoInfo, null);
      assert.equal(cleared[secondIndex].sourcePreference, 'candidate');
      assert.ok(cleared[secondIndex].boundCandidateVideoInfo);
    }
  ],
  [
    'keeps the bound candidate when switching source preference to page',
    () => {
      const pageUrl = 'https://site.example/watch/kept';
      const resolved = helpers.resolvePageContext(pageUrl, createCandidate(pageUrl, {
        title: 'Keep Me'
      }), []);

      const switched = helpers.upsertPageContext(pageUrl, resolved.pageContexts, {
        sourcePreference: 'page',
        boundCandidateVideoInfo: resolved.pageContext.boundCandidateVideoInfo
      });

      const pageIndex = helpers.findPageContextIndex(switched, pageUrl).index;
      assert.equal(switched[pageIndex].sourcePreference, 'page');
      assert.equal(switched[pageIndex].boundCandidateVideoInfo.title, 'Keep Me');
    }
  ]
];

let failures = 0;

for (const [name, run] of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log(`\n${tests.length} test(s) passed.`);
}
