// Port of crimson/typo/state.py

import type { Vec2 } from '@grim/geom.ts';
import { CreatureNameTable } from '@crimson/typo/names.ts';
import { TypingBuffer } from '@crimson/typo/typing.ts';

export function resetTypoState(typo: TypoState, opts: { creatureCapacity: number; dictionaryWords?: readonly string[]; highscoreNames?: readonly string[] }): void {
  const creatureCapacity = opts.creatureCapacity;
  const dictionaryWords = opts.dictionaryWords ?? [];
  const highscoreNames = opts.highscoreNames ?? [];
  typo.typing = new TypingBuffer();
  typo.names = CreatureNameTable.sized(int(creatureCapacity));
  typo.spawnCooldownMs = 0;
  typo.dictionaryWords = dictionaryWords.map((word) => String(word));
  typo.highscoreNames = highscoreNames.map((name) => String(name));
  typo.pendingFireTarget = null;
  typo.pendingReload = false;
}

export function typoShotCounts(typo: TypoState): [number, number] {
  return [int(typo.typing.submitCount), int(typo.typing.matchCount)];
}

export class TypoState {
  typing: TypingBuffer;
  names: CreatureNameTable;
  spawnCooldownMs: number;
  dictionaryWords: readonly string[];
  highscoreNames: readonly string[];
  pendingFireTarget: Vec2 | null;
  pendingReload: boolean;

  constructor(opts: {
    typing?: TypingBuffer;
    names?: CreatureNameTable;
    spawnCooldownMs?: number;
    dictionaryWords?: readonly string[];
    highscoreNames?: readonly string[];
    pendingFireTarget?: Vec2 | null;
    pendingReload?: boolean;
  } = {}) {
    this.typing = opts.typing ?? new TypingBuffer();
    this.names = opts.names ?? CreatureNameTable.sized(0);
    this.spawnCooldownMs = opts.spawnCooldownMs ?? 0;
    this.dictionaryWords = Array.from(opts.dictionaryWords ?? []);
    this.highscoreNames = Array.from(opts.highscoreNames ?? []);
    this.pendingFireTarget = opts.pendingFireTarget ?? null;
    this.pendingReload = opts.pendingReload ?? false;
  }
}
