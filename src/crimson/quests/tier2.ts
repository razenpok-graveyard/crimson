// Port of crimson/quests/tier2.py

import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { SpawnId } from '@crimson/creatures/spawn.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { centerPoint, edgeMidpoints, headingFromCenter, linePoints, radialPoints, spawn, spawnAt } from '@crimson/quests/helpers.ts';
import { registerQuest } from '@crimson/quests/registry.ts';
import type { QuestContext } from '@crimson/quests/types.ts';
import { SpawnEntry } from '@crimson/quests/types.ts';
export { QuestContext, SpawnEntry } from '@crimson/quests/types.ts';

export const build2_1EverredPastures = registerQuest({ level: '2.1', title: 'Everred Pastures', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.BONUS_ECONOMIST })(function build2_1EverredPastures(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const edges = edgeMidpoints(ctx.width);
  const entries: SpawnEntry[] = [];
  for (let wave = 1; wave < 9; wave++) {
    const trigger = (wave - 1) * 13000 + 1500;
    const count = wave;
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_RANDOM_32, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_RANDOM_RED_33, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_RANDOM_GREEN_34, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.top, { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_RANDOM_35, triggerMs: trigger, count: count }));
    if (wave === 4) {
      entries.push(spawnAt(edges.top, { heading: 0.0, spawnId: SpawnId.AI1_SPIDER_SP1_BLUE_TINT_1B, triggerMs: 40500, count: 8 }));
      entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.AI1_SPIDER_SP1_BLUE_TINT_1B, triggerMs: 40500, count: 8 }));
    }
  }
  return entries;
});

export const build2_2SpiderSpawns = registerQuest({ level: '2.2', title: 'Spider Spawns', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.PLASMA_RIFLE })(function build2_2SpiderSpawns(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  return [
    spawn(new Vec2(128.0, 128.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, triggerMs: 1500, count: 1 }),
    spawn(new Vec2(896.0, 896.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, triggerMs: 1500, count: 1 }),
    spawn(new Vec2(896.0, 128.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, triggerMs: 1500, count: 1 }),
    spawn(new Vec2(128.0, 896.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, triggerMs: 1500, count: 1 }),
    spawn(new Vec2(-64.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_AI7_TIMER_38, triggerMs: 3000, count: 2 }),
    spawn(new Vec2(512.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: 18000, count: 1 }),
    spawn(new Vec2(448.0, 448.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, triggerMs: 20500, count: 1 }),
    spawn(new Vec2(576.0, 448.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, triggerMs: 26000, count: 1 }),
    spawn(new Vec2(1088.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_AI7_TIMER_38, triggerMs: 21000, count: 2 }),
    spawn(new Vec2(576.0, 576.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, triggerMs: 31500, count: 1 }),
    spawn(new Vec2(448.0, 576.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, triggerMs: 22000, count: 1 }),
  ];
});

export const build2_3ArachnoidFarm = registerQuest({ level: '2.3', title: 'Arachnoid Farm', timeLimitMs: 240000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.THICK_SKINNED })(function build2_3ArachnoidFarm(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  let trigger: number;
  if (ctx.playerCount + 4 >= 0) {
    trigger = 500;
    for (const pos of linePoints(new Vec2(256.0, 256.0), new Vec2(102.4, 0.0), ctx.playerCount + 4)) {
      entries.push(spawn(pos, { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: trigger, count: 1 }));
      trigger += 500;
    }
    trigger = 10500;
    for (const pos of linePoints(new Vec2(256.0, 768.0), new Vec2(102.4, 0.0), ctx.playerCount + 4)) {
      entries.push(spawn(pos, { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: trigger, count: 1 }));
      trigger += 500;
    }
  }
  if (ctx.playerCount + 7 >= 0) {
    trigger = 40500;
    for (const pos of linePoints(new Vec2(256.0, 512.0), new Vec2(64.0, 0.0), ctx.playerCount + 7)) {
      entries.push(spawn(pos, { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, triggerMs: trigger, count: 1 }));
      trigger += 3500;
    }
  }
  return entries;
});

export const build2_4TwoFronts = registerQuest({ level: '2.4', title: 'Two Fronts', timeLimitMs: 240000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.ION_RIFLE })(function build2_4TwoFronts(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width);
  for (let wave = 0; wave < 40; wave++) {
    const triggerA = wave * 2000 + 1000;
    const triggerB = (wave * 5 + 5) * 400;
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.AI1_ALIEN_BLUE_TINT_1A, triggerMs: triggerA, count: 1 }));
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.AI1_SPIDER_SP1_BLUE_TINT_1B, triggerMs: triggerB, count: 1 }));
    let trigger: number;
    if (wave === 10 || wave === 20) {
      trigger = wave * 2000 + 2500;
      entries.push(spawn(new Vec2(256.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: trigger, count: 1 }));
      entries.push(spawn(new Vec2(768.0, 768.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: trigger, count: 1 }));
    }
    if (wave === 30) {
      trigger = 62500;
      entries.push(spawn(new Vec2(768.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: trigger, count: 1 }));
      entries.push(spawn(new Vec2(256.0, 768.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: trigger, count: 1 }));
    }
  }
  return entries;
});

export const build2_5SweepStakes = registerQuest({ level: '2.5', title: 'Sweep Stakes', timeLimitMs: 35000, startWeaponId: WeaponId.GAUSS_GUN, unlockPerkId: PerkId.BARREL_GREASER })(function build2_5SweepStakes(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const center = centerPoint(ctx.width, ctx.height);
  let trigger = 2000;
  let step = 2000;
  while (step > 720) {
    const angle = (rng.rand({ caller: RngCallerStatic.QUEST_BUILD_SWEEP_STAKES_ANGLE }) % 612 * 0.01);
    for (const pos of radialPoints(center, angle, 0x54, 0xFC, 0x2A)) {
      const heading = headingFromCenter(pos, center);
      entries.push(spawn(pos, { heading: heading, spawnId: SpawnId.ALIEN_AI7_ORBITER_36, triggerMs: trigger, count: 1 }));
    }
    trigger += Math.max(step, 600);
    step -= 0x50;
  }
  return entries;
});

export const build2_6EvilZombiesAtLarge = registerQuest({ level: '2.6', title: 'Evil Zombies At Large', timeLimitMs: 180000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.MEAN_MINIGUN })(function build2_6EvilZombiesAtLarge(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width);
  let trigger = 1500;
  let count = 4;
  while (count <= 13) {
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.top, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: count }));
    trigger += 5500;
    count += 1;
  }
  return entries;
});

export const build2_7SurvivalOfTheFastest = registerQuest({ level: '2.7', title: 'Survival Of The Fastest', timeLimitMs: 120000, startWeaponId: WeaponId.SUBMACHINE_GUN, unlockPerkId: PerkId.AMMUNITION_WITHIN })(function build2_7SurvivalOfTheFastest(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: (SpawnEntry | null)[] = Array.from({ length: 26 }, () => null);

  const setEntry = (idx: number, pos: Vec2, spawnId: SpawnId, trigger: number, count: number): void => {
    if (idx < 0 || idx >= entries.length) {
      return;
    }
    entries[idx] = spawn(pos, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: count });
  };

  // Loop 1: x from 256 to <688, step 72
  let trigger = 500;
  let idx = 0;
  for (let x = 0x100; 0x48 >= 0 ? x < 0x2B0 : x > 0x2B0; x += 0x48) {
    setEntry(idx, new Vec2(x, 256.0), SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, trigger, 1);
    trigger += 900;
    idx += 1;
  }

  // Loop 2: y from 256 to <688, step 72, starting at index 6
  trigger = 5900;
  idx = 6;
  for (let y = 0x100; 0x48 >= 0 ? y < 0x2B0 : y > 0x2B0; y += 0x48) {
    setEntry(idx, new Vec2(688.0, y), SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, trigger, 1);
    trigger += 900;
    idx += 1;
  }

  // Loop 3: x descending from 688, y=688, starting at index 12
  trigger = 11300;
  idx = 12;
  for (const x of [0x2B0, 0x268, 0x220, 0x1D8]) {
    setEntry(idx, new Vec2(x, 688.0), SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, trigger, 1);
    trigger += 900;
    idx += 1;
  }

  // Loop 4: y descending from 688, x=400, starting at index 16
  trigger = 14900;
  idx = 16;
  for (const y of [0x2B0, 0x268, 0x220, 0x1D8]) {
    setEntry(idx, new Vec2(400.0, y), SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, trigger, 1);
    trigger += 900;
    idx += 1;
  }

  // Loop 5: x from 400 to <544, y=400, starting at index 20
  trigger = 18500;
  idx = 20;
  for (let x = 400; 0x48 >= 0 ? x < 0x220 : x > 0x220; x += 0x48) {
    setEntry(idx, new Vec2(x, 400.0), SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, trigger, 1);
    trigger += 900;
    idx += 1;
  }

  // Final fixed entries
  setEntry(22, new Vec2(128.0, 128.0), SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, 22300, 1);
  setEntry(23, new Vec2(896.0, 128.0), SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, 22300, 1);
  setEntry(24, new Vec2(128.0, 896.0), SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, 24300, 1);
  setEntry(25, new Vec2(896.0, 896.0), SpawnId.ALIEN_SPAWNER_CHILD_32_FAST_10, 24300, 1);

  return entries.filter((entry) => entry !== null);
});

export const build2_8LandOfLizards = registerQuest({ level: '2.8', title: 'Land Of Lizards', timeLimitMs: 180000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.SAWED_OFF_SHOTGUN })(function build2_8LandOfLizards(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  return [
    spawn(new Vec2(256.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_RING_24_0E, triggerMs: 2000, count: 1 }),
    spawn(new Vec2(768.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_RING_24_0E, triggerMs: 12000, count: 1 }),
    spawn(new Vec2(256.0, 768.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_RING_24_0E, triggerMs: 22000, count: 1 }),
    spawn(new Vec2(768.0, 768.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_RING_24_0E, triggerMs: 32000, count: 1 }),
  ];
});

export const build2_9GhostPatrols = registerQuest({ level: '2.9', title: 'Ghost Patrols', timeLimitMs: 180000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.VEINS_OF_POISON })(function build2_9GhostPatrols(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width, ctx.height, 128.0);
  entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_RED_FAST_2B, triggerMs: 1500, count: 2 }));
  let trigger = 2500;
  for (let i = 0; i < 12; i++) {
    const x = i % 2 === 0 ? edges.left.x : edges.right.x;
    entries.push(spawn(new Vec2(x, edges.left.y), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_5_19, triggerMs: trigger, count: 1 }));
    trigger += 2500;
  }
  const loopCount = 12;
  entries.push(spawn(new Vec2(-264.0, edges.left.y), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_RED_FAST_2B, triggerMs: (loopCount - 1) * 2500, count: 1 }));
  const specialTrigger = (5 * loopCount + 15) * 500;
  entries.push(spawn(new Vec2(edges.left.x, edges.left.y), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_ALIEN_BRONZE_18, triggerMs: specialTrigger, count: 1 }));
  return entries;
});

export const build2_10Spideroids = registerQuest({ level: '2.10', title: 'Spideroids', timeLimitMs: 360000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.PLASMA_MINIGUN })(function build2_10Spideroids(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries = [spawn(new Vec2(1088.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 1000, count: 1 }), spawn(new Vec2(-64.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 3000, count: 1 }), spawn(new Vec2(1088.0, 256.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 6000, count: 1 })];
  if (fullVersion) {
    entries.push(spawn(new Vec2(1088.0, 762.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 9000, count: 1 }));
    entries.push(spawn(new Vec2(512.0, 1088.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 9000, count: 1 }));
  }
  if (ctx.playerCount >= 2 || fullVersion) {
    entries.push(spawn(new Vec2(-64.0, 762.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 9000, count: 1 }));
  }
  return entries;
});
