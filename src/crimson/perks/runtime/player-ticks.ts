// Port of crimson/perks/runtime/player_ticks.py

import type { Vec2 } from '@grim/geom.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { PLAYER_PERK_TICK_STEPS } from './manifest.ts';
import { type OwnerRefForPlayerFn, type OwnerRefForPlayerProjectilesFn, PlayerPerkTickCtx, type ProjectileSpawnFn } from './player-tick-context.ts';

const _PLAYER_PERK_TICK_STEPS = PLAYER_PERK_TICK_STEPS;

export function applyPlayerPerkTicks(opts: {
  player: PlayerState;
  playerPosBeforeMove: Vec2;
  dt: number;
  state: GameplayState;
  players: PlayerState[] | null;
  stationary: boolean;
  ownerRefForPlayer: OwnerRefForPlayerFn;
  ownerRefForPlayerProjectiles: OwnerRefForPlayerProjectilesFn;
  projectileSpawn: ProjectileSpawnFn;
}): void {
  const ctx = new PlayerPerkTickCtx({
    state: opts.state,
    player: opts.player,
    playerPosBeforeMove: opts.playerPosBeforeMove,
    players: opts.players,
    dt: opts.dt,
    stationary: opts.stationary,
    ownerRefForPlayer: opts.ownerRefForPlayer,
    ownerRefForPlayerProjectiles: opts.ownerRefForPlayerProjectiles,
    projectileSpawn: opts.projectileSpawn,
  });
  for (const step of _PLAYER_PERK_TICK_STEPS) {
    step(ctx);
  }
}
