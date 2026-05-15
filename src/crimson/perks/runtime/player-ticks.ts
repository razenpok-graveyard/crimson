// Port of crimson/perks/runtime/player_ticks.py

import type { Vec2 } from '@grim/geom.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { PLAYER_PERK_TICK_STEPS } from '@crimson/perks/runtime/manifest.ts';
import type { OwnerRefForPlayerFn, OwnerRefForPlayerProjectilesFn, ProjectileSpawnFn } from '@crimson/perks/runtime/player-tick-context.ts';
import { PlayerPerkTickCtx } from '@crimson/perks/runtime/player-tick-context.ts';

const _PLAYER_PERK_TICK_STEPS = PLAYER_PERK_TICK_STEPS;

export function applyPlayerPerkTicks(opts: { player: PlayerState; playerPosBeforeMove: Vec2; dt: number; state: GameplayState; players: PlayerState[] | null; stationary: boolean; ownerRefForPlayer: OwnerRefForPlayerFn; ownerRefForPlayerProjectiles: OwnerRefForPlayerProjectilesFn; projectileSpawn: ProjectileSpawnFn }): void {
  const player = opts.player;
  const playerPosBeforeMove = opts.playerPosBeforeMove;
  const dt = opts.dt;
  const state = opts.state;
  const players = opts.players;
  const stationary = opts.stationary;
  const ownerRefForPlayer = opts.ownerRefForPlayer;
  const ownerRefForPlayerProjectiles = opts.ownerRefForPlayerProjectiles;
  const projectileSpawn = opts.projectileSpawn;
  const ctx = new PlayerPerkTickCtx({ state: state, player: player, playerPosBeforeMove: playerPosBeforeMove, players: players, dt: dt, stationary: stationary, ownerRefForPlayer: ownerRefForPlayer, ownerRefForPlayerProjectiles: ownerRefForPlayerProjectiles, projectileSpawn: projectileSpawn });
  for (const step of _PLAYER_PERK_TICK_STEPS) {
    step(ctx);
  }
}
