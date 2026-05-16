// Port of crimson/player_damage.py

// Player damage intake helpers.
//
// This is a minimal, rewrite-focused port of `player_take_damage` (0x00425e50).
// See: `docs/crimsonland-exe/player-damage.md`.

import { SfxId } from '@grim/sfx-map.ts';
import { f32 } from '@crimson/math-parity.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';

const PLAYER_PAIN_SFX: readonly SfxId[] = [
  SfxId.TROOPER_INPAIN_01,
  SfxId.TROOPER_INPAIN_02,
  SfxId.TROOPER_INPAIN_03,
];
const PLAYER_DEATH_SFX: readonly SfxId[] = [SfxId.TROOPER_DIE_01, SfxId.TROOPER_DIE_02];
const _THICK_SKINNED_DAMAGE_SCALE_F32 = 0.6660000085830688;

export function playerTakeDamage(state: GameplayState, player: PlayerState, damage: number, opts: { dt?: number | null; players?: readonly PlayerState[] | null; onLethal?: (() => void) | null } = {}): number {
  // Apply damage to a player, returning the actual damage applied.

  const dt = opts.dt ?? null;
  const players = opts.players ?? null;
  const onLethal = opts.onLethal ?? null;
  const rawDamage = damage;
  if (rawDamage <= 0.0) {
    return 0.0;
  }
  if (state.debugGodMode) {
    return 0.0;
  }

  if (perkActive(player, PerkId.DEATH_CLOCK)) {
    return 0.0;
  }

  let damageScaled = rawDamage;
  if (perkActive(player, PerkId.TOUGH_RELOADER) && player.weapon.reloadActive) {
    damageScaled *= 0.5;
  }
  const spreadHeatDamage = damageScaled;

  state.survivalRewardDamageSeen = true;

  if (player.shieldTimer > 0.0) {
    return 0.0;
  }

  let wasAliveSource = player;
  // Native bug: the pre-hit alive flag is read from player 1 health even when
  // damaging player 2; preserve this under `--preserve-bugs`.
  if (state.preserveBugs && players !== null && players.length > 0) {
    wasAliveSource = players[0];
  }
  const wasAlive = wasAliveSource.health > 0.0;

  if (perkActive(player, PerkId.THICK_SKINNED)) {
    // Native uses an f32 constant (`~0.666`) here, not exact 2/3.
    damageScaled = f32(damageScaled * _THICK_SKINNED_DAMAGE_SCALE_F32);
  }

  let dodged = false;
  if (perkActive(player, PerkId.NINJA)) {
    dodged = (state.rng.rand({ caller: RngCallerStatic.PLAYER_TAKE_DAMAGE_NINJA }) % 3) === 0;
  } else if (perkActive(player, PerkId.DODGER)) {
    dodged = (state.rng.rand({ caller: RngCallerStatic.PLAYER_TAKE_DAMAGE_DODGER }) % 5) === 0;
  }

  const healthBefore = player.health;
  if (!dodged) {
    if (perkActive(player, PerkId.HIGHLANDER)) {
      if ((state.rng.rand({ caller: RngCallerStatic.PLAYER_TAKE_DAMAGE_HIGHLANDER }) % 10) === 0) {
        player.health = 0.0;
      }
    } else {
      player.health = f32(player.health - damageScaled);
    }
  }

  // Native routes exact-zero Highlander kills through the pain branch; default
  // rewrite mode treats `health == 0` as lethal here.
  let lethalHit = player.health < 0.0;
  if (!state.preserveBugs && player.health === 0.0) {
    lethalHit = true;
  }
  if (!dodged && lethalHit && dt !== null && dt > 0.0) {
    player.deathTimer -= dt * 28.0;
  }

  // Native emits pain/death VO before heading jitter + low-health timer RNG work.
  if (!lethalHit) {
    state.sfxQueue.push(PLAYER_PAIN_SFX[state.rng.rand({ caller: RngCallerStatic.PLAYER_TAKE_DAMAGE_PAIN_SFX }) % PLAYER_PAIN_SFX.length]);
    if (!wasAlive) {
      return Math.max(0.0, healthBefore - player.health);
    }
  } else {
    if (!wasAlive) {
      return Math.max(0.0, healthBefore - player.health);
    }
    if (!perkActive(player, PerkId.FINAL_REVENGE)) {
      state.sfxQueue.push(PLAYER_DEATH_SFX[state.rng.rand({ caller: RngCallerStatic.PLAYER_TAKE_DAMAGE_DEATH_SFX }) & 1]);
    } else if (onLethal !== null) {
      onLethal();
      state.playerDeathHookSkipIndices.add(int(player.index));
    }
  }

  if (!dodged) {
    if (!perkActive(player, PerkId.UNSTOPPABLE)) {
      player.heading += ((state.rng.rand({ caller: RngCallerStatic.PLAYER_TAKE_DAMAGE_HEADING }) % 100) - 50) * 0.04;
      // Native uses post-Tough-Reloader damage (before Thick Skinned) for spread heat growth.
      player.spreadHeat = Math.min(0.48, player.spreadHeat + spreadHeatDamage * 0.01);
    }

    if (player.health <= 20.0 && (state.rng.rand({ caller: RngCallerStatic.PLAYER_TAKE_DAMAGE_LOW_HEALTH }) & 7) === 3) {
      player.lowHealthTimer = 0.0;
    }
  }

  return Math.max(0.0, healthBefore - player.health);
}

export function playerTakeProjectileDamage(state: GameplayState, player: PlayerState, damage: number): number {
  // Apply projectile damage to a player (modeled after `projectile_update` player-hit logic).
  //
  // Native `projectile_update` does not call `player_take_damage` for projectile hits: it sets
  // `projectile.life_timer = 0.25` and subtracts a fixed amount (usually 10.0) if shield is down.

  const dmg = damage;
  if (dmg <= 0.0) {
    return 0.0;
  }
  if (state.debugGodMode) {
    return 0.0;
  }
  if (player.shieldTimer > 0.0) {
    return 0.0;
  }

  player.health -= dmg;
  return dmg;
}
