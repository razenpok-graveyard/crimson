// Port of crimson/render/world/bonuses.py

import { TextureId } from '@grim/assets.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import type { rl } from '@grim/raylib-api.ts';
import { BONUS_BY_ID, BonusId } from '@crimson/bonuses/index.ts';
import { bonusFindAimHoverEntry, bonusLabelForEntry } from '@crimson/bonuses/pool.ts';
import { WEAPON_BY_ID } from '@crimson/weapons.ts';
import { RAD_TO_DEG } from '@crimson/render/world/constants.ts';
import { WorldRenderCtx } from '@crimson/render/world/context.ts';
import * as wgl from '@wgl';

export function bonusIconSrc(texture: rl.Texture, iconId: number): rl.Rectangle {
  const grid = 4;
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  const col = int(iconId) % grid;
  const row = Math.floor(int(iconId) / grid);
  return wgl.makeRectangle(col * cellW, row * cellH, cellW, cellH);
}

export function weaponIconSrc(texture: rl.Texture, iconIndex: number): rl.Rectangle {
  const grid = 8;
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  const frame = int(iconIndex) * 2;
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  return wgl.makeRectangle(col * cellW, row * cellH, cellW * 2, cellH);
}

export function bonusFade(timeLeft: number, timeMax: number): number {
  if (timeLeft <= 0.0 || timeMax <= 0.0) {
    return 0.0;
  }
  if (timeLeft < 0.5) {
    return clamp(timeLeft * 2.0, 0.0, 1.0);
  }
  const age = timeMax - timeLeft;
  if (age < 0.5) {
    return clamp(age * 2.0, 0.0, 1.0);
  }
  return 1.0;
}

export function drawBonusPickups(renderCtx: WorldRenderCtx, opts: { camera: Vec2; viewScale: Vec2; scale: number; alpha?: number }): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  const scale = opts.scale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }
  const frame = renderCtx.frame;
  const resources = frame.resources;
  const bonusesTexture = resources.texture(TextureId.BONUSES);
  const wiconsTexture = resources.texture(TextureId.UI_WICONS);

  const bubbleSrc = bonusIconSrc(bonusesTexture, 0);
  const bubbleSize = 32.0 * scale;

  for (const [idx, bonus] of frame.state.bonusPool.entries.entries()) {
    if (bonus.bonusId === BonusId.UNUSED) {
      continue;
    }

    const fade = bonusFade(bonus.timeLeft, bonus.timeMax);
    const bubbleAlpha = clamp(fade * 0.9, 0.0, 1.0) * alpha;

    const screen = WorldRenderCtx.worldToScreenWith(bonus.pos, { camera: camera, viewScale: viewScale });
    const bubbleDst = wgl.makeRectangle(screen.x, screen.y, bubbleSize, bubbleSize);
    const bubbleOrigin = wgl.makeVector2(bubbleSize * 0.5, bubbleSize * 0.5);
    const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(bubbleAlpha * 255.0 + 0.5) / 255);
    wgl.drawTexturePro(bonusesTexture, bubbleSrc, bubbleDst, bubbleOrigin, 0.0, tint);

    const bonusId = bonus.bonusId;
    let pulse: number;
    let iconScale: number;
    let src: any;
    let dst: wgl.Rectangle;
    let origin: wgl.Vector2;
    if (bonusId === BonusId.WEAPON) {
      if (!WEAPON_BY_ID.has(bonus.amount)) {
        continue;
      }
      const weaponId = bonus.amount;
      const iconIndex = int(WEAPON_BY_ID.get(weaponId)!.iconIndex);
      if (!(0 <= iconIndex && iconIndex <= 31)) {
        continue;
      }

      pulse = Math.sin(frame.bonusAnimPhase) ** 4 * 0.25 + 0.75;
      iconScale = fade * pulse;
      if (iconScale <= 1e-3) {
        continue;
      }

      src = weaponIconSrc(wiconsTexture, iconIndex);
      const w = 60.0 * iconScale * scale;
      const h = 30.0 * iconScale * scale;
      dst = wgl.makeRectangle(screen.x, screen.y, w, h);
      origin = wgl.makeVector2(w * 0.5, h * 0.5);
      wgl.drawTexturePro(wiconsTexture, src, dst, origin, 0.0, tint);
      continue;
    }

    const meta = BONUS_BY_ID.get(bonusId) ?? null;
    let iconId = meta !== null && meta.iconId !== null ? int(meta.iconId) : null;
    if (iconId === null || iconId < 0) {
      continue;
    }
    if (bonusId === BonusId.POINTS && int(bonus.amount) === 1000) {
      iconId += 1;
    }

    pulse = Math.sin(idx + frame.bonusAnimPhase) ** 4 * 0.25 + 0.75;
    iconScale = fade * pulse;
    if (iconScale <= 1e-3) {
      continue;
    }

    src = bonusIconSrc(bonusesTexture, iconId);
    const size = 32.0 * iconScale * scale;
    const rotationRad = Math.sin(idx - frame.elapsedMs * 0.003) * 0.2;
    dst = wgl.makeRectangle(screen.x, screen.y, size, size);
    origin = wgl.makeVector2(size * 0.5, size * 0.5);
    wgl.drawTexturePro(bonusesTexture, src, dst, origin, rotationRad * RAD_TO_DEG, tint);
  }
}

export function drawBonusHoverLabels(renderCtx: WorldRenderCtx, opts: { camera: Vec2; viewScale: Vec2; alpha?: number }): void {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  let alpha = opts.alpha ?? 1.0;
  alpha = clamp(alpha, 0.0, 1.0);
  if (alpha <= 1e-3) {
    return;
  }

  const frame = renderCtx.frame;
  const font = frame.resources.smallFont;
  const textScale = 1.0;
  const screenW = wgl.getScreenWidth();

  const shadow = wgl.makeColor(0 / 255, 0 / 255, 0 / 255, int(180 * alpha + 0.5) / 255);
  const color = wgl.makeColor(230 / 255, 230 / 255, 230 / 255, int(255 * alpha + 0.5) / 255);

  for (const player of frame.players) {
    if (player.health <= 0.0) {
      continue;
    }
    const hovered = bonusFindAimHoverEntry(player, frame.state.bonusPool);
    if (hovered === null) {
      continue;
    }
    const [idx, entry] = hovered;
    const label = bonusLabelForEntry(entry, { preserveBugs: frame.state.preserveBugs });
    if (!label) {
      continue;
    }

    const aim = player.aim;
    const aimScreen = WorldRenderCtx.worldToScreenWith(aim, { camera: camera, viewScale: viewScale });
    let x = aimScreen.x + 16.0;
    const y = aimScreen.y - 7.0;

    let textW: number;
    if (font !== null) {
      textW = measureSmallTextWidth(font, label);
    } else {
      textW = wgl.measureText(label, int(18 * textScale));
    }
    if (x + textW > screenW) {
      x = Math.max(0.0, screenW - textW);
    }

    if (font !== null) {
      drawSmallText(font, label, new Vec2(x + 1.0, y + 1.0), shadow);
      drawSmallText(font, label, new Vec2(x, y), color);
    } else {
      wgl.drawText(label, int(x) + 1, int(y) + 1, int(18 * textScale), shadow);
      wgl.drawText(label, int(x), int(y), int(18 * textScale), color);
    }
  }
}
