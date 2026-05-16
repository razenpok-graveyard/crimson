// Port of crimson/weapon_usage.py

import { WeaponId } from '@crimson/weapons.ts';

export type WeaponUsageCount = number;
export type WeaponUsageCounts = readonly WeaponUsageCount[];

function validateWeaponUsageCount(value: number): WeaponUsageCount {
  if (value < 0) {
    throw new Error('invalid WeaponUsageCount');
  }
  return value;
}

function validateWeaponUsageCounts(value: readonly WeaponUsageCount[]): WeaponUsageCounts {
  if (value.length < WEAPON_USAGE_SLOT_COUNT || value.length > WEAPON_USAGE_SLOT_COUNT) {
    throw new Error('invalid WeaponUsageCounts');
  }
  return value;
}

// Save-status stores 53 u32 entries:
// - slot 0 is unused
// - tracked weapon ids map 1:1 to slots 1..52
// - weapon id 53 has no safe slot in this table
export const WEAPON_USAGE_SLOT_COUNT = 53;
export const WEAPON_USAGE_TRACKED_WEAPON_ID_MIN = Math.trunc(WeaponId.PISTOL);
export const WEAPON_USAGE_TRACKED_WEAPON_ID_MAX = WEAPON_USAGE_SLOT_COUNT - 1;
export const ZERO_WEAPON_USAGE_COUNTS: WeaponUsageCounts = Array.from({ length: Math.max(0, WEAPON_USAGE_SLOT_COUNT) }, (_, i) => i).map((_) => 0);

export function weaponUsageSlotForWeaponId(weaponId: number): number | null {
  // Map a weapon id to save-status usage slot, or `None` if untracked.

  weaponId = Math.trunc(weaponId);
  if (WEAPON_USAGE_TRACKED_WEAPON_ID_MIN <= weaponId && weaponId <= WEAPON_USAGE_TRACKED_WEAPON_ID_MAX) {
    return weaponId;
  }
  return null;
}

export function normalizeWeaponUsageCounts(values: unknown): WeaponUsageCounts {
  if (!Array.isArray(values)) {
    return ZERO_WEAPON_USAGE_COUNTS;
  }
  const normalized: number[] = Array.from({ length: WEAPON_USAGE_SLOT_COUNT }, () => 0);
  for (const [idx, value] of values.slice(0, WEAPON_USAGE_SLOT_COUNT).entries()) {
    try {
      normalized[idx] = (Math.trunc(value) >>> 0);
    } catch (exc) {
      normalized[idx] = 0;
    }
  }
  return Array.from(normalized);
}
