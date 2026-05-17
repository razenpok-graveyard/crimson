// Port of crimson/replay/driver/replay_render.py

function unavailableRuntimeExport(name: string): any {
  return function unavailableRuntimeExportTarget(): never {
    throw new Error(`${name} is not available in the WebGL runtime`);
  };
}

export type ReplayRenderError = any;
export const ReplayRenderError: any = unavailableRuntimeExport('ReplayRenderError');

export type ReplayRenderResult = any;
export const ReplayRenderResult: any = unavailableRuntimeExport('ReplayRenderResult');

export type FfmpegVideoTransport = any;
export const FfmpegVideoTransport: any = unavailableRuntimeExport('FfmpegVideoTransport');

export type runReplayRenderVideo = any;
export const runReplayRenderVideo: any = unavailableRuntimeExport('runReplayRenderVideo');

export type MixedAudioCapture = any;
export const MixedAudioCapture: any = unavailableRuntimeExport('MixedAudioCapture');

export type CapturedAudioTrack = any;
export const CapturedAudioTrack: any = unavailableRuntimeExport('CapturedAudioTrack');

export type captureReplayAudioTrack = any;
export const captureReplayAudioTrack: any = unavailableRuntimeExport('captureReplayAudioTrack');

export type muxRawAudioWithVideo = any;
export const muxRawAudioWithVideo: any = unavailableRuntimeExport('muxRawAudioWithVideo');

export type buildAudioSyncFilter = any;
export const buildAudioSyncFilter: any = unavailableRuntimeExport('buildAudioSyncFilter');

export type inferEffectiveCaptureSampleRate = any;
export const inferEffectiveCaptureSampleRate: any = unavailableRuntimeExport('inferEffectiveCaptureSampleRate');

export type validateArgs = any;
export const validateArgs: any = unavailableRuntimeExport('validateArgs');

export type resolveFfmpegBinary = any;
export const resolveFfmpegBinary: any = unavailableRuntimeExport('resolveFfmpegBinary');

export type spawnFfmpegRawVideoProcess = any;
export const spawnFfmpegRawVideoProcess: any = unavailableRuntimeExport('spawnFfmpegRawVideoProcess');

export type finalizeFfmpegProcess = any;
export const finalizeFfmpegProcess: any = unavailableRuntimeExport('finalizeFfmpegProcess');

export type abortFfmpegProcess = any;
export const abortFfmpegProcess: any = unavailableRuntimeExport('abortFfmpegProcess');
