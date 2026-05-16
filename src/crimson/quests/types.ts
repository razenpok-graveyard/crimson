// Port of crimson/quests/types.py

import type { QuestLevel } from '@crimson/quests/level.ts';
import type { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import type { SpawnId } from '@crimson/creatures/spawn.ts';
import type { TerrainSlotTriplet } from '@crimson/terrain-slots.ts';
import type { WeaponId } from '@crimson/weapons.ts';

export type QuestBuilder = (ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }) => SpawnEntry[];

export class QuestContext {
  readonly width: number;
  readonly height: number;
  readonly playerCount: number;

  constructor(opts: {
    width: number;
    height: number;
    playerCount: number;
  }) {
    this.width = opts.width;
    this.height = opts.height;
    this.playerCount = opts.playerCount;
  }
}

export class SpawnEntry {
  readonly pos: Vec2;
  readonly heading: number;
  readonly spawnId: SpawnId;
  readonly triggerMs: number;
  readonly count: number;

  constructor(opts: {
    pos: Vec2;
    heading: number;
    spawnId: SpawnId;
    triggerMs: number;
    count: number;
  }) {
    this.pos = opts.pos;
    this.heading = opts.heading;
    this.spawnId = opts.spawnId;
    this.triggerMs = opts.triggerMs;
    this.count = opts.count;
  }
}

export class QuestDefinition {
  readonly level: QuestLevel;
  readonly title: string;
  readonly builder: QuestBuilder;
  readonly timeLimitMs: number;
  readonly startWeaponId: WeaponId;
  readonly terrainSlots: TerrainSlotTriplet;
  readonly unlockPerkId: number | null;
  readonly unlockWeaponId: WeaponId | null;

  constructor(opts: {
    level: QuestLevel;
    title: string;
    builder: QuestBuilder;
    timeLimitMs: number;
    startWeaponId: WeaponId;
    terrainSlots: TerrainSlotTriplet;
    unlockPerkId?: number | null;
    unlockWeaponId?: WeaponId | null;
  }) {
    this.level = opts.level;
    this.title = opts.title;
    this.builder = opts.builder;
    this.timeLimitMs = opts.timeLimitMs;
    this.startWeaponId = opts.startWeaponId;
    this.terrainSlots = opts.terrainSlots;
    this.unlockPerkId = opts.unlockPerkId ?? null;
    this.unlockWeaponId = opts.unlockWeaponId ?? null;
  }

  get major(): number {
    return int(this.level.major);
  }

  get minor(): number {
    return int(this.level.minor);
  }
}
