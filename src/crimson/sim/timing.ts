// Port of crimson/sim/timing.py

import { f32 } from '@crimson/math-parity.ts';

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

export class FrameTiming {
  readonly dt: number;
  readonly timeScaleActiveEntry: boolean;
  readonly timeScaleFactor: number;
  readonly zeroGateActive: boolean;
  readonly dtSim: number;

  constructor(opts: {
    dt: number;
    timeScaleActiveEntry: boolean;
    timeScaleFactor: number;
    zeroGateActive: boolean;
    dtSim: number;
  }) {
    this.dt = opts.dt;
    this.timeScaleActiveEntry = opts.timeScaleActiveEntry;
    this.timeScaleFactor = opts.timeScaleFactor;
    this.zeroGateActive = opts.zeroGateActive;
    this.dtSim = opts.dtSim;
  }

  get dtMsI32(): number {
    return Math.trunc(ftolMsI32(this.dt));
  }

  get dtSimMsI32(): number {
    return Math.trunc(ftolMsI32(this.dtSim));
  }

  get dtPlayerLocal(): number {
    if (!this.timeScaleActiveEntry) {
      return this.dtSim;
    }
    return f32((0.600000024 / this.timeScaleFactor) * this.dtSim);
  }

  static compute(dt: number, opts: { timeScaleActiveEntry: boolean; timeScaleFactor: number; zeroGateActive: boolean }): FrameTiming {
    const timeScaleActiveEntry = opts.timeScaleActiveEntry;
    const timeScaleFactor = opts.timeScaleFactor;
    const zeroGateActive = opts.zeroGateActive;
    const dtF32 = f32(dt);
    if (!Number.isFinite(dtF32)) {
      throw new Error(`dt must be finite, got ${pythonRepr(dt)}`);
    }

    const active = timeScaleActiveEntry;
    const factor = f32(timeScaleFactor);
    if (active && (!Number.isFinite(factor) || factor <= 0.0)) {
      throw new Error(`time_scale_factor must be finite and > 0 when active, got ${pythonRepr(timeScaleFactor)}`);
    }

    let dtSim = dtF32;
    if (active) {
      dtSim = f32(dtF32 * factor);
    }
    if (zeroGateActive) {
      dtSim = 0.0;
    }

    return new FrameTiming({ dt: dtF32, timeScaleActiveEntry: active, timeScaleFactor: factor, zeroGateActive: zeroGateActive, dtSim: dtSim });
  }
}

export function ftolMsI32(dtSeconds: number): number {
  // Convert seconds -> integer milliseconds via float32 scale + truncation.

  const dtF32 = f32(dtSeconds);
  const scaledMsF32 = f32(dtF32 * 1000.0);
  return Math.trunc(Math.trunc(scaledMsF32));
}
