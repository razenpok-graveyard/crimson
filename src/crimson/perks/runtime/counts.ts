// Port of crimson/perks/runtime/counts.py

import type { PlayerState } from '@crimson/sim/state-types.ts';
import type { PerkId } from '@crimson/perks/ids.ts';

export function adjustPerkCount(player: PlayerState, perkId: PerkId, opts: { amount?: number } = {}): void {
  const amount = opts.amount ?? 1;
  const idx = int(perkId);
  if (idx >= 0 && idx < player.perkCounts.length) {
    player.perkCounts[idx] += int(amount);
  }
}
