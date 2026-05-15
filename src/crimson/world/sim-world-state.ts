// Port of crimson/world/sim_world_state.py

import { Vec2 } from '@grim/geom.ts';
import type { CreaturePool } from '@crimson/creatures/runtime.ts';
import type { SpawnEnv } from '@crimson/creatures/spawn.ts';
import { GameplayState } from '@crimson/gameplay.ts';
import { PresentationStepCommands } from '@crimson/sim/presentation-step.ts';
import { PlayerState } from '@crimson/sim/state-types.ts';
import { WorldEvents, WorldState } from '@crimson/sim/world-state.ts';
import { weaponAssignPlayer, initDefaultAltWeapon } from '@crimson/weapon-runtime/index.ts';
import { WEAPON_TABLE, WeaponId } from '@crimson/weapons.ts';

function _weaponDamageScaleMap(): Map<number, number> {
  const table = new Map<number, number>();
  for (const entry of WEAPON_TABLE) {
    const wid = int(entry.weaponId);
    if (wid <= 0) continue;
    table.set(wid, Number(entry.damageScale));
  }
  return table;
}

export function resetWorldPlayers(
  players: PlayerState[],
  opts: { state: GameplayState; worldSize: number; playerCount: number; spawnPos?: Vec2 | null },
): void {
  const state = opts.state;
  const worldSize = opts.worldSize;
  const playerCount = opts.playerCount;
  const spawnPos = opts.spawnPos ?? null;
  players.length = 0;

  const base = spawnPos ?? new Vec2(worldSize * 0.5, worldSize * 0.5);
  const count = Math.max(1, int(playerCount));
  let offsets: Vec2[];
  if (count <= 1) {
    offsets = [new Vec2()];
  } else {
    const radius = 32.0;
    const step = Math.PI * 2.0 / count;
    offsets = [];
    for (let idx = 0; idx < count; idx++) {
      offsets.push(Vec2.fromAngle(idx * step).mul(radius));
    }
  }

  for (let idx = 0; idx < count; idx++) {
    const pos = base.add(offsets[idx]).clampRect(0.0, 0.0, worldSize, worldSize);
    const player = new PlayerState({ index: idx, pos });
    weaponAssignPlayer(player, WeaponId.PISTOL, { state });
    initDefaultAltWeapon(player);
    players.push(player);
  }

  // Reset-time loadout bootstrap should not leak queued reload SFX.
  state.sfxQueue.length = 0;
}

export class SimWorldState {
  worldSize: number;
  demoModeActive: boolean;
  questFailRetryCount: number;
  hardcore: boolean;
  preserveBugs: boolean;

  worldState!: WorldState;
  spawnEnv!: SpawnEnv;
  state!: GameplayState;
  players!: PlayerState[];
  creatures!: CreaturePool;

  damageScaleByType: Map<number, number>;
  presentationElapsedMs = 0.0;
  bonusAnimPhase = 0.0;
  gameTuneStarted = false;
  lastEvents: WorldEvents;
  lastPresentation: PresentationStepCommands;

  constructor(opts?: {
    worldSize?: number;
    demoModeActive?: boolean;
    questFailRetryCount?: number;
    hardcore?: boolean;
    preserveBugs?: boolean;
  }) {
    this.worldSize = opts?.worldSize ?? 1024.0;
    this.demoModeActive = opts?.demoModeActive ?? false;
    this.questFailRetryCount = opts?.questFailRetryCount ?? 0;
    this.hardcore = opts?.hardcore ?? false;
    this.preserveBugs = opts?.preserveBugs ?? false;
    this.damageScaleByType = _weaponDamageScaleMap();
    this.lastEvents = new WorldEvents({ hits: [], deaths: [], pickups: [], sfx: [] });
    this.lastPresentation = new PresentationStepCommands();
    this.reset({ seed: 0xBEEF, playerCount: 1 });
  }

  reset(opts?: { seed?: number; playerCount?: number; spawnPos?: Vec2 | null }): void {
    const seed = opts?.seed ?? 0xBEEF;
    const playerCount = opts?.playerCount ?? 1;
    const spawnPos = opts?.spawnPos ?? null;
    this.worldState = WorldState.build({
      worldSize: this.worldSize,
      demoModeActive: Boolean(this.demoModeActive),
      hardcore: Boolean(this.hardcore),
      questFailRetryCount: int(this.questFailRetryCount),
      preserveBugs: Boolean(this.preserveBugs),
    });
    this.spawnEnv = this.worldState.spawnEnv;
    this.state = this.worldState.state;
    this.players = this.worldState.players;
    this.creatures = this.worldState.creatures;
    this.state.rng.srand(int(seed));

    this.lastEvents = new WorldEvents({ hits: [], deaths: [], pickups: [], sfx: [] });
    this.lastPresentation = new PresentationStepCommands();

    this.presentationElapsedMs = 0.0;
    this.bonusAnimPhase = 0.0;
    this.gameTuneStarted = false;

    resetWorldPlayers(
      this.players,
      { state: this.state, worldSize: this.worldSize, playerCount: int(playerCount), spawnPos },
    );
  }

  loadWorldState(worldState: WorldState): void {
    this.worldState = worldState;
    this.spawnEnv = this.worldState.spawnEnv;
    this.state = this.worldState.state;
    this.players = this.worldState.players;
    this.creatures = this.worldState.creatures;
    this.lastEvents = new WorldEvents({ hits: [], deaths: [], pickups: [], sfx: [] });
    this.lastPresentation = new PresentationStepCommands();
  }

  applyStepMetadata(opts: {
    events: WorldEvents;
    presentation: PresentationStepCommands;
    dtSim: number;
    gameTuneStarted: boolean;
  }): void {
    this.lastEvents = opts.events;
    this.lastPresentation = opts.presentation;

    if (opts.dtSim > 0.0) {
      this.presentationElapsedMs += opts.dtSim * 1000.0;
      this.bonusAnimPhase += opts.dtSim * 1.3;
    }

    this.gameTuneStarted = Boolean(opts.gameTuneStarted);
  }

  closeSession(): void {
    this.lastEvents = new WorldEvents({ hits: [], deaths: [], pickups: [], sfx: [] });
    this.lastPresentation = new PresentationStepCommands();

    this.gameTuneStarted = false;
  }
}
