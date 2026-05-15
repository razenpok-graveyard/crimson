// Port of crimson/render/world/projectiles.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import * as wgl from '@wgl';
import { PerkId } from '@crimson/perks/ids.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { KNOWN_PROJ_FRAMES } from '@crimson/sim/world-defs.ts';
import { ProjectileDrawCtx, SecondaryProjectileDrawCtx, drawProjectileFromRegistry, drawSecondaryProjectileFromRegistry } from '@crimson/render/projectile-draw/index.ts';
import { knownProjRgb } from '@crimson/render/projectile-render-registry.ts';
import { WorldRenderCtx } from './context.ts';
import type { Projectile, SecondaryProjectile } from '@crimson/projectiles/types.ts';

function drawFilledCircle(center: Vec2, radius: number, color: wgl.Color): void {
  const segments = Math.max(24, int(radius * 1.5 + 0.5));
  const step = (Math.PI * 2.0) / segments;
  const white = wgl.getWhiteTexture();
  wgl.beginQuads(white);
  wgl.rlTexCoord2f(0.5, 0.5);
  wgl.rlColor4f(color.r, color.g, color.b, color.a);
  for (let i = 0; i < segments; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    wgl.rlVertex2f(center.x, center.y);
    wgl.rlVertex2f(center.x, center.y);
    wgl.rlVertex2f(center.x + Math.cos(a0) * radius, center.y + Math.sin(a0) * radius);
    wgl.rlVertex2f(center.x + Math.cos(a1) * radius, center.y + Math.sin(a1) * radius);
  }
  wgl.endQuads();
}

export function drawProjectile(
  renderCtx: WorldRenderCtx,
  proj: Projectile,
  opts: { projIndex?: number; camera: Vec2; viewScale: Vec2; scale: number; alpha?: number },
): void {
  const { camera, viewScale, scale } = opts;
  const projIndex = opts.projIndex ?? 0;
  let alpha = clamp(opts.alpha ?? 1.0, 0.0, 1.0);
  if (alpha <= 1e-3) return;

  const projectileRenderCtx = renderCtx.withProjection({ camera, viewScale });
  const texture = getTexture(projectileRenderCtx.frame.resources, TextureId.PROJS);
  const typeId = proj.typeId;
  const projPos = proj.pos;
  const screen = projectileRenderCtx.worldToScreen(projPos);
  const life = proj.lifeTimer;
  const angle = proj.angle;

  const registryCtx = new ProjectileDrawCtx({
    renderer: projectileRenderCtx,
    proj,
    projIndex: int(projIndex),
    texture,
    typeId: int(typeId),
    pos: projPos,
    screenPos: screen,
    life,
    angle,
    scale,
    alpha,
  });
  if (drawProjectileFromRegistry(registryCtx)) return;

  const mapping = KNOWN_PROJ_FRAMES.get(typeId);
  if (mapping === undefined) return;
  const [grid, frame] = mapping;
  alpha = int(clamp(clamp(life / 0.4, 0.0, 1.0) * 255.0 * alpha, 0.0, 255.0) + 0.5) / 255;
  const [red, green, blue] = knownProjRgb(typeId);
  const tint = wgl.makeColor(red / 255, green / 255, blue / 255, alpha);
  renderCtx.drawAtlasSprite(texture, {
    grid,
    frame,
    pos: screen,
    scale: 0.6 * scale,
    rotationRad: angle,
    tint,
  });
}

export function isBulletTrailType(typeId: number): boolean {
  return WorldRenderCtx.isBulletTrailType(typeId);
}

export function bulletSpriteSize(typeId: number, opts: { scale: number }): number {
  return WorldRenderCtx.bulletSpriteSize(typeId, { scale: opts.scale });
}

export function drawBulletTrail(
  renderCtx: WorldRenderCtx,
  start: Vec2,
  end: Vec2,
  opts: { typeId: number; alpha: number; scale: number; angle: number },
): boolean {
  return renderCtx.drawBulletTrail(start, end, opts);
}

export function drawSharpshooterLaserSight(
  renderCtx: WorldRenderCtx,
  opts: { camera: Vec2; viewScale: Vec2; scale: number; alpha: number },
): void {
  // Laser sight overlay for the Sharpshooter perk (`projectile_render` @ 0x00422c70).

  const { camera, viewScale, scale } = opts;
  let alpha = clamp(opts.alpha, 0.0, 1.0);
  if (alpha <= 1e-3) return;

  const bulletTrailTexture = getTexture(renderCtx.frame.resources, TextureId.BULLET_TRAIL);
  const players = renderCtx.frame.players;
  if (!players.length) return;

  const tailAlpha = int(clamp(alpha * 0.5, 0.0, 1.0) * 255.0 + 0.5) / 255;
  const headAlpha = int(clamp(alpha * 0.2, 0.0, 1.0) * 255.0 + 0.5) / 255;

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  wgl.beginQuads(bulletTrailTexture);

  for (const player of players) {
    if (player.health <= 0.0) continue;
    if (!perkActive(player, PerkId.SHARPSHOOTER)) continue;

    const playerPos = player.pos;
    const aimHeading = player.aimHeading;
    const aimDir = Vec2.fromHeading(aimHeading);
    const start = playerPos.add(aimDir.mul(15.0));
    const end = playerPos.add(aimDir.mul(512.0));

    const startScreen = WorldRenderCtx.worldToScreenWith(start, { camera, viewScale });
    const endScreen = WorldRenderCtx.worldToScreenWith(end, { camera, viewScale });
    const segment = endScreen.sub(startScreen);
    const [direction, dist] = segment.normalizedWithLength();
    if (dist <= 1e-3) continue;

    const thickness = Math.max(1.0, 2.0 * scale);
    const half = thickness * 0.5;
    const sideOffset = direction.perpLeft().mul(half);
    const p0 = startScreen.sub(sideOffset);
    const p1 = startScreen.add(sideOffset);
    const p2 = endScreen.add(sideOffset);
    const p3 = endScreen.sub(sideOffset);

    wgl.rlColor4f(1, 0, 0, tailAlpha);
    wgl.rlTexCoord2f(0.0, 0.0);
    wgl.rlVertex2f(p0.x, p0.y);

    wgl.rlColor4f(1, 0, 0, tailAlpha);
    wgl.rlTexCoord2f(1.0, 0.0);
    wgl.rlVertex2f(p1.x, p1.y);

    wgl.rlColor4f(1, 0, 0, headAlpha);
    wgl.rlTexCoord2f(1.0, 0.5);
    wgl.rlVertex2f(p2.x, p2.y);

    wgl.rlColor4f(1, 0, 0, headAlpha);
    wgl.rlTexCoord2f(0.0, 0.5);
    wgl.rlVertex2f(p3.x, p3.y);
  }

  wgl.endQuads();
  wgl.endBlendMode();
}

export function drawSecondaryProjectile(
  renderCtx: WorldRenderCtx,
  proj: SecondaryProjectile,
  opts: { camera: Vec2; viewScale: Vec2; scale: number; alpha?: number },
): void {
  const { camera, viewScale, scale } = opts;
  let alpha = clamp(opts.alpha ?? 1.0, 0.0, 1.0);
  if (alpha <= 1e-3) return;

  const projectileRenderCtx = renderCtx.withProjection({ camera, viewScale });
  const projPos = proj.pos;
  const screen = projectileRenderCtx.worldToScreen(projPos);
  const projType = proj.typeId;
  const angle = proj.angle;

  const registryCtx = new SecondaryProjectileDrawCtx({
    renderer: projectileRenderCtx,
    proj,
    projType,
    screenPos: screen,
    angle,
    scale,
    alpha,
  });
  if (drawSecondaryProjectileFromRegistry(registryCtx)) return;

  const r = Math.max(1.0, 4.0 * scale);
  const tint = wgl.makeColor(200 / 255, 200 / 255, 220 / 255, int(200 * alpha + 0.5) / 255);
  drawFilledCircle(new Vec2(int(screen.x), int(screen.y)), r, tint);
}
