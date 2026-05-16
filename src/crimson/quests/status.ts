// Port of crimson/quests/status.py

import type { QuestLevel } from '@crimson/quests/level.ts';

// `game.cfg.quest_play_counts` only has dedicated quest slots for quests 1.1..4.10:
// - attempts live at indices 11..50
// - completions live at indices 51..90
// Stage 5 has no dedicated slots in the original blob layout, so callers that
// need the "tracked in save data" subset must use the `tracked_...` helpers
// instead of the raw offset helpers below.
export const QUEST_STATUS_GAMES_OFFSET = 11;
export const QUEST_STATUS_COMPLETED_OFFSET = 51;
export const QUEST_STATUS_TRACKED_COUNT = 40;

export function questGamesCounterIndex(level: QuestLevel): number {
  return Math.trunc(level.globalIndex) + QUEST_STATUS_GAMES_OFFSET;
}

export function trackedQuestGamesCounterIndex(level: QuestLevel): number | null {
  // Return the persisted attempts slot for quest levels that fit in game.cfg.

  if (!questTrackedInStatus(level)) {
    return null;
  }
  return questGamesCounterIndex(level);
}

export function questCompletedCounterIndex(level: QuestLevel): number {
  return Math.trunc(level.globalIndex) + QUEST_STATUS_COMPLETED_OFFSET;
}

export function questTrackedInStatus(level: QuestLevel): boolean {
  return Math.trunc(level.globalIndex) < QUEST_STATUS_TRACKED_COUNT;
}

export function trackedQuestCompletedCounterIndex(level: QuestLevel): number | null {
  // Return the persisted completion slot for quest levels that fit in game.cfg.

  if (!questTrackedInStatus(level)) {
    return null;
  }
  return questCompletedCounterIndex(level);
}
