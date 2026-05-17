// Port of crimson/typo/names.py

import type { CrandLike } from '@grim/rand.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { readHighscoreTable } from '@crimson/persistence/highscores.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { readFileSync } from 'node:fs';

export const NAME_MAX_CHARS = 16; // creature_name_assign_random enforces strlen < 0x10.
export const NAME_PARTS: readonly string[] = [
  'lamb',
  'gun',
  'head',
  'tail',
  'leg',
  'nose',
  'road',
  'stab',
  'high',
  'low',
  'hat',
  'pie',
  'hand',
  'jack',
  'cube',
  'ice',
  'cow',
  'king',
  'lord',
  'mate',
  'mary',
  'dick',
  'bill',
  'cat',
  'harry',
  'tom',
  'fly',
  'call',
  'shot',
  'gate',
  'quick',
  'brown',
  'fox',
  'jumper',
  'over',
  'lazy',
  'dog',
  'zeta',
  'unique',
  'nerd',
  'earl',
  'sleep',
  'onyx',
  'mill',
  'blue',
  'below',
  'scape',
  'reap',
  'damo',
  'break',
  'boom',
  'the',
];

function pythonSplitlines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (/(?:\r\n|\r|\n)$/.test(text)) {
    lines.pop();
  }
  return lines;
}

export class CreatureNameTable {
  names: string[];

  constructor(opts: {
    names: string[];
  }) {
    this.names = opts.names;
  }

  static sized(size: number): CreatureNameTable {
    return new CreatureNameTable({ names: Array.from({ length: int(size) }, () => '') });
  }

  clear(idx: number): void {
    if (int(idx) >= 0 && int(idx) < this.names.length) {
      this.names[int(idx)] = '';
    }
  }

  activeEntries(opts: { activeMask: readonly boolean[] }): [number, string][] {
    const activeMask = opts.activeMask;
    const entries: [number, string][] = [];
    for (const [idx, name] of this.names.entries()) {
      if (!name) {
        continue;
      }
      if (!(idx >= 0 && idx < activeMask.length && Boolean(activeMask[idx]))) {
        continue;
      }
      entries.push([int(idx), String(name)]);
    }
    return entries;
  }

  findByName(name: string, opts: { activeMask: readonly boolean[] }): number | null {
    const activeMask = opts.activeMask;
    for (const [idx, existing] of this.names.entries()) {
      if (!(idx >= 0 && idx < activeMask.length && Boolean(activeMask[idx]))) {
        continue;
      }
      if (existing === name) {
        return idx;
      }
    }
    return null;
  }

  isUnique(name: string, opts: { excludeIdx: number; activeMask: readonly boolean[] }): boolean {
    const excludeIdx = opts.excludeIdx;
    const activeMask = opts.activeMask;
    const exclude = int(excludeIdx);
    for (const [idx, existing] of this.names.entries()) {
      if (idx === exclude) {
        continue;
      }
      if (!(idx >= 0 && idx < activeMask.length && Boolean(activeMask[idx]))) {
        continue;
      }
      if (existing === name) {
        return false;
      }
    }
    return true;
  }

  assignRandom(creatureIdx: number, rng: CrandLike, opts: { scoreXp: number; activeMask: readonly boolean[]; dictionaryWords?: readonly string[] | null; highscoreNames?: readonly string[] }): string {
    const scoreXp = opts.scoreXp;
    const activeMask = opts.activeMask;
    const dictionaryWords = opts.dictionaryWords ?? null;
    const highscoreNames = opts.highscoreNames ?? [];
    const idx = int(creatureIdx);
    if (!(idx >= 0 && idx < this.names.length)) {
      throw new RangeError(`creature_idx out of range: ${idx}`);
    }

    let tooLongAttempts = 0;
    let attempts = 0;
    while (true) {
      const name = typoBuildName(rng, { scoreXp: scoreXp, dictionaryWords: dictionaryWords, highscoreNames: highscoreNames });
      if (!this.isUnique(name, { excludeIdx: idx, activeMask: activeMask })) {
        attempts += 1;
        if (attempts < 200) {
          continue;
        }
      }

      if (name.length < NAME_MAX_CHARS) {
        this.names[idx] = name;
        return name;
      }

      tooLongAttempts += 1;
      if (tooLongAttempts > 99) {
        this.names[idx] = name;
        return name;
      }
    }
  }
}

function draw(rng: CrandLike, opts: { caller?: number | null } = {}): number {
  const caller = opts.caller ?? null;
  return rng.rand({ caller: caller });
}

function pickHighscoreName(rng: CrandLike, highscoreNames: readonly string[]): string {
  if (highscoreNames.length === 0) {
    return 'quickbrownfox';
  }
  return String(highscoreNames[draw(rng, { caller: RngCallerStatic.TYPO_WORD_PICK_HIGHSCORE_NAME }) % highscoreNames.length]);
}

export function typoNamePart(rng: CrandLike, opts: { allowThe: boolean }): string {
  const allowThe = opts.allowThe;
  const mod = allowThe ? 52 : 51;
  const idx = draw(rng, { caller: RngCallerStatic.TYPO_WORD_PICK_FRAGMENT }) % mod;
  if (idx === 39) {
    return 'nerd';
  }
  return NAME_PARTS[idx];
}

export function typoBuildName(rng: CrandLike, opts: { scoreXp: number; dictionaryWords?: readonly string[] | null; highscoreNames?: readonly string[] }): string {
  let scoreXp = opts.scoreXp;
  const dictionaryWords = opts.dictionaryWords ?? null;
  const highscoreNames = opts.highscoreNames ?? [];
  scoreXp = int(scoreXp);
  if (dictionaryWords !== null && dictionaryWords.length > 0) {
    return typoBuildCustomName(rng, { scoreXp: scoreXp, dictionaryWords: dictionaryWords });
  }
  if (scoreXp > 120) {
    if (draw(rng, { caller: RngCallerStatic.TYPO_TARGET_NAME_ASSIGN_RANDOM_HIGHSCORE_GATE }) % 100 < 10) {
      return pickHighscoreName(rng, highscoreNames);
    }
    if (draw(rng, { caller: RngCallerStatic.TYPO_TARGET_NAME_ASSIGN_RANDOM_FOUR_WORD_GATE }) % 100 < 80) {
      return [typoNamePart(rng, { allowThe: true }), typoNamePart(rng, { allowThe: false }), typoNamePart(rng, { allowThe: false }), typoNamePart(rng, { allowThe: false })].join("");
    }
  }

  if ((scoreXp > 80 && draw(rng, { caller: RngCallerStatic.TYPO_TARGET_NAME_ASSIGN_RANDOM_THREE_WORD_GATE_GT80 }) % 100 < 80) || (scoreXp > 60 && draw(rng, { caller: RngCallerStatic.TYPO_TARGET_NAME_ASSIGN_RANDOM_THREE_WORD_GATE_GT60 }) % 100 < 40)) {
    return [typoNamePart(rng, { allowThe: true }), typoNamePart(rng, { allowThe: false }), typoNamePart(rng, { allowThe: false })].join("");
  }

  if ((scoreXp > 40 && draw(rng, { caller: RngCallerStatic.TYPO_TARGET_NAME_ASSIGN_RANDOM_TWO_WORD_GATE_GT40 }) % 100 < 80) || (scoreXp > 20 && draw(rng, { caller: RngCallerStatic.TYPO_TARGET_NAME_ASSIGN_RANDOM_TWO_WORD_GATE_GT20 }) % 100 < 40)) {
    return [typoNamePart(rng, { allowThe: true }), typoNamePart(rng, { allowThe: false })].join("");
  }

  return typoNamePart(rng, { allowThe: false });
}

function pickWord(rng: CrandLike, words: readonly string[]): string {
  return String(words[draw(rng) % words.length]);
}

function pickUniqueWords(rng: CrandLike, words: readonly string[], count: number): string[] {
  if (count <= 1) {
    return [pickWord(rng, words)];
  }
  if (words.length <= count) {
    return Array.from({ length: Math.max(0, count) }, (_, i) => i).map((_) => pickWord(rng, words));
  }

  const picked: string[] = [];
  const used: Set<number> = new Set();
  while (picked.length < count) {
    const idx = draw(rng) % words.length;
    if ((used as ReadonlySet<unknown>).has(idx)) {
      continue;
    }
    used.add(idx);
    picked.push(String(words[idx]));
  }
  return picked;
}

function typoBuildCustomName(rng: CrandLike, opts: { scoreXp: number; dictionaryWords: readonly string[] }): string {
  let scoreXp = opts.scoreXp;
  const dictionaryWords = opts.dictionaryWords;
  scoreXp = int(scoreXp);
  if (scoreXp > 120) {
    if (draw(rng) % 100 < 10) {
      return pickWord(rng, dictionaryWords);
    }
    if (draw(rng) % 100 < 80) {
      return pickUniqueWords(rng, dictionaryWords, 4).join("");
    }
  }

  if ((scoreXp > 80 && draw(rng) % 100 < 80) || (scoreXp > 60 && draw(rng) % 100 < 40)) {
    return pickUniqueWords(rng, dictionaryWords, 3).join("");
  }

  if ((scoreXp > 40 && draw(rng) % 100 < 80) || (scoreXp > 20 && draw(rng) % 100 < 40)) {
    return pickUniqueWords(rng, dictionaryWords, 2).join("");
  }

  return pickWord(rng, dictionaryWords);
}

export function loadTypoDictionary(path: string): string[] {
  let raw: ReturnType<typeof readFileSync>;
  try {
    raw = readFileSync(String(path), 'utf8');
  } catch (exc) {
    return [];
  }

  const words: string[] = [];
  const seen: Set<string> = new Set();
  for (const line of pythonSplitlines(raw)) {
    const text = (line.split('#', 1)[0]).trim();
    if (text.length === 0) {
      continue;
    }
    if (Array.from(text).length >= NAME_MAX_CHARS) {
      continue;
    }
    if ((seen as ReadonlySet<unknown>).has(text)) {
      continue;
    }
    words.push(text);
    seen.add(text);
  }
  return words;
}

export function loadTypoHighscoreNames(path: string): string[] {
  let records: ReturnType<typeof readHighscoreTable>;
  try {
    records = readHighscoreTable(path, { gameModeId: GameMode.TYPO });
  } catch (exc) {
    return [];
  }

  const names: string[] = [];
  const seen: Set<string> = new Set();
  for (const record of records) {
    const name = record.name();
    if (!name) {
      continue;
    }
    if ((seen as ReadonlySet<unknown>).has(name)) {
      continue;
    }
    if (!Array.from(name).every((ch) => /^\p{L}+$/u.test(ch) || ch === '.')) {
      continue;
    }
    names.push(name);
    seen.add(name);
  }
  return names;
}
