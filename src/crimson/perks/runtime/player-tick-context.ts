// Port of crimson/perks/runtime/player_tick_context.py

import type { Vec2 } from '@grim/geom.ts';
import type { OwnerRef } from '@crimson/owner-ref.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';

export type ProjectileSpawnFn = (...args: any[]) => number;
export type OwnerRefForPlayerFn = (arg0: number) => OwnerRef;
export type OwnerRefForPlayerProjectilesFn = (arg0: GameplayState, arg1: number) => OwnerRef;

export class PlayerPerkTickCtx {
  state: GameplayState;
  player: PlayerState;
  playerPosBeforeMove: Vec2;
  players: PlayerState[] | null;
  dt: number;
  stationary: boolean;
  ownerRefForPlayer: OwnerRefForPlayerFn;
  ownerRefForPlayerProjectiles: OwnerRefForPlayerProjectilesFn;
  projectileSpawn: ProjectileSpawnFn;

  constructor(opts: {
    state: GameplayState;
    player: PlayerState;
    playerPosBeforeMove: Vec2;
    players: PlayerState[] | null;
    dt: number;
    stationary: boolean;
    ownerRefForPlayer: OwnerRefForPlayerFn;
    ownerRefForPlayerProjectiles: OwnerRefForPlayerProjectilesFn;
    projectileSpawn: ProjectileSpawnFn;
  }) {
    this.state = opts.state;
    this.player = opts.player;
    this.playerPosBeforeMove = opts.playerPosBeforeMove;
    this.players = opts.players;
    this.dt = opts.dt;
    this.stationary = opts.stationary;
    this.ownerRefForPlayer = opts.ownerRefForPlayer;
    this.ownerRefForPlayerProjectiles = opts.ownerRefForPlayerProjectiles;
    this.projectileSpawn = opts.projectileSpawn;
  }
}
