// Port of crimson/render/world/trooper.py

import { TextureId } from '@grim/assets.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import type { rl } from '@grim/raylib-api.ts';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { WEAPON_BY_ID } from '@crimson/weapons.ts';
import { RAD_TO_DEG } from '@crimson/render/world/constants.ts';
import { WorldRenderCtx } from '@crimson/render/world/context.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import * as wgl from '@wgl';

export const LAN_PLAYER_RING_RGB: readonly [number, number, number][] = [
  // Match existing trooper torso tint colors for P1/P2.
  [77, 77, 255],
  [255, 140, 89],
  // Distinct colors for P3/P4 (4-player LAN readability).
  [90, 240, 255],
  [255, 120, 230],
];

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export function lanPlayerRingRgb(playerIndex: number): [number, number, number] {
  const idx = Math.max(0, Math.min(LAN_PLAYER_RING_RGB.length - 1, int(playerIndex)));
  return LAN_PLAYER_RING_RGB[idx];
}

export function drawLanPlayerRing(renderCtx: WorldRenderCtx, opts: { player: PlayerState; screenPos: Vec2; baseSize: number; scale: number; alpha: number }): void {
  const player = opts.player;
  const screenPos = opts.screenPos;
  const baseSize = opts.baseSize;
  const scale = opts.scale;
  let alpha = opts.alpha;
  const frame = renderCtx.frame;
  if (!Boolean(frame.lanPlayerRingsEnabled)) {
    return;
  }
  if (frame.players.length <= 1) {
    return;
  }
  if (player.health <= 0.0) {
    return;
  }
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }

  const [red, green, blue] = lanPlayerRingRgb(int(player.index));
  const outer = Math.max(8.0 * scale, baseSize * 0.58);
  const thickness = Math.max(2.5 * scale, baseSize * 0.11);
  const inner = Math.max(0.0, outer - thickness);
  const glowOuter = outer + Math.max(2.0 * scale, baseSize * 0.08);
  const segments = Math.max(24, int(outer * 1.5 + 0.5));
  const center = wgl.makeVector2(screenPos.x, screenPos.y);
  const core = wgl.makeColor(red / 255, green / 255, blue / 255, int(clamp(alpha * 0.9, 0.0, 1.0) * 255.0 + 0.5) / 255);
  const glow = wgl.makeColor(red / 255, green / 255, blue / 255, int(clamp(alpha * 0.35, 0.0, 1.0) * 255.0 + 0.5) / 255);

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  wgl.drawRing(center, inner, outer, 0.0, 360.0, int(segments), core);
  wgl.drawRing(center, outer, glowOuter, 0.0, 360.0, int(segments), glow);
  wgl.endBlendMode();
}

export function drawPlayerTrooperSprite(renderCtx: WorldRenderCtx, texture: rl.Texture, player: PlayerState, opts: { camera: Vec2; viewScale: Vec2; scale: number; alpha?: number }): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  const scale = opts.scale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }
  const renderFrame = renderCtx.frame;
  const resources = renderFrame.resources;
  const particlesTexture = resources.texture(TextureId.PARTICLES);
  const muzzleFlashTexture = resources.texture(TextureId.MUZZLE_FLASH);
  const spriteGrid = 8;
  const cell = spriteGrid > 0 ? texture.width / spriteGrid : texture.width;
  if (cell <= 0.0) {
    return;
  }

  const screenPos = WorldRenderCtx._worldToScreenWith(player.pos, { camera: camera, viewScale: viewScale });
  const baseSize = player.size * scale;
  const baseScale = baseSize / cell;

  drawLanPlayerRing(
    renderCtx,
    { player: player, screenPos: screenPos, baseSize: baseSize, scale: scale, alpha: alpha },
  );

  let atlas: any;
  let atlasFrame: number;
  let col: number;
  let row: number;
  let cellW: number;
  let cellH: number;
  let src: wgl.Rectangle;
  let t: number;
  let size: number;
  let dst: wgl.Rectangle;
  let origin: wgl.Vector2;
  let tint: wgl.Color;
  if (perkActive(player, PerkId.RADIOACTIVE) && alpha > 1e-3) {
    atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(EffectId.AURA)) ?? null;
    if (atlas !== null) {
      const auraGrid = SIZE_CODE_GRID.get(int(atlas.sizeCode)) ?? null;
      if (auraGrid) {
        atlasFrame = int(atlas.frame);
        col = atlasFrame % auraGrid;
        row = Math.floor(atlasFrame / auraGrid);
        cellW = particlesTexture.width / auraGrid;
        cellH = particlesTexture.height / auraGrid;
        src = wgl.makeRectangle(cellW * col, cellH * row, Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0));
        t = renderFrame.elapsedMs * 0.001;
        const auraAlpha = ((Math.sin(t) + 1.0) * 0.1875 + 0.25) * alpha;
        if (auraAlpha > 1e-3) {
          size = 100.0 * scale;
          dst = wgl.makeRectangle(screenPos.x, screenPos.y, size, size);
          origin = wgl.makeVector2(size * 0.5, size * 0.5);
          tint = wgl.makeColor(77 / 255, 153 / 255, 77 / 255, int(clamp(auraAlpha, 0.0, 1.0) * 255.0 + 0.5) / 255);
          wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
          wgl.drawTexturePro(particlesTexture, src, dst, origin, 0.0, tint);
          wgl.endBlendMode();
        }
      }
    }
  }

  tint = wgl.makeColor(240 / 255, 240 / 255, 255 / 255, int(255 * alpha + 0.5) / 255);
  const shadowTint = wgl.makeColor(0 / 255, 0 / 255, 0 / 255, int(90 * alpha + 0.5) / 255);
  let overlayTint = tint;
  if (renderFrame.players.length > 1) {
    const index = int(player.index);
    if (index === 0) {
      overlayTint = wgl.makeColor(77 / 255, 77 / 255, 255 / 255, tint.a);
    } else {
      overlayTint = wgl.makeColor(255 / 255, 140 / 255, 89 / 255, tint.a);
    }
  }

  const draw = (frame: number, opts: { pos: Vec2; scaleMul: number; rotation: number; color: wgl.Color }): void => {
    const pos = opts.pos;
    const scaleMul = opts.scaleMul;
    const rotation = opts.rotation;
    const color = opts.color;
    renderCtx._drawAtlasSprite(
      texture,
      { grid: spriteGrid, frame: Math.max(0, Math.min(63, int(frame))), pos: pos, scale: baseScale * scaleMul, rotationRad: rotation, tint: color },
    );
  };

  if (player.health > 0.0) {
    const legFrame = Math.max(0, Math.min(14, int(player.movePhase + 0.5)));
    const torsoFrame = legFrame + 16;

    const recoilDir = player.aimHeading + Math.PI / 2.0;
    const recoil = player.muzzleFlashAlpha * 12.0 * scale;
    const recoilOffset = Vec2.fromPolar(recoilDir, recoil);

    const legShadowScale = 1.02;
    const torsoShadowScale = 1.03;
    const legShadowOff = 3.0 * scale + baseSize * (legShadowScale - 1.0) * 0.5;
    const torsoShadowOff = 1.0 * scale + baseSize * (torsoShadowScale - 1.0) * 0.5;

    draw(
      legFrame,
      { pos: screenPos.offset({ dx: legShadowOff, dy: legShadowOff }), scaleMul: legShadowScale, rotation: player.heading, color: shadowTint },
    );
    draw(
      torsoFrame,
      { pos: screenPos.offset({ dx: recoilOffset.x + torsoShadowOff, dy: recoilOffset.y + torsoShadowOff }), scaleMul: torsoShadowScale, rotation: player.aimHeading, color: shadowTint },
    );

    draw(
      legFrame,
      { pos: screenPos, scaleMul: 1.0, rotation: player.heading, color: tint },
    );
    draw(
      torsoFrame,
      { pos: screenPos.add(recoilOffset), scaleMul: 1.0, rotation: player.aimHeading, color: overlayTint },
    );

    if (player.shieldTimer > 1e-3 && alpha > 1e-3) {
      atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(EffectId.SHIELD_RING)) ?? null;
      if (atlas !== null) {
        const shieldGrid = SIZE_CODE_GRID.get(int(atlas.sizeCode)) ?? null;
        let strength: number;
        if (shieldGrid) {
          atlasFrame = int(atlas.frame);
          col = atlasFrame % shieldGrid;
          row = Math.floor(atlasFrame / shieldGrid);
          cellW = particlesTexture.width / shieldGrid;
          cellH = particlesTexture.height / shieldGrid;
          src = wgl.makeRectangle(cellW * col, cellH * row, Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0));
          t = renderFrame.elapsedMs * 0.001;
          const timer = player.shieldTimer;
          strength = (Math.sin(t) + 1.0) * 0.25 + timer;
          if (timer < 1.0) {
            strength *= timer;
          }
          strength = Math.min(1.0, strength) * alpha;
          let half: number;
          if (strength > 1e-3) {
            const offsetDir = player.aimHeading - Math.PI / 2.0;
            const center = screenPos.add(Vec2.fromPolar(offsetDir, 3.0 * scale));

            half = Math.sin(t * 3.0) + 17.5;
            size = half * 2.0 * scale;
            const a = int(clamp(strength * 0.4, 0.0, 1.0) * 255.0 + 0.5);
            tint = wgl.makeColor(91 / 255, 180 / 255, 255 / 255, a / 255);
            dst = wgl.makeRectangle(center.x, center.y, size, size);
            origin = wgl.makeVector2(size * 0.5, size * 0.5);
            const rotationDeg = (t + t) * RAD_TO_DEG;

            half = Math.sin(t * 3.0) * 4.0 + 24.0;
            const size2 = half * 2.0 * scale;
            const a2 = int(clamp(strength * 0.3, 0.0, 1.0) * 255.0 + 0.5);
            const tint2 = wgl.makeColor(91 / 255, 180 / 255, 255 / 255, a2 / 255);
            const dst2 = wgl.makeRectangle(center.x, center.y, size2, size2);
            const origin2 = wgl.makeVector2(size2 * 0.5, size2 * 0.5);
            const rotation2Deg = (t * -2.0) * RAD_TO_DEG;

            wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
            wgl.drawTexturePro(particlesTexture, src, dst, origin, rotationDeg, tint);
            wgl.drawTexturePro(particlesTexture, src, dst2, origin2, rotation2Deg, tint2);
            wgl.endBlendMode();
          }
        }
      }
    }

    if (player.muzzleFlashAlpha > 1e-3 && alpha > 1e-3) {
      const weapon = mapGetOrThrow(WEAPON_BY_ID, player.weapon.weaponId);
      const flags = weapon.flags !== null ? int(weapon.flags) : 0;
      if ((flags & 0x8) === 0) {
        const flashAlpha = clamp(player.muzzleFlashAlpha * 0.8, 0.0, 1.0) * alpha;
        if (flashAlpha > 1e-3) {
          size = baseSize * ((flags & 0x4) ? 0.5 : 1.0);
          const heading = player.aimHeading + Math.PI / 2.0;
          const offset = (player.muzzleFlashAlpha * 12.0 - 21.0) * scale;
          const flashPos = screenPos.add(Vec2.fromAngle(heading).mul(offset));
          src = wgl.makeRectangle(0.0, 0.0, muzzleFlashTexture.width, muzzleFlashTexture.height);
          dst = wgl.makeRectangle(flashPos.x, flashPos.y, size, size);
          origin = wgl.makeVector2(size * 0.5, size * 0.5);
          const tintFlash = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(flashAlpha * 255.0 + 0.5) / 255);
          wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
          wgl.drawTexturePro(muzzleFlashTexture, src, dst, origin, player.aimHeading * RAD_TO_DEG, tintFlash);
          wgl.endBlendMode();
        }
      }
    }
    return;
  }

  let frame: number;
  if (player.deathTimer >= 0.0) {
    // Matches the observed frame ramp (32..52) in player_sprite_trace.jsonl.
    frame = 32 + int((16.0 - player.deathTimer) * 1.25);
    if (frame > 52) {
      frame = 52;
    }
    if (frame < 32) {
      frame = 32;
    }
  } else {
    frame = 52;
  }

  const deadShadowScale = 1.03;
  const deadShadowOff = 1.0 * scale + baseSize * (deadShadowScale - 1.0) * 0.5;
  draw(
    frame,
    { pos: screenPos.offset({ dx: deadShadowOff, dy: deadShadowOff }), scaleMul: deadShadowScale, rotation: player.aimHeading, color: shadowTint },
  );
  draw(frame, { pos: screenPos, scaleMul: 1.0, rotation: player.aimHeading, color: overlayTint });
}
