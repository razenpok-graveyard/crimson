// Port of crimson/net/lockstep_protocol.py

import { VERSION } from '@crimson/index.ts';
import { GameMode } from '@crimson/game-modes.ts';
import type { NonNegativeInt, PlayerCount, PositiveInt, SignedIndex } from '@crimson/msgspec-types.ts';
import type { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import type { PackedPlayerInput } from '@crimson/replay/types.ts';
import type { GameCommand } from '@crimson/sim/input-providers.ts';
import { PacketHeader, SlotState } from '@crimson/net/schema-shared.ts';

export type NetMessage = Hello | Welcome | LobbyState | Ready | MatchStart | TickFrame | PauseState | KeepAlive | DebugLogBatch | ResyncBegin | ResyncChunk | ResyncCommit | Disconnect | InputBatch;

export const PROTOCOL_VERSION = 6;
export const DEFAULT_PORT = 31993;
export const TICK_RATE = 60;
// LAN runs on a good network and doesn't need a large buffer; keeping this low
// reduces perceived input latency.
export const INPUT_DELAY_TICKS = 1;
export const MAX_PLAYERS = 4;
export const RELIABLE_RESEND_MS = 40;
export const LINK_TIMEOUT_MS = 1000;
export const INPUT_STALL_TIMEOUT_MS = 250;
const _BUILD_ID_VERSION_RE = new RegExp("^[vV]?\\d+(?:\\.\\d+)+[A-Za-z0-9.\\-_]*$");
const _BUILD_ID_GIT_HASH_RE = new RegExp("^[0-9a-f]{7,40}$");

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

export class Hello {
  readonly tag = 'hello';
  protocolVersion: PositiveInt;
  buildId: string;
  modeId: GameMode;
  playerCount: PlayerCount;
  tickRate: PositiveInt;
  inputDelayTicks: NonNegativeInt;
  questLevel: QuestLevel | null;
  preserveBugs: boolean;
  host: boolean;

  constructor(opts: {
    protocolVersion?: PositiveInt;
    buildId?: string;
    modeId?: GameMode;
    playerCount?: PlayerCount;
    tickRate?: PositiveInt;
    inputDelayTicks?: NonNegativeInt;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    host?: boolean;
  } = {}) {
    this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION;
    this.buildId = opts.buildId ?? '';
    this.modeId = opts.modeId ?? GameMode.DEMO;
    this.playerCount = opts.playerCount ?? 1;
    this.tickRate = opts.tickRate ?? TICK_RATE;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.host = opts.host ?? false;
  }
}

export class Welcome {
  readonly tag = 'welcome';
  accepted: boolean;
  reason: string;
  sessionId: string;
  protocolVersion: PositiveInt;
  buildId: string;
  modeId: GameMode;
  playerCount: PlayerCount;
  slotIndex: SignedIndex;
  hostSlotIndex: NonNegativeInt;
  tickRate: PositiveInt;
  inputDelayTicks: NonNegativeInt;
  seed: number;
  questLevel: QuestLevel | null;
  preserveBugs: boolean;
  started: boolean;

  constructor(opts: {
    accepted?: boolean;
    reason?: string;
    sessionId?: string;
    protocolVersion?: PositiveInt;
    buildId?: string;
    modeId?: GameMode;
    playerCount?: PlayerCount;
    slotIndex?: SignedIndex;
    hostSlotIndex?: NonNegativeInt;
    tickRate?: PositiveInt;
    inputDelayTicks?: NonNegativeInt;
    seed?: number;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    started?: boolean;
  } = {}) {
    this.accepted = opts.accepted ?? false;
    this.reason = opts.reason ?? '';
    this.sessionId = opts.sessionId ?? '';
    this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION;
    this.buildId = opts.buildId ?? '';
    this.modeId = opts.modeId ?? GameMode.DEMO;
    this.playerCount = opts.playerCount ?? 1;
    this.slotIndex = opts.slotIndex ?? -1;
    this.hostSlotIndex = opts.hostSlotIndex ?? 0;
    this.tickRate = opts.tickRate ?? TICK_RATE;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.seed = opts.seed ?? 0;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.started = opts.started ?? false;
  }
}

export class LobbySlot extends SlotState {
}

export class LobbyState {
  readonly tag = 'lobby_state';
  sessionId: string;
  modeId: GameMode;
  playerCount: PlayerCount;
  slots: LobbySlot[];
  allReady: boolean;
  started: boolean;
  questLevel: QuestLevel | null;

  constructor(opts: {
    sessionId?: string;
    modeId?: GameMode;
    playerCount?: PlayerCount;
    slots?: LobbySlot[];
    allReady?: boolean;
    started?: boolean;
    questLevel?: QuestLevel | null;
  } = {}) {
    this.sessionId = opts.sessionId ?? '';
    this.modeId = opts.modeId ?? GameMode.DEMO;
    this.playerCount = opts.playerCount ?? 1;
    this.slots = opts.slots ?? [];
    this.allReady = opts.allReady ?? false;
    this.started = opts.started ?? false;
    this.questLevel = opts.questLevel ?? null;
  }
}

export class Ready {
  readonly tag = 'ready';
  slotIndex: SignedIndex;
  ready: boolean;

  constructor(opts: {
    slotIndex?: SignedIndex;
    ready?: boolean;
  } = {}) {
    this.slotIndex = opts.slotIndex ?? -1;
    this.ready = opts.ready ?? false;
  }
}

export class MatchStart {
  readonly tag = 'match_start';
  sessionId: string;
  modeId: GameMode;
  playerCount: PlayerCount;
  seed: number;
  startTick: NonNegativeInt;
  questLevel: QuestLevel | null;
  preserveBugs: boolean;
  status: GameStatusData | null;

  constructor(opts: {
    sessionId?: string;
    modeId?: GameMode;
    playerCount?: PlayerCount;
    seed?: number;
    startTick?: NonNegativeInt;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    status?: GameStatusData | null;
  } = {}) {
    this.sessionId = opts.sessionId ?? '';
    this.modeId = opts.modeId ?? GameMode.DEMO;
    this.playerCount = opts.playerCount ?? 1;
    this.seed = opts.seed ?? 0;
    this.startTick = opts.startTick ?? 0;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.status = opts.status ?? null;
  }
}

export class InputSample {
  tickIndex: NonNegativeInt;
  packedInput: PackedPlayerInput;

  constructor(opts: {
    tickIndex?: NonNegativeInt;
    packedInput?: PackedPlayerInput;
  } = {}) {
    this.tickIndex = opts.tickIndex ?? 0;
    this.packedInput = opts.packedInput ?? [];
  }
}

export class InputBatch {
  readonly tag = 'input_batch';
  slotIndex: SignedIndex;
  samples: InputSample[];

  constructor(opts: {
    slotIndex?: SignedIndex;
    samples?: InputSample[];
  } = {}) {
    this.slotIndex = opts.slotIndex ?? -1;
    this.samples = opts.samples ?? [];
  }
}

export class TickFrame {
  readonly tag = 'tick_frame';
  tickIndex: NonNegativeInt;
  frameInputs: PackedPlayerInput[];
  commands: GameCommand[];

  constructor(opts: {
    tickIndex?: NonNegativeInt;
    frameInputs?: PackedPlayerInput[];
    commands?: GameCommand[];
  } = {}) {
    this.tickIndex = opts.tickIndex ?? 0;
    this.frameInputs = opts.frameInputs ?? [];
    this.commands = opts.commands ?? [];
  }
}

export class PauseState {
  readonly tag = 'pause_state';
  paused: boolean;
  reason: string;

  constructor(opts: {
    paused?: boolean;
    reason?: string;
  } = {}) {
    this.paused = opts.paused ?? false;
    this.reason = opts.reason ?? '';
  }
}

// Best-effort keepalive packet to prevent timeouts during stalls/pauses.
export class KeepAlive {
  readonly tag = 'keep_alive';
  tickIndex: NonNegativeInt;

  constructor(opts: {
    tickIndex?: NonNegativeInt;
  } = {}) {
    this.tickIndex = opts.tickIndex ?? 0;
  }
}

// Client-to-host debug log forwarding payload (best-effort).
export class DebugLogBatch {
  readonly tag = 'debug_log_batch';
  slotIndex: SignedIndex;
  lines: string[];

  constructor(opts: {
    slotIndex?: SignedIndex;
    lines?: string[];
  } = {}) {
    this.slotIndex = opts.slotIndex ?? -1;
    this.lines = opts.lines ?? [];
  }
}

export class ResyncBegin {
  readonly tag = 'resync_begin';
  streamId: string;
  totalChunks: NonNegativeInt;
  compressedSize: NonNegativeInt;
  replaySize: NonNegativeInt;
  checkpointsSize: NonNegativeInt;

  constructor(opts: {
    streamId?: string;
    totalChunks?: NonNegativeInt;
    compressedSize?: NonNegativeInt;
    replaySize?: NonNegativeInt;
    checkpointsSize?: NonNegativeInt;
  } = {}) {
    this.streamId = opts.streamId ?? '';
    this.totalChunks = opts.totalChunks ?? 0;
    this.compressedSize = opts.compressedSize ?? 0;
    this.replaySize = opts.replaySize ?? 0;
    this.checkpointsSize = opts.checkpointsSize ?? 0;
  }
}

export class ResyncChunk {
  readonly tag = 'resync_chunk';
  streamId: string;
  chunkIndex: NonNegativeInt;
  payload: Uint8Array;

  constructor(opts: {
    streamId?: string;
    chunkIndex?: NonNegativeInt;
    payload?: Uint8Array;
  } = {}) {
    this.streamId = opts.streamId ?? '';
    this.chunkIndex = opts.chunkIndex ?? 0;
    this.payload = opts.payload ?? new Uint8Array([]);
  }
}

export class ResyncCommit {
  readonly tag = 'resync_commit';
  streamId: string;
  tickIndex: SignedIndex;

  constructor(opts: {
    streamId?: string;
    tickIndex?: SignedIndex;
  } = {}) {
    this.streamId = opts.streamId ?? '';
    this.tickIndex = opts.tickIndex ?? -1;
  }
}

export class Disconnect {
  readonly tag = 'disconnect';
  reason: string;

  constructor(opts: {
    reason?: string;
  } = {}) {
    this.reason = opts.reason ?? '';
  }
}

export class LockstepPacket extends PacketHeader {
  message: NetMessage;

  constructor(opts: {
    message?: NetMessage;
  } & ConstructorParameters<typeof PacketHeader>[0] = {}) {
    super(opts);
    this.message = opts.message ?? new PauseState();
  }
}

export function buildPublicVersion(buildId: string): string | null {
  // Extract a "public" version from a build id if it resembles a version string.
  //
  // Supports plain versions like "0.1.0" and build ids with local metadata like
  // "0.1.0+gabcdef123456". Returns None when build_id doesn't look like a version.
  const raw = buildId.trim();
  if (!raw) {
    return null;
  }
  let base = raw.split('+', 1)[0];
  if (pythonStartsWith(base, ['v', 'V'])) {
    base = base.slice(1);
  }
  if (((pattern: RegExp, value: string) => { const match = pattern.exec(value); return match !== null && match[0] === value ? match : null; })(_BUILD_ID_VERSION_RE, String(base)) === null) {
    return null;
  }
  return String(base);
}

export function buildGitHash(buildId: string): string | null {
  // Extract a git hash from a build id if present.
  const raw = buildId.trim();
  if (!raw) {
    return null;
  }
  if (((pattern: RegExp, value: string) => { const match = pattern.exec(value); return match !== null && match[0] === value ? match : null; })(_BUILD_ID_GIT_HASH_RE, String(raw)) !== null) {
    return raw.toLowerCase();
  }
  const match = new RegExp("(?:\\+|\\.)g([0-9a-f]{7,40})\\b", 'i').exec(String(raw));
  if (match === null) {
    return null;
  }
  return match[1].toLowerCase();
}

export function buildsCompatible(peerBuildId: string, hostBuildId: string): boolean {
  // Return True when two peers should be able to talk to each other.
  //
  // LAN gameplay is lockstep and will desync on behavioral mismatches anyway; this
  // is a guardrail against obvious incompatibilities while allowing:
  // - release builds to join git checkouts for the same version (0.1.0 == 0.1.0+g...),
  // - old hash-only build ids to interop with new "<version>+g<hash>" ids.
  const peer = peerBuildId;
  const host = hostBuildId;
  if (peer === host) {
    return true;
  }

  const peerHash = buildGitHash(peer);
  const hostHash = buildGitHash(host);
  if (peerHash !== null && hostHash !== null) {
    // Lockstep sessions are sensitive to tiny behavioral drift. If both peers
    // report git hashes, require an exact hash match.
    return peerHash === hostHash;
  }

  const peerVer = buildPublicVersion(peer);
  const hostVer = buildPublicVersion(host);
  if (peerVer !== null && hostVer !== null && peerVer === hostVer) {
    return true;
  }

  return false;
}

export function currentBuildId(): string {
  // Return runtime build id.
  //
  // Format:
  // - In a git checkout: "<version>+g<short_sha>"
  // - In a packaged build (no git): "<version>"
  const version = String(VERSION);
  let repoRoot: string;
  let out: Uint8Array;
  let build: string;
  try {
    repoRoot = '';
    const gitExe = null;
    if (gitExe === null) {
      return version;
    }
    out = new Uint8Array();
    build = new TextDecoder('utf-8').decode(out).trim();
    if (build) {
      if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(version, '+')) {
        return `${version}.g${build}`;
      }
      return `${version}+g${build}`;
    }
  } catch (exc) {
    return version;
  }
  return version;
}

export function encodePacket(packet: LockstepPacket): Uint8Array {
  return new MsgpackEncoder().encode(packet);
}

export function decodePacket(blob: Uint8Array): LockstepPacket {
  return _PACKET_DECODER.decode(blob);
}

const _PACKET_DECODER = new MsgpackDecoder<LockstepPacket>({ type: LockstepPacket });
