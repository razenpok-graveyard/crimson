// Port of crimson/screens/high_scores_view/shared.py

import { GameMode } from '@crimson/game-modes.ts';
import type { HighScoreRecord } from '@crimson/persistence/highscores.ts';

export function ordinal(value: number): string {
  const n = int(value);
  if (10 <= (n % 100) && (n % 100) <= 20) {
    return `${n}th`;
  }
  const suffix = new Map([[1, 'st'], [2, 'nd'], [3, 'rd']]).get(n % 10) ?? 'th';
  return `${n}${suffix}`;
}

export function formatElapsedMmSs(valueMs: number): string {
  const total = Math.floor(Math.max(0, int(valueMs)) / 1000);
  const [minutes, seconds] = [Math.floor(total / 60), total % 60];
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatScoreDate(entry: HighScoreRecord): string {
  const day = int(entry.day);
  const month = int(entry.month);
  const yearOff = int(entry.yearOffset);
  if (day <= 0 || month <= 0) {
    return '';
  }
  const months: [string, string, string, string, string, string, string, string, string, string, string, string] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = 1 <= month && month <= 12 ? months[month - 1] : `${month}`;
  const year = yearOff >= 0 ? 2000 + yearOff : 2000;
  return `${day}. ${monthName} ${year}`;
}

export function modeLabel(modeId: GameMode, questMajor: number, questMinor: number): string {
  switch (modeId) {
    case GameMode.SURVIVAL:
      return 'Survival';
    case GameMode.RUSH:
      return 'Rush';
    case GameMode.TYPO:
      return 'Typ-o Shooter';
    case GameMode.QUESTS:
      if (int(questMajor) > 0 && int(questMinor) > 0) {
        return `Quest ${int(questMajor)}.${int(questMinor)}`;
      }
      return 'Quests';
    default:
      return 'Unknown';
  }
}
