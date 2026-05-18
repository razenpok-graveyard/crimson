// Port of crimson/ui/hud.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { rl } from '@grim/raylib-api.ts';
import type { BonusHudState } from '@crimson/bonuses/hud.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { survivalLevelThreshold } from '@crimson/gameplay.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import { WEAPON_BY_ID, weaponDisplayName } from '@crimson/weapons.ts';
import * as wgl from '@wgl';

export interface SmallFontLike {
  readonly cellSize: number;
}

export const HUD_TEXT_COLOR = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 255 / 255);
export const HUD_HINT_COLOR = wgl.makeColor(170 / 255, 170 / 255, 180 / 255, 255 / 255);
export const HUD_ACCENT_COLOR = wgl.makeColor(240 / 255, 200 / 255, 80 / 255, 255 / 255);
export const HUD_BASE_WIDTH = 1024.0;
export const HUD_BASE_HEIGHT = 768.0;
export const HUD_TOP_BAR_ALPHA = 0.7;
export const HUD_ICON_ALPHA = 0.8;
export const HUD_PANEL_ALPHA = 0.9;
export const HUD_HEALTH_BG_ALPHA = 0.5;
export const HUD_AMMO_DIM_ALPHA = 0.3;
export const HUD_TOP_BAR_POS = [0.0, 0.0] as const;
export const HUD_TOP_BAR_SIZE = [512.0, 64.0] as const;
export const HUD_HEART_CENTER = [27.0, 21.0] as const;
export const HUD_HEALTH_BAR_POS = [64.0, 16.0] as const;
export const HUD_HEALTH_BAR_SIZE = [120.0, 9.0] as const;
export const HUD_WEAPON_ICON_POS = [220.0, 2.0] as const;
export const HUD_WEAPON_ICON_SIZE = [64.0, 32.0] as const;
export const HUD_CLOCK_POS = [220.0, 2.0] as const;
export const HUD_CLOCK_SIZE = [32.0, 32.0] as const;
export const HUD_CLOCK_ALPHA = 0.9;
export const HUD_AMMO_BASE_POS = [300.0, 10.0] as const;
export const HUD_AMMO_BAR_SIZE = [6.0, 16.0] as const;
export const HUD_AMMO_BAR_STEP = 6.0;
export const HUD_AMMO_BAR_LIMIT = 30;
export const HUD_AMMO_BAR_CLAMP = 20;
export const HUD_AMMO_TEXT_OFFSET = [8.0, 1.0] as const;
export const HUD_SURV_PANEL_POS = [-68.0, 60.0] as const;
export const HUD_SURV_PANEL_SIZE = [182.0, 53.0] as const;
export const HUD_SURV_XP_LABEL_POS = [4.0, 78.0] as const;
export const HUD_SURV_XP_VALUE_POS = [26.0, 74.0] as const;
export const HUD_SURV_LVL_VALUE_POS = [85.0, 79.0] as const;
export const HUD_SURV_PROGRESS_POS = [26.0, 91.0] as const;
export const HUD_SURV_PROGRESS_WIDTH = 54.0;
export const HUD_BONUS_BASE_Y = 121.0;
export const HUD_BONUS_ICON_SIZE = 32.0;
export const HUD_BONUS_TEXT_OFFSET = [36.0, 6.0] as const;
export const HUD_BONUS_SPACING = 52.0;
export const HUD_BONUS_PANEL_OFFSET_Y = -11.0;
export const HUD_XP_BAR_RGBA = new RGBA(0.1, 0.3, 0.6, 1.0);
export const HUD_QUEST_LEFT_Y_SHIFT = 80.0;

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export class HudRenderFlags {
  readonly showHealth: boolean;
  readonly showWeapon: boolean;
  readonly showXp: boolean;
  readonly showTime: boolean;
  readonly showQuestHud: boolean;

  constructor(opts: {
    showHealth: boolean;
    showWeapon: boolean;
    showXp: boolean;
    showTime: boolean;
    showQuestHud: boolean;
  }) {
    this.showHealth = opts.showHealth;
    this.showWeapon = opts.showWeapon;
    this.showXp = opts.showXp;
    this.showTime = opts.showTime;
    this.showQuestHud = opts.showQuestHud;
  }
}

export class HudRenderContext {
  readonly resources: RuntimeResources;
  readonly state: HudState;
  readonly font: SmallFontData | null;
  readonly alpha: number;
  readonly showHealth: boolean;
  readonly showWeapon: boolean;
  readonly showXp: boolean;
  readonly showTime: boolean;
  readonly showQuestHud: boolean;
  readonly smallIndicators: boolean;

  constructor(opts: {
    resources: RuntimeResources;
    state: HudState;
    font?: SmallFontData | null;
    alpha?: number;
    showHealth?: boolean;
    showWeapon?: boolean;
    showXp?: boolean;
    showTime?: boolean;
    showQuestHud?: boolean;
    smallIndicators?: boolean;
  }) {
    this.resources = opts.resources;
    this.state = opts.state;
    this.font = opts.font ?? null;
    this.alpha = opts.alpha ?? 1.0;
    this.showHealth = opts.showHealth ?? true;
    this.showWeapon = opts.showWeapon ?? true;
    this.showXp = opts.showXp ?? true;
    this.showTime = opts.showTime ?? false;
    this.showQuestHud = opts.showQuestHud ?? false;
    this.smallIndicators = opts.smallIndicators ?? false;
  }
}

export class HudState {
  survivalXpSmoothed: number;
  preserveBugs: boolean;

  constructor(opts: {
    survivalXpSmoothed?: number;
    preserveBugs?: boolean;
  } = {}) {
    this.survivalXpSmoothed = opts.survivalXpSmoothed ?? 0;
    this.preserveBugs = opts.preserveBugs ?? false;
  }

  smoothXp(opts: { target: number; frameDtMs: number }): number;
  smoothXp(target: number, frameDtMs: number): number;
  smoothXp(targetOrOpts: number | { target: number; frameDtMs: number }, frameDtMsArg: number | undefined = undefined): number {
    let target: number = typeof targetOrOpts === 'object' && targetOrOpts !== null ? targetOrOpts.target : targetOrOpts as number;
    const frameDtMs: number = typeof targetOrOpts === 'object' && targetOrOpts !== null ? targetOrOpts.frameDtMs : frameDtMsArg as number;
    target = int(target);
    if (target <= 0) {
      this.survivalXpSmoothed = 0;
      return 0;
    }

    let smoothed = int(this.survivalXpSmoothed);
    if (smoothed === target) {
      return smoothed;
    }

    let step = Math.max(1, Math.floor(int(frameDtMs) / 2));
    const diff = Math.abs(smoothed - target);
    if (diff > 1000) {
      step *= Math.floor(diff / 100);
    }

    if (smoothed < target) {
      smoothed += step;
      if (smoothed > target) {
        smoothed = target;
      }
    } else {
      smoothed -= step;
      if (smoothed < target) {
        smoothed = target;
      }
    }

    this.survivalXpSmoothed = smoothed;
    return smoothed;
  }
}

export class HudLayout {
  readonly scale: number;
  readonly textScale: number;
  readonly lineH: number;
  readonly hudYShift: number;

  constructor(opts: {
    scale: number;
    textScale: number;
    lineH: number;
    hudYShift: number;
  }) {
    this.scale = opts.scale;
    this.textScale = opts.textScale;
    this.lineH = opts.lineH;
    this.hudYShift = opts.hudYShift;
  }
}

export function hudFlagsForGameMode(gameModeId: GameMode): HudRenderFlags {
  // Match `hud_update_and_render` (0x0041ca90) flag mapping.

  switch (gameModeId) {
    case GameMode.QUESTS:
      return new HudRenderFlags({ showHealth: true, showWeapon: true, showXp: true, showTime: false, showQuestHud: true });
    case GameMode.SURVIVAL:
      return new HudRenderFlags({ showHealth: true, showWeapon: true, showXp: true, showTime: false, showQuestHud: false });
    case GameMode.RUSH:
      return new HudRenderFlags({ showHealth: true, showWeapon: false, showXp: false, showTime: true, showQuestHud: false });
    case GameMode.TYPO:
      return new HudRenderFlags({ showHealth: true, showWeapon: false, showXp: true, showTime: true, showQuestHud: false });
    default:
      return new HudRenderFlags({ showHealth: false, showWeapon: false, showXp: false, showTime: false, showQuestHud: false });
  }
}

export function hudUiScale(screenW: number, screenH: number): number {
  const scale = Math.min(screenW / HUD_BASE_WIDTH, screenH / HUD_BASE_HEIGHT);
  if (scale < 0.75) {
    return 0.75;
  }
  if (scale > 1.5) {
    return 1.5;
  }
  return scale;
}

export function hudLayout(screenW: number, screenH: number, opts: { font: SmallFontLike | null; showQuestHud: boolean }): HudLayout {
  const font = opts.font;
  const showQuestHud = opts.showQuestHud;
  const scale = hudUiScale(screenW, screenH);
  const textScale = 1.0 * scale;
  const lineH = font !== null ? font.cellSize * textScale : 18.0 * textScale;
  const hudYShift = showQuestHud ? HUD_QUEST_LEFT_Y_SHIFT : 0.0;
  return new HudLayout({ scale: scale, textScale: textScale, lineH: lineH, hudYShift: hudYShift });
}

function drawText(font: SmallFontData | null, text: string, pos: Vec2, scale: number, color: wgl.Color): void {
  if (font !== null) {
    drawSmallText(font, text, pos, color);
  } else {
    wgl.drawText(text, int(pos.x), int(pos.y), int(18 * scale), color);
  }
}

function withAlpha(color: wgl.Color, alpha: number): wgl.Color {
  alpha = Math.max(0.0, Math.min(1.0, alpha));
  return wgl.makeColor(color.r * 255 / 255, color.g * 255 / 255, color.b * 255 / 255, int(color.a * 255 * alpha) / 255);
}

function questPanelSlideX(timeMs: number): number {
  if (timeMs < 1000.0) {
    return (1000.0 - timeMs) * -0.128;
  }
  return 0.0;
}

function survivalXpProgressRatio(opts: { xp: number; level: number }): number {
  const xp = opts.xp;
  let level = opts.level;
  level = Math.max(1, int(level));
  const prevThreshold = level <= 1 ? 0 : survivalLevelThreshold(level - 1);
  const nextThreshold = survivalLevelThreshold(level);
  if (nextThreshold <= prevThreshold) {
    return 0.0;
  }
  return (int(xp) - prevThreshold) / (nextThreshold - prevThreshold);
}

function drawProgressBar(pos: Vec2, width: number, ratio: number, rgba: RGBA, scale: number): void {
  ratio = Math.max(0.0, Math.min(1.0, ratio));
  width = Math.max(0.0, width);
  if (width <= 0.0) {
    return;
  }
  rgba = rgba.clamped();
  const barH = 4.0 * scale;
  const innerH = 2.0 * scale;
  const bgColor = wgl.makeColor(int(255 * rgba.r * 0.6) / 255, int(255 * rgba.g * 0.6) / 255, int(255 * rgba.b * 0.6) / 255, int(255 * rgba.a * 0.4) / 255);
  const fgColor = wgl.makeColor(int(255 * rgba.r) / 255, int(255 * rgba.g) / 255, int(255 * rgba.b) / 255, int(255 * rgba.a) / 255);
  wgl.drawRectangle(int(pos.x), int(pos.y), int(width), int(barH), bgColor);
  const innerW = Math.max(0.0, (width - 2.0 * scale) * ratio);
  wgl.drawRectangle(int(pos.x + scale), int(pos.y + scale), int(innerW), int(innerH), fgColor);
}

export function drawTargetHealthBar(opts: { pos: Vec2; width: number; ratio: number; alpha?: number; scale?: number }): void {
  const pos = opts.pos;
  const width = opts.width;
  let ratio = opts.ratio;
  let alpha = opts.alpha ?? 1.0;
  let scale = opts.scale ?? 1.0;
  ratio = Math.max(0.0, Math.min(1.0, ratio));
  alpha = Math.max(0.0, Math.min(1.0, alpha));
  scale = Math.max(0.1, scale);

  // Matches `hud_update_and_render` (0x0041ca90): color shifts from red->green as ratio increases.
  const r = (1.0 - ratio) * 0.9 + 0.1;
  const g = ratio * 0.9 + 0.1;
  const rgba = new RGBA(r, g, 0.7, 0.2 * alpha);
  drawProgressBar(pos, width, ratio, rgba, scale);
}

function weaponIconIndex(weaponId: number): number | null {
  const iconIndex = int(mapGetOrThrow(WEAPON_BY_ID, weaponId).iconIndex);
  if (iconIndex < 0 || iconIndex > 31) {
    return null;
  }
  return iconIndex;
}

function weaponAmmoClass(weaponId: number): number {
  const value = mapGetOrThrow(WEAPON_BY_ID, weaponId).ammoClass;
  return value !== null ? int(value) : 0;
}

function weaponIconSrc(texture: rl.Texture, iconIndex: number): wgl.Rectangle {
  const grid = 8;
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  const frame = int(iconIndex) * 2;
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  return wgl.makeRectangle(col * cellW, row * cellH, cellW * 2, cellH);
}

function bonusIconSrc(texture: rl.Texture, iconId: number): wgl.Rectangle {
  const grid = 4;
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  const col = int(iconId) % grid;
  const row = Math.floor(int(iconId) / grid);
  return wgl.makeRectangle(col * cellW, row * cellH, cellW, cellH);
}

export function drawHudOverlay(context: HudRenderContext, opts: { player: PlayerState; players?: PlayerState[] | null; bonusHud?: BonusHudState | null; elapsedMs?: number; score?: number | null; frameDtMs?: number | null; questProgressRatio?: number | null }): number {
  const player = opts.player;
  const players = opts.players ?? null;
  const bonusHud = opts.bonusHud ?? null;
  const elapsedMs = opts.elapsedMs ?? 0.0;
  const score = opts.score ?? null;
  let frameDtMs = opts.frameDtMs ?? null;
  const questProgressRatio = opts.questProgressRatio ?? null;
  const resources = context.resources;
  const state = context.state;
  const font = context.font;
  let alpha = context.alpha;
  const showHealth = context.showHealth;
  const showWeapon = context.showWeapon;
  const showXp = context.showXp;
  const showTime = context.showTime;
  const showQuestHud = context.showQuestHud;
  const smallIndicators = context.smallIndicators;
  const gameTop = resources.texture(TextureId.UI_GAME_TOP);
  const lifeHeart = resources.texture(TextureId.UI_LIFE_HEART);
  const indLife = resources.texture(TextureId.UI_IND_LIFE);
  const indPanel = resources.texture(TextureId.UI_IND_PANEL);
  const indBullet = resources.texture(TextureId.UI_IND_BULLET);
  const indFire = resources.texture(TextureId.UI_IND_FIRE);
  const indRocket = resources.texture(TextureId.UI_IND_ROCKET);
  const indElectric = resources.texture(TextureId.UI_IND_ELECTRIC);
  const wicons = resources.texture(TextureId.UI_WICONS);
  const clockTable = resources.texture(TextureId.UI_CLOCK_TABLE);
  const clockPointer = resources.texture(TextureId.UI_CLOCK_POINTER);
  const bonusesTexture = resources.texture(TextureId.BONUSES);

  if (frameDtMs === null) {
    frameDtMs = Math.max(0.0, wgl.getFrameTime() * 1000.0);
  }
  let hudPlayers = players !== null ? Array.from(players) : [player];
  if (hudPlayers.length === 0) {
    hudPlayers = [player];
  }
  const playerCount = hudPlayers.length;

  const screenW = wgl.getScreenWidth();
  const screenH = wgl.getScreenHeight();
  const layout = hudLayout(screenW, screenH, { font: font, showQuestHud: showQuestHud });
  const scale = layout.scale;
  const textScale = layout.textScale;
  const lineH = layout.lineH;

  const ui = (value: number): number => {
    return value * scale;
  };

  let maxY = 0.0;
  alpha = Math.max(0.0, Math.min(1.0, alpha));
  const textColor = withAlpha(HUD_TEXT_COLOR, alpha);
  const panelTextColor = withAlpha(HUD_TEXT_COLOR, alpha * HUD_PANEL_ALPHA);
  const hudYShift = layout.hudYShift;

  // Top bar background.
  let src: rl.Rectangle | wgl.Rectangle = wgl.makeRectangle(0.0, 0.0, gameTop.width, gameTop.height);
  let dst = wgl.makeRectangle(ui(HUD_TOP_BAR_POS[0]), ui(HUD_TOP_BAR_POS[1]), ui(HUD_TOP_BAR_SIZE[0]), ui(HUD_TOP_BAR_SIZE[1]));
  const topAlpha = alpha * HUD_TOP_BAR_ALPHA;
  wgl.drawTexturePro(gameTop, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * topAlpha) / 255));
  maxY = Math.max(maxY, dst.y + dst.h);

  // Pulsing heart.
  if (showHealth) {
    const t = Math.max(0.0, elapsedMs) / 1000.0;
    src = wgl.makeRectangle(0.0, 0.0, lifeHeart.width, lifeHeart.height);
    let heartCenterBase: Vec2;
    let heartStep: Vec2;
    let heartScale: number;
    if (playerCount === 1) {
      heartCenterBase = new Vec2(...HUD_HEART_CENTER);
      heartStep = new Vec2();
      heartScale = 1.0;
    } else {
      heartCenterBase = new Vec2(27.0, 12.0);
      heartStep = new Vec2(0.0, 15.0);
      heartScale = 0.5;
    }
    const player0LowHealth = playerCount > 0 && hudPlayers[0].health < 30.0;

    for (const [idx, hudPlayer] of hudPlayers.entries()) {
      let pulseSpeed = hudPlayer.health < 30.0 ? 5.0 : 2.0;
      if (state.preserveBugs && playerCount > 1 && idx > 0 && player0LowHealth) {
        // Native 2-player HUD uses player 1 low-health pulse speed as a
        // shared baseline for later player heart pulses.
        pulseSpeed = 5.0;
      }
      const phase = idx * (Math.PI * 0.5);
      const pulse = ((Math.sin(t * pulseSpeed + phase) ** 4) * 4.0 + 14.0) * heartScale;
      const size = pulse * 2.0;
      const center = heartCenterBase.add(heartStep.mul(idx));
      dst = wgl.makeRectangle(ui(center.x - pulse), ui(center.y - pulse), ui(size), ui(size));
      wgl.drawTexturePro(lifeHeart, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha * HUD_ICON_ALPHA) / 255));
      maxY = Math.max(maxY, dst.y + dst.h);
    }
  }

  // Health bar.
  let barBasePos: Vec2;
  let barPos: Vec2;
  if (showHealth) {
    barBasePos = new Vec2(...HUD_HEALTH_BAR_POS);
    const barSize = new Vec2(...HUD_HEALTH_BAR_SIZE);
    const bgSrc = wgl.makeRectangle(0.0, 0.0, indLife.width, indLife.height);
    if (playerCount > 1) {
      barBasePos = new Vec2(barBasePos.x, 6.0);
    }

    for (const [idx, hudPlayer] of hudPlayers.entries()) {
      barPos = barBasePos.offset({ dy: playerCount > 1 ? idx * 16.0 : 0.0 });
      const bgDst = wgl.makeRectangle(ui(barPos.x), ui(barPos.y), ui(barSize.x), ui(barSize.y));
      wgl.drawTexturePro(indLife, bgSrc, bgDst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha * HUD_HEALTH_BG_ALPHA) / 255));
      const healthRatio = Math.max(0.0, Math.min(1.0, hudPlayer.health / 100.0));
      if (healthRatio > 0.0) {
        const fillW = barSize.x * healthRatio;
        const fillDst = wgl.makeRectangle(ui(barPos.x), ui(barPos.y), ui(fillW), ui(barSize.y));
        const fillSrc = wgl.makeRectangle(0.0, 0.0, indLife.width * healthRatio, indLife.height);
        wgl.drawTexturePro(indLife, fillSrc, fillDst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha * HUD_ICON_ALPHA) / 255));
      }
      maxY = Math.max(maxY, bgDst.y + bgDst.h);
    }
  }

  // Weapon icon.
  let iconIndex: number | null;
  let iconPos: Vec2;
  if (showWeapon) {
    let iconBasePos: Vec2;
    let iconSize: Vec2;
    let iconStep: Vec2;
    if (playerCount === 1) {
      iconBasePos = new Vec2(...HUD_WEAPON_ICON_POS);
      iconSize = new Vec2(...HUD_WEAPON_ICON_SIZE);
      iconStep = new Vec2();
    } else {
      iconBasePos = new Vec2(220.0, 4.0);
      iconSize = new Vec2(32.0, 16.0);
      iconStep = new Vec2(0.0, 16.0);
    }

    for (const [idx, hudPlayer] of hudPlayers.entries()) {
      iconIndex = weaponIconIndex(hudPlayer.weapon.weaponId);
      if (iconIndex === null) {
        continue;
      }
      src = weaponIconSrc(wicons, iconIndex);
      iconPos = iconBasePos.add(iconStep.mul(idx));
      dst = wgl.makeRectangle(ui(iconPos.x), ui(iconPos.y), ui(iconSize.x), ui(iconSize.y));
      wgl.drawTexturePro(wicons, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha * HUD_ICON_ALPHA) / 255));
      maxY = Math.max(maxY, dst.y + dst.h);
    }
  }

  // Ammo bars.
  let textPos: Vec2;
  if (showWeapon) {
    let ammoBasePos: Vec2;
    let ammoStep: Vec2;
    if (playerCount === 1) {
      ammoBasePos = new Vec2(...HUD_AMMO_BASE_POS);
      ammoStep = new Vec2();
    } else {
      ammoBasePos = new Vec2(290.0, 4.0);
      ammoStep = new Vec2(0.0, 14.0);
    }

    const baseAlpha = alpha * HUD_ICON_ALPHA;
    for (const [playerIdx, hudPlayer] of hudPlayers.entries()) {
      const ammoClass = weaponAmmoClass(hudPlayer.weapon.weaponId);
      let ammoTex: typeof indFire | typeof indRocket | typeof indBullet | typeof indElectric;
      if (ammoClass === 1) {
        ammoTex = indFire;
      } else if (ammoClass === 2) {
        ammoTex = indRocket;
      } else if (ammoClass === 0) {
        ammoTex = indBullet;
      } else {
        ammoTex = indElectric;
      }

      const playerAmmoBase = ammoBasePos.add(ammoStep.mul(playerIdx));
      let bars = Math.max(0, int(hudPlayer.weapon.clipSize));
      if (bars > HUD_AMMO_BAR_LIMIT) {
        bars = HUD_AMMO_BAR_CLAMP;
      }
      const ammoCount = Math.max(0, int(hudPlayer.weapon.ammo));
      for (let idx = 0; idx < bars; idx++) {
        const barAlpha = idx < ammoCount ? baseAlpha : baseAlpha * HUD_AMMO_DIM_ALPHA;
        barPos = playerAmmoBase.offset({ dx: idx * HUD_AMMO_BAR_STEP });
        dst = wgl.makeRectangle(ui(barPos.x), ui(barPos.y), ui(HUD_AMMO_BAR_SIZE[0]), ui(HUD_AMMO_BAR_SIZE[1]));
        src = wgl.makeRectangle(0.0, 0.0, ammoTex.width, ammoTex.height);
        wgl.drawTexturePro(ammoTex, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * barAlpha) / 255));
        maxY = Math.max(maxY, dst.y + dst.h);
      }
      if (ammoCount > bars) {
        const extra = ammoCount - bars;
        textPos = playerAmmoBase.add(new Vec2(bars * HUD_AMMO_BAR_STEP + HUD_AMMO_TEXT_OFFSET[0], HUD_AMMO_TEXT_OFFSET[1]));
        drawText(font, `+ ${extra}`, new Vec2(ui(textPos.x), ui(textPos.y)), textScale, textColor);
      }
    }
  }

  // Quest HUD panels (mm:ss timer + progress).
  let timeMs: any;
  let slideX!: number;
  let clockSize: Vec2;
  let rotation: number;
  let origin: wgl.Vector2;
  let totalSeconds: number;
  let seconds!: number;
  if (showQuestHud) {
    timeMs = Math.max(0.0, elapsedMs);
    slideX = questPanelSlideX(timeMs);

    const questPanelAlpha = alpha * 0.7;
    const questTextColor = withAlpha(HUD_TEXT_COLOR, questPanelAlpha);

    src = wgl.makeRectangle(0.0, 0.0, indPanel.width, indPanel.height);

    // Sliding top panel (first second).
    const slidePanelPos = new Vec2(slideX - 90.0, 67.0);
    const slidePanelSize = new Vec2(182.0, 53.0);
    dst = wgl.makeRectangle(ui(slidePanelPos.x), ui(slidePanelPos.y), ui(slidePanelSize.x), ui(slidePanelSize.y));
    wgl.drawTexturePro(indPanel, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * questPanelAlpha) / 255));
    maxY = Math.max(maxY, dst.y + dst.h);

    // Static progress panel.
    const progressPanelPos = new Vec2(-80.0, 107.0);
    const progressPanelSize = new Vec2(182.0, 53.0);
    dst = wgl.makeRectangle(ui(progressPanelPos.x), ui(progressPanelPos.y), ui(progressPanelSize.x), ui(progressPanelSize.y));
    wgl.drawTexturePro(indPanel, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * questPanelAlpha) / 255));
    maxY = Math.max(maxY, dst.y + dst.h);

    // Clock table + pointer inside the sliding panel.
    const clockAlpha = alpha * HUD_CLOCK_ALPHA;
    const clockTablePos = new Vec2(slideX + 2.0, 78.0);
    clockSize = new Vec2(32.0, 32.0);
    dst = wgl.makeRectangle(ui(clockTablePos.x), ui(clockTablePos.y), ui(clockSize.x), ui(clockSize.y));
    src = wgl.makeRectangle(0.0, 0.0, clockTable.width, clockTable.height);
    wgl.drawTexturePro(clockTable, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * clockAlpha) / 255));

    // NOTE: Raylib's draw_texture_pro uses dst.x/y as the rotation origin position;
    // offset by half-size so the 32x32 quad stays aligned with the table.
    const clockPointerPos = new Vec2(slideX + 18.0, 94.0);
    clockSize = new Vec2(32.0, 32.0);
    dst = wgl.makeRectangle(ui(clockPointerPos.x), ui(clockPointerPos.y), ui(clockSize.x), ui(clockSize.y));
    src = wgl.makeRectangle(0.0, 0.0, clockPointer.width, clockPointer.height);
    rotation = timeMs / 1000.0 * 6.0;
    origin = wgl.makeVector2(ui(16.0), ui(16.0));
    wgl.drawTexturePro(clockPointer, src, dst, origin, rotation, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * clockAlpha) / 255));

    totalSeconds = Math.max(0, Math.floor(int(timeMs) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    seconds = totalSeconds % 60;
    const timePos = new Vec2(slideX + 32.0, 86.0);
    drawText(font, `${minutes}:${String(seconds).padStart(2, '0')}`, new Vec2(ui(timePos.x), ui(timePos.y)), textScale, questTextColor);

    const progressLabelPos = new Vec2(18.0, 122.0);
    drawText(font, 'Progress', new Vec2(ui(progressLabelPos.x), ui(progressLabelPos.y)), textScale, questTextColor);

    if (questProgressRatio !== null) {
      const ratio = Math.max(0.0, Math.min(1.0, questProgressRatio));
      const questBarRgba = new RGBA(0.2, 0.8, 0.3, alpha * 0.8);
      const progressBarPos = new Vec2(10.0, 139.0);
      drawProgressBar(new Vec2(ui(progressBarPos.x), ui(progressBarPos.y)), ui(70.0), ratio, questBarRgba, scale);
    }
  }

  // Survival XP panel.
  const xpTarget = int(score === null ? player.experience : score);
  const xpDisplay = showXp ? state.smoothXp(xpTarget, frameDtMs) : xpTarget;
  let panelPos: Vec2;
  let panelSize: Vec2;
  if (showXp) {
    panelPos = new Vec2(...HUD_SURV_PANEL_POS).offset({ dy: hudYShift });
    panelSize = new Vec2(...HUD_SURV_PANEL_SIZE);
    dst = wgl.makeRectangle(ui(panelPos.x), ui(panelPos.y), ui(panelSize.x), ui(panelSize.y));
    src = wgl.makeRectangle(0.0, 0.0, indPanel.width, indPanel.height);
    wgl.drawTexturePro(indPanel, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha * HUD_PANEL_ALPHA) / 255));
    maxY = Math.max(maxY, dst.y + dst.h);
  }

  let barRgba: any;
  if (showXp) {
    const xpLabelPos = new Vec2(...HUD_SURV_XP_LABEL_POS).offset({ dy: hudYShift });
    const xpValuePos = new Vec2(...HUD_SURV_XP_VALUE_POS).offset({ dy: hudYShift });
    const lvlValuePos = new Vec2(...HUD_SURV_LVL_VALUE_POS).offset({ dy: hudYShift });
    drawText(font, 'Xp', new Vec2(ui(xpLabelPos.x), ui(xpLabelPos.y)), textScale, panelTextColor);
    drawText(font, `${xpDisplay}`, new Vec2(ui(xpValuePos.x), ui(xpValuePos.y)), textScale, panelTextColor);
    drawText(font, `${int(player.level)}`, new Vec2(ui(lvlValuePos.x), ui(lvlValuePos.y)), textScale, panelTextColor);

    const progressRatio = survivalXpProgressRatio({ xp: xpTarget, level: int(player.level) });
    const progressPos = new Vec2(...HUD_SURV_PROGRESS_POS).offset({ dy: hudYShift });
    barRgba = HUD_XP_BAR_RGBA.scaledAlpha(alpha);
    drawProgressBar(new Vec2(ui(progressPos.x), ui(progressPos.y)), ui(HUD_SURV_PROGRESS_WIDTH), progressRatio, barRgba, scale);
    maxY = Math.max(maxY, ui(progressPos.y + 4.0));
  }

  // Mode time clock/text (rush/typo-style HUD).
  if (showTime) {
    timeMs = Math.max(0.0, elapsedMs);
    const clockPos = new Vec2(...HUD_CLOCK_POS);
    clockSize = new Vec2(...HUD_CLOCK_SIZE);
    dst = wgl.makeRectangle(ui(clockPos.x), ui(clockPos.y), ui(clockSize.x), ui(clockSize.y));
    src = wgl.makeRectangle(0.0, 0.0, clockTable.width, clockTable.height);
    wgl.drawTexturePro(clockTable, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha * HUD_CLOCK_ALPHA) / 255));
    maxY = Math.max(maxY, dst.y + dst.h);
    // NOTE: Raylib's draw_texture_pro uses dst.x/y as the rotation origin position;
    // offset by half-size so the 32x32 quad stays aligned with the table.
    const clockCenter = clockPos.add(clockSize.mul(0.5));
    dst = wgl.makeRectangle(ui(clockCenter.x), ui(clockCenter.y), ui(clockSize.x), ui(clockSize.y));
    src = wgl.makeRectangle(0.0, 0.0, clockPointer.width, clockPointer.height);
    rotation = timeMs / 1000.0 * 6.0;
    origin = wgl.makeVector2(ui(clockSize.x * 0.5), ui(clockSize.y * 0.5));
    wgl.drawTexturePro(clockPointer, src, dst, origin, rotation, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha * HUD_CLOCK_ALPHA) / 255));
    totalSeconds = Math.max(0, Math.floor(int(timeMs) / 1000));
    const timeText = `${totalSeconds} seconds`;
    drawText(font, timeText, new Vec2(ui(255.0), ui(10.0)), textScale, textColor);
    maxY = Math.max(maxY, ui(10.0 + lineH));
  }

  // Bonus HUD slots (icon + timers), slide in/out from the left.
  let bonusBottomY = (HUD_BONUS_BASE_Y + hudYShift);
  let bonusY: number;
  if (bonusHud !== null) {
    bonusY = (HUD_BONUS_BASE_Y + hudYShift);
    const bonusPanelAlpha = alpha * 0.7;
    const bonusTextColor = withAlpha(HUD_TEXT_COLOR, bonusPanelAlpha);
    barRgba = HUD_XP_BAR_RGBA.withAlpha(bonusPanelAlpha);

    const slots = bonusHud.slots.slice(0, 16);
    for (const slot of slots) {
      if (!slot.active) {
        continue;
      }

      if (slot.slideX < -184.0) {
        bonusY += HUD_BONUS_SPACING;
        continue;
      }
      const slotPos = new Vec2(slot.slideX, bonusY);

      const hasAlt = slot.timerRefAlt !== null && playerCount > 1;
      const timer = slot.timerValue;
      const timerAlt = hasAlt ? slot.timerValueAlt : 0.0;

      // Slot panel.
      if (!smallIndicators) {
        panelPos = slotPos.offset({ dy: HUD_BONUS_PANEL_OFFSET_Y });
        panelSize = new Vec2(182.0, 53.0);
      } else {
        panelPos = slotPos.add(new Vec2(-96.0, 5.0));
        panelSize = new Vec2(182.0, 26.5);
      }

      src = wgl.makeRectangle(0.0, 0.0, indPanel.width, indPanel.height);
      dst = wgl.makeRectangle(ui(panelPos.x), ui(panelPos.y), ui(panelSize.x), ui(panelSize.y));
      wgl.drawTexturePro(indPanel, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * bonusPanelAlpha) / 255));
      maxY = Math.max(maxY, dst.y + dst.h);

      // Slot icon.
      if (slot.iconId >= 0) {
        src = bonusIconSrc(bonusesTexture, slot.iconId);
        iconPos = slotPos.offset({ dx: -1.0 });
        dst = wgl.makeRectangle(ui(iconPos.x), ui(iconPos.y), ui(HUD_BONUS_ICON_SIZE), ui(HUD_BONUS_ICON_SIZE));
        wgl.drawTexturePro(bonusesTexture, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha) / 255));
        maxY = Math.max(maxY, dst.y + dst.h);
      }

      // Slot timer bars.
      if (!smallIndicators) {
        let timerPos: Vec2;
        let labelPos: Vec2;
        let timer0Pos: Vec2;
        let timer1Pos: Vec2;
        if (!hasAlt) {
          timerPos = slotPos.add(new Vec2(36.0, 21.0));
          drawProgressBar(new Vec2(ui(timerPos.x), ui(timerPos.y)), ui(100.0), timer * 0.05, barRgba, scale);
          labelPos = slotPos.add(new Vec2(36.0, 6.0));
          drawText(font, slot.label, new Vec2(ui(labelPos.x), ui(labelPos.y)), textScale, bonusTextColor);
        } else {
          timer0Pos = slotPos.add(new Vec2(36.0, 17.0));
          drawProgressBar(new Vec2(ui(timer0Pos.x), ui(timer0Pos.y)), ui(100.0), timer * 0.05, barRgba, scale);
          timer1Pos = slotPos.add(new Vec2(36.0, 23.0));
          drawProgressBar(new Vec2(ui(timer1Pos.x), ui(timer1Pos.y)), ui(100.0), timerAlt * 0.05, barRgba, scale);
          labelPos = slotPos.add(new Vec2(36.0, 2.0));
          drawText(font, slot.label, new Vec2(ui(labelPos.x), ui(labelPos.y)), textScale, bonusTextColor);
        }
      } else {
        let timerPos: Vec2;
        let timer0Pos: Vec2;
        let timer1Pos: Vec2;
        if (!hasAlt) {
          timerPos = slotPos.add(new Vec2(36.0, 17.0));
          drawProgressBar(new Vec2(ui(timerPos.x), ui(timerPos.y)), ui(32.0), timer * 0.05, barRgba, scale);
        } else {
          timer0Pos = slotPos.add(new Vec2(36.0, 13.0));
          drawProgressBar(new Vec2(ui(timer0Pos.x), ui(timer0Pos.y)), ui(32.0), timer * 0.05, barRgba, scale);
          timer1Pos = slotPos.add(new Vec2(36.0, 19.0));
          drawProgressBar(new Vec2(ui(timer1Pos.x), ui(timer1Pos.y)), ui(32.0), timerAlt * 0.05, barRgba, scale);
        }
      }

      bonusY += HUD_BONUS_SPACING;
      maxY = Math.max(maxY, ui(bonusY));
    }
    bonusBottomY = bonusY;
  }

  // Weapon aux timer overlay (weapon name popup).
  const auxPanelBasePos = new Vec2(-12.0, bonusBottomY - 17.0);
  const auxIconBasePos = new Vec2(105.0, bonusBottomY - 5.0);
  const auxTextBasePos = new Vec2(8.0, bonusBottomY + 1.0);
  const auxStep = new Vec2(0.0, 32.0);
  for (const [idx, hudPlayer] of hudPlayers.entries()) {
    const auxTimer = hudPlayer.auxTimer;
    if (auxTimer <= 0.0) {
      continue;
    }

    let fade = auxTimer > 1.0 ? 2.0 - auxTimer : auxTimer;
    fade = Math.max(0.0, Math.min(1.0, fade)) * alpha;
    if (fade <= 1e-3) {
      continue;
    }

    const panelAlpha = fade * 0.8;
    const textAlpha = fade;

    panelPos = auxPanelBasePos.add(auxStep.mul(idx));
    panelSize = new Vec2(182.0, 53.0);

    src = wgl.makeRectangle(0.0, 0.0, indPanel.width, indPanel.height);
    dst = wgl.makeRectangle(ui(panelPos.x), ui(panelPos.y), ui(panelSize.x), ui(panelSize.y));
    wgl.drawTexturePro(indPanel, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * panelAlpha) / 255));
    maxY = Math.max(maxY, dst.y + dst.h);

    iconIndex = weaponIconIndex(hudPlayer.weapon.weaponId);
    if (iconIndex !== null) {
      src = weaponIconSrc(wicons, iconIndex);
      iconPos = auxIconBasePos.add(auxStep.mul(idx));
      dst = wgl.makeRectangle(ui(iconPos.x), ui(iconPos.y), ui(60.0), ui(30.0));
      wgl.drawTexturePro(wicons, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * panelAlpha) / 255));
      maxY = Math.max(maxY, dst.y + dst.h);
    }

    const weaponName = weaponDisplayName(hudPlayer.weapon.weaponId, { preserveBugs: state.preserveBugs });
    const weaponColor = withAlpha(HUD_TEXT_COLOR, textAlpha);
    textPos = auxTextBasePos.add(auxStep.mul(idx));
    drawText(font, weaponName, new Vec2(ui(textPos.x), ui(textPos.y)), textScale, weaponColor);
  }

  return maxY;
}
