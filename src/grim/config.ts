// Port of grim/config.py

import { AimScheme } from '@crimson/aim-schemes.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { MovementControlType } from '@crimson/movement-controls.ts';
import { QuestLevel } from '@crimson/quests/level.ts';

export { AimScheme, GameMode, MovementControlType };

export const CRIMSON_CFG_NAME = 'crimson.cfg';
export const CRIMSON_CFG_SIZE = 0x480;
export const PLAYER_NAME_SIZE = 0x20;
export const PLAYER_NAME_MAX_BYTES = PLAYER_NAME_SIZE - 1;
export const SAVED_NAME_SLOT_COUNT = 8;
export const SAVED_NAME_ENTRY_SIZE = 0x1B;
export const SAVED_NAMES_BLOB_SIZE = SAVED_NAME_SLOT_COUNT * SAVED_NAME_ENTRY_SIZE;
export const UNKNOWN_248_SIZE = 0x1F8;
export const PLAYER_BIND_BLOCK_DWORDS = 0x10;
export const PLAYER_BIND_BLOCK_SIZE = PLAYER_BIND_BLOCK_DWORDS * 4;
export const EXT_DIRECTION_ARROW_FLAG_COUNT = 2;
export const EXTENDED_RESERVED_GAP_SIZE = UNKNOWN_248_SIZE - 2 * PLAYER_BIND_BLOCK_SIZE - EXT_DIRECTION_ARROW_FLAG_COUNT;
export const EXT_DIRECTION_ARROW_UNSET = 0;
export const EXT_DIRECTION_ARROW_OFF = 1;
export const EXT_DIRECTION_ARROW_ON = 2;
export const KEYBIND_UNBOUND_CODE = 0x17E;
export const RESERVED_KEYBIND_SLOT_COUNT = 2;
export const PADDING_KEYBIND_SLOT_COUNT = 3;
const _DEFAULT_WIRE_RESERVED_KEYS: [number, number] = [KEYBIND_UNBOUND_CODE, KEYBIND_UNBOUND_CODE];
const _DEFAULT_WIRE_PADDING: [number, number, number] = [KEYBIND_UNBOUND_CODE, KEYBIND_UNBOUND_CODE, KEYBIND_UNBOUND_CODE];
const _DEFAULT_PROFILE_NAME = '10tons';
const _DEFAULT_SAVED_NAMES: [string, string, string, string, string, string, string, string] = [
  'default',
  'default',
  'default',
  'default',
  'default',
  'default',
  'default',
  'default',
];

export enum HighScoreDateMode {
  ALL_TIME = 0,
  MONTH = 1,
  WEEK = 2,
  DAY = 3,
}

export class CrimsonDisplayConfig {
  width: number;
  height: number;
  windowed: boolean;
  bpp: number;
  textureScale: number;
  mouseSensitivity: number;
  detailPreset: number;
  fxDetail: [boolean, boolean, boolean];
  violenceDisabled: number;

  constructor(opts: {
    width: number;
    height: number;
    windowed: boolean;
    bpp: number;
    textureScale: number;
    mouseSensitivity: number;
    detailPreset: number;
    fxDetail: [boolean, boolean, boolean];
    violenceDisabled: number;
  }) {
    this.width = opts.width;
    this.height = opts.height;
    this.windowed = opts.windowed;
    this.bpp = opts.bpp;
    this.textureScale = opts.textureScale;
    this.mouseSensitivity = opts.mouseSensitivity;
    this.detailPreset = opts.detailPreset;
    this.fxDetail = [opts.fxDetail[0], opts.fxDetail[1], opts.fxDetail[2]];
    this.violenceDisabled = opts.violenceDisabled;
  }

  fxDetailEnabled(opts: { level: number; default?: boolean }): boolean;
  fxDetailEnabled(level: number, _default?: boolean): boolean;
  fxDetailEnabled(levelOrOpts: number | { level: number; default?: boolean }, _default: boolean = false): boolean {
    const level = typeof levelOrOpts === 'number' ? levelOrOpts : levelOrOpts.level;
    return Boolean(this.fxDetail[int(level)]);
  }

  setFxDetail(level: number, enabled: boolean): void {
    const values: [boolean, boolean, boolean] = [...this.fxDetail];
    values[int(level)] = Boolean(enabled);
    this.fxDetail = [Boolean(values[0]), Boolean(values[1]), Boolean(values[2])];
  }
}

export class CrimsonAudioConfig {
  soundDisabled: boolean;
  musicDisabled: boolean;
  sfxVolume: number;
  musicVolume: number;

  constructor(opts: { soundDisabled: boolean; musicDisabled: boolean; sfxVolume: number; musicVolume: number }) {
    this.soundDisabled = opts.soundDisabled;
    this.musicDisabled = opts.musicDisabled;
    this.sfxVolume = opts.sfxVolume;
    this.musicVolume = opts.musicVolume;
  }
}

export class CrimsonGameplayConfig {
  mode: GameMode;
  playerCount: number;
  hardcore: boolean;
  questLevel: QuestLevel | null;
  showInfoTexts: boolean;

  constructor(opts: {
    mode: GameMode;
    playerCount: number;
    hardcore: boolean;
    questLevel: QuestLevel | null;
    showInfoTexts: boolean;
  }) {
    this.mode = opts.mode;
    this.playerCount = opts.playerCount;
    this.hardcore = opts.hardcore;
    this.questLevel = opts.questLevel;
    this.showInfoTexts = opts.showInfoTexts;
  }
}

export class CrimsonProfileConfig {
  playerName: string;
  playerNameInputLen: number;
  savedNameCount: number;
  selectedSavedNameSlot: number;
  savedNames: string[];
  showInternetScores: boolean;
  scoreDateMode: HighScoreDateMode;

  constructor(opts: {
    playerName: string;
    playerNameInputLen: number;
    savedNameCount: number;
    selectedSavedNameSlot: number;
    savedNames: string[];
    showInternetScores: boolean;
    scoreDateMode: HighScoreDateMode;
  }) {
    this.playerName = opts.playerName;
    this.playerNameInputLen = opts.playerNameInputLen;
    this.savedNameCount = opts.savedNameCount;
    this.selectedSavedNameSlot = opts.selectedSavedNameSlot;
    this.savedNames = [...opts.savedNames];
    this.showInternetScores = opts.showInternetScores;
    this.scoreDateMode = opts.scoreDateMode;
  }

  setPlayerNameInput(name: string): void {
    const encoded: number[] = [];
    for (const ch of String(name)) {
      const code = ch.charCodeAt(0);
      if (code <= 0xFF) encoded.push(code);
      if (encoded.length >= PLAYER_NAME_MAX_BYTES) break;
    }

    let end = encoded.length;
    while (end > 1 && encoded[end - 1] === 0x20) {
      end -= 1;
    }

    this.playerName = String.fromCharCode(...encoded.slice(0, end));
    this.playerNameInputLen = encoded.length;
  }

  savedNameLabels(): string[] {
    const count = int(this.savedNameCount);
    if (count < 1 || count > SAVED_NAME_SLOT_COUNT) {
      throw new Error(`saved_name_count must be in 1..${SAVED_NAME_SLOT_COUNT}, got ${count}`);
    }
    const labels: string[] = [];
    for (let idx = 0; idx < count; idx++) {
      let label = String(this.savedNames[idx] ?? '').trim();
      if (!label) {
        label = idx === 0 ? 'default' : `slot_${idx}`;
      }
      labels.push(label);
    }
    return labels;
  }
}

export class CrimsonPlayerControls {
  movement: MovementControlType;
  aimScheme: AimScheme;
  showDirectionArrow: boolean;
  moveCodes: [number, number, number, number];
  fireCode: number;
  keyboardAimCodes: [number, number];
  aimAxisCodes: [number, number];
  moveAxisCodes: [number, number];

  constructor(opts: {
    movement: MovementControlType;
    aimScheme: AimScheme;
    showDirectionArrow: boolean;
    moveCodes: [number, number, number, number];
    fireCode: number;
    keyboardAimCodes: [number, number];
    aimAxisCodes: [number, number];
    moveAxisCodes: [number, number];
  }) {
    this.movement = opts.movement;
    this.aimScheme = opts.aimScheme;
    this.showDirectionArrow = opts.showDirectionArrow;
    this.moveCodes = [opts.moveCodes[0], opts.moveCodes[1], opts.moveCodes[2], opts.moveCodes[3]];
    this.fireCode = opts.fireCode;
    this.keyboardAimCodes = [opts.keyboardAimCodes[0], opts.keyboardAimCodes[1]];
    this.aimAxisCodes = [opts.aimAxisCodes[0], opts.aimAxisCodes[1]];
    this.moveAxisCodes = [opts.moveAxisCodes[0], opts.moveAxisCodes[1]];
  }
}

export class CrimsonControlsConfig {
  players: [CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls];
  pickPerkCode: number;
  reloadCode: number;

  constructor(opts: {
    players: [CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls];
    pickPerkCode: number;
    reloadCode: number;
  }) {
    this.players = [opts.players[0], opts.players[1], opts.players[2], opts.players[3]];
    this.pickPerkCode = opts.pickPerkCode;
    this.reloadCode = opts.reloadCode;
  }

  player(playerIndex: number): CrimsonPlayerControls {
    return this.players[_playerIndex(playerIndex)];
  }
}

export class CrimsonConfig {
  path: string;
  display: CrimsonDisplayConfig;
  audio: CrimsonAudioConfig;
  gameplay: CrimsonGameplayConfig;
  profile: CrimsonProfileConfig;
  controls: CrimsonControlsConfig;

  constructor(opts: {
    path?: string;
    display: CrimsonDisplayConfig;
    audio: CrimsonAudioConfig;
    gameplay: CrimsonGameplayConfig;
    profile: CrimsonProfileConfig;
    controls: CrimsonControlsConfig;
  }) {
    this.path = opts.path ?? '<memory>';
    this.display = opts.display;
    this.audio = opts.audio;
    this.gameplay = opts.gameplay;
    this.profile = opts.profile;
    this.controls = opts.controls;
  }

  save(): void {
    // WebGL has no file-backed crimson.cfg path; keep the Python method as a no-op.
  }
}

const _DEFAULT_PLAYER_CONTROL_TEMPLATES: CrimsonPlayerControls[] = [
  new CrimsonPlayerControls({
    movement: MovementControlType.STATIC,
    aimScheme: AimScheme.MOUSE,
    showDirectionArrow: true,
    moveCodes: [0x11, 0x1F, 0x1E, 0x20],
    fireCode: 0x100,
    keyboardAimCodes: [0x10, 0x12],
    aimAxisCodes: [0x13F, 0x140],
    moveAxisCodes: [0x141, 0x153],
  }),
  new CrimsonPlayerControls({
    movement: MovementControlType.STATIC,
    aimScheme: AimScheme.MOUSE,
    showDirectionArrow: true,
    moveCodes: [0xC8, 0xD0, 0xCB, 0xCD],
    fireCode: 0x9D,
    keyboardAimCodes: [0xD3, 0xD1],
    aimAxisCodes: [0x13F, 0x140],
    moveAxisCodes: [0x141, 0x153],
  }),
  new CrimsonPlayerControls({
    movement: MovementControlType.STATIC,
    aimScheme: AimScheme.MOUSE,
    showDirectionArrow: true,
    moveCodes: [0x17, 0x25, 0x24, 0x26],
    fireCode: 0x36,
    keyboardAimCodes: [0x16, 0x18],
    aimAxisCodes: [0x17E, 0x17E],
    moveAxisCodes: [0x17E, 0x17E],
  }),
  new CrimsonPlayerControls({
    movement: MovementControlType.STATIC,
    aimScheme: AimScheme.MOUSE,
    showDirectionArrow: true,
    moveCodes: [0x131, 0x132, 0x133, 0x134],
    fireCode: 0x11F,
    keyboardAimCodes: [0x17E, 0x17E],
    aimAxisCodes: [0x140, 0x13F],
    moveAxisCodes: [0x153, 0x154],
  }),
];

function defaultPlayerControls(index: number): CrimsonPlayerControls {
  const defaults = _DEFAULT_PLAYER_CONTROL_TEMPLATES[_playerIndex(index)];
  return new CrimsonPlayerControls({
    movement: defaults.movement,
    aimScheme: defaults.aimScheme,
    showDirectionArrow: defaults.showDirectionArrow,
    moveCodes: defaults.moveCodes,
    fireCode: defaults.fireCode,
    keyboardAimCodes: defaults.keyboardAimCodes,
    aimAxisCodes: defaults.aimAxisCodes,
    moveAxisCodes: defaults.moveAxisCodes,
  });
}

function _playerIndex(playerIndex: number): number {
  const idx = int(playerIndex);
  if (idx < 0 || idx >= 4) {
    throw new Error(`player index must be in 0..3, got ${idx}`);
  }
  return idx;
}

function _requireRange(value: number, opts: { minimum: number; maximum: number; field: string }): number {
  if (value < opts.minimum || value > opts.maximum) {
    throw new Error(`${opts.field} must be in ${opts.minimum}..${opts.maximum}, got ${value}`);
  }
  return value;
}

type RawPlayerBindBlock = {
  moveForward: number;
  moveBackward: number;
  turnLeft: number;
  turnRight: number;
  fire: number;
  reservedKeys: [number, number];
  aimLeft: number;
  aimRight: number;
  axisAimY: number;
  axisAimX: number;
  axisMoveY: number;
  axisMoveX: number;
  padding: [number, number, number];
};

function _bindBlockOffset(playerIndex: number): number {
  const idx = _playerIndex(playerIndex);
  return (idx < 2 ? 0x1C8 : 0x248) + (idx % 2) * PLAYER_BIND_BLOCK_SIZE;
}

function _readI32(view: DataView, offset: number): number {
  return view.getInt32(offset, true);
}

function _writeI32(view: DataView, offset: number, value: number): void {
  view.setInt32(offset, int(value), true);
}

function _readPlayerBindBlock(view: DataView, playerIndex: number): RawPlayerBindBlock {
  const offset = _bindBlockOffset(playerIndex);
  return {
    moveForward: _readI32(view, offset + 0x00),
    moveBackward: _readI32(view, offset + 0x04),
    turnLeft: _readI32(view, offset + 0x08),
    turnRight: _readI32(view, offset + 0x0C),
    fire: _readI32(view, offset + 0x10),
    reservedKeys: [_readI32(view, offset + 0x14), _readI32(view, offset + 0x18)],
    aimLeft: _readI32(view, offset + 0x1C),
    aimRight: _readI32(view, offset + 0x20),
    axisAimY: _readI32(view, offset + 0x24),
    axisAimX: _readI32(view, offset + 0x28),
    axisMoveY: _readI32(view, offset + 0x2C),
    axisMoveX: _readI32(view, offset + 0x30),
    padding: [_readI32(view, offset + 0x34), _readI32(view, offset + 0x38), _readI32(view, offset + 0x3C)],
  };
}

function _parsedPlayerBindBlock(view: DataView, opts: { playerIndex: number }): RawPlayerBindBlock {
  return _readPlayerBindBlock(view, opts.playerIndex);
}

function _encodePlayerBindBlock(player: CrimsonPlayerControls): RawPlayerBindBlock {
  return {
    moveForward: player.moveCodes[0],
    moveBackward: player.moveCodes[1],
    turnLeft: player.moveCodes[2],
    turnRight: player.moveCodes[3],
    fire: player.fireCode,
    reservedKeys: [int(_DEFAULT_WIRE_RESERVED_KEYS[0]), int(_DEFAULT_WIRE_RESERVED_KEYS[1])],
    aimLeft: player.keyboardAimCodes[0],
    aimRight: player.keyboardAimCodes[1],
    axisAimY: player.aimAxisCodes[0],
    axisAimX: player.aimAxisCodes[1],
    axisMoveY: player.moveAxisCodes[0],
    axisMoveX: player.moveAxisCodes[1],
    padding: [int(_DEFAULT_WIRE_PADDING[0]), int(_DEFAULT_WIRE_PADDING[1]), int(_DEFAULT_WIRE_PADDING[2])],
  };
}

function _encodePrimaryKeybinds(
  players: readonly CrimsonPlayerControls[],
): [RawPlayerBindBlock, RawPlayerBindBlock] {
  return [_encodePlayerBindBlock(players[0]), _encodePlayerBindBlock(players[1])];
}

function _encodeExtendedKeybinds(
  players: readonly CrimsonPlayerControls[],
): [RawPlayerBindBlock, RawPlayerBindBlock] {
  return [_encodePlayerBindBlock(players[2]), _encodePlayerBindBlock(players[3])];
}

function _writeEncodedPlayerBindBlock(view: DataView, playerIndex: number, encoded: RawPlayerBindBlock): void {
  const offset = _bindBlockOffset(playerIndex);
  _writeI32(view, offset + 0x00, encoded.moveForward);
  _writeI32(view, offset + 0x04, encoded.moveBackward);
  _writeI32(view, offset + 0x08, encoded.turnLeft);
  _writeI32(view, offset + 0x0C, encoded.turnRight);
  _writeI32(view, offset + 0x10, encoded.fire);
  _writeI32(view, offset + 0x14, encoded.reservedKeys[0]);
  _writeI32(view, offset + 0x18, encoded.reservedKeys[1]);
  _writeI32(view, offset + 0x1C, encoded.aimLeft);
  _writeI32(view, offset + 0x20, encoded.aimRight);
  _writeI32(view, offset + 0x24, encoded.axisAimY);
  _writeI32(view, offset + 0x28, encoded.axisAimX);
  _writeI32(view, offset + 0x2C, encoded.axisMoveY);
  _writeI32(view, offset + 0x30, encoded.axisMoveX);
  _writeI32(view, offset + 0x34, encoded.padding[0]);
  _writeI32(view, offset + 0x38, encoded.padding[1]);
  _writeI32(view, offset + 0x3C, encoded.padding[2]);
}

function _writePlayerBindBlock(view: DataView, playerIndex: number, player: CrimsonPlayerControls): void {
  _writeEncodedPlayerBindBlock(view, playerIndex, _encodePlayerBindBlock(player));
}

function _parsedPlayerBindBlockIsUninitialized(rawBlock: RawPlayerBindBlock): boolean {
  return !(
    rawBlock.moveForward ||
    rawBlock.moveBackward ||
    rawBlock.turnLeft ||
    rawBlock.turnRight ||
    rawBlock.fire ||
    rawBlock.reservedKeys[0] ||
    rawBlock.reservedKeys[1] ||
    rawBlock.aimLeft ||
    rawBlock.aimRight ||
    rawBlock.axisAimY ||
    rawBlock.axisAimX ||
    rawBlock.axisMoveY ||
    rawBlock.axisMoveX
  );
}

function _playerControlsFromParsedBindBlock(
  rawBlock: RawPlayerBindBlock,
  opts: { playerIndex: number; movement: MovementControlType; aimScheme: AimScheme; showDirectionArrow: boolean },
): CrimsonPlayerControls {
  if (_parsedPlayerBindBlockIsUninitialized(rawBlock)) {
    const defaults = defaultPlayerControls(opts.playerIndex);
    return new CrimsonPlayerControls({
      movement: opts.movement,
      aimScheme: opts.aimScheme,
      showDirectionArrow: opts.showDirectionArrow,
      moveCodes: defaults.moveCodes,
      fireCode: defaults.fireCode,
      keyboardAimCodes: defaults.keyboardAimCodes,
      aimAxisCodes: defaults.aimAxisCodes,
      moveAxisCodes: defaults.moveAxisCodes,
    });
  }
  return new CrimsonPlayerControls({
    movement: opts.movement,
    aimScheme: opts.aimScheme,
    showDirectionArrow: opts.showDirectionArrow,
    moveCodes: [rawBlock.moveForward, rawBlock.moveBackward, rawBlock.turnLeft, rawBlock.turnRight],
    fireCode: rawBlock.fire,
    keyboardAimCodes: [rawBlock.aimLeft, rawBlock.aimRight],
    aimAxisCodes: [rawBlock.axisAimY, rawBlock.axisAimX],
    moveAxisCodes: [rawBlock.axisMoveY, rawBlock.axisMoveX],
  });
}

function _decodeDirectionArrow(view: DataView, playerIndex: number): boolean {
  const idx = _playerIndex(playerIndex);
  if (idx < 2) {
    return Boolean(view.getUint8(0x04 + idx));
  }
  const value = int(view.getUint8(0x2C8 + idx - 2));
  if (value === EXT_DIRECTION_ARROW_OFF) {
    return false;
  }
  if (value === EXT_DIRECTION_ARROW_UNSET || value === EXT_DIRECTION_ARROW_ON) {
    return true;
  }
  throw new Error(`unsupported extended direction arrow flag value: ${value}`);
}

function _encodeDirectionArrowFlags(
  players: readonly CrimsonPlayerControls[],
): [[number, number], [number, number]] {
  const primary: [number, number] = [1, 1];
  for (let idx = 0; idx < 2; idx++) {
    primary[idx] = players[idx].showDirectionArrow ? 1 : 0;
  }
  const extended: [number, number] = [
    players[2].showDirectionArrow ? EXT_DIRECTION_ARROW_ON : EXT_DIRECTION_ARROW_OFF,
    players[3].showDirectionArrow ? EXT_DIRECTION_ARROW_ON : EXT_DIRECTION_ARROW_OFF,
  ];
  return [primary, extended];
}

function _decodeMovement(value: number): MovementControlType {
  const raw = int(value);
  if (raw === 0) {
    return MovementControlType.STATIC;
  }
  return raw as MovementControlType;
}

function _decodeAimScheme(value: number): AimScheme {
  return int(value) as AimScheme;
}

function _decodeGameMode(value: number): GameMode {
  return int(value) as GameMode;
}

function _decodeHighScoreDateMode(value: number): HighScoreDateMode {
  return int(value) as HighScoreDateMode;
}

function _decodePlayerName(raw: Uint8Array): string {
  const zero = raw.indexOf(0);
  const end = zero >= 0 ? zero : raw.length;
  return String.fromCharCode(...raw.slice(0, end));
}

function _encodePlayerNameBuffer(name: string): Uint8Array {
  const out = new Uint8Array(PLAYER_NAME_SIZE);
  const encoded: number[] = [];
  for (const ch of String(name)) {
    const code = ch.charCodeAt(0);
    if (code <= 0xFF) encoded.push(code);
    if (encoded.length >= PLAYER_NAME_MAX_BYTES) break;
  }
  out.set(encoded);
  out[Math.min(encoded.length, PLAYER_NAME_MAX_BYTES)] = 0;
  return out;
}

function _decodeSavedNames(raw: Uint8Array): [string, string, string, string, string, string, string, string] {
  const names: string[] = [];
  for (let idx = 0; idx < SAVED_NAME_SLOT_COUNT; idx++) {
    const start = idx * SAVED_NAME_ENTRY_SIZE;
    names.push(_decodePlayerName(raw.slice(start, start + SAVED_NAME_ENTRY_SIZE)));
  }
  return names as [string, string, string, string, string, string, string, string];
}

function _encodeSavedNamesBlob(names: readonly string[]): Uint8Array {
  const out = new Uint8Array(SAVED_NAMES_BLOB_SIZE);
  for (let idx = 0; idx < SAVED_NAME_SLOT_COUNT; idx++) {
    const name = String(idx < names.length ? names[idx] : '');
    const encoded: number[] = [];
    for (const ch of name) {
      const code = ch.charCodeAt(0);
      if (code <= 0xFF) encoded.push(code);
      if (encoded.length >= SAVED_NAME_ENTRY_SIZE - 1) break;
    }
    const start = idx * SAVED_NAME_ENTRY_SIZE;
    out.set(encoded, start);
    out[start + Math.min(encoded.length, SAVED_NAME_ENTRY_SIZE - 1)] = 0;
  }
  return out;
}

function _savedNameOrderValues(): number[] {
  return Array.from({ length: SAVED_NAME_SLOT_COUNT }, (_, idx) => idx);
}

export function defaultCrimsonConfig(path: string = '<memory>'): CrimsonConfig {
  const profile = new CrimsonProfileConfig({
    playerName: '',
    playerNameInputLen: 0,
    savedNameCount: 1,
    selectedSavedNameSlot: 0,
    savedNames: Array.from(_DEFAULT_SAVED_NAMES),
    showInternetScores: false,
    scoreDateMode: HighScoreDateMode.ALL_TIME,
  });
  profile.setPlayerNameInput(_DEFAULT_PROFILE_NAME);
  profile.playerNameInputLen = 0;

  return new CrimsonConfig({
    path,
    display: new CrimsonDisplayConfig({
      width: 1024,
      height: 768,
      windowed: true,
      bpp: 32,
      textureScale: 1.0,
      mouseSensitivity: 0.5,
      detailPreset: 5,
      fxDetail: [true, true, true],
      violenceDisabled: 0,
    }),
    audio: new CrimsonAudioConfig({
      soundDisabled: false,
      musicDisabled: false,
      sfxVolume: 1.0,
      musicVolume: 1.0,
    }),
    gameplay: new CrimsonGameplayConfig({
      mode: GameMode.SURVIVAL,
      playerCount: 1,
      hardcore: false,
      questLevel: null,
      showInfoTexts: true,
    }),
    profile,
    controls: new CrimsonControlsConfig({
      players: [
        defaultPlayerControls(0),
        defaultPlayerControls(1),
        defaultPlayerControls(2),
        defaultPlayerControls(3),
      ],
      pickPerkCode: 0x101,
      reloadCode: 0x102,
    }),
  });
}

export const defaultCrimsonCfg = defaultCrimsonConfig;

export function decodeCrimsonCfg(path: string, blob: Uint8Array): CrimsonConfig {
  if (blob.length !== CRIMSON_CFG_SIZE) {
    throw new Error(`${path} has unexpected size ${blob.length} (expected ${CRIMSON_CFG_SIZE})`);
  }
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let detailPreset = int(_readI32(view, 0x470));
  let fxDetail: [boolean, boolean, boolean] = [
    Boolean(view.getUint8(0x0E)),
    Boolean(view.getUint8(0x10)),
    Boolean(view.getUint8(0x11)),
  ];
  if (detailPreset === 0 && !fxDetail.some(Boolean)) {
    detailPreset = 5;
    fxDetail = [true, true, true];
  } else {
    detailPreset = _requireRange(detailPreset, { minimum: 1, maximum: 5, field: 'detail_preset' });
  }

  const players = [0, 1, 2, 3].map((idx) => _playerControlsFromParsedBindBlock(
    _parsedPlayerBindBlock(view, { playerIndex: idx }),
    {
      playerIndex: idx,
      movement: _decodeMovement(_readI32(view, 0x1C + idx * 4)),
      aimScheme: _decodeAimScheme(_readI32(view, 0x44 + idx * 4)),
      showDirectionArrow: _decodeDirectionArrow(view, idx),
    },
  )) as [CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls];

  return new CrimsonConfig({
    path,
    display: new CrimsonDisplayConfig({
      width: _readI32(view, 0x1BC),
      height: _readI32(view, 0x1C0),
      windowed: Boolean(view.getUint8(0x1C4)),
      bpp: _readI32(view, 0x1B8),
      textureScale: view.getFloat32(0x70, true),
      mouseSensitivity: view.getFloat32(0x474, true),
      detailPreset,
      fxDetail,
      violenceDisabled: int(view.getUint8(0x46C)),
    }),
    audio: new CrimsonAudioConfig({
      soundDisabled: Boolean(view.getUint8(0x00)),
      musicDisabled: Boolean(view.getUint8(0x01)),
      sfxVolume: view.getFloat32(0x464, true),
      musicVolume: view.getFloat32(0x468, true),
    }),
    gameplay: new CrimsonGameplayConfig({
      mode: _decodeGameMode(_readI32(view, 0x18)),
      playerCount: _requireRange(_readI32(view, 0x14), { minimum: 1, maximum: 4, field: 'player_count' }),
      hardcore: Boolean(view.getUint8(0x448)),
      questLevel: null,
      showInfoTexts: Boolean(view.getUint8(0x449)),
    }),
    profile: new CrimsonProfileConfig({
      playerName: _decodePlayerName(blob.slice(0x180, 0x1A0)),
      playerNameInputLen: _requireRange(_readI32(view, 0x1A0), {
        minimum: 0,
        maximum: PLAYER_NAME_MAX_BYTES,
        field: 'player_name_len',
      }),
      savedNameCount: _requireRange(_readI32(view, 0x84), {
        minimum: 1,
        maximum: SAVED_NAME_SLOT_COUNT,
        field: 'saved_name_count',
      }),
      selectedSavedNameSlot: _requireRange(_readI32(view, 0x80), {
        minimum: 0,
        maximum: SAVED_NAME_SLOT_COUNT - 1,
        field: 'selected_saved_name_slot',
      }),
      savedNames: _decodeSavedNames(blob.slice(0xA8, 0x180)),
      showInternetScores: Boolean(view.getUint8(0x46D)),
      scoreDateMode: _decodeHighScoreDateMode(view.getUint8(0x02)),
    }),
    controls: new CrimsonControlsConfig({
      players,
      pickPerkCode: _readI32(view, 0x478),
      reloadCode: _readI32(view, 0x47C),
    }),
  });
}

function _canonicalWireData(): Uint8Array {
  return new Uint8Array(CRIMSON_CFG_SIZE);
}

export function encodeCrimsonCfg(config: CrimsonConfig): Uint8Array {
  const data = _canonicalWireData();
  const view = new DataView(data.buffer);
  const [primaryDirectionArrows, extendedDirectionArrows] = _encodeDirectionArrowFlags(config.controls.players);
  view.setUint8(0x00, config.audio.soundDisabled ? 1 : 0);
  view.setUint8(0x01, config.audio.musicDisabled ? 1 : 0);
  view.setUint8(0x02, int(config.profile.scoreDateMode));
  view.setUint8(0x04, primaryDirectionArrows[0]);
  view.setUint8(0x05, primaryDirectionArrows[1]);
  view.setUint8(0x0E, config.display.fxDetailEnabled(0) ? 1 : 0);
  view.setUint8(0x10, config.display.fxDetailEnabled(1) ? 1 : 0);
  view.setUint8(0x11, config.display.fxDetailEnabled(2) ? 1 : 0);
  _writeI32(view, 0x14, _requireRange(int(config.gameplay.playerCount), { minimum: 1, maximum: 4, field: 'player_count' }));
  _writeI32(view, 0x18, config.gameplay.mode);
  for (let idx = 0; idx < 4; idx++) {
    _writeI32(view, 0x1C + idx * 4, config.controls.players[idx].movement);
    _writeI32(view, 0x44 + idx * 4, config.controls.players[idx].aimScheme);
  }
  view.setFloat32(0x70, config.display.textureScale, true);
  _writeI32(view, 0x80, _requireRange(int(config.profile.selectedSavedNameSlot), {
    minimum: 0,
    maximum: SAVED_NAME_SLOT_COUNT - 1,
    field: 'selected_saved_name_slot',
  }));
  _writeI32(view, 0x84, _requireRange(int(config.profile.savedNameCount), {
    minimum: 1,
    maximum: SAVED_NAME_SLOT_COUNT,
    field: 'saved_name_count',
  }));
  const savedNameOrder = _savedNameOrderValues();
  for (let idx = 0; idx < SAVED_NAME_SLOT_COUNT; idx++) {
    _writeI32(view, 0x88 + idx * 4, savedNameOrder[idx]);
  }
  data.set(_encodeSavedNamesBlob(config.profile.savedNames), 0xA8);
  data.set(_encodePlayerNameBuffer(config.profile.playerName), 0x180);
  _writeI32(view, 0x1A0, _requireRange(int(config.profile.playerNameInputLen), {
    minimum: 0,
    maximum: PLAYER_NAME_MAX_BYTES,
    field: 'player_name_len',
  }));
  _writeI32(view, 0x1A4, 100);
  _writeI32(view, 0x1B0, 9000);
  _writeI32(view, 0x1B4, 27000);
  _writeI32(view, 0x1B8, config.display.bpp);
  _writeI32(view, 0x1BC, config.display.width);
  _writeI32(view, 0x1C0, config.display.height);
  view.setUint8(0x1C4, config.display.windowed ? 1 : 0);
  const primaryKeybinds = _encodePrimaryKeybinds(config.controls.players);
  const extendedKeybinds = _encodeExtendedKeybinds(config.controls.players);
  for (let idx = 0; idx < 2; idx++) {
    _writeEncodedPlayerBindBlock(view, idx, primaryKeybinds[idx]);
  }
  for (let idx = 2; idx < 4; idx++) {
    _writeEncodedPlayerBindBlock(view, idx, extendedKeybinds[idx - 2]);
  }
  view.setUint8(0x2C8, extendedDirectionArrows[0]);
  view.setUint8(0x2C9, extendedDirectionArrows[1]);
  view.setUint8(0x448, config.gameplay.hardcore ? 1 : 0);
  view.setUint8(0x449, config.gameplay.showInfoTexts ? 1 : 0);
  _writeI32(view, 0x450, 1);
  view.setUint8(0x460, 1);
  view.setFloat32(0x464, config.audio.sfxVolume, true);
  view.setFloat32(0x468, config.audio.musicVolume, true);
  view.setUint8(0x46C, int(config.display.violenceDisabled));
  view.setUint8(0x46D, config.profile.showInternetScores ? 1 : 0);
  _writeI32(view, 0x470, _requireRange(int(config.display.detailPreset), {
    minimum: 1,
    maximum: 5,
    field: 'detail_preset',
  }));
  view.setFloat32(0x474, config.display.mouseSensitivity, true);
  _writeI32(view, 0x478, config.controls.pickPerkCode);
  _writeI32(view, 0x47C, config.controls.reloadCode);
  return data;
}

export function loadCrimsonCfg(_path: string): CrimsonConfig {
  throw new Error('crimson.cfg file loading is unavailable in the WebGL build');
}

export function ensureCrimsonCfg(baseDir: string): CrimsonConfig {
  // WebGL has no file-backed crimson.cfg path; use the default config.
  return defaultCrimsonConfig(`${baseDir}/${CRIMSON_CFG_NAME}`);
}

export function setPlayerNameInput(profile: CrimsonProfileConfig, name: string): void {
  profile.setPlayerNameInput(name);
}

export function savedNameLabels(profile: CrimsonProfileConfig): string[] {
  return profile.savedNameLabels();
}

export function setFxDetail(config: CrimsonDisplayConfig, level: number, enabled: boolean): void {
  config.setFxDetail(level, enabled);
}

export function fxDetailEnabled(config: CrimsonDisplayConfig, level: number): boolean {
  return config.fxDetailEnabled(level);
}

export function applyDetailPreset(config: CrimsonConfig, preset?: number): number {
  const selected = _requireRange(int(preset ?? config.display.detailPreset), {
    minimum: 1,
    maximum: 5,
    field: 'detail_preset',
  });
  config.display.detailPreset = selected;
  if (selected <= 1) {
    config.display.fxDetail = [false, false, false];
  } else if (selected === 2) {
    config.display.fxDetail = [false, false, true];
  } else {
    config.display.fxDetail = [true, true, true];
  }
  return selected;
}
