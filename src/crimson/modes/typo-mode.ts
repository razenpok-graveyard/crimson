// Port of crimson/modes/typo_mode.py

import { TextureId, getTexture } from '@grim/assets.ts';
import { type AudioState } from '@grim/audio.ts';
import { type CrimsonConfig } from '@grim/config.ts';
import { type ConsoleState } from '@grim/console.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { Crand } from '@grim/rand.ts';
import * as wgl from '@wgl';
import { GameMode } from '@crimson/game-modes.ts';
import { advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import { TypoCharCommand, TypoBackspaceCommand, TypoSubmitCommand } from '@crimson/sim/input-providers.ts';
import { buildTypoSession } from '@crimson/sim/session-builders.ts';
import { DeterministicSession, type DeterministicSessionTick } from '@crimson/sim/sessions.ts';
import { buildTypoPlayerInput } from '@crimson/typo/player.ts';
import { typoShotCounts } from '@crimson/typo/state.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { drawHudOverlay, HudRenderContext, hudFlagsForGameMode } from '@crimson/ui/hud.ts';
import { drawTypingBox, drawTypoNameLabels } from '@crimson/ui/overlays/typo-run.ts';
import { BaseGameplayMode } from './base-gameplay-mode.ts';
import { buildHighscoreRecordForGameOver } from './components/highscore-record-builder.ts';

const WORLD_SIZE = 1024.0;
const KEY_ENTER = 13;
const KEY_KP_ENTER = 335;
const KEY_BACKSPACE = 8;
const KEY_TAB = 9;
const KEY_ESCAPE = 27;

export class TypoShooterMode extends BaseGameplayMode {
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
      defaultGameModeId: GameMode.TYPO,
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
    const typo = this.state.typo;
    return buildTypoSession({
      world: this.simWorld.worldState,
      worldSize: this.worldSize,
      damageScaleByType: this.simWorld.damageScaleByType,
      detailPreset: 5,
      violenceDisabled: 0,
      gameTuneStarted: this.simWorld.gameTuneStarted,
      dictionaryWords: typo.dictionaryWords,
      highscoreNames: typo.highscoreNames,
    });
  }

  protected _runtimePlayerCount(): number {
    return 1;
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

  protected _replayClaimedShots(): [number, number] {
    return typoShotCounts(this.state.typo);
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: object }): string {
    const stamp = opts.stamp;
    const score = int(this.player.experience);
    return `typo_${stamp}_score${score}`;
  }

  open(): void {
    super.open();

    // In the WebGL port, typo dictionary and highscore names are loaded
    // externally and set on state.typo before open() is called, or are
    // empty tuples if not available.  The native code loads from disk here;
    // we skip the file I/O and rely on the pre-populated state.

    const status = this.state.status;
    const questUnlockIndex = status !== null ? int(status.questUnlockIndex) : 0;

    const terrain = advanceUnlockTerrain(
      this.state.rng,
      { unlockIndex: questUnlockIndex, width: int(this.worldSize), height: int(this.worldSize) },
    );
    this.applyTerrainSetup({ terrainSlots: terrain.terrainSlots, seed: terrain.terrainSeed });
    this.simWorld.state.rng.srand(int(this.state.rng.state));

    this._simSession = this._newSimSession();
    this._replayRecorder = null; // WebGL: no file-based replay recording
  }

  close(): void {
    this._simSession = null;
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

    if (InputState.wasKeyPressed(KEY_TAB)) {
      this._paused = !this._paused;
    }

    if (InputState.wasKeyPressed(KEY_ESCAPE)) {
      this._action = 'open_pause_menu';
      return;
    }
  }

  private _enqueueTypingCommands(): void {
    const enterPressed = InputState.wasKeyPressed(KEY_ENTER) || InputState.wasKeyPressed(KEY_KP_ENTER);
    if (enterPressed && this.state.typo.typing.text) {
      this.enqueueInputCommand(new TypoSubmitCommand({ playerIndex: 0 }));
    }

    // Native processes at most one keychar per frame via `console_input_poll`.
    if (InputState.wasKeyPressed(KEY_BACKSPACE) || InputState.wasKeyPressedRepeat(KEY_BACKSPACE)) {
      this.enqueueInputCommand(new TypoBackspaceCommand({ playerIndex: 0 }));
    } else {
      const codepoint = InputState.getCharPressed();
      if (codepoint !== KEY_ENTER && codepoint !== KEY_BACKSPACE && codepoint >= 0x20 && codepoint <= 0xFF) {
        const ch = String.fromCharCode(codepoint);
        if (ch) {
          this.enqueueInputCommand(new TypoCharCommand({ playerIndex: 0, ch: ch[0] }));
        }
      }
    }
  }

  protected _enterGameOver(): void {
    if (this._gameOverActive) return;

    const [shotsFired, shotsHit] = typoShotCounts(this.state.typo);
    const record = buildHighscoreRecordForGameOver({
      state: this.state,
      player: this.player,
      survivalElapsedMs: int(this._sessionElapsedMs()),
      creatureKillCount: int(this.creatures.killCount),
      gameModeId: GameMode.TYPO,
      shotsFired,
      shotsHit,
      clampShotsHit: false,
    });

    this._gameOverRecord = record;
    this._gameOverUi.open();
    this._gameOverActive = true;
    this._saveReplay();
  }

  protected _buildLocalInputs(_opts: { dt: number }): PlayerInput[] {
    const aim = this.screenToWorld(this._uiMouse);
    return [buildTypoPlayerInput({ aim, fireRequested: false, reloadRequested: false })];
  }

  update(dt: number): void {
    this._updateAudio(dt);

    const [frameDt] = this._tickFrame(dt);
    this._handleInput();
    if (this._action === 'open_pause_menu') return;

    if (this._gameOverActive) {
      this._updateGameOverUi(frameDt);
      return;
    }

    const dtWorld = this._paused ? 0.0 : frameDt;

    // Native: delay game-over transition until the trooper death animation finishes
    // (checks `death_timer < 0.0` in the main gameplay loop).
    if (this.player.health <= 0.0) {
      if (dtWorld > 0.0) {
        this.player.deathTimer -= dtWorld * 20.0;
      }
      if (this.player.deathTimer < 0.0) {
        this._enterGameOver();
        this._updateGameOverUi(frameDt);
        return;
      }
      return;
    }

    if (dtWorld > 0.0) {
      this._enqueueTypingCommands();
    }

    if (dtWorld <= 0.0) return;

    const session = this._simSession;
    if (session === null) return;

    this._runDeterministicSessionTicks({
      dtFrame: dtWorld,
      session,
      recorder: this._replayRecorder,
      onTick: (_tick: DeterministicSessionTick, _tickIndex: number | null) => false,
      onCheckpoint: (tickIndex: number, tick: DeterministicSessionTick) => {
        this._recordReplayCheckpointFromTick({ tickIndex, tick });
      },
    });
    // Death/game-over flow is handled at the start of the next frame so the
    // trooper death animation can play before the UI slides in.
  }

  draw(): void {
    const alive = this.player.health > 0.0;
    const showGameplayUi = alive && !this._gameOverActive;

    this._drawWorld({
      drawAimIndicators: showGameplayUi,
      entityAlpha: this._worldEntityAlpha(),
    });
    this._drawScreenFade();

    if (showGameplayUi) {
      this._drawNameLabels();
    }

    if (showGameplayUi) {
      const hudFlags = hudFlagsForGameMode(this._configGameModeId());
      this._drawTargetHealthBar();
      drawHudOverlay(new HudRenderContext({
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
        elapsedMs: this._sessionElapsedMs(),
        frameDtMs: this._lastDtMs,
      });
    }

    if (showGameplayUi) {
      this._drawTypingBox();
    }

    if (this._gameOverActive) {
      this._drawGameCursor();
      if (this._gameOverRecord !== null) {
        this._gameOverUi.draw({
          record: this._gameOverRecord,
          bannerKind: this._gameOverBanner,
          resources: this.renderResources.resources,
          mouse: this._uiMousePos(),
        });
      }
    }
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

  private _drawNameLabels(): void {
    drawTypoNameLabels({
      creatures: this.creatures.entries,
      names: this.state.typo.names.names,
      worldToScreen: (worldPos: Vec2) => this.worldToScreen(worldPos),
      drawText: (text: string, pos: Vec2, color: wgl.Color, scale: number) =>
        this._drawUiText(text, pos, color, scale),
      measureTextWidth: (text: string, scale: number) => this._uiTextWidth(text, scale),
    });
  }

  private _drawTypingBox(): void {
    const panelTexture = getTexture(this.renderResources.resources, TextureId.UI_IND_PANEL);
    if (panelTexture === null) return;
    drawTypingBox(
      panelTexture,
      {
        text: this.state.typo.typing.text,
        cursorPulseTime: this._cursorPulseTime,
        drawText: (text: string, pos: Vec2, color: wgl.Color, scale: number) =>
          this._drawUiText(text, pos, color, scale),
        measureTextWidth: (text: string, scale: number) => this._uiTextWidth(text, scale),
      },
    );
  }
}
