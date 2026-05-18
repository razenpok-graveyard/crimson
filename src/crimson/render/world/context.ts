// Port of crimson/render/world/context.py

import { TextureId } from '@grim/assets.ts';
import { Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { RAD_TO_DEG } from '@crimson/render/world/constants.ts';
import type { RenderFrame } from '@crimson/render/frame.ts';
import type { WorldRenderer } from '@crimson/render/world/renderer.ts';
import * as wgl from '@wgl';
import * as viewport from '@crimson/render/world/viewport.ts';

export function buildWorldRenderCtx(renderer: WorldRenderer, opts: { renderFrame: RenderFrame }): WorldRenderCtx {
  const renderFrame = opts.renderFrame;
  return new WorldRenderCtx({ renderer: renderer, frame: renderFrame });
}

function isBulletTrailType(typeId: number): boolean {
  return (0 <= typeId && typeId < 8) || typeId === ProjectileTemplateId.SPLITTER_GUN;
}

function bulletSpriteSize(typeId: number, opts: { scale: number }): number {
  const scale = opts.scale;
  let base = 4.0;
  if (typeId === ProjectileTemplateId.ASSAULT_RIFLE) {
    base = 6.0;
  } else if (typeId === ProjectileTemplateId.SUBMACHINE_GUN) {
    base = 8.0;
  }
  return Math.max(2.0, base * scale);
}

function drawBulletTrail(renderCtx: WorldRenderCtx, start: Vec2, end: Vec2, opts: { typeId: number; alpha: number; scale: number; angle: number }): boolean {
  const typeId = opts.typeId;
  const alpha = opts.alpha;
  const scale = opts.scale;
  const angle = opts.angle;
  const bulletTrailTexture = renderCtx.frame.resources.texture(TextureId.BULLET_TRAIL);
  if (alpha <= 0) {
    return false;
  }

  const segment = end.sub(start);
  const [direction, dist] = segment.normalizedWithLength();

  // Native uses projectile travel direction as the side-offset basis and still emits the
  // trail quad even when origin=head (degenerate impact frames).
  let sideMul: number;
  if (typeId === ProjectileTemplateId.PISTOL || typeId === ProjectileTemplateId.ASSAULT_RIFLE) {
    sideMul = 1.2;
  } else if (typeId === ProjectileTemplateId.GAUSS_GUN) {
    sideMul = 1.1;
  } else {
    sideMul = 0.7;
  }
  const half = 1.5 * sideMul * scale;

  let side: Vec2;
  if (dist > 1e-6) {
    side = direction.perpLeft();
  } else {
    side = Vec2.fromAngle(angle);
  }

  const sideOffset = side.mul(half);
  const p0 = start.sub(sideOffset);
  const p1 = start.add(sideOffset);
  const p2 = end.add(sideOffset);
  const p3 = end.sub(sideOffset);

  // Native uses additive blending for bullet trails and sets color slots per projectile type.
  // Gauss has a distinct blue tint; most other bullet trails are neutral gray.
  let headRgb: any;
  if (typeId === ProjectileTemplateId.GAUSS_GUN) {
    headRgb = [51, 128, 255]; // (0.2, 0.5, 1.0)
  } else {
    headRgb = [128, 128, 128]; // (0.5, 0.5, 0.5)
  }

  const tailRgb: [number, number, number] = [128, 128, 128];
  const head = wgl.makeColor(headRgb[0] / 255, headRgb[1] / 255, headRgb[2] / 255, alpha / 255);
  const tail = wgl.makeColor(tailRgb[0] / 255, tailRgb[1] / 255, tailRgb[2] / 255, 0 / 255);

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  wgl.beginQuads(bulletTrailTexture);
  wgl.rlColor4f(tail.r, tail.g, tail.b, tail.a);
  wgl.rlTexCoord2f(0.0, 0.0);
  wgl.rlVertex2f(p0.x, p0.y);
  wgl.rlColor4f(tail.r, tail.g, tail.b, tail.a);
  wgl.rlTexCoord2f(1.0, 0.0);
  wgl.rlVertex2f(p1.x, p1.y);
  wgl.rlColor4f(head.r, head.g, head.b, head.a);
  wgl.rlTexCoord2f(1.0, 0.5);
  wgl.rlVertex2f(p2.x, p2.y);
  wgl.rlColor4f(head.r, head.g, head.b, head.a);
  wgl.rlTexCoord2f(0.0, 0.5);
  wgl.rlVertex2f(p3.x, p3.y);
  wgl.endQuads();
  wgl.endBlendMode();
  return true;
}

export class WorldRenderCtx {
  renderer: WorldRenderer;
  frame: RenderFrame;
  projectionCamera: Vec2 | null;
  projectionViewScale: Vec2 | null;

  constructor(opts: {
    renderer: WorldRenderer;
    frame: RenderFrame;
    projectionCamera?: Vec2 | null;
    projectionViewScale?: Vec2 | null;
  }) {
    this.renderer = opts.renderer;
    this.frame = opts.frame;
    this.projectionCamera = opts.projectionCamera ?? null;
    this.projectionViewScale = opts.projectionViewScale ?? null;
  }

  _cameraScreenSize(opts: { runtimeW?: number | null; runtimeH?: number | null } = {}): Vec2 {
    const runtimeW = opts.runtimeW ?? null;
    const runtimeH = opts.runtimeH ?? null;
    const outW = runtimeW !== null ? runtimeW : wgl.getScreenWidth();
    const outH = runtimeH !== null ? runtimeH : wgl.getScreenHeight();
    return viewport.cameraScreenSize({ worldSize: this.frame.worldSize, config: this.frame.config, runtimeW: outW, runtimeH: outH });
  }

  _clampCamera(camera: Vec2, screenSize: Vec2): Vec2 {
    return viewport.clampCamera({ worldSize: this.frame.worldSize, camera: camera, screenSize: screenSize });
  }

  _worldParams(): [Vec2, Vec2] {
    const outSize = new Vec2(wgl.getScreenWidth(), wgl.getScreenHeight());
    const [camera, viewScale, screenSize] = viewport.viewTransform({ worldSize: this.frame.worldSize, config: this.frame.config, camera: this.frame.camera, outSize: outSize });
    return [camera, viewScale];
  }

  static _worldToScreenWith(pos: Vec2, opts: { camera: Vec2; viewScale: Vec2 }): Vec2 {
    const camera = opts.camera;
    const viewScale = opts.viewScale;
    return viewport.worldToScreenWith(pos, { camera: camera, viewScale: viewScale });
  }

  static _viewScaleAvg(viewScale: Vec2): number {
    return viewport.viewScaleAvg(viewScale);
  }

  _drawAtlasSprite(texture: rl.Texture, opts: { grid: number; frame: number; pos: Vec2; scale: number; rotationRad?: number; tint?: wgl.Color }): void {
    let grid = opts.grid;
    let frame = opts.frame;
    const pos = opts.pos;
    const scale = opts.scale;
    const rotationRad = opts.rotationRad ?? 0.0;
    const tint = opts.tint ?? wgl.makeColor(1, 1, 1, 1);
    grid = Math.max(1, int(grid));
    frame = Math.max(0, int(frame));
    const cellW = texture.width / grid;
    const cellH = texture.height / grid;
    const col = frame % grid;
    const row = Math.floor(frame / grid);
    const src = wgl.makeRectangle(cellW * col, cellH * row, cellW, cellH);
    const w = cellW * scale;
    const h = cellH * scale;
    const dst = wgl.makeRectangle(pos.x, pos.y, w, h);
    const origin = wgl.makeVector2(w * 0.5, h * 0.5);
    wgl.drawTexturePro(texture, src, dst, origin, rotationRad * RAD_TO_DEG, tint);
  }

  withProjection(opts: { camera: Vec2; viewScale: Vec2 }): WorldRenderCtx {
    const camera = opts.camera;
    const viewScale = opts.viewScale;
    return new WorldRenderCtx({ renderer: this.renderer, frame: this.frame, projectionCamera: camera, projectionViewScale: viewScale });
  }

  static _isBulletTrailType(typeId: number): boolean {
    return isBulletTrailType(typeId);
  }

  static _bulletSpriteSize(typeId: number, opts: { scale: number }): number {
    const scale = opts.scale;
    return bulletSpriteSize(typeId, { scale: scale });
  }

  _drawBulletTrail(start: Vec2, end: Vec2, opts: { typeId: number; alpha: number; scale: number; angle: number }): boolean {
    const typeId = opts.typeId;
    const alpha = opts.alpha;
    const scale = opts.scale;
    const angle = opts.angle;
    return drawBulletTrail(this, start, end, { typeId: typeId, alpha: alpha, scale: scale, angle: angle });
  }

  worldToScreen(pos: Vec2): Vec2 {
    let camera = this.projectionCamera;
    let viewScale = this.projectionViewScale;
    if (camera === null || viewScale === null) {
      [camera, viewScale] = this._worldParams();
    }
    return WorldRenderCtx._worldToScreenWith(pos, { camera: camera, viewScale: viewScale });
  }

  screenToWorld(pos: Vec2): Vec2 {
    let camera = this.projectionCamera;
    let viewScale = this.projectionViewScale;
    if (camera === null || viewScale === null) {
      [camera, viewScale] = this._worldParams();
    }
    return viewport.screenToWorldWith(pos, { camera: camera, viewScale: viewScale });
  }

  cameraScreenSize(opts: { runtimeW?: number | null; runtimeH?: number | null } = {}): Vec2 {
    const runtimeW = opts.runtimeW ?? null;
    const runtimeH = opts.runtimeH ?? null;
    return this._cameraScreenSize({ runtimeW: runtimeW, runtimeH: runtimeH });
  }

  clampCamera(camera: Vec2, screenSize: Vec2): Vec2 {
    return this._clampCamera(camera, screenSize);
  }

  worldParams(): [Vec2, Vec2] {
    return this._worldParams();
  }

  static worldToScreenWith(pos: Vec2, opts: { camera: Vec2; viewScale: Vec2 }): Vec2 {
    const camera = opts.camera;
    const viewScale = opts.viewScale;
    return WorldRenderCtx._worldToScreenWith(pos, { camera: camera, viewScale: viewScale });
  }

  _worldToScreenWith(pos: Vec2, opts: { camera: Vec2; viewScale: Vec2 }): Vec2 {
    const camera = opts.camera;
    const viewScale = opts.viewScale;
    return WorldRenderCtx._worldToScreenWith(pos, { camera: camera, viewScale: viewScale });
  }

  worldToScreenWith(pos: Vec2, opts: { camera: Vec2; viewScale: Vec2 }): Vec2 {
    const camera = opts.camera;
    const viewScale = opts.viewScale;
    return WorldRenderCtx._worldToScreenWith(pos, { camera: camera, viewScale: viewScale });
  }

  static viewScaleAvg(viewScale: Vec2): number {
    return WorldRenderCtx._viewScaleAvg(viewScale);
  }

  _viewScaleAvg(viewScale: Vec2): number {
    return WorldRenderCtx._viewScaleAvg(viewScale);
  }

  viewScaleAvg(viewScale: Vec2): number {
    return WorldRenderCtx._viewScaleAvg(viewScale);
  }

  drawAtlasSprite(texture: rl.Texture, opts: { grid: number; frame: number; pos: Vec2; scale: number; rotationRad?: number; tint?: wgl.Color }): void {
    const grid = opts.grid;
    const frame = opts.frame;
    const pos = opts.pos;
    const scale = opts.scale;
    const rotationRad = opts.rotationRad ?? 0.0;
    const tint = opts.tint ?? wgl.makeColor(1, 1, 1, 1);
    this._drawAtlasSprite(texture, { grid: grid, frame: frame, pos: pos, scale: scale, rotationRad: rotationRad, tint: tint });
  }

  static isBulletTrailType(typeId: number): boolean {
    return WorldRenderCtx._isBulletTrailType(typeId);
  }

  _isBulletTrailType(opts: { typeId: number }): boolean;
  _isBulletTrailType(typeId: number): boolean;
  _isBulletTrailType(typeIdOrOpts: number | { typeId: number }): boolean {
    const typeId: number = typeof typeIdOrOpts === 'object' && typeIdOrOpts !== null ? typeIdOrOpts.typeId : typeIdOrOpts as number;
    return WorldRenderCtx._isBulletTrailType(typeId);
  }

  isBulletTrailType(opts: { typeId: number }): boolean;
  isBulletTrailType(typeId: number): boolean;
  isBulletTrailType(typeIdOrOpts: number | { typeId: number }): boolean {
    const typeId: number = typeof typeIdOrOpts === 'object' && typeIdOrOpts !== null ? typeIdOrOpts.typeId : typeIdOrOpts as number;
    return WorldRenderCtx._isBulletTrailType(typeId);
  }

  static bulletSpriteSize(typeId: number, opts: { scale: number }): number {
    const scale = opts.scale;
    return WorldRenderCtx._bulletSpriteSize(typeId, { scale: scale });
  }

  _bulletSpriteSize(typeId: number, opts: { scale: number }): number {
    const scale = opts.scale;
    return WorldRenderCtx._bulletSpriteSize(typeId, { scale: scale });
  }

  bulletSpriteSize(typeId: number, opts: { scale: number }): number {
    const scale = opts.scale;
    return WorldRenderCtx._bulletSpriteSize(typeId, { scale: scale });
  }

  drawBulletTrail(start: Vec2, end: Vec2, opts: { typeId: number; alpha: number; scale: number; angle: number }): boolean {
    const typeId = opts.typeId;
    const alpha = opts.alpha;
    const scale = opts.scale;
    const angle = opts.angle;
    return this._drawBulletTrail(start, end, { typeId: typeId, alpha: alpha, scale: scale, angle: angle });
  }
}
