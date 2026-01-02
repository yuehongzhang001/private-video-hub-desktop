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

3. Create a `.env.local` file in the root directory and add your Gemini API key:
   ```
   GEMINI_API_KEY=your_actual_gemini_api_key_here
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

## License

[MIT](LICENSE)