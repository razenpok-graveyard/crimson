// Port of crimson/net/relay_reliable.py

import { RELIABLE_RESEND_MS, NetMessage, RelayPacket } from '@crimson/net/relay-protocol.ts';

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export class RelayPendingReliable {
  packet: RelayPacket;
  sentAtMs: number;

  constructor(opts: {
    packet: RelayPacket;
    sentAtMs: number;
  }) {
    this.packet = opts.packet;
    this.sentAtMs = opts.sentAtMs;
  }
}

// Per-peer reliability state for relay protocol packets.
export class RelayReliableLink {
  resendMs: number;
  _nextSeq: number;
  _recvHighestSeq: number;
  _pending: Map<number, RelayPendingReliable>;
  _recvBuffer: Map<number, RelayPacket>;
  _rttLastMs: number;
  _rttEwmaMs: number;
  _resendCount: number;

  constructor(opts: {
    resendMs?: number;
    _nextSeq?: number;
    _recvHighestSeq?: number;
    _pending?: Map<number, RelayPendingReliable>;
    _recvBuffer?: Map<number, RelayPacket>;
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

  primeRecvSeq(opts: { seq: number }): void;
  primeRecvSeq(seq: number): void;
  primeRecvSeq(seqOrOpts: number | { seq: number }): void {
    const seq: number = typeof seqOrOpts === 'object' && seqOrOpts !== null ? seqOrOpts.seq : seqOrOpts as number;
    const value = int(seq);
    if (value <= int(this._recvHighestSeq)) {
      return;
    }
    this._recvHighestSeq = int(value);
  }

  buildPacket(message: NetMessage, opts: { reliable: boolean; nowMs: number }): RelayPacket {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    let seq = 0;
    if (reliable) {
      seq = int(this._nextSeq);
      this._nextSeq += 1;
    }
    const packet = new RelayPacket({ seq: int(seq), ack: int(this._recvHighestSeq), reliable: reliable, message: message });
    if (reliable) {
      this._pending.set(int(seq), new RelayPendingReliable({ packet: packet, sentAtMs: int(nowMs) }));
    }
    return packet;
  }

  ingestPacket(packet: RelayPacket, opts: { nowMs: number }): [NetMessage[], boolean] {
    const nowMs = opts.nowMs;
    this._applyAck(int(packet.ack), { nowMs: int(nowMs) });
    if (!Boolean(packet.reliable)) {
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

    const newestSeq = Math.max(...Array.from(toDrop, (seq) => int(seq)));
    const pending = this._pending.get(int(newestSeq)) ?? null;
    if (pending !== null) {
      const sampleMs = Math.max(0, int(nowMs) - int(pending.sentAtMs));
      this._rttLastMs = int(sampleMs);
      if (this._rttEwmaMs <= 0.0) {
        this._rttEwmaMs = sampleMs;
      } else {
        this._rttEwmaMs = (this._rttEwmaMs * 0.9 + sampleMs * 0.1);
      }
    }

    for (const seq of toDrop) {
      this._pending.delete(int(seq));
    }
  }

  pollResends(opts: { nowMs: number }): RelayPacket[] {
    const nowMs = opts.nowMs;
    const out: RelayPacket[] = [];
    for (let [seq, pending] of Array.from(this._pending.entries())) {
      if (int(nowMs) - int(pending.sentAtMs) < int(this.resendMs)) {
        continue;
      }
      const refreshed = new RelayPacket({ seq: int(pending.packet.seq), ack: int(this._recvHighestSeq), reliable: true, message: pending.packet.message });
      this._pending.set(int(seq), new RelayPendingReliable({ packet: refreshed, sentAtMs: int(nowMs) }));
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
