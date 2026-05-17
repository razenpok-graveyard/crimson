// Port of crimson/dbg/trace.py

function unavailableRuntimeExport(name: string): any {
  return function unavailableRuntimeExportTarget(): never {
    throw new Error(`${name} is not available in the WebGL runtime`);
  };
}

export type TraceError = any;
export const TraceError: any = unavailableRuntimeExport('TraceError');

export type TraceSummary = any;
export const TraceSummary: any = unavailableRuntimeExport('TraceSummary');

export type checksum64 = any;
export const checksum64: any = unavailableRuntimeExport('checksum64');

export type compress = any;
export const compress: any = unavailableRuntimeExport('compress');

export type decompress = any;
export const decompress: any = unavailableRuntimeExport('decompress');

export type chunkKindBytes = any;
export const chunkKindBytes: any = unavailableRuntimeExport('chunkKindBytes');

export type writeChunk = any;
export const writeChunk: any = unavailableRuntimeExport('writeChunk');

export type writeTraceFromIter = any;
export const writeTraceFromIter: any = unavailableRuntimeExport('writeTraceFromIter');

export type writeTraceIter = any;
export const writeTraceIter: any = unavailableRuntimeExport('writeTraceIter');

export type chunkPayloadFromFile = any;
export const chunkPayloadFromFile: any = unavailableRuntimeExport('chunkPayloadFromFile');

export type writeTrace = any;
export const writeTrace: any = unavailableRuntimeExport('writeTrace');

export type loadMetaAtOffset = any;
export const loadMetaAtOffset: any = unavailableRuntimeExport('loadMetaAtOffset');

export type loadFooterAndMetaOffsets = any;
export const loadFooterAndMetaOffsets: any = unavailableRuntimeExport('loadFooterAndMetaOffsets');

export type loadTraceMeta = any;
export const loadTraceMeta: any = unavailableRuntimeExport('loadTraceMeta');

export type TraceReader = any;
export const TraceReader: any = unavailableRuntimeExport('TraceReader');

export type loadTrace = any;
export const loadTrace: any = unavailableRuntimeExport('loadTrace');

export type iterTraceTicks = any;
export const iterTraceTicks: any = unavailableRuntimeExport('iterTraceTicks');
