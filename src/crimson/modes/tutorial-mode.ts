// Port of crimson/modes/tutorial_mode.py

import { TextureId } from '@grim/assets.ts';
import type { AudioState } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import type { Crand } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import type { ViewContext } from '@grim/view.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { inputCodeIsDown, inputCodeIsPressed } from '@crimson/input-codes.ts';
import { perkSelectionPreparedChoices } from '@crimson/perks/selection.ts';
import { GameStatusData } from '@crimson/persistence/save-status.ts';
import { ReplayHeader, ReplayRecorder } from '@crimson/replay/index.ts';
import { DEFAULT_CHECKPOINT_SAMPLE_RATE } from '@crimson/replay/checkpoints.ts';
import { advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import { buildTutorialSession } from '@crimson/sim/session-builders.ts';
import type { DeterministicSession } from '@crimson/sim/sessions.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { HudRenderContext, drawHudOverlay, hudFlagsForGameMode } from '@crimson/ui/hud.ts';
import { TUTORIAL_PANEL_POS, drawTutorialOverlayPanels, tutorialPromptPanelRect } from '@crimson/ui/overlays/tutorial-run.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { BaseGameplayMode } from '@crimson/modes/base-gameplay-mode.ts';
import { PerkMenuController } from '@crimson/modes/components/perk-menu-controller.ts';
import * as wgl from '@wgl';

export const UI_HINT_COLOR = wgl.makeColor(140 / 255, 140 / 255, 140 / 255, 255 / 255);

export class TutorialMode extends BaseGameplayMode {
  protected _perkMenu: PerkMenuController;
  protected _skipButton: UiButtonState;
  protected _playButton: UiButtonState;
  protected _repeatButton: UiButtonState;
  protected _frameInputState: PlayerInput | null;
  protected _perkPickPending: boolean;

  get perkMenu(): PerkMenuController {
    return this._perkMenu;
  }
  get skipButton(): UiButtonState {
    return this._skipButton;
  }
  get playButton(): UiButtonState {
    return this._playButton;
  }
  get repeatButton(): UiButtonState {
    return this._repeatButton;
  }
  get frameInputState(): PlayerInput | null {
    return this._frameInputState;
  }
  get perkPickPending(): boolean {
    return this._perkPickPending;
  }

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
    super({ assetsUrl: ctx.assetsDir, preserveBugs: ctx.preserveBugs, worldSize: 1024.0, defaultGameModeId: GameMode.TUTORIAL, demoModeActive: demoModeActive, questFailRetryCount: 0, hardcore: false, config: config, console: console, audio: audio, audioRng: audioRng });
    this._perkMenu = new PerkMenuController();

    this._skipButton = new UiButtonState({ label: 'Skip tutorial', forceWide: true });
    this._playButton = new UiButtonState({ label: 'Play a game', forceWide: true });
    this._repeatButton = new UiButtonState({ label: 'Repeat tutorial', forceWide: true });
    this._simSession = null;
    this._replayRecorder = null;
    this._frameInputState = null;
    this._perkPickPending = false;
  }

  protected _newSimSession(): DeterministicSession {
    return buildTutorialSession({ world: this.simWorld.worldState, worldSize: this.worldSize, damageScaleByType: this.simWorld.damageScaleByType, detailPreset: int(this._deterministicDetailPreset()), violenceDisabled: int(this._deterministicViolenceDisabled()), gameTuneStarted: Boolean(this.simWorld.gameTuneStarted), demoModeActive: Boolean(this.demoModeActive) });
  }

  protected _runtimePlayerCount(): number {
    return 1;
  }

  open(): void {
    super.open();
    this._perkMenu.reset();

    this._skipButton = new UiButtonState({ label: 'Skip tutorial', forceWide: true });
    this._playButton = new UiButtonState({ label: 'Play a game', forceWide: true });
    this._repeatButton = new UiButtonState({ label: 'Repeat tutorial', forceWide: true });

    this._frameInputState = null;
    this._perkPickPending = false;

    this.state.perkSelection.pendingCount = 0;
    ((target: unknown) => {
      if (target !== null && typeof target === 'object' && typeof (target as { clear?: unknown }).clear === 'function') {
        (target as { clear: () => void }).clear();
      } else if (target !== null && typeof target === 'object' && 'length' in target) {
        (target as { length: number }).length = 0;
      }
    })(this.state.perkSelection.choices);
    this.state.perkSelection.choicesDirty = true;

    const status = this.state.status;
    const terrain = advanceUnlockTerrain(this.state.rng, { unlockIndex: status === null ? 0 : int(status.questUnlockIndex), width: int(this.worldSize), height: int(this.worldSize) });
    this.applyTerrainSetup({
      terrainSlots: terrain.terrainSlots,
      seed: int(terrain.terrainSeed),
    });
    this.simWorld.state.rng.srand(int(this.state.rng.state));

    this.player.pos = new Vec2(this.worldSize * 0.5, this.worldSize * 0.5);
    weaponAssignPlayer(this.player, WeaponId.PISTOL, { state: this.state });
    this._simSession = this._newSimSession();
    this._replayRecorder = new ReplayRecorder(new ReplayHeader({ gameModeId: GameMode.TUTORIAL, seed: int(this._runResetSeed), tickRate: int(this._gameplayTickRate()), questFailRetryCount: int(this.questFailRetryCount), hardcore: Boolean(this.hardcore), preserveBugs: Boolean(this.state.preserveBugs), detailPreset: int(this._deterministicDetailPreset()), violenceDisabled: int(this._deterministicViolenceDisabled()), worldSize: this.worldSize, playerCount: 1, status: status === null ? new GameStatusData() : status.asData() }));
    this._replayCheckpointsSampleRate = int(DEFAULT_CHECKPOINT_SAMPLE_RATE);
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
    this._replayRecorder = null;
    this._frameInputState = null;
    super.close();
  }

  protected _replayClaimedStatsComplete(): boolean {
    return int(this.state.tutorial.stageIndex) >= 8;
  }

  protected _replayClaimedStatsElapsedMs(): number {
    const session = this._simSession;
    if (session === null) {
      return 0;
    }
    return int(session.elapsedMs);
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: any }): string {
    const stamp = opts.stamp;
    const replay = opts.replay;
    const _ = replay;
    return `tutorial_${stamp}`;
  }

  protected _openPerkMenu(): void {
    this._openPerkMenuUi({
      menu: this._perkMenu,
      players: [this.player],
      gameMode: GameMode.TUTORIAL,
      playerCount: 1,
    });
  }

  protected _handleInput(): void {
    if (this._perkMenu.open && InputState.wasKeyPressed(27)) {
      this._perkMenu.close();
      return;
    }

    if (InputState.wasKeyPressed(9)) {
      this._paused = !this._paused;
    }

    if (InputState.wasKeyPressed(27)) {
      this._action = 'open_pause_menu';
      return;
    }
  }

  protected _buildInput(): PlayerInput {
    const controls = this.config.controls.player(0);
    const [moveForwardKey, moveBackwardKey, turnLeftKey, turnRightKey] = controls.moveCodes;
    const fireKey = controls.fireCode;

    const move = new Vec2(Number(inputCodeIsDown(turnRightKey)) - Number(inputCodeIsDown(turnLeftKey)), Number(inputCodeIsDown(moveBackwardKey)) - Number(inputCodeIsDown(moveForwardKey)));

    const mouse = this._uiMousePos();
    const aim = this.screenToWorld(Vec2.fromXY(mouse));

    const fireDown = inputCodeIsDown(fireKey);
    const firePressed = inputCodeIsPressed(fireKey);
    const reloadKey = this.config.controls.reloadCode;
    const reloadPressed = inputCodeIsPressed(reloadKey);

    return new PlayerInput({ move: move, aim: aim, fireDown: Boolean(fireDown), firePressed: Boolean(firePressed), reloadPressed: Boolean(reloadPressed) });
  }

  protected _buildLocalInputs(opts: { dt: number }): PlayerInput[] {
    const dt = opts.dt;
    const _ = dt;
    let frameInputState = this._frameInputState;
    if (frameInputState === null) {
      frameInputState = this._buildInput();
    }
    return [frameInputState];
  }

  protected _finishTutorialRun(opts: { restart: boolean }): void {
    const restart = opts.restart;
    this._saveReplay();
    if (restart) {
      this.open();
      return;
    }
    this.closeRequested = true;
  }

  protected _updatePromptButtons(opts: { dtMs: number; mouse: wgl.Vector2; click: boolean }): void {
    const dtMs = opts.dtMs;
    const mouse = opts.mouse;
    const click = opts.click;
    const tutorial = this.state.tutorial;
    const overlay = this.state.tutorialOverlay;
    const font = this._small;
    if (!(font !== null)) throw new Error('tutorial buttons require loaded small font');
    const stage = int(tutorial.stageIndex);
    const promptAlpha = overlay.promptAlpha;
    if (stage === 8) {
      this._playButton.alpha = promptAlpha;
      this._repeatButton.alpha = promptAlpha;
      this._playButton.enabled = promptAlpha > 1e-3;
      this._repeatButton.enabled = promptAlpha > 1e-3;
    } else {
      const skipAlpha = clamp((tutorial.stageTimerMs - 1000) * 0.001, 0.0, 1.0);
      this._skipButton.alpha = skipAlpha;
      this._skipButton.enabled = skipAlpha > 1e-3;
    }

    let resources: typeof this.renderResources.resources;
    if (stage === 8) {
      resources = this.renderResources.resources;
      const [rect, lines, lineH] = tutorialPromptPanelRect(overlay.promptText, { measureTextWidth: (text, scale) => this._uiTextWidth(text, scale), measureLineHeight: this._uiLineHeight.bind(this), pos: TUTORIAL_PANEL_POS, scale: 1.0 });
      const gap = 18.0;
      const buttonBasePos = new Vec2(rect.x + 10.0, rect.y + rect.h + 10.0);
      const playW = buttonWidth(resources, this._playButton.label, { scale: 1.0, forceWide: true });
      const repeatW = buttonWidth(resources, this._repeatButton.label, { scale: 1.0, forceWide: true });
      if (buttonUpdate(this._playButton, { pos: buttonBasePos, width: playW, dtMs: dtMs, mouse: mouse, click: click })) {
        this._finishTutorialRun({ restart: false });
        return;
      }
      if (buttonUpdate(this._repeatButton, { pos: buttonBasePos.offset({ dx: playW + gap }), width: repeatW, dtMs: dtMs, mouse: mouse, click: click })) {
        this._finishTutorialRun({ restart: true });
        return;
      }
      return;
    }

    if (this._skipButton.enabled) {
      resources = this.renderResources.resources;
      const y = wgl.getScreenHeight() - 50.0;
      const w = buttonWidth(resources, this._skipButton.label, { scale: 1.0, forceWide: true });
      if (buttonUpdate(this._skipButton, { pos: new Vec2(10.0, y), width: w, dtMs: dtMs, mouse: mouse, click: click })) {
        this._finishTutorialRun({ restart: false });
      }
    }
  }

  update(dt: number): void {
    this._updateAudio(dt);
    let dtUiMs: any;
    [dt, dtUiMs] = this._tickFrame(dt, { clampCursorPulse: true });

    this._handleInput();
    if (this._action === 'open_pause_menu') {
      return;
    }
    if (this.closeRequested) {
      return;
    }

    const perkPending = int(this.state.perkSelection.pendingCount) > 0 && this.player.health > 0.0;
    const choices = perkSelectionPreparedChoices(this.simWorld.players, this.state.perkSelection);
    if (int(this.state.tutorial.stageIndex) === 6 && perkPending && !this._perkMenu.active && !this._perkPickPending) {
      this._openPerkMenu();
    }
    if (this._perkMenu.open) {
      const choiceIndex = this._perkMenu.handleInput(this._perkMenuUiContext(), choices, { dtUiMs: dtUiMs });
      if (choiceIndex !== null) {
        this._perkPickPending = true;
        this.recordPerkPickCommand(int(choiceIndex), { playerIndex: 0 });
      }
    }
    this._perkMenu.tickTimeline(dtUiMs);

    const perkMenuActive = this._perkMenu.active;

    const dtWorld = this._paused || perkMenuActive ? 0.0 : dt;

    const inputState = this._buildInput();
    if (dtWorld > 0.0) {
      const session = this._simSession;
      if (session !== null) {
        const elapsedBeforeMs = session.elapsedMs;
        session.detailPreset = int(this._deterministicDetailPreset());
        session.violenceDisabled = int(this._deterministicViolenceDisabled());
        this._frameInputState = inputState;
        try {
          this._runDeterministicSessionTicks({
            dtFrame: dtWorld,
            session: session,
            recorder: this._replayRecorder,
            onTick: (tick, tickIndex) => false,
            onCheckpoint: (tickIndex, tick) => this._recordReplayCheckpointFromTick({ tickIndex: int(tickIndex), tick: tick }),
          });
        } finally {
          this._frameInputState = null;
        }
        if (session.elapsedMs !== elapsedBeforeMs) {
          this._perkPickPending = false;
        }
      }
    }

    const mouse = this._uiMousePos();
    const click = InputState.wasMouseButtonPressed(0);
    this._updatePromptButtons({ dtMs: dtUiMs, mouse: mouse, click: click });
  }

  draw(): void {
    const perkMenuActive = this._perkMenu.active;
    this._drawWorld({
      drawAimIndicators: !perkMenuActive,
      entityAlpha: this._worldEntityAlpha(),
    });
    this._drawScreenFade();

    let hudBottom = 0.0;
    if (!perkMenuActive) {
      const hudFlags = hudFlagsForGameMode(this._configGameModeId());
      this._drawTargetHealthBar();
      hudBottom = drawHudOverlay(new HudRenderContext({ resources: this.renderResources.resources, state: this._hudState, font: this._small, alpha: 1.0, showHealth: hudFlags.showHealth, showWeapon: hudFlags.showWeapon, showXp: hudFlags.showXp, showTime: hudFlags.showTime, showQuestHud: hudFlags.showQuestHud, smallIndicators: this._hudSmallIndicators() }), { player: this.player, players: this.simWorld.players, bonusHud: this.state.bonusHud, elapsedMs: this._simSession !== null ? this._sessionElapsedMs() : 0.0, score: int(this.player.experience), frameDtMs: this._lastDtMs });
    }

    this._drawTutorialPrompts({ hudBottom: hudBottom });

    if (perkMenuActive) {
      this._perkMenu.draw(this._perkMenuUiContext(), perkSelectionPreparedChoices(this.simWorld.players, this.state.perkSelection));
      this._drawMenuCursor();
    }
  }

  protected _drawTutorialPrompts(opts: { hudBottom: number }): void {
    const hudBottom = opts.hudBottom;
    const overlay = this.state.tutorialOverlay;
    drawTutorialOverlayPanels(
      overlay,
      { drawText: (text, pos, color, scale) => this._drawUiText(text, pos, color, scale), measureTextWidth: (text, scale) => this._uiTextWidth(text, scale), measureLineHeight: this._uiLineHeight.bind(this) },
    );
    const resources = this.renderResources.resources;
    const font = this._small;
    if (!(font !== null)) throw new Error('tutorial prompts require loaded small font');

    const stage = int(this.state.tutorial.stageIndex);
    if (stage === 8) {
      const [rect, lines, lineH] = tutorialPromptPanelRect(overlay.promptText, { measureTextWidth: (text, scale) => this._uiTextWidth(text, scale), measureLineHeight: this._uiLineHeight.bind(this), pos: TUTORIAL_PANEL_POS, scale: 1.0 });
      const gap = 18.0;
      const buttonBasePos = new Vec2(rect.x + 10.0, rect.y + rect.h + 10.0);
      const playW = buttonWidth(resources, this._playButton.label, { scale: 1.0, forceWide: true });
      const repeatW = buttonWidth(resources, this._repeatButton.label, { scale: 1.0, forceWide: true });
      buttonDraw(
        resources,
        this._playButton,
        { pos: buttonBasePos, width: playW, scale: 1.0 },
      );
      buttonDraw(
        resources,
        this._repeatButton,
        { pos: buttonBasePos.offset({ dx: playW + gap }), width: repeatW, scale: 1.0 },
      );
      return;
    }

    let y: number;
    if (this._skipButton.alpha > 1e-3) {
      y = wgl.getScreenHeight() - 50.0;
      const w = buttonWidth(resources, this._skipButton.label, { scale: 1.0, forceWide: true });
      buttonDraw(resources, this._skipButton, { pos: new Vec2(10.0, y), width: w, scale: 1.0 });
    }

    if (this._paused) {
      const x = 18.0;
      y = Math.max(18.0, hudBottom + 10.0);
      this._drawUiText('paused (TAB)', new Vec2(x, y), UI_HINT_COLOR);
    }
  }

  protected _drawMenuCursor(): void {
    const resources = this.renderResources.resources;
    const mousePos = this._uiMouse;
    drawMenuCursor(
      resources.texture(TextureId.PARTICLES),
      resources.texture(TextureId.UI_CURSOR),
      { pos: mousePos, pulseTime: this._cursorPulseTime },
    );
  }
}
