// Port of crimson/weapon_runtime/spawn.py

import type { Vec2 } from '@grim/geom.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { weaponEntryForProjectileTypeId } from '@crimson/weapons.ts';

export function ownerRefForPlayer(playerIndex: number): OwnerRef {
  return OwnerRef.fromPlayer(int(playerIndex));
}

export function ownerRefForPlayerProjectiles(state: GameplayState, playerIndex: number): OwnerRef {
  if (!state.friendlyFireEnabled) {
    return OwnerRef.fromLocalPlayer(0);
  }
  return ownerRefForPlayer(playerIndex);
}

export function travelBudgetForTypeId(typeId: ProjectileTemplateId): number {
  return weaponEntryForProjectileTypeId(typeId).travelBudget;
}

function resolvePlayerSlot(players: PlayerState[], opts: { playerIndex: number }): number | null {
  const playerIndex = opts.playerIndex;
  const targetIndex = int(playerIndex);
  if (targetIndex >= 0 && targetIndex < players.length) {
    const direct = players[targetIndex];
    if (int(direct.index) === targetIndex) {
      return int(targetIndex);
    }
  }
  for (const [slot, player] of players.entries()) {
    if (int(player.index) === targetIndex) {
      return int(slot);
    }
  }
  return null;
}

function shotsFiredPlayerIndex(opts: { state: GameplayState; players: PlayerState[] | null; owner: OwnerRef; ownerPlayerIndex: number | null }): number | null {
  const state = opts.state;
  const players = opts.players;
  const owner = opts.owner;
  const ownerPlayerIndex = opts.ownerPlayerIndex;
  let playerIndex: number;
  if (ownerPlayerIndex !== null) {
    playerIndex = int(ownerPlayerIndex);
    if (playerIndex >= 0 && playerIndex < state.shotsFired.length) {
      return int(playerIndex);
    }
  }

  if (owner.isPlayer() && !(owner.localHost && owner.index === 0)) {
    playerIndex = int(owner.index);
    if (playerIndex >= 0 && playerIndex < state.shotsFired.length) {
      return int(playerIndex);
    }
  }

  if (owner.localHost && owner.index === 0 && players !== null && players.length > 0 && players.length === 1) {
    playerIndex = int(players[0].index);
    if (playerIndex >= 0 && playerIndex < state.shotsFired.length) {
      return int(playerIndex);
    }
  }

  return null;
}

function fireBulletsActive(players: PlayerState[] | null, opts: { state: GameplayState; owner: OwnerRef; ownerPlayerIndex: number | null }): boolean {
  const state = opts.state;
  const owner = opts.owner;
  const ownerPlayerIndex = opts.ownerPlayerIndex;
  if (players === null || players.length === 0) {
    return false;
  }

  // Native `projectile_spawn` checks player-1/player-2 Fire Bullets timers
  // globally, regardless of projectile ownership.
  if (Boolean(state.preserveBugs)) {
    return players.slice(0, 2).some((player) => player.fireBulletsTimer > 0.0);
  }

  let resolvedOwnerSlot: number | null = null;
  if (ownerPlayerIndex !== null) {
    resolvedOwnerSlot = resolvePlayerSlot(players, { playerIndex: int(ownerPlayerIndex) });
  } else if (owner.isPlayer() && !(owner.localHost && owner.index === 0)) {
    resolvedOwnerSlot = resolvePlayerSlot(players, { playerIndex: int(owner.index) });
  } else if (owner.localHost && owner.index === 0 && players.length === 1) {
    // Callers that only pass one player are explicitly indicating the owner
    // context (for example OwnerRef.from_local_player(0) with friendly fire disabled).
    resolvedOwnerSlot = 0;
  }

  if (resolvedOwnerSlot === null) {
    return false;
  }
  if (!(resolvedOwnerSlot >= 0 && resolvedOwnerSlot < players.length)) {
    return false;
  }
  return players[resolvedOwnerSlot].fireBulletsTimer > 0.0;
}

export function projectileSpawn(state: GameplayState, opts: { players: PlayerState[] | null; pos: Vec2; angle: number; typeId: ProjectileTemplateId; owner: OwnerRef; ownerPlayerIndex?: number | null; hitsPlayers?: boolean }): number {
  // Mirror `projectile_spawn` (0x00420440) Fire Bullets override.
  const players = opts.players;
  const pos = opts.pos;
  const angle = opts.angle;
  let typeId = opts.typeId;
  const owner = opts.owner;
  const ownerPlayerIndex = opts.ownerPlayerIndex ?? null;
  const hitsPlayers = opts.hitsPlayers ?? false;
  if (!state.bonusSpawnGuard && owner.isPlayer()) {
    while (true) {
      const playerIndex = shotsFiredPlayerIndex({ state: state, players: players, owner: owner, ownerPlayerIndex: ownerPlayerIndex });
      state.shotsFiredTotal += 1;
      if (playerIndex !== null) {
        state.shotsFired[playerIndex] += 1;
      }
      if (typeId === ProjectileTemplateId.FIRE_BULLETS) {
        break;
      }
      if (!fireBulletsActive(players, { state: state, owner: owner, ownerPlayerIndex: ownerPlayerIndex })) {
        break;
      }
      typeId = ProjectileTemplateId.FIRE_BULLETS;
    }
  }

  const meta = travelBudgetForTypeId(typeId);
  return state.projectiles.spawn({ pos: pos, angle: angle, typeId: typeId, owner: owner, travelBudget: meta, hitsPlayers: hitsPlayers });
}

export function spawnProjectileRing(state: GameplayState, originPos: Vec2, opts: { count: number; angleOffset: number; typeId: ProjectileTemplateId; owner: OwnerRef; ownerPlayerIndex?: number | null; players?: PlayerState[] | null }): void {
  const count = opts.count;
  const angleOffset = opts.angleOffset;
  const typeId = opts.typeId;
  const owner = opts.owner;
  const ownerPlayerIndex = opts.ownerPlayerIndex ?? null;
  const players = opts.players ?? null;
  if (count <= 0) {
    return;
  }
  const step = (Math.PI * 2.0) / count;
  for (let idx = 0; idx < count; idx++) {
    projectileSpawn(
      state,
      { players: players, pos: originPos, angle: idx * step + angleOffset, typeId: typeId, owner: owner, ownerPlayerIndex: ownerPlayerIndex },
    );
  }
}
