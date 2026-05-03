# Extension Auto Candidate Tracking

This document records the stable behavior for the browser extension's auto candidate video info tracking flow.

## Scope

Applies to `video-info-extension/` popup, content script hover tracking, and background extension state.

## Product Rules

### Two distinct states

- `Hover Preview`
  - represents the video card currently under the pointer
  - updates when the user hovers a different card-like video item
  - is only for preview UI
  - is rendered on the current webpage as a small overlay, not in the popup
  - must not directly become the bookmark payload for the current page
- `Page-bound Candidate`
  - represents the candidate video info bound to the current detail page
  - is created from a dedicated snapshot captured at navigation time from the clicked object
  - is then matched and bound when the destination page is entered
  - must remain stable for that page until the user clears it or switches to page parsing
  - must not be replaced by later hover activity on the same detail page

### Auto-track toggle

- The feature is user opt-in.
- The toggle label is `自动追踪候选视频信息` with English helper text `Auto track candidate video info`.
- When the toggle is off, the extension keeps the legacy behavior:
  - no hover candidate collection
  - popup defaults to parsing the current page

### Hover preview collection

- Hover preview collection happens only from the user's currently hovered card-like element.
- The extension keeps only one hover preview at a time.
- Hovering a new card replaces the old hover preview.
- The hover preview payload is limited to:
  - title
  - detail page URL
  - thumbnail URL
  - duration
- The extension does not keep hover history.
- A navigation click from a candidate card should refresh the hover preview immediately before page navigation when possible.

### Storage and privacy

- The auto-track toggle is stored in extension local storage.
- The current hover preview is stored in extension session storage so it survives popup closes and page changes within the current browser session.
- Page-bound candidate context is also stored in extension session storage and keyed by current page match information.
- Candidate collection is local-only and must not be uploaded anywhere.
- Turning the toggle off clears the current hover preview and all page-bound candidate contexts.
- `清除当前页候选绑定` clears only the current page-bound candidate, not the hover preview itself.

### Popup source selection

- The popup always works from one editable current video info object.
- Saving must use the current editable UI values, not re-run source competition at save time.
- Source preference is:
  1. current manual edits in the popup
  2. current page-bound candidate when auto-track is enabled and that page is still using candidate mode
  3. explicit `从本页面解析` result for the current page
  4. legacy page parse when auto-track is off

### Matching rules

- Page-bound candidate matching uses the hover preview's detail page URL against the current page URL.
- Matching is strict first (`origin + pathname + search`, ignoring hash).
- A loose fallback (`origin + pathname`) is allowed to tolerate common tracking/hash differences.
- Matching binds only the current page context. Later hover preview updates must not implicitly rebind an already resolved page context.

### Required popup actions

- `收藏`
  - saves the current UI values through Native Messaging
- `从本页面解析`
  - re-runs the current-page extraction flow
  - replaces the editable UI content with the new parsed result
- `清除当前页候选绑定`
  - removes the current page-bound candidate for the current page
  - keeps hover preview separate
  - does not allow later hover updates on the same detail page to silently take over the current page bookmark payload
