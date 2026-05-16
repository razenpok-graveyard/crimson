// Port of crimson/render/terrain_fx.py

import { effectSrcRect } from '@crimson/effects-atlas.ts';
import type { TerrainFxBatch } from '@crimson/sim/terrain-fx.ts';
import type { rl } from '@grim/raylib-api.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import { GroundCorpseDecal, GroundDecal } from '@grim/terrain-render.ts';
import * as wgl from '@wgl';

export function bakeTerrainFxBatch(ground: GroundRenderer, opts: { batch: TerrainFxBatch; textures: FxQueueTextures; corpseFrameForType: (arg0: number) => number }): [boolean, boolean] {
  // Bake terrain FX batch into the ground render target (port of `fx_queue_render`).

  const batch = opts.batch;
  const textures = opts.textures;
  const corpseFrameForType = opts.corpseFrameForType;
  const decals: GroundDecal[] = [];
  for (const entry of batch.decals) {
    const src = effectSrcRect(entry.effectId, { textureWidth: textures.particles.width, textureHeight: textures.particles.height });
    if (src === null) {
      continue;
    }
    decals.push(new GroundDecal({ texture: textures.particles, src: wgl.makeRectangle(...src), pos: entry.pos, width: entry.width, height: entry.height, rotationRad: entry.rotation, tint: entry.color.toRl() }));
  }

  const corpseDecals: GroundCorpseDecal[] = [];
  for (const entry of batch.corpses) {
    corpseDecals.push(new GroundCorpseDecal({ bodysetFrame: corpseFrameForType(entry.creatureTypeId), topLeft: entry.topLeft, size: entry.scale, rotationRad: entry.rotation, tint: entry.color.toRl() }));
  }

  const bakedFx = ground.bakeDecals(decals);
  const bakedCorpses = ground.bakeCorpseDecals(textures.bodyset, corpseDecals);
  return [bakedFx, bakedCorpses];
}

export class FxQueueTextures {
  readonly particles: rl.Texture;
  readonly bodyset: rl.Texture;

  constructor(opts: {
    particles: rl.Texture;
    bodyset: rl.Texture;
  }) {
    this.particles = opts.particles;
    this.bodyset = opts.bodyset;
  }
}
