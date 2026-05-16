// Port of crimson/render/world/projectiles.py

import { TextureId } from '@grim/assets.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { KNOWN_PROJ_FRAMES } from '@crimson/sim/world-defs.ts';
import { ProjectileDrawCtx, SecondaryProjectileDrawCtx, drawProjectileFromRegistry, drawSecondaryProjectileFromRegistry } from '@crimson/render/projectile-draw/index.ts';
import { knownProjRgb } from '@crimson/render/projectile-render-registry.ts';
import { WorldRenderCtx } from '@crimson/render/world/context.ts';
import type { Projectile, SecondaryProjectile } from '@crimson/projectiles/types.ts';
import * as wgl from '@wgl';

export function drawProjectile(renderCtx: WorldRenderCtx, proj: Projectile, opts: { projIndex?: number; camera: Vec2; viewScale: Vec2; scale: number; alpha?: number }): void {
  const projIndex = opts.projIndex ?? 0;
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  const scale = opts.scale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }

  const projectileRenderCtx = renderCtx.withProjection({ camera: camera, viewScale: viewScale });
  const texture = projectileRenderCtx.frame.resources.texture(TextureId.PROJS);
  const typeId = proj.typeId;
  const projPos = proj.pos;
  const screen = projectileRenderCtx.worldToScreen(projPos);
  const life = proj.lifeTimer;
  const angle = proj.angle;

  const registryCtx = new ProjectileDrawCtx({ renderer: projectileRenderCtx, proj: proj, projIndex: int(projIndex), texture: texture, typeId: int(typeId), pos: projPos, screenPos: screen, life: life, angle: angle, scale: scale, alpha: alpha });
  if (drawProjectileFromRegistry(registryCtx)) {
    return;
  }

  const mapping = KNOWN_PROJ_FRAMES.get(typeId) ?? null;
  if (mapping === null) {
    return;
  }
  const [grid, frame] = mapping;
  const alphaByte = int(clamp(clamp(life / 0.4, 0.0, 1.0) * 255.0 * alpha, 0.0, 255.0) + 0.5);
  const [red, green, blue] = knownProjRgb(typeId);
  const tint = wgl.makeColor(int(red) / 255, int(green) / 255, int(blue) / 255, alphaByte / 255);
  renderCtx.drawAtlasSprite(
    texture,
    { grid: grid, frame: frame, pos: screen, scale: 0.6 * scale, rotationRad: angle, tint: tint },
  );
}

export function isBulletTrailType(typeId: number): boolean {
  return WorldRenderCtx.isBulletTrailType(typeId);
}

export function bulletSpriteSize(typeId: number, opts: { scale: number }): number {
  const scale = opts.scale;
  return WorldRenderCtx.bulletSpriteSize(typeId, { scale: scale });
}

export function drawBulletTrail(renderCtx: WorldRenderCtx, start: Vec2, end: Vec2, opts: { typeId: number; alpha: number; scale: number; angle: number }): boolean {
  const typeId = opts.typeId;
  const alpha = opts.alpha;
  const scale = opts.scale;
  const angle = opts.angle;
  return renderCtx.drawBulletTrail(start, end, { typeId: typeId, alpha: alpha, scale: scale, angle: angle });
}

export function drawSharpshooterLaserSight(renderCtx: WorldRenderCtx, opts: { camera: Vec2; viewScale: Vec2; scale: number; alpha: number }): void {
  // Laser sight overlay for the Sharpshooter perk (`projectile_render` @ 0x00422c70).

  const camera = opts.camera;
  const viewScale = opts.viewScale;
  const scale = opts.scale;
  let alpha = opts.alpha;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }
  const bulletTrailTexture = renderCtx.frame.resources.texture(TextureId.BULLET_TRAIL);

  const players = renderCtx.frame.players;
  if (players.length === 0) {
    return;
  }

  const tailAlpha = int(clamp(alpha * 0.5, 0.0, 1.0) * 255.0 + 0.5);
  const headAlpha = int(clamp(alpha * 0.2, 0.0, 1.0) * 255.0 + 0.5);
  const tail = wgl.makeColor(255 / 255, 0 / 255, 0 / 255, tailAlpha / 255);
  const head = wgl.makeColor(255 / 255, 0 / 255, 0 / 255, headAlpha / 255);

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  wgl.beginQuads(bulletTrailTexture);

  for (const player of players) {
    if (player.health <= 0.0) {
      continue;
    }
    if (!perkActive(player, PerkId.SHARPSHOOTER)) {
      continue;
    }
    const playerPos = player.pos;

    const aimHeading = player.aimHeading;
    const aimDir = Vec2.fromHeading(aimHeading);
    const start = playerPos.add(aimDir.mul(15.0));
    const end = playerPos.add(aimDir.mul(512.0));

    const startScreen = WorldRenderCtx.worldToScreenWith(start, { camera: camera, viewScale: viewScale });
    const endScreen = WorldRenderCtx.worldToScreenWith(end, { camera: camera, viewScale: viewScale });
    const segment = endScreen.sub(startScreen);
    const [direction, dist] = segment.normalizedWithLength();
    if (dist <= 1e-3) {
      continue;
    }

    const thickness = Math.max(1.0, 2.0 * scale);
    const half = thickness * 0.5;
    const sideOffset = direction.perpLeft().mul(half);
    const p0 = startScreen.sub(sideOffset);
    const p1 = startScreen.add(sideOffset);
    const p2 = endScreen.add(sideOffset);
    const p3 = endScreen.sub(sideOffset);

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
  }

  wgl.endQuads();
  wgl.endBlendMode();
}

export function drawSecondaryProjectile(renderCtx: WorldRenderCtx, proj: SecondaryProjectile, opts: { camera: Vec2; viewScale: Vec2; scale: number; alpha?: number }): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  const scale = opts.scale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }

  const projectileRenderCtx = renderCtx.withProjection({ camera: camera, viewScale: viewScale });
  const projPos = proj.pos;
  const screen = projectileRenderCtx.worldToScreen(projPos);
  const projType = proj.typeId;
  const angle = proj.angle;

  const registryCtx = new SecondaryProjectileDrawCtx({ renderer: projectileRenderCtx, proj: proj, projType: projType, screenPos: screen, angle: angle, scale: scale, alpha: alpha });
  if (drawSecondaryProjectileFromRegistry(registryCtx)) {
    return;
  }

  wgl.drawCircle(int(screen.x), int(screen.y), Math.max(1.0, 4.0 * scale), wgl.makeColor(200 / 255, 200 / 255, 220 / 255, int(200 * alpha + 0.5) / 255));
}
