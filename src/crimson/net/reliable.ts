// Port of crimson/net/reliable.py

import { RELIABLE_RESEND_MS, LockstepPacket, NetMessage } from '@crimson/net/lockstep-protocol.ts';

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export class LockstepPendingReliable {
  packet: LockstepPacket;
  sentAtMs: number;

  constructor(opts: {
    packet: LockstepPacket;
    sentAtMs: number;
  }) {
    this.packet = opts.packet;
    this.sentAtMs = opts.sentAtMs;
  }
}

// Per-peer reliability state (sequence, ack, resend, de-dup).
export class ReliableLink {
  resendMs: number;
  _nextSeq: number;
  // Highest *contiguous* reliable sequence that has been received and delivered.
  _recvHighestSeq: number;
  _pending: Map<number, LockstepPendingReliable>;
  // Out-of-order reliable packets (seq > _recv_highest_seq + 1).
  _recvBuffer: Map<number, LockstepPacket>;
  // Very rough RTT estimate based on ACK turnaround. Useful for debugging only.
  _rttLastMs: number;
  _rttEwmaMs: number;
  _resendCount: number;

  constructor(opts: {
    resendMs?: number;
    _nextSeq?: number;
    _recvHighestSeq?: number;
    _pending?: Map<number, LockstepPendingReliable>;
    _recvBuffer?: Map<number, LockstepPacket>;
    _rttLastMs?: number;
    _rttEwmaMs?: number;
    _resendCount?: number;
  } = {}) {
    this.resendMs = opts.resendMs ?? RELIABLE_RESEND_MS;
    this._nextSeq = opts._nextSeq ?? 1;
    this._recvHighestSeq = opts._recvHighestSeq ?? 0;
    this._pending = opts._pending ?? new Map();
    this._recvBuffer = opts._recvBuffer ?? new Map();
    this._rttLastMs = opts._rttLastMs ?? 0;
    this._rttEwmaMs = opts._rttEwmaMs ?? 0.0;
    this._resendCount = opts._resendCount ?? 0;
  }

  get recvHighestSeq(): number {
    return int(this._recvHighestSeq);
  }

  get pendingCount(): number {
    return this._pending.size;
  }

  get rttLastMs(): number {
    return int(this._rttLastMs);
  }

  get rttEwmaMs(): number {
    return this._rttEwmaMs;
  }

  get resendCount(): number {
    return int(this._resendCount);
  }

  primeRecvSeq(seq: number): void {
    // Record a reliable seq as already delivered.
    //
    // Used when a trusted message is handled out-of-band (for example an
    // initial handshake packet) so ACK progression remains contiguous.
    const value = int(seq);
    if (value <= int(this._recvHighestSeq)) {
      return;
    }
    this._recvHighestSeq = int(value);
  }

  buildPacket(message: NetMessage, opts: { reliable: boolean; nowMs: number }): LockstepPacket {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    let seq = 0;
    if (reliable) {
      seq = int(this._nextSeq);
      this._nextSeq += 1;
    }
    const packet = new LockstepPacket({ seq: int(seq), ack: int(this._recvHighestSeq), reliable: reliable, message: message });
    if (reliable) {
      this._pending.set(int(seq), new LockstepPendingReliable({ packet: packet, sentAtMs: int(nowMs) }));
    }
    return packet;
  }

  ingestPacket(packet: LockstepPacket, opts: { nowMs: number }): [NetMessage[], boolean] {
    const nowMs = opts.nowMs;
    // Return `(messages, is_duplicate_reliable_packet)`.
    //
    // Reliable delivery uses a cumulative ACK of the highest contiguous reliable
    // sequence that has been received and delivered. Out-of-order packets are
    // buffered and only delivered once gaps are filled.
    this._applyAck(int(packet.ack), { nowMs: int(nowMs) });
    if (!packet.reliable) {
      return [[packet.message], false];
    }

    const seq = int(packet.seq);
    if (seq <= 0) {
      return [[], false];
    }

    if (seq <= int(this._recvHighestSeq)) {
      return [[], true];
    }
    if (this._recvBuffer.has(seq)) {
      return [[], true];
    }

    this._recvBuffer.set(int(seq), packet);

    const delivered: NetMessage[] = [];
    let nextSeq = int(this._recvHighestSeq) + 1;
    while (this._recvBuffer.has(nextSeq)) {
      const nextPacket = mapGetOrThrow(this._recvBuffer, int(nextSeq));
      this._recvBuffer.delete(int(nextSeq));
      delivered.push(nextPacket.message);
      this._recvHighestSeq = int(nextSeq);
      nextSeq += 1;
    }

    return [delivered, false];
  }

  _applyAck(ack: number, opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    if (int(ack) <= 0) {
      return;
    }
    const toDrop = Array.from(this._pending.keys()).filter((seq) => int(seq) <= int(ack));
    if (toDrop.length === 0) {
      return;
    }

    // RTT sample: use the newest pending seq that got ACKed in this packet.
    const newestSeq = Math.max(...Array.from(toDrop, (seq) => int(seq)));
    const pending = this._pending.get(int(newestSeq)) ?? null;
    if (pending !== null) {
      const sampleMs = Math.max(0, int(nowMs) - int(pending.sentAtMs));
      this._rttLastMs = int(sampleMs);
      if (this._rttEwmaMs <= 0.0) {
        this._rttEwmaMs = sampleMs;
      } else {
        // Heavily smoothed; this is for HUD/debug, not congestion control.
        this._rttEwmaMs = this._rttEwmaMs * 0.9 + sampleMs * 0.1;
      }
    }

    for (const seq of toDrop) {
      this._pending.delete(int(seq));
    }
  }

  pollResends(opts: { nowMs: number }): LockstepPacket[] {
    const nowMs = opts.nowMs;
    const out: LockstepPacket[] = [];
    for (let [seq, pending] of Array.from(this._pending.entries())) {
      if (int(nowMs) - int(pending.sentAtMs) < int(this.resendMs)) {
        continue;
      }
      // Re-send packet with up-to-date ACK.
      const refreshed = new LockstepPacket({ seq: int(pending.packet.seq), ack: int(this._recvHighestSeq), reliable: true, message: pending.packet.message });
      this._pending.set(int(seq), new LockstepPendingReliable({ packet: refreshed, sentAtMs: int(nowMs) }));
      out.push(refreshed);
      this._resendCount += 1;
    }
    return out;
  }

  applyAck(ack: number, opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._applyAck(ack, { nowMs: nowMs });
  }
}
