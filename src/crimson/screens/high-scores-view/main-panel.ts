// Port of crimson/screens/high_scores_view/main_panel.py

import { InputState } from '@grim/input.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import { type RuntimeResources, TextureId, getTexture } from '@grim/assets.ts';
import { drawSmallText, measureSmallTextWidth, SmallFontData } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import * as wgl from '@wgl';
import type { HighScoresRequest } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { questByLevel } from '@crimson/quests/index.ts';
import { buttonDraw, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { HS_BACK_BUTTON_X, HS_BACK_BUTTON_Y, HS_BUTTON_STEP_Y, HS_BUTTON_X, HS_BUTTON_Y0, HS_QUEST_ARROW_X, HS_QUEST_ARROW_Y, HS_SCORE_FRAME_H, HS_SCORE_FRAME_W, HS_SCORE_FRAME_X, HS_SCORE_FRAME_Y, HS_TITLE_UNDERLINE_Y } from '@crimson/screens/high-scores-layout.ts';
import { modeLabel } from './shared.ts';
import type { HighScoresView } from './view.ts';

const ORIGIN = wgl.makeVector2(0, 0);

function pyRound(value: number): number {
  const floorValue = Math.floor(value);
  const frac = value - floorValue;
  if (frac < 0.5) return floorValue;
  if (frac > 0.5) return floorValue + 1;
  return floorValue % 2 === 0 ? floorValue : floorValue + 1;
}

export function drawMainPanel(
  view: HighScoresView,
  opts: {
    resources: RuntimeResources;
    font: SmallFontData;
    leftPanelTopLeft: Vec2;
    scale: number;
    modeId: GameMode;
    questMajor: number;
    questMinor: number;
    request: HighScoresRequest | null;
  },
): number | null {
  const { resources, font, leftPanelTopLeft, scale, modeId, questMajor, questMinor, request } = opts;

  let title: string;
  if (modeId === GameMode.QUESTS) {
    title = 'High scores - Quests';
  } else {
    title = `High scores - ${modeLabel(modeId, questMajor, questMinor)}`;
  }

  let titleX = 269.0;
  if (modeId === GameMode.SURVIVAL) {
    // state_14:High scores - Survival title at x=168 (panel left_x0 is -98).
    titleX = 266.0;
  }

  const titleDrawPos = leftPanelTopLeft.add(new Vec2(titleX * scale, 41.0 * scale));
  drawSmallText(font, title, titleDrawPos, wgl.makeColor(1, 1, 1, 1));

  const ulW = measureSmallTextWidth(font, title);
  const ulH = Math.max(1, int(pyRound(1.0 * scale)));
  const ulPos = leftPanelTopLeft.add(new Vec2(titleX * scale, HS_TITLE_UNDERLINE_Y * scale));
  wgl.drawRectangle(
    int(pyRound(ulPos.x)),
    int(pyRound(ulPos.y)),
    int(pyRound(ulW)),
    ulH,
    wgl.makeColor(1, 1, 1, int(255 * 0.7) / 255),
  );

  if (modeId === GameMode.QUESTS) {
    const hardcore = view.state.config.gameplay.hardcore;
    let questColor: wgl.Color;
    if (hardcore) {
      questColor = wgl.makeColor(250 / 255, 70 / 255, 60 / 255, int(255 * 0.7) / 255);
    } else {
      questColor = wgl.makeColor(70 / 255, 180 / 255, 240 / 255, int(255 * 0.7) / 255);
    }
    const questLevel = new QuestLevel({ major: int(questMajor), minor: int(questMinor) });
    const quest = questByLevel(questLevel);
    const questLabel = `${questLevel.text}: ${quest !== null ? quest.title : '???'}`;
    drawSmallText(font, questLabel, leftPanelTopLeft.add(new Vec2(236.0 * scale, 63.0 * scale)), questColor);

    const arrow = getTexture(resources, TextureId.UI_ARROW);
    const globalIndex = int(questLevel.globalIndex);
    const unlock = hardcore
      ? int(view.state.status.questUnlockIndexFull)
      : int(view.state.status.questUnlockIndex);
    const maxIndex = Math.max(0, Math.min(49, unlock));

    const dstW = arrow.width * scale;
    const dstH = arrow.height * scale;
    const tint = wgl.makeColor(1, 1, 1, int(255 * 0.51) / 255);

    if (globalIndex > 0) {
      const src = wgl.makeRectangle(0.0, 0.0, arrow.width, arrow.height);
      const arrowPos = leftPanelTopLeft.add(new Vec2((HS_QUEST_ARROW_X - 255.0) * scale, HS_QUEST_ARROW_Y * scale));
      const dst = wgl.makeRectangle(arrowPos.x, arrowPos.y, dstW, dstH);
      wgl.drawTexturePro(arrow, src, dst, ORIGIN, 0.0, tint);
    }

    if (globalIndex < maxIndex) {
      // state_14 flips ui_arrow.jaz (uv 1..0) for the right arrow.
      // Keep src.x in-range; with CLAMP wrap, raylib can collapse flipped UVs
      // when the rect starts at x=tex.width.
      const src = wgl.makeRectangle(0.0, 0.0, -arrow.width, arrow.height);
      const arrowPos = leftPanelTopLeft.add(new Vec2(HS_QUEST_ARROW_X * scale, HS_QUEST_ARROW_Y * scale));
      const dst = wgl.makeRectangle(arrowPos.x, arrowPos.y, dstW, dstH);
      wgl.drawTexturePro(arrow, src, dst, ORIGIN, 0.0, tint);
    }
  }

  const headerColor = wgl.makeColor(1, 1, 1, 1);
  drawSmallText(font, 'Rank', leftPanelTopLeft.add(new Vec2(211.0 * scale, 84.0 * scale)), headerColor);
  drawSmallText(font, 'Score', leftPanelTopLeft.add(new Vec2(246.0 * scale, 84.0 * scale)), headerColor);
  drawSmallText(font, 'Player', leftPanelTopLeft.add(new Vec2(302.0 * scale, 84.0 * scale)), headerColor);

  // Score list viewport frame (white 1px border + black interior).
  const frameX = leftPanelTopLeft.x + HS_SCORE_FRAME_X * scale;
  const frameY = leftPanelTopLeft.y + HS_SCORE_FRAME_Y * scale;
  const frameW = HS_SCORE_FRAME_W * scale;
  const frameH = HS_SCORE_FRAME_H * scale;
  wgl.drawRectangle(int(pyRound(frameX)), int(pyRound(frameY)), int(pyRound(frameW)), int(pyRound(frameH)), wgl.makeColor(1, 1, 1, 1));
  wgl.drawRectangle(
    int(pyRound(frameX + 1.0 * scale)),
    int(pyRound(frameY + 1.0 * scale)),
    Math.max(0, int(pyRound(frameW - 2.0 * scale))),
    Math.max(0, int(pyRound(frameH - 2.0 * scale))),
    wgl.makeColor(0, 0, 0, 1),
  );

  const rowStep = 16.0 * scale;
  const rows = 10;
  const start = Math.max(0, int(view.scrollIndex));
  const end = Math.min(view.records.length, start + rows);
  let y = leftPanelTopLeft.y + 103.0 * scale;
  let selectedRank: number | null =
    (request !== null && request.highlightRank !== null)
      ? int(request.highlightRank)
      : null;

  const [mx, my] = InputState.mousePosition();
  if (
    frameX <= mx && mx < frameX + frameW &&
    frameY <= my && my < frameY + frameH &&
    y <= my && my < y + rowStep * rows
  ) {
    const row = Math.floor((my - y) / rowStep);
    const hoveredIdx = start + row;
    if (start <= hoveredIdx && hoveredIdx < end) {
      selectedRank = hoveredIdx;
    }
  }

  if (start >= end) {
    drawSmallText(font, 'No scores yet.', new Vec2(leftPanelTopLeft.x + 211.0 * scale, y + 8.0 * scale), wgl.makeColor(190 / 255, 190 / 255, 200 / 255, 1));
  } else {
    for (let idx = start; idx < end; idx++) {
      const entry = view.records[idx];
      let name = entry.name();
      if (!name) name = '???';
      if (name.length > 16) name = name.substring(0, 16);

      let value: string;
      if (modeId === GameMode.RUSH || modeId === GameMode.QUESTS) {
        const elapsedMs = int(entry.survivalElapsedMs);
        value = `${Math.floor(Math.max(0, elapsedMs) / 1000)}`;
      } else {
        value = `${int(entry.scoreXp)}`;
      }

      let color = wgl.makeColor(1, 1, 1, int(255 * 0.7) / 255);
      if (selectedRank !== null && int(selectedRank) === idx) {
        color = wgl.makeColor(1, 1, 1, 1);
      }

      drawSmallText(font, `${idx + 1}`, new Vec2(leftPanelTopLeft.x + 216.0 * scale, y), color);
      drawSmallText(font, value, new Vec2(leftPanelTopLeft.x + 246.0 * scale, y), color);
      drawSmallText(font, name, new Vec2(leftPanelTopLeft.x + 304.0 * scale, y), color);
      y += rowStep;
    }
  }

  const buttonBasePos = leftPanelTopLeft.add(new Vec2(HS_BUTTON_X * scale, HS_BUTTON_Y0 * scale));
  let w = buttonWidth(resources, view.updateButton.label, { scale, forceWide: view.updateButton.forceWide });
  buttonDraw(resources, view.updateButton, { pos: buttonBasePos, width: w, scale });

  w = buttonWidth(resources, view.playButton.label, { scale, forceWide: view.playButton.forceWide });
  buttonDraw(resources, view.playButton, { pos: buttonBasePos.offset({ dx: 0.0, dy: HS_BUTTON_STEP_Y * scale }), width: w, scale });

  w = buttonWidth(resources, view.backButton.label, { scale, forceWide: view.backButton.forceWide });
  buttonDraw(resources, view.backButton, {
    pos: leftPanelTopLeft.add(new Vec2(HS_BACK_BUTTON_X * scale, HS_BACK_BUTTON_Y * scale)),
    width: w,
    scale,
  });

  return selectedRank;
}
