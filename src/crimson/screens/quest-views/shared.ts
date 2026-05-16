// Port of crimson/screens/quest_views/shared.py

import { QuestLevel } from '@crimson/quests/level.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { Vec2 } from '@grim/geom.ts';

export const QUEST_MENU_BASE_X = -5.0;
export const QUEST_MENU_BASE_Y = 185.0;
export const QUEST_MENU_PANEL_OFFSET_X = -63.0;
export const QUEST_TITLE_X_OFFSET = 219.0; // 300 + 64 - 145
export const QUEST_TITLE_Y_OFFSET = 44.0; // 40 + 4
export const QUEST_TITLE_W = 64.0;
export const QUEST_TITLE_H = 32.0;
export const QUEST_STAGE_ICON_X_OFFSET = 80.0; // 64 + 16
export const QUEST_STAGE_ICON_Y_OFFSET = 3.0;
export const QUEST_STAGE_ICON_SIZE = 32.0;
export const QUEST_STAGE_ICON_STEP = 36.0;
export const QUEST_STAGE_ICON_SCALE_UNSELECTED = 0.8;
export const QUEST_LIST_Y_OFFSET = 50.0;
export const QUEST_LIST_ROW_STEP = 20.0;
export const QUEST_LIST_NAME_X_OFFSET = 32.0;
export const QUEST_LIST_HOVER_LEFT_PAD = 10.0;
export const QUEST_LIST_HOVER_RIGHT_PAD = 210.0;
export const QUEST_LIST_HOVER_TOP_PAD = 2.0;
export const QUEST_LIST_HOVER_BOTTOM_PAD = 18.0;
export const QUEST_HARDCORE_UNLOCK_INDEX = 40;
export const QUEST_HARDCORE_CHECKBOX_X_OFFSET = 132.0;
export const QUEST_HARDCORE_CHECKBOX_Y_OFFSET = -12.0;
export const QUEST_HARDCORE_LIST_Y_SHIFT = 10.0;
export const QUEST_BACK_BUTTON_X_OFFSET = 138.0;
export const QUEST_BACK_BUTTON_Y_OFFSET = 212.0;
export const QUEST_PANEL_HEIGHT = 378.0;
// game_update_victory_screen (0x00406350): used as the "end note" screen after the final quest.
export const END_NOTE_PANEL_POS_X = -45.0;
export const END_NOTE_PANEL_POS_Y = 110.0;
export const END_NOTE_PANEL_GEOM_X0 = -63.0;
export const END_NOTE_PANEL_GEOM_Y0 = -81.0;
export const END_NOTE_PANEL_W = 510.0;
export const END_NOTE_PANEL_H = 378.0;
export const END_NOTE_HEADER_X_OFFSET = 214.0; // v11 + 44 - 10 in the decompile, relative to panel-left
export const END_NOTE_HEADER_Y_OFFSET = 46.0; // (base_y + 40) + 6 in the decompile, relative to panel-top
export const END_NOTE_BODY_X_OFFSET = END_NOTE_HEADER_X_OFFSET - 8.0;
export const END_NOTE_BODY_Y_GAP = 32.0;
export const END_NOTE_LINE_STEP_Y = 14.0;
export const END_NOTE_AFTER_BODY_Y_GAP = 22.0; // 14 + 8 in the decompile
export const END_NOTE_BUTTON_X_OFFSET = 266.0; // (v11 + 44 + 20) - 4 + 26, relative to panel-left
export const END_NOTE_BUTTON_Y_OFFSET = 210.0; // (base_y + 40) + 170 in the decompile, relative to panel-top
export const END_NOTE_BUTTON_STEP_Y = 32.0;
// `quest_failed_screen_update` panel geometry/anchors:
// - panel is the classic ui_menuPanel at (-45, 110) with geom x0/y0 (-63, -81)
// - reaper banner X = panel-left + 214; message/buttons are derived from that anchor.
export const QUEST_FAILED_PANEL_POS_X = -45.0;
export const QUEST_FAILED_PANEL_POS_Y = 110.0;
export const QUEST_FAILED_PANEL_GEOM_X0 = -63.0;
export const QUEST_FAILED_PANEL_GEOM_Y0 = -81.0;
export const QUEST_FAILED_PANEL_W = 510.0;
export const QUEST_FAILED_PANEL_H = 378.0;
export const QUEST_FAILED_BANNER_X_OFFSET = 214.0;
export const QUEST_FAILED_BANNER_Y_OFFSET = 40.0;
export const QUEST_FAILED_BANNER_W = 256.0;
export const QUEST_FAILED_BANNER_H = 64.0;
export const QUEST_FAILED_MESSAGE_X_OFFSET = QUEST_FAILED_BANNER_X_OFFSET + 30.0;
export const QUEST_FAILED_MESSAGE_Y_OFFSET = 126.0; // (base_y + 40) + 70 + 16
export const QUEST_FAILED_SCORE_X_OFFSET = QUEST_FAILED_BANNER_X_OFFSET + 40.0;
export const QUEST_FAILED_SCORE_Y_OFFSET = 152.0; // message_y + 16 + 10 in native
export const QUEST_FAILED_BUTTON_X_OFFSET = QUEST_FAILED_BANNER_X_OFFSET + 52.0;
export const QUEST_FAILED_BUTTON_Y_OFFSET = 240.0; // score_y baseline + 98 in native
export const QUEST_FAILED_BUTTON_STEP_Y = 32.0;
export const QUEST_FAILED_PANEL_SLIDE_DURATION_MS = 250.0;

export class QuestMenuLayout {
  readonly titlePos: Vec2;
  readonly iconsStartPos: Vec2;
  readonly listPos: Vec2;

  constructor(opts: {
    titlePos: Vec2;
    iconsStartPos: Vec2;
    listPos: Vec2;
  }) {
    this.titlePos = opts.titlePos;
    this.iconsStartPos = opts.iconsStartPos;
    this.listPos = opts.listPos;
  }
}

export function playerNameDefault(config: CrimsonConfig): string {
  return config.profile.playerName;
}

export function nextQuestLevel(level: QuestLevel): QuestLevel | null {
  const nextIndex = Math.trunc(level.globalIndex) + 1;
  if (nextIndex >= 50) {
    return null;
  }
  return QuestLevel.fromGlobalIndex(nextIndex);
}
