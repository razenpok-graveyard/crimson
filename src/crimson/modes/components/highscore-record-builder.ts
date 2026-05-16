// Port of crimson/modes/components/highscore_record_builder.py

import type { GameMode } from '@crimson/game-modes.ts';
import type { GameplayState } from '@crimson/gameplay.ts';
import { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import { mostUsedWeaponIdForPlayer } from '@crimson/weapon-runtime/index.ts';

export function clampShots(fired: number, hit: number): [number, number] {
  fired = Math.max(0, Math.trunc(fired));
  hit = Math.max(0, Math.min(Math.trunc(hit), fired));
  return [fired, hit];
}

export function shotsFromState(state: GameplayState, opts: { playerIndex: number }): [number, number] {
  const playerIndex = opts.playerIndex;
  const index = Math.trunc(playerIndex);
  if (index < 0 || index >= state.shotsFired.length || index >= state.shotsHit.length) {
    return [0, 0];
  }
  const fired = Math.trunc(state.shotsFired[index]);
  const hit = Math.trunc(state.shotsHit[index]);
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
  record.scoreXp = Math.trunc(player.experience);
  record.survivalElapsedMs = Math.trunc(survivalElapsedMs);
  record.creatureKillCount = Math.trunc(creatureKillCount);

  const weaponId = mostUsedWeaponIdForPlayer(state, { playerIndex: Math.trunc(player.index), fallbackWeaponId: player.weapon.weaponId });
  record.mostUsedWeaponId = weaponId;

  let fired: number;
  let hit: number;
  if (shotsFired === null || shotsHit === null) {
    [fired, hit] = shotsFromState(state, { playerIndex: Math.trunc(player.index) });
  } else {
    fired = Math.trunc(shotsFired);
    hit = Math.trunc(shotsHit);
    if (clampShotsHit) {
      [fired, hit] = clampShots(fired, hit);
    }
  }

  record.shotsFired = fired;
  record.shotsHit = hit;
  record.gameModeId = gameModeId;
  return record;
}
