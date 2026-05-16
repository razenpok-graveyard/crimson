// Port of crimson/render/world/trooper.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import * as wgl from '@wgl';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { WEAPON_BY_ID } from '@crimson/weapons.ts';
import { RAD_TO_DEG } from './constants.ts';
import { WorldRenderCtx } from './context.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';

const _LAN_PLAYER_RING_RGB: [number, number, number][] = [
  // Match existing trooper torso tint colors for P1/P2.
  [77, 77, 255],
  [255, 140, 89],
  // Distinct colors for P3/P4 (4-player LAN readability).
  [90, 240, 255],
  [255, 120, 230],
];

function byteChannel(value: number): number {
  return int(clamp(value, 0.0, 1.0) * 255.0 + 0.5) / 255;
}

export function lanPlayerRingRgb(playerIndex: number): [number, number, number] {
  const idx = Math.max(0, Math.min(_LAN_PLAYER_RING_RGB.length - 1, int(playerIndex)));
  return _LAN_PLAYER_RING_RGB[idx];
}

function drawRing(
  center: Vec2,
  inner: number,
  outer: number,
  segments: number,
  color: wgl.Color,
): void {
  const white = wgl.getWhiteTexture();
  const step = (Math.PI * 2.0) / segments;
  wgl.beginQuads(white);
  wgl.rlTexCoord2f(0.5, 0.5);
  wgl.rlColor4f(color.r, color.g, color.b, color.a);
  for (let i = 0; i < segments; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    const cos0 = Math.cos(a0);
    const sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    wgl.rlVertex2f(center.x + cos0 * inner, center.y + sin0 * inner);
    wgl.rlVertex2f(center.x + cos0 * outer, center.y + sin0 * outer);
    wgl.rlVertex2f(center.x + cos1 * outer, center.y + sin1 * outer);
    wgl.rlVertex2f(center.x + cos1 * inner, center.y + sin1 * inner);
  }
  wgl.endQuads();
}

export function drawLanPlayerRing(
  renderCtx: WorldRenderCtx,
  opts: { player: PlayerState; screenPos: Vec2; baseSize: number; scale: number; alpha: number },
): void {
  const player = opts.player;
  const screenPos = opts.screenPos;
  const baseSize = opts.baseSize;
  const scale = opts.scale;
  let alpha = opts.alpha;
  const frame = renderCtx.frame;
  if (!frame.lanPlayerRingsEnabled) return;
  if (frame.players.length <= 1) return;
  if (player.health <= 0.0) return;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) return;

  const [red, green, blue] = lanPlayerRingRgb(player.index);
  const outer = Math.max(8.0 * scale, baseSize * 0.58);
  const thickness = Math.max(2.5 * scale, baseSize * 0.11);
  const inner = Math.max(0.0, outer - thickness);
  const glowOuter = outer + Math.max(2.0 * scale, baseSize * 0.08);
  const segments = Math.max(24, int(outer * 1.5 + 0.5));
  const center = new Vec2(screenPos.x, screenPos.y);
  const core = wgl.makeColor(red / 255, green / 255, blue / 255, byteChannel(alpha * 0.9));
  const glow = wgl.makeColor(red / 255, green / 255, blue / 255, byteChannel(alpha * 0.35));

  wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
  drawRing(center, inner, outer, segments, core);
  drawRing(center, outer, glowOuter, segments, glow);
  wgl.endBlendMode();
}

export function drawPlayerTrooperSprite(
  renderCtx: WorldRenderCtx,
  texture: wgl.Texture,
  player: PlayerState,
  opts: { camera: Vec2; viewScale: Vec2; scale: number; alpha?: number },
): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  const scale = opts.scale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) return;

  const renderFrame = renderCtx.frame;
  const resources = renderFrame.resources;
  const particlesTexture = getTexture(resources, TextureId.PARTICLES);
  const muzzleFlashTexture = getTexture(resources, TextureId.MUZZLE_FLASH);
  const spriteGrid = 8;
  const cell = spriteGrid > 0 ? texture.width / spriteGrid : texture.width;
  if (cell <= 0.0) return;

  const screenPos = WorldRenderCtx.worldToScreenWith(player.pos, { camera, viewScale });
  const baseSize = player.size * scale;
  const baseScale = baseSize / cell;

  drawLanPlayerRing(renderCtx, { player, screenPos, baseSize, scale, alpha });

  if (perkActive(player, PerkId.RADIOACTIVE) && alpha > 1e-3) {
    const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(EffectId.AURA);
    if (atlas !== undefined) {
      const auraGrid = SIZE_CODE_GRID.get(int(atlas.sizeCode));
      if (auraGrid) {
        const atlasFrame = int(atlas.frame);
        const col = atlasFrame % auraGrid;
        const row = Math.floor(atlasFrame / auraGrid);
        const cellW = particlesTexture.width / auraGrid;
        const cellH = particlesTexture.height / auraGrid;
        const src = wgl.makeRectangle(
          cellW * col, cellH * row,
          Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0),
        );
        const t = renderFrame.elapsedMs * 0.001;
        const auraAlpha = ((Math.sin(t) + 1.0) * 0.1875 + 0.25) * alpha;
        if (auraAlpha > 1e-3) {
          const size = 100.0 * scale;
          const dst = wgl.makeRectangle(screenPos.x, screenPos.y, size, size);
          const origin = wgl.makeVector2(size * 0.5, size * 0.5);
          const tint = wgl.makeColor(77 / 255, 153 / 255, 77 / 255, byteChannel(auraAlpha));
          wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
          wgl.drawTexturePro(particlesTexture, src, dst, origin, 0.0, tint);
          wgl.endBlendMode();
        }
      }
    }
  }

  const tint = wgl.makeColor(240 / 255, 240 / 255, 255 / 255, int(255 * alpha + 0.5) / 255);
  const shadowTint = wgl.makeColor(0, 0, 0, int(90 * alpha + 0.5) / 255);
  let overlayTint = tint;
  if (renderFrame.players.length > 1) {
    const index = int(player.index);
    if (index === 0) {
      overlayTint = wgl.makeColor(77 / 255, 77 / 255, 255 / 255, tint.a);
    } else {
      overlayTint = wgl.makeColor(255 / 255, 140 / 255, 89 / 255, tint.a);
    }
  }

  function draw(frameIdx: number, opts: { pos: Vec2; scaleMul: number; rotation: number; color: wgl.Color }): void {
    renderCtx.drawAtlasSprite(
      texture,
      {
        grid: spriteGrid,
        frame: Math.max(0, Math.min(63, int(frameIdx))),
        pos: opts.pos,
        scale: baseScale * opts.scaleMul,
        rotationRad: opts.rotation,
        tint: opts.color,
      },
    );
  }

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
      { pos: screenPos.offset({ dx: legShadowOff, dy: legShadowOff }),
      scaleMul: legShadowScale,
      rotation: player.heading,
      color: shadowTint },
    );
    draw(
      torsoFrame,
      { pos: screenPos.offset({ dx: recoilOffset.x + torsoShadowOff, dy: recoilOffset.y + torsoShadowOff }),
      scaleMul: torsoShadowScale,
      rotation: player.aimHeading,
      color: shadowTint },
    );

    draw(legFrame, { pos: screenPos, scaleMul: 1.0, rotation: player.heading, color: tint });
    draw(torsoFrame, { pos: screenPos.add(recoilOffset), scaleMul: 1.0, rotation: player.aimHeading, color: overlayTint });

    if (player.shieldTimer > 1e-3 && alpha > 1e-3) {
      const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(EffectId.SHIELD_RING);
      if (atlas !== undefined) {
        const shieldGrid = SIZE_CODE_GRID.get(int(atlas.sizeCode));
        if (shieldGrid) {
          const atlasFrame = int(atlas.frame);
          const col = atlasFrame % shieldGrid;
          const row = Math.floor(atlasFrame / shieldGrid);
          const cellW = particlesTexture.width / shieldGrid;
          const cellH = particlesTexture.height / shieldGrid;
          const src = wgl.makeRectangle(
            cellW * col, cellH * row,
            Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0),
          );
          const t = renderFrame.elapsedMs * 0.001;
          const timer = player.shieldTimer;
          let strength = (Math.sin(t) + 1.0) * 0.25 + timer;
          if (timer < 1.0) strength *= timer;
          strength = Math.min(1.0, strength) * alpha;
          if (strength > 1e-3) {
            const offsetDir = player.aimHeading - Math.PI / 2.0;
            const center = screenPos.add(Vec2.fromPolar(offsetDir, 3.0 * scale));

            let halfVal = Math.sin(t * 3.0) + 17.5;
            const size = halfVal * 2.0 * scale;
            const a = byteChannel(strength * 0.4);
            const shieldTint = wgl.makeColor(91 / 255, 180 / 255, 255 / 255, a);
            const dst = wgl.makeRectangle(center.x, center.y, size, size);
            const origin = wgl.makeVector2(size * 0.5, size * 0.5);
            const rotationDeg = (t + t) * RAD_TO_DEG;

            halfVal = Math.sin(t * 3.0) * 4.0 + 24.0;
            const size2 = halfVal * 2.0 * scale;
            const a2 = byteChannel(strength * 0.3);
            const shieldTint2 = wgl.makeColor(91 / 255, 180 / 255, 255 / 255, a2);
            const dst2 = wgl.makeRectangle(center.x, center.y, size2, size2);
            const origin2 = wgl.makeVector2(size2 * 0.5, size2 * 0.5);
            const rotation2Deg = (t * -2.0) * RAD_TO_DEG;

            wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
            wgl.drawTexturePro(particlesTexture, src, dst, origin, rotationDeg, shieldTint);
            wgl.drawTexturePro(particlesTexture, src, dst2, origin2, rotation2Deg, shieldTint2);
            wgl.endBlendMode();
          }
        }
      }
    }

    if (player.muzzleFlashAlpha > 1e-3 && alpha > 1e-3) {
      const weapon = WEAPON_BY_ID.get(player.weapon.weaponId)!;
      const flags = weapon.flags !== null ? int(weapon.flags) : 0;
      if ((flags & 0x8) === 0) {
        const flashAlpha = clamp(player.muzzleFlashAlpha * 0.8, 0.0, 1.0) * alpha;
        if (flashAlpha > 1e-3) {
          const size = baseSize * ((flags & 0x4) ? 0.5 : 1.0);
          const heading = player.aimHeading + Math.PI / 2.0;
          const offset = (player.muzzleFlashAlpha * 12.0 - 21.0) * scale;
          const flashPos = screenPos.add(Vec2.fromAngle(heading).mul(offset));
          const src = wgl.makeRectangle(
            0.0, 0.0, muzzleFlashTexture.width, muzzleFlashTexture.height,
          );
          const dst = wgl.makeRectangle(flashPos.x, flashPos.y, size, size);
          const origin = wgl.makeVector2(size * 0.5, size * 0.5);
          const tintFlash = wgl.makeColor(1, 1, 1, int(flashAlpha * 255.0 + 0.5) / 255);
          wgl.beginBlendMode(wgl.BlendMode.ADDITIVE);
          wgl.drawTexturePro(
            muzzleFlashTexture, src, dst, origin,
            player.aimHeading * RAD_TO_DEG, tintFlash,
          );
          wgl.endBlendMode();
        }
      }
    }
    return;
  }

  let deadFrame: number;
  if (player.deathTimer >= 0.0) {
    // Matches the observed frame ramp (32..52) in player_sprite_trace.jsonl.
    deadFrame = 32 + int((16.0 - player.deathTimer) * 1.25);
    if (deadFrame > 52) deadFrame = 52;
    if (deadFrame < 32) deadFrame = 32;
  } else {
    deadFrame = 52;
  }

  const deadShadowScale = 1.03;
  const deadShadowOff = 1.0 * scale + baseSize * (deadShadowScale - 1.0) * 0.5;
  draw(
    deadFrame,
    { pos: screenPos.offset({ dx: deadShadowOff, dy: deadShadowOff }),
    scaleMul: deadShadowScale,
    rotation: player.aimHeading,
    color: shadowTint },
  );
  draw(deadFrame, { pos: screenPos, scaleMul: 1.0, rotation: player.aimHeading, color: overlayTint });
}
