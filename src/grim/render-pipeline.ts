// Port of grim/render_pipeline.py

export type RenderDraw = () => void;
export type RenderPresent = () => void;

export interface RenderSink {
  open(): void;
  present(): void;
  flush(): void;
  close(): void;
}

// Default interactive sink; present/flush delegate to the frame loop.
export class WindowSink {
  private _presentFrame: RenderPresent | null;
  private _opened: boolean;

  constructor(opts: { presentFrame?: RenderPresent | null } = {}) {
    const presentFrame = opts.presentFrame ?? null;
    this._presentFrame = presentFrame;
    this._opened = false;
  }

  open(): void {
    this._opened = true;
  }

  present(): void {
    if (this._presentFrame === null) {
      return;
    }
    this._presentFrame();
  }

  flush(): void {
  }

  close(): void {
    this._opened = false;
  }
}

// Shared draw/present orchestration for live and replay contexts.
export class RenderPipeline {
  private _sink: RenderSink;
  private _onResize: ((arg0: number, arg1: number) => void) | null;
  private _beginEndDrawing: boolean;
  private _beginDraw: (() => void) | null;
  private _endDraw: (() => void) | null;
  private _opened: boolean;
  private _width: number;
  private _height: number;

  constructor(opts: { sink: RenderSink; onResize?: ((arg0: number, arg1: number) => void) | null; beginEndDrawing?: boolean; beginDraw?: (() => void) | null; endDraw?: (() => void) | null }) {
    const sink = opts.sink;
    const onResize = opts.onResize ?? null;
    const beginEndDrawing = opts.beginEndDrawing ?? false;
    const beginDraw = opts.beginDraw ?? null;
    const endDraw = opts.endDraw ?? null;
    if (beginEndDrawing && (beginDraw === null || endDraw === null)) {
      throw new Error('begin_draw and end_draw are required when begin_end_drawing=True');
    }
    this._sink = sink;
    this._onResize = onResize;
    this._beginEndDrawing = beginEndDrawing;
    this._beginDraw = beginDraw;
    this._endDraw = endDraw;
    this._opened = false;
    this._width = -1;
    this._height = -1;
  }

  open(opts: { width: number; height: number }): void {
    const width = opts.width;
    const height = opts.height;
    if (this._opened) {
      return;
    }
    const normalizedW = Math.max(0, int(width));
    const normalizedH = Math.max(0, int(height));
    try {
      if (this._onResize !== null) {
        this._onResize(normalizedW, normalizedH);
      }
      this._sink.open();
    } catch (exc) {
      try {
        this._sink.close();
      } catch (exc) {
      }
      this._opened = false;
      this._width = -1;
      this._height = -1;
      throw exc;
    }
    this._opened = true;
    this._width = normalizedW;
    this._height = normalizedH;
  }

  _ensureOpen(opts: { width: number; height: number }): void {
    const width = opts.width;
    const height = opts.height;
    if (this._opened) {
      return;
    }
    this.open({ width: int(width), height: int(height) });
  }

  _resizeIfNeeded(opts: { width: number; height: number }): void {
    const width = opts.width;
    const height = opts.height;
    const normalizedW = Math.max(0, int(width));
    const normalizedH = Math.max(0, int(height));
    if (normalizedW === this._width && normalizedH === this._height) {
      return;
    }
    if (this._onResize !== null) {
      this._onResize(normalizedW, normalizedH);
    }
    this._width = normalizedW;
    this._height = normalizedH;
  }

  draw(opts: { drawFrame: RenderDraw; width: number; height: number }): void {
    const drawFrame = opts.drawFrame;
    const width = opts.width;
    const height = opts.height;
    this._ensureOpen({ width: int(width), height: int(height) });
    this._resizeIfNeeded({ width: int(width), height: int(height) });
    if (this._beginEndDrawing) {
      const beginDraw = this._beginDraw;
      const endDraw = this._endDraw;
      if (beginDraw === null || endDraw === null) {
        throw new Error('render pipeline missing begin/end draw callbacks');
      }
      beginDraw();
      try {
        drawFrame();
      } finally {
        endDraw();
      }
      return;
    }
    drawFrame();
  }

  present(): void {
    if (!this._opened) {
      return;
    }
    this._sink.present();
  }

  render(opts: { drawFrame: RenderDraw; width: number; height: number }): void {
    const drawFrame = opts.drawFrame;
    const width = opts.width;
    const height = opts.height;
    this.draw({ drawFrame: drawFrame, width: int(width), height: int(height) });
    this.present();
  }

  flush(): void {
    if (!this._opened) {
      return;
    }
    this._sink.flush();
  }

  close(): void {
    if (!this._opened) {
      return;
    }
    try {
      this._sink.close();
    } finally {
      this._opened = false;
      this._width = -1;
      this._height = -1;
    }
  }
}
