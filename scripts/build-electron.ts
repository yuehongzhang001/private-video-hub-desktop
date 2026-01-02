import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

async function buildElectronApp() {
  try {
    // 确保 electron 目录存在
    if (!fs.existsSync('electron')) {
      fs.mkdirSync('electron', { recursive: true });
    }

    // 编译 Electron 主进程文件
    await execAsync('npx tsc electron/main.ts --outDir electron --module commonjs --target es2021 --esModuleInterop --skipLibCheck');
    console.log('✅ Electron main process compiled');

    // 编译预加载脚本
    await execAsync('npx tsc electron/preload.ts --outDir electron --module commonjs --target es2021 --esModuleInterop --skipLibCheck');
    console.log('✅ Electron preload script compiled');
    
    console.log('✅ Electron app build completed');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Error building Electron app:', errorMessage);
    process.exit(1);
  }
}

buildElectronApp();