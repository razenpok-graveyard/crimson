// Port of crimson/quests/runtime.py

import type { CrandLike } from '@grim/rand.ts';
import { Crand } from '@grim/rand.ts';
import { SpawnId } from '@crimson/creatures/spawn.ts';
import type { QuestContext, QuestDefinition } from '@crimson/quests/types.ts';
import { SpawnEntry } from '@crimson/quests/types.ts';

export const QUEST_COMPLETION_HIT_SFX_START_MS = 800.0;
export const QUEST_COMPLETION_HIT_SFX_END_MS = 0x353;
export const QUEST_COMPLETION_MUSIC_START_MS = 2000.0;
export const QUEST_COMPLETION_MUSIC_END_MS = 0x803;
export const QUEST_COMPLETION_TRANSITION_MS = 0x9C4;

export function applyHardcoreSpawnTableAdjustment(entries: SpawnEntry[]): SpawnEntry[] {
  // Apply quest hardcore spawn-table count adjustment.
  //
  // Modeled after the quest start logic in the classic game, which bumps `SpawnEntry.count`
  // for most multi-spawn entries in hardcore mode.

  const adjusted: SpawnEntry[] = [];
  for (const entry of entries) {
    const spawnId = entry.spawnId;
    let count = Math.trunc(entry.count);
    if (count > 1 && spawnId !== SpawnId.SPIDER_SP1_CONST_RANGED_VARIANT_3C) {
      if (spawnId === SpawnId.ALIEN_CONST_RED_FAST_2B) {
        count += 2;
      } else {
        count += 8;
      }
    }
    adjusted.push(count === entry.count ? entry : (() => { const value = entry; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value, count }); })());
  }
  return adjusted;
}

export function buildQuestSpawnTable(quest: QuestDefinition, ctx: QuestContext, opts: { rng?: CrandLike | null; hardcore?: boolean; fullVersion?: boolean } = {}): SpawnEntry[] {
  // Build the quest spawn script from the active startup RNG state.

  const rng = opts.rng ?? null;
  const hardcore = opts.hardcore ?? false;
  const fullVersion = opts.fullVersion ?? true;
  const builderRng = rng !== null ? rng : new Crand();
  let entries = quest.builder(ctx, { rng: builderRng, fullVersion: fullVersion });
  if (hardcore) {
    entries = applyHardcoreSpawnTableAdjustment(Array.from(entries));
  }
  return Array.from(entries);
}

export function tickQuestCompletionTransition(completionTransitionMs: number, frameDtMs: number, opts: { creaturesNoneActive: boolean; spawnTableEmpty: boolean }): [number, boolean, boolean, boolean] {
  // Advance quest completion transition timer.
  //
  // The quest-mode update loop waits for a short delay after the quest is "idle complete"
  // (no active creatures + no remaining spawn table entries) before transitioning to the
  // results screen.
  //
  // Returns:
  //   (completion_transition_ms, completed, play_hit_sfx, play_completion_music)

  const creaturesNoneActive = opts.creaturesNoneActive;
  const spawnTableEmpty = opts.spawnTableEmpty;
  const dtMs = frameDtMs;
  const timerMs = completionTransitionMs;

  if (creaturesNoneActive && spawnTableEmpty) {
    if (timerMs < 0.0) {
      // Native quest_mode_update seeds the timer with the frame delta.
      return [dtMs, false, false, false];
    }
    if (QUEST_COMPLETION_HIT_SFX_START_MS < timerMs && timerMs < QUEST_COMPLETION_HIT_SFX_END_MS) {
      // Match the native snap-forward after the quest-hit stinger.
      return [QUEST_COMPLETION_HIT_SFX_END_MS + dtMs, false, true, false];
    }
    if (QUEST_COMPLETION_MUSIC_START_MS < timerMs && timerMs < QUEST_COMPLETION_MUSIC_END_MS) {
      // Match the native snap-forward before the completion music fade-in.
      return [QUEST_COMPLETION_MUSIC_END_MS + dtMs, false, false, true];
    }
    const completed = timerMs > QUEST_COMPLETION_TRANSITION_MS;
    return [timerMs + dtMs, completed, false, false];
  }

  return [-1.0, false, false, false];
}
