// Port of crimson/weapon_runtime/availability.py

import { GameMode } from '@crimson/game-modes.ts';
import type { GameStatus } from '@crimson/persistence/save-status.ts';
import { allQuests } from '@crimson/quests/index.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { GameplayState } from '@crimson/sim/state-types.ts';
import { weaponUsageSlotForWeaponId } from '@crimson/weapon-usage.ts';
import { WEAPON_TABLE, WeaponId } from '@crimson/weapons.ts';

export const WEAPON_DROP_ID_COUNT = 0x21; // weapon ids 1..33
export const WEAPON_AVAILABLE_COUNT = Math.max(...Array.from(WEAPON_TABLE, (entry) => Math.trunc(entry.weaponId))) + 1;

function pythonEquals(left: object | string | number | boolean | null | undefined, right: object | string | number | boolean | null | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (left !== null && left !== undefined && typeof left === 'object') {
    const equal = Reflect.get(left, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(left, right));
    }
  }
  if (right !== null && right !== undefined && typeof right === 'object') {
    const equal = Reflect.get(right, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(right, left));
    }
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => pythonEquals(value, right[index]));
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && pythonEquals(Reflect.get(left, key), Reflect.get(right, key)));
  }
  return false;
}

export function buildWeaponAvailability(opts: { status: GameStatus | null; gameMode: GameMode; demoModeActive: boolean }): boolean[] {
  const status = opts.status;
  const gameMode = opts.gameMode;
  const demoModeActive = opts.demoModeActive;
  const available = Array.from({ length: WEAPON_AVAILABLE_COUNT }, () => false);
  let unlockIndex = 0;
  let unlockIndexFull = 0;
  if (status !== null) {
    unlockIndex = status.questUnlockIndex;
    unlockIndexFull = status.questUnlockIndexFull;
  }

  const pistolId = WeaponId.PISTOL;
  if (pistolId >= 0 && pistolId < available.length) {
    available[pistolId] = true;
  }

  if (unlockIndex > 0) {
    const quests = allQuests();
    for (const quest of quests.slice(0, unlockIndex)) {
      const weaponId = quest.unlockWeaponId;
      if (weaponId !== null && 0 < weaponId && weaponId < available.length) {
        available[weaponId] = true;
      }
    }
  }

  if (gameMode === GameMode.SURVIVAL) {
    for (const weaponId of [WeaponId.ASSAULT_RIFLE, WeaponId.SHOTGUN, WeaponId.SUBMACHINE_GUN]) {
      if (weaponId >= 0 && weaponId < available.length) {
        available[weaponId] = true;
      }
    }
  }

  if (!demoModeActive && unlockIndexFull >= 0x28) {
    const splitterId = WeaponId.SPLITTER_GUN;
    if (splitterId >= 0 && splitterId < available.length) {
      available[splitterId] = true;
    }
  }

  return available;
}

export function prepareWeaponAvailability(state: GameplayState): void {
  state.weaponAvailable.splice(0, state.weaponAvailable.length, ...buildWeaponAvailability({ status: state.status, gameMode: state.gameMode, demoModeActive: state.demoModeActive }));
}

export function weaponPickRandomAvailable(state: GameplayState): WeaponId {
  // Select a random available weapon id.
  //
  // Port of `weapon_pick_random_available` (0x00452cd0).

  const status = state.status;

  for (let i = 0; i < 1000; i++) {
    let baseRand = state.rng.rand({ caller: RngCallerStatic.WEAPON_PICK_RANDOM_AVAILABLE_PICK });
    let weaponId = baseRand % WEAPON_DROP_ID_COUNT + 1;

    // Bias: used weapons have a 50% chance to reroll once.
    if (status !== null) {
      const usageSlot = weaponUsageSlotForWeaponId(weaponId);
      if (usageSlot !== null && status.weaponUsageCountSlot(usageSlot) !== 0) {
        if ((state.rng.rand({ caller: RngCallerStatic.WEAPON_PICK_RANDOM_AVAILABLE_REROLL_GATE }) & 1) === 0) {
          baseRand = state.rng.rand({ caller: RngCallerStatic.WEAPON_PICK_RANDOM_AVAILABLE_REROLL_PICK });
          weaponId = baseRand % WEAPON_DROP_ID_COUNT + 1;
        }
      }
    }

    if (!(weaponId >= 0 && weaponId < state.weaponAvailable.length)) {
      continue;
    }
    if (!state.weaponAvailable[weaponId]) {
      continue;
    }

    // Quest 5-10 special-case: suppress Ion Cannon.
    if (state.gameMode === GameMode.QUESTS && pythonEquals(state.questLevel, new QuestLevel({ major: 5, minor: 10 })) && weaponId === WeaponId.ION_CANNON) {
      continue;
    }

    return weaponId;
  }

  return WeaponId.PISTOL;
}
