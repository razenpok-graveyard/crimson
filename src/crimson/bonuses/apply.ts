// Port of crimson/bonuses/apply.py

import type { Vec2 } from '@grim/geom.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkCountGet } from '@crimson/perks/helpers.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import type { BonusApplyHandler } from '@crimson/bonuses/apply-context.ts';
import { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';
import { applyDoubleExperience } from '@crimson/bonuses/double-experience.ts';
import { applyEnergizer } from '@crimson/bonuses/energizer.ts';
import { applyFireBullets } from '@crimson/bonuses/fire-bullets.ts';
import { applyFireblast } from '@crimson/bonuses/fireblast.ts';
import { applyFreeze } from '@crimson/bonuses/freeze.ts';
import { BONUS_BY_ID, BonusId } from '@crimson/bonuses/ids.ts';
import { applyMedikit } from '@crimson/bonuses/medikit.ts';
import { applyNuke } from '@crimson/bonuses/nuke.ts';
import { applyPoints } from '@crimson/bonuses/points.ts';
import { applyReflexBoost } from '@crimson/bonuses/reflex-boost.ts';
import { applyShield } from '@crimson/bonuses/shield.ts';
import { applyShockChain } from '@crimson/bonuses/shock-chain.ts';
import { applySpeed } from '@crimson/bonuses/speed.ts';
import { applyWeapon } from '@crimson/bonuses/weapon.ts';
import { applyWeaponPowerUp } from '@crimson/bonuses/weapon-power-up.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';

const _BONUS_APPLY_HANDLERS: Map<BonusId, BonusApplyHandler> = new Map([
  [BonusId.POINTS, applyPoints],
  [BonusId.ENERGIZER, applyEnergizer],
  [BonusId.WEAPON_POWER_UP, applyWeaponPowerUp],
  [BonusId.DOUBLE_EXPERIENCE, applyDoubleExperience],
  [BonusId.REFLEX_BOOST, applyReflexBoost],
  [BonusId.FREEZE, applyFreeze],
  [BonusId.SHIELD, applyShield],
  [BonusId.MEDIKIT, applyMedikit],
  [BonusId.SPEED, applySpeed],
  [BonusId.FIRE_BULLETS, applyFireBullets],
  [BonusId.SHOCK_CHAIN, applyShockChain],
  [BonusId.WEAPON, applyWeapon],
  [BonusId.FIREBLAST, applyFireblast],
  [BonusId.NUKE, applyNuke],
]);

export function bonusApply(state: GameplayState, player: PlayerState, bonusId: BonusId, opts: { amount?: number | null; origin: Vec2; creatures: readonly CreatureState[]; players: PlayerState[]; detailPreset?: number; deferFreezeCorpseFx?: boolean; freezeCorpseIndices?: Set<number> | null }): void {
  // Apply a bonus to player + global timers (subset of `bonus_apply`).

  let amount = opts.amount ?? null;
  const origin = opts.origin;
  const creatures = opts.creatures;
  const players = opts.players;
  const detailPreset = opts.detailPreset ?? 5;
  const deferFreezeCorpseFx = opts.deferFreezeCorpseFx ?? false;
  const freezeCorpseIndices = opts.freezeCorpseIndices ?? null;
  const meta = BONUS_BY_ID.get(bonusId) ?? null;
  if (meta === null) {
    return;
  }
  if (amount === null) {
    amount = Math.trunc(meta.nativeAmount || 0);
  }

  const economistMultiplier = perkCountGet(player, PerkId.BONUS_ECONOMIST) !== 0 ? 1.5 : 1.0;
  const iconId = meta.iconId !== null ? Math.trunc(meta.iconId) : -1;
  const label = meta.name;
  const ctx = new BonusApplyCtx({ state: state, player: player, bonusId: bonusId, amount: Math.trunc(amount), originPos: origin, creatures: creatures, players: players, detailPreset: Math.trunc(detailPreset), economistMultiplier: economistMultiplier, label: String(label), iconId: Math.trunc(iconId), deferFreezeCorpseFx: deferFreezeCorpseFx, freezeCorpseIndices: freezeCorpseIndices });
  const handler = _BONUS_APPLY_HANDLERS.get(bonusId) ?? null;
  if (handler !== null) {
    handler(ctx);
  }

  // Bonus types not modeled yet.
  return;
}
