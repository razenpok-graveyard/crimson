// Port of crimson/modes/tutorial_mode.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { type AudioState } from '@grim/audio.ts';
import { type CrimsonConfig } from '@grim/config.ts';
import { type ConsoleState } from '@grim/console.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { clamp } from '@grim/math.ts';
import { Crand } from '@grim/rand.ts';
import * as wgl from '@wgl';
import { GameMode } from '@crimson/game-modes.ts';
import { inputCodeIsDown, inputCodeIsPressed } from '@crimson/input-codes.ts';
import { perkSelectionPreparedChoices } from '@crimson/perks/selection.ts';
import { advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import { buildTutorialSession } from '@crimson/sim/session-builders.ts';
import { DeterministicSession, type DeterministicSessionTick } from '@crimson/sim/sessions.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { drawHudOverlay, HudRenderContext, hudFlagsForGameMode } from '@crimson/ui/hud.ts';
import { TUTORIAL_PANEL_POS, tutorialPromptPanelRect, drawTutorialOverlayPanels } from '@crimson/ui/overlays/tutorial-run.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { BaseGameplayMode } from './base-gameplay-mode.ts';
import { PerkMenuController } from './components/perk-menu-controller.ts';

const WORLD_SIZE = 1024.0;

const UI_HINT_COLOR = wgl.makeColor(140 / 255, 140 / 255, 140 / 255, 1.0);

const KEY_ESCAPE = 27;
const KEY_TAB = 9;
const MOUSE_BUTTON_LEFT = 0;

export class TutorialMode extends BaseGameplayMode {
  private _perkMenu = new PerkMenuController();

  private _skipButton: UiButtonState;
  private _playButton: UiButtonState;
  private _repeatButton: UiButtonState;
  private _perkPickPending = false;
  private _frameInputState: PlayerInput | null = null;

  constructor(opts: {
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
      worldSize: WORLD_SIZE,
      defaultGameModeId: GameMode.TUTORIAL,
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
    this._skipButton = new UiButtonState({ label: 'Skip tutorial', forceWide: true });
    this._playButton = new UiButtonState({ label: 'Play a game', forceWide: true });
    this._repeatButton = new UiButtonState({ label: 'Repeat tutorial', forceWide: true });
  }

  private _newSimSession(): DeterministicSession {
    return buildTutorialSession({
      world: this.simWorld.worldState,
      worldSize: this.worldSize,
      damageScaleByType: this.simWorld.damageScaleByType,
      detailPreset: int(this._deterministicDetailPreset()),
      violenceDisabled: int(this._deterministicViolenceDisabled()),
      gameTuneStarted: this.simWorld.gameTuneStarted,
      demoModeActive: this.demoModeActive,
    });
  }

  protected _runtimePlayerCount(): number {
    return 1;
  }

  protected _replayClaimedStatsComplete(): boolean {
    return int(this.state.tutorial.stageIndex) >= 8;
  }

  protected _replayClaimedStatsElapsedMs(): number {
    const session = this._simSession;
    if (session === null) return 0;
    return int(session.elapsedMs);
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: object }): string {
    return `tutorial_${opts.stamp}`;
  }

  open(): void {
    super.open();
    this._perkMenu.reset();

    this._skipButton = new UiButtonState({ label: 'Skip tutorial', forceWide: true });
    this._playButton = new UiButtonState({ label: 'Play a game', forceWide: true });
    this._repeatButton = new UiButtonState({ label: 'Repeat tutorial', forceWide: true });

    this._perkPickPending = false;
    this._frameInputState = null;

    this.state.perkSelection.pendingCount = 0;
    this.state.perkSelection.choices.length = 0;
    this.state.perkSelection.choicesDirty = true;

    const status = this.state.status;
    const questUnlockIndex = status !== null ? int(status.questUnlockIndex) : 0;

    const terrain = advanceUnlockTerrain(
      this.state.rng,
      { unlockIndex: questUnlockIndex, width: int(this.worldSize), height: int(this.worldSize) },
    );
    this.applyTerrainSetup({ terrainSlots: terrain.terrainSlots, seed: terrain.terrainSeed });
    this.simWorld.state.rng.srand(int(this.state.rng.state));

    this.player.pos = new Vec2(this.worldSize * 0.5, this.worldSize * 0.5);
    weaponAssignPlayer(this.player, WeaponId.PISTOL, { state: this.state });
    this._simSession = this._newSimSession();
    this._replayRecorder = null;
    this._replayCheckpointsSampleRate = 1;
    this._replayCheckpoints.length = 0;
    this._replayCheckpointsLastTick = null;
  }

  close(): void {
    this._simSession = null;
    this._replayRecorder = null;
    this._frameInputState = null;
    super.close();
  }

  private _openPerkMenu(): void {
    this._openPerkMenuUi({
      menu: this._perkMenu,
      players: [this.player],
      gameMode: GameMode.TUTORIAL,
      playerCount: 1,
    });
  }

  private _buildInput(): PlayerInput {
    const playerControls = this.config.controls.player(0);
    const [fwd, bwd, left, right] = playerControls.moveCodes;
    const fireKey = playerControls.fireCode;

    const move = new Vec2(
      (inputCodeIsDown(right) ? 1.0 : 0.0) - (inputCodeIsDown(left) ? 1.0 : 0.0),
      (inputCodeIsDown(bwd) ? 1.0 : 0.0) - (inputCodeIsDown(fwd) ? 1.0 : 0.0),
    );

    const mouse = this._uiMousePos();
    const aim = this.screenToWorld(mouse);

    const fireDown = inputCodeIsDown(fireKey);
    const firePressed = inputCodeIsPressed(fireKey);
    const reloadKey = this.config.controls.reloadCode;
    const reloadPressed = inputCodeIsPressed(reloadKey);

    return new PlayerInput({
      move,
      aim,
      fireDown,
      firePressed,
      reloadPressed,
    });
  }

  protected _buildLocalInputs(_opts: { dt: number }): PlayerInput[] {
    const frameInputState = this._frameInputState;
    if (frameInputState !== null) {
      return [frameInputState];
    }
    return [this._buildInput()];
  }

  protected _handleInput(): void {
    if (this._perkMenu.open && InputState.wasKeyPressed(KEY_ESCAPE)) {
      this._perkMenu.close();
      return;
    }

    if (InputState.wasKeyPressed(KEY_TAB)) {
      this._paused = !this._paused;
    }

    if (InputState.wasKeyPressed(KEY_ESCAPE)) {
      this._action = 'open_pause_menu';
      return;
    }
  }

  private _finishTutorialRun(opts: { restart: boolean }): void {
    this._saveReplay();
    if (opts.restart) {
      this.open();
      return;
    }
    this.closeRequested = true;
  }

  private _updatePromptButtons(opts: { dtMs: number; mouse: Vec2; click: boolean }): void {
    const { dtMs, mouse, click } = opts;
    const tutorial = this.state.tutorial;
    const overlay = this.state.tutorialOverlay;
    const stage = int(tutorial.stageIndex);
    const promptAlpha = overlay.promptAlpha;

    if (stage === 8) {
      this._playButton.alpha = promptAlpha;
      this._repeatButton.alpha = promptAlpha;
      this._playButton.enabled = promptAlpha > 1e-3;
      this._repeatButton.enabled = promptAlpha > 1e-3;
    } else {
      const stageTimerMs = tutorial.stageTimerMs ?? 0;
      const skipAlpha = clamp((stageTimerMs - 1000) * 0.001, 0.0, 1.0);
      this._skipButton.alpha = skipAlpha;
      this._skipButton.enabled = skipAlpha > 1e-3;
    }

    const resources = this.renderResources.resources;

    if (stage === 8) {
      const [rect] = tutorialPromptPanelRect(
        overlay.promptText,
        {
          measureTextWidth: (text: string, scale: number) => this._uiTextWidth(text, scale),
          measureLineHeight: (scale: number) => this._uiLineHeight(scale),
          pos: TUTORIAL_PANEL_POS,
          scale: 1.0,
        },
      );
      const gap = 18.0;
      const buttonBasePos = new Vec2(rect.x + 10.0, rect.y + rect.h + 10.0);
      const playW = buttonWidth(resources, this._playButton.label, { scale: 1.0, forceWide: true });
      const repeatW = buttonWidth(resources, this._repeatButton.label, { scale: 1.0, forceWide: true });

      if (buttonUpdate(this._playButton, { pos: buttonBasePos, width: playW, dtMs, mouse, click })) {
        this._finishTutorialRun({ restart: false });
        return;
      }
      if (buttonUpdate(
        this._repeatButton,
        { pos: buttonBasePos.offset({ dx: playW + gap, dy: 0.0 }), width: repeatW, dtMs, mouse, click },
      )) {
        this._finishTutorialRun({ restart: true });
        return;
      }
      return;
    }

    if (this._skipButton.enabled) {
      const screenH = wgl.getScreenHeight();
      const y = screenH - 50.0;
      const w = buttonWidth(resources, this._skipButton.label, { scale: 1.0, forceWide: true });
      if (buttonUpdate(this._skipButton, { pos: new Vec2(10.0, y), width: w, dtMs, mouse, click })) {
        this._finishTutorialRun({ restart: false });
      }
    }
  }

  update(dt: number): void {
    this._updateAudio(dt);
    const [frameDt, dtUiMs] = this._tickFrame(dt, { clampCursorPulse: true });

    this._handleInput();
    if (this._action === 'open_pause_menu') return;
    if (this.closeRequested) return;

    const perkPending = this.state.perkSelection.pendingCount > 0 && this.player.health > 0.0;
    const choices = perkSelectionPreparedChoices(
      this.simWorld.players,
      this.state.perkSelection,
    );
    const stageIndex = int(this.state.tutorial.stageIndex);

    if (stageIndex === 6 && perkPending && !this._perkMenu.active && !this._perkPickPending) {
      this._openPerkMenu();
    }
    if (this._perkMenu.open) {
      const choiceIndex = this._perkMenu.handleInput(
        this._perkMenuUiContext(),
        choices,
        { dtUiMs },
      );
      if (choiceIndex !== null) {
        this._perkPickPending = true;
        this.recordPerkPickCommand(choiceIndex, { playerIndex: 0 });
      }
    }
    this._perkMenu.tickTimeline(dtUiMs);

    const perkMenuActive = this._perkMenu.active;
    const dtWorld = (this._paused || perkMenuActive) ? 0.0 : frameDt;

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
            session,
            recorder: this._replayRecorder,
            onTick: (_tick: DeterministicSessionTick, _tickIndex: number | null) => false,
            onCheckpoint: (tickIndex: number, tick: DeterministicSessionTick) => {
              this._recordReplayCheckpointFromTick({ tickIndex, tick });
            },
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
    const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);
    this._updatePromptButtons({ dtMs: dtUiMs, mouse, click });
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
        elapsedMs: this._simSession !== null ? this._sessionElapsedMs() : 0.0,
        score: int(this.player.experience),
        frameDtMs: this._lastDtMs,
      });
    }

    this._drawTutorialPrompts({ hudBottom });

    if (perkMenuActive) {
      this._perkMenu.draw(
        this._perkMenuUiContext(),
        perkSelectionPreparedChoices(this.simWorld.players, this.state.perkSelection),
      );
      this._drawMenuCursor();
    }
  }

  private _drawTutorialPrompts(opts: { hudBottom: number }): void {
    const hudBottom = opts.hudBottom;
    const overlay = this.state.tutorialOverlay;

    drawTutorialOverlayPanels(
      overlay,
      {
        drawText: (text: string, pos: Vec2, color: wgl.Color, scale: number) =>
          this._drawUiText(text, pos, color, scale),
        measureTextWidth: (text: string, scale: number) => this._uiTextWidth(text, scale),
        measureLineHeight: (scale: number) => this._uiLineHeight(scale),
      },
    );

    const resources = this.renderResources.resources;
    const tutorial = this.state.tutorial;
    const stage = int(tutorial.stageIndex);

    if (stage === 8) {
      const [rect] = tutorialPromptPanelRect(
        overlay.promptText,
        {
          measureTextWidth: (text: string, scale: number) => this._uiTextWidth(text, scale),
          measureLineHeight: (scale: number) => this._uiLineHeight(scale),
          pos: TUTORIAL_PANEL_POS,
          scale: 1.0,
        },
      );
      const gap = 18.0;
      const buttonBasePos = new Vec2(rect.x + 10.0, rect.y + rect.h + 10.0);
      const playW = buttonWidth(resources, this._playButton.label, { scale: 1.0, forceWide: true });
      const repeatW = buttonWidth(resources, this._repeatButton.label, { scale: 1.0, forceWide: true });

      buttonDraw(resources, this._playButton, { pos: buttonBasePos, width: playW, scale: 1.0 });
      buttonDraw(
        resources,
        this._repeatButton,
        { pos: buttonBasePos.offset({ dx: playW + gap, dy: 0.0 }), width: repeatW, scale: 1.0 },
      );
      return;
    }

    if (this._skipButton.alpha > 1e-3) {
      const screenH = wgl.getScreenHeight();
      const y = screenH - 50.0;
      const w = buttonWidth(resources, this._skipButton.label, { scale: 1.0, forceWide: true });
      buttonDraw(resources, this._skipButton, { pos: new Vec2(10.0, y), width: w, scale: 1.0 });
    }

    if (this._paused) {
      const x = 18.0;
      const y = Math.max(18.0, hudBottom + 10.0);
      this._drawUiText('paused (TAB)', new Vec2(x, y), UI_HINT_COLOR);
    }
  }

  private _drawMenuCursor(): void {
    const resources = this.renderResources.resources;
    const mousePos = this._uiMouse;
    drawMenuCursor(
      getTexture(resources, TextureId.PARTICLES),
      getTexture(resources, TextureId.UI_CURSOR),
      { pos: mousePos, pulseTime: this._cursorPulseTime },
    );
  }
}
