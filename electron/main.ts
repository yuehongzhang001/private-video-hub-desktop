import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

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
  
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: {
      nodeIntegration: false, // 修复1: 应该设置为 false
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
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

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  return mainWindow;
}

// 应用准备就绪后创建窗口
app.whenReady().then(() => {
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
  if (mainWindow) {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'multiSelections']
    });
    
    if (result.canceled) {
      return null;
    }
    
    return result.filePaths;
  }
  return null;
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
