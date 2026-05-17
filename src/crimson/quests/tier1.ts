// Port of crimson/quests/tier1.py

import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { SpawnId } from '@crimson/creatures/spawn.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { centerPoint, cornerPoints, edgeMidpoints, headingFromCenter, spawn, spawnAt } from '@crimson/quests/helpers.ts';
import { registerQuest } from '@crimson/quests/registry.ts';
import type { QuestContext } from '@crimson/quests/types.ts';
import { SpawnEntry } from '@crimson/quests/types.ts';
export { QuestContext, SpawnEntry } from '@crimson/quests/types.ts';

export const build1_1LandHostile = registerQuest({ level: '1.1', title: 'Land Hostile', timeLimitMs: 120000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.ASSAULT_RIFLE })(function build1_1LandHostile(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const edges = edgeMidpoints(ctx.width, ctx.height);
  const [topLeft, topRight, bottomLeft, bottomRight] = cornerPoints(ctx.width, ctx.height);
  return [
    spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: 500, count: 1 }),
    spawnAt(bottomLeft, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: 2500, count: 2 }),
    spawnAt(topLeft, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: 6500, count: 3 }),
    spawnAt(topRight, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: 11500, count: 4 }),
  ];
});

export const build1_2MinorAlienBreach = registerQuest({ level: '1.2', title: 'Minor Alien Breach', timeLimitMs: 120000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.SHOTGUN })(function build1_2MinorAlienBreach(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const center = centerPoint(ctx.width, ctx.height);
  const edges = edgeMidpoints(ctx.width, ctx.height);
  const entries = [spawn(new Vec2(256.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: 1000, count: 2 }), spawn(new Vec2(256.0, 128.0), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: 1700, count: 2 })];
  for (let i = 2; i < 18; i++) {
    const trigger = (i * 5 - 10) * 720;
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: trigger, count: 1 }));
    if (i > 6) {
      entries.push(spawn(new Vec2(edges.right.x, center.y - 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: trigger, count: 1 }));
    }
    if (i === 13) {
      entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREY_BRUTE_29, triggerMs: 39600, count: 1 }));
    }
    if (i > 10) {
      entries.push(spawn(new Vec2(edges.left.x, center.y + 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: trigger, count: 1 }));
    }
  }
  return entries;
});

export const build1_3TargetPractice = registerQuest({ level: '1.3', title: 'Target Practice', timeLimitMs: 65000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.URANIUM_FILLED_BULLETS })(function build1_3TargetPractice(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const center = centerPoint(ctx.width, ctx.height);
  const entries: SpawnEntry[] = [];
  let trigger = 2000;
  let step = 2000;
  while (true) {
    const angle = (rng.rand({ caller: RngCallerStatic.QUEST_BUILD_TARGET_PRACTICE_ANGLE }) % 612 * 0.01);
    const radius = (int(rng.rand({ caller: RngCallerStatic.QUEST_BUILD_TARGET_PRACTICE_RADIUS }) % 8) + 2) * 32;
    const point = center.add(Vec2.fromAngle(angle).mul(radius));
    const heading = headingFromCenter(point, center);
    entries.push(spawn(point, { heading: heading, spawnId: SpawnId.ALIEN_AI7_ORBITER_36, triggerMs: trigger, count: 1 }));
    trigger += Math.max(step, 1100);
    step -= 50;
    if (step <= 500) {
      break;
    }
  }
  return entries;
});

export const build1_4FrontlineAssault = registerQuest({ level: '1.4', title: 'Frontline Assault', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.FLAMETHROWER })(function build1_4FrontlineAssault(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width, ctx.height);
  const [topLeft, topRight, bottomLeft, bottomRight] = cornerPoints(ctx.width, ctx.height);
  let step = 2500;
  for (let i = 2; i < 22; i++) {
    let spawnId: SpawnId;
    if (i < 5) {
      spawnId = SpawnId.ALIEN_CONST_PALE_GREEN_26;
    } else if (i < 10) {
      spawnId = SpawnId.AI1_ALIEN_BLUE_TINT_1A;
    } else {
      spawnId = SpawnId.ALIEN_CONST_PALE_GREEN_26;
    }
    const trigger = i * step - 5000;
    entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: spawnId, triggerMs: trigger, count: 1 }));
    if (i > 4) {
      entries.push(spawnAt(topLeft, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: trigger, count: 1 }));
    }
    if (i > 10) {
      entries.push(spawnAt(topRight, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: trigger, count: 1 }));
    }
    if (i === 10) {
      const burstTrigger = (step * 5 - 2500) * 2;
      entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREY_BRUTE_29, triggerMs: burstTrigger, count: 1 }));
      entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREY_BRUTE_29, triggerMs: burstTrigger, count: 1 }));
    }
    step = Math.max(step - 50, 1800);
  }
  return entries;
});

export const build1_5AlienDens = registerQuest({ level: '1.5', title: 'Alien Dens', timeLimitMs: 180000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.DOCTOR })(function build1_5AlienDens(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  return [
    spawn(new Vec2(256.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_SLOW_08, triggerMs: 1500, count: 1 }),
    spawn(new Vec2(768.0, 768.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_SLOW_08, triggerMs: 1500, count: 1 }),
    spawn(new Vec2(512.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_SLOW_08, triggerMs: 23500, count: ctx.playerCount }),
    spawn(new Vec2(256.0, 768.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_SLOW_08, triggerMs: 38500, count: 1 }),
    spawn(new Vec2(768.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_SLOW_08, triggerMs: 38500, count: 1 }),
  ];
});

export const build1_6TheRandomFactor = registerQuest({ level: '1.6', title: 'The Random Factor', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.SUBMACHINE_GUN })(function build1_6TheRandomFactor(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const center = centerPoint(ctx.width, ctx.height);
  const edges = edgeMidpoints(ctx.width, ctx.height);
  let trigger = 1500;
  while (trigger < 101500) {
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_1D, triggerMs: trigger, count: ctx.playerCount * 2 + 4 }));
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_1D, triggerMs: trigger + 200, count: 6 }));
    if (int(rng.rand({ caller: RngCallerStatic.QUEST_BUILD_THE_RANDOM_FACTOR_BRUTE_GATE }) % 5) === 3) {
      entries.push(spawn(new Vec2(center.x, edges.bottom.y), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREY_BRUTE_29, triggerMs: trigger, count: ctx.playerCount }));
    }
    trigger += 10000;
  }
  return entries;
});

export const build1_7SpiderWaveSyndrome = registerQuest({ level: '1.7', title: 'Spider Wave Syndrome', timeLimitMs: 240000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.MONSTER_VISION })(function build1_7SpiderWaveSyndrome(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width, ctx.height);
  let trigger = 1500;
  while (trigger < 100500) {
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_BLUE_40, triggerMs: trigger, count: ctx.playerCount * 2 + 6 }));
    trigger += 5500;
  }
  return entries;
});

export const build1_8AlienSquads = registerQuest({ level: '1.8', title: 'Alien Squads', timeLimitMs: 180000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.GAUSS_GUN })(function build1_8AlienSquads(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries = [spawn(new Vec2(-256.0, 256.0), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 1500, count: 1 }), spawn(new Vec2(-256.0, 768.0), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 2500, count: 1 }), spawn(new Vec2(768.0, -256.0), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 5500, count: 1 }), spawn(new Vec2(768.0, 1280.0), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 8500, count: 1 }), spawn(new Vec2(1280.0, 1280.0), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 14500, count: 1 }), spawn(new Vec2(1280.0, 768.0), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 18500, count: 1 }), spawn(new Vec2(-256.0, 256.0), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 25000, count: 1 }), spawn(new Vec2(-256.0, 768.0), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 30000, count: 1 })];
  let trigger = 36200;
  while (trigger < 83000) {
    entries.push(spawn(new Vec2(-64.0, -64.0), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: trigger - 400, count: 1 }));
    entries.push(spawn(new Vec2(ctx.width + 64.0, ctx.height + 64.0), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_PALE_GREEN_26, triggerMs: trigger, count: 1 }));
    trigger += 1800;
  }
  return entries;
});

export const build1_9NestingGrounds = registerQuest({ level: '1.9', title: 'Nesting Grounds', timeLimitMs: 240000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.HOT_TEMPERED })(function build1_9NestingGrounds(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const center = centerPoint(ctx.width, ctx.height);
  const edges = edgeMidpoints(ctx.width, ctx.height);
  const entries = [spawn(new Vec2(center.x, edges.bottom.y), { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_1D, triggerMs: 1500, count: ctx.playerCount * 2 + 6 }), spawn(new Vec2(256.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_LIMITED_09, triggerMs: 8000, count: 1 }), spawn(new Vec2(512.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_LIMITED_09, triggerMs: 13000, count: 1 }), spawn(new Vec2(768.0, 768.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_LIMITED_09, triggerMs: 18000, count: 1 }), spawn(new Vec2(center.x, edges.bottom.y), { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_1D, triggerMs: 25000, count: ctx.playerCount * 2 + 6 }), spawn(new Vec2(center.x, edges.bottom.y), { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_1D, triggerMs: 39000, count: ctx.playerCount * 3 + 3 }), spawn(new Vec2(384.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_LIMITED_09, triggerMs: 41100, count: 1 }), spawn(new Vec2(640.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_LIMITED_09, triggerMs: 42100, count: 1 }), spawn(new Vec2(512.0, 640.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_LIMITED_09, triggerMs: 43100, count: 1 }), spawn(new Vec2(512.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_SLOW_08, triggerMs: 44100, count: 1 }), spawn(new Vec2(center.x, edges.bottom.y), { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_1E, triggerMs: 50000, count: ctx.playerCount * 2 + 5 }), spawn(new Vec2(center.x, edges.bottom.y), { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_1F, triggerMs: 55000, count: ctx.playerCount * 2 + 2 })];
  return entries;
});

export const build1_10_8LeggedTerror = registerQuest({ level: '1.10', title: '8-legged Terror', timeLimitMs: 240000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.ROCKET_LAUNCHER })(function build1_10_8LeggedTerror(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries = [spawn(new Vec2(ctx.width - 256, Math.floor(ctx.width / 2)), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, triggerMs: 1000, count: 1 })];
  const [topLeft, topRight, bottomLeft, bottomRight] = cornerPoints(ctx.width, ctx.height, 25.0);
  let trigger = 6000;
  while (trigger < 36800) {
    entries.push(spawnAt(topLeft, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_RANDOM_3D, triggerMs: trigger, count: ctx.playerCount }));
    entries.push(spawnAt(topRight, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_RANDOM_3D, triggerMs: trigger, count: 1 }));
    entries.push(spawnAt(bottomLeft, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_RANDOM_3D, triggerMs: trigger, count: ctx.playerCount }));
    entries.push(spawnAt(bottomRight, { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_RANDOM_3D, triggerMs: trigger, count: 1 }));
    trigger += 2200;
  }
  return entries;
});
