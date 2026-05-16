// Port of crimson/replay/types.py

import { AimScheme, aimSchemeFromValue } from '@crimson/aim-schemes.ts';
import type { GameMode } from '@crimson/game-modes.ts';
import { f32 } from '@crimson/math-parity.ts';
import { MovementControlType, movementControlTypeFromValue } from '@crimson/movement-controls.ts';
import type { NonNegativeInt, PlayerCount, PositiveFloat, PositiveInt } from '@crimson/msgspec-types.ts';
import { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import type { GameCommand } from '@crimson/sim/input-providers.ts';
import { WEAPON_USAGE_SLOT_COUNT } from '@crimson/weapon-usage.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { VERSION } from '@crimson/index.ts';

export type InputQuantization = "f32";
export type PackedPlayerInput = number[];
export type PackedTickInputs = PackedPlayerInput[];

export const REPLAY_FORMAT_VERSION = 11;
export const WEAPON_USAGE_COUNT = WEAPON_USAGE_SLOT_COUNT;
export const FIRE_DOWN_FLAG = 1 << 0;
export const FIRE_PRESSED_FLAG = 1 << 1;
export const RELOAD_PRESSED_FLAG = 1 << 2;
export const RELOAD_DOWN_FLAG = 1 << 16;
export const MOVE_KEYS_PRESENT_FLAG = 1 << 3;
export const MOVE_FORWARD_FLAG = 1 << 4;
export const MOVE_BACKWARD_FLAG = 1 << 5;
export const TURN_LEFT_FLAG = 1 << 6;
export const TURN_RIGHT_FLAG = 1 << 7;
export const MOVE_MODE_PRESENT_FLAG = 1 << 8;
export const MOVE_MODE_SHIFT = 9;
export const MOVE_MODE_MASK = 0x7;
export const AIM_SCHEME_PRESENT_FLAG = 1 << 12;
export const AIM_SCHEME_SHIFT = 13;
export const AIM_SCHEME_MASK = 0x7;
const _RELEASE_VERSION_RE = new RegExp("^\\d+\\.\\d+\\.\\d+$");

function pythonSplitlines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (/(?:\r\n|\r|\n)$/.test(text)) {
    lines.pop();
  }
  return lines;
}

export class ReplayClaimedStatsSnapshot {
  readonly complete: boolean;
  readonly ticks: NonNegativeInt;
  readonly elapsedMs: NonNegativeInt;
  readonly scoreXp: NonNegativeInt;
  readonly kills: NonNegativeInt;
  readonly mostUsedWeaponId: WeaponId;
  readonly shotsFired: NonNegativeInt;
  readonly shotsHit: NonNegativeInt;

  constructor(opts: {
    complete?: boolean;
    ticks?: NonNegativeInt;
    elapsedMs?: NonNegativeInt;
    scoreXp?: NonNegativeInt;
    kills?: NonNegativeInt;
    mostUsedWeaponId?: WeaponId;
    shotsFired?: NonNegativeInt;
    shotsHit?: NonNegativeInt;
  } = {}) {
    this.complete = opts.complete ?? false;
    this.ticks = opts.ticks ?? 0;
    this.elapsedMs = opts.elapsedMs ?? 0;
    this.scoreXp = opts.scoreXp ?? 0;
    this.kills = opts.kills ?? 0;
    this.mostUsedWeaponId = opts.mostUsedWeaponId ?? WeaponId.NONE;
    this.shotsFired = opts.shotsFired ?? 0;
    this.shotsHit = opts.shotsHit ?? 0;
  }
}

export class ReplayHeader {
  readonly gameModeId: GameMode;
  readonly seed: number;
  readonly replayFormatVersion: number;
  readonly questLevel: QuestLevel | null;
  readonly typoDictionaryWords: readonly string[];
  readonly typoHighscoreNames: readonly string[];
  readonly gameVersion: string;
  readonly tickRate: PositiveInt;
  // Mirrors the native quest retry scaling counter (`quest_fail_retry_count`).
  readonly questFailRetryCount: NonNegativeInt;
  readonly hardcore: boolean;
  readonly preserveBugs: boolean;
  readonly detailPreset: NonNegativeInt;
  readonly violenceDisabled: NonNegativeInt;
  readonly worldSize: PositiveFloat;
  readonly playerCount: PlayerCount;
  readonly status: GameStatusData;
  readonly claimedStats: ReplayClaimedStatsSnapshot;
  readonly inputQuantization: InputQuantization;

  constructor(opts: {
    gameModeId: GameMode;
    seed: number;
    replayFormatVersion?: number;
    questLevel?: QuestLevel | null;
    typoDictionaryWords?: readonly string[];
    typoHighscoreNames?: readonly string[];
    gameVersion?: string;
    tickRate?: PositiveInt;
    questFailRetryCount?: NonNegativeInt;
    hardcore?: boolean;
    preserveBugs?: boolean;
    detailPreset?: NonNegativeInt;
    violenceDisabled?: NonNegativeInt;
    worldSize?: PositiveFloat;
    playerCount?: PlayerCount;
    status?: GameStatusData;
    claimedStats?: ReplayClaimedStatsSnapshot;
    inputQuantization?: InputQuantization;
  }) {
    this.gameModeId = opts.gameModeId;
    this.seed = opts.seed;
    this.replayFormatVersion = opts.replayFormatVersion ?? REPLAY_FORMAT_VERSION;
    this.questLevel = opts.questLevel ?? null;
    this.typoDictionaryWords = Array.from(opts.typoDictionaryWords ?? []);
    this.typoHighscoreNames = Array.from(opts.typoHighscoreNames ?? []);
    this.gameVersion = opts.gameVersion ?? defaultGameVersion();
    this.tickRate = opts.tickRate ?? 60;
    this.questFailRetryCount = opts.questFailRetryCount ?? 0;
    this.hardcore = opts.hardcore ?? false;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.detailPreset = opts.detailPreset ?? 5;
    this.violenceDisabled = opts.violenceDisabled ?? 0;
    this.worldSize = opts.worldSize ?? 1024.0;
    this.playerCount = opts.playerCount ?? 1;
    this.status = opts.status ?? new GameStatusData();
    this.claimedStats = opts.claimedStats ?? new ReplayClaimedStatsSnapshot();
    this.inputQuantization = opts.inputQuantization ?? 'f32';
  }
}

export class ReplayTick {
  readonly dt: number;
  readonly inputs: PackedTickInputs;
  readonly commands: GameCommand[];

  constructor(opts: {
    dt: number;
    inputs: PackedTickInputs;
    commands?: GameCommand[];
  }) {
    this.dt = opts.dt;
    this.inputs = opts.inputs;
    this.commands = opts.commands ?? [];
  }
}

export class Replay {
  header: ReplayHeader;
  ticks: ReplayTick[];

  constructor(opts: {
    header: ReplayHeader;
    ticks: ReplayTick[];
  }) {
    this.header = opts.header;
    this.ticks = opts.ticks;
  }
}

function headPointsAtReleaseTag(opts: { version: string; repoRoot: string; gitExe: string }): boolean {
  // Return True when HEAD is tagged as the release version.

  const version = opts.version;
  const repoRoot = opts.repoRoot;
  const gitExe = opts.gitExe;
  if (((pattern: RegExp, value: string) => { const match = pattern.exec(value); return match !== null && match[0] === value ? match : null; })(_RELEASE_VERSION_RE, String(version)) === null) {
    return false;
  }

  const tagsOut = new Uint8Array();
  const tags = new Set(pythonSplitlines(new TextDecoder('utf-8').decode(tagsOut)).filter((line) => line.trim()).map((line) => line.trim()));
  return tags.has(version) || tags.has(`v${version}`);
}

export function currentReplayGameVersion(): string {
  // Return replay header `game_version`.
  //
  // - Release-tagged HEAD: "<version>"
  // - Git checkout non-release: "<version>+g<short_sha>"
  // - No git metadata: "<version>"

  const version = String(VERSION);
  let repoRoot: string;
  let out: Uint8Array;
  let build: string;
  try {
    const gitExe = null;
    if (gitExe === null) {
      return version;
    }
    repoRoot = '';
    out = new Uint8Array();
    build = new TextDecoder('utf-8').decode(out).trim();
    if (!build) {
      return version;
    }
    if (headPointsAtReleaseTag({ version: version, repoRoot: repoRoot, gitExe: gitExe })) {
      return version;
    }
    if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(version, '+')) {
      return `${version}.g${build}`;
    }
    return `${version}+g${build}`;
  } catch (exc) {
    return version;
  }
}

function defaultGameVersion(): string {
  return currentReplayGameVersion();
}

export function quantizeF32(value: number): number {
  return f32(value);
}

export function packInputFlags(opts: { fireDown: boolean; firePressed: boolean; reloadPressed: boolean; reloadDown?: boolean; moveMode?: MovementControlType | null; aimScheme?: AimScheme | null; moveForwardPressed?: boolean | null; moveBackwardPressed?: boolean | null; turnLeftPressed?: boolean | null; turnRightPressed?: boolean | null }): number {
  const fireDown = opts.fireDown;
  const firePressed = opts.firePressed;
  const reloadPressed = opts.reloadPressed;
  const reloadDown = opts.reloadDown ?? false;
  const moveMode = opts.moveMode ?? null;
  const aimScheme = opts.aimScheme ?? null;
  const moveForwardPressed = opts.moveForwardPressed ?? null;
  const moveBackwardPressed = opts.moveBackwardPressed ?? null;
  const turnLeftPressed = opts.turnLeftPressed ?? null;
  const turnRightPressed = opts.turnRightPressed ?? null;
  let flags = 0;
  if (fireDown) {
    flags |= FIRE_DOWN_FLAG;
  }
  if (firePressed) {
    flags |= FIRE_PRESSED_FLAG;
  }
  if (reloadPressed) {
    flags |= RELOAD_PRESSED_FLAG;
  }
  if (reloadDown) {
    flags |= RELOAD_DOWN_FLAG;
  }
  const keyFields = [moveForwardPressed, moveBackwardPressed, turnLeftPressed, turnRightPressed];
  if (keyFields.some((field) => field !== null)) {
    flags |= MOVE_KEYS_PRESENT_FLAG;
    if (moveForwardPressed) {
      flags |= MOVE_FORWARD_FLAG;
    }
    if (moveBackwardPressed) {
      flags |= MOVE_BACKWARD_FLAG;
    }
    if (turnLeftPressed) {
      flags |= TURN_LEFT_FLAG;
    }
    if (turnRightPressed) {
      flags |= TURN_RIGHT_FLAG;
    }
  }
  if (moveMode !== null) {
    flags |= MOVE_MODE_PRESENT_FLAG;
    flags |= (int(moveMode) & MOVE_MODE_MASK) << MOVE_MODE_SHIFT;
  }
  if (aimScheme !== null) {
    flags |= AIM_SCHEME_PRESENT_FLAG;
    flags |= (int(aimScheme) & AIM_SCHEME_MASK) << AIM_SCHEME_SHIFT;
  }
  return int(flags);
}

export function unpackInputFlags(flags: number): [boolean, boolean, boolean, boolean] {
  flags = int(flags);
  return [(flags & FIRE_DOWN_FLAG) !== 0, (flags & FIRE_PRESSED_FLAG) !== 0, (flags & RELOAD_PRESSED_FLAG) !== 0, (flags & RELOAD_DOWN_FLAG) !== 0];
}

export function unpackInputMoveKeyFlags(flags: number): [boolean | null, boolean | null, boolean | null, boolean | null] {
  flags = int(flags);
  if (!((flags & MOVE_KEYS_PRESENT_FLAG) !== 0)) {
    return [null, null, null, null];
  }
  return [(flags & MOVE_FORWARD_FLAG) !== 0, (flags & MOVE_BACKWARD_FLAG) !== 0, (flags & TURN_LEFT_FLAG) !== 0, (flags & TURN_RIGHT_FLAG) !== 0];
}

export function unpackInputModeFlags(flags: number): [MovementControlType | null, AimScheme | null] {
  flags = int(flags);
  let moveMode: MovementControlType | null = null;
  let aimScheme: AimScheme | null = null;
  if ((flags & MOVE_MODE_PRESENT_FLAG) !== 0) {
    moveMode = Math.floor(movementControlTypeFromValue((flags / (2 ** MOVE_MODE_SHIFT) & MOVE_MODE_MASK)));
  }
  let aimSchemeRaw: any;
  if ((flags & AIM_SCHEME_PRESENT_FLAG) !== 0) {
    aimSchemeRaw = Math.floor(flags / (2 ** AIM_SCHEME_SHIFT)) & AIM_SCHEME_MASK;
    if (aimSchemeRaw === AIM_SCHEME_MASK) {
      aimSchemeRaw = -1;
    }
    aimScheme = aimSchemeFromValue(aimSchemeRaw);
  }
  return [moveMode, aimScheme];
}

export function unpackPackedPlayerInput(packed: PackedPlayerInput): [number, number, number, number, number] {
  // Decode a compact replay input row into scalar values.
  //
  // Stored shape is `[move_x, move_y, aim_x, aim_y, flags]`.
  // Returns `(move_x, move_y, aim_x, aim_y, flags)`.

  const _requireNumF = (value: unknown, opts: { field: string }): number => {
    const field = opts.field;
    if (typeof value === 'boolean') {
      throw new TypeError(`${field} must be numeric, got bool`);
    }
    if ((typeof value === 'number' && Number.isInteger(value) || typeof value === 'number')) {
      return value;
    }
    throw new TypeError(`${field} must be numeric`);
  };

  const _requireNumI = (value: unknown, opts: { field: string }): number => {
    const field = opts.field;
    if (typeof value === 'boolean') {
      throw new TypeError(`${field} must be numeric, got bool`);
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
      return int(value);
    }
    if (typeof value === 'number') {
      return int(value);
    }
    throw new TypeError(`${field} must be numeric`);
  };

  if (packed.length !== 5) {
    throw new Error(`packed replay input must have 5 fields, got ${packed.length}`);
  }

  const mx = _requireNumF(packed[0], { field: 'move_x' });
  const my = _requireNumF(packed[1], { field: 'move_y' });
  const ax = _requireNumF(packed[2], { field: 'aim_x' });
  const ay = _requireNumF(packed[3], { field: 'aim_y' });
  const flags = _requireNumI(packed[4], { field: 'flags' });

  return [mx, my, ax, ay, flags];
}
