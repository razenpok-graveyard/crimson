// Port of grim/paq.py

// PAQ archive format (Crimsonland).
//
// File layout:
//   - magic: 4 bytes, ASCII "paq\\0"
//   - entries: repeated until EOF
//       - name: NUL-terminated UTF-8 string (relative path)
//       - size: u32 little-endian payload size
//       - payload: raw file bytes of length `size`

import { readFileSync, writeFileSync } from 'node:fs';

export const MAGIC = new Uint8Array([112, 97, 113, 0]);
export const PAQ_ENTRY = constructStruct([
  constructField('name', constructCString('utf8')),
  constructField('size', constructInt32ul()),
  constructField('payload', constructBytes((ctx) => ctx.size)),
]);
export const PAQ = constructStruct([
  constructField('magic', constructConst(MAGIC)),
  constructField('entries', constructGreedyRange(PAQ_ENTRY)),
]);

interface Construct<T> {
  parse(data: Uint8Array | ArrayBuffer | ArrayBufferView): T;
  build(value: T): Uint8Array;
  parseAt(view: DataView, offset: number, ctx: Record<string, any>): { value: T; offset: number };
  buildInto(value: T, chunks: Uint8Array[], ctx: Record<string, any>): void;
}

interface ConstructField<T = any> {
  name: string;
  construct: Construct<T>;
}

function bytesFrom(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function constructField<T>(name: string, construct: Construct<T>): ConstructField<T> {
  return { name, construct };
}

function constructInt32ul(): Construct<number> {
  return {
    parse(data) {
      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;
    },
    build(value) {
      const output = new Uint8Array(4);
      new DataView(output.buffer).setUint32(0, value, true);
      return output;
    },
    parseAt(view, offset) {
      return { value: view.getUint32(offset, true), offset: offset + 4 };
    },
    buildInto(value, chunks) {
      chunks.push(this.build(value));
    },
  };
}

function constructCString(encoding: string): Construct<string> {
  const decoder = new TextDecoder(encoding);
  const encoder = new TextEncoder();
  return {
    parse(data) {
      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;
    },
    build(value) {
      const encoded = encoder.encode(value);
      const output = new Uint8Array(encoded.byteLength + 1);
      output.set(encoded, 0);
      return output;
    },
    parseAt(view, offset) {
      const start = offset;
      while (offset < view.byteLength && view.getUint8(offset) !== 0) {
        offset += 1;
      }
      if (offset >= view.byteLength) {
        throw new Error('unterminated CString');
      }
      const bytes = new Uint8Array(view.buffer, view.byteOffset + start, offset - start);
      return { value: decoder.decode(bytes), offset: offset + 1 };
    },
    buildInto(value, chunks) {
      chunks.push(this.build(value));
    },
  };
}

function constructBytes(size: number | ((ctx: Record<string, any>) => number)): Construct<Uint8Array> {
  return {
    parse(data) {
      const bytes = bytesFrom(data);
      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;
    },
    build(value) {
      return bytesFrom(value);
    },
    parseAt(view, offset, ctx) {
      const length = typeof size === 'function' ? size(ctx) : size;
      return { value: new Uint8Array(view.buffer, view.byteOffset + offset, length), offset: offset + length };
    },
    buildInto(value, chunks) {
      chunks.push(bytesFrom(value));
    },
  };
}

function constructConst(expected: Uint8Array): Construct<Uint8Array> {
  return {
    parse(data) {
      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;
    },
    build() {
      return expected;
    },
    parseAt(view, offset) {
      const value = new Uint8Array(view.buffer, view.byteOffset + offset, expected.byteLength);
      if (!bytesEqual(value, expected)) {
        throw new Error('Const mismatch');
      }
      return { value, offset: offset + expected.byteLength };
    },
    buildInto(_value, chunks) {
      chunks.push(expected);
    },
  };
}

function constructGreedyRange<T>(item: Construct<T>): Construct<T[]> {
  return {
    parse(data) {
      const bytes = bytesFrom(data);
      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;
    },
    build(values) {
      const chunks: Uint8Array[] = [];
      for (const value of values) {
        item.buildInto(value, chunks, value as Record<string, any>);
      }
      return concatBytes(chunks);
    },
    parseAt(view, offset) {
      const values: T[] = [];
      while (offset < view.byteLength) {
        const parsed = item.parseAt(view, offset, {});
        values.push(parsed.value);
        offset = parsed.offset;
      }
      return { value: values, offset };
    },
    buildInto(values, chunks) {
      chunks.push(this.build(values));
    },
  };
}

function constructStruct(fields: readonly ConstructField[]): Construct<Record<string, any>> {
  return {
    parse(data) {
      const bytes = bytesFrom(data);
      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;
    },
    build(value) {
      const chunks: Uint8Array[] = [];
      this.buildInto(value, chunks, value);
      return concatBytes(chunks);
    },
    parseAt(view, offset) {
      const value: Record<string, any> = {};
      for (const field of fields) {
        const parsed = field.construct.parseAt(view, offset, value);
        value[field.name] = parsed.value;
        offset = parsed.offset;
      }
      return { value, offset };
    },
    buildInto(value, chunks) {
      for (const field of fields) {
        field.construct.buildInto(value[field.name], chunks, value);
      }
    },
  };
}

export function* iterEntriesBytes(data: Uint8Array): IterableIterator<[string, Uint8Array]> {
  const parsed = PAQ.parse(data);
  for (const entry of parsed.entries) {
    yield [entry.name, entry.payload];
  }
}

export function* iterEntries(source: string): IterableIterator<[string, Uint8Array]> {
  const data = readFileSync(String(source));
  yield* iterEntriesBytes(data);
}

export function readPaq(source: string): [string, Uint8Array][] {
  return Array.from(iterEntries(source));
}

export function decodeBytes(data: Uint8Array): [string, Uint8Array][] {
  return Array.from(iterEntriesBytes(data));
}

export function buildEntries(entries: Iterable<[string, Uint8Array]>): Uint8Array {
  const builtEntries = [];
  for (let [name, data] of entries) {
    if (typeof name !== 'string') {
      name = String(name);
    }
    if (ArrayBuffer.isView(data) && !(data instanceof Uint8Array)) {
      data = bytesFrom(data);
    }
    builtEntries.push({ name: String(name), size: data.length, payload: bytesFrom(data) });
  }
  return PAQ.build({ magic: MAGIC, entries: builtEntries });
}

export function writePaq(dest: string, entries: Iterable<[string, Uint8Array]>): void {
  const data = buildEntries(entries);
  writeFileSync(String(dest), data);
}

export function encodeBytes(entries: Iterable<[string, Uint8Array]>): Uint8Array {
  return buildEntries(entries);
}
