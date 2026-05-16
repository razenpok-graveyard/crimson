// Port of crimson/modes/components/perk_prompt_controller.py

import type { CrimsonConfig } from '@grim/config.ts';
import { clamp } from '@grim/math.ts';
import { inputCodeIsDown, inputCodeIsPressed, inputPrimaryJustPressed } from '@crimson/input-codes.ts';
import type { PerkMenuUiContext } from '@crimson/modes/components/perk-menu-controller.ts';
import { PERK_PROMPT_MAX_TIMER_MS, PerkPromptUi } from '@crimson/modes/components/perk-prompt-ui.ts';

export type UiTextWidthFn = (arg0: string, arg1: number) => number;

export class PerkPromptState {
  timerMs: number;
  hover: boolean;
  pulse: number;

  constructor(opts: {
    timerMs?: number;
    hover?: boolean;
    pulse?: number;
  } = {}) {
    this.timerMs = opts.timerMs ?? 0.0;
    this.hover = opts.hover ?? false;
    this.pulse = opts.pulse ?? 0.0;
  }

  reset(): void {
    this.timerMs = 0.0;
    this.hover = false;
    this.pulse = 0.0;
  }

  resetIfPending(opts: { pendingCount: number }): void {
    const pendingCount = opts.pendingCount;
    if (Math.trunc(pendingCount) > 0) {
      this.reset();
    }
  }

  beginFrame(): void {
    this.hover = false;
  }

  pollOpenRequest(opts: { ctx: PerkMenuUiContext; config: CrimsonConfig; pendingCount: number; playerCount: number; anyAlive: boolean; paused: boolean; menuActive: boolean; promptScale?: number }): boolean {
    const ctx = opts.ctx;
    const config = opts.config;
    const pendingCount = opts.pendingCount;
    const playerCount = opts.playerCount;
    const anyAlive = opts.anyAlive;
    const paused = opts.paused;
    const menuActive = opts.menuActive;
    const promptScale = opts.promptScale ?? 1.0;
    if (Math.trunc(pendingCount) <= 0 || !anyAlive || paused || menuActive) {
      return false;
    }
    const label = PerkPromptUi.label(config, { pendingCount: Math.trunc(pendingCount) });
    if (label) {
      const rect = PerkPromptUi.rect({ resources: ctx.resources, scale: promptScale });
      this.hover = rect.contains(ctx.mouse);
    }
    if (this._promptOpenRequested({ config: config, playerCount: Math.trunc(playerCount) })) {
      this.pulse = 1000.0;
      return true;
    }
    return false;
  }

  tickTimer(opts: { pendingCount: number; anyAlive: boolean; paused: boolean; menuActive: boolean; dtUiMs: number }): void {
    const pendingCount = opts.pendingCount;
    const anyAlive = opts.anyAlive;
    const paused = opts.paused;
    const menuActive = opts.menuActive;
    const dtUiMs = opts.dtUiMs;
    const promptVisible = Math.trunc(pendingCount) > 0 && anyAlive && !paused && !menuActive;
    const timerDelta = promptVisible ? dtUiMs : -dtUiMs;
    this.timerMs = clamp(this.timerMs + timerDelta, 0.0, PERK_PROMPT_MAX_TIMER_MS);
  }

  tickPulse(dtUiMs: number): void {
    const pulseDelta = dtUiMs * (this.hover ? 6.0 : -2.0);
    this.pulse = clamp(this.pulse + pulseDelta, 0.0, 1000.0);
  }

  draw(opts: { ctx: PerkMenuUiContext; pendingCount: number; anyAlive: boolean; menuActive: boolean; config: CrimsonConfig; uiTextWidth: UiTextWidthFn; textColor: any; promptScale?: number }): void {
    const ctx = opts.ctx;
    const pendingCount = opts.pendingCount;
    const anyAlive = opts.anyAlive;
    const menuActive = opts.menuActive;
    const config = opts.config;
    const uiTextWidth = opts.uiTextWidth;
    const textColor = opts.textColor;
    const promptScale = opts.promptScale ?? 1.0;
    if (menuActive || !anyAlive) {
      return;
    }
    if (Math.trunc(pendingCount) <= 0) {
      return;
    }
    const label = PerkPromptUi.label(config, { pendingCount: Math.trunc(pendingCount) });
    if (!label) {
      return;
    }
    PerkPromptUi.draw({
      resources: ctx.resources,
      label: label,
      timerMs: this.timerMs,
      pulse: this.pulse,
      uiTextWidth: uiTextWidth,
      textColor: textColor,
      scale: promptScale,
    });
  }

  _promptOpenRequested(opts: { config: CrimsonConfig; playerCount: number }): boolean {
    const config = opts.config;
    const playerCount = opts.playerCount;
    const fireKey = Math.trunc(config.controls.player(0).fireCode);
    const pickKey = config.controls.pickPerkCode;
    if (inputCodeIsPressed(pickKey, { playerIndex: 0 }) && !inputCodeIsDown(fireKey, { playerIndex: 0 })) {
      return true;
    }
    const fireCodes = Array.from({ length: Math.max(0, 4) }, (_, i) => i).map((idx) => Math.trunc(config.controls.player(idx).fireCode));
    return this.hover && inputPrimaryJustPressed({ fireCodes: fireCodes, playerCount: playerCount });
  }
}
