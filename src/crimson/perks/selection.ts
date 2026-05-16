// Port of crimson/perks/selection.py

import { GameMode } from '@crimson/game-modes.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { perkCanOffer } from '@crimson/perks/availability.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { PERK_BY_ID, PerkFlags, PerkId } from '@crimson/perks/ids.ts';
import { perkApply } from '@crimson/perks/runtime/apply.ts';
import type { PerkSelectionState } from '@crimson/perks/state.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';

export const PERK_ID_MAX = Math.max(...Array.from(PERK_BY_ID.keys(), (perkId) => int(perkId)));
export const DEATH_CLOCK_BLOCKED: ReadonlySet<PerkId> = new Set([
  PerkId.JINXED,
  PerkId.BREATHING_ROOM,
  PerkId.GRIM_DEAL,
  PerkId.HIGHLANDER,
  PerkId.FATAL_LOTTERY,
  PerkId.AMMUNITION_WITHIN,
  PerkId.INFERNAL_CONTRACT,
  PerkId.REGENERATION,
  PerkId.GREATER_REGENERATION,
  PerkId.THICK_SKINNED,
  PerkId.BANDAGE,
]);
export const PERK_RARITY_GATE: ReadonlySet<PerkId> = new Set([
  PerkId.JINXED,
  PerkId.AMMUNITION_WITHIN,
  PerkId.ANXIOUS_LOADER,
  PerkId.MONSTER_VISION,
]);

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

export function perkChoiceCount(player: PlayerState): number {
  if (perkActive(player, PerkId.PERK_MASTER)) {
    return 7;
  }
  if (perkActive(player, PerkId.PERK_EXPERT)) {
    return 6;
  }
  return 5;
}

export function perkSelectRandom(state: GameplayState, player: PlayerState, opts: { gameMode: GameMode; playerCount: number }): PerkId {
  // Randomly select an eligible perk id.
  //
  // Port of `perk_select_random` (0x0042fbd0).

  const gameMode = opts.gameMode;
  const playerCount = opts.playerCount;
  for (let i = 0; i < 1000; i++) {
    const perkId = state.rng.rand({ caller: RngCallerStatic.PERK_SELECT_RANDOM }) % PERK_ID_MAX + 1;
    if (!(int(perkId) >= 0 && int(perkId) < state.perkAvailable.length)) {
      continue;
    }
    if (!state.perkAvailable[int(perkId)]) {
      continue;
    }
    if (perkCanOffer(state, player, perkId, { gameMode: gameMode, playerCount: playerCount })) {
      return perkId;
    }
  }

  return PerkId.INSTANT_WINNER;
}

function perkOfferableMask(state: GameplayState, player: PlayerState, opts: { gameMode: GameMode; playerCount: number }): boolean[] {
  // Build a cached `perk_select_random` eligibility mask for `1..PERK_ID_MAX`.
  const gameMode = opts.gameMode;
  const playerCount = opts.playerCount;
  const offerable: boolean[] = Array.from({ length: (PERK_ID_MAX + 1) }, () => false);
  const maxPerkIndex = Math.min(PERK_ID_MAX, state.perkAvailable.length - 1);
  for (let perkIndex = 1; perkIndex < maxPerkIndex + 1; perkIndex++) {
    if (!state.perkAvailable[perkIndex]) {
      continue;
    }
    const perkId = perkIndex;
    if (perkCanOffer(state, player, perkId, { gameMode: gameMode, playerCount: playerCount })) {
      offerable[perkIndex] = true;
    }
  }
  return offerable;
}

export function perkGenerateChoices(state: GameplayState, player: PlayerState, opts: { players?: PlayerState[] | null; gameMode: GameMode; playerCount: number; count?: number | null }): PerkId[] {
  // Generate a unique list of perk choices for the current selection.

  const players = opts.players ?? null;
  const gameMode = opts.gameMode;
  const playerCount = opts.playerCount;
  let count = opts.count ?? null;
  if (count === null) {
    count = perkChoiceCount(player);
  }

  const offerableMask = perkOfferableMask(state, player, { gameMode: gameMode, playerCount: playerCount });
  const playerPerkCounts = player.perkCounts;
  const playerWeaponId = player.weapon.weaponId;
  const deathClockActive = int(playerPerkCounts[int(PerkId.DEATH_CLOCK)]) > 0;
  const flamethrowerId = WeaponId.FLAMETHROWER;

  let pyromaniacAllowed = playerWeaponId === flamethrowerId;
  if (!state.preserveBugs && int(playerCount) > 1) {
    pyromaniacAllowed = false;
    const sourcePlayers = players !== null ? players : [player];
    for (const sourcePlayer of sourcePlayers) {
      if (sourcePlayer.health <= 0.0) {
        continue;
      }
      if (sourcePlayer.weapon.weaponId === flamethrowerId) {
        pyromaniacAllowed = true;
        break;
      }
    }
  }

  const _selectRandomOffer = (): PerkId => {
    for (let i = 0; i < 1000; i++) {
      const perkIndex = state.rng.rand({ caller: RngCallerStatic.PERK_SELECT_RANDOM }) % PERK_ID_MAX + 1;
      if (offerableMask[perkIndex]) {
        return perkIndex;
      }
    }
    return PerkId.INSTANT_WINNER;
  };

  // `perks_generate_choices` always fills a fixed array of 7 entries, even if the UI
  // only shows 5/6 (Perk Expert/Master). Preserve RNG consumption by generating the
  // full list, then slicing.
  let choices: PerkId[] = Array.from({ length: 7 }, () => PerkId.ANTIPERK);
  let choiceIndex = 0;

  // Native `quest_monster_vision_meta` points to quest 3-4 (Hidden Evil):
  // force Monster Vision as the first choice if not owned.
  if (pythonEquals(state.questLevel, new QuestLevel({ major: 3, minor: 4 })) && int(playerPerkCounts[int(PerkId.MONSTER_VISION)]) === 0) {
    choices[0] = PerkId.MONSTER_VISION;
    choiceIndex = 1;
  }

  while (choiceIndex < 7) {
    let attempts = 0;
    let perkId: PerkId;
    while (true) {
      attempts += 1;
      perkId = _selectRandomOffer();

      // Native gates this on player-1 weapon only. In default mode, allow
      // it in co-op when any alive player has Flamethrower equipped.
      if (perkId === PerkId.PYROMANIAC && !pyromaniacAllowed) {
        continue;
      }

      if (deathClockActive && DEATH_CLOCK_BLOCKED.has(perkId)) {
        continue;
      }

      // Global rarity gate: certain perks have a 25% chance to be rejected.
      if (PERK_RARITY_GATE.has(perkId) && (state.rng.rand({ caller: RngCallerStatic.PERKS_GENERATE_CHOICES_RARITY_GATE }) & 3) === 1) {
        continue;
      }

      const meta = PERK_BY_ID.get(perkId) ?? null;
      const flags = meta !== null ? meta.flags : 0;
      const stackable = (flags & PerkFlags.STACKABLE) !== 0;

      if (attempts > 10_000 && stackable) {
        break;
      }

      if (choices.slice(0, choiceIndex).includes(perkId)) {
        continue;
      }

      if (stackable || int(playerPerkCounts[int(perkId)]) < 1 || attempts > 29_999) {
        break;
      }
    }

    choices[choiceIndex] = perkId;
    choiceIndex += 1;
  }

  if (gameMode === GameMode.TUTORIAL) {
    choices = [PerkId.SHARPSHOOTER, PerkId.LONG_DISTANCE_RUNNER, PerkId.EVIL_EYES, PerkId.RADIOACTIVE, PerkId.FASTSHOT, PerkId.FASTSHOT, PerkId.FASTSHOT];
  }

  return choices.slice(0, count);
}

function perkSelectionPrepareIfNeeded(state: GameplayState, players: PlayerState[], perkState: PerkSelectionState, opts: { gameMode: GameMode; playerCount?: number | null }): PerkId[] {
  const gameMode = opts.gameMode;
  let playerCount = opts.playerCount ?? null;
  if (players.length === 0) {
    return [];
  }
  if (playerCount === null) {
    playerCount = players.length;
  }
  if (perkState.choicesDirty || perkState.choices.length === 0) {
    perkState.choices = perkGenerateChoices(state, players[0], { players: players, gameMode: gameMode, playerCount: playerCount, count: 7 });
    perkState.choicesDirty = false;
  }
  return perkState.choices;
}

export function perkSelectionPreparedChoices(players: PlayerState[], perkState: PerkSelectionState): PerkId[] {
  // Return already-prepared visible choices without mutating state.

  if (players.length === 0) {
    return [];
  }
  if (perkState.choicesDirty || perkState.choices.length === 0) {
    return [];
  }
  const visibleCount = Math.max(1, int(perkChoiceCount(players[0])));
  return perkState.choices.slice(0, visibleCount);
}

export function perkSelectionOpenChoices(state: GameplayState, players: PlayerState[], perkState: PerkSelectionState, opts: { gameMode: GameMode; playerCount?: number | null }): PerkId[] {
  // Prepare current perk choices for the selection UI and return the visible list.
  //
  // Mirrors `perk_choices_dirty` + `perks_generate_choices` before entering the
  // perk selection screen (state 6).

  const gameMode = opts.gameMode;
  const playerCount = opts.playerCount ?? null;
  perkSelectionPrepareIfNeeded(
    state,
    players,
    perkState,
    { gameMode: gameMode, playerCount: playerCount },
  );
  return perkSelectionPreparedChoices(players, perkState);
}

export function perkSelectionPick(state: GameplayState, players: PlayerState[], perkState: PerkSelectionState, choiceIndex: number, opts: { gameMode: GameMode; playerCount?: number | null; dt?: number | null; creatures?: readonly CreatureState[] | null; refreshChoices?: boolean }): PerkId | null {
  // Pick a perk from the current choice list and apply it.
  //
  // On success, decrements `pending_count` (one perk resolved) and marks the
  // choice list dirty, matching `perk_selection_screen_update`.

  const gameMode = opts.gameMode;
  const playerCount = opts.playerCount ?? null;
  const dt = opts.dt ?? null;
  const creatures = opts.creatures ?? null;
  const refreshChoices = opts.refreshChoices ?? false;
  if (perkState.pendingCount <= 0) {
    return null;
  }
  perkSelectionPrepareIfNeeded(
    state,
    players,
    perkState,
    { gameMode: gameMode, playerCount: playerCount },
  );
  const choices = perkSelectionPreparedChoices(players, perkState);
  if (choices.length === 0) {
    return null;
  }
  const idx = int(choiceIndex);
  if (idx < 0 || idx >= choices.length) {
    return null;
  }
  const perkId = choices[idx];
  perkApply(state, players, perkId, { perkState: perkState, dt: dt, creatures: creatures });
  if (!(int(perkState.pendingCount) > 0)) throw new Error('picked perk must leave a pending perk to resolve');
  perkState.pendingCount -= 1;
  perkState.choicesDirty = true;
  if (refreshChoices) {
    perkSelectionPrepareIfNeeded(
      state,
      players,
      perkState,
      { gameMode: gameMode, playerCount: playerCount },
    );
  }
  return perkId;
}
