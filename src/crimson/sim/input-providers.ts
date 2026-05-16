// Port of crimson/sim/input_providers.py

import { clearInputEdges } from '@crimson/local-input.ts';
import type { PlayerInput } from '@crimson/sim/input.ts';

export type TypoChar = string;
export type GameCommand = PerkMenuOpenCommand | PerkPickCommand | TypoCharCommand | TypoBackspaceCommand | TypoSubmitCommand;
export type LocalInputBuilder = (arg0: FrameContext) => readonly PlayerInput[];

function validateTypoChar(value: string): TypoChar {
  if (value.length < 1 || value.length > 1) {
    throw new Error('invalid TypoChar');
  }
  return value;
}

export interface InputProvider {
  beginFrame(frameCtx: FrameContext): void;
  pullTick(tickIndex: number, defaultDtSeconds: number): TickSupply;
  supportsCommandSubmission(): boolean;
  submitCommand(command: GameCommand): void;
}

export enum InputStatus {
  READY = 'ready',
  STALLED = 'stalled',
  EOS = 'eos',
}

export class PerkMenuOpenCommand {
  readonly tag = 'perk_menu_open';
  readonly playerIndex: number;

  constructor(opts: {
    playerIndex: number;
  }) {
    this.playerIndex = opts.playerIndex;
  }
}

export class PerkPickCommand {
  readonly tag = 'perk_pick';
  readonly playerIndex: number;
  readonly choiceIndex: number;

  constructor(opts: {
    playerIndex: number;
    choiceIndex: number;
  }) {
    this.playerIndex = opts.playerIndex;
    this.choiceIndex = opts.choiceIndex;
  }
}

export class TypoCharCommand {
  readonly tag = 'typo_char';
  readonly playerIndex: number;
  readonly ch: TypoChar;

  constructor(opts: {
    playerIndex: number;
    ch: TypoChar;
  }) {
    this.playerIndex = opts.playerIndex;
    this.ch = opts.ch;
  }
}

export class TypoBackspaceCommand {
  readonly tag = 'typo_backspace';
  readonly playerIndex: number;

  constructor(opts: {
    playerIndex: number;
  }) {
    this.playerIndex = opts.playerIndex;
  }
}

export class TypoSubmitCommand {
  readonly tag = 'typo_submit';
  readonly playerIndex: number;

  constructor(opts: {
    playerIndex: number;
  }) {
    this.playerIndex = opts.playerIndex;
  }
}

export class FrameContext {
  readonly dtSeconds: number;
  readonly tickDtSeconds: number;
  readonly frameIndex: number;
  readonly candidateTicks: number;
  readonly isNetworked: boolean;
  readonly isReplay: boolean;

  constructor(opts: {
    dtSeconds: number;
    tickDtSeconds: number;
    frameIndex: number;
    candidateTicks: number;
    isNetworked?: boolean;
    isReplay?: boolean;
  }) {
    this.dtSeconds = opts.dtSeconds;
    this.tickDtSeconds = opts.tickDtSeconds;
    this.frameIndex = opts.frameIndex;
    this.candidateTicks = opts.candidateTicks;
    this.isNetworked = opts.isNetworked ?? false;
    this.isReplay = opts.isReplay ?? false;
  }
}

export class ResolvedTick {
  readonly tickIndex: number;
  readonly dtSeconds: number;
  readonly inputs: PlayerInput[];
  readonly commands: GameCommand[];

  constructor(opts: {
    tickIndex: number;
    dtSeconds: number;
    inputs?: PlayerInput[];
    commands?: GameCommand[];
  }) {
    this.tickIndex = opts.tickIndex;
    this.dtSeconds = opts.dtSeconds;
    this.inputs = opts.inputs ?? [];
    this.commands = opts.commands ?? [];
  }
}

export class TickSupply {
  readonly status: InputStatus;
  readonly tick: ResolvedTick | null;

  constructor(opts: {
    status: InputStatus;
    tick?: ResolvedTick | null;
  }) {
    this.status = opts.status;
    this.tick = opts.tick ?? null;
  }
}

// Adapter over local input polling.
export class LocalInputProvider {
  private readonly _playerCount: number;
  private readonly _buildInputs: LocalInputBuilder;
  private readonly _pendingCommands: GameCommand[];
  private readonly _commandsForNextTick: GameCommand[];
  private _frameInputs: PlayerInput[];
  private _edgeInputs: PlayerInput[];
  private _firstTickPending: boolean;

  constructor(opts: { playerCount: number; buildInputs: LocalInputBuilder }) {
    const playerCount = opts.playerCount;
    const buildInputs = opts.buildInputs;
    this._playerCount = Math.max(0, playerCount);
    this._buildInputs = buildInputs;
    this._pendingCommands = [];
    this._commandsForNextTick = [];
    this._frameInputs = [];
    this._edgeInputs = [];
    this._firstTickPending = false;
  }

  beginFrame(frameCtx: FrameContext): void {
    const frameInputs = Array.from(this._buildInputs(frameCtx));
    this._frameInputs = Array.from(frameInputs);
    this._edgeInputs = clearInputEdges(this._frameInputs);
    this._firstTickPending = true;
    if (this._pendingCommands.length > 0) {
      this._commandsForNextTick.push(...this._pendingCommands);
      this._pendingCommands.length = 0;
    }
  }

  pullTick(tickIndex: number, defaultDtSeconds: number): TickSupply {
    tickIndex = int(tickIndex);
    const dtSeconds = defaultDtSeconds;
    let inputs: any;
    if (this._firstTickPending) {
      this._firstTickPending = false;
      inputs = this._playerCount <= 0 ? [] : Array.from(this._frameInputs);
      const commands = Array.from(this._commandsForNextTick);
      this._commandsForNextTick.length = 0;
      return new TickSupply({ status: InputStatus.READY, tick: new ResolvedTick({ tickIndex: tickIndex, dtSeconds: dtSeconds, inputs: inputs, commands: commands }) });
    }
    inputs = this._playerCount <= 0 ? [] : Array.from(this._edgeInputs);
    return new TickSupply({ status: InputStatus.READY, tick: new ResolvedTick({ tickIndex: tickIndex, dtSeconds: dtSeconds, inputs: inputs, commands: [] }) });
  }

  supportsCommandSubmission(): boolean {
    return true;
  }

  submitCommand(command: GameCommand): void {
    this._pendingCommands.push(command);
  }
}
