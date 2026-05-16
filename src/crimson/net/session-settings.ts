// Port of crimson/net/session_settings.py

import { GameMode } from '@crimson/game-modes.ts';
import type { NonNegativeInt, PlayerCount, PositiveInt } from '@crimson/msgspec-types.ts';
import type { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import { INPUT_DELAY_TICKS as LOCKSTEP_INPUT_DELAY_TICKS } from '@crimson/net/lockstep-protocol.ts';
import { PROTOCOL_VERSION as LOCKSTEP_PROTOCOL_VERSION } from '@crimson/net/lockstep-protocol.ts';
import { TICK_RATE as LOCKSTEP_TICK_RATE } from '@crimson/net/lockstep-protocol.ts';
import { Hello, MatchStart, Welcome } from '@crimson/net/lockstep-protocol.ts';
import { INPUT_DELAY_TICKS as RELAY_INPUT_DELAY_TICKS } from '@crimson/net/relay-protocol.ts';
import type { NetcodeMode, RelaySlot } from '@crimson/net/relay-protocol.ts';
import { ROLLBACK_MAX_TICKS, RoomCreate, RoomStart, RoomState } from '@crimson/net/relay-protocol.ts';
import { TICK_RATE as RELAY_TICK_RATE } from '@crimson/net/relay-protocol.ts';
import type { RoomCode } from '@crimson/net/room-code.ts';

export type SessionSettings = LockstepSessionSettings | RelaySessionSettings;

export class LockstepSessionSettings {
  readonly modeId: GameMode;
  readonly playerCount: PlayerCount;
  readonly questLevel: QuestLevel | null;
  readonly preserveBugs: boolean;
  readonly tickRate: PositiveInt;
  readonly inputDelayTicks: NonNegativeInt;
  readonly netcodeMode: "lockstep";

  constructor(opts: {
    modeId?: GameMode;
    playerCount?: PlayerCount;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    tickRate?: PositiveInt;
    inputDelayTicks?: NonNegativeInt;
    netcodeMode?: "lockstep";
  } = {}) {
    this.modeId = opts.modeId ?? GameMode.DEMO;
    this.playerCount = opts.playerCount ?? 1;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.tickRate = opts.tickRate ?? LOCKSTEP_TICK_RATE;
    this.inputDelayTicks = opts.inputDelayTicks ?? LOCKSTEP_INPUT_DELAY_TICKS;
    this.netcodeMode = opts.netcodeMode ?? 'lockstep';
  }
}

export class RelaySessionSettings {
  readonly modeId: GameMode;
  readonly playerCount: PlayerCount;
  readonly questLevel: QuestLevel | null;
  readonly preserveBugs: boolean;
  readonly tickRate: PositiveInt;
  readonly inputDelayTicks: NonNegativeInt;
  readonly rollbackMaxTicks: PositiveInt;
  readonly netcodeMode: NetcodeMode;

  constructor(opts: {
    modeId?: GameMode;
    playerCount?: PlayerCount;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    tickRate?: PositiveInt;
    inputDelayTicks?: NonNegativeInt;
    rollbackMaxTicks?: PositiveInt;
    netcodeMode?: NetcodeMode;
  } = {}) {
    this.modeId = opts.modeId ?? GameMode.DEMO;
    this.playerCount = opts.playerCount ?? 1;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.tickRate = opts.tickRate ?? RELAY_TICK_RATE;
    this.inputDelayTicks = opts.inputDelayTicks ?? RELAY_INPUT_DELAY_TICKS;
    this.rollbackMaxTicks = opts.rollbackMaxTicks ?? ROLLBACK_MAX_TICKS;
    this.netcodeMode = opts.netcodeMode ?? 'rollback';
  }
}

export function sessionSettingsFromHello(message: Hello): LockstepSessionSettings {
  return sessionSettingsForLockstep({ modeId: message.modeId, playerCount: message.playerCount, questLevel: message.questLevel, preserveBugs: message.preserveBugs, tickRate: message.tickRate, inputDelayTicks: message.inputDelayTicks });
}

export function sessionSettingsForLockstep(opts: { modeId: GameMode; playerCount: number; questLevel: QuestLevel | null; preserveBugs: boolean; tickRate?: number; inputDelayTicks?: number }): LockstepSessionSettings {
  const modeId = opts.modeId;
  let playerCount = opts.playerCount;
  const questLevel = opts.questLevel;
  const preserveBugs = opts.preserveBugs;
  let tickRate = opts.tickRate ?? LOCKSTEP_TICK_RATE;
  let inputDelayTicks = opts.inputDelayTicks ?? LOCKSTEP_INPUT_DELAY_TICKS;
  playerCount = Math.max(1, Math.min(4, playerCount));
  tickRate = Math.max(1, tickRate);
  inputDelayTicks = Math.max(0, inputDelayTicks);
  return new LockstepSessionSettings({ modeId: modeId, playerCount: playerCount, questLevel: questLevel, preserveBugs: preserveBugs, tickRate: tickRate, inputDelayTicks: inputDelayTicks });
}

export function sessionSettingsFromWelcome(message: Welcome): LockstepSessionSettings {
  return sessionSettingsForLockstep({ modeId: message.modeId, playerCount: message.playerCount, questLevel: message.questLevel, preserveBugs: message.preserveBugs, tickRate: message.tickRate, inputDelayTicks: message.inputDelayTicks });
}

export function welcomeFromSessionSettings(settings: LockstepSessionSettings, opts: { accepted: boolean; reason?: string; sessionId?: string; protocolVersion?: number; buildId?: string; slotIndex?: number; hostSlotIndex?: number; seed?: number; started?: boolean }): Welcome {
  const accepted = opts.accepted;
  const reason = opts.reason ?? '';
  const sessionId = opts.sessionId ?? '';
  const protocolVersion = opts.protocolVersion ?? LOCKSTEP_PROTOCOL_VERSION;
  const buildId = opts.buildId ?? '';
  const slotIndex = opts.slotIndex ?? -1;
  const hostSlotIndex = opts.hostSlotIndex ?? 0;
  const seed = opts.seed ?? 0;
  const started = opts.started ?? false;
  return new Welcome({ accepted: accepted, reason: reason, sessionId: sessionId, protocolVersion: protocolVersion, buildId: buildId, modeId: settings.modeId, playerCount: settings.playerCount, slotIndex: slotIndex, hostSlotIndex: hostSlotIndex, tickRate: settings.tickRate, inputDelayTicks: settings.inputDelayTicks, seed: seed, questLevel: settings.questLevel, preserveBugs: settings.preserveBugs, started: started });
}

export function sessionSettingsFromMatchStart(message: MatchStart, opts: { tickRate?: number; inputDelayTicks?: number } = {}): LockstepSessionSettings {
  const tickRate = opts.tickRate ?? LOCKSTEP_TICK_RATE;
  const inputDelayTicks = opts.inputDelayTicks ?? LOCKSTEP_INPUT_DELAY_TICKS;
  return sessionSettingsForLockstep({ modeId: message.modeId, playerCount: message.playerCount, questLevel: message.questLevel, preserveBugs: message.preserveBugs, tickRate: tickRate, inputDelayTicks: inputDelayTicks });
}

export function matchStartFromSessionSettings(settings: LockstepSessionSettings, opts: { sessionId: string; seed: number; startTick?: number; status?: GameStatusData | null }): MatchStart {
  const sessionId = opts.sessionId;
  const seed = opts.seed;
  const startTick = opts.startTick ?? 0;
  const status = opts.status ?? null;
  return new MatchStart({ sessionId: sessionId, modeId: settings.modeId, playerCount: settings.playerCount, seed: seed, startTick: startTick, questLevel: settings.questLevel, preserveBugs: settings.preserveBugs, status: status });
}

export function sessionSettingsForRelay(opts: { modeId: GameMode; playerCount: number; questLevel: QuestLevel | null; preserveBugs: boolean; tickRate?: number; inputDelayTicks?: number; rollbackMaxTicks?: number; netcodeMode?: NetcodeMode }): RelaySessionSettings {
  const modeId = opts.modeId;
  let playerCount = opts.playerCount;
  const questLevel = opts.questLevel;
  const preserveBugs = opts.preserveBugs;
  let tickRate = opts.tickRate ?? RELAY_TICK_RATE;
  let inputDelayTicks = opts.inputDelayTicks ?? RELAY_INPUT_DELAY_TICKS;
  let rollbackMaxTicks = opts.rollbackMaxTicks ?? ROLLBACK_MAX_TICKS;
  const netcodeMode = opts.netcodeMode ?? 'rollback';
  playerCount = Math.max(1, Math.min(4, playerCount));
  tickRate = Math.max(1, tickRate);
  inputDelayTicks = Math.max(0, inputDelayTicks);
  rollbackMaxTicks = Math.max(1, rollbackMaxTicks);
  return new RelaySessionSettings({ modeId: modeId, playerCount: playerCount, questLevel: questLevel, preserveBugs: preserveBugs, tickRate: tickRate, inputDelayTicks: inputDelayTicks, rollbackMaxTicks: rollbackMaxTicks, netcodeMode: netcodeMode });
}

export function sessionSettingsFromRoomCreate(message: RoomCreate): RelaySessionSettings {
  return sessionSettingsForRelay({ modeId: message.modeId, playerCount: message.playerCount, questLevel: message.questLevel, preserveBugs: message.preserveBugs, tickRate: message.tickRate, inputDelayTicks: message.inputDelayTicks, rollbackMaxTicks: message.rollbackMaxTicks, netcodeMode: message.netcodeMode });
}

export function helloFromSessionSettings(settings: LockstepSessionSettings, opts: { protocolVersion: number; buildId: string; host: boolean }): Hello {
  const protocolVersion = opts.protocolVersion;
  const buildId = opts.buildId;
  const host = opts.host;
  return new Hello({ protocolVersion: protocolVersion, buildId: buildId, modeId: settings.modeId, playerCount: settings.playerCount, tickRate: settings.tickRate, inputDelayTicks: settings.inputDelayTicks, questLevel: settings.questLevel, preserveBugs: settings.preserveBugs, host: host });
}

export function roomCreateFromSessionSettings(settings: RelaySessionSettings, opts: { status?: GameStatusData | null } = {}): RoomCreate {
  const status = opts.status ?? null;
  return new RoomCreate({ modeId: settings.modeId, playerCount: settings.playerCount, questLevel: settings.questLevel, preserveBugs: settings.preserveBugs, tickRate: settings.tickRate, inputDelayTicks: settings.inputDelayTicks, rollbackMaxTicks: settings.rollbackMaxTicks, netcodeMode: settings.netcodeMode, status: status });
}

export function roomStateFromSessionSettings(settings: RelaySessionSettings, opts: { roomCode: RoomCode; sessionId: string; slots: RelaySlot[]; allReady: boolean; started: boolean }): RoomState {
  const roomCode = opts.roomCode;
  const sessionId = opts.sessionId;
  const slots = opts.slots;
  const allReady = opts.allReady;
  const started = opts.started;
  return new RoomState({ roomCode: roomCode, sessionId: sessionId, modeId: settings.modeId, playerCount: settings.playerCount, questLevel: settings.questLevel, preserveBugs: settings.preserveBugs, tickRate: settings.tickRate, inputDelayTicks: settings.inputDelayTicks, rollbackMaxTicks: settings.rollbackMaxTicks, netcodeMode: settings.netcodeMode, slots: slots, allReady: allReady, started: started });
}

export function roomStartFromSessionSettings(settings: RelaySessionSettings, opts: { roomCode: RoomCode; sessionId: string; seed: number; startTick: number; slotIndex: number; hostSlotIndex: number; reconnectToken: string; status?: GameStatusData | null }): RoomStart {
  const roomCode = opts.roomCode;
  const sessionId = opts.sessionId;
  const seed = opts.seed;
  const startTick = opts.startTick;
  const slotIndex = opts.slotIndex;
  const hostSlotIndex = opts.hostSlotIndex;
  const reconnectToken = opts.reconnectToken;
  const status = opts.status ?? null;
  return new RoomStart({ roomCode: roomCode, sessionId: sessionId, seed: seed, startTick: startTick, modeId: settings.modeId, playerCount: settings.playerCount, questLevel: settings.questLevel, preserveBugs: settings.preserveBugs, tickRate: settings.tickRate, inputDelayTicks: settings.inputDelayTicks, rollbackMaxTicks: settings.rollbackMaxTicks, netcodeMode: settings.netcodeMode, slotIndex: slotIndex, hostSlotIndex: hostSlotIndex, reconnectToken: reconnectToken, status: status });
}
