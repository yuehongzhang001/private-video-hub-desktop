# libmpv addon (phase 1)

This is the minimal native addon scaffold that loads libmpv dynamically and exposes
basic APIs: init/create/load/stop/destroy. Rendering into the Electron window is
not implemented yet.

## Headers

Copy mpv headers into `native/mpv/include/mpv/`:
- `client.h`
- `render.h`

From the mpv dev package on Windows, or from Homebrew paths on macOS:
- Apple Silicon: `/opt/homebrew/include/mpv/`
- Intel: `/usr/local/include/mpv/`

## Build (dev)

Prereqs:
- Windows: Visual Studio Build Tools (C++ workload)
- macOS: Xcode Command Line Tools

Commands:
- `npm install`
- `npm run mpv:build`
- `npm run mpv:rebuild` (after Electron upgrades)

## Runtime files

Provide libmpv at one of these locations:
- Windows: `libmpv/win/libmpv-2.dll` (or `mpv-2.dll`)
- macOS: `libmpv/mac/libmpv.2.dylib` (or `libmpv.dylib`)

The preload resolves those paths automatically. You can also set `LIBMPV_PATH`.
