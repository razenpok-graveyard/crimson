// Port of crimson/net/adapter.py

import type { PackedPlayerInput } from '@crimson/replay/types.ts';
import type { InputBatch, PauseState, TickFrame } from '@crimson/net/lockstep-protocol.ts';
import { INPUT_DELAY_TICKS } from '@crimson/net/lockstep-protocol.ts';
import type { HostReadyTick } from '@crimson/net/lockstep-state.ts';
import { ClientLockstepState, HostLockstepState } from '@crimson/net/lockstep-state.ts';

export class ResyncFailureTracker {
  maxFailuresPerMatch: number;
  failures: number;

  constructor(opts: {
    maxFailuresPerMatch?: number;
    failures?: number;
  } = {}) {
    this.maxFailuresPerMatch = opts.maxFailuresPerMatch ?? 2;
    this.failures = opts.failures ?? 0;
  }

  noteFailure(): boolean {
    this.failures += 1;
    return int(this.failures) >= int(this.maxFailuresPerMatch);
  }

  reset(): void {
    this.failures = 0;
  }
}

export class HostLanAdapter {
  playerCount: number;
  inputDelayTicks: number;
  inputStallTimeoutMs: number;
  localSlotIndex: number;
  lockstep: HostLockstepState;
  resyncFailures: ResyncFailureTracker;

  constructor(opts: {
    playerCount: number;
    inputDelayTicks?: number;
    inputStallTimeoutMs?: number;
    localSlotIndex?: number;
    lockstep?: HostLockstepState;
    resyncFailures?: ResyncFailureTracker;
  }) {
    this.playerCount = opts.playerCount;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.inputStallTimeoutMs = opts.inputStallTimeoutMs ?? 250;
    this.localSlotIndex = opts.localSlotIndex ?? 0;
    this.resyncFailures = opts.resyncFailures ?? new ResyncFailureTracker();
    this.lockstep = new HostLockstepState({ playerCount: int(this.playerCount), inputDelayTicks: int(this.inputDelayTicks), inputStallTimeoutMs: int(this.inputStallTimeoutMs) });
  }

  submitLocalInput(opts: { tickIndex: number; packedInput: PackedPlayerInput }): void {
    const tickIndex = opts.tickIndex;
    const packedInput = opts.packedInput;
    this.lockstep.submitInputSample({
      slotIndex: int(this.localSlotIndex),
      tickIndex: int(tickIndex),
      packedInput: Array.from(packedInput),
    });
  }

  submitRemoteBatch(batch: InputBatch): void {
    this.lockstep.submitInputBatch(batch);
  }

  emitReadyFrames(opts: { nowMs: number }): HostReadyTick[] {
    const nowMs = opts.nowMs;
    return this.lockstep.popReadyFrames({ nowMs: int(nowMs) });
  }

  updatePauseState(opts: { nowMs: number }): PauseState | null {
    const nowMs = opts.nowMs;
    return this.lockstep.updatePauseState({ nowMs: int(nowMs) });
  }
}

export class ClientLanAdapter {
  localSlotIndex: number;
  inputDelayTicks: number;
  inputStallTimeoutMs: number;
  lockstep: ClientLockstepState;
  resyncFailures: ResyncFailureTracker;

  constructor(opts: {
    localSlotIndex: number;
    inputDelayTicks?: number;
    inputStallTimeoutMs?: number;
    lockstep?: ClientLockstepState;
    resyncFailures?: ResyncFailureTracker;
  }) {
    this.localSlotIndex = opts.localSlotIndex;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.inputStallTimeoutMs = opts.inputStallTimeoutMs ?? 250;
    this.resyncFailures = opts.resyncFailures ?? new ResyncFailureTracker();
    this.lockstep = new ClientLockstepState({ localSlotIndex: int(this.localSlotIndex), inputDelayTicks: int(this.inputDelayTicks), inputStallTimeoutMs: int(this.inputStallTimeoutMs) });
  }

  queueLocalInput(packedInput: PackedPlayerInput): InputBatch {
    return this.lockstep.queueLocalInput(Array.from(packedInput));
  }

  ingestTickFrame(frame: TickFrame, opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this.lockstep.ingestTickFrame(
      frame,
      { nowMs: int(nowMs) },
    );
  }

  popTickFrame(): TickFrame | null {
    return this.lockstep.popCanonicalFrame();
  }

  updatePauseState(opts: { nowMs: number }): PauseState | null {
    const nowMs = opts.nowMs;
    return this.lockstep.updatePauseState({ nowMs: int(nowMs) });
  }
}
