// Port of crimson/perks/runtime/hook_types.py

import type { PerkId } from '@crimson/perks/ids.ts';
import type { PerkApplyHandler } from '@crimson/perks/runtime/apply-context.ts';
import type { PerksUpdateEffectsCtx } from '@crimson/perks/runtime/effects-context.ts';
import type { PlayerPerkTickCtx } from '@crimson/perks/runtime/player-tick-context.ts';
import type { CreatureDeath, CreaturePool } from '@crimson/creatures/runtime.ts';
import type { FxQueue } from '@crimson/effects.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';

export type WorldDtStep = (opts: { dt: number; players: PlayerState[] }) => number;

export type PlayerDeathHook = (opts: {
  state: GameplayState;
  creatures: CreaturePool;
  players: PlayerState[];
  player: PlayerState;
  dt: number;
  worldSize: number;
  detailPreset: number;
  fxQueue: FxQueue;
  deaths: CreatureDeath[];
}) => void;

export type PlayerPerkTickStep = (arg0: PlayerPerkTickCtx) => void;
export type PerksUpdateEffectsStep = (arg0: PerksUpdateEffectsCtx) => void;

export class PerkHooks {
  readonly perkId: PerkId;
  readonly applyHandler: PerkApplyHandler | null;
  readonly worldDtStep: WorldDtStep | null;
  readonly playerTickSteps: readonly PlayerPerkTickStep[];
  readonly effectsSteps: readonly PerksUpdateEffectsStep[];
  readonly playerDeathHook: PlayerDeathHook | null;

  constructor(opts: {
    perkId: PerkId;
    applyHandler?: PerkApplyHandler | null;
    worldDtStep?: WorldDtStep | null;
    playerTickSteps?: readonly PlayerPerkTickStep[];
    effectsSteps?: readonly PerksUpdateEffectsStep[];
    playerDeathHook?: PlayerDeathHook | null;
  }) {
    this.perkId = opts.perkId;
    this.applyHandler = opts.applyHandler ?? null;
    this.worldDtStep = opts.worldDtStep ?? null;
    this.playerTickSteps = Array.from(opts.playerTickSteps ?? []);
    this.effectsSteps = Array.from(opts.effectsSteps ?? []);
    this.playerDeathHook = opts.playerDeathHook ?? null;
  }
}
