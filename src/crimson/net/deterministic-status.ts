// Port of crimson/net/deterministic_status.py

function unavailableRuntimeExport(name: string): any {
  return function unavailableRuntimeExportTarget(): never {
    throw new Error(`${name} is not available in the WebGL runtime`);
  };
}

export type buildLanDeterministicStatus = any;
export const buildLanDeterministicStatus: any = unavailableRuntimeExport('buildLanDeterministicStatus');

export type hashStatusData = any;
export const hashStatusData: any = unavailableRuntimeExport('hashStatusData');

export type statusDataFromStatus = any;
export const statusDataFromStatus: any = unavailableRuntimeExport('statusDataFromStatus');
