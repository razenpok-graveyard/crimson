// Port of crimson/creatures/spawn.py

// Creature spawning helpers.
//
// This module combines:
// - a spawn-id labeling index (direct `type_id`/`flags` assignments extracted from
//   `creature_spawn_template`, `FUN_00430af0`)
// - a partial 1:1 rewrite of `creature_spawn_template` as a pure plan builder
//
// Note: in the original game, `creature_spawn_template` is an algorithm (formations,
// spawn slots, tail modifiers), so the spawn-id index here is only used for labeling
// and debug UIs.
//
// See also: `docs/creatures/spawn_plan.md` (porting model / invariants).

import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { BonusId } from '@crimson/bonuses/index.ts';
import { f32 } from '@crimson/math-parity.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { TintRGBA } from '@crimson/creatures/spawn-ids.ts';
import { HAS_SPAWN_SLOT_FLAG, RANDOM_HEADING_SENTINEL, CreatureAiMode, CreatureFlags, CreatureTypeId, SpawnId, Tint } from '@crimson/creatures/spawn-ids.ts';
import { SPAWN_ID_TO_TEMPLATE } from '@crimson/creatures/spawn-templates.ts';
export { HAS_SPAWN_SLOT_FLAG, RANDOM_HEADING_SENTINEL, CreatureAiMode, CreatureFlags, CreatureTypeId, SpawnId } from '@crimson/creatures/spawn-ids.ts';
export { SPAWN_ID_TO_TEMPLATE, SPAWN_TEMPLATES, TYPE_ID_TO_NAME, SpawnTemplate } from '@crimson/creatures/spawn-templates.ts';

type TemplateFn = (arg0: PlanBuilder) => void;

export class AlienSpawnerSpec {
  readonly timer: number;
  readonly limit: number;
  readonly interval: number;
  readonly childTemplateId: SpawnId;
  readonly size: number;
  readonly health: number;
  readonly moveSpeed: number;
  readonly rewardValue: number;
  readonly tint: TintRGBA;

  constructor(opts: {
    timer: number;
    limit: number;
    interval: number;
    childTemplateId: SpawnId;
    size: number;
    health: number;
    moveSpeed: number;
    rewardValue: number;
    tint: TintRGBA;
  }) {
    this.timer = opts.timer;
    this.limit = opts.limit;
    this.interval = opts.interval;
    this.childTemplateId = opts.childTemplateId;
    this.size = opts.size;
    this.health = opts.health;
    this.moveSpeed = opts.moveSpeed;
    this.rewardValue = opts.rewardValue;
    this.tint = opts.tint;
  }
}

export class ConstantSpawnSpec {
  readonly typeId: CreatureTypeId;
  readonly health: number;
  readonly moveSpeed: number;
  readonly rewardValue: number;
  readonly tint: TintRGBA;
  readonly size: number;
  readonly contactDamage: number;
  readonly flags: number;
  readonly aiMode: number;
  readonly orbitAngle: number | null;
  readonly orbitRadius: number | null;
  readonly rangedProjectileType: number | null;
  readonly bonusId: BonusId | null;
  readonly bonusDurationOverride: number | null;

  constructor(opts: {
    typeId: CreatureTypeId;
    health: number;
    moveSpeed: number;
    rewardValue: number;
    tint: TintRGBA;
    size: number;
    contactDamage: number;
    flags?: number;
    aiMode?: number;
    orbitAngle?: number | null;
    orbitRadius?: number | null;
    rangedProjectileType?: number | null;
    bonusId?: BonusId | null;
    bonusDurationOverride?: number | null;
  }) {
    this.typeId = opts.typeId;
    this.health = opts.health;
    this.moveSpeed = opts.moveSpeed;
    this.rewardValue = opts.rewardValue;
    this.tint = opts.tint;
    this.size = opts.size;
    this.contactDamage = opts.contactDamage;
    this.flags = opts.flags ?? 0;
    this.aiMode = opts.aiMode ?? CreatureAiMode.ORBIT_PLAYER;
    this.orbitAngle = opts.orbitAngle ?? null;
    this.orbitRadius = opts.orbitRadius ?? null;
    this.rangedProjectileType = opts.rangedProjectileType ?? null;
    this.bonusId = opts.bonusId ?? null;
    this.bonusDurationOverride = opts.bonusDurationOverride ?? null;
  }
}

export class FormationChildSpec {
  readonly typeId: CreatureTypeId;
  readonly health: number;
  readonly moveSpeed: number;
  readonly rewardValue: number;
  readonly size: number;
  readonly contactDamage: number;
  readonly tint: TintRGBA;
  readonly maxHealth: number | null;
  readonly orbitAngle: number | null;
  readonly orbitRadius: number | null;

  constructor(opts: {
    typeId: CreatureTypeId;
    health: number;
    moveSpeed: number;
    rewardValue: number;
    size: number;
    contactDamage: number;
    tint: TintRGBA;
    maxHealth?: number | null;
    orbitAngle?: number | null;
    orbitRadius?: number | null;
  }) {
    this.typeId = opts.typeId;
    this.health = opts.health;
    this.moveSpeed = opts.moveSpeed;
    this.rewardValue = opts.rewardValue;
    this.size = opts.size;
    this.contactDamage = opts.contactDamage;
    this.tint = opts.tint;
    this.maxHealth = opts.maxHealth ?? null;
    this.orbitAngle = opts.orbitAngle ?? null;
    this.orbitRadius = opts.orbitRadius ?? null;
  }
}

export class GridFormationSpec {
  readonly parent: ConstantSpawnSpec;
  readonly childAiMode: number;
  readonly childSpec: FormationChildSpec;
  readonly xRange: Iterable<number>;
  readonly yRange: Iterable<number>;
  readonly applyFallback: boolean;
  readonly setParentMaxHealth: boolean;

  constructor(opts: {
    parent: ConstantSpawnSpec;
    childAiMode: number;
    childSpec: FormationChildSpec;
    xRange: Iterable<number>;
    yRange: Iterable<number>;
    applyFallback?: boolean;
    setParentMaxHealth?: boolean;
  }) {
    this.parent = opts.parent;
    this.childAiMode = opts.childAiMode;
    this.childSpec = opts.childSpec;
    this.xRange = opts.xRange;
    this.yRange = opts.yRange;
    this.applyFallback = opts.applyFallback ?? false;
    this.setParentMaxHealth = opts.setParentMaxHealth ?? true;
  }
}

export class RingFormationSpec {
  readonly parent: ConstantSpawnSpec;
  readonly childAiMode: number;
  readonly childSpec: FormationChildSpec;
  readonly count: number;
  readonly angleStep: number;
  readonly radius: number;
  readonly applyFallback: boolean;
  readonly setPosition: boolean;
  readonly setParentMaxHealth: boolean;

  constructor(opts: {
    parent: ConstantSpawnSpec;
    childAiMode: number;
    childSpec: FormationChildSpec;
    count: number;
    angleStep: number;
    radius: number;
    applyFallback?: boolean;
    setPosition?: boolean;
    setParentMaxHealth?: boolean;
  }) {
    this.parent = opts.parent;
    this.childAiMode = opts.childAiMode;
    this.childSpec = opts.childSpec;
    this.count = opts.count;
    this.angleStep = opts.angleStep;
    this.radius = opts.radius;
    this.applyFallback = opts.applyFallback ?? false;
    this.setPosition = opts.setPosition ?? false;
    this.setParentMaxHealth = opts.setParentMaxHealth ?? true;
  }
}

export class SpawnEnv {
  readonly terrainWidth: number;
  readonly terrainHeight: number;
  readonly demoModeActive: boolean;
  readonly hardcore: boolean;
  readonly questFailRetryCount: number;

  constructor(opts: {
    terrainWidth: number;
    terrainHeight: number;
    demoModeActive: boolean;
    hardcore: boolean;
    questFailRetryCount: number;
  }) {
    this.terrainWidth = opts.terrainWidth;
    this.terrainHeight = opts.terrainHeight;
    this.demoModeActive = opts.demoModeActive;
    this.hardcore = opts.hardcore;
    this.questFailRetryCount = opts.questFailRetryCount;
  }
}

export class BurstEffect {
  readonly pos: Vec2;
  readonly count: number;

  constructor(opts: {
    pos: Vec2;
    count: number;
  }) {
    this.pos = opts.pos;
    this.count = opts.count;
  }
}

export class CreatureInit {
  // Template id that produced this creature (not necessarily unique per creature in formations).
  originTemplateId: number;
  pos: Vec2;
  // Heading is optional at plan-build time:
  // - `None` means "preserve stale slot heading" (native `creature_alloc_slot` behavior).
  // - explicit float means "set heading to this value".
  // The base template path writes heading explicitly at tail (`final_heading`).
  heading: number | null;
  phaseSeed: number;
  typeId: CreatureTypeId | null;
  flags: number;
  aiMode: number;
  health: number | null;
  maxHealth: number | null;
  moveSpeed: number | null;
  rewardValue: number | null;
  size: number | null;
  contactDamage: number | null;
  tint: Tint | null;
  orbitAngle: number | null;
  orbitRadius: number | null;
  rangedProjectileType: number | null;
  // AI link semantics:
  // - For most formations (ai_mode 3/5/...), `ai_link_parent` references another creature index
  //   (typically the parent or previous element in the chain).
  // - For AI7 timer mode (flag 0x80), `ai_timer` is written into link_index.
  aiLinkParent: number | null;
  aiTimer: number | null;
  targetOffset: Vec2 | null;
  // Spawn slot reference (stored in link_index when flags include HAS_SPAWN_SLOT_FLAG).
  spawnSlot: number | null;
  // BONUS_ON_DEATH uses link_index low/high 16-bit fields for bonus spawn args.
  bonusId: BonusId | null;
  bonusDurationOverride: number | null;

  constructor(opts: {
    originTemplateId: number;
    pos: Vec2;
    heading: number | null;
    phaseSeed: number;
    typeId?: CreatureTypeId | null;
    flags?: number;
    aiMode?: number;
    health?: number | null;
    maxHealth?: number | null;
    moveSpeed?: number | null;
    rewardValue?: number | null;
    size?: number | null;
    contactDamage?: number | null;
    tint?: Tint | null;
    orbitAngle?: number | null;
    orbitRadius?: number | null;
    rangedProjectileType?: number | null;
    aiLinkParent?: number | null;
    aiTimer?: number | null;
    targetOffset?: Vec2 | null;
    spawnSlot?: number | null;
    bonusId?: BonusId | null;
    bonusDurationOverride?: number | null;
  }) {
    this.originTemplateId = opts.originTemplateId;
    this.pos = opts.pos;
    this.heading = opts.heading;
    this.phaseSeed = opts.phaseSeed;
    this.typeId = opts.typeId ?? null;
    this.flags = opts.flags ?? 0;
    this.aiMode = opts.aiMode ?? CreatureAiMode.ORBIT_PLAYER;
    this.health = opts.health ?? null;
    this.maxHealth = opts.maxHealth ?? null;
    this.moveSpeed = opts.moveSpeed ?? null;
    this.rewardValue = opts.rewardValue ?? null;
    this.size = opts.size ?? null;
    this.contactDamage = opts.contactDamage ?? null;
    this.tint = opts.tint ?? null;
    this.orbitAngle = opts.orbitAngle ?? null;
    this.orbitRadius = opts.orbitRadius ?? null;
    this.rangedProjectileType = opts.rangedProjectileType ?? null;
    this.aiLinkParent = opts.aiLinkParent ?? null;
    this.aiTimer = opts.aiTimer ?? null;
    this.targetOffset = opts.targetOffset ?? null;
    this.spawnSlot = opts.spawnSlot ?? null;
    this.bonusId = opts.bonusId ?? null;
    this.bonusDurationOverride = opts.bonusDurationOverride ?? null;
  }
}

export class SpawnSlotInit {
  ownerCreature: number;
  timer: number;
  count: number;
  limit: number;
  interval: number;
  childTemplateId: SpawnId;

  constructor(opts: {
    ownerCreature: number;
    timer: number;
    count: number;
    limit: number;
    interval: number;
    childTemplateId: SpawnId;
  }) {
    this.ownerCreature = opts.ownerCreature;
    this.timer = opts.timer;
    this.count = opts.count;
    this.limit = opts.limit;
    this.interval = opts.interval;
    this.childTemplateId = opts.childTemplateId;
  }
}

export class SpawnPlan {
  readonly creatures: readonly CreatureInit[];
  readonly spawnSlots: readonly SpawnSlotInit[];
  readonly effects: readonly BurstEffect[];
  readonly primary: number;

  constructor(opts: {
    creatures: readonly CreatureInit[];
    spawnSlots: readonly SpawnSlotInit[];
    effects: readonly BurstEffect[];
    primary: number;
  }) {
    this.creatures = opts.creatures;
    this.spawnSlots = opts.spawnSlots;
    this.effects = opts.effects;
    this.primary = opts.primary;
  }
}

export class PlanBuilder {
  templateId: SpawnId;
  pos: Vec2;
  rng: CrandLike;
  env: SpawnEnv;
  creatures: CreatureInit[];
  spawnSlots: SpawnSlotInit[];
  effects: BurstEffect[];
  primary: number;

  constructor(opts: {
    templateId: SpawnId;
    pos: Vec2;
    rng: CrandLike;
    env: SpawnEnv;
    creatures: CreatureInit[];
    spawnSlots: SpawnSlotInit[];
    effects: BurstEffect[];
    primary?: number;
  }) {
    this.templateId = opts.templateId;
    this.pos = opts.pos;
    this.rng = opts.rng;
    this.env = opts.env;
    this.creatures = opts.creatures;
    this.spawnSlots = opts.spawnSlots;
    this.effects = opts.effects;
    this.primary = opts.primary ?? 0;
  }

  static start(templateId: SpawnId, pos: Vec2, heading: number, rng: CrandLike, env: SpawnEnv): [PlanBuilder, number] {
    // creature_alloc_slot() for the base creature.
    const creatures: CreatureInit[] = [allocCreature(templateId, pos, rng)];
    const spawnSlots: SpawnSlotInit[] = [];
    const effects: BurstEffect[] = [];

    // `heading == RANDOM_HEADING_SENTINEL` uses a randomized heading.
    let finalHeading = heading;
    if (finalHeading === RANDOM_HEADING_SENTINEL) {
      finalHeading = rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_RANDOM_HEADING }) % 628 * 0.01;
    }

    // Base initialization always consumes one rand() for a transient heading value.
    creatures[0].heading = rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_BASE_HEADING }) % 314 * 0.01;

    return [new PlanBuilder({ templateId: templateId, pos: pos, rng: rng, env: env, creatures: creatures, spawnSlots: spawnSlots, effects: effects, primary: 0 }), finalHeading];
  }

  get base(): CreatureInit {
    return this.creatures[0];
  }

  addSlot(opts: { owner: number; timer: number; limit: number; interval: number; child: SpawnId }): number {
    const owner = opts.owner;
    const timer = opts.timer;
    const limit = opts.limit;
    const interval = opts.interval;
    const child = opts.child;
    return addSpawnSlot(this.spawnSlots, { ownerCreature: owner, timer: timer, limit: limit, interval: interval, childTemplateId: child });
  }

  ringChildren(opts: { kwargs?: any }): number;
  ringChildren(kwargs?: any): number;
  ringChildren(kwargsOrOpts: any | { kwargs?: any } = {}): number {
    const kwargs: any = typeof kwargsOrOpts === 'object' && kwargsOrOpts !== null ? kwargsOrOpts.kwargs ?? {} : kwargsOrOpts ?? {};
    return spawnRingChildren(this.creatures, this.templateId, this.pos, this.rng, kwargs);
  }

  gridChildren(opts: { kwargs?: any }): number;
  gridChildren(kwargs?: any): number;
  gridChildren(kwargsOrOpts: any | { kwargs?: any } = {}): number {
    const kwargs: any = typeof kwargsOrOpts === 'object' && kwargsOrOpts !== null ? kwargsOrOpts.kwargs ?? {} : kwargsOrOpts ?? {};
    return spawnGridChildren(this.creatures, this.templateId, this.pos, this.rng, kwargs);
  }

  chainChildren(opts: { kwargs?: any }): number;
  chainChildren(kwargs?: any): number;
  chainChildren(kwargsOrOpts: any | { kwargs?: any } = {}): number {
    const kwargs: any = typeof kwargsOrOpts === 'object' && kwargsOrOpts !== null ? kwargsOrOpts.kwargs ?? {} : kwargsOrOpts ?? {};
    return spawnChainChildren(this.creatures, this.templateId, this.pos, this.rng, kwargs);
  }

  finish(opts: { finalHeading: number }): SpawnPlan;
  finish(finalHeading: number): SpawnPlan;
  finish(finalHeadingOrOpts: number | { finalHeading: number }): SpawnPlan {
    const finalHeading: number = typeof finalHeadingOrOpts === 'object' && finalHeadingOrOpts !== null ? finalHeadingOrOpts.finalHeading : finalHeadingOrOpts as number;
    applyTail(this.templateId, this.creatures, this.spawnSlots, this.effects, this.primary, finalHeading, this.env);
    return new SpawnPlan({ creatures: Array.from(this.creatures), spawnSlots: Array.from(this.spawnSlots), effects: Array.from(this.effects), primary: this.primary });
  }
}

export class SurvivalSpawnPosCallers {
  readonly edge: RngCallerStatic;
  readonly topX: RngCallerStatic;
  readonly bottomX: RngCallerStatic;
  readonly leftY: RngCallerStatic;
  readonly rightY: RngCallerStatic;

  constructor(opts: {
    edge: RngCallerStatic;
    topX: RngCallerStatic;
    bottomX: RngCallerStatic;
    leftY: RngCallerStatic;
    rightY: RngCallerStatic;
  }) {
    this.edge = opts.edge;
    this.topX = opts.topX;
    this.bottomX = opts.bottomX;
    this.leftY = opts.leftY;
    this.rightY = opts.rightY;
  }
}

export class SpawnTemplateCall {
  readonly templateId: SpawnId;
  readonly pos: Vec2;
  readonly heading: number;

  constructor(opts: {
    templateId: SpawnId;
    pos: Vec2;
    heading: number;
  }) {
    this.templateId = opts.templateId;
    this.pos = opts.pos;
    this.heading = opts.heading;
  }
}

const ALIEN_SPAWNER_TEMPLATES: Map<SpawnId, AlienSpawnerSpec> = new Map([
  [SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, new AlienSpawnerSpec({ timer: 1.0, limit: 100, interval: 2.2, childTemplateId: SpawnId.ALIEN_RANDOM_1D, size: 50.0, health: 1000.0, moveSpeed: 2.0, rewardValue: 3000.0, tint: [1.0, 1.0, 1.0, 1.0] })],
  [SpawnId.ALIEN_SPAWNER_CHILD_1D_SLOW_08, new AlienSpawnerSpec({ timer: 1.0, limit: 100, interval: 2.8, childTemplateId: SpawnId.ALIEN_RANDOM_1D, size: 50.0, health: 1000.0, moveSpeed: 2.0, rewardValue: 3000.0, tint: [1.0, 1.0, 1.0, 1.0] })],
  [SpawnId.ALIEN_SPAWNER_CHILD_1D_LIMITED_09, new AlienSpawnerSpec({ timer: 1.0, limit: 16, interval: 2.0, childTemplateId: SpawnId.ALIEN_RANDOM_1D, size: 40.0, health: 450.0, moveSpeed: 2.0, rewardValue: 1000.0, tint: [1.0, 1.0, 1.0, 1.0] })],
  [SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, new AlienSpawnerSpec({ timer: 2.0, limit: 100, interval: 5.0, childTemplateId: SpawnId.SPIDER_SP1_RANDOM_32, size: 55.0, health: 1000.0, moveSpeed: 1.5, rewardValue: 3000.0, tint: [0.8, 0.7, 0.4, 1.0] })],
  [SpawnId.ALIEN_SPAWNER_CHILD_3C_SLOW_0B, new AlienSpawnerSpec({ timer: 2.0, limit: 100, interval: 6.0, childTemplateId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, size: 65.0, health: 3500.0, moveSpeed: 1.5, rewardValue: 5000.0, tint: [0.9, 0.1, 0.1, 1.0] })],
  [SpawnId.ALIEN_SPAWNER_CHILD_31_FAST_0C, new AlienSpawnerSpec({ timer: 1.5, limit: 100, interval: 2.0, childTemplateId: SpawnId.LIZARD_RANDOM_31, size: 32.0, health: 50.0, moveSpeed: 2.8, rewardValue: 1000.0, tint: [0.9, 0.8, 0.4, 1.0] })],
  [SpawnId.ALIEN_SPAWNER_CHILD_31_SLOW_0D, new AlienSpawnerSpec({ timer: 2.0, limit: 100, interval: 6.0, childTemplateId: SpawnId.LIZARD_RANDOM_31, size: 32.0, health: 50.0, moveSpeed: 1.3, rewardValue: 1000.0, tint: [0.9, 0.8, 0.4, 1.0] })],
  [SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, new AlienSpawnerSpec({ timer: 1.5, limit: 100, interval: 2.3, childTemplateId: SpawnId.SPIDER_SP1_RANDOM_32, size: 32.0, health: 50.0, moveSpeed: 2.8, rewardValue: 800.0, tint: [0.9, 0.8, 0.4, 1.0] })],
]);
const CONSTANT_SPAWN_TEMPLATES: Map<SpawnId, ConstantSpawnSpec> = new Map([
  [SpawnId.SPIDER_SP2_SPLITTER_01, new ConstantSpawnSpec({ typeId: CreatureTypeId.SPIDER_SP2, health: 400.0, moveSpeed: 2.0, rewardValue: 1000.0, tint: [0.8, 0.7, 0.4, 1.0], size: 80.0, contactDamage: 17.0, flags: CreatureFlags.SPLIT_ON_DEATH })],
  [SpawnId.ALIEN_CONST_BROWN_TRANSPARENT_0F, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 20.0, moveSpeed: 2.9, rewardValue: 60.0, tint: [0.665, 0.385, 0.259, 0.56], size: 50.0, contactDamage: 35.0 })],
  [SpawnId.ALIEN_CONST_PURPLE_GHOST_21, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 53.0, moveSpeed: 1.7, rewardValue: 120.0, tint: [0.7, 0.1, 0.51, 0.5], size: 55.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_GREEN_GHOST_22, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 25.0, moveSpeed: 1.7, rewardValue: 150.0, tint: [0.1, 0.7, 0.51, 0.05], size: 50.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_GREEN_GHOST_SMALL_23, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 5.0, moveSpeed: 1.7, rewardValue: 180.0, tint: [0.1, 0.7, 0.51, 0.04], size: 45.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_GREEN_24, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 20.0, moveSpeed: 2.0, rewardValue: 110.0, tint: [0.1, 0.7, 0.11, 1.0], size: 50.0, contactDamage: 4.0 })],
  [SpawnId.ALIEN_CONST_GREEN_SMALL_25, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 25.0, moveSpeed: 2.5, rewardValue: 125.0, tint: [0.1, 0.8, 0.11, 1.0], size: 30.0, contactDamage: 3.0 })],
  [SpawnId.ALIEN_CONST_PALE_GREEN_26, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 2.2, rewardValue: 125.0, tint: [0.6, 0.8, 0.6, 1.0], size: 45.0, contactDamage: 10.0 })],
  [SpawnId.ALIEN_CONST_WEAPON_BONUS_27, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 2.1, rewardValue: 125.0, tint: [1.0, 0.8, 0.1, 1.0], size: 45.0, contactDamage: 10.0, flags: CreatureFlags.BONUS_ON_DEATH, bonusId: BonusId.WEAPON, bonusDurationOverride: 5 })],
  [SpawnId.ALIEN_CONST_PURPLE_28, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 1.7, rewardValue: 150.0, tint: [0.7, 0.1, 0.51, 1.0], size: 55.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_GREY_BRUTE_29, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 800.0, moveSpeed: 2.5, rewardValue: 450.0, tint: [0.8, 0.8, 0.8, 1.0], size: 70.0, contactDamage: 20.0 })],
  [SpawnId.ALIEN_CONST_GREY_FAST_2A, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 3.1, rewardValue: 300.0, tint: [0.3, 0.3, 0.3, 1.0], size: 60.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_RED_FAST_2B, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 30.0, moveSpeed: 3.6, rewardValue: 450.0, tint: [1.0, 0.3, 0.3, 1.0], size: 35.0, contactDamage: 20.0 })],
  [SpawnId.ALIEN_CONST_RED_BOSS_2C, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 3800.0, moveSpeed: 2.0, rewardValue: 1500.0, tint: [0.85, 0.2, 0.2, 1.0], size: 80.0, contactDamage: 40.0 })],
  [SpawnId.ALIEN_CONST_CYAN_AI2_2D, new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 45.0, moveSpeed: 3.1, rewardValue: 200.0, tint: [0.0, 0.9, 0.8, 1.0], size: 38.0, contactDamage: 3.0, aiMode: CreatureAiMode.CHASE_PLAYER })],
  [SpawnId.LIZARD_CONST_GREY_2F, new ConstantSpawnSpec({ typeId: CreatureTypeId.LIZARD, health: 20.0, moveSpeed: 2.5, rewardValue: 150.0, tint: [0.8, 0.8, 0.8, 1.0], size: 45.0, contactDamage: 4.0 })],
  [SpawnId.LIZARD_CONST_YELLOW_BOSS_30, new ConstantSpawnSpec({ typeId: CreatureTypeId.LIZARD, health: 1000.0, moveSpeed: 2.0, rewardValue: 400.0, tint: [0.9, 0.8, 0.1, 1.0], size: 65.0, contactDamage: 10.0 })],
  [SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, new ConstantSpawnSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 4500.0, moveSpeed: 2.0, rewardValue: 4500.0, tint: [1.0, 1.0, 1.0, 1.0], size: 64.0, contactDamage: 50.0, flags: CreatureFlags.RANGED_ATTACK_SHOCK, orbitAngle: 0.9, rangedProjectileType: 9 })],
  [SpawnId.SPIDER_SP1_CONST_RED_BOSS_3B, new ConstantSpawnSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 1200.0, moveSpeed: 2.0, rewardValue: 4000.0, tint: [0.9, 0.0, 0.0, 1.0], size: 70.0, contactDamage: 20.0 })],
  [SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, new ConstantSpawnSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 200.0, moveSpeed: 2.0, rewardValue: 200.0, tint: [0.9, 0.1, 0.1, 1.0], size: 40.0, contactDamage: 20.0, flags: CreatureFlags.RANGED_ATTACK_VARIANT, aiMode: CreatureAiMode.CHASE_PLAYER, orbitAngle: 0.4, rangedProjectileType: 26 })],
  [SpawnId.SPIDER_SP1_CONST_WHITE_FAST_3E, new ConstantSpawnSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 1000.0, moveSpeed: 2.8, rewardValue: 500.0, tint: [1.0, 1.0, 1.0, 1.0], size: 64.0, contactDamage: 40.0 })],
  [SpawnId.SPIDER_SP1_CONST_BROWN_SMALL_3F, new ConstantSpawnSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 200.0, moveSpeed: 2.3, rewardValue: 210.0, tint: [0.7, 0.4, 0.1, 1.0], size: 35.0, contactDamage: 20.0 })],
  [SpawnId.SPIDER_SP1_CONST_BLUE_40, new ConstantSpawnSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 70.0, moveSpeed: 2.2, rewardValue: 160.0, tint: [0.5, 0.6, 0.9, 1.0], size: 45.0, contactDamage: 5.0 })],
  [SpawnId.ZOMBIE_CONST_GREY_42, new ConstantSpawnSpec({ typeId: CreatureTypeId.ZOMBIE, health: 200.0, moveSpeed: 1.7, rewardValue: 160.0, tint: [0.9, 0.9, 0.9, 1.0], size: 45.0, contactDamage: 15.0 })],
  [SpawnId.ZOMBIE_CONST_GREEN_BRUTE_43, new ConstantSpawnSpec({ typeId: CreatureTypeId.ZOMBIE, health: 2000.0, moveSpeed: 2.1, rewardValue: 460.0, tint: [0.2, 0.6, 0.1, 1.0], size: 70.0, contactDamage: 15.0 })],
]);
const GRID_FORMATIONS: Map<SpawnId, GridFormationSpec> = new Map([
  [SpawnId.FORMATION_GRID_ALIEN_GREEN_14, new GridFormationSpec({ parent: new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 1500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [0.7, 0.8, 0.31, 1.0], size: 50.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }), childAiMode: CreatureAiMode.FOLLOW_LINK_TETHERED, childSpec: new FormationChildSpec({ typeId: CreatureTypeId.ALIEN, health: 40.0, moveSpeed: 2.0, rewardValue: 60.0, size: 50.0, contactDamage: 4.0, tint: [0.4, 0.7, 0.11, 1.0] }), xRange: Array.from({ length: Math.max(0, Math.ceil((-576 - 0) / -64)) }, (_, i) => 0 + i * -64), yRange: Array.from({ length: Math.max(0, Math.ceil((257 - 128) / 16)) }, (_, i) => 128 + i * 16), applyFallback: true })],
  [SpawnId.FORMATION_GRID_ALIEN_WHITE_15, new GridFormationSpec({ parent: new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 1500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [1.0, 1.0, 1.0, 1.0], size: 60.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }), childAiMode: CreatureAiMode.LINK_GUARD, childSpec: new FormationChildSpec({ typeId: CreatureTypeId.ALIEN, health: 40.0, moveSpeed: 2.0, rewardValue: 60.0, size: 50.0, contactDamage: 4.0, tint: [0.4, 0.7, 0.11, 1.0] }), xRange: Array.from({ length: Math.max(0, Math.ceil((-576 - 0) / -64)) }, (_, i) => 0 + i * -64), yRange: Array.from({ length: Math.max(0, Math.ceil((257 - 128) / 16)) }, (_, i) => 128 + i * 16), applyFallback: true })],
  [SpawnId.FORMATION_GRID_LIZARD_WHITE_16, new GridFormationSpec({ parent: new ConstantSpawnSpec({ typeId: CreatureTypeId.LIZARD, health: 1500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [1.0, 1.0, 1.0, 1.0], size: 64.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }), childAiMode: CreatureAiMode.LINK_GUARD, childSpec: new FormationChildSpec({ typeId: CreatureTypeId.LIZARD, health: 40.0, moveSpeed: 2.0, rewardValue: 60.0, size: 60.0, contactDamage: 4.0, tint: [0.4, 0.7, 0.11, 1.0] }), xRange: Array.from({ length: Math.max(0, Math.ceil((-576 - 0) / -64)) }, (_, i) => 0 + i * -64), yRange: Array.from({ length: Math.max(0, Math.ceil((257 - 128) / 16)) }, (_, i) => 128 + i * 16), applyFallback: true })],
  [SpawnId.FORMATION_GRID_SPIDER_SP1_WHITE_17, new GridFormationSpec({ parent: new ConstantSpawnSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 1500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [1.0, 1.0, 1.0, 1.0], size: 60.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }), childAiMode: CreatureAiMode.LINK_GUARD, childSpec: new FormationChildSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 40.0, moveSpeed: 2.0, rewardValue: 60.0, size: 50.0, contactDamage: 4.0, tint: [0.4, 0.7, 0.11, 1.0] }), xRange: Array.from({ length: Math.max(0, Math.ceil((-576 - 0) / -64)) }, (_, i) => 0 + i * -64), yRange: Array.from({ length: Math.max(0, Math.ceil((257 - 128) / 16)) }, (_, i) => 128 + i * 16), applyFallback: true })],
  [SpawnId.FORMATION_GRID_ALIEN_BRONZE_18, new GridFormationSpec({ parent: new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [0.7, 0.8, 0.31, 1.0], size: 40.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }), childAiMode: CreatureAiMode.FOLLOW_LINK, childSpec: new FormationChildSpec({ typeId: CreatureTypeId.ALIEN, health: 260.0, moveSpeed: 3.8, rewardValue: 60.0, size: 50.0, contactDamage: 35.0, tint: [0.7125, 0.4125, 0.2775, 0.6] }), xRange: Array.from({ length: Math.max(0, Math.ceil((-576 - 0) / -64)) }, (_, i) => 0 + i * -64), yRange: Array.from({ length: Math.max(0, Math.ceil((257 - 128) / 16)) }, (_, i) => 128 + i * 16) })],
]);
const RING_FORMATIONS: Map<SpawnId, RingFormationSpec> = new Map([
  [SpawnId.FORMATION_RING_ALIEN_8_12, new RingFormationSpec({ parent: new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 200.0, moveSpeed: 2.2, rewardValue: 600.0, tint: [0.65, 0.85, 0.97, 1.0], size: 55.0, contactDamage: 14.0 }), childAiMode: CreatureAiMode.FOLLOW_LINK, childSpec: new FormationChildSpec({ typeId: CreatureTypeId.ALIEN, health: 40.0, moveSpeed: 2.4, rewardValue: 60.0, size: 50.0, contactDamage: 4.0, tint: [0.32, 0.588, 0.426, 1.0] }), count: 8, angleStep: Math.PI / 4.0, radius: 100.0 })],
  [SpawnId.FORMATION_RING_ALIEN_5_19, new RingFormationSpec({ parent: new ConstantSpawnSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 3.8, rewardValue: 300.0, tint: [0.95, 0.55, 0.37, 1.0], size: 55.0, contactDamage: 40.0 }), childAiMode: CreatureAiMode.FOLLOW_LINK_TETHERED, childSpec: new FormationChildSpec({ typeId: CreatureTypeId.ALIEN, health: 220.0, moveSpeed: 3.8, rewardValue: 60.0, size: 50.0, contactDamage: 35.0, tint: [0.7125, 0.4125, 0.2775, 0.6] }), count: 5, angleStep: (Math.PI * 2.0) / 5.0, radius: 110.0, setPosition: true })],
]);

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

// Raised when a spawn template id is outside the supported rewrite coverage.
export class UnsupportedSpawnTemplateError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'UnsupportedSpawnTemplateError';
  }
}


export function spawnIdLabel(spawnId: SpawnId): string {
  const entry = SPAWN_ID_TO_TEMPLATE.get(spawnId) ?? null;
  if (entry === null || entry.creature === null) {
    return 'unknown';
  }
  return entry.creature;
}

function addSpawnSlot(spawnSlots: SpawnSlotInit[], opts: { ownerCreature: number; timer: number; limit: number; interval: number; childTemplateId: SpawnId }): number {
  const ownerCreature = opts.ownerCreature;
  const timer = opts.timer;
  const limit = opts.limit;
  const interval = opts.interval;
  const childTemplateId = opts.childTemplateId;
  const slotIdx = spawnSlots.length;
  spawnSlots.push(new SpawnSlotInit({ ownerCreature: ownerCreature, timer: timer, count: 0, limit: limit, interval: interval, childTemplateId: childTemplateId }));
  return slotIdx;
}

function applyConstantTemplate(c: CreatureInit, spec: ConstantSpawnSpec): void {
  c.typeId = spec.typeId;
  c.flags = spec.flags;
  c.aiMode = spec.aiMode;
  c.health = spec.health;
  c.moveSpeed = spec.moveSpeed;
  c.rewardValue = spec.rewardValue;
  applyTint(c, spec.tint);
  c.size = spec.size;
  c.contactDamage = spec.contactDamage;
  if (spec.orbitAngle !== null) {
    c.orbitAngle = spec.orbitAngle;
  }
  if (spec.orbitRadius !== null) {
    c.orbitRadius = spec.orbitRadius;
  }
  if (spec.rangedProjectileType !== null) {
    c.rangedProjectileType = spec.rangedProjectileType;
  }
  if (spec.bonusId !== null) {
    c.bonusId = spec.bonusId;
  }
  if (spec.bonusDurationOverride !== null) {
    c.bonusDurationOverride = spec.bonusDurationOverride;
  }
}

function applyTint(c: CreatureInit, tint: TintRGBA): void {
  c.tint = tint;
}

export function resolveTint(tint: Tint | null): TintRGBA {
  // Resolve a partial/optional tint into concrete RGBA multipliers.
  if (tint === null) {
    return [1.0, 1.0, 1.0, 1.0];
  }
  const [tintR, tintG, tintB, tintA] = tint;
  return [tintR === null ? 1.0 : tintR, tintG === null ? 1.0 : tintG, tintB === null ? 1.0 : tintB, tintA === null ? 1.0 : tintA];
}

function applyChildSpec(child: CreatureInit, spec: FormationChildSpec): void {
  child.typeId = spec.typeId;
  child.health = spec.health;
  child.maxHealth = spec.maxHealth !== null ? spec.maxHealth : spec.health;
  child.moveSpeed = spec.moveSpeed;
  child.rewardValue = spec.rewardValue;
  child.size = spec.size;
  child.contactDamage = spec.contactDamage;
  applyTint(child, spec.tint);
  if (spec.orbitAngle !== null) {
    child.orbitAngle = spec.orbitAngle;
  }
  if (spec.orbitRadius !== null) {
    child.orbitRadius = spec.orbitRadius;
  }
}

function applySizeHealthReward(c: CreatureInit, size: number, opts: { healthScale: number; healthAdd: number; rewardAdd?: number }): void {
  const healthScale = opts.healthScale;
  const healthAdd = opts.healthAdd;
  const rewardAdd = opts.rewardAdd ?? 50.0;
  c.size = size;
  c.health = size * healthScale + healthAdd;
  c.rewardValue = size + size + rewardAdd;
}

function applySizeHealth(c: CreatureInit, size: number, opts: { healthScale: number; healthAdd: number }): void {
  const healthScale = opts.healthScale;
  const healthAdd = opts.healthAdd;
  c.size = size;
  c.health = size * healthScale + healthAdd;
}

function applySizeMoveSpeed(c: CreatureInit, size: number, scale: number, base: number): void {
  c.moveSpeed = size * scale + base;
}

function spawnRingChildren(creatures: CreatureInit[], templateId: SpawnId, pos: Vec2, rng: CrandLike, opts: { count: number; angleStep: number; radius: number; aiMode: number; childSpec: FormationChildSpec; linkParent?: number; setPosition?: boolean; headingOverride?: number | null }): number {
  const count = opts.count;
  const angleStep = opts.angleStep;
  const radius = opts.radius;
  const aiMode = opts.aiMode;
  const childSpec = opts.childSpec;
  const linkParent = opts.linkParent ?? 0;
  const setPosition = opts.setPosition ?? false;
  const headingOverride = opts.headingOverride ?? null;
  let lastIdx = -1;
  for (let i = 0; i < count; i++) {
    const child = allocCreature(templateId, pos, rng);
    child.aiMode = aiMode;
    child.aiLinkParent = linkParent;
    const angle = i * angleStep;
    // Keep template authoring math simple here; runtime init quantizes
    // `target_offset`/`pos` through float32 (`CreaturePool._apply_init`).
    child.targetOffset = Vec2.fromAngle(angle).mul(radius);
    if (setPosition) {
      child.pos = pos.add((child.targetOffset || new Vec2()));
    }
    if (headingOverride !== null) {
      child.heading = headingOverride;
    }
    applyChildSpec(child, childSpec);
    creatures.push(child);
    lastIdx = creatures.length - 1;
  }
  return lastIdx;
}

function spawnGridChildren(creatures: CreatureInit[], templateId: SpawnId, pos: Vec2, rng: CrandLike, opts: { xRange: Iterable<number>; yRange: Iterable<number>; aiMode: number; childSpec: FormationChildSpec; linkParent?: number }): number {
  const xRange = opts.xRange;
  const yRange = opts.yRange;
  const aiMode = opts.aiMode;
  const childSpec = opts.childSpec;
  const linkParent = opts.linkParent ?? 0;
  let lastIdx = -1;
  for (const xOffset of xRange) {
    for (const yOffset of yRange) {
      const child = allocCreature(templateId, pos, rng);
      child.aiMode = aiMode;
      child.aiLinkParent = linkParent;
      child.targetOffset = new Vec2(xOffset, yOffset);
      child.pos = new Vec2(pos.x + xOffset, pos.y + yOffset);
      applyChildSpec(child, childSpec);
      creatures.push(child);
      lastIdx = creatures.length - 1;
    }
  }
  return lastIdx;
}

function spawnChainChildren(creatures: CreatureInit[], templateId: SpawnId, pos: Vec2, rng: CrandLike, opts: { count: number; aiMode: number; childSpec: FormationChildSpec; setupChild: (arg0: CreatureInit, arg1: number) => void; linkParentStart?: number }): number {
  const count = opts.count;
  const aiMode = opts.aiMode;
  const childSpec = opts.childSpec;
  const setupChild = opts.setupChild;
  const linkParentStart = opts.linkParentStart ?? 0;
  let chainPrev = linkParentStart;
  for (let idx = 0; idx < count; idx++) {
    const child = allocCreature(templateId, pos, rng);
    child.aiMode = aiMode;
    child.aiLinkParent = chainPrev;
    setupChild(child, idx);
    applyChildSpec(child, childSpec);
    creatures.push(child);
    chainPrev = creatures.length - 1;
  }
  return chainPrev;
}

function registerTemplate(...templateIds: SpawnId[]): (arg0: TemplateFn) => TemplateFn {
  const decorator = (fn: TemplateFn): TemplateFn => {
    for (const templateId of templateIds) {
      TEMPLATE_BUILDERS.set(templateId, fn);
    }
    return fn;
  };

  return decorator;
}

export function tickSpawnSlot(slot: SpawnSlotInit, frameDt: number): SpawnId | null {
  // Advance a spawn slot timer by `frame_dt`, returning a spawned template id if triggered.
  //
  // Modeled after `creature_update_all`'s spawn-slot tick:
  //   timer -= dt
  //   if timer < 0:
  //     timer += interval
  //     if count < limit:
  //       count += 1
  //       spawn child_template_id
  //
  // Note: the original only adds `interval` once (no loop), so large dt can keep the timer negative.
  let timer = f32(slot.timer);
  const interval = f32(slot.interval);
  const dt = f32(frameDt);
  timer = f32(timer - dt);
  slot.timer = timer;
  if (slot.timer < 0.0) {
    slot.timer = f32(slot.timer + interval);
    if (slot.count < slot.limit) {
      slot.count += 1;
      return slot.childTemplateId;
    }
  }
  return null;
}

function allocCreature(templateId: number, pos: Vec2, rng: CrandLike): CreatureInit {
  // creature_alloc_slot():
  // - clears flags
  // - seeds phase_seed = float(crt_rand() & 0x17f)
  const phaseSeed = rng.rand({ caller: RngCallerStatic.CREATURE_ALLOC_SLOT_PHASE_SEED }) & 0x17F;
  // Native `creature_alloc_slot` does not clear heading; some template child paths
  // intentionally keep stale heading from the recycled slot.
  return new CreatureInit({ originTemplateId: templateId, pos: pos, heading: null, phaseSeed: phaseSeed });
}

function clamp01(value: number): number {
  if (value < 0.0) {
    return 0.0;
  }
  if (1.0 < value) {
    return 1.0;
  }
  return value;
}

export function buildSurvivalSpawnCreature(pos: Vec2, rng: CrandLike, opts: { playerExperience: number }): CreatureInit {
  // Pure model of `survival_spawn_creature` (crimsonland.exe 0x00407510).
  //
  // Note: this is not a `creature_spawn_template` spawn id; it picks a `type_id` and stats
  // dynamically based on `player_experience`.
  const playerExperience = opts.playerExperience;
  const xp = int(playerExperience);

  const c = allocCreature(-1, pos, rng);
  c.aiMode = CreatureAiMode.ORBIT_PLAYER;

  const r10 = rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_TYPE_ROLL }) % 10;

  let typeId: number;
  if (xp < 12000) {
    typeId = r10 < 9 ? 2 : 3;
  } else if (xp < 25000) {
    typeId = r10 < 4 ? 0 : 3;
    if (8 < r10) {
      typeId = 2;
    }
  } else if (xp < 42000) {
    if (r10 < 5) {
      typeId = 2;
    } else {
      // Decompiled as a sign-bit trick, but in practice this is a parity pick.
      typeId = (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_PARITY_PICK }) & 1) + 3;
    }
  } else if (xp < 50000) {
    typeId = 2;
  } else if (xp < 90000) {
    typeId = 4;
  } else {
    if (109999 < xp) {
      if (r10 < 6) {
        typeId = 2;
      } else if (r10 < 9) {
        typeId = 4;
      } else {
        typeId = 0;
      }
    } else {
      typeId = 0;
    }
  }

  // Rare override: forces spider_sp1 when (rand() & 0x1f) == 2.
  if ((rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_RARE_OVERRIDE }) & 0x1F) === 2) {
    typeId = 3;
  }

  c.typeId = typeId;

  // size = rand() % 20 + 44
  c.size = (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_SIZE }) % 20 + 44);

  // heading = (rand() % 314) * 0.01
  c.heading = f32(f32(rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_HEADING }) % 314) * f32(0.01));

  // Native computes in float32; preserve rounding so derived speeds match capture.
  let moveSpeed = f32(f32(f32(Math.floor(xp / 4000)) * f32(0.045)) + f32(0.9));
  if (c.typeId === CreatureTypeId.SPIDER_SP1) {
    c.flags |= CreatureFlags.AI7_LINK_TIMER;
    moveSpeed = f32(f32(moveSpeed) * f32(1.3));
  }

  const rHealth = rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_HEALTH });
  const healthScaled = f32(f32(xp) * f32(0.00125));
  const healthRand = f32(rHealth & 0xF);
  let health = f32(f32(healthScaled + healthRand) + f32(52.0));

  if (c.typeId === CreatureTypeId.ZOMBIE) {
    moveSpeed = f32(f32(moveSpeed) * f32(0.6));
    if (moveSpeed < 1.3) {
      moveSpeed = f32(1.3);
    }
    health = f32(f32(health) * f32(1.5));
  }

  if (moveSpeed > 3.5) {
    moveSpeed = f32(3.5);
  }

  c.moveSpeed = moveSpeed;
  c.health = health;
  c.rewardValue = 0.0;

  // Tint based on player_experience thresholds.
  let tintA: number | any = 1.0;
  let tintR: any;
  let tintG: any;
  let tintB: number | any;
  if (xp < 50_000) {
    tintR = 1.0 - 1.0 / (Math.floor(xp / 1000) + 10.0);
    tintG = (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_LOW_TINT_G }) % 10 * 0.01 + 0.9 - 1.0 / (Math.floor(xp / 10000) + 10.0));
    tintB = rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_LOW_TINT_B }) % 10 * 0.01 + 0.7;
  } else if (xp < 100_000) {
    tintR = 0.9 - 1.0 / (Math.floor(xp / 1000) + 10.0);
    tintG = (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_MID_TINT_G }) % 10 * 0.01 + 0.8 - 1.0 / (Math.floor(xp / 10000) + 10.0));
    tintB = ((xp - 50_000) * 6e-06 + rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_MID_TINT_B }) % 10 * 0.01 + 0.7);
  } else {
    tintR = 1.0 - 1.0 / (Math.floor(xp / 1000) + 10.0);
    tintG = (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_HIGH_TINT_G }) % 10 * 0.01 + 0.9 - 1.0 / (Math.floor(xp / 10000) + 10.0));
    tintB = (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_HIGH_TINT_B }) % 10 * 0.01 + 1.0 - (xp - 100_000) * 3e-06);
    if (tintB < 0.5) {
      tintB = 0.5;
    }
  }

  c.tint = [tintR, tintG, tintB, tintA];

  // contact_damage = size * 0.0952381
  c.contactDamage = (c.size || 0.0) * (2.0 / 21.0);

  // reward_value is always 0.0 at this point in the original.
  c.rewardValue = ((c.health || 0.0) * 0.4 + (c.contactDamage || 0.0) * 0.8 + moveSpeed * 5.0 + (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_REWARD_BONUS }) % 10 + 10));

  // Rare stat overrides (color-coded variants).
  let r = rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_RARE_RED });
  if (r % 180 < 2) {
    applyTint(c, [0.9, 0.4, 0.4, 1.0]);
    c.health = 65.0;
    c.rewardValue = 320.0;
  } else {
    r = rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_RARE_GREEN });
    if (r % 240 < 2) {
      applyTint(c, [0.4, 0.9, 0.4, 1.0]);
      c.health = 85.0;
      c.rewardValue = 420.0;
    } else {
      r = rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_RARE_BLUE });
      if (r % 360 < 2) {
        applyTint(c, [0.4, 0.4, 0.9, 1.0]);
        c.health = 125.0;
        c.rewardValue = 520.0;
      }
    }
  }

  // Rare health/size boosts (do not recompute contact_damage).
  r = rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_RARE_PURPLE });
  if (r % 1320 < 4) {
    applyTint(c, [0.84, 0.24, 0.89, 1.0]);
    c.size = 80.0;
    c.rewardValue = 600.0;
    c.health = (c.health || 0.0) + 230.0;
  } else {
    r = rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_RARE_YELLOW });
    if (r % 1620 < 4) {
      applyTint(c, [0.94, 0.84, 0.29, 1.0]);
      c.size = 85.0;
      c.rewardValue = 900.0;
      c.health = (c.health || 0.0) + 2230.0;
    }
  }

  if (c.health !== null) {
    c.maxHealth = c.health;
  }
  if (c.rewardValue !== null) {
    c.rewardValue *= 0.8;
  }

  if (c.tint !== null) {
    [tintR, tintG, tintB, tintA] = c.tint;
    c.tint = [tintR !== null ? clamp01(tintR) : null, tintG !== null ? clamp01(tintG) : null, tintB !== null ? clamp01(tintB) : null, tintA !== null ? clamp01(tintA) : null];
  }

  return c;
}

function randSurvivalSpawnPos(rng: CrandLike, opts: { terrainWidth: number; terrainHeight: number; callers: SurvivalSpawnPosCallers }): Vec2 {
  const terrainWidth = opts.terrainWidth;
  const terrainHeight = opts.terrainHeight;
  const callers = opts.callers;
  switch (rng.rand({ caller: callers.edge }) & 3) {
    case 0:
      return new Vec2(rng.rand({ caller: callers.topX }) % terrainWidth, -40.0);
    case 1:
      return new Vec2(rng.rand({ caller: callers.bottomX }) % terrainWidth, terrainHeight + 40.0);
    case 2:
      return new Vec2(-40.0, rng.rand({ caller: callers.leftY }) % terrainHeight);
    default:
      return new Vec2(terrainWidth + 40.0, rng.rand({ caller: callers.rightY }) % terrainHeight);
  }
}

export function tickSurvivalWaveSpawns(spawnCooldown: number, frameDtMs: number, rng: CrandLike, opts: { playerCount: number; survivalElapsedMs: number; playerExperience: number; terrainWidth: number; terrainHeight: number }): [number, CreatureInit[]] {
  // Advance survival enemy wave spawning, returning updated cooldown + spawned creatures.
  //
  // Modeled after `survival_update` (crimsonland.exe 0x00407cd0) wave spawns:
  //   spawn_cooldown -= player_count * frame_dt_ms
  //   while spawn_cooldown < 0:
  //     interval_ms = 500 - int(survival_elapsed_ms) / 1800
  //     if interval_ms < 0:
  //       extra = (1 - interval_ms) >> 1
  //       interval_ms += extra * 2
  //       spawn `extra` creatures at random edges
  //     interval_ms = max(1, interval_ms)
  //     spawn_cooldown += interval_ms
  //     spawn 1 creature at a random edge
  const playerCount = opts.playerCount;
  const survivalElapsedMs = opts.survivalElapsedMs;
  const playerExperience = opts.playerExperience;
  const terrainWidth = opts.terrainWidth;
  const terrainHeight = opts.terrainHeight;
  let cooldown = f32(f32(spawnCooldown) - f32(f32(playerCount) * f32(frameDtMs)));
  if (cooldown >= 0.0) {
    return [cooldown, []];
  }

  const spawns: CreatureInit[] = [];
  while (cooldown < 0.0) {
    let intervalMs = 500 - Math.floor(int(f32(survivalElapsedMs)) / 1800);
    let pos: Vec2;
    if (intervalMs < 0) {
      const extra = Math.floor((1 - intervalMs) / (2 ** 1));
      intervalMs += int(extra) * 2;
      for (let i = 0; i < int(extra); i++) {
        pos = randSurvivalSpawnPos(rng, { terrainWidth: terrainWidth, terrainHeight: terrainHeight, callers: SURVIVAL_UPDATE_EXTRA_SPAWN_POS_CALLERS });
        spawns.push(buildSurvivalSpawnCreature(pos, rng, { playerExperience: playerExperience }));
      }
    }

    if (intervalMs < 1) {
      intervalMs = 1;
    }
    cooldown = f32(cooldown + f32(intervalMs));

    pos = randSurvivalSpawnPos(rng, { terrainWidth: terrainWidth, terrainHeight: terrainHeight, callers: SURVIVAL_UPDATE_MAIN_SPAWN_POS_CALLERS });
    spawns.push(buildSurvivalSpawnCreature(pos, rng, { playerExperience: playerExperience }));
  }

  return [cooldown, Array.from(spawns)];
}

export function advanceSurvivalSpawnStage(stage: number, opts: { playerLevel: number }): [number, SpawnTemplateCall[]] {
  // Return scripted survival spawns for the current stage (aka `survival_update` milestones).
  //
  // Modeled after `survival_update` (crimsonland.exe 0x00407cd0) stage 0..10 gate checks.
  const playerLevel = opts.playerLevel;
  stage = int(stage);
  const level = int(playerLevel);

  const spawns: SpawnTemplateCall[] = [];
  const heading = Math.PI;

  while (true) {
    if (stage === 0) {
      if (level < 5) {
        break;
      }
      stage = 1;
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.FORMATION_RING_ALIEN_8_12, pos: new Vec2(-164.0, 512.0), heading: heading }));
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.FORMATION_RING_ALIEN_8_12, pos: new Vec2(1188.0, 512.0), heading: heading }));
      continue;
    }

    if (stage === 1) {
      if (level < 9) {
        break;
      }
      stage = 2;
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_RED_BOSS_2C, pos: new Vec2(1088.0, 512.0), heading: heading }));
      continue;
    }

    if (stage === 2) {
      if (level < 11) {
        break;
      }
      stage = 3;
      const step = f32(42.666668);
      for (let i = 0; i < 12; i++) {
        spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP2_RANDOM_35, pos: new Vec2(1088.0, f32(f32(i) * f32(step) + f32(256.0))), heading: heading }));
      }
      continue;
    }

    if (stage === 3) {
      if (level < 13) {
        break;
      }
      stage = 4;
      for (let i = 0; i < 4; i++) {
        spawns.push(new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_RED_FAST_2B, pos: new Vec2(1088.0, i * 64.0 + 384.0), heading: heading }));
      }
      continue;
    }

    if (stage === 4) {
      if (level < 15) {
        break;
      }
      stage = 5;
      for (let i = 0; i < 4; i++) {
        spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_AI7_TIMER_38, pos: new Vec2(1088.0, i * 64.0 + 384.0), heading: heading }));
      }
      for (let i = 0; i < 4; i++) {
        spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_AI7_TIMER_38, pos: new Vec2(-64.0, i * 64.0 + 384.0), heading: heading }));
      }
      continue;
    }

    if (stage === 5) {
      if (level < 17) {
        break;
      }
      stage = 6;
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, pos: new Vec2(1088.0, 512.0), heading: heading }));
      continue;
    }

    if (stage === 6) {
      if (level < 19) {
        break;
      }
      stage = 7;
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP2_SPLITTER_01, pos: new Vec2(640.0, 512.0), heading: heading }));
      continue;
    }

    if (stage === 7) {
      if (level < 21) {
        break;
      }
      stage = 8;
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP2_SPLITTER_01, pos: new Vec2(384.0, 256.0), heading: heading }));
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP2_SPLITTER_01, pos: new Vec2(640.0, 768.0), heading: heading }));
      continue;
    }

    if (stage === 8) {
      if (level < 26) {
        break;
      }
      stage = 9;
      for (let i = 0; i < 4; i++) {
        spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, pos: new Vec2(1088.0, i * 64.0 + 384.0), heading: heading }));
      }
      for (let i = 0; i < 4; i++) {
        spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, pos: new Vec2(-64.0, i * 64.0 + 384.0), heading: heading }));
      }
      continue;
    }

    if (stage === 9) {
      if (level <= 31) {
        break;
      }
      stage = 10;
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, pos: new Vec2(1088.0, 512.0), heading: heading }));
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, pos: new Vec2(-64.0, 512.0), heading: heading }));
      for (let i = 0; i < 4; i++) {
        spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, pos: new Vec2(i * 64.0 + 384.0, -64.0), heading: heading }));
      }
      for (let i = 0; i < 4; i++) {
        spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, pos: new Vec2(i * 64.0 + 384.0, 1088.0), heading: heading }));
      }
      continue;
    }

    break;
  }

  return [stage, Array.from(spawns)];
}

export function buildRushModeSpawnCreature(pos: Vec2, tintRgba: TintRGBA, rng: CrandLike, opts: { typeId: number; survivalElapsedMs: number }): CreatureInit {
  // Pure model of `creature_spawn` (0x00428240) as used by `rush_mode_update` (0x004072b0).
  const typeId = opts.typeId;
  const survivalElapsedMs = opts.survivalElapsedMs;
  const elapsedMs = int(survivalElapsedMs);

  const c = allocCreature(-1, pos, rng);
  c.typeId = typeId;
  c.aiMode = CreatureAiMode.ORBIT_PLAYER;

  const elapsedF32 = f32(elapsedMs);
  c.health = f32(elapsedF32 * f32(1e-4) + 10.0);
  c.heading = f32(f32(rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_HEADING }) % 314) * f32(0.01));
  c.moveSpeed = f32(elapsedF32 * f32(1e-5) + 2.5);
  c.rewardValue = (rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_REWARD }) % 30 + 140);

  c.tint = tintRgba;
  c.contactDamage = 4.0;

  if (c.health !== null) {
    c.maxHealth = c.health;
  }
  c.size = f32(elapsedF32 * f32(1e-5) + 47.0);

  return c;
}

export function tickRushModeSpawns(spawnCooldown: number, frameDtMs: number, rng: CrandLike, opts: { playerCount: number; survivalElapsedMs: number; terrainWidth: number; terrainHeight: number }): [number, CreatureInit[]] {
  // Advance rush-mode edge wave spawning (pure model of `rush_mode_update` / 0x004072b0).
  const playerCount = opts.playerCount;
  const survivalElapsedMs = opts.survivalElapsedMs;
  const terrainWidth = opts.terrainWidth;
  const terrainHeight = opts.terrainHeight;
  let cooldown = f32(f32(spawnCooldown) - f32(f32(playerCount) * f32(frameDtMs)));

  const spawns: CreatureInit[] = [];
  while (cooldown < 0.0) {
    cooldown = f32(cooldown + 250.0);

    const t = f32(int(survivalElapsedMs + 1.0));
    const tintR = clamp01(f32(t * f32(1.0 / 120000.0) + 0.3));
    const tintG = clamp01(f32(t * 10000.0 + 0.3));
    const tintB = clamp01(f32(Math.sin(f32(t * f32(1e-4))) + 0.3));
    const tintA = 1.0;
    const tint: [number, number, number, number] = [tintR, tintG, tintB, tintA];

    const elapsedMs = int(survivalElapsedMs);
    const theta = f32(f32(elapsedMs) * f32(0.001));
    const terrainWidthF = f32(terrainWidth);
    const terrainHeightF = f32(terrainHeight);
    const spawnRight = new Vec2(f32(terrainWidthF + 64.0), f32(terrainHeightF * 0.5 + Math.cos(theta) * 256.0));
    const spawnLeft = new Vec2(-64.0, f32(terrainHeightF * 0.5 + Math.sin(theta) * 256.0));

    let c = buildRushModeSpawnCreature(spawnRight, tint, rng, { typeId: 2, survivalElapsedMs: elapsedMs });
    c.aiMode = CreatureAiMode.ORBIT_PLAYER_WIDE;
    spawns.push(c);

    c = buildRushModeSpawnCreature(spawnLeft, tint, rng, { typeId: 3, survivalElapsedMs: elapsedMs });
    c.aiMode = CreatureAiMode.ORBIT_PLAYER_WIDE;
    c.flags |= CreatureFlags.AI7_LINK_TIMER;
    if (c.moveSpeed !== null) {
      c.moveSpeed = f32(c.moveSpeed * 1.4);
    }
    spawns.push(c);
  }

  return [cooldown, Array.from(spawns)];
}

export function buildTutorialStage3FireSpawns(): SpawnTemplateCall[] {
  // Spawn pack triggered by the stage-3 fire-key transition in `tutorial_timeline_update` (0x00408990).
  const heading = Math.PI;
  return [new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_GREEN_24, pos: new Vec2(-164.0, 412.0), heading: heading }), new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_PALE_GREEN_26, pos: new Vec2(-184.0, 512.0), heading: heading }), new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_GREEN_24, pos: new Vec2(-154.0, 612.0), heading: heading })];
}

export function buildTutorialStage4ClearSpawns(): SpawnTemplateCall[] {
  // Spawn pack triggered by the stage-4 "all clear" transition in `tutorial_timeline_update` (0x00408990).
  const heading = Math.PI;
  return [new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_GREEN_24, pos: new Vec2(1188.0, 412.0), heading: heading }), new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_PALE_GREEN_26, pos: new Vec2(1208.0, 512.0), heading: heading }), new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_GREEN_24, pos: new Vec2(1178.0, 612.0), heading: heading })];
}

export function buildTutorialStage5RepeatSpawns(repeatSpawnCount: number): SpawnTemplateCall[] {
  // Spawn packs triggered by the stage-5 repeat loop in `tutorial_timeline_update` (0x00408990).
  //
  // `repeat_spawn_count` is the incremented counter value (1..7). When it reaches 8, the tutorial
  // transitions instead of spawning more creatures.
  //
  // Note: the original also stores the returned creature pointer from template `0x27` in
  // `tutorial_hint_bonus_ptr` and rewrites its packed bonus args (`link_index` low/high 16-bit fields)
  // depending on `repeat_spawn_count`. This helper only reproduces the `creature_spawn_template` calls.
  const n = int(repeatSpawnCount);
  if (n < 1 || 8 <= n) {
    return [];
  }

  const heading = Math.PI;
  const spawns: SpawnTemplateCall[] = [];

  if ((n & 1) === 0) {
    // Even: right-side spawn pack (with an off-screen bottom-right spawn).
    if (n < 6) {
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_WEAPON_BONUS_27, pos: new Vec2(1056.0, 1056.0), heading: heading }));
    }
    spawns.push(new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_GREEN_24, pos: new Vec2(1188.0, 1136.0), heading: heading }));
    spawns.push(new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_PALE_GREEN_26, pos: new Vec2(1208.0, 512.0), heading: heading }));
    spawns.push(new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_GREEN_24, pos: new Vec2(1178.0, 612.0), heading: heading }));
    if (n === 4) {
      spawns.push(new SpawnTemplateCall({ templateId: SpawnId.SPIDER_SP1_CONST_BLUE_40, pos: new Vec2(512.0, 1056.0), heading: heading }));
    }
    return Array.from(spawns);
  }

  // Odd: left-side spawn pack.
  if (n < 6) {
    spawns.push(new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_WEAPON_BONUS_27, pos: new Vec2(-32.0, 1056.0), heading: heading }));
  }
  spawns.push(...buildTutorialStage3FireSpawns());
  return Array.from(spawns);
}

export function buildTutorialStage6PerksDoneSpawns(): SpawnTemplateCall[] {
  // Spawn pack triggered by the stage-6 "no perks pending" transition in `tutorial_timeline_update` (0x00408990).
  const heading = Math.PI;
  return [...buildTutorialStage3FireSpawns(), new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_PURPLE_28, pos: new Vec2(-32.0, -32.0), heading: heading }), ...buildTutorialStage4ClearSpawns()];
}

function applyTail(templateId: SpawnId, planCreatures: CreatureInit[], planSpawnSlots: SpawnSlotInit[], planEffects: BurstEffect[], primaryIdx: number, finalHeading: number, env: SpawnEnv): void {
  const c = planCreatures[primaryIdx];

  // Demo-burst effect (skipped when demo_mode_active != 0).
  if (!env.demoModeActive && 0.0 < c.pos.x && c.pos.x < env.terrainWidth && 0.0 < c.pos.y && c.pos.y < env.terrainHeight) {
    planEffects.push(new BurstEffect({ pos: c.pos, count: 8 }));
  }

  if (c.health !== null) {
    c.maxHealth = c.health;
  }

  // Spider_sp1 "AI7 timer" auto-enable (applies to the *return* creature).
  if (c.typeId === CreatureTypeId.SPIDER_SP1 && !(c.flags & CreatureFlags.RANGED_ATTACK_SHOCK | CreatureFlags.AI7_LINK_TIMER)) {
    c.flags |= CreatureFlags.AI7_LINK_TIMER;
    c.aiLinkParent = null;
    c.spawnSlot = null;
    c.aiTimer = 0;
    if (c.moveSpeed !== null) {
      c.moveSpeed *= 1.2;
    }
  }

  // Hardcore tweak for template 0x38 only.
  if (templateId === SpawnId.SPIDER_SP1_AI7_TIMER_38 && env.hardcore && c.moveSpeed !== null) {
    c.moveSpeed *= 0.7;
  }

  c.heading = finalHeading;

  // Quest fail retry count modifiers.
  const slotIdx = c.spawnSlot;
  const hasSpawnSlot = slotIdx !== null && slotIdx >= 0 && slotIdx < planSpawnSlots.length;

  if (!env.hardcore) {
    // This is written as a short-circuit expression in the original:
    // for flag 0x4 creatures, always bump their spawn-slot interval by +0.2 in non-hardcore.
    if ((c.flags & HAS_SPAWN_SLOT_FLAG) && hasSpawnSlot && slotIdx !== null) {
      planSpawnSlots[slotIdx].interval += 0.2;
    }

    if (env.questFailRetryCount > 0) {
      const d = env.questFailRetryCount;
      if (c.rewardValue !== null && c.moveSpeed !== null && c.contactDamage !== null && c.health !== null) {
        if (d === 1) {
          c.rewardValue *= 0.9;
          c.moveSpeed *= 0.95;
          c.contactDamage *= 0.95;
          c.health *= 0.95;
        } else if (d === 2) {
          c.rewardValue *= 0.85;
          c.moveSpeed *= 0.9;
          c.contactDamage *= 0.9;
          c.health *= 0.9;
        } else if (d === 3) {
          c.rewardValue *= 0.85;
          c.moveSpeed *= 0.8;
          c.contactDamage *= 0.8;
          c.health *= 0.8;
        } else if (d === 4) {
          c.rewardValue *= 0.8;
          c.moveSpeed *= 0.7;
          c.contactDamage *= 0.7;
          c.health *= 0.7;
        } else {
          c.rewardValue *= 0.8;
          c.moveSpeed *= 0.6;
          c.contactDamage *= 0.5;
          c.health *= 0.5;
        }
      }

      if (hasSpawnSlot && (c.flags & HAS_SPAWN_SLOT_FLAG) && slotIdx !== null) {
        planSpawnSlots[slotIdx].interval += Math.min(3.0, d * 0.35);
      }
    }
  } else {
    // In hardcore: quest fail retry count is forcibly cleared (global), and creature stats are buffed.
    if (c.moveSpeed !== null) {
      c.moveSpeed *= 1.05;
    }
    if (c.contactDamage !== null) {
      c.contactDamage *= 1.4;
    }
    if (c.health !== null) {
      c.health *= 1.2;
    }

    if (hasSpawnSlot && (c.flags & HAS_SPAWN_SLOT_FLAG) && slotIdx !== null) {
      planSpawnSlots[slotIdx].interval = Math.max(0.1, planSpawnSlots[slotIdx].interval - 0.2);
    }
  }
}

function applyUnhandledCreatureTypeFallback(planCreatures: CreatureInit[], primaryIdx: number): void {
  // Some template paths jump to the "Unhandled creatureType.\n" debug block in the original,
  // which forcibly overwrites `type_id` and `health` on the *current* creature pointer.
  // See artifacts/creature_spawn_template/binja-hlil.txt (label_431099).
  // Notably: several grid/ring templates in the late formation switch ladder
  // (e.g. 0x11, 0x13..0x17) reach LAB_00431094.
  const c = planCreatures[primaryIdx];
  c.typeId = CreatureTypeId.ALIEN;
  c.health = 20.0;
}

function applyAlienSpawner(ctx: PlanBuilder, spec: AlienSpawnerSpec): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  c.flags = CreatureFlags.ANIM_PING_PONG;
  c.spawnSlot = ctx.addSlot({ owner: 0, timer: spec.timer, limit: spec.limit, interval: spec.interval, child: spec.childTemplateId });
  c.size = spec.size;
  c.health = spec.health;
  c.moveSpeed = spec.moveSpeed;
  c.rewardValue = spec.rewardValue;
  applyTint(c, spec.tint);
  c.contactDamage = 0.0;
}

function applyConstantSpawn(ctx: PlanBuilder, spec: ConstantSpawnSpec): void {
  const c = ctx.base;
  applyConstantTemplate(c, spec);
}

function applyGridFormation(ctx: PlanBuilder, spec: GridFormationSpec): void {
  const parent = ctx.base;
  applyConstantTemplate(parent, spec.parent);
  if (spec.setParentMaxHealth && parent.health !== null) {
    parent.maxHealth = parent.health;
  }
  ctx.primary = ctx.gridChildren({ xRange: spec.xRange, yRange: spec.yRange, aiMode: spec.childAiMode, childSpec: spec.childSpec });
  if (spec.applyFallback) {
    applyUnhandledCreatureTypeFallback(ctx.creatures, ctx.primary);
  }
}

function applyRingFormation(ctx: PlanBuilder, spec: RingFormationSpec): void {
  const parent = ctx.base;
  applyConstantTemplate(parent, spec.parent);
  if (spec.setParentMaxHealth && parent.health !== null) {
    parent.maxHealth = parent.health;
  }
  ctx.primary = ctx.ringChildren({ count: spec.count, angleStep: spec.angleStep, radius: spec.radius, aiMode: spec.childAiMode, childSpec: spec.childSpec, setPosition: spec.setPosition });
  if (spec.applyFallback) {
    applyUnhandledCreatureTypeFallback(ctx.creatures, ctx.primary);
  }
}

const template00ZombieBossSpawner = registerTemplate(SpawnId.ZOMBIE_BOSS_SPAWNER_00)(function template00ZombieBossSpawner(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ZOMBIE;
  c.flags = CreatureFlags.ANIM_PING_PONG | CreatureFlags.ANIM_LONG_STRIP;
  c.spawnSlot = ctx.addSlot({ owner: 0, timer: 1.0, limit: 812, interval: 0.7, child: SpawnId.ZOMBIE_RANDOM_41 });
  c.size = 64.0;
  c.health = 8500.0;
  c.moveSpeed = 1.3;
  c.rewardValue = 6600.0;
  applyTint(c, [0.6, 0.6, 1.0, 0.8]);
  c.contactDamage = 50.0;
});

const template03_05_06BasicRandom = registerTemplate(SpawnId.SPIDER_SP1_RANDOM_03, SpawnId.SPIDER_SP2_RANDOM_05, SpawnId.ALIEN_RANDOM_06)(function template03_05_06BasicRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = mapGetOrThrow(BASIC_RANDOM_TYPE_IDS, ctx.templateId);
  const size = ctx.rng.rand({ caller: mapGetOrThrow(BASIC_RANDOM_SIZE_CALLERS, ctx.templateId) }) % 15 + 38.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = ctx.rng.rand({ caller: mapGetOrThrow(BASIC_RANDOM_MOVE_SPEED_CALLERS, ctx.templateId) }) % 18 * 0.1 + 1.1;
  const tintB = ctx.rng.rand({ caller: mapGetOrThrow(BASIC_RANDOM_TINT_B_CALLERS, ctx.templateId) }) % 25 * 0.01 + 0.8;
  applyTint(c, [0.6, 0.6, clamp01(tintB), 1.0]);
  c.contactDamage = ctx.rng.rand({ caller: mapGetOrThrow(BASIC_RANDOM_CONTACT_DAMAGE_CALLERS, ctx.templateId) }) % 10 + 4.0;
});

const template04LizardRandom = registerTemplate(SpawnId.LIZARD_RANDOM_04)(function template04LizardRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.LIZARD;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_04_SIZE }) % 15 + 38.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  applyTint(c, [0.67, 0.67, 1.0, 1.0]);
  c.moveSpeed = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_04_MOVE_SPEED }) % 18 * 0.1 + 1.1);
  c.contactDamage = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_04_CONTACT_DAMAGE }) % 10 + 4.0);
});

const template0eAlienSpawnerRing24 = registerTemplate(SpawnId.ALIEN_SPAWNER_RING_24_0E)(function template0eAlienSpawnerRing24(ctx: PlanBuilder): void {
  const parent = ctx.base;
  parent.typeId = CreatureTypeId.ALIEN;
  parent.flags = CreatureFlags.ANIM_PING_PONG;
  parent.spawnSlot = ctx.addSlot({ owner: 0, timer: 1.5, limit: 64, interval: 1.05, child: SpawnId.AI1_LIZARD_BLUE_TINT_1C });
  parent.size = 32.0;
  parent.health = 50.0;
  parent.moveSpeed = 2.8;
  parent.rewardValue = 5000.0;
  applyTint(parent, [0.9, 0.8, 0.4, 1.0]);
  parent.contactDamage = 0.0;

  const childSpec = new FormationChildSpec({ typeId: CreatureTypeId.ALIEN, health: 40.0, moveSpeed: 4.0, rewardValue: 350.0, size: 35.0, contactDamage: 30.0, tint: [1.0, 0.3, 0.3, 1.0] });
  ctx.primary = ctx.ringChildren({ count: 24, angleStep: Math.PI / 12.0, radius: 100.0, aiMode: CreatureAiMode.FOLLOW_LINK, childSpec: childSpec, headingOverride: 0.0 });
});

const template11FormationChainLizard4 = registerTemplate(SpawnId.FORMATION_CHAIN_LIZARD_4_11)(function template11FormationChainLizard4(ctx: PlanBuilder): void {
  const parent = ctx.base;
  parent.typeId = CreatureTypeId.LIZARD;
  parent.aiMode = CreatureAiMode.ORBIT_PLAYER_TIGHT;
  applyTint(parent, [0.99, 0.99, 0.21, 1.0]);
  parent.health = 1500.0;
  parent.maxHealth = 1500.0;
  parent.moveSpeed = 2.1;
  parent.rewardValue = 1000.0;
  parent.size = 69.0;
  parent.contactDamage = 150.0;

  // Spawns a linked chain of 4 children (link points to previous). The original also sets
  // the base creature's link_index to the last child after the loop.
  const childSpec = new FormationChildSpec({ typeId: CreatureTypeId.LIZARD, health: 60.0, moveSpeed: 2.4, rewardValue: 60.0, size: 50.0, contactDamage: 14.0, tint: [0.6, 0.6, 0.31, 1.0] });

  const setupChild = (child: CreatureInit, idx: number): void => {
    child.targetOffset = new Vec2(-256.0 + idx * 64.0, -256.0);
    const angle = (2 + idx * 2) * (Math.PI / 8.0);
    child.pos = Vec2.fromAngle(angle).mul(256.0).add(ctx.pos);
  };

  const chainPrev = ctx.chainChildren({ count: 4, aiMode: CreatureAiMode.FOLLOW_LINK, childSpec: childSpec, setupChild: setupChild });

  parent.aiLinkParent = chainPrev;
  ctx.primary = chainPrev;
  applyUnhandledCreatureTypeFallback(ctx.creatures, ctx.primary);
});

const template13FormationChainAlien10 = registerTemplate(SpawnId.FORMATION_CHAIN_ALIEN_10_13)(function template13FormationChainAlien10(ctx: PlanBuilder): void {
  const parent = ctx.base;
  parent.typeId = CreatureTypeId.ALIEN;
  parent.aiMode = CreatureAiMode.ORBIT_LINK;
  parent.pos = ctx.pos.offset({ dx: 256.0 });
  applyTint(parent, [0.6, 0.8, 0.91, 1.0]);
  parent.health = 200.0;
  parent.maxHealth = 200.0;
  parent.moveSpeed = 2.0;
  parent.rewardValue = 600.0;
  parent.size = 40.0;
  parent.contactDamage = 20.0;

  const childSpec = new FormationChildSpec({ typeId: CreatureTypeId.ALIEN, health: 60.0, moveSpeed: 2.0, rewardValue: 60.0, size: 50.0, contactDamage: 4.0, tint: [0.4, 0.7, 0.11, 1.0], orbitAngle: Math.PI, orbitRadius: 10.0 });

  const setupChild = (child: CreatureInit, idx: number): void => {
    const angleIdx = 2 + idx * 2;
    const angle = angleIdx * (20.0) * (Math.PI / 180.0);
    child.pos = Vec2.fromAngle(angle).mul(256.0).add(ctx.pos);
  };

  const chainPrev = ctx.chainChildren({ count: 10, aiMode: CreatureAiMode.ORBIT_LINK, childSpec: childSpec, setupChild: setupChild });

  parent.aiLinkParent = chainPrev;
  ctx.primary = chainPrev;
  applyUnhandledCreatureTypeFallback(ctx.creatures, ctx.primary);
});

const template1a1b1cAi1BlueTint = registerTemplate(SpawnId.AI1_ALIEN_BLUE_TINT_1A, SpawnId.AI1_SPIDER_SP1_BLUE_TINT_1B, SpawnId.AI1_LIZARD_BLUE_TINT_1C)(function template1a1b1cAi1BlueTint(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.aiMode = CreatureAiMode.ORBIT_PLAYER_TIGHT;
  c.size = 50.0;
  c.moveSpeed = 2.4;
  c.rewardValue = 125.0;

  [c.typeId, c.health] = mapGetOrThrow(AI1_BLUE_TINT_TEMPLATES, ctx.templateId);

  const tint = ctx.rng.rand({ caller: mapGetOrThrow(AI1_BLUE_TINT_CALLERS, ctx.templateId) }) % 40 * 0.01 + 0.5;
  applyTint(c, [tint, tint, 1.0, 1.0]);
  c.contactDamage = 5.0;
});

const template1dAlienRandom = registerTemplate(SpawnId.ALIEN_RANDOM_1D)(function template1dAlienRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_SIZE }) % 20 + 35.0;
  applySizeHealth(c, size, { healthScale: 8.0 / 7.0, healthAdd: 10.0 });
  c.moveSpeed = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_MOVE_SPEED }) % 15 * 0.1 + 1.1;
  c.rewardValue = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_REWARD }) % 100 + 50.0;
  applyTint(c, [ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_TINT_R }) % 50 * 0.001 + 0.6, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_TINT_G }) % 50 * 0.01 + 0.5, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_TINT_B }) % 50 * 0.001 + 0.6, 1.0]);
  c.contactDamage = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_CONTACT_DAMAGE }) % 10 + 4.0;
});

const template1eAlienRandom = registerTemplate(SpawnId.ALIEN_RANDOM_1E)(function template1eAlienRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_SIZE }) % 30 + 35.0;
  applySizeHealth(c, size, { healthScale: 16.0 / 7.0, healthAdd: 10.0 });
  c.moveSpeed = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_MOVE_SPEED }) % 17 * 0.1 + 1.5;
  c.rewardValue = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_REWARD }) % 200 + 50.0;
  applyTint(c, [ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_TINT_R }) % 50 * 0.001 + 0.6, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_TINT_G }) % 50 * 0.001 + 0.6, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_TINT_B }) % 50 * 0.01 + 0.5, 1.0]);
  c.contactDamage = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_CONTACT_DAMAGE }) % 30 + 4.0;
});

const template1fAlienRandom = registerTemplate(SpawnId.ALIEN_RANDOM_1F)(function template1fAlienRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_SIZE }) % 30 + 45.0;
  applySizeHealth(c, size, { healthScale: 26.0 / 7.0, healthAdd: 30.0 });
  c.moveSpeed = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_MOVE_SPEED }) % 21 * 0.1 + 1.6;
  c.rewardValue = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_REWARD }) % 200 + 80.0;
  applyTint(c, [ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_TINT_R }) % 50 * 0.01 + 0.5, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_TINT_G }) % 50 * 0.001 + 0.6, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_TINT_B }) % 50 * 0.001 + 0.6, 1.0]);
  c.contactDamage = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_CONTACT_DAMAGE }) % 35 + 8.0;
});

const template20AlienRandomGreen = registerTemplate(SpawnId.ALIEN_RANDOM_GREEN_20)(function template20AlienRandomGreen(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_GREEN_20_SIZE }) % 30 + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_GREEN_20_MOVE_SPEED }) % 18 * 0.1 + 1.1;
  const tintG = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_GREEN_20_TINT_G }) % 40 * 0.01 + 0.6);
  applyTint(c, [0.3, tintG, 0.3, 1.0]);
  c.contactDamage = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_GREEN_20_CONTACT_DAMAGE }) % 10 + 4.0;
});

const template2eLizardRandom = registerTemplate(SpawnId.LIZARD_RANDOM_2E)(function template2eLizardRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.LIZARD;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_SIZE }) % 30 + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_MOVE_SPEED }) % 18 * 0.1 + 1.1);
  applyTint(c, [ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_TINT_R }) % 40 * 0.01 + 0.6, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_TINT_G }) % 40 * 0.01 + 0.6, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_TINT_B }) % 40 * 0.01 + 0.6, 1.0]);
  c.contactDamage = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_CONTACT_DAMAGE }) % 10 + 4.0);
});

const template31LizardRandom = registerTemplate(SpawnId.LIZARD_RANDOM_31)(function template31LizardRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.LIZARD;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_31_SIZE }) % 30 + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 10.0 });
  c.moveSpeed = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_31_MOVE_SPEED }) % 18 * 0.1 + 1.1;
  const tint = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_31_TINT }) % 30 * 0.01 + 0.6;
  applyTint(c, [tint, tint, 0.38, 1.0]);
  c.contactDamage = size * 0.14 + 4.0;
});

const template32SpiderSp1Random = registerTemplate(SpawnId.SPIDER_SP1_RANDOM_32)(function template32SpiderSp1Random(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_32_SIZE }) % 25 + 40.0;
  applySizeHealthReward(c, size, { healthScale: 1.0, healthAdd: 10.0 });
  c.moveSpeed = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_32_MOVE_SPEED }) % 17 * 0.1 + 1.1;
  const tint = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_32_TINT }) % 40 * 0.01 + 0.6;
  applyTint(c, [tint, tint, tint, 1.0]);
  c.contactDamage = size * 0.14 + 4.0;
});

const template33SpiderSp1RandomRed = registerTemplate(SpawnId.SPIDER_SP1_RANDOM_RED_33)(function template33SpiderSp1RandomRed(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_RED_33_SIZE }) % 15 + 45.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_RED_33_MOVE_SPEED }) % 18 * 0.1 + 1.1;
  applyTint(c, [ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_RED_33_TINT_R }) % 40 * 0.01 + 0.6, 0.5, 0.5, 1.0]);
  c.contactDamage = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_RED_33_CONTACT_DAMAGE }) % 10 + 4.0;
});

const template34SpiderSp1RandomGreen = registerTemplate(SpawnId.SPIDER_SP1_RANDOM_GREEN_34)(function template34SpiderSp1RandomGreen(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_GREEN_34_SIZE }) % 20 + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_GREEN_34_MOVE_SPEED }) % 18 * 0.1 + 1.1;
  applyTint(c, [0.5, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_GREEN_34_TINT_G }) % 40 * 0.01 + 0.6, 0.5, 1.0]);
  c.contactDamage = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_GREEN_34_CONTACT_DAMAGE }) % 10 + 4.0;
});

const template35SpiderSp2Random = registerTemplate(SpawnId.SPIDER_SP2_RANDOM_35)(function template35SpiderSp2Random(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP2;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_35_SIZE }) % 10 + 30.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_35_MOVE_SPEED }) % 18 * 0.1 + 1.1;
  applyTint(c, [0.8, ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_35_TINT_G }) % 20 * 0.01 + 0.8, 0.8, 1.0]);
  c.contactDamage = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_35_CONTACT_DAMAGE }) % 10 + 4.0;
});

const template36AlienAi7Orbiter = registerTemplate(SpawnId.ALIEN_AI7_ORBITER_36)(function template36AlienAi7Orbiter(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  c.size = 50.0;
  c.aiMode = CreatureAiMode.HOLD_TIMER;
  c.orbitRadius = 1.5;
  c.health = 10.0;
  c.moveSpeed = 1.8;
  c.rewardValue = 150.0;
  const tintG = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_AI7_ORBITER_TINT_G }) % 5 * 0.01 + 0.65;
  applyTint(c, [0.65, tintG, 0.95, 1.0]);
  c.contactDamage = 40.0;
});

const template37SpiderSp2RangedVariant = registerTemplate(SpawnId.SPIDER_SP2_RANGED_VARIANT_37)(function template37SpiderSp2RangedVariant(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP2;
  c.flags = CreatureFlags.RANGED_ATTACK_VARIANT;
  c.health = 50.0;
  c.moveSpeed = 3.2;
  c.rewardValue = 433.0;
  applyTint(c, [1.0, 0.75, 0.1, 1.0]);
  c.size = ((ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANGED_VARIANT_37_SIZE }) & 3) + 41);
  c.contactDamage = 10.0;
});

const template38SpiderSp1Ai7Timer = registerTemplate(SpawnId.SPIDER_SP1_AI7_TIMER_38)(function template38SpiderSp1Ai7Timer(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  c.flags = CreatureFlags.AI7_LINK_TIMER;
  c.aiTimer = 0;
  c.health = 50.0;
  c.moveSpeed = 4.8;
  c.rewardValue = 433.0;
  applyTint(c, [1.0, 0.75, 0.1, 1.0]);
  c.size = ((ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_AI7_TIMER_38_SIZE }) & 3) + 41);
  c.contactDamage = 10.0;
});

const template39SpiderSp1Ai7TimerWeak = registerTemplate(SpawnId.SPIDER_SP1_AI7_TIMER_WEAK_39)(function template39SpiderSp1Ai7TimerWeak(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  c.flags = CreatureFlags.AI7_LINK_TIMER;
  c.aiTimer = 0;
  c.health = 4.0;
  c.moveSpeed = 4.8;
  c.rewardValue = 50.0;
  applyTint(c, [0.8, 0.65, 0.1, 1.0]);
  c.size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_AI7_TIMER_WEAK_39_SIZE }) % 4 + 26);
  c.contactDamage = 10.0;
});

const template3dSpiderSp1Random = registerTemplate(SpawnId.SPIDER_SP1_RANDOM_3D)(function template3dSpiderSp1Random(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  c.health = 70.0;
  c.moveSpeed = 2.6;
  c.rewardValue = 120.0;
  const tint = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_3D_TINT }) % 20 * 0.01 + 0.8;
  applyTint(c, [tint, tint, tint, 1.0]);
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_3D_SIZE }) % 7 + 45);
  c.size = size;
  c.contactDamage = size * 0.22;
});

const template41ZombieRandom = registerTemplate(SpawnId.ZOMBIE_RANDOM_41)(function template41ZombieRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ZOMBIE;
  const size = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ZOMBIE_RANDOM_41_SIZE }) % 30 + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 10.0 });
  applySizeMoveSpeed(c, size, 0.0025, 0.9);
  const tint = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ZOMBIE_RANDOM_41_TINT }) % 40 * 0.01 + 0.6;
  applyTint(c, [tint, tint, tint, 1.0]);
  c.contactDamage = ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ZOMBIE_RANDOM_41_CONTACT_DAMAGE }) % 10 + 4.0;
});

export function buildSpawnPlan(templateId: SpawnId, pos: Vec2, heading: number, rng: CrandLike, env: SpawnEnv): SpawnPlan {
  // Pure plan builder modeled after `creature_spawn_template` (0x00430AF0).
  //
  // The plan lists:
  //   - every creature allocated and configured directly by the template
  //   - any spawn-slot configurations (deferred child spawns)
  //   - side-effects like burst FX
  const [ctx, finalHeading] = PlanBuilder.start(templateId, pos, heading, rng, env);

  let builder: any = null;
  let spec: any = null;
  if ((builder = TEMPLATE_BUILDERS.get(templateId) ?? null)) {
    builder(ctx);
  } else if ((spec = ALIEN_SPAWNER_TEMPLATES.get(templateId) ?? null)) {
    applyAlienSpawner(ctx, spec);
  } else if ((spec = GRID_FORMATIONS.get(templateId) ?? null)) {
    applyGridFormation(ctx, spec);
  } else if ((spec = RING_FORMATIONS.get(templateId) ?? null)) {
    applyRingFormation(ctx, spec);
  } else if ((spec = CONSTANT_SPAWN_TEMPLATES.get(templateId) ?? null)) {
    applyConstantSpawn(ctx, spec);
  } else {
    throw new UnsupportedSpawnTemplateError(`unsupported spawn template id: 0x${int(templateId)}`);
  }

  return ctx.finish(finalHeading);
}

const TEMPLATE_BUILDERS: Map<SpawnId, TemplateFn> = new Map();
const SURVIVAL_UPDATE_EXTRA_SPAWN_POS_CALLERS = new SurvivalSpawnPosCallers({
  edge: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_EDGE,
  topX: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_TOP_X,
  bottomX: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_BOTTOM_X,
  leftY: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_LEFT_Y,
  rightY: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_RIGHT_Y,
});
const SURVIVAL_UPDATE_MAIN_SPAWN_POS_CALLERS = new SurvivalSpawnPosCallers({
  edge: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_EDGE,
  topX: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_TOP_X,
  bottomX: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_BOTTOM_X,
  leftY: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_LEFT_Y,
  rightY: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_RIGHT_Y,
});
const BASIC_RANDOM_TYPE_IDS: Map<SpawnId, CreatureTypeId> = new Map([
  [SpawnId.SPIDER_SP1_RANDOM_03, CreatureTypeId.SPIDER_SP1],
  [SpawnId.SPIDER_SP2_RANDOM_05, CreatureTypeId.SPIDER_SP2],
  [SpawnId.ALIEN_RANDOM_06, CreatureTypeId.ALIEN],
]);
const BASIC_RANDOM_SIZE_CALLERS: Map<SpawnId, RngCallerStatic> = new Map([
  [SpawnId.SPIDER_SP1_RANDOM_03, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_03_SIZE],
  [SpawnId.SPIDER_SP2_RANDOM_05, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_05_SIZE],
  [SpawnId.ALIEN_RANDOM_06, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_06_SIZE],
]);
const BASIC_RANDOM_MOVE_SPEED_CALLERS: Map<SpawnId, RngCallerStatic> = new Map([
  [SpawnId.SPIDER_SP1_RANDOM_03, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_03_MOVE_SPEED],
  [SpawnId.SPIDER_SP2_RANDOM_05, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_05_MOVE_SPEED],
  [SpawnId.ALIEN_RANDOM_06, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_06_MOVE_SPEED],
]);
const BASIC_RANDOM_TINT_B_CALLERS: Map<SpawnId, RngCallerStatic> = new Map([
  [SpawnId.SPIDER_SP1_RANDOM_03, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_03_TINT_B],
  [SpawnId.SPIDER_SP2_RANDOM_05, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_05_TINT_B],
  [SpawnId.ALIEN_RANDOM_06, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_06_TINT_B],
]);
const BASIC_RANDOM_CONTACT_DAMAGE_CALLERS: Map<SpawnId, RngCallerStatic> = new Map([
  [SpawnId.SPIDER_SP1_RANDOM_03, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_03_CONTACT_DAMAGE],
  [SpawnId.SPIDER_SP2_RANDOM_05, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_05_CONTACT_DAMAGE],
  [SpawnId.ALIEN_RANDOM_06, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_06_CONTACT_DAMAGE],
]);
const AI1_BLUE_TINT_TEMPLATES: Map<SpawnId, [CreatureTypeId, number]> = new Map([
  [SpawnId.AI1_ALIEN_BLUE_TINT_1A, [CreatureTypeId.ALIEN, 50.0]],
  [SpawnId.AI1_SPIDER_SP1_BLUE_TINT_1B, [CreatureTypeId.SPIDER_SP1, 40.0]],
  [SpawnId.AI1_LIZARD_BLUE_TINT_1C, [CreatureTypeId.LIZARD, 50.0]],
]);
const AI1_BLUE_TINT_CALLERS: Map<SpawnId, RngCallerStatic> = new Map([
  [SpawnId.AI1_ALIEN_BLUE_TINT_1A, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_AI1_BLUE_TINT_1A],
  [SpawnId.AI1_SPIDER_SP1_BLUE_TINT_1B, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_AI1_BLUE_TINT_1B],
  [SpawnId.AI1_LIZARD_BLUE_TINT_1C, RngCallerStatic.CREATURE_SPAWN_TEMPLATE_AI1_BLUE_TINT_1C],
]);
