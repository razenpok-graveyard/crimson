// Port of crimson/replay/recorder.py

import type { PlayerInput } from '@crimson/sim/input.ts';
import type { GameCommand } from '@crimson/sim/input-providers.ts';
import { packTickInputs } from '@crimson/replay/input-codec.ts';
import type { ReplayHeader } from '@crimson/replay/types.ts';
import { REPLAY_FORMAT_VERSION, Replay, ReplayTick } from '@crimson/replay/types.ts';

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

export class ReplayRecorder {
  protected _header: ReplayHeader;
  protected _defaultDt: number;
  protected _tickIndex: number;
  protected _ticks: ReplayTick[];

  constructor(header: ReplayHeader) {
    if (header.replayFormatVersion !== REPLAY_FORMAT_VERSION) {
      throw new Error(`unsupported replay format version: ${header.replayFormatVersion}`);
    }
    const tickRate = header.tickRate;
    if (tickRate <= 0) {
      throw new Error(`invalid tick_rate: ${tickRate}`);
    }
    this._header = header;
    this._defaultDt = 1.0 / tickRate;
    this._tickIndex = 0;
    this._ticks = [];
  }

  get header(): ReplayHeader {
    return this._header;
  }

  get tickIndex(): number {
    return this._tickIndex;
  }

  get recordedTickCount(): number {
    return this._ticks.length;
  }

  recordTick(inputs: readonly PlayerInput[], opts: { commands?: GameCommand[] | null; dt?: number | null } = {}): number {
    const commands = opts.commands ?? null;
    const dt = opts.dt ?? null;
    // Record a single simulation tick worth of inputs.
    //
    // Returns the tick index that was recorded.

    if (inputs.length !== this._header.playerCount) {
      throw new Error(`expected ${this._header.playerCount} player inputs, got ${inputs.length}`);
    }

    const packed = packTickInputs(inputs, { quant: this._header.inputQuantization });
    const tickDt = dt !== null ? dt : this._defaultDt;
    if (!Number.isFinite(tickDt) || tickDt < 0.0) {
      throw new Error(`dt must be finite and >= 0, got ${pythonRepr(tickDt)}`);
    }

    const tickIndex = this._tickIndex;
    this._ticks.push(new ReplayTick({ dt: tickDt, inputs: packed, commands: commands !== null && commands.length > 0 ? Array.from(commands) : [] }));
    this._tickIndex += 1;
    return tickIndex;
  }

  finish(): Replay {
    return new Replay({ header: this._header, ticks: this._ticks });
  }
}
