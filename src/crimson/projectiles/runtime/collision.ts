// Port of crimson/projectiles/runtime/collision.py

import { Vec2 } from '@grim/geom.ts';
import { nativeFindSizeMargin } from '@crimson/collision-math.ts';
import { creatureLifecycleIsAlive } from '@crimson/creatures/lifecycle.ts';
import type { OwnerRef } from '@crimson/owner-ref.ts';
import type { CreatureDamageApplier } from '@crimson/projectiles/types.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
export { nativeFindSizeMargin } from '@crimson/collision-math.ts';

// Keep strict native boundary semantics for collision acceptance.
const _NATIVE_FIND_RADIUS_MARGIN_EPS = 0.0;

export function hitRadiusFor(creature: CreatureState): number {
  // Approximate `creature_find_in_radius`/`creatures_apply_radius_damage` sizing.
  //
  // The native code compares `distance - radius < creature.size * 0.14285715 + 3.0`.

  return Math.max(0.0, nativeFindSizeMargin(creature.size));
}

export function withinNativeFindRadius(opts: { origin: Vec2; target: Vec2; radius: number; targetSize: number }): boolean {
  // Mirror native `creature_find_in_radius` / `player_find_in_radius` predicate.
  //
  // Native uses:
  //   sqrt(dx*dx + dy*dy) - radius < size * 0.14285715 + 3.0

  const origin = opts.origin;
  const target = opts.target;
  const radius = opts.radius;
  const targetSize = opts.targetSize;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const radiusF = radius;
  const sizeMargin = nativeFindSizeMargin(targetSize);
  const maxAxisDelta = radiusF + sizeMargin + _NATIVE_FIND_RADIUS_MARGIN_EPS;
  // Fast reject for the common case where either axis already exceeds the
  // maximal accepted Euclidean radius.
  if (Math.abs(dx) > maxAxisDelta || Math.abs(dy) > maxAxisDelta) {
    return false;
  }
  const margin = Math.sqrt(dx * dx + dy * dy) - radiusF - sizeMargin;
  // Native compares against zero; keep strict threshold to avoid rewrite-only
  // near-edge hits that can cascade into RNG/XP timing drift.
  return margin < _NATIVE_FIND_RADIUS_MARGIN_EPS;
}

export function creatureFindNearestForSecondary(opts: { creatures: readonly CreatureState[]; origin: Vec2; preserveBugs?: boolean }): number {
  // Port of `creature_find_nearest(origin, -1, 0.0)` for homing secondary targets.

  const creatures = opts.creatures;
  const origin = opts.origin;
  const preserveBugs = opts.preserveBugs ?? false;
  let bestIdx = preserveBugs ? 0 : -1;
  let bestDistSq = 1_000_000.0;
  const maxIndex = Math.min(creatures.length, 0x180);
  for (let idx = 0; idx < maxIndex; idx++) {
    const creature = creatures[idx];
    if (!creature.active) {
      continue;
    }
    if (!creatureLifecycleIsAlive(creature.lifecycleStage)) {
      continue;
    }
    const distSq = Vec2.distanceSq(origin, creature.pos);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

export function applyDamageToCreature(creatures: readonly CreatureState[], creatureIndex: number, damage: number, opts: { damageType: number; impulse: Vec2; owner: OwnerRef; applyCreatureDamage?: CreatureDamageApplier | null }): void {
  const damageType = opts.damageType;
  const impulse = opts.impulse;
  const owner = opts.owner;
  const applyCreatureDamage = opts.applyCreatureDamage ?? null;
  if (damage <= 0.0) {
    return;
  }
  const idx = Math.trunc(creatureIndex);
  if (!(idx >= 0 && idx < creatures.length)) {
    return;
  }
  if (applyCreatureDamage !== null) {
    applyCreatureDamage(idx, damage, Math.trunc(damageType), impulse, owner);
  } else {
    creatures[idx].hp -= damage;
  }
}
