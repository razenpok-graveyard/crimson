// Port of crimson/net/lockstep_lobby.py

import type { GameMode } from '@crimson/game-modes.ts';
import type { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';
import type { Hello, MatchStart, Ready } from '@crimson/net/lockstep-protocol.ts';
import { PROTOCOL_VERSION, LobbySlot, LobbyState, Welcome, buildsCompatible } from '@crimson/net/lockstep-protocol.ts';
import type { LockstepSessionSettings } from '@crimson/net/session-settings.ts';
import { matchStartFromSessionSettings, sessionSettingsForLockstep, welcomeFromSessionSettings } from '@crimson/net/session-settings.ts';
import type { PeerAddr } from '@crimson/net/transport.ts';

function tupleKey(value: readonly unknown[] | string): string {
  return typeof value === 'string' ? value : value.join(',');
}

export class HostPeer {
  addr: PeerAddr;
  slotIndex: number;
  ready: boolean;
  peerName: string;

  constructor(opts: {
    addr: PeerAddr;
    slotIndex: number;
    ready?: boolean;
    peerName?: string;
  }) {
    this.addr = opts.addr;
    this.slotIndex = opts.slotIndex;
    this.ready = opts.ready ?? false;
    this.peerName = opts.peerName ?? '';
  }
}

export class HostLobby {
  modeId: GameMode;
  playerCount: number;
  buildId: string;
  tickRate: number;
  inputDelayTicks: number;
  questLevel: QuestLevel | null;
  preserveBugs: boolean;
  sessionId: string;
  started: boolean;
  hostReady: boolean;
  peersByAddr: Map<string, HostPeer>;

  constructor(opts: {
    modeId: GameMode;
    playerCount: number;
    buildId: string;
    tickRate: number;
    inputDelayTicks: number;
    questLevel?: QuestLevel | null;
    preserveBugs?: boolean;
    sessionId?: string;
    started?: boolean;
    hostReady?: boolean;
    peersByAddr?: Map<string, HostPeer>;
  }) {
    this.modeId = opts.modeId;
    this.playerCount = opts.playerCount;
    this.buildId = opts.buildId;
    this.tickRate = opts.tickRate;
    this.inputDelayTicks = opts.inputDelayTicks;
    this.questLevel = opts.questLevel ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.sessionId = opts.sessionId ?? globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    this.started = opts.started ?? false;
    this.hostReady = opts.hostReady ?? true;
    this.peersByAddr = opts.peersByAddr ?? new Map();
  }

  sessionSettings(): LockstepSessionSettings {
    return sessionSettingsForLockstep({ modeId: this.modeId, playerCount: int(this.playerCount), questLevel: this.questLevel, preserveBugs: this.preserveBugs, tickRate: int(this.tickRate), inputDelayTicks: int(this.inputDelayTicks) });
  }

  _nextFreeSlot(): number | null {
    const used = new Set([0]);
    for (const peer of this.peersByAddr.values()) {
      used.add(int(peer.slotIndex));
    }
    for (let slot = 1; slot < int(this.playerCount); slot++) {
      if (!((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(used, slot)) {
        return int(slot);
      }
    }
    return null;
  }

  processHello(addr: PeerAddr, hello: Hello): Welcome {
    if (this.started) {
      return new Welcome({ accepted: false, reason: 'match_already_started' });
    }
    if (int(hello.protocolVersion) !== int(PROTOCOL_VERSION)) {
      return new Welcome({ accepted: false, reason: 'protocol_mismatch' });
    }
    if (!buildsCompatible(String(hello.buildId), String(this.buildId))) {
      return new Welcome({ accepted: false, reason: 'build_mismatch' });
    }
    if (hello.host) {
      return new Welcome({ accepted: false, reason: 'hello_host_flag' });
    }

    let peer = this.peersByAddr.get(tupleKey(addr)) ?? null;
    if (peer === null) {
      const slot = this._nextFreeSlot();
      if (slot === null) {
        return new Welcome({ accepted: false, reason: 'lobby_full' });
      }
      peer = new HostPeer({ addr: addr, slotIndex: int(slot), ready: false });
      this.peersByAddr.set(tupleKey(addr), peer);
    }

    return welcomeFromSessionSettings(this.sessionSettings(), { accepted: true, reason: '', sessionId: String(this.sessionId), protocolVersion: int(PROTOCOL_VERSION), buildId: String(this.buildId), slotIndex: int(peer.slotIndex), hostSlotIndex: 0, seed: 0, started: this.started });
  }

  processReady(addr: PeerAddr, ready: Ready): void {
    const peer = this.peersByAddr.get(tupleKey(addr)) ?? null;
    if (peer === null) {
      return;
    }
    if (int(ready.slotIndex) !== int(peer.slotIndex)) {
      return;
    }
    peer.ready = ready.ready;
  }

  allConnected(): boolean {
    if (int(this.playerCount) <= 1) {
      return true;
    }
    return this.peersByAddr.size >= (int(this.playerCount) - 1);
  }

  allReady(): boolean {
    if (!this.hostReady) {
      return false;
    }
    if (!this.allConnected()) {
      return false;
    }
    for (const peer of this.peersByAddr.values()) {
      if (!peer.ready) {
        return false;
      }
    }
    return true;
  }

  slotForAddr(addr: PeerAddr): number | null {
    const peer = this.peersByAddr.get(tupleKey(addr)) ?? null;
    if (peer === null) {
      return null;
    }
    return int(peer.slotIndex);
  }

  lobbyState(): LobbyState {
    const slots: LobbySlot[] = [];
    for (let slot = 0; slot < int(this.playerCount); slot++) {
      if (slot === 0) {
        slots.push(new LobbySlot({ slotIndex: 0, connected: true, ready: this.hostReady, isHost: true, peerName: 'host' }));
        continue;
      }
      const peer = (() => { for (const p of this.peersByAddr.values()) { if (int(p.slotIndex) === slot) return p; } return null; })();
      if (peer === null) {
        slots.push(new LobbySlot({ slotIndex: int(slot), connected: false, ready: false, isHost: false, peerName: '' }));
        continue;
      }
      slots.push(new LobbySlot({ slotIndex: int(slot), connected: true, ready: peer.ready, isHost: false, peerName: String(peer.peerName) }));
    }
    return new LobbyState({ sessionId: String(this.sessionId), modeId: this.modeId, playerCount: int(this.playerCount), slots: slots, allReady: this.allReady(), started: this.started, questLevel: this.questLevel });
  }

  startMatch(opts: { seed: number; startTick?: number; status?: GameStatusData | null }): MatchStart {
    const seed = opts.seed;
    const startTick = opts.startTick ?? 0;
    const status = opts.status ?? null;
    this.started = true;
    return matchStartFromSessionSettings(this.sessionSettings(), { sessionId: String(this.sessionId), seed: int(seed), startTick: int(startTick), status: status });
  }
}

export class ClientLobby {
  buildId: string;
  hello: Hello;
  welcome: Welcome | null;
  lobbyStateLatest: LobbyState | null;
  matchStart: MatchStart | null;

  constructor(opts: {
    buildId: string;
    hello: Hello;
    welcome?: Welcome | null;
    lobbyStateLatest?: LobbyState | null;
    matchStart?: MatchStart | null;
  }) {
    this.buildId = opts.buildId;
    this.hello = opts.hello;
    this.welcome = opts.welcome ?? null;
    this.lobbyStateLatest = opts.lobbyStateLatest ?? null;
    this.matchStart = opts.matchStart ?? null;
  }

  get slotIndex(): number {
    const welcome = this.welcome;
    if (welcome === null) {
      return -1;
    }
    return int(welcome.slotIndex);
  }

  get joined(): boolean {
    const welcome = this.welcome;
    return welcome !== null && welcome.accepted;
  }

  get started(): boolean {
    return this.matchStart !== null;
  }

  ingestWelcome(welcome: Welcome): void {
    this.welcome = welcome;
  }

  ingestLobbyState(state: LobbyState): void {
    this.lobbyStateLatest = state;
  }

  ingestMatchStart(event: MatchStart): void {
    this.matchStart = event;
  }
}
