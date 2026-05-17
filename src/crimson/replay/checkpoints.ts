// Port of crimson/replay/checkpoints.py

import { Vec2 } from '@grim/geom.ts';
import { BonusId } from '@crimson/bonuses/index.ts';
import type { CreatureDeath } from '@crimson/creatures/runtime.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { PlayerState } from '@crimson/sim/state-types.ts';
import { ftolMsI32 } from '@crimson/sim/timing.ts';
import type { WorldEvents, WorldState } from '@crimson/sim/world-state.ts';
import type { WeaponId } from '@crimson/weapons.ts';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { zstdCompressSync, zstdDecompressSync, constants as zlibConstants } from 'node:zlib';

export class ReplayPlayerCheckpoint {
  readonly pos: Vec2;
  readonly health: number;
  readonly weaponId: WeaponId;
  readonly ammo: number;
  readonly experience: number;
  readonly level: number;

  constructor(opts: {
    pos: Vec2;
    health: number;
    weaponId: WeaponId;
    ammo: number;
    experience: number;
    level: number;
  }) {
    this.pos = opts.pos;
    this.health = opts.health;
    this.weaponId = opts.weaponId;
    this.ammo = opts.ammo;
    this.experience = opts.experience;
    this.level = opts.level;
  }
}

export class ReplayTypoNameEntry {
  readonly creatureIndex: number;
  readonly name: string;

  constructor(opts: {
    creatureIndex: number;
    name: string;
  }) {
    this.creatureIndex = opts.creatureIndex;
    this.name = opts.name;
  }
}

export class ReplayTypoSnapshot {
  readonly inputText: string;
  readonly submitCount: number;
  readonly matchCount: number;
  readonly spawnCooldownMs: number;
  readonly activeNames: ReplayTypoNameEntry[];

  constructor(opts: {
    inputText?: string;
    submitCount?: number;
    matchCount?: number;
    spawnCooldownMs?: number;
    activeNames?: ReplayTypoNameEntry[];
  } = {}) {
    this.inputText = opts.inputText ?? '';
    this.submitCount = opts.submitCount ?? 0;
    this.matchCount = opts.matchCount ?? 0;
    this.spawnCooldownMs = opts.spawnCooldownMs ?? 0;
    this.activeNames = opts.activeNames ?? [];
  }
}

export class ReplayTutorialSnapshot {
  readonly stageIndex: number;
  readonly stageTimerMs: number;
  readonly stageTransitionTimerMs: number;
  readonly hintIndex: number;
  readonly hintAlpha: number;
  readonly hintFadeIn: boolean;
  readonly repeatSpawnCount: number;
  readonly hintBonusCreatureRef: number | null;
  readonly promptText: string;
  readonly promptAlpha: number;
  readonly hintText: string;
  readonly hintAlphaOverlay: number;

  constructor(opts: {
    stageIndex?: number;
    stageTimerMs?: number;
    stageTransitionTimerMs?: number;
    hintIndex?: number;
    hintAlpha?: number;
    hintFadeIn?: boolean;
    repeatSpawnCount?: number;
    hintBonusCreatureRef?: number | null;
    promptText?: string;
    promptAlpha?: number;
    hintText?: string;
    hintAlphaOverlay?: number;
  } = {}) {
    this.stageIndex = opts.stageIndex ?? -1;
    this.stageTimerMs = opts.stageTimerMs ?? 0;
    this.stageTransitionTimerMs = opts.stageTransitionTimerMs ?? -1000;
    this.hintIndex = opts.hintIndex ?? -1;
    this.hintAlpha = opts.hintAlpha ?? 0;
    this.hintFadeIn = opts.hintFadeIn ?? false;
    this.repeatSpawnCount = opts.repeatSpawnCount ?? 0;
    this.hintBonusCreatureRef = opts.hintBonusCreatureRef ?? null;
    this.promptText = opts.promptText ?? '';
    this.promptAlpha = opts.promptAlpha ?? 0.0;
    this.hintText = opts.hintText ?? '';
    this.hintAlphaOverlay = opts.hintAlphaOverlay ?? 0.0;
  }
}

export class ReplayCheckpoint {
  readonly tickIndex: number;
  readonly rngState: number;
  readonly elapsedMs: number;
  readonly scoreXp: number;
  readonly kills: number;
  readonly creatureCount: number;
  readonly perkPending: number;
  readonly players: ReplayPlayerCheckpoint[];
  readonly bonusTimers: Map<string, number>;
  readonly deaths: ReplayDeathLedgerEntry[];
  readonly perk: ReplayPerkSnapshot;
  readonly events: ReplayEventSummary;
  readonly tutorial: ReplayTutorialSnapshot | null;
  readonly typo: ReplayTypoSnapshot | null;

  constructor(opts: {
    tickIndex: number;
    rngState: number;
    elapsedMs: number;
    scoreXp: number;
    kills: number;
    creatureCount: number;
    perkPending: number;
    players: ReplayPlayerCheckpoint[];
    bonusTimers: Map<string, number>;
    deaths?: ReplayDeathLedgerEntry[];
    perk?: ReplayPerkSnapshot;
    events?: ReplayEventSummary;
    tutorial?: ReplayTutorialSnapshot | null;
    typo?: ReplayTypoSnapshot | null;
  }) {
    this.tickIndex = opts.tickIndex;
    this.rngState = opts.rngState;
    this.elapsedMs = opts.elapsedMs;
    this.scoreXp = opts.scoreXp;
    this.kills = opts.kills;
    this.creatureCount = opts.creatureCount;
    this.perkPending = opts.perkPending;
    this.players = opts.players;
    this.bonusTimers = opts.bonusTimers;
    this.deaths = opts.deaths ?? [];
    this.perk = opts.perk ?? new ReplayPerkSnapshot();
    this.events = opts.events ?? new ReplayEventSummary();
    this.tutorial = opts.tutorial ?? null;
    this.typo = opts.typo ?? null;
  }
}

export class ReplayDeathLedgerEntry {
  readonly creatureIndex: number;
  readonly typeId: number;
  readonly rewardValue: number;
  readonly xpAwarded: number;
  readonly ownerId: number;

  constructor(opts: {
    creatureIndex: number;
    typeId: number;
    rewardValue: number;
    xpAwarded: number;
    ownerId: number;
  }) {
    this.creatureIndex = opts.creatureIndex;
    this.typeId = opts.typeId;
    this.rewardValue = opts.rewardValue;
    this.xpAwarded = opts.xpAwarded;
    this.ownerId = opts.ownerId;
  }
}

export class ReplayPerkSnapshot {
  readonly pendingCount: number;
  readonly choicesDirty: boolean;
  readonly choices: number[];
  readonly playerNonzeroCounts: number[][][];

  constructor(opts: {
    pendingCount?: number;
    choicesDirty?: boolean;
    choices?: number[];
    playerNonzeroCounts?: number[][][];
  } = {}) {
    this.pendingCount = opts.pendingCount ?? 0;
    this.choicesDirty = opts.choicesDirty ?? false;
    this.choices = opts.choices ?? [];
    this.playerNonzeroCounts = opts.playerNonzeroCounts ?? [];
  }
}

export class ReplayEventSummary {
  // Legacy sidecars may omit this block; -1 marks "unknown/not recorded".
  readonly hitCount: number;
  readonly pickupCount: number;
  readonly sfxCount: number;
  readonly sfxHead: string[];

  constructor(opts: {
    hitCount?: number;
    pickupCount?: number;
    sfxCount?: number;
    sfxHead?: string[];
  } = {}) {
    this.hitCount = opts.hitCount ?? 0;
    this.pickupCount = opts.pickupCount ?? 0;
    this.sfxCount = opts.sfxCount ?? 0;
    this.sfxHead = opts.sfxHead ?? [];
  }
}

export class ReplayCheckpoints {
  readonly version: number;
  readonly sampleRate: number;
  readonly checkpoints: ReplayCheckpoint[];

  constructor(opts: {
    version: number;
    sampleRate: number;
    checkpoints?: ReplayCheckpoint[];
  }) {
    this.version = opts.version;
    this.sampleRate = opts.sampleRate;
    this.checkpoints = opts.checkpoints ?? [];
  }
}

function bytesFrom(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function pythonStartsWith(value: string | Uint8Array, prefix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(prefix)) {
    return prefix.some((item) => pythonStartsWith(value, item));
  }
  if (typeof value === 'string' && typeof prefix === 'string') {
    return value.startsWith(prefix);
  }
  if (typeof value === 'string' || typeof prefix === 'string') {
    return false;
  }
  return value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte);
}

function pythonEndsWith(value: string | Uint8Array, suffix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(suffix)) {
    return suffix.some((item) => pythonEndsWith(value, item));
  }
  if (typeof value === 'string' && typeof suffix === 'string') {
    return value.endsWith(suffix);
  }
  if (typeof value === 'string' || typeof suffix === 'string') {
    return false;
  }
  const offset = value.byteLength - suffix.byteLength;
  return offset >= 0 && suffix.every((byte, index) => value[offset + index] === byte);
}

function _pathJoin(...parts: Array<string | number>): string {
  const cleaned = parts.map((part, idx) => {
    const text = String(part);
    if (idx === 0) {
      const stripped = text.replace(/\/+$/g, '');
      if (stripped === '.') {
        return '';
      }
      return text === '/' ? '/' : stripped;
    }
    return text.replace(/^\/+|\/+$/g, '');
  }).filter((part) => part.length > 0);
  if (cleaned.length === 0) {
    return '';
  }
  if (cleaned[0] === '/') {
    return `/${cleaned.slice(1).join('/')}`;
  }
  return cleaned.join('/');
}

function _basename(path: string): string {
  const normalized = path.replace(/\/+$/g, '');
  const idx = normalized.lastIndexOf('/');
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

function _dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) {
    return '.';
  }
  if (idx === 0) {
    return '/';
  }
  return path.slice(0, idx);
}

function _mkdirParents(path: string): void {
  mkdirSync(path, { recursive: true });
}

class MsgpackEncoder {
  private readonly _encoder = new TextEncoder();
  private _bytes: number[] = [];

  encode(value: unknown): Uint8Array {
    this._bytes = [];
    this.writeValue(value);
    return new Uint8Array(this._bytes);
  }

  private writeValue(value: unknown): void {
    if (value === null || value === undefined) {
      this.writeByte(0xc0);
    } else if (typeof value === 'boolean') {
      this.writeByte(value ? 0xc3 : 0xc2);
    } else if (typeof value === 'number') {
      this.writeNumber(value);
    } else if (typeof value === 'string') {
      this.writeString(value);
    } else if (value instanceof Uint8Array) {
      this.writeBinary(value);
    } else if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      this.writeBinary(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    } else if (Array.isArray(value)) {
      this.writeArray(value);
    } else if (value instanceof Map) {
      this.writeMap(Array.from(value.entries()));
    } else if (typeof value === 'object') {
      this.writeObject(value as Record<string, unknown>);
    } else {
      throw new Error('unsupported msgpack value');
    }
  }

  private writeNumber(value: number): void {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      this.writeByte(0xcb);
      const buffer = new ArrayBuffer(8);
      new DataView(buffer).setFloat64(0, value, false);
      this.writeBytes(new Uint8Array(buffer));
    } else if (value >= 0 && value <= 0x7f) {
      this.writeByte(value);
    } else if (value >= -32 && value < 0) {
      this.writeByte(0x100 + value);
    } else if (value >= 0 && value <= 0xff) {
      this.writeByte(0xcc);
      this.writeByte(value);
    } else if (value >= 0 && value <= 0xffff) {
      this.writeByte(0xcd);
      this.writeUint16(value);
    } else if (value >= 0 && value <= 0xffffffff) {
      this.writeByte(0xce);
      this.writeUint32(value);
    } else if (value >= -0x80 && value < 0) {
      this.writeByte(0xd0);
      this.writeByte(value);
    } else if (value >= -0x8000 && value < 0) {
      this.writeByte(0xd1);
      this.writeUint16(value);
    } else if (value >= -0x80000000 && value < 0) {
      this.writeByte(0xd2);
      this.writeUint32(value);
    } else {
      this.writeByte(0xcb);
      const buffer = new ArrayBuffer(8);
      new DataView(buffer).setFloat64(0, value, false);
      this.writeBytes(new Uint8Array(buffer));
    }
  }

  private writeString(value: string): void {
    const bytes = this._encoder.encode(value);
    if (bytes.length <= 31) {
      this.writeByte(0xa0 | bytes.length);
    } else if (bytes.length <= 0xff) {
      this.writeByte(0xd9);
      this.writeByte(bytes.length);
    } else if (bytes.length <= 0xffff) {
      this.writeByte(0xda);
      this.writeUint16(bytes.length);
    } else {
      this.writeByte(0xdb);
      this.writeUint32(bytes.length);
    }
    this.writeBytes(bytes);
  }

  private writeBinary(value: Uint8Array): void {
    if (value.length <= 0xff) {
      this.writeByte(0xc4);
      this.writeByte(value.length);
    } else if (value.length <= 0xffff) {
      this.writeByte(0xc5);
      this.writeUint16(value.length);
    } else {
      this.writeByte(0xc6);
      this.writeUint32(value.length);
    }
    this.writeBytes(value);
  }

  private writeArray(value: readonly unknown[]): void {
    if (value.length <= 15) {
      this.writeByte(0x90 | value.length);
    } else if (value.length <= 0xffff) {
      this.writeByte(0xdc);
      this.writeUint16(value.length);
    } else {
      this.writeByte(0xdd);
      this.writeUint32(value.length);
    }
    for (const item of value) {
      this.writeValue(item);
    }
  }

  private writeObject(value: Record<string, unknown>): void {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .map((key): [string, unknown] => [key, value[key]]);
    this.writeMap(entries);
  }

  private writeMap(entries: readonly (readonly [unknown, unknown])[]): void {
    if (entries.length <= 15) {
      this.writeByte(0x80 | entries.length);
    } else if (entries.length <= 0xffff) {
      this.writeByte(0xde);
      this.writeUint16(entries.length);
    } else {
      this.writeByte(0xdf);
      this.writeUint32(entries.length);
    }
    for (const [key, value] of entries) {
      this.writeValue(key);
      this.writeValue(value);
    }
  }

  private writeByte(value: number): void {
    this._bytes.push(value & 0xff);
  }

  private writeBytes(value: Uint8Array): void {
    for (const byte of value) {
      this.writeByte(byte);
    }
  }

  private writeUint16(value: number): void {
    this.writeByte(value >> 8);
    this.writeByte(value);
  }

  private writeUint32(value: number): void {
    this.writeByte(value / 0x1000000);
    this.writeByte(value >> 16);
    this.writeByte(value >> 8);
    this.writeByte(value);
  }
}

class MsgpackDecoder<T> {
  private readonly _type?: new (...args: any[]) => T;

  constructor(opts: { type?: new (...args: any[]) => T } = {}) {
    this._type = opts.type;
  }

  decode(blob: Uint8Array): T {
    const value = new MsgpackReader(blob).read();
    const normalized = camelizeMsgpackValue(value);
    if (
      this._type !== undefined
      && normalized !== null
      && typeof normalized === 'object'
      && !Array.isArray(normalized)
      && !(normalized instanceof Uint8Array)
      && !(normalized instanceof Map)
    ) {
      return new this._type(normalized);
    }
    return normalized as T;
  }
}

function camelizeMsgpackValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelizeMsgpackValue);
  }
  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, item]) => [key, camelizeMsgpackValue(item)]));
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())] = camelizeMsgpackValue(item);
    }
    return output;
  }
  return value;
}

class MsgpackReader {
  private readonly _decoder = new TextDecoder();
  private _offset = 0;

  constructor(private readonly _data: Uint8Array) {}

  read(): unknown {
    const value = this.readValue();
    if (this._offset !== this._data.length) {
      throw new Error('trailing msgpack bytes');
    }
    return value;
  }

  private readValue(): unknown {
    const tag = this.readByte();
    if (tag <= 0x7f) {
      return tag;
    }
    if (tag >= 0xe0) {
      return tag - 0x100;
    }
    if (tag >= 0xa0 && tag <= 0xbf) {
      return this.readString(tag & 0x1f);
    }
    if (tag >= 0x90 && tag <= 0x9f) {
      return this.readArray(tag & 0x0f);
    }
    if (tag >= 0x80 && tag <= 0x8f) {
      return this.readMap(tag & 0x0f);
    }
    switch (tag) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return this.readBytes(this.readByte());
      case 0xc5:
        return this.readBytes(this.readUint16());
      case 0xc6:
        return this.readBytes(this.readUint32());
      case 0xcb:
        return this.readFloat64();
      case 0xcc:
        return this.readByte();
      case 0xcd:
        return this.readUint16();
      case 0xce:
        return this.readUint32();
      case 0xd0:
        return this.toSigned(this.readByte(), 0x80, 0x100);
      case 0xd1:
        return this.toSigned(this.readUint16(), 0x8000, 0x10000);
      case 0xd2:
        return this.toSigned(this.readUint32(), 0x80000000, 0x100000000);
      case 0xd9:
        return this.readString(this.readByte());
      case 0xda:
        return this.readString(this.readUint16());
      case 0xdb:
        return this.readString(this.readUint32());
      case 0xdc:
        return this.readArray(this.readUint16());
      case 0xdd:
        return this.readArray(this.readUint32());
      case 0xde:
        return this.readMap(this.readUint16());
      case 0xdf:
        return this.readMap(this.readUint32());
      default:
        throw new Error('unsupported msgpack tag: ' + tag);
    }
  }

  private readArray(length: number): unknown[] {
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      result.push(this.readValue());
    }
    return result;
  }

  private readMap(length: number): Record<string, unknown> | Map<unknown, unknown> {
    const entries: [unknown, unknown][] = [];
    let stringKeys = true;
    for (let index = 0; index < length; index += 1) {
      const key = this.readValue();
      const value = this.readValue();
      entries.push([key, value]);
      stringKeys = stringKeys && typeof key === 'string';
    }
    if (!stringKeys) {
      return new Map(entries);
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      result[key as string] = value;
    }
    return result;
  }

  private readString(length: number): string {
    return this._decoder.decode(this.readBytes(length));
  }

  private readFloat64(): number {
    const bytes = this.readBytes(8);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, false);
  }

  private readUint16(): number {
    return (this.readByte() << 8) | this.readByte();
  }

  private readUint32(): number {
    return (this.readByte() * 0x1000000) + (this.readByte() << 16) + (this.readByte() << 8) + this.readByte();
  }

  private readByte(): number {
    if (this._offset >= this._data.length) {
      throw new Error('unexpected end of msgpack data');
    }
    const byte = this._data[this._offset];
    this._offset += 1;
    return byte;
  }

  private readBytes(length: number): Uint8Array {
    if (this._offset + length > this._data.length) {
      throw new Error('unexpected end of msgpack data');
    }
    const bytes = this._data.slice(this._offset, this._offset + length);
    this._offset += length;
    return bytes;
  }

  private toSigned(value: number, signBit: number, range: number): number {
    return value >= signBit ? value - range : value;
  }
}

function pyRound(value: number, ndigits = 0): number {
  const factor = 10 ** ndigits;
  const scaled = value * factor;
  const floorValue = Math.floor(scaled);
  const frac = scaled - floorValue;
  if (frac < 0.5) {
    return floorValue / factor;
  }
  if (frac > 0.5) {
    return (floorValue + 1) / factor;
  }
  return (floorValue % 2 === 0 ? floorValue : floorValue + 1) / factor;
}

export class ReplayCheckpointsError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'ReplayCheckpointsError';
  }
}


export const FORMAT_VERSION = 4;
export const DEFAULT_CHECKPOINT_SAMPLE_RATE = 1;
const _ZSTD_MAGIC = new Uint8Array([40, 181, 47, 253]);
const _DEFAULT_MAX_CHECKPOINTS_PAYLOAD_BYTES = 256 * 1024 * 1024;
const _CHECKPOINTS_ZSTD_LEVEL = 19;
const _CHECKPOINTS_ENCODER = new MsgpackEncoder();
const _CHECKPOINTS_DECODER = new MsgpackDecoder<ReplayCheckpoints>({ type: ReplayCheckpoints });

export function defaultCheckpointsPath(replayPath: string): string {
  return _pathJoin(_dirname(String(replayPath)), `${_basename(String(replayPath))}.chk`);
}

function isZstd(data: Uint8Array): boolean {
  return pythonStartsWith(bytesFrom(data), _ZSTD_MAGIC);
}

function decompressZstdCheckpoints(data: Uint8Array, opts: { maxOutputBytes: number }): Uint8Array {
  const maxOutputBytes = opts.maxOutputBytes;
  let payload: Uint8Array;
  try {
    payload = new Uint8Array(zstdDecompressSync(data, { maxOutputLength: int(maxOutputBytes) + 1 }));
  } catch (exc) {
    throw new ReplayCheckpointsError('invalid checkpoints zstd payload');
  }
  if (payload.length > int(maxOutputBytes)) {
    throw new ReplayCheckpointsError(`checkpoints payload too large after zstd decompression (> ${int(maxOutputBytes)} bytes)`);
  }
  return payload;
}

function bonusTimerMs(value: number): number {
  // Keep checkpoint values compact/stable: ms resolution is enough for divergence detection.
  const ms = int(ftolMsI32(value));
  if (ms < 0) {
    return 0;
  }
  return ms;
}

export function buildCheckpoint(opts: { tickIndex: number; world: WorldState; elapsedMs: number; creatureCountOverride?: number | null; deaths?: readonly CreatureDeath[] | null; events?: WorldEvents | null }): ReplayCheckpoint {
  const tickIndex = opts.tickIndex;
  const world = opts.world;
  const elapsedMs = opts.elapsedMs;
  const creatureCountOverride = opts.creatureCountOverride ?? null;
  const deaths = opts.deaths ?? null;
  const events = opts.events ?? null;
  const state = world.state;
  const players: PlayerState[] = Array.from(world.players);
  const scoreXp = players.reduce((total, player) => total + int(player.experience), 0);
  const kills = int(world.creatures.killCount);
  let creatureCount: number;
  if (creatureCountOverride === null) {
    creatureCount = world.creatures.entries.filter((creature) => creature.active).reduce((total, creature) => total + 1, 0);
  } else {
    creatureCount = int(creatureCountOverride);
  }

  const playerCkpts: ReplayPlayerCheckpoint[] = [];
  for (const player of players) {
    playerCkpts.push(new ReplayPlayerCheckpoint({ pos: new Vec2(pyRound(player.pos.x, 4), pyRound(player.pos.y, 4)), health: pyRound(player.health, 4), weaponId: player.weapon.weaponId, ammo: pyRound(player.weapon.ammo, 4), experience: int(player.experience), level: int(player.level) }));
  }

  const bonusTimers = new Map([[String(BonusId.WEAPON_POWER_UP), bonusTimerMs(state.bonuses.weaponPowerUp)], [String(BonusId.REFLEX_BOOST), bonusTimerMs(state.bonuses.reflexBoost)], [String(BonusId.ENERGIZER), bonusTimerMs(state.bonuses.energizer)], [String(BonusId.DOUBLE_EXPERIENCE), bonusTimerMs(state.bonuses.doubleExperience)], [String(BonusId.FREEZE), bonusTimerMs(state.bonuses.freeze)]]);

  const perkCounts: number[][][] = [];
  for (const player of players) {
    const nonzero: number[][] = [];
    for (const [perkId, count] of player.perkCounts.entries()) {
      const countI = int(count);
      if (countI !== 0) {
        nonzero.push([int(perkId), countI]);
      }
    }
    perkCounts.push(nonzero);
  }

  const perkSnapshot = new ReplayPerkSnapshot({ pendingCount: int(state.perkSelection.pendingCount), choicesDirty: state.perkSelection.choicesDirty, choices: Array.from(state.perkSelection.choices).map((perkId) => int(perkId)), playerNonzeroCounts: perkCounts });

  const deathEntries: ReplayDeathLedgerEntry[] = [];
  for (const death of deaths || []) {
    deathEntries.push(new ReplayDeathLedgerEntry({ creatureIndex: int(death.index), typeId: int(death.typeId), rewardValue: death.rewardValue, xpAwarded: int(death.xpAwarded), ownerId: int(death.owner.toLegacy()) }));
  }

  const hits = events !== null ? Array.from(events.hits) : [];
  const pickups = events !== null ? Array.from(events.pickups) : [];
  const sfx = events !== null ? Array.from(events.sfx) : [];
  const eventSummary = new ReplayEventSummary({ hitCount: hits.length, pickupCount: pickups.length, sfxCount: sfx.length, sfxHead: sfx.slice(0, 4).map((key) => key) });

  let typoSnapshot: ReplayTypoSnapshot | null = null;
  let tutorialSnapshot: ReplayTutorialSnapshot | null = null;
  if (state.gameMode === GameMode.TUTORIAL) {
    const tutorial = state.tutorial;
    const overlay = state.tutorialOverlay;
    tutorialSnapshot = new ReplayTutorialSnapshot({ stageIndex: int(tutorial.stageIndex), stageTimerMs: int(tutorial.stageTimerMs), stageTransitionTimerMs: int(tutorial.stageTransitionTimerMs), hintIndex: int(tutorial.hintIndex), hintAlpha: int(tutorial.hintAlpha), hintFadeIn: tutorial.hintFadeIn, repeatSpawnCount: int(tutorial.repeatSpawnCount), hintBonusCreatureRef: tutorial.hintBonusCreatureRef === null ? null : int(tutorial.hintBonusCreatureRef), promptText: String(overlay.promptText), promptAlpha: overlay.promptAlpha, hintText: String(overlay.hintText), hintAlphaOverlay: overlay.hintAlpha });
  }
  if (state.gameMode === GameMode.TYPO) {
    const activeMask = Array.from(world.creatures.entries).map((creature) => creature.active);
    const activeNames = state.typo.names.activeEntries({ activeMask: activeMask }).map(([creatureIndex, name]) => new ReplayTypoNameEntry({ creatureIndex: int(creatureIndex), name: String(name) }));
    typoSnapshot = new ReplayTypoSnapshot({ inputText: String(state.typo.typing.text), submitCount: int(state.typo.typing.submitCount), matchCount: int(state.typo.typing.matchCount), spawnCooldownMs: int(state.typo.spawnCooldownMs), activeNames: activeNames });
  }

  return new ReplayCheckpoint({ tickIndex: int(tickIndex), rngState: int(state.rng.state), elapsedMs: int(pyRound(elapsedMs)), scoreXp: int(scoreXp), kills: int(kills), creatureCount: int(creatureCount), perkPending: int(state.perkSelection.pendingCount), players: playerCkpts, bonusTimers: bonusTimers, deaths: deathEntries, perk: perkSnapshot, events: eventSummary, tutorial: tutorialSnapshot, typo: typoSnapshot });
}

export function dumpCheckpoints(checkpoints: ReplayCheckpoints): Uint8Array {
  const raw = _CHECKPOINTS_ENCODER.encode(checkpoints);
  return new Uint8Array(zstdCompressSync(raw, { params: { [zlibConstants.ZSTD_c_compressionLevel]: _CHECKPOINTS_ZSTD_LEVEL } }));
}

export function loadCheckpoints(data: Uint8Array): ReplayCheckpoints {
  const maxPayloadBytes = int(_DEFAULT_MAX_CHECKPOINTS_PAYLOAD_BYTES);
  let payload = bytesFrom(data);
  if (isZstd(payload)) {
    payload = decompressZstdCheckpoints(payload, { maxOutputBytes: maxPayloadBytes });
  }
  if (payload.length > int(maxPayloadBytes)) {
    throw new ReplayCheckpointsError(`checkpoints payload too large (> ${int(maxPayloadBytes)} bytes)`);
  }
  let decoded: ReturnType<typeof _CHECKPOINTS_DECODER.decode>;
  try {
    decoded = _CHECKPOINTS_DECODER.decode(payload);
  } catch (exc) {
    throw new ReplayCheckpointsError('invalid checkpoints msgpack payload');
  }

  if (int(decoded.version) !== FORMAT_VERSION) {
    throw new ReplayCheckpointsError(`unsupported checkpoints version: ${int(decoded.version)}`);
  }
  return decoded;
}

export function dumpCheckpointsFile(path: string, checkpoints: ReplayCheckpoints): void {
  writeFileSync(String(path), dumpCheckpoints(checkpoints));
}

export function loadCheckpointsFile(path: string): ReplayCheckpoints {
  return loadCheckpoints(readFileSync(String(path)));
}
