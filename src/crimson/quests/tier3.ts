// Port of crimson/quests/tier3.py

import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { SpawnId } from '@crimson/creatures/spawn.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { centerPoint, edgeMidpoints, linePoints, radialPoints, ringPoints, spawn, spawnAt } from '@crimson/quests/helpers.ts';
import { registerQuest } from '@crimson/quests/registry.ts';
import type { QuestContext } from '@crimson/quests/types.ts';
import { SpawnEntry } from '@crimson/quests/types.ts';
export { QuestContext, SpawnEntry } from '@crimson/quests/types.ts';

export const build3_1TheBlighting = registerQuest({ level: '3.1', title: 'The Blighting', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.TOXIC_AVENGER })(function build3_1TheBlighting(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const edges = edgeMidpoints(ctx.width);
  const edgesWide = edgeMidpoints(ctx.width, undefined, 128.0);
  const entries = [spawnAt(edgesWide.right, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_RED_FAST_2B, triggerMs: 1500, count: 2 }), spawnAt(edgesWide.left, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_RED_FAST_2B, triggerMs: 1500, count: 2 }), spawn(new Vec2(896.0, 128.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: 2000, count: 1 }), spawn(new Vec2(128.0, 128.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: 2000, count: 1 }), spawn(new Vec2(128.0, 896.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: 2000, count: 1 }), spawn(new Vec2(896.0, 896.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: 2000, count: 1 })];

  let trigger = 4000;
  for (let wave = 0; wave < 8; wave++) {
    if (wave === 2 || wave === 4) {
      entries.push(spawnAt(edgesWide.left, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_RED_FAST_2B, triggerMs: trigger, count: 4 }));
    }
    if (wave === 3 || wave === 5) {
      entries.push(spawnAt(edgesWide.right, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_RED_FAST_2B, triggerMs: trigger, count: 4 }));
    }
    const spawnId = wave % 2 === 0 ? SpawnId.AI1_ALIEN_BLUE_TINT_1A : SpawnId.AI1_LIZARD_BLUE_TINT_1C;
    const edge = wave % 5;
    if (edge === 0) {
      entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: 12 }));
      trigger += 15000;
    } else if (edge === 1) {
      entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: 12 }));
      trigger += 15000;
    } else if (edge === 2) {
      entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: 12 }));
      trigger += 15000;
    } else if (edge === 3) {
      entries.push(spawnAt(edges.top, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: 12 }));
      trigger += 15000;
    }
    trigger += 1000;
  }
  return entries;
});

export const build3_2LizardKings = registerQuest({ level: '3.2', title: 'Lizard Kings', timeLimitMs: 180000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.MULTI_PLASMA })(function build3_2LizardKings(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const center = centerPoint(ctx.width, ctx.height);
  const entries = [spawn(new Vec2(1152.0, 512.0), { heading: 0.0, spawnId: SpawnId.FORMATION_CHAIN_LIZARD_4_11, triggerMs: 1500, count: 1 }), spawn(new Vec2(-128.0, 512.0), { heading: 0.0, spawnId: SpawnId.FORMATION_CHAIN_LIZARD_4_11, triggerMs: 1500, count: 1 }), spawn(new Vec2(1152.0, 896.0), { heading: 0.0, spawnId: SpawnId.FORMATION_CHAIN_LIZARD_4_11, triggerMs: 1500, count: 1 })];
  let trigger = 1500;
  for (let [pos, angle] of ringPoints(center, 256.0, 28, { step: 0.34906587 })) {
    entries.push(spawn(pos, { heading: -angle, spawnId: SpawnId.LIZARD_RANDOM_31, triggerMs: trigger, count: 1 }));
    trigger += 900;
  }
  return entries;
});

function theKillingRandomSpawner(opts: { rng: CrandLike; triggerMs: number; yCaller: number; xCaller: number }): SpawnEntry {
  const rng = opts.rng;
  const triggerMs = opts.triggerMs;
  const yCaller = opts.yCaller;
  const xCaller = opts.xCaller;
  const y = rng.rand({ caller: yCaller }) % 768 + 128.0;
  const x = rng.rand({ caller: xCaller }) % 768 + 128.0;
  return spawn(new Vec2(x, y), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: triggerMs, count: 3 });
}

export const build3_3TheKilling = registerQuest({ level: '3.3', title: 'The Killing', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.REGENERATION })(function build3_3TheKilling(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const edges = edgeMidpoints(ctx.width);
  const entries: SpawnEntry[] = [];
  let trigger = 2000;
  for (let wave = 0; wave < 10; wave++) {
    const spawnCycle = (rng.rand({ caller: RngCallerStatic.QUEST_BUILD_THE_KILLING_TEMPLATE_PICK }) % 3);
    let spawnId: SpawnId;
    if (spawnCycle === 0) {
      spawnId = SpawnId.AI1_ALIEN_BLUE_TINT_1A;
    } else if (spawnCycle === 1) {
      spawnId = SpawnId.AI1_SPIDER_SP1_BLUE_TINT_1B;
    } else {
      spawnId = SpawnId.AI1_LIZARD_BLUE_TINT_1C;
    }

    const edge = (rng.rand({ caller: RngCallerStatic.QUEST_BUILD_THE_KILLING_LAYOUT_PICK }) % 5);
    if (edge === 0) {
      entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: 12 }));
    } else if (edge === 1) {
      entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: 12 }));
    } else if (edge === 2) {
      entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: 12 }));
    } else if (edge === 3) {
      entries.push(spawnAt(edges.top, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: 12 }));
    } else {
      entries.push(theKillingRandomSpawner({ rng: rng, triggerMs: trigger, yCaller: RngCallerStatic.QUEST_BUILD_THE_KILLING_SPAWNER_1_Y, xCaller: RngCallerStatic.QUEST_BUILD_THE_KILLING_SPAWNER_1_X }));
      entries.push(theKillingRandomSpawner({ rng: rng, triggerMs: trigger + 1000, yCaller: RngCallerStatic.QUEST_BUILD_THE_KILLING_SPAWNER_2_Y, xCaller: RngCallerStatic.QUEST_BUILD_THE_KILLING_SPAWNER_2_X }));
      entries.push(theKillingRandomSpawner({ rng: rng, triggerMs: trigger + 2000, yCaller: RngCallerStatic.QUEST_BUILD_THE_KILLING_SPAWNER_3_Y, xCaller: RngCallerStatic.QUEST_BUILD_THE_KILLING_SPAWNER_3_X }));
    }

    trigger += 6000;
  }
  return entries;
});

export const build3_4HiddenEvil = registerQuest({ level: '3.4', title: 'Hidden Evil', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.SEEKER_ROCKETS })(function build3_4HiddenEvil(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const edges = edgeMidpoints(ctx.width, ctx.height);
  return [
    spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PURPLE_GHOST_21, triggerMs: 500, count: 50 }),
    spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREEN_GHOST_22, triggerMs: 15000, count: 30 }),
    spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREEN_GHOST_SMALL_23, triggerMs: 25000, count: 20 }),
    spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREEN_GHOST_SMALL_23, triggerMs: 30000, count: 30 }),
    spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREEN_GHOST_22, triggerMs: 35000, count: 30 }),
  ];
});

export const build3_5SurroundedByReptiles = registerQuest({ level: '3.5', title: 'Surrounded By Reptiles', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.PYROMANIAC })(function build3_5SurroundedByReptiles(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  let trigger = 1000;
  for (const pos of linePoints(new Vec2(256.0, 256.0), new Vec2(0.0, 102.4), 5)) {
    entries.push(spawn(new Vec2(256.0, pos.y), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_SLOW_0D, triggerMs: trigger, count: 1 }));
    entries.push(spawn(new Vec2(768.0, pos.y), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_SLOW_0D, triggerMs: trigger, count: 1 }));
    trigger += 800;
  }

  trigger = 8000;
  for (const pos of linePoints(new Vec2(256.0, 256.0), new Vec2(102.4, 0.0), 5)) {
    entries.push(spawn(new Vec2(pos.x, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_SLOW_0D, triggerMs: trigger, count: 1 }));
    entries.push(spawn(new Vec2(pos.x, 768.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_SLOW_0D, triggerMs: trigger, count: 1 }));
    trigger += 800;
  }
  return entries;
});

export const build3_6TheLizquidation = registerQuest({ level: '3.6', title: 'The Lizquidation', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.BLOW_TORCH })(function build3_6TheLizquidation(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width);
  let trigger = 1500;
  for (let wave = 0; wave < 10; wave++) {
    const count = wave + 6;
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.LIZARD_RANDOM_2E, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.LIZARD_RANDOM_2E, triggerMs: trigger, count: count }));
    if (wave === 4) {
      entries.push(spawn(new Vec2(ctx.width + 128.0, edges.right.y), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_RED_FAST_2B, triggerMs: 1500, count: 2 }));
    }
    trigger += 8000;
  }
  return entries;
});

export const build3_7SpidersInc = registerQuest({ level: '3.7', title: 'Spiders Inc.', timeLimitMs: 300000, startWeaponId: WeaponId.PLASMA_MINIGUN, unlockPerkId: PerkId.NINJA })(function build3_7SpidersInc(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const edges = edgeMidpoints(ctx.width);
  const center = centerPoint(ctx.width, ctx.height);
  const entries = [spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_AI7_TIMER_38, triggerMs: 500, count: 1 }), spawn(new Vec2(center.x + 64.0, edges.bottom.y), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_AI7_TIMER_38, triggerMs: 500, count: 1 }), spawnAt(edges.top, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_BLUE_40, triggerMs: 500, count: 4 })];

  let trigger = 17000;
  let stepCount = 0;
  while (trigger < 107000) {
    const count = Math.floor(stepCount / 2) + 3;
    entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_AI7_TIMER_38, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.top, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_AI7_TIMER_38, triggerMs: trigger, count: count }));
    trigger += 6000;
    stepCount += 1;
  }
  return entries;
});

export const build3_8LizardRaze = registerQuest({ level: '3.8', title: 'Lizard Raze', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.ROCKET_MINIGUN })(function build3_8LizardRaze(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width);
  let trigger = 1500;
  while (trigger < 91500) {
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.LIZARD_RANDOM_2E, triggerMs: trigger, count: 6 }));
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.LIZARD_RANDOM_2E, triggerMs: trigger, count: 6 }));
    trigger += 6000;
  }
  entries.push(...[spawn(new Vec2(128.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_FAST_0C, triggerMs: 10000, count: 1 }), spawn(new Vec2(128.0, 384.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_FAST_0C, triggerMs: 10000, count: 1 }), spawn(new Vec2(128.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_FAST_0C, triggerMs: 10000, count: 1 })]);
  return entries;
});

export const build3_9DejaVu = registerQuest({ level: '3.9', title: 'Deja vu', timeLimitMs: 120000, startWeaponId: WeaponId.GAUSS_GUN, unlockPerkId: PerkId.HIGHLANDER })(function build3_9DejaVu(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const center = centerPoint(ctx.width, ctx.height);
  let trigger = 2000;
  let step = 2000;
  while (step > 560) {
    const angle = (rng.rand({ caller: RngCallerStatic.QUEST_BUILD_DEJA_VU_ANGLE }) % 612 * 0.01);
    for (const pos of radialPoints(center, angle, 0x54, 0xFC, 0x2A)) {
      entries.push(spawn(pos, { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_SLOW_0D, triggerMs: trigger, count: 1 }));
    }
    trigger += step;
    step -= 0x50;
  }
  return entries;
});

export const build3_10ZombieMasters = registerQuest({ level: '3.10', title: 'Zombie Masters', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.JACKHAMMER })(function build3_10ZombieMasters(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  return [
    spawn(new Vec2(256.0, 256.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_BOSS_SPAWNER_00, triggerMs: 1000, count: ctx.playerCount }),
    spawn(new Vec2(512.0, 256.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_BOSS_SPAWNER_00, triggerMs: 6000, count: 1 }),
    spawn(new Vec2(768.0, 256.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_BOSS_SPAWNER_00, triggerMs: 14000, count: ctx.playerCount }),
    spawn(new Vec2(768.0, 768.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_BOSS_SPAWNER_00, triggerMs: 18000, count: 1 }),
  ];
});
