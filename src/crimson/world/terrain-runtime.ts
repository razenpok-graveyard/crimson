// Port of crimson/world/terrain_runtime.py

import type { TerrainSlotTriplet } from '@crimson/terrain-slots.ts';
import { resolveTerrainSlots } from '@crimson/terrain-slots.ts';
import type { RenderResources } from '@crimson/world/render-resources.ts';

export class TerrainRuntime {
  worldSize: number;
  renderResources: RenderResources;

  constructor(opts: {
    worldSize?: number;
    renderResources?: RenderResources;
  } = {}) {
    this.worldSize = opts.worldSize ?? 1024.0;
    this.renderResources = opts.renderResources ?? undefined!;
  }

  applyTerrainSetup(opts: { terrainSlots: TerrainSlotTriplet; seed: number }): void {
    const terrainSlots = opts.terrainSlots;
    const seed = opts.seed;
    const [base, overlay, detail] = resolveTerrainSlots(terrainSlots, this.renderResources.registryTexture.bind(this.renderResources));
    this.renderResources.setGroundTextures({
      base: base,
      overlay: overlay,
      detail: detail,
    });
    this.renderResources.scheduleGroundGeneration({ seed: seed });
  }

  scheduleFromRngSeed(opts: { seed: number }): void {
    const seed = opts.seed;
    this.renderResources.scheduleGroundGeneration({ seed: seed });
  }

  processPending(): void {
    this.renderResources.processGroundPending();
  }
}
