// Port of crimson/replay/driver/replay_info.py

import { BonusId, bonusDisplayName } from '@crimson/bonuses/ids.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { perkDisplayName } from '@crimson/perks/ids.ts';
import type { Replay } from '@crimson/replay/index.ts';
import { TickResult } from '@crimson/sim/hooks.ts';
import type { GameCommand } from '@crimson/sim/input-providers.ts';
import { PerkMenuOpenCommand } from '@crimson/sim/input-providers.ts';
import type { BonusPickupEvent } from '@crimson/sim/state-types.ts';
import { PlayerState } from '@crimson/sim/state-types.ts';
import type { WeaponId } from '@crimson/weapons.ts';
import { weaponDisplayName } from '@crimson/weapons.ts';
import type { PlaybackDriver } from '@crimson/replay/driver/playback-driver.ts';
import { PlaybackWalkHooks } from '@crimson/replay/driver/playback-driver.ts';
import { ReplayRunnerError } from '@crimson/replay/driver/setup.ts';

export type ReplayInfoCoreEventKind = "bonus_pickup" | "weapon_change" | "perk_pick" | "level_up" | "health_damage" | "health_heal" | "player_death";
export type ReplayInfoExtraEventKind = "creature_deaths" | "perk_menu_open";
export type ReplayInfoEventKind = ReplayInfoCoreEventKind | ReplayInfoExtraEventKind;

const _EPSILON = 1e-6;
export const CORE_EVENT_KINDS: ReadonlySet<ReplayInfoCoreEventKind> = new Set([
  'bonus_pickup',
  'weapon_change',
  'perk_pick',
  'level_up',
  'health_damage',
  'health_heal',
  'player_death',
]);

export class ReplayInfoTimelineEvent {
  readonly tickIndex: number;
  readonly elapsedMs: number;
  readonly kind: ReplayInfoEventKind;
  readonly playerIndex: number | null;
  readonly detail: string;
  readonly data: Record<string, unknown>;

  constructor(opts: {
    tickIndex: number;
    elapsedMs: number;
    kind: ReplayInfoEventKind;
    playerIndex: number | null;
    detail: string;
    data: Record<string, unknown>;
  }) {
    this.tickIndex = opts.tickIndex;
    this.elapsedMs = opts.elapsedMs;
    this.kind = opts.kind;
    this.playerIndex = opts.playerIndex;
    this.detail = opts.detail;
    this.data = opts.data;
  }
}

export class ReplayInfoResult {
  readonly gameModeId: GameMode;
  readonly tickRate: number;
  readonly ticksSimulated: number;
  readonly elapsedMs: number;
  readonly playerCount: number;
  readonly timeline: ReplayInfoTimelineEvent[];

  constructor(opts: {
    gameModeId: GameMode;
    tickRate: number;
    ticksSimulated: number;
    elapsedMs: number;
    playerCount: number;
    timeline: ReplayInfoTimelineEvent[];
  }) {
    this.gameModeId = opts.gameModeId;
    this.tickRate = opts.tickRate;
    this.ticksSimulated = opts.ticksSimulated;
    this.elapsedMs = opts.elapsedMs;
    this.playerCount = opts.playerCount;
    this.timeline = opts.timeline;
  }
}

export class PlayerSnapshot {
  readonly health: number;
  readonly level: number;
  readonly experience: number;
  readonly weaponId: WeaponId;
  readonly perkCounts: readonly number[];

  constructor(opts: {
    health: number;
    level: number;
    experience: number;
    weaponId: WeaponId;
    perkCounts: readonly number[];
  }) {
    this.health = opts.health;
    this.level = opts.level;
    this.experience = opts.experience;
    this.weaponId = opts.weaponId;
    this.perkCounts = opts.perkCounts;
  }
}

function captureSnapshots(players: PlayerState[]): PlayerSnapshot[] {
  const snapshots: PlayerSnapshot[] = [];
  for (const player of players) {
    snapshots.push(new PlayerSnapshot({ health: player.health, level: player.level, experience: player.experience, weaponId: player.weapon.weaponId, perkCounts: Array.from(player.perkCounts) }));
  }
  return snapshots;
}

function appendEvent(timeline: ReplayInfoTimelineEvent[], opts: { tickIndex: number; elapsedMs: number; kind: ReplayInfoEventKind; playerIndex: number | null; detail: string; data: Record<string, unknown>; playerFilter: number | null; includeExtraEvents: boolean }): void {
  const tickIndex = opts.tickIndex;
  const elapsedMs = opts.elapsedMs;
  const kind = opts.kind;
  const playerIndex = opts.playerIndex;
  const detail = opts.detail;
  const data = opts.data;
  const playerFilter = opts.playerFilter;
  const includeExtraEvents = opts.includeExtraEvents;
  if (!(CORE_EVENT_KINDS as ReadonlySet<unknown>).has(kind) && !includeExtraEvents) {
    return;
  }
  if (playerFilter !== null && playerIndex !== null && playerIndex !== playerFilter) {
    return;
  }
  timeline.push(new ReplayInfoTimelineEvent({ tickIndex: tickIndex, elapsedMs: elapsedMs, kind: kind, playerIndex: playerIndex, detail: detail, data: data }));
}

function appendExtraReplayCommands(opts: { commands: GameCommand[]; tickIndex: number; elapsedMs: number; timeline: ReplayInfoTimelineEvent[]; playerFilter: number | null; includeExtraEvents: boolean }): void {
  const commands = opts.commands;
  const tickIndex = opts.tickIndex;
  const elapsedMs = opts.elapsedMs;
  const timeline = opts.timeline;
  const playerFilter = opts.playerFilter;
  const includeExtraEvents = opts.includeExtraEvents;
  if (!includeExtraEvents) {
    return;
  }
  for (const cmd of commands) {
    if (cmd instanceof PerkMenuOpenCommand) {
      appendEvent(
        timeline,
        { tickIndex: tickIndex, elapsedMs: elapsedMs, kind: 'perk_menu_open', playerIndex: cmd.playerIndex, detail: `p${cmd.playerIndex} perk menu opened`, data: { 'player_index': cmd.playerIndex }, playerFilter: playerFilter, includeExtraEvents: true },
      );
    }
  }
}

function appendBonusPickupEvents(opts: { tickIndex: number; elapsedMs: number; timeline: ReplayInfoTimelineEvent[]; pickups: BonusPickupEvent[]; preserveBugs: boolean; playerFilter: number | null; includeExtraEvents: boolean }): void {
  const tickIndex = opts.tickIndex;
  const elapsedMs = opts.elapsedMs;
  const timeline = opts.timeline;
  const pickups = opts.pickups;
  const preserveBugs = opts.preserveBugs;
  const playerFilter = opts.playerFilter;
  const includeExtraEvents = opts.includeExtraEvents;
  for (const pickup of pickups) {
    const bonusId = pickup.bonusId;
    const bonusName = bonusDisplayName(bonusId, { preserveBugs: preserveBugs });
    let detail = `p${pickup.playerIndex} picked ${bonusName} (${bonusId}) amount=${pickup.amount}`;
    const data: Record<string, unknown> = { "bonus_id": bonusId, "bonus_name": bonusName, "amount": pickup.amount };
    if (bonusId === BonusId.WEAPON) {
      const weaponId = pickup.amount;
      const weaponName = weaponDisplayName(weaponId, { preserveBugs: preserveBugs });
      detail += ` -> ${weaponName}`;
      data['weapon_id'] = weaponId;
      data['weapon_name'] = weaponName;
    }
    appendEvent(
      timeline,
      { tickIndex: tickIndex, elapsedMs: elapsedMs, kind: 'bonus_pickup', playerIndex: pickup.playerIndex, detail: detail, data: data, playerFilter: playerFilter, includeExtraEvents: includeExtraEvents },
    );
  }
}

function appendSnapshotDiffEvents(opts: { tickIndex: number; elapsedMs: number; before: PlayerSnapshot[]; after: PlayerSnapshot[]; timeline: ReplayInfoTimelineEvent[]; preserveBugs: boolean; violenceDisabled: number; playerFilter: number | null; includeExtraEvents: boolean }): void {
  const tickIndex = opts.tickIndex;
  const elapsedMs = opts.elapsedMs;
  const before = opts.before;
  const after = opts.after;
  const timeline = opts.timeline;
  const preserveBugs = opts.preserveBugs;
  const violenceDisabled = opts.violenceDisabled;
  const playerFilter = opts.playerFilter;
  const includeExtraEvents = opts.includeExtraEvents;
  const playersLen = Math.min(before.length, after.length);
  for (let idx = 0; idx < playersLen; idx++) {
    const pre = before[idx];
    const post = after[idx];

    if (pre.weaponId !== post.weaponId) {
      const weaponBeforeName = weaponDisplayName(pre.weaponId, { preserveBugs: preserveBugs });
      const weaponAfterName = weaponDisplayName(post.weaponId, { preserveBugs: preserveBugs });
      appendEvent(
        timeline,
        { tickIndex: tickIndex, elapsedMs: elapsedMs, kind: 'weapon_change', playerIndex: idx, detail: `p${idx} weapon ${weaponBeforeName} -> ${weaponAfterName}`, data: { "weapon_id_before": pre.weaponId, "weapon_name_before": weaponBeforeName, "weapon_id_after": post.weaponId, "weapon_name_after": weaponAfterName }, playerFilter: playerFilter, includeExtraEvents: includeExtraEvents },
      );
    }

    if (post.level > pre.level) {
      appendEvent(
        timeline,
        { tickIndex: tickIndex, elapsedMs: elapsedMs, kind: 'level_up', playerIndex: idx, detail: `p${idx} level ${pre.level} -> ${post.level} (xp=${post.experience})`, data: { "level_before": pre.level, "level_after": post.level, "xp": post.experience }, playerFilter: playerFilter, includeExtraEvents: includeExtraEvents },
      );
    }

    const perkLen = Math.min(pre.perkCounts.length, post.perkCounts.length);
    for (let perkId = 0; perkId < perkLen; perkId++) {
      const beforeCount = pre.perkCounts[perkId];
      const afterCount = post.perkCounts[perkId];
      if (afterCount <= beforeCount) {
        continue;
      }
      const perkName = perkDisplayName(perkId, { violenceDisabled: violenceDisabled, preserveBugs: preserveBugs });
      appendEvent(
        timeline,
        { tickIndex: tickIndex, elapsedMs: elapsedMs, kind: 'perk_pick', playerIndex: idx, detail: `p${idx} perk ${perkName} (${perkId}) x${afterCount}`, data: { "perk_id": perkId, "perk_name": perkName, "count_before": beforeCount, "count_after": afterCount }, playerFilter: playerFilter, includeExtraEvents: includeExtraEvents },
      );
    }

    const healthBefore = pre.health;
    const healthAfter = post.health;
    let amount: number;
    if (healthAfter < healthBefore - _EPSILON) {
      amount = healthBefore - healthAfter;
      appendEvent(
        timeline,
        { tickIndex: tickIndex, elapsedMs: elapsedMs, kind: 'health_damage', playerIndex: idx, detail: `p${idx} damage ${amount.toFixed(6)} (health ${healthBefore.toFixed(6)}->${healthAfter.toFixed(6)})`, data: { "amount": amount, "health_before": healthBefore, "health_after": healthAfter }, playerFilter: playerFilter, includeExtraEvents: includeExtraEvents },
      );
    } else if (healthAfter > healthBefore + _EPSILON) {
      amount = healthAfter - healthBefore;
      appendEvent(
        timeline,
        { tickIndex: tickIndex, elapsedMs: elapsedMs, kind: 'health_heal', playerIndex: idx, detail: `p${idx} heal ${amount.toFixed(6)} (health ${healthBefore.toFixed(6)}->${healthAfter.toFixed(6)})`, data: { "amount": amount, "health_before": healthBefore, "health_after": healthAfter }, playerFilter: playerFilter, includeExtraEvents: includeExtraEvents },
      );
    }

    if (healthBefore > 0.0 && healthAfter <= 0.0) {
      appendEvent(
        timeline,
        { tickIndex: tickIndex, elapsedMs: elapsedMs, kind: 'player_death', playerIndex: idx, detail: `p${idx} died (health ${healthBefore.toFixed(6)}->${healthAfter.toFixed(6)})`, data: { "health_before": healthBefore, "health_after": healthAfter }, playerFilter: playerFilter, includeExtraEvents: includeExtraEvents },
      );
    }
  }
}

function validatePlayerFilter(opts: { replay: Replay; playerIndex: number | null }): number | null {
  const replay = opts.replay;
  const playerIndex = opts.playerIndex;
  if (playerIndex === null) {
    return null;
  }
  if (playerIndex < 0) {
    throw new ReplayRunnerError(`invalid player_index filter: ${playerIndex}`);
  }
  if (replay.header.playerCount > 0 && playerIndex >= replay.header.playerCount) {
    throw new ReplayRunnerError(`player_index filter out of range: ${playerIndex} (player_count=${replay.header.playerCount})`);
  }
  return playerIndex;
}

export function collectReplayInfo(driver: PlaybackDriver, opts: { playerIndex?: number | null; includeExtraEvents?: boolean } = {}): ReplayInfoResult {
  const playerIndex = opts.playerIndex ?? null;
  const includeExtraEvents = opts.includeExtraEvents ?? true;
  const replay = driver.replay;
  const mode = driver.modeId;
  const playerFilter = validatePlayerFilter({ replay: replay, playerIndex: playerIndex });
  const timeline: ReplayInfoTimelineEvent[] = [];
  let before: PlayerSnapshot[] | null = null;

  const _appendTick = (tickResult: TickResult, opts: { afterPlayers: PlayerState[]; before: PlayerSnapshot[] }): void => {
    const afterPlayers = opts.afterPlayers;
    const before = opts.before;
    const sourceTick = tickResult.sourceTick;
    const tick = tickResult.payload;
    const after = captureSnapshots(afterPlayers);

    const elapsedMs = int(tick.elapsedMs);
    if (mode !== GameMode.RUSH) {
      appendExtraReplayCommands({
        commands: sourceTick.commands,
        tickIndex: int(sourceTick.tickIndex),
        elapsedMs: elapsedMs,
        timeline: timeline,
        playerFilter: playerFilter,
        includeExtraEvents: includeExtraEvents,
      });
    }

    appendBonusPickupEvents({
      tickIndex: int(sourceTick.tickIndex),
      elapsedMs: elapsedMs,
      timeline: timeline,
      pickups: tick.step.events.pickups,
      preserveBugs: replay.header.preserveBugs,
      playerFilter: playerFilter,
      includeExtraEvents: includeExtraEvents,
    });

    if (tick.step.events.deaths.length > 0) {
      appendEvent(
        timeline,
        { tickIndex: int(sourceTick.tickIndex), elapsedMs: elapsedMs, kind: 'creature_deaths', playerIndex: null, detail: `creature deaths=${tick.step.events.deaths.length}`, data: { 'count': tick.step.events.deaths.length }, playerFilter: playerFilter, includeExtraEvents: includeExtraEvents },
      );
    }

    appendSnapshotDiffEvents({
      tickIndex: int(sourceTick.tickIndex),
      elapsedMs: elapsedMs,
      before: before,
      after: after,
      timeline: timeline,
      preserveBugs: replay.header.preserveBugs,
      violenceDisabled: replay.header.violenceDisabled,
      playerFilter: playerFilter,
      includeExtraEvents: includeExtraEvents,
    });
  };

  const _beforeTick = (tickIndex: number, world: any, dtTick: number): void => {
    before = captureSnapshots(world.players);
  };

  const _afterTick = (tickResult: TickResult, world: any): void => {
    if (!(before !== null)) throw new Error('missing pre-step replay snapshot');
    _appendTick(tickResult, { afterPlayers: world.players, before: before });
  };

  const walkResult = driver.walkTicks({ hooks: new PlaybackWalkHooks({ beforeTick: _beforeTick, afterTick: _afterTick }) });
  const runResult = driver.buildRunResult({ ticks: int(walkResult.ticksCompleted) });

  return new ReplayInfoResult({ gameModeId: mode, tickRate: replay.header.tickRate, ticksSimulated: int(walkResult.ticksCompleted), elapsedMs: int(runResult.elapsedMs), playerCount: driver.world.players.length, timeline: timeline });
}

export function eventCountsByKind(timeline: ReplayInfoTimelineEvent[]): Map<string, number> {
  const counts: Map<ReplayInfoEventKind, number> = new Map();
  for (const event of timeline) {
    counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
  }
  return new Map(Object.entries(Object.fromEntries(Array.from(Array.from(counts.entries()).sort((left, right) => left < right ? -1 : left > right ? 1 : 0), ([kind, count]) => [String(kind), int(count)] as const))));
}
