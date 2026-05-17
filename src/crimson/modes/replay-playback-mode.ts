// Port of crimson/modes/replay_playback_mode.py

import { TextureId } from '@grim/assets.ts';
import type { AudioState } from '@grim/audio.ts';
import { initAudioState, playMusic, shutdownAudio, updateAudio } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { GrimMonoFont } from '@grim/fonts/grim-mono.ts';
import { loadGrimMonoFont } from '@grim/fonts/grim-mono.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, loadSmallFont, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { Crand } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import type { ViewContext } from '@grim/view.ts';
import { GameMode } from '@crimson/game-modes.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import { modeFromRtxFlag } from '@crimson/render/rtx/mode.ts';
import { Replay, loadReplayFile, warnOnGameVersionMismatch } from '@crimson/replay/index.ts';
import { PlaybackDriver, buildRuntimePlaybackDriver } from '@crimson/replay/driver/playback-driver.ts';
import { advancePlaybackFrame } from '@crimson/replay/driver/playback-pump.ts';
import { ReplayRunnerError } from '@crimson/replay/driver/setup.ts';
import { PresentationTickOutput, applyPresentationOutputs } from '@crimson/sim/batch-apply.ts';
import { FixedStepClock } from '@crimson/sim/clock.ts';
import type { TickResult } from '@crimson/sim/hooks.ts';
import type { PostApplyReaction } from '@crimson/sim/presentation-reactions.ts';
import { applyPostApplyReaction, buildPostApplyReaction } from '@crimson/sim/presentation-reactions.ts';
import { HUD_AMMO_BASE_POS, HUD_AMMO_TEXT_OFFSET, HudRenderContext, HudState, drawHudOverlay, hudFlagsForGameMode, hudUiScale } from '@crimson/ui/hud.ts';
import { drawQuestCompleteBannerOverlay, drawQuestTitleTimerOverlay } from '@crimson/ui/overlays/quest-run.ts';
import { drawTutorialOverlayPanels } from '@crimson/ui/overlays/tutorial-run.ts';
import { drawTypingBox, drawTypoNameLabels } from '@crimson/ui/overlays/typo-run.ts';
import { WorldRuntime } from '@crimson/world/runtime.ts';
import * as grimMusic from '@grim/music.ts';
import * as wgl from '@wgl';

export const PLAYBACK_SPEED_STEPS: readonly number[] = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0];
const _DEFAULT_SPEED_INDEX = 2;
const _SKIP_SHORT_SECONDS = 5.0;
const _SKIP_LONG_SECONDS = 30.0;
const _REPLAY_WIDGET_PANEL_SIZE = new Vec2(182.0, 53.0);
const _REPLAY_WIDGET_ICON_SIZE = new Vec2(32.0, 32.0);
const _REPLAY_WIDGET_BAR_HEIGHT = 4.0;
const _REPLAY_WIDGET_X_SHIFT = 10.0;
const _REPLAY_WIDGET_TEXT_LINE1_Y = HUD_AMMO_BASE_POS[1] + HUD_AMMO_TEXT_OFFSET[1];
const _REPLAY_WIDGET_PANEL_TO_LINE1_Y = -7.0;
const _REPLAY_WIDGET_PANEL_OFFSET_X = 0.0;
const _REPLAY_WIDGET_PANEL_OFFSET_Y = 0.0;
const _REPLAY_WIDGET_CLOCK_OFFSET_X = 0.0;
const _REPLAY_WIDGET_CLOCK_OFFSET_Y = 0.0;
const _REPLAY_WIDGET_TEXT_OFFSET_X = 0.0;
const _REPLAY_WIDGET_TEXT_OFFSET_Y = 0.0;
const _REPLAY_WIDGET_BAR_OFFSET_X = 0.0;
const _REPLAY_WIDGET_BAR_OFFSET_Y = 0.0;

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

function pyRound(value: number, ndigits = 0): number {
  const factor = 10 ** ndigits;
  const scaled = value * factor;
  const floorValue = Math.floor(scaled);
  const frac = scaled - floorValue;
  if (frac < 0.5) {
    return floorValue / factor;
  }
  if (frac > 0.5) {
    return (floorValue + 1) / factor;
  }
  return (floorValue % 2 === 0 ? floorValue : floorValue + 1) / factor;
}

export class ReplayPlaybackMode {
  protected _ctx: ViewContext;
  protected _replayPath: string;
  protected _config: CrimsonConfig;
  protected _console: ConsoleState;
  protected _maxTicks: number | null;
  protected _traceRng: boolean;
  protected _rtx: boolean;
  protected _showReplayWidget: boolean;
  closeRequested: boolean;
  protected _replay: Replay | null;
  protected _runtime: WorldRuntime | null;
  protected _small: SmallFontData | null;
  protected _hudState: HudState;
  protected _grimMono: GrimMonoFont | null;
  protected _questTitle: string;
  protected _questLevel: QuestLevel | null;
  protected _tickRate: number;
  protected _dt: number;
  protected _dtAccum: number;
  protected _clock: FixedStepClock;
  protected _frameIndex: number;
  protected _tickIndex: number;
  protected _finished: boolean;
  protected _paused: boolean;
  protected _stepOncePending: boolean;
  protected _speedIndex: number;
  protected _driver: PlaybackDriver | null;
  protected _questTotalSpawnCount: number;
  protected _audio: AudioState | null;
  protected _audioRng: Crand | null;

  get ctx(): ViewContext {
    return this._ctx;
  }
  get replayPath(): string {
    return this._replayPath;
  }
  get config(): CrimsonConfig {
    return this._config;
  }
  get console(): ConsoleState {
    return this._console;
  }
  get maxTicks(): number | null {
    return this._maxTicks;
  }
  get traceRng(): boolean {
    return this._traceRng;
  }
  get rtx(): boolean {
    return this._rtx;
  }
  get showReplayWidget(): boolean {
    return this._showReplayWidget;
  }
  get replay(): Replay | null {
    return this._replay;
  }
  get runtime(): WorldRuntime | null {
    return this._runtime;
  }
  get small(): SmallFontData | null {
    return this._small;
  }
  get hudState(): HudState {
    return this._hudState;
  }
  get grimMono(): GrimMonoFont | null {
    return this._grimMono;
  }
  get questTitle(): string {
    return this._questTitle;
  }
  get questLevel(): QuestLevel | null {
    return this._questLevel;
  }
  get tickRate(): number {
    return this._tickRate;
  }
  get dt(): number {
    return this._dt;
  }
  get dtAccum(): number {
    return this._dtAccum;
  }
  get clock(): FixedStepClock {
    return this._clock;
  }
  get frameIndex(): number {
    return this._frameIndex;
  }
  get paused(): boolean {
    return this._paused;
  }
  get stepOncePending(): boolean {
    return this._stepOncePending;
  }
  get speedIndex(): number {
    return this._speedIndex;
  }
  get driver(): PlaybackDriver | null {
    return this._driver;
  }
  get questTotalSpawnCount(): number {
    return this._questTotalSpawnCount;
  }
  get audio(): AudioState | null {
    return this._audio;
  }
  get audioRng(): Crand | null {
    return this._audioRng;
  }

  constructor(ctx: ViewContext, opts: { replayPath: string; config: CrimsonConfig; console: ConsoleState; maxTicks?: number | null; traceRng?: boolean; rtx?: boolean; showReplayWidget?: boolean }) {
    const replayPath = opts.replayPath;
    const config = opts.config;
    const console = opts.console;
    const maxTicks = opts.maxTicks ?? null;
    const traceRng = opts.traceRng ?? false;
    const rtx = opts.rtx ?? false;
    const showReplayWidget = opts.showReplayWidget ?? true;
    this._ctx = ctx;
    this._replayPath = replayPath;
    this._config = config;
    this._console = console;
    this._maxTicks = maxTicks !== null ? Math.max(0, int(maxTicks)) : null;
    this._traceRng = traceRng;
    this._rtx = rtx;
    this._showReplayWidget = showReplayWidget;

    this.closeRequested = false;

    this._replay = null;
    this._runtime = null;
    this._small = null;
    this._hudState = new HudState();
    this._grimMono = null;
    this._questTitle = '';
    this._questLevel = null;

    this._tickRate = 60;
    this._dt = 1.0 / 60.0;
    this._dtAccum = 0.0;
    this._clock = new FixedStepClock({ tickRate: 60 });
    this._frameIndex = 0;
    this._tickIndex = 0;
    this._finished = false;
    this._paused = false;
    this._stepOncePending = false;
    this._speedIndex = _DEFAULT_SPEED_INDEX;

    this._driver = null;
    this._questTotalSpawnCount = 0;

    this._audio = null;
    this._audioRng = null;
  }

  get tickIndex(): number {
    return int(this._tickIndex);
  }

  get finished(): boolean {
    return this._finished;
  }

  protected static _formatTimeText(seconds: number): string {
    const totalSeconds = Math.max(0, int(seconds));
    const minutes = Math.floor(totalSeconds / 60);
    const remSeconds = totalSeconds % 60;
    return `${minutes}:${String(remSeconds).padStart(2, '0')}`;
  }

  protected _replayProgressRatio(): number {
    const replay = this._replay;
    if (replay === null) {
      return 0.0;
    }
    const totalTicks = replay.ticks.length;
    if (totalTicks <= 0) {
      return 1.0;
    }
    const ratio = this._tickIndex / totalTicks;
    if (ratio < 0.0) {
      return 0.0;
    }
    if (ratio > 1.0) {
      return 1.0;
    }
    return ratio;
  }

  protected _registerReplayAudioCommands(): void {
    const console = this._console;

    const cmdSndAddGameTune = (args: string[]): void => {
      if (args.length !== 1) {
        console.log.log('snd_addGameTune <tuneName.ogg>');
        return;
      }
      const audio = this._audio;
      if (audio === null) {
        return;
      }
      const relPath = `music/${args[0]}`;
      const result = grimMusic.loadMusicTrack(audio.music, this._ctx.assetsDir, relPath, { console: console });
      if (result === null) {
        return;
      }
      const [trackKey, trackId] = result;
      grimMusic.queueTrack(audio.music, trackKey);
    };

    console.registerCommand('snd_addGameTune', cmdSndAddGameTune);
  }

  protected _loadGameTuneQueue(): void {
    if (this._audio === null) {
      return;
    }
    this._console.execLine('exec music/game_tunes.txt');
  }

  protected _drawWorld(opts: { drawAimIndicators?: boolean; entityAlpha?: number } = {}): void {
    const drawAimIndicators = opts.drawAimIndicators ?? true;
    const entityAlpha = opts.entityAlpha ?? 1.0;
    const runtime = this._runtime;
    if (runtime === null) {
      return;
    }
    runtime.draw({
      drawAimIndicators: drawAimIndicators,
      entityAlpha: entityAlpha,
    });
  }

  protected _replayWidgetMetrics(): [number, number, number, number, number, number] {
    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const scale = hudUiScale(screenW, screenH);

    const panelW = _REPLAY_WIDGET_PANEL_SIZE.x * scale;
    const panelH = _REPLAY_WIDGET_PANEL_SIZE.y * scale;
    const panelX = screenW - panelW - _REPLAY_WIDGET_X_SHIFT * scale;
    const line1Y = _REPLAY_WIDGET_TEXT_LINE1_Y * scale;
    const panelY = Math.max(2.0 * scale, line1Y + _REPLAY_WIDGET_PANEL_TO_LINE1_Y * scale);
    return [scale, panelX, panelY, panelW, panelH, line1Y];
  }

  protected _drawReplayWidget(): void {
    const replay = this._replay;
    if (replay === null) {
      return;
    }

    let [scale, panelX, panelY, panelW, panelH, line1Y] = this._replayWidgetMetrics();
    panelX += _REPLAY_WIDGET_PANEL_OFFSET_X * scale;
    panelY += _REPLAY_WIDGET_PANEL_OFFSET_Y * scale;

    const runtime = this._runtime;
    if (!(runtime !== null)) throw new Error('World runtime must be open before replay draw');
    const resources = runtime.renderResources.resources;

    const iconW = _REPLAY_WIDGET_ICON_SIZE.x * scale;
    const iconH = _REPLAY_WIDGET_ICON_SIZE.y * scale;
    const iconX = panelX + 2.0 * scale + _REPLAY_WIDGET_CLOCK_OFFSET_X * scale;
    const iconY = panelY + 8.0 * scale + _REPLAY_WIDGET_CLOCK_OFFSET_Y * scale;

    const clockTable = resources.texture(TextureId.UI_CLOCK_TABLE);
    let src = wgl.makeRectangle(0.0, 0.0, clockTable.width, clockTable.height);
    let dst = wgl.makeRectangle(iconX, iconY, iconW, iconH);
    wgl.drawTexturePro(clockTable, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 230 / 255));

    const elapsedSeconds = this._tickIndex / this._tickRate;

    const clockPointer = resources.texture(TextureId.UI_CLOCK_POINTER);
    src = wgl.makeRectangle(0.0, 0.0, clockPointer.width, clockPointer.height);
    const centerX = iconX + iconW * 0.5;
    const centerY = iconY + iconH * 0.5;
    dst = wgl.makeRectangle(centerX, centerY, iconW, iconH);
    const origin = wgl.makeVector2(iconW * 0.5, iconH * 0.5);
    const rotation = Math.max(0.0, elapsedSeconds) * 6.0;
    wgl.drawTexturePro(clockPointer, src, dst, origin, rotation, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 220 / 255));

    const totalTicks = replay.ticks.length;
    const totalSeconds = totalTicks / this._tickRate;
    const progressRatio = this._replayProgressRatio();

    const textX = iconX + iconW + 6.0 * scale + _REPLAY_WIDGET_TEXT_OFFSET_X * scale;
    line1Y = line1Y + _REPLAY_WIDGET_TEXT_OFFSET_Y * scale;
    const textScale = 1.0;
    const status = this._paused ? 'PAUSE' : 'REPLAY';
    const statusColor = this._paused ? wgl.makeColor(245 / 255, 210 / 255, 120 / 255, 230 / 255) : wgl.makeColor(230 / 255, 230 / 255, 230 / 255, 220 / 255);
    this._drawUiText(
      `${status} ${(this._playbackSpeed()).toFixed(2)}x`,
      new Vec2(textX, line1Y),
      statusColor,
      { scale: textScale },
    );

    const elapsedText = ReplayPlaybackMode._formatTimeText(elapsedSeconds);
    const totalText = ReplayPlaybackMode._formatTimeText(totalSeconds);
    const elapsedW = this._measureUiTextWidth(elapsedText, { scale: textScale });
    const totalW = this._measureUiTextWidth(totalText, { scale: textScale });
    const line2Y = line1Y + 18.0 * scale;

    const rightLimit = panelX + panelW - 4.0 * scale + _REPLAY_WIDGET_TEXT_OFFSET_X * scale;
    const totalX = rightLimit - totalW;
    const barXBase = textX + elapsedW + 6.0 * scale;
    const barW = Math.max(8.0 * scale, totalX - 6.0 * scale - barXBase);
    const barX = barXBase + _REPLAY_WIDGET_BAR_OFFSET_X * scale;
    const barY = line2Y + 5.0 * scale + _REPLAY_WIDGET_BAR_OFFSET_Y * scale;
    const barH = _REPLAY_WIDGET_BAR_HEIGHT * scale;
    wgl.drawRectangle(int(barX), int(barY), int(barW), int(barH), wgl.makeColor(46 / 255, 67 / 255, 96 / 255, 150 / 255));
    const fillW = barW * progressRatio;
    if (fillW > 0.0) {
      wgl.drawRectangle(int(barX), int(barY), int(fillW), int(barH), wgl.makeColor(70 / 255, 130 / 255, 220 / 255, 225 / 255));
    }

    this._drawUiText(
      elapsedText,
      new Vec2(textX, line2Y),
      wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 210 / 255),
      { scale: textScale },
    );
    this._drawUiText(
      totalText,
      new Vec2(totalX, line2Y),
      wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 210 / 255),
      { scale: textScale },
    );
  }

  async open(): Promise<void> {
    this._small = loadSmallFont(this._ctx.assetsDir);
    this._hudState = new HudState();
    this._grimMono = null;
    this._questTitle = '';

    const replay = await loadReplayFile(this._replayPath);
    this._replay = replay;
    warnOnGameVersionMismatch(replay, { action: 'playback' });

    const tickRate = int(replay.header.tickRate);
    if (tickRate <= 0) {
      throw new Error(`invalid tick_rate: ${tickRate}`);
    }
    this._tickRate = tickRate;
    this._dt = 1.0 / tickRate;
    this._dtAccum = 0.0;
    this._clock = new FixedStepClock({ tickRate: int(tickRate) });
    this._frameIndex = 0;
    this._tickIndex = 0;
    this._finished = false;
    this._paused = false;
    this._stepOncePending = false;
    this._speedIndex = _DEFAULT_SPEED_INDEX;
    this._driver = null;

    const worldSize = replay.header.worldSize;
    const audio = initAudioState(this._config, this._ctx.assetsDir, this._console);
    const audioRng = new Crand((int(replay.header.seed) >>> 0));
    this._audio = audio;
    this._audioRng = audioRng;
    this._registerReplayAudioCommands();
    this._loadGameTuneQueue();

    const questFailRetryCount = int(replay.header.questFailRetryCount);
    const hardcore = Boolean(replay.header.hardcore);
    const preserveBugs = Boolean(replay.header.preserveBugs);
    const rtxMode = modeFromRtxFlag(this._rtx);

    const runtime = new WorldRuntime({ assetsDir: this._ctx.assetsDir, worldSize: worldSize, demoModeActive: false, questFailRetryCount: int(questFailRetryCount), hardcore: hardcore, preserveBugs: preserveBugs, config: this._config, audio: this._audio, audioRng: this._audioRng, rtxMode: rtxMode });
    this._runtime = runtime;
    runtime.reset({
      seed: int(replay.header.seed),
      playerCount: int(replay.header.playerCount),
    });
    runtime.openRuntime();

    const simWorld = runtime.simWorld;
    let driver: PlaybackDriver | null;
    try {
      this._driver = buildRuntimePlaybackDriver(replay, { maxTicks: this._maxTicks, traceRng: this._traceRng, worldSize: worldSize });
      driver = this._driver;
      simWorld.loadWorldState(driver.world);
    } catch (exc) {
      if (!(exc instanceof ReplayRunnerError)) {
        throw exc;
      }
      throw new Error(`unsupported replay game_mode_id: ${int(replay.header.gameModeId)}`);
    }

    this._hudState.preserveBugs = Boolean(simWorld.state.preserveBugs);

    driver = this._driver;
    if (!(driver !== null)) throw new Error('Replay driver must be initialized before replay view setup');
    const terrainSetup = driver.terrainSetup;
    if (terrainSetup !== null) {
      runtime.terrainRuntime.applyTerrainSetup({
        terrainSlots: terrainSetup.terrainSlots,
        seed: int(terrainSetup.terrainSeed),
      });
    }

    const quest = driver.questDefinition;
    if (quest !== null) {
      this._questTitle = String(quest.title);
      this._questLevel = quest.level;
      this._grimMono = loadGrimMonoFont(this._ctx.assetsDir);
      this._questTotalSpawnCount = int(driver.questTotalSpawnCount);
    } else {
      this._questTotalSpawnCount = 0;
    }
  }

  close(): void {
    this._small = null;
    this._grimMono = null;
    this._driver = null;
    if (this._runtime !== null) {
      this._runtime.closeRuntime();
      this._runtime = null;
    }
    if (this._audio !== null) {
      shutdownAudio(this._audio);
      this._audio = null;
      this._audioRng = null;
    }
  }

  shouldClose(): boolean {
    return this.closeRequested;
  }

  consumeScreenshotRequest(): boolean {
    return false;
  }

  protected _drawUiText(text: string, pos: Vec2, color: wgl.Color, opts: { scale?: number } = {}): void {
    const scale = opts.scale ?? 1.0;
    const _ = scale;
    const font = this._small;
    if (!(font !== null)) throw new Error('small font must be loaded before replay ui draw');
    drawSmallText(font, text, pos, color);
  }

  protected _measureUiTextWidth(text: string, opts: { scale?: number } = {}): number {
    const scale = opts.scale ?? 1.0;
    const _ = scale;
    const font = this._small;
    if (!(font !== null)) throw new Error('small font must be loaded before replay ui measurement');
    return measureSmallTextWidth(font, text);
  }

  protected _buildPostApplyReaction(opts: { tickResult: TickResult }): PostApplyReaction {
    const tickResult = opts.tickResult;
    const driver = this._driver;
    return buildPostApplyReaction({ tickResult: tickResult, questState: driver === null ? null : driver.questSpawnState });
  }

  protected _applyPostApplyReaction(reaction: PostApplyReaction): void {
    const runtime = this._runtime;
    if (runtime === null) {
      return;
    }
    applyPostApplyReaction({
      reaction: reaction,
      playSfx: runtime.audioBridge.router.playSfx.bind(runtime.audioBridge.router),
      playCompletionMusic: this._playQuestCompletionMusic.bind(this),
    });
  }

  protected _playQuestCompletionMusic(): void {
    if (this._audio === null) {
      return;
    }
    playMusic(this._audio, 'crimsonquest');
    const playback = this._audio.music.playbacks.get('crimsonquest') ?? null;
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

  protected _tickLimit(): number {
    const replay = this._replay;
    if (replay === null) {
      return 0;
    }
    const totalTicks = replay.ticks.length;
    if (this._maxTicks === null) {
      return int(totalTicks);
    }
    return Math.min(int(totalTicks), Math.max(0, int(this._maxTicks)));
  }

  protected _markFinishedIfComplete(): void {
    const tickLimit = int(this._tickLimit());
    if (int(this._tickIndex) < int(tickLimit)) {
      return;
    }
    this._finished = true;
  }

  protected _advanceRunner(opts: { dtSeconds: number; maxTicks?: number | null }): void {
    const dtSeconds = opts.dtSeconds;
    const maxTicks = opts.maxTicks ?? null;
    const replay = this._replay;
    const runtime = this._runtime;
    const driver = this._driver;
    if (replay === null || runtime === null || driver === null) {
      this._finished = true;
      return;
    }
    const tickLimit = int(this._tickLimit());
    if (int(this._tickIndex) >= tickLimit) {
      this._markFinishedIfComplete();
      return;
    }

    const frameDt = dtSeconds;
    const advance = advancePlaybackFrame({ driver: driver, simWorld: runtime.simWorld, clock: this._clock, startTick: int(this._tickIndex), frameIndex: int(this._frameIndex), dtSeconds: frameDt, maxTicks: maxTicks, tickLimit: int(tickLimit), gameTuneStarted: Boolean(driver.session.gameTuneStarted) });
    this._frameIndex = int(advance.frameIndex);
    this._tickIndex = int(advance.nextTickIndex);

    const _onOutputApplied = (output: PresentationTickOutput): void => {
      this._applyPostApplyReaction(mapGetOrThrow(reactionByTick, int(output.tickIndex)));
    };

    const reactionByTick = new Map(Array.from(advance.tickResults, (tickResult) => [int(tickResult.sourceTick.tickIndex), this._buildPostApplyReaction({ tickResult: tickResult })] as const));
    if (advance.outputs.length > 0) {
      applyPresentationOutputs({
        outputs: advance.outputs,
        syncAudioBridgeState: runtime.syncAudioBridgeState.bind(runtime),
        applyAudioPlan: (plan, shouldApplyAudio) => runtime.audioBridge.applyPlan({ plan: plan, applyAudio: Boolean(shouldApplyAudio) }),
        applyTerrainFx: runtime.renderResources.consumeTerrainFxBatch,
        updateCamera: runtime.updateCamera.bind(runtime),
        onOutputApplied: _onOutputApplied,
        applyAudio: true,
      });
    } else {
      for (const output of advance.outputs) {
        _onOutputApplied(output);
      }
    }

    this._markFinishedIfComplete();
    this._dtAccum = this._clock.accum;
  }

  protected _playbackSpeed(): number {
    return PLAYBACK_SPEED_STEPS[int(this._speedIndex)];
  }

  protected _changeSpeed(delta: number): void {
    let idx = int(this._speedIndex) + int(delta);
    idx = Math.max(0, Math.min(idx, PLAYBACK_SPEED_STEPS.length - 1));
    this._speedIndex = idx;
  }

  protected _skipForwardSeconds(seconds: number): void {
    const replay = this._replay;
    if (replay === null || this._finished) {
      return;
    }
    const ticks = int(pyRound(seconds * this._tickRate));
    if (ticks <= 0) {
      return;
    }
    const target = Math.min(int(this._tickLimit()), int(this._tickIndex) + int(ticks));
    const audioBridge = this._runtime !== null ? this._runtime.audioBridge : null;
    let prevSfxEnabled: boolean | null = null;
    if (audioBridge !== null && audioBridge.router !== null) {
      prevSfxEnabled = Boolean(audioBridge.router.sfxEnabled);
      audioBridge.router.sfxEnabled = false;
    }
    try {
      const ticksToAdvance = Math.max(0, int(target) - int(this._tickIndex));
      if (ticksToAdvance > 0) {
        this._advanceRunner({
          dtSeconds: ticksToAdvance * this._dt,
          maxTicks: int(ticksToAdvance),
        });
      }
    } finally {
      if (prevSfxEnabled !== null && audioBridge !== null && audioBridge.router !== null) {
        audioBridge.router.sfxEnabled = prevSfxEnabled;
      }
    }
    this._clock.reset();
    this._dtAccum = 0.0;
  }

  update(dt: number): void {
    if (InputState.wasKeyPressed(27)) {
      this.closeRequested = true;
      return;
    }
    if (InputState.wasKeyPressed(32)) {
      this._paused = !this._paused;
    }
    if (InputState.wasKeyPressed(190) && this._paused) {
      this._stepOncePending = true;
    }
    if (InputState.wasKeyPressed(219)) {
      this._changeSpeed(-1);
    }
    if (InputState.wasKeyPressed(221)) {
      this._changeSpeed(1);
    }
    if (InputState.wasKeyPressed(49)) {
      this._speedIndex = _DEFAULT_SPEED_INDEX;
    }
    if (InputState.wasKeyPressed(39)) {
      this._skipForwardSeconds(_SKIP_SHORT_SECONDS);
    }
    if (InputState.wasKeyPressed(34)) {
      this._skipForwardSeconds(_SKIP_LONG_SECONDS);
    }

    if (!this._finished && this._paused && this._stepOncePending) {
      this._clock.reset();
      this._advanceRunner({
        dtSeconds: this._dt,
        maxTicks: 1,
      });
      this._clock.reset();
      this._stepOncePending = false;
      this._dtAccum = 0.0;
    }

    if (!this._finished && !this._paused) {
      if (dt < 0.0) {
        dt = 0.0;
      }
      if (dt > 0.1) {
        dt = 0.1;
      }
      this._advanceRunner({
        dtSeconds: dt * this._playbackSpeed(),
      });
    }

    if (this._audio !== null) {
      updateAudio(this._audio, dt);
    }

    // Runtime open schedules terrain generation, but replay advances
    // deterministic world ticks directly, so we must process pending ground
    // work explicitly.
    if (this._runtime !== null) {
      const ground = this._runtime.renderResources.ground;
      if (ground !== null) {
        ground.processPending();
      }
    }
  }

  protected _drawQuestTitle(): void {
    const replay = this._replay;
    if (replay === null || replay.header.gameModeId !== GameMode.QUESTS) {
      return;
    }
    const font = this._grimMono;
    if (font === null) {
      return;
    }
    const title = String(this._questTitle || '');
    const level = this._questLevel;
    if (!title || level === null) {
      return;
    }
    const driver = this._driver;
    if (driver === null || driver.questSpawnState === null) {
      return;
    }

    drawQuestTitleTimerOverlay(
      font,
      title,
      level.text,
      { timerMs: driver.questSpawnState.spawnTimelineMs },
    );
  }

  protected _drawQuestCompleteBanner(): void {
    const replay = this._replay;
    if (replay === null || replay.header.gameModeId !== GameMode.QUESTS) {
      return;
    }
    const runtime = this._runtime;
    if (!(runtime !== null)) throw new Error('World runtime must be open before replay quest banner draw');
    const driver = this._driver;
    if (driver === null || driver.questSpawnState === null) {
      return;
    }
    drawQuestCompleteBannerOverlay(
      runtime.renderResources.resources.texture(TextureId.UI_TEXT_LEVEL_COMPLETE),
      { timerMs: driver.questSpawnState.completionTransitionMs },
    );
  }

  protected _drawTypoNameLabels(): void {
    const runtime = this._runtime;
    if (!(runtime !== null)) throw new Error('World runtime must be open before Typ-o replay draw');
    drawTypoNameLabels({
      creatures: runtime.simWorld.creatures.entries,
      names: runtime.simWorld.state.typo.names.names,
      worldToScreen: runtime.renderer.worldToScreen,
      drawText: (text, pos, color, scale) => this._drawUiText(text, pos, color, { scale: scale }),
      measureTextWidth: (text, scale) => this._measureUiTextWidth(text, { scale: scale }),
    });
  }

  protected _drawTypingBox(): void {
    const runtime = this._runtime;
    if (!(runtime !== null)) throw new Error('World runtime must be open before Typ-o replay draw');
    const driver = this._driver;
    const cursorPulseTime = driver === null ? 0.0 : driver.elapsedMs * 0.001;
    drawTypingBox(
      runtime.renderResources.resources.texture(TextureId.UI_IND_PANEL),
      { text: runtime.simWorld.state.typo.typing.text, cursorPulseTime: cursorPulseTime, drawText: (text, pos, color, scale) => this._drawUiText(text, pos, color, { scale: scale }), measureTextWidth: (text, scale) => this._measureUiTextWidth(text, { scale: scale }) },
    );
  }

  protected _drawTutorialOverlays(): void {
    const runtime = this._runtime;
    if (!(runtime !== null)) throw new Error('World runtime must be open before tutorial replay draw');
    drawTutorialOverlayPanels(
      runtime.simWorld.state.tutorialOverlay,
      { drawText: (text, pos, color, scale) => this._drawUiText(text, pos, color, { scale: scale }), measureTextWidth: (text, scale) => this._measureUiTextWidth(text, { scale: scale }), measureLineHeight: (scale) => int(this._small !== null ? this._small.cellSize * scale : 20 * scale) },
    );
  }

  draw(): void {
    const runtime = this._runtime;
    if (!(runtime !== null)) throw new Error('World runtime must be open before replay draw');
    const replay = this._replay;
    if (!(replay !== null)) throw new Error('Replay must be loaded before replay draw');
    const simWorld = runtime.simWorld;
    const players = simWorld.players;
    if (!(players.length > 0)) throw new Error('Replay runtime must have at least one player before draw');
    this._drawWorld({ drawAimIndicators: true });
    const modeId = replay.header.gameModeId;
    const showTypoUi = modeId === GameMode.TYPO && players[0].health > 0.0;
    const hudFlags = hudFlagsForGameMode(modeId);
    let questProgressRatio: number | null = null;
    let elapsedMs = simWorld.presentationElapsedMs;
    let driver: PlaybackDriver | null;
    switch (modeId) {
      case GameMode.QUESTS:
        const total = int(this._questTotalSpawnCount);
        const kills = int(simWorld.creatures.killCount);
        questProgressRatio = total > 0 ? kills / total : null;
        driver = this._driver;
        if (driver !== null) {
          elapsedMs = driver.elapsedMs;
        }
        break;
      default:
        driver = this._driver;
        if (driver !== null) {
          elapsedMs = driver.elapsedMs;
        }
        break;
    }
    if (showTypoUi) {
      this._drawTypoNameLabels();
    }
    drawHudOverlay(
      new HudRenderContext({ resources: runtime.renderResources.resources, state: this._hudState, font: this._small, showHealth: hudFlags.showHealth, showWeapon: hudFlags.showWeapon, showXp: hudFlags.showXp, showTime: hudFlags.showTime, showQuestHud: hudFlags.showQuestHud, smallIndicators: false }),
      { player: players[0], players: players, bonusHud: simWorld.state.bonusHud, elapsedMs: elapsedMs, frameDtMs: Math.max(0.0, wgl.getFrameTime()) * 1000.0, questProgressRatio: questProgressRatio },
    );

    this._drawQuestTitle();
    this._drawQuestCompleteBanner();
    if (modeId === GameMode.TUTORIAL) {
      this._drawTutorialOverlays();
    }
    if (showTypoUi) {
      this._drawTypingBox();
    }

    if (this._showReplayWidget) {
      this._drawReplayWidget();
    }
  }
}
