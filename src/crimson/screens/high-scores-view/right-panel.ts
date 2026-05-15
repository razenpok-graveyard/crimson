// Port of crimson/screens/high_scores_view/right_panel.py

import { type RuntimeResources, TextureId, getTexture } from '@grim/assets.ts';
import { drawSmallText, measureSmallTextWidth, SmallFontData } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import * as wgl from '@wgl';
import { GameMode } from '@crimson/game-modes.ts';
import { savedNameLabels } from '@grim/config.ts';
import { WEAPON_BY_ID, weaponDisplayName } from '@crimson/weapons.ts';
import { InputState } from '@grim/input.ts';
import { HS_LOCAL_CLOCK_X, HS_LOCAL_CLOCK_Y, HS_LOCAL_DATE_X, HS_LOCAL_DATE_Y, HS_LOCAL_FRAGS_X, HS_LOCAL_FRAGS_Y, HS_LOCAL_HIT_X, HS_LOCAL_HIT_Y, HS_LOCAL_LABEL_X, HS_LOCAL_LABEL_Y, HS_LOCAL_NAME_X, HS_LOCAL_NAME_Y, HS_LOCAL_RANK_X, HS_LOCAL_RANK_Y, HS_LOCAL_SCORE_LABEL_X, HS_LOCAL_SCORE_LABEL_Y, HS_LOCAL_SCORE_VALUE_X, HS_LOCAL_SCORE_VALUE_Y, HS_LOCAL_TIME_LABEL_X, HS_LOCAL_TIME_LABEL_Y, HS_LOCAL_TIME_VALUE_X, HS_LOCAL_TIME_VALUE_Y, HS_LOCAL_WEAPON_Y, HS_LOCAL_WICON_X, HS_LOCAL_WICON_Y, HS_RIGHT_CHECK_X, HS_RIGHT_CHECK_Y, HS_RIGHT_GAME_MODE_DROP_X, HS_RIGHT_GAME_MODE_DROP_Y, HS_RIGHT_GAME_MODE_VALUE_X, HS_RIGHT_GAME_MODE_VALUE_Y, HS_RIGHT_GAME_MODE_WIDGET_W, HS_RIGHT_GAME_MODE_WIDGET_X, HS_RIGHT_GAME_MODE_WIDGET_Y, HS_RIGHT_GAME_MODE_X, HS_RIGHT_GAME_MODE_Y, HS_RIGHT_NUMBER_PLAYERS_X, HS_RIGHT_NUMBER_PLAYERS_Y, HS_RIGHT_PLAYER_COUNT_DROP_X, HS_RIGHT_PLAYER_COUNT_DROP_Y, HS_RIGHT_PLAYER_COUNT_VALUE_X, HS_RIGHT_PLAYER_COUNT_VALUE_Y, HS_RIGHT_PLAYER_COUNT_WIDGET_W, HS_RIGHT_PLAYER_COUNT_WIDGET_X, HS_RIGHT_PLAYER_COUNT_WIDGET_Y, HS_RIGHT_SCORE_LIST_DROP_X, HS_RIGHT_SCORE_LIST_DROP_Y, HS_RIGHT_SCORE_LIST_VALUE_X, HS_RIGHT_SCORE_LIST_VALUE_Y, HS_RIGHT_SCORE_LIST_WIDGET_W, HS_RIGHT_SCORE_LIST_WIDGET_X, HS_RIGHT_SCORE_LIST_WIDGET_Y, HS_RIGHT_SCORE_LIST_X, HS_RIGHT_SCORE_LIST_Y, HS_RIGHT_SHOW_INTERNET_X, HS_RIGHT_SHOW_INTERNET_Y, HS_RIGHT_SHOW_SCORES_DROP_X, HS_RIGHT_SHOW_SCORES_DROP_Y, HS_RIGHT_SHOW_SCORES_VALUE_X, HS_RIGHT_SHOW_SCORES_VALUE_Y, HS_RIGHT_SHOW_SCORES_WIDGET_W, HS_RIGHT_SHOW_SCORES_WIDGET_X, HS_RIGHT_SHOW_SCORES_WIDGET_Y, HS_RIGHT_SHOW_SCORES_X, HS_RIGHT_SHOW_SCORES_Y, hsRightLocalCardXShift, hsRightOptionsXShift } from '@crimson/screens/high-scores-layout.ts';
import { mouseInsideRectWithPadding } from '@crimson/screens/panels/hit-test.ts';
import { formatElapsedMmSs, formatScoreDate, ordinal } from './shared.ts';
import type { HighScoresView } from './view.ts';

const WHITE = wgl.makeColor(1, 1, 1, 1);
const ORIGIN = wgl.makeVector2(0, 0);

function savedScoreNames(view: HighScoresView): string[] {
  return savedNameLabels(view.state.config.profile);
}

function drawLine(x1: number, y1: number, x2: number, y2: number, color: wgl.Color): void {
  const ix1 = int(x1);
  const iy1 = int(y1);
  const ix2 = int(x2);
  const iy2 = int(y2);
  if (iy1 === iy2) {
    wgl.drawRectangle(Math.min(ix1, ix2), iy1, Math.abs(ix2 - ix1), 1, color);
    return;
  }
  if (ix1 === ix2) {
    wgl.drawRectangle(ix1, Math.min(iy1, iy2), 1, Math.abs(iy2 - iy1), color);
    return;
  }
  wgl.drawRectangle(ix1, iy1, ix2 - ix1, iy2 - iy1, color);
}

function gameModeFromId(modeRaw: number): GameMode {
  switch (int(modeRaw)) {
    case GameMode.DEMO:
      return GameMode.DEMO;
    case GameMode.SURVIVAL:
      return GameMode.SURVIVAL;
    case GameMode.RUSH:
      return GameMode.RUSH;
    case GameMode.QUESTS:
      return GameMode.QUESTS;
    case GameMode.TYPO:
      return GameMode.TYPO;
    case GameMode.TUTORIAL:
      return GameMode.TUTORIAL;
    default:
      return GameMode.DEMO;
  }
}

function drawDropdown(
  opts: {
    resources: RuntimeResources;
    font: SmallFontData;
    widgetPos: Vec2;
    widgetW: number;
    items: string[];
    selectedIndex: number;
    valuePos: Vec2;
    arrowPos: Vec2;
    isOpen: boolean;
    enabled: boolean;
    scale: number;
  },
): void {
  const { resources, font, widgetPos, widgetW, items, valuePos, arrowPos, isOpen, enabled, scale } = opts;
  let selectedIndex = opts.selectedIndex;
  const itemCount = Math.max(0, items.length);
  const headerH = 16.0 * scale;
  const rowH = 16.0 * scale;
  const fullH = (itemCount * 16.0 + 24.0) * scale;
  const rowsY0 = widgetPos.y + 17.0 * scale;

  const [mx, my] = InputState.mousePosition();
  const mouse = { x: mx, y: my };
  const hoveredHeader = enabled && mouseInsideRectWithPadding(
    mouse, { pos: widgetPos, width: widgetW, height: 14.0 * scale },
  );

  const widgetH = isOpen ? fullH : headerH;
  wgl.drawRectangle(int(widgetPos.x), int(widgetPos.y), int(widgetW), int(widgetH), wgl.makeColor(1, 1, 1, 1));
  wgl.drawRectangle(
    int(widgetPos.x) + 1,
    int(widgetPos.y) + 1,
    Math.max(0, int(widgetW) - 2),
    Math.max(0, int(widgetH) - 2),
    wgl.makeColor(0, 0, 0, 1),
  );

  if ((isOpen || hoveredHeader) && enabled) {
    const lineH = Math.max(1, int(1.0 * scale));
    wgl.drawRectangle(
      int(widgetPos.x),
      int(widgetPos.y + 15.0 * scale),
      int(widgetW),
      lineH,
      wgl.makeColor(1, 1, 1, 128 / 255),
    );
  }

  const arrowTex = ((isOpen || hoveredHeader) && enabled)
    ? getTexture(resources, TextureId.UI_DROP_ON)
    : getTexture(resources, TextureId.UI_DROP_OFF);
  const arrowW = arrowTex.width * scale;
  const arrowH = arrowTex.height * scale;
  wgl.drawTexturePro(
    arrowTex,
    wgl.makeRectangle(0.0, 0.0, arrowTex.width, arrowTex.height),
    wgl.makeRectangle(arrowPos.x, arrowPos.y, arrowW, arrowH),
    ORIGIN,
    0.0,
    WHITE,
  );

  if (itemCount <= 0) return;

  selectedIndex = Math.max(0, Math.min(itemCount - 1, int(selectedIndex)));
  const headerAlpha = ((isOpen || hoveredHeader) && enabled) ? 242 / 255 : 191 / 255;
  drawSmallText(font, items[selectedIndex], valuePos, wgl.makeColor(1, 1, 1, headerAlpha));

  if (!isOpen) return;

  for (let idx = 0; idx < items.length; idx++) {
    const label = items[idx];
    const itemY = rowsY0 + rowH * idx;
    const hovered = enabled && mouseInsideRectWithPadding(
      mouse, { pos: new Vec2(widgetPos.x, itemY), width: widgetW, height: 14.0 * scale },
    );
    let alpha = 153 / 255;
    if (hovered) alpha = 242 / 255;
    if (idx === selectedIndex) alpha = Math.max(alpha, 245 / 255);
    drawSmallText(font, label, new Vec2(valuePos.x, itemY), wgl.makeColor(1, 1, 1, alpha));
  }
}

export function drawRightPanel(
  view: HighScoresView,
  opts: {
    resources: RuntimeResources;
    font: SmallFontData;
    rightTopLeft: Vec2;
    scale: number;
    highlightRank: number | null;
  },
): void {
  if (opts.highlightRank === null) {
    drawRightPanelQuestOptions(view, opts);
    return;
  }
  drawRightPanelLocalScore(view, {
    resources: opts.resources,
    font: opts.font,
    rightTopLeft: opts.rightTopLeft,
    scale: opts.scale,
    highlightRank: opts.highlightRank,
  });
}

function drawRightPanelQuestOptions(
  view: HighScoresView,
  opts: {
    resources: RuntimeResources;
    font: SmallFontData;
    rightTopLeft: Vec2;
    scale: number;
  },
): void {
  const { resources, font, rightTopLeft, scale } = opts;
  const optionsShiftX = hsRightOptionsXShift(view.state.config.display.width);
  const optionsTopLeft = rightTopLeft.add(new Vec2(optionsShiftX * scale, 0.0));
  const textColor = wgl.makeColor(1, 1, 1, int(255 * 0.8) / 255);

  // Checkbox: "Show internet scores"
  const checkTex = view.state.config.profile.showInternetScores
    ? getTexture(resources, TextureId.UI_CHECK_ON)
    : getTexture(resources, TextureId.UI_CHECK_OFF);
  const checkW = checkTex.width * scale;
  const checkH = checkTex.height * scale;
  wgl.drawTexturePro(
    checkTex,
    wgl.makeRectangle(0.0, 0.0, checkTex.width, checkTex.height),
    wgl.makeRectangle(
      optionsTopLeft.x + HS_RIGHT_CHECK_X * scale,
      optionsTopLeft.y + HS_RIGHT_CHECK_Y * scale,
      checkW,
      checkH,
    ),
    ORIGIN,
    0.0,
    WHITE,
  );

  drawSmallText(font, 'Show internet scores', optionsTopLeft.add(new Vec2(HS_RIGHT_SHOW_INTERNET_X * scale, HS_RIGHT_SHOW_INTERNET_Y * scale)), textColor);
  drawSmallText(font, 'Number of players', optionsTopLeft.add(new Vec2(HS_RIGHT_NUMBER_PLAYERS_X * scale, HS_RIGHT_NUMBER_PLAYERS_Y * scale)), textColor);
  drawSmallText(font, 'Game mode', optionsTopLeft.add(new Vec2(HS_RIGHT_GAME_MODE_X * scale, HS_RIGHT_GAME_MODE_Y * scale)), textColor);
  drawSmallText(font, 'Show scores:', optionsTopLeft.add(new Vec2(HS_RIGHT_SHOW_SCORES_X * scale, HS_RIGHT_SHOW_SCORES_Y * scale)), textColor);
  drawSmallText(font, 'Selected score list:', optionsTopLeft.add(new Vec2(HS_RIGHT_SCORE_LIST_X * scale, HS_RIGHT_SCORE_LIST_Y * scale)), textColor);

  // Dropdown widgets (state_14 quest variant).
  const showScoresItems = ['Best of all time', 'Best of month', 'Best of week', 'Best of day'];
  const playerItems = ['1 player', '2 players', '3 players', '4 players'];
  const modeItems: [string, number][] = [['Quests', 3], ['Rush', 2], ['Survival', 1]];
  if (int(view.state.status.questUnlockIndex) >= 0x28) {
    modeItems.push(["Typ'o'Shooter", 4]);
  }
  const names = savedScoreNames(view);

  const playerCount = Math.max(1, Math.min(4, view.state.config.gameplay.playerCount));
  const playerSelected = playerCount - 1;
  const showScoresSelected = Math.max(0, Math.min(showScoresItems.length - 1, int(view.state.config.profile.scoreDateMode)));
  const modeId = view.state.config.gameplay.mode;
  let modeSelected = 0;
  for (let idx = 0; idx < modeItems.length; idx++) {
    if (modeItems[idx][1] === modeId) {
      modeSelected = idx;
      break;
    }
  }
  const nameSelected = Math.max(0, Math.min(names.length - 1, int(view.state.config.profile.selectedSavedNameSlot)));

  type DropdownSpec = [boolean, Vec2, number, string[], number, Vec2, Vec2, boolean];
  const dropdowns: DropdownSpec[] = [
    [
      view.playerCountOpen,
      new Vec2(HS_RIGHT_PLAYER_COUNT_WIDGET_X, HS_RIGHT_PLAYER_COUNT_WIDGET_Y),
      HS_RIGHT_PLAYER_COUNT_WIDGET_W,
      playerItems,
      playerSelected,
      new Vec2(HS_RIGHT_PLAYER_COUNT_VALUE_X, HS_RIGHT_PLAYER_COUNT_VALUE_Y),
      new Vec2(HS_RIGHT_PLAYER_COUNT_DROP_X, HS_RIGHT_PLAYER_COUNT_DROP_Y),
      !(view.gameModeOpen || view.showScoresOpen || view.scoreListOpen),
    ],
    [
      view.gameModeOpen,
      new Vec2(HS_RIGHT_GAME_MODE_WIDGET_X, HS_RIGHT_GAME_MODE_WIDGET_Y),
      HS_RIGHT_GAME_MODE_WIDGET_W,
      modeItems.map(([label]) => label),
      modeSelected,
      new Vec2(HS_RIGHT_GAME_MODE_VALUE_X, HS_RIGHT_GAME_MODE_VALUE_Y),
      new Vec2(HS_RIGHT_GAME_MODE_DROP_X, HS_RIGHT_GAME_MODE_DROP_Y),
      !(view.playerCountOpen || view.showScoresOpen || view.scoreListOpen),
    ],
    [
      view.showScoresOpen,
      new Vec2(HS_RIGHT_SHOW_SCORES_WIDGET_X, HS_RIGHT_SHOW_SCORES_WIDGET_Y),
      HS_RIGHT_SHOW_SCORES_WIDGET_W,
      showScoresItems,
      showScoresSelected,
      new Vec2(HS_RIGHT_SHOW_SCORES_VALUE_X, HS_RIGHT_SHOW_SCORES_VALUE_Y),
      new Vec2(HS_RIGHT_SHOW_SCORES_DROP_X, HS_RIGHT_SHOW_SCORES_DROP_Y),
      !(view.playerCountOpen || view.gameModeOpen || view.scoreListOpen),
    ],
    [
      view.scoreListOpen,
      new Vec2(HS_RIGHT_SCORE_LIST_WIDGET_X, HS_RIGHT_SCORE_LIST_WIDGET_Y),
      HS_RIGHT_SCORE_LIST_WIDGET_W,
      names,
      nameSelected,
      new Vec2(HS_RIGHT_SCORE_LIST_VALUE_X, HS_RIGHT_SCORE_LIST_VALUE_Y),
      new Vec2(HS_RIGHT_SCORE_LIST_DROP_X, HS_RIGHT_SCORE_LIST_DROP_Y),
      !(view.playerCountOpen || view.gameModeOpen || view.showScoresOpen),
    ],
  ];

  // Active list must render last so overlapping widgets don't occlude open options.
  for (const [isOpen, widgetOffset, widgetW, items, selectedIndex, valueOffset, arrowOffset, enabled] of dropdowns) {
    if (isOpen) continue;
    drawDropdown({
      resources,
      font,
      widgetPos: optionsTopLeft.add(widgetOffset.mul(scale)),
      widgetW: widgetW * scale,
      items,
      selectedIndex,
      valuePos: optionsTopLeft.add(valueOffset.mul(scale)),
      arrowPos: optionsTopLeft.add(arrowOffset.mul(scale)),
      isOpen,
      enabled,
      scale,
    });
  }
  for (const [isOpen, widgetOffset, widgetW, items, selectedIndex, valueOffset, arrowOffset, enabled] of dropdowns) {
    if (!isOpen) continue;
    drawDropdown({
      resources,
      font,
      widgetPos: optionsTopLeft.add(widgetOffset.mul(scale)),
      widgetW: widgetW * scale,
      items,
      selectedIndex,
      valuePos: optionsTopLeft.add(valueOffset.mul(scale)),
      arrowPos: optionsTopLeft.add(arrowOffset.mul(scale)),
      isOpen,
      enabled,
      scale,
    });
  }
}

function drawRightPanelLocalScore(
  view: HighScoresView,
  opts: {
    resources: RuntimeResources;
    font: SmallFontData;
    rightTopLeft: Vec2;
    scale: number;
    highlightRank: number | null;
  },
): void {
  const { resources, font, rightTopLeft, scale, highlightRank } = opts;
  const localShiftX = hsRightLocalCardXShift(view.state.config.display.width);
  const cardTopLeft = rightTopLeft.add(new Vec2(localShiftX * scale, 0.0));

  if (view.records.length === 0) return;

  let idx = highlightRank !== null ? int(highlightRank) : int(view.scrollIndex);
  if (idx < 0) idx = 0;
  if (idx >= view.records.length) idx = view.records.length - 1;
  const entry = view.records[idx];

  const textColor = wgl.makeColor(int(255 * 0.9) / 255, int(255 * 0.9) / 255, int(255 * 0.9) / 255, int(255 * 0.8) / 255);
  const valueColor = wgl.makeColor(int(255 * 0.9) / 255, int(255 * 0.9) / 255, 1, 1);
  const gameTimeColor = wgl.makeColor(1, 1, 1, int(255 * 0.8) / 255);
  const lowerSectionColor = wgl.makeColor(int(255 * 0.9) / 255, int(255 * 0.9) / 255, int(255 * 0.9) / 255, int(255 * 0.7) / 255);
  const separatorColor = wgl.makeColor(149 / 255, 175 / 255, 198 / 255, int(255 * 0.7) / 255);

  let name = entry.name();
  if (!name) name = '???';
  drawSmallText(font, name, cardTopLeft.add(new Vec2(HS_LOCAL_NAME_X * scale, HS_LOCAL_NAME_Y * scale)), textColor);
  drawSmallText(font, 'Local score', cardTopLeft.add(new Vec2(HS_LOCAL_LABEL_X * scale, HS_LOCAL_LABEL_Y * scale)), textColor);

  drawLine(
    int(cardTopLeft.x + 78.0 * scale),
    int(cardTopLeft.y + 57.0 * scale),
    int(cardTopLeft.x + 117.0 * scale),
    int(cardTopLeft.y + 57.0 * scale),
    separatorColor,
  );

  const dateText = formatScoreDate(entry);
  if (dateText) {
    drawSmallText(font, dateText, cardTopLeft.add(new Vec2(HS_LOCAL_DATE_X * scale, HS_LOCAL_DATE_Y * scale)), textColor);
  }
  drawLine(
    int(cardTopLeft.x + 74.0 * scale),
    int(cardTopLeft.y + 72.0 * scale),
    int(cardTopLeft.x + 266.0 * scale),
    int(cardTopLeft.y + 72.0 * scale),
    separatorColor,
  );

  drawSmallText(font, 'Score', cardTopLeft.add(new Vec2(HS_LOCAL_SCORE_LABEL_X * scale, HS_LOCAL_SCORE_LABEL_Y * scale)), textColor);

  const modeRaw = int(entry.gameModeId);
  const modeId = gameModeFromId(modeRaw);
  const elapsedMs = int(entry.survivalElapsedMs);
  const scoreXp = int(entry.scoreXp);

  let timeLabel: string;
  if (modeId === GameMode.QUESTS) {
    timeLabel = 'Experience';
  } else {
    timeLabel = 'Game time';
  }

  drawSmallText(font, timeLabel, cardTopLeft.add(new Vec2(HS_LOCAL_TIME_LABEL_X * scale, HS_LOCAL_TIME_LABEL_Y * scale)), gameTimeColor);
  drawLine(
    int(cardTopLeft.x + 170.0 * scale),
    int(cardTopLeft.y + 90.0 * scale),
    int(cardTopLeft.x + 170.0 * scale),
    int(cardTopLeft.y + 138.0 * scale),
    separatorColor,
  );

  // Native highscore card:
  // - Rush/Quest: score is survival time in seconds (ms * 0.001), rendered with 2 decimals.
  // - Others: score is XP (u32).
  let scoreValuePosX = HS_LOCAL_SCORE_VALUE_X * scale;
  let scoreValuePosY = HS_LOCAL_SCORE_VALUE_Y * scale;
  let scoreValue: string;
  if (modeId === GameMode.RUSH || modeId === GameMode.QUESTS) {
    scoreValue = `${(Math.max(0, elapsedMs) * 0.001).toFixed(2)} secs`;
    // Quest/Rush scores are variable-width second labels ("%.2f secs") and are
    // centered in the left score column in native.
    const scoreLabelW = measureSmallTextWidth(font, 'Score');
    const scoreValueW = measureSmallTextWidth(font, scoreValue);
    const scoreColCenterX = HS_LOCAL_SCORE_LABEL_X * scale + scoreLabelW * 0.5;
    scoreValuePosX = scoreColCenterX - scoreValueW * 0.5;
  } else {
    scoreValue = `${scoreXp}`;
  }
  drawSmallText(font, scoreValue, cardTopLeft.add(new Vec2(scoreValuePosX, scoreValuePosY)), valueColor);

  if (modeId === GameMode.QUESTS) {
    drawSmallText(font, `${scoreXp}`, cardTopLeft.add(new Vec2(HS_LOCAL_TIME_VALUE_X * scale, HS_LOCAL_TIME_VALUE_Y * scale)), gameTimeColor);
  } else {
    drawClockGauge({
      resources,
      elapsedMs,
      pos: cardTopLeft.add(new Vec2(HS_LOCAL_CLOCK_X * scale, HS_LOCAL_CLOCK_Y * scale)),
      scale,
    });
    drawSmallText(font, formatElapsedMmSs(elapsedMs), cardTopLeft.add(new Vec2(HS_LOCAL_TIME_VALUE_X * scale, HS_LOCAL_TIME_VALUE_Y * scale)), gameTimeColor);
  }

  drawSmallText(font, `Rank: ${ordinal(idx + 1)}`, cardTopLeft.add(new Vec2(HS_LOCAL_RANK_X * scale, HS_LOCAL_RANK_Y * scale)), textColor);

  const frags = int(entry.creatureKillCount);
  const shotsFired = int(entry.shotsFired);
  const shotsHit = int(entry.shotsHit);
  let hitPct = 0;
  if (shotsFired > 0) {
    hitPct = Math.floor((shotsHit * 100) / shotsFired);
  }

  drawLine(
    int(cardTopLeft.x + 74.0 * scale),
    int(cardTopLeft.y + 142.0 * scale),
    int(cardTopLeft.x + 266.0 * scale),
    int(cardTopLeft.y + 142.0 * scale),
    separatorColor,
  );

  const weaponId = entry.mostUsedWeaponId;
  const [weaponName, iconIndex] = weaponLabelAndIcon(view, weaponId);
  if (iconIndex !== null) {
    drawWicon({
      resources,
      iconIndex,
      pos: cardTopLeft.add(new Vec2(HS_LOCAL_WICON_X * scale, HS_LOCAL_WICON_Y * scale)),
      scale,
    });
  }
  const weaponNameX = HS_LOCAL_WICON_X * scale + Math.max(
    0.0,
    32.0 * scale - measureSmallTextWidth(font, weaponName) * 0.5,
  );
  drawSmallText(font, weaponName, cardTopLeft.add(new Vec2(weaponNameX, HS_LOCAL_WEAPON_Y * scale)), lowerSectionColor);
  drawSmallText(font, `Frags: ${frags}`, cardTopLeft.add(new Vec2(HS_LOCAL_FRAGS_X * scale, HS_LOCAL_FRAGS_Y * scale)), lowerSectionColor);
  drawSmallText(font, `Hit %: ${hitPct}%`, cardTopLeft.add(new Vec2(HS_LOCAL_HIT_X * scale, HS_LOCAL_HIT_Y * scale)), lowerSectionColor);

  drawLine(
    int(cardTopLeft.x + 74.0 * scale),
    int(cardTopLeft.y + 194.0 * scale),
    int(cardTopLeft.x + 266.0 * scale),
    int(cardTopLeft.y + 194.0 * scale),
    separatorColor,
  );
}

function drawClockGauge(
  opts: {
    resources: RuntimeResources;
    elapsedMs: number;
    pos: Vec2;
    scale: number;
  },
): void {
  const { resources, elapsedMs, pos, scale } = opts;
  const tableTex = getTexture(resources, TextureId.UI_CLOCK_TABLE);
  const pointerTex = getTexture(resources, TextureId.UI_CLOCK_POINTER);
  const drawW = 32.0 * scale;
  const drawH = 32.0 * scale;
  const dst = wgl.makeRectangle(pos.x, pos.y, drawW, drawH);
  const srcTable = wgl.makeRectangle(0.0, 0.0, tableTex.width, tableTex.height);
  const srcPointer = wgl.makeRectangle(0.0, 0.0, pointerTex.width, pointerTex.height);
  wgl.drawTexturePro(tableTex, srcTable, dst, ORIGIN, 0.0, WHITE);

  const seconds = int(Math.max(0, int(elapsedMs) / 1000));
  const rotationDeg = seconds * 6.0;
  const centerX = pos.x + drawW * 0.5;
  const centerY = pos.y + drawH * 0.5;
  wgl.drawTexturePro(
    pointerTex,
    srcPointer,
    wgl.makeRectangle(centerX, centerY, drawW, drawH),
    wgl.makeVector2(drawW * 0.5, drawH * 0.5),
    rotationDeg,
    WHITE,
  );
}

function drawWicon(
  opts: {
    resources: RuntimeResources;
    iconIndex: number;
    pos: Vec2;
    scale: number;
  },
): void {
  const { resources, iconIndex, pos, scale } = opts;
  const tex = getTexture(resources, TextureId.UI_WICONS);
  const idx = int(iconIndex);
  if (idx < 0 || idx > 31) return;
  const grid = 8;
  const cellW = tex.width / grid;
  const cellH = tex.height / grid;
  const frame = idx * 2;
  const srcX = (frame % grid) * cellW;
  const srcY = Math.floor(frame / grid) * cellH;
  const iconW = cellW * 2.0;
  const iconH = cellH;
  wgl.drawTexturePro(
    tex,
    wgl.makeRectangle(srcX, srcY, iconW, iconH),
    wgl.makeRectangle(pos.x, pos.y, iconW * scale, iconH * scale),
    ORIGIN,
    0.0,
    WHITE,
  );
}

function weaponLabelAndIcon(view: HighScoresView, weaponId: number): [string, number | null] {
  const weapon = WEAPON_BY_ID.get(weaponId);
  if (weapon === undefined) {
    throw new Error(`unknown weapon id: ${weaponId}`);
  }
  const name = weaponDisplayName(weapon.weaponId, { preserveBugs: view.state.preserveBugs });
  return [name, weapon.iconIndex];
}
