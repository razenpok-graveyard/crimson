// Port of crimson/game/types.py

import type { Crand } from '@grim/rand.ts';
import type { GameMode } from '@crimson/game-modes.ts';
import type { RoomCode } from '@crimson/net/room-code.ts';
import { defaultRuntimeDir } from '@crimson/paths.ts';
import type { PauseBackground } from '@crimson/pause-background.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import { RtxRenderMode } from '@crimson/render/rtx/mode.ts';
import type { RuntimeResources } from '@grim/assets.ts';
import type { AudioState } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { Vec2 } from '@grim/geom.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { QuestRunOutcome } from '@crimson/modes/quest-mode.ts';
import type { LockstepRuntime } from '@crimson/net/lockstep-runtime.ts';
import type { RollbackRuntime } from '@crimson/net/rollback-runtime.ts';
import type { GameStatus, GameStatusData } from '@crimson/persistence/save-status.ts';
export { type PauseBackground } from '@crimson/pause-background.ts';

export type NetworkSessionMode = "survival" | "rush" | "quests";
export type NetworkSessionRole = "host" | "join";
export type NetcodeMode = "rollback" | "lockstep";
export type NetworkEndpoint = LockstepEndpoint | RollbackEndpoint;

function defaultRtxRenderMode(): RtxRenderMode {
  return RtxRenderMode.CLASSIC;
}

export class GameConfig {
  readonly baseDir: string;
  readonly assetsDir: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number;
  readonly seed: number | null;
  readonly demoEnabled: boolean;
  readonly noIntro: boolean;
  readonly debug: boolean;
  readonly rtx: boolean;
  readonly preserveBugs: boolean;
  readonly pendingNetworkSession: PendingNetworkSession | null;

  constructor(opts: {
    baseDir?: string;
    assetsDir?: string | null;
    width?: number | null;
    height?: number | null;
    fps?: number;
    seed?: number | null;
    demoEnabled?: boolean;
    noIntro?: boolean;
    debug?: boolean;
    rtx?: boolean;
    preserveBugs?: boolean;
    pendingNetworkSession?: PendingNetworkSession | null;
  } = {}) {
    this.baseDir = opts.baseDir ?? defaultRuntimeDir();
    this.assetsDir = opts.assetsDir ?? null;
    this.width = opts.width ?? null;
    this.height = opts.height ?? null;
    this.fps = opts.fps ?? 60;
    this.seed = opts.seed ?? null;
    this.demoEnabled = opts.demoEnabled ?? false;
    this.noIntro = opts.noIntro ?? false;
    this.debug = opts.debug ?? false;
    this.rtx = opts.rtx ?? false;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.pendingNetworkSession = opts.pendingNetworkSession ?? null;
  }
}

export class LockstepEndpoint {
  readonly bindHost: string;
  readonly host: string;
  readonly port: number;

  constructor(opts: {
    bindHost?: string;
    host?: string;
    port?: number;
  } = {}) {
    this.bindHost = opts.bindHost ?? '0.0.0.0';
    this.host = opts.host ?? '127.0.0.1';
    this.port = opts.port ?? 31993;
  }
}

export class RollbackEndpoint {
  readonly relayHost: string;
  readonly relayPort: number;
  readonly roomCode: RoomCode | null;

  constructor(opts: {
    relayHost?: string;
    relayPort?: number;
    roomCode?: RoomCode | null;
  } = {}) {
    this.relayHost = opts.relayHost ?? '127.0.0.1';
    this.relayPort = opts.relayPort ?? 31993;
    this.roomCode = opts.roomCode ?? null;
  }
}

export class NetworkSessionConfig {
  readonly mode: NetworkSessionMode;
  readonly endpoint: NetworkEndpoint;
  readonly netcodeMode: NetcodeMode;
  readonly playerCount: number;
  readonly questLevel: QuestLevel | null;
  readonly rollbackMaxTicks: number;
  readonly reconnectTimeoutMs: number;
  readonly inputDelayTicks: number;
  readonly preserveBugs: boolean;

  constructor(opts: {
    mode: NetworkSessionMode;
    endpoint: NetworkEndpoint;
    netcodeMode?: NetcodeMode;
    playerCount?: number;
    questLevel?: QuestLevel | null;
    rollbackMaxTicks?: number;
    reconnectTimeoutMs?: number;
    inputDelayTicks?: number;
    preserveBugs?: boolean;
  }) {
    this.mode = opts.mode;
    this.endpoint = opts.endpoint;
    this.netcodeMode = opts.netcodeMode ?? 'rollback';
    this.playerCount = opts.playerCount ?? 1;
    this.questLevel = opts.questLevel ?? null;
    this.rollbackMaxTicks = opts.rollbackMaxTicks ?? 8;
    this.reconnectTimeoutMs = opts.reconnectTimeoutMs ?? 15_000;
    this.inputDelayTicks = opts.inputDelayTicks ?? 1;
    this.preserveBugs = opts.preserveBugs ?? false;
    const endpoint = this.endpoint;
    if (this.netcodeMode === 'lockstep') {
      if (!(endpoint instanceof LockstepEndpoint)) {
        throw new TypeError('lockstep sessions require LockstepEndpoint');
      }
      return;
    }
    if (!(endpoint instanceof RollbackEndpoint)) {
      throw new TypeError('rollback sessions require RollbackEndpoint');
    }
  }
}

export class PendingNetworkSession {
  role: NetworkSessionRole;
  config: NetworkSessionConfig;
  autoStart: boolean;
  started: boolean;
  error: string;

  constructor(opts: {
    role: NetworkSessionRole;
    config: NetworkSessionConfig;
    autoStart?: boolean;
    started?: boolean;
    error?: string;
  }) {
    this.role = opts.role;
    this.config = opts.config;
    this.autoStart = opts.autoStart ?? false;
    this.started = opts.started ?? false;
    this.error = opts.error ?? '';
  }
}

export class HighScoresRequest {
  gameModeId: GameMode;
  questLevel: QuestLevel | null;
  highlightRank: number | null;

  constructor(opts: {
    gameModeId: GameMode;
    questLevel?: QuestLevel | null;
    highlightRank?: number | null;
  }) {
    this.gameModeId = opts.gameModeId;
    this.questLevel = opts.questLevel ?? null;
    this.highlightRank = opts.highlightRank ?? null;
  }
}

export class GameState {
  baseDir: string;
  assetsDir: string;
  rng: Crand;
  config: CrimsonConfig;
  status: GameStatus;
  console: ConsoleState;
  demoEnabled: boolean;
  preserveBugs: boolean;
  resources: RuntimeResources | null;
  audio: AudioState | null;
  sessionStart: number;
  rtxMode: RtxRenderMode;
  skipIntro: boolean;
  gammaRamp: number;
  sndFreqAdjustmentEnabled: boolean;
  menuGround: GroundRenderer | null;
  menuGroundCamera: Vec2 | null;
  menuSignLocked: boolean;
  statsMenuEasterEggRoll: number;
  pauseBackground: PauseBackground | null;
  pendingNetworkSession: PendingNetworkSession | null;
  networkRuntime: RollbackRuntime | LockstepRuntime | null;
  networkInLobby: boolean;
  networkWaitingForPlayers: boolean;
  networkExpectedPlayers: number;
  networkConnectedPlayers: number;
  networkDesyncCount: number;
  networkResyncFailureCount: number;
  networkLastError: string;
  pendingQuestLevel: QuestLevel | null;
  pendingHighScores: HighScoresRequest | null;
  questOutcome: QuestRunOutcome | null;
  questFailRetryCount: number;
  terrainRegenerateRequested: boolean;
  survivalElapsedMs: number;
  demoTrialElapsedMs: number;
  quitRequested: boolean;
  screenFadeAlpha: number;
  screenFadeRamp: boolean;
  runtimeUpdatesPerFrame: number;
  inputStallCount: number;
  ticksAdvancedPerFrame: number;
  simMs: number;
  presentationPlanMs: number;
  presentationApplyMs: number;

  constructor(opts: {
    baseDir: string;
    assetsDir: string;
    rng: Crand;
    config: CrimsonConfig;
    status: GameStatus;
    console: ConsoleState;
    demoEnabled: boolean;
    preserveBugs: boolean;
    resources: RuntimeResources | null;
    audio: AudioState | null;
    sessionStart: number;
    rtxMode?: RtxRenderMode;
    skipIntro?: boolean;
    gammaRamp?: number;
    sndFreqAdjustmentEnabled?: boolean;
    menuGround?: GroundRenderer | null;
    menuGroundCamera?: Vec2 | null;
    menuSignLocked?: boolean;
    statsMenuEasterEggRoll?: number;
    pauseBackground?: PauseBackground | null;
    pendingNetworkSession?: PendingNetworkSession | null;
    networkRuntime?: RollbackRuntime | LockstepRuntime | null;
    networkInLobby?: boolean;
    networkWaitingForPlayers?: boolean;
    networkExpectedPlayers?: number;
    networkConnectedPlayers?: number;
    networkDesyncCount?: number;
    networkResyncFailureCount?: number;
    networkLastError?: string;
    pendingQuestLevel?: QuestLevel | null;
    pendingHighScores?: HighScoresRequest | null;
    questOutcome?: QuestRunOutcome | null;
    questFailRetryCount?: number;
    terrainRegenerateRequested?: boolean;
    survivalElapsedMs?: number;
    demoTrialElapsedMs?: number;
    quitRequested?: boolean;
    screenFadeAlpha?: number;
    screenFadeRamp?: boolean;
    runtimeUpdatesPerFrame?: number;
    inputStallCount?: number;
    ticksAdvancedPerFrame?: number;
    simMs?: number;
    presentationPlanMs?: number;
    presentationApplyMs?: number;
  }) {
    this.baseDir = opts.baseDir;
    this.assetsDir = opts.assetsDir;
    this.rng = opts.rng;
    this.config = opts.config;
    this.status = opts.status;
    this.console = opts.console;
    this.demoEnabled = opts.demoEnabled;
    this.preserveBugs = opts.preserveBugs;
    this.resources = opts.resources;
    this.audio = opts.audio;
    this.sessionStart = opts.sessionStart;
    this.rtxMode = opts.rtxMode ?? defaultRtxRenderMode();
    this.skipIntro = opts.skipIntro ?? false;
    this.gammaRamp = opts.gammaRamp ?? 1.0;
    this.sndFreqAdjustmentEnabled = opts.sndFreqAdjustmentEnabled ?? true;
    this.menuGround = opts.menuGround ?? null;
    this.menuGroundCamera = opts.menuGroundCamera ?? null;
    this.menuSignLocked = opts.menuSignLocked ?? false;
    this.statsMenuEasterEggRoll = opts.statsMenuEasterEggRoll ?? -1;
    this.pauseBackground = opts.pauseBackground ?? null;
    this.pendingNetworkSession = opts.pendingNetworkSession ?? null;
    this.networkRuntime = opts.networkRuntime ?? null;
    this.networkInLobby = opts.networkInLobby ?? false;
    this.networkWaitingForPlayers = opts.networkWaitingForPlayers ?? false;
    this.networkExpectedPlayers = opts.networkExpectedPlayers ?? 1;
    this.networkConnectedPlayers = opts.networkConnectedPlayers ?? 1;
    this.networkDesyncCount = opts.networkDesyncCount ?? 0;
    this.networkResyncFailureCount = opts.networkResyncFailureCount ?? 0;
    this.networkLastError = opts.networkLastError ?? '';
    this.pendingQuestLevel = opts.pendingQuestLevel ?? null;
    this.pendingHighScores = opts.pendingHighScores ?? null;
    this.questOutcome = opts.questOutcome ?? null;
    this.questFailRetryCount = opts.questFailRetryCount ?? 0;
    this.terrainRegenerateRequested = opts.terrainRegenerateRequested ?? false;
    this.survivalElapsedMs = opts.survivalElapsedMs ?? 0.0;
    this.demoTrialElapsedMs = opts.demoTrialElapsedMs ?? 0;
    this.quitRequested = opts.quitRequested ?? false;
    this.screenFadeAlpha = opts.screenFadeAlpha ?? 0.0;
    this.screenFadeRamp = opts.screenFadeRamp ?? false;
    this.runtimeUpdatesPerFrame = opts.runtimeUpdatesPerFrame ?? 0;
    this.inputStallCount = opts.inputStallCount ?? 0;
    this.ticksAdvancedPerFrame = opts.ticksAdvancedPerFrame ?? 0;
    this.simMs = opts.simMs ?? 0.0;
    this.presentationPlanMs = opts.presentationPlanMs ?? 0.0;
    this.presentationApplyMs = opts.presentationApplyMs ?? 0.0;
  }
}

export interface Screen {
  open(): void;
  close(): void;
  update(dt: number): void;
  draw(): void;
  takeAction(): string | null;
}

export interface GameplayScreen extends Screen, PauseBackground {
  closeRequested: boolean;
  defaultGameModeId: GameMode;
  bindStatus(status: GameStatus | null): void;
  bindScreenFade(fade: GameState | null): void;
  bindAudio(audio: AudioState | null, audioRng: Crand): void;
  setLanRuntime(opts: { enabled: boolean; role: string; expectedPlayers: number; connectedPlayers: number; waitingForPlayers: boolean }): void;
  bindLanRuntime(runtime: RollbackRuntime | LockstepRuntime | null): void;
  setLanMatchStart(opts: { seed: number; startTick?: number; status?: GameStatusData | null }): void;
  stealGroundForMenu(): GroundRenderer | null;
  menuGroundCamera(): Vec2;
  consoleElapsedMs(): number;
  prepareDemoTrialOverlayFrame(): void;
  regenerateTerrainForConsole(): void;
  setRtxMode(mode: RtxRenderMode): void;
  setRuntimeUpdatesPerFrame(value: number): void;
  frameTelemetry(): [number, number, number, number, number, number];
}
