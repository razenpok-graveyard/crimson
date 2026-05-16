// Port of crimson/replay/driver/render_telemetry.py

import { rl } from '@grim/raylib-api.ts';
import * as profileHooks from '@crimson/render/world/profile-hooks.ts';

export class RenderTelemetryFrameSnapshot {
  readonly frameIndex: number;
  readonly tickIndexBeforeUpdate: number;
  readonly tickIndexAfterUpdate: number;
  readonly updateMs: number;
  readonly drawMs: number;
  readonly frameMs: number;
  readonly drawCallsTotal: number;
  readonly drawCallsByApi: Map<string, number>;
  readonly drawCallsByPass: Map<string, number>;
  readonly passMs: Map<string, number>;

  constructor(opts: {
    frameIndex: number;
    tickIndexBeforeUpdate: number;
    tickIndexAfterUpdate: number;
    updateMs: number;
    drawMs: number;
    frameMs: number;
    drawCallsTotal: number;
    drawCallsByApi: Map<string, number>;
    drawCallsByPass: Map<string, number>;
    passMs: Map<string, number>;
  }) {
    this.frameIndex = opts.frameIndex;
    this.tickIndexBeforeUpdate = opts.tickIndexBeforeUpdate;
    this.tickIndexAfterUpdate = opts.tickIndexAfterUpdate;
    this.updateMs = opts.updateMs;
    this.drawMs = opts.drawMs;
    this.frameMs = opts.frameMs;
    this.drawCallsTotal = opts.drawCallsTotal;
    this.drawCallsByApi = opts.drawCallsByApi;
    this.drawCallsByPass = opts.drawCallsByPass;
    this.passMs = opts.passMs;
  }
}

export class SessionSink {
  private readonly _session: RenderTelemetrySession;

  constructor(session: RenderTelemetrySession) {
    this._session = session;
  }

  onPassDuration(passName: string, durationMs: number): void {
    this._session.recordPassDuration(passName, durationMs);
  }
}

export class RenderTelemetrySession {
  private readonly __INTERCEPT_APIS: readonly [string, string][] = [
    ['draw_texture_pro', 'draw_texture_pro'],
    ['draw_circle', 'draw_circle'],
    ['draw_circle_lines', 'draw_circle_lines'],
    ['draw_circle_sector', 'draw_circle_sector'],
    ['draw_ring', 'draw_ring'],
    ['draw_rectangle', 'draw_rectangle'],
    ['draw_rectangle_lines', 'draw_rectangle_lines'],
    ['draw_text', 'draw_text'],
    ['rl_begin', 'rl_begin'],
    ['begin_blend_mode', 'begin_blend_mode'],
    ['end_blend_mode', 'end_blend_mode'],
  ];
  private _active: boolean;
  private readonly _originals: Map<string, (...args: any[]) => unknown>;
  private readonly _frames: RenderTelemetryFrameSnapshot[];
  private _currentFrameIndex: number | null;
  private _currentTickBeforeUpdate: number | null;
  private _drawCallsTotal: number;
  private readonly _drawCallsByApi: Map<string, number>;
  private readonly _drawCallsByPass: Map<string, number>;
  private readonly _passMs: Map<string, number>;
  private readonly _sink: SessionSink;
  private _prevSink: profileHooks.RenderProfileSink | null;

  constructor() {
    this._active = false;
    this._originals = new Map();
    this._frames = [];
    this._currentFrameIndex = null;
    this._currentTickBeforeUpdate = null;
    this._drawCallsTotal = 0;
    this._drawCallsByApi = new Map();
    this._drawCallsByPass = new Map();
    this._passMs = new Map();
    this._sink = new SessionSink(this);
    this._prevSink = null;
  }

  get frames(): readonly RenderTelemetryFrameSnapshot[] {
    return Array.from(this._frames);
  }

  start(): void {
    if (this._active) {
      return;
    }


    this._active = true;
    profileHooks.clearPassStack();
    this._prevSink = profileHooks.setActiveSink(this._sink);
    for (let [fnName, apiName] of this.__INTERCEPT_APIS) {
      const original = Reflect.get((rl) as object, fnName) ?? null;
      if (original === null || !(typeof original === 'function')) {
        continue;
      }
      this._originals.set(fnName, original);

      const _wrapped = (...args: any[]): unknown => {
        const _orig: (...args: any[]) => unknown = original;
        const _apiName: string = apiName;
        const kwargs: Record<string, any> = {};
        this.recordDrawCall(_apiName);
        return _orig(...args, ...Object.values(kwargs));
      };

      Reflect.set(rl, fnName, _wrapped);
    }
  }

  stop(): void {
    if (!this._active) {
      return;
    }


    this._active = false;
    for (let [fnName, original] of this._originals.entries()) {
      Reflect.set(rl, fnName, original);
    }
    this._originals.clear();
    profileHooks.clearPassStack();
    profileHooks.setActiveSink(this._prevSink);
    this._prevSink = null;
  }

  __enter__(): RenderTelemetrySession {
    this.start();
    return this;
  }

  __exit__(excType: unknown, exc: unknown, tb: unknown): void {
    this.stop();
  }

  beginFrame(opts: { frameIndex: number; tickIndexBeforeUpdate: number }): void {
    const frameIndex = opts.frameIndex;
    const tickIndexBeforeUpdate = opts.tickIndexBeforeUpdate;
    if (!this._active) {
      return;
    }
    this._currentFrameIndex = int(frameIndex);
    this._currentTickBeforeUpdate = int(tickIndexBeforeUpdate);
    this._drawCallsTotal = 0;
    this._drawCallsByApi.clear();
    this._drawCallsByPass.clear();
    this._passMs.clear();
  }

  endFrame(opts: { tickIndexAfterUpdate: number; updateMs: number; drawMs: number; frameMs: number }): void {
    const tickIndexAfterUpdate = opts.tickIndexAfterUpdate;
    const updateMs = opts.updateMs;
    const drawMs = opts.drawMs;
    const frameMs = opts.frameMs;
    if (this._currentFrameIndex === null || this._currentTickBeforeUpdate === null) {
      return;
    }
    const snapshot = new RenderTelemetryFrameSnapshot({ frameIndex: int(this._currentFrameIndex), tickIndexBeforeUpdate: int(this._currentTickBeforeUpdate), tickIndexAfterUpdate: int(tickIndexAfterUpdate), updateMs, drawMs, frameMs, drawCallsTotal: int(this._drawCallsTotal), drawCallsByApi: new Map(Array.from(Array.from(this._drawCallsByApi.entries()).sort((left, right) => left < right ? -1 : left > right ? 1 : 0), ([key, value]) => [String(key), int(value)] as const)), drawCallsByPass: new Map(Array.from(Array.from(this._drawCallsByPass.entries()).sort((left, right) => left < right ? -1 : left > right ? 1 : 0), ([key, value]) => [String(key), int(value)] as const)), passMs: new Map(Array.from(Array.from(this._passMs.entries()).sort((left, right) => left < right ? -1 : left > right ? 1 : 0), ([key, value]) => [String(key), value] as const)) });
    this._frames.push(snapshot);
    this._currentFrameIndex = null;
    this._currentTickBeforeUpdate = null;
  }

  recordDrawCall(apiName: string): void {
    if (this._currentFrameIndex === null) {
      return;
    }
    const api = apiName;
    this._drawCallsTotal += 1;
    this._drawCallsByApi.set(api, (this._drawCallsByApi.get(api) ?? 0) + 1);
    const passName = profileHooks.currentPassName() || '_unscoped';
    this._drawCallsByPass.set(String(passName), (this._drawCallsByPass.get(String(passName)) ?? 0) + 1);
  }

  recordPassDuration(passName: string, durationMs: number): void {
    if (this._currentFrameIndex === null) {
      return;
    }
    this._passMs.set(passName, (this._passMs.get(passName) ?? 0) + durationMs);
  }
}
