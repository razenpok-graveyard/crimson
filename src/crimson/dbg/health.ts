// Port of crimson/dbg/health.py

import { entitySamplesChannel, rngStreamChannelRequired, simStateChannel, timingSamplesChannelRequired } from '@crimson/dbg/channel-helpers.ts';
import type { BuiltinObject } from '@crimson/dbg/payloads.ts';
import { toBuiltinObject } from '@crimson/dbg/payloads.ts';
import { TRACE_REQUIRED_CHANNELS } from '@crimson/dbg/schema.ts';
import { TraceReader } from '@crimson/dbg/trace.ts';

function pythonCompareKeys(left: any, right: any): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const item = pythonCompareKeys(left[index], right[index]);
      if (item !== 0) {
        return item;
      }
    }
    return left.length - right.length;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export function summarizeTraceHealth(tracePath: string, opts: { tickStart?: number | null; tickEnd?: number | null } = {}): BuiltinObject {
  const tickStart = opts.tickStart ?? null;
  const tickEnd = opts.tickEnd ?? null;
  const path = tracePath;
  const trace = new TraceReader(path);
  let ticksTotal: number;
  let ticksWithDt: number;
  let rngStreamRows: number;
  let simStateRows: number;
  let sampleCreatureRows: number;
  let sampleProjectileRows: number;
  let sampleSecondaryRows: number;
  let sampleBonusRows: number;
  let timingSamplesRows: number;
  let samples: ReturnType<typeof entitySamplesChannel>;
  try {
    const channelsPresent: Map<string, number> = new Map();
    ticksTotal = 0;
    ticksWithDt = 0;
    rngStreamRows = 0;
    simStateRows = 0;
    sampleCreatureRows = 0;
    sampleProjectileRows = 0;
    sampleSecondaryRows = 0;
    sampleBonusRows = 0;
    timingSamplesRows = 0;

    for (const tick of trace.iterTicks({ tickStart: tickStart, tickEnd: tickEnd })) {
      ticksTotal += 1;
      ticksWithDt += 1;
      for (const channelName of TRACE_REQUIRED_CHANNELS) {
        channelsPresent.set(channelName, int(channelsPresent.get(channelName) ?? 0) + 1);
        if (channelName === 'rng_stream') {
          rngStreamRows += rngStreamChannelRequired(tick).length;
        } else if (channelName === 'timing_samples') {
          timingSamplesRows += timingSamplesChannelRequired(tick).length;
        } else if (channelName === 'sim_state') {
          if (simStateChannel(tick) !== null) {
            simStateRows += 1;
          }
        } else if (channelName === 'entity_samples') {
          samples = entitySamplesChannel(tick);
          if (samples !== null) {
            sampleCreatureRows += samples.creatures.length;
            sampleProjectileRows += samples.projectiles.length;
            sampleSecondaryRows += samples.secondaryProjectiles.length;
            sampleBonusRows += samples.bonuses.length;
          }
        }
      }
    }

    const issues: string[] = [];
    if (ticksTotal === 0) {
      issues.push('trace window has no ticks');
    }
    for (const requiredChannel of TRACE_REQUIRED_CHANNELS) {
      if ((channelsPresent.get(String(requiredChannel)) ?? 0) <= 0) {
        issues.push(`${requiredChannel} channel missing`);
      }
    }

    let windowStart = tickStart;
    let windowEnd = tickEnd;
    const metaRange = trace.meta.tickRange;
    if (ticksTotal > 0) {
      if (windowStart === null) {
        windowStart = int(metaRange.get('start_tick') ?? -1);
      }
      if (windowEnd === null) {
        windowEnd = int(metaRange.get('end_tick') ?? -1);
      }
    }
    return toBuiltinObject({ "trace_format_version": int(trace.meta.traceFormatVersion), "trace_schema_version": int(trace.meta.traceSchemaVersion), "tick_window": { 'requested_start': tickStart === null ? null : int(tickStart), 'requested_end': tickEnd === null ? null : int(tickEnd), 'actual_start': windowStart === null ? null : int(windowStart), 'actual_end': windowEnd === null ? null : int(windowEnd), 'ticks_in_window': int(ticksTotal) }, "channels_present": Object.fromEntries(Array.from(Array.from(channelsPresent.entries()).sort((left, right) => pythonCompareKeys(left, right)), ([key, value]) => [String(key), int(value)] as const)), "metrics": { 'ticks_with_dt_ms_i32': int(ticksWithDt), 'rng_stream_rows': int(rngStreamRows), 'sim_state_rows': int(simStateRows), 'sample_creature_rows': int(sampleCreatureRows), 'sample_projectile_rows': int(sampleProjectileRows), 'sample_secondary_projectile_rows': int(sampleSecondaryRows), 'sample_bonus_rows': int(sampleBonusRows), 'timing_samples_rows': int(timingSamplesRows) }, "issues": issues, "ok_for_movement_root_cause": issues.length === 0 }, { field: 'trace_health' });
  } finally {
    trace.close();
  }
}
