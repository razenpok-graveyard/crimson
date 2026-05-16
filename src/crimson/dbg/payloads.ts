// Port of crimson/dbg/payloads.py

export type BuiltinScalar = null | boolean | number | string;
export type BuiltinValue = BuiltinScalar | BuiltinValue[] | { [key: string]: BuiltinValue };
export type BuiltinObject = { [key: string]: BuiltinValue };
export type BuiltinRows = BuiltinObject[];

export function coerceBuiltinValue(value: unknown, opts: { field: string }): BuiltinValue {
  const field = opts.field;
  if (value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return int(value);
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => coerceBuiltinValue(item, { field: `${field}[]` }));
  }
  if (Array.isArray(value)) {
    return value.map((item) => coerceBuiltinValue(item, { field: `${field}[]` }));
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const out: BuiltinObject = {};
    for (let [key, item] of Object.entries(value)) {
      if (!(typeof key === 'string')) {
        throw new TypeError(`${field} must use string keys, got ${((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? 'dict' : typeof valueForType)(key)}`);
      }
      out[String(key)] = coerceBuiltinValue(item, { field: `${field}.${key}` });
    }
    return out;
  }
  throw new TypeError(`${field} must contain only builtin debug payload values, got ${((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? 'dict' : typeof valueForType)(value)}`);
}

export function toBuiltinValue(value: unknown, opts: { field: string }): BuiltinValue {
  const field = opts.field;
  return coerceBuiltinValue(structuredClone(value), { field: field });
}

export function toBuiltinObject(value: unknown, opts: { field: string }): BuiltinObject {
  const field = opts.field;
  const built = toBuiltinValue(value, { field: field });
  if (!(typeof built === 'object' && built !== null && !Array.isArray(built))) {
    throw new TypeError(`${field} must convert to a mapping payload`);
  }
  return built;
}

export function toBuiltinRows(value: unknown, opts: { field: string }): BuiltinRows {
  const field = opts.field;
  const built = toBuiltinValue(value, { field: field });
  if (!Array.isArray(built)) {
    throw new TypeError(`${field} must convert to a row list payload`);
  }
  const rows: BuiltinRows = [];
  for (const [index, item] of built.entries()) {
    if (!(typeof item === 'object' && item !== null && !Array.isArray(item))) {
      throw new TypeError(`${field}[${index}] must be a mapping payload`);
    }
    rows.push(item);
  }
  return rows;
}

export function builtinObjectOrEmpty(value: BuiltinValue | null): BuiltinObject {
  if (!(typeof value === 'object' && value !== null && !Array.isArray(value))) {
    return {};
  }
  let coerced: ReturnType<typeof coerceBuiltinValue>;
  try {
    coerced = coerceBuiltinValue(value, { field: 'payload' });
  } catch (exc) {
    return {};
  }
  if (typeof coerced === 'object' && coerced !== null && !Array.isArray(coerced)) {
    return coerced;
  }
  return {};
}

export function builtinRowsOrEmpty(value: BuiltinValue | null): BuiltinRows {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: BuiltinRows = [];
  for (const item of value) {
    if (!(typeof item === 'object' && item !== null && !Array.isArray(item))) {
      return [];
    }
    try {
      rows.push(toBuiltinObject(item, { field: 'payload[]' }));
    } catch (exc) {
      return [];
    }
  }
  return rows;
}
