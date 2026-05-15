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
import { CrandLike } from '@grim/rand.ts';
import { BonusId } from '@crimson/bonuses/ids.ts';
import { f32 } from '@crimson/math-parity.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { HAS_SPAWN_SLOT_FLAG, RANDOM_HEADING_SENTINEL, CreatureAiMode, CreatureFlags, CreatureTypeId, SpawnId, type Tint, type TintRGBA } from './spawn-ids.ts';
import { SPAWN_ID_TO_TEMPLATE, SPAWN_TEMPLATES, TYPE_ID_TO_NAME, type SpawnTemplate } from './spawn-templates.ts';

export { CreatureAiMode, CreatureFlags, CreatureTypeId, HAS_SPAWN_SLOT_FLAG, RANDOM_HEADING_SENTINEL, SPAWN_ID_TO_TEMPLATE, SPAWN_TEMPLATES, SpawnId, TYPE_ID_TO_NAME, type SpawnTemplate };


class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValueError';
  }
}


export class UnsupportedSpawnTemplateError extends ValueError {
  // Raised when a spawn template id is outside the supported rewrite coverage.

  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSpawnTemplateError';
  }
}


type AlienSpawnerSpecInit = {
  timer: number;
  limit: number;
  interval: number;
  childTemplateId: SpawnId;
  size: number;
  health: number;
  moveSpeed: number;
  rewardValue: number;
  tint: TintRGBA;
};

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

  constructor(opts: AlienSpawnerSpecInit) {
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


export const ALIEN_SPAWNER_TEMPLATES: Map<SpawnId, AlienSpawnerSpec> = new Map(
  ([
  [SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, {
    timer: 1.0,
    limit: 100,
    interval: 2.2,
    childTemplateId: SpawnId.ALIEN_RANDOM_1D,
    size: 50.0,
    health: 1000.0,
    moveSpeed: 2.0,
    rewardValue: 3000.0,
    tint: [1.0, 1.0, 1.0, 1.0],
  }],
  [SpawnId.ALIEN_SPAWNER_CHILD_1D_SLOW_08, {
    timer: 1.0,
    limit: 100,
    interval: 2.8,
    childTemplateId: SpawnId.ALIEN_RANDOM_1D,
    size: 50.0,
    health: 1000.0,
    moveSpeed: 2.0,
    rewardValue: 3000.0,
    tint: [1.0, 1.0, 1.0, 1.0],
  }],
  [SpawnId.ALIEN_SPAWNER_CHILD_1D_LIMITED_09, {
    timer: 1.0,
    limit: 16,
    interval: 2.0,
    childTemplateId: SpawnId.ALIEN_RANDOM_1D,
    size: 40.0,
    health: 450.0,
    moveSpeed: 2.0,
    rewardValue: 1000.0,
    tint: [1.0, 1.0, 1.0, 1.0],
  }],
  [SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, {
    timer: 2.0,
    limit: 100,
    interval: 5.0,
    childTemplateId: SpawnId.SPIDER_SP1_RANDOM_32,
    size: 55.0,
    health: 1000.0,
    moveSpeed: 1.5,
    rewardValue: 3000.0,
    tint: [0.8, 0.7, 0.4, 1.0],
  }],
  [SpawnId.ALIEN_SPAWNER_CHILD_3C_SLOW_0B, {
    timer: 2.0,
    limit: 100,
    interval: 6.0,
    childTemplateId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C,
    size: 65.0,
    health: 3500.0,
    moveSpeed: 1.5,
    rewardValue: 5000.0,
    tint: [0.9, 0.1, 0.1, 1.0],
  }],
  [SpawnId.ALIEN_SPAWNER_CHILD_31_FAST_0C, {
    timer: 1.5,
    limit: 100,
    interval: 2.0,
    childTemplateId: SpawnId.LIZARD_RANDOM_31,
    size: 32.0,
    health: 50.0,
    moveSpeed: 2.8,
    rewardValue: 1000.0,
    tint: [0.9, 0.8, 0.4, 1.0],
  }],
  [SpawnId.ALIEN_SPAWNER_CHILD_31_SLOW_0D, {
    timer: 2.0,
    limit: 100,
    interval: 6.0,
    childTemplateId: SpawnId.LIZARD_RANDOM_31,
    size: 32.0,
    health: 50.0,
    moveSpeed: 1.3,
    rewardValue: 1000.0,
    tint: [0.9, 0.8, 0.4, 1.0],
  }],
  [SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, {
    timer: 1.5,
    limit: 100,
    interval: 2.3,
    childTemplateId: SpawnId.SPIDER_SP1_RANDOM_32,
    size: 32.0,
    health: 50.0,
    moveSpeed: 2.8,
    rewardValue: 800.0,
    tint: [0.9, 0.8, 0.4, 1.0],
  }],
  ] satisfies readonly (readonly [SpawnId, AlienSpawnerSpecInit])[]).map(
    ([spawnId, spec]) => [spawnId, new AlienSpawnerSpec(spec)],
  ),
);


type ConstantSpawnSpecInit = {
  typeId: CreatureTypeId;
  health: number;
  moveSpeed: number;
  rewardValue: number;
  tint: TintRGBA;
  size: number;
  contactDamage: number;
  flags?: CreatureFlags;
  aiMode?: number;
  orbitAngle?: number | null;
  orbitRadius?: number | null;
  rangedProjectileType?: number | null;
  bonusId?: BonusId | null;
  bonusDurationOverride?: number | null;
};

export class ConstantSpawnSpec {
  readonly typeId: CreatureTypeId;
  readonly health: number;
  readonly moveSpeed: number;
  readonly rewardValue: number;
  readonly tint: TintRGBA;
  readonly size: number;
  readonly contactDamage: number;
  readonly flags: CreatureFlags;
  readonly aiMode: number;
  readonly orbitAngle: number | null;
  readonly orbitRadius: number | null;
  readonly rangedProjectileType: number | null;
  readonly bonusId: BonusId | null;
  readonly bonusDurationOverride: number | null;

  constructor(opts: ConstantSpawnSpecInit) {
    this.typeId = opts.typeId;
    this.health = opts.health;
    this.moveSpeed = opts.moveSpeed;
    this.rewardValue = opts.rewardValue;
    this.tint = opts.tint;
    this.size = opts.size;
    this.contactDamage = opts.contactDamage;
    this.flags = opts.flags ?? (0 as CreatureFlags);
    this.aiMode = opts.aiMode ?? CreatureAiMode.ORBIT_PLAYER;
    this.orbitAngle = opts.orbitAngle ?? null;
    this.orbitRadius = opts.orbitRadius ?? null;
    this.rangedProjectileType = opts.rangedProjectileType ?? null;
    this.bonusId = opts.bonusId ?? null;
    this.bonusDurationOverride = opts.bonusDurationOverride ?? null;
  }
}

function constSpec(opts: ConstantSpawnSpecInit): ConstantSpawnSpec {
  return new ConstantSpawnSpec(opts);
}


type FormationChildSpecInit = {
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
};

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

  constructor(opts: FormationChildSpecInit) {
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

function childSpec(opts: FormationChildSpecInit): FormationChildSpec {
  return new FormationChildSpec(opts);
}


type GridFormationSpecInit = {
  parent: ConstantSpawnSpec;
  childAiMode: number;
  childSpec: FormationChildSpec;
  xRange: readonly number[];
  yRange: readonly number[];
  applyFallback?: boolean;
  setParentMaxHealth?: boolean;
};

export class GridFormationSpec {
  readonly parent: ConstantSpawnSpec;
  readonly childAiMode: number;
  readonly childSpec: FormationChildSpec;
  readonly xRange: readonly number[];
  readonly yRange: readonly number[];
  readonly applyFallback: boolean;
  readonly setParentMaxHealth: boolean;

  constructor(opts: GridFormationSpecInit) {
    this.parent = opts.parent;
    this.childAiMode = opts.childAiMode;
    this.childSpec = opts.childSpec;
    this.xRange = opts.xRange;
    this.yRange = opts.yRange;
    this.applyFallback = opts.applyFallback ?? false;
    this.setParentMaxHealth = opts.setParentMaxHealth ?? true;
  }
}


type RingFormationSpecInit = {
  parent: ConstantSpawnSpec;
  childAiMode: number;
  childSpec: FormationChildSpec;
  count: number;
  angleStep: number;
  radius: number;
  applyFallback?: boolean;
  setPosition?: boolean;
  setParentMaxHealth?: boolean;
};

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

  constructor(opts: RingFormationSpecInit) {
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


function rangeArray(start: number, stop: number, step: number): number[] {
  const result: number[] = [];
  if (step > 0) {
    for (let i = start; i < stop; i += step) result.push(i);
  } else if (step < 0) {
    for (let i = start; i > stop; i += step) result.push(i);
  }
  return result;
}


export const CONSTANT_SPAWN_TEMPLATES: Map<SpawnId, ConstantSpawnSpec> = new Map([
  [SpawnId.SPIDER_SP2_SPLITTER_01, constSpec({ typeId: CreatureTypeId.SPIDER_SP2, health: 400.0, moveSpeed: 2.0, rewardValue: 1000.0, tint: [0.8, 0.7, 0.4, 1.0], size: 80.0, contactDamage: 17.0, flags: CreatureFlags.SPLIT_ON_DEATH })],
  [SpawnId.ALIEN_CONST_BROWN_TRANSPARENT_0F, constSpec({ typeId: CreatureTypeId.ALIEN, health: 20.0, moveSpeed: 2.9, rewardValue: 60.0, tint: [0.665, 0.385, 0.259, 0.56], size: 50.0, contactDamage: 35.0 })],
  [SpawnId.ALIEN_CONST_PURPLE_GHOST_21, constSpec({ typeId: CreatureTypeId.ALIEN, health: 53.0, moveSpeed: 1.7, rewardValue: 120.0, tint: [0.7, 0.1, 0.51, 0.5], size: 55.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_GREEN_GHOST_22, constSpec({ typeId: CreatureTypeId.ALIEN, health: 25.0, moveSpeed: 1.7, rewardValue: 150.0, tint: [0.1, 0.7, 0.51, 0.05], size: 50.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_GREEN_GHOST_SMALL_23, constSpec({ typeId: CreatureTypeId.ALIEN, health: 5.0, moveSpeed: 1.7, rewardValue: 180.0, tint: [0.1, 0.7, 0.51, 0.04], size: 45.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_GREEN_24, constSpec({ typeId: CreatureTypeId.ALIEN, health: 20.0, moveSpeed: 2.0, rewardValue: 110.0, tint: [0.1, 0.7, 0.11, 1.0], size: 50.0, contactDamage: 4.0 })],
  [SpawnId.ALIEN_CONST_GREEN_SMALL_25, constSpec({ typeId: CreatureTypeId.ALIEN, health: 25.0, moveSpeed: 2.5, rewardValue: 125.0, tint: [0.1, 0.8, 0.11, 1.0], size: 30.0, contactDamage: 3.0 })],
  [SpawnId.ALIEN_CONST_PALE_GREEN_26, constSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 2.2, rewardValue: 125.0, tint: [0.6, 0.8, 0.6, 1.0], size: 45.0, contactDamage: 10.0 })],
  [SpawnId.ALIEN_CONST_WEAPON_BONUS_27, constSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 2.1, rewardValue: 125.0, tint: [1.0, 0.8, 0.1, 1.0], size: 45.0, contactDamage: 10.0, flags: CreatureFlags.BONUS_ON_DEATH, bonusId: BonusId.WEAPON, bonusDurationOverride: 5 })],
  [SpawnId.ALIEN_CONST_PURPLE_28, constSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 1.7, rewardValue: 150.0, tint: [0.7, 0.1, 0.51, 1.0], size: 55.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_GREY_BRUTE_29, constSpec({ typeId: CreatureTypeId.ALIEN, health: 800.0, moveSpeed: 2.5, rewardValue: 450.0, tint: [0.8, 0.8, 0.8, 1.0], size: 70.0, contactDamage: 20.0 })],
  [SpawnId.ALIEN_CONST_GREY_FAST_2A, constSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 3.1, rewardValue: 300.0, tint: [0.3, 0.3, 0.3, 1.0], size: 60.0, contactDamage: 8.0 })],
  [SpawnId.ALIEN_CONST_RED_FAST_2B, constSpec({ typeId: CreatureTypeId.ALIEN, health: 30.0, moveSpeed: 3.6, rewardValue: 450.0, tint: [1.0, 0.3, 0.3, 1.0], size: 35.0, contactDamage: 20.0 })],
  [SpawnId.ALIEN_CONST_RED_BOSS_2C, constSpec({ typeId: CreatureTypeId.ALIEN, health: 3800.0, moveSpeed: 2.0, rewardValue: 1500.0, tint: [0.85, 0.2, 0.2, 1.0], size: 80.0, contactDamage: 40.0 })],
  [SpawnId.ALIEN_CONST_CYAN_AI2_2D, constSpec({ typeId: CreatureTypeId.ALIEN, health: 45.0, moveSpeed: 3.1, rewardValue: 200.0, tint: [0.0, 0.9, 0.8, 1.0], size: 38.0, contactDamage: 3.0, aiMode: CreatureAiMode.CHASE_PLAYER })],
  [SpawnId.LIZARD_CONST_GREY_2F, constSpec({ typeId: CreatureTypeId.LIZARD, health: 20.0, moveSpeed: 2.5, rewardValue: 150.0, tint: [0.8, 0.8, 0.8, 1.0], size: 45.0, contactDamage: 4.0 })],
  [SpawnId.LIZARD_CONST_YELLOW_BOSS_30, constSpec({ typeId: CreatureTypeId.LIZARD, health: 1000.0, moveSpeed: 2.0, rewardValue: 400.0, tint: [0.9, 0.8, 0.1, 1.0], size: 65.0, contactDamage: 10.0 })],
  [SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, constSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 4500.0, moveSpeed: 2.0, rewardValue: 4500.0, tint: [1.0, 1.0, 1.0, 1.0], size: 64.0, contactDamage: 50.0, flags: CreatureFlags.RANGED_ATTACK_SHOCK, orbitAngle: 0.9, rangedProjectileType: 9 })],
  [SpawnId.SPIDER_SP1_CONST_RED_BOSS_3B, constSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 1200.0, moveSpeed: 2.0, rewardValue: 4000.0, tint: [0.9, 0.0, 0.0, 1.0], size: 70.0, contactDamage: 20.0 })],
  [SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, constSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 200.0, moveSpeed: 2.0, rewardValue: 200.0, tint: [0.9, 0.1, 0.1, 1.0], size: 40.0, contactDamage: 20.0, flags: CreatureFlags.RANGED_ATTACK_VARIANT, aiMode: CreatureAiMode.CHASE_PLAYER, orbitAngle: 0.4, rangedProjectileType: 26 })],
  [SpawnId.SPIDER_SP1_CONST_WHITE_FAST_3E, constSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 1000.0, moveSpeed: 2.8, rewardValue: 500.0, tint: [1.0, 1.0, 1.0, 1.0], size: 64.0, contactDamage: 40.0 })],
  [SpawnId.SPIDER_SP1_CONST_BROWN_SMALL_3F, constSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 200.0, moveSpeed: 2.3, rewardValue: 210.0, tint: [0.7, 0.4, 0.1, 1.0], size: 35.0, contactDamage: 20.0 })],
  [SpawnId.SPIDER_SP1_CONST_BLUE_40, constSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 70.0, moveSpeed: 2.2, rewardValue: 160.0, tint: [0.5, 0.6, 0.9, 1.0], size: 45.0, contactDamage: 5.0 })],
  [SpawnId.ZOMBIE_CONST_GREY_42, constSpec({ typeId: CreatureTypeId.ZOMBIE, health: 200.0, moveSpeed: 1.7, rewardValue: 160.0, tint: [0.9, 0.9, 0.9, 1.0], size: 45.0, contactDamage: 15.0 })],
  [SpawnId.ZOMBIE_CONST_GREEN_BRUTE_43, constSpec({ typeId: CreatureTypeId.ZOMBIE, health: 2000.0, moveSpeed: 2.1, rewardValue: 460.0, tint: [0.2, 0.6, 0.1, 1.0], size: 70.0, contactDamage: 15.0 })],
]);


export const GRID_FORMATIONS: Map<SpawnId, GridFormationSpec> = new Map(
  ([
  [SpawnId.FORMATION_GRID_ALIEN_GREEN_14, {
    parent: constSpec({ typeId: CreatureTypeId.ALIEN, health: 1500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [0.7, 0.8, 0.31, 1.0], size: 50.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }),
    childAiMode: CreatureAiMode.FOLLOW_LINK_TETHERED,
    childSpec: childSpec({
      typeId: CreatureTypeId.ALIEN,
      health: 40.0,
      moveSpeed: 2.0,
      rewardValue: 60.0,
      size: 50.0,
      contactDamage: 4.0,
      tint: [0.4, 0.7, 0.11, 1.0],
    }),
    xRange: rangeArray(0, -576, -64),
    yRange: rangeArray(128, 257, 16),
    applyFallback: true,
    setParentMaxHealth: true,
  }],
  [SpawnId.FORMATION_GRID_ALIEN_WHITE_15, {
    parent: constSpec({ typeId: CreatureTypeId.ALIEN, health: 1500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [1.0, 1.0, 1.0, 1.0], size: 60.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }),
    childAiMode: CreatureAiMode.LINK_GUARD,
    childSpec: childSpec({
      typeId: CreatureTypeId.ALIEN,
      health: 40.0,
      moveSpeed: 2.0,
      rewardValue: 60.0,
      size: 50.0,
      contactDamage: 4.0,
      tint: [0.4, 0.7, 0.11, 1.0],
    }),
    xRange: rangeArray(0, -576, -64),
    yRange: rangeArray(128, 257, 16),
    applyFallback: true,
    setParentMaxHealth: true,
  }],
  [SpawnId.FORMATION_GRID_LIZARD_WHITE_16, {
    parent: constSpec({ typeId: CreatureTypeId.LIZARD, health: 1500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [1.0, 1.0, 1.0, 1.0], size: 64.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }),
    childAiMode: CreatureAiMode.LINK_GUARD,
    childSpec: childSpec({
      typeId: CreatureTypeId.LIZARD,
      health: 40.0,
      moveSpeed: 2.0,
      rewardValue: 60.0,
      size: 60.0,
      contactDamage: 4.0,
      tint: [0.4, 0.7, 0.11, 1.0],
    }),
    xRange: rangeArray(0, -576, -64),
    yRange: rangeArray(128, 257, 16),
    applyFallback: true,
    setParentMaxHealth: true,
  }],
  [SpawnId.FORMATION_GRID_SPIDER_SP1_WHITE_17, {
    parent: constSpec({ typeId: CreatureTypeId.SPIDER_SP1, health: 1500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [1.0, 1.0, 1.0, 1.0], size: 60.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }),
    childAiMode: CreatureAiMode.LINK_GUARD,
    childSpec: childSpec({
      typeId: CreatureTypeId.SPIDER_SP1,
      health: 40.0,
      moveSpeed: 2.0,
      rewardValue: 60.0,
      size: 50.0,
      contactDamage: 4.0,
      tint: [0.4, 0.7, 0.11, 1.0],
    }),
    xRange: rangeArray(0, -576, -64),
    yRange: rangeArray(128, 257, 16),
    applyFallback: true,
    setParentMaxHealth: true,
  }],
  [SpawnId.FORMATION_GRID_ALIEN_BRONZE_18, {
    parent: constSpec({ typeId: CreatureTypeId.ALIEN, health: 500.0, moveSpeed: 2.0, rewardValue: 600.0, tint: [0.7, 0.8, 0.31, 1.0], size: 40.0, contactDamage: 40.0, aiMode: CreatureAiMode.CHASE_PLAYER }),
    childAiMode: CreatureAiMode.FOLLOW_LINK,
    childSpec: childSpec({
      typeId: CreatureTypeId.ALIEN,
      health: 260.0,
      moveSpeed: 3.8,
      rewardValue: 60.0,
      size: 50.0,
      contactDamage: 35.0,
      tint: [0.7125, 0.4125, 0.2775, 0.6],
    }),
    xRange: rangeArray(0, -576, -64),
    yRange: rangeArray(128, 257, 16),
    applyFallback: false,
    setParentMaxHealth: true,
  }],
  ] satisfies readonly (readonly [SpawnId, GridFormationSpecInit])[]).map(
    ([spawnId, spec]) => [spawnId, new GridFormationSpec(spec)],
  ),
);


export const RING_FORMATIONS: Map<SpawnId, RingFormationSpec> = new Map(
  ([
  [SpawnId.FORMATION_RING_ALIEN_8_12, {
    parent: constSpec({ typeId: CreatureTypeId.ALIEN, health: 200.0, moveSpeed: 2.2, rewardValue: 600.0, tint: [0.65, 0.85, 0.97, 1.0], size: 55.0, contactDamage: 14.0 }),
    childAiMode: CreatureAiMode.FOLLOW_LINK,
    childSpec: childSpec({
      typeId: CreatureTypeId.ALIEN,
      health: 40.0,
      moveSpeed: 2.4,
      rewardValue: 60.0,
      size: 50.0,
      contactDamage: 4.0,
      tint: [0.32, 0.588, 0.426, 1.0],
    }),
    count: 8,
    angleStep: Math.PI / 4.0,
    radius: 100.0,
    applyFallback: false,
    setPosition: false,
    setParentMaxHealth: true,
  }],
  [SpawnId.FORMATION_RING_ALIEN_5_19, {
    parent: constSpec({ typeId: CreatureTypeId.ALIEN, health: 50.0, moveSpeed: 3.8, rewardValue: 300.0, tint: [0.95, 0.55, 0.37, 1.0], size: 55.0, contactDamage: 40.0 }),
    childAiMode: CreatureAiMode.FOLLOW_LINK_TETHERED,
    childSpec: childSpec({
      typeId: CreatureTypeId.ALIEN,
      health: 220.0,
      moveSpeed: 3.8,
      rewardValue: 60.0,
      size: 50.0,
      contactDamage: 35.0,
      tint: [0.7125, 0.4125, 0.2775, 0.6],
    }),
    count: 5,
    angleStep: Math.PI * 2.0 / 5.0,
    radius: 110.0,
    applyFallback: false,
    setPosition: true,
    setParentMaxHealth: true,
  }],
  ] satisfies readonly (readonly [SpawnId, RingFormationSpecInit])[]).map(
    ([spawnId, spec]) => [spawnId, new RingFormationSpec(spec)],
  ),
);


export function spawnIdLabel(spawnId: SpawnId): string {
  const entry = SPAWN_ID_TO_TEMPLATE.get(spawnId);
  if (entry === undefined || entry.creature === null) {
    return 'unknown';
  }
  return entry.creature;
}


type SpawnEnvInit = {
  terrainWidth: number;
  terrainHeight: number;
  demoModeActive: boolean;
  hardcore: boolean;
  questFailRetryCount: number;
};

export class SpawnEnv {
  readonly terrainWidth: number;
  readonly terrainHeight: number;
  readonly demoModeActive: boolean;
  readonly hardcore: boolean;
  readonly questFailRetryCount: number;

  constructor(opts: SpawnEnvInit) {
    this.terrainWidth = opts.terrainWidth;
    this.terrainHeight = opts.terrainHeight;
    this.demoModeActive = opts.demoModeActive;
    this.hardcore = opts.hardcore;
    this.questFailRetryCount = opts.questFailRetryCount;
  }
}


type BurstEffectInit = {
  pos: Vec2;
  count: number;
};

export class BurstEffect {
  readonly pos: Vec2;
  readonly count: number;

  constructor(opts: BurstEffectInit) {
    this.pos = opts.pos;
    this.count = opts.count;
  }
}


export class CreatureInit {
  // Template id that produced this creature (not necessarily unique per creature in formations).
  originTemplateId: number;
  pos: Vec2;
  // Heading is optional at plan-build time:
  // - `null` means "preserve stale slot heading" (native `creature_alloc_slot` behavior).
  // - explicit float means "set heading to this value".
  // The base template path writes heading explicitly at tail (`final_heading`).
  heading: number | null;
  phaseSeed: number;
  typeId: CreatureTypeId | null = null;
  flags: CreatureFlags = 0 as CreatureFlags;
  aiMode: number = CreatureAiMode.ORBIT_PLAYER;
  health: number | null = null;
  maxHealth: number | null = null;
  moveSpeed: number | null = null;
  rewardValue: number | null = null;
  size: number | null = null;
  contactDamage: number | null = null;
  tint: Tint | null = null;
  orbitAngle: number | null = null;
  orbitRadius: number | null = null;
  rangedProjectileType: number | null = null;
  // AI link semantics:
  // - For most formations (ai_mode 3/5/...), `aiLinkParent` references another creature index
  //   (typically the parent or previous element in the chain).
  // - For AI7 timer mode (flag 0x80), `aiTimer` is written into link_index.
  aiLinkParent: number | null = null;
  aiTimer: number | null = null;
  targetOffset: Vec2 | null = null;
  // Spawn slot reference (stored in link_index when flags include HAS_SPAWN_SLOT_FLAG).
  spawnSlot: number | null = null;
  // BONUS_ON_DEATH uses link_index low/high 16-bit fields for bonus spawn args.
  bonusId: BonusId | null = null;
  bonusDurationOverride: number | null = null;

  constructor(opts: {
    originTemplateId: number;
    pos: Vec2;
    heading: number | null;
    phaseSeed: number;
  }) {
    this.originTemplateId = opts.originTemplateId;
    this.pos = opts.pos;
    this.heading = opts.heading;
    this.phaseSeed = opts.phaseSeed;
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


type SpawnPlanInit = {
  creatures: readonly CreatureInit[];
  spawnSlots: readonly SpawnSlotInit[];
  effects: readonly BurstEffect[];
  primary: number;
};

export class SpawnPlan {
  readonly creatures: readonly CreatureInit[];
  readonly spawnSlots: readonly SpawnSlotInit[];
  readonly effects: readonly BurstEffect[];
  readonly primary: number;

  constructor(opts: SpawnPlanInit) {
    this.creatures = opts.creatures;
    this.spawnSlots = opts.spawnSlots;
    this.effects = opts.effects;
    this.primary = opts.primary;
  }
}


function addSpawnSlot(
  spawnSlots: SpawnSlotInit[],
  opts: {
    ownerCreature: number;
    timer: number;
    limit: number;
    interval: number;
    childTemplateId: SpawnId;
  },
): number {
  const slotIdx = spawnSlots.length;
  spawnSlots.push(new SpawnSlotInit({
    ownerCreature: opts.ownerCreature,
    timer: opts.timer,
    count: 0,
    limit: opts.limit,
    interval: opts.interval,
    childTemplateId: opts.childTemplateId,
  }));
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


// Resolve a partial/optional tint into concrete RGBA multipliers.
export function resolveTint(tint: Tint | null): TintRGBA {
  if (tint === null) {
    return [1.0, 1.0, 1.0, 1.0];
  }
  const [tintR, tintG, tintB, tintA] = tint;
  return [
    tintR === null ? 1.0 : tintR,
    tintG === null ? 1.0 : tintG,
    tintB === null ? 1.0 : tintB,
    tintA === null ? 1.0 : tintA,
  ];
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


function applySizeHealthReward(
  c: CreatureInit,
  size: number,
  opts: {
    healthScale: number;
    healthAdd: number;
    rewardAdd?: number;
  },
): void {
  const rewardAdd = opts.rewardAdd ?? 50.0;
  c.size = size;
  c.health = size * opts.healthScale + opts.healthAdd;
  c.rewardValue = size + size + rewardAdd;
}


function applySizeHealth(c: CreatureInit, size: number, opts: { healthScale: number; healthAdd: number }): void {
  c.size = size;
  c.health = size * opts.healthScale + opts.healthAdd;
}


function applySizeMoveSpeed(c: CreatureInit, size: number, scale: number, base: number): void {
  c.moveSpeed = size * scale + base;
}


function spawnRingChildren(
  creatures: CreatureInit[],
  templateId: SpawnId,
  pos: Vec2,
  rng: CrandLike,
  opts: {
    count: number;
    angleStep: number;
    radius: number;
    aiMode: number;
    childSpec: FormationChildSpec;
    linkParent?: number;
    setPosition?: boolean;
    headingOverride?: number | null;
  },
): number {
  const linkParent = opts.linkParent ?? 0;
  const setPosition = opts.setPosition ?? false;
  const headingOverride = opts.headingOverride ?? null;
  let lastIdx = -1;
  for (let i = 0; i < opts.count; i++) {
    const child = allocCreature(templateId, pos, rng);
    child.aiMode = opts.aiMode;
    child.aiLinkParent = linkParent;
    const angle = i * opts.angleStep;
    // Keep template authoring math simple here; runtime init quantizes
    // `target_offset`/`pos` through float32 (`CreaturePool._apply_init`).
    child.targetOffset = Vec2.fromAngle(angle).mul(opts.radius);
    if (setPosition) {
      child.pos = pos.add(child.targetOffset ?? new Vec2());
    }
    if (headingOverride !== null) {
      child.heading = headingOverride;
    }
    applyChildSpec(child, opts.childSpec);
    creatures.push(child);
    lastIdx = creatures.length - 1;
  }
  return lastIdx;
}


function spawnGridChildren(
  creatures: CreatureInit[],
  templateId: SpawnId,
  pos: Vec2,
  rng: CrandLike,
  opts: {
    xRange: readonly number[];
    yRange: readonly number[];
    aiMode: number;
    childSpec: FormationChildSpec;
    linkParent?: number;
  },
): number {
  const linkParent = opts.linkParent ?? 0;
  let lastIdx = -1;
  for (const xOffset of opts.xRange) {
    for (const yOffset of opts.yRange) {
      const child = allocCreature(templateId, pos, rng);
      child.aiMode = opts.aiMode;
      child.aiLinkParent = linkParent;
      child.targetOffset = new Vec2(xOffset, yOffset);
      child.pos = new Vec2(pos.x + xOffset, pos.y + yOffset);
      applyChildSpec(child, opts.childSpec);
      creatures.push(child);
      lastIdx = creatures.length - 1;
    }
  }
  return lastIdx;
}


function spawnChainChildren(
  creatures: CreatureInit[],
  templateId: SpawnId,
  pos: Vec2,
  rng: CrandLike,
  opts: {
    count: number;
    aiMode: number;
    childSpec: FormationChildSpec;
    setupChild: (child: CreatureInit, idx: number) => void;
    linkParentStart?: number;
  },
): number {
  const linkParentStart = opts.linkParentStart ?? 0;
  let chainPrev = linkParentStart;
  for (let idx = 0; idx < opts.count; idx++) {
    const child = allocCreature(templateId, pos, rng);
    child.aiMode = opts.aiMode;
    child.aiLinkParent = chainPrev;
    opts.setupChild(child, idx);
    applyChildSpec(child, opts.childSpec);
    creatures.push(child);
    chainPrev = creatures.length - 1;
  }
  return chainPrev;
}


class PlanBuilder {
  templateId: SpawnId;
  pos: Vec2;
  rng: CrandLike;
  env: SpawnEnv;
  creatures: CreatureInit[];
  spawnSlots: SpawnSlotInit[];
  effects: BurstEffect[];
  primary: number = 0;

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

  static start(
    templateId: SpawnId,
    pos: Vec2,
    heading: number,
    rng: CrandLike,
    env: SpawnEnv,
  ): [PlanBuilder, number] {
    // creature_alloc_slot() for the base creature.
    const creatures: CreatureInit[] = [allocCreature(templateId, pos, rng)];
    const spawnSlots: SpawnSlotInit[] = [];
    const effects: BurstEffect[] = [];

    // `heading == RANDOM_HEADING_SENTINEL` uses a randomized heading.
    let finalHeading = heading;
    if (finalHeading === RANDOM_HEADING_SENTINEL) {
      finalHeading = (rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_RANDOM_HEADING }) % 628) * 0.01;
    }

    // Base initialization always consumes one rand() for a transient heading value.
    creatures[0].heading = (rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_BASE_HEADING }) % 314) * 0.01;

    return [
      new PlanBuilder({ templateId, pos, rng, env, creatures, spawnSlots, effects, primary: 0 }),
      finalHeading,
    ];
  }

  get base(): CreatureInit {
    return this.creatures[0];
  }

  addSlot(opts: { owner: number; timer: number; limit: number; interval: number; child: SpawnId }): number {
    return addSpawnSlot(this.spawnSlots, { ownerCreature: opts.owner, timer: opts.timer, limit: opts.limit, interval: opts.interval, childTemplateId: opts.child });
  }

  ringChildren(
    opts: {
      count: number;
      angleStep: number;
      radius: number;
      aiMode: number;
      childSpec: FormationChildSpec;
      linkParent?: number;
      setPosition?: boolean;
      headingOverride?: number | null;
    },
  ): number {
    return spawnRingChildren(
      this.creatures, this.templateId, this.pos, this.rng,
      opts,
    );
  }

  gridChildren(
    opts: {
      xRange: readonly number[];
      yRange: readonly number[];
      aiMode: number;
      childSpec: FormationChildSpec;
      linkParent?: number;
    },
  ): number {
    return spawnGridChildren(
      this.creatures, this.templateId, this.pos, this.rng,
      opts,
    );
  }

  chainChildren(
    opts: {
      count: number;
      aiMode: number;
      childSpec: FormationChildSpec;
      setupChild: (child: CreatureInit, idx: number) => void;
      linkParentStart?: number;
    },
  ): number {
    return spawnChainChildren(
      this.creatures, this.templateId, this.pos, this.rng,
      opts,
    );
  }

  finish(finalHeading: number): SpawnPlan {
    applyTail(
      this.templateId,
      this.creatures,
      this.spawnSlots,
      this.effects,
      this.primary,
      finalHeading,
      this.env,
    );
    return new SpawnPlan({
      creatures: this.creatures.slice(),
      spawnSlots: this.spawnSlots.slice(),
      effects: this.effects.slice(),
      primary: this.primary,
    });
  }
}


type TemplateFn = (ctx: PlanBuilder) => void;
const TEMPLATE_BUILDERS: Map<SpawnId, TemplateFn> = new Map();

function registerTemplate(...templateIds: SpawnId[]): (fn: TemplateFn) => TemplateFn {
  return (fn: TemplateFn): TemplateFn => {
    for (const templateId of templateIds) {
      TEMPLATE_BUILDERS.set(templateId, fn);
    }
    return fn;
  };
}


// Advance a spawn slot timer by `frameDt`, returning a spawned template id if triggered.
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
export function tickSpawnSlot(slot: SpawnSlotInit, frameDt: number): SpawnId | null {
  const timer = f32(slot.timer);
  const interval = f32(slot.interval);
  const dt = f32(frameDt);
  const newTimer = f32(timer - dt);
  slot.timer = newTimer;
  if (slot.timer < 0.0) {
    slot.timer = f32(f32(slot.timer) + interval);
    if (slot.count < slot.limit) {
      slot.count += 1;
      return slot.childTemplateId;
    }
  }
  return null;
}


function allocCreature(
  templateId: number,
  pos: Vec2,
  rng: CrandLike,
): CreatureInit {
  // creature_alloc_slot():
  // - clears flags
  // - seeds phase_seed = float(crt_rand() & 0x17f)
  const phaseSeed = rng.rand({ caller: RngCallerStatic.CREATURE_ALLOC_SLOT_PHASE_SEED }) & 0x17F;
  // Native `creature_alloc_slot` does not clear heading; some template child paths
  // intentionally keep stale heading from the recycled slot.
  return new CreatureInit({ originTemplateId: templateId, pos, heading: null, phaseSeed });
}


function clamp01(value: number): number {
  if (value < 0.0) return 0.0;
  if (1.0 < value) return 1.0;
  return value;
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


export const SURVIVAL_UPDATE_EXTRA_SPAWN_POS_CALLERS = new SurvivalSpawnPosCallers({
  edge: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_EDGE,
  topX: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_TOP_X,
  bottomX: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_BOTTOM_X,
  leftY: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_LEFT_Y,
  rightY: RngCallerStatic.SURVIVAL_UPDATE_EXTRA_SPAWN_RIGHT_Y,
});

export const SURVIVAL_UPDATE_MAIN_SPAWN_POS_CALLERS = new SurvivalSpawnPosCallers({
  edge: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_EDGE,
  topX: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_TOP_X,
  bottomX: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_BOTTOM_X,
  leftY: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_LEFT_Y,
  rightY: RngCallerStatic.SURVIVAL_UPDATE_MAIN_SPAWN_RIGHT_Y,
});


// Pure model of `survival_spawn_creature` (crimsonland.exe 0x00407510).
//
// Note: this is not a `creature_spawn_template` spawn id; it picks a `type_id` and stats
// dynamically based on `playerExperience`.
export function buildSurvivalSpawnCreature(pos: Vec2, rng: CrandLike, opts: { playerExperience: number }): CreatureInit {
  const xp = int(opts.playerExperience);

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
    c.flags = c.flags | CreatureFlags.AI7_LINK_TIMER;
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
  let tintR: number;
  let tintG: number;
  let tintB: number;
  const tintA = 1.0;
  if (xp < 50_000) {
    tintR = 1.0 - 1.0 / (Math.floor(xp / 1000) + 10.0);
    tintG = (
      (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_LOW_TINT_G }) % 10) * 0.01
      + 0.9
      - 1.0 / (Math.floor(xp / 10000) + 10.0)
    );
    tintB = (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_LOW_TINT_B }) % 10) * 0.01 + 0.7;
  } else if (xp < 100_000) {
    tintR = 0.9 - 1.0 / (Math.floor(xp / 1000) + 10.0);
    tintG = (
      (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_MID_TINT_G }) % 10) * 0.01
      + 0.8
      - 1.0 / (Math.floor(xp / 10000) + 10.0)
    );
    tintB = (
      (xp - 50_000) * 6e-06
      + (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_MID_TINT_B }) % 10) * 0.01
      + 0.7
    );
  } else {
    tintR = 1.0 - 1.0 / (Math.floor(xp / 1000) + 10.0);
    tintG = (
      (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_HIGH_TINT_G }) % 10) * 0.01
      + 0.9
      - 1.0 / (Math.floor(xp / 10000) + 10.0)
    );
    tintB = (
      (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_HIGH_TINT_B }) % 10) * 0.01
      + 1.0
      - (xp - 100_000) * 3e-06
    );
    if (tintB < 0.5) {
      tintB = 0.5;
    }
  }

  c.tint = [tintR, tintG, tintB, tintA];

  // contact_damage = size * 0.0952381
  c.contactDamage = (c.size ?? 0.0) * (2.0 / 21.0);

  // reward_value is always 0.0 at this point in the original.
  c.rewardValue = (
    (c.health ?? 0.0) * 0.4
    + (c.contactDamage ?? 0.0) * 0.8
    + moveSpeed * 5.0
    + (rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_REWARD_BONUS }) % 10 + 10)
  );

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
    c.health = (c.health ?? 0.0) + 230.0;
  } else {
    r = rng.rand({ caller: RngCallerStatic.SURVIVAL_SPAWN_CREATURE_RARE_YELLOW });
    if (r % 1620 < 4) {
      applyTint(c, [0.94, 0.84, 0.29, 1.0]);
      c.size = 85.0;
      c.rewardValue = 900.0;
      c.health = (c.health ?? 0.0) + 2230.0;
    }
  }

  if (c.health !== null) {
    c.maxHealth = c.health;
  }
  if (c.rewardValue !== null) {
    c.rewardValue *= 0.8;
  }

  if (c.tint !== null) {
    const [tr, tg, tb, ta] = c.tint;
    c.tint = [
      tr !== null ? clamp01(tr) : null,
      tg !== null ? clamp01(tg) : null,
      tb !== null ? clamp01(tb) : null,
      ta !== null ? clamp01(ta) : null,
    ];
  }

  return c;
}


export function randSurvivalSpawnPos(
  rng: CrandLike,
  opts: {
    terrainWidth: number;
    terrainHeight: number;
    callers: SurvivalSpawnPosCallers;
  },
): Vec2 {
  switch (rng.rand({ caller: opts.callers.edge }) & 3) {
    case 0:
      return new Vec2(rng.rand({ caller: opts.callers.topX }) % opts.terrainWidth, -40.0);
    case 1:
      return new Vec2(rng.rand({ caller: opts.callers.bottomX }) % opts.terrainWidth, opts.terrainHeight + 40.0);
    case 2:
      return new Vec2(-40.0, rng.rand({ caller: opts.callers.leftY }) % opts.terrainHeight);
    default:
      return new Vec2(opts.terrainWidth + 40.0, rng.rand({ caller: opts.callers.rightY }) % opts.terrainHeight);
  }
}


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
export function tickSurvivalWaveSpawns(
  spawnCooldown: number,
  frameDtMs: number,
  rng: CrandLike,
  opts: {
    playerCount: number;
    survivalElapsedMs: number;
    playerExperience: number;
    terrainWidth: number;
    terrainHeight: number;
  },
): [number, CreatureInit[]] {
  let cooldown = f32(f32(spawnCooldown) - f32(f32(opts.playerCount) * f32(frameDtMs)));
  if (cooldown >= 0.0) {
    return [cooldown, []];
  }

  const spawns: CreatureInit[] = [];
  while (cooldown < 0.0) {
    let intervalMs = 500 - Math.floor(int(f32(opts.survivalElapsedMs)) / 1800);
    if (intervalMs < 0) {
      const extra = (1 - intervalMs) >> 1;
      intervalMs += int(extra) * 2;
      for (let i = 0; i < int(extra); i++) {
        const pos = randSurvivalSpawnPos(
          rng, { terrainWidth: opts.terrainWidth, terrainHeight: opts.terrainHeight, callers: SURVIVAL_UPDATE_EXTRA_SPAWN_POS_CALLERS },
        );
        spawns.push(buildSurvivalSpawnCreature(pos, rng, { playerExperience: opts.playerExperience }));
      }
    }

    if (intervalMs < 1) {
      intervalMs = 1;
    }
    cooldown = f32(cooldown + f32(intervalMs));

    const pos = randSurvivalSpawnPos(
      rng, { terrainWidth: opts.terrainWidth, terrainHeight: opts.terrainHeight, callers: SURVIVAL_UPDATE_MAIN_SPAWN_POS_CALLERS },
    );
    spawns.push(buildSurvivalSpawnCreature(pos, rng, { playerExperience: opts.playerExperience }));
  }

  return [cooldown, spawns];
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

function spawnCall(templateId: SpawnId, pos: Vec2, heading: number): SpawnTemplateCall {
  return new SpawnTemplateCall({ templateId, pos, heading });
}


// Return scripted survival spawns for the current stage (aka `survival_update` milestones).
//
// Modeled after `survival_update` (crimsonland.exe 0x00407cd0) stage 0..10 gate checks.
export function advanceSurvivalSpawnStage(stage: number, opts: { playerLevel: number }): [number, SpawnTemplateCall[]] {
  stage = int(stage);
  const level = int(opts.playerLevel);

  const spawns: SpawnTemplateCall[] = [];
  const heading = Math.PI;

  while (true) {
    if (stage === 0) {
      if (level < 5) break;
      stage = 1;
      spawns.push(spawnCall(SpawnId.FORMATION_RING_ALIEN_8_12, new Vec2(-164.0, 512.0), heading));
      spawns.push(spawnCall(SpawnId.FORMATION_RING_ALIEN_8_12, new Vec2(1188.0, 512.0), heading));
      continue;
    }

    if (stage === 1) {
      if (level < 9) break;
      stage = 2;
      spawns.push(spawnCall(SpawnId.ALIEN_CONST_RED_BOSS_2C, new Vec2(1088.0, 512.0), heading));
      continue;
    }

    if (stage === 2) {
      if (level < 11) break;
      stage = 3;
      const step = f32(42.666668);
      for (let i = 0; i < 12; i++) {
        spawns.push(spawnCall(
          SpawnId.SPIDER_SP2_RANDOM_35,
          new Vec2(1088.0, f32(f32(i) * f32(step) + f32(256.0))),
          heading,
        ));
      }
      continue;
    }

    if (stage === 3) {
      if (level < 13) break;
      stage = 4;
      for (let i = 0; i < 4; i++) {
        spawns.push(spawnCall(SpawnId.ALIEN_CONST_RED_FAST_2B, new Vec2(1088.0, i * 64.0 + 384.0), heading));
      }
      continue;
    }

    if (stage === 4) {
      if (level < 15) break;
      stage = 5;
      for (let i = 0; i < 4; i++) {
        spawns.push(spawnCall(SpawnId.SPIDER_SP1_AI7_TIMER_38, new Vec2(1088.0, i * 64.0 + 384.0), heading));
      }
      for (let i = 0; i < 4; i++) {
        spawns.push(spawnCall(SpawnId.SPIDER_SP1_AI7_TIMER_38, new Vec2(-64.0, i * 64.0 + 384.0), heading));
      }
      continue;
    }

    if (stage === 5) {
      if (level < 17) break;
      stage = 6;
      spawns.push(spawnCall(SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, new Vec2(1088.0, 512.0), heading));
      continue;
    }

    if (stage === 6) {
      if (level < 19) break;
      stage = 7;
      spawns.push(spawnCall(SpawnId.SPIDER_SP2_SPLITTER_01, new Vec2(640.0, 512.0), heading));
      continue;
    }

    if (stage === 7) {
      if (level < 21) break;
      stage = 8;
      spawns.push(spawnCall(SpawnId.SPIDER_SP2_SPLITTER_01, new Vec2(384.0, 256.0), heading));
      spawns.push(spawnCall(SpawnId.SPIDER_SP2_SPLITTER_01, new Vec2(640.0, 768.0), heading));
      continue;
    }

    if (stage === 8) {
      if (level < 26) break;
      stage = 9;
      for (let i = 0; i < 4; i++) {
        spawns.push(spawnCall(SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, new Vec2(1088.0, i * 64.0 + 384.0), heading));
      }
      for (let i = 0; i < 4; i++) {
        spawns.push(spawnCall(SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, new Vec2(-64.0, i * 64.0 + 384.0), heading));
      }
      continue;
    }

    if (stage === 9) {
      if (level <= 31) break;
      stage = 10;
      spawns.push(spawnCall(SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, new Vec2(1088.0, 512.0), heading));
      spawns.push(spawnCall(SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, new Vec2(-64.0, 512.0), heading));
      for (let i = 0; i < 4; i++) {
        spawns.push(spawnCall(SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, new Vec2(i * 64.0 + 384.0, -64.0), heading));
      }
      for (let i = 0; i < 4; i++) {
        spawns.push(spawnCall(SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, new Vec2(i * 64.0 + 384.0, 1088.0), heading));
      }
      continue;
    }

    break;
  }

  return [stage, spawns];
}


// Pure model of `creature_spawn` (0x00428240) as used by `rush_mode_update` (0x004072b0).
export function buildRushModeSpawnCreature(
  pos: Vec2,
  tintRgba: TintRGBA,
  rng: CrandLike,
  opts: {
    typeId: number;
    survivalElapsedMs: number;
  },
): CreatureInit {
  const elapsedMs = int(opts.survivalElapsedMs);
  const typeId = opts.typeId;

  const c = allocCreature(-1, pos, rng);
  c.typeId = typeId;
  c.aiMode = CreatureAiMode.ORBIT_PLAYER;

  const elapsedF32 = f32(elapsedMs);
  c.health = f32(elapsedF32 * f32(1e-4) + 10.0);
  c.heading = f32(f32(rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_HEADING }) % 314) * f32(0.01));
  c.moveSpeed = f32(elapsedF32 * f32(1e-5) + 2.5);
  c.rewardValue = rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_REWARD }) % 30 + 140;

  c.tint = tintRgba;
  c.contactDamage = 4.0;

  if (c.health !== null) {
    c.maxHealth = c.health;
  }
  c.size = f32(elapsedF32 * f32(1e-5) + 47.0);

  return c;
}


// Advance rush-mode edge wave spawning (pure model of `rush_mode_update` / 0x004072b0).
export function tickRushModeSpawns(
  spawnCooldown: number,
  frameDtMs: number,
  rng: CrandLike,
  opts: {
    playerCount: number;
    survivalElapsedMs: number;
    terrainWidth: number;
    terrainHeight: number;
  },
): [number, CreatureInit[]] {
  let cooldown = f32(f32(spawnCooldown) - f32(f32(opts.playerCount) * f32(frameDtMs)));

  const spawns: CreatureInit[] = [];
  while (cooldown < 0.0) {
    cooldown = f32(cooldown + 250.0);

    const t = f32(int(opts.survivalElapsedMs + 1.0));
    const tintR = clamp01(f32(t * f32(1.0 / 120000.0) + 0.3));
    const tintG = clamp01(f32(t * 10000.0 + 0.3));
    const tintB = clamp01(f32(Math.sin(f32(t * f32(1e-4))) + 0.3));
    const tintA = 1.0;
    const tint: TintRGBA = [tintR, tintG, tintB, tintA];

    const elapsedMs = int(opts.survivalElapsedMs);
    const theta = f32(f32(elapsedMs) * f32(0.001));
    const terrainWidthF = f32(opts.terrainWidth);
    const terrainHeightF = f32(opts.terrainHeight);
    const spawnRight = new Vec2(
      f32(terrainWidthF + 64.0),
      f32(terrainHeightF * 0.5 + Math.cos(theta) * 256.0),
    );
    const spawnLeft = new Vec2(
      -64.0,
      f32(terrainHeightF * 0.5 + Math.sin(theta) * 256.0),
    );

    let c = buildRushModeSpawnCreature(spawnRight, tint, rng, { typeId: 2, survivalElapsedMs: elapsedMs });
    c.aiMode = CreatureAiMode.ORBIT_PLAYER_WIDE;
    spawns.push(c);

    c = buildRushModeSpawnCreature(spawnLeft, tint, rng, { typeId: 3, survivalElapsedMs: elapsedMs });
    c.aiMode = CreatureAiMode.ORBIT_PLAYER_WIDE;
    c.flags = c.flags | CreatureFlags.AI7_LINK_TIMER;
    if (c.moveSpeed !== null) {
      c.moveSpeed = f32(c.moveSpeed * 1.4);
    }
    spawns.push(c);
  }

  return [cooldown, spawns];
}


// Spawn pack triggered by the stage-3 fire-key transition in `tutorial_timeline_update` (0x00408990).
export function buildTutorialStage3FireSpawns(): SpawnTemplateCall[] {
  const heading = Math.PI;
  return [
    spawnCall(SpawnId.ALIEN_CONST_GREEN_24, new Vec2(-164.0, 412.0), heading),
    spawnCall(SpawnId.ALIEN_CONST_PALE_GREEN_26, new Vec2(-184.0, 512.0), heading),
    spawnCall(SpawnId.ALIEN_CONST_GREEN_24, new Vec2(-154.0, 612.0), heading),
  ];
}


// Spawn pack triggered by the stage-4 "all clear" transition in `tutorial_timeline_update` (0x00408990).
export function buildTutorialStage4ClearSpawns(): SpawnTemplateCall[] {
  const heading = Math.PI;
  return [
    spawnCall(SpawnId.ALIEN_CONST_GREEN_24, new Vec2(1188.0, 412.0), heading),
    spawnCall(SpawnId.ALIEN_CONST_PALE_GREEN_26, new Vec2(1208.0, 512.0), heading),
    spawnCall(SpawnId.ALIEN_CONST_GREEN_24, new Vec2(1178.0, 612.0), heading),
  ];
}


// Spawn packs triggered by the stage-5 repeat loop in `tutorial_timeline_update` (0x00408990).
//
// `repeat_spawn_count` is the incremented counter value (1..7). When it reaches 8, the tutorial
// transitions instead of spawning more creatures.
//
// Note: the original also stores the returned creature pointer from template `0x27` in
// `tutorial_hint_bonus_ptr` and rewrites its packed bonus args (`link_index` low/high 16-bit fields)
// depending on `repeat_spawn_count`. This helper only reproduces the `creature_spawn_template` calls.
export function buildTutorialStage5RepeatSpawns(repeatSpawnCount: number): SpawnTemplateCall[] {
  const n = int(repeatSpawnCount);
  if (n < 1 || 8 <= n) {
    return [];
  }

  const heading = Math.PI;
  const spawns: SpawnTemplateCall[] = [];

  if ((n & 1) === 0) {
    // Even: right-side spawn pack (with an off-screen bottom-right spawn).
    if (n < 6) {
      spawns.push(spawnCall(SpawnId.ALIEN_CONST_WEAPON_BONUS_27, new Vec2(1056.0, 1056.0), heading));
    }
    spawns.push(spawnCall(SpawnId.ALIEN_CONST_GREEN_24, new Vec2(1188.0, 1136.0), heading));
    spawns.push(spawnCall(SpawnId.ALIEN_CONST_PALE_GREEN_26, new Vec2(1208.0, 512.0), heading));
    spawns.push(spawnCall(SpawnId.ALIEN_CONST_GREEN_24, new Vec2(1178.0, 612.0), heading));
    if (n === 4) {
      spawns.push(spawnCall(SpawnId.SPIDER_SP1_CONST_BLUE_40, new Vec2(512.0, 1056.0), heading));
    }
    return spawns;
  }

  // Odd: left-side spawn pack.
  if (n < 6) {
    spawns.push(spawnCall(SpawnId.ALIEN_CONST_WEAPON_BONUS_27, new Vec2(-32.0, 1056.0), heading));
  }
  spawns.push(...buildTutorialStage3FireSpawns());
  return spawns;
}


// Spawn pack triggered by the stage-6 "no perks pending" transition in `tutorial_timeline_update` (0x00408990).
export function buildTutorialStage6PerksDoneSpawns(): SpawnTemplateCall[] {
  const heading = Math.PI;
  return [
    ...buildTutorialStage3FireSpawns(),
    spawnCall(SpawnId.ALIEN_CONST_PURPLE_28, new Vec2(-32.0, -32.0), heading),
    ...buildTutorialStage4ClearSpawns(),
  ];
}


function applyTail(
  templateId: SpawnId,
  planCreatures: CreatureInit[],
  planSpawnSlots: SpawnSlotInit[],
  planEffects: BurstEffect[],
  primaryIdx: number,
  finalHeading: number,
  env: SpawnEnv,
): void {
  const c = planCreatures[primaryIdx];

  // Demo-burst effect (skipped when demo_mode_active != 0).
  if (!env.demoModeActive && 0.0 < c.pos.x && c.pos.x < env.terrainWidth && 0.0 < c.pos.y && c.pos.y < env.terrainHeight) {
    planEffects.push(new BurstEffect({ pos: c.pos, count: 8 }));
  }

  if (c.health !== null) {
    c.maxHealth = c.health;
  }

  // Spider_sp1 "AI7 timer" auto-enable (applies to the *return* creature).
  if (c.typeId === CreatureTypeId.SPIDER_SP1 && !(
    c.flags & (CreatureFlags.RANGED_ATTACK_SHOCK | CreatureFlags.AI7_LINK_TIMER)
  )) {
    c.flags = c.flags | CreatureFlags.AI7_LINK_TIMER;
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
      if (
        c.rewardValue !== null
        && c.moveSpeed !== null
        && c.contactDamage !== null
        && c.health !== null
      ) {
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
      planSpawnSlots[slotIdx].interval = Math.max(
        0.1,
        planSpawnSlots[slotIdx].interval - 0.2,
      );
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
  ctx.primary = ctx.gridChildren({
    xRange: spec.xRange,
    yRange: spec.yRange,
    aiMode: spec.childAiMode,
    childSpec: spec.childSpec,
  });
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
  ctx.primary = ctx.ringChildren({
    count: spec.count,
    angleStep: spec.angleStep,
    radius: spec.radius,
    aiMode: spec.childAiMode,
    childSpec: spec.childSpec,
    setPosition: spec.setPosition,
  });
  if (spec.applyFallback) {
    applyUnhandledCreatureTypeFallback(ctx.creatures, ctx.primary);
  }
}


function template00ZombieBossSpawner(ctx: PlanBuilder): void {
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
}

registerTemplate(SpawnId.ZOMBIE_BOSS_SPAWNER_00)(template00ZombieBossSpawner);


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


function template030506BasicRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = BASIC_RANDOM_TYPE_IDS.get(ctx.templateId)!;
  const size = (ctx.rng.rand({ caller: BASIC_RANDOM_SIZE_CALLERS.get(ctx.templateId)! }) % 15) + 38.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = (ctx.rng.rand({ caller: BASIC_RANDOM_MOVE_SPEED_CALLERS.get(ctx.templateId)! }) % 18) * 0.1 + 1.1;
  const tintB = (ctx.rng.rand({ caller: BASIC_RANDOM_TINT_B_CALLERS.get(ctx.templateId)! }) % 25) * 0.01 + 0.8;
  applyTint(c, [0.6, 0.6, clamp01(tintB), 1.0]);
  c.contactDamage = (ctx.rng.rand({ caller: BASIC_RANDOM_CONTACT_DAMAGE_CALLERS.get(ctx.templateId)! }) % 10) + 4.0;
}

registerTemplate(
  SpawnId.SPIDER_SP1_RANDOM_03,
  SpawnId.SPIDER_SP2_RANDOM_05,
  SpawnId.ALIEN_RANDOM_06,
)(template030506BasicRandom);


function template04LizardRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.LIZARD;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_04_SIZE }) % 15) + 38.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  applyTint(c, [0.67, 0.67, 1.0, 1.0]);
  c.moveSpeed = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_04_MOVE_SPEED }) % 18)
    * 0.1
    + 1.1
  );
  c.contactDamage = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_04_CONTACT_DAMAGE }) % 10)
    + 4.0
  );
}

registerTemplate(SpawnId.LIZARD_RANDOM_04)(template04LizardRandom);


function template0eAlienSpawnerRing24(ctx: PlanBuilder): void {
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

  const cSpec = childSpec({
    typeId: CreatureTypeId.ALIEN,
    health: 40.0,
    moveSpeed: 4.0,
    rewardValue: 350.0,
    size: 35.0,
    contactDamage: 30.0,
    tint: [1.0, 0.3, 0.3, 1.0],
  });
  ctx.primary = ctx.ringChildren({
    count: 24,
    angleStep: Math.PI / 12.0,
    radius: 100.0,
    aiMode: CreatureAiMode.FOLLOW_LINK,
    childSpec: cSpec,
    headingOverride: 0.0,
  });
}

registerTemplate(SpawnId.ALIEN_SPAWNER_RING_24_0E)(template0eAlienSpawnerRing24);


function template11FormationChainLizard4(ctx: PlanBuilder): void {
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
  const cSpec = childSpec({
    typeId: CreatureTypeId.LIZARD,
    health: 60.0,
    moveSpeed: 2.4,
    rewardValue: 60.0,
    size: 50.0,
    contactDamage: 14.0,
    tint: [0.6, 0.6, 0.31, 1.0],
  });

  const setupChild = (child: CreatureInit, idx: number): void => {
    child.targetOffset = new Vec2(-256.0 + idx * 64.0, -256.0);
    const angle = (2 + idx * 2) * (Math.PI / 8.0);
    child.pos = Vec2.fromAngle(angle).mul(256.0).add(ctx.pos);
  };

  const chainPrev = ctx.chainChildren({
    count: 4,
    aiMode: CreatureAiMode.FOLLOW_LINK,
    childSpec: cSpec,
    setupChild,
  });

  parent.aiLinkParent = chainPrev;
  ctx.primary = chainPrev;
  applyUnhandledCreatureTypeFallback(ctx.creatures, ctx.primary);
}

registerTemplate(SpawnId.FORMATION_CHAIN_LIZARD_4_11)(template11FormationChainLizard4);


function template13FormationChainAlien10(ctx: PlanBuilder): void {
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

  const cSpec = childSpec({
    typeId: CreatureTypeId.ALIEN,
    health: 60.0,
    moveSpeed: 2.0,
    rewardValue: 60.0,
    size: 50.0,
    contactDamage: 4.0,
    tint: [0.4, 0.7, 0.11, 1.0],
    orbitAngle: Math.PI,
    orbitRadius: 10.0,
  });

  const degreesToRadians = 20.0 * Math.PI / 180.0;
  const setupChild = (child: CreatureInit, idx: number): void => {
    const angleIdx = 2 + idx * 2;
    const angle = angleIdx * degreesToRadians;
    child.pos = Vec2.fromAngle(angle).mul(256.0).add(ctx.pos);
  };

  const chainPrev = ctx.chainChildren({
    count: 10,
    aiMode: CreatureAiMode.ORBIT_LINK,
    childSpec: cSpec,
    setupChild,
  });

  parent.aiLinkParent = chainPrev;
  ctx.primary = chainPrev;
  applyUnhandledCreatureTypeFallback(ctx.creatures, ctx.primary);
}

registerTemplate(SpawnId.FORMATION_CHAIN_ALIEN_10_13)(template13FormationChainAlien10);


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


function template1a1b1cAi1BlueTint(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.aiMode = CreatureAiMode.ORBIT_PLAYER_TIGHT;
  c.size = 50.0;
  c.moveSpeed = 2.4;
  c.rewardValue = 125.0;

  const [tid, hp] = AI1_BLUE_TINT_TEMPLATES.get(ctx.templateId)!;
  c.typeId = tid;
  c.health = hp;

  const tint = (ctx.rng.rand({ caller: AI1_BLUE_TINT_CALLERS.get(ctx.templateId)! }) % 40) * 0.01 + 0.5;
  applyTint(c, [tint, tint, 1.0, 1.0]);
  c.contactDamage = 5.0;
}

registerTemplate(
  SpawnId.AI1_ALIEN_BLUE_TINT_1A,
  SpawnId.AI1_SPIDER_SP1_BLUE_TINT_1B,
  SpawnId.AI1_LIZARD_BLUE_TINT_1C,
)(template1a1b1cAi1BlueTint);


function template1dAlienRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_SIZE }) % 20) + 35.0;
  applySizeHealth(c, size, { healthScale: 8.0 / 7.0, healthAdd: 10.0 });
  c.moveSpeed = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_MOVE_SPEED }) % 15) * 0.1 + 1.1;
  c.rewardValue = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_REWARD }) % 100) + 50.0;
  applyTint(c, [
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_TINT_R }) % 50) * 0.001 + 0.6,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_TINT_G }) % 50) * 0.01 + 0.5,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_TINT_B }) % 50) * 0.001 + 0.6,
    1.0,
  ]);
  c.contactDamage = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1D_CONTACT_DAMAGE }) % 10) + 4.0;
}

registerTemplate(SpawnId.ALIEN_RANDOM_1D)(template1dAlienRandom);


function template1eAlienRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_SIZE }) % 30) + 35.0;
  applySizeHealth(c, size, { healthScale: 16.0 / 7.0, healthAdd: 10.0 });
  c.moveSpeed = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_MOVE_SPEED }) % 17) * 0.1 + 1.5;
  c.rewardValue = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_REWARD }) % 200) + 50.0;
  applyTint(c, [
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_TINT_R }) % 50) * 0.001 + 0.6,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_TINT_G }) % 50) * 0.001 + 0.6,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_TINT_B }) % 50) * 0.01 + 0.5,
    1.0,
  ]);
  c.contactDamage = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1E_CONTACT_DAMAGE }) % 30) + 4.0;
}

registerTemplate(SpawnId.ALIEN_RANDOM_1E)(template1eAlienRandom);


function template1fAlienRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_SIZE }) % 30) + 45.0;
  applySizeHealth(c, size, { healthScale: 26.0 / 7.0, healthAdd: 30.0 });
  c.moveSpeed = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_MOVE_SPEED }) % 21) * 0.1 + 1.6;
  c.rewardValue = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_REWARD }) % 200) + 80.0;
  applyTint(c, [
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_TINT_R }) % 50) * 0.01 + 0.5,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_TINT_G }) % 50) * 0.001 + 0.6,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_TINT_B }) % 50) * 0.001 + 0.6,
    1.0,
  ]);
  c.contactDamage = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_1F_CONTACT_DAMAGE }) % 35) + 8.0;
}

registerTemplate(SpawnId.ALIEN_RANDOM_1F)(template1fAlienRandom);


function template20AlienRandomGreen(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_GREEN_20_SIZE }) % 30) + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_GREEN_20_MOVE_SPEED }) % 18)
    * 0.1 + 1.1
  );
  const tintG = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_GREEN_20_TINT_G }) % 40) * 0.01
    + 0.6
  );
  applyTint(c, [0.3, tintG, 0.3, 1.0]);
  c.contactDamage = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ALIEN_RANDOM_GREEN_20_CONTACT_DAMAGE }) % 10)
    + 4.0
  );
}

registerTemplate(SpawnId.ALIEN_RANDOM_GREEN_20)(template20AlienRandomGreen);


function template2eLizardRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.LIZARD;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_SIZE }) % 30) + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_MOVE_SPEED }) % 18)
    * 0.1
    + 1.1
  );
  applyTint(c, [
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_TINT_R }) % 40) * 0.01 + 0.6,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_TINT_G }) % 40) * 0.01 + 0.6,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_TINT_B }) % 40) * 0.01 + 0.6,
    1.0,
  ]);
  c.contactDamage = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_2E_CONTACT_DAMAGE }) % 10)
    + 4.0
  );
}

registerTemplate(SpawnId.LIZARD_RANDOM_2E)(template2eLizardRandom);


function template31LizardRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.LIZARD;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_31_SIZE }) % 30) + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 10.0 });
  c.moveSpeed = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_31_MOVE_SPEED }) % 18) * 0.1 + 1.1;
  const tint = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_LIZARD_RANDOM_31_TINT }) % 30) * 0.01 + 0.6;
  applyTint(c, [tint, tint, 0.38, 1.0]);
  c.contactDamage = size * 0.14 + 4.0;
}

registerTemplate(SpawnId.LIZARD_RANDOM_31)(template31LizardRandom);


function template32SpiderSp1Random(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_32_SIZE }) % 25) + 40.0;
  applySizeHealthReward(c, size, { healthScale: 1.0, healthAdd: 10.0 });
  c.moveSpeed = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_32_MOVE_SPEED }) % 17)
    * 0.1 + 1.1
  );
  const tint = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_32_TINT }) % 40) * 0.01 + 0.6;
  applyTint(c, [tint, tint, tint, 1.0]);
  c.contactDamage = size * 0.14 + 4.0;
}

registerTemplate(SpawnId.SPIDER_SP1_RANDOM_32)(template32SpiderSp1Random);


function template33SpiderSp1RandomRed(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_RED_33_SIZE }) % 15) + 45.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_RED_33_MOVE_SPEED }) % 18)
    * 0.1 + 1.1
  );
  applyTint(c, [
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_RED_33_TINT_R }) % 40) * 0.01 + 0.6,
    0.5,
    0.5,
    1.0,
  ]);
  c.contactDamage = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_RED_33_CONTACT_DAMAGE }) % 10)
    + 4.0
  );
}

registerTemplate(SpawnId.SPIDER_SP1_RANDOM_RED_33)(template33SpiderSp1RandomRed);


function template34SpiderSp1RandomGreen(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_GREEN_34_SIZE }) % 20) + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_GREEN_34_MOVE_SPEED }) % 18)
    * 0.1 + 1.1
  );
  applyTint(c, [
    0.5,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_GREEN_34_TINT_G }) % 40) * 0.01 + 0.6,
    0.5,
    1.0,
  ]);
  c.contactDamage = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_GREEN_34_CONTACT_DAMAGE }) % 10)
    + 4.0
  );
}

registerTemplate(SpawnId.SPIDER_SP1_RANDOM_GREEN_34)(template34SpiderSp1RandomGreen);


function template35SpiderSp2Random(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP2;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_35_SIZE }) % 10) + 30.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 20.0 });
  c.moveSpeed = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_35_MOVE_SPEED }) % 18)
    * 0.1 + 1.1
  );
  applyTint(c, [
    0.8,
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_35_TINT_G }) % 20) * 0.01 + 0.8,
    0.8,
    1.0,
  ]);
  c.contactDamage = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANDOM_35_CONTACT_DAMAGE }) % 10)
    + 4.0
  );
}

registerTemplate(SpawnId.SPIDER_SP2_RANDOM_35)(template35SpiderSp2Random);


function template36AlienAi7Orbiter(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ALIEN;
  c.size = 50.0;
  c.aiMode = CreatureAiMode.HOLD_TIMER;
  c.orbitRadius = 1.5;
  c.health = 10.0;
  c.moveSpeed = 1.8;
  c.rewardValue = 150.0;
  const tintG = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_AI7_ORBITER_TINT_G }) % 5) * 0.01 + 0.65;
  applyTint(c, [0.65, tintG, 0.95, 1.0]);
  c.contactDamage = 40.0;
}

registerTemplate(SpawnId.ALIEN_AI7_ORBITER_36)(template36AlienAi7Orbiter);


function template37SpiderSp2RangedVariant(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP2;
  c.flags = CreatureFlags.RANGED_ATTACK_VARIANT;
  c.health = 50.0;
  c.moveSpeed = 3.2;
  c.rewardValue = 433.0;
  applyTint(c, [1.0, 0.75, 0.1, 1.0]);
  c.size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP2_RANGED_VARIANT_37_SIZE }) & 3) + 41;
  c.contactDamage = 10.0;
}

registerTemplate(SpawnId.SPIDER_SP2_RANGED_VARIANT_37)(template37SpiderSp2RangedVariant);


function template38SpiderSp1Ai7Timer(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  c.flags = CreatureFlags.AI7_LINK_TIMER;
  c.aiTimer = 0;
  c.health = 50.0;
  c.moveSpeed = 4.8;
  c.rewardValue = 433.0;
  applyTint(c, [1.0, 0.75, 0.1, 1.0]);
  c.size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_AI7_TIMER_38_SIZE }) & 3) + 41;
  c.contactDamage = 10.0;
}

registerTemplate(SpawnId.SPIDER_SP1_AI7_TIMER_38)(template38SpiderSp1Ai7Timer);


function template39SpiderSp1Ai7TimerWeak(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  c.flags = CreatureFlags.AI7_LINK_TIMER;
  c.aiTimer = 0;
  c.health = 4.0;
  c.moveSpeed = 4.8;
  c.rewardValue = 50.0;
  applyTint(c, [0.8, 0.65, 0.1, 1.0]);
  c.size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_AI7_TIMER_WEAK_39_SIZE }) % 4) + 26;
  c.contactDamage = 10.0;
}

registerTemplate(SpawnId.SPIDER_SP1_AI7_TIMER_WEAK_39)(template39SpiderSp1Ai7TimerWeak);


function template3dSpiderSp1Random(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.SPIDER_SP1;
  c.health = 70.0;
  c.moveSpeed = 2.6;
  c.rewardValue = 120.0;
  const tint = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_3D_TINT }) % 20) * 0.01 + 0.8;
  applyTint(c, [tint, tint, tint, 1.0]);
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_SPIDER_SP1_RANDOM_3D_SIZE }) % 7) + 45;
  c.size = size;
  c.contactDamage = size * 0.22;
}

registerTemplate(SpawnId.SPIDER_SP1_RANDOM_3D)(template3dSpiderSp1Random);


function template41ZombieRandom(ctx: PlanBuilder): void {
  const c = ctx.base;
  c.typeId = CreatureTypeId.ZOMBIE;
  const size = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ZOMBIE_RANDOM_41_SIZE }) % 30) + 40.0;
  applySizeHealthReward(c, size, { healthScale: 8.0 / 7.0, healthAdd: 10.0 });
  applySizeMoveSpeed(c, size, 0.0025, 0.9);
  const tint = (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ZOMBIE_RANDOM_41_TINT }) % 40) * 0.01 + 0.6;
  applyTint(c, [tint, tint, tint, 1.0]);
  c.contactDamage = (
    (ctx.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TEMPLATE_ZOMBIE_RANDOM_41_CONTACT_DAMAGE }) % 10)
    + 4.0
  );
}

registerTemplate(SpawnId.ZOMBIE_RANDOM_41)(template41ZombieRandom);


export function buildSpawnPlan(
  templateId: SpawnId,
  pos: Vec2,
  heading: number,
  rng: CrandLike,
  env: SpawnEnv,
): SpawnPlan {
  // Pure plan builder modeled after `creature_spawn_template` (0x00430AF0).
  //
  // The plan lists:
  //   - every creature allocated and configured directly by the template
  //   - any spawn-slot configurations (deferred child spawns)
  //   - side-effects like burst FX

  const [ctx, finalHeading] = PlanBuilder.start(templateId, pos, heading, rng, env);

  const builder = TEMPLATE_BUILDERS.get(templateId);
  if (builder) {
    builder(ctx);
  } else {
    const alienSpec = ALIEN_SPAWNER_TEMPLATES.get(templateId);
    if (alienSpec) {
      applyAlienSpawner(ctx, alienSpec);
    } else {
      const gridSpec = GRID_FORMATIONS.get(templateId);
      if (gridSpec) {
        applyGridFormation(ctx, gridSpec);
      } else {
        const ringSpec = RING_FORMATIONS.get(templateId);
        if (ringSpec) {
          applyRingFormation(ctx, ringSpec);
        } else {
          const constSpawnSpec = CONSTANT_SPAWN_TEMPLATES.get(templateId);
          if (constSpawnSpec) {
            applyConstantSpawn(ctx, constSpawnSpec);
          } else {
            throw new UnsupportedSpawnTemplateError(`unsupported spawn template id: 0x${int(templateId).toString(16)}`);
          }
        }
      }
    }
  }

  return ctx.finish(finalHeading);
}
