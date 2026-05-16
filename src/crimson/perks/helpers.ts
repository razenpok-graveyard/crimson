// Port of crimson/perks/helpers.py

import type { PlayerState } from '@crimson/sim/state-types.ts';
import type { PerkId } from '@crimson/perks/ids.ts';

export function perkCountGet(player: PlayerState, perkId: PerkId): number {
  const idx = Math.trunc(perkId);
  if (idx < 0) {
    return 0;
  }
  if (idx >= player.perkCounts.length) {
    return 0;
  }
  return Math.trunc(player.perkCounts[idx]);
}

export function perkActive(player: PlayerState, perkId: PerkId): boolean {
  return perkCountGet(player, perkId) > 0;
}
