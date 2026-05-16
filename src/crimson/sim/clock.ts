// Port of crimson/sim/clock.py

export class FixedStepClock {
  tickRate: number;
  accum: number;

  constructor(opts: {
    tickRate?: number;
    accum?: number;
  } = {}) {
    this.tickRate = opts.tickRate ?? 60;
    this.accum = opts.accum ?? 0.0;
    const tickRate = Math.trunc(this.tickRate);
    if (tickRate <= 0) {
      throw new Error(`tick_rate must be positive, got ${tickRate}`);
    }
    this.tickRate = tickRate;
  }

  get dtTick(): number {
    return 1.0 / this.tickRate;
  }

  reset(): void {
    this.accum = 0.0;
  }

  advance(dt: number, opts: { maxDt?: number } = {}): number {
    const maxDt = opts.maxDt ?? 0.1;
    if (dt <= 0.0) {
      return 0;
    }
    if (dt > maxDt) {
      dt = maxDt;
    }

    this.accum += dt;
    const dtTick = this.dtTick;
    if (!(dtTick > 0.0)) {
      return 0;
    }

    const ticks = Math.trunc((this.accum + 1e-9) / dtTick);
    if (ticks <= 0) {
      return 0;
    }

    this.accum -= dtTick * ticks;
    if (this.accum < 0.0) {
      this.accum = 0.0;
    }
    return Math.trunc(ticks);
  }
}
