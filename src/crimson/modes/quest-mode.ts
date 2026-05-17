// Port of crimson/modes/quest_mode.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { type AudioState, audioPlayMusic } from '@grim/audio.ts';
import { type CrimsonConfig } from '@grim/config.ts';
import { type ConsoleState } from '@grim/console.ts';
import { type GrimMonoFont, createGrimMonoFont } from '@grim/fonts/grim-mono.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { Crand } from '@grim/rand.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { perkSelectionPreparedChoices } from '@crimson/perks/selection.ts';
import { questByLevel } from '@crimson/quests/index.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import { buildQuestSpawnTable } from '@crimson/quests/runtime.ts';
import { trackedQuestGamesCounterIndex } from '@crimson/quests/status.ts';
import { QuestContext, type QuestDefinition, type SpawnEntry } from '@crimson/quests/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { advanceExplicitTerrain, advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { TickResult } from '@crimson/sim/hooks.ts';
import { type PostApplyReaction, buildPostApplyReaction, applyPostApplyReaction } from '@crimson/sim/presentation-reactions.ts';
import { buildQuestSession } from '@crimson/sim/session-builders.ts';
import { DeterministicSession, type DeterministicSessionTick, QuestSpawnState } from '@crimson/sim/sessions.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { drawHudOverlay, HudRenderContext, hudFlagsForGameMode } from '@crimson/ui/hud.ts';
import { drawQuestTitleTimerOverlay, drawQuestCompleteBannerOverlay } from '@crimson/ui/overlays/quest-run.ts';
import { weaponAssignPlayer, mostUsedWeaponIdForPlayer } from '@crimson/weapon-runtime/index.ts';
import { WeaponId, WEAPON_BY_ID } from '@crimson/weapons.ts';
import { BaseGameplayMode, type GameStatus, type LanSession, type LanStepAction } from './base-gameplay-mode.ts';
import { shotsFromState } from './components/highscore-record-builder.ts';
import { PerkMenuController } from './components/perk-menu-controller.ts';
import { PerkPromptState } from './components/perk-prompt-controller.ts';

const WORLD_SIZE = 1024.0;

const UI_TEXT_SCALE = 1.0;
const UI_TEXT_COLOR = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 1.0);
const UI_HINT_COLOR = wgl.makeColor(140 / 255, 140 / 255, 140 / 255, 1.0);
const UI_SPONSOR_COLOR = wgl.makeColor(1.0, 1.0, 1.0, int(255 * 0.5) / 255);

const KEY_ESCAPE = 27;
const KEY_TAB = 9;
const KEY_F2 = 113;
const KEY_F3 = 114;
const KEY_LEFT_BRACKET = 219;
const KEY_RIGHT_BRACKET = 221;

const _DEBUG_WEAPON_IDS: WeaponId[] = (() => {
  const ids: WeaponId[] = [];
  for (const id of WEAPON_BY_ID.keys()) {
    ids.push(id);
  }
  return ids.sort((a, b) => a - b);
})();

export class QuestRunOutcome {
  readonly kind: 'completed' | 'failed';
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
    kind: 'completed' | 'failed';
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
    this.playerHealthValues = opts.playerHealthValues ?? [];
  }
}

export class QuestMode extends BaseGameplayMode {
  private _questDef: QuestDefinition | null = null;
  private _questLevel: QuestLevel | null = null;
  private _questTotalSpawnCount = 0;
  private _outcome: QuestRunOutcome | null = null;
  private _grimMono: GrimMonoFont | null = null;
  private _perkPrompt = new PerkPromptState();
  private _perkMenu = new PerkMenuController({ onClose: () => this._resetPerkPrompt() });
  private _questSpawnState = new QuestSpawnState();
  protected _simSession: DeterministicSession | null = null;

  constructor(opts: {
    worldSize?: number;
    assetsUrl?: string;
    baseDir?: string;
    preserveBugs?: boolean;
    demoModeActive?: boolean;
    config: CrimsonConfig;
    console?: ConsoleState | null;
    audio?: AudioState | null;
    audioRng: Crand;
  }) {
    super({
      worldSize: opts.worldSize ?? WORLD_SIZE,
      defaultGameModeId: GameMode.QUESTS,
      demoModeActive: opts.demoModeActive ?? false,
      questFailRetryCount: 0,
      hardcore: false,
      assetsUrl: opts.assetsUrl,
      baseDir: opts.baseDir,
      preserveBugs: opts.preserveBugs ?? false,
      config: opts.config,
      console: opts.console ?? null,
      audio: opts.audio ?? null,
      audioRng: opts.audioRng,
    });
    this._questLevel = opts.config.gameplay.questLevel ?? new QuestLevel({ major: 1, minor: 1 });
  }

  open(): void {
    super.open();
    this._questDef = null;
    const cfgLevel = this.config.gameplay.questLevel;
    this._questLevel = cfgLevel ?? new QuestLevel({ major: 1, minor: 1 });
    this._questTotalSpawnCount = 0;
    this._outcome = null;
    const courierTex = getTexture(this.renderResources.resources, TextureId.DEFAULT_FONT_COURIER);
    this._grimMono = courierTex != null ? createGrimMonoFont(courierTex) : null;

    this._perkPrompt.reset();
    this._perkMenu.reset();
    this._resetGameplayFrameClock();
    this._resetLanCaptureClock();
    this._replayRecorder = null;
    this._replayCheckpoints.length = 0;
    this._replayCheckpointsLastTick = null;
    this._simSession = null;
  }

  close(): void {
    this._grimMono = null;
    this._simSession = null;
    super.close();
  }

  private _newSimSession(opts: { spawnEntries: readonly SpawnEntry[] }): DeterministicSession {
    const spawnEntries = opts.spawnEntries;
    const questDef = this._questDef;
    const [session, questSpawnState] = buildQuestSession({
      world: this.simWorld.worldState,
      worldSize: this.worldSize,
      damageScaleByType: this.simWorld.damageScaleByType,
      detailPreset: 5,
      violenceDisabled: 0,
      gameTuneStarted: this.simWorld.gameTuneStarted,
      demoModeActive: this.demoModeActive,
      applyWorldDtSteps: false,
      finalizePostRenderLifecycle: true,
      spawnEntries: [...spawnEntries],
      questLevel: questDef !== null ? questDef.level : null,
      startWeaponId: questDef !== null ? questDef.startWeaponId : null,
    });
    this._questSpawnState = questSpawnState;
    return session;
  }

  private _tryOpenPerkMenu(): void {
    this._openPerkMenuUi({
      menu: this._perkMenu,
      players: this.simWorld.players,
      gameMode: GameMode.QUESTS,
      playerCount: Math.max(1, this.simWorld.players.length),
    });
  }

  private _resetPerkPrompt(): void {
    this._perkPrompt.resetIfPending({ pendingCount: this.state.perkSelection.pendingCount });
  }

  private _updatePerkUi(opts: { dtUiMs: number }): void {
    const dtUiMs = opts.dtUiMs;
    const pendingCount = int(this.state.perkSelection.pendingCount);
    const choices = perkSelectionPreparedChoices(
      this.simWorld.players,
      this.state.perkSelection,
    );
    this._perkPrompt.beginFrame();

    if (this._perkMenu.open) {
      const choiceIndex = this._handlePerkMenuInput(choices, dtUiMs);
      if (choiceIndex !== null) {
        this.recordPerkPickCommand(choiceIndex, { playerIndex: 0 });
      }
    }

    if (this._pollPerkOpenRequest({
      pendingCount,
      playerCount: Math.max(1, this.simWorld.players.length),
      anyAlive: this._anyPlayerAlive(),
      paused: this._paused,
      menuActive: this._perkMenu.active,
    })) {
      this._tryOpenPerkMenu();
    }

    this._tickPerkPromptTimer({
      pendingCount,
      anyAlive: this._anyPlayerAlive(),
      paused: this._paused,
      menuActive: this._perkMenu.active,
      dtUiMs,
    });
    if (!this._paused) {
      this._tickPerkPromptPulse(dtUiMs);
    }
    this._tickPerkMenuTimeline(dtUiMs);
  }

  protected _pollPerkOpenRequest(opts: {
    pendingCount: number;
    playerCount: number;
    anyAlive: boolean;
    paused: boolean;
    menuActive: boolean;
  }): boolean {
    return this._perkPrompt.pollOpenRequest({
      ctx: this._perkMenuUiContext(),
      config: this.config,
      pendingCount: opts.pendingCount,
      playerCount: opts.playerCount,
      anyAlive: opts.anyAlive,
      paused: opts.paused,
      menuActive: opts.menuActive,
    });
  }

  protected _tickPerkPromptTimer(opts: {
    pendingCount: number;
    anyAlive: boolean;
    paused: boolean;
    menuActive: boolean;
    dtUiMs: number;
  }): void {
    this._perkPrompt.tickTimer(opts);
  }

  protected _tickPerkPromptPulse(dtUiMs: number): void {
    this._perkPrompt.tickPulse(dtUiMs);
  }

  protected override _handlePerkMenuInput(choices: readonly PerkId[], dtUiMs: number): number | null {
    return this._perkMenu.handleInput(
      this._perkMenuUiContext(),
      choices,
      { dtUiMs },
    );
  }

  protected override _tickPerkMenuTimeline(dtUiMs: number): void {
    this._perkMenu.tickTimeline(dtUiMs);
  }

  protected override _drawPerkMenu(choices: readonly PerkId[]): void {
    this._perkMenu.draw(this._perkMenuUiContext(), choices);
  }

  protected override _drawPerkPrompt(opts: {
    pendingCount: number;
    anyAlive: boolean;
    menuActive: boolean;
    textColor: wgl.Color;
    promptScale: number;
  }): void {
    this._perkPrompt.draw({
      ctx: this._perkMenuUiContext(),
      pendingCount: opts.pendingCount,
      anyAlive: opts.anyAlive,
      menuActive: opts.menuActive,
      config: this.config,
      uiTextWidth: (text: string, scale: number) => this._uiTextWidth(text, scale),
      textColor: opts.textColor,
      promptScale: opts.promptScale,
    });
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

  protected _replayOutputBasename(opts: { stamp: string; replay: object }): string {
    const stamp = opts.stamp;
    const level = this._questLevel !== null ? this._questLevel.text : 'quest';
    const kind = this._outcome !== null ? this._outcome.kind : 'quest';
    const baseTimeMs = int(this._questSpawnState.spawnTimelineMs);
    return `quest_${level}_${stamp}_${kind}_t${baseTimeMs}`;
  }

  protected _replaySkipSaveWhenEmpty(opts: { recorder: { tickIndex: number } }): boolean {
    // Avoid emitting empty replays/checkpoint sidecars (usually indicates a
    // test harness calling failure/complete helpers without ticking).
    return int(opts.recorder.tickIndex) <= 0;
  }

  protected _lanModeName(): 'survival' | 'rush' | 'quests' {
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

  protected _lanPrepareFrame(
    _role: string,
    _dtUiMs: number,
    session: LanSession,
    _dtTick: number,
  ): boolean {
    session.detailPreset = int(this._deterministicDetailPreset());
    session.violenceDisabled = int(this._deterministicViolenceDisabled());
    return true;
  }

  protected _lanOnTickApplied(
    tick: DeterministicSessionTick,
    frameTick: number | null,
    _dtTick: number,
  ): LanStepAction {
    const spawnState = this._questSpawnState;

    if (frameTick !== null) {
      this._storeNetRuntimeSnapshot({
        tickIndex: frameTick,
        elapsedMs: this._simSession !== null ? this._simSession.elapsedMs : 0.0,
        spawnEntries: [...spawnState.spawnEntries],
        spawnTimelineMs: spawnState.spawnTimelineMs,
        noCreaturesTimerMs: spawnState.noCreaturesTimerMs,
        completionTransitionMs: spawnState.completionTransitionMs,
        perkPendingCount: this.state.perkSelection.pendingCount,
      });
    }

    if (spawnState.completed) {
      if (this._outcome === null) {
        if (this._questLevel === null) {
          throw new Error('quest outcome requires active quest level');
        }
        const [fired, hit] = shotsFromState(this.state, { playerIndex: int(this.player.index) });
        const mostUsedWeaponId = mostUsedWeaponIdForPlayer(
          this.state,
          { playerIndex: int(this.player.index), fallbackWeaponId: this.player.weapon.weaponId },
        );
        const playerHealthValues = this.simWorld.players.map((player) => player.health);
        const player2Health = playerHealthValues.length >= 2 ? playerHealthValues[1] : null;
        this._outcome = new QuestRunOutcome({
          kind: 'completed',
          level: this._questLevel,
          baseTimeMs: int(spawnState.spawnTimelineMs),
          playerHealth: playerHealthValues.length > 0 ? playerHealthValues[0] : this.player.health,
          player2Health,
          playerHealthValues,
          pendingPerkCount: int(this.state.perkSelection.pendingCount),
          experience: int(this.player.experience),
          killCount: int(this.creatures.killCount),
          weaponId: this.player.weapon.weaponId,
          shotsFired: fired,
          shotsHit: hit,
          mostUsedWeaponId,
        });
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
    return buildPostApplyReaction({
      tickResult: opts.tickResult,
      questState: this._questSpawnState,
    });
  }

  protected _applyTickPostApplyReaction(reaction: PostApplyReaction, _opts: { dtSeconds: number }): void {
    applyPostApplyReaction({
      reaction,
      playSfx: (sfx) => this.audioBridge.router.playSfx(sfx),
      playCompletionMusic: () => this._playQuestCompletionMusic(),
    });
  }

  private _playQuestCompletionMusic(): void {
    if (this.audio === null) return;
    audioPlayMusic(this.audio, 'crimsonquest');
    const playback = this.audio.music.playbacks?.get?.('crimsonquest');
    if (playback != null) {
      playback.volume = 0.0;
      try {
        wgl.setMusicVolume(playback.music, 0.0);
      } catch {
        playback.volume = 0.0;
      }
    }
  }

  protected _applyResyncSnapshot(snapshot: {
    spawnEntries?: SpawnEntry[];
    spawnTimelineMs?: number;
    noCreaturesTimerMs?: number;
    completionTransitionMs?: number;
    elapsedMs?: number;
  } | null): void {
    const rs = snapshot;
    if (
      rs === null ||
      rs.spawnEntries === undefined ||
      rs.spawnTimelineMs === undefined ||
      rs.noCreaturesTimerMs === undefined ||
      rs.completionTransitionMs === undefined ||
      rs.elapsedMs === undefined
    ) {
      return;
    }
    this._questSpawnState.spawnEntries = [...rs.spawnEntries];
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
    this._replayCheckpoints.length = 0;
    this._replayCheckpointsLastTick = null;

    const hardcoreFlag = this.config.gameplay.hardcore;
    this.hardcore = hardcoreFlag;

    // Native quest start does not reseed RNG per level; carry the current
    // session RNG state into the next run.
    const seed = int(this.state.rng.state) & 0xFFFFFFFF;
    this._runResetSeed = seed;

    const playerCount = this.config.gameplay.playerCount;
    this._syncWorldRuntimeConfig();
    this.worldRuntime.reset({ seed, playerCount: Math.max(1, Math.min(4, playerCount)) });
    this._bindWorld();
    this._localInput.reset({ players: this.simWorld.players });
    this.bindStatus(opts.status);

    const boundStatus = this.state.status;
    const genericUnlockIndex = boundStatus != null ? int(boundStatus.questUnlockIndex ?? 0) : 0;

    advanceUnlockTerrain(
      this.state.rng,
      { unlockIndex: genericUnlockIndex, width: int(this.worldSize), height: int(this.worldSize) },
    );

    // Native `quest_start_selected()` burns one `crt_rand()` for
    // `highscore_record_random_tag` before quest terrain and spawn setup.
    this.state.rng.rand({ caller: RngCallerStatic.QUEST_START_SELECTED_HIGHSCORE_RANDOM_TAG });

    const questTerrain = advanceExplicitTerrain(
      this.state.rng,
      { terrainSlots: quest.terrainSlots, width: int(this.worldSize), height: int(this.worldSize) },
    );
    this.applyTerrainSetup({ terrainSlots: questTerrain.terrainSlots, seed: questTerrain.terrainSeed });

    const ctx = new QuestContext({
      width: int(this.worldSize),
      height: int(this.worldSize),
      playerCount: this.simWorld.players.length,
    });
    const entries = buildQuestSpawnTable(quest, ctx, {
      rng: this.state.rng,
      hardcore: hardcoreFlag,
      fullVersion: !this.demoModeActive,
    });
    this.simWorld.state.rng.srand(int(this.state.rng.state));
    const totalSpawnCount = entries.reduce((sum, e) => sum + int(e.count), 0);
    this._questDef = quest;
    this._questLevel = quest.level;
    this._questTotalSpawnCount = int(totalSpawnCount);
    this._resetGameplayFrameClock();
    this._simSession = this._newSimSession({ spawnEntries: entries });

    if (opts.status !== null) {
      const idx = trackedQuestGamesCounterIndex(quest.level);
      if (idx !== null) {
        opts.status.incrementQuestPlayCount(idx);
      }
    }
  }

  protected _handleInput(): void {
    if (this._perkMenu.open && InputState.wasKeyPressed(KEY_ESCAPE)) {
      this.audioBridge.router.playSfx(SfxId.UI_BUTTONCLICK);
      this._perkMenu.close();
      return;
    }

    if (!this._lanEnabled && InputState.wasKeyPressed(KEY_TAB)) {
      this._paused = !this._paused;
    }

    if (this._debugEnabled && !this._perkMenu.open) {
      if (InputState.wasKeyPressed(KEY_F2)) {
        this.state.debugGodMode = !this.state.debugGodMode;
        this.audioBridge.router.playSfx(SfxId.UI_BUTTONCLICK);
      }
      if (InputState.wasKeyPressed(KEY_F3)) {
        this.state.perkSelection.pendingCount += 1;
        this.state.perkSelection.choicesDirty = true;
        this.audioBridge.router.playSfx(SfxId.UI_LEVELUP);
      }
      if (InputState.wasKeyPressed(KEY_LEFT_BRACKET)) {
        this._debugCycleWeapon(-1);
      }
      if (InputState.wasKeyPressed(KEY_RIGHT_BRACKET)) {
        this._debugCycleWeapon(1);
      }
    }

    if (InputState.wasKeyPressed(KEY_ESCAPE)) {
      this._action = 'open_pause_menu';
      return;
    }
  }

  private _debugCycleWeapon(delta: number): void {
    const weaponIds = _DEBUG_WEAPON_IDS;
    if (weaponIds.length === 0) return;
    const current = this.player.weapon.weaponId;
    let idx = weaponIds.indexOf(current);
    if (idx < 0) idx = 0;
    const weaponId = weaponIds[((idx + int(delta)) % weaponIds.length + weaponIds.length) % weaponIds.length];
    weaponAssignPlayer(this.player, weaponId, { state: this.state });
  }

  private _deathTransitionReady(): boolean {
    let deadPlayers = 0;
    for (const player of this.simWorld.players) {
      if (player.health > 0.0) return false;
      deadPlayers += 1;
      if (player.deathTimer >= 0.0) return false;
    }
    return deadPlayers > 0;
  }

  private _tickDeathTimers(dt: number, opts: { rate?: number } = {}): void {
    const rate = opts.rate ?? 20.0;
    const delta = dt * rate;
    if (delta <= 0.0) return;
    for (const player of this.simWorld.players) {
      if (player.health > 0.0) continue;
      if (player.deathTimer < 0.0) continue;
      player.deathTimer -= delta;
    }
  }

  private _closeFailedRun(): void {
    if (this._outcome === null) {
      if (this._questLevel === null) {
        throw new Error('quest outcome requires active quest level');
      }
      const [fired, hit] = shotsFromState(this.state, { playerIndex: int(this.player.index) });
      const mostUsedWeaponId = mostUsedWeaponIdForPlayer(
        this.state,
        { playerIndex: int(this.player.index), fallbackWeaponId: this.player.weapon.weaponId },
      );
      const playerHealthValues = this.simWorld.players.map((player) => player.health);
      const player2Health = playerHealthValues.length >= 2 ? playerHealthValues[1] : null;
      this._outcome = new QuestRunOutcome({
        kind: 'failed',
        level: this._questLevel,
        baseTimeMs: int(this._questSpawnState.spawnTimelineMs),
        playerHealth: playerHealthValues.length > 0 ? playerHealthValues[0] : this.player.health,
        player2Health,
        playerHealthValues,
        pendingPerkCount: int(this.state.perkSelection.pendingCount),
        experience: int(this.player.experience),
        killCount: int(this.creatures.killCount),
        weaponId: this.player.weapon.weaponId,
        shotsFired: fired,
        shotsHit: hit,
        mostUsedWeaponId,
      });
    }
    this._saveReplay();
    this.closeRequested = true;
  }

  update(dt: number): void {
    const frame = this._beginModeUpdate(dt);
    if (frame === null) return;
    if (this.closeRequested) return;

    if (this._lanEnabled && this._lanRuntime !== null) {
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

    const tickDt = this._gameplayTickDt({ session });

    const onTick = (tick: DeterministicSessionTick, _tickIndex: number | null): boolean => {
      const action = this._lanOnTickApplied(tick, null, tickDt);
      return action !== 'continue';
    };

    const onCheckpoint = (tickIndex: number, tick: DeterministicSessionTick): void => {
      this._recordReplayCheckpointFromTick({ tickIndex, tick });
    };

    this._runDeterministicSessionTicks({
      dtFrame: simDt,
      session,
      recorder: this._replayRecorder,
      onTick,
      onCheckpoint,
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
      const total = this._questTotalSpawnCount;
      const kills = this.creatures.killCount;
      const questProgressRatio = total > 0 ? kills / total : null;
      const hudFlags = hudFlagsForGameMode(this._configGameModeId());

      this._drawTargetHealthBar();
      hudBottom = drawHudOverlay(new HudRenderContext({
        resources: this.renderResources.resources,
        state: this._hudState,
        font: this._small,
        alpha: 1.0,
        showHealth: hudFlags.showHealth,
        showWeapon: hudFlags.showWeapon,
        showXp: hudFlags.showXp,
        showTime: hudFlags.showTime,
        showQuestHud: hudFlags.showQuestHud,
        smallIndicators: this._hudSmallIndicators(),
      }), {
        player: this.player,
        players: this.simWorld.players,
        bonusHud: this.state.bonusHud,
        elapsedMs: this._questSpawnState.spawnTimelineMs,
        frameDtMs: this._lastDtMs,
        questProgressRatio,
      });
    }

    if (this._debugEnabled && !perkMenuActive) {
      const x = 18.0;
      const y = Math.max(18.0, hudBottom + 10.0);
      const god = this.state.debugGodMode ? 'on' : 'off';
      const line = this._uiLineHeight(0.9);
      this._drawUiText(
        `debug: [/] weapon  F3 perk+1  F2 god=${god}`,
        new Vec2(x, y),
        UI_HINT_COLOR,
        0.9,
      );
      const overlayEndY = this._drawLanDebugInfo({ x, y: y + line, lineH: line });
      debugOverlayHeight = Math.max(0.0, overlayEndY - y);
    }

    this._drawQuestTitle();
    this._drawQuestCompleteBanner();

    this._drawPerkPrompt({
      pendingCount: this.state.perkSelection.pendingCount,
      anyAlive: this._anyPlayerAlive(),
      menuActive: this._perkMenu.active,
      textColor: UI_TEXT_COLOR,
      promptScale: UI_TEXT_SCALE,
    });
    this._drawPerkMenu(perkSelectionPreparedChoices(
      this.simWorld.players,
      this.state.perkSelection,
    ));

    if (perkMenuActive) {
      this._drawGameCursor();
    } else if (this._paused) {
      this._drawGameCursor();
      const x = 18.0;
      let y = Math.max(18.0, hudBottom + 10.0);
      y += debugOverlayHeight;
      this._drawUiText('paused (TAB)', new Vec2(x, y), UI_HINT_COLOR);
    }
    this._drawLanWaitOverlay();
  }

  private _drawGameCursor(): void {
    const resources = this.renderResources.resources;
    const mousePos = this._uiMouse;
    drawMenuCursor(
      getTexture(resources, TextureId.PARTICLES),
      getTexture(resources, TextureId.UI_CURSOR),
      { pos: mousePos, pulseTime: this._cursorPulseTime },
    );
  }

  private _drawQuestTitle(): void {
    const font = this._grimMono;
    const quest = this._questDef;
    if (font === null || quest === null) return;
    drawQuestTitleTimerOverlay(
      font,
      quest.title,
      quest.level.text,
      { timerMs: this._questSpawnState.spawnTimelineMs },
    );
  }

  private _drawQuestCompleteBanner(): void {
    const tex = getTexture(this.renderResources.resources, TextureId.UI_TEXT_LEVEL_COMPLETE);
    if (tex === null) return;
    drawQuestCompleteBannerOverlay(
      tex,
      { timerMs: this._questSpawnState.completionTransitionMs },
    );
  }
}
