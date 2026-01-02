import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

async function buildElectronApp() {
  try {
    // 首先确保 dist 目录存在
    if (!fs.existsSync('dist')) {
      fs.mkdirSync('dist', { recursive: true });
    }

    // 编译 Electron 主进程文件
    await execAsync('npx tsc electron/main.ts --outDir electron --module commonjs --target es2021 --esModuleInterop --skipLibCheck');
    console.log('✅ Electron main process compiled');

    // 编译预加载脚本
    await execAsync('npx tsc electron/preload.ts --outDir electron --module commonjs --target es2021 --esModuleInterop --skipLibCheck');
    console.log('✅ Electron preload script compiled');
    
    // 重命名预加载脚本为 .js 扩展名
    if (fs.existsSync('electron/preload.js')) {
      fs.renameSync('electron/preload.js', 'electron/preload.js');
    }
    
    console.log('✅ Electron app build completed');
  } catch (error) {
    console.error('❌ Error building Electron app:', error.message);
    process.exit(1);
  }
}

buildElectronApp();