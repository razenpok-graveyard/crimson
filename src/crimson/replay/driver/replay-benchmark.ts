// Port of crimson/replay/driver/replay_benchmark.py

import type { CrimsonConfig } from '@grim/config.ts';
import { ensureCrimsonCfg } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import { createConsole } from '@grim/console.ts';
import { rl } from '@grim/raylib-api.ts';
import { ViewContext } from '@grim/view.ts';
import { ReplayPlaybackMode } from '@crimson/modes/replay-playback-mode.ts';
import { Replay } from '@crimson/replay/index.ts';
import { PlaybackWalkHooks, buildVerifyPlaybackDriver } from '@crimson/replay/driver/playback-driver.ts';
import type { RenderTelemetryFrameSnapshot } from '@crimson/replay/driver/render-telemetry.ts';
import { RenderTelemetrySession } from '@crimson/replay/driver/render-telemetry.ts';
import { RunResult } from '@crimson/replay/driver/setup.ts';
import { loadRuntimeResources, unloadRuntimeResources } from '@grim/assets.ts';
import { downloadMissingPaqs } from '@crimson/assets-fetch.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import * as wgl from '@wgl';

export type ProfileSortKey = "cumtime" | "tottime";
export type HotspotSource = "project" | "all";

export interface ProgressBarLike {
  update(value: number): void;
  setPostfixStr(s: string, refresh?: boolean): void;
  close(): void;
}

export interface ProfileStatsLike {
  stats: Map<string, [number, number, number, number, unknown]>;
}

function pythonStartsWith(value: string | Uint8Array, prefix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(prefix)) {
    return prefix.some((item) => pythonStartsWith(value, item));
  }
  if (typeof value === 'string' && typeof prefix === 'string') {
    return value.startsWith(prefix);
  }
  if (typeof value === 'string' || typeof prefix === 'string') {
    return false;
  }
  return value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte);
}

function pythonEndsWith(value: string | Uint8Array, suffix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(suffix)) {
    return suffix.some((item) => pythonEndsWith(value, item));
  }
  if (typeof value === 'string' && typeof suffix === 'string') {
    return value.endsWith(suffix);
  }
  if (typeof value === 'string' || typeof suffix === 'string') {
    return false;
  }
  const offset = value.byteLength - suffix.byteLength;
  return offset >= 0 && suffix.every((byte, index) => value[offset + index] === byte);
}

function _basename(path: string): string {
  const normalized = path.replace(/\/+$/g, '');
  const idx = normalized.lastIndexOf('/');
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

function _dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) {
    return '.';
  }
  if (idx === 0) {
    return '/';
  }
  return path.slice(0, idx);
}

function _mkdirParents(path: string): void {
  mkdirSync(path, { recursive: true });
}

function pythonJsonDumps(value: unknown, opts: { sortKeys?: boolean; indent?: number; defaultRepr?: boolean } = {}): string {
  const normalized = pythonJsonValue(value, opts);
  return JSON.stringify(normalized, null, opts.indent ?? 0);
}

function pythonJsonValue(value: unknown, opts: { sortKeys?: boolean; defaultRepr?: boolean }): object | string | number | boolean | null {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => pythonJsonValue(item, opts));
  }
  if (value instanceof Map) {
    const entries = Array.from(value.entries(), ([key, item]) => [String(key), pythonJsonValue(item, opts)] as const);
    return Object.fromEntries(opts.sortKeys === true ? entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0) : entries);
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, pythonJsonValue(item, opts)] as const);
    return Object.fromEntries(opts.sortKeys === true ? entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0) : entries);
  }
  return opts.defaultRepr === true ? String(value) : null;
}

function writeRenderTelemetryCharts(opts: { frames: readonly unknown[]; outDir: string; telemetryJsonPath?: string | null }): Map<string, string> {
  const outDir = String(opts.outDir).replace(/\/+$/g, '');
  return new Map([
    ['frame_timing_svg', `${outDir}/frame_timing.svg`],
    ['draw_calls_svg', `${outDir}/draw_calls.svg`],
    ['pass_timing_stacked_svg', `${outDir}/pass_timing_stacked.svg`],
    ['report_md', `${outDir}/report.md`],
  ]);
}

function tqdm(_opts: { total?: number; unit?: string; desc?: string; leave?: boolean }): { update(value: number): void; setPostfixStr(s: string, refresh?: boolean): void; close(): void } {
  return {
    update(_value: number): void {},
    setPostfixStr(_s: string, _refresh = true): void {},
    close(): void {},
  };
}

class PythonProfile {
  readonly stats = new Map<[string, number, string], [number, number, number, number, unknown]>();

  enable(): void {}

  disable(): void {}

  dumpStats(_path: string): void {}
}

class PythonProfileStats {
  readonly stats: Map<[string, number, string], [number, number, number, number, unknown]>;

  constructor(profile: PythonProfile) {
    this.stats = profile.stats;
  }
}

function pythonProfileStats(profile: PythonProfile): PythonProfileStats {
  return new PythonProfileStats(profile);
}

function pythonFmean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('fmean requires at least one data point');
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function pythonStdev(values: readonly number[]): number {
  if (values.length < 2) {
    throw new Error('stdev requires at least two data points');
  }
  const mean = pythonFmean(values);
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
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

export class ReplayBenchmarkError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'ReplayBenchmarkError';
  }
}


export class BenchmarkSample {
  readonly wallMs: number;
  readonly ticksPerSecond: number;
  readonly realtimeX: number;

  constructor(opts: {
    wallMs: number;
    ticksPerSecond: number;
    realtimeX: number;
  }) {
    this.wallMs = opts.wallMs;
    this.ticksPerSecond = opts.ticksPerSecond;
    this.realtimeX = opts.realtimeX;
  }
}

export class BenchmarkAggregate {
  readonly min: number;
  readonly p50: number;
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
  readonly stdev: number;

  constructor(opts: {
    min: number;
    p50: number;
    mean: number;
    p95: number;
    max: number;
    stdev: number;
  }) {
    this.min = opts.min;
    this.p50 = opts.p50;
    this.mean = opts.mean;
    this.p95 = opts.p95;
    this.max = opts.max;
    this.stdev = opts.stdev;
  }
}

export class ReplayProfileHotspot {
  readonly file: string;
  readonly line: number;
  readonly function: string;
  readonly primitiveCalls: number;
  readonly totalCalls: number;
  readonly tottime: number;
  readonly cumtime: number;

  constructor(opts: {
    file: string;
    line: number;
    function: string;
    primitiveCalls: number;
    totalCalls: number;
    tottime: number;
    cumtime: number;
  }) {
    this.file = opts.file;
    this.line = opts.line;
    this.function = opts.function;
    this.primitiveCalls = opts.primitiveCalls;
    this.totalCalls = opts.totalCalls;
    this.tottime = opts.tottime;
    this.cumtime = opts.cumtime;
  }
}

export class ReplayProfileResult {
  readonly sort: ProfileSortKey;
  readonly top: number;
  readonly source: HotspotSource;
  readonly hotspots: readonly ReplayProfileHotspot[];

  constructor(opts: {
    sort: ProfileSortKey;
    top: number;
    source: HotspotSource;
    hotspots: readonly ReplayProfileHotspot[];
  }) {
    this.sort = opts.sort;
    this.top = opts.top;
    this.source = opts.source;
    this.hotspots = opts.hotspots;
  }
}

export class ReplayRenderTelemetryTopTick {
  readonly tickIndex: number;
  readonly frameIndex: number;
  readonly value: number;

  constructor(opts: {
    tickIndex: number;
    frameIndex: number;
    value: number;
  }) {
    this.tickIndex = opts.tickIndex;
    this.frameIndex = opts.frameIndex;
    this.value = opts.value;
  }
}

export class ReplayRenderTelemetryFrame {
  readonly frameIndex: number;
  readonly tickIndexBeforeUpdate: number;
  readonly tickIndexAfterUpdate: number;
  readonly updateMs: number;
  readonly drawMs: number;
  readonly frameMs: number;
  readonly drawCallsTotal: number;
  readonly drawCallsByApi: Map<string, number>;
  readonly drawCallsByPass: Map<string, number>;
  readonly passMs: Map<string, number>;

  constructor(opts: {
    frameIndex: number;
    tickIndexBeforeUpdate: number;
    tickIndexAfterUpdate: number;
    updateMs: number;
    drawMs: number;
    frameMs: number;
    drawCallsTotal: number;
    drawCallsByApi: Map<string, number>;
    drawCallsByPass: Map<string, number>;
    passMs: Map<string, number>;
  }) {
    this.frameIndex = opts.frameIndex;
    this.tickIndexBeforeUpdate = opts.tickIndexBeforeUpdate;
    this.tickIndexAfterUpdate = opts.tickIndexAfterUpdate;
    this.updateMs = opts.updateMs;
    this.drawMs = opts.drawMs;
    this.frameMs = opts.frameMs;
    this.drawCallsTotal = opts.drawCallsTotal;
    this.drawCallsByApi = opts.drawCallsByApi;
    this.drawCallsByPass = opts.drawCallsByPass;
    this.passMs = opts.passMs;
  }
}

export class ReplayRenderTelemetrySummary {
  readonly frameMs: BenchmarkAggregate;
  readonly updateMs: BenchmarkAggregate;
  readonly drawMs: BenchmarkAggregate;
  readonly drawCallsTotal: BenchmarkAggregate;
  readonly topDrawMsTicks: readonly ReplayRenderTelemetryTopTick[];
  readonly topFrameMsTicks: readonly ReplayRenderTelemetryTopTick[];
  readonly topDrawCallsTicks: readonly ReplayRenderTelemetryTopTick[];

  constructor(opts: {
    frameMs: BenchmarkAggregate;
    updateMs: BenchmarkAggregate;
    drawMs: BenchmarkAggregate;
    drawCallsTotal: BenchmarkAggregate;
    topDrawMsTicks: readonly ReplayRenderTelemetryTopTick[];
    topFrameMsTicks: readonly ReplayRenderTelemetryTopTick[];
    topDrawCallsTicks: readonly ReplayRenderTelemetryTopTick[];
  }) {
    this.frameMs = opts.frameMs;
    this.updateMs = opts.updateMs;
    this.drawMs = opts.drawMs;
    this.drawCallsTotal = opts.drawCallsTotal;
    this.topDrawMsTicks = opts.topDrawMsTicks;
    this.topFrameMsTicks = opts.topFrameMsTicks;
    this.topDrawCallsTicks = opts.topDrawCallsTicks;
  }
}

export class ReplayRenderTelemetryArtifacts {
  readonly telemetryJsonPath: string | null;
  readonly chartsDir: string | null;
  readonly frameTimingSvg: string | null;
  readonly drawCallsSvg: string | null;
  readonly passTimingStackedSvg: string | null;
  readonly reportMd: string | null;

  constructor(opts: {
    telemetryJsonPath?: string | null;
    chartsDir?: string | null;
    frameTimingSvg?: string | null;
    drawCallsSvg?: string | null;
    passTimingStackedSvg?: string | null;
    reportMd?: string | null;
  } = {}) {
    this.telemetryJsonPath = opts.telemetryJsonPath ?? null;
    this.chartsDir = opts.chartsDir ?? null;
    this.frameTimingSvg = opts.frameTimingSvg ?? null;
    this.drawCallsSvg = opts.drawCallsSvg ?? null;
    this.passTimingStackedSvg = opts.passTimingStackedSvg ?? null;
    this.reportMd = opts.reportMd ?? null;
  }
}

export class ReplayRenderTelemetryResult {
  readonly frames: readonly ReplayRenderTelemetryFrame[];
  readonly summary: ReplayRenderTelemetrySummary;
  readonly artifacts: ReplayRenderTelemetryArtifacts | null;
  readonly preview: readonly ReplayRenderTelemetryFrame[];

  constructor(opts: {
    frames: readonly ReplayRenderTelemetryFrame[];
    summary: ReplayRenderTelemetrySummary;
    artifacts?: ReplayRenderTelemetryArtifacts | null;
    preview?: readonly ReplayRenderTelemetryFrame[];
  }) {
    this.frames = opts.frames;
    this.summary = opts.summary;
    this.artifacts = opts.artifacts ?? null;
    this.preview = Array.from(opts.preview ?? []);
  }
}

export class ReplayBenchmarkResult {
  readonly runResult: RunResult;
  readonly samples: readonly BenchmarkSample[];
  readonly wallMs: BenchmarkAggregate;
  readonly ticksPerSecond: BenchmarkAggregate;
  readonly realtimeX: BenchmarkAggregate;
  readonly profile: ReplayProfileResult | null;
  readonly renderTelemetry: ReplayRenderTelemetryResult | null;

  constructor(opts: {
    runResult: RunResult;
    samples: readonly BenchmarkSample[];
    wallMs: BenchmarkAggregate;
    ticksPerSecond: BenchmarkAggregate;
    realtimeX: BenchmarkAggregate;
    profile: ReplayProfileResult | null;
    renderTelemetry?: ReplayRenderTelemetryResult | null;
  }) {
    this.runResult = opts.runResult;
    this.samples = opts.samples;
    this.wallMs = opts.wallMs;
    this.ticksPerSecond = opts.ticksPerSecond;
    this.realtimeX = opts.realtimeX;
    this.profile = opts.profile;
    this.renderTelemetry = opts.renderTelemetry ?? null;
  }
}

export class RenderOnceResult {
  readonly runResult: RunResult;
  readonly telemetryFrames: readonly RenderTelemetryFrameSnapshot[];

  constructor(opts: {
    runResult: RunResult;
    telemetryFrames?: readonly RenderTelemetryFrameSnapshot[];
  }) {
    this.runResult = opts.runResult;
    this.telemetryFrames = Array.from(opts.telemetryFrames ?? []);
  }
}

export async function runReplayRenderBenchmark(replay: Replay, opts: { replayPath: string; baseDir: string; assetsDir?: string | null; width?: number | null; height?: number | null; runs?: number; warmupRuns?: number; maxTicks?: number | null; traceRng?: boolean; profile?: boolean; profileSort?: ProfileSortKey; top?: number; profileOut?: string | null; muteAudio?: boolean; renderTelemetry?: boolean; renderTelemetryOut?: string | null; renderChartsOutDir?: string | null; rtx?: boolean; showProgress?: boolean }): Promise<ReplayBenchmarkResult> {
  const replayPath = opts.replayPath;
  const baseDir = opts.baseDir;
  const assetsDir = opts.assetsDir ?? null;
  const width = opts.width ?? null;
  const height = opts.height ?? null;
  const runs = opts.runs ?? 5;
  const warmupRuns = opts.warmupRuns ?? 1;
  const maxTicks = opts.maxTicks ?? null;
  const traceRng = opts.traceRng ?? false;
  const profile = opts.profile ?? false;
  const profileSort = opts.profileSort ?? 'cumtime';
  const top = opts.top ?? 20;
  const profileOut = opts.profileOut ?? null;
  const muteAudio = opts.muteAudio ?? true;
  const renderTelemetry = opts.renderTelemetry ?? false;
  const renderTelemetryOut = opts.renderTelemetryOut ?? null;
  const renderChartsOutDir = opts.renderChartsOutDir ?? null;
  const rtx = opts.rtx ?? false;
  const showProgress = opts.showProgress ?? false;
  validateArgs({ runs: runs, warmupRuns: warmupRuns, top: top });
  const telemetryRequested = renderTelemetry || renderTelemetryOut !== null || renderChartsOutDir !== null;

  const baselineResult = buildVerifyPlaybackDriver(replay, { maxTicks: maxTicks, traceRng: traceRng }).run();

  const runtimeBaseDir = baseDir;
  const runtimeAssetsDir = assetsDir !== null ? assetsDir : runtimeBaseDir;
  _mkdirParents(String(runtimeBaseDir));
  const cfg = ensureCrimsonCfg(runtimeBaseDir);
  if (muteAudio) {
    cfg.audio.soundDisabled = true;
    cfg.audio.musicDisabled = true;
  }

  const renderWidth = width !== null ? int(width) : cfg.display.width;
  const renderHeight = height !== null ? int(height) : cfg.display.height;
  if (int(renderWidth) <= 0 || int(renderHeight) <= 0) {
    throw new ReplayBenchmarkError(`invalid render resolution: ${renderWidth}x${renderHeight}; width/height must be > 0`);
  }

  const console = createConsole(runtimeBaseDir, runtimeAssetsDir);
  downloadMissingPaqs(runtimeAssetsDir, console);
  const ctx = new ViewContext({ assetsDir: runtimeAssetsDir, preserveBugs: false });

  const configFlags = 0;
  if (int(configFlags) !== 0) {
    (rl as any).setConfigFlags(int(configFlags));
  }
  let resources = null;
  let windowOpen = false;
  try {
    (rl as any).initWindow(int(renderWidth), int(renderHeight), `Replay Benchmark - ${_basename(String(replayPath))}`);
    windowOpen = true;
  } catch (exc) {
    throw new ReplayBenchmarkError(`render benchmark could not initialize window: ${exc instanceof Error ? exc.message : String(exc)}`);
  }

  let tickTotal = replay.ticks.length;
  if (maxTicks !== null) {
    tickTotal = Math.min(tickTotal, Math.max(0, int(maxTicks)));
  }

  let progress: ProgressBarLike | null = null;
  let plannedSteps: ReturnType<typeof int>;
  let samples: BenchmarkSample[];
  let profileResult: ReplayProfileResult | null;
  let telemetryResult: ReplayRenderTelemetryResult | null;
  try {
    resources = await loadRuntimeResources(runtimeAssetsDir);
    plannedSteps = int(warmupRuns) + int(runs) + (profile ? 1 : 0) + (telemetryRequested ? 1 : 0);
    if (showProgress && plannedSteps > 0) {
      progress = tqdm({ total: plannedSteps, unit: 'run', desc: 'render benchmark', leave: false }) as ProgressBarLike;
    }

    const _runOnceWithTickProgress = (opts: { tickDesc: string; rtx: boolean; telemetrySession?: RenderTelemetrySession | null }): RenderOnceResult => {
      const tickDesc = opts.tickDesc;
      const rtx = opts.rtx;
      const telemetrySession = opts.telemetrySession ?? null;
      let tickProgress: ProgressBarLike | null = null;
      let completedTicks = 0;
      let tickCallback: ((arg0: number) => void) | null = null;
      let completedRun = false;
      if (showProgress && tickTotal > 0) {
        const tickProgressBar = tqdm({ total: tickTotal, unit: 'tick', desc: tickDesc, leave: false }) as ProgressBarLike;
        tickProgress = tickProgressBar;

        const _onTick = (tickIndex: number): void => {
          const targetTick = Math.max(0, Math.min(tickTotal, int(tickIndex)));
          if (targetTick <= completedTicks) {
            return;
          }
          tickProgressBar.update(targetTick - completedTicks);
          completedTicks = targetTick;
        };

        tickCallback = _onTick;
      }

      let result: ReturnType<typeof runRenderOnce>;
      try {
        result = runRenderOnce({ ctx: ctx, replayPath: replayPath, cfg: cfg, console: console, maxTicks: maxTicks, traceRng: traceRng, rtx: rtx, telemetrySession: telemetrySession, tickProgressCallback: tickCallback });
        completedRun = true;
        return result;
      } finally {
        if (tickProgress !== null) {
          if (completedRun && completedTicks < tickTotal) {
            tickProgress.update(tickTotal - completedTicks);
          }
          tickProgress.close();
        }
      }
    };

    for (let i = 0; i < int(warmupRuns); i++) {
      _runOnceWithTickProgress({
        tickDesc: 'render ticks warmup',
        rtx: rtx,
      });
      if (progress !== null) {
        progress.update(1);
        progress.setPostfixStr('phase=warmup', false);
      }
    }

    samples = [];
    for (let sampleIdx = 0; sampleIdx < int(runs); sampleIdx++) {
      const startNs = (performance.now() * 1_000_000);
      const measured = _runOnceWithTickProgress({ tickDesc: `render ticks sample ${sampleIdx + 1}/${int(runs)}`, rtx: rtx });
      const elapsedNs = Math.max(1, int((performance.now() * 1_000_000)) - int(startNs));
      const wallMs = elapsedNs / 1_000_000.0;
      const wallS = elapsedNs / 1_000_000_000.0;
      const ticksPerSecond = measured.runResult.ticks / wallS;
      const realtimeX = measured.runResult.elapsedMs / wallMs;
      samples.push(new BenchmarkSample({ wallMs: wallMs, ticksPerSecond: ticksPerSecond, realtimeX: realtimeX }));
      assertConsistentRunResult(
        baselineResult,
        measured.runResult,
        { where: `render run ${sampleIdx + 1}` },
      );
      if (progress !== null) {
        progress.update(1);
        progress.setPostfixStr(`phase=measure sample=${sampleIdx + 1}/${int(runs)}`, false);
      }
    }

    profileResult = null;
    if (profile) {
      const prof = new PythonProfile();
      prof.enable();
      const profiled = _runOnceWithTickProgress({ tickDesc: 'render ticks profile', rtx: rtx });
      prof.disable();
      assertConsistentRunResult(
        baselineResult,
        profiled.runResult,
        { where: 'render profiled run' },
      );

      if (profileOut !== null) {
        const outPath = profileOut;
        _mkdirParents(_dirname(String(outPath)));
        prof.dumpStats(String(outPath));
      }

      const [source, hotspots] = extractHotspots(prof, { sortKey: profileSort, top: int(top) });
      profileResult = new ReplayProfileResult({ sort: profileSort, top: int(top), source: source, hotspots: Array.from(hotspots) });
      if (progress !== null) {
        progress.update(1);
        progress.setPostfixStr('phase=profile', false);
      }
    }

    telemetryResult = null;
    if (telemetryRequested) {
      const telemetrySession = new RenderTelemetrySession();
      let collected: ReturnType<typeof _runOnceWithTickProgress>;
      const _withManager352_0 = telemetrySession as unknown as { __enter__?: () => unknown; __exit__?: (excType: unknown, exc: unknown, tb: unknown) => unknown; start?: () => unknown; stop?: () => unknown };
      if (_withManager352_0.__enter__ !== undefined) {
        _withManager352_0.__enter__();
      } else {
        _withManager352_0.start?.();
      }
      try {
        collected = _runOnceWithTickProgress({ tickDesc: 'render ticks telemetry', rtx: rtx, telemetrySession: telemetrySession });
      } finally {
        if (_withManager352_0.__exit__ !== undefined) {
          _withManager352_0.__exit__(null, null, null);
        } else {
          _withManager352_0.stop?.();
        }
      }
      assertConsistentRunResult(
        baselineResult,
        collected.runResult,
        { where: 'render telemetry run' },
      );

      const frames = Array.from(collected.telemetryFrames).map((frame) => convertTelemetryFrame(frame));
      const summary = summarizeRenderTelemetry({ frames: frames });

      let telemetryJsonPath: string | null = null;
      if (renderTelemetryOut !== null) {
        telemetryJsonPath = renderTelemetryOut;
        _mkdirParents(_dirname(String(telemetryJsonPath)));
        const payload = { "frames": frames.map((frame) => structuredClone(frame)), "summary": structuredClone(summary) };
        writeFileSync(String(telemetryJsonPath), pythonJsonDumps(payload, { sortKeys: true, indent: 2 }) + '\n', { encoding: 'utf-8' });
      }

      let chartPaths: Map<string, string> = new Map();
      if (renderChartsOutDir !== null) {
        chartPaths = writeRenderTelemetryCharts({ frames: Array.from(frames), outDir: renderChartsOutDir, telemetryJsonPath: telemetryJsonPath });
      }

      const artifacts = new ReplayRenderTelemetryArtifacts({ telemetryJsonPath: telemetryJsonPath, chartsDir: renderChartsOutDir !== null ? renderChartsOutDir : null, frameTimingSvg: chartPaths.get('frame_timing_svg') ?? null, drawCallsSvg: chartPaths.get('draw_calls_svg') ?? null, passTimingStackedSvg: chartPaths.get('pass_timing_stacked_svg') ?? null, reportMd: chartPaths.get('report_md') ?? null });
      telemetryResult = new ReplayRenderTelemetryResult({ frames: frames, summary: summary, artifacts: artifacts, preview: Array.from(frames.slice(0, 10)) });
      if (progress !== null) {
        progress.update(1);
        progress.setPostfixStr('phase=telemetry', false);
      }
    }
  } finally {
    if (progress !== null) {
      progress.close();
    }
    unloadRuntimeResources(resources);
    if (windowOpen) {
      (rl as any).closeWindow();
    }
  }

  const wallValues = samples.map((sample) => sample.wallMs);
  const tpsValues = samples.map((sample) => sample.ticksPerSecond);
  const realtimeValues = samples.map((sample) => sample.realtimeX);

  return new ReplayBenchmarkResult({ runResult: baselineResult, samples: Array.from(samples), wallMs: aggregate(wallValues), ticksPerSecond: aggregate(tpsValues), realtimeX: aggregate(realtimeValues), profile: profileResult, renderTelemetry: telemetryResult });
}

export function runReplayBenchmark(replay: Replay, opts: { runs?: number; warmupRuns?: number; maxTicks?: number | null; traceRng?: boolean; profile?: boolean; profileSort?: ProfileSortKey; top?: number; profileOut?: string | null; showProgress?: boolean } = {}): ReplayBenchmarkResult {
  const runs = opts.runs ?? 5;
  const warmupRuns = opts.warmupRuns ?? 1;
  const maxTicks = opts.maxTicks ?? null;
  const traceRng = opts.traceRng ?? false;
  const profile = opts.profile ?? false;
  const profileSort = opts.profileSort ?? 'cumtime';
  const top = opts.top ?? 20;
  const profileOut = opts.profileOut ?? null;
  const showProgress = opts.showProgress ?? false;
  validateArgs({ runs: runs, warmupRuns: warmupRuns, top: top });

  let tickTotal = replay.ticks.length;
  if (maxTicks !== null) {
    tickTotal = Math.min(tickTotal, Math.max(0, int(maxTicks)));
  }

  let progress: ProgressBarLike | null = null;
  let plannedSteps: ReturnType<typeof int>;
  let baselineResult: RunResult | null;
  let samples: BenchmarkSample[];
  let profileResult: ReplayProfileResult | null;
  try {
    plannedSteps = int(warmupRuns) + int(runs) + (profile ? 1 : 0);
    if (showProgress && plannedSteps > 0) {
      progress = tqdm({ total: plannedSteps, unit: 'run', desc: 'headless benchmark', leave: false }) as ProgressBarLike;
    }

    const _runOnceWithTickProgress = (opts: { tickDesc: string }): RunResult => {
      const tickDesc = opts.tickDesc;
      let tickProgress: ProgressBarLike | null = null;
      let completedTicks = 0;
      let tickCallback: ((arg0: number) => void) | null = null;
      let completedRun = false;
      if (showProgress && tickTotal > 0) {
        const tickProgressBar = tqdm({ total: tickTotal, unit: 'tick', desc: tickDesc, leave: false }) as ProgressBarLike;
        tickProgress = tickProgressBar;

        const _onTick = (tickIndex: number): void => {
          const targetTick = Math.max(0, Math.min(tickTotal, int(tickIndex)));
          if (targetTick <= completedTicks) {
            return;
          }
          tickProgressBar.update(targetTick - completedTicks);
          completedTicks = targetTick;
        };

        tickCallback = _onTick;
      }

      let driver: ReturnType<typeof buildVerifyPlaybackDriver>;
      let result: ReturnType<typeof driver.run>;
      try {
        driver = buildVerifyPlaybackDriver(replay, { maxTicks: maxTicks, traceRng: traceRng });
        result = driver.run({ hooks: new PlaybackWalkHooks({ onProgress: tickCallback }) });
        completedRun = true;
        return result;
      } finally {
        if (tickProgress !== null) {
          if (completedRun && completedTicks < tickTotal) {
            tickProgress.update(tickTotal - completedTicks);
          }
          tickProgress.close();
        }
      }
    };

    for (let i = 0; i < int(warmupRuns); i++) {
      _runOnceWithTickProgress({ tickDesc: 'headless ticks warmup' });
      if (progress !== null) {
        progress.update(1);
        progress.setPostfixStr('phase=warmup', false);
      }
    }

    baselineResult = null;
    samples = [];
    for (let sampleIdx = 0; sampleIdx < int(runs); sampleIdx++) {
      const startNs = (performance.now() * 1_000_000);
      const result = _runOnceWithTickProgress({ tickDesc: `headless ticks sample ${sampleIdx + 1}/${int(runs)}` });
      const elapsedNs = Math.max(1, int((performance.now() * 1_000_000)) - int(startNs));
      const wallMs = elapsedNs / 1_000_000.0;
      const wallS = elapsedNs / 1_000_000_000.0;
      const ticksPerSecond = result.ticks / wallS;
      const realtimeX = result.elapsedMs / wallMs;
      samples.push(new BenchmarkSample({ wallMs: wallMs, ticksPerSecond: ticksPerSecond, realtimeX: realtimeX }));
      if (baselineResult === null) {
        baselineResult = result;
      } else {
        assertConsistentRunResult(baselineResult, result, { where: `measured run ${sampleIdx + 1}` });
      }
      if (progress !== null) {
        progress.update(1);
        progress.setPostfixStr(`phase=measure sample=${sampleIdx + 1}/${int(runs)}`, false);
      }
    }

    if (!(baselineResult !== null)) throw new Error();
    profileResult = null;
    if (profile) {
      const prof = new PythonProfile();
      prof.enable();
      const profResult = _runOnceWithTickProgress({ tickDesc: 'headless ticks profile' });
      prof.disable();
      assertConsistentRunResult(baselineResult, profResult, { where: 'profiled run' });

      if (profileOut !== null) {
        const outPath = profileOut;
        _mkdirParents(_dirname(String(outPath)));
        prof.dumpStats(String(outPath));
      }

      const [source, hotspots] = extractHotspots(prof, { sortKey: profileSort, top: int(top) });
      profileResult = new ReplayProfileResult({ sort: profileSort, top: int(top), source: source, hotspots: Array.from(hotspots) });
      if (progress !== null) {
        progress.update(1);
        progress.setPostfixStr('phase=profile', false);
      }
    }
  } finally {
    if (progress !== null) {
      progress.close();
    }
  }

  const wallValues = samples.map((sample) => sample.wallMs);
  const tpsValues = samples.map((sample) => sample.ticksPerSecond);
  const realtimeValues = samples.map((sample) => sample.realtimeX);

  return new ReplayBenchmarkResult({ runResult: baselineResult, samples: Array.from(samples), wallMs: aggregate(wallValues), ticksPerSecond: aggregate(tpsValues), realtimeX: aggregate(realtimeValues), profile: profileResult });
}

function validateArgs(opts: { runs: number; warmupRuns: number; top: number }): void {
  const runs = opts.runs;
  const warmupRuns = opts.warmupRuns;
  const top = opts.top;
  if (int(runs) < 1) {
    throw new ReplayBenchmarkError('runs must be >= 1');
  }
  if (int(warmupRuns) < 0) {
    throw new ReplayBenchmarkError('warmup_runs must be >= 0');
  }
  if (int(top) < 1) {
    throw new ReplayBenchmarkError('top must be >= 1');
  }
}

function runRenderOnce(opts: { ctx: ViewContext; replayPath: string; cfg: CrimsonConfig; console: ConsoleState; maxTicks: number | null; traceRng: boolean; rtx: boolean; telemetrySession?: RenderTelemetrySession | null; tickProgressCallback?: ((arg0: number) => void) | null }): RenderOnceResult {
  const ctx = opts.ctx;
  const replayPath = opts.replayPath;
  const cfg = opts.cfg;
  const console = opts.console;
  const maxTicks = opts.maxTicks;
  const traceRng = opts.traceRng;
  const rtx = opts.rtx;
  const telemetrySession = opts.telemetrySession ?? null;
  const tickProgressCallback = opts.tickProgressCallback ?? null;
  const mode = new ReplayPlaybackMode(ctx, { replayPath: replayPath, config: cfg, console: console, maxTicks: maxTicks, traceRng: traceRng, rtx: rtx });
  mode.open();
  let frameIndex: number;
  try {
    const replay = mode.replay;
    if (replay === null) {
      throw new ReplayBenchmarkError('render benchmark failed: replay playback did not initialize replay state');
    }

    let stepDt = mode.dt;
    if (stepDt <= 0.0) {
      stepDt = 1.0 / 60.0;
    }

    frameIndex = 0;
    while (!Boolean(mode.finished)) {
      const tickBefore = int(mode.tickIndex);
      if (telemetrySession !== null) {
        telemetrySession.beginFrame({
          frameIndex: int(frameIndex),
          tickIndexBeforeUpdate: int(tickBefore),
        });
      }

      const frameStartNs = (performance.now() * 1_000_000);
      const updateStartNs = (performance.now() * 1_000_000);
      mode.update(stepDt);
      const updateNs = Math.max(0, int((performance.now() * 1_000_000)) - int(updateStartNs));

      const drawStartNs = (performance.now() * 1_000_000);
      (wgl as any).beginDrawing();
      try {
        mode.draw();
      } finally {
        (wgl as any).endDrawing();
      }
      const drawNs = Math.max(0, int((performance.now() * 1_000_000)) - int(drawStartNs));
      const frameNs = Math.max(0, int((performance.now() * 1_000_000)) - int(frameStartNs));

      const tickAfter = int(mode.tickIndex);
      if (tickProgressCallback !== null) {
        tickProgressCallback(int(tickAfter));
      }
      if (telemetrySession !== null) {
        telemetrySession.endFrame({
          tickIndexAfterUpdate: int(tickAfter),
          updateMs: updateNs / 1_000_000.0,
          drawMs: drawNs / 1_000_000.0,
          frameMs: frameNs / 1_000_000.0,
        });
      }

      if (Boolean(mode.closeRequested)) {
        throw new ReplayBenchmarkError('render benchmark aborted: replay playback requested close');
      }

      frameIndex += 1;
    }

    return new RenderOnceResult({ runResult: runResultForReplayMode({ mode: mode }), telemetryFrames: telemetrySession !== null ? telemetrySession.frames : [] });
  } finally {
    mode.close();
  }
}

function runResultForReplayMode(opts: { mode: ReplayPlaybackMode }): RunResult {
  const mode = opts.mode;
  const driver = mode.driver;
  if (driver === null) {
    throw new ReplayBenchmarkError('render benchmark failed: replay driver was not available');
  }
  return driver.buildRunResult({ ticks: int(mode.tickIndex) });
}

function assertConsistentRunResult(expected: RunResult, actual: RunResult, opts: { where: string }): void {
  const where = opts.where;
  const expectedValues = [[expected.gameModeId, actual.gameModeId, 'game_mode_id'], [expected.tickRate, actual.tickRate, 'tick_rate'], [expected.ticks, actual.ticks, 'ticks'], [expected.elapsedMs, actual.elapsedMs, 'elapsed_ms'], [expected.scoreXp, actual.scoreXp, 'score_xp'], [expected.creatureKillCount, actual.creatureKillCount, 'creature_kill_count'], [expected.mostUsedWeaponId, actual.mostUsedWeaponId, 'most_used_weapon_id'], [expected.shotsFired, actual.shotsFired, 'shots_fired'], [expected.shotsHit, actual.shotsHit, 'shots_hit'], [expected.rngState, actual.rngState, 'rng_state']] as const;
  for (let [exp, got, fieldName] of expectedValues) {
    if (int(exp) !== int(got)) {
      throw new ReplayBenchmarkError(`non-deterministic replay result across runs: ${fieldName} expected=${exp} actual=${got} (${where})`);
    }
  }
}

function aggregate(values: number[]): BenchmarkAggregate {
  if (values.length === 0) {
    throw new ReplayBenchmarkError('benchmark produced no samples');
  }
  const sortedValues = values.sort((left, right) => pythonCompareKeys(left, right));
  const meanValue = pythonFmean(sortedValues);
  const stdevValue = sortedValues.length >= 2 ? pythonStdev(sortedValues) : 0.0;
  return new BenchmarkAggregate({ min: sortedValues[0], p50: percentile(sortedValues, 0.50), mean: meanValue, p95: percentile(sortedValues, 0.95), max: sortedValues[sortedValues.length - 1], stdev: stdevValue });
}

function aggregateOrZero(values: number[]): BenchmarkAggregate {
  if (values.length === 0) {
    return new BenchmarkAggregate({ min: 0.0, p50: 0.0, mean: 0.0, p95: 0.0, max: 0.0, stdev: 0.0 });
  }
  return aggregate(values);
}

function percentile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) {
    throw new ReplayBenchmarkError('cannot compute percentile of empty values');
  }
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }
  const clamped = Math.min(1.0, Math.max(0.0, ratio));
  const pos = (sortedValues.length - 1) * clamped;
  const lo = int(Math.floor(pos));
  const hi = int(Math.ceil(pos));
  if (lo === hi) {
    return sortedValues[lo];
  }
  const frac = pos - lo;
  return (sortedValues[lo] * (1.0 - frac) + sortedValues[hi] * frac);
}

function extractHotspots(profile: PythonProfile, opts: { sortKey: ProfileSortKey; top: number }): [HotspotSource, ReplayProfileHotspot[]] {
  const sortKey = opts.sortKey;
  const top = opts.top;
  const stats = pythonProfileStats(profile);
  const rows: ReplayProfileHotspot[] = [];
  for (let [key, values] of stats.stats.entries()) {
    const [fileName, lineNumber, functionName] = key;
    const [primitiveCalls, totalCalls, tottime, cumtime, callers] = values;
    rows.push(new ReplayProfileHotspot({ file: String(fileName), line: int(lineNumber), function: String(functionName), primitiveCalls: int(primitiveCalls), totalCalls: int(totalCalls), tottime: tottime, cumtime: cumtime }));
  }

  if (String(sortKey) === 'tottime') {
    rows.sort((left, right) => -1 * pythonCompareKeys(((row) => row.tottime)(left), ((row) => row.tottime)(right)));
  } else {
    rows.sort((left, right) => -1 * pythonCompareKeys(((row) => row.cumtime)(left), ((row) => row.cumtime)(right)));
  }

  const projectRows = rows.filter((row) => isProjectHotspotPath(String(row.file)));
  if (projectRows.length > 0) {
    return ['project', projectRows.slice(0, int(top))];
  }
  return ['all', rows.slice(0, int(top))];
}

function isProjectHotspotPath(path: string): boolean {
  const text = path.replaceAll('\\', '/').toLowerCase();
  return pythonStartsWith(text, 'src/crimson/') || pythonStartsWith(text, 'src/grim/') || pythonStartsWith(text, 'crimson/') || pythonStartsWith(text, 'grim/') || (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(text, '/src/crimson/')) || (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(text, '/src/grim/'));
}

function convertTelemetryFrame(frame: RenderTelemetryFrameSnapshot): ReplayRenderTelemetryFrame {
  return new ReplayRenderTelemetryFrame({ frameIndex: int(frame.frameIndex), tickIndexBeforeUpdate: int(frame.tickIndexBeforeUpdate), tickIndexAfterUpdate: int(frame.tickIndexAfterUpdate), updateMs: frame.updateMs, drawMs: frame.drawMs, frameMs: frame.frameMs, drawCallsTotal: int(frame.drawCallsTotal), drawCallsByApi: new Map(Array.from(frame.drawCallsByApi.entries(), ([key, value]) => [String(key), int(value)] as const)), drawCallsByPass: new Map(Array.from(frame.drawCallsByPass.entries(), ([key, value]) => [String(key), int(value)] as const)), passMs: new Map(Array.from(frame.passMs.entries(), ([key, value]) => [String(key), value] as const)) });
}

function topTicks(opts: { frames: readonly ReplayRenderTelemetryFrame[]; topN: number; keyFn: (arg0: ReplayRenderTelemetryFrame) => number }): ReplayRenderTelemetryTopTick[] {
  const frames = opts.frames;
  const topN = opts.topN;
  const keyFn = opts.keyFn;
  const ordered = Array.from(frames).sort((left, right) => -1 * pythonCompareKeys(keyFn(left), keyFn(right)));
  const selected = ordered.slice(0, Math.max(0, int(topN)));
  return selected.map((frame) => new ReplayRenderTelemetryTopTick({ tickIndex: int(frame.tickIndexAfterUpdate), frameIndex: int(frame.frameIndex), value: keyFn(frame) }));
}

function summarizeRenderTelemetry(opts: { frames: readonly ReplayRenderTelemetryFrame[] }): ReplayRenderTelemetrySummary {
  const frames = opts.frames;
  const frameMsValues = frames.map((frame) => frame.frameMs);
  const updateMsValues = frames.map((frame) => frame.updateMs);
  const drawMsValues = frames.map((frame) => frame.drawMs);
  const drawCallsValues = frames.map((frame) => frame.drawCallsTotal);

  return new ReplayRenderTelemetrySummary({ frameMs: aggregateOrZero(frameMsValues), updateMs: aggregateOrZero(updateMsValues), drawMs: aggregateOrZero(drawMsValues), drawCallsTotal: aggregateOrZero(drawCallsValues), topDrawMsTicks: topTicks({ frames: frames, topN: 5, keyFn: (row) => row.drawMs }), topFrameMsTicks: topTicks({ frames: frames, topN: 5, keyFn: (row) => row.frameMs }), topDrawCallsTicks: topTicks({ frames: frames, topN: 5, keyFn: (row) => row.drawCallsTotal }) });
}
