export function bytesFromHelperStatements(): string[] {
  return [
    'function bytesFrom(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {',
    '  if (data instanceof Uint8Array) {',
    '    return data;',
    '  }',
    '  if (data instanceof ArrayBuffer) {',
    '    return new Uint8Array(data);',
    '  }',
    '  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);',
    '}',
  ];
}

export function constructBinaryHelperStatements(): string[] {
  return [
    'interface Construct<T> {',
    '  parse(data: Uint8Array | ArrayBuffer | ArrayBufferView): T;',
    '  build(value: T): Uint8Array;',
    '  parseAt(view: DataView, offset: number, ctx: Record<string, any>): { value: T; offset: number };',
    '  buildInto(value: T, chunks: Uint8Array[], ctx: Record<string, any>): void;',
    '}',
    '',
    'interface ConstructField<T = any> {',
    '  name: string;',
    '  construct: Construct<T>;',
    '}',
    '',
    ...bytesFromHelperStatements(),
    '',
    'function concatBytes(chunks: Uint8Array[]): Uint8Array {',
    '  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);',
    '  const output = new Uint8Array(total);',
    '  let offset = 0;',
    '  for (const chunk of chunks) {',
    '    output.set(chunk, offset);',
    '    offset += chunk.byteLength;',
    '  }',
    '  return output;',
    '}',
    '',
    'function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {',
    '  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);',
    '}',
    '',
    'function constructField<T>(name: string, construct: Construct<T>): ConstructField<T> {',
    '  return { name, construct };',
    '}',
    '',
    'function constructInt32ul(): Construct<number> {',
    '  return {',
    '    parse(data) {',
    '      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;',
    '    },',
    '    build(value) {',
    '      const output = new Uint8Array(4);',
    '      new DataView(output.buffer).setUint32(0, value, true);',
    '      return output;',
    '    },',
    '    parseAt(view, offset) {',
    '      return { value: view.getUint32(offset, true), offset: offset + 4 };',
    '    },',
    '    buildInto(value, chunks) {',
    '      chunks.push(this.build(value));',
    '    },',
    '  };',
    '}',
    '',
    'function constructCString(encoding: string): Construct<string> {',
    '  const decoder = new TextDecoder(encoding);',
    '  const encoder = new TextEncoder();',
    '  return {',
    '    parse(data) {',
    '      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;',
    '    },',
    '    build(value) {',
    '      const encoded = encoder.encode(value);',
    '      const output = new Uint8Array(encoded.byteLength + 1);',
    '      output.set(encoded, 0);',
    '      return output;',
    '    },',
    '    parseAt(view, offset) {',
    '      const start = offset;',
    '      while (offset < view.byteLength && view.getUint8(offset) !== 0) {',
    '        offset += 1;',
    '      }',
    '      if (offset >= view.byteLength) {',
    "        throw new Error('unterminated CString');",
    '      }',
    '      const bytes = new Uint8Array(view.buffer, view.byteOffset + start, offset - start);',
    '      return { value: decoder.decode(bytes), offset: offset + 1 };',
    '    },',
    '    buildInto(value, chunks) {',
    '      chunks.push(this.build(value));',
    '    },',
    '  };',
    '}',
    '',
    'function constructBytes(size: number | ((ctx: Record<string, any>) => number)): Construct<Uint8Array> {',
    '  return {',
    '    parse(data) {',
    '      const bytes = bytesFrom(data);',
    '      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;',
    '    },',
    '    build(value) {',
    '      return bytesFrom(value);',
    '    },',
    '    parseAt(view, offset, ctx) {',
    "      const length = typeof size === 'function' ? size(ctx) : size;",
    '      return { value: new Uint8Array(view.buffer, view.byteOffset + offset, length), offset: offset + length };',
    '    },',
    '    buildInto(value, chunks) {',
    '      chunks.push(bytesFrom(value));',
    '    },',
    '  };',
    '}',
    '',
    'function constructConst(expected: Uint8Array): Construct<Uint8Array> {',
    '  return {',
    '    parse(data) {',
    '      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;',
    '    },',
    '    build() {',
    '      return expected;',
    '    },',
    '    parseAt(view, offset) {',
    '      const value = new Uint8Array(view.buffer, view.byteOffset + offset, expected.byteLength);',
    '      if (!bytesEqual(value, expected)) {',
    "        throw new Error('Const mismatch');",
    '      }',
    '      return { value, offset: offset + expected.byteLength };',
    '    },',
    '    buildInto(_value, chunks) {',
    '      chunks.push(expected);',
    '    },',
    '  };',
    '}',
    '',
    'function constructGreedyRange<T>(item: Construct<T>): Construct<T[]> {',
    '  return {',
    '    parse(data) {',
    '      const bytes = bytesFrom(data);',
    '      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;',
    '    },',
    '    build(values) {',
    '      const chunks: Uint8Array[] = [];',
    '      for (const value of values) {',
    '        item.buildInto(value, chunks, value as Record<string, any>);',
    '      }',
    '      return concatBytes(chunks);',
    '    },',
    '    parseAt(view, offset) {',
    '      const values: T[] = [];',
    '      while (offset < view.byteLength) {',
    '        const parsed = item.parseAt(view, offset, {});',
    '        values.push(parsed.value);',
    '        offset = parsed.offset;',
    '      }',
    '      return { value: values, offset };',
    '    },',
    '    buildInto(values, chunks) {',
    '      chunks.push(this.build(values));',
    '    },',
    '  };',
    '}',
    '',
    'function constructStruct(fields: readonly ConstructField[]): Construct<Record<string, any>> {',
    '  return {',
    '    parse(data) {',
    '      const bytes = bytesFrom(data);',
    '      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;',
    '    },',
    '    build(value) {',
    '      const chunks: Uint8Array[] = [];',
    '      this.buildInto(value, chunks, value);',
    '      return concatBytes(chunks);',
    '    },',
    '    parseAt(view, offset) {',
    '      const value: Record<string, any> = {};',
    '      for (const field of fields) {',
    '        const parsed = field.construct.parseAt(view, offset, value);',
    '        value[field.name] = parsed.value;',
    '        offset = parsed.offset;',
    '      }',
    '      return { value, offset };',
    '    },',
    '    buildInto(value, chunks) {',
    '      for (const field of fields) {',
    '        field.construct.buildInto(value[field.name], chunks, value);',
    '      }',
    '    },',
    '  };',
    '}',
  ];
}

export function structFloatBufferStatements(): string[] {
  return [
    'const _f32buf = new Float32Array(1);',
    'const _u32buf = new Uint32Array(_f32buf.buffer);',
  ];
}

export function pythonReprHelperStatements(): string[] {
  return [
    'function pythonRepr(value: unknown): string {',
    "  if (typeof value === 'number') {",
    '    if (Number.isNaN(value)) {',
    "      return 'nan';",
    '    }',
    '    if (value === Infinity) {',
    "      return 'inf';",
    '    }',
    '    if (value === -Infinity) {',
    "      return '-inf';",
    '    }',
    '    return String(value);',
    '  }',
    "  if (typeof value === 'string') {",
    '    return JSON.stringify(value);',
    '  }',
    '  if (value === true) {',
    "    return 'True';",
    '  }',
    '  if (value === false) {',
    "    return 'False';",
    '  }',
    '  if (value === null) {',
    "    return 'None';",
    '  }',
    '  return String(value);',
    '}',
  ];
}

export function latin1EncodeReplaceHelperStatements(): string[] {
  return [
    'function latin1EncodeReplace(text: string): number[] {',
    '  const bytes: number[] = [];',
    '  for (const char of text) {',
    '    const codePoint = char.codePointAt(0) ?? 0;',
    '    bytes.push(codePoint <= 0xff ? codePoint : 0x3f);',
    '  }',
    '  return bytes;',
    '}',
  ];
}

export function pythonStringCountHelperStatements(): string[] {
  return [
    'function pythonStringCount(text: string, needle: string): number {',
    "  if (needle === '') {",
    '    return Array.from(text).length + 1;',
    '  }',
    '  let count = 0;',
    '  let start = 0;',
    '  while (true) {',
    '    const index = text.indexOf(needle, start);',
    '    if (index === -1) {',
    '      return count;',
    '    }',
    '    count += 1;',
    '    start = index + needle.length;',
    '  }',
    '}',
  ];
}

export function pythonRoundHelperStatements(): string[] {
  return [
    'function pyRound(value: number): number {',
    '  const floorValue = Math.floor(value);',
    '  const frac = value - floorValue;',
    '  if (frac < 0.5) {',
    '    return floorValue;',
    '  }',
    '  if (frac > 0.5) {',
    '    return floorValue + 1;',
    '  }',
    '  return floorValue % 2 === 0 ? floorValue : floorValue + 1;',
    '}',
  ];
}

export function pythonSplitlinesHelperStatements(): string[] {
  return [
    'function pythonSplitlines(text: string): string[] {',
    "  if (text === '') {",
    '    return [];',
    '  }',
    '  const lines = text.split(/\\r\\n|\\r|\\n/);',
    '  if (/(?:\\r\\n|\\r|\\n)$/.test(text)) {',
    '    lines.pop();',
    '  }',
    '  return lines;',
    '}',
  ];
}

export function pythonTruthyHelperStatements(): string[] {
  return [
    'function pythonTruthy(value: unknown): boolean {',
    '  if (value === null || value === undefined) {',
    '    return false;',
    '  }',
    "  if (typeof value === 'boolean') {",
    '    return value;',
    '  }',
    "  if (typeof value === 'number') {",
    '    return value !== 0 && !Number.isNaN(value);',
    '  }',
    "  if (typeof value === 'string' || Array.isArray(value)) {",
    '    return value.length > 0;',
    '  }',
    '  if (value instanceof Map || value instanceof Set) {',
    '    return value.size > 0;',
    '  }',
    '  return true;',
    '}',
  ];
}

export function pythonJsonDumpsHelperStatements(): string[] {
  return [
    'function pythonJsonDumps(value: object | string | number | boolean | null, opts: { sortKeys?: boolean; indent?: number } = {}): string {',
    '  const normalized = opts.sortKeys === true ? pythonSortJsonKeys(value) : value;',
    '  return JSON.stringify(normalized, null, opts.indent ?? 0);',
    '}',
    '',
    'function pythonSortJsonKeys(value: object | string | number | boolean | null): object | string | number | boolean | null {',
    '  if (Array.isArray(value)) {',
    '    return value.map((item) => pythonSortJsonKeys(item));',
    '  }',
    "  if (value !== null && typeof value === 'object') {",
    '    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);',
    '    return Object.fromEntries(entries.map(([key, item]) => [key, pythonSortJsonKeys(item)]));',
    '  }',
    '  return value;',
    '}',
  ];
}

export function msgpackCodecHelperStatements(): string[] {
  return `
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
    if (
      this._type !== undefined
      && value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && !(value instanceof Uint8Array)
      && !(value instanceof Map)
    ) {
      return new this._type(value);
    }
    return value as T;
  }
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
`.trim().split('\n');
}

export function mapMoveToEndHelperStatements(): string[] {
  return [
    'function mapMoveToEnd<K, V>(map: Map<K, V>, key: K, last = true): void {',
    '  if (!map.has(key)) {',
    '    return;',
    '  }',
    '  const value = map.get(key)!;',
    '  map.delete(key);',
    '  if (last) {',
    '    map.set(key, value);',
    '    return;',
    '  }',
    '  const entries = Array.from(map.entries());',
    '  map.clear();',
    '  map.set(key, value);',
    '  for (const [entryKey, entryValue] of entries) {',
    '    map.set(entryKey, entryValue);',
    '  }',
    '}',
  ];
}

export function pythonEqualsHelperStatements(): string[] {
  return [
    'function pythonEquals(left: object | string | number | boolean | null | undefined, right: object | string | number | boolean | null | undefined): boolean {',
    '  if (left === right) {',
    '    return true;',
    '  }',
    "  if (left !== null && left !== undefined && typeof left === 'object') {",
    "    const equal = Reflect.get(left, 'equal');",
    "    if (typeof equal === 'function') {",
    '      return Boolean(equal.call(left, right));',
    '    }',
    '  }',
    "  if (right !== null && right !== undefined && typeof right === 'object') {",
    "    const equal = Reflect.get(right, 'equal');",
    "    if (typeof equal === 'function') {",
    '      return Boolean(equal.call(right, left));',
    '    }',
    '  }',
    '  if (Array.isArray(left) || Array.isArray(right)) {',
    '    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {',
    '      return false;',
    '    }',
    '    return left.every((value, index) => pythonEquals(value, right[index]));',
    '  }',
    "  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {",
    '    const leftKeys = Object.keys(left);',
    '    const rightKeys = Object.keys(right);',
    '    if (leftKeys.length !== rightKeys.length) {',
    '      return false;',
    '    }',
    '    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && pythonEquals(Reflect.get(left, key), Reflect.get(right, key)));',
    '  }',
    '  return false;',
    '}',
  ];
}

export function strftimeUtcNowHelperStatements(): string[] {
  return [
    'function _strftimeUtcNow(): string {',
    '  const now = new Date();',
    "  const year = String(now.getUTCFullYear()).padStart(4, '0');",
    "  const month = String(now.getUTCMonth() + 1).padStart(2, '0');",
    "  const day = String(now.getUTCDate()).padStart(2, '0');",
    "  const hour = String(now.getUTCHours()).padStart(2, '0');",
    "  const minute = String(now.getUTCMinutes()).padStart(2, '0');",
    "  const second = String(now.getUTCSeconds()).padStart(2, '0');",
    "  const microsecond = `${String(now.getUTCMilliseconds()).padStart(3, '0')}000`;",
    '  return `${year}${month}${day}T${hour}${minute}${second}.${microsecond}Z`;',
    '}',
  ];
}

export function pathJoinHelperStatements(): string[] {
  return [
    'function _pathJoin(...parts: Array<string | number>): string {',
    '  const cleaned = parts.map((part, idx) => {',
    '    const text = String(part);',
    '    if (idx === 0) {',
    "      const stripped = text.replace(/\\/+$/g, '');",
    "      if (stripped === '.') {",
    "        return '';",
    '      }',
    "      return text === '/' ? '/' : stripped;",
    '    }',
    "    return text.replace(/^\\/+|\\/+$/g, '');",
    '  }).filter((part) => part.length > 0);',
    '  if (cleaned.length === 0) {',
    "    return '';",
    '  }',
    "  if (cleaned[0] === '/') {",
    "    return `/${cleaned.slice(1).join('/')}`;",
    '  }',
    "  return cleaned.join('/');",
    '}',
  ];
}

export function pathBasenameHelperStatements(): string[] {
  return [
    'function _basename(path: string): string {',
    "  const normalized = path.replace(/\\/+$/g, '');",
    "  const idx = normalized.lastIndexOf('/');",
    '  return idx < 0 ? normalized : normalized.slice(idx + 1);',
    '}',
  ];
}

export function pathFsHelperStatements(): string[] {
  return [
    'function _dirname(path: string): string {',
    "  const idx = path.lastIndexOf('/');",
    '  if (idx < 0) {',
    "    return '.';",
    '  }',
    '  if (idx === 0) {',
    "    return '/';",
    '  }',
    '  return path.slice(0, idx);',
    '}',
    '',
    'function _mkdirParents(path: string): void {',
    '  mkdirSync(path, { recursive: true });',
    '}',
  ];
}

export function globPathHelperStatements(): string[] {
  return [
    'function _globPath(dir: string, pattern: string): string[] {',
    '  const regexp = _globPattern(pattern);',
    '  return readdirSync(dir, { withFileTypes: true })',
    '    .filter((entry) => entry.isFile() && regexp.test(entry.name))',
    '    .map((entry) => _pathJoin(dir, entry.name));',
    '}',
    '',
    'function _globPattern(pattern: string): RegExp {',
    "  let source = '';",
    '  for (const char of pattern) {',
    "    if (char === '*') {",
    "      source += '[^/]*';",
    "    } else if (char === '?') {",
    "      source += '[^/]';",
    '    } else {',
    "      source += /[\\\\^$.*+?()[\\]{}|]/.test(char) ? `\\\\${char}` : char;",
    '    }',
    '  }',
    '  return new RegExp(`^${source}$`);',
    '}',
  ];
}

export function openTextFileHelperStatements(): string[] {
  return [
    "function _openTextFile(path: string, opts: { mode: string; encoding?: 'utf-8' }): { write(text: string): void; close(): void } {",
    '  return {',
    '    write(text: string): void {',
    "      if (opts.mode.includes('a')) {",
    "        appendFileSync(path, text, { encoding: opts.encoding ?? 'utf-8' });",
    '      } else {',
    "        writeFileSync(path, text, { encoding: opts.encoding ?? 'utf-8' });",
    '      }',
    '    },',
    '    close(): void {},',
    '  };',
    '}',
  ];
}
