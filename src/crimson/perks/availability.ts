// Port of crimson/perks/availability.py

import { GameMode } from '@crimson/game-modes.ts';
import type { GameStatus } from '@crimson/persistence/save-status.ts';
import { allQuests } from '@crimson/quests/index.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { PERK_COUNT_SIZE } from '@crimson/sim/state-types.ts';
import { perkCountGet } from '@crimson/perks/helpers.ts';
import { PERK_BY_ID, PerkFlags, PerkId } from '@crimson/perks/ids.ts';

const _PERK_BASE_AVAILABLE_MAX_ID = Math.trunc(PerkId.BONUS_MAGNET);
const _PERK_ALWAYS_AVAILABLE: readonly PerkId[] = [
  PerkId.MAN_BOMB,
  PerkId.LIVING_FORTRESS,
  PerkId.FIRE_CAUGH,
  PerkId.TOUGH_RELOADER,
];

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

export function buildPerkAvailability(opts: { status: GameStatus | null }): boolean[] {
  const status = opts.status;
  const available = Array.from({ length: PERK_COUNT_SIZE }, () => false);
  let unlockIndex = 0;
  if (status !== null) {
    unlockIndex = status.questUnlockIndex;
  }

  for (let perkId = 1; perkId < _PERK_BASE_AVAILABLE_MAX_ID + 1; perkId++) {
    if (perkId >= 0 && perkId < available.length) {
      available[perkId] = true;
    }
  }

  for (const perkId of _PERK_ALWAYS_AVAILABLE) {
    if (perkId >= 0 && perkId < available.length) {
      available[perkId] = true;
    }
  }

  if (unlockIndex > 0) {
    const quests = allQuests();
    for (const quest of quests.slice(0, unlockIndex)) {
      const perkId = quest.unlockPerkId;
      if (perkId !== null && 0 < perkId && perkId < available.length) {
        available[perkId] = true;
      }
    }
  }

  available[Math.trunc(PerkId.ANTIPERK)] = false;
  return available;
}

export function preparePerkAvailability(state: GameplayState): void {
  state.perkAvailable.splice(0, state.perkAvailable.length, ...buildPerkAvailability({ status: state.status }));
}

export function perkCanOffer(state: GameplayState, player: PlayerState, perkId: PerkId, opts: { gameMode: GameMode; playerCount: number }): boolean {
  // Return whether `perk_id` is eligible for selection.
  //
  // Modeled after `perk_can_offer` (0x0042fb10).

  const gameMode = opts.gameMode;
  const playerCount = opts.playerCount;
  if (perkId === PerkId.ANTIPERK) {
    return false;
  }

  // Hardcore quest 2-10 blocks poison-related perks.
  if (gameMode === GameMode.QUESTS && state.hardcore && pythonEquals(state.questLevel, new QuestLevel({ major: 2, minor: 10 })) && (perkId === PerkId.POISON_BULLETS || perkId === PerkId.VEINS_OF_POISON || perkId === PerkId.PLAGUEBEARER)) {
    return false;
  }

  const meta = PERK_BY_ID.get(perkId) ?? null;
  if (meta === null) {
    return false;
  }

  const flags = meta.flags;
  // Native `perk_can_offer` treats these metadata bits as allow-lists for
  // specific runtime modes, not "only in this mode":
  // - in quest mode, offered perks must have bit 0x1 set
  // - in multiplayer, offered perks must have bit 0x2 set
  // The original game only had 1p/2p, but the port extends this gate to all
  // multiplayer counts for consistent 3p/4p behavior.
  if (gameMode === GameMode.QUESTS && (flags & PerkFlags.QUEST_MODE_ALLOWED) === 0) {
    return false;
  }
  if (playerCount > 1 && (flags & PerkFlags.MULTIPLAYER_ALLOWED) === 0) {
    return false;
  }

  if (meta.prereq && meta.prereq.some((req) => perkCountGet(player, req) <= 0)) {
    return false;
  }

  return true;
}
