// Port of crimson/bonuses/update.py

import { f32 } from '@crimson/math-parity.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { BonusPickupEvent } from '@crimson/sim/state-types.ts';
import { bonusApply } from '@crimson/bonuses/apply.ts';
import { bonusHudUpdate } from '@crimson/bonuses/hud.ts';
import { BonusId } from '@crimson/bonuses/ids.ts';
import { BONUS_PICKUP_LINGER, BONUS_TELEKINETIC_PICKUP_MS, bonusFindAimHoverEntry } from '@crimson/bonuses/pool.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import { PerkId } from '@crimson/perks/index.ts';

const _REFLEX_TIMER_SUBTRACT_BIAS = 4e-9;

export function bonusTelekineticUpdate(state: GameplayState, players: PlayerState[], dt: number, opts: { creatures: readonly CreatureState[]; detailPreset?: number; deferFreezeCorpseFx?: boolean; freezeCorpseIndices?: Set<number> | null }): BonusPickupEvent[] {
  // Allow Telekinetic perk owners to pick up bonuses by aiming at them.

  const creatures = opts.creatures;
  const detailPreset = opts.detailPreset ?? 5;
  const deferFreezeCorpseFx = opts.deferFreezeCorpseFx ?? false;
  const freezeCorpseIndices = opts.freezeCorpseIndices ?? null;
  if (dt <= 0.0) {
    return [];
  }

  const pickups: BonusPickupEvent[] = [];
  const dtMs = dt * 1000.0;

  for (const player of players) {
    if (player.health <= 0.0) {
      continue;
    }

    const hovered = bonusFindAimHoverEntry(player, state.bonusPool);
    if (hovered === null) {
      player.bonusAimHoverIndex = -1;
      player.bonusAimHoverTimerMs = 0.0;
      continue;
    }

    const [idx, entry] = hovered;
    player.bonusAimHoverIndex = int(idx);
    player.bonusAimHoverTimerMs += dtMs;

    if (player.bonusAimHoverTimerMs <= BONUS_TELEKINETIC_PICKUP_MS) {
      continue;
    }
    if (!perkActive(player, PerkId.TELEKINETIC)) {
      continue;
    }
    if (entry.picked || entry.bonusId === BonusId.UNUSED) {
      continue;
    }

    bonusApply(
      state,
      player,
      entry.bonusId,
      { amount: int(entry.amount), origin: entry.pos, creatures: creatures, players: players, detailPreset: int(detailPreset), deferFreezeCorpseFx: deferFreezeCorpseFx, freezeCorpseIndices: freezeCorpseIndices },
    );
    entry.picked = true;
    entry.timeLeft = BONUS_PICKUP_LINGER;
    pickups.push(new BonusPickupEvent({ playerIndex: int(player.index), bonusId: entry.bonusId, amount: int(entry.amount), pos: entry.pos }));

    // Match the exe: after a telekinetic pickup, reset the hover accumulator.
    player.bonusAimHoverIndex = -1;
    player.bonusAimHoverTimerMs = 0.0;
    break;
  }

  return pickups;
}

export function bonusUpdate(state: GameplayState, players: PlayerState[], dt: number, opts: { creatures: readonly CreatureState[]; updateHud?: boolean; detailPreset?: number; deferFreezeCorpseFx?: boolean; freezeCorpseIndices?: Set<number> | null }): BonusPickupEvent[] {
  // Advance world bonuses and global timers (subset of `bonus_update`).

  const creatures = opts.creatures;
  const updateHud = opts.updateHud ?? true;
  const detailPreset = opts.detailPreset ?? 5;
  const deferFreezeCorpseFx = opts.deferFreezeCorpseFx ?? false;
  const freezeCorpseIndices = opts.freezeCorpseIndices ?? null;
  const pickups = bonusTelekineticUpdate(state, players, dt, { creatures: creatures, detailPreset: int(detailPreset), deferFreezeCorpseFx: deferFreezeCorpseFx, freezeCorpseIndices: freezeCorpseIndices });
  pickups.push(...state.bonusPool.update(dt, { state: state, players: players, creatures: creatures, detailPreset: int(detailPreset), deferFreezeCorpseFx: deferFreezeCorpseFx, freezeCorpseIndices: freezeCorpseIndices }));

  if (dt > 0.0) {
    // Native `bonus_update` decrements Freeze + Double XP here; other global
    // timers are advanced earlier in the gameplay loop.
    const doubleXp = state.bonuses.doubleExperience;
    if (doubleXp <= 0.0) {
      state.bonuses.doubleExperience = 0.0;
    } else {
      state.bonuses.doubleExperience = f32(doubleXp - dt);
    }

    const freeze = state.bonuses.freeze;
    if (freeze <= 0.0) {
      state.bonuses.freeze = 0.0;
    } else {
      state.bonuses.freeze = f32(freeze - dt);
    }
  }

  if (updateHud) {
    bonusHudUpdate(state, players, { dt: dt });
  }

  return pickups;
}

export function bonusUpdatePrePickupTimers(state: GameplayState, dt: number): void {
  // Advance global timers that native decrements before `bonus_update`.

  if (dt <= 0.0) {
    return;
  }
  if (state.bonuses.weaponPowerUp > 0.0) {
    state.bonuses.weaponPowerUp = f32(state.bonuses.weaponPowerUp - dt);
  }
  if (state.bonuses.energizer > 0.0) {
    state.bonuses.energizer = f32(state.bonuses.energizer - dt);
  }
  let subtract: number;
  if (state.bonuses.reflexBoost > 0.0) {
    const reflexBefore = state.bonuses.reflexBoost;
    subtract = dt;
    if (0.0 < reflexBefore && reflexBefore < 1.0) {
      // Native x87 timer math trends slightly lower than straight f32 subtraction in this window.
      subtract += _REFLEX_TIMER_SUBTRACT_BIAS;
    }
    state.bonuses.reflexBoost = f32(reflexBefore - subtract);
  }
}
