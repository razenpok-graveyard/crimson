// Port of crimson/dbg/strict_compare.py

import type { BuiltinRows, BuiltinValue } from '@crimson/dbg/payloads.ts';
import { toBuiltinRows, toBuiltinValue } from '@crimson/dbg/payloads.ts';

type PythonMapping = Map<unknown, unknown> | Record<string, unknown>;
type PythonSequence = readonly unknown[];
const PY_TYPE_NONE = Object.freeze({ __name__: 'NoneType' });
const PY_TYPE_BOOL = Object.freeze({ __name__: 'bool' });
const PY_TYPE_INT = Object.freeze({ __name__: 'int' });
const PY_TYPE_FLOAT = Object.freeze({ __name__: 'float' });
const PY_TYPE_STR = Object.freeze({ __name__: 'str' });

function pythonIsIdentifier(value: string): boolean {
  return /^[A-Za-z_]\w*$/.test(value);
}

function pythonIsMapping(value: unknown): value is PythonMapping {
  return value instanceof Map || (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array));
}

function pythonMappingKeys(mapping: PythonMapping): unknown[] {
  return mapping instanceof Map ? Array.from(mapping.keys()) : Object.keys(mapping);
}

function pythonMappingHas(mapping: PythonMapping, key: unknown): boolean {
  return mapping instanceof Map ? mapping.has(key) : Object.prototype.hasOwnProperty.call(mapping, String(key));
}

function pythonMappingGet(mapping: PythonMapping, key: unknown): unknown {
  return mapping instanceof Map ? mapping.get(key) : mapping[String(key)];
}

function pythonIsSequence(value: unknown): value is PythonSequence {
  return Array.isArray(value);
}

function pythonTypeObject(value: unknown): object | Function {
  if (value === null) {
    return PY_TYPE_NONE;
  }
  if (Array.isArray(value)) {
    return Array;
  }
  if (value instanceof Map) {
    return Map;
  }
  if (value instanceof Set) {
    return Set;
  }
  if (typeof value === 'boolean') {
    return PY_TYPE_BOOL;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? PY_TYPE_INT : PY_TYPE_FLOAT;
  }
  if (typeof value === 'string') {
    return PY_TYPE_STR;
  }
  return (typeof value === 'object' || typeof value === 'function') ? (value as { constructor?: Function }).constructor ?? Object : Object;
}

function pythonTypeName(value: unknown): string {
  if (value === null) {
    return 'NoneType';
  }
  if (Array.isArray(value)) {
    return 'list';
  }
  if (value instanceof Map) {
    return 'dict';
  }
  if (typeof value === 'boolean') {
    return 'bool';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'int' : 'float';
  }
  if (typeof value === 'string') {
    return 'str';
  }
  if (typeof value === 'object') {
    return (value as { constructor?: { name?: string } }).constructor?.name && (value as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (value as { constructor: { name: string } }).constructor.name : 'dict';
  }
  return typeof value;
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

export class FieldMismatch {
  readonly path: string;
  readonly kind: string;
  readonly expected: BuiltinValue | null;
  readonly actual: BuiltinValue | null;

  constructor(opts: {
    path: string;
    kind: string;
    expected?: BuiltinValue | null;
    actual?: BuiltinValue | null;
  }) {
    this.path = opts.path;
    this.kind = opts.kind;
    this.expected = opts.expected ?? null;
    this.actual = opts.actual ?? null;
  }
}

function pathOrRoot(path: string): string {
  return path.length > 0 ? path : '<root>';
}

function pathAttr(path: string, name: string): string {
  return !path ? name : `${path}.${name}`;
}

function pathIndex(path: string, index: number): string {
  return path.length > 0 ? `${path}[${int(index)}]` : `[${int(index)}]`;
}

function pathKey(path: string, key: unknown): string {
  if (typeof key === 'string' && pythonIsIdentifier(key)) {
    return pathAttr(path, key);
  }
  const keyText = pythonJsonDumps(key, { sortKeys: true, defaultRepr: true });
  return path.length > 0 ? `${path}[${keyText}]` : `[${keyText}]`;
}

function isStructInstance(value: unknown): boolean {
  const fields = Reflect.get((pythonTypeObject(value)) as object, '__struct_fields__') ?? null;
  return Array.isArray(fields);
}

function structFieldNames(value: unknown): string[] {
  const fields = Reflect.get((pythonTypeObject(value)) as object, '__struct_fields__') ?? null;
  if (Array.isArray(fields) && Array.from(fields).every((name) => typeof name === 'string')) {
    return Array.from(fields).map((name) => String(name));
  }
  return [];
}

function isSequence(value: unknown): boolean {
  return pythonIsSequence(value) && !((typeof value === 'string' || value instanceof Uint8Array || ArrayBuffer.isView(value) && !(value instanceof Uint8Array)));
}

function append(out: FieldMismatch[], opts: { path: string; kind: string; expected?: unknown | null; actual?: unknown | null }): void {
  const path = opts.path;
  const kind = opts.kind;
  const expected = opts.expected ?? null;
  const actual = opts.actual ?? null;
  out.push(new FieldMismatch({ path: pathOrRoot(path), kind: kind, expected: expected !== null ? toBuiltinValue(expected, { field: `${pathOrRoot(path)}.expected` }) : null, actual: actual !== null ? toBuiltinValue(actual, { field: `${pathOrRoot(path)}.actual` }) : null }));
}

function collect(expected: unknown, actual: unknown, opts: { path: string; out: FieldMismatch[] }): void {
  const path = opts.path;
  const out = opts.out;
  if (pythonTypeObject(expected) === pythonTypeObject(actual) && expected === actual) {
    return;
  }

  if (pythonTypeObject(expected) !== pythonTypeObject(actual)) {
    append(out, { path: path, kind: 'type_mismatch', expected: ((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(expected), actual: ((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(actual) });
    return;
  }

  if (isStructInstance(expected)) {
    for (const name of structFieldNames(expected)) {
      collect(
        Reflect.get((expected) as object, name),
        Reflect.get((actual) as object, name),
        { path: pathAttr(path, name), out: out },
      );
    }
    return;
  }

  if (pythonIsMapping(expected)) {
    const expectedMap = (expected as PythonMapping);
    const actualMap = (actual as PythonMapping);
    const keys = Array.from(new Set([...new Set(pythonMappingKeys(expectedMap)), ...new Set(pythonMappingKeys(actualMap))])).sort((left, right) => pythonCompareKeys(pythonRepr(left), pythonRepr(right)));
    for (const key of keys) {
      const keyPath = pathKey(path, key);
      if (!((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(expectedMap, key)) {
        append(out, { path: keyPath, kind: 'missing_expected', actual: pythonMappingGet(actualMap, key) });
        continue;
      }
      if (!((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(actualMap, key)) {
        append(out, { path: keyPath, kind: 'missing_actual', expected: pythonMappingGet(expectedMap, key) });
        continue;
      }
      collect(pythonMappingGet(expectedMap, key), pythonMappingGet(actualMap, key), { path: keyPath, out: out });
    }
    return;
  }

  if (isSequence(expected)) {
    const expectedSeq = (expected as PythonSequence);
    const actualSeq = (actual as PythonSequence);
    if (expectedSeq.length !== actualSeq.length) {
      append(out, { path: path, kind: 'length_mismatch', expected: expectedSeq.length, actual: actualSeq.length });
    }
    const sharedLen = Math.min(expectedSeq.length, actualSeq.length);
    for (let index = 0; index < sharedLen; index++) {
      collect(expectedSeq[index], actualSeq[index], { path: pathIndex(path, index), out: out });
    }
    for (let index = sharedLen; index < expectedSeq.length; index++) {
      append(out, { path: pathIndex(path, index), kind: 'missing_actual', expected: expectedSeq[index] });
    }
    for (let index = sharedLen; index < actualSeq.length; index++) {
      append(out, { path: pathIndex(path, index), kind: 'missing_expected', actual: actualSeq[index] });
    }
    return;
  }

  append(out, { path: path, kind: 'value_mismatch', expected: expected, actual: actual });
}

export function strictMismatches(expected: unknown, actual: unknown, opts: { rootPath?: string } = {}): FieldMismatch[] {
  const rootPath = opts.rootPath ?? '';
  const out: FieldMismatch[] = [];
  collect(expected, actual, { path: rootPath, out: out });
  return out;
}

export function strictMismatchPayload(expected: unknown, actual: unknown, opts: { rootPath?: string } = {}): [BuiltinRows, number, string] {
  const rootPath = opts.rootPath ?? '';
  const mismatches = strictMismatches(expected, actual, { rootPath: rootPath });
  const payload = toBuiltinRows(mismatches, { field: `${rootPath || 'mismatches'}` });
  return [payload, payload.length, pythonJsonDumps(payload, { sortKeys: true, indent: 2, defaultRepr: true })];
}
