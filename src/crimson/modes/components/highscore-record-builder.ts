// Port of crimson/modes/components/highscore_record_builder.py

import type { GameMode } from '@crimson/game-modes.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import { mostUsedWeaponIdForPlayer } from '@crimson/weapon-runtime/index.ts';

export function clampShots(fired: number, hit: number): [number, number] {
  fired = Math.max(0, int(fired));
  hit = Math.max(0, Math.min(int(hit), fired));
  return [fired, hit];
}

export function shotsFromState(state: GameplayState, opts: { playerIndex: number }): [number, number] {
  const playerIndex = opts.playerIndex;
  const index = int(playerIndex);
  if (index < 0 || index >= state.shotsFired.length || index >= state.shotsHit.length) {
    return [0, 0];
  }
  const fired = int(state.shotsFired[index]);
  const hit = int(state.shotsHit[index]);
  return clampShots(fired, hit);
}

export function buildHighscoreRecordForGameOver(opts: { state: GameplayState; player: PlayerState; survivalElapsedMs: number; creatureKillCount: number; gameModeId: GameMode; shotsFired?: number | null; shotsHit?: number | null; clampShotsHit?: boolean }): HighScoreRecord {
  const state = opts.state;
  const player = opts.player;
  const survivalElapsedMs = opts.survivalElapsedMs;
  const creatureKillCount = opts.creatureKillCount;
  const gameModeId = opts.gameModeId;
  const shotsFired = opts.shotsFired ?? null;
  const shotsHit = opts.shotsHit ?? null;
  const clampShotsHit = opts.clampShotsHit ?? true;
  const record = HighScoreRecord.blank();
  record.scoreXp = int(player.experience);
  record.survivalElapsedMs = int(survivalElapsedMs);
  record.creatureKillCount = int(creatureKillCount);

  const weaponId = mostUsedWeaponIdForPlayer(state, { playerIndex: int(player.index), fallbackWeaponId: player.weapon.weaponId });
  record.mostUsedWeaponId = weaponId;

  let fired: any | number;
  let hit: any | number;
  if (shotsFired === null || shotsHit === null) {
    [fired, hit] = shotsFromState(state, { playerIndex: int(player.index) });
  } else {
    fired = int(shotsFired);
    hit = int(shotsHit);
    if (clampShotsHit) {
      [fired, hit] = clampShots(fired, hit);
    }
  }

  record.shotsFired = fired;
  record.shotsHit = hit;
  record.gameModeId = gameModeId;
  return record;
}
