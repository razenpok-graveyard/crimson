// Port of crimson/render/rtx/mode.py

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
  throw new Error(`unsupported render mode ${JSON.stringify(raw)}; expected classic|rtx`);
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
