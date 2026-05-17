// Port of crimson/screens/boot.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId, loadRuntimeResources, unloadRuntimeResources } from '@grim/assets.ts';
import { initAudioState, playMusic, shutdownAudio, stopMusic, updateAudio } from '@grim/audio.ts';
import { InputState } from '@grim/input.ts';
import type { GameState } from '@crimson/game/types.ts';
import * as wgl from '@wgl';

export const SPLASH_ALPHA_SCALE = 2.0;
export const LOGO_TIME_SCALE = 1.1;
export const LOGO_TIME_OFFSET = 2.0;
export const LOGO_SKIP_ACCEL = 4.0;
export const LOGO_SKIP_JUMP = 16.0;
export const LOGO_THEME_TRIGGER = 14.0;
export const LOGO_10_IN_START = 1.0;
export const LOGO_10_IN_END = 2.0;
export const LOGO_10_HOLD_END = 4.0;
export const LOGO_10_OUT_END = 5.0;
export const LOGO_REF_IN_START = 7.0;
export const LOGO_REF_IN_END = 8.0;
export const LOGO_REF_HOLD_END = 10.0;
export const LOGO_REF_OUT_END = 11.0;
export const DEBUG_LOADING_HOLD_ENV = 'CRIMSON_DEBUG_LOADING_HOLD_SECONDS';

function pythonFloat(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  const text = String(value).trim();
  if (/^[+-]?nan$/i.test(text)) {
    return Number.NaN;
  }
  if (/^[+-]?inf(?:inity)?$/i.test(text)) {
    return text.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  const digits = String.raw`\d(?:_?\d)*`;
  const decimalPattern = new RegExp(String.raw`^[+-]?(?:(?:${digits}(?:\.(?:${digits})?)?|\.(?:${digits}))(?:[eE][+-]?${digits})?)$`);
  if (!decimalPattern.test(text)) {
    throw new Error(`invalid float literal: ${text}`);
  }
  return Number(text.replaceAll('_', ''));
}

function pyRound(value: number, ndigits = 0): number {
  const factor = 10 ** ndigits;
  const scaled = value * factor;
  const floorValue = Math.floor(scaled);
  const frac = scaled - floorValue;
  if (frac < 0.5) {
    return floorValue / factor;
  }
  if (frac > 0.5) {
    return (floorValue + 1) / factor;
  }
  return (floorValue % 2 === 0 ? floorValue : floorValue + 1) / factor;
}

export class BootView {
  state: GameState;
  protected _bootTime: number;
  protected _fadeOutReady: boolean;
  protected _fadeOutDone: boolean;
  protected _logoDelayTicks: number;
  protected _logoSkip: boolean;
  protected _logoActive: boolean;
  protected _introStarted: boolean;
  protected _themeStarted: boolean;
  protected _loadingHoldRemaining: number;

  constructor(state: GameState) {
    this.state = state;
    this._bootTime = 0.5;
    this._fadeOutReady = false;
    this._fadeOutDone = false;
    this._logoDelayTicks = 0;
    this._logoSkip = false;
    this._logoActive = false;
    this._introStarted = false;
    this._themeStarted = false;
    this._loadingHoldRemaining = debugLoadingHoldSeconds();
  }

  async open(): Promise<void> {
    if (this.state.resources === null) {
      this.state.resources = await loadRuntimeResources(this.state.assetsDir);
      const loaded = this.state.resources.textures.size;
      this.state.console.log.log(`runtime resources loaded: ${loaded} textures`);
      this.state.console.log.flush();
    }
    if (this.state.audio === null) {
      this.state.audio = initAudioState(this.state.config, this.state.assetsDir, this.state.console);
      this.state.console.execLine('exec music/game_tunes.txt');
    }
    this._bootTime = 0.5;
    this._fadeOutReady = true;
    this._fadeOutDone = false;
    this._logoDelayTicks = 0;
    this._logoSkip = false;
    this._logoActive = false;
    this._introStarted = false;
    this._themeStarted = false;
    this._loadingHoldRemaining = debugLoadingHoldSeconds();
  }

  update(dt: number): void {
    const frameDt = Math.min(dt, 0.1);
    if (this.state.audio !== null) {
      updateAudio(this.state.audio, frameDt);
    }
    if (this._themeStarted) {
      return;
    }

    if (this._fadeOutReady && !this._fadeOutDone) {
      if (this._loadingHoldRemaining > 0.0) {
        this._loadingHoldRemaining = Math.max(0.0, this._loadingHoldRemaining - frameDt);
        return;
      }
      this._bootTime -= frameDt;
      if (this._bootTime <= 0.0) {
        this._bootTime = 0.0;
        this._fadeOutDone = true;
      }
      return;
    }

    if (this.state.skipIntro) {
      this._startTheme();
      return;
    }

    if (this._logoDelayTicks < 5) {
      this._logoDelayTicks += 1;
      return;
    }

    this._logoActive = true;
    if (this._bootTime > LOGO_THEME_TRIGGER) {
      this._startTheme();
      return;
    }
    if (!this._introStarted && this.state.audio !== null) {
      playMusic(this.state.audio, 'intro');
      this._introStarted = true;
    }
    if (!this._logoSkip && this._skipTriggered()) {
      this._logoSkip = true;
    }
    this._bootTime += frameDt * LOGO_TIME_SCALE;
    let t = this._bootTime - LOGO_TIME_OFFSET;
    if (this._logoSkip) {
      if (t < LOGO_10_IN_START || (LOGO_10_OUT_END <= t && (t < LOGO_REF_IN_START || LOGO_REF_OUT_END <= t))) {
        t = LOGO_SKIP_JUMP;
      } else {
        t += frameDt * LOGO_SKIP_ACCEL;
      }
      this._bootTime = t + LOGO_TIME_OFFSET;
    }
  }

  draw(): void {
    wgl.clearBackground(wgl.makeColor(0, 0, 0, 1));
    const resources = this.state.resources;
    if (resources === null) {
      return;
    }
    if (!this._fadeOutDone) {
      this._drawSplash(resources, this._splashAlpha());
      return;
    }
    if (this._logoActive && !this._themeStarted) {
      this._drawCompanyLogoSequence();
    }
  }

  close(): void {
    if (this.state.audio !== null) {
      shutdownAudio(this.state.audio);
      this.state.audio = null;
    }
    unloadRuntimeResources(this.state.resources);
    this.state.resources = null;
  }

  protected _startTheme(): void {
    if (this._themeStarted) {
      return;
    }
    if (this.state.audio !== null) {
      stopMusic(this.state.audio);
      const theme = this.state.demoEnabled ? 'crimsonquest' : 'crimson_theme';
      playMusic(this.state.audio, theme);
    }
    this._themeStarted = true;
  }

  isThemeStarted(): boolean {
    return this._themeStarted;
  }

  protected _skipTriggered(): boolean {
    if (InputState.getKeyPressed() !== 0) {
      return true;
    }
    if (InputState.wasMouseButtonPressed(0)) {
      return true;
    }
    if (InputState.wasMouseButtonPressed(2)) {
      return true;
    }
    return false;
  }

  protected _logoState(t: number): [TextureId, number] | null {
    let alpha: number;
    if (LOGO_10_IN_START <= t && t < LOGO_10_OUT_END) {
      if (t < LOGO_10_IN_END) {
        alpha = t - LOGO_10_IN_START;
      } else if (t < LOGO_10_HOLD_END) {
        alpha = 1.0;
      } else {
        alpha = 1.0 - (t - LOGO_10_HOLD_END);
      }
      return [TextureId.SPLASH_10TONS, BootView._clamp01(alpha)];
    }
    if (LOGO_REF_IN_START <= t && t < LOGO_REF_OUT_END) {
      if (t < LOGO_REF_IN_END) {
        alpha = t - LOGO_REF_IN_START;
      } else if (t < LOGO_REF_HOLD_END) {
        alpha = 1.0;
      } else {
        alpha = 1.0 - (t - LOGO_REF_HOLD_END);
      }
      return [TextureId.SPLASH_REFLEXIVE, BootView._clamp01(alpha)];
    }
    return null;
  }

  protected _drawCompanyLogoSequence(): void {
    const resources = this.state.resources;
    if (resources === null) {
      return;
    }
    const t = this._bootTime - LOGO_TIME_OFFSET;
    const state = this._logoState(t);
    if (state === null) {
      return;
    }
    const [textureId, alpha] = state;
    const tex = resources.texture(textureId);
    const texW = tex.width;
    const texH = tex.height;
    const x = (wgl.getScreenWidth() - texW) * 0.5;
    const y = (wgl.getScreenHeight() - texH) * 0.5;
    const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(pyRound(alpha * 255.0)) / 255);
    (() => { const texture = tex; const position = wgl.makeVector2(x, y); wgl.drawTexturePro(texture, wgl.makeRectangle(0, 0, texture.width, texture.height), wgl.makeRectangle(position.x, position.y, texture.width, texture.height), wgl.makeVector2(0, 0), 0.0, tint); })();
  }

  protected _splashAlpha(): number {
    return BootView._clamp01(this._bootTime * SPLASH_ALPHA_SCALE);
  }

  protected static _clamp01(value: number): number {
    if (value < 0.0) {
      return 0.0;
    }
    if (value > 1.0) {
      return 1.0;
    }
    return value;
  }

  protected _drawSplash(resources: RuntimeResources, alpha: number): void {
    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    if (alpha <= 0.0) {
      return;
    }

    const logo = resources.texture(TextureId.CL_LOGO);
    let logoH = logo.height;
    const bandHeight = logoH * 2.0;
    const bandTop = (screenH - bandHeight) * 0.5 - 4.0;
    const bandBottom = bandTop + bandHeight;
    const bandLeft = -4.0;
    const bandRight = screenW + 4.0;

    const lineAlpha = BootView._clamp01(alpha * 0.7);
    const lineColor = wgl.makeColor(149 / 255, 175 / 255, 198 / 255, int(pyRound(lineAlpha * 255.0)) / 255);
    wgl.drawRectangle(int(pyRound(bandLeft)), int(pyRound(bandTop)), int(pyRound(bandRight - bandLeft)), 1, lineColor);
    wgl.drawRectangle(int(pyRound(bandLeft)), int(pyRound(bandBottom)), int(pyRound(bandRight - bandLeft)), 1, lineColor);
    wgl.drawRectangle(int(pyRound(bandLeft)), int(pyRound(bandTop)), 1, int(pyRound(bandHeight)), lineColor);
    wgl.drawRectangle(int(pyRound(bandRight)), int(pyRound(bandTop)), 1, int(pyRound(bandHeight)), lineColor);

    const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(pyRound(alpha * 255.0)) / 255);

    const logoW = logo.width;
    logoH = logo.height;
    const logoX = (screenW - logoW) * 0.5;
    const logoY = (screenH - logoH) * 0.5;
    (() => { const texture = logo; const position = wgl.makeVector2(logoX, logoY); wgl.drawTexturePro(texture, wgl.makeRectangle(0, 0, texture.width, texture.height), wgl.makeRectangle(position.x, position.y, texture.width, texture.height), wgl.makeVector2(0, 0), 0.0, tint); })();
    const loading = resources.texture(TextureId.LOADING);
    const loadingX = screenW * 0.5 + 128.0;
    const loadingY = screenH * 0.5 + 16.0;
    (() => { const texture = loading; const position = wgl.makeVector2(loadingX, loadingY); wgl.drawTexturePro(texture, wgl.makeRectangle(0, 0, texture.width, texture.height), wgl.makeRectangle(position.x, position.y, texture.width, texture.height), wgl.makeVector2(0, 0), 0.0, tint); })();

    const esrb = resources.texture(TextureId.LOGO_ESRB);
    const esrbW = esrb.width;
    const esrbH = esrb.height;
    const esrbX = screenW - esrbW - 1.0;
    const esrbY = screenH - esrbH - 1.0;
    (() => { const texture = esrb; const position = wgl.makeVector2(esrbX, esrbY); wgl.drawTexturePro(texture, wgl.makeRectangle(0, 0, texture.width, texture.height), wgl.makeRectangle(position.x, position.y, texture.width, texture.height), wgl.makeVector2(0, 0), 0.0, tint); })();
  }
}

export function debugLoadingHoldSeconds(): number {
  const raw = ((globalThis.process?.env?.[DEBUG_LOADING_HOLD_ENV] ?? '')).trim();
  if (!raw) {
    return 0.0;
  }
  try {
    return Math.max(0.0, pythonFloat(raw));
  } catch (exc) {
    return 0.0;
  }
}
