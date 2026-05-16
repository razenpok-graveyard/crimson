// Port of crimson/perks/impl/jinxed_effect.py

import { SfxId } from '@grim/sfx-map.ts';
import { f32 } from '@crimson/math-parity.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import type { PerksUpdateEffectsCtx } from '@crimson/perks/runtime/effects-context.ts';
import { PerkHooks } from '@crimson/perks/runtime/hook-types.ts';

function awardExperienceOnceFromReward(opts: { player: PlayerState; rewardValue: number }): number {
  const player = opts.player;
  const rewardValue = opts.rewardValue;
  const rewardF32 = f32(rewardValue);
  if (rewardF32 <= 0.0) {
    return 0;
  }

  const before = int(player.experience);
  const totalF32 = f32(f32(before) + rewardF32);
  const after = int(totalF32);
  player.experience = int(after);
  return int(after - before);
}

function awardExperienceFromReward(ctx: PerksUpdateEffectsCtx, opts: { rewardValue: number }): number {
  const rewardValue = opts.rewardValue;
  if (ctx.players.length === 0) {
    return 0;
  }
  const player = ctx.players[0];
  let gained = awardExperienceOnceFromReward({ player: player, rewardValue: rewardValue });
  if (gained <= 0) {
    return 0;
  }
  if (ctx.state.bonuses.doubleExperience > 0.0) {
    gained += awardExperienceOnceFromReward({ player: player, rewardValue: rewardValue });
  }
  return int(gained);
}

function selectJinxedAccidentTarget(ctx: PerksUpdateEffectsCtx): PlayerState {
  const player0 = ctx.players[0];
  if (ctx.state.preserveBugs) {
    return player0;
  }

  const alivePlayers = ctx.players.filter((player) => player.health > 0.0);
  if (alivePlayers.length === 0) {
    return player0;
  }
  if (alivePlayers.length === 1) {
    return alivePlayers[0];
  }

  const pick = ctx.state.rng.rand({ caller: RngCallerStatic.REWRITE_JINXED_ACCIDENT_TARGET_PICK }) % alivePlayers.length;
  return alivePlayers[pick];
}

export function updateJinxedTimer(ctx: PerksUpdateEffectsCtx): void {
  if (ctx.state.jinxedTimer >= 0.0) {
    ctx.state.jinxedTimer -= ctx.dt;
  }
}

export function updateJinxed(ctx: PerksUpdateEffectsCtx): void {
  if (ctx.state.jinxedTimer >= 0.0) {
    return;
  }
  if (ctx.players.length === 0) {
    return;
  }
  if (!perkActive(ctx.players[0], PerkId.JINXED)) {
    return;
  }

  if (ctx.state.rng.rand({ caller: RngCallerStatic.PERKS_UPDATE_EFFECTS_JINXED_ACCIDENT_GATE }) % 10 === 3) {
    const player = selectJinxedAccidentTarget(ctx);
    player.health = player.health - 5.0;
    if (ctx.fxQueue !== null) {
      ctx.fxQueue.addRandom({
        pos: player.pos,
        rng: ctx.state.rng,
      });
      ctx.fxQueue.addRandom({
        pos: player.pos,
        rng: ctx.state.rng,
      });
    }
  }

  ctx.state.jinxedTimer = ctx.state.rng.rand({ caller: RngCallerStatic.PERKS_UPDATE_EFFECTS_JINXED_TIMER_RESET }) % 20 * 0.1 + ctx.state.jinxedTimer + 2.0;

  let idx: number;
  let attempts: number;
  if (ctx.state.bonuses.freeze <= 0.0 && ctx.creatures !== null) {
    const poolLimit = ctx.state.preserveBugs ? 0x17F : 0x180;
    const poolMod = Math.min(poolLimit, ctx.creatures.length);
    if (poolMod <= 0) {
      return;
    }

    idx = ctx.state.rng.rand({ caller: RngCallerStatic.PERKS_UPDATE_EFFECTS_JINXED_CREATURE_PICK }) % poolMod;
    attempts = 0;
    while (attempts < 10 && !ctx.creatures[idx].active) {
      idx = ctx.state.rng.rand({ caller: RngCallerStatic.PERKS_UPDATE_EFFECTS_JINXED_CREATURE_RETRY }) % poolMod;
      attempts += 1;
    }
    if (!ctx.creatures[idx].active) {
      return;
    }

    const creature = ctx.creatures[idx];
    creature.hp = -1.0;
    creature.lifecycleStage = creature.lifecycleStage - ctx.dt * 20.0;
    awardExperienceFromReward(ctx, { rewardValue: creature.rewardValue });
    ctx.state.sfxQueue.push(SfxId.TROOPER_INPAIN_01);
  }
}

export const HOOKS = new PerkHooks({
  perkId: PerkId.JINXED,
  effectsSteps: [updateJinxedTimer, updateJinxed],
});
