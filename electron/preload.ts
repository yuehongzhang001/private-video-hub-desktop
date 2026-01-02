import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  playWithMpv: (filePath: string) => ipcRenderer.invoke('mpv:play', filePath),
  // 可以在这里添加更多的 API
});
