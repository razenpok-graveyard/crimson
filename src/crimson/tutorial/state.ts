// Port of crimson/tutorial/state.py

export function resetTutorialState(tutorial: TutorialState, overlay: TutorialOverlayState, opts: { preserveBugs: boolean }): void {
  const preserveBugs = opts.preserveBugs;
  tutorial.stageIndex = -1;
  tutorial.stageTimerMs = 0;
  tutorial.stageTransitionTimerMs = -1000;
  tutorial.hintIndex = -1;
  tutorial.hintAlpha = 0;
  tutorial.hintFadeIn = false;
  tutorial.repeatSpawnCount = 0;
  tutorial.hintBonusCreatureRef = null;
  tutorial.preserveBugs = preserveBugs;
  tutorial.moveActiveThisTick = false;
  tutorial.fireActiveThisTick = false;
  tutorial.hintBonusAliveBeforeTick = false;
  overlay.promptText = '';
  overlay.promptAlpha = 0.0;
  overlay.hintText = '';
  overlay.hintAlpha = 0.0;
}

export class TutorialState {
  stageIndex: number;
  stageTimerMs: number;
  stageTransitionTimerMs: number;
  hintIndex: number;
  hintAlpha: number;
  hintFadeIn: boolean;
  repeatSpawnCount: number;
  hintBonusCreatureRef: number | null;
  preserveBugs: boolean;
  moveActiveThisTick: boolean;
  fireActiveThisTick: boolean;
  hintBonusAliveBeforeTick: boolean;

  constructor(opts: {
    stageIndex?: number;
    stageTimerMs?: number;
    stageTransitionTimerMs?: number;
    hintIndex?: number;
    hintAlpha?: number;
    hintFadeIn?: boolean;
    repeatSpawnCount?: number;
    hintBonusCreatureRef?: number | null;
    preserveBugs?: boolean;
    moveActiveThisTick?: boolean;
    fireActiveThisTick?: boolean;
    hintBonusAliveBeforeTick?: boolean;
  } = {}) {
    this.stageIndex = opts.stageIndex ?? -1;
    this.stageTimerMs = opts.stageTimerMs ?? 0;
    this.stageTransitionTimerMs = opts.stageTransitionTimerMs ?? -1000;
    this.hintIndex = opts.hintIndex ?? -1;
    this.hintAlpha = opts.hintAlpha ?? 0;
    this.hintFadeIn = opts.hintFadeIn ?? false;
    this.repeatSpawnCount = opts.repeatSpawnCount ?? 0;
    this.hintBonusCreatureRef = opts.hintBonusCreatureRef ?? null;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.moveActiveThisTick = opts.moveActiveThisTick ?? false;
    this.fireActiveThisTick = opts.fireActiveThisTick ?? false;
    this.hintBonusAliveBeforeTick = opts.hintBonusAliveBeforeTick ?? false;
  }
}

export class TutorialOverlayState {
  promptText: string;
  promptAlpha: number;
  hintText: string;
  hintAlpha: number;

  constructor(opts: {
    promptText?: string;
    promptAlpha?: number;
    hintText?: string;
    hintAlpha?: number;
  } = {}) {
    this.promptText = opts.promptText ?? '';
    this.promptAlpha = opts.promptAlpha ?? 0.0;
    this.hintText = opts.hintText ?? '';
    this.hintAlpha = opts.hintAlpha ?? 0.0;
  }
}
