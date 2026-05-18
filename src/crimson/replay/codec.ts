// Port of crimson/replay/codec.py

import { GameMode } from '@crimson/game-modes.ts';
import { f32 } from '@crimson/math-parity.ts';
import type { PackedPlayerInput, ReplayClaimedStatsSnapshot, ReplayHeader } from '@crimson/replay/types.ts';
import { REPLAY_FORMAT_VERSION, PackedTickInputs, Replay, ReplayTick } from '@crimson/replay/types.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { zstdCompressSync, zstdDecompressSync, constants as zlibConstants } from 'node:zlib';

function pythonLstrip(value: string | Uint8Array): string | Uint8Array {
  const isWhitespace = (byte: number): boolean => byte === 9 || byte === 10 || byte === 11 || byte === 12 || byte === 13 || byte === 32;
  if (typeof value === 'string') {
    return value.replace(/^\s+/, '');
  }
  let start = 0;
  while (start < value.byteLength && isWhitespace(value[start])) {
    start += 1;
  }
  return value.slice(start);
}

function pythonStripChars(value: string, chars: string): string {
  const charSet = new Set(chars);
  let start = 0;
  let end = value.length;
  while (start < end && charSet.has(value[start])) {
    start += 1;
  }
  while (end > start && charSet.has(value[end - 1])) {
    end -= 1;
  }
  return value.slice(start, end);
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

function pythonRepr(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'nan';
    }
    if (value === Infinity) {
      return 'inf';
    }
    if (value === -Infinity) {
      return '-inf';
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === true) {
    return 'True';
  }
  if (value === false) {
    return 'False';
  }
  if (value === null) {
    return 'None';
  }
  return String(value);
}

export class ReplayCodecError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'ReplayCodecError';
  }
}


const _ZSTD_MAGIC = new Uint8Array([40, 181, 47, 253]);
const _DEFAULT_MAX_REPLAY_PAYLOAD_BYTES = 256 * 1024 * 1024;
const _REPLAY_ZSTD_LEVEL = 19;
const _REPLAY_DECODER = new MsgpackDecoder<Replay>({ type: Replay });

function isZstd(data: Uint8Array): boolean {
  return pythonStartsWith(data, _ZSTD_MAGIC);
}

function decompressZstdReplay(data: Uint8Array, opts: { maxOutputBytes: number }): Uint8Array {
  const maxOutputBytes = opts.maxOutputBytes;
  let payload: Uint8Array;
  try {
    payload = new Uint8Array(zstdDecompressSync(data, { maxOutputLength: int(maxOutputBytes) + 1 }));
  } catch (exc) {
    throw new ReplayCodecError('invalid replay zstd payload');
  }
  if (payload.length > int(maxOutputBytes)) {
    throw new ReplayCodecError(`replay payload too large after zstd decompression (> ${int(maxOutputBytes)} bytes)`);
  }
  return payload;
}

function quantizeF32(value: number): number {
  // Canonicalize via shared math-parity float32 helper.
  return f32(value);
}

function validateClaimedStats(stats: ReplayClaimedStatsSnapshot): void {
  if (int(stats.shotsHit) > int(stats.shotsFired)) {
    throw new ReplayCodecError('replay header claimed_stats.shots_hit must be <= claimed_stats.shots_fired');
  }
}

function validateHeader(header: ReplayHeader, opts: { fromLoad: boolean }): void {
  const fromLoad = opts.fromLoad;
  if (int(header.replayFormatVersion) !== int(REPLAY_FORMAT_VERSION)) {
    if (fromLoad) {
      throw new ReplayCodecError(`unsupported replay format version: ${int(header.replayFormatVersion)}`);
    }
    throw new ReplayCodecError(`unsupported replay format version in header: ${int(header.replayFormatVersion)}`);
  }
  validateClaimedStats(header.claimedStats);
  if (int(header.gameModeId) === int(GameMode.QUESTS)) {
    if (header.questLevel === null) {
      throw new ReplayCodecError('quest replays require a valid header.quest_level');
    }
  }
  if (int(header.gameModeId) === int(GameMode.TYPO)) {
    if (int(header.playerCount) !== 1) {
      throw new ReplayCodecError('Typ-o replays require player_count == 1');
    }
  }
  if (int(header.gameModeId) === int(GameMode.TUTORIAL)) {
    if (int(header.playerCount) !== 1) {
      throw new ReplayCodecError('tutorial replays require player_count == 1');
    }
  }
}

function normalizePackedInput(packed: PackedPlayerInput, opts: { tickIdx: number; playerIdx: number }): PackedPlayerInput {
  const tickIdx = opts.tickIdx;
  const playerIdx = opts.playerIdx;
  if (packed.length !== 5) {
    throw new ReplayCodecError(`replay input tick ${tickIdx} player ${playerIdx} must have 5 fields`);
  }
  const [moveXRaw, moveYRaw, aimXRaw, aimYRaw, flagsRaw] = packed;
  if (!((typeof moveXRaw === 'number' && Number.isInteger(moveXRaw) || typeof moveXRaw === 'number'))) {
    throw new ReplayCodecError(`replay input tick ${tickIdx} player ${playerIdx} move_x must be numeric`);
  }
  if (!((typeof moveYRaw === 'number' && Number.isInteger(moveYRaw) || typeof moveYRaw === 'number'))) {
    throw new ReplayCodecError(`replay input tick ${tickIdx} player ${playerIdx} move_y must be numeric`);
  }
  if (!((typeof aimXRaw === 'number' && Number.isInteger(aimXRaw) || typeof aimXRaw === 'number'))) {
    throw new ReplayCodecError(`replay input tick ${tickIdx} player ${playerIdx} aim_x must be numeric`);
  }
  if (!((typeof aimYRaw === 'number' && Number.isInteger(aimYRaw) || typeof aimYRaw === 'number'))) {
    throw new ReplayCodecError(`replay input tick ${tickIdx} player ${playerIdx} aim_y must be numeric`);
  }
  if (!((typeof flagsRaw === 'number' && Number.isInteger(flagsRaw) || typeof flagsRaw === 'number'))) {
    throw new ReplayCodecError(`replay input tick ${tickIdx} player ${playerIdx} flags must be numeric`);
  }
  return [
    moveXRaw,
    moveYRaw,
    aimXRaw,
    aimYRaw,
    int(flagsRaw),
  ];
}

function validateTickDt(dt: number, opts: { tickIdx: number }): number {
  const tickIdx = opts.tickIdx;
  if (typeof dt === 'boolean' || !((typeof dt === 'number' && Number.isInteger(dt) || typeof dt === 'number'))) {
    throw new ReplayCodecError(`replay tick ${tickIdx} dt must be numeric`);
  }
  const dtValue = dt;
  if (!Number.isFinite(dtValue) || dtValue < 0.0) {
    throw new ReplayCodecError(`replay tick ${tickIdx} dt must be finite and >= 0, got ${pythonRepr(dtValue)}`);
  }
  return quantizeF32(dtValue);
}

export function dumpReplay(replay: Replay): Uint8Array {
  // Serialize a replay as a zstd-compressed msgpack blob.

  validateHeader(replay.header, { fromLoad: false });

  const expectedPlayers = int(replay.header.playerCount);
  const normalizedTicks: ReplayTick[] = [];
  for (const [tickIdx, tick] of replay.ticks.entries()) {
    const inputs = tick.inputs;
    if (inputs.length !== expectedPlayers) {
      throw new ReplayCodecError(`replay tick ${tickIdx} has ${inputs.length} players, expected ${expectedPlayers}`);
    }
    const normalizedInputs = inputs.map((packed, playerIdx) => normalizePackedInput(packed, { tickIdx: int(tickIdx), playerIdx: int(playerIdx) }));
    const dt = validateTickDt(tick.dt, { tickIdx: tickIdx });
    normalizedTicks.push(new ReplayTick({ dt: dt, inputs: normalizedInputs, commands: tick.commands }));
  }

  const raw = new MsgpackEncoder().encode(new Replay({ header: replay.header, ticks: normalizedTicks }));
  return new Uint8Array(zstdCompressSync(raw, { params: { [zlibConstants.ZSTD_c_compressionLevel]: _REPLAY_ZSTD_LEVEL } }));
}

export function loadReplay(data: Uint8Array): Replay {
  const maxPayloadBytes = int(_DEFAULT_MAX_REPLAY_PAYLOAD_BYTES);
  if (isZstd(data)) {
    data = decompressZstdReplay(data, { maxOutputBytes: maxPayloadBytes });
  }
  if (data.length > int(maxPayloadBytes)) {
    throw new ReplayCodecError(`replay payload too large (> ${int(maxPayloadBytes)} bytes)`);
  }

  const stripped = pythonLstrip(data);
  if (pythonStartsWith(stripped, [new Uint8Array([123]), new Uint8Array([91])])) {
    throw new ReplayCodecError('legacy JSON replay format is unsupported; regenerate the replay');
  }

  let replay: ReturnType<typeof _REPLAY_DECODER.decode>;
  try {
    replay = _REPLAY_DECODER.decode(data);
  } catch (exc) {
    throw new ReplayCodecError('invalid replay msgpack payload');
  }

  validateHeader(replay.header, { fromLoad: true });

  const expectedPlayers = int(replay.header.playerCount);
  const normalizedTicks: ReplayTick[] = [];
  for (const [tickIdx, tick] of replay.ticks.entries()) {
    const inputs = tick.inputs;
    if (inputs.length !== expectedPlayers) {
      throw new ReplayCodecError(`replay tick ${tickIdx} has ${inputs.length} players, expected ${expectedPlayers}`);
    }
    const normalizedInputs: PackedTickInputs = [];
    for (const [playerIdx, packed] of inputs.entries()) {
      const normalized = normalizePackedInput(packed, { tickIdx: int(tickIdx), playerIdx: int(playerIdx) });
      normalizedInputs.push([quantizeF32(normalized[0]), quantizeF32(normalized[1]), quantizeF32(normalized[2]), quantizeF32(normalized[3]), int(normalized[4])]);
    }
    const dt = validateTickDt(tick.dt, { tickIdx: tickIdx });
    normalizedTicks.push(new ReplayTick({ dt: dt, inputs: normalizedInputs, commands: tick.commands }));
  }

  return new Replay({ header: replay.header, ticks: normalizedTicks });
}

export function dumpReplayFile(path: string, replay: Replay): void {
  writeFileSync(String(path), dumpReplay(replay));
}

export function loadReplayFile(path: string): Replay {
  return loadReplay(readFileSync(String(path)));
}
