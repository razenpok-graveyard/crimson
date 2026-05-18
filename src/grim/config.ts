// Port of grim/config.py

import { AimScheme } from '@crimson/aim-schemes.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { MovementControlType } from '@crimson/movement-controls.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

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
    this.fxDetail = opts.fxDetail;
    this.violenceDisabled = opts.violenceDisabled;
  }

  fxDetailEnabled(opts: { level: number; default?: boolean }): boolean;
  fxDetailEnabled(level: number, _default?: boolean): boolean;
  fxDetailEnabled(levelOrOpts: number | { level: number; default?: boolean }, _defaultArg: boolean | undefined = undefined): boolean {
    const level: number = typeof levelOrOpts === 'object' && levelOrOpts !== null ? levelOrOpts.level : levelOrOpts as number;
    const _default: boolean = typeof levelOrOpts === 'object' && levelOrOpts !== null ? levelOrOpts.default ?? false : _defaultArg ?? false;
    const _ = _default;
    return Boolean(this.fxDetail[int(level)]);
  }

  setFxDetail(opts: { level: number; enabled: boolean }): void;
  setFxDetail(level: number, enabled: boolean): void;
  setFxDetail(levelOrOpts: number | { level: number; enabled: boolean }, enabledArg: boolean | undefined = undefined): void {
    const level: number = typeof levelOrOpts === 'object' && levelOrOpts !== null ? levelOrOpts.level : levelOrOpts as number;
    const enabled: boolean = typeof levelOrOpts === 'object' && levelOrOpts !== null ? levelOrOpts.enabled : enabledArg as boolean;
    const idx = int(level);
    const values = Array.from(this.fxDetail);
    values[idx] = enabled;
    this.fxDetail = [Boolean(values[0]), Boolean(values[1]), Boolean(values[2])];
  }
}

export class CrimsonAudioConfig {
  soundDisabled: boolean;
  musicDisabled: boolean;
  sfxVolume: number;
  musicVolume: number;

  constructor(opts: {
    soundDisabled: boolean;
    musicDisabled: boolean;
    sfxVolume: number;
    musicVolume: number;
  }) {
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
  savedNames: [string, string, string, string, string, string, string, string];
  showInternetScores: boolean;
  scoreDateMode: HighScoreDateMode;

  constructor(opts: {
    playerName: string;
    playerNameInputLen: number;
    savedNameCount: number;
    selectedSavedNameSlot: number;
    savedNames: [string, string, string, string, string, string, string, string];
    showInternetScores: boolean;
    scoreDateMode: HighScoreDateMode;
  }) {
    this.playerName = opts.playerName;
    this.playerNameInputLen = opts.playerNameInputLen;
    this.savedNameCount = opts.savedNameCount;
    this.selectedSavedNameSlot = opts.selectedSavedNameSlot;
    this.savedNames = opts.savedNames;
    this.showInternetScores = opts.showInternetScores;
    this.scoreDateMode = opts.scoreDateMode;
  }

  setPlayerNameInput(opts: { name: string }): void;
  setPlayerNameInput(name: string): void;
  setPlayerNameInput(nameOrOpts: string | { name: string }): void {
    const name: string = typeof nameOrOpts === 'object' && nameOrOpts !== null ? nameOrOpts.name : nameOrOpts as string;
    const encoded = latin1EncodeIgnore(name).slice(0, PLAYER_NAME_MAX_BYTES);
    const buf = new Uint8Array(PLAYER_NAME_SIZE);
    buf.set(encoded, 0);
    buf[Math.min(encoded.length, PLAYER_NAME_MAX_BYTES)] = 0;

    const end = buf.indexOf(0);
    let i = end - 1;
    while (i > 0 && buf[i] === 0x20) {
      buf[i] = 0;
      i -= 1;
    }

    this.playerName = latin1DecodeUntilNull(bytesFrom(buf));
    this.playerNameInputLen = encoded.length;
  }

  savedNameLabels(): readonly string[] {
    const count = int(this.savedNameCount);
    if (count < 1 || count > SAVED_NAME_SLOT_COUNT) {
      throw new Error(`saved_name_count must be in 1..${SAVED_NAME_SLOT_COUNT}, got ${count}`);
    }
    const labels: string[] = [];
    for (let idx = 0; idx < count; idx++) {
      let label = (String(this.savedNames[idx])).trim();
      if (!label) {
        label = idx === 0 ? 'default' : `slot_${idx}`;
      }
      labels.push(label);
    }
    return Array.from(labels);
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
    this.moveCodes = opts.moveCodes;
    this.fireCode = opts.fireCode;
    this.keyboardAimCodes = opts.keyboardAimCodes;
    this.aimAxisCodes = opts.aimAxisCodes;
    this.moveAxisCodes = opts.moveAxisCodes;
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
    this.players = opts.players;
    this.pickPerkCode = opts.pickPerkCode;
    this.reloadCode = opts.reloadCode;
  }

  player(opts: { playerIndex: number }): CrimsonPlayerControls;
  player(playerIndex: number): CrimsonPlayerControls;
  player(playerIndexOrOpts: number | { playerIndex: number }): CrimsonPlayerControls {
    const playerIndex: number = typeof playerIndexOrOpts === 'object' && playerIndexOrOpts !== null ? playerIndexOrOpts.playerIndex : playerIndexOrOpts as number;
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
    path: string;
    display: CrimsonDisplayConfig;
    audio: CrimsonAudioConfig;
    gameplay: CrimsonGameplayConfig;
    profile: CrimsonProfileConfig;
    controls: CrimsonControlsConfig;
  }) {
    this.path = opts.path;
    this.display = opts.display;
    this.audio = opts.audio;
    this.gameplay = opts.gameplay;
    this.profile = opts.profile;
    this.controls = opts.controls;
  }

  save(): void {
    writeFileSync(String(this.path), encodeCrimsonCfg(this));
  }
}

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
const _DEFAULT_WIRE_RESERVED_KEYS = [KEYBIND_UNBOUND_CODE, KEYBIND_UNBOUND_CODE] as const;
const _DEFAULT_WIRE_PADDING = [KEYBIND_UNBOUND_CODE, KEYBIND_UNBOUND_CODE, KEYBIND_UNBOUND_CODE] as const;
export const PLAYER_BIND_BLOCK_STRUCT = constructStruct([
  constructField('move_forward', constructInt32sl()),
  constructField('move_backward', constructInt32sl()),
  constructField('turn_left', constructInt32sl()),
  constructField('turn_right', constructInt32sl()),
  constructField('fire', constructInt32sl()),
  constructField('reserved_keys', constructArray(RESERVED_KEYBIND_SLOT_COUNT, constructInt32sl())),
  constructField('aim_left', constructInt32sl()),
  constructField('aim_right', constructInt32sl()),
  constructField('axis_aim_y', constructInt32sl()),
  constructField('axis_aim_x', constructInt32sl()),
  constructField('axis_move_y', constructInt32sl()),
  constructField('axis_move_x', constructInt32sl()),
  constructField('padding', constructArray(PADDING_KEYBIND_SLOT_COUNT, constructInt32sl())),
]);
export const CRIMSON_CFG_STRUCT = constructStruct([
  constructField('sound_disable', constructByte()),
  constructField('music_disable', constructByte()),
  constructField('highscore_date_mode', constructByte()),
  constructField('highscore_duplicate_mode', constructByte()),
  constructField('direction_arrow_flags', constructArray(2, constructByte())),
  constructField('unknown_06', constructBytes(2)),
  constructField('unknown_08', constructInt32sl()),
  constructField('unknown_0c', constructBytes(2)),
  constructField('fx_detail_0', constructByte()),
  constructField('unknown_0f', constructByte()),
  constructField('fx_detail_1', constructByte()),
  constructField('fx_detail_2', constructByte()),
  constructField('unknown_12', constructBytes(2)),
  constructField('player_count', constructInt32sl()),
  constructField('game_mode', constructInt32sl()),
  constructField('player_mode_flags', constructArray(4, constructInt32sl())),
  constructField('player_mode_flags_reserved', constructBytes(0x18)),
  constructField('aim_schemes', constructArray(4, constructInt32sl())),
  constructField('aim_schemes_reserved', constructBytes(0x18)),
  constructField('unknown_6c', constructInt32sl()),
  constructField('texture_scale', constructFloat32l()),
  constructField('player_name_buf', constructBytes(12)),
  constructField('selected_saved_name_slot', constructInt32sl()),
  constructField('saved_name_count', constructInt32sl()),
  constructField('saved_name_order', constructArray(SAVED_NAME_SLOT_COUNT, constructInt32sl())),
  constructField('saved_names', constructBytes(SAVED_NAMES_BLOB_SIZE)),
  constructField('player_name', constructBytes(PLAYER_NAME_SIZE)),
  constructField('player_name_len', constructInt32sl()),
  constructField('unknown_1a4', constructInt32sl()),
  constructField('unknown_1a8', constructInt32sl()),
  constructField('unknown_1ac', constructInt32sl()),
  constructField('aim_pov_right', constructInt32sl()),
  constructField('aim_pov_left', constructInt32sl()),
  constructField('screen_bpp', constructInt32sl()),
  constructField('screen_width', constructInt32sl()),
  constructField('screen_height', constructInt32sl()),
  constructField('windowed_flag', constructByte()),
  constructField('unknown_1c5', constructBytes(3)),
  constructField('keybinds_p1_p2', constructArray(2, PLAYER_BIND_BLOCK_STRUCT)),
  // The original wire format leaves this 0x1F8-byte gap uninterpreted.
  // The Python port uses the front of it for P3/P4 control bindings and
  // their direction-arrow flags, while preserving the remaining bytes.
  constructField('extended_keybinds_p3_p4', constructArray(2, PLAYER_BIND_BLOCK_STRUCT)),
  constructField('extended_direction_arrow_flags', constructArray(EXT_DIRECTION_ARROW_FLAG_COUNT, constructByte())),
  constructField('extended_reserved_gap', constructBytes(EXTENDED_RESERVED_GAP_SIZE)),
  constructField('unknown_440', constructInt32sl()),
  constructField('unknown_444', constructInt32sl()),
  constructField('hardcore_flag', constructByte()),
  constructField('ui_info_texts', constructByte()),
  constructField('unknown_44a', constructBytes(2)),
  constructField('perk_prompt_counter', constructInt32sl()),
  constructField('unknown_450', constructInt32sl()),
  constructField('unknown_454', constructBytes(0x0C)),
  constructField('sound_freq_adjustment_enabled', constructByte()),
  constructField('unknown_461', constructBytes(3)),
  constructField('sfx_volume', constructFloat32l()),
  constructField('music_volume', constructFloat32l()),
  constructField('violence_disabled', constructByte()),
  constructField('score_load_gate', constructByte()),
  constructField('safe_mode_backend_enabled', constructByte()),
  constructField('unknown_46f', constructByte()),
  constructField('detail_preset', constructInt32sl()),
  constructField('mouse_sensitivity', constructFloat32l()),
  constructField('keybind_pick_perk', constructInt32sl()),
  constructField('keybind_reload', constructInt32sl()),
]);
const _DEFAULT_PROFILE_NAME = '10tons';
export const DEFAULT_SAVED_NAMES: [string, string, string, string, string, string, string, string] = [
  'default',
  'default',
  'default',
  'default',
  'default',
  'default',
  'default',
  'default',
];
export const DEFAULT_PLAYER_CONTROL_TEMPLATES: readonly CrimsonPlayerControls[] = [
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

interface Construct<T> {
  parse(data: Uint8Array | ArrayBuffer | ArrayBufferView): T;
  build(value: T): Uint8Array;
  parseAt(view: DataView, offset: number, ctx: Record<string, any>): { value: T; offset: number };
  buildInto(value: T, chunks: Uint8Array[], ctx: Record<string, any>): void;
}

interface ConstructField<T = any> {
  name: string;
  construct: Construct<T>;
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

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function constructField<T>(name: string, construct: Construct<T>): ConstructField<T> {
  return { name, construct };
}

function constructByte(): Construct<number> {
  return {
    parse(data) {
      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;
    },
    build(value) {
      const output = new Uint8Array(1);
      output[0] = value & 0xff;
      return output;
    },
    parseAt(view, offset) {
      return { value: view.getUint8(offset), offset: offset + 1 };
    },
    buildInto(value, chunks) {
      chunks.push(this.build(value));
    },
  };
}

function constructInt32sl(): Construct<number> {
  return {
    parse(data) {
      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;
    },
    build(value) {
      const output = new Uint8Array(4);
      new DataView(output.buffer).setInt32(0, value, true);
      return output;
    },
    parseAt(view, offset) {
      return { value: view.getInt32(offset, true), offset: offset + 4 };
    },
    buildInto(value, chunks) {
      chunks.push(this.build(value));
    },
  };
}

function constructInt32ul(): Construct<number> {
  return {
    parse(data) {
      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;
    },
    build(value) {
      const output = new Uint8Array(4);
      new DataView(output.buffer).setUint32(0, value, true);
      return output;
    },
    parseAt(view, offset) {
      return { value: view.getUint32(offset, true), offset: offset + 4 };
    },
    buildInto(value, chunks) {
      chunks.push(this.build(value));
    },
  };
}

function constructFloat32l(): Construct<number> {
  return {
    parse(data) {
      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;
    },
    build(value) {
      const output = new Uint8Array(4);
      new DataView(output.buffer).setFloat32(0, value, true);
      return output;
    },
    parseAt(view, offset) {
      return { value: view.getFloat32(offset, true), offset: offset + 4 };
    },
    buildInto(value, chunks) {
      chunks.push(this.build(value));
    },
  };
}

function constructCString(encoding: string): Construct<string> {
  const decoder = new TextDecoder(encoding);
  const encoder = new TextEncoder();
  return {
    parse(data) {
      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;
    },
    build(value) {
      const encoded = encoder.encode(value);
      const output = new Uint8Array(encoded.byteLength + 1);
      output.set(encoded, 0);
      return output;
    },
    parseAt(view, offset) {
      const start = offset;
      while (offset < view.byteLength && view.getUint8(offset) !== 0) {
        offset += 1;
      }
      if (offset >= view.byteLength) {
        throw new Error('unterminated CString');
      }
      const bytes = new Uint8Array(view.buffer, view.byteOffset + start, offset - start);
      return { value: decoder.decode(bytes), offset: offset + 1 };
    },
    buildInto(value, chunks) {
      chunks.push(this.build(value));
    },
  };
}

function constructBytes(size: number | ((ctx: Record<string, any>) => number)): Construct<Uint8Array> {
  return {
    parse(data) {
      const bytes = bytesFrom(data);
      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;
    },
    build(value) {
      return bytesFrom(value);
    },
    parseAt(view, offset, ctx) {
      const length = typeof size === 'function' ? size(ctx) : size;
      return { value: new Uint8Array(view.buffer, view.byteOffset + offset, length), offset: offset + length };
    },
    buildInto(value, chunks) {
      chunks.push(bytesFrom(value));
    },
  };
}

function constructConst(expected: Uint8Array): Construct<Uint8Array> {
  return {
    parse(data) {
      return this.parseAt(new DataView(bytesFrom(data).buffer, bytesFrom(data).byteOffset, bytesFrom(data).byteLength), 0, {}).value;
    },
    build() {
      return expected;
    },
    parseAt(view, offset) {
      const value = new Uint8Array(view.buffer, view.byteOffset + offset, expected.byteLength);
      if (!bytesEqual(value, expected)) {
        throw new Error('Const mismatch');
      }
      return { value, offset: offset + expected.byteLength };
    },
    buildInto(_value, chunks) {
      chunks.push(expected);
    },
  };
}

function constructArray<T>(count: number, item: Construct<T>): Construct<T[]> {
  return {
    parse(data) {
      const bytes = bytesFrom(data);
      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;
    },
    build(values) {
      const chunks: Uint8Array[] = [];
      this.buildInto(values, chunks, {});
      return concatBytes(chunks);
    },
    parseAt(view, offset, ctx) {
      const values: T[] = [];
      for (let index = 0; index < count; index += 1) {
        const parsed = item.parseAt(view, offset, ctx);
        values.push(parsed.value);
        offset = parsed.offset;
      }
      return { value: values, offset };
    },
    buildInto(values, chunks, ctx) {
      for (let index = 0; index < count; index += 1) {
        item.buildInto(values[index], chunks, ctx);
      }
    },
  };
}

function constructGreedyRange<T>(item: Construct<T>): Construct<T[]> {
  return {
    parse(data) {
      const bytes = bytesFrom(data);
      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;
    },
    build(values) {
      const chunks: Uint8Array[] = [];
      for (const value of values) {
        item.buildInto(value, chunks, value as Record<string, any>);
      }
      return concatBytes(chunks);
    },
    parseAt(view, offset) {
      const values: T[] = [];
      while (offset < view.byteLength) {
        const parsed = item.parseAt(view, offset, {});
        values.push(parsed.value);
        offset = parsed.offset;
      }
      return { value: values, offset };
    },
    buildInto(values, chunks) {
      chunks.push(this.build(values));
    },
  };
}

function constructStruct(fields: readonly ConstructField[]): Construct<Record<string, any>> {
  return {
    parse(data) {
      const bytes = bytesFrom(data);
      return this.parseAt(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, {}).value;
    },
    build(value) {
      const chunks: Uint8Array[] = [];
      this.buildInto(value, chunks, value);
      return concatBytes(chunks);
    },
    parseAt(view, offset) {
      const value: Record<string, any> = {};
      for (const field of fields) {
        const parsed = field.construct.parseAt(view, offset, value);
        value[field.name] = parsed.value;
        offset = parsed.offset;
      }
      return { value, offset };
    },
    buildInto(value, chunks) {
      for (const field of fields) {
        field.construct.buildInto(value[field.name], chunks, value);
      }
    },
  };
}

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

function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0 && !Number.isNaN(value);
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size > 0;
  }
  return true;
}

export enum HighScoreDateMode {
  ALL_TIME = 0,
  MONTH = 1,
  WEEK = 2,
  DAY = 3,
}

function _playerIndex(playerIndex: number): number {
  const idx = int(playerIndex);
  if (idx < 0 || idx >= 4) {
    throw new RangeError(`player index must be in 0..3, got ${idx}`);
  }
  return idx;
}

function requireRange(value: number, opts: { minimum: number; maximum: number; field: string }): number {
  const minimum = opts.minimum;
  const maximum = opts.maximum;
  const field = opts.field;
  if (value < minimum || value > maximum) {
    throw new Error(`${field} must be in ${minimum}..${maximum}, got ${value}`);
  }
  return value;
}

function parsedPlayerBindBlock(raw: Record<string, any>, opts: { playerIndex: number }): Record<string, any> {
  const playerIndex = opts.playerIndex;
  const idx = _playerIndex(playerIndex);
  if (idx < 2) {
    return raw['keybinds_p1_p2'][idx];
  }
  return raw['extended_keybinds_p3_p4'][idx - 2];
}

function parsedPlayerBindBlockIsUninitialized(rawBlock: Record<string, any>): boolean {
  return !Array.from([rawBlock['move_forward'], rawBlock['move_backward'], rawBlock['turn_left'], rawBlock['turn_right'], rawBlock['fire'], ...rawBlock['reserved_keys'], rawBlock['aim_left'], rawBlock['aim_right'], rawBlock['axis_aim_y'], rawBlock['axis_aim_x'], rawBlock['axis_move_y'], rawBlock['axis_move_x']]).some(pythonTruthy);
}

function playerControlsFromParsedBindBlock(rawBlock: Record<string, any>, opts: { playerIndex: number; movement: MovementControlType; aimScheme: AimScheme; showDirectionArrow: boolean }): CrimsonPlayerControls {
  const playerIndex = opts.playerIndex;
  const movement = opts.movement;
  const aimScheme = opts.aimScheme;
  const showDirectionArrow = opts.showDirectionArrow;
  if (parsedPlayerBindBlockIsUninitialized(rawBlock)) {
    const defaults = defaultPlayerControls(playerIndex);
    return new CrimsonPlayerControls({ movement: movement, aimScheme: aimScheme, showDirectionArrow: showDirectionArrow, moveCodes: defaults.moveCodes, fireCode: defaults.fireCode, keyboardAimCodes: defaults.keyboardAimCodes, aimAxisCodes: defaults.aimAxisCodes, moveAxisCodes: defaults.moveAxisCodes });
  }
  return new CrimsonPlayerControls({ movement: movement, aimScheme: aimScheme, showDirectionArrow: showDirectionArrow, moveCodes: [rawBlock['move_forward'], rawBlock['move_backward'], rawBlock['turn_left'], rawBlock['turn_right']], fireCode: rawBlock['fire'], keyboardAimCodes: [rawBlock['aim_left'], rawBlock['aim_right']], aimAxisCodes: [rawBlock['axis_aim_y'], rawBlock['axis_aim_x']], moveAxisCodes: [rawBlock['axis_move_y'], rawBlock['axis_move_x']] });
}

function encodePlayerBindBlock(player: CrimsonPlayerControls): Record<string, unknown> {
  return { 'move_forward': player.moveCodes[0], 'move_backward': player.moveCodes[1], 'turn_left': player.moveCodes[2], 'turn_right': player.moveCodes[3], 'fire': player.fireCode, 'reserved_keys': [int(_DEFAULT_WIRE_RESERVED_KEYS[0]), int(_DEFAULT_WIRE_RESERVED_KEYS[1])], 'aim_left': player.keyboardAimCodes[0], 'aim_right': player.keyboardAimCodes[1], 'axis_aim_y': player.aimAxisCodes[0], 'axis_aim_x': player.aimAxisCodes[1], 'axis_move_y': player.moveAxisCodes[0], 'axis_move_x': player.moveAxisCodes[1], 'padding': [int(_DEFAULT_WIRE_PADDING[0]), int(_DEFAULT_WIRE_PADDING[1]), int(_DEFAULT_WIRE_PADDING[2])] };
}

function encodePrimaryKeybinds(players: readonly CrimsonPlayerControls[]): Record<string, unknown>[] {
  return Array.from({ length: Math.max(0, 2) }, (_, i) => i).map((idx) => encodePlayerBindBlock(players[idx]));
}

function encodeExtendedKeybinds(players: readonly CrimsonPlayerControls[]): Record<string, unknown>[] {
  return Array.from({ length: Math.max(0, 4 - 2) }, (_, i) => 2 + i).map((idx) => encodePlayerBindBlock(players[idx]));
}

function decodeDirectionArrow(raw: Record<string, any>, opts: { playerIndex: number }): boolean {
  const playerIndex = opts.playerIndex;
  const idx = _playerIndex(playerIndex);
  if (idx < 2) {
    return pythonTruthy(int(raw['direction_arrow_flags'][idx]));
  }

  const value = int(raw['extended_direction_arrow_flags'][idx - 2]);
  if (value === EXT_DIRECTION_ARROW_OFF) {
    return false;
  }
  if (value === EXT_DIRECTION_ARROW_UNSET || value === EXT_DIRECTION_ARROW_ON) {
    return true;
  }
  throw new Error(`unsupported extended direction arrow flag value: ${value}`);
}

function encodeDirectionArrowFlags(players: readonly CrimsonPlayerControls[]): [number[], [number, number]] {
  const primary = [1, 1];
  for (let idx = 0; idx < 2; idx++) {
    primary[idx] = Boolean(players[idx].showDirectionArrow) ? 1 : 0;
  }
  const extended: number[] = [];
  for (let idx = 2; idx < 4; idx++) {
    extended.push(Boolean(players[idx].showDirectionArrow) ? EXT_DIRECTION_ARROW_ON : EXT_DIRECTION_ARROW_OFF);
  }
  return [primary, [extended[0], extended[1]]];
}

function decodeMovement(value: number): MovementControlType {
  const raw = int(value);
  if (raw === 0) {
    return MovementControlType.STATIC;
  }
  return raw as unknown as MovementControlType;
}

function decodeAimScheme(value: number): AimScheme {
  return int(value) as unknown as AimScheme;
}

function decodeGameMode(value: number): GameMode {
  return int(value) as unknown as GameMode;
}

function decodeHighScoreDateMode(value: number): HighScoreDateMode {
  return int(value) as unknown as HighScoreDateMode;
}

function decodePlayerName(raw: Uint8Array): string {
  return latin1DecodeUntilNull(bytesFrom(raw));
}

function encodePlayerNameBuffer(name: string): Uint8Array {
  const encoded = latin1EncodeIgnore(name).slice(0, PLAYER_NAME_MAX_BYTES);
  const buf = new Uint8Array(PLAYER_NAME_SIZE);
  buf.set(encoded, 0);
  buf[Math.min(encoded.length, PLAYER_NAME_MAX_BYTES)] = 0;
  return bytesFrom(buf);
}

function decodeSavedNames(raw: Uint8Array): [string, string, string, string, string, string, string, string] {
  const blob = bytesFrom(raw);
  const names: string[] = [];
  for (let idx = 0; idx < SAVED_NAME_SLOT_COUNT; idx++) {
    const entry = blob.slice(idx * SAVED_NAME_ENTRY_SIZE, (idx + 1) * SAVED_NAME_ENTRY_SIZE);
    names.push(latin1DecodeUntilNull(entry));
  }
  return Array.from(names) as [string, string, string, string, string, string, string, string];
}

function encodeSavedNamesBlob(names: readonly string[]): Uint8Array {
  const out = new Uint8Array(SAVED_NAMES_BLOB_SIZE);
  for (let idx = 0; idx < SAVED_NAME_SLOT_COUNT; idx++) {
    const name = idx < names.length ? String(names[idx]) : '';
    const encoded = latin1EncodeIgnore(name).slice(0, SAVED_NAME_ENTRY_SIZE - 1);
    const start = idx * SAVED_NAME_ENTRY_SIZE;
    out.fill(0, start, start + SAVED_NAME_ENTRY_SIZE);
    out.set(encoded, start);
    out[start + Math.min(encoded.length, SAVED_NAME_ENTRY_SIZE - 1)] = 0;
  }
  return bytesFrom(out);
}

function savedNameOrderValues(): number[] {
  return Array.from(Array.from({ length: Math.max(0, SAVED_NAME_SLOT_COUNT) }, (_, i) => i));
}

function defaultPlayerControls(playerIndex: number): CrimsonPlayerControls {
  const defaults = DEFAULT_PLAYER_CONTROL_TEMPLATES[_playerIndex(playerIndex)];
  return new CrimsonPlayerControls({ movement: defaults.movement, aimScheme: defaults.aimScheme, showDirectionArrow: defaults.showDirectionArrow, moveCodes: defaults.moveCodes, fireCode: defaults.fireCode, keyboardAimCodes: defaults.keyboardAimCodes, aimAxisCodes: defaults.aimAxisCodes, moveAxisCodes: defaults.moveAxisCodes });
}

export function defaultCrimsonCfg(path: string = '<memory>'): CrimsonConfig {
  const profile = new CrimsonProfileConfig({ playerName: '', playerNameInputLen: 0, savedNameCount: 1, selectedSavedNameSlot: 0, savedNames: DEFAULT_SAVED_NAMES, showInternetScores: false, scoreDateMode: HighScoreDateMode.ALL_TIME });
  profile.setPlayerNameInput(_DEFAULT_PROFILE_NAME);
  profile.playerNameInputLen = 0;
  return new CrimsonConfig({ path: path, display: new CrimsonDisplayConfig({ width: 1024, height: 768, windowed: true, bpp: 32, textureScale: 1.0, mouseSensitivity: 0.5, detailPreset: 5, fxDetail: [true, true, true], violenceDisabled: 0 }), audio: new CrimsonAudioConfig({ soundDisabled: false, musicDisabled: false, sfxVolume: 1.0, musicVolume: 1.0 }), gameplay: new CrimsonGameplayConfig({ mode: GameMode.SURVIVAL, playerCount: 1, hardcore: false, questLevel: null, showInfoTexts: true }), profile: profile, controls: new CrimsonControlsConfig({ players: [defaultPlayerControls(0), defaultPlayerControls(1), defaultPlayerControls(2), defaultPlayerControls(3)], pickPerkCode: 0x101, reloadCode: 0x102 }) });
}

export function decodeCrimsonCfg(path: string, blob: Uint8Array): CrimsonConfig {
  if (blob.length !== CRIMSON_CFG_SIZE) {
    throw new Error(`${path} has unexpected size ${blob.length} (expected ${CRIMSON_CFG_SIZE})`);
  }
  const raw = CRIMSON_CFG_STRUCT.parse(blob);

  let fxDetail: [boolean, boolean, boolean] = [Boolean(raw['fx_detail_0']), Boolean(raw['fx_detail_1']), Boolean(raw['fx_detail_2'])];
  let detailPreset = int(raw['detail_preset']);
  if (detailPreset === 0 && !Array.from(fxDetail).some(pythonTruthy)) {
    detailPreset = 5;
    fxDetail = [true, true, true];
  } else {
    detailPreset = requireRange(detailPreset, { minimum: 1, maximum: 5, field: 'detail_preset' });
  }

  const players: [CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls] = Array.from({ length: Math.max(0, 4) }, (_, i) => i).map((idx) => playerControlsFromParsedBindBlock(parsedPlayerBindBlock(raw, { playerIndex: idx }), { playerIndex: idx, movement: decodeMovement(raw['player_mode_flags'][idx]), aimScheme: decodeAimScheme(raw['aim_schemes'][idx]), showDirectionArrow: decodeDirectionArrow(raw, { playerIndex: idx }) })) as [CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls, CrimsonPlayerControls];

  return new CrimsonConfig({ path: path, display: new CrimsonDisplayConfig({ width: int(raw['screen_width']), height: int(raw['screen_height']), windowed: Boolean(raw['windowed_flag']), bpp: int(raw['screen_bpp']), textureScale: raw['texture_scale'], mouseSensitivity: raw['mouse_sensitivity'], detailPreset: detailPreset, fxDetail: fxDetail, violenceDisabled: int(raw['violence_disabled']) }), audio: new CrimsonAudioConfig({ soundDisabled: Boolean(raw['sound_disable']), musicDisabled: Boolean(raw['music_disable']), sfxVolume: raw['sfx_volume'], musicVolume: raw['music_volume'] }), gameplay: new CrimsonGameplayConfig({ mode: decodeGameMode(raw['game_mode']), playerCount: requireRange(int(raw['player_count']), { minimum: 1, maximum: 4, field: 'player_count' }), hardcore: Boolean(raw['hardcore_flag']), questLevel: null, showInfoTexts: Boolean(raw['ui_info_texts']) }), profile: new CrimsonProfileConfig({ playerName: decodePlayerName(raw['player_name']), playerNameInputLen: requireRange(int(raw['player_name_len']), { minimum: 0, maximum: PLAYER_NAME_MAX_BYTES, field: 'player_name_len' }), savedNameCount: requireRange(int(raw['saved_name_count']), { minimum: 1, maximum: SAVED_NAME_SLOT_COUNT, field: 'saved_name_count' }), selectedSavedNameSlot: requireRange(int(raw['selected_saved_name_slot']), { minimum: 0, maximum: SAVED_NAME_SLOT_COUNT - 1, field: 'selected_saved_name_slot' }), savedNames: decodeSavedNames(raw['saved_names']), showInternetScores: Boolean(raw['score_load_gate']), scoreDateMode: decodeHighScoreDateMode(raw['highscore_date_mode']) }), controls: new CrimsonControlsConfig({ players: players, pickPerkCode: int(raw['keybind_pick_perk']), reloadCode: int(raw['keybind_reload']) }) });
}

function canonicalWireData(): Record<string, any> {
  return { ...(CRIMSON_CFG_STRUCT.parse(new Uint8Array(CRIMSON_CFG_SIZE))) };
}

export function encodeCrimsonCfg(config: CrimsonConfig): Uint8Array {
  const data = canonicalWireData();
  const [primaryDirectionArrows, extendedDirectionArrows] = encodeDirectionArrowFlags(config.controls.players);

  data['sound_disable'] = config.audio.soundDisabled ? 1 : 0;
  data['music_disable'] = config.audio.musicDisabled ? 1 : 0;
  data['highscore_date_mode'] = int(config.profile.scoreDateMode);
  data['direction_arrow_flags'] = primaryDirectionArrows;
  data['unknown_08'] = 0;
  data['fx_detail_0'] = config.display.fxDetailEnabled(0) ? 1 : 0;
  data['fx_detail_1'] = config.display.fxDetailEnabled(1) ? 1 : 0;
  data['fx_detail_2'] = config.display.fxDetailEnabled(2) ? 1 : 0;
  data['player_count'] = requireRange(int(config.gameplay.playerCount), { minimum: 1, maximum: 4, field: 'player_count' });
  data['game_mode'] = int(config.gameplay.mode);
  data['player_mode_flags'] = Array.from(config.controls.players).map((player) => int(player.movement));
  data['aim_schemes'] = Array.from(config.controls.players).map((player) => int(player.aimScheme));
  data['texture_scale'] = config.display.textureScale;
  data['selected_saved_name_slot'] = requireRange(int(config.profile.selectedSavedNameSlot), { minimum: 0, maximum: SAVED_NAME_SLOT_COUNT - 1, field: 'selected_saved_name_slot' });
  data['saved_name_count'] = requireRange(int(config.profile.savedNameCount), { minimum: 1, maximum: SAVED_NAME_SLOT_COUNT, field: 'saved_name_count' });
  data['saved_name_order'] = Array.from(savedNameOrderValues());
  data['saved_names'] = encodeSavedNamesBlob(config.profile.savedNames);
  data['player_name'] = encodePlayerNameBuffer(config.profile.playerName);
  data['player_name_len'] = requireRange(int(config.profile.playerNameInputLen), { minimum: 0, maximum: PLAYER_NAME_MAX_BYTES, field: 'player_name_len' });
  data['unknown_1a4'] = 100;
  data['aim_pov_right'] = 9000;
  data['aim_pov_left'] = 27000;
  data['screen_bpp'] = int(config.display.bpp);
  data['screen_width'] = int(config.display.width);
  data['screen_height'] = int(config.display.height);
  data['windowed_flag'] = config.display.windowed ? 1 : 0;
  data['keybinds_p1_p2'] = encodePrimaryKeybinds(config.controls.players);
  data['extended_keybinds_p3_p4'] = encodeExtendedKeybinds(config.controls.players);
  data['extended_direction_arrow_flags'] = [int(extendedDirectionArrows[0]), int(extendedDirectionArrows[1])];
  data['hardcore_flag'] = config.gameplay.hardcore ? 1 : 0;
  data['ui_info_texts'] = config.gameplay.showInfoTexts ? 1 : 0;
  data['unknown_450'] = 1;
  data['sound_freq_adjustment_enabled'] = 1;
  data['sfx_volume'] = config.audio.sfxVolume;
  data['music_volume'] = config.audio.musicVolume;
  data['violence_disabled'] = int(config.display.violenceDisabled);
  data['score_load_gate'] = config.profile.showInternetScores ? 1 : 0;
  data['detail_preset'] = requireRange(int(config.display.detailPreset), { minimum: 1, maximum: 5, field: 'detail_preset' });
  data['mouse_sensitivity'] = config.display.mouseSensitivity;
  data['keybind_pick_perk'] = config.controls.pickPerkCode;
  data['keybind_reload'] = config.controls.reloadCode;
  return CRIMSON_CFG_STRUCT.build(data);
}

export function loadCrimsonCfg(path: string): CrimsonConfig {
  return decodeCrimsonCfg(path, readFileSync(String(path)));
}

export function ensureCrimsonCfg(baseDir: string): CrimsonConfig {
  const path = _pathJoin(baseDir, CRIMSON_CFG_NAME);
  if (!existsSync(String(path))) {
    const config = defaultCrimsonCfg(path);
    config.save();
    return config;
  }
  return loadCrimsonCfg(path);
}

export function applyDetailPreset(config: CrimsonConfig, preset: number | null = null): number {
  let selected = preset === null ? config.display.detailPreset : int(preset);
  selected = requireRange(selected, { minimum: 1, maximum: 5, field: 'detail_preset' });
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
