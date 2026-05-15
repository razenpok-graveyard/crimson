// Port of crimson/modes/survival_mode.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { type AudioState } from '@grim/audio.ts';
import { type CrimsonConfig } from '@grim/config.ts';
import { type ConsoleState } from '@grim/console.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { clamp } from '@grim/math.ts';
import { Crand } from '@grim/rand.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { survivalCheckLevelUp } from '@crimson/gameplay.ts';
import { perkSelectionPreparedChoices } from '@crimson/perks/selection.ts';
import { advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { buildSurvivalSession } from '@crimson/sim/session-builders.ts';
import { DeterministicSession, type DeterministicSessionTick, SurvivalSpawnState } from '@crimson/sim/sessions.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { drawHudOverlay, HudRenderContext, hudFlagsForGameMode } from '@crimson/ui/hud.ts';
import { PERK_MENU_TRANSITION_MS } from '@crimson/ui/perk-menu.ts';
import { weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { WeaponId, WEAPON_BY_ID } from '@crimson/weapons.ts';
import { BaseGameplayMode, type LanSession, type LanStepAction } from './base-gameplay-mode.ts';
import { buildHighscoreRecordForGameOver } from './components/highscore-record-builder.ts';
import { PerkMenuController } from './components/perk-menu-controller.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { PerkPromptState } from './components/perk-prompt-controller.ts';

const WORLD_SIZE = 1024.0;

const UI_TEXT_SCALE = 1.0;
const UI_TEXT_COLOR = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 1.0);
const UI_HINT_COLOR = wgl.makeColor(140 / 255, 140 / 255, 140 / 255, 1.0);
const UI_SPONSOR_COLOR = wgl.makeColor(1.0, 1.0, 1.0, int(255 * 0.5) / 255);
const UI_ERROR_COLOR = wgl.makeColor(240 / 255, 80 / 255, 80 / 255, 1.0);

const KEY_ESCAPE = 27;
const KEY_TAB = 9;
const KEY_F2 = 113;
const KEY_F3 = 114;
const KEY_LEFT_BRACKET = 219;
const KEY_RIGHT_BRACKET = 221;
const KEY_X = 88;

const _DEBUG_WEAPON_IDS: WeaponId[] = (() => {
  const ids: WeaponId[] = [];
  for (const id of WEAPON_BY_ID.keys()) {
    ids.push(id);
  }
  return ids.sort((a, b) => a - b);
})();

export class SurvivalMode extends BaseGameplayMode {
  private _perkPrompt = new PerkPromptState();
  private _perkMenu = new PerkMenuController({ onClose: () => this._resetPerkPrompt() });
  private _hudFadeMs: number = PERK_MENU_TRANSITION_MS;
  private _cursorTime = 0.0;
  private _spawnState = new SurvivalSpawnState();
  protected _simSession: DeterministicSession | null = null;
  private _lanLastTickIndex = -1;

  constructor(opts: {
    assetsUrl?: string;
    baseDir?: string;
    preserveBugs?: boolean;
    config: CrimsonConfig;
    console?: ConsoleState | null;
    audio?: AudioState | null;
    audioRng: Crand;
  }) {
    super({
      worldSize: WORLD_SIZE,
      defaultGameModeId: GameMode.SURVIVAL,
      demoModeActive: false,
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
    this._simSession = this._newSimSession();
  }

  private _newSimSession(): DeterministicSession {
    const [session, spawnState] = buildSurvivalSession({
      world: this.simWorld.worldState,
      worldSize: this.worldSize,
      damageScaleByType: this.simWorld.damageScaleByType,
      detailPreset: 5,
      violenceDisabled: 0,
      gameTuneStarted: this.simWorld.gameTuneStarted,
      finalizePostRenderLifecycle: true,
    });
    this._spawnState = spawnState;
    return session;
  }

  protected _replayCheckpointElapsedMs(): number {
    return this._sessionElapsedMs();
  }

  protected _replayClaimedStatsComplete(): boolean {
    return this._gameOverActive;
  }

  protected _replayClaimedStatsElapsedMs(): number {
    return int(this._sessionElapsedMs());
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: object }): string {
    const stamp = opts.stamp;
    const score = int(this.player.experience);
    return `survival_${stamp}_score${score}`;
  }

  private _tryOpenPerkMenu(): void {
    this._openPerkMenuUi({
      menu: this._perkMenu,
      players: this.simWorld.players,
      gameMode: GameMode.SURVIVAL,
      playerCount: Math.max(1, this.simWorld.players.length),
    });
  }

  private _resetPerkPrompt(): void {
    this._perkPrompt.resetIfPending({ pendingCount: this.state.perkSelection.pendingCount });
  }

  private _updatePerkUi(opts: {
    dtUiMs: number;
    allowInput?: boolean;
    allowPulse?: boolean;
  }): void {
    const dtUiMs = opts.dtUiMs;
    const allowInput = opts.allowInput ?? true;
    const allowPulse = opts.allowPulse ?? true;
    const pendingCount = int(this.state.perkSelection.pendingCount);
    const anyAlive = this._anyPlayerAlive();
    const choices = perkSelectionPreparedChoices(
      this.simWorld.players,
      this.state.perkSelection,
    );

    this._perkPrompt.beginFrame();
    if (this._perkMenu.open && allowInput) {
      const choiceIndex = this._handlePerkMenuInput(choices, dtUiMs);
      if (choiceIndex !== null) {
        this.recordPerkPickCommand(choiceIndex, { playerIndex: 0 });
      }
    }

    if (allowInput && this._pollPerkOpenRequest({
      pendingCount,
      playerCount: Math.max(1, this.simWorld.players.length),
      anyAlive,
      paused: this._paused,
      menuActive: this._perkMenu.active,
    })) {
      this._tryOpenPerkMenu();
    }

    this._tickPerkPromptTimer({
      pendingCount,
      anyAlive,
      paused: this._paused,
      menuActive: this._perkMenu.active,
      dtUiMs,
    });
    if (allowPulse) {
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

  protected _drawPerkPrompt(opts: {
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

  private _wrapUiText(text: string, opts: { maxWidth: number; scale?: number }): string[] {
    const maxWidth = opts.maxWidth;
    const scale = opts.scale ?? UI_TEXT_SCALE;
    const lines: string[] = [];
    const rawLines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)
      ?.map((line) => line.replace(/\r\n|\r|\n$/, ''))
      .filter((line, index, array) => !(index === array.length - 1 && line === '')) ?? [];
    if (rawLines.length === 0) rawLines.push('');
    for (const raw of rawLines) {
      const para = raw.trim();
      if (!para) {
        lines.push('');
        continue;
      }
      let current = '';
      for (const word of para.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
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
    const simUnlockIndex = status != null ? (status.questUnlockIndex ?? 0) : 0;
    const questUnlockIndex = int(simUnlockIndex);

    const terrain = advanceUnlockTerrain(
      this.state.rng,
      { unlockIndex: questUnlockIndex, width: int(this.worldSize), height: int(this.worldSize) },
    );
    this.applyTerrainSetup({ terrainSlots: terrain.terrainSlots, seed: terrain.terrainSeed });
    this.simWorld.state.rng.srand(int(this.state.rng.state));

    this._simSession = this._newSimSession();
    this._hudFadeMs = PERK_MENU_TRANSITION_MS;
    this._replayRecorder = null;
    this._replayCheckpoints.length = 0;
    this._replayCheckpointsLastTick = null;
  }

  close(): void {
    this._simSession = null;
    this._lanLastTickIndex = -1;
    super.close();
  }

  protected _handleInput(): void {
    if (this._gameOverActive) {
      if (InputState.wasKeyPressed(KEY_ESCAPE)) {
        this._action = 'back_to_menu';
        this.closeRequested = true;
      }
      return;
    }

    if (this._perkMenu.open && InputState.wasKeyPressed(KEY_ESCAPE)) {
      if (this._lanEnabled && this._lanRole === 'join') {
        return;
      }
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
      if (InputState.wasKeyPressed(KEY_X)) {
        this.player.experience += 5000;
        survivalCheckLevelUp(this.player, this.state.perkSelection);
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

  protected _enterGameOver(): void {
    if (this._gameOverActive) return;

    const gameModeId = this.config.gameplay.mode;
    const record = buildHighscoreRecordForGameOver({
      state: this.state,
      player: this.player,
      survivalElapsedMs: int(this._sessionElapsedMs()),
      creatureKillCount: int(this.creatures.killCount),
      gameModeId,
    });

    this._gameOverRecord = record;
    this._gameOverUi.open();
    this._gameOverActive = true;
    this._perkMenu.close();
    this._saveReplay();
  }

  protected _lanModeName(): 'survival' | 'rush' | 'quests' {
    return 'survival';
  }

  protected _lanMatchSession(): DeterministicSession | null {
    return this._simSession;
  }

  protected _lanOnPaused(dt: number): void {
    if (this._deathTransitionReady()) {
      this._enterGameOver();
    }
  }

  protected _lanPrepareFrame(
    role: string,
    dtUiMs: number,
    session: LanSession,
    _dtTick: number,
  ): boolean {
    session.detailPreset = int(this._deterministicDetailPreset());
    session.violenceDisabled = int(this._deterministicViolenceDisabled());
    this._updatePerkUi({
      dtUiMs,
      allowInput: role === 'host',
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

  protected _lanOnTickApplied(
    tick: DeterministicSessionTick,
    frameTick: number | null,
    _dtTick: number,
  ): LanStepAction {
    const sessionElapsedMs = this._sessionElapsedMs();
    const sessionStage = int(this._spawnState.stage);
    const sessionSpawnCooldownMs = this._spawnState.spawnCooldownMs;

    if (frameTick !== null) {
      this._lanLastTickIndex = int(frameTick);
      this._storeNetRuntimeSnapshot({
        tickIndex: int(frameTick),
        elapsedMs: sessionElapsedMs,
        stage: sessionStage,
        spawnCooldownMs: sessionSpawnCooldownMs,
        perkPendingCount: int(this.state.perkSelection.pendingCount),
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

  protected _applyResyncSnapshot(snapshot: {
    elapsedMs?: number;
    stage?: number;
    spawnCooldownMs?: number;
  } | null): void {
    const rs = snapshot;
    if (
      rs === null ||
      rs.elapsedMs === undefined ||
      rs.stage === undefined ||
      rs.spawnCooldownMs === undefined
    ) {
      return;
    }
    if (this._simSession !== null) {
      this._simSession.elapsedMs = rs.elapsedMs;
    }
    this._spawnState.stage = int(rs.stage);
    this._spawnState.spawnCooldownMs = rs.spawnCooldownMs;
  }

  update(dt: number): void {
    const frame = this._beginModeUpdate(dt);
    if (frame === null) return;

    this._cursorTime += frame.dt;

    if (this._gameOverActive) {
      this._updateGameOverUi(frame.dt);
      return;
    }

    if (this._lanEnabled && this._lanRuntime !== null) {
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
    if (session === null) return;

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

  private _drawGameCursor(): void {
    const resources = this.renderResources.resources;
    const mousePos = this._uiMouse;
    drawMenuCursor(
      getTexture(resources, TextureId.PARTICLES),
      getTexture(resources, TextureId.UI_CURSOR),
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
      hudBottom = drawHudOverlay(new HudRenderContext({
        resources: this.renderResources.resources,
        state: this._hudState,
        font: this._small,
        alpha: hudAlpha,
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
        elapsedMs: this._sessionElapsedMs(),
        score: this.player.experience,
        frameDtMs: this._lastDtMs,
      });
    }

    if (this._debugEnabled && !this._gameOverActive && !perkMenuActive) {
      // Minimal debug text.
      const x = 18.0;
      const y = Math.max(18.0, hudBottom + 10.0);
      const line = this._uiLineHeight();
      const elapsedMs = this._sessionElapsedMs();

      this._drawUiText(
        `survival: t=${(elapsedMs / 1000.0).toFixed(1).padStart(6, ' ')}s  stage=${int(this._spawnState.stage)}`,
        new Vec2(x, y),
        UI_TEXT_COLOR,
      );
      this._drawUiText(
        `xp=${this.player.experience}  level=${this.player.level}  kills=${this.creatures.killCount}`,
        new Vec2(x, y + line),
        UI_HINT_COLOR,
      );
      const god = this.state.debugGodMode ? 'on' : 'off';
      this._drawUiText(
        `debug: [/] weapon  F3 perk+1  F2 god=${god}  X xp+5000`,
        new Vec2(x, y + line * 2.0),
        UI_HINT_COLOR,
        0.9,
      );
      let yExtra = y + line * 3.0;
      if (this._paused) {
        this._drawUiText('paused (TAB)', new Vec2(x, yExtra), UI_HINT_COLOR);
        yExtra += line;
      }
      if (this.player.health <= 0.0) {
        this._drawUiText('game over', new Vec2(x, yExtra), UI_ERROR_COLOR);
        yExtra += line;
      }
      this._drawLanDebugInfo({ x, y: yExtra, lineH: line });
    }

    if (!this._gameOverActive) {
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
