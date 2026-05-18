// Port of crimson/bonuses/apply_context.py

import type { Vec2 } from '@grim/geom.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { TimerRef } from '@crimson/bonuses/hud.ts';
import type { BonusId } from '@crimson/bonuses/ids.ts';
import { BONUS_BY_ID } from '@crimson/bonuses/ids.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';

export type BonusApplyHandler = (arg0: BonusApplyCtx) => void;

export function bonusApplySeconds(ctx: BonusApplyCtx): number {
  const meta = BONUS_BY_ID.get(ctx.bonusId) ?? null;
  if (meta !== null && meta.applySeconds !== null) {
    return meta.applySeconds;
  }
  return ctx.amount;
}

export class BonusApplyCtx {
  state: GameplayState;
  player: PlayerState;
  bonusId: BonusId;
  amount: number;
  originPos: Vec2;
  creatures: readonly CreatureState[];
  players: PlayerState[];
  detailPreset: number;
  economistMultiplier: number;
  label: string;
  iconId: number;
  deferFreezeCorpseFx: boolean;
  freezeCorpseIndices: Set<number> | null;

  constructor(opts: {
    state: GameplayState;
    player: PlayerState;
    bonusId: BonusId;
    amount: number;
    originPos: Vec2;
    creatures: readonly CreatureState[];
    players: PlayerState[];
    detailPreset: number;
    economistMultiplier: number;
    label: string;
    iconId: number;
    deferFreezeCorpseFx?: boolean;
    freezeCorpseIndices?: Set<number> | null;
  }) {
    this.state = opts.state;
    this.player = opts.player;
    this.bonusId = opts.bonusId;
    this.amount = opts.amount;
    this.originPos = opts.originPos;
    this.creatures = opts.creatures;
    this.players = opts.players;
    this.detailPreset = opts.detailPreset;
    this.economistMultiplier = opts.economistMultiplier;
    this.label = opts.label;
    this.iconId = opts.iconId;
    this.deferFreezeCorpseFx = opts.deferFreezeCorpseFx ?? false;
    this.freezeCorpseIndices = opts.freezeCorpseIndices ?? null;
  }

  registerGlobal(opts: { timerKey: string }): void;
  registerGlobal(timerKey: string): void;
  registerGlobal(timerKeyOrOpts: string | { timerKey: string }): void {
    const timerKey: string = typeof timerKeyOrOpts === 'object' && timerKeyOrOpts !== null ? timerKeyOrOpts.timerKey : timerKeyOrOpts as string;
    this.state.bonusHud.register(
      this.bonusId,
      { label: this.label, iconId: this.iconId, timerRef: new TimerRef({ kind: 'global', key: timerKey }) },
    );
  }

  registerPlayer(opts: { timerKey: string }): void;
  registerPlayer(timerKey: string): void;
  registerPlayer(timerKeyOrOpts: string | { timerKey: string }): void {
    const timerKey: string = typeof timerKeyOrOpts === 'object' && timerKeyOrOpts !== null ? timerKeyOrOpts.timerKey : timerKeyOrOpts as string;
    if (this.players.length > 1) {
      this.state.bonusHud.register(
        this.bonusId,
        { label: this.label, iconId: this.iconId, timerRef: new TimerRef({ kind: 'player', key: timerKey, playerIndex: 0 }), timerRefAlt: new TimerRef({ kind: 'player', key: timerKey, playerIndex: 1 }) },
      );
    } else {
      this.state.bonusHud.register(
        this.bonusId,
        { label: this.label, iconId: this.iconId, timerRef: new TimerRef({ kind: 'player', key: timerKey, playerIndex: int(this.player.index) }) },
      );
    }
  }
}
