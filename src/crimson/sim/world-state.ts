// Port of crimson/sim/world_state.py

import { Vec2 } from '@grim/geom.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { emitBonusPickupEffects } from '@crimson/bonuses/pickup-fx.ts';
import { bonusUpdate, bonusUpdatePrePickupTimers } from '@crimson/bonuses/update.ts';
import { cameraShakeUpdate } from '@crimson/camera.ts';
import { creatureAnimAdvancePhase } from '@crimson/creatures/anim.ts';
import { creatureApplyDamageWithLethalFollowup } from '@crimson/creatures/damage.ts';
import type { CreatureDeath } from '@crimson/creatures/runtime.ts';
import { CreaturePool, CreatureUpdateOptions } from '@crimson/creatures/runtime.ts';
import { CreatureAiMode, CreatureTypeId, SpawnEnv } from '@crimson/creatures/spawn.ts';
import type { FxQueue, FxQueueRotated } from '@crimson/effects.ts';
import type { GameMode } from '@crimson/game-modes.ts';
import { buildGameplayState, playerFrameDtAfterRoundtrip, playerUpdate, survivalEnforceRewardWeaponGuard, survivalProgressionUpdate } from '@crimson/gameplay.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { perksUpdateEffects } from '@crimson/perks/runtime/effects.ts';
import { PLAYER_DEATH_HOOKS, WORLD_DT_STEPS } from '@crimson/perks/runtime/manifest.ts';
import { playerTakeProjectileDamage } from '@crimson/player-damage.ts';
import { PrimaryStepCtx, ProjectileUpdateOptions, SecondaryStepCtx } from '@crimson/projectiles/runtime/index.ts';
import { ProjectileHit } from '@crimson/projectiles/types.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import { normalizeInputFrame } from '@crimson/sim/input-frame.ts';
import { ProjectileDecalPostCtx, planHitSfx, queueProjectileDecalsPostHit, queueProjectileDecalsPreHit } from '@crimson/sim/presentation-step.ts';
import type { BonusPickupEvent, GameplayState } from '@crimson/sim/state-types.ts';
import { PlayerState } from '@crimson/sim/state-types.ts';
import { CREATURE_ANIM } from '@crimson/sim/world-defs.ts';

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

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
    this.deaths = opts.deaths;
    this.pickups = opts.pickups;
    this.sfx = opts.sfx;
    this.triggerGameTune = opts.triggerGameTune ?? false;
    this.hitSfx = opts.hitSfx ?? [];
  }
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

  static build(opts: { worldSize: number; demoModeActive: boolean; hardcore: boolean; questFailRetryCount: number; preserveBugs?: boolean }): WorldState {
    const worldSize = opts.worldSize;
    const demoModeActive = opts.demoModeActive;
    const hardcore = opts.hardcore;
    const questFailRetryCount = opts.questFailRetryCount;
    const preserveBugs = opts.preserveBugs ?? false;
    const spawnEnv = new SpawnEnv({ terrainWidth: worldSize, terrainHeight: worldSize, demoModeActive: demoModeActive, hardcore: hardcore, questFailRetryCount: int(questFailRetryCount) });
    const state = buildGameplayState();
    state.demoModeActive = demoModeActive;
    state.hardcore = hardcore;
    state.preserveBugs = preserveBugs;
    const players: PlayerState[] = [];
    const creatures = new CreaturePool({ env: spawnEnv, effects: state.effects });
    return new WorldState({ spawnEnv: spawnEnv, state: state, players: players, creatures: creatures });
  }

  step(dt: number, opts: { applyWorldDtSteps?: boolean; dtPlayerLocal?: number | null; deferCameraShakeUpdate?: boolean; deferFreezeCorpseFx?: boolean; midStepHook?: (() => void) | null; inputs: PlayerInput[] | null; worldSize: number; damageScaleByType: Map<number, number>; detailPreset: number; violenceDisabled?: number; fxQueue: FxQueue; fxQueueRotated: FxQueueRotated; gameMode: GameMode; perkProgressionEnabled: boolean; gameTuneStarted?: boolean }): WorldEvents {
    const applyWorldDtSteps = opts.applyWorldDtSteps ?? true;
    const dtPlayerLocal = opts.dtPlayerLocal ?? null;
    const deferCameraShakeUpdate = opts.deferCameraShakeUpdate ?? false;
    const deferFreezeCorpseFx = opts.deferFreezeCorpseFx ?? false;
    const midStepHook = opts.midStepHook ?? null;
    let inputs = opts.inputs;
    const worldSize = opts.worldSize;
    const damageScaleByType = opts.damageScaleByType;
    const detailPreset = opts.detailPreset;
    const violenceDisabled = opts.violenceDisabled ?? 0;
    const fxQueue = opts.fxQueue;
    const fxQueueRotated = opts.fxQueueRotated;
    const gameMode = opts.gameMode;
    const perkProgressionEnabled = opts.perkProgressionEnabled;
    const gameTuneStarted = opts.gameTuneStarted ?? false;
    fxQueue.violenceDisabled = int(violenceDisabled);
    ((target: unknown) => {
      if (target !== null && typeof target === 'object' && typeof (target as { clear?: unknown }).clear === 'function') {
        (target as { clear: () => void }).clear();
      } else if (target !== null && typeof target === 'object' && 'length' in target) {
        (target as { length: number }).length = 0;
      }
    })(this.state.playerDeathHookSkipIndices);
    if (applyWorldDtSteps) {
      for (const step of WORLD_DT_STEPS) {
        dt = step({ dt: dt, players: this.players });
      }
    }
    inputs = normalizeInputFrame(inputs, { playerCount: this.players.length }).asList();
    const prevPositions = this.players.map((player) => [player.pos.x, player.pos.y] as [any, any]);
    const prevHealth = this.players.map((player) => player.health);
    // Native Freeze pickup shatters corpses that existed at tick start;
    // same-tick kills are not included in that pass.
    const freezeCorpseIndicesAtTickStart = new Set(Array.from(this.creatures.entries, (item, index) => [index, item] as const).filter(([idx, creature]) => creature.active && creature.hp <= 0.0).map(([idx, creature]) => int(idx)));
    perksUpdateEffects(this.state, this.players, dt, { creatures: this.creatures.entries, fxQueue: fxQueue });
    // `effects_update` runs early in the native frame loop, before creature/projectile updates.
    this.state.effects.update(dt, { fxQueue: fxQueue });

    const _applyProjectileDamageToPlayer = (playerIndex: number, damage: number): void => {
      const idx = int(playerIndex);
      if (!(idx >= 0 && idx < this.players.length)) {
        return;
      }
      playerTakeProjectileDamage(this.state, this.players[idx], damage);
    };

    const creatureResult = this.creatures.update(dt, { options: new CreatureUpdateOptions({ state: this.state, players: this.players, rng: this.state.rng, env: this.spawnEnv, worldWidth: worldSize, worldHeight: worldSize, fxQueue: fxQueue, fxQueueRotated: fxQueueRotated, detailPreset: int(detailPreset), violenceDisabled: int(violenceDisabled) }) });
    const deaths = Array.from(creatureResult.deaths);
    const sfx = Array.from(creatureResult.sfx);
    let triggerGameTune = false;
    const hitSfx: SfxId[] = [];
    let hitAudioGameTuneStarted = gameTuneStarted;

    const _applyProjectileDamageToCreature = (creatureIndex: number, damage: number, damageType: number, impulse: Vec2, owner: OwnerRef): void => {
      const idx = int(creatureIndex);
      if (!(idx >= 0 && idx < this.creatures.entries.length)) {
        return;
      }
      const creature = this.creatures.entries[idx];
      if (!creature.active) {
        return;
      }
      creatureApplyDamageWithLethalFollowup(
        creature,
        { damageAmount: damage, damageType: int(damageType), impulse: impulse, owner: owner, dt: dt, players: this.players, rng: this.state.rng, preserveBugs: Boolean(this.state.preserveBugs), effects: this.state.effects, detailPreset: int(detailPreset), onLethal: (deathSfx) => this._recordCreatureDeath({ creatureIndex: idx, dt: dt, detailPreset: int(detailPreset), worldSize: worldSize, fxQueue: fxQueue, deaths: deaths, sfx: sfx, deathSfx: deathSfx }) },
      );
    };

    const prevCreatureDamageAppliers = this._setCreatureDamageAppliers(_applyProjectileDamageToCreature);

    const _onSecondaryDetonationKill = (creatureIndex: number): void => {
      const idx = int(creatureIndex);
      if (!(idx >= 0 && idx < this.creatures.entries.length) || this.creatures.entries[idx].hp > 0.0) {
        return;
      }
      // Native detonation follow-up re-enters creature death handling but does
      // not run a second death-SFX random pick (`creature_apply_damage` only
      // does that on the original killing hit).
      this._recordCreatureDeath({
        creatureIndex: idx,
        dt: dt,
        detailPreset: int(detailPreset),
        worldSize: worldSize,
        fxQueue: fxQueue,
        deaths: deaths,
        sfx: sfx,
      });
    };

    const _onProjectileHitPre = (hit: ProjectileHit): ProjectileDecalPostCtx => {
      return this._prepareProjectileHitPresentation(hit, { fxQueue: fxQueue, detailPreset: int(detailPreset), violenceDisabled: int(violenceDisabled) });
    };

    const _onProjectileHitPost = (hit: ProjectileHit, postCtx: ProjectileDecalPostCtx): void => {
      this._finalizeProjectileHitPresentation({
        postCtx: postCtx,
        fxQueue: fxQueue,
      });
      const [hitTrigger, keys] = planHitSfx([hit], { gameMode: gameMode, demoModeActive: this.state.demoModeActive, gameTuneStarted: hitAudioGameTuneStarted, rng: this.state.rng });
      if (hitTrigger) {
        triggerGameTune = true;
        hitAudioGameTuneStarted = true;
      }
      if (keys) {
        hitSfx.push(...keys);
      }
    };

    const hits = this.state.projectiles.step(new PrimaryStepCtx({ dt: dt, creatures: this.creatures.entries, options: new ProjectileUpdateOptions({ worldSize: worldSize, damageScaleByType: damageScaleByType, detailPreset: int(detailPreset), rng: this.state.rng, runtimeState: this.state, players: this.players, applyPlayerDamage: _applyProjectileDamageToPlayer, onHit: _onProjectileHitPre, onHitPost: (_onProjectileHitPost as (arg0: ProjectileHit, arg1: unknown) => void) }) }));
    this.state.secondaryProjectiles.step(new SecondaryStepCtx({ dt: dt, creatures: this.creatures.entries, runtimeState: this.state, fxQueue: fxQueue, detailPreset: int(detailPreset), onDetonationKill: _onSecondaryDetonationKill }));
    this._runPostDamagePlayerDeathHooks({
      prevHealth: prevHealth,
      dt: dt,
      worldSize: worldSize,
      detailPreset: int(detailPreset),
      fxQueue: fxQueue,
      deaths: deaths,
    });

    const _killCreatureNoCorpse = (creatureIndex: number, owner: OwnerRef): void => {
      const idx = int(creatureIndex);
      if (!(idx >= 0 && idx < this.creatures.entries.length)) {
        return;
      }
      const creature = this.creatures.entries[idx];
      if (!creature.active) {
        return;
      }
      if (creature.hp <= 0.0) {
        return;
      }
      creature.lastHitOwner = owner;
      this._recordCreatureDeath({
        creatureIndex: idx,
        dt: dt,
        detailPreset: int(detailPreset),
        worldSize: worldSize,
        fxQueue: fxQueue,
        deaths: deaths,
        sfx: sfx,
        keepCorpse: false,
      });
    };

    this.state.particles.update(
      dt,
      { creatures: this.creatures.entries, killCreature: _killCreatureNoCorpse, fxQueue: fxQueue, spriteEffects: this.state.spriteEffects },
    );
    this.state.spriteEffects.update(dt);
    const reloadActiveAny = inputs.some((entry) => Boolean(entry.reloadDown) || Boolean(entry.reloadPressed));
    let playerDt = dt;
    if (dtPlayerLocal !== null) {
      playerDt = dtPlayerLocal;
    }
    for (const [idx, player] of this.players.entries()) {
      const inputState = idx < inputs.length ? inputs[idx] : new PlayerInput();
      playerUpdate(
        player,
        inputState,
        playerDt,
        this.state,
        { detailPreset: int(detailPreset), worldSize: worldSize, players: this.players, creatures: this.creatures.entries, spawnSlots: this.creatures.spawnSlots, onPlayerLethal: (deadPlayer, dtValueParam = playerDt) => this._runPlayerDeathHooks({ player: deadPlayer, dt: dtValueParam, worldSize: worldSize, detailPreset: int(detailPreset), fxQueue: fxQueue, deaths: deaths }), reloadActiveAny: Boolean(reloadActiveAny) },
      );
      if (dtPlayerLocal === null) {
        playerDt = playerFrameDtAfterRoundtrip({ dt: playerDt, timeScaleActive: Boolean(this.state.timeScaleActive), reflexBoostTimer: this.state.bonuses.reflexBoost });
      }
    }
    dt = playerDt;
    if (dt > 0.0) {
      this._advanceCreatureAnim(dt);
      this._advancePlayerAnim(dt, prevPositions);
    }
    if (midStepHook !== null) {
      midStepHook();
    }
    if (!deferCameraShakeUpdate) {
      cameraShakeUpdate(this.state, dt);
    }
    // Native level-up/perk-pending check runs before `bonus_update` in
    // gameplay_update_and_render. Keep the same ordering so XP awarded from
    // bonus-side kill paths (e.g. freeze cleanup) levels on the next tick.
    if (perkProgressionEnabled) {
      survivalProgressionUpdate(this.state, this.players);
    }
    // Native latches `time_scale_active` late (post mode update, pre bonus decrement); next-frame dt uses it.
    this.state.timeScaleActive = this.state.bonuses.reflexBoost > 0.0;
    bonusUpdatePrePickupTimers(this.state, dt);
    const pickups = bonusUpdate(this.state, this.players, dt, { creatures: this.creatures.entries, updateHud: true, detailPreset: int(detailPreset), deferFreezeCorpseFx: deferFreezeCorpseFx, freezeCorpseIndices: freezeCorpseIndicesAtTickStart });
    if (pickups) {
      emitBonusPickupEffects({
        state: this.state,
        pickups: pickups,
        detailPreset: int(detailPreset),
      });
    }
    survivalEnforceRewardWeaponGuard(this.state, this.players);
    if (this.state.sfxQueue) {
      sfx.push(...this.state.sfxQueue);
      ((target: unknown) => {
        if (target !== null && typeof target === 'object' && typeof (target as { clear?: unknown }).clear === 'function') {
          (target as { clear: () => void }).clear();
        } else if (target !== null && typeof target === 'object' && 'length' in target) {
          (target as { length: number }).length = 0;
        }
      })(this.state.sfxQueue);
    }
    // Player-damage VO RNG work lives inside `player_take_damage` for native
    // ordering parity (VO draw before heading-jitter draw).
    ((target: unknown) => {
      if (target !== null && typeof target === 'object' && typeof (target as { clear?: unknown }).clear === 'function') {
        (target as { clear: () => void }).clear();
      } else if (target !== null && typeof target === 'object' && 'length' in target) {
        (target as { length: number }).length = 0;
      }
    })(this.state.playerDeathHookSkipIndices);
    this._restoreCreatureDamageAppliers(prevCreatureDamageAppliers);
    return new WorldEvents({ hits: hits, deaths: Array.from(deaths), pickups: pickups, sfx: sfx, triggerGameTune: triggerGameTune, hitSfx: hitSfx });
  }

  _setCreatureDamageAppliers(opts: { applier: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null }): [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null];
  _setCreatureDamageAppliers(applier: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null): [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null];
  _setCreatureDamageAppliers(applierOrOpts: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null | { applier: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null }): [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] {
    const applier: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null = typeof applierOrOpts === 'object' && applierOrOpts !== null && 'applier' in applierOrOpts ? applierOrOpts.applier : applierOrOpts as ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null;
    const prev: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] = [this.state.projectiles.creatureDamageApplier, this.state.secondaryProjectiles.creatureDamageApplier, this.state.particles.creatureDamageApplier, this.state.bonusPool.creatureDamageApplier];
    this.state.projectiles.creatureDamageApplier = applier;
    this.state.secondaryProjectiles.creatureDamageApplier = applier;
    this.state.particles.creatureDamageApplier = applier;
    this.state.bonusPool.creatureDamageApplier = applier;
    return prev;
  }

  _restoreCreatureDamageAppliers(opts: { previous: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] }): void;
  _restoreCreatureDamageAppliers(previous: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null]): void;
  _restoreCreatureDamageAppliers(previousOrOpts: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] | { previous: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] }): void {
    const previous: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] = typeof previousOrOpts === 'object' && previousOrOpts !== null && 'previous' in previousOrOpts ? previousOrOpts.previous : previousOrOpts as [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null];
    [this.state.projectiles.creatureDamageApplier, this.state.secondaryProjectiles.creatureDamageApplier, this.state.particles.creatureDamageApplier, this.state.bonusPool.creatureDamageApplier] = previous;
  }

  _runPlayerDeathHooks(opts: { player: PlayerState; dt: number; worldSize: number; detailPreset: number; fxQueue: FxQueue; deaths: CreatureDeath[] }): void {
    const player = opts.player;
    const dt = opts.dt;
    const worldSize = opts.worldSize;
    const detailPreset = opts.detailPreset;
    const fxQueue = opts.fxQueue;
    const deaths = opts.deaths;
    for (const hook of PLAYER_DEATH_HOOKS) {
      hook({
        state: this.state,
        creatures: this.creatures,
        players: this.players,
        player: player,
        dt: dt,
        worldSize: worldSize,
        detailPreset: int(detailPreset),
        fxQueue: fxQueue,
        deaths: deaths,
      });
    }
  }

  _runPostDamagePlayerDeathHooks(opts: { prevHealth: number[]; dt: number; worldSize: number; detailPreset: number; fxQueue: FxQueue; deaths: CreatureDeath[] }): void {
    const prevHealth = opts.prevHealth;
    const dt = opts.dt;
    const worldSize = opts.worldSize;
    const detailPreset = opts.detailPreset;
    const fxQueue = opts.fxQueue;
    const deaths = opts.deaths;
    for (const [idx, player] of this.players.entries()) {
      if (idx >= prevHealth.length) {
        continue;
      }
      if (prevHealth[idx] < 0.0) {
        continue;
      }
      if (player.health >= 0.0) {
        continue;
      }
      const playerIdx = int(player.index);
      if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(this.state.playerDeathHookSkipIndices, playerIdx)) {
        this.state.playerDeathHookSkipIndices.delete(playerIdx);
        continue;
      }
      this._runPlayerDeathHooks({
        player: player,
        dt: dt,
        worldSize: worldSize,
        detailPreset: int(detailPreset),
        fxQueue: fxQueue,
        deaths: deaths,
      });
    }
  }

  _recordCreatureDeath(opts: { creatureIndex: number; dt: number; detailPreset: number; worldSize: number; fxQueue: FxQueue; deaths: CreatureDeath[]; keepCorpse?: boolean; sfx: SfxId[]; deathSfx?: readonly SfxId[] }): void {
    const creatureIndex = opts.creatureIndex;
    const dt = opts.dt;
    const detailPreset = opts.detailPreset;
    const worldSize = opts.worldSize;
    const fxQueue = opts.fxQueue;
    const deaths = opts.deaths;
    const keepCorpse = opts.keepCorpse ?? true;
    const sfx = opts.sfx;
    const deathSfx = opts.deathSfx ?? [];
    const death = this.creatures.handleDeath(int(creatureIndex), { state: this.state, players: this.players, rng: this.state.rng, dt: dt, detailPreset: int(detailPreset), worldWidth: worldSize, worldHeight: worldSize, fxQueue: fxQueue, keepCorpse: keepCorpse });
    deaths.push(death);
    sfx.push(...deathSfx);
  }

  _prepareProjectileHitPresentation(hit: ProjectileHit, opts: { fxQueue: FxQueue; detailPreset: number; violenceDisabled: number }): ProjectileDecalPostCtx {
    const fxQueue = opts.fxQueue;
    const detailPreset = opts.detailPreset;
    const violenceDisabled = opts.violenceDisabled;
    return queueProjectileDecalsPreHit({ state: this.state, players: this.players, fxQueue: fxQueue, hit: hit, rng: this.state.rng, detailPreset: int(detailPreset), violenceDisabled: int(violenceDisabled) });
  }

  _finalizeProjectileHitPresentation(opts: { postCtx: ProjectileDecalPostCtx; fxQueue: FxQueue }): void {
    const postCtx = opts.postCtx;
    const fxQueue = opts.fxQueue;
    queueProjectileDecalsPostHit({
      fxQueue: fxQueue,
      postCtx: postCtx,
      rng: this.state.rng,
    });
  }

  _advanceCreatureAnim(opts: { dt: number }): void;
  _advanceCreatureAnim(dt: number): void;
  _advanceCreatureAnim(dtOrOpts: number | { dt: number }): void {
    const dt: number = typeof dtOrOpts === 'object' && dtOrOpts !== null && 'dt' in dtOrOpts ? dtOrOpts.dt : dtOrOpts as number;
    if (this.state.bonuses.freeze > 0.0) {
      return;
    }
    for (const creature of this.creatures.entries) {
      if (!(creature.active && creature.hp > 0.0)) {
        continue;
      }
      const typeId = creature.typeId;
      const info = mapGetOrThrow(CREATURE_ANIM, typeId);
      [creature.animPhase, ] = creatureAnimAdvancePhase(creature.animPhase, { animRate: info.animRate, moveSpeed: creature.moveSpeed, dt: dt, size: creature.size, localScale: creature.moveScale, flags: creature.flags, aiMode: int(creature.aiMode) });
    }
  }

  _advancePlayerAnim(opts: { dt: number; prevPositions: [number, number][] }): void;
  _advancePlayerAnim(dt: number, prevPositions: [number, number][]): void;
  _advancePlayerAnim(dtOrOpts: number | { dt: number; prevPositions: [number, number][] }, prevPositionsArg: [number, number][] | undefined = undefined): void {
    const dt: number = typeof dtOrOpts === 'object' && dtOrOpts !== null && 'dt' in dtOrOpts ? dtOrOpts.dt : dtOrOpts as number;
    const prevPositions: [number, number][] = typeof dtOrOpts === 'object' && dtOrOpts !== null && 'dt' in dtOrOpts ? dtOrOpts.prevPositions : prevPositionsArg as [number, number][];
    const info = CREATURE_ANIM.get(CreatureTypeId.TROOPER) ?? null;
    if (info === null) {
      return;
    }
    for (const [idx, player] of this.players.entries()) {
      if (idx >= prevPositions.length) {
        continue;
      }
      const [prevX, prevY] = prevPositions[idx];
      const speed = new Vec2(player.pos.x - prevX, player.pos.y - prevY).length();
      const moveSpeed = dt > 0.0 ? speed / dt / 120.0 : 0.0;
      [player.movePhase, ] = creatureAnimAdvancePhase(player.movePhase, { animRate: info.animRate, moveSpeed: moveSpeed, dt: dt, size: player.size, localScale: 1.0, flags: 0, aiMode: CreatureAiMode.ORBIT_PLAYER });
    }
  }

  setCreatureDamageAppliers(opts: { applier: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null }): [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null];
  setCreatureDamageAppliers(applier: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null): [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null];
  setCreatureDamageAppliers(applierOrOpts: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null | { applier: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null }): [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] {
    const applier: ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null = typeof applierOrOpts === 'object' && applierOrOpts !== null && 'applier' in applierOrOpts ? applierOrOpts.applier : applierOrOpts as ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null;
    return this._setCreatureDamageAppliers(applier);
  }

  restoreCreatureDamageAppliers(opts: { previous: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] }): void;
  restoreCreatureDamageAppliers(previous: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null]): void;
  restoreCreatureDamageAppliers(previousOrOpts: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] | { previous: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] }): void {
    const previous: [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null] = typeof previousOrOpts === 'object' && previousOrOpts !== null && 'previous' in previousOrOpts ? previousOrOpts.previous : previousOrOpts as [((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null, ((arg0: number, arg1: number, arg2: number, arg3: Vec2, arg4: OwnerRef) => void) | null];
    this._restoreCreatureDamageAppliers(previous);
  }

  runPlayerDeathHooks(opts: { player: PlayerState; dt: number; worldSize: number; detailPreset: number; fxQueue: FxQueue; deaths: CreatureDeath[] }): void {
    const player = opts.player;
    const dt = opts.dt;
    const worldSize = opts.worldSize;
    const detailPreset = opts.detailPreset;
    const fxQueue = opts.fxQueue;
    const deaths = opts.deaths;
    this._runPlayerDeathHooks({ player: player, dt: dt, worldSize: worldSize, detailPreset: detailPreset, fxQueue: fxQueue, deaths: deaths });
  }

  runPostDamagePlayerDeathHooks(opts: { prevHealth: number[]; dt: number; worldSize: number; detailPreset: number; fxQueue: FxQueue; deaths: CreatureDeath[] }): void {
    const prevHealth = opts.prevHealth;
    const dt = opts.dt;
    const worldSize = opts.worldSize;
    const detailPreset = opts.detailPreset;
    const fxQueue = opts.fxQueue;
    const deaths = opts.deaths;
    this._runPostDamagePlayerDeathHooks({ prevHealth: prevHealth, dt: dt, worldSize: worldSize, detailPreset: detailPreset, fxQueue: fxQueue, deaths: deaths });
  }

  recordCreatureDeath(opts: { creatureIndex: number; dt: number; detailPreset: number; worldSize: number; fxQueue: FxQueue; deaths: CreatureDeath[]; keepCorpse?: boolean; sfx: SfxId[]; deathSfx?: readonly SfxId[] }): void {
    const creatureIndex = opts.creatureIndex;
    const dt = opts.dt;
    const detailPreset = opts.detailPreset;
    const worldSize = opts.worldSize;
    const fxQueue = opts.fxQueue;
    const deaths = opts.deaths;
    const keepCorpse = opts.keepCorpse ?? true;
    const sfx = opts.sfx;
    const deathSfx = opts.deathSfx ?? [];
    this._recordCreatureDeath({ creatureIndex: creatureIndex, dt: dt, detailPreset: detailPreset, worldSize: worldSize, fxQueue: fxQueue, deaths: deaths, keepCorpse: keepCorpse, sfx: sfx, deathSfx: deathSfx });
  }

  prepareProjectileHitPresentation(hit: ProjectileHit, opts: { fxQueue: FxQueue; detailPreset: number; violenceDisabled: number }): ProjectileDecalPostCtx {
    const fxQueue = opts.fxQueue;
    const detailPreset = opts.detailPreset;
    const violenceDisabled = opts.violenceDisabled;
    return this._prepareProjectileHitPresentation(hit, { fxQueue: fxQueue, detailPreset: detailPreset, violenceDisabled: violenceDisabled });
  }

  finalizeProjectileHitPresentation(opts: { postCtx: ProjectileDecalPostCtx; fxQueue: FxQueue }): void {
    const postCtx = opts.postCtx;
    const fxQueue = opts.fxQueue;
    this._finalizeProjectileHitPresentation({ postCtx: postCtx, fxQueue: fxQueue });
  }

  advanceCreatureAnim(opts: { dt: number }): void;
  advanceCreatureAnim(dt: number): void;
  advanceCreatureAnim(dtOrOpts: number | { dt: number }): void {
    const dt: number = typeof dtOrOpts === 'object' && dtOrOpts !== null && 'dt' in dtOrOpts ? dtOrOpts.dt : dtOrOpts as number;
    this._advanceCreatureAnim(dt);
  }

  advancePlayerAnim(opts: { dt: number; prevPositions: [number, number][] }): void;
  advancePlayerAnim(dt: number, prevPositions: [number, number][]): void;
  advancePlayerAnim(dtOrOpts: number | { dt: number; prevPositions: [number, number][] }, prevPositionsArg: [number, number][] | undefined = undefined): void {
    const dt: number = typeof dtOrOpts === 'object' && dtOrOpts !== null && 'dt' in dtOrOpts ? dtOrOpts.dt : dtOrOpts as number;
    const prevPositions: [number, number][] = typeof dtOrOpts === 'object' && dtOrOpts !== null && 'dt' in dtOrOpts ? dtOrOpts.prevPositions : prevPositionsArg as [number, number][];
    this._advancePlayerAnim(dt, prevPositions);
  }
}
