// Port of crimson/modes/survival_mode.py

import { TextureId } from '@grim/assets.ts';
import type { AudioState } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import type { Crand } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { ViewContext } from '@grim/view.ts';
import { debugEnabled } from '@crimson/debug.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { survivalCheckLevelUp } from '@crimson/gameplay.ts';
import { lanDebugLog } from '@crimson/net/debug-log.ts';
import type { ModeStateSnapshotV2 } from '@crimson/net/rollback-resync-v5.ts';
import { SurvivalRuntimeSnapshotV2, SurvivalStateSnapshotV2 } from '@crimson/net/rollback-resync-v5.ts';
import { perkSelectionPreparedChoices } from '@crimson/perks/selection.ts';
import { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { Replay } from '@crimson/replay/index.ts';
import { ReplayHeader, ReplayRecorder } from '@crimson/replay/index.ts';
import { DEFAULT_CHECKPOINT_SAMPLE_RATE } from '@crimson/replay/checkpoints.ts';
import { advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { buildSurvivalSession } from '@crimson/sim/session-builders.ts';
import type { DeterministicSession, DeterministicSessionTick } from '@crimson/sim/sessions.ts';
import { SurvivalSpawnState } from '@crimson/sim/sessions.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { HudRenderContext, drawHudOverlay, hudFlagsForGameMode } from '@crimson/ui/hud.ts';
import { PERK_MENU_TRANSITION_MS } from '@crimson/ui/perk-menu.ts';
import { weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { WEAPON_BY_ID } from '@crimson/weapons.ts';
import type { LanSession, LanStepAction } from '@crimson/modes/base-gameplay-mode.ts';
import { BaseGameplayMode } from '@crimson/modes/base-gameplay-mode.ts';
import { buildHighscoreRecordForGameOver } from '@crimson/modes/components/highscore-record-builder.ts';
import { PerkMenuController } from '@crimson/modes/components/perk-menu-controller.ts';
import { PerkPromptState } from '@crimson/modes/components/perk-prompt-controller.ts';
import * as wgl from '@wgl';

export const WORLD_SIZE = 1024.0;
export const UI_TEXT_SCALE = 1.0;
export const UI_TEXT_COLOR = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 255 / 255);
export const UI_HINT_COLOR = wgl.makeColor(140 / 255, 140 / 255, 140 / 255, 255 / 255);
export const UI_SPONSOR_COLOR = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.5) / 255);
export const UI_ERROR_COLOR = wgl.makeColor(240 / 255, 80 / 255, 80 / 255, 255 / 255);
const _DEBUG_WEAPON_IDS = Array.from(Array.from(WEAPON_BY_ID.keys()).sort((left, right) => pythonCompareKeys(left, right)));

function pythonSplitlines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (/(?:\r\n|\r|\n)$/.test(text)) {
    lines.pop();
  }
  return lines;
}

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

export class SurvivalMode extends BaseGameplayMode {
  protected _perkPrompt: PerkPromptState;
  protected _perkMenu: PerkMenuController;
  protected _hudFadeMs: number;
  protected _cursorTime: number;
  protected _spawnState: SurvivalSpawnState;
  protected _lanLastTickIndex: number;

  get perkPrompt(): PerkPromptState {
    return this._perkPrompt;
  }
  get perkMenu(): PerkMenuController {
    return this._perkMenu;
  }
  get hudFadeMs(): number {
    return this._hudFadeMs;
  }
  get cursorTime(): number {
    return this._cursorTime;
  }
  get spawnState(): SurvivalSpawnState {
    return this._spawnState;
  }
  get lanLastTickIndex(): number {
    return this._lanLastTickIndex;
  }

  constructor(ctx: ViewContext, opts: { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand });
  constructor(opts: { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
  constructor(ctxOrOpts: ViewContext | { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean }, maybeOpts?: { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand }) {
    const ctx = maybeOpts === undefined ? { assetsDir: (ctxOrOpts as { assetsUrl?: string }).assetsUrl ?? '', preserveBugs: (ctxOrOpts as { preserveBugs?: boolean }).preserveBugs ?? false } as ViewContext : ctxOrOpts as ViewContext;
    const opts = maybeOpts ?? (ctxOrOpts as { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
    const config = opts.config;
    const console = opts.console ?? null;
    const audio = opts.audio ?? null;
    const audioRng = opts.audioRng;
    super({ assetsUrl: ctx.assetsDir, preserveBugs: ctx.preserveBugs, worldSize: WORLD_SIZE, defaultGameModeId: GameMode.SURVIVAL, demoModeActive: false, questFailRetryCount: 0, hardcore: false, config: config, console: console, audio: audio, audioRng: audioRng });
    this._perkPrompt = new PerkPromptState();
    this._perkMenu = new PerkMenuController({ onClose: this._resetPerkPrompt.bind(this) });
    this._hudFadeMs = PERK_MENU_TRANSITION_MS;
    this._cursorTime = 0.0;
    this._replayRecorder = null;
    this._spawnState = new SurvivalSpawnState();
    this._simSession = this._newSimSession();
    this._lanLastTickIndex = -1;
  }

  protected _newSimSession(): DeterministicSession {
    const [session, spawnState] = buildSurvivalSession({ world: this.simWorld.worldState, worldSize: this.worldSize, damageScaleByType: this.simWorld.damageScaleByType, detailPreset: 5, violenceDisabled: 0, gameTuneStarted: Boolean(this.simWorld.gameTuneStarted), finalizePostRenderLifecycle: true });
    this._spawnState = spawnState;
    return session;
  }

  protected _replayCheckpointElapsedMs(): number {
    return this._sessionElapsedMs();
  }

  protected _replayClaimedStatsComplete(): boolean {
    return Boolean(this._gameOverActive);
  }

  protected _replayClaimedStatsElapsedMs(): number {
    return int(this._sessionElapsedMs());
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: Replay }): string {
    const stamp = opts.stamp;
    const replay = opts.replay;
    const _ = replay;
    const score = int(this.player.experience);
    return `survival_${stamp}_score${score}`;
  }

  protected _tryOpenPerkMenu(): void {
    this._openPerkMenuUi({
      menu: this._perkMenu,
      players: this.simWorld.players,
      gameMode: GameMode.SURVIVAL,
      playerCount: Math.max(1, this.simWorld.players.length),
    });
  }

  protected _resetPerkPrompt(): void {
    this._perkPrompt.resetIfPending({ pendingCount: int(this.state.perkSelection.pendingCount) });
  }

  protected _updatePerkUi(opts: { dtUiMs: number; allowInput?: boolean; allowPulse?: boolean }): void {
    const dtUiMs = opts.dtUiMs;
    const allowInput = opts.allowInput ?? true;
    const allowPulse = opts.allowPulse ?? true;
    const perkCtx = this._perkMenuUiContext();
    const pendingCount = int(this.state.perkSelection.pendingCount);
    const anyAlive = this._anyPlayerAlive();
    const choices = perkSelectionPreparedChoices(this.simWorld.players, this.state.perkSelection);
    this._perkPrompt.beginFrame();
    if (this._perkMenu.open && allowInput) {
      const choiceIndex = this._perkMenu.handleInput(perkCtx, choices, { dtUiMs: dtUiMs });
      if (choiceIndex !== null) {
        this.recordPerkPickCommand(int(choiceIndex), { playerIndex: 0 });
      }
    }
    if (allowInput && this._perkPrompt.pollOpenRequest({ ctx: perkCtx, config: this.config, pendingCount: pendingCount, playerCount: Math.max(1, this.simWorld.players.length), anyAlive: anyAlive, paused: this._paused, menuActive: this._perkMenu.active, promptScale: UI_TEXT_SCALE })) {
      this._tryOpenPerkMenu();
    }
    this._perkPrompt.tickTimer({
      pendingCount: pendingCount,
      anyAlive: anyAlive,
      paused: this._paused,
      menuActive: this._perkMenu.active,
      dtUiMs: dtUiMs,
    });
    if (allowPulse) {
      this._perkPrompt.tickPulse(dtUiMs);
    }
    this._perkMenu.tickTimeline(dtUiMs);
  }

  protected _wrapUiText(text: string, opts: { maxWidth: number; scale?: number }): string[] {
    const maxWidth = opts.maxWidth;
    const scale = opts.scale ?? UI_TEXT_SCALE;
    const lines: string[] = [];
    for (const raw of (() => { const value = pythonSplitlines(text); return value.length > 0 ? value : ['']; })()) {
      const para = raw.trim();
      if (!para) {
        lines.push('');
        continue;
      }
      let current = '';
      for (const word of (() => { const value = para; const text = String(value).trim(); return text === '' ? [] : text.split(/\s+/); })()) {
        const candidate = !current ? word : `${current} ${word}`;
        if (current && this._uiTextWidth(candidate, scale) > maxWidth) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      if (current) {
        lines.push(current);
      }
    }
    return lines;
  }

  open(): void {
    super.open();

    this._perkPrompt.reset();
    this._perkMenu.reset();
    this._cursorTime = 0.0;
    this._cursorPulseTime = 0.0;
    this._resetGameplayFrameClock();
    this._resetLanCaptureClock();
    this._lanLastTickIndex = -1;

    const status = this.state.status;
    const baseStatus = this.saveStatus;
    const simUnlockIndex = status !== null ? int(status.questUnlockIndex) : 0;
    const simUnlockIndexFull = status !== null ? int(status.questUnlockIndexFull) : 0;
    const statusUnlockIndex = baseStatus !== null ? int(baseStatus.questUnlockIndex) : int(simUnlockIndex);
    const statusUnlockIndexFull = baseStatus !== null ? int(baseStatus.questUnlockIndexFull) : int(simUnlockIndexFull);
    const questUnlockIndex = int(simUnlockIndex);
    const terrain = advanceUnlockTerrain(this.state.rng, { unlockIndex: int(questUnlockIndex), width: int(this.worldSize), height: int(this.worldSize) });
    lanDebugLog(
      'terrain_prelude',
      { mode: 'SurvivalMode', lanEnabled: Boolean(this._lanEnabled), lanRole: String(this._lanRole), statusQuestUnlockIndex: int(statusUnlockIndex), statusQuestUnlockIndexFull: int(statusUnlockIndexFull), simQuestUnlockIndex: int(simUnlockIndex), simQuestUnlockIndexFull: int(simUnlockIndexFull), questUnlockIndex: int(questUnlockIndex), terrainSlots: terrain.terrainSlots, terrainSeed: terrain.terrainSeed },
    );
    this.applyTerrainSetup({ terrainSlots: terrain.terrainSlots, seed: terrain.terrainSeed });
    this.simWorld.state.rng.srand(int(this.state.rng.state));

    this._simSession = this._newSimSession();

    this._hudFadeMs = PERK_MENU_TRANSITION_MS;
    const replayStatus = status === null ? new GameStatusData() : status.asData();
    const recordReplay = !Boolean(this._lanEnabled) || String(this._lanRole) === 'host';
    if (recordReplay) {
      this._replayRecorder = new ReplayRecorder(new ReplayHeader({ gameModeId: GameMode.SURVIVAL, seed: int(this._runResetSeed), tickRate: int(this._gameplayTickRate()), questFailRetryCount: int(this.questFailRetryCount), hardcore: Boolean(this.hardcore), preserveBugs: Boolean(this.state.preserveBugs), detailPreset: int(this._deterministicDetailPreset()), violenceDisabled: int(this._deterministicViolenceDisabled()), worldSize: this.worldSize, playerCount: this.simWorld.players.length, status: replayStatus }));
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
  }

  close(): void {
    this._simSession = null;
    this._lanLastTickIndex = -1;
    super.close();
  }

  protected _handleInput(): void {
    if (this._gameOverActive) {
      if (InputState.wasKeyPressed(27)) {
        this._action = 'back_to_menu';
        this.closeRequested = true;
      }
      return;
    }
    if (this._perkMenu.open && InputState.wasKeyPressed(27)) {
      if (Boolean(this._lanEnabled) && String(this._lanRole) === 'join') {
        return;
      }
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
      if (InputState.wasKeyPressed(88)) {
        this.player.experience += 5000;
        survivalCheckLevelUp(this.player, this.state.perkSelection);
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

  protected _enterGameOver(): void {
    if (this._gameOverActive) {
      return;
    }
    const gameModeId = (() => { const value = this.config.gameplay.mode; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
    const record = buildHighscoreRecordForGameOver({ state: this.state, player: this.player, survivalElapsedMs: int(this._sessionElapsedMs()), creatureKillCount: int(this.creatures.killCount), gameModeId: gameModeId });
    this._gameOverRecord = record;
    this._gameOverUi.open();
    this._gameOverActive = true;
    this._perkMenu.close();
    this._saveReplay();
  }

  protected _lanModeName(): "survival" {
    return 'survival';
  }

  protected _lanMatchSession(): DeterministicSession | null {
    return this._simSession;
  }

  protected _lanOnPaused(dt: number): void {
    const _ = dt;
    if (this._deathTransitionReady()) {
      this._enterGameOver();
    }
  }

  protected _lanPrepareFrame(role: string, dtUiMs: number, session: LanSession, dtTick: number): boolean {
    session.detailPreset = int(this._deterministicDetailPreset());
    session.violenceDisabled = int(this._deterministicViolenceDisabled());
    this._updatePerkUi({
      dtUiMs: dtUiMs,
      allowInput: (role === 'host'),
      allowPulse: !this._paused && !this._gameOverActive,
    });
    if (this._perkMenu.active) {
      this._hudFadeMs = 0.0;
    } else {
      this._hudFadeMs = clamp(this._hudFadeMs + dtUiMs, 0.0, PERK_MENU_TRANSITION_MS);
    }

    if (this._perkMenu.active) {
      this._resetLanCaptureClock();
      if (this._deathTransitionReady()) {
        this._enterGameOver();
      }
      return false;
    }
    return true;
  }

  protected _lanAllowFramePop(): boolean {
    return !this._perkMenu.active;
  }

  protected _lanOnTickApplied(tick: DeterministicSessionTick, frameTickIndex: number | null, dtTick: number): LanStepAction {
    const _ = [tick, dtTick];
    const sessionElapsedMs = this._sessionElapsedMs();
    const sessionStage = int(this._spawnState.stage);
    const sessionSpawnCooldownMs = this._spawnState.spawnCooldownMs;

    if (frameTickIndex !== null) {
      this._lanLastTickIndex = int(frameTickIndex);
      this._storeNetRuntimeSnapshot({
        snapshot: new SurvivalStateSnapshotV2({ tickIndex: int(frameTickIndex), replayState: this._netReplaySnapshotState(), runtimeState: new SurvivalRuntimeSnapshotV2({ elapsedMs: sessionElapsedMs, stage: int(sessionStage), spawnCooldownMs: sessionSpawnCooldownMs, perkPendingCount: int(this.state.perkSelection.pendingCount) }) }),
      });
    }

    if (this._perkMenu.active) {
      return 'stop_before_finalize';
    }

    if (this._deathTransitionReady()) {
      this._enterGameOver();
      return 'stop_after_finalize';
    }
    return 'continue';
  }

  protected _applyResyncSnapshot(snapshot: ModeStateSnapshotV2): void {
    if (!(snapshot instanceof SurvivalStateSnapshotV2)) {
      return;
    }
    const rs = snapshot.runtimeState;
    if (this._simSession !== null) {
      this._simSession.elapsedMs = rs.elapsedMs;
    }
    this._spawnState.stage = int(rs.stage);
    this._spawnState.spawnCooldownMs = rs.spawnCooldownMs;
  }

  update(dt: number): void {
    const frame = this._beginModeUpdate(dt);
    if (frame === null) {
      return;
    }

    this._cursorTime += frame.dt;
    if (this._gameOverActive) {
      this._updateGameOverUi(frame.dt);
      return;
    }

    if (Boolean(this._lanEnabled) && this._lanRuntime !== null) {
      this._updateLanMatch({ dt: frame.dt, dtUiMs: frame.dtUiMs });
      return;
    }

    this._updatePerkUi({
      dtUiMs: frame.dtUiMs,
      allowPulse: !this._paused && !this._gameOverActive,
    });
    if (this._perkMenu.active) {
      this._hudFadeMs = 0.0;
    } else {
      this._hudFadeMs = clamp(this._hudFadeMs + frame.dtUiMs, 0.0, PERK_MENU_TRANSITION_MS);
    }

    const perkMenuActive = this._perkMenu.active;
    const simDt = (!this._paused && !perkMenuActive) ? frame.dt : 0.0;
    const session = this._simSession;
    if (this._lanWaitGateActive()) {
      this._resetGameplayFrameClock();
      return;
    }
    if (simDt <= 0.0) {
      this._resetGameplayFrameClock();
      if (this._deathTransitionReady()) {
        this._enterGameOver();
      }
      return;
    }
    if (session === null) {
      return;
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

  protected _drawGameCursor(): void {
    const resources = this.renderResources.resources;
    const mousePos = this._uiMouse;
    drawMenuCursor(
      resources.texture(TextureId.PARTICLES),
      resources.texture(TextureId.UI_CURSOR),
      { pos: mousePos, pulseTime: this._cursorPulseTime },
    );
  }

  draw(): void {
    const perkMenuActive = this._perkMenu.active;
    this._drawWorld({
      drawAimIndicators: !this._gameOverActive && !perkMenuActive,
      entityAlpha: this._worldEntityAlpha(),
    });
    this._drawScreenFade();

    let hudBottom = 0.0;
    if (!this._gameOverActive && !perkMenuActive) {
      const hudAlpha = clamp(this._hudFadeMs / PERK_MENU_TRANSITION_MS, 0.0, 1.0);
      const hudFlags = hudFlagsForGameMode(this._configGameModeId());
      this._drawTargetHealthBar({ alpha: hudAlpha });
      hudBottom = drawHudOverlay(new HudRenderContext({ resources: this.renderResources.resources, state: this._hudState, font: this._small, alpha: hudAlpha, showHealth: hudFlags.showHealth, showWeapon: hudFlags.showWeapon, showXp: hudFlags.showXp, showTime: hudFlags.showTime, showQuestHud: hudFlags.showQuestHud, smallIndicators: this._hudSmallIndicators() }), { player: this.player, players: this.simWorld.players, bonusHud: this.state.bonusHud, elapsedMs: this._sessionElapsedMs(), score: this.player.experience, frameDtMs: this._lastDtMs });
    }

    let yExtra: number;
    if (debugEnabled() && !this._gameOverActive && !perkMenuActive) {
      // Minimal debug text.
      const x = 18.0;
      const y = Math.max(18.0, hudBottom + 10.0);
      const line = this._uiLineHeight();
      const elapsedMs = this._sessionElapsedMs();
      this._drawUiText(`survival: t=${(elapsedMs / 1000.0).toFixed(1).padStart(6, ' ')}s  stage=${int(this._spawnState.stage)}`, new Vec2(x, y), UI_TEXT_COLOR);
      this._drawUiText(`xp=${this.player.experience}  level=${this.player.level}  kills=${this.creatures.killCount}`, new Vec2(x, y + line), UI_HINT_COLOR);
      const god = this.state.debugGodMode ? 'on' : 'off';
      this._drawUiText(`debug: [/] weapon  F3 perk+1  F2 god=${god}  X xp+5000`, new Vec2(x, y + line * 2.0), UI_HINT_COLOR, 0.9);
      yExtra = y + line * 3.0;
      if (this._paused) {
        this._drawUiText('paused (TAB)', new Vec2(x, yExtra), UI_HINT_COLOR);
        yExtra += line;
      }
      if (this.player.health <= 0.0) {
        this._drawUiText('game over', new Vec2(x, yExtra), UI_ERROR_COLOR);
        yExtra += line;
      }
      this._drawLanDebugInfo({ x: x, y: yExtra, lineH: line });
    }
    if (!this._gameOverActive) {
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
    }
    if (!this._gameOverActive && perkMenuActive) {
      this._drawGameCursor();
    }

    if (this._gameOverActive && this._gameOverRecord !== null) {
      this._gameOverUi.draw({
        record: this._gameOverRecord,
        bannerKind: this._gameOverBanner,
        resources: this.renderResources.resources,
        mouse: this._uiMousePos(),
      });
    }
    this._drawLanWaitOverlay();
  }
}
