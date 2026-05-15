// Port of crimson/game/runtime.py

import { loadMusicTrack, queueTrack } from '@grim/music.ts';
import { ensureCrimsonCfg } from '@grim/config.ts';
import { type ConsoleState, type CommandHandler, createConsole, registerBootCommands, registerCoreCvars } from '@grim/console.ts';
import { Crand } from '@grim/rand.ts';
import * as wgl from '@wgl';
import { downloadMissingPaqs } from '@crimson/assets-fetch.ts';
import { setDebugEnabled } from '@crimson/debug.ts';
import { DEMO_QUEST_GRACE_TIME_MS, DEMO_TOTAL_PLAY_TIME_MS, demoTrialOverlayInfo, formatDemoTrialTime } from '@crimson/demo-trial.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { ensureGameStatus } from '@crimson/persistence/save-status.ts';
import { cycleRtxRenderMode, modeFromRtxFlag, parseRtxRenderMode } from '@crimson/render/rtx/mode.ts';
import { GameLoopView } from './loop-view.ts';
import { type GameConfig, GameState } from './types.ts';

export const CRIMSON_PAQ_NAME = 'crimson.paq';
export const MUSIC_PAQ_NAME = 'music.paq';
export const SFX_PAQ_NAME = 'sfx.paq';
export const AUTOEXEC_NAME = 'autoexec.txt';
export const REQUIRED_RUNTIME_PAQS: readonly string[] = [
  CRIMSON_PAQ_NAME,
  MUSIC_PAQ_NAME,
  SFX_PAQ_NAME,
];

function runtimeDownloadTargets(_assetsDir: string): readonly string[] {
  // WebGL loads PAQ assets through URL fetches during boot; there is no synchronous filesystem scan.
  return [];
}

function requireRuntimeAssets(_assetsDir: string): void {
  // WebGL cannot synchronously stat local archives; boot/resource loading reports fetch failures.
}

function parseFloatArg(value: string): number {
  const stripped = value.trim();
  if (/^[+-]?nan$/i.test(stripped)) return Number.NaN;
  if (/^[+-]?inf(?:inity)?$/i.test(stripped)) {
    return stripped.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (stripped.length === 0) return 0.0;
  const digits = String.raw`\d(?:_?\d)*`;
  const decimalPattern = new RegExp(
    String.raw`^[+-]?(?:(?:${digits}(?:\.(?:${digits})?)?|\.(?:${digits}))(?:[eE][+-]?${digits})?)$`,
  );
  if (!decimalPattern.test(stripped)) return 0.0;
  return Number(stripped.replaceAll('_', ''));
}

function parseDemoTrialMsArg(value: string): number {
  const parsed = parseFloatArg(value);
  if (Number.isNaN(parsed)) return 0;
  if (!Number.isFinite(parsed)) {
    throw new RangeError('cannot convert float infinity to integer');
  }
  return int(parsed);
}

function applyDebugConsoleDefaults(console: ConsoleState, opts: { debug: boolean }): void {
  const { debug } = opts;
  if (!debug) return;
  console.registerCvar('cv_showFPS', '1');
}

function bootCommandHandlers(
  state: GameState,
): Record<string, CommandHandler> {
  const con = state.console;

  function cmdSetGammaRamp(args: string[]): void {
    if (args.length !== 1) {
      con.log.log('setGammaRamp <scalar > 0>');
      con.log.log('Command adjusts gamma ramp linearly by multiplying with given scalar');
      return;
    }
    const value = parseFloatArg(args[0]);
    state.gammaRamp = value;
    con.log.log(`Gamma ramp regenerated and multiplied with ${value.toFixed(6)}`);
  }

  function cmdSndAddGameTune(args: string[]): void {
    if (args.length !== 1) {
      con.log.log('snd_addGameTune <tuneName.ogg>');
      return;
    }
    const relPath = `music/${args[0]}`;
    const audio = state.audio;
    if (!audio || !audio.audioContext) {
      return;
    }
    loadMusicTrack(audio.music, audio.audioContext, state.assetsDir, relPath, { console: con })
      .then((result) => {
        if (result) {
          const [key, trackId] = result;
          void trackId;
          queueTrack(audio.music, key);
        }
      });
  }

  function cmdGenerateTerrain(_args: string[]): void {
    state.terrainRegenerateRequested = true;
  }

  function cmdTellTimeSurvived(_args: string[]): void {
    const seconds = int(Math.max(0.0, state.survivalElapsedMs) * 0.00100000005);
    con.log.log(`Survived: ${seconds} seconds.`);
  }

  function cmdSetResourcePaq(args: string[]): void {
    if (args.length !== 1) {
      con.log.log('setresourcepaq <resourcepaq>');
      return;
    }
    con.log.log('setresourcepaq is not supported in the rewrite.');
  }

  function cmdLoadTexture(args: string[]): void {
    if (args.length !== 1) {
      con.log.log('loadtexture <texturefileid>');
      return;
    }
    con.log.log('loadtexture is not supported in the rewrite.');
  }

  function cmdOpenUrl(args: string[]): void {
    if (args.length !== 1) {
      con.log.log('openurl <url>');
      return;
    }
    const url = args[0];
    let ok = false;
    try {
      ok = window.open(url, '_blank') !== null;
    } catch {
      ok = false;
    }
    if (ok) {
      con.log.log(`Launching web browser (${url})..`);
    } else {
      con.log.log('Failed to launch web browser.');
    }
  }

  function cmdSndFreqAdjustment(_args: string[]): void {
    state.sndFreqAdjustmentEnabled = !state.sndFreqAdjustmentEnabled;
    if (state.sndFreqAdjustmentEnabled) {
      con.log.log('Sound frequency adjustment is now enabled.');
    } else {
      con.log.log('Sound frequency adjustment is now disabled.');
    }
  }

  function cmdDemoTrialSetPlaytime(args: string[]): void {
    if (args.length !== 1) {
      con.log.log('demoTrialSetPlaytime <ms>');
      return;
    }
    const value = parseDemoTrialMsArg(args[0]);
    state.status.gameSequenceId = Math.max(0, value);
    state.status.saveIfDirty();
    con.log.log(
      `demo trial: playtime=${state.status.gameSequenceId}ms (total ${DEMO_TOTAL_PLAY_TIME_MS}ms)`,
    );
  }

  function cmdDemoTrialSetGrace(args: string[]): void {
    if (args.length !== 1) {
      con.log.log('demoTrialSetGrace <ms>');
      return;
    }
    const value = parseDemoTrialMsArg(args[0]);
    state.demoTrialElapsedMs = Math.max(0, value);
    con.log.log(
      `demo trial: quest grace=${state.demoTrialElapsedMs}ms (total ${DEMO_QUEST_GRACE_TIME_MS}ms)`,
    );
  }

  function cmdDemoTrialReset(_args: string[]): void {
    state.status.gameSequenceId = 0;
    state.status.saveIfDirty();
    state.demoTrialElapsedMs = 0;
    con.log.log('demo trial: timers reset');
  }

  function cmdDemoTrialInfo(_args: string[]): void {
    const modeRaw = state.config.gameplay.mode;
    let modeId = GameMode.DEMO;
    if (Object.values(GameMode).includes(modeRaw)) {
      modeId = modeRaw;
    }
    let questLevel = null;
    if (modeId === GameMode.QUESTS) {
      questLevel = state.pendingQuestLevel;
    }
    const info = demoTrialOverlayInfo({
      demoBuild: state.demoEnabled,
      gameModeId: modeId,
      globalPlaytimeMs: int(state.status.gameSequenceId),
      questGraceElapsedMs: int(state.demoTrialElapsedMs),
      questLevel,
    });
    const remaining = formatDemoTrialTime(info.remainingMs);
    con.log.log(
      'demo trial: ' +
        `demo=${state.demoEnabled ? 1 : 0} ` +
        `mode=${modeId} ` +
        `quest=${questLevel !== null ? `${questLevel.major}.${questLevel.minor}` : '0.0'} ` +
        `playtime=${state.status.gameSequenceId}ms ` +
        `grace=${state.demoTrialElapsedMs}ms ` +
        `visible=${info.visible ? 1 : 0} ` +
        `kind=${info.kind} ` +
        `remaining=${remaining}`,
    );
  }

  function cmdRenderMode(args: string[]): void {
    if (args.length > 1) {
      con.log.log('rendermode <classic|rtx>');
      return;
    }
    if (args.length === 0) {
      con.log.log(`Render mode is '${state.rtxMode}'.`);
      return;
    }
    try {
      const mode = parseRtxRenderMode(args[0]);
      state.rtxMode = mode;
      con.log.log(`Render mode set to '${state.rtxMode}'.`);
    } catch {
      con.log.log('rendermode <classic|rtx>');
    }
  }

  function cmdToggleRtx(args: string[]): void {
    if (args.length > 0) {
      con.log.log('togglertx');
      return;
    }
    state.rtxMode = cycleRtxRenderMode(state.rtxMode);
    con.log.log(`Render mode set to '${state.rtxMode}'.`);
  }

  return {
    setGammaRamp: cmdSetGammaRamp,
    snd_addGameTune: cmdSndAddGameTune,
    generateterrain: cmdGenerateTerrain,
    telltimesurvived: cmdTellTimeSurvived,
    setresourcepaq: cmdSetResourcePaq,
    loadtexture: cmdLoadTexture,
    openurl: cmdOpenUrl,
    sndfreqadjustment: cmdSndFreqAdjustment,
    demoTrialSetPlaytime: cmdDemoTrialSetPlaytime,
    demoTrialSetGrace: cmdDemoTrialSetGrace,
    demoTrialReset: cmdDemoTrialReset,
    demoTrialInfo: cmdDemoTrialInfo,
    rendermode: cmdRenderMode,
    togglertx: cmdToggleRtx,
  };
}

function resolveAssetsDir(config: GameConfig): string {
  if (config.assetsDir !== null) {
    return config.assetsDir;
  }
  return config.baseDir;
}

export function runGame(
  config: GameConfig,
): { view: GameLoopView; state: GameState } {
  if (config.debug) {
    setDebugEnabled(true);
  }
  const cfg = ensureCrimsonCfg(config.baseDir);
  const width = config.width ?? cfg.display.width;
  const height = config.height ?? cfg.display.height;
  cfg.display.width = width;
  cfg.display.height = height;
  wgl.resize(width, height);

  const rng = config.seed === null ? new Crand() : new Crand(config.seed);
  const assetsDir = resolveAssetsDir(config);

  const console = createConsole(config.baseDir, assetsDir);
  const status = ensureGameStatus(config.baseDir);

  const state = new GameState({
    baseDir: config.baseDir,
    assetsDir,
    rng,
    config: cfg,
    status,
    console,
    demoEnabled: config.demoEnabled,
    preserveBugs: config.preserveBugs,
    skipIntro: config.noIntro,
    resources: null,
    audio: null,
    sessionStart: performance.now() / 1000.0,
    rtxMode: modeFromRtxFlag(config.rtx),
    pendingNetworkSession: config.pendingNetworkSession,
  });

  const handlers = bootCommandHandlers(state);
  registerBootCommands(console, handlers);
  registerCoreCvars(console, width, height);
  applyDebugConsoleDefaults(console, { debug: config.debug });

  console.log.log('crimson: boot start');
  console.log.log(
    `config: ${cfg.display.width}x${cfg.display.height} windowed=${cfg.display.windowed}`,
  );
  console.log.log(`status: ${status.path.split(/[\\/]/).pop() ?? status.path} loaded`);
  console.log.log(`assets: ${assetsDir}`);
  downloadMissingPaqs(assetsDir, console, { names: runtimeDownloadTargets(assetsDir) });
  requireRuntimeAssets(assetsDir);
  console.log.log(`assets: required archives ready (${REQUIRED_RUNTIME_PAQS.join(', ')})`);
  console.log.log(`commands: ${console.commands.size} registered`);
  console.log.log(`cvars: ${console.cvars.size} registered`);
  console.execLine(`exec ${AUTOEXEC_NAME}`);
  console.log.flush();

  const view = new GameLoopView(state);

  return { view, state };
}
