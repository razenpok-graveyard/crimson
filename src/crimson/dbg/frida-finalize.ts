// Port of crimson/dbg/frida_finalize.py

function unavailableRuntimeExport(name: string): any {
  return function unavailableRuntimeExportTarget(): never {
    throw new Error(`${name} is not available in the WebGL runtime`);
  };
}

export type FridaFinalizeError = any;
export const FridaFinalizeError: any = unavailableRuntimeExport('FridaFinalizeError');

export type CaptureRngStreamRow = any;
export const CaptureRngStreamRow: any = unavailableRuntimeExport('CaptureRngStreamRow');

export type CaptureSnapshotGameplay = any;
export const CaptureSnapshotGameplay: any = unavailableRuntimeExport('CaptureSnapshotGameplay');

export type CaptureSimStateSnapshot = any;
export const CaptureSimStateSnapshot: any = unavailableRuntimeExport('CaptureSimStateSnapshot');

export type TickChannels = any;
export const TickChannels: any = unavailableRuntimeExport('TickChannels');

export type SessionFingerprintRow = any;
export const SessionFingerprintRow: any = unavailableRuntimeExport('SessionFingerprintRow');

export type SessionConfigRow = any;
export const SessionConfigRow: any = unavailableRuntimeExport('SessionConfigRow');

export type SessionStartRow = any;
export const SessionStartRow: any = unavailableRuntimeExport('SessionStartRow');

export type RunStartRow = any;
export const RunStartRow: any = unavailableRuntimeExport('RunStartRow');

export type TickRow = any;
export const TickRow: any = unavailableRuntimeExport('TickRow');

export type RunEndRow = any;
export const RunEndRow: any = unavailableRuntimeExport('RunEndRow');

export type ErrorRow = any;
export const ErrorRow: any = unavailableRuntimeExport('ErrorRow');

export type SessionEndRow = any;
export const SessionEndRow: any = unavailableRuntimeExport('SessionEndRow');

export type FinalizedTrace = any;
export const FinalizedTrace: any = unavailableRuntimeExport('FinalizedTrace');

export type FinalizeResult = any;
export const FinalizeResult: any = unavailableRuntimeExport('FinalizeResult');

export type OpenRun = any;
export const OpenRun: any = unavailableRuntimeExport('OpenRun');

export type fingerprint = any;
export const fingerprint: any = unavailableRuntimeExport('fingerprint');

export type decodeCaptureRow = any;
export const decodeCaptureRow: any = unavailableRuntimeExport('decodeCaptureRow');

export type canonicalChannelsPayload = any;
export const canonicalChannelsPayload: any = unavailableRuntimeExport('canonicalChannelsPayload');

export type callerFromCapture = any;
export const callerFromCapture: any = unavailableRuntimeExport('callerFromCapture');

export type replayTickInputsFromRow = any;
export const replayTickInputsFromRow: any = unavailableRuntimeExport('replayTickInputsFromRow');

export type validateTickChannels = any;
export const validateTickChannels: any = unavailableRuntimeExport('validateTickChannels');

export type tickIterFromSpool = any;
export const tickIterFromSpool: any = unavailableRuntimeExport('tickIterFromSpool');

export type runOutputPath = any;
export const runOutputPath: any = unavailableRuntimeExport('runOutputPath');

export type buildMeta = any;
export const buildMeta: any = unavailableRuntimeExport('buildMeta');

export type writeRunTrace = any;
export const writeRunTrace: any = unavailableRuntimeExport('writeRunTrace');

export type finalizeFridaJsonlToTraces = any;
export const finalizeFridaJsonlToTraces: any = unavailableRuntimeExport('finalizeFridaJsonlToTraces');
