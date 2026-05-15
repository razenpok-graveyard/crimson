// Port of crimson/creatures/runtime.py

// Creature realtime simulation glue.
//
// This module materializes pure spawn plans (`creatures.spawn`) into a fixed-size
// runtime pool and advances creatures each frame using the AI helpers.
//
// It is intentionally minimal: the goal is to unblock a playable Survival loop,
// not to perfectly match every edge case in `creature_update_all`.
// See: `docs/creatures/update.md`.

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { Crand } from '@grim/rand.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { BonusId } from '@crimson/bonuses/ids.ts';
import type { EffectPool, FxQueue, FxQueueRotated } from '@crimson/effects.ts';
import { awardExperience, awardExperienceFromReward, survivalRecordRecentDeath } from '@crimson/gameplay.ts';
import { NATIVE_HALF_PI, NATIVE_PI, NATIVE_TAU, NATIVE_TURN_RATE_SCALE, f32, f32Vec2, headingAddPiF32, headingToDirectionF32 } from '@crimson/math-parity.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { playerTakeDamage } from '@crimson/player-damage.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { ftolMsI32 } from '@crimson/sim/timing.ts';
import { weaponEntryForProjectileTypeId } from '@crimson/weapons.ts';
import { applyFinalRevengeOnPlayerDeath } from '@crimson/perks/impl/final-revenge.ts';
import { creatureAi7TickLinkTimer, creatureAiUpdateTarget } from './ai.ts';
import { CreatureDamageType } from './damage-types.ts';
import { creatureApplyDamageWithLethalFollowup } from './damage.ts';
import { CREATURE_LIFECYCLE_ALIVE, CreatureLifecyclePhase, classifyCreatureLifecycle, creatureLifecycleIsAlive } from './lifecycle.ts';
import { HAS_SPAWN_SLOT_FLAG, RANDOM_HEADING_SENTINEL, type SpawnEnv, CreatureAiMode, CreatureFlags, CreatureInit, CreatureTypeId, type SpawnId, SpawnSlotInit, type SpawnPlan, buildSpawnPlan, resolveTint, tickSpawnSlot } from './spawn.ts';

export { CreatureFlags };

export const CREATURE_POOL_SIZE = 0x180;
export const CONTACT_DAMAGE_PERIOD = 0.5;

// Native movement path multiplies by a fixed `30.0` factor in `creature_update_all`.
const CREATURE_SPEED_SCALE = 30.0;

// Base heading turn rate multiplier (angle_approach clamps by frame_dt internally).
const CREATURE_TURN_RATE_SCALE = NATIVE_TURN_RATE_SCALE;

// Native uses lifecycle_stage as a lifecycle sentinel:
// - 16.0 means "alive" (normal AI/movement/anim update)
// - once HP <= 0 it ramps down quickly and drives death slide + corpse decal timing.
// - final deactivation (`lifecycle_stage < -10.0`) happens during render (creature_render_type),
//   not during creature_update_all.
const CREATURE_DEATH_TIMER_DECAY = 28.0;
const CREATURE_CORPSE_FADE_DECAY = 20.0;
const CREATURE_DEATH_SLIDE_SCALE = 9.0;
const _TARGET_REEVAL_PERIOD = 0x46;
const _FLAG_SELF_DAMAGE_TICK = int(CreatureFlags.SELF_DAMAGE_TICK);
const _FLAG_SELF_DAMAGE_TICK_STRONG = int(CreatureFlags.SELF_DAMAGE_TICK_STRONG);
const _FLAG_AI7_LINK_TIMER = int(CreatureFlags.AI7_LINK_TIMER);

const _CREATURE_CONTACT_SFX: Map<CreatureTypeId, [SfxId, SfxId]> = new Map([
  [CreatureTypeId.ZOMBIE, [SfxId.ZOMBIE_ATTACK_01, SfxId.ZOMBIE_ATTACK_02]],
  [CreatureTypeId.LIZARD, [SfxId.LIZARD_ATTACK_01, SfxId.LIZARD_ATTACK_02]],
  [CreatureTypeId.ALIEN, [SfxId.ALIEN_ATTACK_01, SfxId.ALIEN_ATTACK_02]],
  [CreatureTypeId.SPIDER_SP1, [SfxId.SPIDER_ATTACK_01, SfxId.SPIDER_ATTACK_02]],
  [CreatureTypeId.SPIDER_SP2, [SfxId.SPIDER_ATTACK_01, SfxId.SPIDER_ATTACK_02]],
]);

function _wrapAngle(angle: number): number {
  const shifted = f32(angle) + NATIVE_PI;
  return f32(shifted - Math.floor(shifted / NATIVE_TAU) * NATIVE_TAU - NATIVE_PI);
}

// Native `angle_approach` (0x0041f430).
//
// Keep this close to the decompile:
// - wrap angle into [0, 2pi]
// - choose direct-vs-wrapped arc
// - clamp arc scale to <= 1.0
// - step by `frame_dt * arc_scale * rate`
function _angleApproach(current: number, target: number, rate: number, dt: number): number {
  // Native keeps these values in float locals (`fVar*`) across the function.
  // Preserve that spill behavior to avoid branch flips near the `tau` boundary.
  let angle: number = f32(current);
  const targetF: number = f32(target);
  const rateF: number = f32(rate);
  const dtF: number = f32(dt);
  const tau: number = NATIVE_TAU;

  while (angle < 0.0) {
    angle = f32(angle + tau);
  }
  while (tau < angle) {
    angle = f32(angle - tau);
  }

  const direct: number = f32(Math.abs(f32(targetF - angle)));

  let hi = angle;
  if (angle < targetF) hi = targetF;
  let lo = angle;
  if (targetF < angle) lo = targetF;
  const wrapped: number = f32(Math.abs(f32(f32(tau - hi) + lo)));

  let stepScale = wrapped;
  if (direct < wrapped) stepScale = direct;
  if (1.0 < stepScale) stepScale = 1.0;
  stepScale = f32(stepScale);

  const stepDelta: number = f32(f32(dtF * stepScale) * rateF);

  if (direct <= wrapped) {
    if (angle < targetF) {
      return f32(angle + stepDelta);
    }
  } else {
    if (targetF < angle) {
      return f32(angle + stepDelta);
    }
  }
  return f32(angle - stepDelta);
}

function _movementDeltaFromHeadingF32(
  heading: number,
  opts: {
    dt: number;
    moveScale: number;
    moveSpeed: number;
  },
): Vec2 {
  // Native movement path computes cos/sin in x87 precision and rounds only on the
  // final velocity write (`creature_update_all` around 0x00426b85..0x00426bb1).
  // Avoid pre-rounding direction components to float32 here.
  const radians = f32(heading) - NATIVE_HALF_PI;
  const dt = opts.dt;
  const moveScale = opts.moveScale;
  const moveSpeed = opts.moveSpeed;

  // Preserve native multiply order:
  // `vel = trig(heading - half_pi) * frame_dt * move_scale * move_speed * 30.0`
  let vx = Math.cos(radians);
  vx *= dt;
  vx *= moveScale;
  vx *= moveSpeed;
  vx *= CREATURE_SPEED_SCALE;

  let vy = Math.sin(radians);
  vy *= dt;
  vy *= moveScale;
  vy *= moveSpeed;
  vy *= CREATURE_SPEED_SCALE;

  return new Vec2(f32(vx), f32(vy));
}

function _velocityFromDeltaF32(delta: Vec2, opts: { dt: number }): Vec2 {
  const dt = opts.dt;
  if (dt <= 0.0) return new Vec2();
  const invDt = 1.0 / dt;
  return new Vec2(f32(delta.x * invDt), f32(delta.y * invDt));
}

function _advancePosByDeltaF32(pos: Vec2, delta: Vec2): Vec2 {
  return new Vec2(f32(pos.x + delta.x), f32(pos.y + delta.y));
}

function _ownerToPlayerIndex(owner: OwnerRef): number | null {
  return owner.playerIndex();
}

function _travelBudgetForTypeId(typeId: ProjectileTemplateId): number {
  return weaponEntryForProjectileTypeId(typeId).travelBudget;
}

export class CreatureState {
  // Core identity/alive flags.
  active = false;
  typeId: CreatureTypeId = CreatureTypeId.ZOMBIE;

  // Movement / AI.
  pos: Vec2 = new Vec2();
  vel: Vec2 = new Vec2();
  heading = 0.0;
  targetHeading = 0.0;
  forceTarget = 0;
  target: Vec2 = new Vec2();
  targetPlayer = 0;
  aiMode: CreatureAiMode = CreatureAiMode.ORBIT_PLAYER;
  flags: CreatureFlags = 0 as CreatureFlags;

  // Native `creature_alloc_slot` does not clear `link_index`; many spawn paths
  // leave it untouched (notably survival_spawn_creature AI7 spiders), so stale
  // values can affect early AI7 timer phase.
  linkIndex = -1;
  targetOffset: Vec2 | null = null;
  orbitAngle = 0.0;
  orbitRadius = 0.0;
  phaseSeed = 0.0;
  moveScale = 1.0;

  // Combat / timers.
  hp = 0.0;
  maxHp = 0.0;
  moveSpeed = 1.0;
  contactDamage = 0.0;
  attackCooldown = 0.0;
  rewardValue = 0.0;

  // Plaguebearer infection state (native: `collision_flag` byte).
  plagueInfected = false;
  collisionTimer: number = CONTACT_DAMAGE_PERIOD;
  lifecycleStage: number = CREATURE_LIFECYCLE_ALIVE;

  // Presentation.
  size = 50.0;
  animPhase = 0.0;
  hitFlashTimer = 0.0;
  lastHitOwner: OwnerRef = OwnerRef.fromLocalPlayer(0);
  tint: RGBA = new RGBA();

  // Rewrite-only helpers (not in native struct, but derived from spawn plans).
  spawnSlotIndex: number | null = null;
  bonusId: BonusId | null = null;
  bonusDurationOverride: number | null = null;

}

function _replaceCreatureState(creature: CreatureState): CreatureState {
  const c = new CreatureState();
  c.active = creature.active;
  c.typeId = creature.typeId;
  c.pos = creature.pos;
  c.vel = creature.vel;
  c.heading = creature.heading;
  c.targetHeading = creature.targetHeading;
  c.forceTarget = creature.forceTarget;
  c.target = creature.target;
  c.targetPlayer = creature.targetPlayer;
  c.aiMode = creature.aiMode;
  c.flags = creature.flags;
  c.linkIndex = creature.linkIndex;
  c.targetOffset = creature.targetOffset;
  c.orbitAngle = creature.orbitAngle;
  c.orbitRadius = creature.orbitRadius;
  c.phaseSeed = creature.phaseSeed;
  c.moveScale = creature.moveScale;
  c.hp = creature.hp;
  c.maxHp = creature.maxHp;
  c.moveSpeed = creature.moveSpeed;
  c.contactDamage = creature.contactDamage;
  c.attackCooldown = creature.attackCooldown;
  c.rewardValue = creature.rewardValue;
  c.plagueInfected = creature.plagueInfected;
  c.collisionTimer = creature.collisionTimer;
  c.lifecycleStage = creature.lifecycleStage;
  c.size = creature.size;
  c.animPhase = creature.animPhase;
  c.hitFlashTimer = creature.hitFlashTimer;
  c.lastHitOwner = creature.lastHitOwner;
  c.tint = creature.tint;
  c.spawnSlotIndex = creature.spawnSlotIndex;
  c.bonusId = creature.bonusId;
  c.bonusDurationOverride = creature.bonusDurationOverride;
  return c;
}

export class CreatureDeath {
  readonly index: number;
  readonly pos: Vec2;
  readonly typeId: CreatureTypeId;
  readonly rewardValue: number;
  readonly xpAwarded: number;
  readonly owner: OwnerRef;

  constructor(opts: {
    index: number;
    pos: Vec2;
    typeId: CreatureTypeId;
    rewardValue: number;
    xpAwarded: number;
    owner: OwnerRef;
  }) {
    this.index = opts.index;
    this.pos = opts.pos;
    this.typeId = opts.typeId;
    this.rewardValue = opts.rewardValue;
    this.xpAwarded = opts.xpAwarded;
    this.owner = opts.owner;
  }
}

export class CreatureUpdateResult {
  readonly deaths: readonly CreatureDeath[];
  readonly spawned: readonly number[];
  readonly sfx: readonly SfxId[];

  constructor(opts: {
    deaths?: readonly CreatureDeath[];
    spawned?: readonly number[];
    sfx?: readonly SfxId[];
  } = {}) {
    this.deaths = opts.deaths ?? [];
    this.spawned = opts.spawned ?? [];
    this.sfx = opts.sfx ?? [];
  }
}

export class CreatureUpdateOptions {
  readonly state: GameplayState;
  readonly players: PlayerState[];
  readonly rng: CrandLike;
  readonly env: SpawnEnv;
  readonly worldWidth: number;
  readonly worldHeight: number;
  readonly fxQueue: FxQueue;
  readonly fxQueueRotated: FxQueueRotated;
  readonly detailPreset: number;
  readonly violenceDisabled: number;

  constructor(opts: {
    state: GameplayState;
    players: PlayerState[];
    rng: CrandLike;
    env: SpawnEnv;
    worldWidth: number;
    worldHeight: number;
    fxQueue: FxQueue;
    fxQueueRotated: FxQueueRotated;
    detailPreset?: number;
    violenceDisabled?: number;
  }) {
    this.state = opts.state;
    this.players = opts.players;
    this.rng = opts.rng;
    this.env = opts.env;
    this.worldWidth = opts.worldWidth;
    this.worldHeight = opts.worldHeight;
    this.fxQueue = opts.fxQueue;
    this.fxQueueRotated = opts.fxQueueRotated;
    this.detailPreset = opts.detailPreset ?? 5;
    this.violenceDisabled = opts.violenceDisabled ?? 0;
  }
}

class _CreatureInteractionCtx {
  pool: CreaturePool;
  creatureIndex: number;
  creature: CreatureState;
  state: GameplayState;
  players: PlayerState[];
  player: PlayerState;
  dt: number;
  rng: CrandLike;
  detailPreset: number;
  violenceDisabled: number;
  worldWidth: number;
  worldHeight: number;
  fxQueue: FxQueue | null;
  fxQueueRotated: FxQueueRotated | null;
  deaths: CreatureDeath[];
  sfx: SfxId[];
  skipCreature: boolean;
  contactDistSq: number;

  constructor(opts: {
    pool: CreaturePool;
    creatureIndex: number;
    creature: CreatureState;
    state: GameplayState;
    players: PlayerState[];
    player: PlayerState;
    dt: number;
    rng: CrandLike;
    detailPreset: number;
    violenceDisabled: number;
    worldWidth: number;
    worldHeight: number;
    fxQueue: FxQueue | null;
    fxQueueRotated: FxQueueRotated | null;
    deaths: CreatureDeath[];
    sfx: SfxId[];
    skipCreature?: boolean;
    contactDistSq?: number;
  }) {
    this.pool = opts.pool;
    this.creatureIndex = opts.creatureIndex;
    this.creature = opts.creature;
    this.state = opts.state;
    this.players = opts.players;
    this.player = opts.player;
    this.dt = opts.dt;
    this.rng = opts.rng;
    this.detailPreset = opts.detailPreset;
    this.violenceDisabled = opts.violenceDisabled;
    this.worldWidth = opts.worldWidth;
    this.worldHeight = opts.worldHeight;
    this.fxQueue = opts.fxQueue;
    this.fxQueueRotated = opts.fxQueueRotated;
    this.deaths = opts.deaths;
    this.sfx = opts.sfx;
    this.skipCreature = opts.skipCreature ?? false;
    this.contactDistSq = opts.contactDistSq ?? 0.0;
  }
}

type _CreatureInteractionStep = (ctx: _CreatureInteractionCtx) => void;

function _creatureInteractionPlaguebearerSpread(ctx: _CreatureInteractionCtx): void {
  if (
    ctx.players.length > 0 &&
    perkActive(ctx.players[0], PerkId.PLAGUEBEARER) &&
    int(ctx.state.plaguebearerInfectionCount) < 0x3C
  ) {
    ctx.pool._plaguebearerSpreadInfection(ctx.creatureIndex);
  }
}

function _creatureInteractionEnergizerEat(ctx: _CreatureInteractionCtx): void {
  const creature = ctx.creature;
  // Decompile parity (`creature_update_all`, 0x00426220): reuse the same
  // creature->target-player distance scalar for eat/contact branches.
  if (ctx.contactDistSq >= 20.0 * 20.0) return;

  // Native stores `vel` as per-tick delta (not per-second). It applies movement
  // as `pos += vel`, so reverting the just-applied movement subtracts `vel`.
  creature.pos = creature.pos.sub(creature.vel).clampRect(
    0.0,
    0.0,
    ctx.worldWidth,
    ctx.worldHeight,
  );

  // Native reverts the just-applied movement whenever a creature gets within
  // 20 units of the target player, regardless of Energizer.
  if (ctx.state.bonuses.energizer <= 0.0) return;
  if (creature.maxHp >= 380.0) return;

  ctx.state.effects.spawnBurst({
    pos: creature.pos,
    count: 6,
    rng: ctx.rng,
    detailPreset: int(ctx.detailPreset),
  });
  ctx.sfx.push(SfxId.UI_BONUS);

  const prevGuard = ctx.state.bonusSpawnGuard;
  ctx.state.bonusSpawnGuard = true;
  creature.lastHitOwner = OwnerRef.fromPlayer(int(ctx.player.index));
  ctx.deaths.push(
    ctx.pool.handleDeath(
      ctx.creatureIndex,
      {
        state: ctx.state,
        players: ctx.players,
        rng: ctx.rng,
        dt: ctx.dt,
        detailPreset: int(ctx.detailPreset),
        worldWidth: ctx.worldWidth,
        worldHeight: ctx.worldHeight,
        fxQueue: ctx.fxQueue,
        keepCorpse: false,
      },
    ),
  );
  ctx.state.bonusSpawnGuard = prevGuard;
  ctx.skipCreature = true;
}

function _creatureInteractionContactDamage(ctx: _CreatureInteractionCtx): void {
  const creature = ctx.creature;
  if (!creatureLifecycleIsAlive(creature.lifecycleStage)) return;
  if (creature.size <= 16.0) return;
  if (ctx.state.bonuses.energizer > 0.0) return;

  if (ctx.contactDistSq >= 30.0 * 30.0) return;
  if (ctx.player.health <= 0.0) return;
  if (creature.attackCooldown > 0.0) return;

  // Native contact-damage path consumes one `crt_rand()` draw for attack SFX
  // (creature_type_table[*].sfx_bank_b[rand & 1]) before applying damage.
  const options = _CREATURE_CONTACT_SFX.get(creature.typeId);
  if (options !== undefined) {
    ctx.sfx.push(
      options[ctx.rng.rand({ caller: RngCallerStatic.CREATURE_UPDATE_ALL_CONTACT_SFX }) & 1],
    );
  }

  let mrMeleeKilled = false;
  if (perkActive(ctx.player, PerkId.MR_MELEE)) {
    const onMrMeleeLethal = (deathSfx: SfxId[]): void => {
      ctx.deaths.push(
        ctx.pool.handleDeath(
          ctx.creatureIndex,
          {
            state: ctx.state,
            players: ctx.players,
            rng: ctx.rng,
            dt: ctx.dt,
            detailPreset: int(ctx.detailPreset),
            worldWidth: ctx.worldWidth,
            worldHeight: ctx.worldHeight,
            fxQueue: ctx.fxQueue,
          },
        ),
      );
      ctx.sfx.push(...deathSfx);
      if (creature.active) {
        ctx.pool._tickDead(
          creature,
          {
            dt: ctx.dt,
            worldWidth: ctx.worldWidth,
            worldHeight: ctx.worldHeight,
            fxQueueRotated: ctx.fxQueueRotated,
            rng: ctx.rng,
            detailPreset: int(ctx.detailPreset),
            violenceDisabled: int(ctx.violenceDisabled),
          },
        );
      }
    };

    mrMeleeKilled = creatureApplyDamageWithLethalFollowup(
      creature,
      {
        damageAmount: 25.0,
        damageType: CreatureDamageType.MELEE,
        impulse: new Vec2(),
        owner: OwnerRef.fromPlayer(int(ctx.player.index)),
        dt: ctx.dt,
        players: ctx.players,
        rng: ctx.rng,
        preserveBugs: ctx.state.preserveBugs,
        effects: ctx.state.effects,
        detailPreset: int(ctx.detailPreset),
        onLethal: onMrMeleeLethal,
      },
    );
  }

  if (ctx.player.shieldTimer <= 0.0) {
    if (perkActive(ctx.player, PerkId.TOXIC_AVENGER)) {
      creature.flags |=
        CreatureFlags.SELF_DAMAGE_TICK |
        CreatureFlags.SELF_DAMAGE_TICK_STRONG;
    } else if (perkActive(ctx.player, PerkId.VEINS_OF_POISON)) {
      creature.flags |= CreatureFlags.SELF_DAMAGE_TICK;
    }
  }

  const onPlayerLethalFinalRevenge = (): void => {
    applyFinalRevengeOnPlayerDeath({
      state: ctx.state,
      creatures: ctx.pool,
      players: ctx.players,
      player: ctx.player,
      dt: ctx.dt,
      worldSize: Math.max(ctx.worldWidth, ctx.worldHeight),
      detailPreset: int(ctx.detailPreset),
      fxQueue: ctx.fxQueue,
      deaths: ctx.deaths,
    });
  };

  playerTakeDamage(
    ctx.state,
    ctx.player,
    creature.contactDamage,
    { dt: ctx.dt, players: ctx.players, onLethal: onPlayerLethalFinalRevenge },
  );

  if (ctx.fxQueue !== null) {
    const pushDir = ctx.player.pos.sub(creature.pos).normalized();
    ctx.fxQueue.addRandom({ pos: ctx.player.pos.add(pushDir.mul(3.0)), rng: ctx.rng });
  }

  creature.attackCooldown = creature.attackCooldown + 1.0;

  if (mrMeleeKilled) {
    ctx.skipCreature = true;
  }
}

function _creatureInteractionPlaguebearerContactFlag(ctx: _CreatureInteractionCtx): void {
  if (ctx.state.bonuses.energizer > 0.0) return;

  const creature = ctx.creature;
  if (
    ctx.player.plaguebearerActive &&
    creature.hp < 150.0 &&
    int(ctx.state.plaguebearerInfectionCount) < 0x32
  ) {
    if (ctx.contactDistSq < 30.0 * 30.0) {
      creature.plagueInfected = true;
    }
  }
}

function _creatureInteractionContactKillSmall(ctx: _CreatureInteractionCtx): void {
  // Kill small creatures that make contact, matching native `creature_update_all`.
  //
  // Native logic (see decompile around 0x004276d6) sets `health = 0.0` and
  // decrements lifecycle_stage by frame_dt whenever:
  // - distance to the target player is < 30.0, and
  // - creature `size` is <= 30.0.
  //
  // This path does not call `creature_handle_death`, so it intentionally skips XP
  // awards + bonus spawns. The corpse staging still increments kill_count later.

  const creature = ctx.creature;
  if (!creatureLifecycleIsAlive(creature.lifecycleStage)) return;
  if (ctx.contactDistSq >= 30.0 * 30.0) return;
  if (creature.size > 30.0) return;

  creature.hp = 0.0;
  creature.lifecycleStage = f32(creature.lifecycleStage - ctx.dt);
  ctx.skipCreature = true;
}

const _CREATURE_INTERACTION_STEPS: readonly _CreatureInteractionStep[] = [
  _creatureInteractionEnergizerEat,
  _creatureInteractionContactDamage,
  _creatureInteractionPlaguebearerContactFlag,
  _creatureInteractionContactKillSmall,
];

export class CreaturePool {
  private _entries: CreatureState[];
  spawnSlots: SpawnSlotInit[] = [];
  env: SpawnEnv | null = null;
  effects: EffectPool | null = null;
  captureSpawnEventsAuthoritative = false;
  killCount = 0;
  spawnedCount = 0;
  private _updateTick = 0;
  constructor(opts?: {
    size?: number;
    env?: SpawnEnv | null;
    effects?: EffectPool | null;
  }) {
    const size = opts?.size ?? CREATURE_POOL_SIZE;
    const env = opts?.env ?? null;
    const effects = opts?.effects ?? null;
    this._entries = Array.from({ length: int(size) }, () => new CreatureState());
    this.env = env;
    this.effects = effects;
  }

  get entries(): CreatureState[] {
    return this._entries;
  }

  reset(): void {
    for (let i = 0; i < this._entries.length; i++) {
      this._entries[i] = new CreatureState();
    }
    this.spawnSlots.length = 0;
    this.killCount = 0;
    this.spawnedCount = 0;
    this._updateTick = 0;
  }

  iterActive(): CreatureState[] {
    return this._entries.filter((e) => e.active && e.hp > 0.0);
  }

  _plaguebearerSpreadInfection(originIndex: number): void {
    // Port of `FUN_00425d80` (infects nearby creatures when Plaguebearer is active).

    originIndex = int(originIndex);
    if (!(originIndex >= 0 && originIndex < this._entries.length)) return;
    const origin = this._entries[originIndex];
    if (!origin.active) return;

    for (const creature of this._entries) {
      if (!creature.active) continue;

      if (Vec2.distanceSq(creature.pos, origin.pos) < 45.0 * 45.0) {
        if (creature.plagueInfected && origin.hp < 150.0) {
          origin.plagueInfected = true;
        }
        if (origin.plagueInfected && creature.hp < 150.0) {
          creature.plagueInfected = true;
        }
        return;
      }
    }
  }

  private _allocSlot(): number | null {
    for (let i = 0; i < this._entries.length; i++) {
      if (!this._entries[i].active) return i;
    }
    return null;
  }

  private _freeSlotCount(): number {
    let count = 0;
    for (const entry of this._entries) {
      if (!entry.active) count++;
    }
    return count;
  }

  private _resolveTargetPlayerIndex(creature: CreatureState, players: PlayerState[]): number {
    const playerCount = players.length;
    if (playerCount <= 1) {
      creature.targetPlayer = 0;
      return 0;
    }

    let targetPlayer = int(creature.targetPlayer);
    if (!(targetPlayer >= 0 && targetPlayer < playerCount)) {
      targetPlayer = 0;
    }

    // Native 2-player behavior: periodically switch to P2 if alive and closer,
    // and always flip when the current target dies.
    if (playerCount === 2) {
      if ((this._updateTick % _TARGET_REEVAL_PERIOD) !== 0) {
        const other = 1 - targetPlayer;
        if (players[other].health > 0.0) {
          const curDistSq = Vec2.distanceSq(creature.pos, players[targetPlayer].pos);
          const otherDistSq = Vec2.distanceSq(creature.pos, players[other].pos);
          if (otherDistSq < curDistSq) {
            targetPlayer = int(other);
          }
        }
      }
      if (players[targetPlayer].health <= 0.0) {
        targetPlayer = int(1 - targetPlayer);
      }
      creature.targetPlayer = int(targetPlayer);
      return int(targetPlayer);
    }

    // 3/4-player extension: keep deterministic nearest-alive targeting with the
    // same periodic refresh/dead-target refresh policy as native 2-player mode.
    const needsRefresh =
      (this._updateTick % _TARGET_REEVAL_PERIOD) !== 0 ||
      players[targetPlayer].health <= 0.0;
    if (needsRefresh) {
      let nearestIdx = -1;
      let nearestDistSq = 0.0;
      for (let idx = 0; idx < players.length; idx++) {
        if (players[idx].health <= 0.0) continue;
        const distSq = Vec2.distanceSq(creature.pos, players[idx].pos);
        if (nearestIdx < 0 || distSq < nearestDistSq) {
          nearestIdx = int(idx);
          nearestDistSq = distSq;
        }
      }
      if (nearestIdx >= 0) {
        targetPlayer = nearestIdx;
      }
    }

    creature.targetPlayer = int(targetPlayer);
    return int(targetPlayer);
  }

  private _updatePlayerAutoTarget(
    opts: {
      players: PlayerState[];
      preserveBugs: boolean;
      playerIndex: number;
      creatureIndex: number;
      creature: CreatureState;
    },
  ): void {
    const players = opts.players;
    const preserveBugs = opts.preserveBugs;
    const playerIndex = opts.playerIndex;
    const creatureIndex = opts.creatureIndex;
    const creature = opts.creature;
    if (!(int(playerIndex) >= 0 && int(playerIndex) < players.length)) return;
    const player = players[int(playerIndex)];
    if (player.health <= 0.0) return;

    const autoTarget = int(player.autoTarget);
    if (!(autoTarget >= 0 && autoTarget < this._entries.length)) {
      player.autoTarget = int(creatureIndex);
      return;
    }

    const current = this._entries[int(autoTarget)];
    if (!current.active || current.hp <= 0.0) {
      player.autoTarget = int(creatureIndex);
      return;
    }

    const distNew = Vec2.distanceSq(player.pos, creature.pos);
    let currentOrigin = player.pos;
    if (preserveBugs && int(playerIndex) !== 0 && players.length > 0) {
      // Native compares player 2 auto-target replacement against player 1's
      // coordinates here, which can block closer replacements for player 2.
      currentOrigin = players[0].pos;
    }
    const distCurrent = Vec2.distanceSq(currentOrigin, current.pos);
    if (distNew < distCurrent) {
      player.autoTarget = int(creatureIndex);
    }
  }

  spawnInit(init: CreatureInit): number | null {
    // Materialize a single `CreatureInit` into the runtime pool.

    const idx = this._allocSlot();
    if (idx === null) return null;
    // Reuse the allocated slot so fields that native spawn paths do not touch
    // (e.g. link_index for survival AI7 spiders) retain stale values.
    const entry = this._entries[idx];
    this._applyInit(entry, init);

    // Direct init does not have plan-local indices; preserve any raw linkage.
    if (init.aiTimer !== null) {
      entry.linkIndex = int(init.aiTimer);
    } else if (init.aiLinkParent !== null) {
      entry.linkIndex = int(init.aiLinkParent);
    }
    if (init.spawnSlot !== null) {
      // Plan-local slot ids must be remapped by `spawn_plan`; keep explicit.
      entry.spawnSlotIndex = int(init.spawnSlot);
      entry.linkIndex = int(init.spawnSlot);
    }

    this._entries[idx] = entry;
    this.spawnedCount += 1;
    return idx;
  }

  spawnInits(inits: readonly CreatureInit[]): number[] {
    const mapping: number[] = [];
    for (const init of inits) {
      const idx = this.spawnInit(init);
      if (idx !== null) {
        mapping.push(idx);
      }
    }
    return mapping;
  }

  spawnPlan(plan: SpawnPlan, opts?: {
    rng?: CrandLike | null;
    detailPreset?: number;
    effects?: EffectPool | null;
  }): [number[], number | null] {
    const rng = opts?.rng ?? null;
    const detailPreset = opts?.detailPreset ?? 5;
    const effects = opts?.effects ?? null;
    // Materialize a pure `SpawnPlan` into the runtime pool.
    //
    // Returns:
    //   (plan_index_to_pool_index, primary_pool_index_or_none)

    if (this._freeSlotCount() < plan.creatures.length) {
      return [[], null];
    }

    const mapping: number[] = [];
    const pendingAiLinks: (number | null)[] = [];
    const pendingAiTimers: (number | null)[] = [];
    const pendingSpawnSlots: (number | null)[] = [];

    // 1) Allocate pool slots for every creature.
    for (const init of plan.creatures) {
      const poolIdx = this._allocSlot();
      if (poolIdx === null) return [[], null];
      // Reuse the allocated slot so untouched fields keep native-like stale state.
      const entry = this._entries[poolIdx];
      this._applyInit(entry, init);
      this._entries[poolIdx] = entry;
      this.spawnedCount += 1;

      mapping.push(poolIdx);
      pendingAiLinks.push(init.aiLinkParent);
      pendingAiTimers.push(init.aiTimer);
      pendingSpawnSlots.push(init.spawnSlot);
    }

    // 2) Allocate and remap spawn slots.
    const slotMapping: number[] = [];
    for (const slot of plan.spawnSlots) {
      const ownerPlan = int(slot.ownerCreature);
      const ownerPool =
        ownerPlan >= 0 && ownerPlan < mapping.length ? mapping[int(ownerPlan)] : -1;
      this.spawnSlots.push(new SpawnSlotInit({
        ownerCreature: int(ownerPool),
        timer: slot.timer,
        count: int(slot.count),
        limit: int(slot.limit),
        interval: slot.interval,
        childTemplateId: slot.childTemplateId,
      }));
      slotMapping.push(this.spawnSlots.length - 1);
    }

    // 3) Patch link indices now that we have global indices.
    for (let planIdx = 0; planIdx < mapping.length; planIdx++) {
      const poolIdx = mapping[planIdx];
      const entry = this._entries[poolIdx];

      const slotPlan = pendingSpawnSlots[planIdx];
      if (slotPlan !== null) {
        const globalSlot = slotMapping[int(slotPlan)];
        entry.spawnSlotIndex = int(globalSlot);
        entry.linkIndex = int(globalSlot);
        continue;
      }

      const timer = pendingAiTimers[planIdx];
      if (timer !== null) {
        entry.linkIndex = int(timer);
        continue;
      }

      const linkPlan = pendingAiLinks[planIdx];
      if (linkPlan !== null) {
        entry.linkIndex = mapping[int(linkPlan)];
      }
    }

    let primaryPool: number | null = null;
    if (int(plan.primary) >= 0 && int(plan.primary) < mapping.length) {
      primaryPool = mapping[int(plan.primary)];
    }

    const effectPool = effects ?? this.effects;
    if (effectPool !== null && plan.effects.length > 0) {
      const fxRng = rng ?? new Crand(0);
      for (const fx of plan.effects) {
        effectPool.spawnBurst({ pos: fx.pos, count: int(fx.count), rng: fxRng, detailPreset: int(detailPreset) });
      }
    }
    return [mapping, primaryPool];
  }

  spawnTemplate(
    templateId: SpawnId,
    pos: Vec2,
    heading: number,
    rng: CrandLike,
    opts?: {
      env?: SpawnEnv | null;
      detailPreset?: number;
      effects?: EffectPool | null;
    },
  ): [number[], number | null] {
    // Build a spawn plan and materialize it into the pool.

    const env = opts?.env ?? null;
    const detailPreset = opts?.detailPreset ?? 5;
    const effects = opts?.effects ?? null;
    const spawnEnv = env ?? this.env;
    if (spawnEnv === null) {
      throw new Error(
        'CreaturePool.spawnTemplate requires SpawnEnv (set CreaturePool.env or pass env=...)',
      );
    }
    const plan = buildSpawnPlan(templateId, pos, heading, rng, spawnEnv);
    return this.spawnPlan(plan, { rng, detailPreset: int(detailPreset), effects });
  }

  update(dt: number, opts: { options: CreatureUpdateOptions }): CreatureUpdateResult {
    // Advance the creature runtime pool by `dt` seconds.
    //
    // Notes:
    // - Death side effects should be initiated by damage call sites.
    // - This is not a full port of `creature_update_all`; it targets the Survival subset.

    dt = f32(dt);
    const options = opts.options;
    const state = options.state;
    const players = options.players;
    const rng = options.rng;
    const detailPreset = int(options.detailPreset);
    const violenceDisabled = int(options.violenceDisabled);
    const spawnEnv = options.env;
    const worldWidth = options.worldWidth;
    const worldHeight = options.worldHeight;
    const fxQueue = options.fxQueue;
    const fxQueueRotated = options.fxQueueRotated;

    const deaths: CreatureDeath[] = [];
    const spawned: number[] = [];
    const sfx: SfxId[] = [];
    this._updateTick = int(this._updateTick) + 1;
    let singlePlayerDeadTargetPos: Vec2 | null = null;
    if (players.length === 1) {
      singlePlayerDeadTargetPos = new Vec2(
        worldWidth * (27.0 / 64.0),
        worldHeight * (27.0 / 64.0),
      );
    }

    const evilTargets: Set<number> = new Set();
    if (players.length > 0) {
      if (state.preserveBugs) {
        // Native `creature_update_all` reads one global
        // `evil_eyes_target_creature` slot (player-0 storage), even in
        // multiplayer runs.
        if (perkActive(players[0], PerkId.EVIL_EYES)) {
          const evilTarget = int(players[0].evilEyesTargetCreature);
          if (evilTarget >= 0) evilTargets.add(int(evilTarget));
        }
      } else {
        // Bug-fixed path: apply all alive Evil Eyes owners.
        for (const player of players) {
          if (player.health <= 0.0) continue;
          if (!perkActive(player, PerkId.EVIL_EYES)) continue;
          const evilTarget = int(player.evilEyesTargetCreature);
          if (evilTarget >= 0) evilTargets.add(int(evilTarget));
        }
      }
    }

    // Movement + AI. Dead creatures keep updating (death slide + corpse decals)
    // even when `players` is empty so debug views remain deterministic.
    // Native AI7 timer math uses `frame_dt_ms` integer slots with ftol-style
    // truncation semantics.
    const dtMs = dt > 0.0 ? ftolMsI32(dt) : 0;

    const _applySelfDamageTick = (creatureIndex: number, creature: CreatureState): boolean => {
      if (dt <= 0.0 || state.bonuses.freeze > 0.0) return false;
      let damageAmount = 0.0;
      const creatureFlags = int(creature.flags);
      if ((creatureFlags & _FLAG_SELF_DAMAGE_TICK_STRONG) !== 0) {
        damageAmount = dt * 180.0;
      } else if ((creatureFlags & _FLAG_SELF_DAMAGE_TICK) !== 0) {
        damageAmount = dt * 60.0;
      }
      if (damageAmount <= 0.0) return false;

      const onLethal = (deathSfx: SfxId[]): void => {
        deaths.push(
          this.handleDeath(
            int(creatureIndex),
            {
              state,
              players,
              rng,
              dt,
              detailPreset: int(detailPreset),
              worldWidth,
              worldHeight,
              fxQueue,
            },
          ),
        );
        sfx.push(...deathSfx);
      };

      return creatureApplyDamageWithLethalFollowup(
        creature,
        {
          damageAmount,
          damageType: CreatureDamageType.SELF_TICK,
          impulse: new Vec2(),
          owner: creature.lastHitOwner,
          dt,
          players,
          rng,
          preserveBugs: state.preserveBugs,
          effects: state.effects,
          detailPreset,
          onLethal,
        },
      );
    };

    for (let idx = 0; idx < this._entries.length; idx++) {
      const creature = this._entries[idx];
      if (!creature.active) continue;

      if (creature.hitFlashTimer > 0.0) {
        creature.hitFlashTimer = f32(creature.hitFlashTimer - dt);
      }

      // Native `creature_update_all` gates the full per-creature body under
      // freeze; only bookkeeping outside this branch still advances.
      if (state.bonuses.freeze > 0.0) continue;

      if (!creatureLifecycleIsAlive(creature.lifecycleStage) || creature.hp <= 0.0) {
        _applySelfDamageTick(idx, creature);
        // Native still ticks AI7 link-timer state (and its RNG draws) for
        // dead creatures inside `creature_update_all`.
        if (
          dt > 0.0 &&
          state.bonuses.freeze <= 0.0 &&
          ((int(creature.flags)) & _FLAG_AI7_LINK_TIMER) !== 0
        ) {
          creatureAi7TickLinkTimer(creature, { dtMs, rng });
        }
        if (creatureLifecycleIsAlive(creature.lifecycleStage)) {
          creature.lifecycleStage = f32(creature.lifecycleStage - dt);
        }
        if (dt > 0.0) {
          this._tickDead(
            creature,
            {
              dt,
              worldWidth,
              worldHeight,
              fxQueueRotated,
              rng,
              detailPreset: int(detailPreset),
              violenceDisabled: int(violenceDisabled),
            },
          );
        }
        continue;
      }

      if (dt <= 0.0 || players.length === 0) continue;

      const poisonKilled = _applySelfDamageTick(idx, creature);
      // Native order runs AI7 link timer update after periodic self-damage
      // and before any live-branch kill handling/retargeting.
      creatureAi7TickLinkTimer(creature, { dtMs, rng });
      if (poisonKilled) {
        if (creature.active) {
          this._tickDead(
            creature,
            {
              dt,
              worldWidth,
              worldHeight,
              fxQueueRotated,
              rng,
              detailPreset: int(detailPreset),
              violenceDisabled: int(violenceDisabled),
            },
          );
        }
        continue;
      }

      if (creature.plagueInfected) {
        creature.collisionTimer -= dt;
        if (creature.collisionTimer < 0.0) {
          creature.collisionTimer += CONTACT_DAMAGE_PERIOD;
          creature.hp -= 15.0;
          let plagueKilled = false;
          if (creature.hp < 0.0) {
            state.plaguebearerInfectionCount += 1;
            deaths.push(
              this.handleDeath(
                idx,
                {
                  state,
                  players,
                  rng,
                  dt,
                  detailPreset,
                  worldWidth,
                  worldHeight,
                  fxQueue,
                },
              ),
            );
            // Native plague-kill path consumes one rand draw for
            // creature attack SFX bank-b selection after death side effects.
            const contactSfxOptions = _CREATURE_CONTACT_SFX.get(creature.typeId);
            if (contactSfxOptions !== undefined) {
              const sfxIndex =
                int(rng.rand({ caller: RngCallerStatic.CREATURE_UPDATE_ALL_PLAGUE_KILL_SFX })) & 1;
              sfx.push(contactSfxOptions[sfxIndex]);
            }
            plagueKilled = true;
          }

          if (fxQueue !== null) {
            fxQueue.addRandom({ pos: creature.pos, rng });
          }
          if (plagueKilled) {
            // Native keeps executing the current live-branch body after
            // `creature_handle_death` in this timer-wrap kill path.
            // Do not run `_tick_dead` immediately here.
          }
        }
      }

      const targetPlayer = this._resolveTargetPlayerIndex(creature, players);
      // Native only updates player auto-target feedback inside the
      // `creature_update_tick % 0x46 != 0` retarget cadence block.
      if ((this._updateTick % _TARGET_REEVAL_PERIOD) !== 0) {
        this._updatePlayerAutoTarget(
          {
            players,
            preserveBugs: state.preserveBugs,
            playerIndex: int(targetPlayer),
            creatureIndex: int(idx),
            creature,
          },
        );
      }
      const player = players[targetPlayer];
      let playerPos = player.pos;
      if (singlePlayerDeadTargetPos !== null && players[0].health <= 0.0) {
        creature.targetPlayer = 1;
        playerPos = singlePlayerDeadTargetPos;
      }

      const frozenByEvilEyes = evilTargets.has(idx);
      if (frozenByEvilEyes) {
        // Native branch (`creature_update_all`, around 0x0042665f): when the
        // current creature is the Evil Eyes target, the update path jumps to
        // the loop tail before cooldown/interaction/ranged logic.
        creature.forceTarget = 0;
        continue;
      }

      const ai = creatureAiUpdateTarget(
        creature,
        { playerPos, creatures: this._entries, dt },
      );
      creature.moveScale = ai.moveScale;
      if (ai.selfDamage !== null && ai.selfDamage > 0.0) {
        creature.hp -= ai.selfDamage;
        if (creature.hp <= 0.0) {
          deaths.push(
            this.handleDeath(
              idx,
              {
                state,
                players,
                rng,
                dt,
                worldWidth,
                worldHeight,
                fxQueue,
              },
            ),
          );
          if (creature.active) {
            this._tickDead(
              creature,
              {
                dt,
                worldWidth,
                worldHeight,
                fxQueueRotated,
                rng,
                detailPreset: int(detailPreset),
                violenceDisabled: int(violenceDisabled),
              },
            );
          }
          continue;
        }
      }

      if (
        (state.bonuses.energizer > 0.0 && creature.maxHp < 500.0) ||
        creature.plagueInfected
      ) {
        creature.targetHeading = headingAddPiF32(creature.targetHeading);
      }

      const turnRate = f32(creature.moveSpeed * CREATURE_TURN_RATE_SCALE);
      if (((int(creature.flags)) & CreatureFlags.ANIM_PING_PONG) === 0) {
        if (creature.aiMode !== CreatureAiMode.HOLD_TIMER) {
          creature.heading = _angleApproach(
            creature.heading,
            creature.targetHeading,
            turnRate,
            dt,
          );
          const moveDelta = _movementDeltaFromHeadingF32(
            creature.heading,
            { dt, moveScale: creature.moveScale, moveSpeed: creature.moveSpeed },
          );
          creature.vel = moveDelta;
          // Native path (flags without 0x4): no bounds clamp here; offscreen spawns
          // remain offscreen until their own velocity moves them in.
          creature.pos = _advancePosByDeltaF32(creature.pos, moveDelta);
        }
      } else {
        // Spawner/short-strip creatures clamp to bounds using `size` as a radius; most are stationary
        // unless ANIM_LONG_STRIP is set (see creature_update_all).
        const radius = Math.max(0.0, creature.size);
        const maxX = Math.max(radius, worldWidth - radius);
        const maxY = Math.max(radius, worldHeight - radius);
        creature.pos = f32Vec2(creature.pos.clampRect(radius, radius, maxX, maxY));
        if (((int(creature.flags)) & CreatureFlags.ANIM_LONG_STRIP) === 0) {
          creature.vel = new Vec2();
        } else {
          creature.heading = _angleApproach(
            creature.heading,
            creature.targetHeading,
            turnRate,
            dt,
          );
          const moveDelta = _movementDeltaFromHeadingF32(
            creature.heading,
            { dt, moveScale: creature.moveScale, moveSpeed: creature.moveSpeed },
          );
          creature.vel = moveDelta;
          creature.pos = f32Vec2(
            _advancePosByDeltaF32(creature.pos, moveDelta).clampRect(
              radius,
              radius,
              maxX,
              maxY,
            ),
          );
        }
      }

      if (
        players.length > 0 &&
        perkActive(players[0], PerkId.PLAGUEBEARER) &&
        int(state.plaguebearerInfectionCount) < 0x3C
      ) {
        this._plaguebearerSpreadInfection(int(idx));
      }

      // Native decrements contact/ranged cooldown before interaction checks,
      // then lets contact hits raise it back by +1.0 in the same frame.
      if (creature.attackCooldown <= 0.0) {
        creature.attackCooldown = 0.0;
      } else {
        creature.attackCooldown -= dt;
      }

      // Native radioactive contact pulse runs after movement/AI/cooldown
      // synthesis inside the live-creature branch.
      if (players.length > 0 && perkActive(players[0], PerkId.RADIOACTIVE)) {
        const radioactivePlayer = players[0];
        const dist = creature.pos.sub(radioactivePlayer.pos).length();
        if (dist < 100.0) {
          creature.collisionTimer -= dt * 1.5;
          if (creature.collisionTimer < 0.0) {
            creature.collisionTimer = CONTACT_DAMAGE_PERIOD;
            creature.hp -= (100.0 - dist) * 0.3;
            if (fxQueue !== null) {
              fxQueue.addRandom({ pos: creature.pos, rng });
            }

            if (creature.hp < 0.0) {
              if (creature.typeId === CreatureTypeId.LIZARD) {
                creature.hp = 1.0;
              } else {
                radioactivePlayer.experience =
                  int(radioactivePlayer.experience + creature.rewardValue);
                creature.lifecycleStage -= dt;
              }
            }
          }
        }
      }

      // Decompile parity (`creature_update_all`, 0x00426220): compute
      // creature->target-player distance once, then reuse that value for
      // ranged attacks and all contact/eat checks in this creature tick.
      const targetDistSq = Vec2.distanceSq(creature.pos, player.pos);
      const targetDist = Math.sqrt(targetDistSq);

      if (
        !frozenByEvilEyes &&
        ((int(creature.flags)) &
          (CreatureFlags.RANGED_ATTACK_SHOCK |
            CreatureFlags.RANGED_ATTACK_VARIANT)) !== 0
      ) {
        // Ported from creature_update_all (see `analysis/ghidra/raw/crimsonland.exe_decompiled.c`
        // around the 0x004276xx ranged-fire branch).
        if (targetDist > 64.0 && creature.attackCooldown <= 0.0) {
          if ((int(creature.flags)) & CreatureFlags.RANGED_ATTACK_SHOCK) {
            const typeId = ProjectileTemplateId.PLASMA_RIFLE;
            state.projectiles.spawn({
              pos: creature.pos,
              angle: creature.heading,
              typeId,
              owner: OwnerRef.fromCreature(int(idx)),
              travelBudget: _travelBudgetForTypeId(typeId),
              hitsPlayers: true,
            });
            sfx.push(SfxId.SHOCK_FIRE);
            creature.attackCooldown += 1.0;
          }

          if (
            ((int(creature.flags)) & CreatureFlags.RANGED_ATTACK_VARIANT) !== 0 &&
            creature.attackCooldown <= 0.0
          ) {
            const projectileType = creature.orbitRadius;
            state.projectiles.spawn({
              pos: creature.pos,
              angle: creature.heading,
              typeId: projectileType,
              owner: OwnerRef.fromCreature(int(idx)),
              travelBudget: _travelBudgetForTypeId(projectileType),
              hitsPlayers: true,
            });
            sfx.push(SfxId.PLASMAMINIGUN_FIRE);
            creature.attackCooldown =
              (int(rng.rand({ caller: RngCallerStatic.CREATURE_UPDATE_ALL_PLASMAMINIGUN_COOLDOWN })) & 3) *
                0.1 +
              creature.orbitAngle +
              creature.attackCooldown;
          }
        }
      }

      const interactionCtx = new _CreatureInteractionCtx({
        pool: this,
        creatureIndex: int(idx),
        creature,
        state,
        players,
        player,
        dt,
        rng,
        detailPreset,
        violenceDisabled,
        worldWidth,
        worldHeight,
        fxQueue,
        fxQueueRotated,
        deaths,
        sfx,
        skipCreature: false,
        contactDistSq: targetDistSq,
      });
      for (const step of _CREATURE_INTERACTION_STEPS) {
        step(interactionCtx);
        if (interactionCtx.skipCreature) break;
      }
      if (interactionCtx.skipCreature) continue;

      // Tick owner-bound spawn slots at creature-loop tail so spawned children
      // can still be visited later in the same update pass.
      if (
        dt > 0.0 &&
        state.bonuses.freeze <= 0.0 &&
        !this.captureSpawnEventsAuthoritative &&
        ((int(creature.flags)) & int(HAS_SPAWN_SLOT_FLAG)) !== 0
      ) {
        const slotIndex = creature.spawnSlotIndex;
        if (slotIndex !== null && int(slotIndex) >= 0 && int(slotIndex) < this.spawnSlots.length) {
          const slot = this.spawnSlots[int(slotIndex)];
          if (int(slot.ownerCreature) === int(idx)) {
            const childTemplateId = tickSpawnSlot(slot, dt);
            if (childTemplateId !== null) {
              const plan = buildSpawnPlan(
                childTemplateId,
                creature.pos,
                RANDOM_HEADING_SENTINEL,
                rng,
                spawnEnv,
              );
              const [mapping] = this.spawnPlan(plan, { rng, detailPreset: int(detailPreset) });
              spawned.push(...mapping);
            }
          }
        }
      }
    }

    return new CreatureUpdateResult({ deaths, spawned, sfx });
  }

  handleDeath(idx: number, opts: {
    state: GameplayState;
    players: PlayerState[];
    rng: CrandLike;
    dt?: number;
    detailPreset?: number;
    worldWidth: number;
    worldHeight: number;
    fxQueue: FxQueue | null;
    keepCorpse?: boolean;
  }): CreatureDeath {
    // Run one-shot death side effects and return the `CreatureDeath` event.

    const state = opts.state;
    const players = opts.players;
    const rng = opts.rng;
    const dt = opts.dt ?? 0.0;
    const detailPreset = opts.detailPreset ?? 5;
    const worldWidth = opts.worldWidth;
    const worldHeight = opts.worldHeight;
    const fxQueue = opts.fxQueue;
    const keepCorpse = opts.keepCorpse ?? true;
    const creature = this._entries[int(idx)];
    survivalRecordRecentDeath(state, { pos: creature.pos });
    if (
      ((int(creature.flags)) & CreatureFlags.BONUS_ON_DEATH) !== 0 &&
      creature.bonusId !== null
    ) {
      state.bonusPool.spawnAt(
        creature.pos,
        creature.bonusId,
        creature.bonusDurationOverride !== null ? int(creature.bonusDurationOverride) : -1,
        { state, worldWidth, worldHeight },
      );
      if (!state.preserveBugs) {
        creature.bonusId = null;
        creature.bonusDurationOverride = null;
      }
    }
    if (!creature.active) {
      // Native `creature_handle_death` gates its XP/bonus/freeze body under
      // `if (active != 0)`. Re-entrant callers (notably secondary
      // detonation follow-up) can invoke death handling after the first call
      // has already deactivated the creature.
      return new CreatureDeath({
        index: int(idx),
        pos: creature.pos,
        typeId: creature.typeId,
        rewardValue: creature.rewardValue,
        xpAwarded: 0,
        owner: creature.lastHitOwner,
      });
    }
    const death = this._startDeath(
      int(idx),
      creature,
      {
        state,
        players,
        rng,
        detailPreset: int(detailPreset),
        worldWidth,
        worldHeight,
      },
    );

    if (keepCorpse) {
      // Native `creature_handle_death` always decrements lifecycle_stage by
      // frame_dt for corpse-keeping deaths, independent of current value.
      creature.lifecycleStage = creature.lifecycleStage - dt;
    } else {
      creature.active = false;
    }

    if (state.bonuses.freeze > 0.0) {
      const creaturePos = creature.pos;
      for (let i = 0; i < 8; i++) {
        const angle =
          (int(rng.rand({ caller: RngCallerStatic.CREATURE_HANDLE_DEATH_FREEZE_SHARD_ANGLE })) % 612) * 0.01;
        state.effects.spawnFreezeShard({ pos: creaturePos, angle, rng, detailPreset: int(detailPreset) });
      }
      const shatterAngle =
        (int(rng.rand({ caller: RngCallerStatic.CREATURE_HANDLE_DEATH_FREEZE_SHATTER_ANGLE })) % 612) * 0.01;
      state.effects.spawnFreezeShatter({ pos: creaturePos, angle: shatterAngle, rng, detailPreset: int(detailPreset) });
      if (fxQueue !== null) {
        fxQueue.addRandom({ pos: creaturePos, rng });
      }
      this.killCount += 1;
      creature.active = false;
    }

    return death;
  }

  private _applyInit(entry: CreatureState, init: CreatureInit): void {
    entry.active = true;
    entry.typeId = init.typeId !== null ? init.typeId : CreatureTypeId.ZOMBIE;
    entry.pos = f32Vec2(init.pos);
    if (init.heading !== null) {
      // Native spawn paths write heading but keep target_heading stale from
      // the recycled slot (capture lifecycle shows added entries retaining
      // prior target_heading values).
      entry.heading = f32(init.heading);
    }
    entry.target = f32Vec2(init.pos);
    entry.phaseSeed = f32(init.phaseSeed);
    // Native spawn paths zero velocity and a few per-frame state fields on every
    // allocation (`creature_spawn`, `survival_spawn_creature`, `creature_spawn_template`).
    entry.vel = new Vec2();
    entry.forceTarget = 0;

    entry.flags = init.flags ?? 0;
    entry.aiMode = init.aiMode;

    let hp = init.health ? init.health : 0.0;
    if (hp <= 0.0) hp = 1.0;
    entry.hp = f32(hp);
    entry.maxHp = f32(init.maxHealth ? init.maxHealth : hp);

    entry.moveSpeed = f32(init.moveSpeed ? init.moveSpeed : 1.0);
    entry.rewardValue = f32(init.rewardValue ? init.rewardValue : 0.0);
    entry.size = f32(init.size ? init.size : 50.0);
    entry.contactDamage = f32(init.contactDamage ? init.contactDamage : 0.0);

    entry.targetOffset = init.targetOffset !== null ? f32Vec2(init.targetOffset) : null;
    entry.orbitAngle = f32(init.orbitAngle ? init.orbitAngle : 0.0);
    let orbitRadius: number;
    if (init.orbitRadius !== null) {
      orbitRadius = init.orbitRadius;
    } else if (init.rangedProjectileType !== null) {
      orbitRadius = init.rangedProjectileType;
    } else {
      orbitRadius = 0.0;
    }
    entry.orbitRadius = f32(orbitRadius);

    entry.spawnSlotIndex = null;
    entry.attackCooldown = 0.0;

    entry.bonusId = init.bonusId;
    entry.bonusDurationOverride =
      init.bonusDurationOverride !== null ? int(init.bonusDurationOverride) : null;

    const resolved = resolveTint(init.tint);
    entry.tint = new RGBA(resolved[0], resolved[1], resolved[2], resolved[3]);

    entry.plagueInfected = false;
    entry.collisionTimer = 0.0;
    entry.lifecycleStage = CREATURE_LIFECYCLE_ALIVE;
    entry.hitFlashTimer = 0.0;
    entry.animPhase = 0.0;
    entry.lastHitOwner = OwnerRef.fromLocalPlayer(0);
  }

  private _disableSpawnSlot(slotIndex: number): void {
    if (!(int(slotIndex) >= 0 && int(slotIndex) < this.spawnSlots.length)) return;
    const slot = this.spawnSlots[int(slotIndex)];
    slot.ownerCreature = -1;
    slot.limit = 0;
  }

  _tickDead(
    creature: CreatureState,
    opts: {
      dt: number;
      worldWidth: number;
      worldHeight: number;
      fxQueueRotated: FxQueueRotated | null;
      rng?: CrandLike | null;
      detailPreset?: number;
      violenceDisabled?: number;
    },
  ): void {
    // Advance the post-death lifecycle_stage ramp and queue corpse decals.
    //
    // This matches the `lifecycle_stage` death staging inside `creature_update_all`:
    // - while lifecycle_stage > 0: decrement quickly and slide backwards
    // - once lifecycle_stage <= 0: queue a corpse decal and fade out until < -10, then deactivate.

    const dt = opts.dt;
    const worldWidth = opts.worldWidth;
    const worldHeight = opts.worldHeight;
    const fxQueueRotated = opts.fxQueueRotated;
    const rng = opts.rng ?? null;
    const detailPreset = opts.detailPreset ?? 5;
    const violenceDisabled = opts.violenceDisabled ?? 0;
    void worldWidth;
    void worldHeight;

    if (dt <= 0.0) return;

    const dtF32 = f32(dt);
    const hitbox = f32(creature.lifecycleStage);
    if (hitbox <= 0.0) {
      creature.lifecycleStage = f32(hitbox - f32(dtF32 * CREATURE_CORPSE_FADE_DECAY));
      return;
    }

    const longStrip =
      ((int(creature.flags)) & CreatureFlags.ANIM_PING_PONG) === 0 ||
      ((int(creature.flags)) & CreatureFlags.ANIM_LONG_STRIP) !== 0;

    const newHitbox = f32(hitbox - f32(dtF32 * CREATURE_DEATH_TIMER_DECAY));
    creature.lifecycleStage = f32(newHitbox);
    if (newHitbox > 0.0) {
      if (longStrip) {
        // Match float-local multiply chain in `creature_update_all`:
        // slide = (float)((float)(hitbox * dt) * 9.0f)
        const slide = f32(f32(newHitbox * dtF32) * f32(CREATURE_DEATH_SLIDE_SCALE));
        const direction = headingToDirectionF32(creature.heading);
        creature.vel = new Vec2(
          f32(direction.x * slide),
          f32(direction.y * slide),
        );
        creature.pos = new Vec2(
          f32(creature.pos.x - creature.vel.x),
          f32(creature.pos.y - creature.vel.y),
        );
      } else {
        creature.vel = new Vec2();
      }
      return;
    }

    // lifecycle_stage just crossed <= 0: bake a persistent corpse decal into the ground.
    if (int(violenceDisabled) === 0 && fxQueueRotated !== null) {
      const corpseSize = Math.max(1.0, creature.size);
      // Native uses a special fallback corpse id for ping-pong strip creatures.
      const corpseTypeId = longStrip ? int(creature.typeId) : 7;
      const ok = fxQueueRotated.add({
        topLeft: new Vec2(creature.pos.x - corpseSize * 0.5, creature.pos.y - corpseSize * 0.5),
        rgba: creature.tint,
        rotation: creature.heading,
        scale: corpseSize,
        creatureTypeId: corpseTypeId,
      });
      if (!ok) {
        creature.lifecycleStage = 0.001;
        return;
      }
    }

    this.killCount += 1;

    // Native `creature_update_all` emits a 19-splatter blood burst when a
    // ping-pong corpse first reaches this staged kill point.
    if (
      int(violenceDisabled) === 0 &&
      ((int(creature.flags)) & CreatureFlags.ANIM_PING_PONG) !== 0 &&
      rng !== null &&
      this.effects !== null
    ) {
      const batches: [number, number, number][] = [
        [8, 0.0, RngCallerStatic.CREATURE_UPDATE_ALL_PING_PONG_BLOOD_8_ANGLE],
        [6, -0.07, RngCallerStatic.CREATURE_UPDATE_ALL_PING_PONG_BLOOD_6_ANGLE],
        [5, -0.12, RngCallerStatic.CREATURE_UPDATE_ALL_PING_PONG_BLOOD_5_ANGLE],
      ];
      for (const [count, age, angleCaller] of batches) {
        for (let i = 0; i < count; i++) {
          const angle = (int(rng.rand({ caller: angleCaller })) % 612) * 0.01;
          this.effects.spawnBloodSplatter({
            pos: creature.pos,
            angle,
            age,
            rng,
            detailPreset: int(detailPreset),
            violenceDisabled: int(violenceDisabled),
          });
        }
      }
    }
  }

  finalizePostRenderLifecycle(): void {
    // Mirror render-time corpse culling from native `creature_render_type`.
    //
    // Native deactivates entries only after draw once `lifecycle_stage < -10.0`. Keeping
    // this outside `creature_update_all` preserves slot-allocation timing for same-tick
    // survival/rush spawns.

    for (const creature of this._entries) {
      if (!creature.active) continue;
      if (classifyCreatureLifecycle(creature.lifecycleStage) !== CreatureLifecyclePhase.DESPAWNED) {
        continue;
      }
      if (creature.spawnSlotIndex !== null) {
        this._disableSpawnSlot(int(creature.spawnSlotIndex));
      }
      creature.active = false;
    }
  }

  private _startDeath(
    idx: number,
    creature: CreatureState,
    opts: {
      state: GameplayState;
      players: PlayerState[];
      rng: CrandLike;
      detailPreset?: number;
      worldWidth: number;
      worldHeight: number;
    },
  ): CreatureDeath {
    const state = opts.state;
    const players = opts.players;
    const rng = opts.rng;
    const detailPreset = opts.detailPreset ?? 5;
    const worldWidth = opts.worldWidth;
    const worldHeight = opts.worldHeight;
    if (creature.spawnSlotIndex !== null) {
      this._disableSpawnSlot(int(creature.spawnSlotIndex));
    }

    if (
      ((int(creature.flags)) & CreatureFlags.SPLIT_ON_DEATH) !== 0 &&
      creature.size > 35.0
    ) {
      const splits: [number, number][] = [
        [-Math.PI / 2.0, RngCallerStatic.CREATURE_HANDLE_DEATH_SPLIT_CHILD_1_PHASE_SEED],
        [Math.PI / 2.0, RngCallerStatic.CREATURE_HANDLE_DEATH_SPLIT_CHILD_2_PHASE_SEED],
      ];
      for (const [headingOffset, phaseSeedCaller] of splits) {
        const childIdx = this._allocSlot();
        if (childIdx === null) continue;
        const child = _replaceCreatureState(creature);
        child.phaseSeed = int(rng.rand({ caller: phaseSeedCaller })) & 0xFF;
        child.heading = _wrapAngle(creature.heading + headingOffset);
        child.targetHeading = child.heading;
        child.hp = creature.maxHp * 0.25;
        child.rewardValue = child.rewardValue * (2.0 / 3.0);
        child.size = child.size - 8.0;
        child.moveSpeed = child.moveSpeed + 0.1;
        child.contactDamage = child.contactDamage * 0.7;
        child.lifecycleStage = CREATURE_LIFECYCLE_ALIVE;
        this._entries[childIdx] = child;
        this.spawnedCount += 1;
      }

      state.effects.spawnBurst({ pos: creature.pos, count: 8, rng, detailPreset: int(detailPreset) });
    }

    let killer: PlayerState | null = null;
    if (players.length > 0) {
      let playerIndex = _ownerToPlayerIndex(creature.lastHitOwner);
      if (playerIndex === null || !(playerIndex >= 0 && playerIndex < players.length)) {
        playerIndex = 0;
      }
      killer = players[playerIndex];
    }

    let xpAwarded = 0;
    if (killer !== null) {
      if (perkActive(killer, PerkId.BLOODY_MESS_QUICK_LEARNER)) {
        xpAwarded = awardExperience(state, killer, int(creature.rewardValue * 1.3));
      } else {
        xpAwarded = awardExperienceFromReward(state, killer, creature.rewardValue);
      }
    }

    if (players.length > 0) {
      state.bonusPool.trySpawnOnKill(
        creature.pos,
        { state, players, detailPreset, worldWidth, worldHeight },
      );
    }

    return new CreatureDeath({
      index: int(idx),
      pos: creature.pos,
      typeId: creature.typeId,
      rewardValue: creature.rewardValue,
      xpAwarded: int(xpAwarded),
      owner: creature.lastHitOwner,
    });
  }
}
