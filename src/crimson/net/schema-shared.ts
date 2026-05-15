// Port of crimson/net/schema_shared.py

import type { NonNegativeInt, SignedIndex } from '@crimson/msgspec-types.ts';

export class SlotState {
  slotIndex: SignedIndex;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  peerName: string;

  constructor(opts: {
    slotIndex?: SignedIndex;
    connected?: boolean;
    ready?: boolean;
    isHost?: boolean;
    peerName?: string;
  } = {}) {
    this.slotIndex = opts.slotIndex ?? -1;
    this.connected = opts.connected ?? false;
    this.ready = opts.ready ?? false;
    this.isHost = opts.isHost ?? false;
    this.peerName = opts.peerName ?? '';
  }
}

export class PacketHeader {
  seq: NonNegativeInt;
  ack: NonNegativeInt;
  reliable: boolean;

  constructor(opts: {
    seq?: NonNegativeInt;
    ack?: NonNegativeInt;
    reliable?: boolean;
  } = {}) {
    this.seq = opts.seq ?? 0;
    this.ack = opts.ack ?? 0;
    this.reliable = opts.reliable ?? false;
  }
}
