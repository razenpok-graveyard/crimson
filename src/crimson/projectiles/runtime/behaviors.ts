// Port of crimson/projectiles/runtime/behaviors.py

import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import type { SfxId } from '@grim/sfx-map.ts';
import { CreatureDamageType } from '@crimson/creatures/damage-types.ts';
import { creatureLifecycleIsCollidable } from '@crimson/creatures/lifecycle.ts';
import { CreatureFlags } from '@crimson/creatures/spawn.ts';
import type { EffectPool } from '@crimson/effects.ts';
import { f32 } from '@crimson/math-parity.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { weaponEntryForProjectileTypeId } from '@crimson/weapons.ts';
import { spawnIonHitEffects, spawnPlasmaCannonHitEffects, spawnShrinkifierHitEffects, spawnSplitterHitEffects } from '@crimson/projectiles/effects.ts';
import type { Projectile } from '@crimson/projectiles/types.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { applyDamageToCreature, hitRadiusFor } from '@crimson/projectiles/runtime/collision.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import type { ProjectilePool } from '@crimson/projectiles/runtime/projectile-pool.ts';

export type ProjectileHitPerkHook = (arg0: ProjectileHitPerkCtx) => void;

export class ProjectileUpdateCtx {
  pool: ProjectilePool;
  creatures: readonly CreatureState[];
  dt: number;
  ionScale: number;
  detailPreset: number;
  rng: CrandLike;
  runtimeState: GameplayState | null;
  effects: EffectPool | null;
  sfxQueue: SfxId[] | null;

  constructor(opts: {
    pool: ProjectilePool;
    creatures: readonly CreatureState[];
    dt: number;
    ionScale: number;
    detailPreset: number;
    rng: CrandLike;
    runtimeState: GameplayState | null;
    effects: EffectPool | null;
    sfxQueue: SfxId[] | null;
  }) {
    this.pool = opts.pool;
    this.creatures = opts.creatures;
    this.dt = opts.dt;
    this.ionScale = opts.ionScale;
    this.detailPreset = opts.detailPreset;
    this.rng = opts.rng;
    this.runtimeState = opts.runtimeState;
    this.effects = opts.effects;
    this.sfxQueue = opts.sfxQueue;
  }
}

export class ProjectileHitInfo {
  projIndex: number;
  proj: Projectile;
  hitIdx: number;
  move: Vec2;
  target: Vec2;

  constructor(opts: {
    projIndex: number;
    proj: Projectile;
    hitIdx: number;
    move: Vec2;
    target: Vec2;
  }) {
    this.projIndex = opts.projIndex;
    this.proj = opts.proj;
    this.hitIdx = opts.hitIdx;
    this.move = opts.move;
    this.target = opts.target;
  }
}

export class ProjectileHitPerkCtx {
  proj: Projectile;
  creature: CreatureState;
  rng: CrandLike;
  ownerPerkActive: (arg0: OwnerRef, arg1: number) => boolean;
  poisonIdx: number;

  constructor(opts: {
    proj: Projectile;
    creature: CreatureState;
    rng: CrandLike;
    ownerPerkActive: (arg0: OwnerRef, arg1: number) => boolean;
    poisonIdx: number;
  }) {
    this.proj = opts.proj;
    this.creature = opts.creature;
    this.rng = opts.rng;
    this.ownerPerkActive = opts.ownerPerkActive;
    this.poisonIdx = opts.poisonIdx;
  }
}

export function projectileHitPerkPoisonBullets(ctx: ProjectileHitPerkCtx): void {
  if (ctx.ownerPerkActive(ctx.proj.owner, int(ctx.poisonIdx)) && (ctx.rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_POISON_BULLETS_GATE }) & 7) === 1) {
    ctx.creature.flags |= CreatureFlags.SELF_DAMAGE_TICK;
  }
}

export function lifeTimerSubF32(lifeTimer: number, amount: number): number {
  return f32(lifeTimer - amount);
}

export function lingerDefault(ctx: ProjectileUpdateCtx, proj: Projectile): void {
  proj.lifeTimer = lifeTimerSubF32(proj.lifeTimer, ctx.dt);
}

export function lingerGaussGun(ctx: ProjectileUpdateCtx, proj: Projectile): void {
  proj.lifeTimer = lifeTimerSubF32(proj.lifeTimer, ctx.dt * 0.1);
}

export function lingerIonAoe(ctx: ProjectileUpdateCtx, proj: Projectile, opts: { lifeDecayScale: number; damagePerSecond: number; baseRadius: number }): void {
  const lifeDecayScale = opts.lifeDecayScale;
  const damagePerSecond = opts.damagePerSecond;
  const baseRadius = opts.baseRadius;
  proj.lifeTimer = lifeTimerSubF32(proj.lifeTimer, ctx.dt * lifeDecayScale);
  const damage = ctx.dt * damagePerSecond;
  const radius = ctx.ionScale * baseRadius;
  for (const [creatureIdx, creature] of ctx.creatures.entries()) {
    if (!creature.active) {
      continue;
    }
    if (!creatureLifecycleIsCollidable(creature.lifecycleStage)) {
      continue;
    }
    const creatureRadius = hitRadiusFor(creature);
    const hitR = radius + creatureRadius;
    if (Vec2.distanceSq(proj.pos, creature.pos) <= hitR * hitR) {
      applyDamageToCreature(
        ctx.creatures,
        creatureIdx,
        damage,
        { damageType: CreatureDamageType.ION, impulse: new Vec2(), owner: proj.owner, applyCreatureDamage: ctx.pool.creatureDamageApplier },
      );
    }
  }
}

export function lingerIonMinigun(ctx: ProjectileUpdateCtx, proj: Projectile): void {
  lingerIonAoe(
    ctx,
    proj,
    { lifeDecayScale: 1.0, damagePerSecond: 40.0, baseRadius: 60.0 },
  );
}

export function lingerIonRifle(ctx: ProjectileUpdateCtx, proj: Projectile): void {
  lingerIonAoe(
    ctx,
    proj,
    { lifeDecayScale: 1.0, damagePerSecond: 100.0, baseRadius: 88.0 },
  );
}

export function lingerIonCannon(ctx: ProjectileUpdateCtx, proj: Projectile): void {
  lingerIonAoe(
    ctx,
    proj,
    { lifeDecayScale: 0.7, damagePerSecond: 300.0, baseRadius: 128.0 },
  );
}

export function preHitSplitter(ctx: ProjectileUpdateCtx, proj: Projectile, hitIdx: number): void {
  spawnSplitterHitEffects(
    ctx.effects,
    { pos: proj.pos, rng: ctx.rng, detailPreset: ctx.detailPreset },
  );
  // Native player-hit checks key off non-player ownership; creature-owned splitters
  // always satisfy this, so they can hit players even when the parent was local-owned.
  const splitHitsPlayers = true;
  ctx.pool.spawn({
    pos: proj.pos,
    angle: proj.angle - 1.0471976,
    typeId: ProjectileTemplateId.SPLITTER_GUN,
    owner: OwnerRef.fromCreature(int(hitIdx)),
    travelBudget: proj.travelBudget,
    hitsPlayers: splitHitsPlayers,
  });
  ctx.pool.spawn({
    pos: proj.pos,
    angle: proj.angle + 1.0471976,
    typeId: ProjectileTemplateId.SPLITTER_GUN,
    owner: OwnerRef.fromCreature(int(hitIdx)),
    travelBudget: proj.travelBudget,
    hitsPlayers: splitHitsPlayers,
  });
}

export function postHitIonCommon(ctx: ProjectileUpdateCtx, hit: ProjectileHitInfo): void {
  spawnIonHitEffects(
    ctx.effects,
    ctx.sfxQueue,
    { typeId: hit.proj.typeId, pos: hit.proj.pos, rng: ctx.rng, detailPreset: ctx.detailPreset },
  );
}

export function postHitIonRifle(ctx: ProjectileUpdateCtx, hit: ProjectileHitInfo): void {
  const runtimeState = ctx.runtimeState;
  const creatures = ctx.creatures;
  const hitCreature = int(hit.hitIdx);
  if (runtimeState !== null && runtimeState.shockChainProjectileId === hit.projIndex && hitCreature >= 0 && hitCreature < creatures.length) {
    const linksLeft = int(runtimeState.shockChainLinksLeft);
    let bestIdx: number;
    let bestDistSq: any;
    if (linksLeft > 0 && creatures.length > 0) {
      runtimeState.shockChainLinksLeft = linksLeft - 1;

      const originPos = hit.proj.pos;
      const minDistSq = 100.0 * 100.0;

      bestIdx = Boolean(runtimeState.preserveBugs) ? 0 : -1;
      bestDistSq = 1e12;
      for (const [creatureId, creature] of creatures.entries()) {
        if (creatureId === hitCreature) {
          continue;
        }
        if (!creature.active) {
          continue;
        }
        const dSq = Vec2.distanceSq(originPos, creature.pos);
        if (dSq <= minDistSq) {
          continue;
        }
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = creatureId;
        }
      }

      if (bestIdx < 0) {
        postHitIonCommon(ctx, hit);
        return;
      }

      const origin = creatures[hitCreature];
      const target = creatures[bestIdx];
      const angle = target.pos.sub(origin.pos).toHeading();

      const prevGuard = Boolean(runtimeState.bonusSpawnGuard);
      runtimeState.bonusSpawnGuard = true;
      let projId: any;
      try {
        projId = ctx.pool.spawn({ pos: originPos, angle: angle, typeId: hit.proj.typeId, owner: OwnerRef.fromCreature(hitCreature), travelBudget: hit.proj.travelBudget });
      } finally {
        runtimeState.bonusSpawnGuard = prevGuard;
      }
      runtimeState.shockChainProjectileId = projId;
    }
  }
  postHitIonCommon(ctx, hit);
}

export function postHitPlasmaCannon(ctx: ProjectileUpdateCtx, hit: ProjectileHitInfo): void {
  const creature = ctx.creatures[int(hit.hitIdx)];
  const size = creature.size;
  const ringRadius = size * 0.5 + 1.0;

  const plasmaEntry = weaponEntryForProjectileTypeId(ProjectileTemplateId.PLASMA_RIFLE);
  const plasmaMeta = plasmaEntry.travelBudget;

  const runtimeState = ctx.runtimeState;
  let prevGuard = false;
  if (runtimeState !== null) {
    prevGuard = Boolean(runtimeState.bonusSpawnGuard);
    runtimeState.bonusSpawnGuard = true;
  }
  try {
    for (let ringIdx = 0; ringIdx < 12; ringIdx++) {
      const ringAngle = ringIdx * (Math.PI / 6.0);
      const ringOffset = Vec2.fromAngle(ringAngle).mul(ringRadius);
      ctx.pool.spawn({
        pos: hit.proj.pos.add(ringOffset),
        angle: ringAngle,
        typeId: ProjectileTemplateId.PLASMA_RIFLE,
        owner: OwnerRef.fromLocalPlayer(0),
        travelBudget: plasmaMeta,
      });
    }
  } finally {
    if (runtimeState !== null) {
      runtimeState.bonusSpawnGuard = prevGuard;
    }
  }

  spawnPlasmaCannonHitEffects(
    ctx.effects,
    ctx.sfxQueue,
    { pos: hit.proj.pos, detailPreset: ctx.detailPreset },
  );
}

export function postHitShrinkifier(ctx: ProjectileUpdateCtx, hit: ProjectileHitInfo): void {
  spawnShrinkifierHitEffects(
    ctx.effects,
    { pos: hit.proj.pos, rng: ctx.rng, detailPreset: ctx.detailPreset },
  );

  const creature = ctx.creatures[int(hit.hitIdx)];
  const newSize = creature.size * 0.65;
  creature.size = newSize;
  if (newSize < 16.0) {
    applyDamageToCreature(
      ctx.creatures,
      int(hit.hitIdx),
      creature.hp + 1.0,
      { damageType: CreatureDamageType.BULLET, impulse: new Vec2(), owner: hit.proj.owner, applyCreatureDamage: ctx.pool.creatureDamageApplier },
    );
  }
  hit.proj.lifeTimer = 0.25;
}

export function postHitPulseGun(ctx: ProjectileUpdateCtx, hit: ProjectileHitInfo): void {
  const creature = ctx.creatures[int(hit.hitIdx)];
  creature.pos = creature.pos.add(hit.move.mul(3.0));
}

export function postHitPlagueSpreader(ctx: ProjectileUpdateCtx, hit: ProjectileHitInfo): void {
  const creature = ctx.creatures[int(hit.hitIdx)];
  creature.plagueInfected = true;
}

export const PROJECTILE_HIT_PERK_HOOKS: readonly ProjectileHitPerkHook[] = [projectileHitPerkPoisonBullets];
