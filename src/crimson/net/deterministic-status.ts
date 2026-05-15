// Port of crimson/net/deterministic_status.py

import type { GameStatusData } from '@crimson/persistence/save-status.ts';
import { GameStatus, defaultStatusData } from '@crimson/persistence/save-status.ts';
export { hashStatusData } from '@crimson/persistence/save-status.ts';

export function statusDataFromStatus(status: GameStatus | null): GameStatusData {
  if (status === null) {
    return defaultStatusData();
  }
  return status.asData();
}

export function buildLanDeterministicStatus(opts: { status?: GameStatusData | null } = {}): GameStatus {
  // Return a session-local `GameStatus` for deterministic LAN simulation.
  //
  // The host sends its save status in `MatchStart`, and all peers use it as the
  // simulation status. This avoids split brain where local save progress impacts
  // deterministic simulation (weapon availability / RNG consumption).

  // This status object should never overwrite the on-disk save. Give it a
  // safe temp path so accidental `save_if_dirty()` calls don't clobber
  // `game.cfg`.
  const status = opts.status ?? null;
  const path = '/tmp/crimson-lan-sim-game.cfg';
  const data = status === null ? defaultStatusData() : status;
  return GameStatus.fromData({ path: path, data: data, dirty: false });
}
