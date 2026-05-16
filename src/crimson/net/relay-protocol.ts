// Port of crimson/net/relay_protocol.py

import { GameMode } from '@crimson/game-modes.ts';
import type { NonNegativeInt, PlayerCount, PositiveInt, SignedIndex } from '@crimson/msgspec-types.ts';
import type { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import type { PackedPlayerInput } from '@crimson/replay/types.ts';
import { TICK_RATE } from '@crimson/net/lockstep-protocol.ts';
import type { RoomCode } from '@crimson/net/room-code.ts';
import { PacketHeader, SlotState } from '@crimson/net/schema-shared.ts';
export { INPUT_STALL_TIMEOUT_MS, MAX_PLAYERS, RELIABLE_RESEND_MS, TICK_RATE, buildGitHash, buildPublicVersion, buildsCompatible, currentBuildId } from '@crimson/net/lockstep-protocol.ts';
export { ROOM_CODE_LENGTH } from '@crimson/net/room-code.ts';

export type NetcodeMode = "rollback" | "lockstep";
export type NetMessage = ClientHello | ClientWelcome | RoomCreate | RoomJoin | RoomReady | RoomState | RoomStart | PeerDisconnect | RelayError | Ping | Pong | RbInputBatch | RbResyncRequest | RbResyncBegin | RbResyncChunk | RbResyncCommit | LockstepInputBatch | LockstepTickFrame | LockstepControl;

export class RelaySlot extends SlotState {
}

export class ClientHello {
  readonly tag = 'client_hello';
  protocolVersion: number;
  buildId: string;
  peerName: string;

  constructor(opts: {
    protocolVersion?: number;
    buildId?: string;
    peerName?: string;
  } = {}) {
    this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION;
    this.buildId = opts.buildId ?? '';
    this.peerName = opts.peerName ?? '';
  }
}

export class ClientWelcome {
  readonly tag = 'client_welcome';
  accepted: boolean;
  reason: string;
  protocolVersion: number;
  buildId: string;
  peerId: string;

  constructor(opts: {
    accepted?: boolean;
    reason?: string;
    protocolVersion?: number;
    buildId?: string;
    peerId?: string;
  } = {}) {
    this.accepted = opts.accepted ?? false;
    this.reason = opts.reason ?? '';
    this.protocolVersion = opts.protocolVersion ?? PROTOCOL_VERSION;
    this.buildId = opts.buildId ?? '';
    this.peerId = opts.peerId ?? '';
  }
}

export class RoomCreate {
  readonly tag = 'room_create';
  modeId: GameMode;
  playerCount: PlayerCount;
  questLevel: QuestLevel | null;
  preserveBugs: boolean;
  tickRate: PositiveInt;
  inputDelayTicks: NonNegativeInt;
  rollbackMaxTicks: PositiveInt;
  netcodeMode: NetcodeMode;
  status: GameStatusData | null;

  constructor(opts: {
    modeId?: GameMode;
    playerCount?: PlayerCount;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    tickRate?: PositiveInt;
    inputDelayTicks?: NonNegativeInt;
    rollbackMaxTicks?: PositiveInt;
    netcodeMode?: NetcodeMode;
    status?: GameStatusData | null;
  } = {}) {
    this.modeId = opts.modeId ?? GameMode.DEMO;
    this.playerCount = opts.playerCount ?? 1;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.tickRate = opts.tickRate ?? TICK_RATE;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.rollbackMaxTicks = opts.rollbackMaxTicks ?? ROLLBACK_MAX_TICKS;
    this.netcodeMode = opts.netcodeMode ?? 'rollback';
    this.status = opts.status ?? null;
  }
}

export class RoomJoin {
  readonly tag = 'room_join';
  roomCode: RoomCode | null;
  reconnectToken: string;

  constructor(opts: {
    roomCode?: RoomCode | null;
    reconnectToken?: string;
  } = {}) {
    this.roomCode = opts.roomCode ?? null;
    this.reconnectToken = opts.reconnectToken ?? '';
  }
}

export class RoomReady {
  readonly tag = 'room_ready';
  slotIndex: number;
  ready: boolean;

  constructor(opts: {
    slotIndex?: number;
    ready?: boolean;
  } = {}) {
    this.slotIndex = opts.slotIndex ?? -1;
    this.ready = opts.ready ?? false;
  }
}

export class RoomState {
  readonly tag = 'room_state';
  roomCode: RoomCode;
  sessionId: string;
  modeId: GameMode;
  playerCount: PlayerCount;
  questLevel: QuestLevel | null;
  preserveBugs: boolean;
  tickRate: PositiveInt;
  inputDelayTicks: NonNegativeInt;
  rollbackMaxTicks: PositiveInt;
  netcodeMode: NetcodeMode;
  slots: RelaySlot[];
  allReady: boolean;
  started: boolean;

  constructor(opts: {
    roomCode: RoomCode;
    sessionId?: string;
    modeId?: GameMode;
    playerCount?: PlayerCount;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    tickRate?: PositiveInt;
    inputDelayTicks?: NonNegativeInt;
    rollbackMaxTicks?: PositiveInt;
    netcodeMode?: NetcodeMode;
    slots?: RelaySlot[];
    allReady?: boolean;
    started?: boolean;
  }) {
    this.roomCode = opts.roomCode;
    this.sessionId = opts.sessionId ?? '';
    this.modeId = opts.modeId ?? GameMode.DEMO;
    this.playerCount = opts.playerCount ?? 1;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.tickRate = opts.tickRate ?? TICK_RATE;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.rollbackMaxTicks = opts.rollbackMaxTicks ?? ROLLBACK_MAX_TICKS;
    this.netcodeMode = opts.netcodeMode ?? 'rollback';
    this.slots = opts.slots ?? [];
    this.allReady = opts.allReady ?? false;
    this.started = opts.started ?? false;
  }
}

export class RoomStart {
  readonly tag = 'room_start';
  roomCode: RoomCode;
  sessionId: string;
  seed: number;
  startTick: NonNegativeInt;
  modeId: GameMode;
  playerCount: PlayerCount;
  questLevel: QuestLevel | null;
  preserveBugs: boolean;
  tickRate: PositiveInt;
  inputDelayTicks: NonNegativeInt;
  rollbackMaxTicks: PositiveInt;
  netcodeMode: NetcodeMode;
  slotIndex: SignedIndex;
  hostSlotIndex: NonNegativeInt;
  reconnectToken: string;
  status: GameStatusData | null;

  constructor(opts: {
    roomCode: RoomCode;
    sessionId?: string;
    seed?: number;
    startTick?: NonNegativeInt;
    modeId?: GameMode;
    playerCount?: PlayerCount;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    tickRate?: PositiveInt;
    inputDelayTicks?: NonNegativeInt;
    rollbackMaxTicks?: PositiveInt;
    netcodeMode?: NetcodeMode;
    slotIndex?: SignedIndex;
    hostSlotIndex?: NonNegativeInt;
    reconnectToken?: string;
    status?: GameStatusData | null;
  }) {
    this.roomCode = opts.roomCode;
    this.sessionId = opts.sessionId ?? '';
    this.seed = opts.seed ?? 0;
    this.startTick = opts.startTick ?? 0;
    this.modeId = opts.modeId ?? GameMode.DEMO;
    this.playerCount = opts.playerCount ?? 1;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.tickRate = opts.tickRate ?? TICK_RATE;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.rollbackMaxTicks = opts.rollbackMaxTicks ?? ROLLBACK_MAX_TICKS;
    this.netcodeMode = opts.netcodeMode ?? 'rollback';
    this.slotIndex = opts.slotIndex ?? -1;
    this.hostSlotIndex = opts.hostSlotIndex ?? 0;
    this.reconnectToken = opts.reconnectToken ?? '';
    this.status = opts.status ?? null;
  }
}

export class PeerDisconnect {
  readonly tag = 'peer_disconnect';
  slotIndex: SignedIndex;
  reason: string;

  constructor(opts: {
    slotIndex?: SignedIndex;
    reason?: string;
  } = {}) {
    this.slotIndex = opts.slotIndex ?? -1;
    this.reason = opts.reason ?? '';
  }
}

export class RelayError {
  readonly tag = 'relay_error';
  reason: string;

  constructor(opts: {
    reason?: string;
  } = {}) {
    this.reason = opts.reason ?? '';
  }
}

export class Ping {
  readonly tag = 'ping';
  stampMs: NonNegativeInt;

  constructor(opts: {
    stampMs?: NonNegativeInt;
  } = {}) {
    this.stampMs = opts.stampMs ?? 0;
  }
}

export class Pong {
  readonly tag = 'pong';
  stampMs: NonNegativeInt;

  constructor(opts: {
    stampMs?: NonNegativeInt;
  } = {}) {
    this.stampMs = opts.stampMs ?? 0;
  }
}

export class RbInputSample {
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

export class RbInputBatch {
  readonly tag = 'rb_input_sample';
  slotIndex: SignedIndex;
  samples: RbInputSample[];

  constructor(opts: {
    slotIndex?: SignedIndex;
    samples?: RbInputSample[];
  } = {}) {
    this.slotIndex = opts.slotIndex ?? -1;
    this.samples = opts.samples ?? [];
  }
}

export class RbResyncRequest {
  readonly tag = 'rb_resync_request';
  requestId: string;
  fromTick: NonNegativeInt;
  reason: string;
  requestedBySlot: SignedIndex;

  constructor(opts: {
    requestId?: string;
    fromTick?: NonNegativeInt;
    reason?: string;
    requestedBySlot?: SignedIndex;
  } = {}) {
    this.requestId = opts.requestId ?? '';
    this.fromTick = opts.fromTick ?? 0;
    this.reason = opts.reason ?? '';
    this.requestedBySlot = opts.requestedBySlot ?? -1;
  }
}

export class RbResyncBegin {
  readonly tag = 'rb_resync_begin';
  requestId: string;
  snapshotTick: NonNegativeInt;
  codec: string;
  totalChunks: NonNegativeInt;
  compressedSize: NonNegativeInt;
  uncompressedSize: NonNegativeInt;

  constructor(opts: {
    requestId?: string;
    snapshotTick?: NonNegativeInt;
    codec?: string;
    totalChunks?: NonNegativeInt;
    compressedSize?: NonNegativeInt;
    uncompressedSize?: NonNegativeInt;
  } = {}) {
    this.requestId = opts.requestId ?? '';
    this.snapshotTick = opts.snapshotTick ?? 0;
    this.codec = opts.codec ?? 'msgpack_state_v1';
    this.totalChunks = opts.totalChunks ?? 0;
    this.compressedSize = opts.compressedSize ?? 0;
    this.uncompressedSize = opts.uncompressedSize ?? 0;
  }
}

export class RbResyncChunk {
  readonly tag = 'rb_resync_chunk';
  requestId: string;
  chunkIndex: NonNegativeInt;
  payload: Uint8Array;

  constructor(opts: {
    requestId?: string;
    chunkIndex?: NonNegativeInt;
    payload?: Uint8Array;
  } = {}) {
    this.requestId = opts.requestId ?? '';
    this.chunkIndex = opts.chunkIndex ?? 0;
    this.payload = opts.payload ?? new Uint8Array([]);
  }
}

export class RbResyncCommit {
  readonly tag = 'rb_resync_commit';
  requestId: string;
  snapshotTick: NonNegativeInt;

  constructor(opts: {
    requestId?: string;
    snapshotTick?: NonNegativeInt;
  } = {}) {
    this.requestId = opts.requestId ?? '';
    this.snapshotTick = opts.snapshotTick ?? 0;
  }
}

export class LockstepInputBatch {
  readonly tag = 'lockstep_state_input_batch';
  payload: Uint8Array;

  constructor(opts: {
    payload?: Uint8Array;
  } = {}) {
    this.payload = opts.payload ?? new Uint8Array([]);
  }
}

export class LockstepTickFrame {
  readonly tag = 'lockstep_state_tick_frame';
  payload: Uint8Array;

  constructor(opts: {
    payload?: Uint8Array;
  } = {}) {
    this.payload = opts.payload ?? new Uint8Array([]);
  }
}

export class LockstepControl {
  readonly tag = 'lockstep_state_control';
  payload: Uint8Array;

  constructor(opts: {
    payload?: Uint8Array;
  } = {}) {
    this.payload = opts.payload ?? new Uint8Array([]);
  }
}

export class RelayPacket extends PacketHeader {
  message: NetMessage;

  constructor(opts: {
    message?: NetMessage;
  } & ConstructorParameters<typeof PacketHeader>[0] = {}) {
    super(opts);
    this.message = opts.message ?? new Ping();
  }
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

export const PROTOCOL_VERSION = 6;
export const DEFAULT_PORT = 31993;
export const INPUT_DELAY_TICKS = 1;
export const ROLLBACK_MAX_TICKS = 8;
export const RECONNECT_TIMEOUT_MS = 15_000;
export const LINK_TIMEOUT_MS = 5_000;
export const PING_INTERVAL_MS = 250;
export const RESYNC_CHUNK_PAYLOAD_BYTES = 1_024;
export const RESYNC_MAX_SNAPSHOT_BYTES = 2_097_152;
const _PACKET_DECODER = new MsgpackDecoder({ type: RelayPacket });

export function encodePacket(packet: RelayPacket): Uint8Array {
  return new MsgpackEncoder().encode(packet);
}

export function decodePacket(blob: Uint8Array): RelayPacket {
  return _PACKET_DECODER.decode(blob);
}
