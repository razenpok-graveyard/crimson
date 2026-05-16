// Port of crimson/dbg/schema.py

import type { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { ReplayCheckpoint } from '@crimson/replay/checkpoints.ts';
import type { EntitySamplesSnapshot, RngStreamRow, SimStateSnapshot, TimingSampleRow } from '@crimson/dbg/canonical-channels.ts';

export const TRACE_MAGIC = new Uint8Array([99, 114, 105, 109, 115, 111, 110, 95, 100, 101, 98, 117, 103, 95, 116, 114, 97, 99, 101, 95, 118, 49, 10]);
export const TRACE_FORMAT_VERSION = 1;
export const TRACE_SCHEMA_VERSION = 10;
export const SUPPORTED_TRACE_SCHEMA_VERSIONS = new Set([TRACE_SCHEMA_VERSION]);
export const TRACE_REQUIRED_CHANNELS = [
  'checkpoint',
  'sim_state',
  'entity_samples',
  'rng_stream',
  'timing_samples',
];
const _DEFAULT_CHANNEL_VERSION = 1;
const _CHUNK_KIND_META = new Uint8Array([77, 69, 84, 65]);
const _CHUNK_KIND_TICK = new Uint8Array([84, 73, 67, 75]);
const _CHUNK_KIND_FOOTER = new Uint8Array([70, 79, 84, 82]);
export const CHUNK_KINDS = new Set([_CHUNK_KIND_META, _CHUNK_KIND_TICK, _CHUNK_KIND_FOOTER]);
export const CHUNK_KIND_META = new TextDecoder('ascii').decode(_CHUNK_KIND_META);
export const CHUNK_KIND_TICK = new TextDecoder('ascii').decode(_CHUNK_KIND_TICK);
export const CHUNK_KIND_FOOTER = new TextDecoder('ascii').decode(_CHUNK_KIND_FOOTER);
export const TRAILER_MAGIC = new Uint8Array([67, 68, 84, 70, 84, 82, 49, 10]);
export const CHUNK_FLAG_ZSTD = 1 << 0;
export const CHUNK_FLAG_MSGPACK = 1 << 1;
export const DEFAULT_CHUNK_FLAGS = int(CHUNK_FLAG_ZSTD | CHUNK_FLAG_MSGPACK);

export class TraceMeta {
  traceFormatVersion: number;
  traceSchemaVersion: number;
  createdUtc: string;
  producer: Map<string, unknown>;
  source: Map<string, unknown>;
  channels: string[];
  channelVersions: Map<string, number>;
  tickRange: Map<string, number>;
  config: Map<string, unknown>;
  status: GameStatusData | null;

  constructor(opts: {
    traceFormatVersion: number;
    traceSchemaVersion: number;
    createdUtc: string;
    producer: Map<string, unknown>;
    source: Map<string, unknown>;
    channels: string[];
    channelVersions: Map<string, number>;
    tickRange: Map<string, number>;
    config: Map<string, unknown>;
    status?: GameStatusData | null;
  }) {
    this.traceFormatVersion = opts.traceFormatVersion;
    this.traceSchemaVersion = opts.traceSchemaVersion;
    this.createdUtc = opts.createdUtc;
    this.producer = opts.producer;
    this.source = opts.source;
    this.channels = opts.channels;
    this.channelVersions = opts.channelVersions;
    this.tickRange = opts.tickRange;
    this.config = opts.config;
    this.status = opts.status ?? null;
  }
}

export class ReplayTickChannels {
  checkpoint: ReplayCheckpoint;
  simState: SimStateSnapshot;
  entitySamples: EntitySamplesSnapshot;
  rngStream: RngStreamRow[];
  timingSamples: TimingSampleRow[];

  constructor(opts: {
    checkpoint: ReplayCheckpoint;
    simState: SimStateSnapshot;
    entitySamples: EntitySamplesSnapshot;
    rngStream?: RngStreamRow[];
    timingSamples?: TimingSampleRow[];
  }) {
    this.checkpoint = opts.checkpoint;
    this.simState = opts.simState;
    this.entitySamples = opts.entitySamples;
    this.rngStream = opts.rngStream ?? [];
    this.timingSamples = opts.timingSamples ?? [];
  }
}

export class TickRecord {
  tickIndex: number;
  elapsedMs: number;
  dtMsI32: number;
  modeId: number;
  channels: ReplayTickChannels;
  phaseMarkers: string[];

  constructor(opts: {
    tickIndex: number;
    elapsedMs: number;
    dtMsI32: number;
    modeId: number;
    channels: ReplayTickChannels;
    phaseMarkers?: string[];
  }) {
    this.tickIndex = opts.tickIndex;
    this.elapsedMs = opts.elapsedMs;
    this.dtMsI32 = opts.dtMsI32;
    this.modeId = opts.modeId;
    this.channels = opts.channels;
    this.phaseMarkers = opts.phaseMarkers ?? [];
  }
}

export class TickBlock {
  startTick: number;
  endTick: number;
  ticks: TickRecord[];

  constructor(opts: {
    startTick: number;
    endTick: number;
    ticks: TickRecord[];
  }) {
    this.startTick = opts.startTick;
    this.endTick = opts.endTick;
    this.ticks = opts.ticks;
  }
}

export class TickBlockIndexEntry {
  startTick: number;
  endTick: number;
  fileOffset: number;
  compressedLen: number;
  uncompressedLen: number;
  checksum: number;

  constructor(opts: {
    startTick: number;
    endTick: number;
    fileOffset: number;
    compressedLen: number;
    uncompressedLen: number;
    checksum: number;
  }) {
    this.startTick = opts.startTick;
    this.endTick = opts.endTick;
    this.fileOffset = opts.fileOffset;
    this.compressedLen = opts.compressedLen;
    this.uncompressedLen = opts.uncompressedLen;
    this.checksum = opts.checksum;
  }
}

export class TraceFooter {
  traceFormatVersion: number;
  tickBlocks: TickBlockIndexEntry[];
  tickCount: number;
  firstTick: number;
  lastTick: number;
  channelCounts: Map<string, number>;

  constructor(opts: {
    traceFormatVersion: number;
    tickBlocks: TickBlockIndexEntry[];
    tickCount: number;
    firstTick: number;
    lastTick: number;
    channelCounts: Map<string, number>;
  }) {
    this.traceFormatVersion = opts.traceFormatVersion;
    this.tickBlocks = opts.tickBlocks;
    this.tickCount = opts.tickCount;
    this.firstTick = opts.firstTick;
    this.lastTick = opts.lastTick;
    this.channelCounts = opts.channelCounts;
  }
}

export function channelVersionsFor(channels: Iterable<string>): Map<string, number> {
  return new Map(Array.from(channels, (channel) => [String(channel), int(_DEFAULT_CHANNEL_VERSION)] as const));
}
