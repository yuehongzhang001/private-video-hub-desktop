import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { app } from 'electron';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

export type ThumbnailOptions = {
  inputPath: string;
  outputPath?: string;
  width?: number;
  height?: number;
  quality?: number;
};

export type ThumbnailResult = {
  ok: boolean;
  error?: string;
  outputPath?: string;
  dataUrl?: string;
  duration?: number;
};

const nodeRequire = createRequire(import.meta.url);

const resolveFfmpegPath = () => {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return nodeRequire('ffmpeg-static') as string;
  } catch {
    return null;
  }
};


const getDefaultOutputPath = (inputPath: string) => {
  const hash = createHash('sha1').update(inputPath).digest('hex').slice(0, 16);
  return path.join(app.getPath('temp'), 'vhub-thumbs', `${hash}.jpg`);
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
};

export const createThumbnail = async (options: ThumbnailOptions): Promise<ThumbnailResult> => {
  const { inputPath, outputPath, width, height, quality } = options;

  if (!inputPath) {
    return { ok: false, error: 'missing_path' };
  }

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg_missing' };
  }

  const finalOutputPath = outputPath || getDefaultOutputPath(inputPath);

  try {
    await ensureDir(finalOutputPath);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const filters: string[] = ['select=eq(n\\,0)'];
  if (width || height) {
    const w = width ?? -1;
    const h = height ?? -1;
    filters.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease`);
  }

  const args = [
    '-hide_banner',
    '-i', inputPath,
    '-frames:v', '1',
    '-vsync', '0',
    '-vf', filters.join(','),
    '-q:v', String(quality ?? 2),
    '-y',
    finalOutputPath
  ];

  return await new Promise<ThumbnailResult>((resolve) => {
    try {
      const child = spawn(ffmpegPath, args, { windowsHide: true });
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
      child.on('close', async (code) => {
        const duration = parseDuration(stderr);
        if (code !== 0) {
          resolve({ ok: false, error: stderr.trim() || `ffmpeg_exit_${code}` });
          return;
        }

        try {
          const buffer = await fs.promises.readFile(finalOutputPath);
          const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
          resolve({ ok: true, outputPath: finalOutputPath, dataUrl, duration });
        } catch (err) {
          resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      });
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
};

const parseDuration = (output: string) => {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!isFinite(hours) || !isFinite(minutes) || !isFinite(seconds)) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
};
