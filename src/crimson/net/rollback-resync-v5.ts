// Port of crimson/net/rollback_resync_v5.py

import type { SpawnEntry } from '@crimson/quests/types.ts';
import { assertWireF32, wireF32 } from '@crimson/wire/float32-wire.ts';
import { RESYNC_CHUNK_PAYLOAD_BYTES, RESYNC_MAX_SNAPSHOT_BYTES, RbResyncBegin, RbResyncChunk, RbResyncCommit } from '@crimson/net/relay-protocol.ts';
import { deflateSync, inflateSync } from 'node:zlib';

export type ModeStateSnapshotV2 = SurvivalStateSnapshotV2 | RushStateSnapshotV2 | QuestsStateSnapshotV2;

const ModeStateSnapshotV2 = function ModeStateSnapshotV2TaggedUnion(opts: Record<string, unknown>) {
  const tag = String(opts["mode"] ?? opts['tag'] ?? '');
  switch (tag) {
    case "survival":
      return new SurvivalStateSnapshotV2(opts as ConstructorParameters<typeof SurvivalStateSnapshotV2>[0]);
    case "rush":
      return new RushStateSnapshotV2(opts as ConstructorParameters<typeof RushStateSnapshotV2>[0]);
    case "quests":
      return new QuestsStateSnapshotV2(opts as ConstructorParameters<typeof QuestsStateSnapshotV2>[0]);
    default:
      throw new Error(`unsupported ModeStateSnapshotV2 tag: ${tag}`);
  }
} as unknown as new (opts: Record<string, unknown>) => ModeStateSnapshotV2;

function bytesFrom(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
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

// Raised when rollback resync stream payloads are invalid.
export class RollbackResyncV5Error extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'RollbackResyncV5Error';
  }
}


export const SCHEMA_VERSION = 4;
export const SNAPSHOT_CODEC = 'msgpack_state_v4_f32wire';
const _SNAPSHOT_ENCODER = new MsgpackEncoder();
const _SNAPSHOT_DECODER = new MsgpackDecoder<ModeStateSnapshotV2>({ type: ModeStateSnapshotV2 });

export class ReplayStateSnapshotV2 {
  tickIndex: number;
  recordedTickCount: number;

  constructor(opts: {
    tickIndex?: number;
    recordedTickCount?: number;
  } = {}) {
    this.tickIndex = opts.tickIndex ?? 0;
    this.recordedTickCount = opts.recordedTickCount ?? 0;
    this.tickIndex = int(this.tickIndex);
    this.recordedTickCount = int(this.recordedTickCount);
  }
}

export class SurvivalRuntimeSnapshotV2 {
  elapsedMs: number;
  stage: number;
  spawnCooldownMs: number;
  perkPendingCount: number;

  constructor(opts: {
    elapsedMs?: number;
    stage?: number;
    spawnCooldownMs?: number;
    perkPendingCount?: number;
  } = {}) {
    this.elapsedMs = opts.elapsedMs ?? 0.0;
    this.stage = opts.stage ?? 0;
    this.spawnCooldownMs = opts.spawnCooldownMs ?? 0.0;
    this.perkPendingCount = opts.perkPendingCount ?? 0;
    this.elapsedMs = wireF32(this.elapsedMs, { field: 'survival.runtime_state.elapsed_ms' });
    this.stage = int(this.stage);
    this.spawnCooldownMs = wireF32(this.spawnCooldownMs, { field: 'survival.runtime_state.spawn_cooldown_ms' });
    this.perkPendingCount = int(this.perkPendingCount);
  }
}

export class RushRuntimeSnapshotV2 {
  elapsedMs: number;
  spawnCooldownMs: number;
  killCount: number;

  constructor(opts: {
    elapsedMs?: number;
    spawnCooldownMs?: number;
    killCount?: number;
  } = {}) {
    this.elapsedMs = opts.elapsedMs ?? 0.0;
    this.spawnCooldownMs = opts.spawnCooldownMs ?? 0.0;
    this.killCount = opts.killCount ?? 0;
    this.elapsedMs = wireF32(this.elapsedMs, { field: 'rush.runtime_state.elapsed_ms' });
    this.spawnCooldownMs = wireF32(this.spawnCooldownMs, { field: 'rush.runtime_state.spawn_cooldown_ms' });
    this.killCount = int(this.killCount);
  }
}

export class QuestsRuntimeSnapshotV2 {
  elapsedMs: number;
  spawnEntries: readonly SpawnEntry[];
  spawnTimelineMs: number;
  noCreaturesTimerMs: number;
  completionTransitionMs: number;
  perkPendingCount: number;

  constructor(opts: {
    elapsedMs?: number;
    spawnEntries?: readonly SpawnEntry[];
    spawnTimelineMs?: number;
    noCreaturesTimerMs?: number;
    completionTransitionMs?: number;
    perkPendingCount?: number;
  } = {}) {
    this.elapsedMs = opts.elapsedMs ?? 0.0;
    this.spawnEntries = Array.from(opts.spawnEntries ?? []);
    this.spawnTimelineMs = opts.spawnTimelineMs ?? 0.0;
    this.noCreaturesTimerMs = opts.noCreaturesTimerMs ?? 0.0;
    this.completionTransitionMs = opts.completionTransitionMs ?? 0.0;
    this.perkPendingCount = opts.perkPendingCount ?? 0;
    this.elapsedMs = wireF32(this.elapsedMs, { field: 'quests.runtime_state.elapsed_ms' });
    this.spawnEntries = Array.from(this.spawnEntries);
    this.spawnTimelineMs = wireF32(this.spawnTimelineMs, { field: 'quests.runtime_state.spawn_timeline_ms' });
    this.noCreaturesTimerMs = wireF32(this.noCreaturesTimerMs, { field: 'quests.runtime_state.no_creatures_timer_ms' });
    this.completionTransitionMs = wireF32(this.completionTransitionMs, { field: 'quests.runtime_state.completion_transition_ms' });
    this.perkPendingCount = int(this.perkPendingCount);
  }
}

export class ModeStateSnapshotV2Base {
  schemaVersion: number;
  tickIndex: number;
  replayState: ReplayStateSnapshotV2 | null;

  constructor(opts: {
    schemaVersion?: number;
    tickIndex?: number;
    replayState?: ReplayStateSnapshotV2 | null;
  } = {}) {
    this.schemaVersion = opts.schemaVersion ?? SCHEMA_VERSION;
    this.tickIndex = opts.tickIndex ?? 0;
    this.replayState = opts.replayState ?? null;
    this.schemaVersion = int(this.schemaVersion);
    this.tickIndex = int(this.tickIndex);
  }
}

export class SurvivalStateSnapshotV2 extends ModeStateSnapshotV2Base {
  readonly mode = 'survival';
  runtimeState: SurvivalRuntimeSnapshotV2;

  constructor(opts: {
    runtimeState?: SurvivalRuntimeSnapshotV2;
  } & ConstructorParameters<typeof ModeStateSnapshotV2Base>[0] = {}) {
    super(opts);
    this.runtimeState = opts.runtimeState ?? new SurvivalRuntimeSnapshotV2();
  }
}

export class RushStateSnapshotV2 extends ModeStateSnapshotV2Base {
  readonly mode = 'rush';
  runtimeState: RushRuntimeSnapshotV2;

  constructor(opts: {
    runtimeState?: RushRuntimeSnapshotV2;
  } & ConstructorParameters<typeof ModeStateSnapshotV2Base>[0] = {}) {
    super(opts);
    this.runtimeState = opts.runtimeState ?? new RushRuntimeSnapshotV2();
  }
}

export class QuestsStateSnapshotV2 extends ModeStateSnapshotV2Base {
  readonly mode = 'quests';
  runtimeState: QuestsRuntimeSnapshotV2;

  constructor(opts: {
    runtimeState?: QuestsRuntimeSnapshotV2;
  } & ConstructorParameters<typeof ModeStateSnapshotV2Base>[0] = {}) {
    super(opts);
    this.runtimeState = opts.runtimeState ?? new QuestsRuntimeSnapshotV2();
  }
}

export class RbResyncMessageSet {
  readonly begin: RbResyncBegin;
  readonly chunks: RbResyncChunk[];
  readonly commit: RbResyncCommit;

  constructor(opts: {
    begin: RbResyncBegin;
    chunks: RbResyncChunk[];
    commit: RbResyncCommit;
  }) {
    this.begin = opts.begin;
    this.chunks = opts.chunks;
    this.commit = opts.commit;
  }
}

export class RbResyncAssemblerV5 {
  maxSnapshotBytes: number;
  _begin: RbResyncBegin | null;
  _chunks: Map<number, Uint8Array>;

  constructor(opts: {
    maxSnapshotBytes?: number;
    _begin?: RbResyncBegin | null;
    _chunks?: Map<number, Uint8Array>;
  } = {}) {
    this.maxSnapshotBytes = opts.maxSnapshotBytes ?? RESYNC_MAX_SNAPSHOT_BYTES;
    this._begin = opts._begin ?? null;
    this._chunks = opts._chunks ?? new Map();
  }

  get requestId(): string {
    const begin = this._begin;
    if (begin === null) {
      return '';
    }
    return String(begin.requestId || '');
  }

  begin(message: RbResyncBegin): void {
    if (String(message.codec) !== SNAPSHOT_CODEC) {
      throw new RollbackResyncV5Error('unsupported_snapshot_codec');
    }
    if (int(message.compressedSize) < 0 || int(message.compressedSize) > int(this.maxSnapshotBytes)) {
      throw new RollbackResyncV5Error('compressed_snapshot_size_invalid');
    }
    if (int(message.uncompressedSize) < 0 || int(message.uncompressedSize) > int(this.maxSnapshotBytes)) {
      throw new RollbackResyncV5Error('snapshot_size_invalid');
    }
    if (int(message.totalChunks) <= 0) {
      throw new RollbackResyncV5Error('resync_chunk_count_invalid');
    }
    this._begin = message;
    this._chunks.clear();
  }

  pushChunk(message: RbResyncChunk): void {
    const begin = this._begin;
    if (begin === null) {
      throw new RollbackResyncV5Error('resync_begin_missing');
    }
    if ((String(message.requestId || '')) !== (String(begin.requestId || ''))) {
      throw new RollbackResyncV5Error('resync_request_id_mismatch');
    }
    const index = int(message.chunkIndex);
    if (index < 0 || index >= int(begin.totalChunks)) {
      throw new RollbackResyncV5Error('resync_chunk_index_invalid');
    }
    this._chunks.set(index, bytesFrom(message.payload));
  }

  finalize(message: RbResyncCommit): [number, Uint8Array] {
    const begin = this._begin;
    if (begin === null) {
      throw new RollbackResyncV5Error('resync_begin_missing');
    }
    if ((String(message.requestId || '')) !== (String(begin.requestId || ''))) {
      throw new RollbackResyncV5Error('resync_request_id_mismatch');
    }
    if (int(message.snapshotTick) !== int(begin.snapshotTick)) {
      throw new RollbackResyncV5Error('resync_tick_mismatch');
    }

    const expectedChunks = int(begin.totalChunks);
    if (this._chunks.size !== int(expectedChunks)) {
      throw new RollbackResyncV5Error('resync_chunks_incomplete');
    }
    const compressed = concatBytes(Array.from({ length: Math.max(0, int(expectedChunks)) }, (_, i) => i).map((index) => mapGetOrThrow(this._chunks, index)));
    if (compressed.length !== int(begin.compressedSize)) {
      throw new RollbackResyncV5Error('resync_compressed_size_mismatch');
    }
    if (compressed.length > int(this.maxSnapshotBytes)) {
      throw new RollbackResyncV5Error('compressed_snapshot_too_large');
    }

    const payload = new Uint8Array(inflateSync(compressed));
    if (payload.length !== int(begin.uncompressedSize)) {
      throw new RollbackResyncV5Error('resync_uncompressed_size_mismatch');
    }
    if (payload.length > int(this.maxSnapshotBytes)) {
      throw new RollbackResyncV5Error('snapshot_too_large');
    }

    const tick = int(begin.snapshotTick);
    this._begin = null;
    this._chunks.clear();
    return [tick, payload];
  }
}

export function encodeModeSnapshot(opts: { snapshot: ModeStateSnapshotV2 }): Uint8Array {
  const snapshot = opts.snapshot;
  if (int(snapshot.schemaVersion) !== int(SCHEMA_VERSION)) {
    throw new RollbackResyncV5Error('unsupported_snapshot_schema');
  }
  assertSnapshotF32(snapshot);
  const blob = _SNAPSHOT_ENCODER.encode(snapshot);
  if (blob.length > int(RESYNC_MAX_SNAPSHOT_BYTES)) {
    throw new RollbackResyncV5Error('snapshot_too_large');
  }
  return blob;
}

export function decodeModeSnapshot(blob: Uint8Array): ModeStateSnapshotV2 {
  if (blob.length > int(RESYNC_MAX_SNAPSHOT_BYTES)) {
    throw new RollbackResyncV5Error('snapshot_too_large');
  }
  let snapshot: ReturnType<typeof _SNAPSHOT_DECODER.decode>;
  try {
    snapshot = _SNAPSHOT_DECODER.decode(blob);
  } catch (exc) {
    throw new RollbackResyncV5Error('snapshot_decode_error');
  }
  if (int(snapshot.schemaVersion) !== int(SCHEMA_VERSION)) {
    throw new RollbackResyncV5Error('unsupported_snapshot_schema');
  }
  assertSnapshotF32(snapshot);
  return snapshot;
}

function assertSnapshotF32(snapshot: ModeStateSnapshotV2): void {
  const replayState = snapshot.replayState;
  if (replayState !== null) {
    replayState.tickIndex = int(replayState.tickIndex);
    replayState.recordedTickCount = int(replayState.recordedTickCount);
  }
  if (snapshot instanceof SurvivalStateSnapshotV2) {
    let runtimeState = snapshot.runtimeState;
    runtimeState.elapsedMs = assertWireF32(runtimeState.elapsedMs, { field: 'survival.runtime_state.elapsed_ms' });
    runtimeState.spawnCooldownMs = assertWireF32(runtimeState.spawnCooldownMs, { field: 'survival.runtime_state.spawn_cooldown_ms' });
    return;
  } else if (snapshot instanceof RushStateSnapshotV2) {
    let runtimeState = snapshot.runtimeState;
    runtimeState.elapsedMs = assertWireF32(runtimeState.elapsedMs, { field: 'rush.runtime_state.elapsed_ms' });
    runtimeState.spawnCooldownMs = assertWireF32(runtimeState.spawnCooldownMs, { field: 'rush.runtime_state.spawn_cooldown_ms' });
    return;
  } else if (snapshot instanceof QuestsStateSnapshotV2) {
    let runtimeState = snapshot.runtimeState;
    runtimeState.elapsedMs = assertWireF32(runtimeState.elapsedMs, { field: 'quests.runtime_state.elapsed_ms' });
    runtimeState.spawnEntries = Array.from(runtimeState.spawnEntries);
    runtimeState.spawnTimelineMs = assertWireF32(runtimeState.spawnTimelineMs, { field: 'quests.runtime_state.spawn_timeline_ms' });
    runtimeState.noCreaturesTimerMs = assertWireF32(runtimeState.noCreaturesTimerMs, { field: 'quests.runtime_state.no_creatures_timer_ms' });
    runtimeState.completionTransitionMs = assertWireF32(runtimeState.completionTransitionMs, { field: 'quests.runtime_state.completion_transition_ms' });
  }
}

export function buildRbResyncMessages(opts: { requestId: string; snapshotTick: number; snapshotBlob: Uint8Array }): RbResyncMessageSet {
  const requestId = opts.requestId;
  const snapshotTick = opts.snapshotTick;
  const snapshotBlob = opts.snapshotBlob;
  const payload = bytesFrom(snapshotBlob);
  if (payload.length > int(RESYNC_MAX_SNAPSHOT_BYTES)) {
    throw new RollbackResyncV5Error('snapshot_too_large');
  }

  const compressed = new Uint8Array(deflateSync(payload, { level: 6 }));
  if (compressed.length > int(RESYNC_MAX_SNAPSHOT_BYTES)) {
    throw new RollbackResyncV5Error('compressed_snapshot_too_large');
  }

  const chunkSize = Math.max(1, int(RESYNC_CHUNK_PAYLOAD_BYTES));
  const totalChunks = Math.max(1, int(Math.ceil(compressed.length / chunkSize)));

  const begin = new RbResyncBegin({ requestId: requestId, snapshotTick: int(snapshotTick), codec: SNAPSHOT_CODEC, totalChunks: int(totalChunks), compressedSize: compressed.length, uncompressedSize: payload.length });

  const chunks: RbResyncChunk[] = [];
  for (let chunkIndex = 0; chunkIndex < int(totalChunks); chunkIndex++) {
    const start = int(chunkIndex) * int(chunkSize);
    const end = start + int(chunkSize);
    chunks.push(new RbResyncChunk({ requestId: requestId, chunkIndex: int(chunkIndex), payload: bytesFrom(compressed.slice(start, end)) }));
  }

  const commit = new RbResyncCommit({ requestId: requestId, snapshotTick: int(snapshotTick) });
  return new RbResyncMessageSet({ begin: begin, chunks: chunks, commit: commit });
}
