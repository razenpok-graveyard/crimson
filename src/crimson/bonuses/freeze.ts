// Port of crimson/bonuses/freeze.py

// Freeze bonus behavior shared by sim, apply, and presentation steps.

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { CREATURE_CORPSE_DESPAWN_LIFECYCLE } from '@crimson/creatures/lifecycle.ts';
import { f32 } from '@crimson/math-parity.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { BonusPickupEvent, GameplayState } from '@crimson/sim/state-types.ts';
import type { BonusApplyCtx } from '@crimson/bonuses/apply-context.ts';

export class DeferredFreezeCorpseFx {
  readonly pos: Vec2;
  readonly detailPreset: number;

  constructor(opts: {
    pos: Vec2;
    detailPreset: number;
  }) {
    this.pos = opts.pos;
    this.detailPreset = opts.detailPreset;
  }
}

export function applyFreeze(ctx: BonusApplyCtx): void {
  const old = ctx.state.bonuses.freeze;
  if (old <= 0.0) {
    ctx.registerGlobal('freeze');
  }
  ctx.state.bonuses.freeze = f32(old + ctx.amount * ctx.economistMultiplier);

  const creatures = ctx.creatures;
  if (creatures.length > 0) {
    const deferCorpseFx = ctx.deferFreezeCorpseFx;
    const allowedIndices = ctx.freezeCorpseIndices;
    for (const [idx, creature] of creatures.entries()) {
      if (!creature.active) {
        continue;
      }
      if (creature.hp > 0.0) {
        continue;
      }
      // Native excludes corpses already below the despawn hitbox threshold
      // from Freeze FX random work in `bonus_apply`.
      if (creature.lifecycleStage < CREATURE_CORPSE_DESPAWN_LIFECYCLE) {
        creature.active = false;
        continue;
      }
      const allowShatterFx = allowedIndices === null || (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(allowedIndices, int(idx)));
      const pos = creature.pos;
      let angle: number;
      if (allowShatterFx && deferCorpseFx) {
        ctx.state.deferredFreezeCorpseFx.push(new DeferredFreezeCorpseFx({ pos: new Vec2(pos.x, pos.y), detailPreset: int(ctx.detailPreset) }));
      } else if (allowShatterFx) {
        for (let i = 0; i < 8; i++) {
          angle = ctx.state.rng.rand({ caller: RngCallerStatic.BONUS_APPLY_FREEZE_SHARD_ANGLE }) % 612 * 0.01;
          ctx.state.effects.spawnFreezeShard({
            pos: pos,
            angle: angle,
            rng: ctx.state.rng,
            detailPreset: int(ctx.detailPreset),
          });
        }
        angle = ctx.state.rng.rand({ caller: RngCallerStatic.BONUS_APPLY_FREEZE_SHATTER_ANGLE }) % 612 * 0.01;
        ctx.state.effects.spawnFreezeShatter({
          pos: pos,
          angle: angle,
          rng: ctx.state.rng,
          detailPreset: int(ctx.detailPreset),
        });
      }
      creature.active = false;
    }
  }

  ctx.state.sfxQueue.push(SfxId.SHOCKWAVE);
}

export function flushDeferredFreezeCorpseFx(state: GameplayState): void {
  const pending = state.deferredFreezeCorpseFx;
  if (pending.length === 0) {
    return;
  }

  for (const queued of pending) {
    const pos = queued.pos;
    const detail = int(queued.detailPreset);
    for (let i = 0; i < 8; i++) {
      let angle = state.rng.rand({ caller: RngCallerStatic.BONUS_APPLY_FREEZE_SHARD_ANGLE }) % 612 * 0.01;
      state.effects.spawnFreezeShard({
        pos: pos,
        angle: angle,
        rng: state.rng,
        detailPreset: detail,
      });
    }
    let angle = state.rng.rand({ caller: RngCallerStatic.BONUS_APPLY_FREEZE_SHATTER_ANGLE }) % 612 * 0.01;
    state.effects.spawnFreezeShatter({
      pos: pos,
      angle: angle,
      rng: state.rng,
      detailPreset: detail,
    });
  }
  pending.length = 0;
}

export function freezeBonusActive(opts: { state: GameplayState }): boolean {
  // Return whether Freeze timer is currently active.
  const state = opts.state;
  return state.bonuses.freeze > 0.0;
}

export function applyFreezePickupFx(opts: { state: GameplayState; pickup: BonusPickupEvent; detailPreset: number }): void {
  // Spawn the freeze-tinted ring used by Freeze bonus pickups.
  const state = opts.state;
  const pickup = opts.pickup;
  const detailPreset = opts.detailPreset;
  state.effects.spawnRing({
    pos: pickup.pos,
    detailPreset: int(detailPreset),
    color: new RGBA(0.3, 0.5, 0.8, 1.0),
  });
}
