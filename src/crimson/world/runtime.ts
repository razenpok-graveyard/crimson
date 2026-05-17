// Port of crimson/world/runtime.py

import type { AudioState } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import type { RenderFrame } from '@crimson/render/frame.ts';
import { RtxRenderMode } from '@crimson/render/rtx/mode.ts';
import { WorldRenderer } from '@crimson/render/world/renderer.ts';
import { AudioBridge } from '@crimson/world/audio-bridge.ts';
import { RenderResources } from '@crimson/world/render-resources.ts';
import { SimWorldState } from '@crimson/world/sim-world-state.ts';
import { TerrainRuntime } from '@crimson/world/terrain-runtime.ts';
import * as wgl from '@wgl';
import * as viewport from '@crimson/render/world/viewport.ts';

// Composition container owning the 4 world components and shared lifecycle methods.
export class WorldRuntime {
  assetsDir: string;
  worldSize: number;
  demoModeActive: boolean;
  questFailRetryCount: number;
  hardcore: boolean;
  preserveBugs: boolean;
  config: CrimsonConfig | null;
  audio: AudioState | null;
  audioRng: CrandLike;
  rtxMode: RtxRenderMode;
  simWorld: SimWorldState;
  renderResources: RenderResources;
  audioBridge: AudioBridge;
  terrainRuntime: TerrainRuntime;
  camera: Vec2;
  lanPlayerRingsEnabled: boolean;
  lanLocalAimIndicatorsOnly: boolean;
  lanLocalPlayerSlotIndex: number;
  renderer: WorldRenderer;

  constructor(opts: { assetsDir: string; worldSize?: number; demoModeActive?: boolean; questFailRetryCount?: number; hardcore?: boolean; preserveBugs?: boolean; config?: CrimsonConfig | null; audioRng: CrandLike; audio?: AudioState | null; rtxMode?: RtxRenderMode }) {
    const assetsDir = opts.assetsDir;
    const worldSize = opts.worldSize ?? 1024.0;
    const demoModeActive = opts.demoModeActive ?? false;
    const questFailRetryCount = opts.questFailRetryCount ?? 0;
    const hardcore = opts.hardcore ?? false;
    const preserveBugs = opts.preserveBugs ?? false;
    const config = opts.config ?? null;
    const audioRng = opts.audioRng;
    const audio = opts.audio ?? null;
    const rtxMode = opts.rtxMode ?? RtxRenderMode.CLASSIC;
    this.assetsDir = assetsDir;
    this.worldSize = worldSize;
    this.demoModeActive = demoModeActive;
    this.questFailRetryCount = int(questFailRetryCount);
    this.hardcore = hardcore;
    this.preserveBugs = preserveBugs;
    this.config = config;
    this.audio = audio;
    this.audioRng = audioRng;
    this.rtxMode = rtxMode;

    this.simWorld = new SimWorldState({ worldSize: this.worldSize, demoModeActive: Boolean(this.demoModeActive), hardcore: Boolean(this.hardcore), questFailRetryCount: int(this.questFailRetryCount), preserveBugs: Boolean(this.preserveBugs) });
    const renderResources = new RenderResources({ assetsDir: this.assetsDir, worldSize: this.worldSize, config: this.config });
    this.renderResources = renderResources;
    this.audioBridge = new AudioBridge({ demoModeActive: Boolean(this.demoModeActive), reflexBoostTimerSource: () => this.simWorld.state.bonuses.reflexBoost, audio: this.audio, audioRng: this.audioRng });
    this.terrainRuntime = new TerrainRuntime({ worldSize: this.worldSize, renderResources: renderResources });

    this.camera = new Vec2(-1.0, -1.0);
    this.lanPlayerRingsEnabled = false;
    this.lanLocalAimIndicatorsOnly = false;
    this.lanLocalPlayerSlotIndex = 0;
    this.renderer = new WorldRenderer({ worldSize: this.worldSize, config: this.config, camera: this.camera });

    this._syncWorldSizeOwnership();
    this.syncAudioBridgeState();
  }

  // ------------------------------------------------------------------
  // Shared lifecycle methods (extracted from 4 identical implementations)
  // ------------------------------------------------------------------
  syncWorldSize(): void {
    this._syncWorldSizeOwnership();
  }

  protected _syncWorldSizeOwnership(): void {
    const worldSize = this.worldSize;
    this.simWorld.worldSize = worldSize;
    this.renderResources.worldSize = worldSize;
    this.terrainRuntime.worldSize = worldSize;
    this.renderer.syncViewport({
      worldSize: worldSize,
      config: this.config,
      camera: this.camera,
    });
    const ground = this.renderResources.ground;
    if (ground !== null) {
      const side = Math.max(0, int(worldSize));
      ground.width = side;
      ground.height = side;
    }
  }

  reset(opts: { seed?: number; playerCount?: number; spawnPos?: Vec2 | null } = {}): void {
    const seed = opts.seed ?? 0xBEEF;
    const playerCount = opts.playerCount ?? 1;
    const spawnPos = opts.spawnPos ?? null;
    this._syncWorldSizeOwnership();
    this.simWorld.demoModeActive = this.demoModeActive;
    this.simWorld.hardcore = this.hardcore;
    this.simWorld.questFailRetryCount = int(this.questFailRetryCount);
    this.simWorld.preserveBugs = this.preserveBugs;
    this.simWorld.reset({
      seed: int(seed),
      playerCount: int(playerCount),
      spawnPos: spawnPos,
    });
    this.renderResources.clearPendingTerrainFx();
    this.camera = new Vec2(-1.0, -1.0);
    this.renderer.syncViewport({
      worldSize: this.worldSize,
      config: this.config,
      camera: this.camera,
    });
    if (this.renderResources.ground !== null) {
      const terrainSeed = this.simWorld.state.rng.state;
      this.terrainRuntime.scheduleFromRngSeed({ seed: terrainSeed });
    }
  }

  openRuntime(): void {
    this.renderResources.config = this.config;
    this.renderResources.open({ terrainSeed: this.simWorld.state.rng.state });
  }

  closeRuntime(): void {
    this.renderResources.close();
    this.simWorld.closeSession();
  }

  syncAudioBridgeState(): void {
    this.audioBridge.sync({
      audio: this.audio,
      audioRng: this.audioRng,
      demoModeActive: this.demoModeActive,
    });
  }

  updateCamera(dt: number): void {
    const _ = dt;
    if (this.simWorld.players.length === 0) {
      return;
    }

    const screenSize = viewport.cameraScreenSize({ worldSize: this.worldSize, config: this.config, runtimeW: wgl.getScreenWidth(), runtimeH: wgl.getScreenHeight() });
    const alive = Array.from(this.simWorld.players).filter((player) => player.health > 0.0);
    let camera: Vec2;
    if (alive.length > 0) {
      const invAlive = 1.0 / alive.length;
      const focus = new Vec2(alive.reduce((total, player) => total + player.pos.x, 0) * invAlive, alive.reduce((total, player) => total + player.pos.y, 0) * invAlive);
      camera = screenSize.mul(0.5).sub(focus);
    } else {
      camera = this.camera;
    }

    camera = camera.add(this.simWorld.state.cameraShakeOffset);
    this.camera = viewport.clampCamera({ worldSize: this.worldSize, camera: camera, screenSize: screenSize });
    this.renderer.syncViewport({
      worldSize: this.worldSize,
      config: this.config,
      camera: this.camera,
    });
  }

  draw(opts: { drawAimIndicators?: boolean; entityAlpha?: number } = {}): void {
    const drawAimIndicators = opts.drawAimIndicators ?? true;
    const entityAlpha = opts.entityAlpha ?? 1.0;
    this.renderer.draw({
      renderFrame: this.buildRenderFrame(),
      drawAimIndicators: drawAimIndicators,
      entityAlpha: entityAlpha,
    });
  }

  buildRenderFrame(): RenderFrame {
    return this.renderResources.buildRenderFrame({ state: this.simWorld.state, players: this.simWorld.players, creatures: this.simWorld.creatures, camera: this.camera, demoModeActive: this.demoModeActive, elapsedMs: this.simWorld.presentationElapsedMs, bonusAnimPhase: this.simWorld.bonusAnimPhase, lanPlayerRingsEnabled: this.lanPlayerRingsEnabled, lanLocalAimIndicatorsOnly: this.lanLocalAimIndicatorsOnly, lanLocalPlayerSlotIndex: int(this.lanLocalPlayerSlotIndex), rtxMode: this.rtxMode });
  }
}
