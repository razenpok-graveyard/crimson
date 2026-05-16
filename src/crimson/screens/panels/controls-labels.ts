// Port of crimson/screens/panels/controls_labels.py

import type { CrimsonControlsConfig } from '@grim/config.ts';
import { AimScheme } from '@crimson/aim-schemes.ts';
import { MovementControlType } from '@crimson/movement-controls.ts';

export enum RebindTarget {
  PLAYER_MOVE_CODES = 1,
  PLAYER_FIRE_CODE = 2,
  PLAYER_KEYBOARD_AIM_CODES = 3,
  PLAYER_AIM_AXIS_CODES = 4,
  PLAYER_MOVE_AXIS_CODES = 5,
  GLOBAL_PICK_PERK_CODE = 6,
  GLOBAL_RELOAD_CODE = 7,
}

export class RebindRowSpec {
  readonly label: string;
  readonly target: RebindTarget;
  readonly targetIndex: number | null;
  readonly axis: boolean;

  constructor(opts: {
    label: string;
    target: RebindTarget;
    targetIndex?: number | null;
    axis?: boolean;
  }) {
    this.label = opts.label;
    this.target = opts.target;
    this.targetIndex = opts.targetIndex ?? null;
    this.axis = opts.axis ?? false;
  }
}

export function inputConfigureForLabel(configId: AimScheme): string {
  // Port of `input_configure_for_label` (0x00447c90).

  const labels = new Map([[AimScheme.MOUSE, 'Mouse'], [AimScheme.KEYBOARD, 'Keyboard'], [AimScheme.JOYSTICK, 'Joystick'], [AimScheme.MOUSE_RELATIVE, 'Mouse relative'], [AimScheme.DUAL_ACTION_PAD, 'Dual Action Pad'], [AimScheme.COMPUTER, 'Computer']]);
  return labels.get(configId) ?? 'Unknown';
}

export function inputSchemeLabel(scheme: MovementControlType): string {
  // Port of `input_scheme_label` (0x00447cf0).

  const labels = new Map([[MovementControlType.UNKNOWN, 'Unknown'], [MovementControlType.RELATIVE, 'Relative'], [MovementControlType.STATIC, 'Static'], [MovementControlType.DUAL_ACTION_PAD, 'Dual Action Pad'], [MovementControlType.MOUSE_POINT_CLICK, 'Mouse point click'], [MovementControlType.COMPUTER, 'Computer']]);
  return labels.get(scheme) ?? 'Unknown';
}

export function controlsMethodLabels(controls: CrimsonControlsConfig, opts: { playerIndex: number }): [string, string] {
  const playerIndex = opts.playerIndex;
  const player = controls.player(playerIndex);
  const aimScheme = player.aimScheme;
  const moveMode = player.movement;
  return [inputConfigureForLabel(aimScheme), inputSchemeLabel(moveMode)];
}

export function controlsAimMethodDropdownIds(currentAimScheme: AimScheme): AimScheme[] {
  const ids = [AimScheme.MOUSE, AimScheme.KEYBOARD, AimScheme.JOYSTICK, AimScheme.MOUSE_RELATIVE, AimScheme.DUAL_ACTION_PAD];
  if (currentAimScheme === AimScheme.COMPUTER) {
    // Original menu keeps "Computer" hidden unless loaded from config.
    ids.push(AimScheme.COMPUTER);
  }
  return Array.from(ids);
}

export function controlsRebindPlan(opts: { aimScheme: AimScheme; moveMode: MovementControlType; playerIndex: number }): [RebindRowSpec[], RebindRowSpec[], RebindRowSpec[]] {
  // Return (aim_rows, move_rows, misc_rows) for `controls_menu_update`.

  const aimScheme = opts.aimScheme;
  const moveMode = opts.moveMode;
  const playerIndex = opts.playerIndex;
  const aimRows: RebindRowSpec[] = [];
  const moveRows: RebindRowSpec[] = [];
  const miscRows: RebindRowSpec[] = [];

  if (aimScheme === AimScheme.KEYBOARD) {
    aimRows.push(new RebindRowSpec({ label: 'Torso left:', target: RebindTarget.PLAYER_KEYBOARD_AIM_CODES, targetIndex: 0 }));
    aimRows.push(new RebindRowSpec({ label: 'Torso right:', target: RebindTarget.PLAYER_KEYBOARD_AIM_CODES, targetIndex: 1 }));
  } else if (aimScheme === AimScheme.DUAL_ACTION_PAD) {
    aimRows.push(new RebindRowSpec({ label: 'Aim Up/Down Axis:', target: RebindTarget.PLAYER_AIM_AXIS_CODES, targetIndex: 0, axis: true }));
    aimRows.push(new RebindRowSpec({ label: 'Aim Left/Right Axis:', target: RebindTarget.PLAYER_AIM_AXIS_CODES, targetIndex: 1, axis: true }));
  }
  aimRows.push(new RebindRowSpec({ label: 'Fire:', target: RebindTarget.PLAYER_FIRE_CODE }));

  if (moveMode === MovementControlType.STATIC) {
    moveRows.push(...[new RebindRowSpec({ label: 'Move Up:', target: RebindTarget.PLAYER_MOVE_CODES, targetIndex: 0 }), new RebindRowSpec({ label: 'Move Down:', target: RebindTarget.PLAYER_MOVE_CODES, targetIndex: 1 }), new RebindRowSpec({ label: 'Move Left:', target: RebindTarget.PLAYER_MOVE_CODES, targetIndex: 2 }), new RebindRowSpec({ label: 'Move Right:', target: RebindTarget.PLAYER_MOVE_CODES, targetIndex: 3 })]);
  } else if (moveMode === MovementControlType.RELATIVE) {
    moveRows.push(...[new RebindRowSpec({ label: 'Forward:', target: RebindTarget.PLAYER_MOVE_CODES, targetIndex: 0 }), new RebindRowSpec({ label: 'Backwards:', target: RebindTarget.PLAYER_MOVE_CODES, targetIndex: 1 }), new RebindRowSpec({ label: 'Turn left:', target: RebindTarget.PLAYER_MOVE_CODES, targetIndex: 2 }), new RebindRowSpec({ label: 'Turn right:', target: RebindTarget.PLAYER_MOVE_CODES, targetIndex: 3 })]);
  } else if (moveMode === MovementControlType.DUAL_ACTION_PAD) {
    moveRows.push(...[new RebindRowSpec({ label: 'Up/Down Axis:', target: RebindTarget.PLAYER_MOVE_AXIS_CODES, targetIndex: 0, axis: true }), new RebindRowSpec({ label: 'Left/Right Axis:', target: RebindTarget.PLAYER_MOVE_AXIS_CODES, targetIndex: 1, axis: true })]);
  } else if (moveMode === MovementControlType.MOUSE_POINT_CLICK) {
    moveRows.push(new RebindRowSpec({ label: 'Move to cursor:', target: RebindTarget.GLOBAL_RELOAD_CODE }));
  }

  if (int(playerIndex) === 0) {
    miscRows.push(new RebindRowSpec({ label: 'Level Up:', target: RebindTarget.GLOBAL_PICK_PERK_CODE }));
    if (moveMode !== MovementControlType.MOUSE_POINT_CLICK) {
      miscRows.push(new RebindRowSpec({ label: 'Reload:', target: RebindTarget.GLOBAL_RELOAD_CODE }));
    }
  }

  return [Array.from(aimRows), Array.from(moveRows), Array.from(miscRows)];
}
