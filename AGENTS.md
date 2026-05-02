# Agent Guidelines

## Project Overview

Private Video Hub Desktop is a React + TypeScript + Vite + Electron desktop app for browsing, managing, and playing a private local video library. The repository also includes native integration for MPV playback and Chrome/Edge native messaging support for the browser extension workflow.

## Project Map

- `components/`: renderer UI components.
- `services/`: renderer-side application services and business logic helpers.
- `electron/`: Electron main-process code and desktop integration.
- `native/`: native messaging host files and native MPV addon sources.
- `video-info-extension/`: browser extension related code/assets.
- `scripts/`: project scripts and build helpers.

## How To Work In This Repository

- Understand the affected runtime before editing: renderer UI, Electron main process, native integration, or extension bridge.
- Prefer minimal, targeted changes and preserve existing behavior unless the task requires a behavior change.
- Do not change business semantics just to make builds pass.
- When changing shared contracts between renderer, Electron, native messaging, or extension code, verify all touched sides still agree.
- When behavior changes, update validation steps and project documents together.

## Documents Policy

`documents/` is the on-demand project knowledge base.

Read `documents/` only when the current task touches:

- documented feature behavior or business rules
- renderer/Electron/native/extension integration contracts
- packaging, release, or environment constraints
- testing or validation workflow conventions
- long-term limitations or design decisions
- a rule you suspect has already been documented
- a task that explicitly asks for document review or updates

Reading rules:

- Start from `documents/README.md`.
- Use the index to choose relevant files.
- Open only the documents needed for the current task.
- Do not read the whole `documents/` directory by default.

## Documentation Update Rules

Update `documents/` when a change introduces or changes:

- feature behavior or user-visible constraints
- renderer/Electron/native messaging contracts
- packaging, release, or environment requirements
- native addon or MPV integration expectations
- testing strategy or validation workflow
- project conventions likely to affect future AI or developer work

Documentation principles:

- Prefer updating an existing document over creating a duplicate.
- Record stable conclusions, not task history.
- Avoid temporary debugging notes and low-level code walkthroughs.

## Testing And Validation

- Install dependencies: `npm install`
- Renderer development: `npm run dev`
- Electron development: `npm run electron:dev`
- Production web build: `npm run build`
- Desktop package build: `npm run package`
- Native MPV addon rebuild when relevant: `npm run mpv:build`

No dedicated automated test script is currently defined in `package.json`; use the smallest relevant build or runtime validation for the area you changed.

## Safety Rules

- Do not commit secrets, tokens, machine-specific registry values, or real user private data.
- Do not weaken desktop security boundaries, native messaging checks, or local file access controls just to make development easier.
- Keep native, Electron, and extension integration changes explicit and reviewable.
