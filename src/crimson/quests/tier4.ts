// Port of crimson/quests/tier4.py

import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { SpawnId } from '@crimson/creatures/spawn.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { centerPoint, edgeMidpoints, ringPoints, spawn, spawnAt } from '@crimson/quests/helpers.ts';
import { registerQuest } from '@crimson/quests/registry.ts';
import type { QuestContext } from '@crimson/quests/types.ts';
import { SpawnEntry } from '@crimson/quests/types.ts';
export { QuestContext, SpawnEntry } from '@crimson/quests/types.ts';

export const build4_1MajorAlienBreach = registerQuest({ level: '4.1', title: 'Major Alien Breach', timeLimitMs: 300000, startWeaponId: WeaponId.ROCKET_MINIGUN, unlockPerkId: PerkId.JINXED })(function build4_1MajorAlienBreach(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width);
  let trigger = 4000;
  for (let offset = 0; 0xF >= 0 ? offset < 0x5DC : offset > 0x5DC; offset += 0xF) {
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_GREEN_20, triggerMs: trigger, count: 2 }));
    entries.push(spawnAt(edges.top, { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_GREEN_20, triggerMs: trigger, count: 2 }));
    trigger += 2000 - offset;
    if (trigger < 1000) {
      trigger = 1000;
    }
  }
  return entries;
});

export const build4_2ZombieTime = registerQuest({ level: '4.2', title: 'Zombie Time', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.PULSE_GUN })(function build4_2ZombieTime(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width);
  let trigger = 1500;
  while (trigger < 0x17CDC) {
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: 8 }));
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: 8 }));
    trigger += 8000;
  }
  return entries;
});

export const build4_3LizardZombiePact = registerQuest({ level: '4.3', title: 'Lizard Zombie Pact', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.PERK_MASTER })(function build4_3LizardZombiePact(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width);
  let trigger = 1500;
  let wave = 0;
  while (trigger < 0x1BB5C) {
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: 6 }));
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: 6 }));
    if (wave % 5 === 0) {
      const idx = Math.floor(wave / 5);
      entries.push(spawn(new Vec2(356.0, (idx * 0xB4 + 0x100)), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_FAST_0C, triggerMs: trigger, count: idx + 1 }));
      entries.push(spawn(new Vec2(356.0, (idx * 0xB4 + 0x180)), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_31_FAST_0C, triggerMs: trigger, count: idx + 2 }));
    }
    trigger += 7000;
    wave += 1;
  }
  return entries;
});

export const build4_4TheCollaboration = registerQuest({ level: '4.4', title: 'The Collaboration', timeLimitMs: 360000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.PLASMA_SHOTGUN })(function build4_4TheCollaboration(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width);
  let trigger = 1500;
  let wave = 0;
  while (trigger < 0x2B55C) {
    const count = int(wave * 0.8 + 7);
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.AI1_ALIEN_BLUE_TINT_1A, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.AI1_SPIDER_SP1_BLUE_TINT_1B, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.AI1_LIZARD_BLUE_TINT_1C, triggerMs: trigger, count: count }));
    entries.push(spawnAt(edges.top, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: count }));
    trigger += 11000;
    wave += 1;
  }
  return entries;
});

export const build4_5TheMassacre = registerQuest({ level: '4.5', title: 'The Massacre', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.REFLEX_BOOSTED })(function build4_5TheMassacre(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const edges = edgeMidpoints(ctx.width);
  const edgesWide = edgeMidpoints(ctx.width, undefined, 128.0);
  let trigger = 1500;
  let wave = 0;
  while (trigger < 0x1656C) {
    entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: wave + 3 }));
    if (wave % 2 === 0) {
      entries.push(spawnAt(edgesWide.right, { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_RED_FAST_2B, triggerMs: trigger, count: wave + 1 }));
    }
    trigger += 5000;
    wave += 1;
  }
  return entries;
});

export const build4_6TheUnblitzkrieg = registerQuest({ level: '4.6', title: 'The Unblitzkrieg', timeLimitMs: 600000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.MINI_ROCKET_SWARMERS })(function build4_6TheUnblitzkrieg(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const spawnIdFor = (toggle: boolean): SpawnId => {
    return toggle ? SpawnId.ALIEN_SPAWNER_CHILD_31_SLOW_0D : SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07;
  };

  const entries: SpawnEntry[] = [];
  let trigger = 500;

  let iVar5 = 0;
  for (let idx = 0; idx < 10; idx++) {
    let y = (Math.floor(iVar5 / 10) + 200);
    entries.push(spawn(new Vec2(824.0, y), { heading: 0.0, spawnId: spawnIdFor(idx % 2 === 1), triggerMs: trigger, count: 1 }));
    trigger += 1800;
    iVar5 += 0x270;
  }

  iVar5 = 0;
  let toggle = false;
  for (let i = 0; i < 10; i++) {
    let x = (0x338 - Math.floor(iVar5 / 10));
    entries.push(spawn(new Vec2(x, 824.0), { heading: 0.0, spawnId: spawnIdFor(toggle), triggerMs: trigger, count: 1 }));
    trigger += 1500;
    toggle = !toggle;
    iVar5 += 0x270;
  }

  entries.push(spawn(new Vec2(512.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: trigger, count: 1 }));

  iVar5 = 0;
  toggle = false;
  for (let i = 0; i < 10; i++) {
    let y = (0x338 - Math.floor(iVar5 / 10));
    entries.push(spawn(new Vec2(200.0, y), { heading: 0.0, spawnId: spawnIdFor(toggle), triggerMs: trigger, count: 1 }));
    trigger += 1200;
    toggle = !toggle;
    iVar5 += 0x270;
  }

  iVar5 = 0;
  toggle = false;
  for (let i = 0; i < 10; i++) {
    let x = (Math.floor(iVar5 / 10) + 200);
    entries.push(spawn(new Vec2(x, 200.0), { heading: 0.0, spawnId: spawnIdFor(toggle), triggerMs: trigger, count: 1 }));
    trigger += 800;
    toggle = !toggle;
    iVar5 += 0x270;
  }

  iVar5 = 0;
  toggle = false;
  for (let i = 0; i < 10; i++) {
    let y = (Math.floor(iVar5 / 10) + 200);
    entries.push(spawn(new Vec2(824.0, y), { heading: 0.0, spawnId: spawnIdFor(toggle), triggerMs: trigger, count: 1 }));
    trigger += 800;
    toggle = !toggle;
    iVar5 += 0x270;
  }

  iVar5 = 0;
  toggle = false;
  for (let i = 0; i < 10; i++) {
    let x = (0x338 - Math.floor(iVar5 / 10));
    entries.push(spawn(new Vec2(x, 824.0), { heading: 0.0, spawnId: spawnIdFor(toggle), triggerMs: trigger, count: 1 }));
    trigger += 700;
    toggle = !toggle;
    iVar5 += 0x270;
  }

  iVar5 = 0;
  toggle = false;
  for (let i = 0; i < 10; i++) {
    let y = (0x338 - Math.floor(iVar5 / 10));
    entries.push(spawn(new Vec2(200.0, y), { heading: 0.0, spawnId: spawnIdFor(toggle), triggerMs: trigger, count: 1 }));
    trigger += 700;
    toggle = !toggle;
    iVar5 += 0x270;
  }

  iVar5 = 0;
  toggle = false;
  for (let i = 0; i < 10; i++) {
    let x = (Math.floor(iVar5 / 10) + 200);
    entries.push(spawn(new Vec2(x, 200.0), { heading: 0.0, spawnId: spawnIdFor(toggle), triggerMs: trigger, count: 1 }));
    trigger += 800;
    toggle = !toggle;
    iVar5 += 0x270;
  }
  return entries;
});

export const build4_7Gauntlet = registerQuest({ level: '4.7', title: 'Gauntlet', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.GREATER_REGENERATION })(function build4_7Gauntlet(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const playerCount = ctx.playerCount + (fullVersion ? 4 : 0);
  const center = centerPoint(ctx.width, ctx.height);
  const edges = edgeMidpoints(ctx.width);

  const ringCount = playerCount + 9;
  let trigger: number;
  if (ringCount > 0) {
    trigger = 0;
    for (let [pos, angle] of ringPoints(center, 158.0, ringCount)) {
      entries.push(spawn(pos, { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: trigger, count: 1 }));
      trigger += 200;
    }
  }

  if (ringCount > 0) {
    trigger = 4000;
    for (let count = 2; count < ringCount + 2; count++) {
      entries.push(spawnAt(edges.right, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: count }));
      entries.push(spawnAt(edges.left, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: count }));
      entries.push(spawnAt(edges.bottom, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: count }));
      entries.push(spawnAt(edges.top, { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: count }));
      trigger += 5500;
    }
  }

  const outerCount = playerCount + 0x11;
  if (outerCount > 0) {
    trigger = 42500;
    for (let [pos, angle] of ringPoints(center, 258.0, outerCount)) {
      entries.push(spawn(pos, { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: trigger, count: 1 }));
      trigger += 500;
    }
  }
  return entries;
});

export const build4_8SyntaxTerror = registerQuest({ level: '4.8', title: 'Syntax Terror', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.ION_MINIGUN })(function build4_8SyntaxTerror(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const playerCount = ctx.playerCount + (fullVersion ? 4 : 0);
  let outerSeed = 0x14C9;
  let outerIndex = 0;
  let triggerBase = 1500;
  while (outerSeed < 0x159D) {
    let trigger: any;
    let innerSeed: number;
    if (playerCount + 9 > 0) {
      trigger = triggerBase;
      innerSeed = 0x4C5;
      for (let i = 0; i < playerCount + 9; i++) {
        const x = ((((i * i * 0x4C + 0xEC) * i + outerSeed * outerIndex) + 0x380) % 0x380) + 0x40;
        const y = (((innerSeed * i + (outerIndex * outerIndex * 0x4C + 0x1B) * outerIndex) + 0x380) % 0x380) + 0x40;
        entries.push(spawn(new Vec2(x, y), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: trigger, count: 1 }));
        trigger += 300;
        innerSeed += 0x15;
      }
      triggerBase += 30000;
    }
    outerSeed += 0x35;
    outerIndex += 1;
  }
  return entries;
});

export const build4_9TheAnnihilation = registerQuest({ level: '4.9', title: 'The Annihilation', timeLimitMs: 300000, startWeaponId: WeaponId.PISTOL, unlockPerkId: PerkId.BREATHING_ROOM })(function build4_9TheAnnihilation(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [];
  const halfW = Math.floor(ctx.width / 2);
  entries.push(spawn(new Vec2(128.0, halfW), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_RED_FAST_2B, triggerMs: 500, count: 2 }));

  let trigger = 500;
  let iVar5 = 0;
  for (let idx = 0; idx < 12; idx++) {
    let y = (Math.floor(iVar5 / 12) + 0x80);
    let x = idx % 2 === 0 ? 832.0 : 896.0;
    entries.push(spawn(new Vec2(x, y), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: trigger, count: 1 }));
    trigger += 500;
    iVar5 += 0x300;
  }

  trigger = 45000;
  iVar5 = 0;
  let toggle = false;
  for (let i = 0; i < 12; i++) {
    let y = (Math.floor(iVar5 / 12) + 0x80);
    let x = toggle ? 832.0 : 896.0;
    entries.push(spawn(new Vec2(x, y), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: trigger, count: 1 }));
    trigger += 300;
    toggle = !toggle;
    iVar5 += 0x300;
  }
  return entries;
});

export const build4_10TheEndOfAll = registerQuest({ level: '4.10', title: 'The End of All', timeLimitMs: 480000, startWeaponId: WeaponId.PISTOL, unlockWeaponId: WeaponId.ION_CANNON })(function build4_10TheEndOfAll(ctx: QuestContext, opts: { rng: CrandLike; fullVersion?: boolean }): SpawnEntry[] {
  const rng = opts.rng;
  const fullVersion = opts.fullVersion ?? true;
  const entries: SpawnEntry[] = [
    spawn(new Vec2(128.0, 128.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 3000, count: 1 }),
    spawn(new Vec2(896.0, 128.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 6000, count: 1 }),
    spawn(new Vec2(128.0, 896.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 9000, count: 1 }),
    spawn(new Vec2(896.0, 896.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 12000, count: 1 }),
  ];

  const center = centerPoint(ctx.width, ctx.height);
  const edgesWide = edgeMidpoints(ctx.width, ctx.height, 128.0);

  let trigger = 13000;
  for (let [pos, angle] of ringPoints(center, 80.0, 6, { step: 1.0471976 })) {
    entries.push(spawn(pos, { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: trigger, count: 1 }));
    trigger += 300;
  }

  entries.push(spawn(new Vec2(512.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_3C_SLOW_0B, triggerMs: trigger, count: 1 }));

  trigger = 18000;
  let y = 0x100;
  let toggle = false;
  let x: any;
  while (y < 0x300) {
    x = toggle ? edgesWide.right.x : edgesWide.left.x;
    entries.push(spawn(new Vec2(x, y), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: trigger, count: 2 }));
    trigger += 1000;
    toggle = !toggle;
    y += 0x80;
  }

  trigger = 43000;
  for (let [pos, angle] of ringPoints(center, 80.0, 6, { step: 1.0471976, start: 0.5235988 })) {
    entries.push(spawn(pos, { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: trigger, count: 1 }));
    trigger += 300;
  }

  if (fullVersion) {
    trigger = 62800;
    for (let [pos, angle] of ringPoints(center, 180.0, 12, { step: 0.5235988, start: 0.5235988 })) {
      entries.push(spawn(pos, { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_FAST_07, triggerMs: trigger, count: 1 }));
      trigger += 500;
    }
  }

  trigger = 48000;
  y = 0x100;
  toggle = false;
  while (y < 0x300) {
    x = toggle ? edgesWide.right.x : edgesWide.left.x;
    entries.push(spawn(new Vec2(x, y), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: trigger, count: 2 }));
    trigger += 1000;
    toggle = !toggle;
    y += 0x80;
  }

  return entries;
});
