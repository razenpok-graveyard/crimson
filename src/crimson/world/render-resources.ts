// Port of crimson/world/render_resources.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId, runtimeResourcesFor } from '@grim/assets.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import { GroundRenderer } from '@grim/terrain-render.ts';
import { creatureCorpseFrameForType } from '@crimson/creatures/anim.ts';
import type { CreaturePool } from '@crimson/creatures/runtime.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import { RenderFrame } from '@crimson/render/frame.ts';
import type { RtxRenderMode } from '@crimson/render/rtx/mode.ts';
import { FxQueueTextures, bakeTerrainFxBatch } from '@crimson/render/terrain-fx.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import type { TerrainFxBatch } from '@crimson/sim/terrain-fx.ts';
import * as wgl from '@wgl';

export class RenderResources {
  assetsDir: string;
  worldSize: number;
  config: CrimsonConfig | null;
  ground: GroundRenderer | null;
  fxTextures: FxQueueTextures | null;
  _pendingTerrainFxBatches: TerrainFxBatch[];
  _resources: RuntimeResources | null;

  constructor(opts: {
    assetsDir: string;
    worldSize?: number;
    config?: CrimsonConfig | null;
    ground?: GroundRenderer | null;
    fxTextures?: FxQueueTextures | null;
    _pendingTerrainFxBatches?: TerrainFxBatch[];
    _resources?: RuntimeResources | null;
  }) {
    this.assetsDir = opts.assetsDir;
    this.worldSize = opts.worldSize ?? 1024.0;
    this.config = opts.config ?? null;
    this.ground = opts.ground ?? null;
    this.fxTextures = opts.fxTextures ?? null;
    this._pendingTerrainFxBatches = opts._pendingTerrainFxBatches ?? [];
    this._resources = opts._resources ?? null;
  }

  get resources(): RuntimeResources {
    const resources = this._resources;
    if (!(resources !== null)) throw new Error('runtime resources must be loaded before use');
    return resources;
  }

  set resources(value: RuntimeResources | null) {
    this._resources = value;
  }

  registryTexture(textureId: TextureId): rl.Texture {
    const resources = this._resources;
    if (resources !== null) {
      return resources.texture(textureId);
    }
    return runtimeResourcesFor(this.assetsDir).texture(textureId);
  }

  syncGroundSettings(): void {
    if (this.ground === null) {
      return;
    }
    if (this.config === null) {
      this.ground.textureScale = 1.0;
      return;
    }
    this.ground.textureScale = this.config.display.textureScale;
  }

  setGroundTextures(opts: { base: rl.Texture; overlay: rl.Texture; detail: rl.Texture }): void {
    const base = opts.base;
    const overlay = opts.overlay;
    const detail = opts.detail;
    this.clearPendingTerrainFx();
    if (this.ground === null) {
      this.ground = new GroundRenderer({ texture: base, overlay: overlay, overlayDetail: detail, width: int(this.worldSize), height: int(this.worldSize), textureScale: 1.0 });
    } else {
      this.ground.texture = base;
      this.ground.overlay = overlay;
      this.ground.overlayDetail = detail;
    }
    this.syncGroundSettings();
  }

  scheduleGroundGeneration(opts: { seed: number }): void {
    const seed = opts.seed;
    if (this.ground === null) {
      return;
    }
    this.ground.scheduleGenerate(seed);
  }

  processGroundPending(): void {
    if (this.ground === null) {
      return;
    }
    this.ground.processPending();
    if (this.ground.textureFailed) {
      this.clearPendingTerrainFx();
      return;
    }
    if (!this.ground.renderTargetReady()) {
      return;
    }
    if (this.fxTextures === null || this._pendingTerrainFxBatches.length === 0) {
      return;
    }
    const pending = Array.from(this._pendingTerrainFxBatches);
    this._pendingTerrainFxBatches.length = 0;
    for (const batch of pending) {
      this._bakeTerrainFxBatch(
        batch,
        { corpseFrameForType: creatureCorpseFrameForType },
      );
    }
  }

  open(opts: { terrainSeed: number }): void {
    const terrainSeed = opts.terrainSeed;
    this.close();
    const resources = runtimeResourcesFor(this.assetsDir);
    this._resources = resources;

    const base = resources.texture(TextureId.TER_Q1_BASE);
    const overlay = resources.texture(TextureId.TER_Q1_OVERLAY);
    this.setGroundTextures({ base: base, overlay: overlay, detail: base });
    this.scheduleGroundGeneration({ seed: terrainSeed });
    this.fxTextures = new FxQueueTextures({ particles: resources.texture(TextureId.PARTICLES), bodyset: resources.texture(TextureId.BODYSET) });
  }

  close(): void {
    if (this.ground !== null && this.ground.renderTarget !== null) {
      wgl.unloadRenderTexture(this.ground.renderTarget);
      this.ground.renderTarget = null;
    }
    this.ground = null;

    this._resources = null;
    this.fxTextures = null;
    this.clearPendingTerrainFx();
  }

  clearPendingTerrainFx(): void {
    this._pendingTerrainFxBatches.length = 0;
  }

  _bakeTerrainFxBatch(batch: TerrainFxBatch, opts: { corpseFrameForType?: (arg0: number) => number } = {}): void {
    const corpseFrameForType = opts.corpseFrameForType ?? creatureCorpseFrameForType;
    if (this.ground === null || this.fxTextures === null) {
      return;
    }
    if (batch.isEmpty()) {
      return;
    }
    bakeTerrainFxBatch(
      this.ground,
      { batch: batch, textures: this.fxTextures, corpseFrameForType: corpseFrameForType },
    );
  }

  consumeTerrainFxBatch(batch: TerrainFxBatch, opts: { corpseFrameForType?: (arg0: number) => number } = {}): void {
    const corpseFrameForType = opts.corpseFrameForType ?? creatureCorpseFrameForType;
    if (batch.isEmpty()) {
      return;
    }
    const ground = this.ground;
    if (ground === null || ground.textureFailed || this.fxTextures === null) {
      return;
    }
    if (ground.renderTargetReady()) {
      this._bakeTerrainFxBatch(
        batch,
        { corpseFrameForType: corpseFrameForType },
      );
      return;
    }
    this._pendingTerrainFxBatches.push(batch);
  }

  buildRenderFrame(opts: { state: GameplayState; players: PlayerState[]; creatures: CreaturePool; camera: Vec2; demoModeActive: boolean; elapsedMs: number; bonusAnimPhase: number; lanPlayerRingsEnabled: boolean; lanLocalAimIndicatorsOnly: boolean; lanLocalPlayerSlotIndex: number; rtxMode: RtxRenderMode }): RenderFrame {
    const state = opts.state;
    const players = opts.players;
    const creatures = opts.creatures;
    const camera = opts.camera;
    const demoModeActive = opts.demoModeActive;
    const elapsedMs = opts.elapsedMs;
    const bonusAnimPhase = opts.bonusAnimPhase;
    const lanPlayerRingsEnabled = opts.lanPlayerRingsEnabled;
    const lanLocalAimIndicatorsOnly = opts.lanLocalAimIndicatorsOnly;
    const lanLocalPlayerSlotIndex = opts.lanLocalPlayerSlotIndex;
    const rtxMode = opts.rtxMode;
    return new RenderFrame({ worldSize: this.worldSize, demoModeActive: demoModeActive, config: this.config, camera: camera, ground: this.ground, state: state, players: players, creatures: creatures, resources: this.resources, elapsedMs: elapsedMs, bonusAnimPhase: bonusAnimPhase, lanPlayerRingsEnabled: lanPlayerRingsEnabled, lanLocalAimIndicatorsOnly: lanLocalAimIndicatorsOnly, lanLocalPlayerSlotIndex: int(lanLocalPlayerSlotIndex), rtxMode: rtxMode });
  }
}
