// Port of crimson/world/sim_world_state.py

import { Vec2 } from '@grim/geom.ts';
import type { CreaturePool } from '@crimson/creatures/runtime.ts';
import type { SpawnEnv } from '@crimson/creatures/spawn.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import { PresentationStepCommands } from '@crimson/sim/presentation-step.ts';
import { PlayerState } from '@crimson/sim/state-types.ts';
import { WorldEvents, WorldState } from '@crimson/sim/world-state.ts';
import { initDefaultAltWeapon, weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { WEAPON_TABLE, WeaponId } from '@crimson/weapons.ts';

export class SimWorldState {
  worldSize: number;
  demoModeActive: boolean;
  questFailRetryCount: number;
  hardcore: boolean;
  preserveBugs: boolean;
  worldState: WorldState;
  spawnEnv: SpawnEnv;
  state: GameplayState;
  players: PlayerState[];
  creatures: CreaturePool;
  damageScaleByType: Map<number, number>;
  presentationElapsedMs: number;
  bonusAnimPhase: number;
  gameTuneStarted: boolean;
  lastEvents: WorldEvents;
  lastPresentation: PresentationStepCommands;

  constructor(opts: {
    worldSize?: number;
    demoModeActive?: boolean;
    questFailRetryCount?: number;
    hardcore?: boolean;
    preserveBugs?: boolean;
    worldState?: WorldState;
    spawnEnv?: SpawnEnv;
    state?: GameplayState;
    players?: PlayerState[];
    creatures?: CreaturePool;
    damageScaleByType?: Map<number, number>;
    presentationElapsedMs?: number;
    bonusAnimPhase?: number;
    gameTuneStarted?: boolean;
    lastEvents?: WorldEvents;
    lastPresentation?: PresentationStepCommands;
  } = {}) {
    this.worldSize = opts.worldSize ?? 1024.0;
    this.demoModeActive = opts.demoModeActive ?? false;
    this.questFailRetryCount = opts.questFailRetryCount ?? 0;
    this.hardcore = opts.hardcore ?? false;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.worldState = opts.worldState ?? undefined!;
    this.spawnEnv = opts.spawnEnv ?? undefined!;
    this.state = opts.state ?? undefined!;
    this.players = opts.players ?? [];
    this.creatures = opts.creatures ?? undefined!;
    this.damageScaleByType = opts.damageScaleByType ?? weaponDamageScaleMap();
    this.presentationElapsedMs = opts.presentationElapsedMs ?? 0.0;
    this.bonusAnimPhase = opts.bonusAnimPhase ?? 0.0;
    this.gameTuneStarted = opts.gameTuneStarted ?? false;
    this.lastEvents = opts.lastEvents ?? new WorldEvents({ hits: [], deaths: [], pickups: [], sfx: [] });
    this.lastPresentation = opts.lastPresentation ?? new PresentationStepCommands();
    this.reset({ seed: 0xBEEF, playerCount: 1 });
  }

  reset(opts: { seed?: number; playerCount?: number; spawnPos?: Vec2 | null } = {}): void {
    const seed = opts.seed ?? 0xBEEF;
    const playerCount = opts.playerCount ?? 1;
    const spawnPos = opts.spawnPos ?? null;
    this.worldState = WorldState.build({ worldSize: this.worldSize, demoModeActive: this.demoModeActive, hardcore: this.hardcore, questFailRetryCount: int(this.questFailRetryCount), preserveBugs: this.preserveBugs });
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
      { state: this.state, worldSize: this.worldSize, playerCount: int(playerCount), spawnPos: spawnPos },
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

  applyStepMetadata(opts: { events: WorldEvents; presentation: PresentationStepCommands; dtSim: number; gameTuneStarted: boolean }): void {
    const events = opts.events;
    const presentation = opts.presentation;
    const dtSim = opts.dtSim;
    const gameTuneStarted = opts.gameTuneStarted;
    this.lastEvents = events;
    this.lastPresentation = presentation;

    if (dtSim > 0.0) {
      this.presentationElapsedMs += dtSim * 1000.0;
      this.bonusAnimPhase += dtSim * 1.3;
    }

    this.gameTuneStarted = gameTuneStarted;
  }

  closeSession(): void {
    this.lastEvents = new WorldEvents({ hits: [], deaths: [], pickups: [], sfx: [] });
    this.lastPresentation = new PresentationStepCommands();

    this.gameTuneStarted = false;
  }
}

function weaponDamageScaleMap(): Map<number, number> {
  const table: Map<number, number> = new Map();
  for (const entry of WEAPON_TABLE) {
    if (int(entry.weaponId) <= 0) {
      continue;
    }
    table.set(int(entry.weaponId), entry.damageScale);
  }
  return table;
}

export function resetWorldPlayers(players: PlayerState[], opts: { state: GameplayState; worldSize: number; playerCount: number; spawnPos?: Vec2 | null }): void {
  const state = opts.state;
  const worldSize = opts.worldSize;
  const playerCount = opts.playerCount;
  const spawnPos = opts.spawnPos ?? null;
  players.length = 0;

  const base = spawnPos === null ? new Vec2(worldSize * 0.5, worldSize * 0.5) : spawnPos;
  const count = Math.max(1, int(playerCount));
  let offsets: Vec2[];
  if (count <= 1) {
    offsets = [new Vec2()];
  } else {
    const radius = 32.0;
    const step = (Math.PI * 2.0) / count;
    offsets = Array.from({ length: Math.max(0, count) }, (_, i) => i).map((idx) => Vec2.fromAngle(idx * step).mul(radius));
  }

  for (let idx = 0; idx < count; idx++) {
    const pos = (base.add(offsets[idx])).clampRect(0.0, 0.0, worldSize, worldSize);
    const player = new PlayerState({ index: idx, pos: pos });
    weaponAssignPlayer(player, WeaponId.PISTOL, { state: state });
    initDefaultAltWeapon(player);
    players.push(player);
  }

  // Reset-time loadout bootstrap should not leak queued reload SFX.
  state.sfxQueue.clear();
}
