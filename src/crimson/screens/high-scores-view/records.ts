// Port of crimson/screens/high_scores_view/records.py

import type { GameState, HighScoresRequest } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import { type HighScoreRecord, highscoreDateChecksum, readHighscoreTable, scoresPathForMode } from '@crimson/persistence/highscores.ts';

export function resolveRequest(state: GameState): HighScoresRequest {
  let request = state.pendingHighScores;
  state.pendingHighScores = null;
  if (request === null) {
    request = {
      gameModeId: state.config.gameplay.mode,
      questLevel: null,
      highlightRank: null,
    };
  }

  if (request.gameModeId === GameMode.QUESTS && request.questLevel === null) {
    let level = state.pendingQuestLevel;
    if (level === null) {
      level = state.config.gameplay.questLevel;
    }
    // Native screen always has a valid quest stage selected (defaults to 1.1).
    request.questLevel = level ?? new QuestLevel({ major: 1, minor: 1 });
  }

  return request;
}

function passesDateFilter(entry: HighScoreRecord, dateMode: number, now: Date): boolean {
  // Native `config_highscore_date_mode` values (see highscore_screen_update):
  //   0 = Best of all time (no filter)
  //   1 = Best of month
  //   2 = Best of week
  //   3 = Best of day
  const mode = int(dateMode);
  if (mode <= 0) {
    return true;
  }

  const day = int(entry.day);
  const month = int(entry.month);
  const yearOff = int(entry.yearOffset);
  if (day <= 0 || month <= 0) {
    return false;
  }
  const year = 2000 + yearOff;
  if (mode === 1) {
    return month === (now.getMonth() + 1) && year === now.getFullYear();
  }
  if (mode === 3) {
    return day === now.getDate() && month === (now.getMonth() + 1) && year === now.getFullYear();
  }
  if (mode === 2) {
    // Week-of-year checksum stored at record byte 0x41.
    const stored = int(entry.data[0x41]);
    const checksum = highscoreDateChecksum(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return stored === checksum && year === now.getFullYear();
  }
  return true;
}

export function loadRecords(state: GameState, request: HighScoresRequest): HighScoreRecord[] {
  const path = scoresPathForMode(
    state.baseDir,
    request.gameModeId,
    {
      hardcore: state.config.gameplay.hardcore,
      questStageMajor: request.questLevel === null ? 0 : int(request.questLevel.major),
      questStageMinor: request.questLevel === null ? 0 : int(request.questLevel.minor),
      playerCount: state.config.gameplay.playerCount,
    },
  );
  let records: HighScoreRecord[];
  try {
    records = readHighscoreTable(path, { gameModeId: request.gameModeId });
  } catch {
    return [];
  }
  const dateMode = int(state.config.profile.scoreDateMode);
  if (dateMode > 0) {
    const now = new Date();
    records = records.filter((entry) => passesDateFilter(entry, dateMode, now));
  }
  return records;
}
