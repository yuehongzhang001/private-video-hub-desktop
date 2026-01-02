import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist', // 构建输出目录
    emptyOutDir: true, // 构建前清空目录
  },
  server: {
    port: 5173,
    open: true
  },
  // 为 Electron 预加载脚本添加配置
  define: {
    global: 'globalThis',
  }
});
