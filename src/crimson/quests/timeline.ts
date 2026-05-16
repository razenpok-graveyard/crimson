// Port of crimson/quests/timeline.py

import { SpawnTemplateCall } from '@crimson/creatures/spawn.ts';
import { f32 } from '@crimson/math-parity.ts';
import type { SpawnEntry } from '@crimson/quests/types.ts';

export function tickQuestSpawnTimeline(entries: readonly SpawnEntry[], questSpawnTimelineMs: number, frameDtMs: number, opts: { terrainWidth: number; creaturesNoneActive: boolean; noCreaturesTimerMs: number }): [readonly SpawnEntry[], boolean, number, readonly SpawnTemplateCall[]] {
  // Advance quest spawn-table firing (pure model of `quest_spawn_timeline_update` / 0x00434250).
  //
  // Returns:
  //   (updated_entries, creatures_none_active, no_creatures_timer_ms, spawn_calls)
  const terrainWidth = opts.terrainWidth;
  let creaturesNoneActive = opts.creaturesNoneActive;
  let noCreaturesTimerMs = opts.noCreaturesTimerMs;
  const timelineMs = f32(questSpawnTimelineMs);
  const dtMs = f32(frameDtMs);

  if (!creaturesNoneActive) {
    noCreaturesTimerMs = 0.0;
  } else {
    noCreaturesTimerMs = f32(noCreaturesTimerMs + dtMs);
  }

  const forceSpawn = creaturesNoneActive && 3000.0 < noCreaturesTimerMs && 0x6A4 < timelineMs;

  let startIdx: number | null = null;
  for (const [idx, entry] of entries.entries()) {
    if (entry.count <= 0) {
      continue;
    }
    if (f32(entry.triggerMs) < timelineMs || forceSpawn) {
      startIdx = idx;
      break;
    }
  }

  if (startIdx === null) {
    return [entries, creaturesNoneActive, noCreaturesTimerMs, []];
  }

  const spawns: SpawnTemplateCall[] = [];
  const updatedEntries = Array.from(entries);

  const triggerMs = entries[startIdx].triggerMs;
  for (let idx = startIdx; idx < entries.length; idx++) {
    const entry = entries[idx];
    if (entry.triggerMs !== triggerMs) {
      break;
    }

    const basePos = entry.pos;
    const offscreenX = basePos.x < 0.0 || f32(terrainWidth) < basePos.x;

    for (let spawnIdx = 0; spawnIdx < Math.trunc(entry.count); spawnIdx++) {
      const magnitude = f32(spawnIdx * 0x28);
      const offset = (spawnIdx & 1) === 0 ? magnitude : -magnitude;
      let pos: any;
      if (offscreenX) {
        pos = basePos.offset({ dy: offset });
      } else {
        pos = basePos.offset({ dx: offset });
      }
      spawns.push(new SpawnTemplateCall({ templateId: entry.spawnId, pos: pos, heading: f32(entry.heading) }));
    }

    if (entry.count !== 0) {
      updatedEntries[idx] = (() => { const value = entry; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value, count: 0 }); })();
    }
  }

  // After spawning, the original forces the "none active" flag off.
  creaturesNoneActive = false;

  return [Array.from(updatedEntries), creaturesNoneActive, noCreaturesTimerMs, Array.from(spawns)];
}

export function questSpawnTableEmpty(entries: readonly SpawnEntry[]): boolean {
  // Return True when all quest spawn entries are exhausted (count <= 0).
  return entries.every((entry) => entry.count <= 0);
}

export function tickQuestModeSpawns(entries: readonly SpawnEntry[], questSpawnTimelineMs: number, frameDtMs: number, opts: { terrainWidth: number; creaturesNoneActive: boolean; noCreaturesTimerMs: number }): [readonly SpawnEntry[], number, boolean, number, readonly SpawnTemplateCall[]] {
  // Advance quest-mode spawning (spawn timeline + table firing).
  //
  // Modeled after the spawning portion of `quest_mode_update` (0x004070e0), which:
  //   - Advances `quest_spawn_timeline` unless the quest is idle-complete (no creatures active and
  //     the spawn table is empty).
  //   - Calls `quest_spawn_timeline_update` to fire spawn entries.
  //
  // Returns:
  //   (updated_entries, quest_spawn_timeline_ms, creatures_none_active, no_creatures_timer_ms, spawn_calls)
  const terrainWidth = opts.terrainWidth;
  let creaturesNoneActive = opts.creaturesNoneActive;
  let noCreaturesTimerMs = opts.noCreaturesTimerMs;
  let timelineMs = f32(questSpawnTimelineMs);
  const dtMs = f32(frameDtMs);

  if (!creaturesNoneActive || !questSpawnTableEmpty(entries)) {
    timelineMs = f32(timelineMs + dtMs);
  }

  let spawns: any;
  [entries, creaturesNoneActive, noCreaturesTimerMs, spawns] = tickQuestSpawnTimeline(entries, timelineMs, dtMs, { terrainWidth: terrainWidth, creaturesNoneActive: creaturesNoneActive, noCreaturesTimerMs: noCreaturesTimerMs });

  return [entries, timelineMs, creaturesNoneActive, noCreaturesTimerMs, spawns];
}
