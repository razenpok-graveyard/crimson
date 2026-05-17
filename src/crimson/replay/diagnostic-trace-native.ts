// Port of crimson/replay/diagnostic_trace_native.py

import type { OwnerRef } from '@crimson/owner-ref.ts';
import { readFileSync } from 'node:fs';

export class ReplayTickTraceTiming {
  elapsedMs: number;

  constructor(opts: {
    elapsedMs: number;
  }) {
    this.elapsedMs = opts.elapsedMs;
  }
}

export class ReplayTickRng {
  rngState: number;
  rngAfterPerkEffects: number;
  rngAfterCreatures: number;
  rngAfterProjectiles: number;
  rngAfterSecondaryProjectiles: number;
  rngAfterParticles: number;
  rngAfterPlayerUpdate: number;
  rngAfterStageSpawns: number;
  rngAfterWaveSpawns: number;
  rngAfterSpawns: number;
  rngAfterBonusUpdate: number;

  constructor(opts: {
    rngState: number;
    rngAfterPerkEffects: number;
    rngAfterCreatures: number;
    rngAfterProjectiles: number;
    rngAfterSecondaryProjectiles: number;
    rngAfterParticles: number;
    rngAfterPlayerUpdate: number;
    rngAfterStageSpawns: number;
    rngAfterWaveSpawns: number;
    rngAfterSpawns: number;
    rngAfterBonusUpdate: number;
  }) {
    this.rngState = opts.rngState;
    this.rngAfterPerkEffects = opts.rngAfterPerkEffects;
    this.rngAfterCreatures = opts.rngAfterCreatures;
    this.rngAfterProjectiles = opts.rngAfterProjectiles;
    this.rngAfterSecondaryProjectiles = opts.rngAfterSecondaryProjectiles;
    this.rngAfterParticles = opts.rngAfterParticles;
    this.rngAfterPlayerUpdate = opts.rngAfterPlayerUpdate;
    this.rngAfterStageSpawns = opts.rngAfterStageSpawns;
    this.rngAfterWaveSpawns = opts.rngAfterWaveSpawns;
    this.rngAfterSpawns = opts.rngAfterSpawns;
    this.rngAfterBonusUpdate = opts.rngAfterBonusUpdate;
  }
}

export class ReplayTickTraceSummary {
  scoreXp: number;
  kills: number;
  shotsFiredP0: number;
  creatureCount: number;
  perkPending: number;

  constructor(opts: {
    scoreXp: number;
    kills: number;
    shotsFiredP0: number;
    creatureCount: number;
    perkPending: number;
  }) {
    this.scoreXp = opts.scoreXp;
    this.kills = opts.kills;
    this.shotsFiredP0 = opts.shotsFiredP0;
    this.creatureCount = opts.creatureCount;
    this.perkPending = opts.perkPending;
  }
}

export class ReplayTickTraceVec2 {
  x: number;
  y: number;

  constructor(opts: {
    x: number;
    y: number;
  }) {
    this.x = opts.x;
    this.y = opts.y;
  }
}

export class ReplayTickTraceWeaponState {
  weaponId: number | string;
  ammo: number;
  clipSize: number;
  reloadActive: boolean;
  reloadTimer: number;
  reloadTimerMax: number;
  shotCooldown: number;

  constructor(opts: {
    weaponId: number | string;
    ammo: number;
    clipSize?: number;
    reloadActive?: boolean;
    reloadTimer?: number;
    reloadTimerMax?: number;
    shotCooldown?: number;
  }) {
    this.weaponId = opts.weaponId;
    this.ammo = opts.ammo;
    this.clipSize = opts.clipSize ?? 0;
    this.reloadActive = opts.reloadActive ?? false;
    this.reloadTimer = opts.reloadTimer ?? 0.0;
    this.reloadTimerMax = opts.reloadTimerMax ?? 0.0;
    this.shotCooldown = opts.shotCooldown ?? 0.0;
  }
}

export class ReplayTickTracePlayerState {
  index: number;
  pos: ReplayTickTraceVec2;
  health: number;
  weapon: ReplayTickTraceWeaponState;
  experience: number;
  level: number;

  constructor(opts: {
    index: number;
    pos: ReplayTickTraceVec2;
    health: number;
    weapon: ReplayTickTraceWeaponState;
    experience: number;
    level: number;
  }) {
    this.index = opts.index;
    this.pos = opts.pos;
    this.health = opts.health;
    this.weapon = opts.weapon;
    this.experience = opts.experience;
    this.level = opts.level;
  }
}

export class ReplayTickTracePerkSelection {
  pendingCount: number;

  constructor(opts: {
    pendingCount?: number;
  } = {}) {
    this.pendingCount = opts.pendingCount ?? 0;
  }
}

export class ReplayTickTraceBonusTimers {
  weaponPowerUp: number;
  reflexBoost: number;
  energizer: number;
  doubleExperience: number;
  freeze: number;

  constructor(opts: {
    weaponPowerUp?: number;
    reflexBoost?: number;
    energizer?: number;
    doubleExperience?: number;
    freeze?: number;
  } = {}) {
    this.weaponPowerUp = opts.weaponPowerUp ?? 0.0;
    this.reflexBoost = opts.reflexBoost ?? 0.0;
    this.energizer = opts.energizer ?? 0.0;
    this.doubleExperience = opts.doubleExperience ?? 0.0;
    this.freeze = opts.freeze ?? 0.0;
  }
}

export class ReplayTickTraceGameplayState {
  bonuses: ReplayTickTraceBonusTimers;
  perkSelection: ReplayTickTracePerkSelection;
  pendingNukeCount: number;
  debugNukeKillsLast: number;
  debugNukeTickLast: number;
  debugNukeKillIndexSum: number;
  debugLastPickedBonusId: number;
  debugLastPickedBonusAmount: number;

  constructor(opts: {
    bonuses: ReplayTickTraceBonusTimers;
    perkSelection: ReplayTickTracePerkSelection;
    pendingNukeCount?: number;
    debugNukeKillsLast?: number;
    debugNukeTickLast?: number;
    debugNukeKillIndexSum?: number;
    debugLastPickedBonusId?: number;
    debugLastPickedBonusAmount?: number;
  }) {
    this.bonuses = opts.bonuses;
    this.perkSelection = opts.perkSelection;
    this.pendingNukeCount = opts.pendingNukeCount ?? 0;
    this.debugNukeKillsLast = opts.debugNukeKillsLast ?? 0;
    this.debugNukeTickLast = opts.debugNukeTickLast ?? 0;
    this.debugNukeKillIndexSum = opts.debugNukeKillIndexSum ?? 0;
    this.debugLastPickedBonusId = opts.debugLastPickedBonusId ?? 0;
    this.debugLastPickedBonusAmount = opts.debugLastPickedBonusAmount ?? 0;
  }
}

export class ReplayTickTraceCreatureSample {
  index: number;
  typeId: number;
  hp: number;
  pos: ReplayTickTraceVec2;
  flags: number;
  aiMode: number;
  linkIndex: number;
  heading: number;
  targetHeading: number;
  orbitAngle: number;
  orbitRadius: number;
  lifecycleStage: number;

  constructor(opts: {
    index: number;
    typeId: number;
    hp: number;
    pos: ReplayTickTraceVec2;
    flags: number;
    aiMode: number;
    linkIndex: number;
    heading: number;
    targetHeading: number;
    orbitAngle: number;
    orbitRadius: number;
    lifecycleStage: number;
  }) {
    this.index = opts.index;
    this.typeId = opts.typeId;
    this.hp = opts.hp;
    this.pos = opts.pos;
    this.flags = opts.flags;
    this.aiMode = opts.aiMode;
    this.linkIndex = opts.linkIndex;
    this.heading = opts.heading;
    this.targetHeading = opts.targetHeading;
    this.orbitAngle = opts.orbitAngle;
    this.orbitRadius = opts.orbitRadius;
    this.lifecycleStage = opts.lifecycleStage;
  }
}

export class ReplayTickTraceProjectileSample {
  index: number;
  typeId: number;
  angle: number;
  pos: ReplayTickTraceVec2;
  vel: ReplayTickTraceVec2;
  lifeTimer: number;
  speedScale: number;
  damagePool: number;
  hitRadius: number;
  travelBudget: number;
  owner: OwnerRef;

  constructor(opts: {
    index: number;
    typeId: number;
    angle: number;
    pos: ReplayTickTraceVec2;
    vel: ReplayTickTraceVec2;
    lifeTimer: number;
    speedScale: number;
    damagePool: number;
    hitRadius: number;
    travelBudget: number;
    owner: OwnerRef;
  }) {
    this.index = opts.index;
    this.typeId = opts.typeId;
    this.angle = opts.angle;
    this.pos = opts.pos;
    this.vel = opts.vel;
    this.lifeTimer = opts.lifeTimer;
    this.speedScale = opts.speedScale;
    this.damagePool = opts.damagePool;
    this.hitRadius = opts.hitRadius;
    this.travelBudget = opts.travelBudget;
    this.owner = opts.owner;
  }
}

export class ReplayTickTraceSecondaryProjectileSample {
  index: number;
  typeId: number;
  angle: number;
  pos: ReplayTickTraceVec2;
  vel: ReplayTickTraceVec2;
  speed: number;
  trailTimer: number;
  owner: OwnerRef;
  targetId: number;

  constructor(opts: {
    index: number;
    typeId: number;
    angle: number;
    pos: ReplayTickTraceVec2;
    vel: ReplayTickTraceVec2;
    speed: number;
    trailTimer: number;
    owner: OwnerRef;
    targetId: number;
  }) {
    this.index = opts.index;
    this.typeId = opts.typeId;
    this.angle = opts.angle;
    this.pos = opts.pos;
    this.vel = opts.vel;
    this.speed = opts.speed;
    this.trailTimer = opts.trailTimer;
    this.owner = opts.owner;
    this.targetId = opts.targetId;
  }
}

export class ReplayTickTraceBonusSample {
  index: number;
  bonusId: number;
  picked: boolean;
  timeLeft: number;
  timeMax: number;
  pos: ReplayTickTraceVec2;
  amount: number;

  constructor(opts: {
    index: number;
    bonusId: number;
    picked: boolean;
    timeLeft: number;
    timeMax: number;
    pos: ReplayTickTraceVec2;
    amount: number;
  }) {
    this.index = opts.index;
    this.bonusId = opts.bonusId;
    this.picked = opts.picked;
    this.timeLeft = opts.timeLeft;
    this.timeMax = opts.timeMax;
    this.pos = opts.pos;
    this.amount = opts.amount;
  }
}

export class ReplayTickTraceEntitySamples {
  creatures: ReplayTickTraceCreatureSample[];
  projectiles: ReplayTickTraceProjectileSample[];
  secondaryProjectiles: ReplayTickTraceSecondaryProjectileSample[];
  bonuses: ReplayTickTraceBonusSample[];

  constructor(opts: {
    creatures?: ReplayTickTraceCreatureSample[];
    projectiles?: ReplayTickTraceProjectileSample[];
    secondaryProjectiles?: ReplayTickTraceSecondaryProjectileSample[];
    bonuses?: ReplayTickTraceBonusSample[];
  } = {}) {
    this.creatures = opts.creatures ?? [];
    this.projectiles = opts.projectiles ?? [];
    this.secondaryProjectiles = opts.secondaryProjectiles ?? [];
    this.bonuses = opts.bonuses ?? [];
  }
}

export class ReplayTickTraceRow {
  schemaVersion: number;
  tickIndex: number;
  timing: ReplayTickTraceTiming;
  rng: ReplayTickRng;
  summary: ReplayTickTraceSummary;
  gameplayState: ReplayTickTraceGameplayState;
  playerState: ReplayTickTracePlayerState;
  entities: ReplayTickTraceEntitySamples;

  constructor(opts: {
    schemaVersion: number;
    tickIndex: number;
    timing: ReplayTickTraceTiming;
    rng: ReplayTickRng;
    summary: ReplayTickTraceSummary;
    gameplayState: ReplayTickTraceGameplayState;
    playerState: ReplayTickTracePlayerState;
    entities?: ReplayTickTraceEntitySamples;
  }) {
    this.schemaVersion = opts.schemaVersion;
    this.tickIndex = opts.tickIndex;
    this.timing = opts.timing;
    this.rng = opts.rng;
    this.summary = opts.summary;
    this.gameplayState = opts.gameplayState;
    this.playerState = opts.playerState;
    this.entities = opts.entities ?? new ReplayTickTraceEntitySamples();
  }
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

function pythonStartsWith(value: string | Uint8Array, prefix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(prefix)) {
    return prefix.some((item) => pythonStartsWith(value, item));
  }
  if (typeof value === 'string' && typeof prefix === 'string') {
    return value.startsWith(prefix);
  }
  if (typeof value === 'string' || typeof prefix === 'string') {
    return false;
  }
  return value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte);
}

function pythonEndsWith(value: string | Uint8Array, suffix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(suffix)) {
    return suffix.some((item) => pythonEndsWith(value, item));
  }
  if (typeof value === 'string' && typeof suffix === 'string') {
    return value.endsWith(suffix);
  }
  if (typeof value === 'string' || typeof suffix === 'string') {
    return false;
  }
  const offset = value.byteLength - suffix.byteLength;
  return offset >= 0 && suffix.every((byte, index) => value[offset + index] === byte);
}

class MsgpackEncoder {
  private readonly _encoder = new TextEncoder();
  private _bytes: number[] = [];

  encode(value: unknown): Uint8Array {
    this._bytes = [];
    this.writeValue(value);
    return new Uint8Array(this._bytes);
  }

  private writeValue(value: unknown): void {
    if (value === null || value === undefined) {
      this.writeByte(0xc0);
    } else if (typeof value === 'boolean') {
      this.writeByte(value ? 0xc3 : 0xc2);
    } else if (typeof value === 'number') {
      this.writeNumber(value);
    } else if (typeof value === 'string') {
      this.writeString(value);
    } else if (value instanceof Uint8Array) {
      this.writeBinary(value);
    } else if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      this.writeBinary(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    } else if (Array.isArray(value)) {
      this.writeArray(value);
    } else if (value instanceof Map) {
      this.writeMap(Array.from(value.entries()));
    } else if (typeof value === 'object') {
      this.writeObject(value as Record<string, unknown>);
    } else {
      throw new Error('unsupported msgpack value');
    }
  }

  private writeNumber(value: number): void {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      this.writeByte(0xcb);
      const buffer = new ArrayBuffer(8);
      new DataView(buffer).setFloat64(0, value, false);
      this.writeBytes(new Uint8Array(buffer));
    } else if (value >= 0 && value <= 0x7f) {
      this.writeByte(value);
    } else if (value >= -32 && value < 0) {
      this.writeByte(0x100 + value);
    } else if (value >= 0 && value <= 0xff) {
      this.writeByte(0xcc);
      this.writeByte(value);
    } else if (value >= 0 && value <= 0xffff) {
      this.writeByte(0xcd);
      this.writeUint16(value);
    } else if (value >= 0 && value <= 0xffffffff) {
      this.writeByte(0xce);
      this.writeUint32(value);
    } else if (value >= -0x80 && value < 0) {
      this.writeByte(0xd0);
      this.writeByte(value);
    } else if (value >= -0x8000 && value < 0) {
      this.writeByte(0xd1);
      this.writeUint16(value);
    } else if (value >= -0x80000000 && value < 0) {
      this.writeByte(0xd2);
      this.writeUint32(value);
    } else {
      this.writeByte(0xcb);
      const buffer = new ArrayBuffer(8);
      new DataView(buffer).setFloat64(0, value, false);
      this.writeBytes(new Uint8Array(buffer));
    }
  }

  private writeString(value: string): void {
    const bytes = this._encoder.encode(value);
    if (bytes.length <= 31) {
      this.writeByte(0xa0 | bytes.length);
    } else if (bytes.length <= 0xff) {
      this.writeByte(0xd9);
      this.writeByte(bytes.length);
    } else if (bytes.length <= 0xffff) {
      this.writeByte(0xda);
      this.writeUint16(bytes.length);
    } else {
      this.writeByte(0xdb);
      this.writeUint32(bytes.length);
    }
    this.writeBytes(bytes);
  }

  private writeBinary(value: Uint8Array): void {
    if (value.length <= 0xff) {
      this.writeByte(0xc4);
      this.writeByte(value.length);
    } else if (value.length <= 0xffff) {
      this.writeByte(0xc5);
      this.writeUint16(value.length);
    } else {
      this.writeByte(0xc6);
      this.writeUint32(value.length);
    }
    this.writeBytes(value);
  }

  private writeArray(value: readonly unknown[]): void {
    if (value.length <= 15) {
      this.writeByte(0x90 | value.length);
    } else if (value.length <= 0xffff) {
      this.writeByte(0xdc);
      this.writeUint16(value.length);
    } else {
      this.writeByte(0xdd);
      this.writeUint32(value.length);
    }
    for (const item of value) {
      this.writeValue(item);
    }
  }

  private writeObject(value: Record<string, unknown>): void {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .map((key): [string, unknown] => [key, value[key]]);
    this.writeMap(entries);
  }

  private writeMap(entries: readonly (readonly [unknown, unknown])[]): void {
    if (entries.length <= 15) {
      this.writeByte(0x80 | entries.length);
    } else if (entries.length <= 0xffff) {
      this.writeByte(0xde);
      this.writeUint16(entries.length);
    } else {
      this.writeByte(0xdf);
      this.writeUint32(entries.length);
    }
    for (const [key, value] of entries) {
      this.writeValue(key);
      this.writeValue(value);
    }
  }

  private writeByte(value: number): void {
    this._bytes.push(value & 0xff);
  }

  private writeBytes(value: Uint8Array): void {
    for (const byte of value) {
      this.writeByte(byte);
    }
  }

  private writeUint16(value: number): void {
    this.writeByte(value >> 8);
    this.writeByte(value);
  }

  private writeUint32(value: number): void {
    this.writeByte(value / 0x1000000);
    this.writeByte(value >> 16);
    this.writeByte(value >> 8);
    this.writeByte(value);
  }
}

class MsgpackDecoder<T> {
  private readonly _type?: new (...args: any[]) => T;

  constructor(opts: { type?: new (...args: any[]) => T } = {}) {
    this._type = opts.type;
  }

  decode(blob: Uint8Array): T {
    const value = new MsgpackReader(blob).read();
    const normalized = camelizeMsgpackValue(value);
    if (
      this._type !== undefined
      && normalized !== null
      && typeof normalized === 'object'
      && !Array.isArray(normalized)
      && !(normalized instanceof Uint8Array)
      && !(normalized instanceof Map)
    ) {
      return new this._type(normalized);
    }
    return normalized as T;
  }
}

function camelizeMsgpackValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelizeMsgpackValue);
  }
  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, item]) => [key, camelizeMsgpackValue(item)]));
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())] = camelizeMsgpackValue(item);
    }
    return output;
  }
  return value;
}

class MsgpackReader {
  private readonly _decoder = new TextDecoder();
  private _offset = 0;

  constructor(private readonly _data: Uint8Array) {}

  read(): unknown {
    const value = this.readValue();
    if (this._offset !== this._data.length) {
      throw new Error('trailing msgpack bytes');
    }
    return value;
  }

  private readValue(): unknown {
    const tag = this.readByte();
    if (tag <= 0x7f) {
      return tag;
    }
    if (tag >= 0xe0) {
      return tag - 0x100;
    }
    if (tag >= 0xa0 && tag <= 0xbf) {
      return this.readString(tag & 0x1f);
    }
    if (tag >= 0x90 && tag <= 0x9f) {
      return this.readArray(tag & 0x0f);
    }
    if (tag >= 0x80 && tag <= 0x8f) {
      return this.readMap(tag & 0x0f);
    }
    switch (tag) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return this.readBytes(this.readByte());
      case 0xc5:
        return this.readBytes(this.readUint16());
      case 0xc6:
        return this.readBytes(this.readUint32());
      case 0xcb:
        return this.readFloat64();
      case 0xcc:
        return this.readByte();
      case 0xcd:
        return this.readUint16();
      case 0xce:
        return this.readUint32();
      case 0xd0:
        return this.toSigned(this.readByte(), 0x80, 0x100);
      case 0xd1:
        return this.toSigned(this.readUint16(), 0x8000, 0x10000);
      case 0xd2:
        return this.toSigned(this.readUint32(), 0x80000000, 0x100000000);
      case 0xd9:
        return this.readString(this.readByte());
      case 0xda:
        return this.readString(this.readUint16());
      case 0xdb:
        return this.readString(this.readUint32());
      case 0xdc:
        return this.readArray(this.readUint16());
      case 0xdd:
        return this.readArray(this.readUint32());
      case 0xde:
        return this.readMap(this.readUint16());
      case 0xdf:
        return this.readMap(this.readUint32());
      default:
        throw new Error('unsupported msgpack tag: ' + tag);
    }
  }

  private readArray(length: number): unknown[] {
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      result.push(this.readValue());
    }
    return result;
  }

  private readMap(length: number): Record<string, unknown> | Map<unknown, unknown> {
    const entries: [unknown, unknown][] = [];
    let stringKeys = true;
    for (let index = 0; index < length; index += 1) {
      const key = this.readValue();
      const value = this.readValue();
      entries.push([key, value]);
      stringKeys = stringKeys && typeof key === 'string';
    }
    if (!stringKeys) {
      return new Map(entries);
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      result[key as string] = value;
    }
    return result;
  }

  private readString(length: number): string {
    return this._decoder.decode(this.readBytes(length));
  }

  private readFloat64(): number {
    const bytes = this.readBytes(8);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, false);
  }

  private readUint16(): number {
    return (this.readByte() << 8) | this.readByte();
  }

  private readUint32(): number {
    return (this.readByte() * 0x1000000) + (this.readByte() << 16) + (this.readByte() << 8) + this.readByte();
  }

  private readByte(): number {
    if (this._offset >= this._data.length) {
      throw new Error('unexpected end of msgpack data');
    }
    const byte = this._data[this._offset];
    this._offset += 1;
    return byte;
  }

  private readBytes(length: number): Uint8Array {
    if (this._offset + length > this._data.length) {
      throw new Error('unexpected end of msgpack data');
    }
    const bytes = this._data.slice(this._offset, this._offset + length);
    this._offset += length;
    return bytes;
  }

  private toSigned(value: number, signBit: number, range: number): number {
    return value >= signBit ? value - range : value;
  }
}

export const REPLAY_TICK_TRACE_SCHEMA_VERSION = 6;
export const REPLAY_TICK_TRACE_MSGPACK_MAGIC = new Uint8Array([99, 114, 105, 109, 115, 111, 110, 95, 114, 101, 112, 108, 97, 121, 95, 116, 105, 99, 107, 95, 116, 114, 97, 99, 101, 95, 109, 115, 103, 112, 97, 99, 107, 95, 118, 51, 10]);
const _ROW_LEN_STRUCT = pythonStructFormat('<I');
const _ROW_DECODER = new MsgpackDecoder<ReplayTickTraceRow>({ type: ReplayTickTraceRow });

export function decodeReplayTickTraceMsgpackRow(payload: Uint8Array, opts: { field: string }): ReplayTickTraceRow {
  const field = opts.field;
  let row: ReturnType<typeof _ROW_DECODER.decode>;
  try {
    row = _ROW_DECODER.decode(payload);
  } catch (exc) {
    throw new Error(`${field} must be a valid replay tick trace v6 msgpack row`);
  }
  if (int(row.schemaVersion) !== int(REPLAY_TICK_TRACE_SCHEMA_VERSION)) {
    throw new Error(`${field}.schema_version must be ${int(REPLAY_TICK_TRACE_SCHEMA_VERSION)}, got ${int(row.schemaVersion)}`);
  }
  return row;
}

export function decodeReplayTickTraceMsgpackStreamBytes(data: Uint8Array, opts: { field: string }): ReplayTickTraceRow[] {
  const field = opts.field;
  const raw = bytesFrom(data);
  if (!pythonStartsWith(raw, REPLAY_TICK_TRACE_MSGPACK_MAGIC)) {
    throw new Error(`${field} has invalid trace msgpack magic`);
  }
  let offset = REPLAY_TICK_TRACE_MSGPACK_MAGIC.length;
  const rows: ReplayTickTraceRow[] = [];
  let rowIndex = 0;
  while (offset < raw.length) {
    if ((raw.length - offset) < _ROW_LEN_STRUCT.size) {
      throw new Error(`${field} has truncated row length prefix at offset ${offset}`);
    }
    const [rowLen] = _ROW_LEN_STRUCT.unpackFrom(raw, offset);
    offset += _ROW_LEN_STRUCT.size;
    if (int(rowLen) <= 0) {
      throw new Error(`${field} has invalid row length ${int(rowLen)}`);
    }
    const end = offset + int(rowLen);
    if (end > raw.length) {
      throw new Error(`${field} has truncated row payload at index ${rowIndex}`);
    }
    const payload = raw.slice(offset, end);
    offset = end;
    rows.push(decodeReplayTickTraceMsgpackRow(payload, { field: `${field}.rows[${rowIndex}]` }));
    rowIndex += 1;
  }
  return rows;
}

export function decodeReplayTickTraceMsgpackStream(path: string): ReplayTickTraceRow[] {
  const payload = readFileSync(String(path));
  return decodeReplayTickTraceMsgpackStreamBytes(payload, { field: path });
}
