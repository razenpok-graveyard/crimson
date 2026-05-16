// Port of crimson/creatures/damage.py

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { EffectPool } from '@crimson/effects.ts';
import { EffectId } from '@crimson/effects-atlas.ts';
import { f32 } from '@crimson/math-parity.ts';
import type { OwnerRef } from '@crimson/owner-ref.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import { CreatureDamageType } from '@crimson/creatures/damage-types.ts';
import { CREATURE_LIFECYCLE_ALIVE } from '@crimson/creatures/lifecycle.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import { CreatureFlags, CreatureTypeId } from '@crimson/creatures/spawn.ts';

export type CreatureDamageStep = (arg0: CreatureDamageCtx) => void;

export class CreatureDamageCtx {
  creature: CreatureState;
  damage: number;
  damageType: number;
  impulse: Vec2;
  owner: OwnerRef;
  dt: number;
  players: PlayerState[];
  rng: CrandLike;

  constructor(opts: {
    creature: CreatureState;
    damage: number;
    damageType: number;
    impulse: Vec2;
    owner: OwnerRef;
    dt: number;
    players: PlayerState[];
    rng: CrandLike;
  }) {
    this.creature = opts.creature;
    this.damage = opts.damage;
    this.damageType = opts.damageType;
    this.impulse = opts.impulse;
    this.owner = opts.owner;
    this.dt = opts.dt;
    this.players = opts.players;
    this.rng = opts.rng;
  }
}

function anyPlayerHasPerk(players: PlayerState[], perkId: PerkId): boolean {
  return players.some((player) => perkActive(player, perkId));
}

function damageType1UraniumFilledBullets(ctx: CreatureDamageCtx): void {
  if (!anyPlayerHasPerk(ctx.players, PerkId.URANIUM_FILLED_BULLETS)) {
    return;
  }
  ctx.damage *= 2.0;
}

function damageType1LivingFortress(ctx: CreatureDamageCtx): void {
  if (!anyPlayerHasPerk(ctx.players, PerkId.LIVING_FORTRESS)) {
    return;
  }
  for (const player of ctx.players) {
    if (player.health <= 0.0) {
      continue;
    }
    const timer = player.livingFortressTimer;
    if (timer > 0.0) {
      ctx.damage *= timer * 0.05 + 1.0;
    }
  }
}

function damageType1BarrelGreaser(ctx: CreatureDamageCtx): void {
  if (!anyPlayerHasPerk(ctx.players, PerkId.BARREL_GREASER)) {
    return;
  }
  ctx.damage *= 1.4;
}

function damageType1Doctor(ctx: CreatureDamageCtx): void {
  if (!anyPlayerHasPerk(ctx.players, PerkId.DOCTOR)) {
    return;
  }
  ctx.damage *= 1.2;
}

function damageType1HeadingJitter(ctx: CreatureDamageCtx): void {
  const creature = ctx.creature;
  if ((creature.flags & CreatureFlags.ANIM_PING_PONG) !== 0) {
    return;
  }
  const jitter = ((ctx.rng.rand({ caller: RngCallerStatic.CREATURE_APPLY_DAMAGE_HEADING_JITTER }) & 0x7F) - 0x40) * 0.002;
  const size = Math.max(1e-6, creature.size);
  let turn = jitter / (size * 0.025);
  turn = Math.min(Math.PI / 2.0, turn);
  creature.heading += turn;
}

function damageType7IonGunMaster(ctx: CreatureDamageCtx): void {
  if (Array.from(ctx.players).some((player) => perkActive(player, PerkId.ION_GUN_MASTER))) {
    ctx.damage *= 1.2;
  }
}

function damageType4Pyromaniac(ctx: CreatureDamageCtx): void {
  if (!anyPlayerHasPerk(ctx.players, PerkId.PYROMANIAC)) {
    return;
  }
  ctx.damage *= 1.5;
  ctx.rng.rand({ caller: RngCallerStatic.CREATURE_APPLY_DAMAGE_PYROMANIAC });
}

function damageLethalRangedShockBurst(opts: { creature: CreatureState; rng: CrandLike; effects: EffectPool | null; detailPreset: number }): void {
  // Port the `creature_apply_damage` lethal branch for `flags & 0x10`.
  const creature = opts.creature;
  const rng = opts.rng;
  const effects = opts.effects;
  const detailPreset = opts.detailPreset;
  if ((creature.flags & CreatureFlags.RANGED_ATTACK_SHOCK) === 0) {
    return;
  }
  for (let i = 0; i < 5; i++) {
    const rotation = (rng.rand({ caller: RngCallerStatic.CREATURE_APPLY_DAMAGE_SHOCK_BURST_ROTATION }) & 0x7F) * 0.049087387;
    const vel = new Vec2((rng.rand({ caller: RngCallerStatic.CREATURE_APPLY_DAMAGE_SHOCK_BURST_VEL_X }) & 0x7F) - 0x40, (rng.rand({ caller: RngCallerStatic.CREATURE_APPLY_DAMAGE_SHOCK_BURST_VEL_Y }) & 0x7F) - 0x40);
    const scaleStep = rng.rand({ caller: RngCallerStatic.CREATURE_APPLY_DAMAGE_SHOCK_BURST_SCALE_STEP }) % 140 * 0.01 + 0.3;
    if (effects === null) {
      continue;
    }
    effects.spawn({
      effectId: int(EffectId.BURST),
      pos: creature.pos,
      vel: vel,
      rotation: rotation,
      scale: 1.0,
      halfWidth: 36.0,
      halfHeight: 36.0,
      age: 0.0,
      lifetime: 0.7,
      flags: 0x1D,
      color: new RGBA(0.8, 0.8, 0.3, 0.5),
      rotationStep: 0.0,
      scaleStep: scaleStep,
      detailPreset: int(detailPreset),
    });
  }
}

export function resolveNativeDeathSfx(creature: CreatureState, opts: { rng: CrandLike; preserveBugs?: boolean }): SfxId[] {
  // Resolve the native `creature_apply_damage` death sound, if this path owns one.
  const rng = opts.rng;
  const preserveBugs = opts.preserveBugs ?? false;
  if ((creature.flags & CreatureFlags.RANGED_ATTACK_SHOCK) !== 0) {
    return [];
  }
  const roll = rng.rand({ caller: RngCallerStatic.CREATURE_APPLY_DAMAGE_DEATH_SFX });
  if (creature.typeId === CreatureTypeId.TROOPER) {
    if (preserveBugs) {
      return [TROOPER_DEATH_SFX_PRESERVE_BUGS[roll & 3]];
    }
    return [TROOPER_DEATH_SFX[roll % TROOPER_DEATH_SFX.length]];
  }
  const options = CREATURE_DEATH_SFX.get(creature.typeId) ?? null;
  if (options === null) {
    return [];
  }
  return [options[roll & 3]];
}

export function creatureApplyDamage(creature: CreatureState, opts: { damageAmount: number; damageType: number; impulse: Vec2; owner: OwnerRef; dt: number; players: PlayerState[]; rng: CrandLike; effects?: EffectPool | null; detailPreset?: number }): boolean {
  // Apply damage to a creature, returning True if the hit killed it.
  //
  // This is a partial port of `creature_apply_damage` (FUN_004207c0).
  //
  // Notes:
  // - Death side-effects are handled by the caller.
  // - `damage_type` is a native integer category; call sites must supply it.

  const damageAmount = opts.damageAmount;
  const damageType = opts.damageType;
  const impulse = opts.impulse;
  const owner = opts.owner;
  const dt = opts.dt;
  const players = opts.players;
  const rng = opts.rng;
  const effects = opts.effects ?? null;
  const detailPreset = opts.detailPreset ?? 5;
  creature.lastHitOwner = owner;
  creature.hitFlashTimer = 0.2;

  const ctx = new CreatureDamageCtx({ creature: creature, damage: damageAmount, damageType: int(damageType), impulse: impulse, owner: owner, dt: dt, players: players, rng: rng });

  for (const step of CREATURE_DAMAGE_GLOBAL_PRE_STEPS.get(ctx.damageType) ?? []) {
    step(ctx);
  }

  for (const step of CREATURE_DAMAGE_PRE_STEPS.get(ctx.damageType) ?? []) {
    step(ctx);
  }
  if (ctx.damageType === CreatureDamageType.BULLET) {
    damageType1HeadingJitter(ctx);
  }

  if (creature.hp <= 0.0) {
    if (dt > 0.0) {
      creature.lifecycleStage = f32(creature.lifecycleStage - f32(dt * 15.0));
    }
    return true;
  }

  for (const step of CREATURE_DAMAGE_ALIVE_STEPS.get(ctx.damageType) ?? []) {
    step(ctx);
  }

  creature.hp -= ctx.damage;
  creature.vel = creature.vel.sub(ctx.impulse);

  if (creature.hp <= 0.0) {
    if (dt > 0.0) {
      creature.lifecycleStage = f32(creature.lifecycleStage - f32(dt));
    } else {
      creature.lifecycleStage = f32(creature.lifecycleStage - 0.001);
    }
    creature.vel = creature.vel.sub(impulse.mul(2.0));
    damageLethalRangedShockBurst({
      creature: creature,
      rng: rng,
      effects: effects,
      detailPreset: int(detailPreset),
    });
    return true;
  }

  return false;
}

export function creatureApplyDamageWithLethalFollowup(creature: CreatureState, opts: { damageAmount: number; damageType: number; impulse: Vec2; owner: OwnerRef; dt: number; players: PlayerState[]; rng: CrandLike; preserveBugs?: boolean; effects?: EffectPool | null; detailPreset?: number; onLethal: (arg0: SfxId[]) => void }): boolean {
  // Apply damage and run a required lethal follow-up exactly on death transition.
  //
  // This helper keeps lethal bookkeeping adjacent to damage application so runtime
  // call sites cannot accidentally skip death handling side effects.

  const damageAmount = opts.damageAmount;
  const damageType = opts.damageType;
  const impulse = opts.impulse;
  const owner = opts.owner;
  const dt = opts.dt;
  const players = opts.players;
  const rng = opts.rng;
  const preserveBugs = opts.preserveBugs ?? false;
  const effects = opts.effects ?? null;
  const detailPreset = opts.detailPreset ?? 5;
  const onLethal = opts.onLethal;
  const deathStartNeeded = creature.hp > 0.0 && creature.lifecycleStage === CREATURE_LIFECYCLE_ALIVE;
  const killed = creatureApplyDamage(creature, { damageAmount: damageAmount, damageType: int(damageType), impulse: impulse, owner: owner, dt: dt, players: players, rng: rng, effects: effects, detailPreset: int(detailPreset) });
  if (killed && deathStartNeeded) {
    onLethal(resolveNativeDeathSfx(creature, { rng: rng, preserveBugs: preserveBugs }));
    return true;
  }
  return false;
}

export const CREATURE_DEATH_SFX: Map<CreatureTypeId, readonly SfxId[]> = new Map([
  [CreatureTypeId.ZOMBIE, [
    SfxId.ZOMBIE_DIE_01,
    SfxId.ZOMBIE_DIE_02,
    SfxId.ZOMBIE_DIE_03,
    SfxId.ZOMBIE_DIE_04,
  ]],
  [CreatureTypeId.LIZARD, [
    SfxId.LIZARD_DIE_01,
    SfxId.LIZARD_DIE_02,
    SfxId.LIZARD_DIE_03,
    SfxId.LIZARD_DIE_04,
  ]],
  [CreatureTypeId.ALIEN, [
    SfxId.ALIEN_DIE_01,
    SfxId.ALIEN_DIE_02,
    SfxId.ALIEN_DIE_03,
    SfxId.ALIEN_DIE_04,
  ]],
  [CreatureTypeId.SPIDER_SP1, [
    SfxId.SPIDER_DIE_01,
    SfxId.SPIDER_DIE_02,
    SfxId.SPIDER_DIE_03,
    SfxId.SPIDER_DIE_04,
  ]],
  [CreatureTypeId.SPIDER_SP2, [
    SfxId.SPIDER_DIE_01,
    SfxId.SPIDER_DIE_02,
    SfxId.SPIDER_DIE_03,
    SfxId.SPIDER_DIE_04,
  ]],
]);
export const TROOPER_DEATH_SFX: readonly SfxId[] = [
  SfxId.TROOPER_DIE_01,
  SfxId.TROOPER_DIE_02,
  SfxId.TROOPER_DIE_03,
];
// Native `gameplay_reset_state` writes trooper death-bank slots 0..2 only, but
// `creature_apply_damage` still indexes the bank with `rand & 3`. The unwritten
// slot remains BSS-zeroed and resolves to native SFX id 0:
// `sfx_trooper_inpain_01`.
export const TROOPER_DEATH_SFX_PRESERVE_BUGS: readonly SfxId[] = [
  ...TROOPER_DEATH_SFX,
  SfxId.TROOPER_INPAIN_01,
];
export const CREATURE_DAMAGE_PRE_STEPS: Map<number, readonly CreatureDamageStep[]> = new Map([
  [CreatureDamageType.BULLET, [
    damageType1UraniumFilledBullets,
    damageType1LivingFortress,
    damageType1BarrelGreaser,
    damageType1Doctor,
  ]],
]);
export const CREATURE_DAMAGE_GLOBAL_PRE_STEPS: Map<number, readonly CreatureDamageStep[]> = new Map([
  [CreatureDamageType.ION, [damageType7IonGunMaster]],
]);
export const CREATURE_DAMAGE_ALIVE_STEPS: Map<number, readonly CreatureDamageStep[]> = new Map([
  [CreatureDamageType.FIRE, [damageType4Pyromaniac]],
]);
