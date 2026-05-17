// Port of grim/rand.py

export type CallerStatic = number | null;
export type RngTraceSink = (arg0: number, arg1: number, arg2: number, arg3: CallerStatic) => void;

export interface CrandLike {
  readonly state: number;
  srand(seed: number): void;
  rand(opts?: { caller?: CallerStatic }): number;
  advance(draws: number): void;
}

// Exact static caller address when known.
export const CRT_RAND_MULT = 214013;
export const CRT_RAND_INC = 2531011;

// Raised when strict RNG tracing sees an untagged gameplay draw.
export class MissingRngCallerError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'MissingRngCallerError';
  }
}


export class RngDrawRecord {
  readonly stateBefore: number;
  readonly stateAfter: number;
  readonly value: number;
  readonly caller: CallerStatic;

  constructor(opts: {
    stateBefore: number;
    stateAfter: number;
    value: number;
    caller: CallerStatic;
  }) {
    this.stateBefore = opts.stateBefore;
    this.stateAfter = opts.stateAfter;
    this.value = opts.value;
    this.caller = opts.caller;
  }
}

// MSVCRT-compatible `rand()` LCG used by the original game.
//
// Matches:
//   seed = seed * 214013 + 2531011
//   return (seed >> 16) & 0x7fff
export class CrtRand {
  protected _state: number;
  protected _traceSink: RngTraceSink | null;
  protected _traceRequireCaller: boolean;

  constructor(seed: number | null = null) {
    if (seed === null) {
      seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
    }
    this._state = (seed >>> 0);
    this._traceSink = null;
    this._traceRequireCaller = false;
  }

  get state(): number {
    return this._state;
  }

  srand(seed: number): void {
    this._state = (seed >>> 0);
  }

  advance(draws: number): void {
    const steps = int(draws);
    if (steps < 0) {
      throw new Error(`draws must be >= 0, got ${draws}`);
    }
    let state = this._state;
    for (let i = 0; i < steps; i++) {
      state = ((state * CRT_RAND_MULT + CRT_RAND_INC) >>> 0);
    }
    this._state = state;
  }

  get traceSink(): RngTraceSink | null {
    return this._traceSink;
  }

  get traceRequireCaller(): boolean {
    return this._traceRequireCaller;
  }

  setTraceSink(sink: RngTraceSink | null, opts: { requireCaller?: boolean } = {}): void {
    const requireCaller = opts.requireCaller ?? false;
    this._traceSink = sink;
    this._traceRequireCaller = requireCaller;
  }

  rand(opts: { caller?: CallerStatic } = {}): number {
    const caller = opts.caller ?? null;
    const stateBefore = this._state;
    this._state = ((this._state * CRT_RAND_MULT + CRT_RAND_INC) >>> 0);
    const value = Math.floor(this._state / (2 ** 16)) & 0x7FFF;
    if (caller !== null && !(0 <= caller && caller <= 0xFFFFFFFF)) {
      throw new Error(`caller must be a uint32, got ${caller}`);
    }
    const traceSink = this._traceSink;
    if (traceSink !== null) {
      if (this._traceRequireCaller && caller === null) {
        throw new MissingRngCallerError('strict RNG trace requires caller');
      }
      traceSink(int(stateBefore), int(this._state), int(value), caller);
    }
    return value;
  }
}

// MSVCRT-compatible `rand()` LCG.
export class Crand extends CrtRand {
}

export class RecordingState {
  base: CrandLike;
  records: RngDrawRecord[];

  constructor(base: CrandLike) {
    this.base = base;
    this.records = [];
  }
}

export class RecordingCrand {
  protected _shared: RecordingState;

  get shared(): RecordingState {
    return this._shared;
  }

  constructor(base: CrandLike, shared: RecordingState | null = null) {
    this._shared = shared === null ? new RecordingState(base) : shared;
  }

  get state(): number {
    return int(this._shared.base.state);
  }

  get calls(): number {
    return this._shared.records.length;
  }

  get records(): readonly RngDrawRecord[] {
    return Array.from(this._shared.records);
  }

  srand(seed: number): void {
    this._shared.base.srand(int(seed));
    ((target: unknown) => {
      if (target !== null && typeof target === 'object' && typeof (target as { clear?: unknown }).clear === 'function') {
        (target as { clear: () => void }).clear();
      } else if (target !== null && typeof target === 'object' && 'length' in target) {
        (target as { length: number }).length = 0;
      }
    })(this._shared.records);
  }

  rand(opts: { caller?: CallerStatic } = {}): number {
    const caller = opts.caller ?? null;
    const stateBefore = int(this._shared.base.state);
    const value = this._shared.base.rand();
    const stateAfter = int(this._shared.base.state);
    this._shared.records.push(new RngDrawRecord({ stateBefore: stateBefore, stateAfter: stateAfter, value: value, caller: caller }));
    return value;
  }

  advance(draws: number): void {
    const steps = int(draws);
    if (steps < 0) {
      throw new Error(`draws must be >= 0, got ${draws}`);
    }
    this._shared.base.advance(steps);
  }

  recordsSince(startCall: number = 0): RngDrawRecord[] {
    const start = Math.max(0, int(startCall));
    return Array.from(this._shared.records.slice(start));
  }

  valuesSince(startCall: number = 0): number[] {
    return Array.from(this.recordsSince(startCall)).map((record) => record.value);
  }
}
