// Port of crimson/perks/state.py

import type { PerkId } from '@crimson/perks/ids.ts';

// Global thresholds used by perk timers in `player_update`.
//
// These are global (not per-player) in crimsonland.exe: `flt_473310`,
// `flt_473314`, and `flt_473318`.
export class PerkEffectIntervals {
  manBomb: number;
  fireCough: number;
  hotTempered: number;

  constructor(opts: {
    manBomb?: number;
    fireCough?: number;
    hotTempered?: number;
  } = {}) {
    this.manBomb = opts.manBomb ?? 4.0;
    this.fireCough = opts.fireCough ?? 2.0;
    this.hotTempered = opts.hotTempered ?? 2.0;
  }
}

export class PerkSelectionState {
  pendingCount: number;
  choices: PerkId[];
  choicesDirty: boolean;
  capturePlayerPerkCountsKnown: boolean;

  constructor(opts: {
    pendingCount?: number;
    choices?: PerkId[];
    choicesDirty?: boolean;
    capturePlayerPerkCountsKnown?: boolean;
  } = {}) {
    this.pendingCount = opts.pendingCount ?? 0;
    this.choices = opts.choices ?? [];
    this.choicesDirty = opts.choicesDirty ?? true;
    this.capturePlayerPerkCountsKnown = opts.capturePlayerPerkCountsKnown ?? true;
  }
}
