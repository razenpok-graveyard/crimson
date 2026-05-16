// Port of crimson/net/relay_transport.py

import { RelayPacket, decodePacket, encodePacket } from '@crimson/net/relay-protocol.ts';
import * as socket from '@grim/python-socket.ts';

export type PeerAddr = [string, number];

export class RelayUdpTransport {
  bindHost: string;
  bindPort: number;
  recvBufferSize: number;
  sock: socket.socket | null;

  constructor(opts: {
    bindHost: string;
    bindPort: number;
    recvBufferSize?: number;
    sock?: socket.socket | null;
  }) {
    this.bindHost = opts.bindHost;
    this.bindPort = opts.bindPort;
    this.recvBufferSize = opts.recvBufferSize ?? 65536;
    this.sock = opts.sock ?? null;
  }

  get boundPort(): number {
    const sock = this.sock;
    if (sock === null) {
      return int(this.bindPort);
    }
    return int(sock.getsockname()[1]);
  }

  open(): void {
    if (this.sock !== null) {
      return;
    }
    const sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM);
    sock.setblocking(false);
    sock.bind([String(this.bindHost), int(this.bindPort)]);
    this.sock = sock;
  }

  close(): void {
    const sock = this.sock;
    this.sock = null;
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
    const sock = this.sock;
    if (sock === null) {
      throw new Error('transport is not open');
    }
    const blob = encodePacket(packet);
    sock.sendto(blob, [String(addr[0]), int(addr[1])]);
  }

  recvPackets(opts: { maxPackets?: number | null } = {}): [PeerAddr, RelayPacket][] {
    const maxPackets = opts.maxPackets ?? null;
    const sock = this.sock;
    if (sock === null) {
      return [];
    }
    const out: [PeerAddr, RelayPacket][] = [];
    const cap = maxPackets === null ? null : Math.max(0, int(maxPackets));
    while (true) {
      if (cap !== null && out.length >= int(cap)) {
        break;
      }
      let blob: ReturnType<typeof sock.recvfrom>[0];
      let rawAddr: ReturnType<typeof sock.recvfrom>[1];
      try {
        [blob, rawAddr] = sock.recvfrom(int(this.recvBufferSize));
      } catch (exc) {
        break;
      }
      const addr: PeerAddr = [String(rawAddr[0]), int(rawAddr[1])];
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
