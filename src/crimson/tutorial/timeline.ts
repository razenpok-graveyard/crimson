// Port of crimson/tutorial/timeline.py

import { Vec2 } from '@grim/geom.ts';
import { BonusId } from '@crimson/bonuses/index.ts';
import { SpawnId, SpawnTemplateCall, buildTutorialStage3FireSpawns, buildTutorialStage4ClearSpawns, buildTutorialStage5RepeatSpawns, buildTutorialStage6PerksDoneSpawns } from '@crimson/creatures/spawn.ts';
import type { TutorialState } from '@crimson/tutorial/state.ts';

export const TUTORIAL_STAGE_TEXT: readonly string[] = [
  'In this tutorial you\'ll learn how to play Crimsonland',
  'First learn to move by pushing the arrow keys.',
  'Now pick up the bonuses by walking over them',
  'Now learn to shoot and move at the same time.\nClick the left Mouse button to shoot.',
  'Now, move the mouse to aim at the monsters',
  'It will help you to move and shoot at the same time. Just keep moving!',
  'Now let\'s learn about Perks. You\'ll receive a perk when you gain enough experience points.',
  'Perks can give you extra abilities, or boost your skills. Choose wisely!',
  'Great! Now you are ready to start playing Crimsonland',
];
export const TUTORIAL_HINT_TEXT: readonly string[] = [
  'This is the speed powerup, it makes you move faster!',
  'This is a weapon powerup. Picking it up gives you a new weapon.',
  'This powerup doubles all experience points you gain while it\'s active.',
  'This is the nuke powerup, picking it up causes a huge\nexplosion harming all monsters nearby!',
  'Reflex Boost powerup slows down time giving you a chance to react better',
  '',
  '',
];
export const TUTORIAL_HINT_TEXT_BUGS: readonly string[] = [
  'This is the speed powerup, it makes you move faster!',
  'This is a weapon powerup. Picking it you gets a new weapon.',
  'This powerup doubles all experience points you gain while it\'s active.',
  'This is the nuke powerup, picking it up causes a huge\nexposion harming all monsters nearby!',
  'Reflex Boost powerup slows down time giving you a chance to react better',
  '',
  '',
];

export class BonusSpawnCall {
  readonly bonusId: BonusId;
  readonly amount: number;
  readonly pos: Vec2;

  constructor(opts: {
    bonusId: BonusId;
    amount: number;
    pos: Vec2;
  }) {
    this.bonusId = opts.bonusId;
    this.amount = opts.amount;
    this.pos = opts.pos;
  }
}

export class TutorialFrameActions {
  readonly promptText: string;
  readonly promptAlpha: number;
  readonly hintText: string;
  readonly hintAlpha: number;
  readonly spawnTemplates: readonly SpawnTemplateCall[];
  readonly spawnBonuses: readonly BonusSpawnCall[];
  readonly stage5BonusCarrierDrop: [BonusId, number] | null;
  readonly playLevelupSfx: boolean;
  readonly forcePlayerHealth: number;
  readonly forcePlayerExperience: number | null;

  constructor(opts: {
    promptText?: string;
    promptAlpha?: number;
    hintText?: string;
    hintAlpha?: number;
    spawnTemplates?: readonly SpawnTemplateCall[];
    spawnBonuses?: readonly BonusSpawnCall[];
    stage5BonusCarrierDrop?: [BonusId, number] | null;
    playLevelupSfx?: boolean;
    forcePlayerHealth?: number;
    forcePlayerExperience?: number | null;
  } = {}) {
    this.promptText = opts.promptText ?? '';
    this.promptAlpha = opts.promptAlpha ?? 0.0;
    this.hintText = opts.hintText ?? '';
    this.hintAlpha = opts.hintAlpha ?? 0.0;
    this.spawnTemplates = Array.from(opts.spawnTemplates ?? []);
    this.spawnBonuses = Array.from(opts.spawnBonuses ?? []);
    this.stage5BonusCarrierDrop = opts.stage5BonusCarrierDrop ?? null;
    this.playLevelupSfx = opts.playLevelupSfx ?? false;
    this.forcePlayerHealth = opts.forcePlayerHealth ?? 100.0;
    this.forcePlayerExperience = opts.forcePlayerExperience ?? null;
  }
}

export function tutorialStage5BonusCarrierConfig(repeatSpawnCount: number): [BonusId, number] | null {
  // Return the (bonus_id, amount_override) applied to the stage-5 bonus carrier for this repeat count.
  //
  // This reproduces the packed bonus-arg writes to `tutorial_hint_bonus_ptr` in `tutorial_timeline_update`.
  //
  // - amount_override == -1 means "use the bonus meta default".
  // - For weapon bonuses, amount_override is the weapon id.
  const n = int(repeatSpawnCount);
  if (n === 1) {
    return [BonusId.SPEED, -1];
  }
  if (n === 2) {
    return [BonusId.WEAPON, 5];
  }
  if (n === 3) {
    return [BonusId.DOUBLE_EXPERIENCE, -1];
  }
  if (n === 4) {
    return [BonusId.NUKE, -1];
  }
  if (n === 5) {
    return [BonusId.REFLEX_BOOST, -1];
  }
  return null;
}

function clamp01(value: number): number {
  if (value <= 0.0) {
    return 0.0;
  }
  if (value >= 1.0) {
    return 1.0;
  }
  return value;
}

function tickStageTransition(stageIndex: number, transitionTimerMs: number, opts: { frameDtMs: number }): [number, number] {
  const frameDtMs = opts.frameDtMs;
  stageIndex = int(stageIndex);
  transitionTimerMs = int(transitionTimerMs);
  const dtMs = int(frameDtMs);

  if (transitionTimerMs < -1) {
    transitionTimerMs += dtMs;
    if (transitionTimerMs < -1) {
      return [stageIndex, transitionTimerMs];
    }
    stageIndex += 1;
    if (stageIndex === 9) {
      stageIndex = 0;
    }
    transitionTimerMs = 0;
    return [stageIndex, transitionTimerMs];
  }

  if (-1 < transitionTimerMs) {
    transitionTimerMs += dtMs;
  }
  if (1000 < transitionTimerMs) {
    transitionTimerMs = -1;
  }
  return [stageIndex, transitionTimerMs];
}

function promptAlpha(opts: { stageIndex: number; stageTimerMs: number; transitionTimerMs: number }): number {
  let stageIndex = opts.stageIndex;
  let stageTimerMs = opts.stageTimerMs;
  let transitionTimerMs = opts.transitionTimerMs;
  stageIndex = int(stageIndex);
  stageTimerMs = int(stageTimerMs);
  transitionTimerMs = int(transitionTimerMs);

  if (stageIndex < 0) {
    return 0.0;
  }

  let alpha: number;
  if (transitionTimerMs < -1) {
    alpha = -transitionTimerMs * 0.001;
  } else if (transitionTimerMs < 0) {
    alpha = 1.0;
  } else {
    alpha = transitionTimerMs * 0.001;
  }

  if (stageIndex === 5) {
    if (stageTimerMs > 5000 && transitionTimerMs > -2) {
      alpha = 1.0 - (stageTimerMs - 5000) * 0.001;
    }
    if (stageTimerMs >= 0x1771) {
      alpha = 0.0;
    }
  }

  return clamp01(alpha);
}

function tickHint(state: TutorialState, opts: { frameDtMs: number; hintBonusDied: boolean }): [SpawnTemplateCall[], string, number] {
  const frameDtMs = opts.frameDtMs;
  const hintBonusDied = opts.hintBonusDied;
  const hintSpawns: SpawnTemplateCall[] = [];

  if (!state.hintFadeIn && hintBonusDied) {
    state.hintFadeIn = true;
    state.hintIndex = int(state.hintIndex) + 1;
    hintSpawns.push(...[new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_GREEN_24, pos: new Vec2(128.0, 128.0), heading: 3.1415927 }), new SpawnTemplateCall({ templateId: SpawnId.ALIEN_CONST_PALE_GREEN_26, pos: new Vec2(152.0, 160.0), heading: 3.1415927 })]);
  }

  const delta = int(frameDtMs) * 3;
  state.hintAlpha = int(state.hintAlpha) + (state.hintFadeIn ? delta : -delta);
  if (state.hintAlpha < 0) {
    state.hintAlpha = 0;
  } else if (state.hintAlpha > 1000) {
    state.hintAlpha = 1000;
  }

  const hintTextTable = state.preserveBugs ? TUTORIAL_HINT_TEXT_BUGS : TUTORIAL_HINT_TEXT;
  const idx = int(state.hintIndex);
  const text = idx >= 0 && idx < hintTextTable.length ? hintTextTable[idx] : '';
  const alpha = text ? state.hintAlpha * 0.001 : 0.0;
  return [Array.from(hintSpawns), text, clamp01(alpha)];
}

export function tickTutorialTimeline(state: TutorialState, opts: { frameDtMs: number; anyMoveActive: boolean; anyFireActive: boolean; creaturesNoneActive: boolean; bonusPoolEmpty: boolean; perkPendingCount: number; hintBonusDied?: boolean }): [TutorialState, TutorialFrameActions] {
  // Pure model of the tutorial director (`tutorial_timeline_update` / 0x00408990).
  //
  // Notes:
  // - The returned UI model (prompt/hint text+alpha) reflects the state *before* any stage triggers
  //   applied by this tick. The returned state reflects the post-trigger values for the next frame.
  const frameDtMs = opts.frameDtMs;
  const anyMoveActive = opts.anyMoveActive;
  const anyFireActive = opts.anyFireActive;
  const creaturesNoneActive = opts.creaturesNoneActive;
  const bonusPoolEmpty = opts.bonusPoolEmpty;
  const perkPendingCount = opts.perkPendingCount;
  const hintBonusDied = opts.hintBonusDied ?? false;
  const dtMs = int(frameDtMs);
  state = (() => { const value = state; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value }); })();
  state.stageTimerMs = int(state.stageTimerMs) + dtMs;

  const [stageIndex, transitionTimerMs] = tickStageTransition(state.stageIndex, state.stageTransitionTimerMs, { frameDtMs: dtMs });
  state.stageIndex = int(stageIndex);
  state.stageTransitionTimerMs = int(transitionTimerMs);

  let promptText = stageIndex >= 0 && stageIndex < TUTORIAL_STAGE_TEXT.length ? TUTORIAL_STAGE_TEXT[stageIndex] : '';
  let promptAlphaValue = promptAlpha({ stageIndex: stageIndex, stageTimerMs: state.stageTimerMs, transitionTimerMs: transitionTimerMs });
  if (stageIndex === 6 && int(perkPendingCount) < 1) {
    promptText = '';
    promptAlphaValue = 0.0;
  }

  const [hintSpawns, hintText, hintAlpha] = tickHint(state, { frameDtMs: dtMs, hintBonusDied: hintBonusDied });

  const actions = new TutorialFrameActions({ promptText: promptText, promptAlpha: promptAlphaValue, hintText: hintText, hintAlpha: hintAlpha, spawnTemplates: hintSpawns, spawnBonuses: [], stage5BonusCarrierDrop: null, playLevelupSfx: false, forcePlayerHealth: 100.0, forcePlayerExperience: stageIndex !== 6 ? 0 : null });

  const spawnTemplates: SpawnTemplateCall[] = Array.from(actions.spawnTemplates);
  const spawnBonuses: BonusSpawnCall[] = [];
  let playLevelupSfx = false;
  let stage5BonusCarrierDrop: [BonusId, number] | null = null;
  let forceExperience = actions.forcePlayerExperience;

  if (stageIndex === 0) {
    if (state.stageTimerMs > 6000 && state.stageTransitionTimerMs === -1) {
      state.repeatSpawnCount = 0;
      state.hintIndex = int(state.stageTransitionTimerMs);
      state.hintFadeIn = false;
      state.stageTransitionTimerMs = -1000;
    }
  } else if (stageIndex === 1) {
    if (anyMoveActive && state.stageTransitionTimerMs === -1) {
      state.stageTransitionTimerMs = -1000;
      playLevelupSfx = true;
      spawnBonuses.push(...[new BonusSpawnCall({ bonusId: BonusId.POINTS, amount: 500, pos: new Vec2(260.0, 260.0) }), new BonusSpawnCall({ bonusId: BonusId.POINTS, amount: 1000, pos: new Vec2(600.0, 400.0) }), new BonusSpawnCall({ bonusId: BonusId.POINTS, amount: 500, pos: new Vec2(300.0, 400.0) })]);
    }
  } else if (stageIndex === 2) {
    if (bonusPoolEmpty && state.stageTransitionTimerMs === -1) {
      state.stageTransitionTimerMs = -1000;
      playLevelupSfx = true;
    }
  } else if (stageIndex === 3) {
    if (anyFireActive && state.stageTransitionTimerMs === -1) {
      state.stageTransitionTimerMs = -1000;
      playLevelupSfx = true;
      spawnTemplates.push(...buildTutorialStage3FireSpawns());
    }
  } else if (stageIndex === 4) {
    if (creaturesNoneActive && state.stageTransitionTimerMs === -1) {
      state.stageTimerMs = 1000;
      state.stageTransitionTimerMs = -1000;
      playLevelupSfx = true;
      state.repeatSpawnCount = 0;
      spawnTemplates.push(...buildTutorialStage4ClearSpawns());
    }
  } else if (stageIndex === 5) {
    if (bonusPoolEmpty && creaturesNoneActive) {
      state.repeatSpawnCount = int(state.repeatSpawnCount) + 1;
      if (int(state.repeatSpawnCount) < 8) {
        state.hintFadeIn = false;
        state.hintBonusCreatureRef = null;
        spawnTemplates.push(...buildTutorialStage5RepeatSpawns(int(state.repeatSpawnCount)));
        stage5BonusCarrierDrop = tutorialStage5BonusCarrierConfig(int(state.repeatSpawnCount));
      } else if (state.stageTransitionTimerMs === -1) {
        state.stageTransitionTimerMs = -1000;
        playLevelupSfx = true;
        forceExperience = 3000;
      }
    }
  } else if (stageIndex === 6) {
    if (int(perkPendingCount) < 1 && state.stageTransitionTimerMs === -1) {
      state.stageTransitionTimerMs = -1000;
      spawnTemplates.push(...buildTutorialStage6PerksDoneSpawns());
    }
  } else if (stageIndex === 7) {
    if (bonusPoolEmpty && creaturesNoneActive && state.stageTransitionTimerMs === -1) {
      state.stageTransitionTimerMs = -1000;
    }
  }

  return [state, new TutorialFrameActions({ promptText: actions.promptText, promptAlpha: actions.promptAlpha, hintText: actions.hintText, hintAlpha: actions.hintAlpha, spawnTemplates: Array.from(spawnTemplates), spawnBonuses: Array.from(spawnBonuses), stage5BonusCarrierDrop: stage5BonusCarrierDrop, playLevelupSfx: playLevelupSfx, forcePlayerHealth: actions.forcePlayerHealth, forcePlayerExperience: forceExperience })];
}
