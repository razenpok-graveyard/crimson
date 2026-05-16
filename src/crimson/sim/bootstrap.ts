// Port of crimson/sim/bootstrap.py

import type { CrandLike } from '@grim/rand.ts';
import type { TerrainSlotTriplet } from '@crimson/terrain-slots.ts';
import { chooseUnlockTerrainSlots } from '@crimson/terrain-slots.ts';

// Terrain stamping RNG consumption mirrors `grim/terrain_render.py` + `docs/crimsonland-exe/terrain.md`.
export const TERRAIN_RANDOM_PRELUDE_DRAWS = 3;
export const TERRAIN_DENSITY_BASE = 800;
export const TERRAIN_DENSITY_OVERLAY = 0x23;
export const TERRAIN_DENSITY_DETAIL = 0x0F;
export const TERRAIN_DENSITY_SHIFT = 19;
export const TERRAIN_RAND_DRAWS_PER_STAMP = 3; // rotation, then position draws (see terrain renderer parity notes)

export class TerrainSetup {
  readonly terrainSlots: TerrainSlotTriplet;
  readonly terrainSeed: number;

  constructor(opts: {
    terrainSlots: TerrainSlotTriplet;
    terrainSeed: number;
  }) {
    this.terrainSlots = opts.terrainSlots;
    this.terrainSeed = opts.terrainSeed;
  }
}

export function terrainStampingDraws(opts: { width: number; height: number }): number {
  // Return the number of `rand()` draws consumed by the procedural terrain stamps.

  const width = opts.width;
  const height = opts.height;
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const area = w * h;
  const stamps = ((Math.floor((area * TERRAIN_DENSITY_BASE) / (2 ** TERRAIN_DENSITY_SHIFT))) + (Math.floor((area * TERRAIN_DENSITY_OVERLAY) / (2 ** TERRAIN_DENSITY_SHIFT))) + (Math.floor((area * TERRAIN_DENSITY_DETAIL) / (2 ** TERRAIN_DENSITY_SHIFT))));

  return stamps * TERRAIN_RAND_DRAWS_PER_STAMP;
}

function advanceRandomTerrainPreludeRng(rng: CrandLike): void {
  // Native `terrain_generate_random()` consumes three CRT draws before the
  // unlock-gated variant rolls. The values are not used by the rewrite, but
  // the state advance is required for parity.
  rng.advance(TERRAIN_RANDOM_PRELUDE_DRAWS);
}

function advanceTerrainStampingRng(rng: CrandLike, opts: { width: number; height: number }): void {
  const width = opts.width;
  const height = opts.height;
  rng.advance(terrainStampingDraws({ width: width, height: height }));
}

export function advanceUnlockTerrain(rng: CrandLike, opts: { unlockIndex: number; width: number; height: number }): TerrainSetup {
  // Advance RNG through the shared unlock-driven terrain startup window.
  //
  // Mutates the authoritative RNG to match native `terrain_generate_random()`
  // and returns the minimal render boundary data needed by the detached terrain
  // renderer.

  const unlockIndex = opts.unlockIndex;
  const width = opts.width;
  const height = opts.height;
  advanceRandomTerrainPreludeRng(rng);
  const terrainSlots = chooseUnlockTerrainSlots({ unlockIndex: unlockIndex, rng: rng });
  const terrainSeed = rng.state;
  advanceTerrainStampingRng(
    rng,
    { width: width, height: height },
  );
  return new TerrainSetup({ terrainSlots: terrainSlots, terrainSeed: terrainSeed });
}

export function advanceExplicitTerrain(rng: CrandLike, opts: { terrainSlots: TerrainSlotTriplet; width: number; height: number }): TerrainSetup {
  // Advance RNG through explicit terrain generation when slots are fixed.

  const terrainSlots = opts.terrainSlots;
  const width = opts.width;
  const height = opts.height;
  const terrainSeed = rng.state;
  advanceTerrainStampingRng(
    rng,
    { width: width, height: height },
  );
  return new TerrainSetup({ terrainSlots: terrainSlots, terrainSeed: terrainSeed });
}
