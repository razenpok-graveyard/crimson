// Port of grim/raylib_api.py

import { type WebGLContext, type RenderTarget, type ShaderQuadVertex, BlendMode } from "@grim/webgl.js";

export { BlendMode };
export type { RenderTarget, ShaderQuadVertex };

export type Color = { r: number; g: number; b: number; a: number };
export function makeColor(r: number, g: number, b: number, a: number): Color { return { r, g, b, a }; }

export type Rectangle = { x: number; y: number; w: number; h: number };
export function makeRectangle(x: number, y: number, w: number, h: number): Rectangle { return { x, y, w, h }; }

export type Vector2 = { x: number; y: number };
export function makeVector2(x: number, y: number): Vector2 { return { x, y }; }

export interface Texture {
  id: WebGLTexture;
  width: number;
  height: number;
}

export function makeTexture(id: WebGLTexture, width: number, height: number): Texture { return { id, width, height }; }

let ctx: WebGLContext;
export function setContext(context: WebGLContext): void { ctx = context; }

export function getScreenWidth(): number { return ctx.screenWidth; }
export function getScreenHeight(): number { return ctx.screenHeight; }
export function clearBackground(color: Color): void {
  ctx.clearBackground(color.r, color.g, color.b, color.a);
}
export function setGammaGain(gain: number): void { ctx.setGammaGain(gain); }

export function drawTexturePro(
  texture: Texture,
  source: Rectangle,
  dest: Rectangle,
  origin: Vector2,
  rotation: number,
  tint: Color,
): void {
  ctx.drawTexturePro(texture, source, dest, origin, rotation, tint);
}

export function drawRectangle(x: number, y: number, w: number, h: number, color: Color): void {
  ctx.drawRectangle(x, y, w, h, color.r, color.g, color.b, color.a);
}

export function drawLine(x1: number, y1: number, x2: number, y2: number, color: Color): void {
  const ix1 = Math.trunc(x1);
  const iy1 = Math.trunc(y1);
  const ix2 = Math.trunc(x2);
  const iy2 = Math.trunc(y2);
  if (iy1 === iy2) {
    drawRectangle(Math.min(ix1, ix2), iy1, Math.abs(ix2 - ix1), 1, color);
    return;
  }
  if (ix1 === ix2) {
    drawRectangle(ix1, Math.min(iy1, iy2), 1, Math.abs(iy2 - iy1), color);
    return;
  }
  drawRectangle(ix1, iy1, ix2 - ix1, iy2 - iy1, color);
}

export function drawRectangleLines(x: number, y: number, w: number, h: number, color: Color): void {
  drawRectangle(x, y, w, 1, color);
  drawRectangle(x, y + h - 1, w, 1, color);
  drawRectangle(x, y + 1, 1, h - 2, color);
  drawRectangle(x + w - 1, y + 1, 1, h - 2, color);
}

export function drawRectangleLinesEx(rect: Rectangle, lineThick: number, color: Color): void {
  const thick = Math.max(1, Math.trunc(lineThick));
  drawRectangle(rect.x, rect.y, rect.w, thick, color);
  drawRectangle(rect.x, rect.y + rect.h - thick, rect.w, thick, color);
  drawRectangle(rect.x, rect.y, thick, rect.h, color);
  drawRectangle(rect.x + rect.w - thick, rect.y, thick, rect.h, color);
}

export function drawCircleLines(x: number, y: number, radius: number, color: Color): void {
  const r = Math.max(1.0, radius);
  const innerR = Math.max(0.0, r - 0.5);
  const outerR = r + 0.5;
  const segments = Math.max(24, Math.trunc(r * 0.25 + 24.0));
  const step = (Math.PI * 2.0) / segments;

  ctx.beginQuads(ctx.whiteTexture);
  ctx.texCoord2f(0.5, 0.5);
  ctx.color4f(color.r, color.g, color.b, color.a);
  for (let i = 0; i < segments; i += 1) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    const cos0 = Math.cos(a0);
    const sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    ctx.vertex2f(x + cos0 * innerR, y + sin0 * innerR);
    ctx.vertex2f(x + cos0 * outerR, y + sin0 * outerR);
    ctx.vertex2f(x + cos1 * outerR, y + sin1 * outerR);
    ctx.vertex2f(x + cos1 * innerR, y + sin1 * innerR);
  }
  ctx.endQuads();
}

export function drawCircle(x: number, y: number, radius: number, color: Color): void {
  const r = Math.max(1.0, radius);
  const segments = Math.max(24, Math.trunc(r * 1.5 + 0.5));
  const step = (Math.PI * 2.0) / segments;

  ctx.beginQuads(ctx.whiteTexture);
  ctx.texCoord2f(0.5, 0.5);
  ctx.color4f(color.r, color.g, color.b, color.a);
  for (let i = 0; i < segments; i += 1) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    ctx.vertex2f(x, y);
    ctx.vertex2f(x, y);
    ctx.vertex2f(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
    ctx.vertex2f(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
  }
  ctx.endQuads();
}

export function drawCircleSector(
  center: Vector2,
  radius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
  color: Color,
): void {
  const r = Math.max(0.0, radius);
  const segmentCount = Math.max(3, Math.trunc(segments));
  if (r <= 0.0) {
    return;
  }
  const start = startAngle * Math.PI / 180.0;
  const sweep = (endAngle - startAngle) * Math.PI / 180.0;
  const step = sweep / segmentCount;

  ctx.beginQuads(ctx.whiteTexture);
  ctx.texCoord2f(0.5, 0.5);
  ctx.color4f(color.r, color.g, color.b, color.a);
  for (let i = 0; i < segmentCount; i += 1) {
    const a0 = start + i * step;
    const a1 = start + (i + 1) * step;
    ctx.vertex2f(center.x, center.y);
    ctx.vertex2f(center.x, center.y);
    ctx.vertex2f(center.x + Math.cos(a0) * r, center.y + Math.sin(a0) * r);
    ctx.vertex2f(center.x + Math.cos(a1) * r, center.y + Math.sin(a1) * r);
  }
  ctx.endQuads();
}

export function drawRing(
  center: Vector2,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
  segments: number,
  color: Color,
): void {
  const inner = Math.max(0.0, Math.min(innerRadius, outerRadius));
  const outer = Math.max(inner, Math.max(innerRadius, outerRadius));
  const segmentCount = Math.max(3, Math.trunc(segments));
  if (outer <= 0.0 || outer <= inner) {
    return;
  }
  const start = startAngle * Math.PI / 180.0;
  const sweep = (endAngle - startAngle) * Math.PI / 180.0;
  const step = sweep / segmentCount;

  ctx.beginQuads(ctx.whiteTexture);
  ctx.texCoord2f(0.5, 0.5);
  ctx.color4f(color.r, color.g, color.b, color.a);
  for (let i = 0; i < segmentCount; i += 1) {
    const a0 = start + i * step;
    const a1 = start + (i + 1) * step;
    const cos0 = Math.cos(a0);
    const sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    ctx.vertex2f(center.x + cos0 * inner, center.y + sin0 * inner);
    ctx.vertex2f(center.x + cos0 * outer, center.y + sin0 * outer);
    ctx.vertex2f(center.x + cos1 * outer, center.y + sin1 * outer);
    ctx.vertex2f(center.x + cos1 * inner, center.y + sin1 * inner);
  }
  ctx.endQuads();
}

export function beginBlendMode(mode: BlendMode): void { ctx.setBlendMode(mode); }
export function endBlendMode(): void { ctx.setBlendMode(BlendMode.ALPHA); }

export function rlSetBlendFactors(src: number, dst: number, eq: number): void {
  ctx.setCustomBlendFactors(src, dst, eq);
}
export function rlSetTexture(_textureId: number): void { ctx.flush(); }
export function rlSetBlendFactorsSeparate(
  srcRGB: number, dstRGB: number, eqRGB: number,
  srcA: number, dstA: number, eqA: number,
): void {
  ctx.setCustomBlendFactorsSeparate(srcRGB, dstRGB, eqRGB, srcA, dstA, eqA);
}

export function setAlphaTest(enabled: boolean): void { ctx.setAlphaTest(enabled); }
export function rlColorMask(r: boolean, g: boolean, b: boolean, a: boolean): void { ctx.setColorMask(r, g, b, a); }

export function setScissor(x: number, y: number, w: number, h: number): void { ctx.setScissor(x, y, w, h); }
export function clearScissor(): void { ctx.clearScissor(); }

export function beginQuads(texture: Texture): void { ctx.beginQuads(texture); }
export function endQuads(): void { ctx.endQuads(); }
export function rlTexCoord2f(u: number, v: number): void { ctx.texCoord2f(u, v); }
export function rlColor4f(r: number, g: number, b: number, a: number): void { ctx.color4f(r, g, b, a); }
export function rlVertex2f(x: number, y: number): void { ctx.vertex2f(x, y); }
export function createShaderProgram(vsSource: string, fsSource: string): WebGLProgram {
  return ctx.createShaderProgram(vsSource, fsSource);
}
export function getShaderLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
  return ctx.getShaderLocation(program, name);
}
export function setShaderFloat(program: WebGLProgram, location: WebGLUniformLocation | null, value: number): void {
  ctx.setShaderFloat(program, location, value);
}
export function setShaderVec4(
  program: WebGLProgram,
  location: WebGLUniformLocation | null,
  x: number,
  y: number,
  z: number,
  w: number,
): void {
  ctx.setShaderVec4(program, location, x, y, z, w);
}
export function drawShaderQuad(
  program: WebGLProgram,
  mvpLocation: WebGLUniformLocation | null,
  vertices: readonly ShaderQuadVertex[],
): void {
  ctx.drawShaderQuad(program, mvpLocation, vertices);
}

export function beginTextureMode(rt: RenderTarget): void { ctx.beginRenderTarget(rt); }
export function endTextureMode(): void { ctx.endRenderTarget(); }
export function loadRenderTexture(width: number, height: number): RenderTarget { return ctx.createRenderTarget(width, height); }
export function unloadRenderTexture(rt: RenderTarget): void { ctx.destroyRenderTarget(rt); }

export function loadTexture(
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas,
  opts?: { clamp?: boolean; pointFilter?: boolean },
): Texture { return ctx.loadTexture(source, opts); }
export function unloadTexture(texture: Texture): void { ctx.unloadTexture(texture); }

export function flush(): void { ctx.flush(); }
export function getWhiteTexture(): Texture { return ctx.whiteTexture; }
export function resize(width: number, height: number): void { ctx.resize(width, height); }
export function getCanvas(): HTMLCanvasElement { return ctx.canvas; }
export function destroy(): void { ctx.destroy(); }

let _lastFrameTime = 0;
let _currentFrameTime = 0;
let _currentFps = 0;
let _textCanvas: HTMLCanvasElement | null = null;
let _textCtx: CanvasRenderingContext2D | null = null;

function textContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (_textCtx !== null) return _textCtx;
  _textCanvas = document.createElement('canvas');
  _textCtx = _textCanvas.getContext('2d');
  return _textCtx;
}

export function updateFps(now: number): void {
  if (_lastFrameTime > 0) {
    const dt = (now - _lastFrameTime) * 0.001;
    _currentFrameTime = Math.max(0, dt);
    _currentFps = dt > 0 ? 1.0 / dt : 0;
  }
  _lastFrameTime = now;
}
export function getFrameTime(): number { return _currentFrameTime; }
export function getFps(): number { return _currentFps; }

export const enum TextureFilter {
  POINT = 0,
  BILINEAR = 1,
}

export const enum TextureWrap {
  REPEAT = 0,
  CLAMP = 1,
}

export function setTextureFilter(texture: Texture, filter: TextureFilter): void {
  ctx.setTextureFilter(texture, filter);
}

export function setTextureWrap(texture: Texture, wrap: TextureWrap): void {
  ctx.setTextureWrap(texture, wrap);
}

export function measureText(text: string, fontSize: number): number {
  const textCtx = textContext();
  if (textCtx !== null) {
    textCtx.font = `${fontSize}px sans-serif`;
    return textCtx.measureText(text).width;
  }
  return text.length * fontSize * 0.6;
}

export function drawText(text: string, x: number, y: number, fontSize: number, color: Color): void {
  if (text.length === 0) return;
  const textCtx = textContext();
  const canvas = _textCanvas;
  if (textCtx === null || canvas === null) return;

  textCtx.font = `${fontSize}px sans-serif`;
  const width = Math.max(1, Math.ceil(textCtx.measureText(text).width));
  const height = Math.max(1, Math.ceil(fontSize * 1.25));
  canvas.width = width;
  canvas.height = height;
  textCtx.font = `${fontSize}px sans-serif`;
  textCtx.textBaseline = 'top';
  textCtx.clearRect(0, 0, width, height);
  textCtx.fillStyle = 'rgba(255, 255, 255, 1)';
  textCtx.fillText(text, 0, 0);

  const texture = ctx.loadTexture(canvas, { clamp: true, pointFilter: false });
  ctx.drawTexturePro(
    texture,
    { x: 0, y: 0, w: width, h: height },
    { x, y, w: width, h: height },
    { x: 0, y: 0 },
    0,
    { r: color.r, g: color.g, b: color.b, a: color.a },
  );
  ctx.flush();
  ctx.unloadTexture(texture);
}

export const RL_SRC_ALPHA = 0x0302;
export const RL_ONE_MINUS_SRC_ALPHA = 0x0303;
export const RL_ONE = 1;
export const RL_ZERO = 0;
export const RL_DST_COLOR = 0x0306;
export const RL_ONE_MINUS_DST_COLOR = 0x0307;
export const RL_FUNC_ADD = 0x8006;
export const RL_DST_ALPHA = 0x0304;
export const RL_SRC_COLOR = 0x0300;
