// Port of crimson/atlas.py

// Atlas slicing used by the Crimsonland renderer.
//
// Findings from decompiled code:
// - FUN_0041fed0 precomputes UV grids for 2x2, 4x4, 8x8, 16x16 (steps 0.5/0.25/0.125/0.0625).
// - FUN_0042e0a0 reads a table at VA 0x004755F0 with pairs (cell_code, group_id).
//   cell_code maps to grid size: 0x80->2, 0x40->4, 0x20->8, 0x10->16.
//   group_id is passed to the renderer alongside the grid size; semantics unknown.
// - FUN_0042e120 uses the selected UV grid to build quad UVs by frame index.
//
// This module replicates the atlas cutting: given a grid size and frame index,
// compute UVs or crop subimages.

import type { Image } from 'PIL';

export const GRID_SIZE_BY_CODE = new Map([
  [0x80, 2],
  [0x40, 4],
  [0x20, 8],
  [0x10, 16],
]);
// DAT_004755f0 table (index -> (cell_code, group_id)) extracted from crimsonland.exe
export const SPRITE_TABLE = [
  [0x80, 0x2],
  [0x80, 0x3],
  [0x20, 0x0],
  [0x20, 0x1],
  [0x20, 0x2],
  [0x20, 0x3],
  [0x20, 0x4],
  [0x20, 0x5],
  [0x20, 0x8],
  [0x20, 0x9],
  [0x20, 0xA],
  [0x20, 0xB],
  [0x40, 0x5],
  [0x40, 0x3],
  [0x40, 0x4],
  [0x40, 0x5],
  [0x40, 0x6],
];

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export function gridSizeFromCode(code: number): number {
  return mapGetOrThrow(GRID_SIZE_BY_CODE, code);
}

export function gridSizeForIndex(index: number): number {
  const [code, ] = SPRITE_TABLE[index];
  return gridSizeFromCode(code);
}

export function uvForIndex(grid: number, index: number): [number, number, number, number] {
  const row = Math.floor(index / grid);
  const col = index % grid;
  const step = 1.0 / grid;
  const u0 = col * step;
  const v0 = row * step;
  const u1 = u0 + step;
  const v1 = v0 + step;
  return [u0, v0, u1, v1];
}

export function rectForIndex(width: number, height: number, grid: number, index: number): [number, number, number, number] {
  const row = Math.floor(index / grid);
  const col = index % grid;
  const cellW = Math.floor(width / grid);
  const cellH = Math.floor(height / grid);
  const x0 = col * cellW;
  const y0 = row * cellH;
  return [x0, y0, x0 + cellW, y0 + cellH];
}

export function sliceIndex(image: Image.Image, grid: number, index: number): Image.Image {
  return image.crop(rectForIndex(image.width, image.height, grid, index));
}

export function sliceGrid(image: Image.Image, grid: number): Image.Image[] {
  const frames = [];
  for (let idx = 0; idx < grid * grid; idx++) {
    frames.push(sliceIndex(image, grid, idx));
  }
  return frames;
}

export function sliceByIndices(image: Image.Image, grid: number, indices: Iterable<number>): Image.Image[] {
  return Array.from(indices).map((idx) => sliceIndex(image, grid, idx));
}
