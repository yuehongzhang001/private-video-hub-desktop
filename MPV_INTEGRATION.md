# libmpv Integration Notes / libmpv 集成说明

This document summarizes how libmpv is integrated for playback inside the app.
本文总结应用内使用 libmpv 播放的技术实现与要点。

## Architecture Overview / 架构概览

### English

- Native addon (Node-API) in `native/mpv/src/addon.cc`
  - Loads libmpv dynamically (no static linking).
  - Creates an mpv handle and a software render context (RGBA frames).
  - Exposes JS APIs: `init`, `createPlayer`, `loadFile`, `command`,
    `getProperty`, `renderFrame`, `stop`, `destroy`.
- Preload bridge in `electron/preload.cts`
  - Loads the addon (`mpvaddon.node`) and exposes a safe `electronAPI` surface.
  - Resolves libmpv location from:
    - `LIBMPV_PATH`
    - `libmpv/win/libmpv-2.dll` or `libmpv/win/mpv-2.dll`
    - `libmpv/mac/libmpv.2.dylib` or `libmpv/mac/libmpv.dylib`
    - packaged resources (`process.resourcesPath`).
- Renderer playback in `components/VideoPlayer.tsx`
  - Uses `<canvas>` when mpv is available.
  - Calls `mpvRenderFrame(width, height)` on each animation frame.
  - Controls mpv via `mpvCommand` (play/pause, seek, volume).
  - Reads time/metadata via `mpvGetProperty`.

### 中文

- 原生插件（Node-API）：`native/mpv/src/addon.cc`
  - 动态加载 libmpv（非静态链接）。
  - 创建 mpv 实例和软件渲染上下文（RGBA 帧）。
  - 暴露 JS API：`init`、`createPlayer`、`loadFile`、`command`、
    `getProperty`、`renderFrame`、`stop`、`destroy`。
- 预加载桥接：`electron/preload.cts`
  - 加载插件（`mpvaddon.node`），并以 `electronAPI` 安全暴露给渲染进程。
  - libmpv 路径解析顺序：
    - `LIBMPV_PATH`
    - `libmpv/win/libmpv-2.dll` 或 `libmpv/win/mpv-2.dll`
    - `libmpv/mac/libmpv.2.dylib` 或 `libmpv/mac/libmpv.dylib`
    - 打包资源路径（`process.resourcesPath`）
- 渲染层播放：`components/VideoPlayer.tsx`
  - mpv 可用时使用 `<canvas>`。
  - 每帧调用 `mpvRenderFrame(width, height)` 获取 RGBA。
  - 通过 `mpvCommand` 控制播放（播放/暂停/快进/音量）。
  - 通过 `mpvGetProperty` 读取时间/元数据。

## Build and Runtime / 构建与运行

### English

1. Install deps:
   - `npm install`
2. Build addon:
   - `npm run mpv:build`
3. Rebuild for Electron ABI:
   - `npm run mpv:rebuild`
4. Run:
   - `npm run electron:dev`

### 中文

1. 安装依赖：
   - `npm install`
2. 构建原生插件：
   - `npm run mpv:build`
3. 按 Electron ABI 重新编译：
   - `npm run mpv:rebuild`
4. 运行：
   - `npm run electron:dev`

## Required Files / 依赖文件

### English

- Headers (shared across Windows/macOS):
  - `native/mpv/include/mpv/client.h`
  - `native/mpv/include/mpv/render.h`
- Windows runtime:
  - `libmpv/win/libmpv-2.dll` (or `mpv-2.dll`)
- macOS runtime:
  - `libmpv/mac/libmpv.2.dylib` (or `libmpv.dylib`)

### 中文

- 头文件（Windows/macOS 通用）：
  - `native/mpv/include/mpv/client.h`
  - `native/mpv/include/mpv/render.h`
- Windows 运行库：
  - `libmpv/win/libmpv-2.dll`（或 `mpv-2.dll`）
- macOS 运行库：
  - `libmpv/mac/libmpv.2.dylib`（或 `libmpv.dylib`）

## Electron Builder Packaging / 打包配置

### English

Configured in `package.json`:

- Windows: copy `libmpv/win/*` to `resources/libmpv/`
- macOS: copy `libmpv/mac/*` to `Contents/Frameworks/`
- Also package addon:
  - `native/mpv/build/Release/mpvaddon.node` -> `resources/mpv/mpvaddon.node`

### 中文

在 `package.json` 中配置：

- Windows：复制 `libmpv/win/*` 到 `resources/libmpv/`
- macOS：复制 `libmpv/mac/*` 到 `Contents/Frameworks/`
- 同时打包插件：
  - `native/mpv/build/Release/mpvaddon.node` -> `resources/mpv/mpvaddon.node`

## Playback Flow / 播放流程

### English

1. Preload initializes:
   - `mpvInit()` loads libmpv and creates the mpv instance.
2. When a video is selected:
   - `mpvLoad(filePath)` loads the file.
3. Render loop:
   - `mpvRenderFrame(width, height)` returns RGBA buffer.
   - Renderer draws it to `<canvas>` each animation frame.
4. Controls:
   - Play/pause: `mpvCommand(['cycle','pause'])`
   - Seek: `mpvCommand(['set','time-pos', seconds])`
   - Volume: `mpvCommand(['set','volume', percent])`

### 中文

1. 预加载初始化：
   - `mpvInit()` 加载 libmpv 并创建实例
2. 选择视频：
   - `mpvLoad(filePath)` 加载文件
3. 渲染循环：
   - `mpvRenderFrame(width, height)` 返回 RGBA 帧
   - 渲染层把帧绘制到 `<canvas>`
4. 控制：
   - 播放/暂停：`mpvCommand(['cycle','pause'])`
   - 跳转：`mpvCommand(['set','time-pos', seconds])`
   - 音量：`mpvCommand(['set','volume', percent])`

## Audio / 音频

### English

Audio output is configured in the addon:

- `audio=yes`
- `audio-device=auto`
- `audio-exclusive=no`
- Output backend:
  - Windows: `ao=wasapi`
  - macOS: `ao=coreaudio`
  - Other: `ao=auto`

### 中文

音频输出在插件侧配置：

- `audio=yes`
- `audio-device=auto`
- `audio-exclusive=no`
- 输出后端：
  - Windows：`ao=wasapi`
  - macOS：`ao=coreaudio`
  - 其他：`ao=auto`

## Debugging / 调试

### English

- Main process logs preload status:
  - `[preload] begin / ready / error`
- Player overlay shows:
  - `mpvStatus`, `mpvError`, `mpvVol`, `mpvMute`

If `electronAPI` is missing:
- Ensure `electron/preload.cjs` exists
- `electron/main.ts` points to `preload.cjs`
- Rebuild TypeScript output (`npm run electron:dev`)

### 中文

- 主进程日志：
  - `[preload] begin / ready / error`
- 播放器调试面板：
  - `mpvStatus`、`mpvError`、`mpvVol`、`mpvMute`

如果 `electronAPI` 不存在：
- 确认 `electron/preload.cjs` 已生成
- `electron/main.ts` 指向 `preload.cjs`
- 重新编译 TypeScript（`npm run electron:dev`）

## Notes / Limitations / 备注与限制

### English

- Rendering uses software frames (RGBA) via libmpv SW render API.
- Performance depends on resolution; consider throttling if needed.
- Thumbnail generation still uses HTML5 `<video>` (libmpv thumbnails removed).

### 中文

- 目前使用软件渲染（RGBA）从 libmpv 取帧。
- 性能取决于分辨率，必要时可做帧率限制。
- 缩略图仍使用 HTML5 `<video>`（libmpv 缩略图已移除）。
