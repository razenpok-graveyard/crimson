// Port of crimson/sim/presentation_reactions.py

import { SfxId } from '@grim/sfx-map.ts';
import type { TickResult } from '@crimson/sim/hooks.ts';
import type { QuestSpawnState } from '@crimson/sim/sessions.ts';

export class QuestPresentationReaction {
  readonly playHitSfx: boolean;
  readonly playCompletionMusic: boolean;

  constructor(opts: {
    playHitSfx?: boolean;
    playCompletionMusic?: boolean;
  } = {}) {
    this.playHitSfx = opts.playHitSfx ?? false;
    this.playCompletionMusic = opts.playCompletionMusic ?? false;
  }
}

export class PostApplyReaction {
  readonly sfx: readonly SfxId[];
  readonly quest: QuestPresentationReaction | null;

  constructor(opts: {
    sfx?: readonly SfxId[];
    quest?: QuestPresentationReaction | null;
  } = {}) {
    this.sfx = Array.from(opts.sfx ?? []);
    this.quest = opts.quest ?? null;
  }
}

export function buildPostApplyReaction(opts: { tickResult: TickResult; questState?: QuestSpawnState | null }): PostApplyReaction {
  const tickResult = opts.tickResult;
  const questState = opts.questState ?? null;
  if (questState === null) {
    return new PostApplyReaction({ sfx: Array.from(tickResult.payload.step.postApplySfx) });
  }
  return new PostApplyReaction({ sfx: Array.from(tickResult.payload.step.postApplySfx), quest: new QuestPresentationReaction({ playHitSfx: questState.playHitSfx, playCompletionMusic: questState.playCompletionMusic }) });
}

export function applyPostApplyReaction(opts: { reaction: PostApplyReaction; playSfx: ((arg0: SfxId) => void) | null; playCompletionMusic?: (() => void) | null }): void {
  const reaction = opts.reaction;
  const playSfx = opts.playSfx;
  const playCompletionMusic = opts.playCompletionMusic ?? null;
  const quest = reaction.quest;
  if (playSfx !== null) {
    for (const sfx of reaction.sfx) {
      playSfx(sfx);
    }
    if (quest !== null && Boolean(quest.playHitSfx)) {
      playSfx(SfxId.QUESTHIT);
    }
  }

  if (quest !== null && Boolean(quest.playCompletionMusic) && playCompletionMusic !== null) {
    playCompletionMusic();
  }
}
