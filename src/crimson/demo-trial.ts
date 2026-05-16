// Port of crimson/demo_trial.py

import { GameMode } from '@crimson/game-modes.ts';
import type { QuestLevel } from '@crimson/quests/level.ts';

export const DEMO_TOTAL_PLAY_TIME_MS = 2_400_000;
export const DEMO_QUEST_GRACE_TIME_MS = 300_000;

export class DemoTrialOverlayInfo {
  readonly visible: boolean;
  readonly kind: string; // "none" | "quest_tier_limit" | "quest_grace_left" | "time_up"
  readonly remainingMs: number;
  readonly remainingLabel: string;
  readonly showRemainingLine: boolean;

  constructor(opts: {
    visible: boolean;
    kind: string;
    remainingMs: number;
    remainingLabel: string;
    showRemainingLine: boolean;
  }) {
    this.visible = opts.visible;
    this.kind = opts.kind;
    this.remainingMs = opts.remainingMs;
    this.remainingLabel = opts.remainingLabel;
    this.showRemainingLine = opts.showRemainingLine;
  }
}

export function formatDemoTrialTime(ms: number): string {
  let value = int(ms);
  if (value < 0) {
    value = 0;
  }
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.floor(value / 1_000) % 60;
  const centiseconds = Math.floor((value % 1_000) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

export function tickDemoTrialTimers(opts: { demoBuild: boolean; gameModeId: GameMode; overlayVisible: boolean; globalPlaytimeMs: number; questGraceElapsedMs: number; dtMs: number }): [number, number] {
  // Advance demo timers by `dt_ms` (ms), returning updated values.
  //
  // This mirrors the classic behavior where:
  //   - global playtime accumulates until it hits `DEMO_TOTAL_PLAY_TIME_MS`, then clamps
  //   - once global time is exhausted, a quest-only grace timer becomes active
  //   - timers do not advance while the demo trial overlay is shown

  const demoBuild = opts.demoBuild;
  const gameModeId = opts.gameModeId;
  const overlayVisible = opts.overlayVisible;
  const globalPlaytimeMs = opts.globalPlaytimeMs;
  const questGraceElapsedMs = opts.questGraceElapsedMs;
  const dtMs = opts.dtMs;
  if (!demoBuild) {
    return [int(globalPlaytimeMs), int(questGraceElapsedMs)];
  }

  switch (gameModeId) {
    case GameMode.TUTORIAL:
      return [int(globalPlaytimeMs), int(questGraceElapsedMs)];
    default:
      break;
  }
  let usedMs = Math.max(0, int(globalPlaytimeMs));
  let graceMs = Math.max(0, int(questGraceElapsedMs));
  if (usedMs >= DEMO_TOTAL_PLAY_TIME_MS && graceMs < 1) {
    graceMs = 1;
  }
  usedMs = Math.min(DEMO_TOTAL_PLAY_TIME_MS, usedMs);

  if (overlayVisible) {
    return [int(usedMs), int(graceMs)];
  }

  const deltaMs = int(dtMs);
  if (deltaMs <= 0) {
    return [int(usedMs), int(graceMs)];
  }

  usedMs = Math.min(DEMO_TOTAL_PLAY_TIME_MS, usedMs + deltaMs);
  if (usedMs >= DEMO_TOTAL_PLAY_TIME_MS && graceMs < 1) {
    graceMs = 1;
  }

  if (graceMs > 0) {
    switch (gameModeId) {
      case GameMode.QUESTS:
        graceMs += deltaMs;
        break;
      default:
        break;
    }
  }
  return [int(usedMs), int(graceMs)];
}

export function demoTrialOverlayInfo(opts: { demoBuild: boolean; gameModeId: GameMode; globalPlaytimeMs: number; questGraceElapsedMs: number; questLevel: QuestLevel | null }): DemoTrialOverlayInfo {
  // Compute demo trial overlay status.
  //
  // Modeled after `demo_trial_overlay_render` (0x004047c0) call sites and time formatting.
  //
  // Notes:
  //   - `global_playtime_ms` maps to `game_status_blob.game_sequence_id` (ms).
  //   - `quest_grace_elapsed_ms` maps to `demo_trial_elapsed_ms` (ms) once activated.

  const demoBuild = opts.demoBuild;
  const gameModeId = opts.gameModeId;
  const globalPlaytimeMs = opts.globalPlaytimeMs;
  const questGraceElapsedMs = opts.questGraceElapsedMs;
  const questLevel = opts.questLevel;
  if (!demoBuild) {
    return new DemoTrialOverlayInfo({ visible: false, kind: 'none', remainingMs: 0, remainingLabel: formatDemoTrialTime(0), showRemainingLine: false });
  }

  switch (gameModeId) {
    case GameMode.TUTORIAL: // tutorial
      return new DemoTrialOverlayInfo({ visible: false, kind: 'none', remainingMs: 0, remainingLabel: formatDemoTrialTime(0), showRemainingLine: false });
    default:
      break;
  }
  const usedMs = Math.max(0, int(globalPlaytimeMs));
  const graceMs = Math.max(0, int(questGraceElapsedMs));

  const globalRemainingMs = Math.max(0, DEMO_TOTAL_PLAY_TIME_MS - usedMs);
  const graceRemainingMs = Math.max(0, DEMO_QUEST_GRACE_TIME_MS - graceMs);

  const tierLocked = gameModeId === GameMode.QUESTS && questLevel !== null && (int(questLevel.major) > 1 || int(questLevel.minor) > 10);

  if (graceMs > 0) {
    if (graceRemainingMs <= 0) {
      return new DemoTrialOverlayInfo({ visible: true, kind: 'time_up', remainingMs: 0, remainingLabel: formatDemoTrialTime(0), showRemainingLine: false });
    }
    if (tierLocked) {
      return new DemoTrialOverlayInfo({ visible: true, kind: 'quest_tier_limit', remainingMs: int(graceRemainingMs), remainingLabel: formatDemoTrialTime(graceRemainingMs), showRemainingLine: false });
    }
    // During the quest-only grace period, the classic demo blocks other modes
    // and points the player back to Quests.
    if (gameModeId !== GameMode.QUESTS) {
      return new DemoTrialOverlayInfo({ visible: true, kind: 'quest_grace_left', remainingMs: int(graceRemainingMs), remainingLabel: formatDemoTrialTime(graceRemainingMs), showRemainingLine: false });
    }
    return new DemoTrialOverlayInfo({ visible: false, kind: 'none', remainingMs: int(graceRemainingMs), remainingLabel: formatDemoTrialTime(graceRemainingMs), showRemainingLine: false });
  }

  if (globalRemainingMs <= 0) {
    return new DemoTrialOverlayInfo({ visible: true, kind: 'time_up', remainingMs: 0, remainingLabel: formatDemoTrialTime(0), showRemainingLine: false });
  }

  // Demo tier gating: the classic demo lets you play stage 1 quests only; once
  // the player reaches stage > 1, it shows the upsell overlay even if time remains.
  if (tierLocked) {
    return new DemoTrialOverlayInfo({ visible: true, kind: 'quest_tier_limit', remainingMs: int(globalRemainingMs), remainingLabel: formatDemoTrialTime(globalRemainingMs), showRemainingLine: true });
  }

  return new DemoTrialOverlayInfo({ visible: false, kind: 'none', remainingMs: int(globalRemainingMs), remainingLabel: formatDemoTrialTime(globalRemainingMs), showRemainingLine: false });
}
