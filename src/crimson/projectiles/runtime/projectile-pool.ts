// Port of crimson/projectiles/runtime/projectile_pool.py

import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { CreatureDamageType } from '@crimson/creatures/damage-types.ts';
import { creatureLifecycleIsAlive, creatureLifecycleIsCollidable } from '@crimson/creatures/lifecycle.ts';
import { EffectPool } from '@crimson/effects.ts';
import { NATIVE_HALF_PI, f32 } from '@crimson/math-parity.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { weaponEntryForProjectileTypeId } from '@crimson/weapons.ts';
import type { CreatureDamageApplier } from '@crimson/projectiles/types.ts';
import { MAIN_PROJECTILE_POOL_SIZE, Projectile, ProjectileCollisionProfile, ProjectileHit, ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { PROJECTILE_HIT_PERK_HOOKS, ProjectileHitInfo, ProjectileHitPerkCtx, ProjectileUpdateCtx } from '@crimson/projectiles/runtime/behaviors.ts';
import { applyDamageToCreature, hitRadiusFor, withinNativeFindRadius } from '@crimson/projectiles/runtime/collision.ts';
import { primaryRuleForTypeId } from '@crimson/projectiles/runtime/primary-rules.ts';
import { CreatureSpatialHash } from '@crimson/projectiles/runtime/spatial-hash.ts';
import { CreatureState } from '@crimson/creatures/runtime.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';

const _DEFAULT_PROJECTILE_COLLISION_PROFILE = new ProjectileCollisionProfile({
  hitRadius: 1.0,
  initialDamagePool: 1.0,
});
export const PROJECTILE_COLLISION_PROFILE_BY_TYPE_ID: Map<ProjectileTemplateId, ProjectileCollisionProfile> = new Map([
  [ProjectileTemplateId.ION_MINIGUN, new ProjectileCollisionProfile({ hitRadius: 3.0, initialDamagePool: 1.0 })],
  [ProjectileTemplateId.ION_RIFLE, new ProjectileCollisionProfile({ hitRadius: 5.0, initialDamagePool: 1.0 })],
  [ProjectileTemplateId.ION_CANNON, new ProjectileCollisionProfile({ hitRadius: 10.0, initialDamagePool: 1.0 })],
  [ProjectileTemplateId.PLASMA_CANNON, new ProjectileCollisionProfile({ hitRadius: 10.0, initialDamagePool: 1.0 })],
  [ProjectileTemplateId.GAUSS_GUN, new ProjectileCollisionProfile({ hitRadius: 1.0, initialDamagePool: 300.0 })],
  [ProjectileTemplateId.FIRE_BULLETS, new ProjectileCollisionProfile({ hitRadius: 1.0, initialDamagePool: 240.0 })],
  [ProjectileTemplateId.BLADE_GUN, new ProjectileCollisionProfile({ hitRadius: 1.0, initialDamagePool: 50.0 })],
]);

export class ProjectileUpdateOptions {
  readonly worldSize: number;
  readonly damageScaleByType: Map<number, number>;
  readonly rng: CrandLike;
  readonly runtimeState: GameplayState;
  readonly players: readonly PlayerState[];
  readonly applyPlayerDamage: (arg0: number, arg1: number) => void;
  readonly ionAoeScale: number;
  readonly detailPreset: number;
  readonly onHit: ((arg0: ProjectileHit) => unknown) | null;
  readonly onHitPost: ((arg0: ProjectileHit, arg1: unknown) => void) | null;

  constructor(opts: {
    worldSize: number;
    damageScaleByType: Map<number, number>;
    rng: CrandLike;
    runtimeState: GameplayState;
    players: readonly PlayerState[];
    applyPlayerDamage: (arg0: number, arg1: number) => void;
    ionAoeScale?: number;
    detailPreset?: number;
    onHit?: ((arg0: ProjectileHit) => unknown) | null;
    onHitPost?: ((arg0: ProjectileHit, arg1: unknown) => void) | null;
  }) {
    this.worldSize = opts.worldSize;
    this.damageScaleByType = opts.damageScaleByType;
    this.rng = opts.rng;
    this.runtimeState = opts.runtimeState;
    this.players = opts.players;
    this.applyPlayerDamage = opts.applyPlayerDamage;
    this.ionAoeScale = opts.ionAoeScale ?? 1.0;
    this.detailPreset = opts.detailPreset ?? 5;
    this.onHit = opts.onHit ?? null;
    this.onHitPost = opts.onHitPost ?? null;
  }
}

export class PrimaryStepCtx {
  readonly dt: number;
  readonly creatures: readonly CreatureState[];
  readonly options: ProjectileUpdateOptions;

  constructor(opts: {
    dt: number;
    creatures: readonly CreatureState[];
    options: ProjectileUpdateOptions;
  }) {
    this.dt = opts.dt;
    this.creatures = opts.creatures;
    this.options = opts.options;
  }
}

export class ProjectilePool {
  protected _entries: Projectile[];
  protected _creatureDamageApplier: CreatureDamageApplier | null;

  constructor(opts: { size?: number } = {}) {
    const size = opts.size ?? MAIN_PROJECTILE_POOL_SIZE;
    this._entries = Array.from({ length: Math.max(0, size) }, (_, i) => i).map((_) => new Projectile());
    this._creatureDamageApplier = null;
  }

  get entries(): Projectile[] {
    return this._entries;
  }

  get creatureDamageApplier(): CreatureDamageApplier | null {
    return this._creatureDamageApplier;
  }

  set creatureDamageApplier(value: CreatureDamageApplier | null) {
    this._creatureDamageApplier = value;
  }

  reset(): void {
    for (const entry of this._entries) {
      entry.active = false;
    }
  }

  spawn(opts: { pos: Vec2; angle: number; typeId: ProjectileTemplateId; owner: OwnerRef; travelBudget?: number; hitsPlayers?: boolean }): number {
    const pos = opts.pos;
    const angle = opts.angle;
    const typeId = opts.typeId;
    const owner = opts.owner;
    const travelBudget = opts.travelBudget ?? 0.0;
    const hitsPlayers = opts.hitsPlayers ?? false;
    let index = null;
    for (const [i, entry] of this._entries.entries()) {
      if (!entry.active) {
        index = i;
        break;
      }
    }
    if (index === null) {
      index = this._entries.length - 1;
    }
    const entry = this._entries[index];

    entry.active = true;
    // Native projectile spawn writes angle/pos as float32 fields; keep those
    // stores narrowed so next-tick movement uses the same precision.
    const angleF32 = f32(angle);
    const posF32 = new Vec2(f32(pos.x), f32(pos.y));
    entry.angle = angleF32;
    entry.pos = posF32;
    entry.origin = posF32;
    entry.vel = new Vec2(f32(Math.cos(angleF32) * 1.5), f32(Math.sin(angleF32) * 1.5));
    entry.typeId = typeId;
    entry.lifeTimer = 0.4;
    entry.reserved = 0.0;
    entry.speedScale = 1.0;
    entry.travelBudget = travelBudget;
    const weaponEntry = weaponEntryForProjectileTypeId(typeId);
    entry.travelBudget = weaponEntry.travelBudget;
    entry.owner = owner;
    entry.hitsPlayers = hitsPlayers;

    const collisionProfile = projectileCollisionProfile(typeId);
    entry.hitRadius = collisionProfile.hitRadius;
    entry.damagePool = collisionProfile.initialDamagePool;
    return index;
  }

  iterActive(): Projectile[] {
    return this._entries.filter((entry) => entry.active);
  }

  step(ctx: PrimaryStepCtx): ProjectileHit[] {
    // Update the main projectile pool.
    //
    // Modeled after `projectile_update` (0x00420b90) for the subset used by demo/state-9 work.
    const dt = f32(ctx.dt);
    const creatures = ctx.creatures;
    const options = ctx.options;
    const worldSize = f32(options.worldSize);
    const damageScaleByType = options.damageScaleByType;
    const ionAoeScale = options.ionAoeScale;
    const detailPreset = int(options.detailPreset);
    const rng = options.rng;
    const runtimeState = options.runtimeState;
    const players = options.players;
    const applyPlayerDamage = options.applyPlayerDamage;
    const applyCreatureDamage = this._creatureDamageApplier;
    const onHit = options.onHit;
    const onHitPost = options.onHitPost;

    if (dt <= 0.0) {
      return [];
    }

    let barrelGreaserActive = false;
    let ionGunMasterActive = false;
    let ionScale = ionAoeScale;
    const poisonIdx = int(PerkId.POISON_BULLETS);
    const barrelIdx = int(PerkId.BARREL_GREASER);
    const ionIdx = int(PerkId.ION_GUN_MASTER);
    for (const player of players) {
      const perkCounts = player.perkCounts;

      if (barrelIdx >= 0 && barrelIdx < perkCounts.length && int(perkCounts[barrelIdx]) > 0) {
        barrelGreaserActive = true;
      }
      if (ionIdx >= 0 && ionIdx < perkCounts.length && int(perkCounts[ionIdx]) > 0) {
        ionGunMasterActive = true;
      }
      if (barrelGreaserActive && ionGunMasterActive) {
        break;
      }
    }

    if (ionScale === 1.0 && ionGunMasterActive) {
      ionScale = 1.2;
    }

    const _ownerPerkActive = (owner: OwnerRef, perkIdx: number): boolean => {
      const playerIndex = owner.playerIndexInBounds(players.length);
      if (playerIndex === null) {
        return false;
      }
      const perkCounts = players[playerIndex].perkCounts;
      return perkIdx >= 0 && perkIdx < perkCounts.length && int(perkCounts[perkIdx]) > 0;
    };

    const effects: EffectPool | null = runtimeState.effects;
    const sfxQueue: SfxId[] | null = runtimeState.sfxQueue;

    const hits: ProjectileHit[] = [];
    const margin = 64.0;

    const _creatureIsCollidable = (creature: CreatureState): boolean => {
      if (!creature.active) {
        return false;
      }
      if (!creatureLifecycleIsCollidable(creature.lifecycleStage)) {
        return false;
      }
      return true;
    };

    const creatureSpatial = new CreatureSpatialHash({ creatures: creatures, isCollidable: _creatureIsCollidable });

    const _damageScale = (typeId: number): number => {
      const value = damageScaleByType.get(typeId) ?? null;
      if (value !== null) {
        return value;
      }
      return weaponEntryForProjectileTypeId(typeId).damageScale;
    };

    const _damageDistanceF32 = (origin: Vec2, pos: Vec2): number => {
      const dx = f32(origin.x - pos.x);
      const dy = f32(origin.y - pos.y);
      const distSq = f32(f32(dx * dx) + f32(dy * dy));
      return f32(Math.sqrt(distSq));
    };

    const _projectileDamageAmountF32 = (dist: number, damageScale: number): number => {
      // `projectile_update` computes this from float locals (`fVar11/fVar23`),
      // so keep the damage path rounded through float32.
      let distF32 = f32(dist);
      if (distF32 < 50.0) {
        distF32 = 50.0;
      }
      const damageScaleF32 = f32(damageScale);
      return f32(((100.0 / distF32) * damageScaleF32 * 30.0 + 10.0) * 0.95);
    };

    const _damageTypeFor = (): number => {
      return int(CreatureDamageType.BULLET);
    };

    const updateCtx = new ProjectileUpdateCtx({ pool: this, creatures: creatures, dt: dt, ionScale: ionScale, detailPreset: int(detailPreset), rng: rng, runtimeState: runtimeState, effects: effects, sfxQueue: sfxQueue });

    const _resetShockChainIfOwner = (index: number): void => {
      if (runtimeState.shockChainProjectileId !== index) {
        return;
      }
      runtimeState.shockChainProjectileId = -1;
      runtimeState.shockChainLinksLeft = 0;
    };

    for (const [projIndex, proj] of this._entries.entries()) {
      if (!proj.active) {
        continue;
      }
      const rule = primaryRuleForTypeId(proj.typeId);

      if (proj.lifeTimer <= 0.0) {
        proj.active = false;
        // Native `projectile_update` clears the active flag but still
        // runs this tick's life_timer branch, so expired ion projectiles
        // can apply one final linger AoE pass.
      }

      if (proj.lifeTimer < 0.4) {
        if (rule.resetShockChainOnLinger) {
          _resetShockChainIfOwner(projIndex);
        }
        rule.linger(updateCtx, proj);
        continue;
      }

      if (proj.pos.x < -margin || proj.pos.y < -margin || proj.pos.x > worldSize + margin || proj.pos.y > worldSize + margin) {
        proj.lifeTimer = f32(proj.lifeTimer - dt);
        continue;
      }

      let steps = int(proj.travelBudget);
      if (barrelGreaserActive && proj.owner.isPlayer()) {
        steps *= 2;
      }

      // Decompile parity (`projectile_update`, 0x00420b90):
      //   local_cc += (float)(cos(angle - pi/2) * frame_dt * 20.0f) * speed_scale * 3.0f
      //   local_c8 += (float)(sin(angle - pi/2) * frame_dt * 20.0f) * speed_scale * 3.0f
      // Keep the float32 cast before `* speed_scale * 3.0`.
      const headingRadians = proj.angle - NATIVE_HALF_PI;
      const dirX = Math.cos(headingRadians);
      const dirY = Math.sin(headingRadians);
      let acc = new Vec2();
      let step = 0;
      while (step < steps) {
        acc = new Vec2(f32(acc.x + f32(dirX * dt * 20.0) * proj.speedScale * 3.0), f32(acc.y + f32(dirY * dt * 20.0) * proj.speedScale * 3.0));

        let hitIdx: any;
        let creature: any;
        let ownerPlayerIndex: any;
        if (acc.length() >= 4.0 || steps <= step + 3) {
          const move = acc;
          proj.pos = new Vec2(f32(proj.pos.x + move.x), f32(proj.pos.y + move.y));
          acc = new Vec2();

          hitIdx = null;
          const ownerCreatureIdx = proj.owner.creatureIndexInBounds(creatures.length);
          for (const idx of creatureSpatial.candidateIndices({ pos: proj.pos, radius: proj.hitRadius })) {
            creature = creatures[idx];
            if (!_creatureIsCollidable(creature)) {
              continue;
            }
            if (withinNativeFindRadius({ origin: proj.pos, target: creature.pos, radius: proj.hitRadius, targetSize: creature.size })) {
              hitIdx = idx;
              break;
            }
          }

          const ownerCollision = (hitIdx !== null && ownerCreatureIdx !== null && int(hitIdx) === ownerCreatureIdx);
          if (ownerCollision) {
            // Native `creature_find_in_radius` does not skip owner id during
            // search; owner hits are discarded after the first match instead of
            // continuing to a later candidate in the same tick.
            hitIdx = null;
          }

          let canHitPlayers: boolean;
          if (hitIdx === null) {
            canHitPlayers = true;
            if (int(projIndex) === int(runtimeState.shockChainProjectileId)) {
              // Native skips `player_find_in_radius` for the currently tracked
              // shock-chain projectile slot in this branch.
              canHitPlayers = false;
            }

            let hitPlayerIdx: any;
            if (proj.hitsPlayers && canHitPlayers) {
              hitPlayerIdx = null;
              ownerPlayerIndex = proj.owner.playerIndexInBounds(players.length);
              for (const [idx, player] of players.entries()) {
                if (ownerPlayerIndex !== null && idx === ownerPlayerIndex) {
                  continue;
                }
                if (player.health <= 0.0) {
                  continue;
                }
                if (withinNativeFindRadius({ origin: proj.pos, target: player.pos, radius: proj.hitRadius, targetSize: player.size })) {
                  hitPlayerIdx = idx;
                  break;
                }
              }

              if (hitPlayerIdx === null) {
                step += 3;
                continue;
              }

              proj.lifeTimer = 0.25;
              applyPlayerDamage(int(hitPlayerIdx), 10.0);

              step += 3;
              continue;
            }

            step += 3;
            continue;
          }

          const typeId = proj.typeId;
          creature = creatures[hitIdx];

          const perkCtx = new ProjectileHitPerkCtx({ proj: proj, creature: creature, rng: rng, ownerPerkActive: _ownerPerkActive, poisonIdx: poisonIdx });
          for (const hook of PROJECTILE_HIT_PERK_HOOKS) {
            hook(perkCtx);
          }

          rule.preHit(updateCtx, proj, int(hitIdx));

          ownerPlayerIndex = proj.owner.playerIndexInBounds(runtimeState.shotsHit.length);
          if (ownerPlayerIndex !== null && creatureLifecycleIsAlive(creature.lifecycleStage)) {
            const shotsHit = runtimeState.shotsHit;
            shotsHit[ownerPlayerIndex] += 1;
          }

          const target = creature.pos;
          const hit = new ProjectileHit({ typeId: typeId, origin: proj.origin, hit: proj.pos, target: target });
          hits.push(hit);
          const hitCtx = onHit !== null ? onHit(hit) : null;

          if (proj.lifeTimer !== 0.25 && rule.stopOnHit) {
            proj.lifeTimer = 0.25;
            const jitter = rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_STOP_ON_HIT_JITTER }) & 3;
            const jitterDx = f32(dirX * jitter);
            const jitterDy = f32(dirY * jitter);
            proj.pos = new Vec2(f32(proj.pos.x + jitterDx), f32(proj.pos.y + jitterDy));
          }

          const dist = _damageDistanceF32(proj.origin, proj.pos);

          rule.postHit(updateCtx, new ProjectileHitInfo({ projIndex: int(projIndex), proj: proj, hitIdx: int(hitIdx), move: move, target: target }));

          const damageScale = _damageScale(typeId);
          const damageAmount = _projectileDamageAmountF32(dist, damageScale);

          if (damageAmount > 0.0 && creature.hp > 0.0) {
            const remaining = proj.damagePool - 1.0;
            proj.damagePool = remaining;
            // Native `projectile_update` writes both impulse components from the
            // same cosine term (`cos(angle - pi/2) * speed_scale`).
            const impulseAxis = f32(Math.cos(proj.angle - NATIVE_HALF_PI) * proj.speedScale);
            const impulse = new Vec2(impulseAxis, impulseAxis);
            const damageType = _damageTypeFor();
            if (remaining <= 0.0) {
              applyDamageToCreature(
                creatures,
                int(hitIdx),
                damageAmount,
                { damageType: damageType, impulse: impulse, owner: proj.owner, applyCreatureDamage: applyCreatureDamage },
              );
              creatureSpatial.syncIndex(int(hitIdx));
              if (proj.lifeTimer !== 0.25) {
                proj.lifeTimer = 0.25;
              }
            } else {
              applyDamageToCreature(
                creatures,
                int(hitIdx),
                remaining,
                { damageType: damageType, impulse: impulse, owner: proj.owner, applyCreatureDamage: applyCreatureDamage },
              );
              creatureSpatial.syncIndex(int(hitIdx));
              proj.damagePool -= creature.hp;
            }
          }

          // Native `projectile_update` has separate freeze-hit ownership for
          // primary and secondary projectiles. This branch is the default
          // primary-projectile single-shard path (`crt_rand` @ 0x4215fa ->
          // caller_static 0x4215ff). Secondary rocket-style `% 612` shard
          // loops live in the secondary projectile update path instead.
          if (runtimeState.bonuses.freeze > 0.0 && effects !== null && rule.emitDefaultFreezeShard) {
            let shardAngle = (proj.angle - NATIVE_HALF_PI);
            shardAngle += rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_DEFAULT_FREEZE_SHARD_ANGLE }) % 100 * 0.01;
            effects.spawnFreezeShard({
              pos: proj.pos,
              angle: shardAngle,
              rng: rng,
              detailPreset: int(detailPreset),
            });
          }

          if (proj.damagePool === 1.0) {
            // Native clears damage_pool to 0.0 whenever it's exactly 1.0
            // in this branch, even if life_timer is already 0.25.
            const lifeBefore = proj.lifeTimer;
            proj.damagePool = 0.0;
            if (lifeBefore !== 0.25) {
              proj.lifeTimer = 0.25;
            }
          }

          if (proj.lifeTimer === 0.25 && rule.stopOnHit) {
            if (onHitPost !== null && hitCtx !== null) {
              onHitPost(hit, hitCtx);
            }
            break;
          }

          if (proj.damagePool <= 0.0) {
            if (onHitPost !== null && hitCtx !== null) {
              onHitPost(hit, hitCtx);
            }
            break;
          }

          if (onHitPost !== null && hitCtx !== null) {
            onHitPost(hit, hitCtx);
          }
        }

        step += 3;
      }
    }

    return hits;
  }

  updateDemo(dt: number, creatures: readonly CreatureState[], opts: { worldSize: number; speedByType: Map<number, number>; damageByType: Map<number, number> }): ProjectileHit[] {
    const worldSize = opts.worldSize;
    const speedByType = opts.speedByType;
    const damageByType = opts.damageByType;
    // Update a small projectile subset for the demo view.

    if (dt <= 0.0) {
      return [];
    }

    const hits: ProjectileHit[] = [];
    const margin = 64.0;

    for (const proj of this._entries) {
      if (!proj.active) {
        continue;
      }

      if (proj.lifeTimer <= 0.0) {
        proj.active = false;
        continue;
      }

      if (proj.lifeTimer < 0.4) {
        let damage: number;
        let radius: number;
        if (proj.typeId === ProjectileTemplateId.ION_RIFLE) {
          damage = dt * 100.0;
          radius = 88.0;
          for (let creature of creatures) {
            if (creature.hp <= 0.0) {
              continue;
            }
            let creatureRadius = hitRadiusFor(creature);
            let hitR = radius + creatureRadius;
            if (Vec2.distanceSq(proj.pos, creature.pos) <= hitR * hitR) {
              creature.hp -= damage;
            }
          }
        } else if (proj.typeId === ProjectileTemplateId.ION_MINIGUN) {
          damage = dt * 40.0;
          radius = 60.0;
          for (let creature of creatures) {
            if (creature.hp <= 0.0) {
              continue;
            }
            let creatureRadius = hitRadiusFor(creature);
            let hitR = radius + creatureRadius;
            if (Vec2.distanceSq(proj.pos, creature.pos) <= hitR * hitR) {
              creature.hp -= damage;
            }
          }
        }
        proj.lifeTimer = f32(proj.lifeTimer - dt);
        continue;
      }

      if (proj.pos.x < -margin || proj.pos.y < -margin || proj.pos.x > worldSize + margin || proj.pos.y > worldSize + margin) {
        proj.lifeTimer = f32(proj.lifeTimer - dt);
        continue;
      }

      const speed = (speedByType.get(proj.typeId) ?? 650.0) * proj.speedScale;
      const direction = Vec2.fromHeading(proj.angle);
      proj.pos = proj.pos.add(direction.mul(speed * dt));

      let hitIdx = null;
      for (const [idx, creature] of creatures.entries()) {
        if (creature.hp <= 0.0) {
          continue;
        }
        let creatureRadius = hitRadiusFor(creature);
        let hitR = proj.hitRadius + creatureRadius;
        if (Vec2.distanceSq(proj.pos, creature.pos) <= hitR * hitR) {
          hitIdx = idx;
          break;
        }
      }
      if (hitIdx === null) {
        continue;
      }

      let creature = creatures[hitIdx];
      hits.push(new ProjectileHit({ typeId: proj.typeId, origin: proj.origin, hit: proj.pos, target: creature.pos }));

      creature = creatures[hitIdx];
      creature.hp -= damageByType.get(proj.typeId) ?? 10.0;

      proj.lifeTimer = 0.25;
    }

    return hits;
  }
}

export function projectileCollisionProfile(typeId: ProjectileTemplateId): ProjectileCollisionProfile {
  return PROJECTILE_COLLISION_PROFILE_BY_TYPE_ID.get(typeId) ?? _DEFAULT_PROJECTILE_COLLISION_PROFILE;
}
