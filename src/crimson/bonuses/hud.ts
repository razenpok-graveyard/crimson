// Port of crimson/bonuses/hud.py

import type { GameplayState } from '@crimson/sim/state-types.ts';
import { PlayerState } from '@crimson/sim/state-types.ts';
import { BonusId } from '@crimson/bonuses/ids.ts';

export const BONUS_HUD_SLOT_COUNT = 16;

export class TimerRef {
  readonly kind: string; // "global" or "player"
  readonly key: string;
  readonly playerIndex: number | null;

  constructor(opts: {
    kind: string;
    key: string;
    playerIndex?: number | null;
  }) {
    this.kind = opts.kind;
    this.key = opts.key;
    this.playerIndex = opts.playerIndex ?? null;
  }
}

export class BonusHudSlot {
  active: boolean;
  bonusId: BonusId;
  label: string;
  iconId: number;
  slideX: number;
  timerRef: TimerRef | null;
  timerRefAlt: TimerRef | null;
  timerValue: number;
  timerValueAlt: number;

  constructor(opts: {
    active?: boolean;
    bonusId?: BonusId;
    label?: string;
    iconId?: number;
    slideX?: number;
    timerRef?: TimerRef | null;
    timerRefAlt?: TimerRef | null;
    timerValue?: number;
    timerValueAlt?: number;
  } = {}) {
    this.active = opts.active ?? false;
    this.bonusId = opts.bonusId ?? BonusId.UNUSED;
    this.label = opts.label ?? '';
    this.iconId = opts.iconId ?? -1;
    this.slideX = opts.slideX ?? -184.0;
    this.timerRef = opts.timerRef ?? null;
    this.timerRefAlt = opts.timerRefAlt ?? null;
    this.timerValue = opts.timerValue ?? 0.0;
    this.timerValueAlt = opts.timerValueAlt ?? 0.0;
  }
}

export class BonusHudState {
  slots: BonusHudSlot[];

  constructor(opts: {
    slots?: BonusHudSlot[];
  } = {}) {
    this.slots = opts.slots ?? Array.from({ length: Math.max(0, BONUS_HUD_SLOT_COUNT) }, (_, i) => i).map((_) => new BonusHudSlot());
  }

  register(bonusId: BonusId, opts: { label: string; iconId: number; timerRef: TimerRef; timerRefAlt?: TimerRef | null }): void {
    const label = opts.label;
    const iconId = opts.iconId;
    const timerRef = opts.timerRef;
    const timerRefAlt = opts.timerRefAlt ?? null;
    let existing = null;
    let free = null;
    for (let slot of this.slots) {
      if (slot.active && slot.bonusId === bonusId) {
        existing = slot;
        break;
      }
      if (!slot.active && free === null) {
        free = slot;
      }
    }
    let slot = existing || free;
    if (slot === null) {
      slot = this.slots[this.slots.length - 1];
    }
    slot.active = true;
    slot.bonusId = bonusId;
    slot.label = label;
    slot.iconId = int(iconId);
    slot.slideX = -184.0;
    slot.timerRef = timerRef;
    slot.timerRefAlt = timerRefAlt;
    slot.timerValue = 0.0;
    slot.timerValueAlt = 0.0;
  }
}

export function bonusHudUpdate(state: GameplayState, players: PlayerState[], opts: { dt?: number } = {}): void {
  // Refresh HUD slots based on current timer values + advance slide animation.

  let dt = opts.dt ?? 0.0;
  const globalTimers = { "weapon_power_up": state.bonuses.weaponPowerUp, "reflex_boost": state.bonuses.reflexBoost, "energizer": state.bonuses.energizer, "double_experience": state.bonuses.doubleExperience, "freeze": state.bonuses.freeze };

  const _globalTimerValue = (key: string): number => {
    if (!Object.prototype.hasOwnProperty.call(globalTimers, key)) {
      throw new Error(`Unexpected bonus HUD global timer key: ${key}`);
    }
    return (globalTimers as Record<string, number>)[key];
  };

  const _playerTimerValue = (player: PlayerState, key: string): number => {
    const playerTimers: Record<string, number> = { "fire_bullets_timer": player.fireBulletsTimer, "shield_timer": player.shieldTimer, "speed_bonus_timer": player.speedBonusTimer };
    if (!Object.prototype.hasOwnProperty.call(playerTimers, key)) {
      throw new Error(`Unexpected bonus HUD player timer key: ${key}`);
    }
    return (playerTimers as Record<string, number>)[key];
  };

  const _timerValue = (ref: TimerRef | null): number => {
    if (ref === null) {
      return 0.0;
    }
    if (ref.kind === 'global') {
      return Math.max(0.0, _globalTimerValue(ref.key));
    }
    if (ref.kind === 'player') {
      const idx = ref.playerIndex;
      if (idx === null || !(idx >= 0 && idx < players.length)) {
        return 0.0;
      }
      return Math.max(0.0, _playerTimerValue(players[idx], ref.key));
    }
    return 0.0;
  };

  const playerCount = players.length;
  dt = Math.max(0.0, dt);

  for (const [slotIndex, slot] of state.bonusHud.slots.entries()) {
    if (!slot.active) {
      continue;
    }
    const timer = Math.max(0.0, _timerValue(slot.timerRef));
    const timerAlt = (slot.timerRefAlt !== null && playerCount > 1) ? Math.max(0.0, _timerValue(slot.timerRefAlt)) : 0.0;
    slot.timerValue = timer;
    slot.timerValueAlt = timerAlt;

    if (timer > 0.0 || timerAlt > 0.0) {
      slot.slideX += dt * 350.0;
    } else {
      slot.slideX -= dt * 320.0;
    }

    if (slot.slideX > -2.0) {
      slot.slideX = -2.0;
    }

    if (slot.slideX < -184.0 && !state.bonusHud.slots.slice(slotIndex + 1).some((other: any) => other.active)) {
      slot.active = false;
      slot.bonusId = BonusId.UNUSED;
      slot.label = '';
      slot.iconId = -1;
      slot.slideX = -184.0;
      slot.timerRef = null;
      slot.timerRefAlt = null;
      slot.timerValue = 0.0;
      slot.timerValueAlt = 0.0;
    }
  }
}
