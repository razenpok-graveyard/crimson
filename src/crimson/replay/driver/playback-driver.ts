// Port of crimson/replay/driver/playback_driver.py

import type { QuestLevel } from '@crimson/quests/level.ts';
import { CallerStatic, CrtRand, RngTraceSink } from '@grim/rand.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { GameStatus } from '@crimson/persistence/save-status.ts';
import { questByLevel } from '@crimson/quests/index.ts';
import { buildQuestSpawnTable } from '@crimson/quests/runtime.ts';
import type { QuestDefinition, SpawnEntry } from '@crimson/quests/types.ts';
import { QuestContext } from '@crimson/quests/types.ts';
import type { Replay } from '@crimson/replay/index.ts';
import { warnOnGameVersionMismatch } from '@crimson/replay/index.ts';
import type { ReplayCheckpoint } from '@crimson/replay/checkpoints.ts';
import { buildCheckpoint as buildReplayCheckpoint } from '@crimson/replay/checkpoints.ts';
import { sessionSettingsFromReplayHeader } from '@crimson/replay/header-settings.ts';
import { unpackTickInputs } from '@crimson/replay/input-codec.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { TerrainSetup, advanceExplicitTerrain, advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { TickResult } from '@crimson/sim/hooks.ts';
import { ResolvedTick } from '@crimson/sim/input-providers.ts';
import { buildQuestSession, buildRushSession, buildSurvivalSession, buildTutorialSession, buildTypoSession, enforceRushLoadout } from '@crimson/sim/session-builders.ts';
import type { DeterministicSession, QuestSpawnState } from '@crimson/sim/sessions.ts';
import { WorldState } from '@crimson/sim/world-state.ts';
import { typoShotCounts } from '@crimson/typo/state.ts';
import type { WeaponId } from '@crimson/weapons.ts';
import { resetWorldPlayers } from '@crimson/world/sim-world-state.ts';
import { shouldApplyWorldDtStepsForReplay } from '@crimson/replay/driver/replay-timing.ts';
import { ReplayRunnerError, RunResult, buildDamageScaleByType, player0MostUsedWeaponId, player0Shots } from '@crimson/replay/driver/setup.ts';

export type RngTraceDraw = [number, number, number, CallerStatic];
export type TickRngTraceObserver = (arg0: TickResult, arg1: RngTraceDraw[]) => void;
export type TickProgressCallback = (arg0: number) => void;
export type TickBeginObserver = (arg0: number, arg1: WorldState, arg2: number) => void;
export type TickEndObserver = (arg0: TickResult, arg1: WorldState) => void;

function pythonRepr(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'nan';
    }
    if (value === Infinity) {
      return 'inf';
    }
    if (value === -Infinity) {
      return '-inf';
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === true) {
    return 'True';
  }
  if (value === false) {
    return 'False';
  }
  if (value === null) {
    return 'None';
  }
  return String(value);
}

export class PlaybackWalkHooks {
  readonly beforeTick: TickBeginObserver | null;
  readonly afterTick: TickEndObserver | null;
  readonly onProgress: TickProgressCallback | null;
  readonly onRngTrace: TickRngTraceObserver | null;

  constructor(opts: {
    beforeTick?: TickBeginObserver | null;
    afterTick?: TickEndObserver | null;
    onProgress?: TickProgressCallback | null;
    onRngTrace?: TickRngTraceObserver | null;
  } = {}) {
    this.beforeTick = opts.beforeTick ?? null;
    this.afterTick = opts.afterTick ?? null;
    this.onProgress = opts.onProgress ?? null;
    this.onRngTrace = opts.onRngTrace ?? null;
  }
}

export class PlaybackWalkResult {
  readonly startTick: number;
  readonly nextTickIndex: number;
  readonly ticksCompleted: number;

  constructor(opts: {
    startTick: number;
    nextTickIndex: number;
    ticksCompleted: number;
  }) {
    this.startTick = opts.startTick;
    this.nextTickIndex = opts.nextTickIndex;
    this.ticksCompleted = opts.ticksCompleted;
  }
}

// Canonical replay driver.
export class PlaybackDriver {
  replay: Replay;
  maxTicks: number | null;
  traceRng: boolean;
  strictRngTrace: boolean;
  interTickRandDraws: number;
  interTickRandDrawsByTick: Map<number, number> | null;
  protected _providedWorldSize: number | null;
  protected _questSpawnEntries: SpawnEntry[] | null;
  protected _questStartWeaponId: WeaponId | null;
  protected _questSpawnState: QuestSpawnState | null;
  protected _questDefinition: QuestDefinition | null;
  protected _questTotalSpawnCount: number;
  protected _terrainSetup: TerrainSetup | null;
  protected _questSpawnEntriesResolved: SpawnEntry[];
  protected _questStartWeaponResolved: WeaponId | null;
  sessionSettings: ReturnType<typeof sessionSettingsFromReplayHeader>;
  tickRate: number;
  dt: number;
  worldSize: number;
  world: WorldState;
  session: DeterministicSession;
  protected _lastTickRngRows: RngTraceDraw[];
  tickLimit: number;
  modeId!: GameMode;

  constructor(replay: Replay, opts: { maxTicks?: number | null; traceRng?: boolean; strictRngTrace?: boolean; versionMismatchAction?: string | null; worldSize?: number | null; interTickRandDraws?: number; interTickRandDrawsByTick?: Map<number, number> | null; spawnEntries?: readonly SpawnEntry[] | null; startWeaponId?: WeaponId | null } = {}) {
    const maxTicks = opts.maxTicks ?? null;
    const traceRng = opts.traceRng ?? false;
    const strictRngTrace = opts.strictRngTrace ?? false;
    const versionMismatchAction = opts.versionMismatchAction ?? 'verification';
    const worldSize = opts.worldSize ?? null;
    const interTickRandDraws = opts.interTickRandDraws ?? 0;
    const interTickRandDrawsByTick = opts.interTickRandDrawsByTick ?? null;
    const spawnEntries = opts.spawnEntries ?? null;
    const startWeaponId = opts.startWeaponId ?? null;
    this.replay = replay;
    this.maxTicks = maxTicks;
    this.traceRng = traceRng;
    this.strictRngTrace = strictRngTrace;
    this.interTickRandDraws = Math.max(0, int(interTickRandDraws));
    this.interTickRandDrawsByTick = interTickRandDrawsByTick;
    this._providedWorldSize = worldSize !== null ? worldSize : null;
    this._questSpawnEntries = spawnEntries !== null ? Array.from(spawnEntries) : null;
    this._questStartWeaponId = startWeaponId;
    this._questSpawnState = null;
    this._questDefinition = null;
    this._questTotalSpawnCount = 0;
    this._terrainSetup = null;
    this._questSpawnEntriesResolved = [];
    this._questStartWeaponResolved = null;

    if (versionMismatchAction !== null) {
      warnOnGameVersionMismatch(replay, { action: String(versionMismatchAction) });
    }

    this.sessionSettings = sessionSettingsFromReplayHeader(replay.header);

    const modeRaw = int(this.sessionSettings.modeId);
    try {
      this.modeId = (() => { const value = modeRaw; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
    } catch (exc) {
      throw new ReplayRunnerError(`unsupported replay game_mode_id=${modeRaw}`);
    }

    const tickRate = int(this.sessionSettings.tickRate);
    if (tickRate <= 0) {
      throw new ReplayRunnerError(`invalid tick_rate: ${tickRate}`);
    }
    this.tickRate = int(tickRate);
    this.dt = 1.0 / this.tickRate;

    this.worldSize = this._resolveWorldSize();
    this.world = this._prepareWorld();

    const applyWorldDtSteps = shouldApplyWorldDtStepsForReplay({ originalCaptureReplay: false });
    this.session = this._buildSession({ applyWorldDtSteps: Boolean(applyWorldDtSteps) });
    this._lastTickRngRows = [];

    this.tickLimit = this.maxTicks === null ? replay.ticks.length : Math.min(replay.ticks.length, Math.max(0, int(this.maxTicks)));
  }

  protected _resolveWorldSize(): number {
    if (this._providedWorldSize !== null) {
      return this._providedWorldSize;
    }
    return this.replay.header.worldSize;
  }

  protected _prepareWorld(): WorldState {
    const world = WorldState.build({ worldSize: this.worldSize, demoModeActive: false, hardcore: Boolean(this.replay.header.hardcore), questFailRetryCount: int(this.replay.header.questFailRetryCount), preserveBugs: Boolean(this.sessionSettings.preserveBugs) });
    world.state.rng.srand(int(this.replay.header.seed));
    resetWorldPlayers(
      world.players,
      { state: world.state, worldSize: this.worldSize, playerCount: int(this.sessionSettings.playerCount) },
    );
    world.state.status = GameStatus.fromData({ path: 'replay://status', data: this.replay.header.status, dirty: false });
    this._questDefinition = null;
    this._questTotalSpawnCount = 0;
    this._terrainSetup = null;
    this._questSpawnEntriesResolved = [];
    this._questStartWeaponResolved = null;

    let terrain: ReturnType<typeof advanceUnlockTerrain>;
    switch (this.modeId) {
      case GameMode.SURVIVAL:
      case GameMode.RUSH:
        terrain = advanceUnlockTerrain(world.state.rng, { unlockIndex: int(this.replay.header.status.questUnlockIndex), width: int(this.worldSize), height: int(this.worldSize) });
        this._terrainSetup = terrain;
        break;
      case GameMode.TYPO:
        terrain = advanceUnlockTerrain(world.state.rng, { unlockIndex: int(this.replay.header.status.questUnlockIndex), width: int(this.worldSize), height: int(this.worldSize) });
        this._terrainSetup = terrain;
        break;
      case GameMode.TUTORIAL:
        terrain = advanceUnlockTerrain(world.state.rng, { unlockIndex: int(this.replay.header.status.questUnlockIndex), width: int(this.worldSize), height: int(this.worldSize) });
        this._terrainSetup = terrain;
        break;
      case GameMode.QUESTS:
        const questDefinition = resolveReplayQuestDefinition(this.replay);
        const questLevel = questDefinition.level;
        const startWeaponId = this._questStartWeaponId === null ? questDefinition.startWeaponId : this._questStartWeaponId;
        const ctx = new QuestContext({ width: int(this.worldSize), height: int(this.worldSize), playerCount: int(this.sessionSettings.playerCount) });
        advanceUnlockTerrain(
          world.state.rng,
          { unlockIndex: int(this.replay.header.status.questUnlockIndex), width: int(this.worldSize), height: int(this.worldSize) },
        );
        // Native `quest_start_selected()` burns one `crt_rand()` for
        // `highscore_record_random_tag` before quest terrain and spawn setup.
        world.state.rng.rand({ caller: RngCallerStatic.QUEST_START_SELECTED_HIGHSCORE_RANDOM_TAG });
        const questTerrain = advanceExplicitTerrain(world.state.rng, { terrainSlots: questDefinition.terrainSlots, width: int(this.worldSize), height: int(this.worldSize) });
        const generatedSpawnEntries = Array.from(buildQuestSpawnTable(questDefinition, ctx, { rng: world.state.rng, hardcore: Boolean(this.replay.header.hardcore), fullVersion: true }));
        const spawnEntries = this._questSpawnEntries !== null ? Array.from(this._questSpawnEntries) : generatedSpawnEntries;
        world.state.questLevel = questLevel;
        this._questDefinition = questDefinition;
        this._questTotalSpawnCount = int(spawnEntries.reduce((total, entry) => total + int(entry.count), 0));
        this._questSpawnEntriesResolved = spawnEntries;
        this._questStartWeaponResolved = startWeaponId;
        this._terrainSetup = new TerrainSetup({ terrainSlots: questDefinition.terrainSlots, terrainSeed: questTerrain.terrainSeed });
        break;
      default:
        break;
    }
    return world;
  }

  protected _buildSession(opts: { applyWorldDtSteps: boolean }): DeterministicSession {
    const applyWorldDtSteps = opts.applyWorldDtSteps;
    const damageScaleByType = buildDamageScaleByType();
    this._questSpawnState = null;
    switch (this.modeId) {
      case GameMode.SURVIVAL:
        let [session, ] = buildSurvivalSession({ world: this.world, worldSize: this.worldSize, damageScaleByType: damageScaleByType, detailPreset: this.replay.header.detailPreset, violenceDisabled: this.replay.header.violenceDisabled, gameTuneStarted: false, applyWorldDtSteps: applyWorldDtSteps, finalizePostRenderLifecycle: true });
        return session;
      case GameMode.RUSH:
        enforceRushLoadout(this.world);
        [session, ] = buildRushSession({ world: this.world, worldSize: this.worldSize, damageScaleByType: damageScaleByType, detailPreset: this.replay.header.detailPreset, violenceDisabled: this.replay.header.violenceDisabled, gameTuneStarted: false, finalizePostRenderLifecycle: true });
        return session;
      case GameMode.QUESTS:
        const questDefinition = this._questDefinition;
        if (questDefinition === null) {
          throw new ReplayRunnerError('quest replay startup must resolve quest definition before session build');
        }
        const spawnEntries = Array.from(this._questSpawnEntriesResolved);
        const questLevel = questDefinition.level;
        const startWeaponId = this._questStartWeaponResolved;
        let questState: any;
        [session, questState] = buildQuestSession({ world: this.world, worldSize: this.worldSize, damageScaleByType: damageScaleByType, detailPreset: this.replay.header.detailPreset, violenceDisabled: this.replay.header.violenceDisabled, gameTuneStarted: false, demoModeActive: this.world.state.demoModeActive, applyWorldDtSteps: applyWorldDtSteps, finalizePostRenderLifecycle: true, spawnEntries: spawnEntries, questLevel: questLevel, startWeaponId: startWeaponId });
        this._questSpawnState = questState;
        return session;
      case GameMode.TYPO:
        return buildTypoSession({ world: this.world, worldSize: this.worldSize, damageScaleByType: damageScaleByType, detailPreset: this.replay.header.detailPreset, violenceDisabled: this.replay.header.violenceDisabled, gameTuneStarted: false, dictionaryWords: this.replay.header.typoDictionaryWords, highscoreNames: this.replay.header.typoHighscoreNames });
      case GameMode.TUTORIAL:
        return buildTutorialSession({ world: this.world, worldSize: this.worldSize, damageScaleByType: damageScaleByType, detailPreset: this.replay.header.detailPreset, violenceDisabled: this.replay.header.violenceDisabled, gameTuneStarted: false, demoModeActive: false });
      default:
        throw new ReplayRunnerError(`unsupported replay game_mode_id=${int(this.modeId)}`);
    }
  }

  protected _prepareTick(opts: { tickIndex: number }): void {
    const tickIndex = opts.tickIndex;
    if (int(tickIndex) < 0 || int(tickIndex) >= int(this.tickLimit)) {
      throw new ReplayRunnerError(`tick_index out of range: ${tickIndex} (tick_limit=${this.tickLimit})`);
    }

    const state = this.world.state;
    state.gameMode = this.modeId;
    state.demoModeActive = false;

    let draws: any;
    if (this.interTickRandDrawsByTick !== null) {
      draws = this.interTickRandDrawsByTick.get(int(tickIndex)) ?? null;
      if (draws === null) {
        draws = int(this.interTickRandDraws);
      }
      for (let i = 0; i < Math.max(0, int(draws)); i++) {
        state.rng.rand({ caller: RngCallerStatic.REPLAY_DRIVER_INTER_TICK_DRAW_BY_TICK });
      }
    }
  }

  buildCheckpoint(opts: { tickResult: TickResult; useWorldStepCreatureCount?: boolean }): ReplayCheckpoint {
    const tickResult = opts.tickResult;
    const useWorldStepCreatureCount = opts.useWorldStepCreatureCount ?? false;
    return buildReplayCheckpoint({ tickIndex: int(tickResult.sourceTick.tickIndex), world: this.world, elapsedMs: this.elapsedMs, creatureCountOverride: useWorldStepCreatureCount ? int(tickResult.payload.creatureCountWorldStep) : null, deaths: tickResult.payload.step.events.deaths, events: tickResult.payload.step.events });
  }

  stepTick(tickIndex: number): TickResult {
    tickIndex = int(tickIndex);
    this._prepareTick({ tickIndex: tickIndex });
    this._lastTickRngRows = [];
    const replayTick = this.replay.ticks[tickIndex];
    const dtTick = replayTick.dt;
    const inputs = unpackTickInputs(replayTick.inputs);
    const commands = Array.from(replayTick.commands);
    let tickRngRows: any;
    let sourceTick = undefined as unknown as ResolvedTick;
    let sessionTick = undefined as unknown as ReturnType<typeof this.session.stepTick>;
    let tickResult = undefined as unknown as TickResult;
    for (const _tickRngRowsValue of tickRngTrace(this.world.state.rng, { enabled: this.traceRng, strict: this.strictRngTrace })) {
      tickRngRows = _tickRngRowsValue;
      sourceTick = new ResolvedTick({ tickIndex: int(tickIndex), dtSeconds: dtTick, inputs: Array.from(inputs), commands: Array.from(commands) });

      sessionTick = this.session.stepTick({ dt: dtTick, inputs: inputs, traceRng: this.traceRng, commands: commands });
      tickResult = new TickResult({ sourceTick: sourceTick, payload: sessionTick, replayTickIndex: int(tickIndex) });
    }

    if (this.interTickRandDrawsByTick === null) {
      const draws = Math.max(0, int(this.interTickRandDraws));
      for (let i = 0; i < draws; i++) {
        this.world.state.rng.rand({ caller: RngCallerStatic.REPLAY_DRIVER_INTER_TICK_DRAW });
      }
    }
    this._lastTickRngRows = Array.from(tickRngRows);
    return tickResult;
  }

  walkTicks(opts: { startTick?: number; stopTick?: number | null; hooks?: PlaybackWalkHooks | null } = {}): PlaybackWalkResult {
    const startTick = opts.startTick ?? 0;
    const stopTick = opts.stopTick ?? null;
    const hooks = opts.hooks ?? null;
    const requestedStartTick = int(startTick);
    if (requestedStartTick < 0) {
      throw new ReplayRunnerError(`invalid start_tick: ${requestedStartTick}`);
    }
    const requestedStopTick = stopTick === null ? int(this.tickLimit) : int(stopTick);
    if (requestedStopTick < requestedStartTick) {
      throw new ReplayRunnerError(`invalid tick range: start_tick=${requestedStartTick} stop_tick=${requestedStopTick}`);
    }

    const tickLimit = int(this.tickLimit);
    let nextTickIndex = Math.min(requestedStartTick, tickLimit);
    const stopTickIndex = Math.min(requestedStopTick, tickLimit);
    const activeHooks = hooks !== null ? hooks : new PlaybackWalkHooks();

    while (nextTickIndex < stopTickIndex) {
      if (activeHooks.beforeTick !== null) {
        activeHooks.beforeTick(int(nextTickIndex), this.world, this.replay.ticks[nextTickIndex].dt);
      }
      const tickResult = this.stepTick(nextTickIndex);
      nextTickIndex = int(tickResult.sourceTick.tickIndex) + 1;

      if (activeHooks.afterTick !== null) {
        activeHooks.afterTick(tickResult, this.world);
      }
      if (activeHooks.onRngTrace !== null) {
        activeHooks.onRngTrace(tickResult, this._lastTickRngRows);
      }
      if (activeHooks.onProgress !== null) {
        activeHooks.onProgress(int(nextTickIndex));
      }
    }

    return new PlaybackWalkResult({ startTick: Math.min(requestedStartTick, tickLimit), nextTickIndex: int(nextTickIndex), ticksCompleted: int(nextTickIndex - Math.min(requestedStartTick, tickLimit)) });
  }

  run(opts: { hooks?: PlaybackWalkHooks | null } = {}): RunResult {
    const hooks = opts.hooks ?? null;
    this.walkTicks({
      startTick: 0,
      stopTick: int(this.tickLimit),
      hooks: hooks,
    });
    return this.buildRunResult({ ticks: int(this.tickLimit) });
  }

  buildRunResult(opts: { ticks: number }): RunResult {
    const ticks = opts.ticks;
    let shotsFired: ReturnType<typeof typoShotCounts>[0] | ReturnType<typeof player0Shots>[0];
    let shotsHit: ReturnType<typeof typoShotCounts>[1] | ReturnType<typeof player0Shots>[1];
    if (this.modeId === GameMode.TYPO) {
      [shotsFired, shotsHit] = typoShotCounts(this.world.state.typo);
    } else {
      [shotsFired, shotsHit] = player0Shots(this.world.state);
    }
    const mostUsedWeaponId = player0MostUsedWeaponId(this.world.state, this.world.players);
    const scoreXp = this.world.players.length > 0 ? int(this.world.players[0].experience) : 0;

    return new RunResult({ gameModeId: this.modeId, tickRate: int(this.tickRate), ticks: int(ticks), elapsedMs: int(this.elapsedMs), scoreXp: int(scoreXp), creatureKillCount: int(this.world.creatures.killCount), mostUsedWeaponId: mostUsedWeaponId, shotsFired: int(shotsFired), shotsHit: int(shotsHit), rngState: int(this.world.state.rng.state) });
  }

  get elapsedMs(): number {
    const questState = this._questSpawnState;
    if (questState !== null) {
      return questState.spawnTimelineMs;
    }
    return this.session.elapsedMs;
  }

  get questSpawnState(): QuestSpawnState | null {
    return this._questSpawnState;
  }

  get questDefinition(): QuestDefinition | null {
    return this._questDefinition;
  }

  get questTotalSpawnCount(): number {
    return int(this._questTotalSpawnCount);
  }

  get terrainSetup(): TerrainSetup | null {
    return this._terrainSetup;
  }
}

export function requireQuestLevelFromReplay(replay: Replay): QuestLevel {
  if (replay.header.questLevel === null) {
    throw new ReplayRunnerError('quest replays require a valid header.quest_level');
  }
  return replay.header.questLevel;
}

export function resolveReplayQuestDefinition(replay: Replay, opts: { questLevel?: QuestLevel | null } = {}): QuestDefinition {
  const questLevel = opts.questLevel ?? null;
  const level = questLevel !== null ? questLevel : requireQuestLevelFromReplay(replay);
  const quest = questByLevel(level);
  if (quest === null) {
    throw new ReplayRunnerError(`unsupported quest replay: unknown quest_level=${pythonRepr(level.text)}`);
  }
  return quest;
}

function* tickRngTrace(rng: unknown, opts: { enabled: boolean; strict?: boolean }): IterableIterator<RngTraceDraw[]> {
  const enabled = opts.enabled;
  const strict = opts.strict ?? false;
  const draws: RngTraceDraw[] = [];
  if (!enabled || !(rng instanceof CrtRand)) {
    yield draws;
    return;
  }

  const previousSink = rng.traceSink;
  const previousRequireCaller = rng.traceRequireCaller;

  const _sink = (stateBeforeU32: number, stateAfterU32: number, value15: number, caller: CallerStatic): void => {
    draws.push([int(stateBeforeU32), int(value15), int(stateAfterU32), caller]);
  };

  const traceSink: RngTraceSink = _sink;
  rng.setTraceSink(traceSink, { requireCaller: strict });
  try {
    yield draws;
  } finally {
    rng.setTraceSink(previousSink, { requireCaller: Boolean(previousRequireCaller) });
  }
}

export function buildVerifyPlaybackDriver(replay: Replay, opts: { maxTicks?: number | null; warnOnVersionMismatch?: boolean; traceRng?: boolean; strictRngTrace?: boolean; interTickRandDraws?: number; interTickRandDrawsByTick?: Map<number, number> | null; spawnEntries?: readonly SpawnEntry[] | null; startWeaponId?: WeaponId | null } = {}): PlaybackDriver {
  // Build the canonical headless/verification replay driver.

  const maxTicks = opts.maxTicks ?? null;
  const warnOnVersionMismatch = opts.warnOnVersionMismatch ?? true;
  const traceRng = opts.traceRng ?? false;
  const strictRngTrace = opts.strictRngTrace ?? false;
  const interTickRandDraws = opts.interTickRandDraws ?? 0;
  const interTickRandDrawsByTick = opts.interTickRandDrawsByTick ?? null;
  const spawnEntries = opts.spawnEntries ?? null;
  const startWeaponId = opts.startWeaponId ?? null;
  return new PlaybackDriver(replay, { maxTicks: maxTicks, traceRng: traceRng, strictRngTrace: strictRngTrace, versionMismatchAction: warnOnVersionMismatch ? 'verification' : null, interTickRandDraws: int(interTickRandDraws), interTickRandDrawsByTick: interTickRandDrawsByTick, spawnEntries: spawnEntries, startWeaponId: startWeaponId });
}

export function buildRuntimePlaybackDriver(replay: Replay, opts: { maxTicks: number | null; traceRng: boolean; worldSize: number; spawnEntries?: readonly SpawnEntry[] | null; startWeaponId?: WeaponId | null }): PlaybackDriver {
  // Build the canonical live replay-playback driver.

  const maxTicks = opts.maxTicks;
  const traceRng = opts.traceRng;
  const worldSize = opts.worldSize;
  const spawnEntries = opts.spawnEntries ?? null;
  const startWeaponId = opts.startWeaponId ?? null;
  return new PlaybackDriver(replay, { maxTicks: maxTicks, traceRng: traceRng, versionMismatchAction: null, worldSize: worldSize, spawnEntries: spawnEntries, startWeaponId: startWeaponId });
}
