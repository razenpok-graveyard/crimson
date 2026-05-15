// Port of crimson/sim/hooks.py

import type { ResolvedTick } from '@crimson/sim/input-providers.ts';
import type { DeterministicSessionTick } from '@crimson/sim/sessions.ts';
import type { GameCommand } from '@crimson/sim/input-providers.ts';

export class TickResult {
  sourceTick: ResolvedTick;
  payload: DeterministicSessionTick;
  replayTickIndex: number | null;
  lanSync: LanTickSync | null;

  constructor(opts: {
    sourceTick: ResolvedTick;
    payload: DeterministicSessionTick;
    replayTickIndex?: number | null;
    lanSync?: LanTickSync | null;
  }) {
    this.sourceTick = opts.sourceTick;
    this.payload = opts.payload;
    this.replayTickIndex = opts.replayTickIndex ?? null;
    this.lanSync = opts.lanSync ?? null;
  }
}

export class LanFrameSample {
  readonly frameTickIndex: number;
  readonly frameInputs: readonly number[][];
  readonly commands: readonly GameCommand[];

  constructor(opts: {
    frameTickIndex: number;
    frameInputs: readonly number[][];
    commands?: readonly GameCommand[];
  }) {
    this.frameTickIndex = opts.frameTickIndex;
    this.frameInputs = opts.frameInputs;
    this.commands = Array.from(opts.commands ?? []);
  }
}

export class LanTickSync {
  readonly frameTickIndex: number;
  readonly frameInputs: readonly number[][];

  constructor(opts: {
    frameTickIndex: number;
    frameInputs: readonly number[][];
  }) {
    this.frameTickIndex = opts.frameTickIndex;
    this.frameInputs = opts.frameInputs;
  }
}

export class LanSyncCallbacks {
  role: string;
  takeFrameSample: (arg0: number) => LanFrameSample | null;
  broadcastTickFrame: ((arg0: number, arg1: readonly number[][], arg2: readonly GameCommand[]) => void) | null;

  constructor(opts: {
    role: string;
    takeFrameSample: (arg0: number) => LanFrameSample | null;
    broadcastTickFrame?: ((arg0: number, arg1: readonly number[][], arg2: readonly GameCommand[]) => void) | null;
  }) {
    this.role = opts.role;
    this.takeFrameSample = opts.takeFrameSample;
    this.broadcastTickFrame = opts.broadcastTickFrame ?? null;
  }
}
