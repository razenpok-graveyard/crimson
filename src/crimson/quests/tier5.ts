// Port of crimson/quests/tier5.py

import { Vec2 } from '@grim/geom.ts';
import { SpawnId } from '@crimson/creatures/spawn.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { centerPoint, ringPoints, spawn } from './helpers.ts';
import { registerQuest } from './registry.ts';
import type { QuestContext, SpawnEntry as SpawnEntryType } from './types.ts';

export const build5_1TheBeating = registerQuest({
  level: '5.1',
  title: 'The Beating',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
  unlockWeaponId: WeaponId.ION_SHOTGUN,
})(function build5_1TheBeating(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  const entries: SpawnEntryType[] = [
    spawn(new Vec2(256.0, 256.0), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_WEAPON_BONUS_27, triggerMs: 500, count: 1 }),
    spawn(new Vec2(ctx.width + 32.0, Math.floor(ctx.height / 2)), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREY_BRUTE_29, triggerMs: 8000, count: 3 }),
  ];

  let trigger = 10000;
  let xOffset = 0x40;
  for (let i = 0; i < 8; i++) {
    entries.push(spawn(new Vec2(ctx.width + xOffset, Math.floor(ctx.height / 2)), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREEN_SMALL_25, triggerMs: trigger, count: 8 }));
    trigger += 100;
    xOffset += 0x20;
  }

  entries.push(spawn(new Vec2(-32.0, Math.floor(ctx.height / 2)), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREY_BRUTE_29, triggerMs: 18000, count: 3 }));

  trigger = 20000;
  let x = -64;
  for (let i = 0; i < 8; i++) {
    entries.push(spawn(new Vec2(x, Math.floor(ctx.height / 2)), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_GREEN_SMALL_25, triggerMs: trigger, count: 8 }));
    trigger += 100;
    x -= 32;
  }

  trigger = 40000;
  let y = -64;
  for (let i = 0; i < 6; i++) {
    entries.push(spawn(new Vec2(Math.floor(ctx.width / 2), y), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_BROWN_TRANSPARENT_0F, triggerMs: trigger, count: 4 }));
    trigger += 100;
    y -= 42;
  }

  trigger = 40000;
  y = ctx.width + 0x2C;
  for (let i = 0; i < 6; i++) {
    entries.push(spawn(new Vec2(Math.floor(ctx.width / 2), y), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: trigger, count: 2 }));
    trigger += 100;
    y += 0x20;
  }

  return entries;
});

export const build5_2TheSpankingOfTheDead = registerQuest({
  level: '5.2',
  title: 'The Spanking Of The Dead',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
  unlockPerkId: PerkId.DEATH_CLOCK,
})(function build5_2TheSpankingOfTheDead(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  const entries: SpawnEntryType[] = [
    spawn(new Vec2(256.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_WEAPON_BONUS_27, triggerMs: 500, count: 1 }),
    spawn(new Vec2(768.0, 512.0), { heading: 0.0, spawnId: SpawnId.ALIEN_CONST_WEAPON_BONUS_27, triggerMs: 500, count: 1 }),
  ];

  let trigger = 5000;
  let stepIndex = 0;
  while (trigger < 0xA988) {
    const angle = stepIndex * 0.33333334;
    const radius = 512.0 - stepIndex * 3.8;
    const pos = Vec2.fromPolar(angle, radius).offset({ dx: 512.0, dy: 512.0 });
    entries.push(spawn(pos, { heading: angle, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count: 1 }));
    trigger += 300;
    stepIndex += 1;
  }

  const offset = stepIndex * 300;
  entries.push(spawn(new Vec2(1280.0, 512.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_CONST_GREY_42, triggerMs: offset + 10000, count: 16 }));
  entries.push(spawn(new Vec2(-256.0, 512.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_CONST_GREY_42, triggerMs: offset + 20000, count: 16 }));
  return entries;
});

export const build5_3TheFortress = registerQuest({
  level: '5.3',
  title: 'The Fortress',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
  unlockPerkId: PerkId.MY_FAVOURITE_WEAPON,
})(function build5_3TheFortress(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  const entries: SpawnEntryType[] = [
    spawn(new Vec2(-50.0, Math.floor(ctx.height / 2)), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_BLUE_40, triggerMs: 100, count: 6 }),
  ];

  let trigger = 1100;
  let ySeed = 0x200;
  while (trigger < 0x14B4) {
    const y = ySeed * 0.125 + 256.0;
    entries.push(spawn(new Vec2(768.0, y), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_1D_LIMITED_09, triggerMs: trigger, count: 1 }));
    trigger += 600;
    ySeed += 0x200;
  }

  let entryCount = 8;
  let xSeed = 0x180;
  while (xSeed < 0x901) {
    trigger = entryCount * 600 + 0x157C;
    for (let row = 1; row <= 6; row++) {
      if (row !== 1 || (xSeed !== 0x480 && xSeed !== 0x600)) {
        const xVal = xSeed * 0.16666667 + 256.0;
        const yVal = 512.0 - (row * 0x180) * 0.16666667;
        entries.push(spawn(new Vec2(xVal, yVal), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: trigger, count: 1 }));
        trigger += 600;
        entryCount += 1;
      }
    }
    xSeed += 0x180;
  }

  return entries;
});

export const build5_4TheGangWars = registerQuest({
  level: '5.4',
  title: 'The Gang Wars',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
  unlockWeaponId: WeaponId.GAUSS_SHOTGUN,
})(function build5_4TheGangWars(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  const entries: SpawnEntryType[] = [
    spawn(new Vec2(-150.0, Math.floor(ctx.height / 2)), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 100, count: 1 }),
    spawn(new Vec2(1174.0, Math.floor(ctx.height / 2)), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: 2500, count: 1 }),
  ];

  let trigger = 5500;
  for (let i = 0; i < 10; i++) {
    entries.push(spawn(new Vec2(1174.0, Math.floor(ctx.height / 2)), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: trigger, count: 2 }));
    trigger += 4000;
  }

  entries.push(spawn(new Vec2(512.0, 1152.0), { heading: 0.0, spawnId: SpawnId.FORMATION_CHAIN_ALIEN_10_13, triggerMs: 50500, count: 1 }));

  trigger = 59500;
  while (trigger < 0x184AC) {
    entries.push(spawn(new Vec2(-150.0, Math.floor(ctx.height / 2)), { heading: 0.0, spawnId: SpawnId.FORMATION_RING_ALIEN_8_12, triggerMs: trigger, count: 2 }));
    trigger += 4000;
  }

  entries.push(spawn(new Vec2(512.0, 1152.0), { heading: 0.0, spawnId: SpawnId.FORMATION_CHAIN_ALIEN_10_13, triggerMs: 107500, count: 3 }));
  return entries;
});

export const build5_5KneeDeepInTheDead = registerQuest({
  level: '5.5',
  title: 'Knee-deep in the Dead',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
  unlockPerkId: PerkId.BANDAGE,
})(function build5_5KneeDeepInTheDead(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  const entries: SpawnEntryType[] = [
    spawn(new Vec2(-50.0, ctx.height * 0.5), { heading: 0.0, spawnId: SpawnId.ZOMBIE_CONST_GREEN_BRUTE_43, triggerMs: 100, count: 1 }),
  ];

  let trigger = 500;
  let wave = 0;
  while (trigger < 0x178F4) {
    if (wave % 8 === 0) {
      entries.push(spawn(new Vec2(-50.0, ctx.height * 0.5), { heading: 0.0, spawnId: SpawnId.ZOMBIE_CONST_GREEN_BRUTE_43, triggerMs: trigger - 2, count: 1 }));
    }
    const count = wave > 0x20 ? 2 : 1;
    entries.push(spawn(new Vec2(-50.0, ctx.height * 0.5), { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger, count }));
    if (trigger > 0x30D4) {
      entries.push(spawn(new Vec2(-50.0, ctx.height * 0.5 + 158.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger + 500, count: 1 }));
    }
    if (trigger > 0x5FB4) {
      entries.push(spawn(new Vec2(-50.0, ctx.height * 0.5 - 158.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_RANDOM_41, triggerMs: trigger + 1000, count: 1 }));
    }
    if (trigger > 0x8E94) {
      entries.push(spawn(new Vec2(-50.0, ctx.height * 0.5 - 258.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_CONST_GREY_42, triggerMs: trigger + 0x514, count: 1 }));
    }
    if (trigger > 0xBD74) {
      entries.push(spawn(new Vec2(-50.0, ctx.height * 0.5 + 258.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_CONST_GREY_42, triggerMs: trigger + 300, count: 1 }));
    }
    trigger += 0x5DC;
    wave += 1;
  }

  return entries;
});

export const build5_6CrossFire = registerQuest({
  level: '5.6',
  title: 'Cross Fire',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
  unlockPerkId: PerkId.ANGRY_RELOADER,
})(function build5_6CrossFire(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  return [
    spawn(new Vec2(1074.0, ctx.height * 0.5), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_BLUE_40, triggerMs: 100, count: 6 }),
    spawn(new Vec2(-40.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 5500, count: 4 }),
    spawn(new Vec2(-40.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 15500, count: 6 }),
    spawn(new Vec2(512.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 18500, count: 2 }),
    spawn(new Vec2(-100.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 25500, count: 8 }),
    spawn(new Vec2(512.0, 1152.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_BLUE_40, triggerMs: 26000, count: 6 }),
    spawn(new Vec2(512.0, -128.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_BLUE_40, triggerMs: 26000, count: 6 }),
  ];
});

export const build5_7ArmyOfThree = registerQuest({
  level: '5.7',
  title: 'Army of Three',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
})(function build5_7ArmyOfThree(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  return [
    spawn(new Vec2(-64.0, 256.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_ALIEN_WHITE_15, triggerMs: 500, count: 1 }),
    spawn(new Vec2(-64.0, 512.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_ALIEN_WHITE_15, triggerMs: 5500, count: 1 }),
    spawn(new Vec2(-64.0, 768.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_ALIEN_WHITE_15, triggerMs: 15000, count: 1 }),
    spawn(new Vec2(-64.0, 768.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_SPIDER_SP1_WHITE_17, triggerMs: 19500, count: 1 }),
    spawn(new Vec2(-64.0, 512.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_SPIDER_SP1_WHITE_17, triggerMs: 22500, count: 1 }),
    spawn(new Vec2(-64.0, 256.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_SPIDER_SP1_WHITE_17, triggerMs: 26500, count: 1 }),
    spawn(new Vec2(-64.0, 256.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_LIZARD_WHITE_16, triggerMs: 35500, count: 1 }),
    spawn(new Vec2(-64.0, 512.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_LIZARD_WHITE_16, triggerMs: 39500, count: 1 }),
    spawn(new Vec2(-64.0, 768.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_LIZARD_WHITE_16, triggerMs: 42500, count: 1 }),
    spawn(new Vec2(512.0, 1152.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_ALIEN_WHITE_15, triggerMs: 52500, count: 3 }),
    spawn(new Vec2(512.0, -256.0), { heading: 0.0, spawnId: SpawnId.FORMATION_GRID_SPIDER_SP1_WHITE_17, triggerMs: 56500, count: 3 }),
  ];
});

export const build5_8MonsterBlues = registerQuest({
  level: '5.8',
  title: 'Monster Blues',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
  unlockPerkId: PerkId.ION_GUN_MASTER,
})(function build5_8MonsterBlues(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  const entries: SpawnEntryType[] = [
    spawn(new Vec2(-50.0, ctx.height * 0.5), { heading: 0.0, spawnId: SpawnId.LIZARD_RANDOM_04, triggerMs: 500, count: 10 }),
    spawn(new Vec2(1074.0, ctx.height * 0.5), { heading: 0.0, spawnId: SpawnId.ALIEN_RANDOM_06, triggerMs: 7500, count: 10 }),
    spawn(new Vec2(512.0, 1088.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_RANDOM_03, triggerMs: 17500, count: 12 }),
    spawn(new Vec2(512.0, -64.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_RANDOM_03, triggerMs: 17500, count: 12 }),
  ];

  let trigger = 27500;
  for (let idx = 0; idx < 0x40; idx++) {
    let sid: SpawnId;
    if (idx % 4 === 0) {
      sid = SpawnId.ALIEN_RANDOM_06;
    } else if (idx % 4 === 1) {
      sid = SpawnId.SPIDER_SP1_RANDOM_03;
    } else {
      sid = SpawnId.SPIDER_SP2_RANDOM_05;
    }
    const count = Math.floor(idx / 8) + 2;
    entries.push(spawn(new Vec2(-64.0, 512.0), { heading: 0.0, spawnId: sid, triggerMs: trigger, count }));
    trigger += 900;
  }
  return entries;
});

export const build5_9Nagolipoli = registerQuest({
  level: '5.9',
  title: 'Nagolipoli',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
  unlockPerkId: PerkId.STATIONARY_RELOADER,
})(function build5_9Nagolipoli(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  const entries: SpawnEntryType[] = [];

  const center = centerPoint(ctx.width, ctx.height);
  for (const [pos, angle] of ringPoints(center, 128.0, 8, { step: 0.7853982 })) {
    entries.push(spawn(pos, { heading: angle, spawnId: SpawnId.SPIDER_SP1_CONST_BLUE_40, triggerMs: 2000, count: 1 }));
  }

  for (const [pos, angle] of ringPoints(center, 178.0, 12, { step: 0.5235988 })) {
    entries.push(spawn(pos, { heading: angle, spawnId: SpawnId.SPIDER_SP1_CONST_BLUE_40, triggerMs: 8000, count: 1 }));
  }

  let trigger = 13000;
  let wave = 0;
  while (trigger < 0x96C8) {
    const count = Math.floor(wave / 8) + 1;
    entries.push(spawn(new Vec2(-64.0, -64.0), { heading: 1.0471976, spawnId: SpawnId.AI1_LIZARD_BLUE_TINT_1C, triggerMs: trigger, count }));
    entries.push(spawn(new Vec2(1088.0, -64.0), { heading: -1.0471976, spawnId: SpawnId.AI1_LIZARD_BLUE_TINT_1C, triggerMs: trigger, count }));
    entries.push(spawn(new Vec2(-64.0, 1088.0), { heading: -1.0471976, spawnId: SpawnId.AI1_LIZARD_BLUE_TINT_1C, triggerMs: trigger, count }));
    entries.push(spawn(new Vec2(1088.0, 1088.0), { heading: 3.926991, spawnId: SpawnId.AI1_LIZARD_BLUE_TINT_1C, triggerMs: trigger, count }));
    trigger += 800;
    wave += 1;
  }

  const lastWave = Math.max(wave - 1, 0);
  let baseLeft = (lastWave + 0x97 + wave * 4) * 0xA0;
  for (let idx = 0; idx < 6; idx++) {
    const y = idx * 85.333336 + 256.0;
    entries.push(spawn(new Vec2(64.0, y), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: baseLeft, count: 1 }));
    baseLeft += 100;
  }

  let baseRight = wave * 800 + 25000;
  for (let idx = 0; idx < 6; idx++) {
    const y = idx * 85.333336 + 256.0;
    entries.push(spawn(new Vec2(960.0, y), { heading: 0.0, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_32_SLOW_0A, triggerMs: baseRight, count: 1 }));
    baseRight += 100;
  }

  const baseMid = (lastWave + 0xB0 + wave * 4) * 0xA0;
  entries.push(spawn(new Vec2(512.0, 256.0), { heading: Math.PI, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_3C_SLOW_0B, triggerMs: baseMid, count: 1 }));
  entries.push(spawn(new Vec2(512.0, 768.0), { heading: Math.PI, spawnId: SpawnId.ALIEN_SPAWNER_CHILD_3C_SLOW_0B, triggerMs: baseMid, count: 1 }));

  const baseVertical = wave * 800 + 0x6F54;
  entries.push(spawn(new Vec2(512.0, 1088.0), { heading: 3.926991, spawnId: SpawnId.AI1_LIZARD_BLUE_TINT_1C, triggerMs: baseVertical, count: 8 }));
  entries.push(spawn(new Vec2(512.0, -64.0), { heading: 3.926991, spawnId: SpawnId.AI1_LIZARD_BLUE_TINT_1C, triggerMs: baseVertical, count: 8 }));
  return entries;
});

export const build5_10TheGathering = registerQuest({
  level: '5.10',
  title: 'The Gathering',
  timeLimitMs: 480000,
  startWeaponId: WeaponId.PISTOL,
  unlockWeaponId: WeaponId.PLASMA_CANNON,
})(function build5_10TheGathering(ctx: QuestContext, { rng, fullVersion = true }): SpawnEntryType[] {
  return [
    spawn(new Vec2(256.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 500, count: 1 }),
    spawn(new Vec2(768.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 9500, count: 2 }),
    spawn(new Vec2(256.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, triggerMs: 15500, count: 2 }),
    spawn(new Vec2(768.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, triggerMs: 24500, count: 2 }),
    spawn(new Vec2(256.0, 512.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_BOSS_SPAWNER_00, triggerMs: 30500, count: 2 }),
    spawn(new Vec2(768.0, 512.0), { heading: 0.0, spawnId: SpawnId.ZOMBIE_BOSS_SPAWNER_00, triggerMs: 39500, count: 2 }),
    spawn(new Vec2(64.0, 64.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 54500, count: 2 }),
    spawn(new Vec2(960.0, 64.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 54500, count: 1 }),
    spawn(new Vec2(64.0, 960.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 54500, count: 2 }),
    spawn(new Vec2(960.0, 960.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C, triggerMs: 54500, count: 1 }),
    spawn(new Vec2(-128.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP1_CONST_SHOCK_BOSS_3A, triggerMs: 90500, count: 6 }),
    spawn(new Vec2(1152.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 99500, count: 4 }),
    spawn(new Vec2(1152.0, 512.0), { heading: 0.0, spawnId: SpawnId.SPIDER_SP2_SPLITTER_01, triggerMs: 109500, count: 2 }),
  ];
});
