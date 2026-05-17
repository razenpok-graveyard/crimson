// Port of crimson/persistence/highscores.py

import { QuestLevel } from '@crimson/quests/level.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { WeaponId } from '@crimson/weapons.ts';
import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync, mkdirSync } from 'node:fs';

export const RECORD_SIZE = 0x48;
export const RECORD_WIRE_SIZE = RECORD_SIZE + 4; // record + checksum
export const TABLE_MAX = 100;
export const NAME_SIZE = 0x20;
export const NAME_MAX_EDIT = 0x14; // game_over_screen_update sets ui_text_input maxlen=0x14

function latin1DecodeUntilNull(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) {
    end = bytes.byteLength;
  }
  let text = '';
  for (let index = 0; index < end; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function latin1EncodeIgnore(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0xff) {
      bytes.push(code);
    }
  }
  return bytes;
}

interface PythonStructFormat {
  readonly size: number;
  unpackFrom(data: Uint8Array | ArrayBuffer | ArrayBufferView, offset?: number): number[];
  pack(value: number): Uint8Array;
  packInto(data: Uint8Array | ArrayBuffer | ArrayBufferView, offset: number, value: number): void;
}

function bytesFrom(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function pythonStructFormat(format: string): PythonStructFormat {
  if (format === '<I') {
    return {
      size: 4,
      unpackFrom(data, offset = 0) {
        const bytes = bytesFrom(data);
        return [new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)];
      },
      pack(value) {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, int(value) >>> 0, true);
        return bytes;
      },
      packInto(data, offset, value) {
        const bytes = bytesFrom(data);
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, int(value) >>> 0, true);
      },
    };
  }
  throw new Error(`unsupported struct format: ${format}`);
}

function _pathJoin(...parts: Array<string | number>): string {
  const cleaned = parts.map((part, idx) => {
    const text = String(part);
    if (idx === 0) {
      const stripped = text.replace(/\/+$/g, '');
      if (stripped === '.') {
        return '';
      }
      return text === '/' ? '/' : stripped;
    }
    return text.replace(/^\/+|\/+$/g, '');
  }).filter((part) => part.length > 0);
  if (cleaned.length === 0) {
    return '';
  }
  if (cleaned[0] === '/') {
    return `/${cleaned.slice(1).join('/')}`;
  }
  return cleaned.join('/');
}

function _basename(path: string): string {
  const normalized = path.replace(/\/+$/g, '');
  const idx = normalized.lastIndexOf('/');
  return idx < 0 ? normalized : normalized.slice(idx + 1);
}

function _pathExtname(path: string): string {
  const base = _basename(path);
  if (base === '' || base === '.' || base === '..') {
    return '';
  }
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

function _pathStem(path: string): string {
  const base = _basename(path);
  const ext = _pathExtname(base);
  return ext === '' ? base : base.slice(0, -ext.length);
}

function _dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) {
    return '.';
  }
  if (idx === 0) {
    return '/';
  }
  return path.slice(0, idx);
}

function _mkdirParents(path: string): void {
  mkdirSync(path, { recursive: true });
}

function _openTextFile(path: string, opts: { mode: string; encoding?: 'utf-8' }): { read(size: number): Uint8Array; write(data: string | Uint8Array): void; close(): void } {
  const binary = opts.mode.includes('b');
  let readOffset = 0;
  const readBuffer = opts.mode.includes('r') ? new Uint8Array(readFileSync(path)) : new Uint8Array();
  let wrote = false;
  return {
    read(size: number): Uint8Array {
      const chunk = readBuffer.slice(readOffset, readOffset + size);
      readOffset += chunk.byteLength;
      return chunk;
    },
    write(data: string | Uint8Array): void {
      const payload = binary || typeof data !== 'string' ? data : String(data);
      if (opts.mode.includes('a')) {
        appendFileSync(path, payload);
      } else if (wrote) {
        appendFileSync(path, payload);
      } else {
        writeFileSync(path, payload);
        wrote = true;
      }
    },
    close(): void {},
  };
}

function pythonCompareKeys(left: any, right: any): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const item = pythonCompareKeys(left[index], right[index]);
      if (item !== 0) {
        return item;
      }
    }
    return left.length - right.length;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export class HighScoreRecord {
  data: Uint8Array;

  constructor(opts: {
    data: Uint8Array;
  }) {
    this.data = opts.data;
  }

  static blank(): HighScoreRecord {
    const data = new Uint8Array(RECORD_SIZE);
    data[0x46] = 0x7C;
    data[0x47] = 0xFF;
    return new HighScoreRecord({ data: data });
  }

  static fromBytes(data: Uint8Array): HighScoreRecord {
    if (data.length !== RECORD_SIZE) {
      throw new Error(`expected ${RECORD_SIZE} bytes, got ${data.length}`);
    }
    return new HighScoreRecord({ data: new Uint8Array(data) });
  }

  copy(): HighScoreRecord {
    return new HighScoreRecord({ data: new Uint8Array(this.data) });
  }

  name(): string {
    const raw = bytesFrom(this.data.slice(0, NAME_SIZE));
    return latin1DecodeUntilNull(raw);
  }

  setName(value: string): void {
    const encoded = latin1EncodeIgnore(value).slice(0, NAME_SIZE - 1);
    this.data.fill(0, 0, NAME_SIZE);
    this.data.set(encoded, 0);
    this.data[Math.min(encoded.length, NAME_SIZE - 1)] = 0;
  }

  trimTrailingSpaces(): void {
    // highscore_save_record: strips trailing spaces (0x20) in-place before saving.
    const raw = this.data.slice(0, NAME_SIZE);
    let end = raw.indexOf(0);
    if (end < 0) {
      end = NAME_SIZE;
    }
    let i = end - 1;
    while (i > 0 && raw[i] === 0x20) {
      raw[i] = 0;
      i -= 1;
    }
  }

  get survivalElapsedMs(): number {
    return int(pythonStructFormat('<I').unpackFrom(this.data, 0x20)[0]);
  }

  set survivalElapsedMs(value: number) {
    pythonStructFormat('<I').packInto(this.data, 0x20, (int(value) >>> 0));
  }

  get scoreXp(): number {
    return int(pythonStructFormat('<I').unpackFrom(this.data, 0x24)[0]);
  }

  set scoreXp(value: number) {
    pythonStructFormat('<I').packInto(this.data, 0x24, (int(value) >>> 0));
  }

  get gameModeId(): GameMode {
    return knownGameMode(int(this.data[0x28]));
  }

  set gameModeId(value: GameMode) {
    this.data[0x28] = int(value) & 0xFF;
  }

  get questStageMajor(): number {
    return int(this.data[0x29]);
  }

  set questStageMajor(value: number) {
    this.data[0x29] = int(value) & 0xFF;
  }

  get questStageMinor(): number {
    return int(this.data[0x2A]);
  }

  set questStageMinor(value: number) {
    this.data[0x2A] = int(value) & 0xFF;
  }

  get questLevel(): QuestLevel | null {
    const major = int(this.questStageMajor);
    const minor = int(this.questStageMinor);
    if (major <= 0 || minor <= 0) {
      return null;
    }
    return new QuestLevel({ major: major, minor: minor });
  }

  set questLevel(value: QuestLevel | null) {
    if (value === null) {
      this.questStageMajor = 0;
      this.questStageMinor = 0;
      return;
    }
    this.questStageMajor = int(value.major);
    this.questStageMinor = int(value.minor);
  }

  get mostUsedWeaponId(): WeaponId {
    return int(this.data[0x2B]) as unknown as WeaponId;
  }

  set mostUsedWeaponId(value: WeaponId) {
    this.data[0x2B] = int(value) & 0xFF;
  }

  get shotsFired(): number {
    return int(pythonStructFormat('<I').unpackFrom(this.data, 0x2C)[0]);
  }

  set shotsFired(value: number) {
    pythonStructFormat('<I').packInto(this.data, 0x2C, (int(value) >>> 0));
  }

  get shotsHit(): number {
    return int(pythonStructFormat('<I').unpackFrom(this.data, 0x30)[0]);
  }

  set shotsHit(value: number) {
    pythonStructFormat('<I').packInto(this.data, 0x30, (int(value) >>> 0));
  }

  get creatureKillCount(): number {
    return int(pythonStructFormat('<I').unpackFrom(this.data, 0x34)[0]);
  }

  set creatureKillCount(value: number) {
    pythonStructFormat('<I').packInto(this.data, 0x34, (int(value) >>> 0));
  }

  get reserved0(): number {
    return int(pythonStructFormat('<I').unpackFrom(this.data, 0x38)[0]);
  }

  set reserved0(value: number) {
    pythonStructFormat('<I').packInto(this.data, 0x38, (int(value) >>> 0));
  }

  get day(): number {
    return int(this.data[0x40]);
  }

  get month(): number {
    return int(this.data[0x42]);
  }

  get yearOffset(): number {
    return int(this.data[0x43]);
  }

  get flags(): number {
    return int(this.data[0x44]);
  }

  set flags(value: number) {
    this.data[0x44] = int(value) & 0xFF;
  }

  get fullVersionMarker(): number {
    return int(this.data[0x45]);
  }

  set fullVersionMarker(value: number) {
    this.data[0x45] = int(value) & 0xFF;
  }

  ensureDateFields(now: Date | null = null): void {
    if (int(this.data[0x40]) !== 0) {
      return;
    }
    if (now === null) {
      now = new Date();
    }
    this.data[0x40] = int(now.getDate()) & 0xFF;
    this.data[0x42] = int(now.getMonth() + 1) & 0xFF;
    this.data[0x43] = int(now.getFullYear() - 2000) & 0xFF;
    this.data[0x41] = int(highscoreDateChecksum(now.getFullYear(), now.getMonth() + 1, now.getDate())) & 0xFF;
  }
}

function knownGameMode(value: number): GameMode {
  const raw = int(value);
  if (Object.values(GameMode).includes(raw as GameMode)) {
    return raw as GameMode;
  }
  return GameMode.DEMO;
}

function clampU32(value: number): number {
  return (int(value) >>> 0);
}

function scoreChecksum(data: Uint8Array): number {
  if (data.length !== RECORD_SIZE) {
    throw new Error(`expected ${RECORD_SIZE} bytes, got ${data.length}`);
  }
  let checksum = 0;
  for (const [idx, b] of data.entries()) {
    checksum = clampU32(checksum + (idx + 3) * int(b) * 7);
  }
  return checksum;
}

function encodeByte(value: number, idx: number): number {
  // highscore_write_record: b += ((idx * 5 + 1) * idx + 6)
  return int(value) + (idx * 5 + 1) * idx + 6 & 0xFF;
}

function decodeByte(value: number, idx: number): number {
  // highscore_read_record: b += (-6 - ((idx * 5 + 1) * idx))
  return int(value) - ((idx * 5 + 1) * idx + 6) & 0xFF;
}

export function highscoreDateChecksum(year: number, month: number, day: number): number {
  // Port of `highscore_date_checksum` (0x0043a950).
  let iVar1 = Math.floor((0x0E - int(month)) / 0x0C);
  let iVar2 = (int(year) - iVar1) + 0x12C0;
  iVar1 = ((Math.floor((iVar2 + (Math.floor(iVar2 / (2 ** 31)) & 3)) / (2 ** 2))) - 0x7D2D + int(day) + (Math.floor((Math.floor(iVar2 / 400) + (Math.floor(((int(month) + iVar1 * 0x0C) * 0x99 - 0x1C9) / 5 + iVar2) * 0x16D)) - iVar2 / 100)));
  iVar2 = (((((((iVar1 - iVar1 % 7) + 0x7BFD) + 0x23AB1) % 0x23AB1) + 0x8EAC) % 0x8EAC) + 0x5B5) % 0x5B5;
  iVar1 = Math.floor(iVar2 / 0x5B4);
  return Math.floor((((iVar2 - iVar1) + 0x16D) % 0x16D + iVar1) / 7 + 1);
}

export function scoresDirForBaseDir(baseDir: string): string {
  // Original uses CreateDirectoryA("scores5") relative to cwd.
  return _pathJoin(baseDir, 'scores5');
}

function withPlayerCountSuffix(path: string, opts: { playerCount: number }): string {
  const playerCount = opts.playerCount;
  let count = int(playerCount);
  if (count <= 1) {
    return path;
  }
  // Native only supports 1P/2P. Our port supports up to 4 players; keep separate leaderboards.
  count = Math.max(2, Math.min(4, count));
  if (_pathExtname(String(path)).toLowerCase() !== '.hi') {
    return path;
  }
  return _pathJoin(_dirname(String(path)), `${_pathStem(String(path))}_${count}${_pathExtname(String(path))}`);
}

function scoresPathForModeRoot(opts: { root: string; gameModeId: GameMode; hardcore: boolean; questStageMajor: number; questStageMinor: number }): string {
  const root = opts.root;
  const gameModeId = opts.gameModeId;
  const hardcore = opts.hardcore;
  const questStageMajor = opts.questStageMajor;
  const questStageMinor = opts.questStageMinor;
  const mode = knownGameMode(int(gameModeId));
  switch (mode) {
    case GameMode.SURVIVAL:
      return _pathJoin(root, 'survival.hi');
    case GameMode.RUSH:
      return _pathJoin(root, 'rush.hi');
    case GameMode.TYPO:
      return _pathJoin(root, 'typo.hi');
    case GameMode.QUESTS:
      // Native `highscore_build_path` uses `questhc*.hi` when hardcore is OFF,
      // and `quest*.hi` when hardcore is ON.
      const prefix = hardcore ? 'quest' : 'questhc';
      const major = int(questStageMajor);
      const minor = int(questStageMinor);
      return _pathJoin(root, `${prefix}${major}_${minor}.hi`);
    default:
      return _pathJoin(root, 'unknown.hi');
  }
}

export function scoresPathForMode(baseDir: string, gameModeId: GameMode, opts: { hardcore?: boolean; questStageMajor?: number; questStageMinor?: number; playerCount?: number } = {}): string {
  const hardcore = opts.hardcore ?? false;
  const questStageMajor = opts.questStageMajor ?? 0;
  const questStageMinor = opts.questStageMinor ?? 0;
  const playerCount = opts.playerCount ?? 1;
  const root = scoresDirForBaseDir(baseDir);
  const path = scoresPathForModeRoot({ root: root, gameModeId: gameModeId, hardcore: hardcore, questStageMajor: int(questStageMajor), questStageMinor: int(questStageMinor) });
  return withPlayerCountSuffix(path, { playerCount: int(playerCount) });
}

export function scoresPathForConfig(baseDir: string, config: CrimsonConfig, opts: { questStageMajor?: number; questStageMinor?: number } = {}): string {
  let questStageMajor = opts.questStageMajor ?? 0;
  let questStageMinor = opts.questStageMinor ?? 0;
  const mode = knownGameMode(config.gameplay.mode);
  const root = scoresDirForBaseDir(baseDir);
  let path: string;
  switch (mode) {
    case GameMode.QUESTS:
      const hardcore = config.gameplay.hardcore;
      if (int(questStageMajor) === 0 && int(questStageMinor) === 0) {
        const level = config.gameplay.questLevel;
        if (level !== null) {
          questStageMajor = int(level.major);
          questStageMinor = int(level.minor);
        }
      }
      path = scoresPathForModeRoot({ root: root, gameModeId: mode, hardcore: hardcore, questStageMajor: int(questStageMajor), questStageMinor: int(questStageMinor) });
      break;
    default:
      path = scoresPathForModeRoot({ root: root, gameModeId: mode, hardcore: config.gameplay.hardcore, questStageMajor: int(questStageMajor), questStageMinor: int(questStageMinor) });
      break;
  }
  return withPlayerCountSuffix(path, { playerCount: config.gameplay.playerCount });
}

export function decodeRecordPayload(encoded: Uint8Array): Uint8Array {
  if (encoded.length !== RECORD_SIZE) {
    throw new Error(`expected ${RECORD_SIZE} bytes, got ${encoded.length}`);
  }
  const out = new Uint8Array(encoded);
  for (let idx = 0; idx < RECORD_SIZE; idx++) {
    out[idx] = decodeByte(out[idx], idx);
  }
  return bytesFrom(out);
}

export function encodeRecordPayload(decoded: Uint8Array): Uint8Array {
  if (decoded.length !== RECORD_SIZE) {
    throw new Error(`expected ${RECORD_SIZE} bytes, got ${decoded.length}`);
  }
  const out = new Uint8Array(decoded);
  for (let idx = 0; idx < RECORD_SIZE; idx++) {
    out[idx] = encodeByte(out[idx], idx);
  }
  return bytesFrom(out);
}

export function readHighscoreRecords(path: string): HighScoreRecord[] {
  if (!((existsSync(String(path)) && statSync(String(path)).isFile()))) {
    return [];
  }
  const records: HighScoreRecord[] = [];
  const fp = _openTextFile(String(path), { mode: 'rb', encoding: 'utf-8' });
  let blob: ReturnType<typeof fp.read>;
  let payload: ReturnType<typeof blob.slice>;
  let storedChecksum: ReturnType<typeof int>;
  let decoded: ReturnType<typeof decodeRecordPayload>;
  let computed: ReturnType<typeof scoreChecksum>;
  try {
    while (true) {
      blob = fp.read(RECORD_WIRE_SIZE);
      if (blob.length === 0) {
        break;
      }
      if (blob.length !== RECORD_WIRE_SIZE) {
        break;
      }
      payload = blob.slice(0, RECORD_SIZE);
      storedChecksum = int(pythonStructFormat('<I').unpackFrom(blob, RECORD_SIZE)[0]);
      decoded = decodeRecordPayload(payload);
      computed = scoreChecksum(decoded);
      if (computed !== storedChecksum) {
        continue;
      }
      records.push(HighScoreRecord.fromBytes(decoded));
    }
  } finally {
    fp.close();
  }
  return records;
}

export function writeHighscoreRecords(path: string, records: HighScoreRecord[]): void {
  _mkdirParents(_dirname(String(path)));
  const fp = _openTextFile(String(path), { mode: 'wb', encoding: 'utf-8' });
  let encoded: ReturnType<typeof encodeRecordPayload>;
  let checksum: ReturnType<typeof scoreChecksum>;
  try {
    for (let record of records) {
      record = record.copy();
      record.trimTrailingSpaces();
      record.ensureDateFields();
      encoded = encodeRecordPayload(bytesFrom(record.data));
      checksum = scoreChecksum(bytesFrom(record.data));
      fp.write(encoded);
      fp.write(pythonStructFormat('<I').pack(checksum));
    }
  } finally {
    fp.close();
  }
}

export function readHighscoreTable(path: string, opts: { gameModeId: GameMode }): HighScoreRecord[] {
  const gameModeId = opts.gameModeId;
  let records = readHighscoreRecords(path);
  records = records.filter((r) => int(r.gameModeId) === int(gameModeId));
  return sortHighscores(records, { gameModeId: gameModeId }).slice(0, TABLE_MAX);
}

export function sortHighscores(records: HighScoreRecord[], opts: { gameModeId: GameMode }): HighScoreRecord[] {
  const gameModeId = opts.gameModeId;
  const mode = knownGameMode(int(gameModeId));
  switch (mode) {
    case GameMode.RUSH:
      return Array.from(records).sort((left, right) => -1 * pythonCompareKeys(int(left.survivalElapsedMs), int(right.survivalElapsedMs)));
    case GameMode.QUESTS:
      const _questKey = (r: HighScoreRecord): [number, number] => {
        const value = int(r.survivalElapsedMs);
        if (value === 0) {
          return [1, 0];
        }
        return [0, value];
      };

      return Array.from(records).sort((left, right) => pythonCompareKeys(_questKey(left), _questKey(right)));
    default:
      return Array.from(records).sort((left, right) => -1 * pythonCompareKeys(int(left.scoreXp), int(right.scoreXp)));
  }
}

export function rankIndex(recordsSorted: HighScoreRecord[], record: HighScoreRecord): number {
  const mode = knownGameMode(int(record.gameModeId));
  let score: number;
  switch (mode) {
    case GameMode.RUSH:
      score = int(record.survivalElapsedMs);
      for (const [idx, entry] of recordsSorted.entries()) {
        if (score > int(entry.survivalElapsedMs)) {
          return idx;
        }
      }
      return recordsSorted.length;
    case GameMode.QUESTS:
      score = int(record.survivalElapsedMs);
      for (const [idx, entry] of recordsSorted.entries()) {
        const other = int(entry.survivalElapsedMs);
        if (other === 0) {
          return idx;
        }
        if (score < other) {
          return idx;
        }
      }
      return recordsSorted.length;
    default:
      score = int(record.scoreXp);
      for (const [idx, entry] of recordsSorted.entries()) {
        if (score > int(entry.scoreXp)) {
          return idx;
        }
      }
      return recordsSorted.length;
  }
}

export function upsertHighscoreRecord(path: string, record: HighScoreRecord): [HighScoreRecord[], number] {
  // Save `record` into the mode table, returning (sorted_records, rank_index).
  const recordsSorted = readHighscoreTable(path, { gameModeId: record.gameModeId });
  const idx = rankIndex(recordsSorted, record);
  if (idx >= TABLE_MAX) {
    return [recordsSorted, idx];
  }
  let updated = Array.from(recordsSorted);
  updated.splice(idx, 0, record.copy());
  updated = updated.slice(0, TABLE_MAX);
  writeHighscoreRecords(path, updated);
  return [updated, idx];
}
