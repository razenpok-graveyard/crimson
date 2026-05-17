// Port of crimson/cli/net.py

import { DesktopCliUnavailableError } from './root.ts';

export const netApp = {
  command(_name: string): (_fn: (...args: never[]) => void) => void {
    return (_fn) => {
      void _fn;
    };
  },
};

export function parseOptionalQuestLevel(..._args: any[]): any {
  void _args;
  throw new DesktopCliUnavailableError('net _parse_optional_quest_level');
}
export const _parseOptionalQuestLevel = parseOptionalQuestLevel;

export function cmdNetHost(_opts: { mode?: string; questLevel?: string; players?: number; bind?: string; host?: string; port?: number; relayHost?: string; relayPort?: number; roomCode?: string; netcode?: string; rollbackMaxTicks?: number; reconnectTimeoutMs?: number; inputDelayTicks?: number; debug?: boolean; rtx?: boolean; width?: number | null; height?: number | null; fps?: number; baseDir?: string; assetsDir?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('net host');
}

export function cmdNetJoin(_opts: { code?: string; host?: string; port?: number; mode?: string; questLevel?: string; relayHost?: string; relayPort?: number; netcode?: string; rollbackMaxTicks?: number; reconnectTimeoutMs?: number; inputDelayTicks?: number; debug?: boolean; rtx?: boolean; width?: number | null; height?: number | null; fps?: number; baseDir?: string; assetsDir?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('net join');
}
