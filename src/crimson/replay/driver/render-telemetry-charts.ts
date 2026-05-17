// Port of crimson/replay/driver/render_telemetry_charts.py

function unavailableRuntimeExport(name: string): any {
  return function unavailableRuntimeExportTarget(): never {
    throw new Error(`${name} is not available in the WebGL runtime`);
  };
}

export type writeRenderTelemetryCharts = any;
export const writeRenderTelemetryCharts: any = unavailableRuntimeExport('writeRenderTelemetryCharts');

export type writeRenderTelemetryChartsFromJson = any;
export const writeRenderTelemetryChartsFromJson: any = unavailableRuntimeExport('writeRenderTelemetryChartsFromJson');
