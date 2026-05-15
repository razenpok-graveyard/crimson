// Port of crimson/quests/registry.py

import type { TerrainSlotTriplet } from '@crimson/terrain-slots.ts';
import { terrainSlotsForQuest } from '@crimson/terrain-slots.ts';
import type { WeaponId } from '@crimson/weapons.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import type { QuestBuilder } from '@crimson/quests/types.ts';
import { QuestDefinition } from '@crimson/quests/types.ts';

const quests: Map<string, QuestDefinition> = new Map();

export function registerQuest(opts: { level: string; title: string; timeLimitMs: number; startWeaponId: WeaponId; unlockPerkId?: number | null; unlockWeaponId?: WeaponId | null; terrainSlots?: TerrainSlotTriplet | null }): (arg0: QuestBuilder) => QuestBuilder {
  const level = opts.level;
  const title = opts.title;
  const timeLimitMs = opts.timeLimitMs;
  const startWeaponId = opts.startWeaponId;
  const unlockPerkId = opts.unlockPerkId ?? null;
  const unlockWeaponId = opts.unlockWeaponId ?? null;
  const terrainSlots = opts.terrainSlots ?? null;
  function builderName(builderFn: QuestBuilder): string {
    return builderFn.name || String(builderFn);
  }

  function decorator(builder: QuestBuilder): QuestBuilder {
    const questLevel = QuestLevel.parse(level);
    const resolvedTerrainSlots = terrainSlots !== null ? terrainSlots : terrainSlotsForQuest(questLevel);
    const normalizedUnlockWeaponId = unlockWeaponId !== null ? unlockWeaponId : null;
    const quest = new QuestDefinition({ level: questLevel, title: title, builder: builder, timeLimitMs: timeLimitMs, startWeaponId: startWeaponId, unlockPerkId: unlockPerkId, unlockWeaponId: normalizedUnlockWeaponId, terrainSlots: resolvedTerrainSlots });
    const existing = quests.get(quest.level.text) ?? null;
    if (existing !== null) {
      throw new Error(`duplicate quest level ${quest.level.text}: ${builderName(existing.builder)} vs ${builderName(builder)}`);
    }
    quests.set(quest.level.text, quest);
    return builder;
  }

  return decorator;
}

export function allQuests(): QuestDefinition[] {
  return Array.from(quests.values()).sort((left, right) => left.level.globalIndex < right.level.globalIndex ? -1 : left.level.globalIndex > right.level.globalIndex ? 1 : 0);
}

export function questByLevel(level: QuestLevel): QuestDefinition | null {
  return quests.get(level.text) ?? null;
}
