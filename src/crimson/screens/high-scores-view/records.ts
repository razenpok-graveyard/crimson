// Port of crimson/screens/high_scores_view/records.py

import type { GameState } from '@crimson/game/types.ts';
import { HighScoresRequest } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import type { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import { highscoreDateChecksum, readHighscoreTable, scoresPathForMode } from '@crimson/persistence/highscores.ts';

export function resolveRequest(state: GameState): HighScoresRequest {
  let request = state.pendingHighScores;
  state.pendingHighScores = null;
  if (request === null) {
    request = new HighScoresRequest({ gameModeId: (() => { const value = state.config.gameplay.mode; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })() });
  }

  let level: typeof state.pendingQuestLevel;
  if (request.gameModeId === GameMode.QUESTS && request.questLevel === null) {
    level = state.pendingQuestLevel;
    if (level === null) {
      level = state.config.gameplay.questLevel;
    }
    // Native screen always has a valid quest stage selected (defaults to 1.1).
    request.questLevel = level !== null ? level : new QuestLevel({ major: 1, minor: 1 });
  }

  return request;
}

function passesDateFilter(entry: HighScoreRecord, opts: { dateMode: number; now: Date }): boolean {
  // Native `config_highscore_date_mode` values (see highscore_screen_update):
  //   0 = Best of all time (no filter)
  //   1 = Best of month
  //   2 = Best of week
  //   3 = Best of day
  const dateMode = opts.dateMode;
  const now = opts.now;
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
    return int(month) === int(now.getMonth() + 1) && int(year) === int(now.getFullYear());
  }
  if (mode === 3) {
    return int(day) === int(now.getDate()) && int(month) === int(now.getMonth() + 1) && int(year) === int(now.getFullYear());
  }
  if (mode === 2) {
    // Week-of-year checksum stored at record byte 0x41.

    const stored = int(entry.data[0x41]);
    const checksum = int(highscoreDateChecksum(now.getFullYear(), now.getMonth() + 1, now.getDate()));
    return int(stored) === int(checksum) && int(year) === int(now.getFullYear());
  }
  return true;
}

export function loadRecords(state: GameState, request: HighScoresRequest): HighScoreRecord[] {
  const path = scoresPathForMode(state.baseDir, request.gameModeId, { hardcore: state.config.gameplay.hardcore, questStageMajor: request.questLevel === null ? 0 : int(request.questLevel.major), questStageMinor: request.questLevel === null ? 0 : int(request.questLevel.minor), playerCount: state.config.gameplay.playerCount });
  let records: ReturnType<typeof readHighscoreTable>;
  try {
    records = readHighscoreTable(path, { gameModeId: request.gameModeId });
  } catch (exc) {
    return [];
  }
  const dateMode = int(state.config.profile.scoreDateMode);
  if (dateMode > 0) {
    const now = new Date();
    records = records.filter((entry) => passesDateFilter(entry, { dateMode: dateMode, now: now }));
  }
  return records;
}
