// Port of crimson/sim/world_state.py

import { Vec2 } from '@grim/geom.ts';
import type { SfxId } from '@grim/sfx-map.ts';
import { emitBonusPickupEffects } from '@crimson/bonuses/pickup-fx.ts';
import { bonusUpdate, bonusUpdatePrePickupTimers } from '@crimson/bonuses/update.ts';
import { cameraShakeUpdate } from '@crimson/camera.ts';
import { creatureAnimAdvancePhase } from '@crimson/creatures/anim.ts';
import { creatureApplyDamageWithLethalFollowup } from '@crimson/creatures/damage.ts';
import { CreatureDeath, CreaturePool, CreatureUpdateOptions } from '@crimson/creatures/runtime.ts';
import { CreatureAiMode, CreatureTypeId, SpawnEnv } from '@crimson/creatures/spawn.ts';
import type { FxQueue, FxQueueRotated } from '@crimson/effects.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { buildGameplayState, playerUpdate, playerFrameDtAfterRoundtrip, survivalProgressionUpdate, survivalEnforceRewardWeaponGuard } from '@crimson/gameplay.ts';
import type { OwnerRef } from '@crimson/owner-ref.ts';
import { perksUpdateEffects } from '@crimson/perks/runtime/effects.ts';
import { PLAYER_DEATH_HOOKS, WORLD_DT_STEPS } from '@crimson/perks/runtime/manifest.ts';
import { playerTakeProjectileDamage } from '@crimson/player-damage.ts';
import { PrimaryStepCtx, ProjectileUpdateOptions } from '@crimson/projectiles/runtime/projectile-pool.ts';
import { SecondaryStepCtx } from '@crimson/projectiles/runtime/secondary-pool.ts';
import type { ProjectileHit } from '@crimson/projectiles/types.ts';
import { PlayerInput } from './input.ts';
import { normalizeInputFrame } from './input-frame.ts';
import { type ProjectileDecalPostCtx, planHitSfx, queueProjectileDecalsPostHit, queueProjectileDecalsPreHit } from './presentation-step.ts';
import type { BonusPickupEvent, GameplayState, PlayerState } from './state-types.ts';
import { CREATURE_ANIM } from './world-defs.ts';

export class WorldEvents {
  hits: ProjectileHit[];
  deaths: readonly CreatureDeath[];
  pickups: BonusPickupEvent[];
  sfx: SfxId[];
  triggerGameTune: boolean;
  hitSfx: SfxId[];

  constructor(opts: {
    hits: ProjectileHit[];
    deaths: readonly CreatureDeath[];
    pickups: BonusPickupEvent[];
    sfx: SfxId[];
    triggerGameTune?: boolean;
    hitSfx?: SfxId[];
  }) {
    this.hits = opts.hits;
    this.deaths = Array.from(opts.deaths);
    this.pickups = opts.pickups;
    this.sfx = opts.sfx;
    this.triggerGameTune = opts.triggerGameTune ?? false;
    this.hitSfx = opts.hitSfx ?? [];
  }
}

const _WORLD_DT_STEPS = WORLD_DT_STEPS;
const _PLAYER_DEATH_HOOKS = PLAYER_DEATH_HOOKS;

type CreatureDamageApplier = (
  creatureIndex: number,
  damage: number,
  damageType: number,
  knockback: Vec2,
  owner: OwnerRef,
) => void;

export interface WorldStateStepOpts {
  readonly applyWorldDtSteps?: boolean;
  readonly dtPlayerLocal?: number | null;
  readonly deferCameraShakeUpdate?: boolean;
  readonly deferFreezeCorpseFx?: boolean;
  readonly midStepHook?: (() => void) | null;
  readonly inputs: PlayerInput[] | null;
  readonly worldSize: number;
  readonly damageScaleByType: Map<number, number>;
  readonly detailPreset: number;
  readonly violenceDisabled?: number;
  readonly fxQueue: FxQueue;
  readonly fxQueueRotated: FxQueueRotated;
  readonly gameMode: GameMode;
  readonly perkProgressionEnabled: boolean;
  readonly gameTuneStarted?: boolean;
}

export class WorldState {
  spawnEnv: SpawnEnv;
  state: GameplayState;
  players: PlayerState[];
  creatures: CreaturePool;

  constructor(opts: {
    spawnEnv: SpawnEnv;
    state: GameplayState;
    players: PlayerState[];
    creatures: CreaturePool;
  }) {
    this.spawnEnv = opts.spawnEnv;
    this.state = opts.state;
    this.players = opts.players;
    this.creatures = opts.creatures;
  }

  static build(opts: {
    worldSize: number;
    demoModeActive: boolean;
    hardcore: boolean;
    questFailRetryCount: number;
    preserveBugs?: boolean;
  }): WorldState {
    const spawnEnv = new SpawnEnv({
      terrainWidth: Number(opts.worldSize),
      terrainHeight: Number(opts.worldSize),
      demoModeActive: opts.demoModeActive,
      hardcore: opts.hardcore,
      questFailRetryCount: int(opts.questFailRetryCount),
    });
    const state = buildGameplayState();
    state.demoModeActive = opts.demoModeActive;
    state.hardcore = opts.hardcore;
    state.preserveBugs = opts.preserveBugs ?? false;
    const players: PlayerState[] = [];
    const creatures = new CreaturePool({
      env: spawnEnv,
      effects: state.effects,
    });
    return new WorldState({
      spawnEnv,
      state,
      players,
      creatures,
    });
  }

  step(dt: number, opts: WorldStateStepOpts): WorldEvents {
    const {
      applyWorldDtSteps = true,
      dtPlayerLocal = null,
      deferCameraShakeUpdate: deferCameraShake = false,
      deferFreezeCorpseFx = false,
      midStepHook = null,
      worldSize,
      damageScaleByType,
      detailPreset,
      violenceDisabled = 0,
      fxQueue,
      fxQueueRotated,
      gameMode,
      perkProgressionEnabled,
      gameTuneStarted = false,
    } = opts;

    let inputs = opts.inputs;

    dt = Number(dt);
    fxQueue.violenceDisabled = int(violenceDisabled);
    this.state.playerDeathHookSkipIndices.clear();

    if (applyWorldDtSteps) {
      for (const step of _WORLD_DT_STEPS) {
        dt = Number(step({ dt, players: this.players }));
      }
    }

    const normalizedInputs = normalizeInputFrame(inputs, { playerCount: this.players.length }).asList();

    const prevPositions: [number, number][] = this.players.map(
      (player) => [player.pos.x, player.pos.y] as [number, number],
    );
    const prevHealth: number[] = this.players.map((player) => Number(player.health));

    // Native Freeze pickup shatters corpses that existed at tick start;
    // same-tick kills are not included in that pass.
    const freezeCorpseIndicesAtTickStart = new Set<number>();
    const creatureEntries = this.creatures.entries;
    for (let idx = 0; idx < creatureEntries.length; idx++) {
      const creature = creatureEntries[idx];
      if (creature.active && Number(creature.hp) <= 0.0) {
        freezeCorpseIndicesAtTickStart.add(int(idx));
      }
    }

    perksUpdateEffects(this.state, this.players, dt, { creatures: creatureEntries, fxQueue });

    // `effects_update` runs early in the native frame loop, before creature/projectile updates.
    this.state.effects.update(dt, { fxQueue });

    const _applyProjectileDamageToPlayer = (playerIndex: number, damage: number): void => {
      const idx = int(playerIndex);
      if (!(idx >= 0 && idx < this.players.length)) return;
      playerTakeProjectileDamage(this.state, this.players[idx], Number(damage));
    };

    const creatureResult = this.creatures.update(dt, { options: new CreatureUpdateOptions({
      state: this.state,
      players: this.players,
      rng: this.state.rng,
      env: this.spawnEnv,
      worldWidth: Number(worldSize),
      worldHeight: Number(worldSize),
      fxQueue,
      fxQueueRotated,
      detailPreset: int(detailPreset),
      violenceDisabled: int(violenceDisabled),
    }) });

    const deaths: CreatureDeath[] = [...creatureResult.deaths];
    const sfx: SfxId[] = [...creatureResult.sfx];
    let triggerGameTune = false;
    const hitSfx: SfxId[] = [];
    let hitAudioGameTuneStarted = gameTuneStarted;

    const _applyProjectileDamageToCreature: CreatureDamageApplier = (
      creatureIndex: number,
      damage: number,
      damageType: number,
      impulse: Vec2,
      owner: OwnerRef,
    ): void => {
      const idx = int(creatureIndex);
      if (!(idx >= 0 && idx < creatureEntries.length)) return;
      const creature = creatureEntries[idx];
      if (!creature.active) return;

      creatureApplyDamageWithLethalFollowup(
        creature,
        {
          damageAmount: Number(damage),
          damageType: int(damageType),
          impulse,
          owner,
          dt: Number(dt),
          players: this.players,
          rng: this.state.rng,
          preserveBugs: Boolean(this.state.preserveBugs),
          effects: this.state.effects,
          detailPreset: int(detailPreset),
          onLethal: (deathSfx: SfxId[]) => {
            this._recordCreatureDeath({
              creatureIndex: idx,
              dt: Number(dt),
              detailPreset: int(detailPreset),
              worldSize: Number(worldSize),
              fxQueue,
              deaths,
              sfx,
              deathSfx,
            });
          },
        },
      );
    };

    const prevCreatureDamageAppliers = this._setCreatureDamageAppliers(_applyProjectileDamageToCreature);

    const _onSecondaryDetonationKill = (creatureIndex: number): void => {
      const idx = int(creatureIndex);
      if (!(idx >= 0 && idx < creatureEntries.length) || Number(creatureEntries[idx].hp) > 0.0) {
        return;
      }
      // Native detonation follow-up re-enters creature death handling but does
      // not run a second death-SFX random pick (`creature_apply_damage` only
      // does that on the original killing hit).
      this._recordCreatureDeath({
        creatureIndex: idx,
        dt: Number(dt),
        detailPreset: int(detailPreset),
        worldSize: Number(worldSize),
        fxQueue,
        deaths,
        sfx,
      });
    };

    const _onProjectileHitPre = (hit: ProjectileHit): ProjectileDecalPostCtx => {
      return this._prepareProjectileHitPresentation(hit, {
        fxQueue,
        detailPreset: int(detailPreset),
        violenceDisabled: int(violenceDisabled),
      });
    };

    const _onProjectileHitPost = (_hit: ProjectileHit, postCtx: object): void => {
      this._finalizeProjectileHitPresentation({
        postCtx: postCtx as ProjectileDecalPostCtx,
        fxQueue,
      });
      const [hitTrigger, keys] = planHitSfx(
        [_hit],
        {
          gameMode,
          demoModeActive: this.state.demoModeActive,
          gameTuneStarted: hitAudioGameTuneStarted,
          rng: this.state.rng,
        },
      );
      if (hitTrigger) {
        triggerGameTune = true;
        hitAudioGameTuneStarted = true;
      }
      if (keys.length > 0) {
        hitSfx.push(...keys);
      }
    };

    const hits: ProjectileHit[] = this.state.projectiles.step(new PrimaryStepCtx({
      dt: Number(dt),
      creatures: creatureEntries,
      options: new ProjectileUpdateOptions({
        worldSize: Number(worldSize),
        damageScaleByType,
        rng: this.state.rng,
        runtimeState: this.state,
        players: this.players,
        applyPlayerDamage: _applyProjectileDamageToPlayer,
        detailPreset: int(detailPreset),
        onHit: _onProjectileHitPre,
        onHitPost: _onProjectileHitPost,
      }),
    }));

    this.state.secondaryProjectiles.step(new SecondaryStepCtx({
      dt: Number(dt),
      creatures: creatureEntries,
      runtimeState: this.state,
      fxQueue,
      detailPreset: int(detailPreset),
      onDetonationKill: _onSecondaryDetonationKill,
    }));

    this._runPostDamagePlayerDeathHooks({
      prevHealth,
      dt: Number(dt),
      worldSize: Number(worldSize),
      detailPreset: int(detailPreset),
      fxQueue,
      deaths,
    });

    const _killCreatureNoCorpse = (creatureIndex: number, owner: OwnerRef): void => {
      const idx = int(creatureIndex);
      if (!(idx >= 0 && idx < creatureEntries.length)) return;
      const creature = creatureEntries[idx];
      if (!creature.active) return;
      if (Number(creature.hp) <= 0.0) return;
      creature.lastHitOwner = owner;
      this._recordCreatureDeath({
        creatureIndex: idx,
        dt: Number(dt),
        detailPreset: int(detailPreset),
        worldSize: Number(worldSize),
        fxQueue,
        deaths,
        sfx,
        keepCorpse: false,
      });
    };

    this.state.particles.update(dt, {
      creatures: creatureEntries,
      killCreature: _killCreatureNoCorpse,
      fxQueue,
      spriteEffects: this.state.spriteEffects,
    });

    this.state.spriteEffects.update(dt);

    const reloadActiveAny = normalizedInputs.some(
      (entry) => Boolean(entry.reloadDown) || Boolean(entry.reloadPressed),
    );
    let playerDt = Number(dt);
    if (dtPlayerLocal !== null) {
      playerDt = Number(dtPlayerLocal);
    }

    for (let idx = 0; idx < this.players.length; idx++) {
      const player = this.players[idx];
      const inputState = idx < normalizedInputs.length ? normalizedInputs[idx] : new PlayerInput();

      playerUpdate(player, inputState, playerDt, this.state, {
        detailPreset: int(detailPreset),
        worldSize: Number(worldSize),
        players: this.players,
        creatures: creatureEntries,
        spawnSlots: this.creatures.spawnSlots,
        onPlayerLethal: (deadPlayer: PlayerState) => {
          this._runPlayerDeathHooks({
            player: deadPlayer,
            dt: Number(playerDt),
            worldSize: Number(worldSize),
            detailPreset: int(detailPreset),
            fxQueue,
            deaths,
          });
        },
        reloadActiveAny: Boolean(reloadActiveAny),
      });

      if (dtPlayerLocal === null) {
        playerDt = playerFrameDtAfterRoundtrip({
          dt: playerDt,
          timeScaleActive: Boolean(this.state.timeScaleActive),
          reflexBoostTimer: Number(this.state.bonuses.reflexBoost),
        });
      }
    }

    dt = Number(playerDt);

    if (dt > 0.0) {
      this._advanceCreatureAnim(dt);
      this._advancePlayerAnim(dt, prevPositions);
    }

    if (midStepHook !== null) {
      midStepHook();
    }

    if (!deferCameraShake) {
      cameraShakeUpdate(this.state, dt);
    }

    // Native level-up/perk-pending check runs before `bonus_update` in
    // gameplay_update_and_render. Keep the same ordering so XP awarded from
    // bonus-side kill paths (e.g. freeze cleanup) levels on the next tick.

    if (perkProgressionEnabled) {
      survivalProgressionUpdate(this.state, this.players);
    }

    // Native latches `time_scale_active` late (post mode update, pre bonus decrement); next-frame dt uses it.
    this.state.timeScaleActive = Number(this.state.bonuses.reflexBoost) > 0.0;

    bonusUpdatePrePickupTimers(this.state, dt);

    const pickups = bonusUpdate(
      this.state,
      this.players,
      dt,
      {
        creatures: creatureEntries,
        updateHud: true,
        detailPreset: int(detailPreset),
        deferFreezeCorpseFx: Boolean(deferFreezeCorpseFx),
        freezeCorpseIndices: freezeCorpseIndicesAtTickStart,
      },
    );

    if (pickups.length > 0) {
      emitBonusPickupEffects({ state: this.state, pickups, detailPreset: int(detailPreset) });
    }

    survivalEnforceRewardWeaponGuard(this.state, this.players);

    if (this.state.sfxQueue.length > 0) {
      sfx.push(...this.state.sfxQueue);
      this.state.sfxQueue.length = 0;
    }

    // Player-damage VO RNG work lives inside `player_take_damage` for native
    // ordering parity (VO draw before heading-jitter draw).

    this.state.playerDeathHookSkipIndices.clear();
    this._restoreCreatureDamageAppliers(prevCreatureDamageAppliers);

    return new WorldEvents({
      hits,
      deaths,
      pickups,
      sfx,
      triggerGameTune: Boolean(triggerGameTune),
      hitSfx,
    });
  }

  private _setCreatureDamageAppliers(
    applier: CreatureDamageApplier | null,
  ): [
    CreatureDamageApplier | null,
    CreatureDamageApplier | null,
    CreatureDamageApplier | null,
    CreatureDamageApplier | null,
  ] {
    const { projectiles, secondaryProjectiles, particles, bonusPool } = this.state;
    const prev: [
      CreatureDamageApplier | null,
      CreatureDamageApplier | null,
      CreatureDamageApplier | null,
      CreatureDamageApplier | null,
    ] = [
      projectiles.creatureDamageApplier,
      secondaryProjectiles.creatureDamageApplier,
      particles.creatureDamageApplier,
      bonusPool.creatureDamageApplier,
    ];
    projectiles.creatureDamageApplier = applier;
    secondaryProjectiles.creatureDamageApplier = applier;
    particles.creatureDamageApplier = applier;
    bonusPool.creatureDamageApplier = applier;
    return prev;
  }

  private _restoreCreatureDamageAppliers(
    previous: [
      CreatureDamageApplier | null,
      CreatureDamageApplier | null,
      CreatureDamageApplier | null,
      CreatureDamageApplier | null,
    ],
  ): void {
    const { projectiles, secondaryProjectiles, particles, bonusPool } = this.state;
    [
      projectiles.creatureDamageApplier,
      secondaryProjectiles.creatureDamageApplier,
      particles.creatureDamageApplier,
      bonusPool.creatureDamageApplier,
    ] = previous;
  }

  private _runPlayerDeathHooks(opts: {
    player: PlayerState;
    dt: number;
    worldSize: number;
    detailPreset: number;
    fxQueue: FxQueue;
    deaths: CreatureDeath[];
  }): void {
    for (const hook of _PLAYER_DEATH_HOOKS) {
      hook({
        state: this.state,
        creatures: this.creatures,
        players: this.players,
        player: opts.player,
        dt: Number(opts.dt),
        worldSize: Number(opts.worldSize),
        detailPreset: int(opts.detailPreset),
        fxQueue: opts.fxQueue,
        deaths: opts.deaths,
      });
    }
  }

  private _runPostDamagePlayerDeathHooks(opts: {
    prevHealth: number[];
    dt: number;
    worldSize: number;
    detailPreset: number;
    fxQueue: FxQueue;
    deaths: CreatureDeath[];
  }): void {
    for (let idx = 0; idx < this.players.length; idx++) {
      const player = this.players[idx];
      if (idx >= opts.prevHealth.length) continue;
      if (Number(opts.prevHealth[idx]) < 0.0) continue;
      if (Number(player.health) >= 0.0) continue;

      const playerIdx = int(player.index);
      if (this.state.playerDeathHookSkipIndices.has(playerIdx)) {
        this.state.playerDeathHookSkipIndices.delete(playerIdx);
        continue;
      }

      this._runPlayerDeathHooks({
        player,
        dt: Number(opts.dt),
        worldSize: Number(opts.worldSize),
        detailPreset: int(opts.detailPreset),
        fxQueue: opts.fxQueue,
        deaths: opts.deaths,
      });
    }
  }

  private _recordCreatureDeath(opts: {
    creatureIndex: number;
    dt: number;
    detailPreset: number;
    worldSize: number;
    fxQueue: FxQueue;
    deaths: CreatureDeath[];
    sfx: SfxId[];
    keepCorpse?: boolean;
    deathSfx?: SfxId[];
  }): void {
    const death = this.creatures.handleDeath(int(opts.creatureIndex), {
      state: this.state,
      players: this.players,
      rng: this.state.rng,
      dt: Number(opts.dt),
      detailPreset: int(opts.detailPreset),
      worldWidth: Number(opts.worldSize),
      worldHeight: Number(opts.worldSize),
      fxQueue: opts.fxQueue,
      keepCorpse: opts.keepCorpse ?? true,
    });
    opts.deaths.push(death);
    if (opts.deathSfx !== undefined && opts.deathSfx.length > 0) {
      opts.sfx.push(...opts.deathSfx);
    }
  }

  private _prepareProjectileHitPresentation(
    hit: ProjectileHit,
    opts: {
      fxQueue: FxQueue;
      detailPreset: number;
      violenceDisabled: number;
    },
  ): ProjectileDecalPostCtx {
    return queueProjectileDecalsPreHit({
      state: this.state,
      players: this.players,
      fxQueue: opts.fxQueue,
      hit,
      rng: this.state.rng,
      detailPreset: int(opts.detailPreset),
      violenceDisabled: int(opts.violenceDisabled),
    });
  }

  private _finalizeProjectileHitPresentation(opts: {
    postCtx: ProjectileDecalPostCtx;
    fxQueue: FxQueue;
  }): void {
    queueProjectileDecalsPostHit({
      fxQueue: opts.fxQueue,
      postCtx: opts.postCtx,
      rng: this.state.rng,
    });
  }

  private _advanceCreatureAnim(dt: number): void {
    if (Number(this.state.bonuses.freeze) > 0.0) return;

    const entries = this.creatures.entries;
    for (let i = 0; i < entries.length; i++) {
      const creature = entries[i];
      if (!(creature.active && creature.hp > 0.0)) continue;

      const typeId = creature.typeId;
      const info = CREATURE_ANIM.get(typeId)!;

      const [newPhase] = creatureAnimAdvancePhase(
        creature.animPhase,
        {
          animRate: info.animRate,
          moveSpeed: Number(creature.moveSpeed),
          dt,
          size: Number(creature.size),
          localScale: Number(creature.moveScale),
          flags: creature.flags,
          aiMode: int(creature.aiMode),
        },
      );
      creature.animPhase = newPhase;
    }
  }

  private _advancePlayerAnim(dt: number, prevPositions: [number, number][]): void {
    const info = CREATURE_ANIM.get(CreatureTypeId.TROOPER);
    if (info === undefined) return;

    for (let idx = 0; idx < this.players.length; idx++) {
      const player = this.players[idx];
      if (idx >= prevPositions.length) continue;

      const [prevX, prevY] = prevPositions[idx];
      const speed = new Vec2(player.pos.x - prevX, player.pos.y - prevY).length();
      const moveSpeed = dt > 0.0 ? speed / dt / 120.0 : 0.0;

      const [newPhase] = creatureAnimAdvancePhase(
        player.movePhase,
        {
          animRate: info.animRate,
          moveSpeed,
          dt,
          size: Number(player.size),
          localScale: 1.0,
          flags: 0,
          aiMode: CreatureAiMode.ORBIT_PLAYER,
        },
      );
      player.movePhase = newPhase;
    }
  }
}
