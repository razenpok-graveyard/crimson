// Port of crimson/net/relay_transport.py

import { RelayPacket, decodePacket, encodePacket } from '@crimson/net/relay-protocol.ts';
import * as socket from '@grim/python-socket.ts';

export type PeerAddr = [string, number];

export class RelayUdpTransport {
  bindHost: string;
  bindPort: number;
  recvBufferSize: number;
  _sock: socket.socket | null;

  constructor(opts: {
    bindHost: string;
    bindPort: number;
    recvBufferSize?: number;
    _sock?: socket.socket | null;
  }) {
    this.bindHost = opts.bindHost;
    this.bindPort = opts.bindPort;
    this.recvBufferSize = opts.recvBufferSize ?? 65536;
    this._sock = opts._sock ?? null;
  }

  get boundPort(): number {
    const sock = this._sock;
    if (sock === null) {
      return Math.trunc(this.bindPort);
    }
    return Math.trunc(sock.getsockname()[1]);
  }

  open(): void {
    if (this._sock !== null) {
      return;
    }
    const sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM);
    sock.setblocking(false);
    sock.bind([String(this.bindHost), Math.trunc(this.bindPort)]);
    this._sock = sock;
  }

  close(): void {
    const sock = this._sock;
    this._sock = null;
    if (sock === null) {
      return;
    }
    try {
      sock.close();
    } catch (exc) {
      return;
    }
  }

  sendPacket(addr: PeerAddr, packet: RelayPacket): void {
    const sock = this._sock;
    if (sock === null) {
      throw new Error('transport is not open');
    }
    const blob = encodePacket(packet);
    sock.sendto(blob, [String(addr[0]), Math.trunc(addr[1])]);
  }

  recvPackets(opts: { maxPackets?: number | null } = {}): [PeerAddr, RelayPacket][] {
    const maxPackets = opts.maxPackets ?? null;
    const sock = this._sock;
    if (sock === null) {
      return [];
    }
    const out: [PeerAddr, RelayPacket][] = [];
    const cap = maxPackets === null ? null : Math.max(0, Math.trunc(maxPackets));
    while (true) {
      if (cap !== null && out.length >= Math.trunc(cap)) {
        break;
      }
      let blob: ReturnType<typeof sock.recvfrom>[0];
      let rawAddr: ReturnType<typeof sock.recvfrom>[1];
      try {
        [blob, rawAddr] = sock.recvfrom(Math.trunc(this.recvBufferSize));
      } catch (exc) {
        break;
      }
      const addr: PeerAddr = [String(rawAddr[0]), Math.trunc(rawAddr[1])];
      let packet: ReturnType<typeof decodePacket>;
      try {
        packet = decodePacket(blob);
      } catch (exc) {
        continue;
      }
      out.push([addr, packet]);
    }
    return out;
  }
}
