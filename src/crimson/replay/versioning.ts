// Port of crimson/replay/versioning.py

import { Replay, currentReplayGameVersion } from '@crimson/replay/types.ts';

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

// Raised when replay `game_version` is incompatible with runtime version.
export class ReplayGameVersionError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'ReplayGameVersionError';
  }
}

// Warned when replay and runtime build metadata differ while game version matches.
export class ReplayGameVersionWarning extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'ReplayGameVersionWarning';
  }
}


function splitGameVersion(value: string): [string, string] {
  const [gameVersion, sep, buildMetadata] = (() => { const text = String(value); const sep = '+'; const index = text.indexOf(sep); return index === -1 ? [text, '', ''] : [text.slice(0, index), sep, text.slice(index + sep.length)]; })();
  if (!sep) {
    return [gameVersion.trim(), ''];
  }
  return [gameVersion.trim(), buildMetadata.trim()];
}

export function warnOnGameVersionMismatch(replay: Replay, opts: { action?: string; currentVersion?: string | null } = {}): void {
  // Require matching game version; warn when only build metadata differs.

  const action = opts.action ?? 'playback';
  const currentVersion = opts.currentVersion ?? null;
  const expected = currentVersion !== null ? currentVersion.trim() : (currentReplayGameVersion()).trim();
  const got = replay.header.gameVersion.trim();

  if (!got) {
    throw new ReplayGameVersionError(`Replay is missing game_version; ${action} requires a matching game version (current=${pythonRepr(expected)}).`);
  }

  const [expectedGameVersion, ] = splitGameVersion(expected);
  const [replayGameVersion, ] = splitGameVersion(got);
  if (replayGameVersion !== expectedGameVersion) {
    throw new ReplayGameVersionError(`Replay game_version mismatch; ${action} requires a matching game version (replay=${pythonRepr(got)}, current=${pythonRepr(expected)}).`);
  }

  if (got !== expected) {
    console.warn(`Replay game_version build metadata differs (git tag/hash mismatch); continuing because base game version matches (replay=${pythonRepr(got)}, current=${pythonRepr(expected)}).`);
  }
}
