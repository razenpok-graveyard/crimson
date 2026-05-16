// Port of crimson/effects_atlas.py

export class EffectAtlasEntry {
  readonly effectId: number;
  readonly sizeCode: number;
  readonly frame: number;

  constructor(opts: {
    effectId: number;
    sizeCode: number;
    frame: number;
  }) {
    this.effectId = opts.effectId;
    this.sizeCode = opts.sizeCode;
    this.frame = opts.frame;
  }

  get grid(): number {
    return SIZE_CODE_GRID.get(this.sizeCode)!;
  }
}

export const SIZE_CODE_GRID: Map<number, number> = new Map([
  [0x10, 16],
  [0x20, 8],
  [0x40, 4],
  [0x80, 2],
]);
// Extracted from `effect_id_table` (`size_code`, `frame`) (see `docs/structs/effects.md`).
export const EFFECT_ID_ATLAS_TABLE: readonly EffectAtlasEntry[] = [
  new EffectAtlasEntry({ effectId: 0x00, sizeCode: 0x80, frame: 0x02 }),
  new EffectAtlasEntry({ effectId: 0x01, sizeCode: 0x80, frame: 0x03 }),
  new EffectAtlasEntry({ effectId: 0x02, sizeCode: 0x20, frame: 0x00 }),
  new EffectAtlasEntry({ effectId: 0x03, sizeCode: 0x20, frame: 0x01 }),
  new EffectAtlasEntry({ effectId: 0x04, sizeCode: 0x20, frame: 0x02 }),
  new EffectAtlasEntry({ effectId: 0x05, sizeCode: 0x20, frame: 0x03 }),
  new EffectAtlasEntry({ effectId: 0x06, sizeCode: 0x20, frame: 0x04 }),
  new EffectAtlasEntry({ effectId: 0x07, sizeCode: 0x20, frame: 0x05 }),
  new EffectAtlasEntry({ effectId: 0x08, sizeCode: 0x20, frame: 0x08 }),
  new EffectAtlasEntry({ effectId: 0x09, sizeCode: 0x20, frame: 0x09 }),
  new EffectAtlasEntry({ effectId: 0x0A, sizeCode: 0x20, frame: 0x0A }),
  new EffectAtlasEntry({ effectId: 0x0B, sizeCode: 0x20, frame: 0x0B }),
  new EffectAtlasEntry({ effectId: 0x0C, sizeCode: 0x40, frame: 0x05 }),
  new EffectAtlasEntry({ effectId: 0x0D, sizeCode: 0x40, frame: 0x03 }),
  new EffectAtlasEntry({ effectId: 0x0E, sizeCode: 0x40, frame: 0x04 }),
  new EffectAtlasEntry({ effectId: 0x0F, sizeCode: 0x40, frame: 0x05 }),
  new EffectAtlasEntry({ effectId: 0x10, sizeCode: 0x40, frame: 0x06 }),
  new EffectAtlasEntry({ effectId: 0x11, sizeCode: 0x40, frame: 0x07 }),
  new EffectAtlasEntry({ effectId: 0x12, sizeCode: 0x10, frame: 0x26 }),
];
export const EFFECT_ID_ATLAS_TABLE_BY_ID: Map<number, EffectAtlasEntry> = new Map(EFFECT_ID_ATLAS_TABLE.map((entry) => [entry.effectId, entry] as const));

export enum EffectId {
  BURST = 0x00,
  RING = 0x01,
  SHIELD_RING = 0x02,
  EFFECT_03 = 0x03,
  EFFECT_04 = 0x04,
  EFFECT_05 = 0x05,
  EFFECT_06 = 0x06,
  BLOOD_SPLATTER = 0x07,
  FREEZE_SHARD_0 = 0x08,
  FREEZE_SHARD_1 = 0x09,
  FREEZE_SHARD_2 = 0x0A,
  EFFECT_0B = 0x0B,
  EXPLOSION_BURST = 0x0C,
  GLOW = 0x0D,
  FREEZE_SHATTER = 0x0E,
  EFFECT_0F = 0x0F,
  AURA = 0x10,
  EXPLOSION_PUFF = 0x11,
  CASING = 0x12,
}

export function effectSrcRect(effectId: number, opts: { textureWidth: number; textureHeight: number }): [number, number, number, number] | null {
  const textureWidth = opts.textureWidth;
  const textureHeight = opts.textureHeight;
  const entry = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(effectId)) ?? null;
  if (entry === null) {
    return null;
  }

  const grid = SIZE_CODE_GRID.get(entry.sizeCode) ?? null;
  if (!grid) {
    return null;
  }

  const frame = int(entry.frame);
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  const cellW = textureWidth / grid;
  const cellH = textureHeight / grid;
  return [cellW * col, cellH * row, cellW, cellH];
}
