// Port of crimson/persistence/save_status.py

import { GameMode } from '@crimson/game-modes.ts';
import { WEAPON_USAGE_SLOT_COUNT, ZERO_WEAPON_USAGE_COUNTS, type WeaponUsageCounts, weaponUsageSlotForWeaponId } from '@crimson/weapon-usage.ts';

export const GAME_CFG_NAME = 'game.cfg';

export const BLOB_SIZE = 0x268;
export const FILE_SIZE = BLOB_SIZE + 4;

export const WEAPON_USAGE_COUNT = WEAPON_USAGE_SLOT_COUNT;

// Quest play count length inferred from known trailing fields in the blob (0xD8..0x244).
export const QUEST_PLAY_COUNT = 91;

export const UNKNOWN_TAIL_SIZE = 0x10;

export type QuestPlayCounts = readonly number[];

const ZERO_QUEST_PLAY_COUNTS: QuestPlayCounts = Array.from({ length: QUEST_PLAY_COUNT }, () => 0);
const ZERO_UNKNOWN_TAIL = new Uint8Array(UNKNOWN_TAIL_SIZE);
const STATUS_FIELD_NAMES = new Set([
  'questUnlockIndex',
  'questUnlockIndexFull',
  'weaponUsageCounts',
  'questPlayCounts',
  'modePlaySurvival',
  'modePlayRush',
  'modePlayTypo',
  'modePlayOther',
  'gameSequenceId',
  'unknownTail',
]);

function statusValueEquals<T, U>(left: T, right: U): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) {
        return false;
      }
    }
    return true;
  }
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    if (left.length !== right.length) {
      return false;
    }
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export const GAME_STATUS_STRUCT = [
  ['questUnlockIndex', 'Int16ul'],
  ['questUnlockIndexFull', 'Int16ul'],
  ['weaponUsageCounts', `Array(${WEAPON_USAGE_COUNT}, Int32ul)`],
  ['questPlayCounts', `Array(${QUEST_PLAY_COUNT}, Int32ul)`],
  ['modePlaySurvival', 'Int32ul'],
  ['modePlayRush', 'Int32ul'],
  ['modePlayTypo', 'Int32ul'],
  ['modePlayOther', 'Int32ul'],
  ['gameSequenceId', 'Int32ul'],
  ['unknownTail', `Bytes(${UNKNOWN_TAIL_SIZE})`],
] as const;

export const GAME_CFG_STRUCT = [
  ['encoded', `Bytes(${BLOB_SIZE})`],
  ['checksum', 'Int32ul'],
] as const;

export class GameStatusData {
  questUnlockIndex: number;
  questUnlockIndexFull: number;
  weaponUsageCounts: WeaponUsageCounts;
  questPlayCounts: QuestPlayCounts;
  modePlaySurvival: number;
  modePlayRush: number;
  modePlayTypo: number;
  modePlayOther: number;
  gameSequenceId: number;
  unknownTail: Uint8Array;

  constructor(opts: {
    questUnlockIndex?: number;
    questUnlockIndexFull?: number;
    weaponUsageCounts?: WeaponUsageCounts;
    questPlayCounts?: QuestPlayCounts;
    modePlaySurvival?: number;
    modePlayRush?: number;
    modePlayTypo?: number;
    modePlayOther?: number;
    gameSequenceId?: number;
    unknownTail?: Uint8Array;
  } = {}) {
    this.questUnlockIndex = opts.questUnlockIndex ?? 0;
    this.questUnlockIndexFull = opts.questUnlockIndexFull ?? 0;
    this.weaponUsageCounts = opts.weaponUsageCounts ?? ZERO_WEAPON_USAGE_COUNTS.slice();
    this.questPlayCounts = opts.questPlayCounts ?? ZERO_QUEST_PLAY_COUNTS.slice();
    this.modePlaySurvival = opts.modePlaySurvival ?? 0;
    this.modePlayRush = opts.modePlayRush ?? 0;
    this.modePlayTypo = opts.modePlayTypo ?? 0;
    this.modePlayOther = opts.modePlayOther ?? 0;
    this.gameSequenceId = opts.gameSequenceId ?? 0;
    this.unknownTail = opts.unknownTail ?? new Uint8Array(ZERO_UNKNOWN_TAIL);
  }
}

class Missing {
}

const MISSING = new Missing();

export class GameStatus extends GameStatusData {
  path: string;
  dirty: boolean;

  constructor(opts: {
    path: string;
    dirty?: boolean;
    questUnlockIndex?: number;
    questUnlockIndexFull?: number;
    weaponUsageCounts?: WeaponUsageCounts;
    questPlayCounts?: QuestPlayCounts;
    modePlaySurvival?: number;
    modePlayRush?: number;
    modePlayTypo?: number;
    modePlayOther?: number;
    gameSequenceId?: number;
    unknownTail?: Uint8Array;
  }) {
    super(opts);
    this.path = opts.path;
    this.dirty = opts.dirty ?? false;
    return new Proxy(this, {
      set(target, prop, value, receiver) {
        const name = String(prop);
        const markDirty = STATUS_FIELD_NAMES.has(name);
        const current = markDirty ? Reflect.get(target, prop, receiver) : MISSING;
        const ok = Reflect.set(target, prop, value, receiver);
        if (ok && markDirty && current !== MISSING && !statusValueEquals(current, value)) {
          Reflect.set(target, 'dirty', true, receiver);
        }
        return ok;
      },
    });
  }

  static fromData(opts: { path: string; data: GameStatusData; dirty?: boolean }): GameStatus {
    return new GameStatus({
      path: opts.path,
      dirty: opts.dirty ?? false,
      questUnlockIndex: opts.data.questUnlockIndex,
      questUnlockIndexFull: opts.data.questUnlockIndexFull,
      weaponUsageCounts: opts.data.weaponUsageCounts.slice(),
      questPlayCounts: opts.data.questPlayCounts.slice(),
      modePlaySurvival: opts.data.modePlaySurvival,
      modePlayRush: opts.data.modePlayRush,
      modePlayTypo: opts.data.modePlayTypo,
      modePlayOther: opts.data.modePlayOther,
      gameSequenceId: opts.data.gameSequenceId,
      unknownTail: new Uint8Array(opts.data.unknownTail),
    });
  }

  asData(): GameStatusData {
    return new GameStatusData({
      questUnlockIndex: this.questUnlockIndex,
      questUnlockIndexFull: this.questUnlockIndexFull,
      weaponUsageCounts: this.weaponUsageCounts.slice(),
      questPlayCounts: this.questPlayCounts.slice(),
      modePlaySurvival: this.modePlaySurvival,
      modePlayRush: this.modePlayRush,
      modePlayTypo: this.modePlayTypo,
      modePlayOther: this.modePlayOther,
      gameSequenceId: this.gameSequenceId,
      unknownTail: new Uint8Array(this.unknownTail),
    });
  }

  modePlayCountForMode(gameMode: GameMode): number {
    return this[modeCountFieldForMode(gameMode)];
  }

  incrementModePlayCountForMode(gameMode: GameMode, delta: number = 1): number {
    const field = modeCountFieldForMode(gameMode);
    const value = this[field] + int(delta);
    this[field] = value;
    return value;
  }

  weaponUsageCountSlot(slot: number): number {
    const slotIdx = requireIndex(slot, { size: WEAPON_USAGE_COUNT, field: 'weapon_usage_slot' });
    return int(this.weaponUsageCounts[slotIdx]);
  }

  incrementWeaponUsageSlot(slot: number, delta: number = 1): number {
    const slotIdx = requireIndex(slot, { size: WEAPON_USAGE_COUNT, field: 'weapon_usage_slot' });
    const counts = Array.from(this.weaponUsageCounts);
    counts[slotIdx] = counts[slotIdx] + int(delta);
    this.weaponUsageCounts = counts;
    return counts[slotIdx];
  }

  weaponUsageCountForWeaponId(weaponId: number): number {
    const slot = weaponUsageSlotForWeaponId(weaponId);
    if (slot === null) return 0;
    return this.weaponUsageCountSlot(slot);
  }

  incrementWeaponUsageForWeaponId(weaponId: number, delta: number = 1): number | null {
    const slot = weaponUsageSlotForWeaponId(weaponId);
    if (slot === null) return null;
    return this.incrementWeaponUsageSlot(slot, delta);
  }

  questPlayCount(index: number): number {
    const questIdx = requireIndex(index, { size: QUEST_PLAY_COUNT, field: 'quest_play_count' });
    return int(this.questPlayCounts[questIdx]);
  }

  incrementQuestPlayCount(index: number, delta: number = 1): number {
    const questIdx = requireIndex(index, { size: QUEST_PLAY_COUNT, field: 'quest_play_count' });
    const counts = Array.from(this.questPlayCounts);
    counts[questIdx] = counts[questIdx] + int(delta);
    this.questPlayCounts = counts;
    return counts[questIdx];
  }

  save(): void {
    // Browser/WebGL builds cannot create path.parent directories before saving.
    saveStatus(this.path, this);
    this.dirty = false;
  }

  saveIfDirty(): void {
    if (this.dirty) {
      this.save();
    }
  }
}

type ModeCountField = 'modePlaySurvival' | 'modePlayRush' | 'modePlayTypo' | 'modePlayOther';

function modeCountFieldForMode(gameMode: GameMode): ModeCountField {
  const mode = int(gameMode) as GameMode;
  switch (mode) {
    case GameMode.SURVIVAL:
      return 'modePlaySurvival';
    case GameMode.RUSH:
      return 'modePlayRush';
    case GameMode.TYPO:
      return 'modePlayTypo';
    default:
      return 'modePlayOther';
  }
}

function requireIndex(index: number, opts: { size: number; field: string }): number {
  const idx = int(index);
  if (0 <= idx && idx < int(opts.size)) {
    return idx;
  }
  throw new RangeError(`${opts.field} out of range: ${idx}`);
}

function statusBlobDict(data: GameStatusData): Record<string, number | number[] | Uint8Array> {
  return {
    questUnlockIndex: data.questUnlockIndex,
    questUnlockIndexFull: data.questUnlockIndexFull,
    weaponUsageCounts: Array.from(data.weaponUsageCounts),
    questPlayCounts: Array.from(data.questPlayCounts),
    modePlaySurvival: data.modePlaySurvival,
    modePlayRush: data.modePlayRush,
    modePlayTypo: data.modePlayTypo,
    modePlayOther: data.modePlayOther,
    gameSequenceId: data.gameSequenceId,
    unknownTail: new Uint8Array(data.unknownTail),
  };
}

export function defaultStatusData(): GameStatusData {
  return new GameStatusData();
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, int(value) & 0xFFFF, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, int(value) >>> 0, true);
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function parseStatusBlob(decoded: Uint8Array): GameStatusData {
  if (decoded.length !== BLOB_SIZE) {
    throw new Error(`expected decoded blob of 0x${BLOB_SIZE.toString(16)} bytes, got 0x${decoded.length.toString(16)}`);
  }
  const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  let offset = 0;
  const questUnlockIndex = readU16(view, offset); offset += 2;
  const questUnlockIndexFull = readU16(view, offset); offset += 2;
  const weaponUsageCounts: number[] = [];
  for (let i = 0; i < WEAPON_USAGE_COUNT; i++) {
    weaponUsageCounts.push(readU32(view, offset)); offset += 4;
  }
  const questPlayCounts: number[] = [];
  for (let i = 0; i < QUEST_PLAY_COUNT; i++) {
    questPlayCounts.push(readU32(view, offset)); offset += 4;
  }
  const modePlaySurvival = readU32(view, offset); offset += 4;
  const modePlayRush = readU32(view, offset); offset += 4;
  const modePlayTypo = readU32(view, offset); offset += 4;
  const modePlayOther = readU32(view, offset); offset += 4;
  const gameSequenceId = readU32(view, offset); offset += 4;
  const unknownTail = decoded.slice(offset, offset + UNKNOWN_TAIL_SIZE);
  return new GameStatusData({
    questUnlockIndex,
    questUnlockIndexFull,
    weaponUsageCounts,
    questPlayCounts,
    modePlaySurvival,
    modePlayRush,
    modePlayTypo,
    modePlayOther,
    gameSequenceId,
    unknownTail,
  });
}

export function buildStatusBlob(data: GameStatusData): Uint8Array {
  void statusBlobDict(data);
  const decoded = new Uint8Array(BLOB_SIZE);
  const view = new DataView(decoded.buffer);
  let offset = 0;
  writeU16(view, offset, data.questUnlockIndex); offset += 2;
  writeU16(view, offset, data.questUnlockIndexFull); offset += 2;
  for (let i = 0; i < WEAPON_USAGE_COUNT; i++) {
    writeU32(view, offset, data.weaponUsageCounts[i] ?? 0); offset += 4;
  }
  for (let i = 0; i < QUEST_PLAY_COUNT; i++) {
    writeU32(view, offset, data.questPlayCounts[i] ?? 0); offset += 4;
  }
  writeU32(view, offset, data.modePlaySurvival); offset += 4;
  writeU32(view, offset, data.modePlayRush); offset += 4;
  writeU32(view, offset, data.modePlayTypo); offset += 4;
  writeU32(view, offset, data.modePlayOther); offset += 4;
  writeU32(view, offset, data.gameSequenceId); offset += 4;
  decoded.set(data.unknownTail.slice(0, UNKNOWN_TAIL_SIZE), offset);
  return decoded;
}

export function toS8(value: number): number {
  value &= 0xFF;
  return (value & 0x80) ? value - 0x100 : value;
}

export function indexPoly(idx: number): number {
  const i = toS8(idx);
  return ((i * 7 + 0x0F) * i + 0x03) * i;
}

export function decodeBlob(encoded: Uint8Array): Uint8Array {
  if (encoded.length !== BLOB_SIZE) {
    throw new Error(`decoded blob must be 0x${BLOB_SIZE.toString(16)} bytes, got 0x${encoded.length.toString(16)}`);
  }
  const decoded = new Uint8Array(encoded);
  for (let i = 0; i < BLOB_SIZE; i++) {
    decoded[i] = (decoded[i] - 0x6F - indexPoly(i)) & 0xFF;
  }
  return decoded;
}

export function encodeBlob(decoded: Uint8Array): Uint8Array {
  if (decoded.length !== BLOB_SIZE) {
    throw new Error(`decoded blob must be 0x${BLOB_SIZE.toString(16)} bytes, got 0x${decoded.length.toString(16)}`);
  }
  const encoded = new Uint8Array(decoded);
  for (let i = 0; i < BLOB_SIZE; i++) {
    encoded[i] = (encoded[i] + 0x6F + indexPoly(i)) & 0xFF;
  }
  return encoded;
}

export function computeChecksum(decoded: Uint8Array): number {
  let acc = 0;
  let u = 0;
  for (let i = 0; i < decoded.length; i++) {
    const c = toS8(decoded[i]);
    const iVar5 = (c * 7 + i) * c + u;
    acc = (acc + 0x0D + iVar5) >>> 0;
    u += 0x6F;
  }
  return acc >>> 0;
}

function storageKey(path: string): string {
  // Browser/WebGL builds store game.cfg wire data in localStorage instead of Path files.
  return `crimson-game-status:${path}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(byte);
  }
  return btoa(text);
}

function base64ToBytes(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes;
}

export function loadStatus(path: string): GameStatus {
  const rawText = localStorage.getItem(storageKey(path));
  if (rawText === null) {
    throw new Error(`Cannot open file '${path}'`);
  }
  const raw = base64ToBytes(rawText);
  if (raw.length !== FILE_SIZE) {
    throw new Error(`expected 0x${FILE_SIZE.toString(16)} bytes, got 0x${raw.length.toString(16)}`);
  }
  const encoded = raw.slice(0, BLOB_SIZE);
  const storedChecksum = readU32(new DataView(raw.buffer, raw.byteOffset, raw.byteLength), BLOB_SIZE);
  const decoded = decodeBlob(encoded);
  const computed = computeChecksum(decoded);
  if (storedChecksum !== computed) {
    throw new Error('checksum mismatch');
  }
  return GameStatus.fromData({ path, data: parseStatusBlob(decoded), dirty: false });
}

export function saveStatus(path: string, status: GameStatusData | GameStatus): void {
  const data = status instanceof GameStatus ? status.asData() : status;
  const decoded = buildStatusBlob(data);
  const checksum = computeChecksum(decoded);
  const encoded = encodeBlob(decoded);
  const raw = new Uint8Array(FILE_SIZE);
  raw.set(encoded, 0);
  writeU32(new DataView(raw.buffer), BLOB_SIZE, checksum);
  localStorage.setItem(storageKey(path), bytesToBase64(raw));
}

export function ensureGameStatus(baseDir: string): GameStatus {
  const path = `${baseDir.replace(/\/+$/g, '')}/${GAME_CFG_NAME}`;
  if (localStorage.getItem(storageKey(path)) !== null) {
    return loadStatus(path);
  }
  const status = GameStatus.fromData({ path, data: defaultStatusData(), dirty: false });
  status.save();
  return status;
}

export function hashStatusData(status: GameStatusData): string {
  const blob = buildStatusBlob(status);
  return sha256Hex(blob);
}

function sha256Hex(data: Uint8Array): string {
  const k = [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
    0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
    0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
    0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
    0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
    0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
    0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
    0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
  ];
  let h0 = 0x6A09E667;
  let h1 = 0xBB67AE85;
  let h2 = 0x3C6EF372;
  let h3 = 0xA54FF53A;
  let h4 = 0x510E527F;
  let h5 = 0x9B05688C;
  let h6 = 0x1F83D9AB;
  let h7 = 0x5BE0CD19;
  const bitLen = data.length * 8;
  const paddedLen = Math.floor((data.length + 9 + 63) / 64) * 64;
  const msg = new Uint8Array(paddedLen);
  msg.set(data);
  msg[data.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
