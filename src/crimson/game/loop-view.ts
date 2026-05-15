// Port of crimson/game/loop_view.py

import { audioStopMusic } from '@grim/audio.ts';
import { Vec2 } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { type GroundRenderer } from '@grim/terrain-render.ts';
import { type View } from '@grim/view.ts';
import { InputState } from '@grim/input.ts';
import { debugEnabled } from '@crimson/debug.ts';
import { DemoView } from '@crimson/demo.ts';
import { type DemoTrialOverlayInfo, demoTrialOverlayInfo, tickDemoTrialTimers } from '@crimson/demo-trial.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { inputBeginFrame } from '@crimson/input-codes.ts';
import { QuestMode } from '@crimson/modes/quest-mode.ts';
import { RushMode } from '@crimson/modes/rush-mode.ts';
import { SurvivalMode } from '@crimson/modes/survival-mode.ts';
import { TutorialMode } from '@crimson/modes/tutorial-mode.ts';
import { TypoShooterMode } from '@crimson/modes/typo-mode.ts';
import { type RtxRenderMode, cycleRtxRenderMode } from '@crimson/render/rtx/mode.ts';
import { BootView } from '@crimson/screens/boot.ts';
import { HighScoresView } from '@crimson/screens/high-scores-view/view.ts';
import { MenuView, ensureMenuGround } from '@crimson/screens/menu.ts';
import { AlienZooKeeperView } from '@crimson/screens/panels/alien-zookeeper.ts';
import { PanelMenuView } from '@crimson/screens/panels/base.ts';
import { ControlsMenuView } from '@crimson/screens/panels/controls.ts';
import { CreditsView } from '@crimson/screens/panels/credits.ts';
import { UnlockedPerksDatabaseView, UnlockedWeaponsDatabaseView } from '@crimson/screens/panels/databases.ts';
import { ModsMenuView } from '@crimson/screens/panels/mods.ts';
import { OptionsMenuView } from '@crimson/screens/panels/options.ts';
import { PlayGameMenuView } from '@crimson/screens/panels/play-game.ts';
import { StatisticsMenuView } from '@crimson/screens/panels/stats.ts';
import { PauseMenuView } from '@crimson/screens/pause-menu.ts';
import { QuestsMenuView } from '@crimson/screens/quest-views/quests-menu.ts';
import { QuestResultsView } from '@crimson/screens/quest-views/quest-results.ts';
import { QuestFailedView } from '@crimson/screens/quest-views/quest-failed.ts';
import { EndNoteView } from '@crimson/screens/quest-views/end-note.ts';
import { updateScreenFade } from '@crimson/screens/transitions.ts';
import { DEMO_PURCHASE_URL, DemoTrialOverlayUi } from '@crimson/ui/demo-trial-overlay.ts';
import { type Screen, type GameState, type GameplayScreen, HighScoresRequest } from './types.ts';

const KEY_F4 = 115;
const KEY_P = 80;
const KEY_ESCAPE = 27;

const GAMMA_RAMP_VS = `#version 300 es
precision highp float;

in vec3 vertexPosition;
in vec2 vertexTexCoord;
in vec4 vertexColor;

out vec2 fragTexCoord;
out vec4 fragColor;

uniform mat4 mvp;

void main() {
    fragTexCoord = vertexTexCoord;
    fragColor = vertexColor;
    gl_Position = mvp * vec4(vertexPosition, 1.0);
}
`;

const GAMMA_RAMP_FS = `#version 300 es
precision highp float;

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform vec4 colDiffuse;
uniform float u_gamma_gain;

out vec4 finalColor;

void main() {
    vec4 texel = texture(texture0, fragTexCoord) * fragColor * colDiffuse;
    texel.rgb = clamp(texel.rgb * max(u_gamma_gain, 0.0), 0.0, 1.0);
    finalColor = texel;
}
`;

interface GammaRampShader {
  setGain(gain: number): void;
}

let _gammaRampShader: GammaRampShader | null = null;
let _gammaRampShaderGainLoc: number = -1;
let _gammaRampShaderTried = false;

function getGammaRampShader(): [GammaRampShader | null, number] {
  if (_gammaRampShaderTried) {
    return [_gammaRampShader, _gammaRampShaderGainLoc];
  }
  _gammaRampShaderTried = true;
  _gammaRampShader = {
    setGain(gain: number): void {
      wgl.setGammaGain(gain);
    },
  };
  _gammaRampShaderGainLoc = 0;
  return [_gammaRampShader, _gammaRampShaderGainLoc];
}

function setGammaRampGain(shader: GammaRampShader, _gainLoc: number, gain: number): void {
  shader.setGain(Math.max(0.0, gain));
}

function modeViewOptions(state: GameState): { assetsUrl: string; baseDir: string; preserveBugs: boolean } {
  return { assetsUrl: state.assetsDir, baseDir: state.baseDir, preserveBugs: state.preserveBugs };
}

function isGameplayScreen(view: Screen | null): view is GameplayScreen {
  if (view === null) return false;
  return (
    'frameTelemetry' in view &&
    'consoleElapsedMs' in view &&
    'bindStatus' in view &&
    'closeRequested' in view &&
    'defaultGameModeId' in view
  );
}

export class GameLoopView implements View {
  readonly state: GameState;

  private _boot: BootView;
  private _demo: DemoView;
  private _menu: MenuView;

  private _frontViews: Record<string, Screen>;
  private _frontActive: Screen | null = null;
  private _frontStack: Screen[] = [];
  private _active: View;

  private _demoTrialOverlay: DemoTrialOverlayUi | null = null;
  private _demoTrialInfo: DemoTrialOverlayInfo | null = null;
  private _demoActive = false;
  private _menuActive = false;
  private _quitAfterDemo = false;
  private _screenshotRequested = false;
  private _runtimeUpdatesPerFrame = 0;

  constructor(state: GameState) {
    this.state = state;

    this._boot = new BootView(state);
    this._demo = new DemoView(state);
    this._menu = new MenuView(state);

    const gs = state;
    const modeOptions = modeViewOptions(state);

    this._frontViews = {
      open_play_game: new PlayGameMenuView(gs),
      open_quests: new QuestsMenuView(gs),
      open_pause_menu: new PauseMenuView(gs),
      start_quest: new QuestMode({
        ...modeOptions,
        demoModeActive: state.demoEnabled,
        config: state.config,
        console: state.console,
        audio: state.audio,
        audioRng: state.rng,
      }),
      quest_results: new QuestResultsView(gs),
      quest_failed: new QuestFailedView(gs),
      end_note: new EndNoteView(gs),
      open_high_scores: new HighScoresView(gs),
      start_survival: new SurvivalMode({
        ...modeOptions,
        config: state.config,
        console: state.console,
        audio: state.audio,
        audioRng: state.rng,
      }),
      start_rush: new RushMode({
        ...modeOptions,
        config: state.config,
        console: state.console,
        audio: state.audio,
        audioRng: state.rng,
      }),
      start_typo: new TypoShooterMode({
        ...modeOptions,
        config: state.config,
        console: state.console,
        audio: state.audio,
        audioRng: state.rng,
      }),
      start_tutorial: new TutorialMode({
        ...modeOptions,
        demoModeActive: state.demoEnabled,
        config: state.config,
        console: state.console,
        audio: state.audio,
        audioRng: state.rng,
      }),
      open_options: new OptionsMenuView(gs),
      open_controls: new ControlsMenuView(gs),
      open_statistics: new StatisticsMenuView(gs),
      open_weapon_database: new UnlockedWeaponsDatabaseView(gs),
      open_perk_database: new UnlockedPerksDatabaseView(gs),
      open_credits: new CreditsView(gs),
      open_alien_zookeeper: new AlienZooKeeperView(gs),
      open_mods: new ModsMenuView(gs),
      open_other_games: new PanelMenuView(
        gs,
        {
          title: 'Other games',
          body: 'This menu is out of scope for the rewrite.',
        },
      ),
    };

    this._active = this._boot;
  }

  private _demoTrialOverlayView(): DemoTrialOverlayUi | null {
    if (this._demoTrialOverlay === null) {
      const resources = this.state.resources;
      if (resources === null) {
        return null;
      }
      this._demoTrialOverlay = new DemoTrialOverlayUi(resources);
    }
    return this._demoTrialOverlay;
  }

  open(): void {
    this._boot.open();
  }

  shouldClose(): boolean {
    return this.state.quitRequested;
  }

  consumeScreenshotRequest(): boolean {
    const requested = this._screenshotRequested;
    this._screenshotRequested = false;
    return requested;
  }

  private _lanUiEnabled(): boolean {
    const cvar = this.state.console.cvars.get('cv_lanLockstepEnabled');
    if (cvar === undefined) return true;
    return cvar.valueF !== 0;
  }

  private _autoLanStartAction(): string | null {
    return null;
  }

  private _resolveLanAction(action: string): string | null {
    if (action === 'open_lan_session') {
      return 'open_play_game';
    }

    const lanModeActions: Record<string, string> = {
      start_survival_lan: 'start_survival',
      start_rush_lan: 'start_rush',
      start_quest_lan: 'start_quest',
    };
    const mapped = lanModeActions[action];
    if (mapped !== undefined) {
      return mapped;
    }

    return action;
  }

  private _tickNetworkRuntime(): void {
    this._runtimeUpdatesPerFrame = 0;
    this.state.runtimeUpdatesPerFrame = 0;
  }

  private _clearStateFrameTelemetry(): void {
    this.state.inputStallCount = 0;
    this.state.ticksAdvancedPerFrame = 0;
    this.state.simMs = 0.0;
    this.state.presentationPlanMs = 0.0;
    this.state.presentationApplyMs = 0.0;
  }

  private _syncGameplayFrameTelemetryToState(): void {
    const gameplay = this._gameplayScreen(this._frontActive);
    if (gameplay === null) return;

    const [
      runtimeUpdatesPerFrame,
      inputStallCount,
      ticksAdvancedPerFrame,
      simMs,
      presentationPlanMs,
      presentationApplyMs,
    ] = gameplay.frameTelemetry();

    this.state.runtimeUpdatesPerFrame = int(runtimeUpdatesPerFrame);
    this.state.inputStallCount = int(inputStallCount);
    this.state.ticksAdvancedPerFrame = int(ticksAdvancedPerFrame);
    this.state.simMs = simMs;
    this.state.presentationPlanMs = presentationPlanMs;
    this.state.presentationApplyMs = presentationApplyMs;
  }

  update(dt: number): void {
    inputBeginFrame();

    const con = this.state.console;
    con.handleHotkey();
    con.update(dt);
    this._syncConsoleElapsedMs();
    this._handleConsoleRequests();
    this._syncRtxMode();
    updateScreenFade(this.state, dt);
    this._tickNetworkRuntime();
    this._clearStateFrameTelemetry();

    const frontActive = this._frontActive;
    const gameplay = this._gameplayScreen(frontActive);

    if (gameplay !== null) {
      gameplay.setRuntimeUpdatesPerFrame(int(this._runtimeUpdatesPerFrame));
    }

    if (debugEnabled() && !con.openFlag && InputState.wasKeyPressed(KEY_F4)) {
      this._setRtxMode(cycleRtxRenderMode(this.state.rtxMode), 'debug hotkey F4');
    }
    if (debugEnabled() && !con.openFlag && InputState.wasKeyPressed(KEY_P)) {
      this._screenshotRequested = true;
    }

    if (con.openFlag) {
      if (con.quitRequested) {
        this.state.quitRequested = true;
        con.quitRequested = false;
      }
      return;
    }

    this._demoTrialInfo = null;
    this._tickStatisticsPlaytime(dt);

    if (gameplay !== null) {
      if (this._updateDemoTrialOverlay(dt)) {
        return;
      }
    }

    this._active.update(dt);
    this._syncGameplayFrameTelemetryToState();

    if (this._frontActive !== null) {
      const fa = this._frontActive;
      const gp = this._gameplayScreen(fa);
      let action = fa.takeAction!();

      if (gp !== null) {
        action = this._resolveGameplayAction(gp, action);
      }
      if (action !== null) {
        action = this._resolveLanAction(action);
        if (action === null) return;
      }

      if (action === 'back_to_menu') {
        this._captureGameplayGroundForMenu();
        this.state.pauseBackground = null;
        this._frontActive!.close();
        this._frontActive = null;
        while (this._frontStack.length > 0) {
          this._frontStack.pop()!.close();
        }
        this._menu.open();
        this._active = this._menu;
        this._menuActive = true;
        return;
      }

      if (action === 'back_to_previous') {
        if (this._frontStack.length > 0) {
          fa.close();
          this._frontActive = this._frontStack.pop()!;
          if (this._gameplayScreen(this._frontActive) !== null) {
            this.state.pauseBackground = null;
          } else {
            if (this._frontActive instanceof StatisticsMenuView) {
              this._frontActive.reopenFromChild();
            }
          }
          this._active = this._frontActive;
          return;
        }
        fa.close();
        this._frontActive = null;
        this.state.pauseBackground = null;
        this._menu.open();
        this._active = this._menu;
        this._menuActive = true;
        return;
      }

      if (action === 'open_pause_menu') {
        const pauseView = this._frontViews['open_pause_menu'] ?? null;
        if (pauseView === null) return;

        if (gp !== null) {
          this.state.pauseBackground = gp;
          this._frontStack.push(fa);
          pauseView.open();
          this._frontActive = pauseView;
          this._active = pauseView;
          return;
        }
        if (this.state.pauseBackground === null) {
          // Options panel uses open_pause_menu as back_action; when no game is
          // running, treat it like back_to_menu.
          this._frontActive!.close();
          this._frontActive = null;
          while (this._frontStack.length > 0) {
            this._frontStack.pop()!.close();
          }
          this._menu.open();
          this._active = this._menu;
          this._menuActive = true;
          return;
        }
        fa.close();
        pauseView.open();
        this._frontActive = pauseView;
        this._active = pauseView;
        return;
      }

      if (
        action === 'start_survival' ||
        action === 'start_rush' ||
        action === 'start_typo'
      ) {
        // Temporary: bump the counter on mode start so the Play Game overlay (F1)
        // and Statistics screen reflect activity.
        const modeMap: Record<string, GameMode> = {
          start_survival: GameMode.SURVIVAL,
          start_rush: GameMode.RUSH,
          start_typo: GameMode.TYPO,
        };
        const modeId = modeMap[action];
        if (modeId !== undefined) {
          this.state.status.incrementModePlayCountForMode(modeId);
        }
      }

      if (action !== null) {
        const view = this._frontViews[action] ?? null;
        if (view !== null) {
          if (
            action === 'open_high_scores' ||
            action === 'open_weapon_database' ||
            action === 'open_perk_database' ||
            action === 'open_credits'
          ) {
            if (gp !== null && this.state.pauseBackground === null) {
              this.state.pauseBackground = gp;
            }
            this._frontStack.push(fa);
          } else if (
            (action === 'quest_results' || action === 'quest_failed') &&
            gp !== null
          ) {
            this.state.pauseBackground = gp;
            this._frontStack.push(fa);
          } else {
            if (
              action === 'start_survival' ||
              action === 'start_rush' ||
              action === 'start_typo' ||
              action === 'start_tutorial' ||
              action === 'start_quest' ||
              action === 'open_play_game' ||
              action === 'open_lan_session' ||
              action === 'open_quests'
            ) {
              this.state.pauseBackground = null;
              while (this._frontStack.length > 0) {
                this._frontStack.pop()!.close();
              }
            }
            fa.close();
          }

          this._openFrontView(action, view);
          this._frontActive = view;
          this._active = view;
          return;
        }
      }
    }

    if (this._menuActive) {
      let action: string | null = this._menu.takeAction();
      if (action === null) {
        action = this._autoLanStartAction();
      }

      if (action === 'quit_app') {
        this.state.quitRequested = true;
        return;
      }

      if (action === 'start_demo') {
        const demo = this._demo;
        if (demo === null) return;
        this._menu.close();
        this._menuActive = false;
        demo.open();
        this._active = demo;
        this._demoActive = true;
        return;
      }

      if (action === 'quit_after_demo') {
        const demo = this._demo;
        if (demo === null) return;
        this._menu.close();
        this._menuActive = false;
        this._quitAfterDemo = true;
        demo.open();
        this._active = demo;
        this._demoActive = true;
        return;
      }

      if (action !== null) {
        action = this._resolveLanAction(action);
        if (action === null) return;

        const view = this._frontViews[action] ?? null;
        if (view !== null) {
          this._menu.close();
          this._menuActive = false;
          this._openFrontView(action, view);
          this._frontActive = view;
          this._active = view;
          return;
        }
      }
    }

    if (
      !this._demoActive &&
      !this._menuActive &&
      this._frontActive === null &&
      this.state.demoEnabled &&
      this._boot.isThemeStarted()
    ) {
      const demo = this._demo;
      if (demo !== null) {
        demo.open();
        this._active = demo;
        this._demoActive = true;
        return;
      }
    }

    if (this._demoActive && !this._menuActive && this._demo !== null && this._demo.isFinished()) {
      this._demo.close();
      this._demoActive = false;
      if (this._quitAfterDemo) {
        this._quitAfterDemo = false;
        this.state.quitRequested = true;
        return;
      }
      ensureMenuGround(this.state, { regenerate: true });
      this._menu.open();
      this._active = this._menu;
      this._menuActive = true;
      return;
    }

    if (
      !this._demoActive &&
      !this._menuActive &&
      this._frontActive === null &&
      this._boot.isThemeStarted()
    ) {
      this._menu.open();
      this._active = this._menu;
      this._menuActive = true;
    }

    if (con.quitRequested) {
      this.state.quitRequested = true;
      con.quitRequested = false;
    }
  }

  private _tickStatisticsPlaytime(dt: number): void {
    // Native `_game_sequence_id` advances on gameplay frames only (state 9)
    // and is used by the Statistics "played for ... hours ... minutes" row.
    if (this.state.demoEnabled) return;
    if (this._gameplayScreen(this._frontActive) === null) return;
    const deltaMs = int(dt * 1000.0);
    if (deltaMs <= 0) return;
    this.state.status.gameSequenceId = int(this.state.status.gameSequenceId + deltaMs);
  }

  private _syncConsoleElapsedMs(): void {
    const views: Screen[] = [];
    if (this._frontActive !== null) views.push(this._frontActive);
    if (this._frontStack.length > 0) {
      for (let i = this._frontStack.length - 1; i >= 0; i--) {
        views.push(this._frontStack[i]);
      }
    }
    for (const view of views) {
      const gameplay = this._gameplayScreen(view);
      if (gameplay !== null) {
        this.state.survivalElapsedMs = Math.max(0.0, gameplay.consoleElapsedMs());
        return;
      }
    }
  }

  private _handleConsoleRequests(): void {
    if (this.state.terrainRegenerateRequested) {
      this.state.terrainRegenerateRequested = false;
      this._regenerateTerrainForConsole();
    }
  }

  private _regenerateTerrainForConsole(): void {
    ensureMenuGround(this.state, { regenerate: true });
    const views: Screen[] = [];
    if (this._frontActive !== null) views.push(this._frontActive);
    if (this._frontStack.length > 0) {
      for (let i = this._frontStack.length - 1; i >= 0; i--) {
        views.push(this._frontStack[i]);
      }
    }
    for (const view of views) {
      const gameplay = this._gameplayScreen(view);
      if (gameplay !== null) {
        gameplay.regenerateTerrainForConsole();
        return;
      }
    }
  }

  private _updateDemoTrialOverlay(dt: number): boolean {
    if (!this.state.demoEnabled) return false;
    const gameplay = this._gameplayScreen(this._frontActive);

    const modeRaw = this.state.config.gameplay.mode;
    let modeId: GameMode;
    if (Object.values(GameMode).includes(modeRaw)) {
      modeId = modeRaw;
    } else {
      modeId = GameMode.DEMO;
    }

    let questLevel = null;
    if (modeId === GameMode.QUESTS) {
      questLevel = this.state.pendingQuestLevel;
    }

    const current = demoTrialOverlayInfo({
      demoBuild: true,
      gameModeId: modeId,
      globalPlaytimeMs: int(this.state.status.gameSequenceId),
      questGraceElapsedMs: int(this.state.demoTrialElapsedMs),
      questLevel,
    });

    const frameDt = Math.min(dt, 0.1);
    const dtMs = int(frameDt * 1000.0);
    const [usedMs, graceMs] = tickDemoTrialTimers({
      demoBuild: true,
      gameModeId: modeId,
      overlayVisible: current.visible,
      globalPlaytimeMs: int(this.state.status.gameSequenceId),
      questGraceElapsedMs: int(this.state.demoTrialElapsedMs),
      dtMs: int(dtMs),
    });

    if (usedMs !== int(this.state.status.gameSequenceId)) {
      this.state.status.gameSequenceId = int(usedMs);
    }
    this.state.demoTrialElapsedMs = int(graceMs);

    const info = demoTrialOverlayInfo({
      demoBuild: true,
      gameModeId: modeId,
      globalPlaytimeMs: int(this.state.status.gameSequenceId),
      questGraceElapsedMs: int(this.state.demoTrialElapsedMs),
      questLevel,
    });
    this._demoTrialInfo = info;

    if (!info.visible) return false;

    if (gameplay !== null) {
      gameplay.prepareDemoTrialOverlayFrame();
    }

    const overlayView = this._demoTrialOverlayView();
    if (overlayView === null) return false;
    const action = overlayView.update(dtMs);
    if (action === 'purchase') {
      this.state.quitRequested = true;
      try {
        window.open(DEMO_PURCHASE_URL, '_blank');
      } catch {
        this.state.console.log.log('demo trial: failed to open purchase URL');
      }
      return true;
    }

    if (InputState.wasKeyPressed(KEY_ESCAPE) || action === 'maybe_later') {
      this._captureGameplayGroundForMenu();
      if (this._frontActive !== null) {
        this._frontActive.close();
        this._frontActive = null;
      }
      while (this._frontStack.length > 0) {
        this._frontStack.pop()!.close();
      }
      this._menu.open();
      this._active = this._menu;
      this._menuActive = true;
      return true;
    }

    return true;
  }

  private _gameplayScreen(view: Screen | null): GameplayScreen | null {
    if (view === null) return null;
    if (isGameplayScreen(view)) return view;
    return null;
  }

  private _openFrontView(action: string, view: Screen): void {
    const gameplay = this._gameplayScreen(view);
    if (gameplay !== null) {
      this._openGameplayScreen(gameplay);
    } else {
      view.open();
    }
    this._maybeAdoptMenuGround(action);
  }

  private _maybeAdoptMenuGround(_action: string): void {
    // Native `game_state_set(9)` always calls `gameplay_reset_state()`, which
    // runs `terrain_generate_random()`. Menu terrain should carry back to menu,
    // but entering a fresh gameplay run must regenerate terrain instead of
    // reusing the captured menu render target.
  }

  private _openGameplayScreen(gameplay: GameplayScreen): void {
    if (this.state.screenFadeRamp) {
      this.state.screenFadeAlpha = 1.0;
    }
    this.state.screenFadeRamp = false;

    if (gameplay instanceof QuestMode) {
      this.state.questOutcome = null;
    }

    if (this.state.audio !== null) {
      // Original game: entering gameplay cuts the menu theme; in-game tunes
      // start later on the first creature hit.
      audioStopMusic(this.state.audio);
    }

    this._configureLanRuntime(gameplay);

    gameplay.bindStatus(this.state.status);
    gameplay.bindAudio(this.state.audio, this.state.rng);
    gameplay.setRtxMode(this.state.rtxMode);
    gameplay.bindScreenFade(this.state);
    gameplay.open();

    if (gameplay instanceof QuestMode) {
      this._prepareQuestRun(gameplay);
    }
  }

  private _configureLanRuntime(gameplay: GameplayScreen): void {
    gameplay.setLanRuntime({
      enabled: false,
      role: '',
      expectedPlayers: 1,
      connectedPlayers: 1,
      waitingForPlayers: false,
    });
    gameplay.bindLanRuntime(null);
  }

  private _prepareQuestRun(gameplay: QuestMode): void {
    const level = this.state.pendingQuestLevel;
    if (level === null) return;
    gameplay.startRun(level, { status: this.state.status });
  }

  private _resolveGameplayAction(
    gameplay: GameplayScreen,
    action: string | null,
  ): string | null {
    if (action === 'open_high_scores') {
      this.state.pendingHighScores = new HighScoresRequest({
        gameModeId: gameplay.defaultGameModeId,
      });
      return action;
    }

    if (action === 'back_to_menu') {
      gameplay.closeRequested = false;
      return action;
    }

    if (action !== null) return action;

    if (!gameplay.closeRequested) return null;
    gameplay.closeRequested = false;

    if (gameplay instanceof QuestMode) {
      const outcome = gameplay.consumeOutcome();
      if (outcome !== null) {
        this.state.questOutcome = outcome;
        if (outcome.kind === 'completed') return 'quest_results';
        if (outcome.kind === 'failed') return 'quest_failed';
      }
      return 'back_to_menu';
    }

    return 'back_to_menu';
  }

  private _setRtxMode(mode: RtxRenderMode, source: string): void {
    if (mode === this.state.rtxMode) return;
    this.state.rtxMode = mode;
    this._syncRtxMode();
    this.state.console.log.log(`render mode: ${mode} (${source})`);
  }

  private _syncRtxMode(): void {
    const views: Screen[] = [];
    if (this._frontActive !== null) views.push(this._frontActive);
    if (this._frontStack.length > 0) {
      views.push(...this._frontStack);
    }
    for (const view of views) {
      const gameplay = this._gameplayScreen(view);
      if (gameplay !== null) {
        gameplay.setRtxMode(this.state.rtxMode);
      }
    }
  }

  private _stealGroundFromView(view: Screen | null): GroundRenderer | null {
    const gameplay = this._gameplayScreen(view);
    if (gameplay === null) return null;
    const ground = gameplay.stealGroundForMenu();
    if (ground !== null) return ground;
    return null;
  }

  private _menuGroundCameraFromView(view: Screen | null): Vec2 | null {
    const gameplay = this._gameplayScreen(view);
    if (gameplay === null) return null;
    const camera = gameplay.menuGroundCamera();
    if (camera instanceof Vec2) return camera;
    return null;
  }

  private _replaceMenuGround(ground: GroundRenderer, camera: Vec2 | null): void {
    const previous = this.state.menuGround;
    if (previous === ground) {
      this.state.menuGroundCamera = camera;
      return;
    }
    if (previous !== null && previous.renderTarget !== null) {
      wgl.unloadRenderTexture(previous.renderTarget);
      previous.renderTarget = null;
    }
    this.state.menuGround = ground;
    this.state.menuGroundCamera = camera;
  }

  private _captureGameplayGroundForMenu(): void {
    let ground: GroundRenderer | null = null;
    let camera: Vec2 | null = null;

    if (this._gameplayScreen(this._frontActive) !== null) {
      camera = this._menuGroundCameraFromView(this._frontActive);
      ground = this._stealGroundFromView(this._frontActive);
    }

    if (ground === null) {
      for (let i = this._frontStack.length - 1; i >= 0; i--) {
        const view = this._frontStack[i];
        if (this._gameplayScreen(view) !== null) {
          camera = this._menuGroundCameraFromView(view);
          ground = this._stealGroundFromView(view);
          if (ground !== null) break;
        }
      }
    }

    if (ground === null) return;
    this._replaceMenuGround(ground, camera);
  }

  private _drawSceneLayers(): void {
    this._active.draw();
    const info = this._demoTrialInfo;
    if (info !== null && info.visible) {
      this._demoTrialOverlayView()?.draw(info);
    }
    // WebGL loads runtime resources asynchronously; Python reaches this draw path only after resources exist.
    if (this.state.resources !== null) {
      this.state.console.draw();
      this.state.console.drawFpsCounter();
    }
  }

  private _drawWithGamma(): void {
    const gammaGain = Math.max(0.0, this.state.gammaRamp);
    if (Math.abs(gammaGain - 1.0) <= 1e-6) {
      this._drawSceneLayers();
      return;
    }

    const [shader, gainLoc] = getGammaRampShader();
    if (shader === null || gainLoc < 0) {
      this._drawSceneLayers();
      return;
    }

    setGammaRampGain(shader, gainLoc, gammaGain);
    try {
      this._drawSceneLayers();
    } finally {
      wgl.setGammaGain(1.0);
    }
  }

  draw(): void {
    this._drawWithGamma();
  }

  close(): void {
    if (this._menuActive) {
      this._menu.close();
    }
    if (this._frontActive !== null) {
      this._frontActive.close();
    }
    while (this._frontStack.length > 0) {
      this._frontStack.pop()!.close();
    }
    if (this._demoActive && this._demo !== null) {
      this._demo.close();
    }
    const overlay = this._demoTrialOverlay;
    if (overlay !== null) {
      overlay.close();
    }
    if (this.state.menuGround !== null && this.state.menuGround.renderTarget !== null) {
      wgl.unloadRenderTexture(this.state.menuGround.renderTarget);
      this.state.menuGround.renderTarget = null;
    }
    this._boot.close();
    this.state.console.close();
  }
}
