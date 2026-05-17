// Port of crimson/dbg/focus.py

import { compareEntitySamples, compareRngStream, compareSimState } from '@crimson/dbg/channel-compare.ts';
import { ENTITY_SAMPLE_KINDS, checkpointChannelRequired, entityRows, entitySamplesChannelRequired, rngStreamChannelRequired, simStateChannelRequired } from '@crimson/dbg/channel-helpers.ts';
import { checkpointDeepdiff } from '@crimson/dbg/checkpoint-diff.ts';
import { BuiltinObject, toBuiltinObject } from '@crimson/dbg/payloads.ts';
import type { TickRecord } from '@crimson/dbg/schema.ts';
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

function entityUidSet(row: TickRecord, kind: string): Set<number> {
  const samples = entitySamplesChannelRequired(row);
  const out: Set<number> = new Set();
  for (const item of entityRows(samples, { kind: kind })) {
    out.add(int(item.uid));
  }
  return out;
}

export function focusTick(opts: { goldenTrace: string; candidateTrace: string; tickIndex: number }): BuiltinObject {
  const goldenTrace = opts.goldenTrace;
  const candidateTrace = opts.candidateTrace;
  const tickIndex = opts.tickIndex;
  const tick = int(tickIndex);
  const expected = new TraceReader(goldenTrace);
  const candidate = new TraceReader(candidateTrace);
  let expectedRow: ReturnType<typeof expected.tick>;
  let candidateRow: ReturnType<typeof candidate.tick>;
  try {
    expectedRow = expected.tick(tick);
    candidateRow = candidate.tick(tick);
  } finally {
    candidate.close();
    expected.close();
  }

  if (expectedRow === null || candidateRow === null) {
    throw new Error(`tick ${tick} missing in one of the traces`);
  }

  const expectedCheckpoint = checkpointChannelRequired(expectedRow);
  const candidateCheckpoint = checkpointChannelRequired(candidateRow);

  const checkpointDiff = checkpointDeepdiff(expectedCheckpoint, candidateCheckpoint);

  const [rngOk, rngStreamDetail] = compareRngStream(rngStreamChannelRequired(expectedRow), rngStreamChannelRequired(candidateRow));
  const rngStream = { ...(rngStreamDetail || {}) };
  rngStream['ok'] = rngOk;

  const entityPresence: BuiltinObject = {};
  let entityDiverged = false;
  for (const kind of ENTITY_SAMPLE_KINDS) {
    const expectedUids = entityUidSet(expectedRow, kind);
    const candidateUids = entityUidSet(candidateRow, kind);
    const missing = Array.from(expectedUids).filter((item) => !candidateUids.has(item)).sort((left, right) => pythonCompareKeys(left, right));
    const extra = Array.from(candidateUids).filter((item) => !expectedUids.has(item)).sort((left, right) => pythonCompareKeys(left, right));
    let diverged = missing.length > 0 || extra.length > 0 || expectedUids.size !== candidateUids.size;
    if (diverged) {
      entityDiverged = true;
    }
    entityPresence[kind] = { "expected_count": expectedUids.size, "candidate_count": candidateUids.size, "missing_uids": missing, "extra_uids": extra };
  }
  const [entitySamplesOk, entitySamplesDetail] = compareEntitySamples(entitySamplesChannelRequired(expectedRow), entitySamplesChannelRequired(candidateRow));
  const [simStateOk, simStateDetail] = compareSimState(simStateChannelRequired(expectedRow), simStateChannelRequired(candidateRow));

  let diverged = checkpointDiff !== null || !(rngStream['ok'] ?? null) || entityDiverged || !entitySamplesOk || !simStateOk;

  return toBuiltinObject({ 'tick_index': int(tick), 'diverged': diverged, 'checkpoint_diff_count': checkpointDiff === null ? 0 : int(checkpointDiff.diffCount), 'checkpoint_diff': checkpointDiff === null ? null : { 'payload': checkpointDiff.payload, 'pretty': checkpointDiff.pretty }, 'rng_stream': rngStream, 'entity_presence': entityPresence, 'entity_samples': { 'ok': entitySamplesOk, 'detail': entitySamplesDetail }, 'sim_state': { 'ok': simStateOk, 'detail': simStateDetail } }, { field: 'focus_tick' });
}
