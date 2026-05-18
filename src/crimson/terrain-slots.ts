// Port of crimson/terrain_slots.py

import { TextureId } from '@grim/assets.ts';
import type { CrandLike } from '@grim/rand.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';

export type TerrainSlotTriplet = [number, number, number];

export const Q1_TERRAIN_SLOTS: TerrainSlotTriplet = [0, 1, 0] as const;
export const Q2_TERRAIN_SLOTS: TerrainSlotTriplet = [2, 3, 2] as const;
export const Q3_TERRAIN_SLOTS: TerrainSlotTriplet = [4, 5, 4] as const;
export const Q4_TERRAIN_SLOTS: TerrainSlotTriplet = [6, 7, 6] as const;
export const DEFAULT_TERRAIN_SLOTS: TerrainSlotTriplet = Q1_TERRAIN_SLOTS;
export const UNLOCK_TERRAIN_SLOTS: Map<number, TerrainSlotTriplet> = new Map([
  [40, Q4_TERRAIN_SLOTS], // after quest 4.10 "The End of All"
  [30, Q3_TERRAIN_SLOTS], // after quest 3.10 "Zombie Masters"
  [20, Q2_TERRAIN_SLOTS], // after quest 2.10 "Spideroids"
]);
const TEXTURE_ID_BY_TERRAIN_SLOT: Map<number, TextureId> = new Map([
  [0, TextureId.TER_Q1_BASE],
  [1, TextureId.TER_Q1_OVERLAY],
  [2, TextureId.TER_Q2_BASE],
  [3, TextureId.TER_Q2_OVERLAY],
  [4, TextureId.TER_Q3_BASE],
  [5, TextureId.TER_Q3_OVERLAY],
  [6, TextureId.TER_Q4_BASE],
  [7, TextureId.TER_Q4_OVERLAY],
]);

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export function terrainSlotsForQuest(level: QuestLevel): TerrainSlotTriplet {
  if (level.major <= 4) {
    const base = (level.major - 1) * 2;
    const alt = base + 1;
    if (level.minor < 6) {
      return [base, alt, base];
    }
    return [base, base, alt];
  }
  return [level.minor & 3, 1, 3];
}

export function chooseUnlockTerrainSlots(opts: { unlockIndex: number; rng: CrandLike }): TerrainSlotTriplet {
  // Keep the thresholds descending to preserve the native chained 1/8 roll order.
  const unlockIndex = opts.unlockIndex;
  const rng = opts.rng;
  for (let [threshold, slots] of UNLOCK_TERRAIN_SLOTS.entries()) {
    let caller = null;
    if (threshold === 40) {
      caller = RngCallerStatic.UNLOCK_TERRAIN_Q4;
    } else if (threshold === 30) {
      caller = RngCallerStatic.UNLOCK_TERRAIN_Q3;
    } else if (threshold === 20) {
      caller = RngCallerStatic.UNLOCK_TERRAIN_Q2;
    }
    if (unlockIndex >= threshold && (rng.rand({ caller: caller }) & 7) === 3) {
      return slots;
    }
  }
  return DEFAULT_TERRAIN_SLOTS;
}

export function terrainSlotsToTextureIds(slots: TerrainSlotTriplet): [TextureId, TextureId, TextureId] {
  return [mapGetOrThrow(TEXTURE_ID_BY_TERRAIN_SLOT, slots[0]), mapGetOrThrow(TEXTURE_ID_BY_TERRAIN_SLOT, slots[1]), mapGetOrThrow(TEXTURE_ID_BY_TERRAIN_SLOT, slots[2])];
}

export function resolveTerrainSlots<T>(slots: TerrainSlotTriplet, lookup: (arg0: TextureId) => T): [T, T, T] {
  const [baseId, overlayId, detailId] = terrainSlotsToTextureIds(slots);
  return [lookup(baseId), lookup(overlayId), lookup(detailId)];
}
