// Port of crimson/dbg/channel_compare.py

import type { EntitySamplesSnapshot, RngStreamRow, SimStateSnapshot, TimingSampleRow } from '@crimson/dbg/canonical-channels.ts';
import { ENTITY_SAMPLE_KINDS, EntitySampleRow, entityRows } from '@crimson/dbg/channel-helpers.ts';
import { BuiltinObject, BuiltinRows, toBuiltinObject, toBuiltinValue } from '@crimson/dbg/payloads.ts';
import { strictMismatchPayload } from '@crimson/dbg/strict-compare.ts';

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

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

function rngStreamRowPayload(row: RngStreamRow, opts: { field: string }): BuiltinObject {
  const field = opts.field;
  const payload = toBuiltinObject({ 'tick_call_index': row.tickCallIndex, 'value_15': row.value15, 'state_before_u32': row.stateBeforeU32, 'state_after_u32': row.stateAfterU32, 'caller': row.caller, 'caller_hex': row.caller === null ? null : `0x${Math.trunc(row.caller).toString(16).padStart(8, '0')}` }, { field: field });
  return payload;
}

export function compareRngStream(expectedRows: RngStreamRow[], actualRows: RngStreamRow[]): [boolean, BuiltinObject | null] {
  const expKeys = expectedRows.map((row) => [row.tickCallIndex, row.value15, row.stateBeforeU32, row.stateAfterU32, row.caller]);
  const actKeys = actualRows.map((row) => [row.tickCallIndex, row.value15, row.stateBeforeU32, row.stateAfterU32, row.caller]);
  const maxPrefix = Math.min(expKeys.length, actKeys.length);
  let prefix = 0;
  while (prefix < maxPrefix && pythonEquals(expKeys[prefix], actKeys[prefix])) {
    prefix += 1;
  }
  if (prefix === expKeys.length && expKeys.length === actKeys.length) {
    return [true, null];
  }
  const detail = toBuiltinObject({ 'prefix_match_len': prefix, 'expected_calls': expKeys.length, 'actual_calls': actKeys.length, 'missing_tail': Math.max(0, expKeys.length - actKeys.length), 'extra_tail': Math.max(0, actKeys.length - expKeys.length) }, { field: 'rng_stream.diff' });
  if (prefix < expectedRows.length) {
    detail['expected_first_mismatch'] = rngStreamRowPayload(expectedRows[prefix], { field: 'rng_stream.expected' });
  }
  if (prefix < actualRows.length) {
    detail['actual_first_mismatch'] = rngStreamRowPayload(actualRows[prefix], { field: 'rng_stream.actual' });
  }
  return [false, detail];
}

export function compareSimState(expectedObj: SimStateSnapshot, actualObj: SimStateSnapshot): [boolean, BuiltinObject | null] {
  if (pythonEquals(expectedObj, actualObj)) {
    return [true, null];
  }
  const [payload, diffCount, pretty] = strictMismatchPayload(expectedObj, actualObj, { rootPath: 'sim_state' });
  return [false, toBuiltinObject({ 'diff_count': int(diffCount), 'mismatches': payload, 'pretty': pretty }, { field: 'sim_state.diff' })];
}

export function compareTimingSamples(expectedRows: TimingSampleRow[], actualRows: TimingSampleRow[]): [boolean, BuiltinObject | null] {
  if (pythonEquals(expectedRows, actualRows)) {
    return [true, null];
  }
  const [payload, diffCount, pretty] = strictMismatchPayload(expectedRows, actualRows, { rootPath: 'timing_samples' });
  return [false, toBuiltinObject({ 'diff_count': int(diffCount), 'mismatches': payload, 'pretty': pretty }, { field: 'timing_samples.diff' })];
}

function rowsByUid(rows: EntitySampleRow[]): [Map<number, EntitySampleRow>, number, number[]] {
  const byUid: Map<number, EntitySampleRow> = new Map();
  const duplicateUids: number[] = [];
  for (const row of rows) {
    const uid = int(row.uid);
    if (byUid.has(uid)) {
      duplicateUids.push(uid);
    }
    byUid.set(uid, row);
  }
  return [byUid, rows.length, duplicateUids];
}

export function compareEntitySamples(expectedObj: EntitySamplesSnapshot, actualObj: EntitySamplesSnapshot): [boolean, BuiltinObject | null] {
  if (pythonEquals(expectedObj, actualObj)) {
    return [true, null];
  }

  const detail: BuiltinObject = {};
  const rowDiffs: BuiltinRows = [];
  for (const kind of ENTITY_SAMPLE_KINDS) {
    const [expMap, expTotal, expDupes] = rowsByUid(entityRows(expectedObj, { kind: kind }));
    const [actMap, actTotal, actDupes] = rowsByUid(entityRows(actualObj, { kind: kind }));
    if (expTotal !== actTotal) {
      detail[`${kind}_count`] = { 'expected': expTotal, 'actual': actTotal };
    }
    if (expDupes.length > 0 || actDupes.length > 0) {
      detail[`${kind}_duplicate_uids`] = { "expected": expDupes, "actual": actDupes };
    }

    const missing = Array.from(expMap.keys()).filter((uid) => !actMap.has(uid)).sort((left, right) => pythonCompareKeys(left, right));
    const extra = Array.from(actMap.keys()).filter((uid) => !expMap.has(uid)).sort((left, right) => pythonCompareKeys(left, right));
    if (missing.length > 0 || extra.length > 0) {
      detail[`${kind}_uids`] = { "missing": missing, "extra": extra };
    }

    for (const uid of Array.from(expMap.keys()).filter((item) => actMap.has(item)).sort((left, right) => pythonCompareKeys(left, right))) {
      const expectedRow = mapGetOrThrow(expMap, uid);
      const actualRow = mapGetOrThrow(actMap, uid);
      if (expectedRow === actualRow) {
        continue;
      }
      const rowPath = `entity_samples.${kind}[uid=${uid}]`;
      const [payload, diffCount, pretty] = strictMismatchPayload(expectedRow, actualRow, { rootPath: rowPath });
      rowDiffs.push({ 'path': rowPath, 'diff_count': int(diffCount), 'mismatches': payload, 'pretty': pretty });
    }
  }

  if (rowDiffs.length > 0) {
    detail['row_diffs'] = toBuiltinValue(rowDiffs, { field: 'entity_samples.row_diffs' });
  }
  return [(Object.keys(detail).length === 0), Object.keys(detail).length === 0 ? null : detail];
}
