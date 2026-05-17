// Port of crimson/audio_router.py

import type { AudioState } from '@grim/audio.ts';
import { playSfx, triggerGameTune } from '@grim/audio.ts';
import type { Crand, CrandLike } from '@grim/rand.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { GameMode } from '@crimson/game-modes.ts';
import type { ProjectileHit } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { WEAPON_BY_ID, WeaponId, weaponEntryForProjectileTypeId } from '@crimson/weapons.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';

const _MAX_HIT_SFX_PER_FRAME = 4;
const _BULLET_HIT_SFX = [
  SfxId.BULLET_HIT_01,
  SfxId.BULLET_HIT_02,
  SfxId.BULLET_HIT_03,
  SfxId.BULLET_HIT_04,
  SfxId.BULLET_HIT_05,
  SfxId.BULLET_HIT_06,
];

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export class AudioRouter {
  audioRng: Crand;
  audio: AudioState | null;
  demoModeActive: boolean;
  sfxEnabled: boolean;
  reflexBoostTimerSource: (() => number) | null;

  constructor(opts: {
    audioRng: Crand;
    audio?: AudioState | null;
    demoModeActive?: boolean;
    sfxEnabled?: boolean;
    reflexBoostTimerSource?: (() => number) | null;
  }) {
    this.audioRng = opts.audioRng;
    this.audio = opts.audio ?? null;
    this.demoModeActive = opts.demoModeActive ?? false;
    this.sfxEnabled = opts.sfxEnabled ?? true;
    this.reflexBoostTimerSource = opts.reflexBoostTimerSource ?? null;
  }

  _reflexBoostTimer(): number {
    const source = this.reflexBoostTimerSource;
    if (source === null) {
      return 0.0;
    }
    return source();
  }

  playSfx(sfx: SfxId): void {
    if (this.audio === null || !this.sfxEnabled) {
      return;
    }
    playSfx(
      this.audio,
      sfx,
      { reflexBoostTimer: this._reflexBoostTimer() },
    );
  }

  triggerGameTune(): string | null {
    if (this.audio === null) {
      return null;
    }
    return triggerGameTune(this.audio, { rng: this.audioRng });
  }

  handlePlayerAudio(player: PlayerState, opts: { prevShotSeq: number; prevReloadActive: boolean; prevReloadTimer: number }): void {
    const prevShotSeq = opts.prevShotSeq;
    const prevReloadActive = opts.prevReloadActive;
    const prevReloadTimer = opts.prevReloadTimer;
    if (this.audio === null) {
      return;
    }
    const weapon = mapGetOrThrow(WEAPON_BY_ID, player.weapon.weaponId);

    if (int(player.shotSeq) > int(prevShotSeq)) {
      if (player.fireBulletsTimer > 0.0) {
        // player_update (crimsonland.exe): when Fire Bullets is active, the regular per-weapon
        // shot sfx is suppressed and replaced by Fire Bullets + Plasma Minigun fire sfx.
        const fireBullets = mapGetOrThrow(WEAPON_BY_ID, WeaponId.FIRE_BULLETS);
        const plasmaMinigun = mapGetOrThrow(WEAPON_BY_ID, WeaponId.PLASMA_MINIGUN);
        this.playSfx(fireBullets.fireSound);
        this.playSfx(plasmaMinigun.fireSound);
      } else {
        this.playSfx(weapon.fireSound);
      }
    }

    const reloadActive = player.weapon.reloadActive;
    const reloadTimer = player.weapon.reloadTimer;
    const reloadStarted = (!prevReloadActive && reloadActive) || (reloadTimer > prevReloadTimer + 1e-6);
    if (reloadStarted) {
      this.playSfx(weapon.reloadSound);
    }
  }

  _hitSfxForType(typeId: number, opts: { beamTypes: ReadonlySet<number>; rng: CrandLike }): SfxId {
    const beamTypes = opts.beamTypes;
    const rng = opts.rng;
    const ammoClass = weaponEntryForProjectileTypeId(typeId).ammoClass;
    if (ammoClass === 4) {
      return SfxId.SHOCK_HIT_01;
    }
    return _BULLET_HIT_SFX[rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_HIT_SFX }) % _BULLET_HIT_SFX.length];
  }

  playHitSfx(hits: ProjectileHit[], opts: { gameMode: GameMode; rng: CrandLike; beamTypes: ReadonlySet<number> }): void {
    const gameMode = opts.gameMode;
    const rng = opts.rng;
    const beamTypes = opts.beamTypes;
    if (this.audio === null || hits.length === 0) {
      return;
    }

    const end = Math.min(hits.length, _MAX_HIT_SFX_PER_FRAME);
    let gameTuneStarted = this.audio.music.gameTuneStarted;
    for (let idx = 0; idx < end; idx++) {
      if (!this.demoModeActive && gameMode !== GameMode.RUSH && !gameTuneStarted) {
        triggerGameTune(this.audio, { rng: rng });
        gameTuneStarted = true;
        continue;
      }
      const typeId = int(hits[idx].typeId);
      this.playSfx(this._hitSfxForType(typeId, { beamTypes: beamTypes, rng: rng }));
    }
  }

  reflexBoostTimer(): number {
    return this._reflexBoostTimer();
  }

  hitSfxForType(typeId: number, opts: { beamTypes: ReadonlySet<number>; rng: CrandLike }): SfxId {
    const beamTypes = opts.beamTypes;
    const rng = opts.rng;
    return this._hitSfxForType(typeId, { beamTypes: beamTypes, rng: rng });
  }
}
