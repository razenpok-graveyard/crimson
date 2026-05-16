// Port of crimson/dbg/checkpoint_diff.py

import type { ReplayCheckpoint } from '@crimson/replay/checkpoints.ts';
import type { BuiltinObject } from '@crimson/dbg/payloads.ts';
import { toBuiltinObject } from '@crimson/dbg/payloads.ts';
import { strictMismatchPayload } from '@crimson/dbg/strict-compare.ts';

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

function pythonJsonDumps(value: unknown, opts: { sortKeys?: boolean; indent?: number; defaultRepr?: boolean } = {}): string {
  const normalized = pythonJsonValue(value, opts);
  return JSON.stringify(normalized, null, opts.indent ?? 0);
}

function pythonJsonValue(value: unknown, opts: { sortKeys?: boolean; defaultRepr?: boolean }): object | string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => pythonJsonValue(item, opts));
  }
  if (value instanceof Map) {
    const entries = Array.from(value.entries(), ([key, item]) => [String(key), pythonJsonValue(item, opts)] as const);
    return Object.fromEntries(opts.sortKeys === true ? entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0) : entries);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, pythonJsonValue(item, opts)] as const);
    return Object.fromEntries(opts.sortKeys === true ? entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0) : entries);
  }
  return opts.defaultRepr === true ? String(value) : null;
}

export class ReplayDiffFailure {
  readonly kind: string;
  readonly tickIndex: number;
  readonly expected: ReplayCheckpoint;
  readonly actual: ReplayCheckpoint | null;

  constructor(opts: {
    kind: string;
    tickIndex: number;
    expected: ReplayCheckpoint;
    actual?: ReplayCheckpoint | null;
  }) {
    this.kind = opts.kind;
    this.tickIndex = opts.tickIndex;
    this.expected = opts.expected;
    this.actual = opts.actual ?? null;
  }
}

export class ReplayDiffResult {
  readonly ok: boolean;
  readonly checkedCount: number;
  readonly firstRngOnlyTick: number | null;
  readonly failure: ReplayDiffFailure | null;

  constructor(opts: {
    ok: boolean;
    checkedCount: number;
    firstRngOnlyTick?: number | null;
    failure?: ReplayDiffFailure | null;
  }) {
    this.ok = opts.ok;
    this.checkedCount = opts.checkedCount;
    this.firstRngOnlyTick = opts.firstRngOnlyTick ?? null;
    this.failure = opts.failure ?? null;
  }
}

export class CheckpointDeepDiff {
  readonly payload: BuiltinObject;
  readonly pretty: string;
  readonly diffCount: number;

  constructor(opts: {
    payload: BuiltinObject;
    pretty: string;
    diffCount: number;
  }) {
    this.payload = opts.payload;
    this.pretty = opts.pretty;
    this.diffCount = opts.diffCount;
  }
}

function checkpointToObj(checkpoint: ReplayCheckpoint, opts: { includeRngFields: boolean }): BuiltinObject {
  const includeRngFields = opts.includeRngFields;
  const obj = toBuiltinObject(checkpoint, { field: 'checkpoint' });
  if (!includeRngFields) {
    for (const key of ['rng_state']) {
      delete obj[key];
    }
  }
  return obj;
}

export function checkpointDeepdiff(expected: ReplayCheckpoint, actual: ReplayCheckpoint): CheckpointDeepDiff | null {
  const [mismatches, diffCount, pretty] = strictMismatchPayload(expected, actual);
  if (int(diffCount) <= 0) {
    return null;
  }

  const payload = toBuiltinObject({ 'mismatches': mismatches }, { field: 'checkpoint_diff.payload' });
  return new CheckpointDeepDiff({ payload: payload, pretty: pythonJsonDumps(payload, { sortKeys: true, indent: 2, defaultRepr: true }), diffCount: int(diffCount) });
}

export function compareCheckpoints(expected: readonly ReplayCheckpoint[], actual: readonly ReplayCheckpoint[]): ReplayDiffResult {
  const actualByTick = new Map(Array.from(actual, (ckpt) => [int(ckpt.tickIndex), ckpt] as const));
  let firstRngOnlyTick: number | null = null;
  let checkedCount = 0;

  for (const exp of expected) {
    checkedCount += 1;
    const tick = int(exp.tickIndex);
    const act = actualByTick.has(tick) ? actualByTick.get(tick)! : null;
    if (act === null) {
      return new ReplayDiffResult({ ok: false, checkedCount: checkedCount, firstRngOnlyTick: firstRngOnlyTick, failure: new ReplayDiffFailure({ kind: 'missing_checkpoint', tickIndex: tick, expected: exp, actual: null }) });
    }

    if (exp === act) {
      continue;
    }

    const expNoRng = checkpointToObj(exp, { includeRngFields: false });
    const actNoRng = checkpointToObj(act, { includeRngFields: false });
    if (pythonEquals(expNoRng, actNoRng)) {
      if (firstRngOnlyTick === null) {
        firstRngOnlyTick = tick;
      }
      continue;
    }

    return new ReplayDiffResult({ ok: false, checkedCount: checkedCount, firstRngOnlyTick: firstRngOnlyTick, failure: new ReplayDiffFailure({ kind: 'state_mismatch', tickIndex: tick, expected: exp, actual: act }) });
  }

  return new ReplayDiffResult({ ok: true, checkedCount: checkedCount, firstRngOnlyTick: firstRngOnlyTick, failure: null });
}
