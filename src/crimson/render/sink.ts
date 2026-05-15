// Port of crimson/render/sink.py

import type { RenderPresent } from '@grim/render-pipeline.ts';
export { type RenderPresent, type RenderSink, WindowSink } from '@grim/render-pipeline.ts';

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
  readonly outputPath: string;
  private readonly _openTransport: (() => void) | null;
  private readonly _presentFrame: RenderPresent | null;
  private readonly _flushTransport: (() => void) | null;
  private readonly _closeTransport: (() => void) | null;
  private _opened: boolean;
  private _flushed: boolean;

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
