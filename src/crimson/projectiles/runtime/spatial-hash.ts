// Port of crimson/projectiles/runtime/spatial_hash.py

import type { Vec2 } from '@grim/geom.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';

const _SPATIAL_BUCKET_SIZE = 64.0;
const _NATIVE_FIND_SIZE_SCALE = 0.14285715;
const _NATIVE_FIND_BASE_MARGIN = 3.0;
const _NATIVE_FIND_RADIUS_MARGIN_EPS = 0.001;

function tupleKey(value: readonly unknown[] | string): string {
  return typeof value === 'string' ? value : value.join(',');
}

function mapGetOrInit<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const value = create();
  map.set(key, value);
  return value;
}

function arrayRemove<T>(items: T[], value: T): void {
  const index = items.indexOf(value);
  if (index !== -1) {
    items.splice(index, 1);
  }
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

export class CreatureSpatialHash {
  creatures: readonly CreatureState[];
  isCollidable: (arg0: CreatureState) => boolean;
  bucketSize: number;
  _bucketSize: number;
  _cells: Map<string, number[]>;
  _cellByIndex: ([number, number] | null)[];
  _maxFindMargin: number;

  constructor(opts: {
    creatures: readonly CreatureState[];
    isCollidable: (arg0: CreatureState) => boolean;
    bucketSize?: number;
    _bucketSize?: number;
    _cells?: Map<string, number[]>;
    _cellByIndex?: ([number, number] | null)[];
    _maxFindMargin?: number;
  }) {
    this.creatures = opts.creatures;
    this.isCollidable = opts.isCollidable;
    this.bucketSize = opts.bucketSize ?? _SPATIAL_BUCKET_SIZE;
    this._bucketSize = opts._bucketSize ?? _SPATIAL_BUCKET_SIZE;
    this._cells = opts._cells ?? new Map();
    this._cellByIndex = opts._cellByIndex !== undefined ? opts._cellByIndex : [];
    this._maxFindMargin = opts._maxFindMargin ?? 0.0;
    if (this.bucketSize > 0.0) {
      this._bucketSize = this.bucketSize;
    }
    this.rebuild();
  }

  rebuild(): void {
    const cells: Map<string, number[]> = new Map();
    const cellByIndex: ([number, number] | null)[] = Array.from({ length: this.creatures.length }, () => null);
    let maxFindMargin = 0.0;

    for (const [idx, creature] of this.creatures.entries()) {
      if (!this.isCollidable(creature)) {
        continue;
      }
      const cell = this._cellForPos(creature.pos);
      mapGetOrInit(cells, tupleKey(cell), () => []).push(int(idx));
      cellByIndex[int(idx)] = cell;
      const creatureFindMargin = nativeFindMarginForSize(creature.size);
      if (creatureFindMargin > maxFindMargin) {
        maxFindMargin = creatureFindMargin;
      }
    }

    this._cells = cells;
    this._cellByIndex = cellByIndex;
    this._maxFindMargin = maxFindMargin;
  }

  syncIndex(index: number): void {
    if (!(int(index) >= 0 && int(index) < this.creatures.length)) {
      return;
    }
    const idx = int(index);
    const creature = this.creatures[idx];
    const previousCell = this._cellByIndex[idx];
    if (!this.isCollidable(creature)) {
      if (previousCell !== null) {
        this._removeFromCell(idx, previousCell);
        this._cellByIndex[idx] = null;
      }
      return;
    }

    const nextCell = this._cellForPos(creature.pos);
    if (pythonEquals(previousCell, nextCell)) {
      return;
    }
    if (previousCell !== null) {
      this._removeFromCell(idx, previousCell);
    }
    mapGetOrInit(this._cells, tupleKey(nextCell), () => []).push(idx);
    this._cellByIndex[idx] = nextCell;

    const creatureFindMargin = nativeFindMarginForSize(creature.size);
    if (creatureFindMargin > this._maxFindMargin) {
      this._maxFindMargin = creatureFindMargin;
    }
  }

  candidateIndices(opts: { pos: Vec2; radius: number }): number[] {
    const pos = opts.pos;
    const radius = opts.radius;
    if (this._cells.size === 0) {
      return [];
    }
    const projCellX = int(Math.floor(pos.x / this._bucketSize));
    const projCellY = int(Math.floor(pos.y / this._bucketSize));
    const maxAxisDelta = radius + this._maxFindMargin + _NATIVE_FIND_RADIUS_MARGIN_EPS;
    const cellSpan = int(Math.ceil(maxAxisDelta / this._bucketSize));

    const candidates: number[] = [];
    for (let cellY = projCellY - cellSpan; cellY < projCellY + cellSpan + 1; cellY++) {
      for (let cellX = projCellX - cellSpan; cellX < projCellX + cellSpan + 1; cellX++) {
        const bucket = this._cells.get(tupleKey([int(cellX), int(cellY)])) ?? null;
        if (bucket !== null) {
          candidates.push(...bucket);
        }
      }
    }

    if (candidates.length > 1) {
      candidates.sort((a, b) => a - b);
    }
    return candidates;
  }

  _cellForPos(pos: Vec2): [number, number] {
    const cellX = int(Math.floor(pos.x / this._bucketSize));
    const cellY = int(Math.floor(pos.y / this._bucketSize));
    return [cellX, cellY];
  }

  _removeFromCell(index: number, cell: [number, number]): void {
    const bucket = this._cells.get(tupleKey(cell)) ?? null;
    if (bucket === null) {
      return;
    }
    try {
      arrayRemove(bucket, int(index));
    } catch (exc) {
      return;
    }
    if (bucket === null || bucket.length === 0) {
      this._cells.delete(tupleKey(cell));
    }
  }

  cellForPos(pos: Vec2): [number, number] {
    return this._cellForPos(pos);
  }

  removeFromCell(index: number, cell: [number, number]): void {
    this._removeFromCell(index, cell);
  }
}

export function nativeFindMarginForSize(size: number): number {
  return size * _NATIVE_FIND_SIZE_SCALE + _NATIVE_FIND_BASE_MARGIN;
}
