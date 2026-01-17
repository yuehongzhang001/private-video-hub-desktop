
export interface VideoItem {
  id: string;
  file?: File;
  path?: string;
  url: string;
  name: string;
  size: number;
  lastModified: number;
  thumbnail?: string;
  duration?: number;
  clickCount?: number;
  isProcessing?: boolean;
}

export enum SortMode {
  AFTER_CURRENT = 'next',
  NEWEST = 'newest',
  SIZE = 'size',
  CLICKS = 'clicks',
  RANDOM = 'random'
}

export type DisplaySize = 'small' | 'medium' | 'large';

export interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
}
