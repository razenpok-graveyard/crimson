// Port of crimson/render/rtx/mode.py

function pythonRepr(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'nan';
    }
    if (value === Infinity) {
      return 'inf';
    }
    if (value === -Infinity) {
      return '-inf';
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === true) {
    return 'True';
  }
  if (value === false) {
    return 'False';
  }
  if (value === null) {
    return 'None';
  }
  return String(value);
}

export enum RtxRenderMode {
  CLASSIC = 'classic',
  RTX = 'rtx',
}

export function parseRtxRenderMode(raw: string): RtxRenderMode {
  const value = raw.trim().toLowerCase();
  if (value === 'classic') {
    return RtxRenderMode.CLASSIC;
  }
  if (value === 'rtx') {
    return RtxRenderMode.RTX;
  }
  throw new Error(`unsupported render mode ${pythonRepr(raw)}; expected classic|rtx`);
}

export function modeFromRtxFlag(enabled: boolean): RtxRenderMode {
  if (enabled) {
    return RtxRenderMode.RTX;
  }
  return RtxRenderMode.CLASSIC;
}

export function cycleRtxRenderMode(mode: RtxRenderMode): RtxRenderMode {
  if (mode === RtxRenderMode.RTX) {
    return RtxRenderMode.CLASSIC;
  }
  return RtxRenderMode.RTX;
}
