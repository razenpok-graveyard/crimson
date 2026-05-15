// Port of crimson/render/frame.py

import type { RuntimeResources } from '@grim/assets.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { Vec2 } from '@grim/geom.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { CreaturePool } from '@crimson/creatures/runtime.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import type { RtxRenderMode } from '@crimson/render/rtx/mode.ts';

// Typed world snapshot consumed by render code.
//
// This intentionally carries references (not deep copies) so render can be
// deterministic per frame boundary while remaining allocation-light.
export class RenderFrame {
  readonly worldSize: number;
  readonly demoModeActive: boolean;
  readonly config: CrimsonConfig | null;
  readonly camera: Vec2;
  readonly ground: GroundRenderer | null;
  readonly state: GameplayState;
  readonly players: PlayerState[];
  readonly creatures: CreaturePool;
  readonly resources: RuntimeResources;
  readonly elapsedMs: number;
  readonly bonusAnimPhase: number;
  readonly lanPlayerRingsEnabled: boolean;
  readonly lanLocalAimIndicatorsOnly: boolean;
  readonly lanLocalPlayerSlotIndex: number;
  readonly rtxMode: RtxRenderMode;

  constructor(opts: {
    worldSize: number;
    demoModeActive: boolean;
    config: CrimsonConfig | null;
    camera: Vec2;
    ground: GroundRenderer | null;
    state: GameplayState;
    players: PlayerState[];
    creatures: CreaturePool;
    resources: RuntimeResources;
    elapsedMs: number;
    bonusAnimPhase: number;
    lanPlayerRingsEnabled: boolean;
    lanLocalAimIndicatorsOnly: boolean;
    lanLocalPlayerSlotIndex: number;
    rtxMode: RtxRenderMode;
  }) {
    this.worldSize = opts.worldSize;
    this.demoModeActive = opts.demoModeActive;
    this.config = opts.config;
    this.camera = opts.camera;
    this.ground = opts.ground;
    this.state = opts.state;
    this.players = opts.players;
    this.creatures = opts.creatures;
    this.resources = opts.resources;
    this.elapsedMs = opts.elapsedMs;
    this.bonusAnimPhase = opts.bonusAnimPhase;
    this.lanPlayerRingsEnabled = opts.lanPlayerRingsEnabled;
    this.lanLocalAimIndicatorsOnly = opts.lanLocalAimIndicatorsOnly;
    this.lanLocalPlayerSlotIndex = opts.lanLocalPlayerSlotIndex;
    this.rtxMode = opts.rtxMode;
  }
}
