// Port of crimson/modes/typo_mode.py

import { TextureId } from '@grim/assets.ts';
import type { AudioState } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { Crand } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import type { ViewContext } from '@grim/view.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { scoresPathForMode } from '@crimson/persistence/highscores.ts';
import { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { Replay } from '@crimson/replay/index.ts';
import { ReplayHeader, ReplayRecorder } from '@crimson/replay/index.ts';
import { DEFAULT_CHECKPOINT_SAMPLE_RATE } from '@crimson/replay/checkpoints.ts';
import { advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import type { PlayerInput } from '@crimson/sim/input.ts';
import { TypoBackspaceCommand, TypoCharCommand, TypoSubmitCommand } from '@crimson/sim/input-providers.ts';
import { buildTypoSession } from '@crimson/sim/session-builders.ts';
import type { DeterministicSession } from '@crimson/sim/sessions.ts';
import { loadTypoDictionary, loadTypoHighscoreNames } from '@crimson/typo/names.ts';
import { buildTypoPlayerInput } from '@crimson/typo/player.ts';
import { typoShotCounts } from '@crimson/typo/state.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { HudRenderContext, drawHudOverlay, hudFlagsForGameMode } from '@crimson/ui/hud.ts';
import { drawTypingBox, drawTypoNameLabels } from '@crimson/ui/overlays/typo-run.ts';
import { BaseGameplayMode } from '@crimson/modes/base-gameplay-mode.ts';
import { buildHighscoreRecordForGameOver } from '@crimson/modes/components/highscore-record-builder.ts';
import { existsSync, statSync } from 'node:fs';

export const WORLD_SIZE = 1024.0;

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

export class TypoShooterMode extends BaseGameplayMode {

  constructor(ctx: ViewContext, opts: { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand });
  constructor(opts: { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
  constructor(ctxOrOpts: ViewContext | { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean }, maybeOpts?: { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand }) {
    const ctx = maybeOpts === undefined ? { assetsDir: (ctxOrOpts as { assetsUrl?: string }).assetsUrl ?? '', preserveBugs: (ctxOrOpts as { preserveBugs?: boolean }).preserveBugs ?? false } as ViewContext : ctxOrOpts as ViewContext;
    const opts = maybeOpts ?? (ctxOrOpts as { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
    const config = opts.config;
    const console = opts.console ?? null;
    const audio = opts.audio ?? null;
    const audioRng = opts.audioRng;
    super({ assetsUrl: ctx.assetsDir, preserveBugs: ctx.preserveBugs, worldSize: WORLD_SIZE, defaultGameModeId: GameMode.TYPO, demoModeActive: false, questFailRetryCount: 0, hardcore: false, config: config, console: console, audio: audio, audioRng: audioRng });
    this._simSession = this._newSimSession();
  }

  protected _newSimSession(): DeterministicSession {
    return buildTypoSession({ world: this.simWorld.worldState, worldSize: this.worldSize, damageScaleByType: this.simWorld.damageScaleByType, detailPreset: 5, violenceDisabled: 0, gameTuneStarted: Boolean(this.simWorld.gameTuneStarted), dictionaryWords: this.state.typo.dictionaryWords, highscoreNames: this.state.typo.highscoreNames });
  }

  open(): void {
    super.open();
    const dictionaryPath = _pathJoin(this._baseDir, 'typo_dictionary.txt');
    let dictionaryWords: readonly string[] = [];
    if ((existsSync(String(dictionaryPath)) && statSync(String(dictionaryPath)).isFile())) {
      dictionaryWords = Array.from(loadTypoDictionary(dictionaryPath));
    }
    const highscoreNames = Array.from(loadTypoHighscoreNames(scoresPathForMode(this._baseDir, GameMode.TYPO)));

    const status = this.state.status;
    const terrain = advanceUnlockTerrain(this.state.rng, { unlockIndex: status !== null ? int(status.questUnlockIndex) : 0, width: int(this.worldSize), height: int(this.worldSize) });
    this.applyTerrainSetup({
      terrainSlots: terrain.terrainSlots,
      seed: int(terrain.terrainSeed),
    });
    this.simWorld.state.rng.srand(int(this.state.rng.state));
    this.state.typo.dictionaryWords = dictionaryWords;
    this.state.typo.highscoreNames = highscoreNames;
    this._simSession = this._newSimSession();

    this._replayRecorder = new ReplayRecorder(new ReplayHeader({ gameModeId: GameMode.TYPO, seed: int(this._runResetSeed), tickRate: int(this._gameplayTickRate()), questFailRetryCount: int(this.questFailRetryCount), hardcore: Boolean(this.hardcore), preserveBugs: Boolean(this.state.preserveBugs), detailPreset: int(this._deterministicDetailPreset()), violenceDisabled: int(this._deterministicViolenceDisabled()), worldSize: this.worldSize, playerCount: 1, status: status === null ? new GameStatusData() : status.asData(), typoDictionaryWords: Array.from(dictionaryWords), typoHighscoreNames: Array.from(highscoreNames) }));
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
    super.close();
  }

  protected _runtimePlayerCount(): number {
    return 1;
  }

  protected _buildLocalInputs(opts: { dt: number }): PlayerInput[] {
    const dt = opts.dt;
    const _ = dt;
    return [
      buildTypoPlayerInput({ aim: this.screenToWorld(this._uiMouse), fireRequested: false, reloadRequested: false }),
    ];
  }

  protected _handleInput(): void {
    if (this._gameOverActive) {
      if (InputState.wasKeyPressed(27)) {
        this._action = 'back_to_menu';
        this.closeRequested = true;
      }
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

  protected _enqueueTypingCommands(): void {
    const enterPressed = InputState.wasKeyPressed(13) || InputState.wasKeyPressed(335);
    if (enterPressed && this.state.typo.typing.text) {
      this.enqueueInputCommand(new TypoSubmitCommand({ playerIndex: 0 }));
    }

    // Native processes at most one keychar per frame via `console_input_poll`.
    if (InputState.wasKeyPressed(8) || InputState.wasKeyPressedRepeat(8)) {
      this.enqueueInputCommand(new TypoBackspaceCommand({ playerIndex: 0 }));
    } else {
      const codepoint = int(InputState.getCharPressed());
      if (codepoint !== 13 && codepoint !== 8 && 0x20 <= codepoint && codepoint <= 0xFF) {
        let ch: ReturnType<typeof String.fromCodePoint>;
        try {
          ch = String.fromCodePoint(codepoint);
        } catch (exc) {
          ch = '';
        }
        if (ch) {
          this.enqueueInputCommand(new TypoCharCommand({ playerIndex: 0, ch: ch[0] }));
        }
      }
    }
  }

  protected _enterGameOver(): void {
    if (this._gameOverActive) {
      return;
    }

    const [shotsFired, shotsHit] = typoShotCounts(this.state.typo);
    const record = buildHighscoreRecordForGameOver({ state: this.state, player: this.player, survivalElapsedMs: int(this._sessionElapsedMs()), creatureKillCount: int(this.creatures.killCount), gameModeId: GameMode.TYPO, shotsFired: int(shotsFired), shotsHit: int(shotsHit), clampShotsHit: false });

    this._gameOverRecord = record;
    this._gameOverUi.open();
    this._gameOverActive = true;
    this._saveReplay();
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

  protected _replayClaimedShots(): [number, number] {
    return typoShotCounts(this.state.typo);
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: Replay }): string {
    const stamp = opts.stamp;
    const replay = opts.replay;
    const _ = replay;
    const score = int(this.player.experience);
    return `typo_${stamp}_score${score}`;
  }

  update(dt: number): void {
    this._updateAudio(dt);

    dt = this._tickFrame(dt)[0];
    this._handleInput();
    if (this._action === 'open_pause_menu') {
      return;
    }

    if (this._gameOverActive) {
      this._updateGameOverUi(dt);
      return;
    }

    const dtWorld = this._paused ? 0.0 : dt;

    // Native: delay game-over transition until the trooper death animation finishes
    // (checks `death_timer < 0.0` in the main gameplay loop).
    if (this.player.health <= 0.0) {
      if (dtWorld > 0.0) {
        this.player.deathTimer -= dtWorld * 20.0;
      }
      if (this.player.deathTimer < 0.0) {
        this._enterGameOver();
        this._updateGameOverUi(dt);
        return;
      }
      return;
    }

    if (dtWorld > 0.0) {
      this._enqueueTypingCommands();
    }

    if (dtWorld <= 0.0) {
      return;
    }

    const session = this._simSession;
    if (session === null) {
      return;
    }

    const _onCheckpoint = (tickIndex: number, tick: any): void => {
      this._recordReplayCheckpointFromTick({
        tickIndex: int(tickIndex),
        tick: tick,
      });
    };

    this._runDeterministicSessionTicks({
      dtFrame: dtWorld,
      session: session,
      recorder: this._replayRecorder,
      onTick: (tick, tickIndex) => false,
      onCheckpoint: _onCheckpoint,
    });
    // Death/game-over flow is handled at the start of the next frame so the
    // trooper death animation can play before the UI slides in.
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

  protected _drawNameLabels(): void {
    drawTypoNameLabels({
      creatures: this.creatures.entries,
      names: this.state.typo.names.names,
      worldToScreen: this.worldToScreen,
      drawText: (text, pos, color, scale) => this._drawUiText(text, pos, color, scale),
      measureTextWidth: (text, scale) => this._uiTextWidth(text, scale),
    });
  }

  protected _drawTypingBox(): void {
    drawTypingBox(
      this.renderResources.resources.texture(TextureId.UI_IND_PANEL),
      { text: this.state.typo.typing.text, cursorPulseTime: this._cursorPulseTime, drawText: (text, pos, color, scale) => this._drawUiText(text, pos, color, scale), measureTextWidth: (text, scale) => this._uiTextWidth(text, scale) },
    );
  }

  draw(): void {
    const alive = this.player.health > 0.0;
    const showGameplayUi = alive && !this._gameOverActive;

    this._drawWorld({ drawAimIndicators: showGameplayUi, entityAlpha: this._worldEntityAlpha() });
    this._drawScreenFade();

    if (showGameplayUi) {
      this._drawNameLabels();
    }

    if (showGameplayUi) {
      const hudFlags = hudFlagsForGameMode(this._configGameModeId());
      this._drawTargetHealthBar();
      drawHudOverlay(
        new HudRenderContext({ resources: this.renderResources.resources, state: this._hudState, font: this._small, showHealth: hudFlags.showHealth, showWeapon: hudFlags.showWeapon, showXp: hudFlags.showXp, showTime: hudFlags.showTime, showQuestHud: hudFlags.showQuestHud, smallIndicators: this._hudSmallIndicators() }),
        { player: this.player, players: this.simWorld.players, bonusHud: this.state.bonusHud, elapsedMs: this._sessionElapsedMs(), frameDtMs: this._lastDtMs },
      );
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
}
