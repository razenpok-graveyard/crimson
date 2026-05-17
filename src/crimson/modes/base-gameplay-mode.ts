// Port of crimson/modes/base_gameplay_mode.py

import { type AudioState, audioUpdate, audioStopMusic } from '@grim/audio.ts';
import { type CrimsonConfig, fxDetailEnabled } from '@grim/config.ts';
import type { RuntimeResources } from '@grim/assets.ts';
import { type ConsoleState } from '@grim/console.ts';
import { type SmallFontData, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { drawSmallText } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { type CrandLike } from '@grim/rand.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { InputState } from '@grim/input.ts';
import { type GroundRenderer } from '@grim/terrain-render.ts';
import { debugEnabled } from '@crimson/debug.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { LocalInputInterpreter, clearInputEdges } from '@crimson/local-input.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { perkCountGet } from '@crimson/perks/helpers.ts';
import { creatureFindInRadius } from '@crimson/perks/runtime/effects-context.ts';
import { perkSelectionOpenChoices } from '@crimson/perks/selection.ts';
import { WorldRenderer } from '@crimson/render/world/renderer.ts';
import type { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import { RtxRenderMode } from '@crimson/render/rtx/mode.ts';
import { GameOverUi } from '@crimson/screens/results/game-over.ts';
import { type PresentationTickOutput, applyPresentationOutputs, applySimMetadataTickResult } from '@crimson/sim/batch-apply.ts';
import { FixedStepClock } from '@crimson/sim/clock.ts';
import { advanceTickRunnerFrame } from '@crimson/sim/frame-pump.ts';
import { type LanFrameSample, type LanSyncCallbacks, type TickResult } from '@crimson/sim/hooks.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import { type FrameContext, type GameCommand, InputStatus, LocalInputProvider, PerkMenuOpenCommand, PerkPickCommand, TickSupply } from '@crimson/sim/input-providers.ts';
import { PostApplyReaction, applyPostApplyReaction, buildPostApplyReaction } from '@crimson/sim/presentation-reactions.ts';
import type { DeterministicSession, DeterministicSessionTick } from '@crimson/sim/sessions.ts';
import { TickBatchResult, TickRunner } from '@crimson/sim/tick-runner.ts';
import type { TerrainSlotTriplet } from '@crimson/terrain-slots.ts';
import { drawTargetHealthBar, HudState } from '@crimson/ui/hud.ts';
import { WorldRuntime } from '@crimson/world/runtime.ts';
import { shotsFromState, buildHighscoreRecordForGameOver } from './components/highscore-record-builder.ts';
import { PerkMenuUiContext as FullPerkMenuUiContext } from './components/perk-menu-controller.ts';
import type { CreatureDeath, CreaturePool } from '@crimson/creatures/runtime.ts';
import type { GameState, GameStateStatus } from '@crimson/game/types.ts';
import type { SimWorldState } from '@crimson/world/sim-world-state.ts';
import type { RenderResources } from '@crimson/world/render-resources.ts';
import type { AudioBridge } from '@crimson/world/audio-bridge.ts';
import type { TerrainRuntime } from '@crimson/world/terrain-runtime.ts';
import type { PresentationStepCommands } from '@crimson/sim/presentation-step.ts';
import type { TerrainFxBatch } from '@crimson/sim/terrain-fx.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import type { WorldEvents } from '@crimson/sim/world-state.ts';

interface ReplayRecorder {
  tickIndex: number;
  recordedTickCount: number;
  recordTick(inputs: readonly PlayerInput[], opts?: { commands?: GameCommand[] | null; dt?: number | null }): number;
  finish(): object;
}

interface ReplayCheckpoint {
  tickIndex: number;
  elapsedMs: number;
  deaths: readonly CreatureDeath[] | null;
  events: WorldEvents | null;
}

type LanRuntimeHandle = object;
type NetReplaySnapshotState = object | null;
type NetRuntimeSnapshotPayload = Record<string, string | number | boolean | object | null>;

export type GameStatus = GameStateStatus;
type GameStatusData = GameStateStatus;

interface AppliedBatchTick {
  tick: DeterministicSessionTick;
  replayTickIndex: number | null;
  frameTickIndex: number | null;
}

interface BatchApplyOutcome {
  readonly ticksApplied: number;
  readonly stopped: boolean;
  readonly stopAfterFinalize: boolean;
  readonly presentationOutputs: readonly PresentationTickOutput[];
  readonly postApplyReactions: readonly PostApplyReaction[];
}

function emptyBatchOutcome(): BatchApplyOutcome {
  return {
    ticksApplied: 0,
    stopped: false,
    stopAfterFinalize: false,
    presentationOutputs: [],
    postApplyReactions: [],
  };
}

interface ModeFrameState {
  readonly dt: number;
  readonly dtUiMs: number;
}

export type LanStepAction = 'continue' | 'stop_before_finalize' | 'stop_after_finalize';

export type LanSession = DeterministicSession;

class LanRuntimeInputProvider {
  private readonly _captureClockRate: number;
  private _captureClock: FixedStepClock;
  private _popBlocked = false;

  constructor(opts: { playerCount: number; tickRate: number }) {
    this._captureClockRate = Math.max(1, int(opts.tickRate));
    this._captureClock = new FixedStepClock({ tickRate: this._captureClockRate });
  }

  get popBlocked(): boolean {
    return this._popBlocked;
  }

  get captureTickDt(): number {
    return this._captureClock.dtTick;
  }

  advanceCaptureTicks(dt: number): number {
    return this._captureClock.advance(dt);
  }

  resetCaptureClock(): void {
    this._captureClock.reset();
  }

  beginFrame(_frameCtx: FrameContext): void {
    this._popBlocked = false;
  }

  takeFrameSample(_runnerTickIndex: number): LanFrameSample | null {
    return null;
  }

  pullTick(_tickIndex: number, _defaultDtSeconds: number): TickSupply {
    return new TickSupply({ status: InputStatus.STALLED });
  }

  supportsCommandSubmission(): boolean {
    return false;
  }

  submitCommand(_command: GameCommand): void {}

  bindRuntime(_runtime: LanRuntimeHandle | null | undefined): void {}
  setRole(_role: string): void {}
  setBeforePop(_callback: (() => boolean) | null): void {}
}

const LAN_SIM_DETAIL_PRESET = 5;
const LAN_SIM_VIOLENCE_DISABLED = 0;

export class BaseGameplayMode {
  protected _assetsRoot: string;
  protected _small: SmallFontData | null = null;
  protected _hudState: HudState;
  defaultGameModeId: GameMode;
  config: CrimsonConfig;
  protected _console: ConsoleState | null;
  protected _baseDir: string;

  closeRequested = false;
  protected _action: string | null = null;
  protected _paused = false;
  protected _statusBase: GameStatus | null = null;
  protected _statusSim: GameStatus | null = null;
  protected _lanStatus: GameStatus | null = null;
  protected _lanStatusData: GameStatusData | null = null;
  protected _localInput: LocalInputInterpreter;
  protected _gameOverUi: GameOverUi;

  assetsDir: string;
  worldSize: number;
  demoModeActive: boolean;
  questFailRetryCount: number;
  hardcore: boolean;
  preserveBugs: boolean;
  audio: AudioState | null;
  audioRng: CrandLike;
  rtxMode: RtxRenderMode;

  protected _worldRuntime: WorldRuntime;
  simWorld: SimWorldState;
  renderResources: RenderResources;
  audioBridge: AudioBridge;
  terrainRuntime: TerrainRuntime;
  renderer: WorldRenderer;

  protected _gameOverActive = false;
  protected _gameOverRecord: HighScoreRecord | null = null;
  protected _gameOverBanner = 'reaper';

  protected _uiMouse: Vec2 = new Vec2();
  protected _cursorPulseTime = 0.0;
  protected _lastDtMs = 0.0;
  protected _screenFade: GameState | null = null;
  protected _terrainRegenCounter = 0;
  protected _runResetSeed = 0;
  protected _replayRecorder: ReplayRecorder | null = null;
  protected _replayCheckpoints: ReplayCheckpoint[] = [];
  protected _replayCheckpointsSampleRate = 60;
  protected _replayCheckpointsLastTick: number | null = null;
  protected _lanRuntime: LanRuntimeHandle | null = null;
  protected _rollbackRuntime: LanRuntimeHandle | null = null;
  protected _lanLocalSlotIndex = 0;
  protected _lanSeedOverride: number | null = null;
  protected _lanStartTick = 0;
  protected _lanEnabled = false;
  protected _lanRole = '';
  protected _lanExpectedPlayers = 1;
  protected _lanConnectedPlayers = 1;
  protected _lanWaitingForPlayers = false;
  protected _lanTraceLastMs = -1000.0;
  protected _lanTerrainPendingLast = false;
  protected _lanTerrainPendingSinceMs = 0;
  protected _lanInitialTerrainReady = false;
  protected _runtimeUpdatesPerFrame = 0;
  protected _inputStallCount = 0;
  protected _ticksAdvancedPerFrame = 0;
  protected _simMs = 0.0;
  protected _presentationPlanMs = 0.0;
  protected _presentationApplyMs = 0.0;
  protected _queuedInputCommands: GameCommand[] = [];
  protected _networkInputProvider: LanRuntimeInputProvider;
  protected _simSession: DeterministicSession | null = null;
  protected _tickInputProvider: LocalInputProvider | LanRuntimeInputProvider | null = null;
  protected _tickRunner: TickRunner | null = null;
  protected _tickRunnerSession: DeterministicSession | null = null;
  protected _tickRunnerIsNetworked = false;
  protected _tickRunnerNetworkRole = '';
  protected _tickRunnerFrameIndex = 0;
  protected _tickRunnerNextTickIndex = 0;
  protected _tickRunnerLocalClock: FixedStepClock | null = null;

  state!: GameplayState;
  creatures!: CreaturePool;
  player!: PlayerState;

  constructor(
    opts: {
      assetsUrl?: string;
      worldSize: number;
      defaultGameModeId: GameMode;
      demoModeActive?: boolean;
      questFailRetryCount?: number;
      hardcore?: boolean;
      baseDir?: string;
      config: CrimsonConfig;
      console?: ConsoleState | null;
      audio?: AudioState | null;
      audioRng: CrandLike;
      preserveBugs?: boolean;
    },
  ) {
    this._assetsRoot = opts.assetsUrl ?? '';
    this._small = null;
    this._hudState = new HudState();
    this.defaultGameModeId = opts.defaultGameModeId;

    this.config = opts.config;
    this._console = opts.console ?? null;
    this._baseDir = opts.baseDir ?? '';

    this.closeRequested = false;
    this._action = null;
    this._paused = false;
    this._localInput = new LocalInputInterpreter();
    this._gameOverUi = new GameOverUi({
      assetsRoot: this._assetsRoot,
      baseDir: this._baseDir,
      config: opts.config,
      preserveBugs: opts.preserveBugs ?? false,
    });

    this.assetsDir = opts.assetsUrl ?? '';
    this.worldSize = opts.worldSize;
    this.demoModeActive = opts.demoModeActive ?? false;
    this.questFailRetryCount = opts.questFailRetryCount ?? 0;
    this.hardcore = opts.hardcore ?? false;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.audio = opts.audio ?? null;
    this.audioRng = opts.audioRng;
    this.rtxMode = RtxRenderMode.CLASSIC;

    this._worldRuntime = new WorldRuntime({
      assetsUrl: this.assetsDir,
      worldSize: this.worldSize,
      demoModeActive: this.demoModeActive,
      questFailRetryCount: this.questFailRetryCount,
      hardcore: this.hardcore,
      preserveBugs: this.preserveBugs,
      config: this.config,
      audio: this.audio,
      audioRng: this.audioRng,
      rtxMode: this.rtxMode,
    });
    this.simWorld = this._worldRuntime.simWorld;
    this.renderResources = this._worldRuntime.renderResources;
    this.audioBridge = this._worldRuntime.audioBridge;
    this.terrainRuntime = this._worldRuntime.terrainRuntime;
    this.renderer = this._worldRuntime.renderer;

    this._setCameraVec(new Vec2(-1.0, -1.0));
    this.lanPlayerRingsEnabled = false;
    this.lanLocalAimIndicatorsOnly = false;
    this.lanLocalPlayerSlotIndex = 0;
    this._syncWorldRuntimeConfig();

    const playerCount = this._runtimePlayerCount();
    this._worldRuntime.reset({ seed: 0xBEEF, playerCount: Math.max(1, Math.min(4, playerCount)) });
    this._bindWorld();

    this._gameOverActive = false;
    this._gameOverRecord = null;
    this._gameOverBanner = 'reaper';

    this._uiMouse = new Vec2();
    this._cursorPulseTime = 0.0;
    this._lastDtMs = 0.0;
    this._screenFade = null;
    this._terrainRegenCounter = 0;
    this._runResetSeed = 0;
    this._replayRecorder = null;
    this._replayCheckpoints = [];
    this._replayCheckpointsSampleRate = 60;
    this._replayCheckpointsLastTick = null;
    this._lanRuntime = null;
    this._rollbackRuntime = null;
    this._lanLocalSlotIndex = 0;
    this._lanSeedOverride = null;
    this._lanStartTick = 0;
    this._lanEnabled = false;
    this._lanRole = '';
    this._lanExpectedPlayers = 1;
    this._lanConnectedPlayers = 1;
    this._lanWaitingForPlayers = false;
    this._lanTraceLastMs = -1000.0;
    this._lanTerrainPendingLast = false;
    this._lanTerrainPendingSinceMs = 0;
    this._lanInitialTerrainReady = false;
    this._runtimeUpdatesPerFrame = 0;
    this._inputStallCount = 0;
    this._ticksAdvancedPerFrame = 0;
    this._simMs = 0.0;
    this._presentationPlanMs = 0.0;
    this._presentationApplyMs = 0.0;
    this._queuedInputCommands = [];
    this._networkInputProvider = new LanRuntimeInputProvider({
      playerCount: Math.max(0, this.simWorld.players.length),
      tickRate: this._deterministicTickRate(),
    });
    this._simSession = null;
    this._tickInputProvider = null;
    this._tickRunner = null;
    this._tickRunnerSession = null;
    this._tickRunnerIsNetworked = false;
    this._tickRunnerNetworkRole = '';
    this._tickRunnerFrameIndex = 0;
    this._tickRunnerNextTickIndex = 0;
    this._tickRunnerLocalClock = null;
  }


  get worldRuntime(): WorldRuntime {
    return this._worldRuntime;
  }

  get camera(): Vec2 {
    return this._worldRuntime.camera;
  }

  protected _setCameraVec(value: Vec2): void {
    this._worldRuntime.camera = value;
  }

  get lanPlayerRingsEnabled(): boolean {
    return Boolean(this._worldRuntime.lanPlayerRingsEnabled);
  }

  set lanPlayerRingsEnabled(value: boolean) {
    this._worldRuntime.lanPlayerRingsEnabled = Boolean(value);
  }

  get lanLocalAimIndicatorsOnly(): boolean {
    return Boolean(this._worldRuntime.lanLocalAimIndicatorsOnly);
  }

  set lanLocalAimIndicatorsOnly(value: boolean) {
    this._worldRuntime.lanLocalAimIndicatorsOnly = Boolean(value);
  }

  get lanLocalPlayerSlotIndex(): number {
    return int(this._worldRuntime.lanLocalPlayerSlotIndex);
  }

  set lanLocalPlayerSlotIndex(value: number) {
    this._worldRuntime.lanLocalPlayerSlotIndex = int(value);
  }


  protected _syncWorldRuntimeConfig(): void {
    const runtime = this._worldRuntime;
    runtime.worldSize = this.worldSize;
    runtime.demoModeActive = this.demoModeActive;
    runtime.questFailRetryCount = this.questFailRetryCount;
    runtime.hardcore = this.hardcore;
    runtime.preserveBugs = this.preserveBugs;
    runtime.config = this.config;
    runtime.audio = this.audio;
    runtime.audioRng = this.audioRng;
    runtime.rtxMode = this.rtxMode;
  }


  applyTerrainSetup(opts: { terrainSlots: TerrainSlotTriplet; seed: number }): void {
    this.terrainRuntime.applyTerrainSetup({ terrainSlots: opts.terrainSlots, seed: opts.seed });
  }


  protected _drawWorld(opts?: { drawAimIndicators?: boolean; entityAlpha?: number }): void {
    this._worldRuntime.draw({
      drawAimIndicators: opts?.drawAimIndicators ?? true,
      entityAlpha: opts?.entityAlpha ?? 1.0,
    });
  }


  worldToScreen(pos: Vec2): Vec2 {
    return this.renderer.worldToScreen(pos);
  }

  screenToWorld(pos: Vec2): Vec2 {
    return this.renderer.screenToWorld(pos);
  }


  protected _refreshEffectiveStatus(opts: { resetLanStatus: boolean }): void {
    if (this._lanEnabled) {
      if (opts.resetLanStatus || this._lanStatus === null) {
        this._lanStatus = null; // No LAN status in WebGL
      }
      this._statusSim = this._lanStatus;
    } else {
      this._lanStatus = null;
      this._lanStatusData = null;
      this._statusSim = this._statusBase;
    }
    // Keep the currently-bound world state in sync (note that `open()` resets
    // the underlying simulation state, so `_bindWorld()` also re-applies it).
    this.state.status = this._statusSim;
  }


  bindLanRuntime(_runtime: LanRuntimeHandle | null): void {
    // No LAN in WebGL port
  }

  setLanMatchStart(_opts: { seed: number; startTick?: number; status?: GameStatusData | null }): void {
    // No LAN in WebGL port
  }


  protected _cvarFloat(name: string, defaultVal: number = 0.0): number {
    const console_ = this._console;
    if (console_ === null) return defaultVal;
    const cvar = console_.cvars.get(name);
    if (cvar == null) return defaultVal;
    return Number(cvar.valueF ?? defaultVal);
  }

  protected _hudSmallIndicators(): boolean {
    return this._cvarFloat('cv_uiSmallIndicators', 0.0) !== 0.0;
  }

  protected _lanPlayerRingsEnabled(): boolean {
    if (!this._lanEnabled) return false;
    return this._cvarFloat('cv_lanPlayerRings', 0.0) !== 0.0;
  }

  protected _syncLanVisualFlags(): void {
    this.lanPlayerRingsEnabled = this._lanPlayerRingsEnabled();
    this.lanLocalAimIndicatorsOnly = this._lanEnabled;
    this.lanLocalPlayerSlotIndex = Math.max(0, Math.min(3, this._lanLocalSlotIndex));
  }


  protected _configGameModeId(): GameMode {
    try {
      return this.config.gameplay.mode;
    } catch {
      return GameMode.DEMO;
    }
  }


  protected _drawTargetHealthBar(opts?: { alpha?: number }): void {
    const alpha = opts?.alpha ?? 1.0;
    const creatures = this.creatures.entries;
    if (!creatures || creatures.length === 0) return;

    const targetIndices: number[] = [];
    const targetPlayers = this.state.preserveBugs
      ? this.simWorld.players.slice(0, 1)
      : this.simWorld.players;

    for (const targetPlayer of targetPlayers) {
      if (!this.state.preserveBugs && targetPlayer.health <= 0.0) continue;
      if (perkCountGet(targetPlayer, PerkId.DOCTOR) <= 0) continue;
      const targetIdx = creatureFindInRadius(
        creatures,
        { pos: targetPlayer.aim, radius: 12.0, startIndex: 0 },
      );
      if (targetIdx === -1) continue;
      if (targetIndices.indexOf(targetIdx) !== -1) continue;
      targetIndices.push(targetIdx);
    }

    for (const targetIdx of targetIndices) {
      const creature = creatures[targetIdx];
      if (!creature.active) continue;
      const hp = Number(creature.hp);
      const maxHp = Number(creature.maxHp);
      if (maxHp <= 0.0) continue;

      let ratio = hp / maxHp;
      if (ratio < 0.0) ratio = 0.0;
      if (ratio > 1.0) ratio = 1.0;

      const screenLeft = this.worldToScreen(creature.pos.add(new Vec2(-32.0, 32.0)));
      const screenRight = this.worldToScreen(creature.pos.add(new Vec2(32.0, 32.0)));
      const width = screenRight.x - screenLeft.x;
      if (width <= 1e-3) continue;
      drawTargetHealthBar({
        pos: screenLeft,
        width,
        ratio,
        alpha,
        scale: width / 64.0,
      });
    }
  }


  protected _bindWorld(): void {
    this.state = this.simWorld.state;
    this.creatures = this.simWorld.creatures;
    this.player = this.simWorld.players[0];
    const preserveBugs = this.state.preserveBugs;
    this._localInput.setPreserveBugs(preserveBugs);
    this._hudState.preserveBugs = preserveBugs;
    this._gameOverUi.preserveBugs = preserveBugs;
    // `GameplayState.status` is the simulation status (LAN may override it
    // with a deterministic session-local status to avoid split brain).
    this.state.status = this._statusSim;
  }


  protected _anyPlayerAlive(): boolean {
    return this.simWorld.players.some((p) => p.health > 0.0);
  }


  get saveStatus(): GameStatus | null {
    return this._statusBase;
  }

  get simStatus(): GameStatus | null {
    return this._statusSim;
  }

  bindStatus(status: GameStatus | null): void {
    this._statusBase = status;
    this._refreshEffectiveStatus({ resetLanStatus: false });
  }

  bindScreenFade(fade: GameState | null): void {
    this._screenFade = fade;
  }

  bindRuntimeResources(resources: RuntimeResources | null): void {
    this.renderResources.resources = resources;
  }

  bindAudio(audio: AudioState | null, audioRng: CrandLike): void {
    this.audio = audio;
    this.audioRng = audioRng;
    this._worldRuntime.audio = audio;
    this._worldRuntime.audioRng = audioRng;
  }

  setRtxMode(mode: RtxRenderMode): void {
    this.rtxMode = mode;
    this._worldRuntime.rtxMode = mode;
  }


  protected _updateAudio(dt: number): void {
    if (this.audio !== null) {
      audioUpdate(this.audio, dt);
    }
  }


  protected _uiLineHeight(scale: number = 1.0): number {
    if (this._small !== null) {
      return int(this._small.cellSize * scale);
    }
    return int(20 * scale);
  }

  protected _uiTextWidth(text: string, _scale: number = 1.0): number {
    const font = this._small;
    if (font === null) throw new Error('small font must be loaded before ui text measurement');
    return int(measureSmallTextWidth(font, text));
  }

  protected _drawUiText(
    text: string,
    pos: Vec2,
    color: wgl.Color,
    _scale: number = 1.0,
  ): void {
    const font = this._small;
    if (font === null) throw new Error('small font must be loaded before ui text draw');
    drawSmallText(font, text, pos, color);
  }


  protected _perkMenuPlaySfx(): ((id: SfxId) => void) | null {
    return (id: SfxId) => this.audioBridge.router.playSfx(id);
  }

  protected _perkMenuUiContext(): FullPerkMenuUiContext {
    return new FullPerkMenuUiContext({
      player: this.player,
      resources: this.renderResources.resources,
      mouse: this._uiMousePos(),
      violenceDisabled: this.config.display.violenceDisabled,
      preserveBugs: this.state.preserveBugs ?? false,
      fxDetail: fxDetailEnabled(this.config.display, 0),
      playSfx: this._perkMenuPlaySfx(),
    });
  }

  protected _openPerkMenuUi(opts: {
    menu: { active: boolean; openMenu?(opts: { playSfx?: ((sfx: SfxId) => void) | null }): void };
    players: PlayerState[];
    gameMode: GameMode;
    playerCount: number;
  }): void {
    if (opts.menu.active) return;

    const perkCtx = this._perkMenuUiContext();
    const recorder = this._replayRecorder;
    if (recorder !== null) {
      this._recordReplayCheckpoint(Math.max(0, recorder.tickIndex - 1), { force: true });
    }

    const choices = perkSelectionOpenChoices(
      this.state,
      opts.players,
      this.state.perkSelection,
      { gameMode: opts.gameMode, playerCount: opts.playerCount },
    );
    if (!choices || (Array.isArray(choices) && choices.length === 0)) {
      throw new Error('perk menu open requires prepared perk choices');
    }

    opts.menu.openMenu?.({ playSfx: perkCtx.playSfx });
    this.enqueueInputCommand(new PerkMenuOpenCommand({ playerIndex: 0 }));
  }

  protected _uiMousePos(): Vec2 {
    return this._uiMouse;
  }


  protected _updateUiMouse(): void {
    const [mx, my] = InputState.mousePosition();
    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    this._uiMouse = new Vec2(
      Math.max(0.0, Math.min(mx, Math.max(0.0, screenW - 1.0))),
      Math.max(0.0, Math.min(my, Math.max(0.0, screenH - 1.0))),
    );
  }


  protected _tickFrame(dt: number, opts?: { clampCursorPulse?: boolean }): [number, number] {
    dt = Number(dt);
    const dtUiMs = Math.min(dt, 0.1) * 1000.0;
    this._lastDtMs = dtUiMs;

    this._updateUiMouse();
    this._traceLanStateHeartbeat();

    const pulseDt = opts?.clampCursorPulse ? Math.min(dt, 0.1) : dt;
    this._cursorPulseTime += pulseDt * 1.1;

    return [dt, dtUiMs];
  }


  protected _beginModeUpdate(dt: number): ModeFrameState | null {
    this._updateAudio(dt);

    const [frameDt, frameDtUiMs] = this._tickFrame(dt);
    this._resetFrameTelemetry();
    this._handleInput();
    if (this._action === 'open_pause_menu') {
      return null;
    }
    return { dt: frameDt, dtUiMs: frameDtUiMs };
  }


  protected _handleInput(): void {
    throw new Error('_handleInput() must be implemented by subclass');
  }


  setRuntimeUpdatesPerFrame(value: number): void {
    this._runtimeUpdatesPerFrame = Math.max(0, int(value));
  }

  enqueueInputCommand(command: GameCommand): void {
    const provider = this._tickInputProvider;
    if (provider === null) {
      this._queuedInputCommands.push(command);
      return;
    }
    if (!provider.supportsCommandSubmission()) {
      this._queuedInputCommands.push(command);
      return;
    }
    provider.submitCommand(command);
  }

  protected _flushQueuedInputCommands(opts: {
    provider: LocalInputProvider | LanRuntimeInputProvider;
  }): void {
    if (this._queuedInputCommands.length === 0) return;
    if (!opts.provider.supportsCommandSubmission()) return;
    for (const command of this._queuedInputCommands) {
      opts.provider.submitCommand(command);
    }
    this._queuedInputCommands.length = 0;
  }

  recordPerkPickCommand(choiceIndex: number, opts?: { playerIndex?: number }): void {
    this.enqueueInputCommand(
      new PerkPickCommand({ playerIndex: opts?.playerIndex ?? 0, choiceIndex: int(choiceIndex) }),
    );
  }


  protected _sessionElapsedMs(): number {
    const session = this._simSession;
    if (session === null) throw new Error('session elapsed requested without an active deterministic session');
    return Number(session.elapsedMs);
  }

  protected _replayCheckpointElapsedMs(): number {
    return Number(this.simWorld.presentationElapsedMs);
  }

  protected _replayClaimedStatsComplete(): boolean {
    return false;
  }

  protected _replayClaimedStatsElapsedMs(): number {
    return int(this._replayCheckpointElapsedMs());
  }

  protected _replayClaimedShots(): [number, number] {
    return shotsFromState(this.state, { playerIndex: this.player.index });
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: object }): string {
    const modeName = this.constructor.name.replace('Mode', '').toLowerCase() || 'replay';
    return `${modeName}_${opts.stamp}`;
  }

  protected _replaySkipSaveWhenEmpty(_opts: { recorder: ReplayRecorder }): boolean {
    return false;
  }


  protected _recordReplayCheckpoint(
    tickIndex: number,
    opts?: {
      force?: boolean;
      deaths?: readonly CreatureDeath[] | null;
      events?: WorldEvents | null;
    },
  ): void {
    const recorder = this._replayRecorder;
    if (recorder === null) return;
    if (tickIndex < 0) return;
    const force = opts?.force ?? false;
    if (!force && (tickIndex % (this._replayCheckpointsSampleRate || 1)) !== 0) return;
    if (this._replayCheckpointsLastTick === tickIndex) return;
    this._replayCheckpoints.push({
      tickIndex,
      elapsedMs: this._replayCheckpointElapsedMs(),
      deaths: opts?.deaths ?? null,
      events: opts?.events ?? null,
    });
    this._replayCheckpointsLastTick = tickIndex;
  }


  protected _saveReplay(): void {
    // Replay saving is not applicable in the WebGL port.
    this._replayRecorder = null;
    this._replayCheckpoints.length = 0;
    this._replayCheckpointsLastTick = null;
  }


  frameTelemetry(): [number, number, number, number, number, number] {
    return [
      this._runtimeUpdatesPerFrame,
      this._inputStallCount,
      this._ticksAdvancedPerFrame,
      this._simMs,
      this._presentationPlanMs,
      this._presentationApplyMs,
    ];
  }

  protected _resetFrameTelemetry(): void {
    this._inputStallCount = 0;
    this._ticksAdvancedPerFrame = 0;
    // Placeholder stage timers before profiler hooks land in later slices.
    this._simMs = 0.0;
    this._presentationPlanMs = 0.0;
    this._presentationApplyMs = 0.0;
  }


  setLanRuntime(_opts: {
    enabled: boolean;
    role: string;
    expectedPlayers: number;
    connectedPlayers: number;
    waitingForPlayers: boolean;
  }): void {
    // No LAN in WebGL port
  }

  protected _lanWaitGateActive(): boolean {
    if (!this._lanEnabled) return false;
    if (!this._lanWaitingForPlayers) return false;
    return this._lanConnectedPlayers < this._lanExpectedPlayers;
  }

  protected _lanTerrainGenerationPending(): boolean {
    return false;
  }

  protected _traceLanTerrainGeneration(): void {
    // No LAN terrain generation tracking in WebGL
  }

  protected _traceLanStateHeartbeat(): void {
    // No LAN heartbeat in WebGL
  }


  protected _drawLanDebugInfo(
    _opts: { x: number; y: number; lineH: number },
  ): number {
    return _opts.y;
  }


  protected _drawLanWaitOverlay(): void {
    // No LAN wait overlay in WebGL
  }


  protected _netReplaySnapshotState(): NetReplaySnapshotState {
    return null;
  }

  protected _storeNetRuntimeSnapshot(_opts: NetRuntimeSnapshotPayload): void {}

  protected _consumeNetRuntimeRecovery(_opts: { modeName: string }): void {}

  protected _applyResyncSnapshot(_snapshot: NetRuntimeSnapshotPayload): void {
    throw new Error(`${this.constructor.name}._applyResyncSnapshot() must be implemented`);
  }


  protected _playerNameDefault(): string {
    return String(this.config.profile.playerName || '');
  }

  protected _runtimePlayerCount(): number {
    return this.config.gameplay.playerCount;
  }

  protected _deterministicDetailPreset(): number {
    if (this._lanEnabled) return LAN_SIM_DETAIL_PRESET;
    return this.config.display.detailPreset;
  }

  protected _deterministicViolenceDisabled(): number {
    if (this._lanEnabled) return LAN_SIM_VIOLENCE_DISABLED;
    return this.config.display.violenceDisabled;
  }


  update(dt: number): void {
    throw new Error(`${this.constructor.name}.update() must be implemented by gameplay mode`);
  }

  draw(): void {
    throw new Error(`${this.constructor.name}.draw() must be implemented by gameplay mode`);
  }


  protected get _debugEnabled(): boolean {
    return debugEnabled();
  }


  protected _screenSize(): [number, number] {
    return [wgl.getScreenWidth(), wgl.getScreenHeight()];
  }


  protected _shotsFromState(playerIndex: number): [number, number] {
    return shotsFromState(this.state, { playerIndex });
  }


  protected _buildHighscoreRecordForGameOver(opts: {
    survivalElapsedMs: number;
    creatureKillCount: number;
    gameModeId: GameMode;
    shotsFired?: number | null;
    shotsHit?: number | null;
    clampShotsHit?: boolean;
  }): HighScoreRecord {
    return buildHighscoreRecordForGameOver({
      state: this.state,
      player: this.player,
      ...opts,
    });
  }


  protected _handlePerkMenuInput(_choices: readonly PerkId[], _dtUiMs: number): number | null {
    return null;
  }

  protected _pollPerkOpenRequest(_opts: {
    pendingCount: number;
    playerCount: number;
    anyAlive: boolean;
    paused: boolean;
    menuActive: boolean;
  }): boolean {
    return false;
  }

  protected _tickPerkPromptTimer(_opts: {
    pendingCount: number;
    anyAlive: boolean;
    paused: boolean;
    menuActive: boolean;
    dtUiMs: number;
  }): void {}

  protected _tickPerkPromptPulse(_dtUiMs: number): void {}

  protected _tickPerkMenuTimeline(_dtUiMs: number): void {}

  protected _drawPerkPrompt(_opts: {
    pendingCount: number;
    anyAlive: boolean;
    menuActive: boolean;
    textColor: wgl.Color;
    promptScale: number;
  }): void {}

  protected _drawPerkMenu(_choices: readonly PerkId[]): void {}


  open(): void {
    this.closeRequested = false;
    this._action = null;
    this._paused = false;
    if (this._screenFade !== null && this._screenFade.resources !== null) {
      this.renderResources.resources = this._screenFade.resources;
    }
    this._small = this.renderResources.resources.smallFont;
    this._hudState = new HudState();

    this._gameOverActive = false;
    this._gameOverRecord = null;
    this._gameOverBanner = 'reaper';
    this._gameOverUi.close();

    // Native game_over/victory transitions call `sfx_mute_all` on menu + extra
    // tracks before restarting gameplay ("Play Again"), resetting first-hit tune gate.
    audioStopMusic(this.audio);

    const playerCount = this._runtimePlayerCount();
    let seed: number;
    if (this._lanSeedOverride !== null) {
      seed = this._lanSeedOverride;
    } else {
      seed = Number(this.state.rng.state);
    }
    this._runResetSeed = int(seed) >>> 0;

    // Reset LAN sim status at the start of each run so per-session usage
    // counts (weapon bias) start from a consistent baseline across peers.
    this._refreshEffectiveStatus({ resetLanStatus: true });

    this._syncWorldRuntimeConfig();
    this._worldRuntime.reset({ seed, playerCount: Math.max(1, Math.min(4, playerCount)) });
    this._worldRuntime.openRuntime();
    this._bindWorld();

    this._localInput.reset({ players: this.simWorld.players });
    this._networkInputProvider = new LanRuntimeInputProvider({
      playerCount: Math.max(0, this.simWorld.players.length),
      tickRate: this._deterministicTickRate(),
    });
    this._resetLanCaptureClock();
    this._resetTickRunnerState();
    this._resetReplayCaptureState({ clearRecorder: false });

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    this._uiMouse = new Vec2(screenW * 0.5, screenH * 0.5);
    this._cursorPulseTime = 0.0;
    this._lanTerrainPendingLast = false;
    this._lanTerrainPendingSinceMs = 0;
    this._lanInitialTerrainReady = false;
  }


  close(): void {
    this._gameOverUi.close();
    if (this._small !== null) {
      this._small = null;
    }
    this._resetTickRunnerState();
    this._resetReplayCaptureState({ clearRecorder: true });
    this._worldRuntime.closeRuntime();
  }


  takeAction(): string | null {
    const action = this._action;
    this._action = null;
    return action;
  }


  protected _enterGameOver(): void {
    throw new Error('_enterGameOver() must be implemented by subclass');
  }

  protected _updateGameOverUi(dt: number): void {
    let record = this._gameOverRecord;
    if (record === null) {
      this._enterGameOver();
      record = this._gameOverRecord;
    }
    if (record === null) return;

    const action = this._gameOverUi.update(dt, {
      record,
      playerNameDefault: this._playerNameDefault(),
      playSfx: (id: SfxId) => this.audioBridge.router.playSfx(id),
      rng: null,
      mouse: this._uiMousePos(),
    });
    if (action === 'play_again') {
      this.open();
      return;
    }
    if (action === 'high_scores') {
      this._action = 'open_high_scores';
      return;
    }
    if (action === 'main_menu') {
      this._action = 'back_to_menu';
      this.closeRequested = true;
    }
  }


  protected _worldEntityAlpha(): number {
    if (!this._gameOverActive) return 1.0;
    return Number(this._gameOverUi.worldEntityAlpha());
  }


  drawPauseBackground(opts?: { entityAlpha?: number }): void {
    let alpha = opts?.entityAlpha ?? 1.0;
    if (alpha < 0.0) alpha = 0.0;
    else if (alpha > 1.0) alpha = 1.0;
    this._drawWorld({
      drawAimIndicators: false,
      entityAlpha: this._worldEntityAlpha() * alpha,
    });
  }


  stealGroundForMenu(): GroundRenderer | null {
    const ground = this.renderResources.ground;
    this.renderResources.ground = null;
    return ground;
  }

  adoptGroundFromMenu(ground: GroundRenderer | null): void {
    if (ground === null) return;
    const current = this.renderResources.ground;
    if (current !== null && current !== ground) {
      current.destroy();
    }
    this.renderResources.ground = ground;
  }

  menuGroundCamera(): Vec2 {
    return this.camera;
  }


  consoleElapsedMs(): number {
    return Number(this.simWorld.presentationElapsedMs);
  }

  prepareDemoTrialOverlayFrame(): void {
    this._worldRuntime.updateCamera(0.0);
    this._syncAudioAndGround();
  }

  regenerateTerrainForConsole(): void {
    if (this.renderResources.ground === null) return;
    // Keep this deterministic without consuming gameplay RNG.
    this._terrainRegenCounter = (int(this._terrainRegenCounter) + 1) >>> 0;
    const terrainSeed = (int(this.state.rng.state) + int(this._terrainRegenCounter)) >>> 0;
    this.renderResources.ground.scheduleGenerate(terrainSeed);
  }


  protected _drawScreenFade(): void {
    let fadeAlpha = 0.0;
    if (this._screenFade !== null) {
      fadeAlpha = Number(this._screenFade.screenFadeAlpha);
    }
    if (fadeAlpha <= 0.0) return;
    const alpha = int(255 * Math.max(0.0, Math.min(1.0, fadeAlpha))) / 255;
    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    wgl.drawRectangle(0, 0, screenW, screenH, wgl.makeColor(0, 0, 0, alpha));
  }


  protected _buildLocalInputs(opts: { dt: number }): PlayerInput[] {
    return this._localInput.buildFrameInputs({
      players: this.simWorld.players,
      config: this.config,
      mouseScreen: this._uiMouse,
      screenToWorld: (pos: Vec2) => this.screenToWorld(pos),
      dt: opts.dt,
      creatures: this.creatures.entries,
    });
  }

  protected static _clearLocalInputEdges(inputs: readonly PlayerInput[]): PlayerInput[] {
    return clearInputEdges(inputs);
  }


  protected static _deterministicTickRate(): number {
    return 60;
  }

  protected _deterministicTickRate(): number {
    return 60;
  }

  protected _gameplayTickRate(): number {
    return this._deterministicTickRate();
  }

  protected _gameplayTickDt(_opts?: { session?: DeterministicSession | null }): number {
    return 1.0 / this._gameplayTickRate();
  }


  protected _resetGameplayFrameClock(): void {
    const clock = this._tickRunnerLocalClock;
    if (clock !== null) {
      clock.reset();
    }
  }

  protected _resetTickRunnerState(): void {
    this._tickInputProvider = null;
    this._tickRunner = null;
    this._tickRunnerSession = null;
    this._tickRunnerIsNetworked = false;
    this._tickRunnerNetworkRole = '';
    this._tickRunnerFrameIndex = 0;
    this._tickRunnerNextTickIndex = 0;
    this._tickRunnerLocalClock = null;
  }

  protected _resetReplayCaptureState(opts: { clearRecorder: boolean }): void {
    this._queuedInputCommands.length = 0;
    if (opts.clearRecorder) {
      this._replayRecorder = null;
    }
    this._replayCheckpoints.length = 0;
    this._replayCheckpointsLastTick = null;
  }


  protected _lanCaptureTickDt(): number {
    return this._networkInputProvider.captureTickDt;
  }

  protected _advanceLanCaptureTicks(dt: number): number {
    return this._networkInputProvider.advanceCaptureTicks(dt);
  }

  protected _resetLanCaptureClock(): void {
    this._networkInputProvider.resetCaptureClock();
  }


  protected _buildLanSyncCallbacks(_opts: {
    runtime: LanRuntimeHandle | null;
    lockstepRuntime: LanRuntimeHandle | null;
    role: string;
    provider: LanRuntimeInputProvider;
  }): LanSyncCallbacks {
    return {
      role: _opts.role,
      takeFrameSample: (_tickIndex: number) => null,
      broadcastTickFrame: null,
    };
  }


  protected _ensureTickRunner(opts: {
    session: DeterministicSession;
    isNetworked: boolean;
    lanRuntime?: LanRuntimeHandle | null;
    lockstepRuntime?: LanRuntimeHandle | null;
    role?: string;
  }): [TickRunner, LocalInputProvider | LanRuntimeInputProvider] {
    const runner = this._tickRunner;
    const provider = this._tickInputProvider;

    if (
      runner !== null &&
      provider !== null &&
      this._tickRunnerSession === opts.session &&
      this._tickRunnerIsNetworked === opts.isNetworked &&
      (!opts.isNetworked || this._tickRunnerNetworkRole === (opts.role ?? ''))
    ) {
      if (opts.isNetworked) {
        if (!(provider instanceof LanRuntimeInputProvider)) {
          throw new TypeError('networked tick runner provider must be LanRuntimeInputProvider');
        }
        provider.bindRuntime(opts.lanRuntime);
        provider.setRole(opts.role ?? '');
        provider.setBeforePop(null);
        this._tickRunnerLocalClock = null;
      } else if (this._tickRunnerLocalClock === null) {
        this._tickRunnerLocalClock = new FixedStepClock({ tickRate: this._gameplayTickRate() });
      }
      return [runner, provider];
    }

    let newProvider: LocalInputProvider | LanRuntimeInputProvider;
    if (opts.isNetworked) {
      const lanProvider = this._networkInputProvider;
      lanProvider.bindRuntime(opts.lanRuntime);
      lanProvider.setRole(opts.role ?? '');
      lanProvider.setBeforePop(null);
      newProvider = lanProvider;
    } else {
      newProvider = new LocalInputProvider({
        playerCount: Math.max(0, this.simWorld.players.length),
        buildInputs: (frameCtx: FrameContext) => this._buildLocalInputs({ dt: frameCtx.dtSeconds }),
      });
    }
    this._flushQueuedInputCommands({ provider: newProvider });

    const newRunner = new TickRunner({
      session: opts.session,
      inputProvider: newProvider,
      config: { traceRng: false },
    });
    this._tickRunner = newRunner;
    this._tickInputProvider = newProvider;
    this._tickRunnerSession = opts.session;
    this._tickRunnerIsNetworked = opts.isNetworked;
    this._tickRunnerNetworkRole = opts.isNetworked ? (opts.role ?? '') : '';
    this._tickRunnerFrameIndex = 0;
    this._tickRunnerNextTickIndex = 0;
    this._tickRunnerLocalClock = opts.isNetworked
      ? null
      : new FixedStepClock({ tickRate: this._gameplayTickRate() });
    return [newRunner, newProvider];
  }


  protected static _prepareLanTickSync(_opts: {
    tickResult: TickResult;
    callbacks: LanSyncCallbacks;
  }): void {
    // No LAN sync in WebGL
  }

  protected static _finalizeLanTickSync(_opts: {
    tickResult: TickResult;
    callbacks: LanSyncCallbacks;
  }): void {
    // No LAN sync in WebGL
  }


  protected _recordReplayCheckpointFromTick(opts: {
    tickIndex: number | null;
    tick: DeterministicSessionTick;
  }): void {
    if (opts.tickIndex === null) return;
    const worldEvents = opts.tick.step?.events;
    this._recordReplayCheckpoint(opts.tickIndex, {
      deaths: worldEvents?.deaths,
      events: worldEvents,
    });
  }


  protected _lanModeName(): 'survival' | 'rush' | 'quests' {
    throw new Error('_lanModeName() must be implemented by subclass');
  }

  protected _lanMatchSession(): DeterministicSession | null {
    throw new Error('_lanMatchSession() must be implemented by subclass');
  }

  protected _lanPrepareFrame(
    _role: string,
    _dtUiMs: number,
    _session: DeterministicSession,
    _dtTick: number,
  ): boolean {
    return true;
  }

  protected _lanAllowFramePop(): boolean {
    return true;
  }

  protected _lanOnTickApplied(
    _tick: DeterministicSessionTick,
    _frameTickIndex: number | null,
    _dtTick: number,
  ): LanStepAction {
    return 'continue';
  }

  protected _lanOnPaused(_dt: number): void {}


  protected _updateLanMatch(_opts: { dt: number; dtUiMs?: number }): void {
    // No LAN in WebGL port
  }

  protected _prepareLanMatchRuntime(_opts: { modeName: string }): string | null {
    return null;
  }

  protected _queueLanLocalInputs(_opts: {
    runtime: LanRuntimeHandle | null;
    ticksToCapture: number;
    dt: number;
  }): void {
    // No LAN in WebGL
  }

  protected _consumeLanTickFrames(_opts: {
    runtime: LanRuntimeHandle | null;
    lockstepRuntime: LanRuntimeHandle | null;
    session: DeterministicSession;
    role: string;
    dtTick: number;
  }): boolean {
    return false;
  }


  protected _syncAudioAndGround(): void {
    this._worldRuntime.syncAudioBridgeState();
    if (this.renderResources.ground !== null) {
      this.renderResources.ground.processPending();
    }
  }


  protected _applyBatchPresentationOutputs(opts: {
    outputs: readonly PresentationTickOutput[];
    postApplyReactions?: readonly PostApplyReaction[];
    applyAudio: boolean;
    updateCamera: boolean;
  }): void {
    const postApplyReactions = opts.postApplyReactions ?? [];
    if (postApplyReactions.length > 0 && postApplyReactions.length !== opts.outputs.length) {
      throw new Error('post-apply reactions must align with presentation outputs');
    }

    const reactionByTick = new Map<number, PostApplyReaction>();
    for (let i = 0; i < opts.outputs.length && i < postApplyReactions.length; i++) {
      reactionByTick.set(opts.outputs[i].tickIndex, postApplyReactions[i]);
    }

    applyPresentationOutputs({
      outputs: opts.outputs,
      syncAudioBridgeState: () => this._worldRuntime.syncAudioBridgeState(),
      applyAudioPlan: (plan: PresentationStepCommands, applyAudio: boolean) =>
        this.audioBridge.applyPlan({ plan, applyAudio }),
      applyTerrainFx: (batch: TerrainFxBatch) => this.renderResources.consumeTerrainFxBatch(batch),
      updateCamera: opts.updateCamera
        ? (dtSim: number) => this._worldRuntime.updateCamera(dtSim)
        : null,
      onOutputApplied: (output: PresentationTickOutput) => {
        const reaction = reactionByTick.get(output.tickIndex) ?? new PostApplyReaction();
        this._applyTickPostApplyReaction(reaction, { dtSeconds: Number(output.dtSim) });
      },
      applyAudio: opts.applyAudio,
    });
  }


  protected _buildTickPostApplyReaction(opts: { tickResult: TickResult }): PostApplyReaction {
    return buildPostApplyReaction({ tickResult: opts.tickResult });
  }

  protected _applyTickPostApplyReaction(
    reaction: PostApplyReaction,
    _opts: { dtSeconds: number },
  ): void {
    applyPostApplyReaction({
      reaction,
      playSfx: (id: SfxId) => this.audioBridge.router.playSfx(id),
    });
  }


  protected _processTickBatchResults(opts: {
    batch: TickBatchResult;
    session: DeterministicSession;
    recorder?: ReplayRecorder | null;
    lanSyncCallbacks?: LanSyncCallbacks | null;
    onTickApplied?: ((applied: AppliedBatchTick) => LanStepAction) | null;
    onCheckpoint?: ((replayTickIndex: number, tick: DeterministicSessionTick) => void) | null;
  }): BatchApplyOutcome {
    const {
      batch,
      session,
      recorder = null,
      lanSyncCallbacks = null,
      onTickApplied = null,
      onCheckpoint = null,
    } = opts;

    let ticksApplied = 0;
    let stopAfterFinalize = false;
    const presentationOutputs: PresentationTickOutput[] = [];
    const postApplyReactions: PostApplyReaction[] = [];

    for (const tickResult of batch.completedResults) {
      const tick = tickResult.payload;
      let replayTickIndex = tickResult.replayTickIndex;
      if (replayTickIndex === null && recorder !== null) {
        replayTickIndex = recorder.recordTick(
          [...tickResult.sourceTick.inputs],
          { commands: Array.from(tickResult.sourceTick.commands) },
        );
        tickResult.replayTickIndex = replayTickIndex;
      }

      const applied: AppliedBatchTick = {
        tick,
        replayTickIndex,
        frameTickIndex: null,
      };

      if (lanSyncCallbacks !== null) {
        BaseGameplayMode._prepareLanTickSync({ tickResult, callbacks: lanSyncCallbacks });
      }
      if (tickResult.lanSync !== null) {
        applied.frameTickIndex = tickResult.lanSync.frameTickIndex;
      }

      presentationOutputs.push(
        applySimMetadataTickResult({
          simWorld: this.simWorld,
          tickResult,
          gameTuneStarted: session.gameTuneStarted,
        }),
      );
      postApplyReactions.push(
        this._buildTickPostApplyReaction({ tickResult }),
      );
      this._ticksAdvancedPerFrame += 1;
      ticksApplied += 1;

      let action: LanStepAction = 'continue';
      if (onTickApplied !== null) {
        action = onTickApplied(applied);
      }
      if (action === 'stop_before_finalize') {
        return {
          ticksApplied,
          stopped: true,
          stopAfterFinalize: false,
          presentationOutputs,
          postApplyReactions,
        };
      }

      if (replayTickIndex !== null && onCheckpoint !== null) {
        onCheckpoint(replayTickIndex, tick);
      }

      if (lanSyncCallbacks !== null) {
        BaseGameplayMode._finalizeLanTickSync({ tickResult, callbacks: lanSyncCallbacks });
      }

      if (action === 'stop_after_finalize') {
        stopAfterFinalize = true;
        return {
          ticksApplied,
          stopped: true,
          stopAfterFinalize,
          presentationOutputs,
          postApplyReactions,
        };
      }
    }

    return {
      ticksApplied,
      stopped: false,
      stopAfterFinalize,
      presentationOutputs,
      postApplyReactions,
    };
  }


  protected _runDeterministicSessionTicks(opts: {
    dtFrame: number;
    session: DeterministicSession;
    recorder: ReplayRecorder | null;
    onTick: (tick: DeterministicSessionTick, replayTickIndex: number | null) => boolean;
    onCheckpoint?: ((replayTickIndex: number, tick: DeterministicSessionTick) => void) | null;
  }): void {
    if (opts.dtFrame <= 0.0) return;

    this._syncAudioAndGround();
    opts.session.detailPreset = this._deterministicDetailPreset();
    opts.session.violenceDisabled = this._deterministicViolenceDisabled();

    const [runner, provider] = this._ensureTickRunner({
      session: opts.session,
      isNetworked: false,
    });
    if (!(provider instanceof LocalInputProvider)) {
      throw new TypeError('local tick runner provider must be LocalInputProvider');
    }
    let localClock = this._tickRunnerLocalClock;
    if (localClock === null) {
      localClock = new FixedStepClock({ tickRate: this._gameplayTickRate() });
      this._tickRunnerLocalClock = localClock;
    }

    const candidateTicks = localClock.advance(opts.dtFrame);
    const tickDt = localClock.dtTick;
    const simStart = performance.now();

    const advance = advanceTickRunnerFrame({
      runner,
      startTick: this._tickRunnerNextTickIndex,
      frameIndex: this._tickRunnerFrameIndex,
      ticksRequested: candidateTicks,
      dtSeconds: opts.dtFrame,
      tickDtSeconds: tickDt,
      isNetworked: false,
      isReplay: false,
      refundClock: localClock,
    });

    this._tickRunnerFrameIndex = advance.frameIndex;
    this._tickRunnerNextTickIndex = advance.nextTickIndex;
    const batch = advance.batch;
    this._simMs = performance.now() - simStart;
    this._presentationPlanMs = batch.completedResults.reduce(
      (sum: number, row: TickResult) =>
        sum + Math.max(0.0, Number(row.payload.step?.presentationPlanMs ?? 0)),
      0.0,
    );

    const applyStart = performance.now();
    const outcome = this._processTickBatchResults({
      batch,
      session: opts.session,
      recorder: opts.recorder,
      onTickApplied: (applied: AppliedBatchTick) =>
        opts.onTick(applied.tick, applied.replayTickIndex) ? 'stop_after_finalize' : 'continue',
      onCheckpoint: opts.onCheckpoint ?? null,
    });

    this._applyBatchPresentationOutputs({
      outputs: outcome.presentationOutputs,
      postApplyReactions: outcome.postApplyReactions,
      applyAudio: true,
      updateCamera: true,
    });

    this._presentationApplyMs = performance.now() - applyStart;
    if (batch.batchStatus === InputStatus.STALLED && batch.ticksCompleted <= 0) {
      this._inputStallCount += 1;
    }
  }
}
