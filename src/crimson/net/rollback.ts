// Port of crimson/net/rollback.py

import { PackedPlayerInput } from '@crimson/replay/types.ts';
import { RbInputBatch, RbInputSample } from '@crimson/net/relay-protocol.ts';

let neutralInput: PackedPlayerInput = [0.0, 0.0, 0.0, 0.0, 0];
const _MAX_SENT_HISTORY_TICKS = 256;
const _MAX_RESEND_SAMPLES = 64;

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

function pythonEquals(left: object | string | number | boolean | null | undefined, right: object | string | number | boolean | null | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (left !== null && left !== undefined && typeof left === 'object') {
    const equal = Reflect.get(left, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(left, right));
    }
  }
  if (right !== null && right !== undefined && typeof right === 'object') {
    const equal = Reflect.get(right, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(right, left));
    }
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => pythonEquals(value, right[index]));
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && pythonEquals(Reflect.get(left, key), Reflect.get(right, key)));
  }
  return false;
}

export class RollbackFrame {
  readonly tickIndex: number;
  readonly frameInputs: PackedPlayerInput[];
  readonly predictedSlots: readonly number[];

  constructor(opts: {
    tickIndex: number;
    frameInputs: PackedPlayerInput[];
    predictedSlots?: readonly number[];
  }) {
    this.tickIndex = opts.tickIndex;
    this.frameInputs = opts.frameInputs;
    this.predictedSlots = Array.from(opts.predictedSlots ?? []);
  }
}

// Input timeline + prediction + rollback trigger bookkeeping.
//
// This controller does not mutate game state directly. It emits canonical tick
// inputs and reports rollback windows when late remote inputs disagree with
// previously-emitted predicted inputs.
export class RollbackController {
  playerCount: number;
  localSlotIndex: number;
  inputDelayTicks: number;
  maxRollbackTicks: number;
  maxSentHistoryTicks: number;
  maxResendSamples: number;
  _captureTick: number;
  _nextEmitTick: number;
  _knownBySlot: Map<number, Map<number, PackedPlayerInput>>;
  _emittedFrames: Map<number, PackedPlayerInput[]>;
  _pendingFrames: RollbackFrame[];
  _pendingRollbackFrom: number | null;
  _pendingResyncFrom: number | null;
  rollbackCount: number;
  predictionMismatches: number;
  maxRollbackDistance: number;

  constructor(opts: {
    playerCount: number;
    localSlotIndex: number;
    inputDelayTicks?: number;
    maxRollbackTicks?: number;
    maxSentHistoryTicks?: number;
    maxResendSamples?: number;
    _captureTick?: number;
    _nextEmitTick?: number;
    _knownBySlot?: Map<number, Map<number, PackedPlayerInput>>;
    _emittedFrames?: Map<number, PackedPlayerInput[]>;
    _pendingFrames?: RollbackFrame[];
    _pendingRollbackFrom?: number | null;
    _pendingResyncFrom?: number | null;
    rollbackCount?: number;
    predictionMismatches?: number;
    maxRollbackDistance?: number;
  }) {
    this.playerCount = opts.playerCount;
    this.localSlotIndex = opts.localSlotIndex;
    this.inputDelayTicks = opts.inputDelayTicks ?? 1;
    this.maxRollbackTicks = opts.maxRollbackTicks ?? 8;
    this.maxSentHistoryTicks = opts.maxSentHistoryTicks ?? _MAX_SENT_HISTORY_TICKS;
    this.maxResendSamples = opts.maxResendSamples ?? _MAX_RESEND_SAMPLES;
    this._captureTick = opts._captureTick ?? 0;
    this._nextEmitTick = opts._nextEmitTick ?? 0;
    this._knownBySlot = opts._knownBySlot ?? new Map();
    this._emittedFrames = opts._emittedFrames ?? new Map();
    this._pendingFrames = opts._pendingFrames ?? [];
    this._pendingRollbackFrom = opts._pendingRollbackFrom ?? null;
    this._pendingResyncFrom = opts._pendingResyncFrom ?? null;
    this.rollbackCount = opts.rollbackCount ?? 0;
    this.predictionMismatches = opts.predictionMismatches ?? 0;
    this.maxRollbackDistance = opts.maxRollbackDistance ?? 0;
    const players = Math.max(1, int(this.playerCount));
    this.playerCount = int(players);
    const slot = Math.max(0, Math.min(int(this.localSlotIndex), int(players) - 1));
    this.localSlotIndex = int(slot);
    this.inputDelayTicks = Math.max(0, int(this.inputDelayTicks));
    this.maxRollbackTicks = Math.max(1, int(this.maxRollbackTicks));
    for (let slotIndex = 0; slotIndex < int(this.playerCount); slotIndex++) {
      this._knownBySlot.set(int(slotIndex), new Map<number, PackedPlayerInput>());
    }
  }

  get captureTick(): number {
    return int(this._captureTick);
  }

  get nextEmitTick(): number {
    return int(this._nextEmitTick);
  }

  queueLocalInput(packedInput: PackedPlayerInput): RbInputBatch {
    const targetTick = int(this._captureTick) + int(this.inputDelayTicks);
    mapGetOrThrow(this._knownBySlot, int(this.localSlotIndex)).set(int(targetTick), Array.from(packedInput));

    const history = Math.max(1, int(this.maxSentHistoryTicks));
    const oldest = Math.max(int(this._nextEmitTick), int(targetTick) - int(history) + 1);
    const maxSamples = Math.max(1, int(this.maxResendSamples));

    const samples: RbInputSample[] = [];
    const slotMap = mapGetOrThrow(this._knownBySlot, int(this.localSlotIndex));
    let count = 0;
    for (let tick = int(targetTick); -1 >= 0 ? tick < int(oldest) - 1 : tick > int(oldest) - 1; tick += -1) {
      const value = slotMap.get(int(tick)) ?? null;
      if (value === null) {
        continue;
      }
      samples.push(new RbInputSample({ tickIndex: int(tick), packedInput: Array.from(value) }));
      count += 1;
      if (count >= int(maxSamples)) {
        break;
      }
    }

    for (const tick of Array.from(slotMap.keys())) {
      if (int(tick) < int(oldest) || int(tick) > int(targetTick)) {
        slotMap.delete(int(tick));
      }
    }

    this._captureTick += 1;
    this._emitReadyFrames();
    return new RbInputBatch({ slotIndex: int(this.localSlotIndex), samples: samples });
  }

  ingestRemoteSamples(opts: { slotIndex: number; samples: RbInputSample[] }): void {
    const slotIndex = opts.slotIndex;
    const samples = opts.samples;
    const slot = int(slotIndex);
    if (slot < 0 || slot >= int(this.playerCount)) {
      return;
    }
    if (slot === int(this.localSlotIndex)) {
      return;
    }
    const known = mapGetOrThrow(this._knownBySlot, int(slot));
    for (const sample of samples) {
      const tick = int(sample.tickIndex);
      if (tick < 0) {
        continue;
      }
      const incoming = Array.from(sample.packedInput);
      const prev = known.get(int(tick)) ?? null;
      known.set(int(tick), incoming);
      if (prev !== null && pythonEquals(prev, incoming)) {
        continue;
      }
      this._noteLateMismatch({ slotIndex: int(slot), tickIndex: int(tick), incoming: incoming });
    }
    this._emitReadyFrames();
  }

  popFrame(): RollbackFrame | null {
    if (this._pendingFrames.length === 0) {
      return null;
    }
    return this._pendingFrames.shift()!;
  }

  drainRollbackFrom(): number | null {
    const value = this._pendingRollbackFrom;
    this._pendingRollbackFrom = null;
    return value === null ? null : int(value);
  }

  drainResyncFrom(): number | null {
    const value = this._pendingResyncFrom;
    this._pendingResyncFrom = null;
    return value === null ? null : int(value);
  }

  rebuildEmittedFrom(opts: { fromTick: number }): RollbackFrame[];
  rebuildEmittedFrom(fromTick: number): RollbackFrame[];
  rebuildEmittedFrom(fromTickOrOpts: number | { fromTick: number }): RollbackFrame[] {
    const fromTick: number = typeof fromTickOrOpts === 'object' && fromTickOrOpts !== null && 'fromTick' in fromTickOrOpts ? fromTickOrOpts.fromTick : fromTickOrOpts as number;
    const start = Math.max(0, int(fromTick));
    const head = int(this._nextEmitTick);
    if (start >= int(head)) {
      return [];
    }

    const rebuilt: RollbackFrame[] = [];
    for (let tick = int(start); tick < int(head); tick++) {
      const predictedSlots: number[] = [];
      const frameInputs: PackedPlayerInput[] = [];
      for (let slot = 0; slot < int(this.playerCount); slot++) {
        let value = this._knownForTick(int(slot), int(tick));
        if (value === null) {
          predictedSlots.push(int(slot));
          value = this._predictForTick(int(slot), int(tick));
        }
        frameInputs.push(Array.from(value));
      }
      this._emittedFrames.set(int(tick), frameInputs.map((item) => Array.from(item)));
      rebuilt.push(new RollbackFrame({ tickIndex: int(tick), frameInputs: frameInputs.map((item) => Array.from(item)), predictedSlots: Array.from(predictedSlots) }));
    }
    return rebuilt;
  }

  resetToTick(opts: { tickIndex: number }): void;
  resetToTick(tickIndex: number): void;
  resetToTick(tickIndexOrOpts: number | { tickIndex: number }): void {
    const tickIndex: number = typeof tickIndexOrOpts === 'object' && tickIndexOrOpts !== null && 'tickIndex' in tickIndexOrOpts ? tickIndexOrOpts.tickIndex : tickIndexOrOpts as number;
    const target = Math.max(0, int(tickIndex));
    this._captureTick = Math.max(int(this._captureTick), int(target));
    this._nextEmitTick = Math.max(int(this._nextEmitTick), int(target));
    this._pendingFrames.length = 0;
    this._pendingRollbackFrom = null;
    this._pendingResyncFrom = null;
    for (const slotMap of this._knownBySlot.values()) {
      for (const tick of Array.from(slotMap.keys())) {
        if (int(tick) >= int(target)) {
          continue;
        }
        slotMap.delete(int(tick));
      }
    }
    for (const tick of Array.from(this._emittedFrames.keys())) {
      if (int(tick) >= int(target)) {
        continue;
      }
      this._emittedFrames.delete(int(tick));
    }
  }

  _emitReadyFrames(): void {
    const localKnown = mapGetOrThrow(this._knownBySlot, int(this.localSlotIndex));
    while (localKnown.has(int(this._nextEmitTick))) {
      const tick = int(this._nextEmitTick);
      const predictedSlots: number[] = [];
      const frameInputs: PackedPlayerInput[] = [];
      for (let slot = 0; slot < int(this.playerCount); slot++) {
        let value = this._knownForTick(int(slot), int(tick));
        if (value === null) {
          predictedSlots.push(int(slot));
          value = this._predictForTick(int(slot), int(tick));
        }
        frameInputs.push(Array.from(value));
      }
      this._pendingFrames.push(new RollbackFrame({ tickIndex: int(tick), frameInputs: frameInputs.map((item) => Array.from(item)), predictedSlots: Array.from(predictedSlots) }));
      this._emittedFrames.set(int(tick), frameInputs.map((item) => Array.from(item)));
      this._nextEmitTick += 1;
      this._pruneEmitted();
    }
  }

  _knownForTick(opts: { slot: number; tick: number }): PackedPlayerInput | null;
  _knownForTick(slot: number, tick: number): PackedPlayerInput | null;
  _knownForTick(slotOrOpts: number | { slot: number; tick: number }, tickArg: number | undefined = undefined): PackedPlayerInput | null {
    const slot: number = typeof slotOrOpts === 'object' && slotOrOpts !== null && 'slot' in slotOrOpts ? slotOrOpts.slot : slotOrOpts as number;
    const tick: number = typeof slotOrOpts === 'object' && slotOrOpts !== null && 'slot' in slotOrOpts ? slotOrOpts.tick : tickArg as number;
    return mapGetOrThrow(this._knownBySlot, int(slot)).get(int(tick)) ?? null;
  }

  _predictForTick(opts: { slot: number; tick: number }): PackedPlayerInput;
  _predictForTick(slot: number, tick: number): PackedPlayerInput;
  _predictForTick(slotOrOpts: number | { slot: number; tick: number }, tickArg: number | undefined = undefined): PackedPlayerInput {
    const slot: number = typeof slotOrOpts === 'object' && slotOrOpts !== null && 'slot' in slotOrOpts ? slotOrOpts.slot : slotOrOpts as number;
    const tick: number = typeof slotOrOpts === 'object' && slotOrOpts !== null && 'slot' in slotOrOpts ? slotOrOpts.tick : tickArg as number;
    const known = mapGetOrThrow(this._knownBySlot, int(slot));
    for (let back = int(tick) - 1; -1 >= 0 ? back < -1 : back > -1; back += -1) {
      const value = known.get(int(back)) ?? null;
      if (value !== null) {
        return Array.from(value);
      }
    }
    return Array.from(neutralInput);
  }

  _noteLateMismatch(opts: { slotIndex: number; tickIndex: number; incoming: PackedPlayerInput }): void {
    const slotIndex = opts.slotIndex;
    const tickIndex = opts.tickIndex;
    const incoming = opts.incoming;
    const emitted = this._emittedFrames.get(int(tickIndex)) ?? null;
    if (emitted === null) {
      return;
    }
    if (int(slotIndex) >= emitted.length) {
      return;
    }
    const predicted = emitted[int(slotIndex)];
    if (pythonEquals(Array.from(predicted), Array.from(incoming))) {
      return;
    }

    this.predictionMismatches = int(this.predictionMismatches) + 1;
    const distance = Math.max(0, int(this._nextEmitTick) - int(tickIndex));
    this.maxRollbackDistance = Math.max(int(this.maxRollbackDistance), int(distance));

    let pending: number | null;
    if (int(distance) > int(this.maxRollbackTicks)) {
      pending = this._pendingResyncFrom;
      if (pending === null) {
        this._pendingResyncFrom = int(tickIndex);
      } else {
        this._pendingResyncFrom = Math.min(int(pending), int(tickIndex));
      }
      return;
    }

    this.rollbackCount = int(this.rollbackCount) + 1;
    pending = this._pendingRollbackFrom;
    if (pending === null) {
      this._pendingRollbackFrom = int(tickIndex);
    } else {
      this._pendingRollbackFrom = Math.min(int(pending), int(tickIndex));
    }
  }

  _pruneEmitted(): void {
    const keepFrom = int(this._nextEmitTick) - Math.max(1, int(this.maxRollbackTicks)) - 2;
    for (const tick of Array.from(this._emittedFrames.keys())) {
      if (int(tick) >= int(keepFrom)) {
        continue;
      }
      this._emittedFrames.delete(int(tick));
    }
  }

  emitReadyFrames(): void {
    this._emitReadyFrames();
  }

  knownForTick(opts: { slot: number; tick: number }): PackedPlayerInput | null;
  knownForTick(slot: number, tick: number): PackedPlayerInput | null;
  knownForTick(slotOrOpts: number | { slot: number; tick: number }, tickArg: number | undefined = undefined): PackedPlayerInput | null {
    const slot: number = typeof slotOrOpts === 'object' && slotOrOpts !== null && 'slot' in slotOrOpts ? slotOrOpts.slot : slotOrOpts as number;
    const tick: number = typeof slotOrOpts === 'object' && slotOrOpts !== null && 'slot' in slotOrOpts ? slotOrOpts.tick : tickArg as number;
    return this._knownForTick(slot, tick);
  }

  predictForTick(opts: { slot: number; tick: number }): PackedPlayerInput;
  predictForTick(slot: number, tick: number): PackedPlayerInput;
  predictForTick(slotOrOpts: number | { slot: number; tick: number }, tickArg: number | undefined = undefined): PackedPlayerInput {
    const slot: number = typeof slotOrOpts === 'object' && slotOrOpts !== null && 'slot' in slotOrOpts ? slotOrOpts.slot : slotOrOpts as number;
    const tick: number = typeof slotOrOpts === 'object' && slotOrOpts !== null && 'slot' in slotOrOpts ? slotOrOpts.tick : tickArg as number;
    return this._predictForTick(slot, tick);
  }

  noteLateMismatch(opts: { slotIndex: number; tickIndex: number; incoming: PackedPlayerInput }): void {
    const slotIndex = opts.slotIndex;
    const tickIndex = opts.tickIndex;
    const incoming = opts.incoming;
    this._noteLateMismatch({ slotIndex: slotIndex, tickIndex: tickIndex, incoming: incoming });
  }

  pruneEmitted(): void {
    this._pruneEmitted();
  }
}
