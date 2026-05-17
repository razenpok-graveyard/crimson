// Port of crimson/modes/quest_mode.py

import { TextureId } from '@grim/assets.ts';
import type { AudioState } from '@grim/audio.ts';
import { playMusic } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { GrimMonoFont } from '@grim/fonts/grim-mono.ts';
import { loadGrimMonoFont } from '@grim/fonts/grim-mono.ts';
import { Vec2 } from '@grim/geom.ts';
import type { Crand } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { ViewContext } from '@grim/view.ts';
import { debugEnabled } from '@crimson/debug.ts';
import { GameMode } from '@crimson/game-modes.ts';
import type { ModeStateSnapshotV2 } from '@crimson/net/rollback-resync-v5.ts';
import { QuestsRuntimeSnapshotV2, QuestsStateSnapshotV2 } from '@crimson/net/rollback-resync-v5.ts';
import { perkSelectionPreparedChoices } from '@crimson/perks/selection.ts';
import type { GameStatus } from '@crimson/persistence/save-status.ts';
import { GameStatusData } from '@crimson/persistence/save-status.ts';
import { questByLevel } from '@crimson/quests/index.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import { buildQuestSpawnTable } from '@crimson/quests/runtime.ts';
import { trackedQuestGamesCounterIndex } from '@crimson/quests/status.ts';
import type { QuestDefinition, SpawnEntry } from '@crimson/quests/types.ts';
import { QuestContext } from '@crimson/quests/types.ts';
import type { Replay } from '@crimson/replay/index.ts';
import { ReplayHeader, ReplayRecorder } from '@crimson/replay/index.ts';
import { DEFAULT_CHECKPOINT_SAMPLE_RATE } from '@crimson/replay/checkpoints.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { advanceExplicitTerrain, advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import type { TickResult } from '@crimson/sim/hooks.ts';
import type { PostApplyReaction } from '@crimson/sim/presentation-reactions.ts';
import { applyPostApplyReaction, buildPostApplyReaction } from '@crimson/sim/presentation-reactions.ts';
import { buildQuestSession } from '@crimson/sim/session-builders.ts';
import type { DeterministicSession, DeterministicSessionTick } from '@crimson/sim/sessions.ts';
import { QuestSpawnState } from '@crimson/sim/sessions.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { HudRenderContext, drawHudOverlay, hudFlagsForGameMode } from '@crimson/ui/hud.ts';
import { drawQuestCompleteBannerOverlay, drawQuestTitleTimerOverlay } from '@crimson/ui/overlays/quest-run.ts';
import { mostUsedWeaponIdForPlayer, weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import type { WeaponId } from '@crimson/weapons.ts';
import { WEAPON_BY_ID } from '@crimson/weapons.ts';
import type { LanSession, LanStepAction } from '@crimson/modes/base-gameplay-mode.ts';
import { BaseGameplayMode } from '@crimson/modes/base-gameplay-mode.ts';
import { shotsFromState } from '@crimson/modes/components/highscore-record-builder.ts';
import { PerkMenuController } from '@crimson/modes/components/perk-menu-controller.ts';
import { PerkPromptState } from '@crimson/modes/components/perk-prompt-controller.ts';
import * as wgl from '@wgl';

export const WORLD_SIZE = 1024.0;
export const UI_TEXT_SCALE = 1.0;
export const UI_TEXT_COLOR = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 255 / 255);
export const UI_HINT_COLOR = wgl.makeColor(140 / 255, 140 / 255, 140 / 255, 255 / 255);
export const UI_SPONSOR_COLOR = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.5) / 255);
const _DEBUG_WEAPON_IDS = Array.from(Array.from(WEAPON_BY_ID.keys()).sort((left, right) => pythonCompareKeys(left, right)));

function pythonCompareKeys(left: any, right: any): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const item = pythonCompareKeys(left[index], right[index]);
      if (item !== 0) {
        return item;
      }
    }
    return left.length - right.length;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export class QuestRunOutcome {
  readonly kind: string; // "completed" | "failed"
  readonly level: QuestLevel;
  readonly baseTimeMs: number;
  readonly playerHealth: number;
  readonly player2Health: number | null;
  readonly pendingPerkCount: number;
  readonly experience: number;
  readonly killCount: number;
  readonly weaponId: WeaponId;
  readonly shotsFired: number;
  readonly shotsHit: number;
  readonly mostUsedWeaponId: WeaponId;
  readonly playerHealthValues: readonly number[];

  constructor(opts: {
    kind: string;
    level: QuestLevel;
    baseTimeMs: number;
    playerHealth: number;
    player2Health: number | null;
    pendingPerkCount: number;
    experience: number;
    killCount: number;
    weaponId: WeaponId;
    shotsFired: number;
    shotsHit: number;
    mostUsedWeaponId: WeaponId;
    playerHealthValues?: readonly number[];
  }) {
    this.kind = opts.kind;
    this.level = opts.level;
    this.baseTimeMs = opts.baseTimeMs;
    this.playerHealth = opts.playerHealth;
    this.player2Health = opts.player2Health;
    this.pendingPerkCount = opts.pendingPerkCount;
    this.experience = opts.experience;
    this.killCount = opts.killCount;
    this.weaponId = opts.weaponId;
    this.shotsFired = opts.shotsFired;
    this.shotsHit = opts.shotsHit;
    this.mostUsedWeaponId = opts.mostUsedWeaponId;
    this.playerHealthValues = Array.from(opts.playerHealthValues ?? []);
  }
}

export class QuestMode extends BaseGameplayMode {
  protected _questDef: QuestDefinition | null;
  protected _questLevel: QuestLevel | null;
  protected _questTotalSpawnCount: number;
  protected _outcome: QuestRunOutcome | null;
  protected _grimMono: GrimMonoFont | null;
  protected _perkPrompt: PerkPromptState;
  protected _perkMenu: PerkMenuController;
  protected _questSpawnState: QuestSpawnState;

  constructor(ctx: ViewContext, opts: { demoModeActive?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand });
  constructor(opts: { demoModeActive?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
  constructor(ctxOrOpts: ViewContext | { demoModeActive?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean }, maybeOpts?: { demoModeActive?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand }) {
    const ctx = maybeOpts === undefined ? { assetsDir: (ctxOrOpts as { assetsUrl?: string }).assetsUrl ?? '', preserveBugs: (ctxOrOpts as { preserveBugs?: boolean }).preserveBugs ?? false } as ViewContext : ctxOrOpts as ViewContext;
    const opts = maybeOpts ?? (ctxOrOpts as { demoModeActive?: boolean; config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
    const demoModeActive = opts.demoModeActive ?? false;
    const config = opts.config;
    const console = opts.console ?? null;
    const audio = opts.audio ?? null;
    const audioRng = opts.audioRng;
    super({ assetsUrl: ctx.assetsDir, preserveBugs: ctx.preserveBugs, worldSize: WORLD_SIZE, defaultGameModeId: GameMode.QUESTS, demoModeActive: demoModeActive, questFailRetryCount: 0, hardcore: false, config: config, console: console, audio: audio, audioRng: audioRng });
    this._questDef = null;
    this._questLevel = this.config.gameplay.questLevel || new QuestLevel({ major: 1, minor: 1 });
    this._questTotalSpawnCount = 0;
    this._outcome = null;
    this._grimMono = null;
    this._perkPrompt = new PerkPromptState();
    this._perkMenu = new PerkMenuController({ onClose: this._resetPerkPrompt.bind(this) });
    this._questSpawnState = new QuestSpawnState();
    this._simSession = null;
    this._replayRecorder = null;
  }

  open(): void {
    super.open();
    this._questDef = null;
    this._questLevel = this.config.gameplay.questLevel || new QuestLevel({ major: 1, minor: 1 });
    this._questTotalSpawnCount = 0;
    this._outcome = null;
    this._grimMono = loadGrimMonoFont(this._assetsRoot);

    this._perkPrompt.reset();
    this._perkMenu.reset();
    this._resetGameplayFrameClock();
    this._resetLanCaptureClock();
    this._replayRecorder = null;
    ((target: unknown) => {
      if (target !== null && typeof target === 'object' && typeof (target as { clear?: unknown }).clear === 'function') {
        (target as { clear: () => void }).clear();
      } else if (target !== null && typeof target === 'object' && 'length' in target) {
        (target as { length: number }).length = 0;
      }
    })(this._replayCheckpoints);
    this._replayCheckpointsLastTick = null;
    this._simSession = null;
  }

  close(): void {
    this._grimMono = null;
    this._simSession = null;
    super.close();
  }

  protected _newSimSession(opts: { spawnEntries: readonly SpawnEntry[] }): DeterministicSession {
    const spawnEntries = opts.spawnEntries;
    const questDef = this._questDef;
    const [session, questSpawnState] = buildQuestSession({ world: this.simWorld.worldState, worldSize: this.worldSize, damageScaleByType: this.simWorld.damageScaleByType, detailPreset: 5, violenceDisabled: 0, gameTuneStarted: Boolean(this.simWorld.gameTuneStarted), demoModeActive: Boolean(this.demoModeActive), applyWorldDtSteps: false, finalizePostRenderLifecycle: true, spawnEntries: Array.from(spawnEntries), questLevel: questDef === null ? null : questDef.level, startWeaponId: questDef === null ? null : questDef.startWeaponId });
    this._questSpawnState = questSpawnState;
    return session;
  }

  protected _tryOpenPerkMenu(): void {
    this._openPerkMenuUi({
      menu: this._perkMenu,
      players: this.simWorld.players,
      gameMode: GameMode.QUESTS,
      playerCount: Math.max(1, this.simWorld.players.length),
    });
  }

  protected _resetPerkPrompt(): void {
    this._perkPrompt.resetIfPending({ pendingCount: int(this.state.perkSelection.pendingCount) });
  }

  protected _updatePerkUi(opts: { dtUiMs: number }): void {
    const dtUiMs = opts.dtUiMs;
    const perkCtx = this._perkMenuUiContext();
    const pendingCount = int(this.state.perkSelection.pendingCount);
    const choices = perkSelectionPreparedChoices(this.simWorld.players, this.state.perkSelection);
    this._perkPrompt.beginFrame();
    if (this._perkMenu.open) {
      const choiceIndex = this._perkMenu.handleInput(perkCtx, choices, { dtUiMs: dtUiMs });
      if (choiceIndex !== null) {
        this.recordPerkPickCommand(int(choiceIndex), { playerIndex: 0 });
      }
    }
    if (this._perkPrompt.pollOpenRequest({ ctx: perkCtx, config: this.config, pendingCount: pendingCount, playerCount: Math.max(1, this.simWorld.players.length), anyAlive: this._anyPlayerAlive(), paused: this._paused, menuActive: this._perkMenu.active, promptScale: UI_TEXT_SCALE })) {
      this._tryOpenPerkMenu();
    }
    this._perkPrompt.tickTimer({
      pendingCount: pendingCount,
      anyAlive: this._anyPlayerAlive(),
      paused: this._paused,
      menuActive: this._perkMenu.active,
      dtUiMs: dtUiMs,
    });
    if (!this._paused) {
      this._perkPrompt.tickPulse(dtUiMs);
    }
    this._perkMenu.tickTimeline(dtUiMs);
  }

  protected _replayCheckpointElapsedMs(): number {
    return this._questSpawnState.spawnTimelineMs;
  }

  protected _replayClaimedStatsComplete(): boolean {
    return this._outcome !== null;
  }

  protected _replayClaimedStatsElapsedMs(): number {
    return int(this._questSpawnState.spawnTimelineMs);
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: Replay }): string {
    const stamp = opts.stamp;
    const replay = opts.replay;
    const replayLevel = replay.header.questLevel === null ? '' : replay.header.questLevel.text;
    const level = this._questLevel !== null ? this._questLevel.text : (replayLevel || 'quest');
    const kind = this._outcome !== null ? String(this._outcome.kind) : 'quest';
    const baseTimeMs = int(this._questSpawnState.spawnTimelineMs);
    return `quest_${level}_${stamp}_${kind}_t${baseTimeMs}`;
  }

  protected _replaySkipSaveWhenEmpty(opts: { recorder: ReplayRecorder }): boolean {
    const recorder = opts.recorder;
    // Avoid emitting empty replays/checkpoint sidecars (usually indicates a
    // test harness calling failure/complete helpers without ticking).
    return int(recorder.tickIndex) <= 0;
  }

  protected _lanModeName(): "quests" {
    return 'quests';
  }

  protected _lanMatchSession(): DeterministicSession | null {
    return this._simSession;
  }

  protected _lanOnPaused(dt: number): void {
    this._tickDeathTimers(dt, { rate: 1.0 });
    if (this._deathTransitionReady()) {
      this._closeFailedRun();
    }
  }

  protected _lanPrepareFrame(role: string, dtUiMs: number, session: LanSession, dtTick: number): boolean {
    const _: [string, number, number] = [role, dtUiMs, dtTick];
    session.detailPreset = int(this._deterministicDetailPreset());
    session.violenceDisabled = int(this._deterministicViolenceDisabled());
    return true;
  }

  protected _lanOnTickApplied(tick: DeterministicSessionTick, frameTickIndex: number | null, dtTick: number): LanStepAction {
    const session = this._simSession;
    void tick;
    const spawnState = this._questSpawnState;
    void dtTick;
    if (frameTickIndex !== null) {
      this._storeNetRuntimeSnapshot({
        snapshot: new QuestsStateSnapshotV2({ tickIndex: int(frameTickIndex), replayState: this._netReplaySnapshotState(), runtimeState: new QuestsRuntimeSnapshotV2({ elapsedMs: session !== null ? session.elapsedMs : 0.0, spawnEntries: Array.from(spawnState.spawnEntries), spawnTimelineMs: spawnState.spawnTimelineMs, noCreaturesTimerMs: spawnState.noCreaturesTimerMs, completionTransitionMs: spawnState.completionTransitionMs, perkPendingCount: int(this.state.perkSelection.pendingCount) }) }),
      });
    }

    if (spawnState.completed) {
      let player2Health: any;
      if (this._outcome === null) {
        if (!(this._questLevel !== null)) throw new Error('quest outcome requires active quest level');
        const [fired, hit] = shotsFromState(this.state, { playerIndex: int(this.player.index) });
        const mostUsedWeaponId = mostUsedWeaponIdForPlayer(this.state, { playerIndex: int(this.player.index), fallbackWeaponId: this.player.weapon.weaponId });
        const playerHealthValues = Array.from(this.simWorld.players).map((player) => player.health);
        player2Health = null;
        if (playerHealthValues.length >= 2) {
          player2Health = playerHealthValues[1];
        }
        this._outcome = new QuestRunOutcome({ kind: 'completed', level: this._questLevel, baseTimeMs: int(spawnState.spawnTimelineMs), playerHealth: playerHealthValues.length > 0 ? playerHealthValues[0] : this.player.health, player2Health: player2Health, playerHealthValues: playerHealthValues, pendingPerkCount: int(this.state.perkSelection.pendingCount), experience: int(this.player.experience), killCount: int(this.creatures.killCount), weaponId: this.player.weapon.weaponId, shotsFired: fired, shotsHit: hit, mostUsedWeaponId: mostUsedWeaponId });
      }
      this._saveReplay();
      this.closeRequested = true;
      return 'stop_after_finalize';
    }

    if (this._deathTransitionReady()) {
      this._closeFailedRun();
      return 'stop_after_finalize';
    }
    return 'continue';
  }

  protected _buildTickPostApplyReaction(opts: { tickResult: TickResult }): PostApplyReaction {
    const tickResult = opts.tickResult;
    return buildPostApplyReaction({ tickResult: tickResult, questState: this._questSpawnState });
  }

  protected _applyTickPostApplyReaction(reaction: PostApplyReaction, opts: { dtSeconds: number }): void {
    const dtSeconds = opts.dtSeconds;
    const _ = dtSeconds;
    applyPostApplyReaction({
      reaction: reaction,
      playSfx: this.audioBridge.router.playSfx.bind(this.audioBridge.router),
      playCompletionMusic: this._playQuestCompletionMusic.bind(this),
    });
  }

  protected _playQuestCompletionMusic(): void {
    if (this.audio === null) {
      return;
    }
    playMusic(this.audio, 'crimsonquest');
    const playback = this.audio.music.playbacks.get('crimsonquest') ?? null;
    if (playback === null) {
      return;
    }
    playback.volume = 0.0;
    try {
      wgl.setMusicVolume(playback.music, 0.0);
    } catch (exc) {
      playback.volume = 0.0;
    }
  }

  protected _applyResyncSnapshot(snapshot: ModeStateSnapshotV2): void {
    if (!(snapshot instanceof QuestsStateSnapshotV2)) {
      return;
    }
    const rs = snapshot.runtimeState;
    this._questSpawnState.spawnEntries = Array.from(rs.spawnEntries);
    this._questSpawnState.spawnTimelineMs = rs.spawnTimelineMs;
    this._questSpawnState.noCreaturesTimerMs = rs.noCreaturesTimerMs;
    this._questSpawnState.completionTransitionMs = rs.completionTransitionMs;
    this._questSpawnState.completed = false;
    this._questSpawnState.playHitSfx = false;
    this._questSpawnState.playCompletionMusic = false;
    const session = this._simSession;
    if (session !== null) {
      session.elapsedMs = rs.elapsedMs;
    }
  }

  consumeOutcome(): QuestRunOutcome | null {
    const outcome = this._outcome;
    this._outcome = null;
    return outcome;
  }

  startRun(level: QuestLevel, opts: { status: GameStatus | null }): void {
    const status = opts.status;
    const quest = questByLevel(level);
    if (quest === null) {
      this._questDef = null;
      this._questLevel = level;
      this._questTotalSpawnCount = 0;
      this._simSession = null;
      return;
    }
    this._outcome = null;
    this._replayRecorder = null;
    ((target: unknown) => {
      if (target !== null && typeof target === 'object' && typeof (target as { clear?: unknown }).clear === 'function') {
        (target as { clear: () => void }).clear();
      } else if (target !== null && typeof target === 'object' && 'length' in target) {
        (target as { length: number }).length = 0;
      }
    })(this._replayCheckpoints);
    this._replayCheckpointsLastTick = null;

    const hardcoreFlag = this.config.gameplay.hardcore;

    this.hardcore = hardcoreFlag;
    // Native quest start does not reseed RNG per level; carry the current
    // session RNG state into the next run.
    const seed = (int(this.state.rng.state) >>> 0);
    this._runResetSeed = int(seed);

    const playerCount = this.config.gameplay.playerCount;
    this._syncWorldRuntimeConfig();
    this.worldRuntime.reset({ seed: seed, playerCount: Math.max(1, Math.min(4, playerCount)) });
    this._bindWorld();
    this._localInput.reset({ players: this.simWorld.players });
    this.bindStatus(status);
    const boundStatus = this.state.status;
    const genericUnlockIndex = boundStatus !== null ? int(boundStatus.questUnlockIndex) : 0;
    advanceUnlockTerrain(
      this.state.rng,
      { unlockIndex: int(genericUnlockIndex), width: int(this.worldSize), height: int(this.worldSize) },
    );
    // Native `quest_start_selected()` burns one `crt_rand()` for
    // `highscore_record_random_tag` before quest terrain and spawn setup.
    this.state.rng.rand({ caller: RngCallerStatic.QUEST_START_SELECTED_HIGHSCORE_RANDOM_TAG });
    const questTerrain = advanceExplicitTerrain(this.state.rng, { terrainSlots: quest.terrainSlots, width: int(this.worldSize), height: int(this.worldSize) });
    this.applyTerrainSetup({
      terrainSlots: questTerrain.terrainSlots,
      seed: int(questTerrain.terrainSeed),
    });

    const ctx = new QuestContext({ width: int(this.worldSize), height: int(this.worldSize), playerCount: this.simWorld.players.length });
    const entries = buildQuestSpawnTable(quest, ctx, { rng: this.state.rng, hardcore: hardcoreFlag, fullVersion: !this.demoModeActive });
    this.simWorld.state.rng.srand(int(this.state.rng.state));
    const totalSpawnCount = entries.reduce((total, entry) => total + int(entry.count), 0);
    this._questDef = quest;
    this._questLevel = quest.level;
    this._questTotalSpawnCount = int(totalSpawnCount);
    this._resetGameplayFrameClock();
    this._simSession = this._newSimSession({ spawnEntries: Array.from(entries) });

    const replayStatus = status === null ? new GameStatusData() : status.asData();
    const recordReplay = !Boolean(this._lanEnabled) || String(this._lanRole) === 'host';
    if (recordReplay) {
      this._replayRecorder = new ReplayRecorder(new ReplayHeader({ gameModeId: GameMode.QUESTS, seed: int(this._runResetSeed), questLevel: quest.level, tickRate: int(this._gameplayTickRate()), questFailRetryCount: int(this.questFailRetryCount), hardcore: Boolean(this.hardcore), preserveBugs: Boolean(this.state.preserveBugs), detailPreset: this.config.display.detailPreset, violenceDisabled: this.config.display.violenceDisabled, worldSize: this.worldSize, playerCount: this.simWorld.players.length, status: replayStatus }));
      this._replayCheckpointsSampleRate = int(DEFAULT_CHECKPOINT_SAMPLE_RATE);
    } else {
      this._replayRecorder = null;
    }
    ((target: unknown) => {
      if (target !== null && typeof target === 'object' && typeof (target as { clear?: unknown }).clear === 'function') {
        (target as { clear: () => void }).clear();
      } else if (target !== null && typeof target === 'object' && 'length' in target) {
        (target as { length: number }).length = 0;
      }
    })(this._replayCheckpoints);
    this._replayCheckpointsLastTick = null;

    if (status !== null) {
      const idx = trackedQuestGamesCounterIndex(quest.level);
      if (idx !== null) {
        status.incrementQuestPlayCount(idx);
      }
    }
  }

  protected _handleInput(): void {
    if (this._perkMenu.open && InputState.wasKeyPressed(27)) {
      this.audioBridge.router.playSfx(SfxId.UI_BUTTONCLICK);
      this._perkMenu.close();
      return;
    }

    if (!Boolean(this._lanEnabled) && InputState.wasKeyPressed(9)) {
      this._paused = !this._paused;
    }

    if (debugEnabled() && !this._perkMenu.open) {
      if (InputState.wasKeyPressed(113)) {
        this.state.debugGodMode = !Boolean(this.state.debugGodMode);
        this.audioBridge.router.playSfx(SfxId.UI_BUTTONCLICK);
      }
      if (InputState.wasKeyPressed(114)) {
        this.state.perkSelection.pendingCount += 1;
        this.state.perkSelection.choicesDirty = true;
        this.audioBridge.router.playSfx(SfxId.UI_LEVELUP);
      }
      if (InputState.wasKeyPressed(219)) {
        this._debugCycleWeapon(-1);
      }
      if (InputState.wasKeyPressed(221)) {
        this._debugCycleWeapon(1);
      }
    }

    if (InputState.wasKeyPressed(27)) {
      this._action = 'open_pause_menu';
      return;
    }
  }

  protected _debugCycleWeapon(delta: number): void {
    const weaponIds = _DEBUG_WEAPON_IDS;
    if (weaponIds.length === 0) {
      return;
    }
    const current = this.player.weapon.weaponId;
    let idx = weaponIds.indexOf(current);
    if (idx < 0) {
      idx = 0;
    }
    const weaponId = weaponIds[((idx + int(delta)) + weaponIds.length) % weaponIds.length];
    weaponAssignPlayer(this.player, weaponId, { state: this.state });
  }

  protected _deathTransitionReady(): boolean {
    let deadPlayers = 0;
    for (const player of this.simWorld.players) {
      if (player.health > 0.0) {
        return false;
      }
      deadPlayers += 1;
      if (player.deathTimer >= 0.0) {
        return false;
      }
    }
    return deadPlayers > 0;
  }

  protected _tickDeathTimers(dt: number, opts: { rate?: number } = {}): void {
    const rate = opts.rate ?? 20.0;
    const delta = dt * rate;
    if (delta <= 0.0) {
      return;
    }
    for (const player of this.simWorld.players) {
      if (player.health > 0.0) {
        continue;
      }
      if (player.deathTimer < 0.0) {
        continue;
      }
      player.deathTimer = player.deathTimer - delta;
    }
  }

  protected _closeFailedRun(): void {
    let player2Health: any;
    if (this._outcome === null) {
      if (!(this._questLevel !== null)) throw new Error('quest outcome requires active quest level');
      const [fired, hit] = shotsFromState(this.state, { playerIndex: int(this.player.index) });
      const mostUsedWeaponId = mostUsedWeaponIdForPlayer(this.state, { playerIndex: int(this.player.index), fallbackWeaponId: this.player.weapon.weaponId });
      const playerHealthValues = Array.from(this.simWorld.players).map((player) => player.health);
      player2Health = null;
      if (playerHealthValues.length >= 2) {
        player2Health = playerHealthValues[1];
      }
      this._outcome = new QuestRunOutcome({ kind: 'failed', level: this._questLevel, baseTimeMs: int(this._questSpawnState.spawnTimelineMs), playerHealth: playerHealthValues.length > 0 ? playerHealthValues[0] : this.player.health, player2Health: player2Health, playerHealthValues: playerHealthValues, pendingPerkCount: int(this.state.perkSelection.pendingCount), experience: int(this.player.experience), killCount: int(this.creatures.killCount), weaponId: this.player.weapon.weaponId, shotsFired: fired, shotsHit: hit, mostUsedWeaponId: mostUsedWeaponId });
    }
    this._saveReplay();
    this.closeRequested = true;
  }

  update(dt: number): void {
    const frame = this._beginModeUpdate(dt);
    if (frame === null) {
      return;
    }
    if (Boolean(this.closeRequested)) {
      return;
    }
    if (Boolean(this._lanEnabled) && this._lanRuntime !== null) {
      this._updateLanMatch({ dt: frame.dt, dtUiMs: frame.dtUiMs });
      return;
    }

    this._updatePerkUi({ dtUiMs: frame.dtUiMs });

    const simDt = (this._paused || this._perkMenu.active) ? 0.0 : frame.dt;
    const session = this._simSession;
    if (this._lanWaitGateActive()) {
      this._resetGameplayFrameClock();
      return;
    }
    if (simDt <= 0.0) {
      this._resetGameplayFrameClock();
      // Match legacy transition behavior: keep countdown moving, but at
      // real-time pace while perk-menu transition is holding world ticks.
      this._tickDeathTimers(frame.dt, { rate: 1.0 });
      if (this._deathTransitionReady()) {
        this._closeFailedRun();
      }
      return;
    }
    if (session === null) {
      this._tickDeathTimers(simDt);
      if (this._deathTransitionReady()) {
        this._closeFailedRun();
      }
      return;
    }

    session.detailPreset = int(this._deterministicDetailPreset());
    session.violenceDisabled = int(this._deterministicViolenceDisabled());

    this._worldRuntime.syncAudioBridgeState();
    if (this.renderResources.ground !== null) {
      this.renderResources.ground.processPending();
    }

    const tickDt = this._gameplayTickDt({ session: session });

    const _onTick = (tick: any, tickIndex: number | null): boolean => {
      const _ = tickIndex;
      const action = this._lanOnTickApplied(tick, null, tickDt);
      return action !== 'continue';
    };

    const _onCheckpoint = (tickIndex: number, tick: any): void => {
      this._recordReplayCheckpointFromTick({
        tickIndex: int(tickIndex),
        tick: tick,
      });
    };

    this._runDeterministicSessionTicks({
      dtFrame: simDt,
      session: session,
      recorder: this._replayRecorder,
      onTick: _onTick,
      onCheckpoint: _onCheckpoint,
    });
  }

  draw(): void {
    const perkMenuActive = this._perkMenu.active;
    let debugOverlayHeight = 0.0;
    this._drawWorld({
      drawAimIndicators: !perkMenuActive,
      entityAlpha: this._worldEntityAlpha(),
    });
    this._drawScreenFade();

    let hudBottom = 0.0;
    if (!perkMenuActive) {
      const total = int(this._questTotalSpawnCount);
      const kills = int(this.creatures.killCount);
      const questProgressRatio = total > 0 ? kills / total : null;
      const hudFlags = hudFlagsForGameMode(this._configGameModeId());
      this._drawTargetHealthBar();
      hudBottom = drawHudOverlay(new HudRenderContext({ resources: this.renderResources.resources, state: this._hudState, font: this._small, showHealth: hudFlags.showHealth, showWeapon: hudFlags.showWeapon, showXp: hudFlags.showXp, showTime: hudFlags.showTime, showQuestHud: hudFlags.showQuestHud, smallIndicators: this._hudSmallIndicators() }), { player: this.player, players: this.simWorld.players, bonusHud: this.state.bonusHud, elapsedMs: this._questSpawnState.spawnTimelineMs, frameDtMs: this._lastDtMs, questProgressRatio: questProgressRatio });
    }

    let x: number;
    let y: any;
    if (debugEnabled() && !perkMenuActive) {
      x = 18.0;
      y = Math.max(18.0, hudBottom + 10.0);
      const god = this.state.debugGodMode ? 'on' : 'off';
      const line = this._uiLineHeight(0.9);
      this._drawUiText(`debug: [/] weapon  F3 perk+1  F2 god=${god}`, new Vec2(x, y), UI_HINT_COLOR, 0.9);
      const overlayEndY = this._drawLanDebugInfo({ x: x, y: y + line, lineH: line });
      debugOverlayHeight = Math.max(0.0, overlayEndY - y);
    }

    this._drawQuestTitle();
    this._drawQuestCompleteBanner();

    this._perkPrompt.draw({
      ctx: this._perkMenuUiContext(),
      pendingCount: int(this.state.perkSelection.pendingCount),
      anyAlive: this._anyPlayerAlive(),
      menuActive: this._perkMenu.active,
      config: this.config,
      uiTextWidth: this._uiTextWidth.bind(this),
      textColor: UI_TEXT_COLOR,
      promptScale: UI_TEXT_SCALE,
    });
    this._perkMenu.draw(this._perkMenuUiContext(), perkSelectionPreparedChoices(this.simWorld.players, this.state.perkSelection));

    if (perkMenuActive) {
      this._drawGameCursor();
    } else if (this._paused) {
      this._drawGameCursor();
      x = 18.0;
      y = Math.max(18.0, hudBottom + 10.0);
      y += debugOverlayHeight;
      this._drawUiText('paused (TAB)', new Vec2(x, y), UI_HINT_COLOR);
    }
    this._drawLanWaitOverlay();
  }

  protected _drawGameCursor(): void {
    const resources = this.renderResources.resources;
    const mousePos = this._uiMouse;
    drawMenuCursor(
      resources.texture(TextureId.PARTICLES),
      resources.texture(TextureId.UI_CURSOR),
      { pos: mousePos, pulseTime: this._cursorPulseTime },
    );
  }

  protected _drawQuestTitle(): void {
    const font = this._grimMono;
    const quest = this._questDef;
    if (font === null || quest === null) {
      return;
    }
    drawQuestTitleTimerOverlay(
      font,
      quest.title,
      quest.level.text,
      { timerMs: this._questSpawnState.spawnTimelineMs },
    );
  }

  protected _drawQuestCompleteBanner(): void {
    const tex = this.renderResources.resources.texture(TextureId.UI_TEXT_LEVEL_COMPLETE);
    drawQuestCompleteBannerOverlay(
      tex,
      { timerMs: this._questSpawnState.completionTransitionMs },
    );
  }
}
