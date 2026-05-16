// Port of crimson/render/world/renderer.py

import type { CrimsonConfig } from '@grim/config.ts';
import { Vec2 } from '@grim/geom.ts';
import type { RenderFrame } from '@crimson/render/frame.ts';
import { buildWorldRenderCtx } from '@crimson/render/world/context.ts';
import { drawWorld } from '@crimson/render/world/draw.ts';
import * as wgl from '@wgl';
import * as viewport from '@crimson/render/world/viewport.ts';

export class WorldRenderer {
  worldSize: number;
  config: CrimsonConfig | null;
  camera: Vec2;

  constructor(opts: {
    worldSize: number;
    config: CrimsonConfig | null;
    camera: Vec2;
  }) {
    this.worldSize = opts.worldSize;
    this.config = opts.config;
    this.camera = opts.camera;
  }

  syncViewport(opts: { worldSize: number; config: CrimsonConfig | null; camera: Vec2 }): void {
    const worldSize = opts.worldSize;
    const config = opts.config;
    const camera = opts.camera;
    this.worldSize = worldSize;
    this.config = config;
    this.camera = camera;
  }

  draw(opts: { renderFrame: RenderFrame; drawAimIndicators?: boolean; entityAlpha?: number }): void {
    const renderFrame = opts.renderFrame;
    const drawAimIndicators = opts.drawAimIndicators ?? true;
    const entityAlpha = opts.entityAlpha ?? 1.0;
    this.syncViewport({
      worldSize: renderFrame.worldSize,
      config: renderFrame.config,
      camera: renderFrame.camera,
    });
    const renderCtx = buildWorldRenderCtx(this, { renderFrame: renderFrame });
    drawWorld(
      renderCtx,
      { drawAimIndicators: drawAimIndicators, entityAlpha: entityAlpha },
    );
  }

  _cameraScreenSize(opts: { runtimeW?: number | null; runtimeH?: number | null } = {}): Vec2 {
    const runtimeW = opts.runtimeW ?? null;
    const runtimeH = opts.runtimeH ?? null;
    const outW = runtimeW !== null ? runtimeW : wgl.getScreenWidth();
    const outH = runtimeH !== null ? runtimeH : wgl.getScreenHeight();
    return viewport.cameraScreenSize({ worldSize: this.worldSize, config: this.config, runtimeW: outW, runtimeH: outH });
  }

  _clampCamera(camera: Vec2, screenSize: Vec2): Vec2 {
    return viewport.clampCamera({ worldSize: this.worldSize, camera: camera, screenSize: screenSize });
  }

  _worldParams(): [Vec2, Vec2] {
    const outSize = new Vec2(wgl.getScreenWidth(), wgl.getScreenHeight());
    const [camera, viewScale, screenSize] = viewport.viewTransform({ worldSize: this.worldSize, config: this.config, camera: this.camera, outSize: outSize });
    return [camera, viewScale];
  }

  worldToScreen(pos: Vec2): Vec2 {
    const [camera, viewScale] = this._worldParams();
    return viewport.worldToScreenWith(pos, { camera: camera, viewScale: viewScale });
  }

  screenToWorld(pos: Vec2): Vec2 {
    const [camera, viewScale] = this._worldParams();
    return viewport.screenToWorldWith(pos, { camera: camera, viewScale: viewScale });
  }
}
