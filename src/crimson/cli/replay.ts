// Port of crimson/cli/replay.py

import { DesktopCliUnavailableError } from './root.ts';

export const replayApp = {
  command(_name: string): (_fn: (...args: never[]) => void) => void {
    return (_fn) => {
      void _fn;
    };
  },
};

export function resolveReplayPath(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _resolve_replay_path');
}
export const _resolveReplayPath = resolveReplayPath;

export function defaultReplayRenderOutputPath(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _default_replay_render_output_path');
}
export const _defaultReplayRenderOutputPath = defaultReplayRenderOutputPath;

export function replayRenderProgressCallback(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_render_progress_callback');
}
export const _replayRenderProgressCallback = replayRenderProgressCallback;

export function renderCheckpointDiffFailure(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _render_checkpoint_diff_failure');
}
export const _renderCheckpointDiffFailure = renderCheckpointDiffFailure;

export function replayModeLabel(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_mode_label');
}
export const _replayModeLabel = replayModeLabel;

export function runResultPayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _run_result_payload');
}
export const _runResultPayload = runResultPayload;

export function replayInfoEventPayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_info_event_payload');
}
export const _replayInfoEventPayload = replayInfoEventPayload;

export function replayVerifyClaimedStatsPayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_verify_claimed_stats_payload');
}
export const _replayVerifyClaimedStatsPayload = replayVerifyClaimedStatsPayload;

export function replayVerifyRunResultClaimPayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_verify_run_result_claim_payload');
}
export const _replayVerifyRunResultClaimPayload = replayVerifyRunResultClaimPayload;

export function replayVerifyMismatchedFields(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_verify_mismatched_fields');
}
export const _replayVerifyMismatchedFields = replayVerifyMismatchedFields;

export function replayInfoSummaryPayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_info_summary_payload');
}
export const _replayInfoSummaryPayload = replayInfoSummaryPayload;

export function benchmarkAggregatePayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _benchmark_aggregate_payload');
}
export const _benchmarkAggregatePayload = benchmarkAggregatePayload;

export function renderTelemetryTopTickPayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _render_telemetry_top_tick_payload');
}
export const _renderTelemetryTopTickPayload = renderTelemetryTopTickPayload;

export function renderTelemetryFramePayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _render_telemetry_frame_payload');
}
export const _renderTelemetryFramePayload = renderTelemetryFramePayload;

export function pathText(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _path_text');
}
export const _pathText = pathText;

export function replayBenchmarkProfilePayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_benchmark_profile_payload');
}
export const _replayBenchmarkProfilePayload = replayBenchmarkProfilePayload;

export function replayBenchmarkSettingsPayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_benchmark_settings_payload');
}
export const _replayBenchmarkSettingsPayload = replayBenchmarkSettingsPayload;

export function replayBenchmarkSamplePayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_benchmark_sample_payload');
}
export const _replayBenchmarkSamplePayload = replayBenchmarkSamplePayload;

export function renderTelemetryArtifactsPayload(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _render_telemetry_artifacts_payload');
}
export const _renderTelemetryArtifactsPayload = renderTelemetryArtifactsPayload;

export function fmtMetricAgg(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _fmt_metric_agg');
}
export const _fmtMetricAgg = fmtMetricAgg;

export function fmtReplayListDuration(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _fmt_replay_list_duration');
}
export const _fmtReplayListDuration = fmtReplayListDuration;

export function fmtReplayListModified(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _fmt_replay_list_modified');
}
export const _fmtReplayListModified = fmtReplayListModified;

export function versionTuple(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _version_tuple');
}
export const _versionTuple = versionTuple;

export function isVersionOlder(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _is_version_older');
}
export const _isVersionOlder = isVersionOlder;

export function replayListModeLabel(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_list_mode_label');
}
export const _replayListModeLabel = replayListModeLabel;

export function replayListModeStyle(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_list_mode_style');
}
export const _replayListModeStyle = replayListModeStyle;

export function replayListScoreKills(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _replay_list_score_kills');
}
export const _replayListScoreKills = replayListScoreKills;

export function buildReplayListRow(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('replay _build_replay_list_row');
}
export const _buildReplayListRow = buildReplayListRow;

export function cmdReplayPlay(_opts: { replayFile?: string; width?: number | null; height?: number | null; fps?: number; baseDir?: string; assetsDir?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('replay play');
}

export function cmdReplayList(_opts: { baseDir?: string; color?: boolean } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('replay list');
}

export function cmdReplayVerify(_opts: { replayFile?: string; maxTicks?: number | null; traceRng?: boolean; outputFormat?: "human" | "json"; jsonOut?: string | null; baseDir?: string } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('replay verify');
}

export function cmdReplayInfo(_opts: { replayFile?: string; outputFormat?: "human" | "json"; jsonOut?: string | null; maxTicks?: number | null; verbose?: boolean; playerIndex?: number | null; baseDir?: string } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('replay info');
}

export function cmdReplayBenchmark(_opts: { replayFile?: string; runs?: number | null; warmupRuns?: number | null; mode?: "headless" | "render"; rtx?: boolean; maxTicks?: number | null; traceRng?: boolean; profile?: boolean; profileSort?: "cumtime" | "tottime"; top?: number; profileOut?: string | null; renderTelemetry?: boolean; renderTelemetryOut?: string | null; renderChartsOutDir?: string | null; outputFormat?: "human" | "json"; jsonOut?: string | null; baseDir?: string } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('replay benchmark');
}

export function cmdReplayRender(_opts: { replayFile?: string; out?: string | null; width?: number | null; height?: number | null; fps?: number; maxTicks?: number | null; traceRng?: boolean; ffmpegBin?: string | null; crf?: number; preset?: "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow"; pixelFormat?: string; overwrite?: boolean; audio?: boolean; baseDir?: string; assetsDir?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('replay render');
}

export function cmdReplayVerifyCheckpoints(_opts: { replayFile?: string; checkpointsFile?: string | null; maxTicks?: number | null; traceRng?: boolean; baseDir?: string } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('replay verify-checkpoints');
}

export function cmdReplayDiffCheckpoints(_opts: { expectedFile?: string; actualFile?: string } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('replay diff-checkpoints');
}
