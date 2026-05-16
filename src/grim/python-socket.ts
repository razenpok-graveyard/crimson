import * as dgram from 'node:dgram';

export const AF_INET = 2;
export const SOCK_DGRAM = 2;

export class BlockingIOError extends Error {}
export class OSError extends Error {}

export type socket = Socket;

export function socket(_family: number, _type: number): Socket {
  return new Socket(dgram.createSocket('udp4'));
}

export class Socket {
  private readonly socket: dgram.Socket;
  private readonly queue: Array<[Uint8Array, [string, number]]> = [];
  private boundAddr: [string, number] = ['0.0.0.0', 0];

  constructor(socket: dgram.Socket) {
    this.socket = socket;
    this.socket.on('message', (message, remote) => {
      this.queue.push([new Uint8Array(message), [remote.address, remote.port]]);
    });
    this.socket.on('error', () => undefined);
  }

  setblocking(_enabled: boolean): void {
    void _enabled;
  }

  bind(addr: [string, number]): void {
    const [host, port] = addr;
    this.boundAddr = [host, port];
    this.socket.bind(port, host);
  }

  getsockname(): [string, number] {
    const address = this.socket.address();
    if (typeof address === 'string') {
      return this.boundAddr;
    }
    return [address.address, address.port];
  }

  close(): void {
    this.socket.close();
  }

  sendto(blob: Uint8Array, addr: [string, number]): void {
    this.socket.send(blob, addr[1], addr[0]);
  }

  recvfrom(_size: number): [Uint8Array, [string, number]] {
    void _size;
    const item = this.queue.shift();
    if (item === undefined) {
      throw new BlockingIOError();
    }
    return item;
  }
}
