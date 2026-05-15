// Port of crimson/cli/session.py

import { GameConfig, runGame } from '@crimson/game/index.ts';

export type SessionMode = "survival" | "rush" | "quests";
export type ParsedNetcodeMode = "rollback" | "lockstep";

function pythonRepr(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'nan';
    }
    if (value === Infinity) {
      return 'inf';
    }
    if (value === -Infinity) {
      return '-inf';
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === true) {
    return 'True';
  }
  if (value === false) {
    return 'False';
  }
  if (value === null) {
    return 'None';
  }
  return String(value);
}

export function parseSessionMode(mode: string): SessionMode {
  const modeName = mode.trim().toLowerCase();
  if (modeName === 'survival') {
    return 'survival';
  }
  if (modeName === 'rush') {
    return 'rush';
  }
  if (modeName === 'quests') {
    return 'quests';
  }
  throw new Error(`unsupported mode ${pythonRepr(mode)}; expected one of: survival, rush, quests`);
}

export function parseNetcodeMode(raw: string): ParsedNetcodeMode {
  const value = raw.trim().toLowerCase();
  if (value === 'rollback' || value === 'rb') {
    return 'rollback';
  }
  if (value === 'lockstep') {
    return 'lockstep';
  }
  throw new Error(`unsupported netcode ${pythonRepr(raw)}; expected rollback|lockstep`);
}

export function runGameWithPendingSession(opts: { pending: any; baseDir: string; assetsDir: string | null; width: number | null; height: number | null; fps: number; debug: boolean; rtx: boolean }): void {
  const pending = opts.pending;
  const baseDir = opts.baseDir;
  const assetsDir = opts.assetsDir;
  const width = opts.width;
  const height = opts.height;
  const fps = opts.fps;
  const debug = opts.debug;
  const rtx = opts.rtx;
  runGame(new GameConfig({ baseDir: baseDir, assetsDir: assetsDir, width: width, height: height, fps: fps, debug: debug, rtx: rtx, preserveBugs: false, pendingNetworkSession: pending }));
}
