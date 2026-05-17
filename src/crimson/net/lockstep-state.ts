// Port of crimson/net/lockstep_state.py

import { PackedPlayerInput } from '@crimson/replay/types.ts';
import { INPUT_DELAY_TICKS, INPUT_STALL_TIMEOUT_MS, InputBatch, InputSample, PauseState, TickFrame } from '@crimson/net/lockstep-protocol.ts';

export const CLIENT_MAX_CAPTURE_LEAD_TICKS = 1;
export const CLIENT_MAX_RESEND_SAMPLES = 64;
export const CLIENT_MAX_SENT_HISTORY_TICKS = 256;

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

function mapGetOrInit<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const value = create();
  map.set(key, value);
  return value;
}

export class HostLockstepState {
  playerCount: number;
  inputDelayTicks: number;
  inputStallTimeoutMs: number;
  _inputsByTick: Map<number, Map<number, PackedPlayerInput>>;
  _nextEmitTick: number;
  _lastProgressMs: number;
  _paused: boolean;

  constructor(opts: {
    playerCount: number;
    inputDelayTicks?: number;
    inputStallTimeoutMs?: number;
    _inputsByTick?: Map<number, Map<number, PackedPlayerInput>>;
    _nextEmitTick?: number;
    _lastProgressMs?: number;
    _paused?: boolean;
  }) {
    this.playerCount = opts.playerCount;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.inputStallTimeoutMs = opts.inputStallTimeoutMs ?? INPUT_STALL_TIMEOUT_MS;
    this._inputsByTick = opts._inputsByTick ?? new Map();
    this._nextEmitTick = opts._nextEmitTick ?? 0;
    this._lastProgressMs = opts._lastProgressMs ?? 0;
    this._paused = opts._paused ?? false;
  }

  get nextEmitTick(): number {
    return int(this._nextEmitTick);
  }

  get bufferedTickCount(): number {
    return this._inputsByTick.size;
  }

  get paused(): boolean {
    return this._paused;
  }

  get lastProgressMs(): number {
    return int(this._lastProgressMs);
  }

  waitingForInputs(opts: { tickIndex?: number | null } = {}): number {
    let tickIndex = opts.tickIndex ?? null;
    if (tickIndex === null) {
      tickIndex = int(this._nextEmitTick);
    }
    const tickInputs = this._inputsByTick.get(int(tickIndex)) ?? new Map<number, PackedPlayerInput>();
    return Math.max(0, int(this.playerCount) - tickInputs.size);
  }

  submitInputSample(opts: { slotIndex: number; tickIndex: number; packedInput: PackedPlayerInput }): void {
    const slotIndex = opts.slotIndex;
    const tickIndex = opts.tickIndex;
    const packedInput = opts.packedInput;
    if (int(slotIndex) < 0 || int(slotIndex) >= int(this.playerCount)) {
      return;
    }
    if (int(tickIndex) < int(this._nextEmitTick)) {
      return;
    }
    const tickInputs = mapGetOrInit(this._inputsByTick, int(tickIndex), () => new Map<number, PackedPlayerInput>());
    tickInputs.set(int(slotIndex), Array.from(packedInput));
  }

  submitInputBatch(batch: InputBatch): void {
    const slot = int(batch.slotIndex);
    for (const sample of batch.samples) {
      this.submitInputSample({
        slotIndex: int(slot),
        tickIndex: int(sample.tickIndex),
        packedInput: sample.packedInput,
      });
    }
  }

  _tickComplete(opts: { tickIndex: number }): boolean;
  _tickComplete(tickIndex: number): boolean;
  _tickComplete(tickIndexOrOpts: number | { tickIndex: number }): boolean {
    const tickIndex: number = typeof tickIndexOrOpts === 'object' && tickIndexOrOpts !== null && 'tickIndex' in tickIndexOrOpts ? tickIndexOrOpts.tickIndex : tickIndexOrOpts as number;
    const tickInputs = this._inputsByTick.get(int(tickIndex)) ?? null;
    if (tickInputs === null) {
      return false;
    }
    if (tickInputs.size < int(this.playerCount)) {
      return false;
    }
    return Array.from({ length: Math.max(0, int(this.playerCount)) }, (_, i) => i).every((slot) => tickInputs.has(int(slot)));
  }

  popReadyFrames(opts: { nowMs: number }): HostReadyTick[] {
    const nowMs = opts.nowMs;
    const frames: HostReadyTick[] = [];
    while (this._tickComplete(int(this._nextEmitTick))) {
      const tick = int(this._nextEmitTick);
      const tickInputs = this._inputsByTick.get(tick) ?? new Map<number, PackedPlayerInput>();
      this._inputsByTick.delete(tick);
      const orderedInputs = Array.from({ length: Math.max(0, int(this.playerCount)) }, (_, i) => i).map((slot) => Array.from(mapGetOrThrow(tickInputs, slot)));
      frames.push(new HostReadyTick({ tickIndex: int(tick), frameInputs: orderedInputs }));
      this._nextEmitTick += 1;
      this._lastProgressMs = int(nowMs);
    }

    return frames;
  }

  updatePauseState(opts: { nowMs: number }): PauseState | null {
    const nowMs = opts.nowMs;
    const tickInputs = this._inputsByTick.get(int(this._nextEmitTick)) ?? new Map<number, PackedPlayerInput>();
    const waitingFor = Math.max(0, int(this.playerCount) - tickInputs.size);
    const shouldPause = waitingFor > 0 && (int(nowMs) - int(this._lastProgressMs)) >= int(this.inputStallTimeoutMs);
    if (Boolean(shouldPause) === this._paused) {
      return null;
    }
    this._paused = Boolean(shouldPause);
    if (shouldPause) {
      return new PauseState({ paused: true, reason: 'waiting_input' });
    }
    return new PauseState({ paused: false, reason: '' });
  }

  tickComplete(opts: { tickIndex: number }): boolean;
  tickComplete(tickIndex: number): boolean;
  tickComplete(tickIndexOrOpts: number | { tickIndex: number }): boolean {
    const tickIndex: number = typeof tickIndexOrOpts === 'object' && tickIndexOrOpts !== null && 'tickIndex' in tickIndexOrOpts ? tickIndexOrOpts.tickIndex : tickIndexOrOpts as number;
    return this._tickComplete(tickIndex);
  }
}

export class HostReadyTick {
  tickIndex: number;
  frameInputs: PackedPlayerInput[];

  constructor(opts: {
    tickIndex?: number;
    frameInputs?: PackedPlayerInput[];
  } = {}) {
    this.tickIndex = opts.tickIndex ?? 0;
    this.frameInputs = opts.frameInputs ?? [];
  }
}

export class ClientLockstepState {
  localSlotIndex: number;
  inputDelayTicks: number;
  inputStallTimeoutMs: number;
  maxResendSamples: number;
  maxSentHistoryTicks: number;
  _captureTick: number;
  _sentInputs: Map<number, PackedPlayerInput>;
  _canonicalByTick: Map<number, TickFrame>;
  _nextConsumeTick: number;
  _lastProgressMs: number;
  _paused: boolean;

  constructor(opts: {
    localSlotIndex: number;
    inputDelayTicks?: number;
    inputStallTimeoutMs?: number;
    maxResendSamples?: number;
    maxSentHistoryTicks?: number;
    _captureTick?: number;
    _sentInputs?: Map<number, PackedPlayerInput>;
    _canonicalByTick?: Map<number, TickFrame>;
    _nextConsumeTick?: number;
    _lastProgressMs?: number;
    _paused?: boolean;
  }) {
    this.localSlotIndex = opts.localSlotIndex;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.inputStallTimeoutMs = opts.inputStallTimeoutMs ?? INPUT_STALL_TIMEOUT_MS;
    this.maxResendSamples = opts.maxResendSamples ?? CLIENT_MAX_RESEND_SAMPLES;
    this.maxSentHistoryTicks = opts.maxSentHistoryTicks ?? CLIENT_MAX_SENT_HISTORY_TICKS;
    this._captureTick = opts._captureTick ?? 0;
    this._sentInputs = opts._sentInputs ?? new Map();
    this._canonicalByTick = opts._canonicalByTick ?? new Map();
    this._nextConsumeTick = opts._nextConsumeTick ?? 0;
    this._lastProgressMs = opts._lastProgressMs ?? 0;
    this._paused = opts._paused ?? false;
  }

  get nextConsumeTick(): number {
    return int(this._nextConsumeTick);
  }

  get captureTick(): number {
    return int(this._captureTick);
  }

  get bufferedFrameCount(): number {
    return this._canonicalByTick.size;
  }

  get paused(): boolean {
    return this._paused;
  }

  get lastProgressMs(): number {
    return int(this._lastProgressMs);
  }

  queueLocalInput(packedInput: PackedPlayerInput): InputBatch {
    // Keep the joiner's "capture clock" close to lockstep progress to avoid
    // scheduling inputs far in the future (which manifests as extra input lag).
    const maxCaptureTick = int(this._nextConsumeTick) + int(CLIENT_MAX_CAPTURE_LEAD_TICKS);
    if (int(this._captureTick) > int(maxCaptureTick)) {
      this._captureTick = int(maxCaptureTick);
    }

    const targetTick = int(this._captureTick + int(this.inputDelayTicks));
    this._sentInputs.set(int(targetTick), Array.from(packedInput));

    const samples: InputSample[] = [];
    let oldestTick = Math.max(0, int(this._nextConsumeTick));
    const historyTicks = int(this.maxSentHistoryTicks);
    if (historyTicks > 0) {
      oldestTick = Math.max(int(oldestTick), int(targetTick) - int(historyTicks) + 1);
    }
    const maxSamples = Math.max(1, int(this.maxResendSamples));
    let sampleCount = 0;
    for (let tick = int(targetTick); -1 >= 0 ? tick < int(oldestTick) - 1 : tick > int(oldestTick) - 1; tick += -1) {
      const value = this._sentInputs.get(int(tick)) ?? null;
      if (value === null) {
        continue;
      }
      samples.push(new InputSample({ tickIndex: int(tick), packedInput: Array.from(value) }));
      sampleCount += 1;
      if (int(sampleCount) >= int(maxSamples)) {
        break;
      }
    }

    // Keep memory bounded while preserving any still-unacknowledged ticks.
    let minKeepTick = Math.max(0, int(this._nextConsumeTick));
    if (historyTicks > 0) {
      minKeepTick = Math.max(int(minKeepTick), int(targetTick) - int(historyTicks) + 1);
    }
    const maxKeepTick = int(targetTick);
    for (const tick of Array.from(this._sentInputs.keys())) {
      if (int(tick) < int(minKeepTick) || int(tick) > int(maxKeepTick)) {
        this._sentInputs.delete(int(tick));
      }
    }

    this._captureTick += 1;
    return new InputBatch({ slotIndex: int(this.localSlotIndex), samples: samples });
  }

  ingestTickFrame(frame: TickFrame, opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    const tick = int(frame.tickIndex);
    this._canonicalByTick.set(int(tick), new TickFrame({ tickIndex: int(frame.tickIndex), frameInputs: Array.from(frame.frameInputs).map((item) => Array.from(item)), commands: Array.from(frame.commands) }));
    this._lastProgressMs = int(nowMs);
  }

  popCanonicalFrame(): TickFrame | null {
    const tick = int(this._nextConsumeTick);
    const frame = this._canonicalByTick.get(int(tick)) ?? null;
    this._canonicalByTick.delete(int(tick));
    if (frame === null) {
      return null;
    }
    this._nextConsumeTick += 1;
    return frame;
  }

  hasCanonicalFrame(): boolean {
    return this._canonicalByTick.has(int(this._nextConsumeTick));
  }

  updatePauseState(opts: { nowMs: number }): PauseState | null {
    const nowMs = opts.nowMs;
    const frameReady = this._canonicalByTick.has(int(this._nextConsumeTick));
    const shouldPause = !frameReady && (int(nowMs) - int(this._lastProgressMs)) >= int(this.inputStallTimeoutMs);
    if (Boolean(shouldPause) === this._paused) {
      return null;
    }
    this._paused = Boolean(shouldPause);
    if (shouldPause) {
      return new PauseState({ paused: true, reason: 'waiting_tick_frame' });
    }
    return new PauseState({ paused: false, reason: '' });
  }
}
