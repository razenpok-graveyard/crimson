// Port of crimson/weapon_runtime/assign.py

import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { WeaponSlot } from '@crimson/sim/state-types.ts';
import { weaponUsageSlotForWeaponId } from '@crimson/weapon-usage.ts';
import { WEAPON_BY_ID, Weapon, WeaponId } from '@crimson/weapons.ts';

export type WeaponAssignClipModifier = (arg0: WeaponAssignCtx) => void;

export class WeaponAssignCtx {
  player: PlayerState;
  clipSize: number;

  constructor(opts: {
    player: PlayerState;
    clipSize: number;
  }) {
    this.player = opts.player;
    this.clipSize = opts.clipSize;
  }
}

export function weaponEntry(weaponId: WeaponId): Weapon {
  return WEAPON_BY_ID.get(weaponId)!;
}

function weaponAssignClipAmmoManiac(ctx: WeaponAssignCtx): void {
  if (perkActive(ctx.player, PerkId.AMMO_MANIAC)) {
    ctx.clipSize += Math.max(1, int(ctx.clipSize * 0.25));
  }
}

function weaponAssignClipMyFavouriteWeapon(ctx: WeaponAssignCtx): void {
  if (perkActive(ctx.player, PerkId.MY_FAVOURITE_WEAPON)) {
    ctx.clipSize += 2;
  }
}

export function initDefaultAltWeapon(player: PlayerState): void {
  // Initialize native reset-time alternate weapon slot state.

  player.altWeapon = new WeaponSlot({ weaponId: WeaponId.PISTOL, clipSize: 12, ammo: 12.0, reloadActive: false, reloadTimer: 0.0, reloadTimerMax: 1.2, shotCooldown: 0.0 });
}

export function weaponAssignPlayer(player: PlayerState, weaponId: WeaponId, opts: { state: GameplayState }): void {
  // Assign weapon and reset per-weapon runtime state (ammo/cooldowns).

  const state = opts.state;
  if (state.status !== null && !state.demoModeActive) {
    const usageSlot = weaponUsageSlotForWeaponId(int(weaponId));
    if (usageSlot !== null) {
      state.status.incrementWeaponUsageSlot(usageSlot);
    }
  }

  const weapon = weaponEntry(weaponId);
  player.weapon.weaponId = weaponId;

  const clipSize = int(weapon.clipSize);
  const clipCtx = new WeaponAssignCtx({ player: player, clipSize: Math.max(0, clipSize) });
  for (const modifier of _WEAPON_ASSIGN_CLIP_MODIFIERS) {
    modifier(clipCtx);
  }
  player.weapon.clipSize = Math.max(0, int(clipCtx.clipSize));
  player.weapon.ammo = player.weapon.clipSize;
  player.weaponResetLatch = 0;
  player.weapon.reloadActive = false;
  player.weapon.reloadTimer = 0.0;
  player.weapon.reloadTimerMax = 0.0;
  player.weapon.shotCooldown = 0.0;
  player.auxTimer = 2.0;

  if (state !== null) {
    state.sfxQueue.push(weapon.reloadSound);
  }
}

export function mostUsedWeaponIdForPlayer(state: GameplayState, opts: { playerIndex: number; fallbackWeaponId: WeaponId }): WeaponId {
  // Return a weapon id for the player's most-used weapon.

  const playerIndex = opts.playerIndex;
  const fallbackWeaponId = opts.fallbackWeaponId;
  const idx = int(playerIndex);
  if (idx >= 0 && idx < state.weaponShotsFired.length) {
    const counts = state.weaponShotsFired[idx];
    if (counts.length > 0) {
      const start = counts.length > 1 ? 1 : 0;
      const best = Array.from({ length: Math.max(0, counts.length - start) }, (_, i) => start + i).reduce((best, candidate) => int(counts[candidate]) > int(counts[best]) ? candidate : best);
      if (int(counts[best]) > 0) {
        return best;
      }
    }
  }
  return fallbackWeaponId;
}

export function playerSwapAltWeapon(player: PlayerState): boolean {
  // Swap primary and alternate weapon runtime blocks (Alternate Weapon perk).

  if (player.altWeapon === null) {
    return false;
  }
  [player.weapon, player.altWeapon] = [player.altWeapon, player.weapon];
  return true;
}

export function playerStartReload(player: PlayerState, state: GameplayState): void {
  // Start or refresh a reload timer (`player_start_reload` @ 0x00413430).

  if (player.weapon.reloadActive && (perkActive(player, PerkId.AMMUNITION_WITHIN) || perkActive(player, PerkId.REGRESSION_BULLETS))) {
    return;
  }

  const weapon = weaponEntry(player.weapon.weaponId);
  let reloadTime = weapon.reloadTime;

  if (!player.weapon.reloadActive) {
    player.weapon.reloadActive = true;
  }

  if (perkActive(player, PerkId.FASTLOADER)) {
    reloadTime *= 0.7;
  }
  if (state.bonuses.weaponPowerUp > 0.0) {
    reloadTime *= 0.6;
  }

  player.weapon.reloadTimer = Math.max(0.0, reloadTime);
  player.weapon.reloadTimerMax = player.weapon.reloadTimer;
}

const _WEAPON_ASSIGN_CLIP_MODIFIERS: readonly WeaponAssignClipModifier[] = [
  weaponAssignClipAmmoManiac,
  weaponAssignClipMyFavouriteWeapon,
];
