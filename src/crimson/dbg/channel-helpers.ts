// Port of crimson/dbg/channel_helpers.py

import type { ReplayCheckpoint } from '@crimson/replay/checkpoints.ts';
import type { BonusEntitySample, CreatureEntitySample, EntitySamplesSnapshot, ProjectileEntitySample, RngStreamRow, SecondaryProjectileEntitySample, SimStateSnapshot, TimingSampleRow } from '@crimson/dbg/canonical-channels.ts';
import type { TickRecord } from '@crimson/dbg/schema.ts';
import { TraceError } from '@crimson/dbg/trace.ts';

export type EntitySampleRow = CreatureEntitySample | ProjectileEntitySample | SecondaryProjectileEntitySample | BonusEntitySample;

export const ENTITY_SAMPLE_KINDS = ['creatures', 'projectiles', 'secondary_projectiles', 'bonuses'] as const;

function pythonRepr(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return 'nan';
    }
    if (value === Infinity) {
      return 'inf';
    }
    if (value === -Infinity) {
      return '-inf';
    }
    return String(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === true) {
    return 'True';
  }
  if (value === false) {
    return 'False';
  }
  if (value === null) {
    return 'None';
  }
  return String(value);
}

function requireRow(row: TickRecord | null, opts: { channelName: string }): TickRecord {
  const channelName = opts.channelName;
  if (row === null) {
    throw new TraceError(`missing tick row for ${channelName} channel`);
  }
  return row;
}

export function checkpointChannel(row: TickRecord | null): ReplayCheckpoint | null {
  return row === null ? null : row.channels.checkpoint;
}

export function checkpointChannelRequired(row: TickRecord | null): ReplayCheckpoint {
  return requireRow(row, { channelName: 'checkpoint' }).channels.checkpoint;
}

export function simStateChannel(row: TickRecord | null): SimStateSnapshot | null {
  return row === null ? null : row.channels.simState;
}

export function simStateChannelRequired(row: TickRecord | null): SimStateSnapshot {
  return requireRow(row, { channelName: 'sim_state' }).channels.simState;
}

export function entitySamplesChannel(row: TickRecord | null): EntitySamplesSnapshot | null {
  return row === null ? null : row.channels.entitySamples;
}

export function entitySamplesChannelRequired(row: TickRecord | null): EntitySamplesSnapshot {
  return requireRow(row, { channelName: 'entity_samples' }).channels.entitySamples;
}

export function rngStreamChannelRequired(row: TickRecord | null): RngStreamRow[] {
  return Array.from(requireRow(row, { channelName: 'rng_stream' }).channels.rngStream);
}

export function timingSamplesChannelRequired(row: TickRecord | null): TimingSampleRow[] {
  return Array.from(requireRow(row, { channelName: 'timing_samples' }).channels.timingSamples);
}

export function entityRows(samples: EntitySamplesSnapshot, opts: { kind: string }): EntitySampleRow[] {
  const kind = opts.kind;
  switch (kind) {
    case 'creatures':
      return [...samples.creatures];
    case 'projectiles':
      return [...samples.projectiles];
    case 'secondary_projectiles':
      return [...samples.secondaryProjectiles];
    case 'bonuses':
      return [...samples.bonuses];
    default:
      throw new Error(`unsupported entity sample kind: ${pythonRepr(kind)}`);
  }
}
