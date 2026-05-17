// Port of crimson/dbg/diff.py

import { compareEntitySamples, compareRngStream, compareSimState, compareTimingSamples } from '@crimson/dbg/channel-compare.ts';
import { checkpointChannelRequired, entitySamplesChannelRequired, rngStreamChannelRequired, simStateChannelRequired, timingSamplesChannelRequired } from '@crimson/dbg/channel-helpers.ts';
import { checkpointDeepdiff } from '@crimson/dbg/checkpoint-diff.ts';
import { BuiltinObject, toBuiltinObject } from '@crimson/dbg/payloads.ts';
import type { TickRecord } from '@crimson/dbg/schema.ts';
import { TRACE_REQUIRED_CHANNELS } from '@crimson/dbg/schema.ts';
import { TraceError, TraceReader } from '@crimson/dbg/trace.ts';

function pythonCompareKeys(left: any, right: any): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const item = pythonCompareKeys(left[index], right[index]);
      if (item !== 0) {
        return item;
      }
    }
    return left.length - right.length;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function tickMismatchRow(opts: { kind: string; channel: string; detail: BuiltinObject | null }): BuiltinObject {
  const kind = opts.kind;
  const channel = opts.channel;
  const detail = opts.detail;
  return toBuiltinObject({ 'kind': kind, 'channel': channel, 'detail': detail === null ? null : toBuiltinObject(detail, { field: `${channel}.detail` }) }, { field: `${channel}.mismatch` });
}

function firstMismatch(opts: { pairs: TickPair[]; tickEnd?: number | null }): [number, TraceMismatch | null] {
  const pairs = opts.pairs;
  const tickEnd = opts.tickEnd ?? null;
  let checkedCount = 0;
  for (const pair of pairs) {
    const tick = pair.tickIndex;
    if (tickEnd !== null && tick > tickEnd) {
      break;
    }
    checkedCount += 1;
    if (pair.expectedRow === null || pair.actualRow === null) {
      return [checkedCount, new TraceMismatch({ kind: 'missing_tick', tickIndex: tick })];
    }
    const tickMismatches: BuiltinObject[] = [];

    const expected = checkpointChannelRequired(pair.expectedRow);
    const actual = checkpointChannelRequired(pair.actualRow);
    const expRngStream = rngStreamChannelRequired(pair.expectedRow);
    const actRngStream = rngStreamChannelRequired(pair.actualRow);

    const checkpointDiff = checkpointDeepdiff(expected, actual);
    if (checkpointDiff !== null) {
      tickMismatches.push(tickMismatchRow({ kind: 'checkpoint_field_mismatch', channel: 'checkpoint', detail: { 'diff_count': int(checkpointDiff.diffCount), 'payload': structuredClone(checkpointDiff.payload), 'pretty': String(checkpointDiff.pretty) } }));
    }

    const [rngOk, rngDetail] = compareRngStream(expRngStream, actRngStream);
    if (!rngOk) {
      tickMismatches.push(tickMismatchRow({ kind: 'rng_stream_mismatch', channel: 'rng_stream', detail: rngDetail }));
    }

    const expectedSimState = simStateChannelRequired(pair.expectedRow);
    const actualSimState = simStateChannelRequired(pair.actualRow);
    const [simOk, simDetail] = compareSimState(expectedSimState, actualSimState);
    if (!simOk) {
      tickMismatches.push(tickMismatchRow({ kind: 'sim_state_mismatch', channel: 'sim_state', detail: simDetail }));
    }

    const expectedEntitySamples = entitySamplesChannelRequired(pair.expectedRow);
    const actualEntitySamples = entitySamplesChannelRequired(pair.actualRow);
    const [entitiesOk, entitiesDetail] = compareEntitySamples(expectedEntitySamples, actualEntitySamples);
    if (!entitiesOk) {
      tickMismatches.push(tickMismatchRow({ kind: 'entity_sample_mismatch', channel: 'entity_samples', detail: entitiesDetail }));
    }

    const expectedTimingSamples = timingSamplesChannelRequired(pair.expectedRow);
    const actualTimingSamples = timingSamplesChannelRequired(pair.actualRow);
    const [timingOk, timingDetail] = compareTimingSamples(expectedTimingSamples, actualTimingSamples);
    if (!timingOk) {
      tickMismatches.push(tickMismatchRow({ kind: 'timing_samples_mismatch', channel: 'timing_samples', detail: timingDetail }));
    }

    if (tickMismatches.length > 0) {
      return [checkedCount, new TraceMismatch({ kind: 'tick_mismatch', tickIndex: tick, detail: { 'mismatch_count': tickMismatches.length, 'mismatches': tickMismatches } })];
    }
  }

  return [checkedCount, null];
}

function loadPairs(opts: { expectedTrace: TraceReader; actualTrace: TraceReader; tickStart: number | null; tickEnd: number | null }): TickPair[] {
  const expectedTrace = opts.expectedTrace;
  const actualTrace = opts.actualTrace;
  const tickStart = opts.tickStart;
  const tickEnd = opts.tickEnd;
  const expectedRows = new Map(Array.from(expectedTrace.iterTicks({ tickStart: tickStart, tickEnd: tickEnd }), (row: any) => [row.tickIndex, row] as const));
  const actualRows = new Map(Array.from(actualTrace.iterTicks({ tickStart: tickStart, tickEnd: tickEnd }), (row: any) => [row.tickIndex, row] as const));
  const allTicks = Array.from(new Set([...new Set(expectedRows.keys()), ...new Set(actualRows.keys())])).sort((left, right) => pythonCompareKeys(left, right));
  const pairs: TickPair[] = [];
  for (const tick of allTicks) {
    const expRow = expectedRows.get(tick) ?? null;
    const actRow = actualRows.get(tick) ?? null;
    pairs.push(new TickPair({ tickIndex: tick, expectedRow: expRow, actualRow: actRow }));
  }
  return pairs;
}

export function diffTraces(opts: { expectedTracePath: string; actualTracePath: string; tickStart?: number | null; tickEnd?: number | null }): TraceDiffReport {
  const expectedTracePath = opts.expectedTracePath;
  const actualTracePath = opts.actualTracePath;
  const tickStart = opts.tickStart ?? null;
  const tickEnd = opts.tickEnd ?? null;
  const expectedTrace = new TraceReader(expectedTracePath);
  const actualTrace = new TraceReader(actualTracePath);
  let expectedChannels: Set<any>;
  let actualChannels: Set<any>;
  let channelName: ReturnType<typeof String>;
  let pairs: ReturnType<typeof loadPairs>;
  try {
    expectedChannels = new Set(Array.from(expectedTrace.meta.channels).map((channel) => String(channel)));
    actualChannels = new Set(Array.from(actualTrace.meta.channels).map((channel) => String(channel)));
    for (const requiredChannel of TRACE_REQUIRED_CHANNELS) {
      channelName = String(requiredChannel);
      if (!(expectedChannels as ReadonlySet<unknown>).has(channelName) || !(actualChannels as ReadonlySet<unknown>).has(channelName)) {
        return new TraceDiffReport({ ok: false, checkedCount: 0, tickStart: tickStart, tickEnd: tickEnd, mismatch: new TraceMismatch({ kind: 'missing_channel', tickIndex: -1, detail: { "channel": channelName, "expected_has": (expectedChannels as ReadonlySet<unknown>).has(channelName), "actual_has": (actualChannels as ReadonlySet<unknown>).has(channelName) } }) });
      }
    }
    pairs = loadPairs({ expectedTrace: expectedTrace, actualTrace: actualTrace, tickStart: tickStart, tickEnd: tickEnd });
    let checkedCount: ReturnType<typeof firstMismatch>[0];
    let mismatch: ReturnType<typeof firstMismatch>[1];
    try {
      [checkedCount, mismatch] = firstMismatch({ pairs: pairs, tickEnd: tickEnd });
    } catch (exc) {
      if (!(exc instanceof TraceError)) {
        throw exc;
      }
      throw new Error(String(exc));
    }
    return new TraceDiffReport({ ok: (mismatch === null), checkedCount: checkedCount, tickStart: tickStart, tickEnd: tickEnd, mismatch: mismatch });
  } finally {
    actualTrace.close();
    expectedTrace.close();
  }
}

export function bisectTraces(opts: { expectedTracePath: string; actualTracePath: string; tickStart?: number | null; tickEnd?: number | null; windowBefore?: number; windowAfter?: number }): TraceBisectReport {
  const expectedTracePath = opts.expectedTracePath;
  const actualTracePath = opts.actualTracePath;
  const tickStart = opts.tickStart ?? null;
  const tickEnd = opts.tickEnd ?? null;
  const windowBefore = opts.windowBefore ?? 12;
  const windowAfter = opts.windowAfter ?? 6;
  const expectedTrace = new TraceReader(expectedTracePath);
  const actualTrace = new TraceReader(actualTracePath);
  let pairs: ReturnType<typeof loadPairs>;
  try {
    pairs = loadPairs({ expectedTrace: expectedTrace, actualTrace: actualTrace, tickStart: tickStart, tickEnd: tickEnd });
    if (pairs.length === 0) {
      return new TraceBisectReport({ ok: true, firstBadTick: null, checkedCount: 0, mismatch: null, windowStart: null, windowEnd: null });
    }

    const endTickBound = tickEnd === null ? pairs[pairs.length - 1].tickIndex : tickEnd;
    let checkedCount: ReturnType<typeof firstMismatch>[0];
    let mismatch: ReturnType<typeof firstMismatch>[1];
    try {
      [checkedCount, mismatch] = firstMismatch({ pairs: pairs, tickEnd: endTickBound });
    } catch (exc) {
      if (!(exc instanceof TraceError)) {
        throw exc;
      }
      throw new Error(String(exc));
    }
    if (mismatch === null) {
      return new TraceBisectReport({ ok: true, firstBadTick: null, checkedCount: checkedCount, mismatch: null, windowStart: null, windowEnd: null });
    }

    const firstBad = mismatch.tickIndex;
    const finalMismatch = mismatch;
    const left = firstBad - Math.max(0, windowBefore);
    const right = firstBad + Math.max(0, windowAfter);

    return new TraceBisectReport({ ok: false, firstBadTick: firstBad, checkedCount: checkedCount, mismatch: finalMismatch, windowStart: left, windowEnd: right });
  } finally {
    actualTrace.close();
    expectedTrace.close();
  }
}

export function mismatchToJson(mismatch: TraceMismatch | null): BuiltinObject | null {
  if (mismatch === null) {
    return null;
  }
  return toBuiltinObject({ 'kind': mismatch.kind, 'tick_index': mismatch.tickIndex, 'detail': mismatch.detail === null ? null : toBuiltinObject(mismatch.detail, { field: 'mismatch.detail' }) }, { field: 'mismatch_json' });
}

export function diffReportToJson(report: TraceDiffReport): BuiltinObject {
  return toBuiltinObject({ 'schema_version': 1, 'status': report.ok ? 'ok' : 'diverged', 'checked_count': report.checkedCount, 'tick_start': report.tickStart, 'tick_end': report.tickEnd, 'mismatch': mismatchToJson(report.mismatch) }, { field: 'diff_report' });
}

export function bisectReportToJson(report: TraceBisectReport): BuiltinObject {
  return toBuiltinObject({ 'schema_version': 1, 'status': report.ok ? 'ok' : 'diverged', 'checked_count': report.checkedCount, 'first_bad_tick': report.firstBadTick, 'mismatch': mismatchToJson(report.mismatch), 'window_start': report.windowStart, 'window_end': report.windowEnd }, { field: 'bisect_report' });
}

export class TraceMismatch {
  readonly kind: string;
  readonly tickIndex: number;
  readonly detail: BuiltinObject | null;

  constructor(opts: {
    kind: string;
    tickIndex: number;
    detail?: BuiltinObject | null;
  }) {
    this.kind = opts.kind;
    this.tickIndex = opts.tickIndex;
    this.detail = opts.detail ?? null;
  }
}

export class TraceDiffReport {
  readonly ok: boolean;
  readonly checkedCount: number;
  readonly tickStart: number | null;
  readonly tickEnd: number | null;
  readonly mismatch: TraceMismatch | null;

  constructor(opts: {
    ok: boolean;
    checkedCount: number;
    tickStart: number | null;
    tickEnd: number | null;
    mismatch?: TraceMismatch | null;
  }) {
    this.ok = opts.ok;
    this.checkedCount = opts.checkedCount;
    this.tickStart = opts.tickStart;
    this.tickEnd = opts.tickEnd;
    this.mismatch = opts.mismatch ?? null;
  }
}

export class TraceBisectReport {
  readonly ok: boolean;
  readonly firstBadTick: number | null;
  readonly checkedCount: number;
  readonly mismatch: TraceMismatch | null;
  readonly windowStart: number | null;
  readonly windowEnd: number | null;

  constructor(opts: {
    ok: boolean;
    firstBadTick: number | null;
    checkedCount: number;
    mismatch: TraceMismatch | null;
    windowStart?: number | null;
    windowEnd?: number | null;
  }) {
    this.ok = opts.ok;
    this.firstBadTick = opts.firstBadTick;
    this.checkedCount = opts.checkedCount;
    this.mismatch = opts.mismatch;
    this.windowStart = opts.windowStart ?? null;
    this.windowEnd = opts.windowEnd ?? null;
  }
}

export class TickPair {
  readonly tickIndex: number;
  readonly expectedRow: TickRecord | null;
  readonly actualRow: TickRecord | null;

  constructor(opts: {
    tickIndex: number;
    expectedRow: TickRecord | null;
    actualRow: TickRecord | null;
  }) {
    this.tickIndex = opts.tickIndex;
    this.expectedRow = opts.expectedRow;
    this.actualRow = opts.actualRow;
  }
}
