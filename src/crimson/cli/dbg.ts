// Port of crimson/cli/dbg.py

import { DesktopCliUnavailableError } from './root.ts';

export const dbgApp = {
  command(_name: string): (_fn: (...args: never[]) => void) => void {
    return (_fn) => {
      void _fn;
    };
  },
};

export function cmdDbgRecord(_opts: { replayFile?: string; out?: string; impl?: "python" | "zig"; chunkTicks?: number } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('dbg record');
}

export function cmdDbgHealth(_opts: { traceFile?: string; tickStart?: number | null; tickEnd?: number | null; jsonOut?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('dbg health');
}

export function cmdDbgVerify(_opts: object = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('dbg verify');
}

export function cmdDbgDiff(_opts: { goldenTrace?: string; candidateTrace?: string; tickStart?: number | null; tickEnd?: number | null; jsonOut?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('dbg diff');
}

export function cmdDbgBisect(_opts: { goldenTrace?: string; candidateTrace?: string; tickStart?: number | null; tickEnd?: number | null; windowBefore?: number; windowAfter?: number; jsonOut?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('dbg bisect');
}

export function cmdDbgTick(_opts: { traceFile?: string; tickIndex?: number; jsonMode?: boolean; jsonOut?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('dbg tick');
}

export function cmdDbgEntity(_opts: { traceFile?: string; entityUid?: number; ticks?: string | null; jsonMode?: boolean; jsonOut?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('dbg entity');
}

export function cmdDbgQuery(_opts: { traceFile?: string; expression?: string; limit?: number; jsonMode?: boolean; jsonOut?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('dbg query');
}

export function cmdDbgFocus(_opts: { goldenTrace?: string; candidateTrace?: string; tick?: number; jsonMode?: boolean; jsonOut?: string | null } = {}): void {
  void _opts;
  throw new DesktopCliUnavailableError('dbg focus');
}
