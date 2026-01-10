# Private Video Hub Desktop

A desktop application for managing and playing your private video collection, built with React, TypeScript, Vite, and Electron.

## Features

- Browse and play your local video files
- Generate thumbnails for your videos
- Sort and search your video library
- Multi-language support (English and Chinese)
- Cross-platform desktop application (Windows, macOS, Linux)

## Development

### Prerequisites

- Node.js (v18 or higher)
- npm

### Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd private-video-hub-desktop
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running in Development

To run the application in development mode:

```bash
npm run dev
```

To run the Electron application in development mode:

```bash
npm run electron:dev
```

### Native Messaging (Chrome Extension)

To allow the browser extension to send data to the desktop app via Native Messaging, register the native host manifest.

1. Copy and edit `native/native-messaging-host.json`:
   - `allowed_origins` must match your extension ID from `chrome://extensions/`
2. The manifest uses a wrapper script to start Node:
   - `native/native-messaging-host.cmd` launches `native/native-messaging-host.cjs`
3. Register the manifest (Windows, Chrome stable):

```powershell
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.private_video_hub.desktop" `
  /ve /t REG_SZ /d "D:\git\Private-video-hub-desktop\native\native-messaging-host.json" /f
```

Notes:
- If you use a different Chrome channel, replace `Google\Chrome` with `Google\Chrome Beta/Dev/Canary`.
- If you use Edge, replace it with `Microsoft\Edge`.
- Restart Chrome after changes.

### Building

To build the web version:

```bash
npm run build
```

To build the Electron desktop application:

```bash
npm run package
```

This will create distributable files in the `release` directory for your current platform.

## Logging (Release)

Logs are written to:
- Main process: `C:\Users\<you>\AppData\Roaming\Private Video Hub\logs\main.log`
- Renderer process: `C:\Users\<you>\AppData\Roaming\Private Video Hub\logs\renderer.log`

To mirror renderer logs to the command line (PowerShell):

```powershell
$env:RENDERER_LOG_TO_CONSOLE="1"
.\'Private Video Hub.exe'
```

## Architecture

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Build Tool**: Vite
- **Desktop Wrapper**: Electron
- **Packaging**: electron-builder

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit your changes (`git commit -m 'Add some amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

# How to run chrome extension in dev mode:

add this to registry
```shell
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.private_video_hub.desktop" /ve /t REG_SZ /d "D:\git\Private-video-hub-desktop\native\native-messaging-host.json" /f

```