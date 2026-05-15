// Port of crimson/perks/runtime/manifest.py

// Single source of truth for perk hook ownership and dispatch ordering.

import type { PerkId } from '@crimson/perks/ids.ts';
import { HOOKS as AMMO_MANIAC_HOOKS } from '@crimson/perks/impl/ammo-maniac.ts';
import { HOOKS as BANDAGE_HOOKS } from '@crimson/perks/impl/bandage.ts';
import { HOOKS as BREATHING_ROOM_HOOKS } from '@crimson/perks/impl/breathing-room.ts';
import { HOOKS as DEATH_CLOCK_HOOKS } from '@crimson/perks/impl/death-clock.ts';
import { HOOKS as EVIL_EYES_HOOKS } from '@crimson/perks/impl/evil-eyes-effect.ts';
import { HOOKS as FATAL_LOTTERY_HOOKS } from '@crimson/perks/impl/fatal-lottery.ts';
import { HOOKS as FINAL_REVENGE_HOOKS } from '@crimson/perks/impl/final-revenge.ts';
import { HOOKS as FIRE_COUGH_HOOKS } from '@crimson/perks/impl/fire-cough.ts';
import { HOOKS as GRIM_DEAL_HOOKS } from '@crimson/perks/impl/grim-deal.ts';
import { HOOKS as HOT_TEMPERED_HOOKS } from '@crimson/perks/impl/hot-tempered.ts';
import { HOOKS as INFERNAL_CONTRACT_HOOKS } from '@crimson/perks/impl/infernal-contract.ts';
import { HOOKS as INSTANT_WINNER_HOOKS } from '@crimson/perks/impl/instant-winner.ts';
import { HOOKS as JINXED_HOOKS } from '@crimson/perks/impl/jinxed-effect.ts';
import { HOOKS as LEAN_MEAN_EXP_MACHINE_HOOKS } from '@crimson/perks/impl/lean-mean-exp-machine-effect.ts';
import { HOOKS as LIFELINE_50_50_HOOKS } from '@crimson/perks/impl/lifeline-50-50.ts';
import { HOOKS as LIVING_FORTRESS_HOOKS } from '@crimson/perks/impl/living-fortress.ts';
import { HOOKS as MAN_BOMB_HOOKS } from '@crimson/perks/impl/man-bomb.ts';
import { HOOKS as MY_FAVOURITE_WEAPON_HOOKS } from '@crimson/perks/impl/my-favourite-weapon.ts';
import { HOOKS as PLAGUEBEARER_HOOKS } from '@crimson/perks/impl/plaguebearer.ts';
import { HOOKS as PYROKINETIC_HOOKS } from '@crimson/perks/impl/pyrokinetic-effect.ts';
import { HOOKS as RANDOM_WEAPON_HOOKS } from '@crimson/perks/impl/random-weapon.ts';
import { HOOKS as REFLEX_BOOSTED_HOOKS } from '@crimson/perks/impl/reflex-boosted.ts';
import { HOOKS as REGENERATION_HOOKS } from '@crimson/perks/impl/regeneration-effect.ts';
import { HOOKS as THICK_SKINNED_HOOKS } from '@crimson/perks/impl/thick-skinned.ts';
import type { PerkApplyHandler } from '@crimson/perks/runtime/apply-context.ts';
import type { PerkHooks, PerksUpdateEffectsStep, PlayerDeathHook, PlayerPerkTickStep, WorldDtStep } from '@crimson/perks/runtime/hook-types.ts';
import { updatePlayerBonusTimers } from '@crimson/perks/runtime/player-bonus-timers.ts';

// Order is parity-critical for runtime dispatch.
export const PERK_HOOKS_IN_ORDER: readonly PerkHooks[] = [
  REFLEX_BOOSTED_HOOKS,
  MAN_BOMB_HOOKS,
  LIVING_FORTRESS_HOOKS,
  FIRE_COUGH_HOOKS,
  HOT_TEMPERED_HOOKS,
  REGENERATION_HOOKS,
  LEAN_MEAN_EXP_MACHINE_HOOKS,
  DEATH_CLOCK_HOOKS,
  EVIL_EYES_HOOKS,
  PYROKINETIC_HOOKS,
  JINXED_HOOKS,
  FINAL_REVENGE_HOOKS,
  INSTANT_WINNER_HOOKS,
  FATAL_LOTTERY_HOOKS,
  RANDOM_WEAPON_HOOKS,
  LIFELINE_50_50_HOOKS,
  THICK_SKINNED_HOOKS,
  BREATHING_ROOM_HOOKS,
  INFERNAL_CONTRACT_HOOKS,
  GRIM_DEAL_HOOKS,
  AMMO_MANIAC_HOOKS,
  BANDAGE_HOOKS,
  MY_FAVOURITE_WEAPON_HOOKS,
  PLAGUEBEARER_HOOKS,
];
export const PERK_APPLY_HANDLERS: Map<PerkId, PerkApplyHandler> = new Map(
  PERK_HOOKS_IN_ORDER
    .filter((hook): hook is PerkHooks & { applyHandler: PerkApplyHandler } => hook.applyHandler !== null)
    .map((hook) => [hook.perkId, hook.applyHandler]),
);
export const WORLD_DT_STEPS: readonly WorldDtStep[] = PERK_HOOKS_IN_ORDER
  .filter((hook): hook is PerkHooks & { worldDtStep: WorldDtStep } => hook.worldDtStep !== null)
  .map((hook) => hook.worldDtStep);
export const PLAYER_DEATH_HOOKS: readonly PlayerDeathHook[] = PERK_HOOKS_IN_ORDER
  .filter((hook): hook is PerkHooks & { playerDeathHook: PlayerDeathHook } => hook.playerDeathHook !== null)
  .map((hook) => hook.playerDeathHook);
export const PLAYER_PERK_TICK_STEPS: readonly PlayerPerkTickStep[] = PERK_HOOKS_IN_ORDER.flatMap((hook) => hook.playerTickSteps);
export const PERKS_UPDATE_EFFECT_STEPS: readonly PerksUpdateEffectsStep[] = [
  updatePlayerBonusTimers,
  ...PERK_HOOKS_IN_ORDER.flatMap((hook) => hook.effectsSteps),
];
