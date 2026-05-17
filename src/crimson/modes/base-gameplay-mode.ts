// Port of crimson/modes/base_gameplay_mode.py

import type { AudioState } from '@grim/audio.ts';
import { stopMusic, updateAudio } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, loadSmallFont, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import type { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { ViewContext } from '@grim/view.ts';
import { debugEnabled } from '@crimson/debug.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { LocalInputInterpreter, clearInputEdges } from '@crimson/local-input.ts';
import { lanDebugLog } from '@crimson/net/debug-log.ts';
import { buildLanDeterministicStatus } from '@crimson/net/deterministic-status.ts';
import { TickFrame } from '@crimson/net/lockstep-protocol.ts';
import { LockstepRuntime } from '@crimson/net/lockstep-runtime.ts';
import type { ModeStateSnapshotV2 } from '@crimson/net/rollback-resync-v5.ts';
import { ReplayStateSnapshotV2, RollbackResyncV5Error, decodeModeSnapshot, encodeModeSnapshot } from '@crimson/net/rollback-resync-v5.ts';
import { RollbackRuntime } from '@crimson/net/rollback-runtime.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkCountGet } from '@crimson/perks/helpers.ts';
import { creatureFindInRadius } from '@crimson/perks/runtime/effects-context.ts';
import { perkSelectionOpenChoices } from '@crimson/perks/selection.ts';
import type { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import { RtxRenderMode } from '@crimson/render/rtx/mode.ts';
import type { Replay } from '@crimson/replay/index.ts';
import { ReplayClaimedStatsSnapshot, dumpReplay } from '@crimson/replay/index.ts';
import { FORMAT_VERSION as CHECKPOINTS_FORMAT_VERSION } from '@crimson/replay/checkpoints.ts';
import type { ReplayCheckpoint } from '@crimson/replay/checkpoints.ts';
import { ReplayCheckpoints, buildCheckpoint, defaultCheckpointsPath, dumpCheckpointsFile } from '@crimson/replay/checkpoints.ts';
import { packPlayerInput, unpackPlayerInput } from '@crimson/replay/input-codec.ts';
import { GameOverUi } from '@crimson/screens/results/game-over.ts';
import { PresentationTickOutput, applyPresentationOutputs, applySimMetadataTickResult } from '@crimson/sim/batch-apply.ts';
import { FixedStepClock } from '@crimson/sim/clock.ts';
import { advanceTickRunnerFrame } from '@crimson/sim/frame-pump.ts';
import type { TickResult } from '@crimson/sim/hooks.ts';
import { LanFrameSample, LanSyncCallbacks, LanTickSync } from '@crimson/sim/hooks.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import type { FrameContext, GameCommand } from '@crimson/sim/input-providers.ts';
import { InputStatus, LocalInputProvider, PerkMenuOpenCommand, PerkPickCommand, ResolvedTick, TickSupply } from '@crimson/sim/input-providers.ts';
import { PostApplyReaction, applyPostApplyReaction, buildPostApplyReaction } from '@crimson/sim/presentation-reactions.ts';
import type { DeterministicSession, DeterministicSessionTick } from '@crimson/sim/sessions.ts';
import type { TickBatchResult } from '@crimson/sim/tick-runner.ts';
import { TickRunner, TickRunnerConfig } from '@crimson/sim/tick-runner.ts';
import type { TerrainSlotTriplet } from '@crimson/terrain-slots.ts';
import { HudState, drawTargetHealthBar } from '@crimson/ui/hud.ts';
import { mostUsedWeaponIdForPlayer } from '@crimson/weapon-runtime/index.ts';
import { WorldRuntime } from '@crimson/world/runtime.ts';
import { shotsFromState } from '@crimson/modes/components/highscore-record-builder.ts';
import type { PerkMenuController } from '@crimson/modes/components/perk-menu-controller.ts';
import { PerkMenuUiContext } from '@crimson/modes/components/perk-menu-controller.ts';
import type { CreatureDeath, CreaturePool } from '@crimson/creatures/runtime.ts';
import type { GameState } from '@crimson/game/types.ts';
import { GameplayState } from '@crimson/gameplay.ts';
import type { GameStatus, GameStatusData } from '@crimson/persistence/save-status.ts';
import type { ReplayRecorder } from '@crimson/replay/index.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import type { WorldEvents } from '@crimson/sim/world-state.ts';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import * as wgl from '@wgl';

export type LanRuntime = LockstepRuntime | RollbackRuntime;
export type LanStepAction = "continue" | "stop_before_finalize" | "stop_after_finalize";
export type LanSession = DeterministicSession;

export const LAN_SIM_DETAIL_PRESET = 5;
export const LAN_SIM_VIOLENCE_DISABLED = 0;

function _strftimeUtcNow(format = '%Y%m%dT%H%M%S.%fZ', utc = true): string {
  const now = new Date();
  const year = String(utc ? now.getUTCFullYear() : now.getFullYear()).padStart(4, '0');
  const month = String((utc ? now.getUTCMonth() : now.getMonth()) + 1).padStart(2, '0');
  const day = String(utc ? now.getUTCDate() : now.getDate()).padStart(2, '0');
  const hour = String(utc ? now.getUTCHours() : now.getHours()).padStart(2, '0');
  const minute = String(utc ? now.getUTCMinutes() : now.getMinutes()).padStart(2, '0');
  const second = String(utc ? now.getUTCSeconds() : now.getSeconds()).padStart(2, '0');
  const microsecond = `${String(now.getUTCMilliseconds()).padStart(3, '0')}000`;
  return format.replaceAll('%Y', year).replaceAll('%m', month).replaceAll('%d', day).replaceAll('%H', hour).replaceAll('%M', minute).replaceAll('%S', second).replaceAll('%f', microsecond);
}

function _pathJoin(...parts: Array<string | number>): string {
  const cleaned = parts.map((part, idx) => {
    const text = String(part);
    if (idx === 0) {
      const stripped = text.replace(/\/+$/g, '');
      if (stripped === '.') {
        return '';
      }
      return text === '/' ? '/' : stripped;
    }
    return text.replace(/^\/+|\/+$/g, '');
  }).filter((part) => part.length > 0);
  if (cleaned.length === 0) {
    return '';
  }
  if (cleaned[0] === '/') {
    return `/${cleaned.slice(1).join('/')}`;
  }
  return cleaned.join('/');
}

function _pathIsAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function _dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) {
    return '.';
  }
  if (idx === 0) {
    return '/';
  }
  return path.slice(0, idx);
}

function _mkdirParents(path: string): void {
  mkdirSync(path, { recursive: true });
}

function pythonEquals(left: object | string | number | boolean | null | undefined, right: object | string | number | boolean | null | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (left !== null && left !== undefined && typeof left === 'object') {
    const equal = Reflect.get(left, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(left, right));
    }
  }
  if (right !== null && right !== undefined && typeof right === 'object') {
    const equal = Reflect.get(right, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(right, left));
    }
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => pythonEquals(value, right[index]));
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && pythonEquals(Reflect.get(left, key), Reflect.get(right, key)));
  }
  return false;
}

function zip<A, B>(a: readonly A[], b: readonly B[], opts?: { strict?: boolean }): [A, B][];
function zip<A, B, C>(a: readonly A[], b: readonly B[], c: readonly C[], opts?: { strict?: boolean }): [A, B, C][];
function zip(...args: unknown[]): unknown[][] {
  const last = args.at(-1);
  const hasOpts = last !== null && typeof last === 'object' && !Array.isArray(last) && Object.prototype.hasOwnProperty.call(last, 'strict');
  const arrays = (hasOpts ? args.slice(0, -1) : args) as readonly unknown[][];
  const length = arrays.length === 0 ? 0 : Math.min(...arrays.map((array) => array.length));
  return Array.from({ length }, (_, index) => arrays.map((array) => array[index]));
}

function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0 && !Number.isNaN(value);
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size > 0;
  }
  return true;
}

export class AppliedBatchTick {
  tick: DeterministicSessionTick;
  replayTickIndex: number | null;
  frameTickIndex: number | null;

  constructor(opts: {
    tick: DeterministicSessionTick;
    replayTickIndex: number | null;
    frameTickIndex?: number | null;
  }) {
    this.tick = opts.tick;
    this.replayTickIndex = opts.replayTickIndex;
    this.frameTickIndex = opts.frameTickIndex ?? null;
  }
}

export class BatchApplyOutcome {
  readonly ticksApplied: number;
  readonly stopped: boolean;
  readonly stopAfterFinalize: boolean;
  readonly presentationOutputs: readonly PresentationTickOutput[];
  readonly postApplyReactions: readonly PostApplyReaction[];

  constructor(opts: {
    ticksApplied?: number;
    stopped?: boolean;
    stopAfterFinalize?: boolean;
    presentationOutputs?: readonly PresentationTickOutput[];
    postApplyReactions?: readonly PostApplyReaction[];
  } = {}) {
    this.ticksApplied = opts.ticksApplied ?? 0;
    this.stopped = opts.stopped ?? false;
    this.stopAfterFinalize = opts.stopAfterFinalize ?? false;
    this.presentationOutputs = Array.from(opts.presentationOutputs ?? []);
    this.postApplyReactions = Array.from(opts.postApplyReactions ?? []);
  }
}

export class ModeFrameState {
  readonly dt: number;
  readonly dtUiMs: number;

  constructor(opts: {
    dt: number;
    dtUiMs: number;
  }) {
    this.dt = opts.dt;
    this.dtUiMs = opts.dtUiMs;
  }
}

export class LanRuntimeInputProvider {
  protected _runtime: LanRuntime | null;
  protected _role: string;
  protected _samplesByRunnerTick: Map<number, LanFrameSample>;
  protected _beforePop: (() => boolean) | null;
  protected _popBlocked: boolean;
  protected _captureClock: FixedStepClock;

  get runtime(): LanRuntime | null {
    return this._runtime;
  }
  get role(): string {
    return this._role;
  }
  get samplesByRunnerTick(): Map<number, LanFrameSample> {
    return this._samplesByRunnerTick;
  }
  get beforePop(): (() => boolean) | null {
    return this._beforePop;
  }
  get captureClock(): FixedStepClock {
    return this._captureClock;
  }

  constructor(opts: { playerCount: number; tickRate: number }) {
    const playerCount = opts.playerCount;
    const tickRate = opts.tickRate;
    const _ = playerCount;
    this._runtime = null;
    this._role = '';
    this._samplesByRunnerTick = new Map();
    this._beforePop = null;
    this._popBlocked = false;
    this._captureClock = new FixedStepClock({ tickRate: Math.max(1, int(tickRate)) });
  }

  bindRuntime(runtime: LanRuntime | null): void {
    this._runtime = runtime;
    this._samplesByRunnerTick.clear();
    this._popBlocked = false;
  }

  setRole(role: string): void {
    this._role = role;
  }

  setBeforePop(callback: (() => boolean) | null): void {
    this._beforePop = callback;
    this._popBlocked = false;
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

  beginFrame(frameCtx: FrameContext): void {
    const _ = frameCtx;
    this._samplesByRunnerTick.clear();
    this._popBlocked = false;
  }

  takeFrameSample(runnerTickIndex: number): LanFrameSample | null {
    return (() => { const map = this._samplesByRunnerTick; const key = int(runnerTickIndex); const value = map.has(key) ? map.get(key)! : null; map.delete(key); return value; })();
  }

  pullTick(tickIndex: number, defaultDtSeconds: number): TickSupply {
    this._popBlocked = false;
    const beforePop = this._beforePop;
    if (beforePop !== null && !pythonTruthy(beforePop())) {
      this._popBlocked = true;
      return new TickSupply({ status: InputStatus.STALLED, tick: null });
    }
    const runtime = this._runtime;
    if (runtime === null) {
      return new TickSupply({ status: InputStatus.STALLED, tick: null });
    }
    const frame = runtime.popTickFrame();
    if (frame === null) {
      return new TickSupply({ status: InputStatus.STALLED, tick: null });
    }
    const frameTickIndex = int(frame.tickIndex);
    const frameInputs = Array.from(frame.frameInputs).map((packed) => Array.from(packed));
    const playerInputs = frameInputs.map((packed) => unpackPlayerInput(packed));
    this._samplesByRunnerTick.set(int(tickIndex), new LanFrameSample({ frameTickIndex: int(frameTickIndex), frameInputs: Array.from(frameInputs), commands: Array.from(frame.commands) }));
    return new TickSupply({ status: InputStatus.READY, tick: new ResolvedTick({ tickIndex: int(tickIndex), dtSeconds: defaultDtSeconds, inputs: playerInputs, commands: Array.from(frame.commands) }) });
  }

  supportsCommandSubmission(): boolean {
    return this._runtime !== null && String(this._role) === 'host';
  }

  submitCommand(command: GameCommand): void {
    const runtime = this._runtime;
    if (runtime === null) {
      return;
    }
    if (String(this._role) !== 'host') {
      return;
    }
    if (runtime instanceof LockstepRuntime) {
      runtime.submitLocalCommand(command);
    }
  }
}

export class BaseGameplayMode {
  protected _assetsRoot: string;
  protected _small: SmallFontData | null;
  protected _hudState: HudState;
  defaultGameModeId: GameMode;
  config: CrimsonConfig;
  protected _console: ConsoleState | null;
  protected _baseDir: any;
  closeRequested: boolean;
  protected _action: string | null;
  protected _paused: boolean;
  protected _statusBase: GameStatus | null;
  protected _statusSim: GameStatus | null;
  protected _lanStatus: GameStatus | null;
  protected _lanStatusData: GameStatusData | null;
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
  simWorld: any;
  renderResources: any;
  audioBridge: any;
  terrainRuntime: any;
  renderer: any;
  protected _gameOverActive: boolean;
  protected _gameOverRecord: HighScoreRecord | null;
  protected _gameOverBanner: string;
  protected _uiMouse: Vec2;
  protected _cursorPulseTime: number;
  protected _lastDtMs: number;
  protected _screenFade: GameState | null;
  protected _terrainRegenCounter: number;
  protected _runResetSeed: number;
  protected _replayRecorder: ReplayRecorder | null;
  protected _replayCheckpoints: ReplayCheckpoint[];
  protected _replayCheckpointsSampleRate: number;
  protected _replayCheckpointsLastTick: number | null;
  protected _lanRuntime: LanRuntime | null;
  protected _rollbackRuntime: RollbackRuntime | null;
  protected _lanLocalSlotIndex: number;
  protected _lanSeedOverride: number | null;
  protected _lanStartTick: number;
  protected _lanEnabled: boolean;
  protected _lanRole: string;
  protected _lanExpectedPlayers: number;
  protected _lanConnectedPlayers: number;
  protected _lanWaitingForPlayers: boolean;
  protected _lanTraceLastMs: number;
  protected _lanTerrainPendingLast: boolean;
  protected _lanTerrainPendingSinceMs: number;
  protected _lanInitialTerrainReady: boolean;
  protected _runtimeUpdatesPerFrame: number;
  protected _inputStallCount: number;
  protected _ticksAdvancedPerFrame: number;
  protected _simMs: number;
  protected _presentationPlanMs: number;
  protected _presentationApplyMs: number;
  protected _queuedInputCommands: GameCommand[];
  protected _networkInputProvider: LanRuntimeInputProvider;
  protected _simSession: DeterministicSession | null;
  protected _tickInputProvider: LocalInputProvider | LanRuntimeInputProvider | null;
  protected _tickRunner: TickRunner | null;
  protected _tickRunnerSession: DeterministicSession | null;
  protected _tickRunnerIsNetworked: boolean;
  protected _tickRunnerNetworkRole: string;
  protected _tickRunnerFrameIndex: number;
  protected _tickRunnerNextTickIndex: number;
  protected _tickRunnerLocalClock: FixedStepClock | null;
  state!: GameplayState;
  creatures!: CreaturePool;
  player!: PlayerState;

  get assetsRoot(): string {
    return this._assetsRoot;
  }
  get small(): SmallFontData | null {
    return this._small;
  }
  get hudState(): HudState {
    return this._hudState;
  }
  get console(): ConsoleState | null {
    return this._console;
  }
  get baseDir(): any {
    return this._baseDir;
  }
  get action(): string | null {
    return this._action;
  }
  get paused(): boolean {
    return this._paused;
  }
  get statusBase(): GameStatus | null {
    return this._statusBase;
  }
  get statusSim(): GameStatus | null {
    return this._statusSim;
  }
  get lanStatus(): GameStatus | null {
    return this._lanStatus;
  }
  get lanStatusData(): GameStatusData | null {
    return this._lanStatusData;
  }
  get localInput(): LocalInputInterpreter {
    return this._localInput;
  }
  get gameOverUi(): GameOverUi {
    return this._gameOverUi;
  }
  get gameOverActive(): boolean {
    return this._gameOverActive;
  }
  get gameOverRecord(): HighScoreRecord | null {
    return this._gameOverRecord;
  }
  get gameOverBanner(): string {
    return this._gameOverBanner;
  }
  get uiMouse(): Vec2 {
    return this._uiMouse;
  }
  get cursorPulseTime(): number {
    return this._cursorPulseTime;
  }
  get lastDtMs(): number {
    return this._lastDtMs;
  }
  get screenFade(): GameState | null {
    return this._screenFade;
  }
  get terrainRegenCounter(): number {
    return this._terrainRegenCounter;
  }
  get runResetSeed(): number {
    return this._runResetSeed;
  }
  get replayRecorder(): ReplayRecorder | null {
    return this._replayRecorder;
  }
  get replayCheckpoints(): ReplayCheckpoint[] {
    return this._replayCheckpoints;
  }
  get replayCheckpointsSampleRate(): number {
    return this._replayCheckpointsSampleRate;
  }
  get replayCheckpointsLastTick(): number | null {
    return this._replayCheckpointsLastTick;
  }
  get lanRuntime(): LanRuntime | null {
    return this._lanRuntime;
  }
  get rollbackRuntime(): RollbackRuntime | null {
    return this._rollbackRuntime;
  }
  get lanLocalSlotIndex(): number {
    return this._lanLocalSlotIndex;
  }
  get lanSeedOverride(): number | null {
    return this._lanSeedOverride;
  }
  get lanStartTick(): number {
    return this._lanStartTick;
  }
  get lanEnabled(): boolean {
    return this._lanEnabled;
  }
  get lanRole(): string {
    return this._lanRole;
  }
  get lanExpectedPlayers(): number {
    return this._lanExpectedPlayers;
  }
  get lanConnectedPlayers(): number {
    return this._lanConnectedPlayers;
  }
  get lanWaitingForPlayers(): boolean {
    return this._lanWaitingForPlayers;
  }
  get lanTraceLastMs(): number {
    return this._lanTraceLastMs;
  }
  get lanTerrainPendingLast(): boolean {
    return this._lanTerrainPendingLast;
  }
  get lanTerrainPendingSinceMs(): number {
    return this._lanTerrainPendingSinceMs;
  }
  get lanInitialTerrainReady(): boolean {
    return this._lanInitialTerrainReady;
  }
  get runtimeUpdatesPerFrame(): number {
    return this._runtimeUpdatesPerFrame;
  }
  get inputStallCount(): number {
    return this._inputStallCount;
  }
  get ticksAdvancedPerFrame(): number {
    return this._ticksAdvancedPerFrame;
  }
  get simMs(): number {
    return this._simMs;
  }
  get presentationPlanMs(): number {
    return this._presentationPlanMs;
  }
  get presentationApplyMs(): number {
    return this._presentationApplyMs;
  }
  get queuedInputCommands(): GameCommand[] {
    return this._queuedInputCommands;
  }
  get networkInputProvider(): LanRuntimeInputProvider {
    return this._networkInputProvider;
  }
  get simSession(): DeterministicSession | null {
    return this._simSession;
  }
  get tickInputProvider(): LocalInputProvider | LanRuntimeInputProvider | null {
    return this._tickInputProvider;
  }
  get tickRunner(): TickRunner | null {
    return this._tickRunner;
  }
  get tickRunnerSession(): DeterministicSession | null {
    return this._tickRunnerSession;
  }
  get tickRunnerIsNetworked(): boolean {
    return this._tickRunnerIsNetworked;
  }
  get tickRunnerNetworkRole(): string {
    return this._tickRunnerNetworkRole;
  }
  get tickRunnerFrameIndex(): number {
    return this._tickRunnerFrameIndex;
  }
  get tickRunnerNextTickIndex(): number {
    return this._tickRunnerNextTickIndex;
  }
  get tickRunnerLocalClock(): FixedStepClock | null {
    return this._tickRunnerLocalClock;
  }

  constructor(ctx: ViewContext, opts: { worldSize: number; defaultGameModeId: GameMode; demoModeActive?: boolean; questFailRetryCount?: number; hardcore?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: CrandLike });
  constructor(opts: { worldSize: number; defaultGameModeId: GameMode; demoModeActive?: boolean; questFailRetryCount?: number; hardcore?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: CrandLike } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
  constructor(ctxOrOpts: ViewContext | { worldSize: number; defaultGameModeId: GameMode; demoModeActive?: boolean; questFailRetryCount?: number; hardcore?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: CrandLike } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean }, maybeOpts?: { worldSize: number; defaultGameModeId: GameMode; demoModeActive?: boolean; questFailRetryCount?: number; hardcore?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: CrandLike }) {
    const ctx = maybeOpts === undefined ? { assetsDir: (ctxOrOpts as { assetsUrl?: string }).assetsUrl ?? '', preserveBugs: (ctxOrOpts as { preserveBugs?: boolean }).preserveBugs ?? false } as ViewContext : ctxOrOpts as ViewContext;
    const opts = maybeOpts ?? (ctxOrOpts as { worldSize: number; defaultGameModeId: GameMode; demoModeActive?: boolean; questFailRetryCount?: number; hardcore?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: CrandLike } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
    const worldSize = opts.worldSize;
    const defaultGameModeId = opts.defaultGameModeId;
    const demoModeActive = opts.demoModeActive ?? false;
    const questFailRetryCount = opts.questFailRetryCount ?? 0;
    const hardcore = opts.hardcore ?? false;
    const config = opts.config;
    const console = opts.console ?? null;
    const audio = opts.audio ?? null;
    const audioRng = opts.audioRng;
    this._assetsRoot = ctx.assetsDir;
    this._small = null;
    this._hudState = new HudState();
    this.defaultGameModeId = defaultGameModeId;

    this.config = config;
    this._console = console;
    this._baseDir = _dirname(String(this.config.path));

    this.closeRequested = false;
    this._action = null;
    this._paused = false;
    this._statusBase = null;
    this._statusSim = null;
    this._lanStatus = null;
    this._lanStatusData = null;
    this._localInput = new LocalInputInterpreter();
    this._gameOverUi = new GameOverUi({ assetsRoot: this._assetsRoot, baseDir: this._baseDir, config: this.config, preserveBugs: ctx.preserveBugs });

    this.assetsDir = ctx.assetsDir;
    this.worldSize = worldSize;
    this.demoModeActive = demoModeActive;
    this.questFailRetryCount = int(questFailRetryCount);
    this.hardcore = hardcore;
    this.preserveBugs = ctx.preserveBugs;
    this.audio = audio;
    this.audioRng = audioRng;
    this.rtxMode = RtxRenderMode.CLASSIC;
    this._worldRuntime = new WorldRuntime({ assetsDir: this.assetsDir, worldSize: this.worldSize, demoModeActive: Boolean(this.demoModeActive), questFailRetryCount: int(this.questFailRetryCount), hardcore: Boolean(this.hardcore), preserveBugs: Boolean(this.preserveBugs), config: this.config, audio: this.audio, audioRng: this.audioRng, rtxMode: this.rtxMode });
    this.simWorld = this._worldRuntime.simWorld;
    this.renderResources = this._worldRuntime.renderResources;
    this.audioBridge = this._worldRuntime.audioBridge;
    this.terrainRuntime = this._worldRuntime.terrainRuntime;
    this.renderer = this._worldRuntime.renderer;
    this.camera = new Vec2(-1.0, -1.0);
    this.lanPlayerRingsEnabled = false;
    this.lanLocalAimIndicatorsOnly = false;
    this.lanLocalPlayerSlotIndex = 0;
    this._syncWorldRuntimeConfig();
    const playerCount = this._runtimePlayerCount();
    this._worldRuntime.reset({ playerCount: Math.max(1, Math.min(4, int(playerCount))) });
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
    this._networkInputProvider = new LanRuntimeInputProvider({ playerCount: Math.max(0, this.simWorld.players.length), tickRate: int(BaseGameplayMode._deterministicTickRate()) });
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

  set camera(value: Vec2) {
    this._worldRuntime.camera = value;
  }

  get lanPlayerRingsEnabled(): boolean {
    return this._worldRuntime.lanPlayerRingsEnabled;
  }

  set lanPlayerRingsEnabled(value: boolean) {
    this._worldRuntime.lanPlayerRingsEnabled = value;
  }

  get lanLocalAimIndicatorsOnly(): boolean {
    return this._worldRuntime.lanLocalAimIndicatorsOnly;
  }

  set lanLocalAimIndicatorsOnly(value: boolean) {
    this._worldRuntime.lanLocalAimIndicatorsOnly = value;
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
    runtime.questFailRetryCount = int(this.questFailRetryCount);
    runtime.hardcore = this.hardcore;
    runtime.preserveBugs = this.preserveBugs;
    runtime.config = this.config;
    runtime.audio = this.audio;
    runtime.audioRng = this.audioRng;
    runtime.rtxMode = this.rtxMode;
  }

  applyTerrainSetup(opts: { terrainSlots: TerrainSlotTriplet; seed: number }): void {
    const terrainSlots = opts.terrainSlots;
    const seed = opts.seed;
    this.terrainRuntime.applyTerrainSetup({ terrainSlots: terrainSlots, seed: seed });
  }

  protected _drawWorld(opts: { drawAimIndicators?: boolean; entityAlpha?: number } = {}): void {
    const drawAimIndicators = opts.drawAimIndicators ?? true;
    const entityAlpha = opts.entityAlpha ?? 1.0;
    this._worldRuntime.draw({
      drawAimIndicators: drawAimIndicators,
      entityAlpha: entityAlpha,
    });
  }

  worldToScreen(pos: Vec2): Vec2 {
    return this.renderer.worldToScreen(pos);
  }

  screenToWorld(pos: Vec2): Vec2 {
    return this.renderer.screenToWorld(pos);
  }

  protected _refreshEffectiveStatus(opts: { resetLanStatus: boolean }): void {
    const resetLanStatus = opts.resetLanStatus;
    if (this._lanEnabled) {
      if (resetLanStatus || this._lanStatus === null) {
        this._lanStatus = buildLanDeterministicStatus({ status: this._lanStatusData });
      }
      this._statusSim = this._lanStatus;
    } else {
      this._lanStatus = null;
      this._lanStatusData = null;
      this._statusSim = this._statusBase;
    }

    // Keep the currently-bound world state in sync (note that `open()` resets
    // the underlying simulation state, so `_bind_world()` also re-applies it).
    this.state.status = this._statusSim;
  }

  bindLanRuntime(runtime: LanRuntime | null): void {
    const previousRuntime = this._lanRuntime;
    this._lanRuntime = runtime;
    this._rollbackRuntime = runtime instanceof RollbackRuntime ? runtime : null;
    this._networkInputProvider.bindRuntime(runtime);
    if (previousRuntime !== runtime && this._tickRunnerIsNetworked) {
      this._resetTickRunnerState();
    }
    const slotIndex = runtime === null ? 0 : int(runtime.localSlotIndex);
    this._lanLocalSlotIndex = Math.max(0, Math.min(3, int(slotIndex)));
  }

  protected _lockstepRuntime(): LockstepRuntime | null {
    const runtime = this._lanRuntime;
    if (runtime instanceof LockstepRuntime) {
      return runtime;
    }
    return null;
  }

  setLanMatchStart(opts: { seed: number; startTick?: number; status?: GameStatusData | null }): void {
    const seed = opts.seed;
    const startTick = opts.startTick ?? 0;
    const status = opts.status ?? null;
    this._lanSeedOverride = int(seed);
    this._lanStartTick = int(startTick);
    if (status !== null) {
      this._lanStatusData = status;
      if (this._lanEnabled) {
        this._refreshEffectiveStatus({ resetLanStatus: true });
      }
    }
  }

  protected _cvarFloat(name: string, _default: number = 0.0): number {
    const console = this._console;
    if (console === null) {
      return _default;
    }
    const cvar = console.cvars.get(name) ?? null;
    if (cvar === null) {
      return _default;
    }
    return cvar.valueF;
  }

  protected _hudSmallIndicators(): boolean {
    return this._cvarFloat('cv_uiSmallIndicators', 0.0) !== 0.0;
  }

  protected _lanPlayerRingsEnabled(): boolean {
    if (!this._lanEnabled) {
      return false;
    }
    return this._cvarFloat('cv_lanPlayerRings', 0.0) !== 0.0;
  }

  protected _syncLanVisualFlags(): void {
    this.lanPlayerRingsEnabled = this._lanPlayerRingsEnabled();
    this.lanLocalAimIndicatorsOnly = this._lanEnabled;
    this.lanLocalPlayerSlotIndex = Math.max(0, Math.min(3, int(this._lanLocalSlotIndex)));
  }

  protected _configGameModeId(): GameMode {
    if (Object.values(GameMode).includes(this.config.gameplay.mode as GameMode)) {
      return this.config.gameplay.mode as GameMode;
    }
    return GameMode.DEMO;
  }

  protected _drawTargetHealthBar(opts: { alpha?: number } = {}): void {
    const alpha = opts.alpha ?? 1.0;
    const creatures = this.creatures.entries;
    if (!creatures) {
      return;
    }

    const targetIndices: number[] = [];
    const targetPlayers = this.state.preserveBugs ? this.simWorld.players.slice(0, 1) : this.simWorld.players;
    for (const targetPlayer of targetPlayers) {
      if (!this.state.preserveBugs && targetPlayer.health <= 0.0) {
        continue;
      }
      if (perkCountGet(targetPlayer, PerkId.DOCTOR) <= 0) {
        continue;
      }
      const targetIdx = creatureFindInRadius(creatures, { pos: targetPlayer.aim, radius: 12.0, startIndex: 0 });
      if (targetIdx === -1) {
        continue;
      }
      if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(targetIndices, targetIdx)) {
        continue;
      }
      targetIndices.push(int(targetIdx));
    }

    for (const targetIdx of targetIndices) {
      const creature = creatures[targetIdx];
      if (!creature.active) {
        continue;
      }
      const hp = creature.hp;
      const maxHp = creature.maxHp;
      if (maxHp <= 0.0) {
        continue;
      }

      let ratio = hp / maxHp;
      if (ratio < 0.0) {
        ratio = 0.0;
      }
      if (ratio > 1.0) {
        ratio = 1.0;
      }

      const screenLeft = this.worldToScreen(creature.pos.add(new Vec2(-32.0, 32.0)));
      const screenRight = this.worldToScreen(creature.pos.add(new Vec2(32.0, 32.0)));
      const width = screenRight.x - screenLeft.x;
      if (width <= 1e-3) {
        continue;
      }
      drawTargetHealthBar({ pos: screenLeft, width: width, ratio: ratio, alpha: alpha, scale: width / 64.0 });
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
    return Array.from(this.simWorld.players).some((player: any) => player.health > 0.0);
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
      updateAudio(this.audio, dt);
    }
  }

  protected _uiLineHeight(scale: number = 1.0): number {
    if (this._small !== null) {
      return int(this._small.cellSize * scale);
    }
    return int(20 * scale);
  }

  protected _uiTextWidth(text: string, scale: number = 1.0): number {
    const _ = scale;
    const font = this._small;
    if (!(font !== null)) throw new Error('small font must be loaded before ui text measurement');
    return int(measureSmallTextWidth(font, text));
  }

  protected _drawUiText(text: string, pos: Vec2, color: wgl.Color, scale: number = 1.0): void {
    const _ = scale;
    const font = this._small;
    if (!(font !== null)) throw new Error('small font must be loaded before ui text draw');
    drawSmallText(font, text, pos, color);
  }

  protected _perkMenuPlaySfx(): ((arg0: SfxId) => void) | null {
    return this.audioBridge.router.playSfx;
  }

  protected _perkMenuUiContext(): PerkMenuUiContext {
    return new PerkMenuUiContext({ player: this.player, violenceDisabled: this.config.display.violenceDisabled, preserveBugs: this.state.preserveBugs, fxDetail: this.config.display.fxDetailEnabled({ level: 0, default: false }), resources: this.renderResources.resources, mouse: this._uiMousePos(), playSfx: this._perkMenuPlaySfx() });
  }

  protected _openPerkMenuUi(opts: { menu: PerkMenuController; players: PlayerState[]; gameMode: GameMode; playerCount: number }): void {
    const menu = opts.menu;
    const players = opts.players;
    const gameMode = opts.gameMode;
    const playerCount = opts.playerCount;
    if (menu.active) {
      return;
    }
    const perkCtx = this._perkMenuUiContext();
    const recorder = Reflect.get((this) as object, '_replay_recorder') ?? null;
    if (recorder !== null) {
      this._recordReplayCheckpoint(Math.max(0, int(recorder.tickIndex) - 1), { force: true });
    }
    const choices = perkSelectionOpenChoices(this.state, players, this.state.perkSelection, { gameMode: gameMode, playerCount: int(playerCount) });
    if (!(choices)) throw new Error('perk menu open requires prepared perk choices');
    menu.openMenu({ playSfx: perkCtx.playSfx?.bind(perkCtx) ?? null });
    this.enqueueInputCommand(new PerkMenuOpenCommand({ playerIndex: 0 }));
  }

  protected _uiMousePos(): wgl.Vector2 {
    return this._uiMouse.toRl();
  }

  protected _updateUiMouse(): void {
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    this._uiMouse = (Vec2.fromXY(mouse)).clampRect(0.0, 0.0, Math.max(0.0, screenW - 1.0), Math.max(0.0, screenH - 1.0));
  }

  protected _tickFrame(dt: number, opts: { clampCursorPulse?: boolean } = {}): [number, number] {
    const clampCursorPulse = opts.clampCursorPulse ?? false;
    const dtUiMs = Math.min(dt, 0.1) * 1000.0;
    this._lastDtMs = dtUiMs;

    this._updateUiMouse();
    this._traceLanStateHeartbeat();

    const pulseDt = clampCursorPulse ? Math.min(dt, 0.1) : dt;
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
    return new ModeFrameState({ dt: frameDt, dtUiMs: frameDtUiMs });
  }

  protected _handleInput(): void {
    throw new Error('NotImplementedError');
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

  protected _flushQueuedInputCommands(opts: { provider: LocalInputProvider | LanRuntimeInputProvider }): void {
    const provider = opts.provider;
    if (this._queuedInputCommands.length === 0) {
      return;
    }
    if (!provider.supportsCommandSubmission()) {
      return;
    }
    for (const command of this._queuedInputCommands) {
      provider.submitCommand(command);
    }
    this._queuedInputCommands.length = 0;
  }

  recordPerkPickCommand(choiceIndex: number, opts: { playerIndex?: number } = {}): void {
    const playerIndex = opts.playerIndex ?? 0;
    this.enqueueInputCommand(new PerkPickCommand({ playerIndex: int(playerIndex), choiceIndex: int(choiceIndex) }));
  }

  protected _sessionElapsedMs(): number {
    const session = this._simSession;
    if (!(session !== null)) throw new Error('session elapsed requested without an active deterministic session');
    return session.elapsedMs;
  }

  protected _replayCheckpointElapsedMs(): number {
    return this.simWorld.presentationElapsedMs;
  }

  protected _replayClaimedStatsComplete(): boolean {
    return false;
  }

  protected _replayClaimedStatsElapsedMs(): number {
    return int(this._replayCheckpointElapsedMs());
  }

  protected _replayClaimedShots(): [number, number] {
    return shotsFromState(this.state, { playerIndex: int(this.player.index) });
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: Replay }): string {
    const stamp = opts.stamp;
    const replay = opts.replay;
    const _ = replay;
    const modeName = String(this.constructor.name).replaceAll('Mode', '').toLowerCase() || 'replay';
    return `${modeName}_${stamp}`;
  }

  protected _replaySkipSaveWhenEmpty(opts: { recorder: ReplayRecorder }): boolean {
    const recorder = opts.recorder;
    const _ = recorder;
    return false;
  }

  protected _recordReplayCheckpoint(tickIndex: number, opts: { force?: boolean; deaths?: readonly CreatureDeath[] | null; events?: WorldEvents | null } = {}): void {
    const force = opts.force ?? false;
    const deaths = opts.deaths ?? null;
    const events = opts.events ?? null;
    const recorder = this._replayRecorder;
    if (recorder === null) {
      return;
    }
    if (tickIndex < 0) {
      return;
    }
    if (!force && (((tickIndex % int(this._replayCheckpointsSampleRate || 1))) !== 0)) {
      return;
    }
    if (this._replayCheckpointsLastTick === int(tickIndex)) {
      return;
    }
    this._replayCheckpoints.push(buildCheckpoint({ tickIndex: int(tickIndex), world: this.simWorld.worldState, elapsedMs: this._replayCheckpointElapsedMs(), deaths: deaths, events: events }));
    this._replayCheckpointsLastTick = int(tickIndex);
  }

  protected _saveReplay(): void {
    const recorder = this._replayRecorder;
    if (recorder === null) {
      return;
    }
    if (this._replaySkipSaveWhenEmpty({ recorder: recorder })) {
      this._replayRecorder = null;
      this._replayCheckpoints.length = 0;
      this._replayCheckpointsLastTick = null;
      return;
    }

    this._recordReplayCheckpoint(Math.max(0, int(recorder.tickIndex) - 1), { force: true });
    let replay = recorder.finish();

    const [shotsFired, shotsHit] = this._replayClaimedShots();
    const mostUsedWeaponId = mostUsedWeaponIdForPlayer(this.state, { playerIndex: int(this.player.index), fallbackWeaponId: this.player.weapon.weaponId });
    const claimedStats = new ReplayClaimedStatsSnapshot({ complete: pythonTruthy(this._replayClaimedStatsComplete()), ticks: int(recorder.tickIndex), elapsedMs: int(this._replayClaimedStatsElapsedMs()), scoreXp: int(this.player.experience), kills: int(this.creatures.killCount), mostUsedWeaponId: mostUsedWeaponId, shotsFired: int(shotsFired), shotsHit: int(shotsHit) });
    replay = (() => { const value = replay; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value, header: (() => { const value = replay.header; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value, claimedStats }); })() }); })();

    const data = dumpReplay(replay);
    const stamp = _strftimeUtcNow('%Y%m%d_%H%M%S', false);
    const replayDir = _pathJoin(this._baseDir, 'replays');
    _mkdirParents(String(replayDir));
    const baseName = this._replayOutputBasename({ stamp: stamp, replay: replay });
    let path = _pathJoin(replayDir, `${baseName}.crd`);
    let counter = 1;
    while (existsSync(String(path))) {
      path = _pathJoin(replayDir, `${baseName}_${counter}.crd`);
      counter += 1;
    }
    writeFileSync(String(path), data);

    const checkpointsPath = defaultCheckpointsPath(path);
    dumpCheckpointsFile(checkpointsPath, new ReplayCheckpoints({ version: CHECKPOINTS_FORMAT_VERSION, sampleRate: int(this._replayCheckpointsSampleRate || 0), checkpoints: Array.from(this._replayCheckpoints) }));
    this._replayRecorder = null;
    this._replayCheckpoints.length = 0;
    this._replayCheckpointsLastTick = null;
    if (this._console !== null) {
      this._console.log.log(`replay: saved ${path}`);
      this._console.log.log(`replay: saved ${checkpointsPath}`);
      this._console.log.flush();
    }
  }

  frameTelemetry(): [number, number, number, number, number, number] {
    return [int(this._runtimeUpdatesPerFrame), int(this._inputStallCount), int(this._ticksAdvancedPerFrame), this._simMs, this._presentationPlanMs, this._presentationApplyMs];
  }

  protected _resetFrameTelemetry(): void {
    this._inputStallCount = 0;
    this._ticksAdvancedPerFrame = 0;
    // Placeholder stage timers before profiler hooks land in later slices.
    this._simMs = 0.0;
    this._presentationPlanMs = 0.0;
    this._presentationApplyMs = 0.0;
  }

  setLanRuntime(opts: { enabled: boolean; role: string; expectedPlayers: number; connectedPlayers: number; waitingForPlayers: boolean }): void {
    const enabled = opts.enabled;
    const role = opts.role;
    let expectedPlayers = opts.expectedPlayers;
    let connectedPlayers = opts.connectedPlayers;
    const waitingForPlayers = opts.waitingForPlayers;
    expectedPlayers = Math.max(1, Math.min(4, int(expectedPlayers)));
    connectedPlayers = Math.max(0, Math.min(expectedPlayers, int(connectedPlayers)));

    const prevEnabled = this._lanEnabled;
    const prevRole = String(this._lanRole);
    if (this._lanEnabled === enabled && String(this._lanRole) === role && int(this._lanExpectedPlayers) === int(expectedPlayers) && int(this._lanConnectedPlayers) === int(connectedPlayers) && this._lanWaitingForPlayers === waitingForPlayers) {
      this._syncLanVisualFlags();
      return;
    }
    this._lanEnabled = enabled;
    this._lanRole = role;
    this._lanExpectedPlayers = int(expectedPlayers);
    this._lanConnectedPlayers = int(connectedPlayers);
    this._lanWaitingForPlayers = waitingForPlayers;
    this._networkInputProvider.setRole(this._lanRole);
    this._syncLanVisualFlags();
    this._lanTraceLastMs = -1000.0;
    if (prevEnabled !== this._lanEnabled) {
      this._refreshEffectiveStatus({ resetLanStatus: true });
      this._resetTickRunnerState();
    } else if (prevRole !== String(this._lanRole)) {
      this._resetTickRunnerState();
    }
    lanDebugLog(
      'set_lan_runtime',
      { mode: this.constructor.name, enabled: this._lanEnabled, role: String(this._lanRole), expectedPlayers: int(this._lanExpectedPlayers), connectedPlayers: int(this._lanConnectedPlayers), waitingForPlayers: this._lanWaitingForPlayers, playerRings: this.lanPlayerRingsEnabled },
    );
  }

  protected _lanWaitGateActive(): boolean {
    if (!this._lanEnabled) {
      return false;
    }
    if (!this._lanWaitingForPlayers) {
      return false;
    }
    return int(this._lanConnectedPlayers) < int(this._lanExpectedPlayers);
  }

  protected _lanTerrainGenerationPending(): boolean {
    if (!this._lanEnabled) {
      return false;
    }
    if (this._lanInitialTerrainReady) {
      return false;
    }
    const ground = this.renderResources.ground;
    if (ground === null) {
      return false;
    }
    return ground.generationPending();
  }

  protected _traceLanTerrainGeneration(): void {
    if (!this._lanEnabled) {
      this._lanTerrainPendingLast = false;
      this._lanInitialTerrainReady = false;
      return;
    }
    const ground = this.renderResources.ground;
    if (ground === null) {
      this._lanTerrainPendingLast = false;
      this._lanInitialTerrainReady = true;
      return;
    }

    const pending = this._lanTerrainGenerationPending();
    const nowMs = int((performance.now() / 1000) * 1000.0);
    if (pending && !this._lanTerrainPendingLast) {
      this._lanTerrainPendingSinceMs = int(nowMs);
      lanDebugLog(
        'lan_terrain_generate_begin',
        { mode: this.constructor.name, role: String(this._lanRole), slot: int(this._lanLocalSlotIndex) },
      );
    }
    if (!pending && this._lanTerrainPendingLast) {
      const durationMs = Math.max(0, int(nowMs) - int(this._lanTerrainPendingSinceMs));
      const rtReady = ground.renderTargetReady();
      lanDebugLog(
        'lan_terrain_generate_done',
        { mode: this.constructor.name, role: String(this._lanRole), slot: int(this._lanLocalSlotIndex), durationMs: int(durationMs), renderTargetReady: rtReady, textureFailed: ground.textureFailed },
      );
    }
    this._lanTerrainPendingLast = pending;
    if (!pending) {
      this._lanInitialTerrainReady = true;
    }
  }

  protected _traceLanStateHeartbeat(): void {
    if (!this._lanEnabled) {
      return;
    }
    const elapsedMs = this.simWorld.presentationElapsedMs;
    if ((elapsedMs - this._lanTraceLastMs) < 1000.0) {
      return;
    }
    this._lanTraceLastMs = elapsedMs;
    lanDebugLog(
      'mode_heartbeat',
      { mode: this.constructor.name, elapsedMs: int(elapsedMs), role: String(this._lanRole), expectedPlayers: int(this._lanExpectedPlayers), connectedPlayers: int(this._lanConnectedPlayers), waitingForPlayers: this._lanWaitingForPlayers, waitGateActive: this._lanWaitGateActive(), localPlayers: this.simWorld.players.length },
    );
  }

  protected _drawLanDebugInfo(opts: { x: number; y: number; lineH: number }): number {
    const x = opts.x;
    let y = opts.y;
    const lineH = opts.lineH;
    if (!debugEnabled() || !this._lanEnabled) {
      return y;
    }

    const role = String(this._lanRole || '?');
    const expected = int(this._lanExpectedPlayers);
    const connected = int(this._lanConnectedPlayers);
    const slot = int(this._lanLocalSlotIndex);
    const state = this._lanWaitGateActive() ? 'waiting' : 'active';
    this._drawUiText(`lan: role=${role} slot=${slot} players=${connected}/${expected} state=${state}`, new Vec2(x, y), wgl.makeColor(130 / 255, 180 / 255, 240 / 255, 255 / 255), 0.9);
    y += lineH;

    const runtime = this._lanRuntime;
    if (runtime !== null) {
      for (const line of runtime.debugOverlayLines()) {
        this._drawUiText(String(line), new Vec2(x, y), wgl.makeColor(232 / 255, 197 / 255, 117 / 255, 255 / 255), 0.85);
        y += lineH;
      }
    }

    this._drawUiText(`telemetry: runtime_updates=${int(this._runtimeUpdatesPerFrame)} ticks=${int(this._ticksAdvancedPerFrame)} stalls=${int(this._inputStallCount)}`, new Vec2(x, y), wgl.makeColor(130 / 255, 180 / 255, 240 / 255, 255 / 255), 0.8);
    y += lineH;
    this._drawUiText(`timers(ms): sim=${this._simMs.toFixed(3)} plan=${this._presentationPlanMs.toFixed(3)} apply=${this._presentationApplyMs.toFixed(3)}`, new Vec2(x, y), wgl.makeColor(130 / 255, 180 / 255, 240 / 255, 255 / 255), 0.8);
    y += lineH;

    if (this._lanWaitGateActive()) {
      this._drawUiText('lan(wait): simulation paused until all peers are ready', new Vec2(x, y), wgl.makeColor(130 / 255, 180 / 255, 240 / 255, 255 / 255), 0.9);
      y += lineH;
    }

    return y;
  }

  protected _drawLanWaitOverlay(): void {
    if (!this._lanWaitGateActive()) {
      return;
    }

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    if (screenW <= 0.0 || screenH <= 0.0) {
      return;
    }

    wgl.drawRectangle(0, 0, int(screenW), int(screenH), wgl.makeColor(8 / 255, 12 / 255, 18 / 255, 148 / 255));

    const panelW = Math.min(560.0, Math.max(320.0, screenW - 80.0));
    const panelH = 156.0;
    const panelX = 0.5 * (screenW - panelW);
    const panelY = Math.max(36.0, 0.17 * screenH);

    wgl.drawRectangle(int(panelX), int(panelY), int(panelW), int(panelH), wgl.makeColor(17 / 255, 24 / 255, 34 / 255, 230 / 255));
    wgl.drawRectangleLinesEx(wgl.makeRectangle(panelX, panelY, panelW, panelH), 2.0, wgl.makeColor(108 / 255, 170 / 255, 230 / 255, 220 / 255));

    const dots = '.'.repeat(int((this._cursorPulseTime * 2.5) % 4));
    const title = `Waiting for LAN players${dots}`;
    const connected = int(this._lanConnectedPlayers);
    const expected = int(this._lanExpectedPlayers);
    const status = `Connected peers: ${connected}/${expected}`;
    const role = String(this._lanRole) === 'host' ? 'Host' : 'Client';
    const roleLine = `Role: ${role}`;
    const hint = role === 'Host' ? 'Match will start automatically when all peers are connected.' : 'Waiting for host to finish lobby and start the match.';

    const textX = panelX + 22.0;
    const textY = panelY + 20.0;
    const lineH = this._uiLineHeight(0.95);
    this._drawUiText(title, new Vec2(textX, textY), wgl.makeColor(230 / 255, 237 / 255, 247 / 255, 255 / 255), 0.95);
    this._drawUiText(status, new Vec2(textX, textY + lineH * 1.4), wgl.makeColor(169 / 255, 214 / 255, 255 / 255, 255 / 255), 0.9);
    this._drawUiText(roleLine, new Vec2(textX, textY + lineH * 2.4), wgl.makeColor(169 / 255, 214 / 255, 255 / 255, 255 / 255), 0.9);
    this._drawUiText(hint, new Vec2(textX, textY + lineH * 3.5), wgl.makeColor(186 / 255, 196 / 255, 214 / 255, 255 / 255), 0.82);

    if (debugEnabled()) {
      this._drawUiText('Debug: waiting for all peers before simulation starts', new Vec2(textX, textY + lineH * 4.5), wgl.makeColor(232 / 255, 197 / 255, 117 / 255, 255 / 255), 0.8);
    }
  }

  protected _netReplaySnapshotState(): ReplayStateSnapshotV2 | null {
    const recorder = this._replayRecorder;
    if (recorder === null) {
      return null;
    }
    return new ReplayStateSnapshotV2({ tickIndex: int(recorder.tickIndex), recordedTickCount: int(recorder.recordedTickCount) });
  }

  protected _storeNetRuntimeSnapshot(opts: { snapshot: ModeStateSnapshotV2 }): void {
    const snapshot = opts.snapshot;
    const runtime = this._rollbackRuntime;
    if (runtime === null) {
      return;
    }
    const tick = Math.max(0, int(snapshot.tickIndex));
    if ((tick % 4) !== 0) {
      return;
    }
    const payload = encodeModeSnapshot({ snapshot: snapshot });
    runtime.storeLocalSnapshot(int(tick), payload);
  }

  protected _consumeNetRuntimeRecovery(opts: { modeName: "survival" | "rush" | "quests" }): void {
    const modeName = opts.modeName;
    const runtime = this._rollbackRuntime;
    if (runtime === null) {
      return;
    }
    const rollbackFrom = runtime.popRollbackFrom();
    if (rollbackFrom !== null) {
      lanDebugLog(
        'rollback_requested',
        { mode: String(modeName), role: String(this._lanRole), fromTick: int(rollbackFrom) },
      );
    }

    const pending = runtime.popResyncSnapshot();
    if (pending === null) {
      return;
    }
    const [tickIndex, payload] = pending;
    let snapshot: ReturnType<typeof decodeModeSnapshot>;
    try {
      snapshot = decodeModeSnapshot(payload);
    } catch (exc) {
      if (!(exc instanceof RollbackResyncV5Error)) {
        throw exc;
      }
      runtime.error = `resync_decode_error:${exc instanceof Error ? exc.message : String(exc)}`;
      return;
    }
    if (String(snapshot.mode) !== String(modeName)) {
      runtime.error = 'resync_mode_mismatch';
      return;
    }
    if (int(snapshot.tickIndex) !== int(tickIndex)) {
      runtime.error = 'resync_tick_mismatch';
      return;
    }
    this._applyResyncSnapshot(snapshot);
    this._resetTickRunnerState();
    runtime.markResyncApplied(int(tickIndex));
  }

  protected _applyResyncSnapshot(snapshot: ModeStateSnapshotV2): void {
    throw new Error(`${this.constructor.name}._apply_resync_snapshot() must be implemented`);
  }

  protected _playerNameDefault(): string {
    return String(this.config.profile.playerName || '');
  }

  protected _runtimePlayerCount(): number {
    return this.config.gameplay.playerCount;
  }

  protected _deterministicDetailPreset(): number {
    if (this._lanEnabled) {
      return int(LAN_SIM_DETAIL_PRESET);
    }
    return this.config.display.detailPreset;
  }

  protected _deterministicViolenceDisabled(): number {
    if (this._lanEnabled) {
      return int(LAN_SIM_VIOLENCE_DISABLED);
    }
    return this.config.display.violenceDisabled;
  }

  update(dt: number): void {
    throw new Error(`${this.constructor.name}.update() must be implemented by gameplay mode`);
  }

  draw(): void {
    throw new Error(`${this.constructor.name}.draw() must be implemented by gameplay mode`);
  }

  open(): void {
    this.closeRequested = false;
    this._action = null;
    this._paused = false;
    this._small = loadSmallFont(this._assetsRoot);
    this._hudState = new HudState();

    this._gameOverActive = false;
    this._gameOverRecord = null;
    this._gameOverBanner = 'reaper';
    this._gameOverUi.close();

    // Native game_over/victory transitions call `sfx_mute_all` on menu + extra
    // tracks before restarting gameplay ("Play Again"), resetting first-hit tune gate.
    stopMusic(this.audio);

    const playerCount = this._runtimePlayerCount();
    const seedSource = this._lanSeedOverride !== null ? 'lan_override' : 'session_state';
    let seed: number;
    if (this._lanSeedOverride !== null) {
      seed = int(this._lanSeedOverride);
    } else {
      seed = int(this.state.rng.state);
    }
    this._runResetSeed = (int(seed) >>> 0);

    // Reset LAN sim status at the start of each run so per-session usage
    // counts (weapon bias) start from a consistent baseline across peers.
    this._refreshEffectiveStatus({ resetLanStatus: true });

    this._syncWorldRuntimeConfig();
    this._worldRuntime.reset({ seed: seed, playerCount: Math.max(1, Math.min(4, int(playerCount))) });
    this._worldRuntime.openRuntime();
    this._bindWorld();
    const ground = this.renderResources.ground;
    lanDebugLog(
      'mode_world_reset',
      { mode: this.constructor.name, seed: int(this._runResetSeed), seedSource: String(seedSource), rngState: int(this.simWorld.state.rng.state), worldSize: this.worldSize, playerCount: this.simWorld.players.length, lanEnabled: this._lanEnabled, lanRole: String(this._lanRole), lanSlot: int(this._lanLocalSlotIndex), baseStatusQuestUnlockIndex: this._statusBase !== null ? int(this._statusBase.questUnlockIndex) : 0, baseStatusQuestUnlockIndexFull: this._statusBase !== null ? int(this._statusBase.questUnlockIndexFull) : 0, simStatusQuestUnlockIndex: this._statusSim !== null ? int(this._statusSim.questUnlockIndex) : 0, simStatusQuestUnlockIndexFull: this._statusSim !== null ? int(this._statusSim.questUnlockIndexFull) : 0, detailPreset: this.config.display.detailPreset, violenceDisabled: this.config.display.violenceDisabled, simDetailPreset: int(this._deterministicDetailPreset()), simViolenceDisabled: int(this._deterministicViolenceDisabled()), screenW: int(wgl.getScreenWidth()), screenH: int(wgl.getScreenHeight()), renderW: int(wgl.getScreenWidth()), renderH: int(wgl.getScreenHeight()), terrainTextureScale: ground !== null ? ground.textureScale : 0.0 },
    );
    this._localInput.reset({ players: this.simWorld.players });
    this._networkInputProvider = new LanRuntimeInputProvider({ playerCount: Math.max(0, this.simWorld.players.length), tickRate: int(BaseGameplayMode._deterministicTickRate()) });
    this._resetLanCaptureClock();
    this._resetTickRunnerState();
    this._resetReplayCaptureState({ clearRecorder: false });

    this._uiMouse = new Vec2(wgl.getScreenWidth() * 0.5, wgl.getScreenHeight() * 0.5);
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
    throw new Error('NotImplementedError');
  }

  protected _updateGameOverUi(dt: number): void {
    let record = this._gameOverRecord;
    if (record === null) {
      this._enterGameOver();
      record = this._gameOverRecord;
    }
    if (record === null) {
      return;
    }

    const action = this._gameOverUi.update(dt, { record: record, playerNameDefault: this._playerNameDefault(), playSfx: this.audioBridge.router.playSfx?.bind(this.audioBridge.router) ?? null, rng: null, mouse: this._uiMousePos() });
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
    if (!this._gameOverActive) {
      return 1.0;
    }
    return this._gameOverUi.worldEntityAlpha();
  }

  drawPauseBackground(opts: { entityAlpha?: number } = {}): void {
    const entityAlpha = opts.entityAlpha ?? 1.0;
    let alpha = entityAlpha;
    if (alpha < 0.0) {
      alpha = 0.0;
    } else if (alpha > 1.0) {
      alpha = 1.0;
    }
    this._drawWorld({ drawAimIndicators: false, entityAlpha: this._worldEntityAlpha() * alpha });
  }

  stealGroundForMenu(): any {
    const ground = this.renderResources.ground;
    this.renderResources.ground = null;
    return ground;
  }

  adoptGroundFromMenu(ground: GroundRenderer | null): void {
    if (ground === null) {
      return;
    }
    const current = this.renderResources.ground;
    if (current !== null && current !== ground && current.renderTarget !== null) {
      wgl.unloadRenderTexture(current.renderTarget);
      current.renderTarget = null;
    }
    this.renderResources.ground = ground;
  }

  menuGroundCamera(): Vec2 {
    return this.camera;
  }

  consoleElapsedMs(): number {
    return this.simWorld.presentationElapsedMs;
  }

  prepareDemoTrialOverlayFrame(): void {
    this._worldRuntime.updateCamera(0.0);
    this._syncAudioAndGround();
  }

  regenerateTerrainForConsole(): void {
    if (this.renderResources.ground === null) {
      return;
    }
    // Keep this deterministic without consuming gameplay RNG.
    this._terrainRegenCounter = ((int(this._terrainRegenCounter) + 1) >>> 0);
    const terrainSeed = ((int(this.state.rng.state) + int(this._terrainRegenCounter)) >>> 0);
    this.renderResources.ground.scheduleGenerate({ seed: terrainSeed });
  }

  protected _drawScreenFade(): void {
    let fadeAlpha = 0.0;
    if (this._screenFade !== null) {
      fadeAlpha = this._screenFade.screenFadeAlpha;
    }
    if (fadeAlpha <= 0.0) {
      return;
    }
    const alpha = int(255 * Math.max(0.0, Math.min(1.0, fadeAlpha)));
    wgl.drawRectangle(0, 0, int(wgl.getScreenWidth()), int(wgl.getScreenHeight()), wgl.makeColor(0 / 255, 0 / 255, 0 / 255, alpha / 255));
  }

  protected _buildLocalInputs(opts: { dt: number }): PlayerInput[] {
    const dt = opts.dt;
    return this._localInput.buildFrameInputs({ players: this.simWorld.players, config: this.config, mouseScreen: this._uiMouse, screenToWorld: this.screenToWorld, dt: dt, creatures: this.creatures.entries });
  }

  protected static _clearLocalInputEdges(inputs: PlayerInput[]): PlayerInput[] {
    return clearInputEdges(inputs);
  }

  protected static _deterministicTickRate(): number {
    return 60;
  }

  protected _gameplayTickRate(): number {
    return int(BaseGameplayMode._deterministicTickRate());
  }

  protected _gameplayTickDt(opts: { session?: DeterministicSession | null } = {}): number {
    const session = opts.session ?? null;
    const _ = session;
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
    const clearRecorder = opts.clearRecorder;
    this._queuedInputCommands.length = 0;
    if (clearRecorder) {
      this._replayRecorder = null;
    }
    this._replayCheckpoints.length = 0;
    this._replayCheckpointsLastTick = null;
  }

  protected _lanCaptureTickDt(): number {
    return this._networkInputProvider.captureTickDt;
  }

  protected _advanceLanCaptureTicks(dt: number): number {
    return int(this._networkInputProvider.advanceCaptureTicks(dt));
  }

  protected _resetLanCaptureClock(): void {
    this._networkInputProvider.resetCaptureClock();
  }

  protected _buildLanSyncCallbacks(opts: { runtime: LanRuntime; lockstepRuntime: LockstepRuntime | null; role: string; provider: LanRuntimeInputProvider }): LanSyncCallbacks {
    const runtime = opts.runtime;
    const lockstepRuntime = opts.lockstepRuntime;
    const role = opts.role;
    const provider = opts.provider;
    return new LanSyncCallbacks({ role: role, takeFrameSample: provider.takeFrameSample, broadcastTickFrame: (role === 'host' && lockstepRuntime !== null ? ((frameTickIndex, frameInputs, commands) => lockstepRuntime.broadcastTickFrame(new TickFrame({ tickIndex: int(frameTickIndex), frameInputs: Array.from(frameInputs).map((packed) => Array.from(packed)), commands: Array.from(commands) }))) : null) });
  }

  protected _ensureTickRunner(opts: { session: DeterministicSession; isNetworked: boolean; lanRuntime?: LanRuntime | null; lockstepRuntime?: LockstepRuntime | null; role?: string }): [TickRunner, LocalInputProvider | LanRuntimeInputProvider] {
    const session = opts.session;
    const isNetworked = opts.isNetworked;
    const lanRuntime = opts.lanRuntime ?? null;
    const lockstepRuntime = opts.lockstepRuntime ?? null;
    const role = opts.role ?? '';
    const _ = lockstepRuntime;
    let runner = this._tickRunner;
    let provider = this._tickInputProvider;
    if (runner !== null && provider !== null && this._tickRunnerSession === session && this._tickRunnerIsNetworked === isNetworked && (!isNetworked || String(this._tickRunnerNetworkRole) === role)) {
      if (isNetworked) {
        if (!(provider instanceof LanRuntimeInputProvider)) {
          throw new TypeError('networked tick runner provider must be _LanRuntimeInputProvider');
        }
        provider.bindRuntime(lanRuntime);
        provider.setRole(role);
        provider.setBeforePop(null);
        this._tickRunnerLocalClock = null;
      } else if (this._tickRunnerLocalClock === null) {
        this._tickRunnerLocalClock = new FixedStepClock({ tickRate: int(this._gameplayTickRate()) });
      }
      return [runner, provider];
    }

    if (isNetworked) {
      provider = this._networkInputProvider;
      provider.bindRuntime(lanRuntime);
      provider.setRole(role);
      provider.setBeforePop(null);
    } else {
      provider = new LocalInputProvider({ playerCount: Math.max(0, this.simWorld.players.length), buildInputs: (frameCtx) => this._buildLocalInputs({ dt: frameCtx.dtSeconds }) });
    }
    this._flushQueuedInputCommands({ provider: provider });

    runner = new TickRunner({ session: session, inputProvider: provider, config: new TickRunnerConfig() });
    this._tickRunner = runner;
    this._tickInputProvider = provider;
    this._tickRunnerSession = session;
    this._tickRunnerIsNetworked = isNetworked;
    this._tickRunnerNetworkRole = isNetworked ? role : '';
    this._tickRunnerFrameIndex = 0;
    this._tickRunnerNextTickIndex = 0;
    this._tickRunnerLocalClock = isNetworked ? null : new FixedStepClock({ tickRate: int(this._gameplayTickRate()) });
    return [runner, provider];
  }

  protected static _prepareLanTickSync(opts: { tickResult: TickResult; callbacks: LanSyncCallbacks }): void {
    const tickResult = opts.tickResult;
    const callbacks = opts.callbacks;
    const sourceTick = tickResult.sourceTick;
    const sample = callbacks.takeFrameSample(int(sourceTick.tickIndex));
    if (sample === null) {
      throw new Error('lan tick runner completed without runtime frame metadata');
    }
    if (!pythonEquals(Array.from(sourceTick.commands), Array.from(sample.commands))) {
      throw new Error('lan tick result commands diverged from canonical frame');
    }
    tickResult.lanSync = new LanTickSync({ frameTickIndex: int(sample.frameTickIndex), frameInputs: Array.from(sample.frameInputs) });
  }

  protected static _finalizeLanTickSync(opts: { tickResult: TickResult; callbacks: LanSyncCallbacks }): void {
    const tickResult = opts.tickResult;
    const callbacks = opts.callbacks;
    const sync = tickResult.lanSync;
    if (sync === null) {
      throw new Error('lan tick result missing frame metadata');
    }
    const frameTickIndex = int(sync.frameTickIndex);
    const role = String(callbacks.role);

    const broadcast = callbacks.broadcastTickFrame;
    if (role === 'host' && broadcast !== null) {
      broadcast(int(frameTickIndex), Array.from(sync.frameInputs), Array.from(tickResult.sourceTick.commands));
    }
  }

  protected _recordReplayCheckpointFromTick(opts: { tickIndex: number | null; tick: DeterministicSessionTick }): void {
    const tickIndex = opts.tickIndex;
    const tick = opts.tick;
    if (tickIndex === null) {
      return;
    }
    const worldEvents = tick.step.events;
    this._recordReplayCheckpoint(
      int(tickIndex),
      { deaths: worldEvents.deaths, events: worldEvents },
    );
  }

  protected _lanModeName(): "survival" | "rush" | "quests" {
    throw new Error('NotImplementedError');
  }

  protected _lanMatchSession(): DeterministicSession | null {
    throw new Error('NotImplementedError');
  }

  protected _lanPrepareFrame(role: string, dtUiMs: number, session: LanSession, dtTick: number): boolean {
    const _ = [role, dtUiMs, session, dtTick];
    return true;
  }

  protected _lanAllowFramePop(): boolean {
    return true;
  }

  protected _lanOnTickApplied(tick: DeterministicSessionTick, frameTickIndex: number | null, dtTick: number): LanStepAction {
    const _ = [tick, frameTickIndex, dtTick];
    return 'continue';
  }

  protected _lanOnPaused(dt: number): void {
    const _ = dt;
  }

  protected _updateLanMatch(opts: { dt: number; dtUiMs?: number }): void {
    const dt = opts.dt;
    const dtUiMs = opts.dtUiMs ?? 0.0;
    const runtime = this._lanRuntime;
    if (runtime === null) {
      return;
    }
    const session = this._lanMatchSession();
    if (session === null) {
      return;
    }
    const lockstepRuntime = this._lockstepRuntime();
    const role = this._prepareLanMatchRuntime({ modeName: this._lanModeName() });
    if (role === null) {
      return;
    }
    this._traceLanTerrainGeneration();
    if (pythonTruthy(this._lanTerrainGenerationPending())) {
      this._resetLanCaptureClock();
      return;
    }

    if (this._paused) {
      this._resetGameplayFrameClock();
      this._lanOnPaused(dt);
      return;
    }

    const dtTick = this._lanCaptureTickDt();
    if (!this._lanPrepareFrame(role, dtUiMs, session, dtTick)) {
      return;
    }

    if (role === 'join') {
      if (this._consumeLanTickFrames({ runtime: runtime, lockstepRuntime: lockstepRuntime, session: session, role: role, dtTick: dtTick })) {
        return;
      }
    }

    const ticksToCapture = this._advanceLanCaptureTicks(dt);
    this._queueLanLocalInputs({
      runtime: runtime,
      ticksToCapture: int(ticksToCapture),
      dt: dt,
    });
    this._consumeLanTickFrames({
      runtime: runtime,
      lockstepRuntime: lockstepRuntime,
      session: session,
      role: role,
      dtTick: dtTick,
    });
  }

  protected _prepareLanMatchRuntime(opts: { modeName: "survival" | "rush" | "quests" }): string | null {
    const modeName = opts.modeName;
    const runtime = this._lanRuntime;
    if (runtime === null) {
      return null;
    }
    const role = String(this._lanRole);
    this._consumeNetRuntimeRecovery({ modeName: modeName });
    if (String(runtime.error || '')) {
      this.closeRequested = true;
      return null;
    }
    this._syncAudioAndGround();
    if (role === 'host' && !runtime.hostRemoteInputsReady()) {
      return null;
    }
    return role;
  }

  protected _queueLanLocalInputs(opts: { runtime: LanRuntime; ticksToCapture: number; dt: number }): void {
    const runtime = opts.runtime;
    const ticksToCapture = opts.ticksToCapture;
    const dt = opts.dt;
    if (int(ticksToCapture) <= 0) {
      return;
    }
    const inputFrame = this._buildLocalInputs({ dt: dt });
    // In LAN sessions each peer is a single local player, so always sample
    // inputs using the configured Player 1 bindings (index 0). The network
    // slot mapping is handled by the lockstep runtime.
    const localInputIndex = 0;
    for (let tickOffset = 0; tickOffset < int(ticksToCapture); tickOffset++) {
      const inputs = tickOffset === 0 ? inputFrame : BaseGameplayMode._clearLocalInputEdges(inputFrame);
      let localInput = new PlayerInput();
      if (localInputIndex >= 0 && localInputIndex < inputs.length) {
        localInput = inputs[localInputIndex];
      }
      runtime.queueLocalInput(packPlayerInput(localInput));
    }
  }

  protected _consumeLanTickFrames(opts: { runtime: LanRuntime; lockstepRuntime: LockstepRuntime | null; session: DeterministicSession; role: string; dtTick: number }): boolean {
    const runtime = opts.runtime;
    const lockstepRuntime = opts.lockstepRuntime;
    const session = opts.session;
    const role = opts.role;
    const dtTick = opts.dtTick;
    const [runner, provider] = this._ensureTickRunner({ session: session, isNetworked: true, lanRuntime: runtime, lockstepRuntime: lockstepRuntime, role: role });
    if (!(provider instanceof LanRuntimeInputProvider)) {
      throw new TypeError('networked tick runner provider must be _LanRuntimeInputProvider');
    }
    provider.bindRuntime(runtime);
    provider.setBeforePop(this._lanAllowFramePop.bind(this));
    const simNsStart = (performance.now() * 1_000_000);
    const ticksRequested = dtTick > 0.0 ? 1 : 0;
    // LAN always requests exactly 0 or 1 ticks per frame. This ensures
    // _on_tick_applied stop actions never discard simulated-but-unapplied ticks.
    if (!(ticksRequested <= 1)) throw new Error();
    const advance = advanceTickRunnerFrame({ runner: runner, startTick: int(this._tickRunnerNextTickIndex), frameIndex: int(this._tickRunnerFrameIndex), ticksRequested: int(ticksRequested), dtSeconds: dtTick, tickDtSeconds: dtTick, isNetworked: true, isReplay: false });
    this._tickRunnerFrameIndex = int(advance.frameIndex);
    this._tickRunnerNextTickIndex = int(advance.nextTickIndex);
    const batch = advance.batch;
    const simMs = ((performance.now() * 1_000_000) - simNsStart) / 1_000_000.0;
    this._simMs += simMs;
    this._presentationPlanMs += batch.completedResults.reduce((total, row) => total + Math.max(0.0, row.payload.step.presentationPlanMs), 0);

    let ticksApplied = 0;
    let stopAfterFinalize = false;
    if (int(batch.ticksCompleted) <= 0) {
      if (provider.popBlocked) {
        return false;
      }
    } else {
      const lanSyncCallbacks = this._buildLanSyncCallbacks({ runtime: runtime, lockstepRuntime: lockstepRuntime, role: role, provider: provider });

      const _onTickApplied = (applied: AppliedBatchTick): LanStepAction => {
        const frameTickIndex = applied.frameTickIndex;
        if (frameTickIndex === null) {
          throw new Error('lan tick runner completed without runtime frame metadata');
        }
        return this._lanOnTickApplied(applied.tick, int(frameTickIndex), dtTick);
      };

      const applyNsStart = (performance.now() * 1_000_000);
      const outcome = this._processTickBatchResults({ batch: batch, session: session, recorder: this._replayRecorder, lanSyncCallbacks: lanSyncCallbacks, onTickApplied: _onTickApplied, onCheckpoint: (replayTickIndex, tick) => this._recordReplayCheckpointFromTick({ tickIndex: int(replayTickIndex), tick: tick }) });
      this._applyBatchPresentationOutputs({
        outputs: outcome.presentationOutputs,
        postApplyReactions: outcome.postApplyReactions,
        applyAudio: true,
        updateCamera: true,
      });
      const applyMs = ((performance.now() * 1_000_000) - applyNsStart) / 1_000_000.0;
      ticksApplied = int(outcome.ticksApplied);
      stopAfterFinalize = outcome.stopAfterFinalize;
      this._presentationApplyMs += applyMs;
    }
    if (int(ticksApplied) <= 0) {
      this._inputStallCount += 1;
    }
    return stopAfterFinalize;
  }

  protected _syncAudioAndGround(): void {
    this._worldRuntime.syncAudioBridgeState();
    if (this.renderResources.ground !== null) {
      this.renderResources.ground.processPending();
    }
  }

  protected _applyBatchPresentationOutputs(opts: { outputs: readonly PresentationTickOutput[]; postApplyReactions?: readonly PostApplyReaction[]; applyAudio: boolean; updateCamera: boolean }): void {
    const outputs = opts.outputs;
    const postApplyReactions = opts.postApplyReactions ?? [];
    const applyAudio = opts.applyAudio;
    const updateCamera = opts.updateCamera;
    if (postApplyReactions.length > 0 && postApplyReactions.length !== outputs.length) {
      throw new Error('post-apply reactions must align with presentation outputs');
    }
    const reactionByTick = new Map(Array.from(zip(outputs, postApplyReactions, { strict: false }), ([output, reaction]: any) => [int(output.tickIndex), reaction] as const));
    applyPresentationOutputs({
      outputs: outputs,
      syncAudioBridgeState: this._worldRuntime.syncAudioBridgeState?.bind(this._worldRuntime) ?? null,
      applyAudioPlan: (plan, shouldApplyAudio) => this._worldRuntime.audioBridge.applyPlan({ plan: plan, applyAudio: Boolean(shouldApplyAudio) }),
      applyTerrainFx: this.renderResources.consumeTerrainFxBatch,
      updateCamera: updateCamera ? this._worldRuntime.updateCamera : null,
      onOutputApplied: (output) => this._applyTickPostApplyReaction(reactionByTick.get(int(output.tickIndex)) ?? new PostApplyReaction(), { dtSeconds: output.dtSim }),
      applyAudio: applyAudio,
    });
  }

  protected _buildTickPostApplyReaction(opts: { tickResult: TickResult }): PostApplyReaction {
    const tickResult = opts.tickResult;
    return buildPostApplyReaction({ tickResult: tickResult });
  }

  protected _applyTickPostApplyReaction(reaction: PostApplyReaction, opts: { dtSeconds: number }): void {
    const dtSeconds = opts.dtSeconds;
    const _ = dtSeconds;
    applyPostApplyReaction({
      reaction: reaction,
      playSfx: this.audioBridge.router.playSfx?.bind(this.audioBridge.router) ?? null,
    });
  }

  protected _processTickBatchResults(opts: { batch: TickBatchResult; session: DeterministicSession; recorder?: ReplayRecorder | null; lanSyncCallbacks?: LanSyncCallbacks | null; onTickApplied?: ((arg0: AppliedBatchTick) => LanStepAction) | null; onCheckpoint?: ((arg0: number, arg1: DeterministicSessionTick) => void) | null }): BatchApplyOutcome {
    const batch = opts.batch;
    const session = opts.session;
    const recorder = opts.recorder ?? null;
    const lanSyncCallbacks = opts.lanSyncCallbacks ?? null;
    const onTickApplied = opts.onTickApplied ?? null;
    const onCheckpoint = opts.onCheckpoint ?? null;
    let ticksApplied = 0;
    let stopAfterFinalize = false;
    const presentationOutputs: PresentationTickOutput[] = [];
    const postApplyReactions: PostApplyReaction[] = [];

    for (const tickResult of batch.completedResults) {
      const tick = tickResult.payload;
      let replayTickIndex = tickResult.replayTickIndex;
      if (replayTickIndex === null && recorder !== null) {
        replayTickIndex = int(recorder.recordTick(Array.from(tickResult.sourceTick.inputs), { commands: tickResult.sourceTick.commands }));
        tickResult.replayTickIndex = replayTickIndex;
      }
      const applied = new AppliedBatchTick({ tick: tick, replayTickIndex: replayTickIndex });
      if (lanSyncCallbacks !== null) {
        BaseGameplayMode._prepareLanTickSync({
          tickResult: tickResult,
          callbacks: lanSyncCallbacks,
        });
      }
      if (tickResult.lanSync !== null) {
        applied.frameTickIndex = int(tickResult.lanSync.frameTickIndex);
      }

      presentationOutputs.push(applySimMetadataTickResult({ simWorld: this.simWorld, tickResult: tickResult, gameTuneStarted: session.gameTuneStarted }));
      postApplyReactions.push(this._buildTickPostApplyReaction({ tickResult: tickResult }));
      this._ticksAdvancedPerFrame += 1;
      ticksApplied += 1;

      let action: LanStepAction = 'continue';
      if (onTickApplied !== null) {
        action = onTickApplied(applied);
      }
      if (action === 'stop_before_finalize') {
        return new BatchApplyOutcome({ ticksApplied: int(ticksApplied), stopped: true, stopAfterFinalize: false, presentationOutputs: Array.from(presentationOutputs), postApplyReactions: Array.from(postApplyReactions) });
      }

      if (replayTickIndex !== null && onCheckpoint !== null) {
        onCheckpoint(int(replayTickIndex), tick);
      }

      if (lanSyncCallbacks !== null) {
        BaseGameplayMode._finalizeLanTickSync({
          tickResult: tickResult,
          callbacks: lanSyncCallbacks,
        });
      }

      if (action === 'stop_after_finalize') {
        stopAfterFinalize = true;
        return new BatchApplyOutcome({ ticksApplied: int(ticksApplied), stopped: true, stopAfterFinalize: stopAfterFinalize, presentationOutputs: Array.from(presentationOutputs), postApplyReactions: Array.from(postApplyReactions) });
      }
    }

    return new BatchApplyOutcome({ ticksApplied: int(ticksApplied), stopped: false, stopAfterFinalize: stopAfterFinalize, presentationOutputs: Array.from(presentationOutputs), postApplyReactions: Array.from(postApplyReactions) });
  }

  protected _runDeterministicSessionTicks(opts: { dtFrame: number; session: DeterministicSession; recorder: ReplayRecorder | null; onTick: (arg0: DeterministicSessionTick, arg1: number | null) => boolean; onCheckpoint?: ((arg0: number, arg1: DeterministicSessionTick) => void) | null }): void {
    const dtFrame = opts.dtFrame;
    const session = opts.session;
    const recorder = opts.recorder;
    const onTick = opts.onTick;
    const onCheckpoint = opts.onCheckpoint ?? null;
    if (dtFrame <= 0.0) {
      return;
    }
    this._syncAudioAndGround();
    session.detailPreset = int(this._deterministicDetailPreset());
    session.violenceDisabled = int(this._deterministicViolenceDisabled());
    const [runner, provider] = this._ensureTickRunner({ session: session, isNetworked: false });
    if (!(provider instanceof LocalInputProvider)) {
      throw new TypeError('local tick runner provider must be LocalInputProvider');
    }
    let localClock = this._tickRunnerLocalClock;
    if (localClock === null) {
      localClock = new FixedStepClock({ tickRate: int(this._gameplayTickRate()) });
      this._tickRunnerLocalClock = localClock;
    }

    const candidateTicks = int(localClock.advance(dtFrame));
    const tickDt = localClock.dtTick;
    const simNsStart = (performance.now() * 1_000_000);
    const advance = advanceTickRunnerFrame({ runner: runner, startTick: int(this._tickRunnerNextTickIndex), frameIndex: int(this._tickRunnerFrameIndex), ticksRequested: int(candidateTicks), dtSeconds: dtFrame, tickDtSeconds: tickDt, isNetworked: false, isReplay: false, refundClock: localClock });
    this._tickRunnerFrameIndex = int(advance.frameIndex);
    this._tickRunnerNextTickIndex = int(advance.nextTickIndex);
    const batch = advance.batch;
    this._simMs = ((performance.now() * 1_000_000) - simNsStart) / 1_000_000.0;
    this._presentationPlanMs = batch.completedResults.reduce((total, row) => total + Math.max(0.0, row.payload.step.presentationPlanMs), 0);

    const applyNsStart = (performance.now() * 1_000_000);
    const outcome = this._processTickBatchResults({ batch: batch, session: session, recorder: recorder, onTickApplied: (applied) => onTick(applied.tick, applied.replayTickIndex) ? 'stop_after_finalize' : 'continue', onCheckpoint: onCheckpoint });
    this._applyBatchPresentationOutputs({
      outputs: outcome.presentationOutputs,
      postApplyReactions: outcome.postApplyReactions,
      applyAudio: true,
      updateCamera: true,
    });
    this._presentationApplyMs = ((performance.now() * 1_000_000) - applyNsStart) / 1_000_000.0;
    if (batch.batchStatus === InputStatus.STALLED && int(batch.ticksCompleted) <= 0) {
      this._inputStallCount += 1;
    }
  }
}
