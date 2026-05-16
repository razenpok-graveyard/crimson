// Port of crimson/net/resync.py

import { ResyncBegin, ResyncChunk, ResyncCommit } from '@crimson/net/lockstep-protocol.ts';
import { deflateSync, inflateSync } from 'node:zlib';

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

function secretsTokenHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class ResyncBuildError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'ResyncBuildError';
  }
}


export class ResyncPayload {
  replayBlob: Uint8Array;
  checkpointsBlob: Uint8Array;

  constructor(opts: {
    replayBlob: Uint8Array;
    checkpointsBlob: Uint8Array;
  }) {
    this.replayBlob = opts.replayBlob;
    this.checkpointsBlob = opts.checkpointsBlob;
  }
}

export class ResyncAssembler {
  beginMessage: ResyncBegin | null;
  _chunks: Map<number, Uint8Array>;
  _committedTick: number | null;

  constructor(opts: {
    beginMessage?: ResyncBegin | null;
    _chunks?: Map<number, Uint8Array>;
    _committedTick?: number | null;
  } = {}) {
    this.beginMessage = opts.beginMessage ?? null;
    this._chunks = opts._chunks ?? new Map();
    this._committedTick = opts._committedTick ?? null;
  }

  get streamId(): string {
    const begin = this.beginMessage;
    if (begin === null) {
      return '';
    }
    return String(begin.streamId);
  }

  reset(): void {
    this.beginMessage = null;
    this._chunks.clear();
    this._committedTick = null;
  }

  ingestBegin(begin: ResyncBegin): void {
    this.beginMessage = begin;
    this._chunks.clear();
    this._committedTick = null;
  }

  ingestChunk(chunk: ResyncChunk): boolean {
    const begin = this.beginMessage;
    if (begin === null) {
      return false;
    }
    if (String(chunk.streamId) !== String(begin.streamId)) {
      return false;
    }
    const idx = int(chunk.chunkIndex);
    if (idx < 0 || idx >= int(begin.totalChunks)) {
      return false;
    }
    this._chunks.set(idx, bytesFrom(chunk.payload));
    return true;
  }

  ingestCommit(commit: ResyncCommit): boolean {
    const begin = this.beginMessage;
    if (begin === null) {
      return false;
    }
    if (String(commit.streamId) !== String(begin.streamId)) {
      return false;
    }
    this._committedTick = int(commit.tickIndex);
    return true;
  }

  ready(): boolean {
    const begin = this.beginMessage;
    if (begin === null) {
      return false;
    }
    if (this._committedTick === null) {
      return false;
    }
    return this._chunks.size === int(begin.totalChunks);
  }

  rebuildPayload(): [Uint8Array, Uint8Array, number] {
    const begin = this.beginMessage;
    if (begin === null) {
      throw new ResyncBuildError('missing resync_begin');
    }
    if (this._committedTick === null) {
      throw new ResyncBuildError('missing resync_commit');
    }
    if (this._chunks.size !== int(begin.totalChunks)) {
      throw new ResyncBuildError(`missing chunks: have=${this._chunks.size} expected=${int(begin.totalChunks)}`);
    }

    const ordered = concatBytes(Array.from({ length: Math.max(0, int(begin.totalChunks)) }, (_, i) => i).map((idx) => this._chunks.get(idx)!));
    if (ordered.length !== int(begin.compressedSize)) {
      throw new ResyncBuildError(`compressed size mismatch: have=${ordered.length} expected=${int(begin.compressedSize)}`);
    }
    const packed = new Uint8Array(inflateSync(ordered));
    const payload = new MsgpackDecoder({ type: ResyncPayload }).decode(packed);
    if (payload.replayBlob.length !== int(begin.replaySize)) {
      throw new ResyncBuildError(`replay size mismatch: have=${payload.replayBlob.length} expected=${int(begin.replaySize)}`);
    }
    if (payload.checkpointsBlob.length !== int(begin.checkpointsSize)) {
      throw new ResyncBuildError(`checkpoint size mismatch: have=${payload.checkpointsBlob.length} expected=${int(begin.checkpointsSize)}`);
    }
    return [bytesFrom(payload.replayBlob), bytesFrom(payload.checkpointsBlob), int(this._committedTick)];
  }
}

function splitChunks(payload: Uint8Array, opts: { chunkSize: number }): Uint8Array[] {
  const chunkSize = opts.chunkSize;
  if (int(chunkSize) <= 0) {
    throw new ResyncBuildError(`chunk_size must be positive, got ${chunkSize}`);
  }
  const out: Uint8Array[] = [];
  for (let offset = 0; int(chunkSize) >= 0 ? offset < payload.length : offset > payload.length; offset += int(chunkSize)) {
    out.push(payload.slice(offset, offset + int(chunkSize)));
  }
  if (out.length === 0) {
    out.push(new Uint8Array([]));
  }
  return out;
}

export function buildResyncMessages(opts: { replayBlob: Uint8Array; checkpointsBlob: Uint8Array; tickIndex: number; chunkSize?: number; streamId?: string | null }): [ResyncBegin, ResyncChunk[], ResyncCommit] {
  const replayBlob = opts.replayBlob;
  const checkpointsBlob = opts.checkpointsBlob;
  const tickIndex = opts.tickIndex;
  const chunkSize = opts.chunkSize ?? 32_768;
  const streamId = opts.streamId ?? null;
  const payload = new ResyncPayload({ replayBlob: bytesFrom(replayBlob), checkpointsBlob: bytesFrom(checkpointsBlob) });
  const packed = new MsgpackEncoder().encode(payload);
  const compressed = new Uint8Array(deflateSync(packed, { level: 9 }));
  const chunksRaw = splitChunks(compressed, { chunkSize: int(chunkSize) });
  const resolvedStreamId = String(streamId || secretsTokenHex(8));

  const begin = new ResyncBegin({ streamId: resolvedStreamId, totalChunks: chunksRaw.length, compressedSize: compressed.length, replaySize: replayBlob.length, checkpointsSize: checkpointsBlob.length });
  const chunks = Array.from(chunksRaw.entries()).map(([idx, chunk]) => new ResyncChunk({ streamId: resolvedStreamId, chunkIndex: int(idx), payload: bytesFrom(chunk) }));
  const commit = new ResyncCommit({ streamId: resolvedStreamId, tickIndex: int(tickIndex) });
  return [begin, chunks, commit];
}
