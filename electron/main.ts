import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawn } from 'child_process';
import * as fs from 'fs';
import { createThumbnail } from './ffmpeg.js';

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

const toLogString = (value: unknown) => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatLogLine = (level: LogLevel, message: string, extra?: string) => {
  const ts = new Date().toISOString();
  const tail = extra ? ` ${extra}` : '';
  return `[${ts}] [${level}] ${message}${tail}\n`;
};

const appendLogLine = async (filePath: string, level: LogLevel, message: string, extra?: string) => {
  try {
    await fs.promises.appendFile(filePath, formatLogLine(level, message, extra), 'utf8');
  } catch {
    // ignore log write errors
  }
};

let rendererLogPath: string | null = null;
let mirrorRendererToConsole = false;

const attachMainLogFile = (logPath: string) => {
  (['log', 'info', 'warn', 'error', 'debug'] as LogLevel[]).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const message = args.map(toLogString).join(' ');
      void appendLogLine(logPath, level, message);
    };
  });
};

const attachRendererLogFile = (target: Electron.WebContents, logPath: string, mirrorToConsole: boolean) => {
  target.on('console-message', (_event, level, message, line, sourceId) => {
    const levelMap: Record<number, LogLevel> = {
      0: 'log',
      1: 'warn',
      2: 'error',
      3: 'debug',
      4: 'info'
    };
    const mapped = levelMap[level] || 'log';
    const source = sourceId ? `${sourceId}:${line}` : `line:${line}`;
    void appendLogLine(logPath, mapped, message, source);
    if (mirrorToConsole) {
      console[mapped](`[renderer] ${message} (${source})`);
    }
  });
};

// 仅在开发环境中使用 electron-devtools-installer
if (process.env.NODE_ENV === 'development') {
  import('electron-devtools-installer').then((devTools: any) => {
    devTools.default(devTools.REACT_DEVELOPER_TOOLS)
      .then((name: string) => console.log(`Added Extension: ${name}`))
      .catch((err: any) => console.log('An error occurred: ', err));
  });
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // 获取当前文件的目录路径
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const preloadPath = path.join(__dirname, 'preload.cjs');
  console.log('[preload] path:', preloadPath, 'exists:', fs.existsSync(preloadPath));
  
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      nodeIntegration: false, // 修复1: 应该设置为 false
      contextIsolation: true,
      sandbox: false,
      preload: preloadPath,
    },
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    show: false,
  };

  mainWindow = new BrowserWindow(windowOptions);
  mainWindow.setMenuBarVisibility(false);

  // 开发环境使用 Vite 服务器，生产环境使用打包后的文件
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // 窗口关闭事件
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 窗口准备显示时触发
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.executeJavaScript('window.electronAPI ? "yes" : "no"')
      .then(result => console.log('[preload] electronAPI:', result))
      .catch(err => console.error('[preload] check failed:', err));
  });

  if (rendererLogPath) {
    attachRendererLogFile(mainWindow.webContents, rendererLogPath, mirrorRendererToConsole);
  }

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  return mainWindow;
}

// 应用准备就绪后创建窗口
app.whenReady().then(() => {
  const logDir = path.join(app.getPath('userData'), 'logs');
  const mainLogPath = path.join(logDir, 'main.log');
  rendererLogPath = path.join(logDir, 'renderer.log');
  mirrorRendererToConsole = /^(1|true|yes)$/i.test(process.env.RENDERER_LOG_TO_CONSOLE || '');
  fs.promises
    .mkdir(logDir, { recursive: true })
    .then(() => {
      attachMainLogFile(mainLogPath);
      console.log('[log] main:', mainLogPath);
      console.log('[log] renderer:', rendererLogPath);
      if (mirrorRendererToConsole) {
        console.log('[log] renderer mirror: enabled');
      }
    })
    .catch(() => {
      // ignore
    });

  createWindow();

  // 移除默认菜单栏
  Menu.setApplicationMenu(null);

  // macOS 特殊处理
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 创建菜单栏
function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const }, // 修复2: 添加 as const
              { role: 'services' as const },
              { type: 'separator' as const }, // 修复3: 添加 as const
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const }, // 修复4: 添加 as const
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [process.platform === 'darwin' ? { role: 'close' as const } : { role: 'quit' as const }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const }, // 修复5: 添加 as const
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' as const }, // 修复6: 添加 as const
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { type: 'separator' as const }, // 修复7: 添加 as const
              { role: 'selectAll' as const },
              { type: 'separator' as const }, // 修复8: 添加 as const
              {
                label: 'Speech',
                submenu: [
                  { role: 'startSpeaking' as const }, 
                  { role: 'stopSpeaking' as const }
                ],
              },
            ]
          : [
              { role: 'delete' as const }, 
              { type: 'separator' as const }, // 修复9: 添加 as const
              { role: 'selectAll' as const }
            ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const }, // 修复10: 添加 as const
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const }, // 修复11: 添加 as const
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' as const }, // 修复12: 添加 as const
              { role: 'front' as const },
              { type: 'separator' as const }, // 修复13: 添加 as const
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help' as const,
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/electron/electron-quick-start-typescript');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC 通信示例
ipcMain.handle('dialog:openDirectory', async () => {
  console.log('[dialog] openDirectory');
  if (mainWindow) {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'multiSelections']
    });
    
    if (result.canceled) {
      console.log('[dialog] canceled');
      return null;
    }
    console.log('[dialog] selected:', result.filePaths);
    return result.filePaths;
  }
  console.log('[dialog] no mainWindow');
  return null;
});

ipcMain.handle('dialog:openDirectoryFiles', async (_event, extensions: string[]) => {
  console.log('[dialog] openDirectoryFiles');
  if (!mainWindow) {
    console.log('[dialog] no mainWindow');
    return null;
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections']
  });

  if (result.canceled) {
    console.log('[dialog] canceled');
    return null;
  }

  const allowed = new Set((extensions || []).map((ext) => ext.toLowerCase()));
  const files: Array<{
    path: string;
    url: string;
    name: string;
    size: number;
    lastModified: number;
  }> = [];

  const walk = async (dir: string) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (allowed.size === 0 || allowed.has(ext)) {
          const stat = await fs.promises.stat(fullPath);
          files.push({
            path: fullPath,
            url: pathToFileURL(fullPath).toString(),
            name: entry.name,
            size: stat.size,
            lastModified: stat.mtimeMs
          });
        }
      }
    }
  };

  for (const dir of result.filePaths) {
    await walk(dir);
  }

  console.log('[dialog] files:', files.length);
  return files;
});

ipcMain.handle('file:trash', async (_event, filePath: string) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: 'missing_path' };
  }

  const resolvedPath = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  try {
    await fs.promises.stat(resolvedPath);
    await shell.trashItem(resolvedPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('ffmpeg:thumbnail', async (_event, options: { inputPath: string; outputPath?: string; width?: number; height?: number; quality?: number }) => {
  return await createThumbnail(options);
});

ipcMain.handle('mpv:play', async (_event, filePath: string) => {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: 'missing_path' };
  }

  const resolvedPath = filePath.startsWith('file://') ? fileURLToPath(filePath) : filePath;
  const mpvBinary = process.env.MPV_PATH || 'mpv';

  return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    try {
      const child = spawn(mpvBinary, [resolvedPath], { detached: true, stdio: 'ignore' });
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
      child.on('spawn', () => {
        child.unref();
        resolve({ ok: true });
      });
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
});

ipcMain.on('preload:ready', (_event, info) => {
  console.log('[preload] ready:', info);
});

ipcMain.on('preload:error', (_event, info) => {
  console.error('[preload] error:', info);
});

ipcMain.on('preload:begin', (_event, info) => {
  console.log('[preload] begin:', info);
});
