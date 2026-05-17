// Port of crimson/sim/presentation_step.py

import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { freezeBonusActive } from '@crimson/bonuses/freeze.ts';
import type { FxQueue } from '@crimson/effects.ts';
import { queueProjectileLargeStreakDecal } from '@crimson/features/presentation/index.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import type { ProjectileHit } from '@crimson/projectiles/types.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { WEAPON_BY_ID, WeaponId, weaponEntryForProjectileTypeId } from '@crimson/weapons.ts';
import type { BonusPickupEvent, GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { BEAM_TYPES } from '@crimson/sim/world-defs.ts';

export interface PresentationAudioSink {
  triggerGameTune(): string | null;
  playSfx(sfx: SfxId): void;
}

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

export class PresentationStepCommands {
  triggerGameTune: boolean;
  sfx: SfxId[];

  constructor(opts: {
    triggerGameTune?: boolean;
    sfx?: SfxId[];
  } = {}) {
    this.triggerGameTune = opts.triggerGameTune ?? false;
    this.sfx = opts.sfx ?? [];
  }
}

export class ProjectileDecalPostCtx {
  readonly hit: ProjectileHit;
  readonly baseAngle: number;
  readonly typeId: number;
  readonly freezeActive: boolean;
  readonly freezeShardSpawn: ((arg0: Vec2, arg1: number) => void) | null;

  constructor(opts: {
    hit: ProjectileHit;
    baseAngle: number;
    typeId: number;
    freezeActive: boolean;
    freezeShardSpawn?: ((arg0: Vec2, arg1: number) => void) | null;
  }) {
    this.hit = opts.hit;
    this.baseAngle = opts.baseAngle;
    this.typeId = opts.typeId;
    this.freezeActive = opts.freezeActive;
    this.freezeShardSpawn = opts.freezeShardSpawn ?? null;
  }
}

export function planPlayerAudioSfx(player: PlayerState, opts: { prevShotSeq: number; prevReloadActive: boolean; prevReloadTimer: number }): SfxId[] {
  const prevShotSeq = opts.prevShotSeq;
  const prevReloadActive = opts.prevReloadActive;
  const prevReloadTimer = opts.prevReloadTimer;
  const sfx: SfxId[] = [];

  const weapon = mapGetOrThrow(WEAPON_BY_ID, player.weapon.weaponId);

  if (int(player.shotSeq) > int(prevShotSeq)) {
    if (player.fireBulletsTimer > 0.0) {
      const fireBullets = mapGetOrThrow(WEAPON_BY_ID, WeaponId.FIRE_BULLETS);
      const plasmaMinigun = mapGetOrThrow(WEAPON_BY_ID, WeaponId.PLASMA_MINIGUN);
      sfx.push(fireBullets.fireSound);
      sfx.push(plasmaMinigun.fireSound);
    } else {
      sfx.push(weapon.fireSound);
    }
  }

  const reloadActive = player.weapon.reloadActive;
  const reloadTimer = player.weapon.reloadTimer;
  const reloadStarted = (!prevReloadActive && reloadActive) || (reloadTimer > prevReloadTimer + 1e-6);
  if (reloadStarted) {
    sfx.push(weapon.reloadSound);
  }

  return sfx;
}

function hitSfxForType(typeId: number, opts: { beamTypes: ReadonlySet<number>; rng: CrandLike }): SfxId {
  const beamTypes = opts.beamTypes;
  const rng = opts.rng;
  const _ = beamTypes;
  const ammoClass = weaponEntryForProjectileTypeId(typeId).ammoClass;
  if (ammoClass === 4) {
    return SfxId.SHOCK_HIT_01;
  }
  return _BULLET_HIT_SFX[rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_HIT_SFX }) % _BULLET_HIT_SFX.length];
}

export function planHitSfx(hits: ProjectileHit[], opts: { gameMode: GameMode; demoModeActive: boolean; gameTuneStarted: boolean; rng: CrandLike; beamTypes?: ReadonlySet<number> }): [boolean, SfxId[]] {
  const gameMode = opts.gameMode;
  const demoModeActive = opts.demoModeActive;
  const gameTuneStarted = opts.gameTuneStarted;
  const rng = opts.rng;
  const beamTypes = opts.beamTypes ?? BEAM_TYPES;
  if (hits.length === 0) {
    return [false, []];
  }

  let triggerGameTune = false;
  let localGameTuneStarted = gameTuneStarted;
  const end = Math.min(hits.length, _MAX_HIT_SFX_PER_FRAME);
  const sfx: SfxId[] = [];
  for (let idx = 0; idx < end; idx++) {
    if (!demoModeActive && gameMode !== GameMode.RUSH && !localGameTuneStarted) {
      // Mirrors `projectile_update`: first eligible hit calls
      // `sfx_play_exclusive(music_track_extra_0)` and skips the panned
      // bullet/shock hit sound for that same hit. Native
      // `sfx_play_exclusive` also performs one RNG draw to pick the
      // playlist entry, so consume one draw here for stream parity.
      triggerGameTune = true;
      localGameTuneStarted = true;
      const _ = rng.rand({ caller: RngCallerStatic.SFX_PLAY_EXCLUSIVE_PLAYLIST_PICK });
      continue;
    }
    const typeId = int(hits[idx].typeId);
    sfx.push(hitSfxForType(typeId, { beamTypes: beamTypes, rng: rng }));
  }
  return [triggerGameTune, sfx];
}

export function queueProjectileDecals(opts: { state: GameplayState; players: readonly PlayerState[]; fxQueue: FxQueue; hits: ProjectileHit[]; rng: CrandLike; detailPreset: number; violenceDisabled: number }): void {
  const state = opts.state;
  const players = opts.players;
  const fxQueue = opts.fxQueue;
  const hits = opts.hits;
  const rng = opts.rng;
  const detailPreset = opts.detailPreset;
  const violenceDisabled = opts.violenceDisabled;
  for (const hit of hits) {
    const postCtx = queueProjectileDecalsPreHit({ state: state, players: players, fxQueue: fxQueue, hit: hit, rng: rng, detailPreset: detailPreset, violenceDisabled: violenceDisabled });
    queueProjectileDecalsPostHit({
      fxQueue: fxQueue,
      postCtx: postCtx,
      rng: rng,
    });
  }
}

export function queueProjectileDecalsPreHit(opts: { state: GameplayState; players: readonly PlayerState[]; fxQueue: FxQueue; hit: ProjectileHit; rng: CrandLike; detailPreset: number; violenceDisabled: number }): ProjectileDecalPostCtx {
  const state = opts.state;
  const players = opts.players;
  const fxQueue = opts.fxQueue;
  const hit = opts.hit;
  const rng = opts.rng;
  const detailPreset = opts.detailPreset;
  const violenceDisabled = opts.violenceDisabled;
  const freezeActive = freezeBonusActive({ state: state });
  const bloody = players.length > 0 && perkActive(players[0], PerkId.BLOODY_MESS_QUICK_LEARNER);
  let freezeShardSpawn: ((arg0: Vec2, arg1: number) => void) | null = null;
  if (freezeActive) {

    const _spawnFreezeShard = (pos: Vec2, angle: number): void => {
      state.effects.spawnFreezeShard({
        pos: pos,
        angle: angle,
        rng: rng,
        detailPreset: int(detailPreset),
      });
    };

    freezeShardSpawn = _spawnFreezeShard;
  }

  const typeId = hit.typeId;

  const baseAngle = hit.hit.sub(hit.origin).toAngle();

  if (typeId === ProjectileTemplateId.BLADE_GUN) {
    for (let i = 0; i < 8; i++) {
      state.effects.spawnBloodSplatter({
        pos: hit.hit,
        angle: (rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_BLADE_GUN_SPLATTER_ANGLE }) & 0xFF) * 0.024543693,
        age: 0.0,
        rng: rng,
        detailPreset: detailPreset,
        violenceDisabled: violenceDisabled,
      });
    }
  }

  // Native `projectile_update` spawns blood splatter before terrain decals.
  let lo: number;
  let hi: number;
  if (bloody) {
    for (let i = 0; i < 8; i++) {
      const spread = ((rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_BLOODY_MESS_SPREAD }) & 0x1F) - 16.0) * 0.0625;
      state.effects.spawnBloodSplatter({
        pos: hit.hit,
        angle: baseAngle + spread,
        age: 0.0,
        rng: rng,
        detailPreset: detailPreset,
        violenceDisabled: violenceDisabled,
      });
    }
    state.effects.spawnBloodSplatter({
      pos: hit.hit,
      angle: baseAngle + Math.PI,
      age: 0.0,
      rng: rng,
      detailPreset: detailPreset,
      violenceDisabled: violenceDisabled,
    });

    lo = -30;
    hi = 30;
    while (lo > -60) {
      const span = hi - lo;
      for (const [dxCaller, dyCaller] of [
        [RngCallerStatic.PROJECTILE_UPDATE_BLOODY_MESS_DECAL_DX_1, RngCallerStatic.PROJECTILE_UPDATE_BLOODY_MESS_DECAL_DY_1],
        [RngCallerStatic.PROJECTILE_UPDATE_BLOODY_MESS_DECAL_DX_2, RngCallerStatic.PROJECTILE_UPDATE_BLOODY_MESS_DECAL_DY_2],
      ]) {
        const dx = rng.rand({ caller: dxCaller }) % span + lo;
        const dy = rng.rand({ caller: dyCaller }) % span + lo;
        fxQueue.addRandom({
          pos: hit.target.add(new Vec2(dx, dy)),
          rng: rng,
        });
      }
      lo -= 10;
      hi += 10;
    }
  } else if (!freezeActive) {
    for (let i = 0; i < 2; i++) {
      state.effects.spawnBloodSplatter({
        pos: hit.hit,
        angle: baseAngle,
        age: 0.0,
        rng: rng,
        detailPreset: detailPreset,
        violenceDisabled: violenceDisabled,
      });
      if ((rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_DEFAULT_REVERSE_SPLATTER_GATE }) & 7) === 2) {
        state.effects.spawnBloodSplatter({
          pos: hit.hit,
          angle: baseAngle + Math.PI,
          age: 0.0,
          rng: rng,
          detailPreset: detailPreset,
          violenceDisabled: violenceDisabled,
        });
      }
    }
  }

  return new ProjectileDecalPostCtx({ hit: hit, baseAngle: baseAngle, typeId: int(typeId), freezeActive: freezeActive, freezeShardSpawn: freezeShardSpawn });
}

export function queueProjectileDecalsPostHit(opts: { fxQueue: FxQueue; postCtx: ProjectileDecalPostCtx; rng: CrandLike }): void {
  const fxQueue = opts.fxQueue;
  const postCtx = opts.postCtx;
  const rng = opts.rng;
  const hit = postCtx.hit;
  const baseAngle = postCtx.baseAngle;

  // Native consumes one extra `crt_rand()` per creature hit before the
  // post-hit terrain decal burst branch.
  rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_POST_HIT_DECAL_BURN });

  const hookHandled = queueProjectileLargeStreakDecal({ hit: hit, baseAngle: baseAngle, fxQueue: fxQueue, rng: rng, freezeOrigin: postCtx.freezeActive ? hit.hit : null, spawnFreezeShard: postCtx.freezeShardSpawn });

  if (hookHandled || postCtx.freezeActive) {
    return;
  }

  for (let i = 0; i < 3; i++) {
    const spread = (rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_DECAL_SPREAD }) % 20 - 10) * 0.1;
    const angle = baseAngle + spread;
    const direction = Vec2.fromAngle(angle).mul(20.0);
    fxQueue.addRandom({ pos: hit.target, rng: rng });
    fxQueue.addRandom({
      pos: hit.target.add(direction.mul(1.5)),
      rng: rng,
    });
    fxQueue.addRandom({
      pos: hit.target.add(direction.mul(2.0)),
      rng: rng,
    });
    fxQueue.addRandom({
      pos: hit.target.add(direction.mul(2.5)),
      rng: rng,
    });
  }
}

export function planWorldPresentationStep(opts: { state: GameplayState; players: readonly PlayerState[]; fxQueue: FxQueue; hits: ProjectileHit[]; pickups: BonusPickupEvent[]; eventSfx: SfxId[]; prevAudio: readonly [number, boolean, number][]; prevPerkPending: number; gameMode: GameMode; demoModeActive: boolean; perkProgressionEnabled: boolean; rng: CrandLike; detailPreset: number; violenceDisabled: number; gameTuneStarted: boolean; triggerGameTune?: boolean | null; hitSfx?: readonly SfxId[] | null }): PresentationStepCommands {
  const state = opts.state;
  const players = opts.players;
  const fxQueue = opts.fxQueue;
  const hits = opts.hits;
  const pickups = opts.pickups;
  const eventSfx = opts.eventSfx;
  const prevAudio = opts.prevAudio;
  const prevPerkPending = opts.prevPerkPending;
  const gameMode = opts.gameMode;
  const demoModeActive = opts.demoModeActive;
  const perkProgressionEnabled = opts.perkProgressionEnabled;
  const rng = opts.rng;
  const detailPreset = opts.detailPreset;
  const violenceDisabled = opts.violenceDisabled;
  const gameTuneStarted = opts.gameTuneStarted;
  const triggerGameTune = opts.triggerGameTune ?? null;
  const hitSfx = opts.hitSfx ?? null;
  const commands = new PresentationStepCommands();
  if (perkProgressionEnabled && int(state.perkSelection.pendingCount) > int(prevPerkPending)) {
    commands.sfx.push(SfxId.UI_LEVELUP);
  }
  if (triggerGameTune === null && hitSfx === null) {
    if (hits.length > 0) {
      queueProjectileDecals({
        state: state,
        players: players,
        fxQueue: fxQueue,
        hits: hits,
        rng: rng,
        detailPreset: int(detailPreset),
        violenceDisabled: int(violenceDisabled),
      });
      if (freezeBonusActive({ state: state })) {
        if (!demoModeActive && gameMode !== GameMode.RUSH && !gameTuneStarted) {
          commands.triggerGameTune = true;
        }
      } else {
        const [_commandsTriggerGameTune, plannedHitSfx] = planHitSfx(hits, { gameMode: gameMode, demoModeActive: demoModeActive, gameTuneStarted: gameTuneStarted, rng: rng });
        commands.triggerGameTune = _commandsTriggerGameTune;
        commands.sfx.push(...plannedHitSfx);
      }
    }
  } else {
    if (triggerGameTune !== null) {
      commands.triggerGameTune = triggerGameTune;
    }
    if (hitSfx !== null) {
      commands.sfx.push(...hitSfx);
    }
  }
  for (const [idx, player] of players.entries()) {
    if (idx >= prevAudio.length) {
      continue;
    }
    const [prevShotSeq, prevReloadActive, prevReloadTimer] = prevAudio[idx];
    commands.sfx.push(...planPlayerAudioSfx(player, { prevShotSeq: int(prevShotSeq), prevReloadActive: prevReloadActive, prevReloadTimer: prevReloadTimer }));
  }
  if (pickups.length > 0) {
    commands.sfx.push(...pickups.map((_) => SfxId.UI_BONUS));
  }
  commands.sfx.push(...eventSfx.slice(0, 4));
  return commands;
}

export function applyPresentationPlan(opts: { plan: PresentationStepCommands; audioSink: PresentationAudioSink | null; applyAudio?: boolean }): void {
  const plan = opts.plan;
  const audioSink = opts.audioSink;
  const applyAudio = opts.applyAudio ?? true;
  if (!applyAudio || audioSink === null) {
    return;
  }
  if (plan.triggerGameTune) {
    audioSink.triggerGameTune();
  }
  for (const sfx of plan.sfx) {
    audioSink.playSfx(sfx);
  }
}
