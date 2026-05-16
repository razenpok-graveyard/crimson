// Port of crimson/typo/player.py

import { Vec2 } from '@grim/geom.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { WeaponId } from '@crimson/weapons.ts';

export const TYPO_WEAPON_ID = WeaponId.SAWED_OFF_SHOTGUN;

export function enforceTypoPlayerFrame(player: PlayerState, opts: { state: GameplayState }): void {
  // Match Typ-o Shooter's bespoke player loop (`player_fire_weapon @ 0x00444980`).
  //
  // Typ-o resets timers and tops up ammo each frame, so typing speed (not weapon
  // cooldown) controls rate of fire.

  const state = opts.state;
  if (player.weapon.weaponId !== TYPO_WEAPON_ID) {
    weaponAssignPlayer(player, TYPO_WEAPON_ID, { state: state });
  }

  player.weapon.shotCooldown = 0.0;
  player.spreadHeat = 0.0;
  player.weapon.ammo = Math.max(0, Math.trunc(player.weapon.clipSize));

  player.weapon.reloadActive = false;
  player.weapon.reloadTimer = 0.0;
  player.weapon.reloadTimerMax = 0.0;
}

export function buildTypoPlayerInput(opts: { aim: Vec2; fireRequested: boolean; reloadRequested: boolean }): PlayerInput {
  const aim = opts.aim;
  const fireRequested = opts.fireRequested;
  const reloadRequested = opts.reloadRequested;
  const fire = fireRequested;
  return new PlayerInput({ move: new Vec2(), aim: aim, fireDown: fire, firePressed: fire, reloadPressed: reloadRequested });
}
