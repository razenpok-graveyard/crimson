// Port of crimson/bonuses/selection.py

import { GameMode } from '@crimson/game-modes.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { BONUS_BY_ID, BonusId } from '@crimson/bonuses/ids.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import type { BonusPool } from '@crimson/bonuses/pool.ts';

function bonusEnabled(bonusId: BonusId): boolean {
  const meta = BONUS_BY_ID.get(bonusId) ?? null;
  if (meta === null) {
    return false;
  }
  return meta.bonusId !== BonusId.UNUSED;
}

function bonusPickSuppressed(opts: { state: GameplayState; players: PlayerState[]; bonusId: BonusId; hasFireBulletsDrop: boolean }): boolean {
  const state = opts.state;
  const players = opts.players;
  const bonusId = opts.bonusId;
  const hasFireBulletsDrop = opts.hasFireBulletsDrop;
  if (!bonusEnabled(bonusId)) {
    return true;
  }
  if (state.shockChainLinksLeft > 0 && bonusId === BonusId.SHOCK_CHAIN) {
    return true;
  }
  if (bonusId === BonusId.FREEZE && state.bonuses.freeze > 0.0) {
    return true;
  }
  if (bonusId === BonusId.SHIELD && players.some((player) => player.shieldTimer > 0.0)) {
    return true;
  }
  if (bonusId === BonusId.WEAPON && hasFireBulletsDrop) {
    return true;
  }
  if (bonusId === BonusId.WEAPON && players.some((player) => perkActive(player, PerkId.MY_FAVOURITE_WEAPON))) {
    return true;
  }
  if (bonusId === BonusId.MEDIKIT && players.some((player) => perkActive(player, PerkId.DEATH_CLOCK))) {
    return true;
  }
  const level = state.questLevel;
  if (state.gameMode !== GameMode.QUESTS || level === null || level.minor !== 10) {
    return false;
  }

  const major = level.major;
  if (bonusId === BonusId.NUKE) {
    return major === 2 || major === 4 || major === 5 || (state.hardcore && major === 3);
  }
  if (bonusId === BonusId.FREEZE) {
    return major === 4 || (state.hardcore && major === 2);
  }
  return false;
}

export function bonusPickRandomType(pool: BonusPool, state: GameplayState, players: PlayerState[]): BonusId {
  const hasFireBulletsDrop = pool.entries.some((entry) => entry.bonusId === BonusId.FIRE_BULLETS && !entry.picked);

  for (let i = 0; i < 101; i++) {
    const roll = state.rng.rand({ caller: RngCallerStatic.BONUS_PICK_RANDOM_TYPE_ROLL }) % 162 + 1;
    // Mirrors `bonus_pick_random_type` (0x412470) mapping:
    // - roll = rand() % 162 + 1  (1..162)
    // - Points: roll 1..13
    // - Energizer: roll 14 with (rand & 0x3F) == 0, else Weapon
    // - Bucketed ids 3..14 via a 10-step loop; if it would exceed 14, returns 0
    //   to force a reroll (matching the `goto LABEL_18` path leaving `v3 == 0`).
    let bonusId: BonusId;
    let bucketOffset: number;
    let bonusValue: number;
    if (roll <= 13) {
      bonusId = BonusId.POINTS;
    } else if (roll === 14) {
      if ((state.rng.rand({ caller: RngCallerStatic.BONUS_PICK_RANDOM_TYPE_ENERGIZER }) & 0x3F) === 0) {
        bonusId = BonusId.ENERGIZER;
      } else {
        bonusId = BonusId.WEAPON;
      }
    } else {
      bucketOffset = roll - 14;
      bonusValue = int(BonusId.WEAPON);
      while (bucketOffset > 10) {
        bucketOffset -= 10;
        bonusValue += 1;
        if (bonusValue >= 15) {
          bonusValue = int(BonusId.UNUSED);
          break;
        }
      }
      bonusId = bonusValue;
    }
    if (bonusId === BonusId.UNUSED) {
      continue;
    }
    if (bonusPickSuppressed({ state: state, players: players, bonusId: bonusId, hasFireBulletsDrop: hasFireBulletsDrop })) {
      continue;
    }
    return bonusId;
  }
  return BonusId.POINTS;
}
