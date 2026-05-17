// Port of crimson/net/rollback_runtime.py

import type { GameMode } from '@crimson/game-modes.ts';
import type { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import type { PackedPlayerInput } from '@crimson/replay/types.ts';
import { lanDebugLog } from '@crimson/net/debug-log.ts';
import { TickFrame } from '@crimson/net/lockstep-protocol.ts';
import type { NetcodeMode, NetMessage } from '@crimson/net/relay-protocol.ts';
import { DEFAULT_PORT, INPUT_DELAY_TICKS, LINK_TIMEOUT_MS, PING_INTERVAL_MS, PROTOCOL_VERSION, RECONNECT_TIMEOUT_MS, ROLLBACK_MAX_TICKS, ClientHello, ClientWelcome, PeerDisconnect, Ping, Pong, RbInputBatch, RbResyncBegin, RbResyncChunk, RbResyncCommit, RbResyncRequest, RelayError, RoomJoin, RoomReady, RoomStart, RoomState, currentBuildId } from '@crimson/net/relay-protocol.ts';
import { RelayReliableLink } from '@crimson/net/relay-reliable.ts';
import type { PeerAddr } from '@crimson/net/relay-transport.ts';
import { RelayUdpTransport } from '@crimson/net/relay-transport.ts';
import { RollbackController } from '@crimson/net/rollback.ts';
import { RbResyncAssemblerV5, RollbackResyncV5Error, buildRbResyncMessages, decodeModeSnapshot } from '@crimson/net/rollback-resync-v5.ts';
import type { RoomCode } from '@crimson/net/room-code.ts';
import { roomCreateFromSessionSettings, sessionSettingsForRelay } from '@crimson/net/session-settings.ts';

export type RollbackRuntimeConfig = HostRollbackRuntimeConfig | JoinRollbackRuntimeConfig;
type ReconnectState = "idle" | "waiting_for_peer_reconnect" | "self_reconnecting";

function bytesFrom(data: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

function mapMoveToEnd<K, V>(map: Map<K, V>, key: K, last = true): void {
  if (!map.has(key)) {
    return;
  }
  const value = map.get(key)!;
  map.delete(key);
  if (last) {
    map.set(key, value);
    return;
  }
  const entries = Array.from(map.entries());
  map.clear();
  map.set(key, value);
  for (const [entryKey, entryValue] of entries) {
    map.set(entryKey, entryValue);
  }
}

export class RollbackRuntimeConfigBase {
  modeId: GameMode;
  playerCount: number;
  relayHost: string;
  relayPort: number;
  roomCode: RoomCode | null;
  questLevel: QuestLevel | null;
  preserveBugs: boolean;
  netcodeMode: NetcodeMode;
  tickRate: number;
  inputDelayTicks: number;
  rollbackMaxTicks: number;
  reconnectTimeoutMs: number;
  simStatus: GameStatusData | null;

  constructor(opts: {
    modeId: GameMode;
    playerCount: number;
    relayHost: string;
    relayPort?: number;
    roomCode?: RoomCode | null;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    netcodeMode?: NetcodeMode;
    tickRate?: number;
    inputDelayTicks?: number;
    rollbackMaxTicks?: number;
    reconnectTimeoutMs?: number;
    simStatus?: GameStatusData | null;
  }) {
    this.modeId = opts.modeId;
    this.playerCount = opts.playerCount;
    this.relayHost = opts.relayHost;
    this.relayPort = opts.relayPort ?? DEFAULT_PORT;
    this.roomCode = opts.roomCode ?? null;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.netcodeMode = opts.netcodeMode ?? 'rollback';
    this.tickRate = opts.tickRate ?? 60;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.rollbackMaxTicks = opts.rollbackMaxTicks ?? ROLLBACK_MAX_TICKS;
    this.reconnectTimeoutMs = opts.reconnectTimeoutMs ?? RECONNECT_TIMEOUT_MS;
    this.simStatus = opts.simStatus ?? null;
  }
}

export class RollbackRuntime {
  cfg: RollbackRuntimeConfig;
  buildId: string;
  transport: RelayUdpTransport;
  link: RelayReliableLink;
  started: boolean;
  error: string;
  lobbyStateLatest: RoomState | null;
  matchStartEvent: RoomStart | null;
  _serverAddr: PeerAddr | null;
  _peerId: string;
  _accepted: boolean;
  _createdRoom: boolean;
  _sentJoinRequest: boolean;
  _joinedRoom: boolean;
  _sentReady: boolean;
  _lastHelloMs: number;
  _lastSeenMs: number;
  _lastSendMs: number;
  _lastPingMs: number;
  _reconnectToken: string;
  _pausedForReconnect: boolean;
  _announcedRoomCode: RoomCode | null;
  _reconnectState: ReconnectState;
  _rollback: RollbackController | null;
  _frameQueue: TickFrame[];
  _remoteSeenSlots: Set<number>;
  _pendingRollbackFrom: number | null;
  _localSnapshotBlobs: Map<number, Uint8Array>;
  _pendingResyncSnapshot: [number, Uint8Array] | null;
  _pendingResyncSnapshotDelivered: boolean;
  _resyncAssembler: RbResyncAssemblerV5 | null;
  _activeResyncRequestId: string;
  _handledResyncRequestIds: Set<string>;
  desyncCount: number;
  lastDesyncTick: number;
  lastDesyncKind: string;
  lastDesyncExpected: string;
  lastDesyncActual: string;
  rollbackCount: number;
  predictionMismatches: number;
  maxRollbackTicksSeen: number;
  resyncCount: number;
  reconnectCount: number;
  _reconnectDeadlineMs: number;
  _neutralInput: PackedPlayerInput;

  constructor(opts: {
    cfg: RollbackRuntimeConfig;
    buildId?: string;
    transport?: RelayUdpTransport;
    link?: RelayReliableLink;
    started?: boolean;
    error?: string;
    lobbyStateLatest?: RoomState | null;
    matchStartEvent?: RoomStart | null;
    _serverAddr?: PeerAddr | null;
    _peerId?: string;
    _accepted?: boolean;
    _createdRoom?: boolean;
    _sentJoinRequest?: boolean;
    _joinedRoom?: boolean;
    _sentReady?: boolean;
    _lastHelloMs?: number;
    _lastSeenMs?: number;
    _lastSendMs?: number;
    _lastPingMs?: number;
    _reconnectToken?: string;
    _pausedForReconnect?: boolean;
    _announcedRoomCode?: RoomCode | null;
    _reconnectState?: ReconnectState;
    _rollback?: RollbackController | null;
    _frameQueue?: TickFrame[];
    _remoteSeenSlots?: Set<number>;
    _pendingRollbackFrom?: number | null;
    _localSnapshotBlobs?: Map<number, Uint8Array>;
    _pendingResyncSnapshot?: [number, Uint8Array] | null;
    _pendingResyncSnapshotDelivered?: boolean;
    _resyncAssembler?: RbResyncAssemblerV5 | null;
    _activeResyncRequestId?: string;
    _handledResyncRequestIds?: Set<string>;
    desyncCount?: number;
    lastDesyncTick?: number;
    lastDesyncKind?: string;
    lastDesyncExpected?: string;
    lastDesyncActual?: string;
    rollbackCount?: number;
    predictionMismatches?: number;
    maxRollbackTicksSeen?: number;
    resyncCount?: number;
    reconnectCount?: number;
    _reconnectDeadlineMs?: number;
    _neutralInput?: PackedPlayerInput;
  }) {
    this.cfg = opts.cfg;
    this.buildId = opts.buildId ?? currentBuildId();
    this.link = opts.link ?? new RelayReliableLink();
    this.started = opts.started ?? false;
    this.error = opts.error ?? '';
    this.lobbyStateLatest = opts.lobbyStateLatest ?? null;
    this.matchStartEvent = opts.matchStartEvent ?? null;
    this._serverAddr = opts._serverAddr ?? null;
    this._peerId = opts._peerId ?? '';
    this._accepted = opts._accepted ?? false;
    this._createdRoom = opts._createdRoom ?? false;
    this._sentJoinRequest = opts._sentJoinRequest ?? false;
    this._joinedRoom = opts._joinedRoom ?? false;
    this._sentReady = opts._sentReady ?? false;
    this._lastHelloMs = opts._lastHelloMs ?? 0;
    this._lastSeenMs = opts._lastSeenMs ?? 0;
    this._lastSendMs = opts._lastSendMs ?? 0;
    this._lastPingMs = opts._lastPingMs ?? 0;
    this._reconnectToken = opts._reconnectToken ?? '';
    this._pausedForReconnect = opts._pausedForReconnect ?? false;
    this._announcedRoomCode = opts._announcedRoomCode ?? null;
    this._reconnectState = opts._reconnectState ?? 'idle';
    this._rollback = opts._rollback ?? null;
    this._frameQueue = opts._frameQueue ?? [];
    this._remoteSeenSlots = opts._remoteSeenSlots ?? new Set();
    this._pendingRollbackFrom = opts._pendingRollbackFrom ?? null;
    this._localSnapshotBlobs = opts._localSnapshotBlobs ?? new Map();
    this._pendingResyncSnapshot = opts._pendingResyncSnapshot ?? null;
    this._pendingResyncSnapshotDelivered = opts._pendingResyncSnapshotDelivered ?? false;
    this._resyncAssembler = opts._resyncAssembler ?? null;
    this._activeResyncRequestId = opts._activeResyncRequestId ?? '';
    this._handledResyncRequestIds = opts._handledResyncRequestIds ?? new Set();
    this.desyncCount = opts.desyncCount ?? 0;
    this.lastDesyncTick = opts.lastDesyncTick ?? -1;
    this.lastDesyncKind = opts.lastDesyncKind ?? '';
    this.lastDesyncExpected = opts.lastDesyncExpected ?? '';
    this.lastDesyncActual = opts.lastDesyncActual ?? '';
    this.rollbackCount = opts.rollbackCount ?? 0;
    this.predictionMismatches = opts.predictionMismatches ?? 0;
    this.maxRollbackTicksSeen = opts.maxRollbackTicksSeen ?? 0;
    this.resyncCount = opts.resyncCount ?? 0;
    this.reconnectCount = opts.reconnectCount ?? 0;
    this._reconnectDeadlineMs = opts._reconnectDeadlineMs ?? 0;
    this._neutralInput = opts._neutralInput ?? [0.0, 0.0, 0.0, 0.0, 0];
    this.transport = new RelayUdpTransport({ bindHost: '0.0.0.0', bindPort: 0 });
  }

  get localSlotIndex(): number {
    const event = this.matchStartEvent;
    if (event === null) {
      return String(this.cfg.role) === 'host' ? 0 : -1;
    }
    return int(event.slotIndex);
  }

  open(): void {
    if (this._serverAddr !== null) {
      return;
    }
    const hostRaw = (String(this.cfg.relayHost)).trim();
    let host = hostRaw;
    if (hostRaw) {
      try {
        host = String(hostRaw);
      } catch (exc) {
        host = hostRaw;
      }
    }
    this._serverAddr = [host, int(this.cfg.relayPort)];
    this.transport.open();
    this._lastSeenMs = _nowMs();
  }

  close(): void {
    this.transport.close();
    this._serverAddr = null;
    this._peerId = '';
    this._accepted = false;
    this._createdRoom = false;
    this._sentJoinRequest = false;
    this._joinedRoom = false;
    this._sentReady = false;
    this._lastHelloMs = 0;
    this._lastSeenMs = 0;
    this._lastSendMs = 0;
    this._lastPingMs = 0;
    this._reconnectToken = '';
    this._pausedForReconnect = false;
    this._reconnectState = 'idle';
    this._announcedRoomCode = null;
    this._rollback = null;
    this._frameQueue.length = 0;
    this._remoteSeenSlots.clear();
    this._pendingRollbackFrom = null;
    this._localSnapshotBlobs.clear();
    this._pendingResyncSnapshot = null;
    this._pendingResyncSnapshotDelivered = false;
    this._resyncAssembler = null;
    this._activeResyncRequestId = '';
    this._handledResyncRequestIds.clear();
    this.started = false;
    this.error = '';
  }

  lobbyState(): RoomState | null {
    return this.lobbyStateLatest;
  }

  matchStart(): RoomStart | null {
    return this.matchStartEvent;
  }

  debugOverlayLines(): string[] {
    const mode = String(this.cfg.netcodeMode);
    const lines = [`net(${mode}): room=${String(this.cfg.roomCode || '?')} slot=${int(this.localSlotIndex)} started=${(this.started ? 1 : 0)}`, `rb: rollbacks=${int(this.rollbackCount)} mismatch=${int(this.predictionMismatches)} max=${int(this.maxRollbackTicksSeen)} resync=${int(this.resyncCount)} reconnect=${int(this.reconnectCount)} paused=${(this._pausedForReconnect ? 1 : 0)}`];
    if (this.error) {
      lines.push(`net: error=${this.error}`);
    }
    return lines;
  }

  hostRemoteInputsReady(): boolean {
    if (this._pausedForReconnect) {
      return false;
    }
    if (String(this.cfg.role) !== 'host') {
      return true;
    }
    const event = this.matchStartEvent;
    if (event === null) {
      return false;
    }
    for (let slot = 1; slot < int(event.playerCount); slot++) {
      if (!(this._remoteSeenSlots as ReadonlySet<unknown>).has(int(slot))) {
        return false;
      }
    }
    return true;
  }

  storeLocalSnapshot(opts: { tickIndex: number; snapshotBlob: Uint8Array }): void;
  storeLocalSnapshot(tickIndex: number, snapshotBlob: Uint8Array): void;
  storeLocalSnapshot(tickIndexOrOpts: number | { tickIndex: number; snapshotBlob: Uint8Array }, snapshotBlobArg: Uint8Array | undefined = undefined): void {
    const tickIndex: number = typeof tickIndexOrOpts === 'object' && tickIndexOrOpts !== null && 'tickIndex' in tickIndexOrOpts ? tickIndexOrOpts.tickIndex : tickIndexOrOpts as number;
    const snapshotBlob: Uint8Array = typeof tickIndexOrOpts === 'object' && tickIndexOrOpts !== null && 'tickIndex' in tickIndexOrOpts ? tickIndexOrOpts.snapshotBlob : snapshotBlobArg as Uint8Array;
    const tick = Math.max(0, int(tickIndex));
    const blob = bytesFrom(snapshotBlob);
    this._localSnapshotBlobs.set(tick, blob);
    mapMoveToEnd(this._localSnapshotBlobs, tick, true);

    const keepFrom = int(tick) - 64;
    for (const key of Array.from(this._localSnapshotBlobs.keys())) {
      if (int(key) >= int(keepFrom)) {
        continue;
      }
      this._localSnapshotBlobs.delete(int(key));
    }
  }

  popRollbackFrom(): number | null {
    const value = this._pendingRollbackFrom;
    this._pendingRollbackFrom = null;
    return value === null ? null : int(value);
  }

  popResyncSnapshot(): [number, Uint8Array] | null {
    const snapshot = this._pendingResyncSnapshot;
    if (snapshot === null) {
      return null;
    }
    if (this._pendingResyncSnapshotDelivered) {
      return null;
    }
    this._pendingResyncSnapshotDelivered = true;
    return [int(snapshot[0]), bytesFrom(snapshot[1])];
  }

  markResyncApplied(opts: { tickIndex: number }): void;
  markResyncApplied(tickIndex: number): void;
  markResyncApplied(tickIndexOrOpts: number | { tickIndex: number }): void {
    const tickIndex: number = typeof tickIndexOrOpts === 'object' && tickIndexOrOpts !== null && 'tickIndex' in tickIndexOrOpts ? tickIndexOrOpts.tickIndex : tickIndexOrOpts as number;
    const tick = Math.max(0, int(tickIndex));
    this._pendingResyncSnapshot = null;
    this._pendingResyncSnapshotDelivered = false;
    this._activeResyncRequestId = '';
    const controller = this._rollback;
    if (controller !== null) {
      controller.resetToTick(int(tick) + 1);
    }
    this._frameQueue.length = 0;
    this._pausedForReconnect = false;
    if (this._reconnectState !== 'self_reconnecting') {
      this._reconnectState = 'idle';
    }
    lanDebugLog(
      'resync_commit_applied',
      { role: String(this.cfg.role), roomCode: String(this.cfg.roomCode || ''), tickIndex: int(tick) },
    );
  }

  queueLocalInput(packedInput: PackedPlayerInput, opts: { nowMs?: number | null } = {}): void {
    const nowMs = opts.nowMs ?? null;
    if (this._pausedForReconnect) {
      return;
    }
    const controller = this._rollback;
    if (controller === null) {
      return;
    }
    const batch = controller.queueLocalInput(Array.from(packedInput));
    this._syncRollbackMetrics(controller);
    this._send(batch, { reliable: false, nowMs: nowMs === null ? _nowMs() : int(nowMs) });
    this._drainFrames();
  }

  popTickFrame(): TickFrame | null {
    if (this._pausedForReconnect) {
      return null;
    }
    if (this._frameQueue.length === 0) {
      return null;
    }
    return this._frameQueue.shift()!;
  }

  noteDesync(opts: { kind: string; tickIndex: number; expected: string; actual: string }): void {
    const kind = opts.kind;
    const tickIndex = opts.tickIndex;
    const expected = opts.expected;
    const actual = opts.actual;
    this.desyncCount = int(this.desyncCount) + 1;
    this.lastDesyncTick = int(tickIndex);
    this.lastDesyncKind = kind;
    this.lastDesyncExpected = expected;
    this.lastDesyncActual = actual;
  }

  update(opts: { nowMs?: number | null } = {}): void {
    let nowMs = opts.nowMs ?? null;
    if (nowMs === null) {
      nowMs = _nowMs();
    }
    const now = int(nowMs);
    if (this._serverAddr === null) {
      return;
    }
    if (this.error) {
      return;
    }

    this._sendHelloIfNeeded({ nowMs: int(now) });

    for (let [addr, packet] of this.transport.recvPackets({ maxPackets: 512 })) {
      if (addr !== this._serverAddr) {
        continue;
      }
      this._lastSeenMs = int(now);
      const [messages, dup] = this.link.ingestPacket(packet, { nowMs: int(now) });
      for (const message of messages) {
        this._handleMessage({ message: message, nowMs: int(now) });
      }
    }

    for (const packet of this.link.pollResends({ nowMs: int(now) })) {
      try {
        this.transport.sendPacket(this._serverAddr, packet);
      } catch (exc) {
        continue;
      }
      this._lastSendMs = int(now);
    }

    if (this._accepted && this._joinedRoom && !this.started) {
      if (!this._sentReady) {
        this._send(new RoomReady({ slotIndex: Math.max(0, int(this.localSlotIndex)), ready: true }), { reliable: true, nowMs: int(now) });
        this._sentReady = true;
      }
    }

    if (this._accepted) {
      if (this._lastPingMs <= 0 || (int(now) - int(this._lastPingMs)) >= int(PING_INTERVAL_MS)) {
        this._send(new Ping({ stampMs: int(now) }), { reliable: false, nowMs: int(now) });
        this._lastPingMs = int(now);
      }
    }

    const silentMs = int(now) - int(this._lastSeenMs);
    if (this._lastSeenMs > 0 && silentMs >= int(LINK_TIMEOUT_MS)) {
      if (this._canSelfReconnect()) {
        this._startSelfReconnect({ nowMs: int(now), reason: 'timeout' });
      } else if (!this._pausedForReconnect) {
        this.error = 'timeout';
      }
    }

    if (this._reconnectDeadlineMs > 0 && int(now) >= int(this._reconnectDeadlineMs)) {
      this.error = 'reconnect_timeout';
      lanDebugLog(
        'reconnect_fail',
        { role: String(this.cfg.role), roomCode: String(this.cfg.roomCode || ''), state: String(this._reconnectState), reason: 'deadline' },
      );
    }

    this._drainFrames();
  }

  _sendHelloIfNeeded(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    if (this._accepted) {
      if (this._joinedRoom) {
        return;
      }

      const reconnecting = this._reconnectToken.length > 0 && String(this._reconnectState) === 'self_reconnecting';
      if (reconnecting) {
        if (this._sentJoinRequest) {
          return;
        }
        this._sentJoinRequest = true;
        this._send(
          new RoomJoin({ roomCode: this.cfg.roomCode, reconnectToken: String(this._reconnectToken) }),
          { reliable: true, nowMs: int(nowMs) },
        );
        return;
      }

      if (String(this.cfg.role) === 'host' && !this._createdRoom) {
        this._createdRoom = true;
        const settings = sessionSettingsForRelay({ modeId: this.cfg.modeId, playerCount: int(this.cfg.playerCount), questLevel: this.cfg.questLevel, preserveBugs: Boolean(this.cfg.preserveBugs), tickRate: int(this.cfg.tickRate), inputDelayTicks: int(this.cfg.inputDelayTicks), rollbackMaxTicks: int(this.cfg.rollbackMaxTicks), netcodeMode: this.cfg.netcodeMode });
        this._send(
          roomCreateFromSessionSettings(settings, { status: this.cfg.simStatus }),
          { reliable: true, nowMs: int(nowMs) },
        );
        return;
      }
      if (String(this.cfg.role) !== 'host') {
        if (this._sentJoinRequest) {
          return;
        }
        this._sentJoinRequest = true;
        this._send(
          new RoomJoin({ roomCode: this.cfg.roomCode, reconnectToken: '' }),
          { reliable: true, nowMs: int(nowMs) },
        );
        return;
      }
      return;
    }

    if ((int(nowMs) - int(this._lastHelloMs)) < 200) {
      return;
    }
    this._lastHelloMs = int(nowMs);
    this._send(
      new ClientHello({ protocolVersion: int(PROTOCOL_VERSION), buildId: String(this.buildId), peerName: '' }),
      { reliable: true, nowMs: int(nowMs) },
    );
  }

  _handleMessage(opts: { message: NetMessage; nowMs: number }): void {
    const message = opts.message;
    const nowMs = opts.nowMs;
    lanDebugLog(
      'net_recv',
      { role: String(this.cfg.role), kind: ((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(message), roomCode: String(this.cfg.roomCode || '') },
    );
    if (message instanceof Pong) {
      return;
    } else if (message instanceof ClientWelcome) {
      if (!Boolean(message.accepted)) {
        this.error = String(message.reason || 'rejected');
        return;
      }
      this._accepted = true;
      this._peerId = String(message.peerId || '');
      if (String(this._reconnectState) === 'self_reconnecting') {
        this._sentJoinRequest = false;
      }
      return;
    } else if (message instanceof RelayError) {
      this.error = String(message.reason || 'relay_error');
      return;
    } else if (message instanceof RoomState) {
      this.lobbyStateLatest = message;
      this._joinedRoom = true;
      if (this._isReconnectInProgress() && this._roomStateHasLocalSlot(message)) {
        this._finishReconnect({ nowMs: int(nowMs) });
      }
      if (String(this.cfg.role) === 'host') {
        this.cfg.roomCode = message.roomCode;
        this._announceRoomCode(this.cfg.roomCode);
      } else if (this.cfg.roomCode !== message.roomCode) {
        this.cfg.roomCode = message.roomCode;
      }
      return;
    } else if (message instanceof RoomStart) {
      const firstStart = !this.started;
      this.matchStartEvent = message;
      this.started = true;
      this._reconnectDeadlineMs = 0;
      this._reconnectToken = String(message.reconnectToken || '');
      this._pausedForReconnect = false;
      this._reconnectState = 'idle';
      if (firstStart) {
        this._initRollback(message);
      }
      this._sentReady = true;
      if (this.cfg.roomCode !== message.roomCode) {
        this.cfg.roomCode = message.roomCode;
      }
      if (String(this.cfg.role) === 'host') {
        this._announceRoomCode(this.cfg.roomCode);
      }
      return;
    } else if (message instanceof PeerDisconnect) {
      if (!this.started) {
        this.error = String(message.reason || 'peer_disconnect');
        return;
      }
      if (this._reconnectDeadlineMs <= 0) {
        this.reconnectCount = int(this.reconnectCount) + 1;
      }
      this._reconnectDeadlineMs = int(nowMs) + int(this.cfg.reconnectTimeoutMs);
      this._pausedForReconnect = true;
      this._reconnectState = 'waiting_for_peer_reconnect';
      lanDebugLog(
        'reconnect_start',
        { role: String(this.cfg.role), roomCode: String(this.cfg.roomCode || ''), state: String(this._reconnectState), reason: String(message.reason || 'peer_disconnect') },
      );
      return;
    } else if (message instanceof RbInputBatch) {
      const controller = this._rollback;
      if (controller === null) {
        return;
      }
      const slot = int(message.slotIndex);
      if (int(slot) !== int(controller.localSlotIndex)) {
        this._remoteSeenSlots.add(int(slot));
      }
      controller.ingestRemoteSamples({ slotIndex: int(slot), samples: Array.from(message.samples) });
      this._syncRollbackMetrics(controller);

      const rollbackFrom = controller.drainRollbackFrom();
      if (rollbackFrom !== null) {
        this._applyRollbackFrom({ controller: controller, fromTick: int(rollbackFrom), nowMs: int(nowMs) });
      }

      const resyncFrom = controller.drainResyncFrom();
      if (resyncFrom !== null) {
        this._sendResyncRequest({
          fromTick: int(resyncFrom),
          reason: 'rollback_window_overflow',
          nowMs: int(nowMs),
        });
      }
      return;
    } else if (message instanceof RbResyncRequest) {
      this._handleResyncRequest({ message: message, nowMs: int(nowMs) });
      return;
    } else if (message instanceof RbResyncBegin) {
      this._handleResyncBegin({ message: message });
      return;
    } else if (message instanceof RbResyncChunk) {
      this._handleResyncChunk({ message: message });
      return;
    } else if (message instanceof RbResyncCommit) {
      this._handleResyncCommit({ message: message, nowMs: int(nowMs) });
      return;
    } else {
      return;
    }
  }

  _initRollback(event: RoomStart): void {
    this._frameQueue.length = 0;
    this._remoteSeenSlots.clear();
    this._pendingRollbackFrom = null;
    this._localSnapshotBlobs.clear();
    this._pendingResyncSnapshot = null;
    this._pendingResyncSnapshotDelivered = false;
    this._resyncAssembler = null;
    this._activeResyncRequestId = '';
    this._rollback = new RollbackController({ playerCount: Math.max(1, int(event.playerCount)), localSlotIndex: Math.max(0, int(event.slotIndex)), inputDelayTicks: Math.max(0, int(event.inputDelayTicks)), maxRollbackTicks: Math.max(1, int(event.rollbackMaxTicks)) });

    // Prime initial delay ticks with neutral inputs.
    const delay = Math.max(0, int(event.inputDelayTicks));
    const playerCount = Math.max(1, int(event.playerCount));
    for (let tick = 0; tick < delay; tick++) {
      for (let slot = 0; slot < playerCount; slot++) {
        mapGetOrThrow(this._rollback._knownBySlot, int(slot)).set(int(tick), Array.from(this._neutralInput));
      }
    }
  }

  _drainFrames(): void {
    if (this._pausedForReconnect) {
      return;
    }
    const controller = this._rollback;
    if (controller === null) {
      return;
    }
    while (true) {
      const frame = controller.popFrame();
      if (frame === null) {
        break;
      }
      this._frameQueue.push(new TickFrame({ tickIndex: int(frame.tickIndex), frameInputs: Array.from(frame.frameInputs).map((item) => Array.from(item)), commands: [] }));
    }
  }

  _syncRollbackMetrics(controller: RollbackController): void {
    this.rollbackCount = int(controller.rollbackCount);
    this.predictionMismatches = int(controller.predictionMismatches);
    this.maxRollbackTicksSeen = int(controller.maxRollbackDistance);
  }

  _applyRollbackFrom(opts: { controller: RollbackController; fromTick: number; nowMs: number }): void {
    const controller = opts.controller;
    const fromTick = opts.fromTick;
    const nowMs = opts.nowMs;
    const tick = Math.max(0, int(fromTick));
    const pending = this._pendingRollbackFrom;
    if (pending === null) {
      this._pendingRollbackFrom = int(tick);
    } else {
      this._pendingRollbackFrom = Math.min(int(pending), int(tick));
    }

    const snapshotTick = int(tick) - 1;
    if (this._latestSnapshotAtOrBefore(snapshotTick) === null) {
      this._sendResyncRequest({ fromTick: int(tick), reason: 'rollback_snapshot_missing', nowMs: int(nowMs) });
      return;
    }

    const rebuilt = controller.rebuildEmittedFrom(int(tick));
    if (rebuilt) {
      const rebuiltQueue = this._frameQueue.filter((frame) => int(frame.tickIndex) < int(tick));
      for (const frame of rebuilt) {
        rebuiltQueue.push(new TickFrame({ tickIndex: int(frame.tickIndex), frameInputs: Array.from(frame.frameInputs).map((item) => Array.from(item)), commands: [] }));
      }
      this._frameQueue = rebuiltQueue;
    }

    lanDebugLog(
      'rollback_applied',
      { role: String(this.cfg.role), roomCode: String(this.cfg.roomCode || ''), fromTick: int(tick), rebuiltFrames: rebuilt.length },
    );
  }

  _sendResyncRequest(opts: { fromTick: number; reason: string; nowMs: number }): void {
    const fromTick = opts.fromTick;
    const reason = opts.reason;
    const nowMs = opts.nowMs;
    const requestId = globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    this.resyncCount = int(this.resyncCount) + 1;
    this._pausedForReconnect = true;
    this._activeResyncRequestId = String(requestId);
    this._send(
      new RbResyncRequest({ requestId: String(requestId), fromTick: Math.max(0, int(fromTick)), reason: reason, requestedBySlot: Math.max(0, int(this.localSlotIndex)) }),
      { reliable: true, nowMs: int(nowMs) },
    );
    lanDebugLog(
      'resync_request_sent',
      { role: String(this.cfg.role), roomCode: String(this.cfg.roomCode || ''), requestId: String(requestId), fromTick: Math.max(0, int(fromTick)), reason: reason },
    );
  }

  _handleResyncRequest(opts: { message: RbResyncRequest; nowMs: number }): void {
    const message = opts.message;
    const nowMs = opts.nowMs;
    if (!this._isHostSlot()) {
      return;
    }

    let requestId = (String(message.requestId || '')).trim();
    if (!requestId) {
      requestId = globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    }
    if ((this._handledResyncRequestIds as ReadonlySet<unknown>).has(requestId)) {
      return;
    }
    this._handledResyncRequestIds.add(requestId);

    const snapshot = this._latestSnapshotAny();
    if (snapshot === null) {
      this._send(new RelayError({ reason: 'resync_snapshot_unavailable' }), { reliable: true, nowMs: int(nowMs) });
      return;
    }
    const [snapshotTick, payload] = snapshot;

    let stream: ReturnType<typeof buildRbResyncMessages>;
    try {
      stream = buildRbResyncMessages({ requestId: requestId, snapshotTick: int(snapshotTick), snapshotBlob: bytesFrom(payload) });
    } catch (exc) {
      if (!(exc instanceof RollbackResyncV5Error)) {
        throw exc;
      }
      this._send(new RelayError({ reason: 'resync_snapshot_invalid' }), { reliable: true, nowMs: int(nowMs) });
      return;
    }

    this._send(stream.begin, { reliable: true, nowMs: int(nowMs) });
    for (const chunk of stream.chunks) {
      this._send(chunk, { reliable: true, nowMs: int(nowMs) });
    }
    this._send(stream.commit, { reliable: true, nowMs: int(nowMs) });
  }

  _handleResyncBegin(opts: { message: RbResyncBegin }): void {
    const message = opts.message;
    const requestId = String(message.requestId || '');
    if (!requestId) {
      return;
    }
    if (this._activeResyncRequestId && requestId !== String(this._activeResyncRequestId)) {
      return;
    }

    const assembler = new RbResyncAssemblerV5();
    try {
      assembler.begin(message);
    } catch (exc) {
      if (!(exc instanceof RollbackResyncV5Error)) {
        throw exc;
      }
      return;
    }
    this._resyncAssembler = assembler;
    this._activeResyncRequestId = String(requestId);
    this._pausedForReconnect = true;
    lanDebugLog(
      'resync_begin_recv',
      { role: String(this.cfg.role), roomCode: String(this.cfg.roomCode || ''), requestId: String(requestId), snapshotTick: int(message.snapshotTick), chunks: int(message.totalChunks) },
    );
  }

  _handleResyncChunk(opts: { message: RbResyncChunk }): void {
    const message = opts.message;
    const assembler = this._resyncAssembler;
    if (assembler === null) {
      return;
    }
    if ((String(message.requestId || '')) !== String(assembler.requestId)) {
      return;
    }
    try {
      assembler.pushChunk(message);
    } catch (exc) {
      if (!(exc instanceof RollbackResyncV5Error)) {
        throw exc;
      }
      this._resyncAssembler = null;
      this.error = 'resync_chunk_error';
    }
  }

  _handleResyncCommit(opts: { message: RbResyncCommit; nowMs: number }): void {
    const message = opts.message;
    const nowMs = opts.nowMs;
    const assembler = this._resyncAssembler;
    if (assembler === null) {
      return;
    }
    if ((String(message.requestId || '')) !== String(assembler.requestId)) {
      return;
    }

    let snapshotTick: ReturnType<typeof assembler.finalize>[0];
    let payload: ReturnType<typeof assembler.finalize>[1];
    try {
      [snapshotTick, payload] = assembler.finalize(message);
      decodeModeSnapshot(payload);
    } catch (exc) {
      if (!(exc instanceof RollbackResyncV5Error)) {
        throw exc;
      }
      this._resyncAssembler = null;
      this.error = 'resync_commit_error';
      return;
    }

    this._resyncAssembler = null;
    this._pendingResyncSnapshot = [int(snapshotTick), bytesFrom(payload)];
    this._pendingResyncSnapshotDelivered = false;
    this._pausedForReconnect = true;
    this._reconnectDeadlineMs = int(nowMs) + int(this.cfg.reconnectTimeoutMs);
  }

  _startSelfReconnect(opts: { nowMs: number; reason: string }): void {
    const nowMs = opts.nowMs;
    const reason = opts.reason;
    if (!this._canSelfReconnect()) {
      return;
    }
    if (String(this._reconnectState) === 'self_reconnecting') {
      return;
    }

    this.reconnectCount = int(this.reconnectCount) + 1;
    this._pausedForReconnect = true;
    this._reconnectState = 'self_reconnecting';
    this._reconnectDeadlineMs = int(nowMs) + int(this.cfg.reconnectTimeoutMs);

    this._accepted = false;
    this._joinedRoom = false;
    this._createdRoom = false;
    this._sentJoinRequest = false;
    this._sentReady = false;
    this._peerId = '';
    this._lastHelloMs = 0;
    this._lastPingMs = 0;
    this.link = new RelayReliableLink();

    lanDebugLog(
      'reconnect_start',
      { role: String(this.cfg.role), roomCode: String(this.cfg.roomCode || ''), state: String(this._reconnectState), reason: reason },
    );
  }

  _finishReconnect(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._reconnectDeadlineMs = 0;
    this._pausedForReconnect = false;
    const previous = String(this._reconnectState);
    this._reconnectState = 'idle';
    lanDebugLog(
      'reconnect_success',
      { role: String(this.cfg.role), roomCode: String(this.cfg.roomCode || ''), previousState: previous, nowMs: int(nowMs) },
    );
  }

  _isReconnectInProgress(): boolean {
    return String(this._reconnectState) === 'waiting_for_peer_reconnect' || String(this._reconnectState) === 'self_reconnecting';
  }

  _canSelfReconnect(): boolean {
    return this.started && (((String(this._reconnectToken || '')).trim()).length > 0);
  }

  _roomStateHasLocalSlot(roomState: RoomState): boolean {
    const slotIndex = int(this.localSlotIndex);
    if (slotIndex < 0 || slotIndex >= roomState.slots.length) {
      return false;
    }
    const slot = roomState.slots[int(slotIndex)];
    return Boolean(slot.connected);
  }

  _isHostSlot(): boolean {
    const event = this.matchStartEvent;
    if (event === null) {
      return String(this.cfg.role) === 'host';
    }
    return int(event.slotIndex) === int(event.hostSlotIndex);
  }

  _latestSnapshotAny(): [number, Uint8Array] | null {
    if (this._localSnapshotBlobs.size === 0) {
      return null;
    }
    const tick = Array.from(this._localSnapshotBlobs.keys()).at(-1)!;
    const payload = this._localSnapshotBlobs.get(int(tick)) ?? null;
    if (payload === null) {
      return null;
    }
    return [int(tick), bytesFrom(payload)];
  }

  _latestSnapshotAtOrBefore(opts: { tickIndex: number }): [number, Uint8Array] | null;
  _latestSnapshotAtOrBefore(tickIndex: number): [number, Uint8Array] | null;
  _latestSnapshotAtOrBefore(tickIndexOrOpts: number | { tickIndex: number }): [number, Uint8Array] | null {
    const tickIndex: number = typeof tickIndexOrOpts === 'object' && tickIndexOrOpts !== null && 'tickIndex' in tickIndexOrOpts ? tickIndexOrOpts.tickIndex : tickIndexOrOpts as number;
    const target = int(tickIndex);
    let selectedTick: number | null = null;
    for (const tick of this._localSnapshotBlobs.keys()) {
      if (int(tick) <= int(target)) {
        selectedTick = int(tick);
      } else {
        break;
      }
    }
    if (selectedTick === null) {
      return null;
    }
    const payload = this._localSnapshotBlobs.get(int(selectedTick)) ?? null;
    if (payload === null) {
      return null;
    }
    return [int(selectedTick), bytesFrom(payload)];
  }

  _send(message: NetMessage, opts: { reliable: boolean; nowMs: number }): void {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    const addr = this._serverAddr;
    if (addr === null) {
      return;
    }
    const packet = this.link.buildPacket(message, { reliable: reliable, nowMs: int(nowMs) });
    try {
      this.transport.sendPacket(addr, packet);
    } catch (exc) {
      return;
    }
    this._lastSendMs = int(nowMs);
    if (!(message instanceof Ping)) {
      lanDebugLog(
        'net_send',
        { role: String(this.cfg.role), kind: ((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(message), reliable: reliable, roomCode: String(this.cfg.roomCode || '') },
      );
    }
  }

  _announceRoomCode(roomCode: RoomCode | null): void {
    if (roomCode === null) {
      return;
    }
    if (roomCode === this._announcedRoomCode) {
      return;
    }
    this._announcedRoomCode = roomCode;
    console.log(`[crimson] Invite code: ${roomCode}`);
  }

  sendHelloIfNeeded(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._sendHelloIfNeeded({ nowMs: nowMs });
  }

  handleMessage(opts: { message: NetMessage; nowMs: number }): void {
    const message = opts.message;
    const nowMs = opts.nowMs;
    this._handleMessage({ message: message, nowMs: nowMs });
  }

  initRollback(event: RoomStart): void {
    this._initRollback(event);
  }

  drainFrames(): void {
    this._drainFrames();
  }

  syncRollbackMetrics(controller: RollbackController): void {
    this._syncRollbackMetrics(controller);
  }

  applyRollbackFrom(opts: { controller: RollbackController; fromTick: number; nowMs: number }): void {
    const controller = opts.controller;
    const fromTick = opts.fromTick;
    const nowMs = opts.nowMs;
    this._applyRollbackFrom({ controller: controller, fromTick: fromTick, nowMs: nowMs });
  }

  sendResyncRequest(opts: { fromTick: number; reason: string; nowMs: number }): void {
    const fromTick = opts.fromTick;
    const reason = opts.reason;
    const nowMs = opts.nowMs;
    this._sendResyncRequest({ fromTick: fromTick, reason: reason, nowMs: nowMs });
  }

  handleResyncRequest(opts: { message: RbResyncRequest; nowMs: number }): void {
    const message = opts.message;
    const nowMs = opts.nowMs;
    this._handleResyncRequest({ message: message, nowMs: nowMs });
  }

  handleResyncBegin(opts: { message: RbResyncBegin }): void {
    const message = opts.message;
    this._handleResyncBegin({ message: message });
  }

  handleResyncChunk(opts: { message: RbResyncChunk }): void {
    const message = opts.message;
    this._handleResyncChunk({ message: message });
  }

  handleResyncCommit(opts: { message: RbResyncCommit; nowMs: number }): void {
    const message = opts.message;
    const nowMs = opts.nowMs;
    this._handleResyncCommit({ message: message, nowMs: nowMs });
  }

  startSelfReconnect(opts: { nowMs: number; reason: string }): void {
    const nowMs = opts.nowMs;
    const reason = opts.reason;
    this._startSelfReconnect({ nowMs: nowMs, reason: reason });
  }

  finishReconnect(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._finishReconnect({ nowMs: nowMs });
  }

  isReconnectInProgress(): boolean {
    return this._isReconnectInProgress();
  }

  canSelfReconnect(): boolean {
    return this._canSelfReconnect();
  }

  roomStateHasLocalSlot(roomState: RoomState): boolean {
    return this._roomStateHasLocalSlot(roomState);
  }

  isHostSlot(): boolean {
    return this._isHostSlot();
  }

  latestSnapshotAny(): [number, Uint8Array] | null {
    return this._latestSnapshotAny();
  }

  latestSnapshotAtOrBefore(opts: { tickIndex: number }): [number, Uint8Array] | null;
  latestSnapshotAtOrBefore(tickIndex: number): [number, Uint8Array] | null;
  latestSnapshotAtOrBefore(tickIndexOrOpts: number | { tickIndex: number }): [number, Uint8Array] | null {
    const tickIndex: number = typeof tickIndexOrOpts === 'object' && tickIndexOrOpts !== null && 'tickIndex' in tickIndexOrOpts ? tickIndexOrOpts.tickIndex : tickIndexOrOpts as number;
    return this._latestSnapshotAtOrBefore(tickIndex);
  }

  send(message: NetMessage, opts: { reliable: boolean; nowMs: number }): void {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    this._send(message, { reliable: reliable, nowMs: nowMs });
  }

  announceRoomCode(roomCode: RoomCode | null): void {
    this._announceRoomCode(roomCode);
  }
}

export class HostRollbackRuntimeConfig extends RollbackRuntimeConfigBase {
  role: "host" = 'host';
}

export class JoinRollbackRuntimeConfig extends RollbackRuntimeConfigBase {
  role: "join" = 'join';
}

function _nowMs(): number {
  return int((performance.now() / 1000) * 1000.0);
}
