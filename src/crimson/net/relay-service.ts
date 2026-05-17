// Port of crimson/net/relay_service.py

function unavailableRuntimeExport(name: string): any {
  return function unavailableRuntimeExportTarget(): never {
    throw new Error(`${name} is not available in the WebGL runtime`);
  };
}

export type RelayServer = any;
export const RelayServer: any = unavailableRuntimeExport('RelayServer');

export type RelayServerConfig = any;
export const RelayServerConfig: any = unavailableRuntimeExport('RelayServerConfig');
