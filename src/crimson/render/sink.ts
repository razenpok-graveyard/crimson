// Port of crimson/render/sink.py

import type { RenderPresent } from '@grim/render-pipeline.ts';
import { mkdirSync } from 'node:fs';
export { type RenderPresent, type RenderSink, WindowSink } from '@grim/render-pipeline.ts';

function _pathIsAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function _dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) {
    return '.';
  }
  if (idx === 0) {
    return '/';
  }
  return path.slice(0, idx);
}

function _mkdirParents(path: string): void {
  mkdirSync(path, { recursive: true });
}

// Headless sink used for determinism-only verification paths.
export class NullSink {

  open(): void {
  }

  present(): void {
  }

  flush(): void {
  }

  close(): void {
  }
}

// Video-export sink. Fail-fast by policy: presentation errors abort rendering.
export class VideoSink {
  outputPath: string;
  protected _openTransport: (() => void) | null;
  protected _presentFrame: RenderPresent | null;
  protected _flushTransport: (() => void) | null;
  protected _closeTransport: (() => void) | null;
  protected _opened: boolean;
  protected _flushed: boolean;

  get openTransport(): (() => void) | null {
    return this._openTransport;
  }
  get presentFrame(): RenderPresent | null {
    return this._presentFrame;
  }
  get flushTransport(): (() => void) | null {
    return this._flushTransport;
  }
  get closeTransport(): (() => void) | null {
    return this._closeTransport;
  }
  get opened(): boolean {
    return this._opened;
  }
  get flushed(): boolean {
    return this._flushed;
  }

  constructor(opts: { outputPath: string; openTransport?: (() => void) | null; presentFrame?: RenderPresent | null; flushTransport?: (() => void) | null; closeTransport?: (() => void) | null }) {
    const outputPath = opts.outputPath;
    const openTransport = opts.openTransport ?? null;
    const presentFrame = opts.presentFrame ?? null;
    const flushTransport = opts.flushTransport ?? null;
    const closeTransport = opts.closeTransport ?? null;
    this.outputPath = outputPath;
    this._openTransport = openTransport;
    this._presentFrame = presentFrame;
    this._flushTransport = flushTransport;
    this._closeTransport = closeTransport;
    this._opened = false;
    this._flushed = false;
  }

  open(): void {
    _mkdirParents(_dirname(String(this.outputPath)));
    if (this._openTransport !== null) {
      this._openTransport();
    }
    this._opened = true;
    this._flushed = false;
  }

  present(): void {
    if (this._presentFrame !== null) {
      this._presentFrame();
    }
  }

  flush(): void {
    if (!this._opened || this._flushed) {
      return;
    }
    if (this._flushTransport !== null) {
      this._flushTransport();
    }
    this._flushed = true;
  }

  close(): void {
    if (!this._opened) {
      return;
    }
    if (this._closeTransport !== null) {
      this._closeTransport();
    }
    this._opened = false;
  }
}
