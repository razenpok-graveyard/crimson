// Port of crimson/replay/header_settings.py

import { GameMode } from '@crimson/game-modes.ts';
import { INPUT_DELAY_TICKS as LOCKSTEP_INPUT_DELAY_TICKS } from '@crimson/net/lockstep-protocol.ts';
import type { LockstepSessionSettings } from '@crimson/net/session-settings.ts';
import { sessionSettingsForLockstep } from '@crimson/net/session-settings.ts';
import { GameStatusData } from '@crimson/persistence/save-status.ts';
import { ReplayHeader } from '@crimson/replay/types.ts';

export function sessionSettingsFromReplayHeader(header: ReplayHeader, opts: { inputDelayTicks?: number } = {}): LockstepSessionSettings {
  const inputDelayTicks = opts.inputDelayTicks ?? LOCKSTEP_INPUT_DELAY_TICKS;
  return sessionSettingsForLockstep({ modeId: header.gameModeId, playerCount: header.playerCount, questLevel: header.questLevel, preserveBugs: header.preserveBugs, tickRate: header.tickRate, inputDelayTicks: inputDelayTicks });
}

export function replayHeaderFromSessionSettings(settings: LockstepSessionSettings, opts: { seed: number; questFailRetryCount?: number; hardcore?: boolean; detailPreset?: number; violenceDisabled?: number; worldSize?: number; status?: GameStatusData | null }): ReplayHeader {
  const seed = opts.seed;
  const questFailRetryCount = opts.questFailRetryCount ?? 0;
  const hardcore = opts.hardcore ?? false;
  const detailPreset = opts.detailPreset ?? 5;
  const violenceDisabled = opts.violenceDisabled ?? 0;
  const worldSize = opts.worldSize ?? 1024.0;
  const status = opts.status ?? null;
  const modeRaw = settings.modeId;
  let gameModeId: GameMode;
  try {
    gameModeId = Object.values(GameMode).includes(modeRaw as GameMode) ? modeRaw as GameMode : (() => { const value = int(modeRaw); if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
  } catch (exc) {
    throw new Error(`unsupported replay game_mode_id=${modeRaw}`);
  }
  const questLevel = settings.questLevel;
  if (gameModeId === GameMode.QUESTS && questLevel === null) {
    throw new Error('quest replays require quest_level');
  }
  if (gameModeId === GameMode.TUTORIAL && settings.playerCount !== 1) {
    throw new Error('tutorial replays require player_count == 1');
  }

  return new ReplayHeader({ gameModeId: gameModeId, seed: seed, questLevel: questLevel, tickRate: settings.tickRate, questFailRetryCount: questFailRetryCount, hardcore: hardcore, preserveBugs: settings.preserveBugs, detailPreset: detailPreset, violenceDisabled: violenceDisabled, worldSize: worldSize, playerCount: settings.playerCount, status: status === null ? new GameStatusData() : status });
}
