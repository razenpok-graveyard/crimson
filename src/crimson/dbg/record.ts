// Port of crimson/dbg/record.py

function unavailableRuntimeExport(name: string): any {
  return function unavailableRuntimeExportTarget(): never {
    throw new Error(`${name} is not available in the WebGL runtime`);
  };
}

export type EntityGenerationState = any;
export const EntityGenerationState: any = unavailableRuntimeExport('EntityGenerationState');

export type fingerprint = any;
export const fingerprint: any = unavailableRuntimeExport('fingerprint');

export type rngStreamFromDraws = any;
export const rngStreamFromDraws: any = unavailableRuntimeExport('rngStreamFromDraws');

export type entitySamplesForWorld = any;
export const entitySamplesForWorld: any = unavailableRuntimeExport('entitySamplesForWorld');

export type simStateFromWorld = any;
export const simStateFromWorld: any = unavailableRuntimeExport('simStateFromWorld');

export type buildReplayFingerprint = any;
export const buildReplayFingerprint: any = unavailableRuntimeExport('buildReplayFingerprint');

export type buildTraceMeta = any;
export const buildTraceMeta: any = unavailableRuntimeExport('buildTraceMeta');

export type recordReplayToTracePython = any;
export const recordReplayToTracePython: any = unavailableRuntimeExport('recordReplayToTracePython');

export type commandDetail = any;
export const commandDetail: any = unavailableRuntimeExport('commandDetail');

export type runProcess = any;
export const runProcess: any = unavailableRuntimeExport('runProcess');

export type recordReplayToTraceZig = any;
export const recordReplayToTraceZig: any = unavailableRuntimeExport('recordReplayToTraceZig');

export type recordReplayToTrace = any;
export const recordReplayToTrace: any = unavailableRuntimeExport('recordReplayToTrace');
