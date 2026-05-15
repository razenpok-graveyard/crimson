// Port of crimson/cli/relay.py

import { DesktopCliUnavailableError } from './root.ts';

export const relayApp = {
  command(_name: string): (_fn: (...args: never[]) => void) => void {
    return (_fn) => {
      void _fn;
    };
  },
};

export function cmdRelayServe(_opts: { bind?: string; port?: number; tickMs?: number; logLevel?: string; logFile?: string | null; baseDir?: string } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('relay serve');
}
