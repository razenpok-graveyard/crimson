// Port of crimson/net/lockstep_runtime.py

import type { GameMode } from '@crimson/game-modes.ts';
import type { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import type { PackedPlayerInput } from '@crimson/replay/types.ts';
import type { GameCommand } from '@crimson/sim/input-providers.ts';
import { ftolMsI32 } from '@crimson/sim/timing.ts';
import { lanDebugLog, lanDebugLogPath, setLanDebugForwarder } from '@crimson/net/debug-log.ts';
import { ClientLobby, HostLobby } from '@crimson/net/lockstep-lobby.ts';
import type { NetMessage } from '@crimson/net/lockstep-protocol.ts';
import { INPUT_DELAY_TICKS, LINK_TIMEOUT_MS, PROTOCOL_VERSION, TICK_RATE, DebugLogBatch, Disconnect, Hello, InputBatch, KeepAlive, LobbyState, MatchStart, PauseState, Ready, TickFrame, Welcome, currentBuildId } from '@crimson/net/lockstep-protocol.ts';
import type { HostReadyTick } from '@crimson/net/lockstep-state.ts';
import { ClientLockstepState, HostLockstepState } from '@crimson/net/lockstep-state.ts';
import { ReliableLink } from '@crimson/net/reliable.ts';
import { helloFromSessionSettings, sessionSettingsForLockstep, sessionSettingsFromHello, sessionSettingsFromMatchStart, sessionSettingsFromWelcome } from '@crimson/net/session-settings.ts';
import type { PeerAddr } from '@crimson/net/transport.ts';
import { UdpTransport } from '@crimson/net/transport.ts';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

export type LockstepRuntimeConfig = HostLockstepRuntimeConfig | JoinLockstepRuntimeConfig;

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

function _strftimeUtcNow(): string {
  const now = new Date();
  const year = String(now.getUTCFullYear()).padStart(4, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  const minute = String(now.getUTCMinutes()).padStart(2, '0');
  const second = String(now.getUTCSeconds()).padStart(2, '0');
  const microsecond = `${String(now.getUTCMilliseconds()).padStart(3, '0')}000`;
  return `${year}${month}${day}T${hour}${minute}${second}.${microsecond}Z`;
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

function _pathIsAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
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

function tupleKey(value: readonly unknown[] | string): string {
  return typeof value === 'string' ? value : value.join(',');
}

export class LockstepRuntimeConfigBase {
  modeId: GameMode;
  playerCount: number;
  bindHost: string;
  hostIp: string;
  port: number;
  questLevel: QuestLevel | null;
  preserveBugs: boolean;
  tickRate: number;
  inputDelayTicks: number;
  simStatus: GameStatusData | null;

  constructor(opts: {
    modeId: GameMode;
    playerCount: number;
    bindHost: string;
    hostIp: string;
    port: number;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    tickRate?: number;
    inputDelayTicks?: number;
    simStatus?: GameStatusData | null;
  }) {
    this.modeId = opts.modeId;
    this.playerCount = opts.playerCount;
    this.bindHost = opts.bindHost;
    this.hostIp = opts.hostIp;
    this.port = opts.port;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.tickRate = opts.tickRate ?? TICK_RATE;
    this.inputDelayTicks = opts.inputDelayTicks ?? INPUT_DELAY_TICKS;
    this.simStatus = opts.simStatus ?? null;
  }
}

export class HostPeerLink {
  addr: PeerAddr;
  link: ReliableLink;
  lastSeenMs: number;

  constructor(opts: {
    addr: PeerAddr;
    link?: ReliableLink;
    lastSeenMs?: number;
  }) {
    this.addr = opts.addr;
    this.link = opts.link ?? new ReliableLink();
    this.lastSeenMs = opts.lastSeenMs ?? 0;
  }
}

// Drive LAN lobby handshake and keep socket state alive across views.
export class LockstepRuntime {
  cfg: LockstepRuntimeConfig;
  buildId: string;
  transport: UdpTransport;
  started: boolean;
  error: string;
  hostLobby: HostLobby | null;
  hostPeers: Map<PeerAddr, HostPeerLink>;
  hostSeed: number;
  hostMatchStart: MatchStart | null;
  hostLastBroadcastMs: number;
  hostLockstep: HostLockstepState | null;
  hostCaptureTick: number;
  hostReadyTicks: HostReadyTick[];
  _pendingHostCommands: GameCommand[];
  _hostSeenInputSlots: Set<number>;
  clientLobby: ClientLobby | null;
  clientLink: ReliableLink | null;
  clientHostAddr: PeerAddr | null;
  clientLastHelloMs: number;
  clientLastSeenMs: number;
  _clientLastSendMs: number;
  clientLockstep: ClientLockstepState | null;
  clientPauseState: PauseState | null;
  _clientSeenTickFrame: boolean;
  _lastSendMs: number;
  // Instrumentation (debug overlay + lan debug logs).
  _metricsLastLogMs: number;
  _metricsLastResendsTotal: number;
  _hostInputQueuedAtMs: Map<number, number>;
  _hostLocalInputLatencyMs: number;
  _hostLocalInputLatencyEwmaMs: number;
  _clientInputQueuedAtMs: Map<number, number>;
  _clientLocalInputLatencyMs: number;
  _clientLocalInputLatencyEwmaMs: number;
  desyncCount: number;
  lastDesyncTick: number;
  lastDesyncKind: string;
  lastDesyncExpected: string;
  lastDesyncActual: string;
  _clientLogForwardQueue: string[];
  _clientLogForwardLastFlushMs: number;
  _clientLogForwardDropped: number;
  _clientLogForwardEnabled: boolean;
  _hostRemoteLogPaths: Map<number, string>;
  _neutralInput: PackedPlayerInput;

  constructor(opts: {
    cfg: LockstepRuntimeConfig;
    buildId?: string;
    transport?: UdpTransport;
    started?: boolean;
    error?: string;
    hostLobby?: HostLobby | null;
    hostPeers?: Map<PeerAddr, HostPeerLink>;
    hostSeed?: number;
    hostMatchStart?: MatchStart | null;
    hostLastBroadcastMs?: number;
    hostLockstep?: HostLockstepState | null;
    hostCaptureTick?: number;
    hostReadyTicks?: HostReadyTick[];
    _pendingHostCommands?: GameCommand[];
    _hostSeenInputSlots?: Set<number>;
    clientLobby?: ClientLobby | null;
    clientLink?: ReliableLink | null;
    clientHostAddr?: PeerAddr | null;
    clientLastHelloMs?: number;
    clientLastSeenMs?: number;
    _clientLastSendMs?: number;
    clientLockstep?: ClientLockstepState | null;
    clientPauseState?: PauseState | null;
    _clientSeenTickFrame?: boolean;
    _lastSendMs?: number;
    _metricsLastLogMs?: number;
    _metricsLastResendsTotal?: number;
    _hostInputQueuedAtMs?: Map<number, number>;
    _hostLocalInputLatencyMs?: number;
    _hostLocalInputLatencyEwmaMs?: number;
    _clientInputQueuedAtMs?: Map<number, number>;
    _clientLocalInputLatencyMs?: number;
    _clientLocalInputLatencyEwmaMs?: number;
    desyncCount?: number;
    lastDesyncTick?: number;
    lastDesyncKind?: string;
    lastDesyncExpected?: string;
    lastDesyncActual?: string;
    _clientLogForwardQueue?: string[];
    _clientLogForwardLastFlushMs?: number;
    _clientLogForwardDropped?: number;
    _clientLogForwardEnabled?: boolean;
    _hostRemoteLogPaths?: Map<number, string>;
    _neutralInput?: PackedPlayerInput;
  }) {
    this.cfg = opts.cfg;
    this.buildId = opts.buildId ?? currentBuildId();
    this.started = opts.started ?? false;
    this.error = opts.error ?? '';
    this.hostLobby = opts.hostLobby ?? null;
    this.hostPeers = opts.hostPeers ?? new Map();
    this.hostSeed = opts.hostSeed ?? 0;
    this.hostMatchStart = opts.hostMatchStart ?? null;
    this.hostLastBroadcastMs = opts.hostLastBroadcastMs ?? 0;
    this.hostLockstep = opts.hostLockstep ?? null;
    this.hostCaptureTick = opts.hostCaptureTick ?? 0;
    this.hostReadyTicks = opts.hostReadyTicks ?? [];
    this._pendingHostCommands = opts._pendingHostCommands ?? [];
    this._hostSeenInputSlots = opts._hostSeenInputSlots ?? new Set();
    this.clientLobby = opts.clientLobby ?? null;
    this.clientLink = opts.clientLink ?? null;
    this.clientHostAddr = opts.clientHostAddr ?? null;
    this.clientLastHelloMs = opts.clientLastHelloMs ?? 0;
    this.clientLastSeenMs = opts.clientLastSeenMs ?? 0;
    this._clientLastSendMs = opts._clientLastSendMs ?? 0;
    this.clientLockstep = opts.clientLockstep ?? null;
    this.clientPauseState = opts.clientPauseState ?? null;
    this._clientSeenTickFrame = opts._clientSeenTickFrame ?? false;
    this._lastSendMs = opts._lastSendMs ?? 0;
    this._metricsLastLogMs = opts._metricsLastLogMs ?? 0;
    this._metricsLastResendsTotal = opts._metricsLastResendsTotal ?? 0;
    this._hostInputQueuedAtMs = opts._hostInputQueuedAtMs ?? new Map();
    this._hostLocalInputLatencyMs = opts._hostLocalInputLatencyMs ?? 0;
    this._hostLocalInputLatencyEwmaMs = opts._hostLocalInputLatencyEwmaMs ?? 0.0;
    this._clientInputQueuedAtMs = opts._clientInputQueuedAtMs ?? new Map();
    this._clientLocalInputLatencyMs = opts._clientLocalInputLatencyMs ?? 0;
    this._clientLocalInputLatencyEwmaMs = opts._clientLocalInputLatencyEwmaMs ?? 0.0;
    this.desyncCount = opts.desyncCount ?? 0;
    this.lastDesyncTick = opts.lastDesyncTick ?? -1;
    this.lastDesyncKind = opts.lastDesyncKind ?? '';
    this.lastDesyncExpected = opts.lastDesyncExpected ?? '';
    this.lastDesyncActual = opts.lastDesyncActual ?? '';
    this._clientLogForwardQueue = opts._clientLogForwardQueue ?? [];
    this._clientLogForwardLastFlushMs = opts._clientLogForwardLastFlushMs ?? 0;
    this._clientLogForwardDropped = opts._clientLogForwardDropped ?? 0;
    this._clientLogForwardEnabled = opts._clientLogForwardEnabled ?? false;
    this._hostRemoteLogPaths = opts._hostRemoteLogPaths ?? new Map();
    this._neutralInput = opts._neutralInput ?? [0.0, 0.0, 0.0, 0.0, 0];
    const bindPort = String(this.cfg.role) === 'host' ? int(this.cfg.port) : 0;
    this.transport = new UdpTransport({ bindHost: String(this.cfg.bindHost), bindPort: int(bindPort) });
  }

  open(): void {
    if (this.hostLobby !== null || this.clientLobby !== null) {
      return;
    }
    this.transport.open();
    this._lastSendMs = 0;
    this._metricsLastLogMs = 0;
    this._metricsLastResendsTotal = 0;
    this._hostInputQueuedAtMs.clear();
    this._hostLocalInputLatencyMs = 0;
    this._hostLocalInputLatencyEwmaMs = 0.0;
    this._clientInputQueuedAtMs.clear();
    this._clientLocalInputLatencyMs = 0;
    this._clientLocalInputLatencyEwmaMs = 0.0;
    this._hostSeenInputSlots.clear();
    this.desyncCount = 0;
    this.lastDesyncTick = -1;
    this.lastDesyncKind = '';
    this.lastDesyncExpected = '';
    this.lastDesyncActual = '';

    this._clientLogForwardQueue.length = 0;
    this._clientLogForwardLastFlushMs = 0;
    this._clientLogForwardDropped = 0;
    this._clientLogForwardEnabled = false;
    this._hostRemoteLogPaths.clear();
    this._clientSeenTickFrame = false;
    lanDebugLog(
      'net_open',
      { role: String(this.cfg.role), bindHost: String(this.cfg.bindHost), bindPort: int(this.transport.boundPort), buildId: String(this.buildId), modeId: int(this.cfg.modeId), playerCount: int(this.cfg.playerCount), tickRate: int(this.cfg.tickRate), inputDelayTicks: int(this.cfg.inputDelayTicks) },
    );
    let hostIp: any;
    if (String(this.cfg.role) === 'host') {
      this.hostLobby = new HostLobby({ modeId: this.cfg.modeId, playerCount: int(this.cfg.playerCount), buildId: String(this.buildId), tickRate: int(this.cfg.tickRate), inputDelayTicks: int(this.cfg.inputDelayTicks), questLevel: this.cfg.questLevel, preserveBugs: Boolean(this.cfg.preserveBugs) });
      this.hostLastBroadcastMs = _nowMs();
    } else {
      const hostIpRaw = (String(this.cfg.hostIp)).trim();
      hostIp = hostIpRaw;
      if (hostIpRaw) {
        try {
          hostIp = String(hostIpRaw);
        } catch (exc) {
          lanDebugLog('net_resolve_host_error', { role: 'join', host: hostIpRaw, error: String(exc) });
        }
      }
      this.clientHostAddr = [hostIp, int(this.cfg.port)];
      lanDebugLog(
        'net_resolve_host',
        { role: 'join', host: hostIpRaw, resolved: hostIp, port: int(this.cfg.port) },
      );
      this.clientLink = new ReliableLink();
      setLanDebugForwarder(this._clientForwardLogLine.bind(this));
      this._clientLogForwardEnabled = true;
      const settings = sessionSettingsForLockstep({ modeId: this.cfg.modeId, playerCount: int(this.cfg.playerCount), questLevel: this.cfg.questLevel, preserveBugs: Boolean(this.cfg.preserveBugs), tickRate: int(this.cfg.tickRate), inputDelayTicks: int(this.cfg.inputDelayTicks) });
      const hello = helloFromSessionSettings(settings, { protocolVersion: int(PROTOCOL_VERSION), buildId: String(this.buildId), host: false });
      this.clientLobby = new ClientLobby({ buildId: String(this.buildId), hello: hello });
      this.clientLastHelloMs = 0;
      this.clientLastSeenMs = _nowMs();
      this._clientLastSendMs = 0;
    }
  }

  close(): void {
    try {
      this.transport.close();
    } finally {
      this.hostLobby = null;
      this.hostPeers.clear();
      this.hostSeed = 0;
      this.hostMatchStart = null;
      this.hostLastBroadcastMs = 0;
      this.clientLobby = null;
      this.clientLink = null;
      this.clientHostAddr = null;
      this.clientLastHelloMs = 0;
      this.clientLastSeenMs = 0;
      this._clientLastSendMs = 0;
      this.hostLockstep = null;
      this.hostCaptureTick = 0;
      this.hostReadyTicks.length = 0;
      this._pendingHostCommands.length = 0;
      this.clientLockstep = null;
      this.clientPauseState = null;
      this._lastSendMs = 0;
      this._metricsLastLogMs = 0;
      this._metricsLastResendsTotal = 0;
      this._hostInputQueuedAtMs.clear();
      this._hostLocalInputLatencyMs = 0;
      this._hostLocalInputLatencyEwmaMs = 0.0;
      this._clientInputQueuedAtMs.clear();
      this._clientLocalInputLatencyMs = 0;
      this._clientLocalInputLatencyEwmaMs = 0.0;
      this._hostSeenInputSlots.clear();
      this.desyncCount = 0;
      this.lastDesyncTick = -1;
      this.lastDesyncKind = '';
      this.lastDesyncExpected = '';
      this.lastDesyncActual = '';

      this._clientLogForwardQueue.length = 0;
      this._clientLogForwardLastFlushMs = 0;
      this._clientLogForwardDropped = 0;
      if (this._clientLogForwardEnabled) {
        setLanDebugForwarder(null);
      }
      this._clientLogForwardEnabled = false;
      this._hostRemoteLogPaths.clear();
      this._clientSeenTickFrame = false;
      this.started = false;
      this.error = '';
      lanDebugLog('net_close', { role: String(this.cfg.role) });
    }
  }

  hostRemoteInputsReady(): boolean {
    // True once each remote slot has sent at least one InputBatch.
    //
    // This is used to gate the host's first simulation steps so the host doesn't
    // start capturing inputs before joiners have entered gameplay, which can
    // create persistent host-side input latency.
    if (String(this.cfg.role) !== 'host') {
      return true;
    }
    const lockstep = this.hostLockstep;
    if (lockstep === null) {
      return false;
    }
    const playerCount = Math.max(1, int(lockstep.playerCount));
    for (let slot = 1; slot < int(playerCount); slot++) {
      if (!(this._hostSeenInputSlots as ReadonlySet<unknown>).has(int(slot))) {
        return false;
      }
    }
    return true;
  }

  get boundPort(): number {
    return int(this.transport.boundPort);
  }

  debugOverlayLines(): string[] {
    // Return compact LAN debug HUD lines for in-game overlays.
    const lines: string[] = [];
    const role = String(this.cfg.role);
    const nowMs = _nowMs();
    const tickRate = Math.max(1, int(this.cfg.tickRate) || 1);
    const delayTicks = Math.max(0, int(this.cfg.inputDelayTicks));
    const delayMs = ftolMsI32(delayTicks * 1000.0 / tickRate);

    if (this.error) {
      lines.push(`net: error=${this.error}`);
    }
    if (int(this.desyncCount) > 0) {
      const exp = String(this.lastDesyncExpected || '').slice(0, 8);
      const act = String(this.lastDesyncActual || '').slice(0, 8);
      lines.push(`desyncs: ${int(this.desyncCount)} last=${String(this.lastDesyncKind || '?')}@${int(this.lastDesyncTick)} ${exp}!=${act}`);
    }

    let lockstep: HostLockstepState | null | ClientLockstepState;
    let emitTick: number;
    let leadTicks: number;
    let waitingFor: number;
    let stallMs: number;
    let rttLabel: string;
    if (role === 'host') {
      const peerTotal = Math.max(0, int(this.cfg.playerCount) - 1);
      lockstep = this.hostLockstep;
      emitTick = 0;
      leadTicks = 0;
      waitingFor = 0;
      stallMs = 0;
      if (lockstep !== null) {
        emitTick = int(lockstep.nextEmitTick);
        leadTicks = int(this.hostCaptureTick) - int(emitTick);
        waitingFor = int(lockstep.waitingForInputs());
        if (waitingFor > 0) {
          stallMs = Math.max(0, int(nowMs) - int(lockstep.lastProgressMs));
        }
      }
      const rtts = Array.from(this.hostPeers.values()).filter((peer) => peer.link.rttLastMs > 0).map((peer) => int(peer.link.rttLastMs));
      rttLabel = '?';
      if (rtts.length > 0) {
        rttLabel = `${Math.min(...rtts)}..${Math.max(...rtts)}`;
      }
      const pendingMax = (() => { const values = Array.from(this.hostPeers.values(), (peer) => int(peer.link.pendingCount)); return values.length === 0 ? 0 : Math.max(...values); })();
      lines.push(`net(host): peers=${this.hostPeers.size}/${int(peerTotal)} emit=${int(emitTick)} lead=${int(leadTicks)} wait=${int(waitingFor)} stall=${int(stallMs)}ms`);
      lines.push(`link(host): delay=${delayTicks}t(${delayMs}ms) rtt=${rttLabel}ms pending=${int(pendingMax)}`);
      return lines;
    }

    const lobby = this.clientLobby;
    const host = this.clientHostAddr;
    const hostLabel = host !== null ? `${host[0]}:${host[1]}` : '?:?';
    const joined = lobby !== null ? lobby.joined : false;
    const started = lobby !== null ? lobby.started : false;
    const slot = lobby !== null ? int(lobby.slotIndex) : -1;

    lockstep = this.clientLockstep;
    let consumeTick = 0;
    let bufferedFrames = 0;
    stallMs = 0;
    let paused = 0;
    if (lockstep !== null) {
      consumeTick = int(lockstep.nextConsumeTick);
      bufferedFrames = int(lockstep.bufferedFrameCount);
      paused = int(lockstep.paused);
      if (int(lockstep.bufferedFrameCount) <= 0) {
        stallMs = Math.max(0, int(nowMs) - int(lockstep.lastProgressMs));
      }
    }

    const link = this.clientLink;
    let rttLast = 0;
    let rttEwma = 0;
    let pending = 0;
    if (link !== null) {
      rttLast = int(link.rttLastMs);
      rttEwma = int(link.rttEwmaMs);
      pending = int(link.pendingCount);
    }

    lines.push(`net(join): host=${hostLabel} slot=${int(slot)} joined=${int(joined)} started=${int(started)} consume=${int(consumeTick)} buf=${int(bufferedFrames)} stall=${int(stallMs)}ms pause=${int(paused)}`);
    lines.push(`link(join): delay=${delayTicks}t(${delayMs}ms) rtt=${int(rttLast)}/${int(rttEwma)}ms pending=${int(pending)}`);
    const pause = this.clientPauseState;
    if (pause !== null && pause.paused) {
      lines.push(`pause: ${String(pause.reason || '')}`);
    }

    return lines;
  }

  lobbyState(): LobbyState | null {
    let lobby: HostLobby | null | ClientLobby;
    if (String(this.cfg.role) === 'host') {
      lobby = this.hostLobby;
      if (lobby === null) {
        return null;
      }
      return lobby.lobbyState();
    }
    lobby = this.clientLobby;
    if (lobby === null) {
      return null;
    }
    return lobby.lobbyStateLatest;
  }

  matchStart(): MatchStart | null {
    if (String(this.cfg.role) === 'host') {
      return this.hostMatchStart;
    }
    const lobby = this.clientLobby;
    if (lobby === null) {
      return null;
    }
    return lobby.matchStart;
  }

  get localSlotIndex(): number {
    if (String(this.cfg.role) === 'host') {
      return 0;
    }
    const lobby = this.clientLobby;
    if (lobby === null) {
      return -1;
    }
    return int(lobby.slotIndex);
  }

  noteDesync(opts: { kind: string; tickIndex: number; expected: string; actual: string }): void {
    const kind = opts.kind;
    const tickIndex = opts.tickIndex;
    const expected = opts.expected;
    const actual = opts.actual;
    // Record a desync event and (optionally) notify the host.
    //
    // For now, desync detection is driven by gameplay modes comparing local
    // hashes with those embedded in host tick frames.
    this.desyncCount = int(this.desyncCount) + 1;
    this.lastDesyncTick = int(tickIndex);
    this.lastDesyncKind = kind;
    this.lastDesyncExpected = expected;
    this.lastDesyncActual = actual;
    lanDebugLog(
      'lan_desync',
      { role: String(this.cfg.role), kind: kind, tickIndex: int(tickIndex), expected: expected, actual: actual },
    );
  }

  _setClientError(opts: { reason: string }): void;
  _setClientError(reason: string): void;
  _setClientError(reasonOrOpts: string | { reason: string }): void {
    const reason: string = typeof reasonOrOpts === 'object' && reasonOrOpts !== null ? reasonOrOpts.reason : reasonOrOpts as string;
    if (this.error) {
      return;
    }
    this.error = reason;
    // Once client enters a terminal error state, stop forwarding local logs.
    if (this._clientLogForwardEnabled) {
      setLanDebugForwarder(null);
    }
    this._clientLogForwardEnabled = false;
    this._clientLogForwardQueue.length = 0;
  }

  _abortHostMatch(opts: { reason: string; nowMs: number; addr?: PeerAddr | null }): void {
    const reason = opts.reason;
    const nowMs = opts.nowMs;
    const addr = opts.addr ?? null;
    if (!this.started) {
      return;
    }
    if (this.error) {
      return;
    }
    this.error = reason;
    const details: Record<string, unknown> = { "role": 'host', "reason": reason };
    if (addr !== null) {
      details['addr'] = `${addr[0]}:${int(addr[1])}`;
    }
    lanDebugLog('net_match_abort', details);
    this._hostBroadcast(new Disconnect({ reason: reason }), { reliable: true, nowMs: int(nowMs) });
  }

  _clientForwardLogLine(opts: { line: string }): void;
  _clientForwardLogLine(line: string): void;
  _clientForwardLogLine(lineOrOpts: string | { line: string }): void {
    const line: string = typeof lineOrOpts === 'object' && lineOrOpts !== null ? lineOrOpts.line : lineOrOpts as string;
    // Best-effort: keep a bounded queue of recent log lines.
    if (!this._clientLogForwardEnabled) {
      return;
    }
    if (String(this.cfg.role) !== 'join') {
      return;
    }
    if (this._clientLogForwardQueue.length >= int(CLIENT_LOG_FORWARD_MAX_QUEUE_LINES)) {
      this._clientLogForwardQueue.shift();
      this._clientLogForwardDropped = int(this._clientLogForwardDropped) + 1;
    }
    this._clientLogForwardQueue.push(line);
  }

  _clientFlushForwardedLogs(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    if (!this._clientLogForwardEnabled) {
      return;
    }
    if ((int(nowMs) - int(this._clientLogForwardLastFlushMs)) < int(CLIENT_LOG_FORWARD_FLUSH_MS)) {
      return;
    }

    if (this._clientLogForwardQueue.length === 0 && int(this._clientLogForwardDropped) <= 0) {
      return;
    }

    const lobby = this.clientLobby;
    if (lobby === null) {
      return;
    }
    const welcome = lobby.welcome;
    if (welcome === null || !welcome.accepted) {
      return;
    }
    const slotIndex = int(welcome.slotIndex);
    if (int(slotIndex) <= 0) {
      return;
    }

    const lines: string[] = [];
    let chars = 0;
    const dropped = int(this._clientLogForwardDropped);
    if (dropped > 0) {
      const timestamp = new Date().toISOString().replace('Z', '+00:00');
      const dropLine = `${timestamp} event=log_forward_drop dropped=${int(dropped)}\\n`;
      lines.push(dropLine);
      chars += Array.from(dropLine).length;
      this._clientLogForwardDropped = 0;
    }

    while (this._clientLogForwardQueue.length > 0 && lines.length < int(CLIENT_LOG_FORWARD_MAX_LINES_PER_BATCH)) {
      const nextLine = String(this._clientLogForwardQueue[0]);
      if (lines.length > 0 && (int(chars) + nextLine.length) > int(CLIENT_LOG_FORWARD_MAX_CHARS_PER_BATCH)) {
        break;
      }
      if (lines.length === 0 && nextLine.length > int(CLIENT_LOG_FORWARD_MAX_CHARS_PER_BATCH)) {
        // Oversized line: still forward it (single line batch).
        lines.push(String(this._clientLogForwardQueue.shift()!));
        break;
      }
      lines.push(String(this._clientLogForwardQueue.shift()!));
      chars += lines[lines.length - 1].length;
    }

    if (lines.length === 0) {
      return;
    }

    this._clientLogForwardLastFlushMs = int(nowMs);
    try {
      this._clientSend(
        new DebugLogBatch({ slotIndex: int(slotIndex), lines: lines }),
        { reliable: false, nowMs: int(nowMs) },
      );
    } catch (exc) {
      // Don't let debug log forwarding affect gameplay.
      return;
    }
  }

  _hostWriteRemoteLogBatch(opts: { addr: PeerAddr; slotIndex: number; lines: string[] }): void {
    const addr = opts.addr;
    const slotIndex = opts.slotIndex;
    const lines = opts.lines;
    if (int(slotIndex) <= 0) {
      return;
    }
    if (lines.length === 0) {
      return;
    }

    let path = this._hostRemoteLogPaths.get(int(slotIndex)) ?? null;
    let sessionId: string;
    if (path === null) {
      const hostPath = lanDebugLogPath();
      if (hostPath === null) {
        return;
      }
      const safeIp = String(addr[0]).replaceAll(':', '_').replaceAll('/', '_');
      const timestamp = _strftimeUtcNow();
      path = _pathJoin(_dirname(String(hostPath)), `lan-client-slot${int(slotIndex)}-from${safeIp}-${int(addr[1])}-${timestamp}.log`);
      _mkdirParents(_dirname(String(path)));
      sessionId = '';
      const lobby = this.hostLobby;
      if (lobby !== null) {
        sessionId = String(lobby.sessionId);
      }
      const initTs = new Date().toISOString().replace('Z', '+00:00');
      const initLine = `${initTs} event=remote_log_init slot_index=${int(slotIndex)} addr=${addr[0]}:${int(addr[1])} session_id=${sessionId}\\\\n`;
      const handle = _openTextFile(String(path), { mode: 'a', encoding: 'utf-8' });
      try {
        handle.write(initLine);
      } finally {
        handle.close();
      }
      this._hostRemoteLogPaths.set(int(slotIndex), path);
    }

    const handle = _openTextFile(String(path), { mode: 'a', encoding: 'utf-8' });
    try {
      for (const line of lines) {
        let text = String(line);
        if (!pythonEndsWith(text, '\n')) {
          text += '\n';
        }
        handle.write(text);
      }
    } finally {
      handle.close();
    }
  }

  queueLocalInput(packedInput: PackedPlayerInput, opts: { nowMs?: number | null } = {}): void {
    let nowMs = opts.nowMs ?? null;
    if (nowMs === null) {
      nowMs = _nowMs();
    }
    let lockstep: HostLockstepState | null | ClientLockstepState;
    let targetTick: number;
    if (String(this.cfg.role) === 'host') {
      lockstep = this.hostLockstep;
      if (lockstep === null) {
        return;
      }
      // Keep the host capture clock close to lockstep progress. Otherwise
      // even short stalls can cause the host to queue inputs far in the
      // future, which shows up as persistent host-side input latency.
      const maxCaptureTick = int(lockstep.nextEmitTick) + int(HOST_MAX_CAPTURE_LEAD_TICKS);
      if (int(this.hostCaptureTick) > int(maxCaptureTick)) {
        this.hostCaptureTick = int(maxCaptureTick);
      }
      targetTick = int(this.hostCaptureTick) + int(this.cfg.inputDelayTicks);
      this._hostInputQueuedAtMs.set(int(targetTick), int(nowMs));
      lockstep.submitInputSample({
        slotIndex: 0,
        tickIndex: int(targetTick),
        packedInput: Array.from(packedInput),
      });
      this.hostCaptureTick += 1;
      return;
    }

    lockstep = this.clientLockstep;
    if (lockstep === null) {
      return;
    }
    const batch = lockstep.queueLocalInput(Array.from(packedInput));
    // The client lockstep can clamp its internal capture tick to stay close to
    // lockstep progress, so compute the actual target tick after enqueuing.
    const usedCaptureTick = int(lockstep.captureTick) - 1;
    targetTick = int(usedCaptureTick) + int(lockstep.inputDelayTicks);
    this._clientInputQueuedAtMs.set(int(targetTick), int(nowMs));
    this._clientSend(batch, { reliable: false, nowMs: int(nowMs) });
  }

  popTickFrame(): TickFrame | null {
    if (String(this.cfg.role) === 'host') {
      if (this.hostReadyTicks.length === 0) {
        return null;
      }
      const ready = this.hostReadyTicks.shift()!;
      const commands = Array.from(this._pendingHostCommands);
      this._pendingHostCommands.length = 0;
      return new TickFrame({ tickIndex: int(ready.tickIndex), frameInputs: Array.from(ready.frameInputs).map((packed) => Array.from(packed)), commands: commands });
    }
    const lockstep = this.clientLockstep;
    if (lockstep === null) {
      return null;
    }
    return lockstep.popCanonicalFrame();
  }

  submitLocalCommand(command: GameCommand): void {
    if (String(this.cfg.role) !== 'host') {
      return;
    }
    this._pendingHostCommands.push(command);
  }

  broadcastTickFrame(frame: TickFrame, opts: { nowMs?: number | null } = {}): void {
    let nowMs = opts.nowMs ?? null;
    if (String(this.cfg.role) !== 'host') {
      return;
    }
    if (nowMs === null) {
      nowMs = _nowMs();
    }
    this._hostBroadcast(frame, { reliable: true, nowMs: int(nowMs) });
  }

  update(opts: { nowMs?: number | null } = {}): void {
    let nowMs = opts.nowMs ?? null;
    if (nowMs === null) {
      nowMs = _nowMs();
    }
    if (String(this.cfg.role) === 'host') {
      this._updateHost({ nowMs: int(nowMs) });
    } else {
      this._updateClient({ nowMs: int(nowMs) });
    }
    this._traceMetrics({ nowMs: int(nowMs) });
  }

  _updateHost(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    const lobby = this.hostLobby;
    if (lobby === null) {
      return;
    }

    for (let [addr, packet] of this.transport.recvPackets({ maxPackets: int(MAX_RECV_PACKETS_PER_UPDATE) })) {
      const peerLink = this.hostPeers.get(addr) ?? null;
      if (peerLink === null) {
        const message = packet.message;
        if (message instanceof Hello) {
          this._handleHostMessage(addr, message, { nowMs: int(nowMs) });
          const acceptedPeer = this.hostPeers.get(addr) ?? null;
          if (acceptedPeer !== null && Boolean(packet.reliable) && int(packet.seq) > 0) {
            acceptedPeer.link.primeRecvSeq(int(packet.seq));
          }
        }
        continue;
      }
      peerLink.lastSeenMs = int(nowMs);
      const [messages, dup] = peerLink.link.ingestPacket(packet, { nowMs: int(nowMs) });
      if (dup) {
        lanDebugLog('net_recv_dup', { role: 'host', addr: `${addr[0]}:${addr[1]}`, seq: int(packet.seq) });
      }
      for (const message of messages) {
        this._handleHostMessage(addr, message, { nowMs: int(nowMs) });
      }
    }

    // Drop timed-out peers.
    let timeoutMs = int(LINK_TIMEOUT_MS);
    if (lobby.started && !this.hostRemoteInputsReady()) {
      timeoutMs = int(LOADING_LINK_TIMEOUT_MS);
    }
    const lockstep = this.hostLockstep;
    if (lobby.started && lockstep !== null && lockstep.paused) {
      timeoutMs = Math.max(int(timeoutMs), int(PAUSED_LINK_TIMEOUT_MS));
    }
    for (let [addr, peer] of Array.from(this.hostPeers.entries())) {
      if ((int(nowMs) - int(peer.lastSeenMs)) < int(timeoutMs)) {
        continue;
      }
      const slot = lobby.slotForAddr(addr);
      this.hostPeers.delete(addr);
      lobby.peersByAddr.delete(tupleKey(addr));
      if (slot !== null) {
        this._hostSeenInputSlots.delete(int(slot));
      }
      lanDebugLog(
        'net_timeout',
        { role: 'host', addr: `${addr[0]}:${addr[1]}`, timeoutMs: int(timeoutMs), started: lobby.started },
      );
      if (lobby.started) {
        this._abortHostMatch({ reason: 'peer_timeout', nowMs: int(nowMs), addr: addr });
      }
    }

    // Broadcast lobby state periodically.
    if (!lobby.started && (int(nowMs) - int(this.hostLastBroadcastMs)) >= 250) {
      this.hostLastBroadcastMs = int(nowMs);
      this._hostBroadcastLobbyState({ nowMs: int(nowMs) });
    }

    // Start automatically once ready.
    if (!lobby.started && lobby.allReady()) {
      const status = this.cfg.simStatus;
      if (status === null) {
        this.error = 'missing_sim_status';
        lanDebugLog(
          'net_sanity_error',
          { role: 'host', kind: 'match_start', reason: String(this.error) },
        );
        return;
      }
      this.hostSeed = int(((_nowMs() * 1103515245 + 12345) >>> 0));
      const event = lobby.startMatch({ seed: int(this.hostSeed), status: status });
      this.started = true;
      this.hostMatchStart = event;
      this._hostInitLockstep(event);
      this._hostSeenInputSlots.clear();
      lanDebugLog(
        'net_match_start',
        { role: 'host', sessionId: String(event.sessionId || ''), modeId: int(event.modeId), playerCount: int(event.playerCount), seed: int(event.seed), startTick: int(event.startTick), questLevel: String(event.questLevel || ''), preserveBugs: Boolean(event.preserveBugs), statusQuestUnlockIndex: int(status.questUnlockIndex), statusQuestUnlockIndexFull: int(status.questUnlockIndexFull), tickRate: int(this.cfg.tickRate), inputDelayTicks: int(this.cfg.inputDelayTicks) },
      );
      this._hostBroadcast(event, { reliable: true, nowMs: int(nowMs) });
    }

    if (this.hostLockstep !== null) {
      const pause = this.hostLockstep.updatePauseState({ nowMs: int(nowMs) });
      if (pause !== null) {
        this._hostBroadcast(pause, { reliable: true, nowMs: int(nowMs) });
      }
      const frames = this.hostLockstep.popReadyFrames({ nowMs: int(nowMs) });
      for (const frame of frames) {
        const tick = int(frame.tickIndex);
        const queuedAt = this._hostInputQueuedAtMs.get(int(tick)) ?? null;
        this._hostInputQueuedAtMs.delete(int(tick));
        if (queuedAt !== null) {
          const latencyMs = Math.max(0, int(nowMs) - int(queuedAt));
          this._hostLocalInputLatencyMs = int(latencyMs);
          if (this._hostLocalInputLatencyEwmaMs <= 0.0) {
            this._hostLocalInputLatencyEwmaMs = latencyMs;
          } else {
            this._hostLocalInputLatencyEwmaMs = this._hostLocalInputLatencyEwmaMs * 0.9 + latencyMs * 0.1;
          }
        }
        this.hostReadyTicks.push(frame);
      }
    }

    // Resend reliable packets.
    for (let [addr, peer] of this.hostPeers.entries()) {
      for (const resend of peer.link.pollResends({ nowMs: int(nowMs) })) {
        try {
          this.transport.sendPacket(addr, resend);
        } catch (exc) {
          continue;
        }
        this._lastSendMs = int(nowMs);
      }
    }

    // Prevent timeouts during stalls/pauses by sending best-effort keepalives.
    if (this.started && this.hostPeers.size > 0) {
      const lastSend = int(this._lastSendMs);
      let tickIndex: number;
      if (lastSend <= 0) {
        this._lastSendMs = int(nowMs);
      } else if ((int(nowMs) - int(lastSend)) >= int(KEEPALIVE_INTERVAL_MS)) {
        tickIndex = 0;
        if (this.hostLockstep !== null) {
          tickIndex = int(this.hostLockstep.nextEmitTick);
        }
        this._hostBroadcast(new KeepAlive({ tickIndex: int(tickIndex) }), { reliable: false, nowMs: int(nowMs) });
      }
    }
  }

  _handleHostMessage(addr: PeerAddr, message: NetMessage, opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    const lobby = this.hostLobby;
    if (lobby === null) {
      return;
    }
    if (message instanceof KeepAlive) {
      return;
    }
    if (message instanceof Hello) {
      lanDebugLog(
        'net_recv',
        { role: 'host', kind: 'hello', addr: `${addr[0]}:${addr[1]}`, protocolVersion: int(message.protocolVersion), buildId: String(message.buildId || ''), modeId: int(message.modeId), playerCount: int(message.playerCount), tickRate: int(message.tickRate), inputDelayTicks: int(message.inputDelayTicks), questLevel: String(message.questLevel || ''), preserveBugs: Boolean(message.preserveBugs), host: Boolean(message.host) },
      );
      const welcome = lobby.processHello(addr, message);
      lanDebugLog(
        'lobby_welcome',
        { role: 'host', addr: `${addr[0]}:${addr[1]}`, accepted: Boolean(welcome.accepted), reason: String(welcome.reason || ''), slotIndex: int(welcome.slotIndex), sessionId: String(welcome.sessionId) },
      );
      if (Boolean(welcome.accepted)) {
        const peer = this.hostPeers.get(addr) ?? null;
        if (peer === null) {
          this.hostPeers.set(addr, new HostPeerLink({ addr: addr, lastSeenMs: int(nowMs) }));
        } else {
          peer.lastSeenMs = int(nowMs);
        }
      }
      this._hostSend(
        addr,
        welcome,
        { reliable: true, nowMs: int(nowMs), trackPeer: Boolean(welcome.accepted) },
      );
      // Publish lobby state update after accepting/rejecting.
      this._hostBroadcastLobbyState({ nowMs: int(nowMs) });
      return;
    }
    if (message instanceof Ready) {
      lanDebugLog(
        'net_recv',
        { role: 'host', kind: 'ready', addr: `${addr[0]}:${addr[1]}`, slotIndex: int(message.slotIndex), ready: Boolean(message.ready) },
      );
      lobby.processReady(addr, message);
      this._hostBroadcastLobbyState({ nowMs: int(nowMs) });
      return;
    }
    if (message instanceof Disconnect) {
      lanDebugLog('net_recv', { role: 'host', kind: 'disconnect', addr: `${addr[0]}:${addr[1]}` });
      const slot = lobby.slotForAddr(addr);
      this.hostPeers.delete(addr);
      lobby.peersByAddr.delete(tupleKey(addr));
      if (slot !== null) {
        this._hostSeenInputSlots.delete(int(slot));
      }
      if (lobby.started) {
        this._abortHostMatch({ reason: 'peer_disconnect', nowMs: int(nowMs), addr: addr });
      }
      this._hostBroadcastLobbyState({ nowMs: int(nowMs) });
      return;
    }
    let mappedSlot: any;
    let slotIndex!: number;
    if (message instanceof DebugLogBatch) {
      mappedSlot = lobby.slotForAddr(addr);
      const msgSlot = int(message.slotIndex);
      slotIndex = mappedSlot !== null ? int(mappedSlot) : int(msgSlot);
      if (int(slotIndex) <= 0) {
        return;
      }
      const lines = Array.from(message.lines);
      this._hostWriteRemoteLogBatch({ addr: addr, slotIndex: int(slotIndex), lines: lines });
      return;
    }
    let batch: typeof message;
    let maxTick: number;
    let minTick: number;
    if (message instanceof InputBatch) {
      const lockstep = this.hostLockstep;
      if (lockstep === null) {
        return;
      }
      mappedSlot = lobby.slotForAddr(addr);
      if (mappedSlot === null) {
        return;
      }
      if (int(mappedSlot) > 0) {
        this._hostSeenInputSlots.add(int(mappedSlot));
      }
      batch = message;
      if (int(batch.slotIndex) !== int(mappedSlot)) {
        batch = new InputBatch({ slotIndex: int(mappedSlot), samples: Array.from(batch.samples) });
      }
      maxTick = -1;
      minTick = 2**31 - 1;
      for (const sample of batch.samples) {
        const tick = int(sample.tickIndex);
        maxTick = Math.max(int(maxTick), int(tick));
        minTick = Math.min(int(minTick), int(tick));
      }
      if (maxTick >= 0 && (int(maxTick) < 5 || (int(maxTick) % 60) === 0)) {
        lanDebugLog(
          'net_recv',
          { role: 'host', kind: 'input_batch', addr: `${addr[0]}:${addr[1]}`, slotIndex: int(batch.slotIndex), sampleCount: batch.samples.length, tickMin: minTick !== 2**31 - 1 ? int(minTick) : 0, tickMax: int(maxTick) },
        );
      }
      lockstep.submitInputBatch(batch);
      return;
    }
  }

  _hostSend(addr: PeerAddr, message: NetMessage, opts: { reliable: boolean; nowMs: number; trackPeer?: boolean }): void {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    const trackPeer = opts.trackPeer ?? true;
    let peer = this.hostPeers.get(addr) ?? null;
    if (peer === null) {
      if (trackPeer) {
        peer = new HostPeerLink({ addr: addr, lastSeenMs: int(nowMs) });
        this.hostPeers.set(addr, peer);
      }
    }
    let packet: any;
    if (peer !== null) {
      packet = peer.link.buildPacket(message, { reliable: reliable, nowMs: int(nowMs) });
    } else {
      packet = new ReliableLink().buildPacket(message, { reliable: reliable, nowMs: int(nowMs) });
    }
    try {
      this.transport.sendPacket(addr, packet);
    } catch (exc) {
      return;
    }
    this._lastSendMs = int(nowMs);
    if (message instanceof KeepAlive) {
      return;
    }
    if (message instanceof TickFrame) {
      const tick = int(message.tickIndex);
      if (int(tick) < 5 || (int(tick) % 60) === 0) {
        lanDebugLog(
          'net_send',
          { role: 'host', kind: 'tick_frame', addr: `${addr[0]}:${addr[1]}`, reliable: reliable, tickIndex: int(tick), commandCount: message.commands.length },
        );
      }
      return;
    }
    if (message instanceof PauseState) {
      lanDebugLog(
        'net_send',
        { role: 'host', kind: 'pause_state', addr: `${addr[0]}:${addr[1]}`, reliable: reliable, paused: Boolean(message.paused), reason: String(message.reason || '') },
      );
      return;
    }
    const kind = ((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(message);
    lanDebugLog(
      'net_send',
      { role: 'host', kind: kind, addr: `${addr[0]}:${addr[1]}`, reliable: reliable },
    );
  }

  _hostBroadcast(message: NetMessage, opts: { reliable: boolean; nowMs: number }): void {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    for (const addr of Array.from(this.hostPeers.keys())) {
      this._hostSend(addr, message, { reliable: reliable, nowMs: int(nowMs) });
    }
  }

  _hostBroadcastLobbyState(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    const lobby = this.hostLobby;
    if (lobby === null) {
      return;
    }
    const state = lobby.lobbyState();
    this._hostBroadcast(state, { reliable: true, nowMs: int(nowMs) });
  }

  _updateClient(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    const lobby = this.clientLobby;
    const link = this.clientLink;
    const host = this.clientHostAddr;
    if (lobby === null || link === null || host === null) {
      return;
    }
    if (this.error) {
      return;
    }

    // Send hello until welcome arrives.
    if (lobby.welcome === null && int(link.pendingCount) <= 0 && (int(nowMs) - int(this.clientLastHelloMs)) >= 200) {
      this.clientLastHelloMs = int(nowMs);
      this._clientSend(lobby.hello, { reliable: true, nowMs: int(nowMs) });
    }

    for (let [addr, packet] of this.transport.recvPackets({ maxPackets: int(MAX_RECV_PACKETS_PER_UPDATE) })) {
      if (addr !== host) {
        continue;
      }
      this.clientLastSeenMs = int(nowMs);
      const [messages, dup] = link.ingestPacket(packet, { nowMs: int(nowMs) });
      if (dup) {
        lanDebugLog('net_recv_dup', { role: 'join', addr: `${addr[0]}:${addr[1]}`, seq: int(packet.seq) });
      }
      for (const message of messages) {
        this._handleClientMessage(message, { nowMs: int(nowMs) });
        if (this.error) {
          return;
        }
      }
    }

    let timeoutMs = int(LINK_TIMEOUT_MS);
    if (this.started && !this._clientSeenTickFrame) {
      timeoutMs = int(LOADING_LINK_TIMEOUT_MS);
    }
    const pauseState = this.clientPauseState;
    if (this.started && pauseState !== null && pauseState.paused && ((String(pauseState.reason || '')) === 'waiting_input')) {
      timeoutMs = Math.max(int(timeoutMs), int(PAUSED_LINK_TIMEOUT_MS));
    }
    if ((int(nowMs) - int(this.clientLastSeenMs)) >= int(timeoutMs)) {
      if (!this.error) {
        this._setClientError('timeout');
        lanDebugLog(
          'net_timeout',
          { role: 'join', addr: `${host[0]}:${host[1]}`, timeoutMs: int(timeoutMs), started: this.started, seenTickFrame: this._clientSeenTickFrame },
        );
      }
      return;
    }

    this._clientFlushForwardedLogs({ nowMs: int(nowMs) });

    for (const resend of link.pollResends({ nowMs: int(nowMs) })) {
      try {
        this.transport.sendPacket(host, resend);
      } catch (exc) {
        continue;
      }
      this._lastSendMs = int(nowMs);
      this._clientLastSendMs = int(nowMs);
    }

    // Prevent timeouts during stalls/pauses by sending best-effort keepalives.
    if (this.started) {
      const lastSend = int(this._lastSendMs);
      let tickIndex: number;
      if (lastSend <= 0) {
        this._lastSendMs = int(nowMs);
      } else if ((int(nowMs) - int(lastSend)) >= int(KEEPALIVE_INTERVAL_MS)) {
        tickIndex = 0;
        if (this.clientLockstep !== null) {
          tickIndex = int(this.clientLockstep.nextConsumeTick);
        }
        this._clientSend(new KeepAlive({ tickIndex: int(tickIndex) }), { reliable: false, nowMs: int(nowMs) });
      }
    }

    this._clientSendIdleHeartbeat({ nowMs: int(nowMs) });
  }

  _handleClientMessage(message: NetMessage, opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    const lobby = this.clientLobby;
    if (lobby === null) {
      return;
    }
    if (message instanceof KeepAlive) {
      return;
    }
    let mismatched: boolean;
    if (message instanceof Welcome) {
      lanDebugLog(
        'net_recv',
        { role: 'join', kind: 'welcome', accepted: Boolean(message.accepted), reason: String(message.reason || ''), slotIndex: int(message.slotIndex), sessionId: String(message.sessionId), protocolVersion: int(message.protocolVersion), buildId: String(message.buildId || ''), modeId: int(message.modeId), playerCount: int(message.playerCount), tickRate: int(message.tickRate), inputDelayTicks: int(message.inputDelayTicks), questLevel: String(message.questLevel || ''), preserveBugs: Boolean(message.preserveBugs), started: Boolean(message.started) },
      );
      lobby.ingestWelcome(message);
      if (!Boolean(message.accepted)) {
        this._setClientError(String(message.reason || 'rejected'));
        return;
      }
      const welcomeSettings = sessionSettingsFromWelcome(message);
      const hello = lobby.hello;
      if (hello !== null) {
        const helloSettings = sessionSettingsFromHello(hello);
        mismatched = helloSettings !== welcomeSettings;
        if (mismatched) {
          lanDebugLog(
            'net_welcome_override',
            { role: 'join', helloModeId: int(helloSettings.modeId), welcomeModeId: int(welcomeSettings.modeId), helloPlayerCount: int(helloSettings.playerCount), welcomePlayerCount: int(welcomeSettings.playerCount), helloTickRate: int(helloSettings.tickRate), welcomeTickRate: int(welcomeSettings.tickRate), helloInputDelayTicks: int(helloSettings.inputDelayTicks), welcomeInputDelayTicks: int(welcomeSettings.inputDelayTicks), helloQuestLevel: String(helloSettings.questLevel || ''), welcomeQuestLevel: String(welcomeSettings.questLevel || ''), helloPreserveBugs: helloSettings.preserveBugs, welcomePreserveBugs: welcomeSettings.preserveBugs },
          );
        }
      }

      // Host is authoritative; adopt its config so lockstep + validation use
      // canonical values (CLI joiners may start with placeholders).
      this.cfg.modeId = welcomeSettings.modeId;
      this.cfg.playerCount = int(welcomeSettings.playerCount);
      this.cfg.tickRate = int(welcomeSettings.tickRate);
      this.cfg.inputDelayTicks = int(welcomeSettings.inputDelayTicks);
      this.cfg.questLevel = welcomeSettings.questLevel;
      this.cfg.preserveBugs = welcomeSettings.preserveBugs;
      const ready = new Ready({ slotIndex: int(message.slotIndex), ready: true });
      this._clientSend(ready, { reliable: true, nowMs: int(nowMs) });
      return;
    }
    if (message instanceof LobbyState) {
      const connected = message.slots.filter((slot) => Boolean(slot.connected)).reduce((total, slot) => total + 1, 0);
      lanDebugLog(
        'net_recv',
        { role: 'join', kind: 'lobby_state', sessionId: String(message.sessionId), playerCount: int(message.playerCount), connected: int(connected), allReady: Boolean(message.allReady), started: Boolean(message.started) },
      );
      lobby.ingestLobbyState(message);
      return;
    }
    let status: any;
    let statusUnlock: number;
    let statusUnlockFull: number;
    if (message instanceof MatchStart) {
      status = message.status;
      statusUnlock = 0;
      statusUnlockFull = 0;
      if (status !== null) {
        statusUnlock = int(status.questUnlockIndex);
        statusUnlockFull = int(status.questUnlockIndexFull);
      }
      lanDebugLog(
        'net_recv',
        { role: 'join', kind: 'match_start', sessionId: String(message.sessionId), modeId: int(message.modeId), playerCount: int(message.playerCount), seed: int(message.seed), startTick: int(message.startTick), questLevel: String(message.questLevel || ''), preserveBugs: Boolean(message.preserveBugs), statusQuestUnlockIndex: int(statusUnlock), statusQuestUnlockIndexFull: int(statusUnlockFull) },
      );
      const welcome = lobby.welcome;
      if (welcome !== null && String(welcome.sessionId || '')) {
        if ((String(message.sessionId || '')) !== (String(welcome.sessionId || ''))) {
          this._setClientError('session_id_mismatch');
          lanDebugLog(
            'net_sanity_mismatch',
            { role: 'join', kind: 'match_start', expectedSessionId: String(welcome.sessionId || ''), actualSessionId: String(message.sessionId || '') },
          );
          return;
        }
      }
      const expectedSettings = sessionSettingsForLockstep({ modeId: this.cfg.modeId, playerCount: int(this.cfg.playerCount), questLevel: this.cfg.questLevel, preserveBugs: Boolean(this.cfg.preserveBugs), tickRate: int(this.cfg.tickRate), inputDelayTicks: int(this.cfg.inputDelayTicks) });
      const matchSettings = sessionSettingsFromMatchStart(message, { tickRate: int(expectedSettings.tickRate), inputDelayTicks: int(expectedSettings.inputDelayTicks) });
      mismatched = matchSettings !== expectedSettings;
      if (mismatched) {
        this._setClientError('match_start_mismatch');
        lanDebugLog(
          'net_sanity_mismatch',
          { role: 'join', kind: 'match_start', expectedModeId: int(expectedSettings.modeId), actualModeId: int(matchSettings.modeId), expectedPlayerCount: int(expectedSettings.playerCount), actualPlayerCount: int(matchSettings.playerCount), expectedQuestLevel: String(expectedSettings.questLevel || ''), actualQuestLevel: String(matchSettings.questLevel || ''), expectedPreserveBugs: expectedSettings.preserveBugs, actualPreserveBugs: matchSettings.preserveBugs },
        );
        return;
      }

      status = message.status;
      if (status === null) {
        this._setClientError('match_start_missing_status');
        lanDebugLog(
          'net_sanity_error',
          { role: 'join', kind: 'match_start', reason: String(this.error) },
        );
        return;
      }

      lobby.ingestMatchStart(message);
      this.started = true;
      this._clientInitLockstep(message);
      return;
    }
    if (message instanceof TickFrame) {
      this._clientSeenTickFrame = true;
      const lockstep = this.clientLockstep;
      if (lockstep === null) {
        return;
      }
      const tick = int(message.tickIndex);
      if (int(tick) < 0) {
        lanDebugLog('net_sanity_error', { role: 'join', kind: 'tick_frame', reason: 'negative_tick', tickIndex: int(tick) });
        return;
      }
      const inputsLen = message.frameInputs.length;
      if (int(inputsLen) !== int(this.cfg.playerCount)) {
        lanDebugLog(
          'net_sanity_error',
          { role: 'join', kind: 'tick_frame', reason: 'frame_inputs_len', tickIndex: int(tick), inputsLen: int(inputsLen), expectedLen: int(this.cfg.playerCount) },
        );
      }
      if (int(tick) < 5 || (int(tick) % 60) === 0) {
        lanDebugLog(
          'net_recv',
          { role: 'join', kind: 'tick_frame', tickIndex: int(tick), commandCount: message.commands.length },
        );
      }
      lockstep.ingestTickFrame(message, { nowMs: int(nowMs) });
      const queuedAt = this._clientInputQueuedAtMs.get(int(tick)) ?? null;
      this._clientInputQueuedAtMs.delete(int(tick));
      if (queuedAt !== null) {
        const latencyMs = Math.max(0, int(nowMs) - int(queuedAt));
        this._clientLocalInputLatencyMs = int(latencyMs);
        if (this._clientLocalInputLatencyEwmaMs <= 0.0) {
          this._clientLocalInputLatencyEwmaMs = latencyMs;
        } else {
          this._clientLocalInputLatencyEwmaMs = this._clientLocalInputLatencyEwmaMs * 0.9 + latencyMs * 0.1;
        }
      }
      return;
    }
    if (message instanceof PauseState) {
      lanDebugLog(
        'net_recv',
        { role: 'join', kind: 'pause_state', paused: Boolean(message.paused), reason: String(message.reason || '') },
      );
      // Lobby doesn't model pause; keep for logging and future integration.
      this.clientPauseState = message;
      return;
    }
    if (message instanceof Disconnect) {
      lanDebugLog('net_recv', { role: 'join', kind: 'disconnect', reason: String(message.reason || '') });
      this._setClientError(String(message.reason || 'disconnect'));
      return;
    }
    lanDebugLog('net_recv', { role: 'join', kind: ((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(message) });
  }

  _clientSend(message: NetMessage, opts: { reliable: boolean; nowMs: number }): void {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    const link = this.clientLink;
    const host = this.clientHostAddr;
    if (link === null || host === null) {
      return;
    }
    const packet = link.buildPacket(message, { reliable: reliable, nowMs: int(nowMs) });
    try {
      this.transport.sendPacket(host, packet);
    } catch (exc) {
      return;
    }
    this._lastSendMs = int(nowMs);
    this._clientLastSendMs = int(nowMs);
    if (message instanceof KeepAlive) {
      return;
    }
    if (message instanceof DebugLogBatch) {
      // Avoid recursive log forwarding (sending logs would itself get logged).
      return;
    }
    let maxTick: number;
    let minTick: number;
    if (message instanceof InputBatch) {
      maxTick = -1;
      minTick = 2**31 - 1;
      for (const sample of message.samples) {
        const tick = int(sample.tickIndex);
        maxTick = Math.max(int(maxTick), int(tick));
        minTick = Math.min(int(minTick), int(tick));
      }
      if (maxTick >= 0 && (int(maxTick) < 5 || (int(maxTick) % 60) === 0)) {
        lanDebugLog(
          'net_send',
          { role: 'join', kind: 'input_batch', reliable: reliable, slotIndex: int(message.slotIndex), sampleCount: message.samples.length, tickMin: minTick !== 2**31 - 1 ? int(minTick) : 0, tickMax: int(maxTick) },
        );
      }
      return;
    }
    lanDebugLog('net_send', { role: 'join', kind: ((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(message), reliable: reliable });
  }

  _clientSendIdleHeartbeat(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    if (!this.started) {
      return;
    }
    const pauseState = this.clientPauseState;
    if (pauseState === null || !pauseState.paused || (String(pauseState.reason || '')) !== 'waiting_input') {
      return;
    }
    if ((int(nowMs) - int(this._clientLastSendMs)) < int(IDLE_HEARTBEAT_MS)) {
      return;
    }
    const lobby = this.clientLobby;
    const link = this.clientLink;
    if (lobby === null || link === null) {
      return;
    }
    if (int(link.pendingCount) > 0) {
      return;
    }
    this._clientSend(
      new InputBatch({ slotIndex: int(lobby.slotIndex), samples: [] }),
      { reliable: false, nowMs: int(nowMs) },
    );
  }

  _traceMetrics(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    if ((int(nowMs) - int(this._metricsLastLogMs)) < 1000) {
      return;
    }
    this._metricsLastLogMs = int(nowMs);

    const tickRate = Math.max(1, int(this.cfg.tickRate) || 1);
    const delayTicks = Math.max(0, int(this.cfg.inputDelayTicks));
    const delayMs = ftolMsI32(delayTicks * 1000.0 / tickRate);

    const role = String(this.cfg.role);
    let lockstep: HostLockstepState | null | ClientLockstepState;
    let stallMs: number;
    let captureTick: number;
    let resendsTotal: number;
    let resendsDelta: number;
    if (role === 'host') {
      lockstep = this.hostLockstep;
      const waitingFor = lockstep !== null ? int(lockstep.waitingForInputs()) : 0;
      stallMs = 0;
      if (lockstep !== null && waitingFor > 0) {
        stallMs = Math.max(0, int(nowMs) - int(lockstep.lastProgressMs));
      }

      captureTick = int(this.hostCaptureTick);
      const emitTick = lockstep !== null ? int(lockstep.nextEmitTick) : 0;
      const readyFrames = this.hostReadyTicks.length;
      const bufferedTicks = lockstep !== null ? int(lockstep.bufferedTickCount) : 0;
      const targetLeadTicks = int(captureTick) + int(delayTicks) - int(emitTick);

      const rtts = Array.from(this.hostPeers.values()).filter((peer) => peer.link.rttLastMs > 0).map((peer) => int(peer.link.rttLastMs));
      const rttMin = rtts.length > 0 ? Math.min(...rtts) : 0;
      const rttMax = rtts.length > 0 ? Math.max(...rtts) : 0;
      const pendingMax = (() => { const values = Array.from(this.hostPeers.values(), (peer) => int(peer.link.pendingCount)); return values.length === 0 ? 0 : Math.max(...values); })();
      resendsTotal = Array.from(this.hostPeers.values()).reduce((total, peer) => total + int(peer.link.resendCount), 0);
      resendsDelta = Math.max(0, int(resendsTotal) - int(this._metricsLastResendsTotal));
      this._metricsLastResendsTotal = int(resendsTotal);

      lanDebugLog(
        'net_metrics',
        { role: 'host', delayTicks: int(delayTicks), delayMs: int(delayMs), captureTick: int(captureTick), emitTick: int(emitTick), leadTicks: int(captureTick) - int(emitTick), targetLeadTicks: int(targetLeadTicks), readyFrames: int(readyFrames), bufferedTicks: int(bufferedTicks), waitingFor: int(waitingFor), stallMs: int(stallMs), rttMinMs: int(rttMin), rttMaxMs: int(rttMax), pendingMax: int(pendingMax), resendsS: int(resendsDelta), inputLatencyMs: int(this._hostLocalInputLatencyMs), inputLatencyEwmaMs: int(this._hostLocalInputLatencyEwmaMs) },
      );
      return;
    }

    const link = this.clientLink;
    lockstep = this.clientLockstep;
    const pending = link !== null ? int(link.pendingCount) : 0;
    resendsTotal = link !== null ? int(link.resendCount) : 0;
    resendsDelta = Math.max(0, int(resendsTotal) - int(this._metricsLastResendsTotal));
    this._metricsLastResendsTotal = int(resendsTotal);

    stallMs = 0;
    if (lockstep !== null && int(lockstep.bufferedFrameCount) <= 0) {
      stallMs = Math.max(0, int(nowMs) - int(lockstep.lastProgressMs));
    }

    captureTick = lockstep !== null ? int(lockstep.captureTick) : 0;
    const consumeTick = lockstep !== null ? int(lockstep.nextConsumeTick) : 0;
    const bufferedFrames = lockstep !== null ? int(lockstep.bufferedFrameCount) : 0;
    lanDebugLog(
      'net_metrics',
      { role: 'join', delayTicks: int(delayTicks), delayMs: int(delayMs), stallMs: int(stallMs), captureTick: int(captureTick), consumeTick: int(consumeTick), leadTicks: int(captureTick) - int(consumeTick), bufferedFrames: int(bufferedFrames), rttMs: link !== null ? int(link.rttLastMs) : 0, rttEwmaMs: link !== null ? int(link.rttEwmaMs) : 0, pending: int(pending), resendsS: int(resendsDelta), inputLatencyMs: int(this._clientLocalInputLatencyMs), inputLatencyEwmaMs: int(this._clientLocalInputLatencyEwmaMs) },
    );
  }

  _hostInitLockstep(event: MatchStart): void {
    const playerCount = Math.max(1, Math.min(4, int(event.playerCount)));
    this.hostLockstep = new HostLockstepState({ playerCount: int(playerCount), inputDelayTicks: int(this.cfg.inputDelayTicks) });
    this.hostCaptureTick = 0;
    this.hostReadyTicks.length = 0;
    this._pendingHostCommands.length = 0;

    // Prime initial ticks (0..delay-1) with neutral inputs so the match can start immediately.
    const delay = Math.max(0, int(this.cfg.inputDelayTicks));
    const neutral = Array.from(this._neutralInput);
    for (let tick = 0; tick < int(delay); tick++) {
      for (let slot = 0; slot < int(playerCount); slot++) {
        this.hostLockstep.submitInputSample({
          slotIndex: int(slot),
          tickIndex: int(tick),
          packedInput: Array.from(neutral),
        });
      }
    }
  }

  _clientInitLockstep(event: MatchStart): void {
    const slotIndex = int(this.localSlotIndex);
    this.clientLockstep = new ClientLockstepState({ localSlotIndex: int(slotIndex), inputDelayTicks: int(this.cfg.inputDelayTicks) });
    this.clientPauseState = null;
    this._clientSeenTickFrame = false;
  }

  setClientError(opts: { reason: string }): void;
  setClientError(reason: string): void;
  setClientError(reasonOrOpts: string | { reason: string }): void {
    const reason: string = typeof reasonOrOpts === 'object' && reasonOrOpts !== null ? reasonOrOpts.reason : reasonOrOpts as string;
    this._setClientError(reason);
  }

  abortHostMatch(opts: { reason: string; nowMs: number; addr?: PeerAddr | null }): void {
    const reason = opts.reason;
    const nowMs = opts.nowMs;
    const addr = opts.addr ?? null;
    this._abortHostMatch({ reason: reason, nowMs: nowMs, addr: addr });
  }

  clientForwardLogLine(opts: { line: string }): void;
  clientForwardLogLine(line: string): void;
  clientForwardLogLine(lineOrOpts: string | { line: string }): void {
    const line: string = typeof lineOrOpts === 'object' && lineOrOpts !== null ? lineOrOpts.line : lineOrOpts as string;
    this._clientForwardLogLine(line);
  }

  clientFlushForwardedLogs(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._clientFlushForwardedLogs({ nowMs: nowMs });
  }

  hostWriteRemoteLogBatch(opts: { addr: PeerAddr; slotIndex: number; lines: string[] }): void {
    const addr = opts.addr;
    const slotIndex = opts.slotIndex;
    const lines = opts.lines;
    this._hostWriteRemoteLogBatch({ addr: addr, slotIndex: slotIndex, lines: lines });
  }

  updateHost(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._updateHost({ nowMs: nowMs });
  }

  handleHostMessage(addr: PeerAddr, message: NetMessage, opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._handleHostMessage(addr, message, { nowMs: nowMs });
  }

  hostSend(addr: PeerAddr, message: NetMessage, opts: { reliable: boolean; nowMs: number; trackPeer?: boolean }): void {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    const trackPeer = opts.trackPeer ?? true;
    this._hostSend(addr, message, { reliable: reliable, nowMs: nowMs, trackPeer: trackPeer });
  }

  hostBroadcast(message: NetMessage, opts: { reliable: boolean; nowMs: number }): void {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    this._hostBroadcast(message, { reliable: reliable, nowMs: nowMs });
  }

  hostBroadcastLobbyState(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._hostBroadcastLobbyState({ nowMs: nowMs });
  }

  updateClient(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._updateClient({ nowMs: nowMs });
  }

  handleClientMessage(message: NetMessage, opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._handleClientMessage(message, { nowMs: nowMs });
  }

  clientSend(message: NetMessage, opts: { reliable: boolean; nowMs: number }): void {
    const reliable = opts.reliable;
    const nowMs = opts.nowMs;
    this._clientSend(message, { reliable: reliable, nowMs: nowMs });
  }

  clientSendIdleHeartbeat(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._clientSendIdleHeartbeat({ nowMs: nowMs });
  }

  traceMetrics(opts: { nowMs: number }): void {
    const nowMs = opts.nowMs;
    this._traceMetrics({ nowMs: nowMs });
  }

  hostInitLockstep(event: MatchStart): void {
    this._hostInitLockstep(event);
  }

  clientInitLockstep(event: MatchStart): void {
    this._clientInitLockstep(event);
  }
}

export class HostLockstepRuntimeConfig extends LockstepRuntimeConfigBase {
  role: "host" = 'host';
}

export class JoinLockstepRuntimeConfig extends LockstepRuntimeConfigBase {
  role: "join" = 'join';
}

function _nowMs(): number {
  return int((performance.now() / 1000) * 1000.0);
}

// The host is authoritative and doesn't need to queue inputs far ahead. Keeping
// the host capture clock close to lockstep progress avoids persistent host-side
// input lag if the host stalls briefly and then "runs behind" real time.
const HOST_MAX_CAPTURE_LEAD_TICKS = 1;
// Best-effort debug log mirroring from clients to host.
const CLIENT_LOG_FORWARD_FLUSH_MS = 200;
const CLIENT_LOG_FORWARD_MAX_QUEUE_LINES = 5000;
const CLIENT_LOG_FORWARD_MAX_LINES_PER_BATCH = 50;
// Keep under common MTU to avoid fragmentation (msgpack overhead not accounted).
const CLIENT_LOG_FORWARD_MAX_CHARS_PER_BATCH = 900;
// `LINK_TIMEOUT_MS` is tuned for responsive LAN failure detection, but gameplay
// view transitions can include multi-second stalls (e.g. terrain generation).
// Use a more forgiving timeout until lockstep traffic is flowing.
const LOADING_LINK_TIMEOUT_MS = 10_000;
const KEEPALIVE_INTERVAL_MS = 250;
// During intentional gameplay pauses (e.g. perk selection) peers can stop
// producing fresh inputs for longer than the normal 1s failure timeout.
const PAUSED_LINK_TIMEOUT_MS = 60_000;
// Bound socket drain work per update to avoid frame-time spikes under burst traffic.
const MAX_RECV_PACKETS_PER_UPDATE = 512;
// When gameplay is paused and no new inputs are generated, periodically send a
// tiny no-op batch so ACK progression and timeout tracking stay alive.
const IDLE_HEARTBEAT_MS = 250;
