// Port of crimson/screens/high_scores_view/right_panel.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { HS_LOCAL_CLOCK_X, HS_LOCAL_CLOCK_Y, HS_LOCAL_DATE_X, HS_LOCAL_DATE_Y, HS_LOCAL_FRAGS_X, HS_LOCAL_FRAGS_Y, HS_LOCAL_HIT_X, HS_LOCAL_HIT_Y, HS_LOCAL_LABEL_X, HS_LOCAL_LABEL_Y, HS_LOCAL_NAME_X, HS_LOCAL_NAME_Y, HS_LOCAL_RANK_X, HS_LOCAL_RANK_Y, HS_LOCAL_SCORE_LABEL_X, HS_LOCAL_SCORE_LABEL_Y, HS_LOCAL_SCORE_VALUE_X, HS_LOCAL_SCORE_VALUE_Y, HS_LOCAL_TIME_LABEL_X, HS_LOCAL_TIME_LABEL_Y, HS_LOCAL_TIME_VALUE_X, HS_LOCAL_TIME_VALUE_Y, HS_LOCAL_WEAPON_Y, HS_LOCAL_WICON_X, HS_LOCAL_WICON_Y, HS_RIGHT_CHECK_X, HS_RIGHT_CHECK_Y, HS_RIGHT_GAME_MODE_DROP_X, HS_RIGHT_GAME_MODE_DROP_Y, HS_RIGHT_GAME_MODE_VALUE_X, HS_RIGHT_GAME_MODE_VALUE_Y, HS_RIGHT_GAME_MODE_WIDGET_W, HS_RIGHT_GAME_MODE_WIDGET_X, HS_RIGHT_GAME_MODE_WIDGET_Y, HS_RIGHT_GAME_MODE_X, HS_RIGHT_GAME_MODE_Y, HS_RIGHT_NUMBER_PLAYERS_X, HS_RIGHT_NUMBER_PLAYERS_Y, HS_RIGHT_PLAYER_COUNT_DROP_X, HS_RIGHT_PLAYER_COUNT_DROP_Y, HS_RIGHT_PLAYER_COUNT_VALUE_X, HS_RIGHT_PLAYER_COUNT_VALUE_Y, HS_RIGHT_PLAYER_COUNT_WIDGET_W, HS_RIGHT_PLAYER_COUNT_WIDGET_X, HS_RIGHT_PLAYER_COUNT_WIDGET_Y, HS_RIGHT_SCORE_LIST_DROP_X, HS_RIGHT_SCORE_LIST_DROP_Y, HS_RIGHT_SCORE_LIST_VALUE_X, HS_RIGHT_SCORE_LIST_VALUE_Y, HS_RIGHT_SCORE_LIST_WIDGET_W, HS_RIGHT_SCORE_LIST_WIDGET_X, HS_RIGHT_SCORE_LIST_WIDGET_Y, HS_RIGHT_SCORE_LIST_X, HS_RIGHT_SCORE_LIST_Y, HS_RIGHT_SHOW_INTERNET_X, HS_RIGHT_SHOW_INTERNET_Y, HS_RIGHT_SHOW_SCORES_DROP_X, HS_RIGHT_SHOW_SCORES_DROP_Y, HS_RIGHT_SHOW_SCORES_VALUE_X, HS_RIGHT_SHOW_SCORES_VALUE_Y, HS_RIGHT_SHOW_SCORES_WIDGET_W, HS_RIGHT_SHOW_SCORES_WIDGET_X, HS_RIGHT_SHOW_SCORES_WIDGET_Y, HS_RIGHT_SHOW_SCORES_X, HS_RIGHT_SHOW_SCORES_Y, hsRightLocalCardXShift, hsRightOptionsXShift } from '@crimson/screens/high-scores-layout.ts';
import { mouseInsideRectWithPadding } from '@crimson/screens/panels/hit-test.ts';
import { formatElapsedMmSs, formatScoreDate, ordinal } from '@crimson/screens/high-scores-view/shared.ts';
import type { HighScoresView } from '@crimson/screens/high-scores-view/view.ts';
import { WEAPON_BY_ID, weaponDisplayName } from '@crimson/weapons.ts';
import * as wgl from '@wgl';

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

function savedScoreNames(view: HighScoresView): string[] {
  return Array.from(view.state.config.profile.savedNameLabels());
}

function drawDropdown(opts: { resources: RuntimeResources; font: SmallFontData; widgetPos: Vec2; widgetW: number; items: string[] | readonly string[]; selectedIndex: number; valuePos: Vec2; arrowPos: Vec2; isOpen: boolean; enabled: boolean; scale: number }): void {
  const resources = opts.resources;
  const font = opts.font;
  const widgetPos = opts.widgetPos;
  const widgetW = opts.widgetW;
  const items = opts.items;
  let selectedIndex = opts.selectedIndex;
  const valuePos = opts.valuePos;
  const arrowPos = opts.arrowPos;
  const isOpen = opts.isOpen;
  const enabled = opts.enabled;
  const scale = opts.scale;
  const itemCount = Math.max(0, items.length);
  const headerH = 16.0 * scale;
  const rowH = 16.0 * scale;
  const fullH = (itemCount * 16.0 + 24.0) * scale;
  const rowsY0 = widgetPos.y + 17.0 * scale;

  const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
  const hoveredHeader = enabled && mouseInsideRectWithPadding(mouse, { pos: widgetPos, width: widgetW, height: 14.0 * scale });

  const widgetH = isOpen ? fullH : headerH;
  wgl.drawRectangle(int(widgetPos.x), int(widgetPos.y), int(widgetW), int(widgetH), wgl.makeColor(1, 1, 1, 1));
  wgl.drawRectangle(int(widgetPos.x) + 1, int(widgetPos.y) + 1, Math.max(0, int(widgetW) - 2), Math.max(0, int(widgetH) - 2), wgl.makeColor(0, 0, 0, 1));

  if ((isOpen || hoveredHeader) && enabled) {
    const lineH = Math.max(1, int(1.0 * scale));
    wgl.drawRectangle(int(widgetPos.x), int(widgetPos.y + 15.0 * scale), int(widgetW), lineH, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 128 / 255));
  }

  const arrowTex = ((isOpen || hoveredHeader) && enabled) ? resources.texture(TextureId.UI_DROP_ON) : resources.texture(TextureId.UI_DROP_OFF);
  const arrowW = arrowTex.width * scale;
  const arrowH = arrowTex.height * scale;
  wgl.drawTexturePro(arrowTex, wgl.makeRectangle(0.0, 0.0, arrowTex.width, arrowTex.height), wgl.makeRectangle(arrowPos.x, arrowPos.y, arrowW, arrowH), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

  if (itemCount <= 0) {
    return;
  }

  selectedIndex = Math.max(0, Math.min(itemCount - 1, int(selectedIndex)));
  const headerAlpha = ((isOpen || hoveredHeader) && enabled) ? 242 : 191;
  drawSmallText(font, String(items[selectedIndex]), valuePos, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, headerAlpha / 255));

  if (!isOpen) {
    return;
  }

  for (const [idx, label] of items.entries()) {
    const itemY = rowsY0 + rowH * idx;
    const hovered = enabled && mouseInsideRectWithPadding(mouse, { pos: new Vec2(widgetPos.x, itemY), width: widgetW, height: 14.0 * scale });
    let alpha = 153;
    if (hovered) {
      alpha = 242;
    }
    if (idx === selectedIndex) {
      alpha = Math.max(alpha, 245);
    }
    drawSmallText(font, String(label), new Vec2(valuePos.x, itemY), wgl.makeColor(255 / 255, 255 / 255, 255 / 255, alpha / 255));
  }
}

export function drawRightPanel(view: HighScoresView, opts: { resources: RuntimeResources; font: SmallFontData; rightTopLeft: Vec2; scale: number; highlightRank: number | null }): void {
  const resources = opts.resources;
  const font = opts.font;
  const rightTopLeft = opts.rightTopLeft;
  const scale = opts.scale;
  const highlightRank = opts.highlightRank;
  if (highlightRank === null) {
    drawRightPanelQuestOptions(
      view,
      { resources: resources, font: font, rightTopLeft: rightTopLeft, scale: scale },
    );
    return;
  }
  drawRightPanelLocalScore(
    view,
    { resources: resources, font: font, rightTopLeft: rightTopLeft, scale: scale, highlightRank: highlightRank },
  );
}

function drawRightPanelQuestOptions(view: HighScoresView, opts: { resources: RuntimeResources; font: SmallFontData; rightTopLeft: Vec2; scale: number }): void {
  const resources = opts.resources;
  const font = opts.font;
  const rightTopLeft = opts.rightTopLeft;
  const scale = opts.scale;
  const optionsShiftX = hsRightOptionsXShift(view.state.config.display.width);
  const optionsTopLeft = rightTopLeft.add(new Vec2(optionsShiftX * scale, 0.0));
  const textColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255);

  // Checkbox: "Show internet scores"
  const checkTex = view.state.config.profile.showInternetScores ? resources.texture(TextureId.UI_CHECK_ON) : resources.texture(TextureId.UI_CHECK_OFF);
  const checkW = checkTex.width * scale;
  const checkH = checkTex.height * scale;
  wgl.drawTexturePro(checkTex, wgl.makeRectangle(0.0, 0.0, checkTex.width, checkTex.height), wgl.makeRectangle(optionsTopLeft.x + HS_RIGHT_CHECK_X * scale, optionsTopLeft.y + HS_RIGHT_CHECK_Y * scale, checkW, checkH), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
  drawSmallText(font, 'Show internet scores', optionsTopLeft.add(new Vec2(HS_RIGHT_SHOW_INTERNET_X * scale, HS_RIGHT_SHOW_INTERNET_Y * scale)), textColor);
  drawSmallText(font, 'Number of players', optionsTopLeft.add(new Vec2(HS_RIGHT_NUMBER_PLAYERS_X * scale, HS_RIGHT_NUMBER_PLAYERS_Y * scale)), textColor);
  drawSmallText(font, 'Game mode', optionsTopLeft.add(new Vec2(HS_RIGHT_GAME_MODE_X * scale, HS_RIGHT_GAME_MODE_Y * scale)), textColor);
  drawSmallText(font, 'Show scores:', optionsTopLeft.add(new Vec2(HS_RIGHT_SHOW_SCORES_X * scale, HS_RIGHT_SHOW_SCORES_Y * scale)), textColor);
  drawSmallText(font, 'Selected score list:', optionsTopLeft.add(new Vec2(HS_RIGHT_SCORE_LIST_X * scale, HS_RIGHT_SCORE_LIST_Y * scale)), textColor);

  // Dropdown widgets (state_14 quest variant).
  const showScoresItems: [string, string, string, string] = ['Best of all time', 'Best of month', 'Best of week', 'Best of day'];
  const playerItems: [string, string, string, string] = ['1 player', '2 players', '3 players', '4 players'];
  const modeItems: [string, number][] = [['Quests', 3], ['Rush', 2], ['Survival', 1]] as const;
  if (int(view.state.status.questUnlockIndex) >= 0x28) {
    modeItems.push(['Typ\'o\'Shooter', 4]);
  }
  const names = savedScoreNames(view);

  const playerCount = Math.max(1, Math.min(4, view.state.config.gameplay.playerCount));
  const playerSelected = playerCount - 1;
  const showScoresSelected = Math.max(0, Math.min(showScoresItems.length - 1, int(view.state.config.profile.scoreDateMode)));
  const modeId = view.state.config.gameplay.mode;
  let modeSelected = 0;
  for (const [idx, [label, id]] of modeItems.entries()) {
    if (int(id) === int(modeId)) {
      modeSelected = idx;
      break;
    }
  }
  const nameSelected = Math.max(0, Math.min(names.length - 1, int(view.state.config.profile.selectedSavedNameSlot)));

  const dropdowns: [boolean, Vec2, number, string[], number, Vec2, Vec2, boolean][] = [[view._playerCountOpen, new Vec2(HS_RIGHT_PLAYER_COUNT_WIDGET_X, HS_RIGHT_PLAYER_COUNT_WIDGET_Y), HS_RIGHT_PLAYER_COUNT_WIDGET_W, Array.from(playerItems), playerSelected, new Vec2(HS_RIGHT_PLAYER_COUNT_VALUE_X, HS_RIGHT_PLAYER_COUNT_VALUE_Y), new Vec2(HS_RIGHT_PLAYER_COUNT_DROP_X, HS_RIGHT_PLAYER_COUNT_DROP_Y), !(view._gameModeOpen || view._showScoresOpen || view._scoreListOpen)], [view._gameModeOpen, new Vec2(HS_RIGHT_GAME_MODE_WIDGET_X, HS_RIGHT_GAME_MODE_WIDGET_Y), HS_RIGHT_GAME_MODE_WIDGET_W, modeItems.map(([label, _id]) => label), modeSelected, new Vec2(HS_RIGHT_GAME_MODE_VALUE_X, HS_RIGHT_GAME_MODE_VALUE_Y), new Vec2(HS_RIGHT_GAME_MODE_DROP_X, HS_RIGHT_GAME_MODE_DROP_Y), !(view._playerCountOpen || view._showScoresOpen || view._scoreListOpen)], [view._showScoresOpen, new Vec2(HS_RIGHT_SHOW_SCORES_WIDGET_X, HS_RIGHT_SHOW_SCORES_WIDGET_Y), HS_RIGHT_SHOW_SCORES_WIDGET_W, Array.from(showScoresItems), showScoresSelected, new Vec2(HS_RIGHT_SHOW_SCORES_VALUE_X, HS_RIGHT_SHOW_SCORES_VALUE_Y), new Vec2(HS_RIGHT_SHOW_SCORES_DROP_X, HS_RIGHT_SHOW_SCORES_DROP_Y), !(view._playerCountOpen || view._gameModeOpen || view._scoreListOpen)], [view._scoreListOpen, new Vec2(HS_RIGHT_SCORE_LIST_WIDGET_X, HS_RIGHT_SCORE_LIST_WIDGET_Y), HS_RIGHT_SCORE_LIST_WIDGET_W, names, nameSelected, new Vec2(HS_RIGHT_SCORE_LIST_VALUE_X, HS_RIGHT_SCORE_LIST_VALUE_Y), new Vec2(HS_RIGHT_SCORE_LIST_DROP_X, HS_RIGHT_SCORE_LIST_DROP_Y), !(view._playerCountOpen || view._gameModeOpen || view._showScoresOpen)]];
  // Active list must render last so overlapping widgets don't occlude open options.
  for (let [isOpen, widgetOffset, widgetW, items, selectedIndex, valueOffset, arrowOffset, enabled] of dropdowns) {
    if (isOpen) {
      continue;
    }
    drawDropdown({
      resources: resources,
      font: font,
      widgetPos: optionsTopLeft.add(widgetOffset.mul(scale)),
      widgetW: widgetW * scale,
      items: items,
      selectedIndex: selectedIndex,
      valuePos: optionsTopLeft.add(valueOffset.mul(scale)),
      arrowPos: optionsTopLeft.add(arrowOffset.mul(scale)),
      isOpen: isOpen,
      enabled: enabled,
      scale: scale,
    });
  }
  for (let [isOpen, widgetOffset, widgetW, items, selectedIndex, valueOffset, arrowOffset, enabled] of dropdowns) {
    if (!isOpen) {
      continue;
    }
    drawDropdown({
      resources: resources,
      font: font,
      widgetPos: optionsTopLeft.add(widgetOffset.mul(scale)),
      widgetW: widgetW * scale,
      items: items,
      selectedIndex: selectedIndex,
      valuePos: optionsTopLeft.add(valueOffset.mul(scale)),
      arrowPos: optionsTopLeft.add(arrowOffset.mul(scale)),
      isOpen: isOpen,
      enabled: enabled,
      scale: scale,
    });
  }
}

function drawRightPanelLocalScore(view: HighScoresView, opts: { resources: RuntimeResources; font: SmallFontData; rightTopLeft: Vec2; scale: number; highlightRank: number | null }): void {
  const resources = opts.resources;
  const font = opts.font;
  const rightTopLeft = opts.rightTopLeft;
  const scale = opts.scale;
  const highlightRank = opts.highlightRank;
  const localShiftX = hsRightLocalCardXShift(view.state.config.display.width);
  const cardTopLeft = rightTopLeft.add(new Vec2(localShiftX * scale, 0.0));
  if (view._records.length === 0) {
    return;
  }
  let idx = highlightRank !== null ? int(highlightRank) : int(view._scrollIndex);
  if (idx < 0) {
    idx = 0;
  }
  if (idx >= view._records.length) {
    idx = view._records.length - 1;
  }
  const entry = view._records[idx];

  const textColor = wgl.makeColor(int(255 * 0.9) / 255, int(255 * 0.9) / 255, int(255 * 0.9) / 255, int(255 * 0.8) / 255);
  const valueColor = wgl.makeColor(int(255 * 0.9) / 255, int(255 * 0.9) / 255, 255 / 255, 255 / 255);
  const gameTimeColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255);
  const lowerSectionColor = wgl.makeColor(int(255 * 0.9) / 255, int(255 * 0.9) / 255, int(255 * 0.9) / 255, int(255 * 0.7) / 255);
  const separatorColor = wgl.makeColor(149 / 255, 175 / 255, 198 / 255, int(255 * 0.7) / 255);

  let name = String(entry.name());
  if (!name) {
    name = '???';
  }
  drawSmallText(font, name, cardTopLeft.add(new Vec2(HS_LOCAL_NAME_X * scale, HS_LOCAL_NAME_Y * scale)), textColor);
  drawSmallText(font, 'Local score', cardTopLeft.add(new Vec2(HS_LOCAL_LABEL_X * scale, HS_LOCAL_LABEL_Y * scale)), textColor);
  wgl.drawLine(int(cardTopLeft.x + 78.0 * scale), int(cardTopLeft.y + 57.0 * scale), int(cardTopLeft.x + 117.0 * scale), int(cardTopLeft.y + 57.0 * scale), separatorColor);

  const dateText = formatScoreDate(entry);
  if (dateText) {
    drawSmallText(font, dateText, cardTopLeft.add(new Vec2(HS_LOCAL_DATE_X * scale, HS_LOCAL_DATE_Y * scale)), textColor);
  }
  wgl.drawLine(int(cardTopLeft.x + 74.0 * scale), int(cardTopLeft.y + 72.0 * scale), int(cardTopLeft.x + 266.0 * scale), int(cardTopLeft.y + 72.0 * scale), separatorColor);

  drawSmallText(font, 'Score', cardTopLeft.add(new Vec2(HS_LOCAL_SCORE_LABEL_X * scale, HS_LOCAL_SCORE_LABEL_Y * scale)), textColor);

  const modeRaw = int(entry.gameModeId);
  let modeId: GameMode;
  try {
    modeId = (() => { const value = modeRaw; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
  } catch (exc) {
    modeId = GameMode.DEMO;
  }
  const elapsedMs = int(entry.survivalElapsedMs);
  const scoreXp = int(entry.scoreXp);
  let timeLabel: string;
  switch (modeId) {
    case GameMode.QUESTS:
      timeLabel = 'Experience';
      break;
    default:
      timeLabel = 'Game time';
      break;
  }
  drawSmallText(font, timeLabel, cardTopLeft.add(new Vec2(HS_LOCAL_TIME_LABEL_X * scale, HS_LOCAL_TIME_LABEL_Y * scale)), gameTimeColor);
  wgl.drawLine(int(cardTopLeft.x + 170.0 * scale), int(cardTopLeft.y + 90.0 * scale), int(cardTopLeft.x + 170.0 * scale), int(cardTopLeft.y + 138.0 * scale), separatorColor);

  // Native highscore card:
  // - Rush/Quest: score is survival time in seconds (ms * 0.001), rendered with 2 decimals.
  // - Others: score is XP (u32).
  let scoreValuePos = new Vec2(HS_LOCAL_SCORE_VALUE_X * scale, HS_LOCAL_SCORE_VALUE_Y * scale);
  let scoreValue: string;
  switch (modeId) {
    case GameMode.RUSH:
    case GameMode.QUESTS:
      scoreValue = `${(Math.max(0, elapsedMs) * 0.001).toFixed(2)} secs`;
      // Quest/Rush scores are variable-width second labels ("%.2f secs") and are
      // centered in the left score column in native.
      const scoreLabelW = measureSmallTextWidth(font, 'Score');
      const scoreValueW = measureSmallTextWidth(font, scoreValue);
      const scoreColCenterX = HS_LOCAL_SCORE_LABEL_X * scale + scoreLabelW * 0.5;
      scoreValuePos = new Vec2(scoreColCenterX - scoreValueW * 0.5, HS_LOCAL_SCORE_VALUE_Y * scale);
      break;
    default:
      scoreValue = `${scoreXp}`;
      break;
  }
  drawSmallText(font, scoreValue, cardTopLeft.add(scoreValuePos), valueColor);

  switch (modeId) {
    case GameMode.QUESTS:
      drawSmallText(font, `${scoreXp}`, cardTopLeft.add(new Vec2(HS_LOCAL_TIME_VALUE_X * scale, HS_LOCAL_TIME_VALUE_Y * scale)), gameTimeColor);
      break;
    default:
      drawClockGauge({
        resources: resources,
        elapsedMs: elapsedMs,
        pos: cardTopLeft.add(new Vec2(HS_LOCAL_CLOCK_X * scale, HS_LOCAL_CLOCK_Y * scale)),
        scale: scale,
      });
      drawSmallText(font, formatElapsedMmSs(elapsedMs), cardTopLeft.add(new Vec2(HS_LOCAL_TIME_VALUE_X * scale, HS_LOCAL_TIME_VALUE_Y * scale)), gameTimeColor);
      break;
  }
  drawSmallText(font, `Rank: ${ordinal(idx + 1)}`, cardTopLeft.add(new Vec2(HS_LOCAL_RANK_X * scale, HS_LOCAL_RANK_Y * scale)), textColor);

  const frags = int(entry.creatureKillCount);

  const shotsFired = int(entry.shotsFired);
  const shotsHit = int(entry.shotsHit);
  let hitPct = 0;
  if (shotsFired > 0) {
    hitPct = int(Math.floor((shotsHit * 100) / shotsFired));
  }
  wgl.drawLine(int(cardTopLeft.x + 74.0 * scale), int(cardTopLeft.y + 142.0 * scale), int(cardTopLeft.x + 266.0 * scale), int(cardTopLeft.y + 142.0 * scale), separatorColor);

  const weaponId = entry.mostUsedWeaponId;
  const [weaponName, iconIndex] = weaponLabelAndIcon(view, weaponId);
  if (iconIndex !== null) {
    drawWicon({
      resources: resources,
      iconIndex: iconIndex,
      pos: cardTopLeft.add(new Vec2(HS_LOCAL_WICON_X * scale, HS_LOCAL_WICON_Y * scale)),
      scale: scale,
    });
  }
  const weaponNameX = HS_LOCAL_WICON_X * scale + Math.max(0.0, 32.0 * scale - measureSmallTextWidth(font, weaponName) * 0.5);
  drawSmallText(font, weaponName, cardTopLeft.add(new Vec2(weaponNameX, HS_LOCAL_WEAPON_Y * scale)), lowerSectionColor);
  drawSmallText(font, `Frags: ${frags}`, cardTopLeft.add(new Vec2(HS_LOCAL_FRAGS_X * scale, HS_LOCAL_FRAGS_Y * scale)), lowerSectionColor);
  drawSmallText(font, `Hit %: ${hitPct}%`, cardTopLeft.add(new Vec2(HS_LOCAL_HIT_X * scale, HS_LOCAL_HIT_Y * scale)), lowerSectionColor);
  wgl.drawLine(int(cardTopLeft.x + 74.0 * scale), int(cardTopLeft.y + 194.0 * scale), int(cardTopLeft.x + 266.0 * scale), int(cardTopLeft.y + 194.0 * scale), separatorColor);
}

function drawClockGauge(opts: { resources: RuntimeResources; elapsedMs: number; pos: Vec2; scale: number }): void {
  const resources = opts.resources;
  const elapsedMs = opts.elapsedMs;
  const pos = opts.pos;
  const scale = opts.scale;
  const tableTex = resources.texture(TextureId.UI_CLOCK_TABLE);
  const pointerTex = resources.texture(TextureId.UI_CLOCK_POINTER);
  const drawW = 32.0 * scale;
  const drawH = 32.0 * scale;
  const dst = wgl.makeRectangle(pos.x, pos.y, drawW, drawH);
  const srcTable = wgl.makeRectangle(0.0, 0.0, tableTex.width, tableTex.height);
  const srcPointer = wgl.makeRectangle(0.0, 0.0, pointerTex.width, pointerTex.height);
  wgl.drawTexturePro(tableTex, srcTable, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
  const seconds = Math.max(0, Math.floor(int(elapsedMs) / 1000));
  const rotationDeg = seconds * 6.0;
  const center = new Vec2(pos.x + drawW * 0.5, pos.y + drawH * 0.5);
  wgl.drawTexturePro(pointerTex, srcPointer, wgl.makeRectangle(center.x, center.y, drawW, drawH), wgl.makeVector2(drawW * 0.5, drawH * 0.5), rotationDeg, wgl.makeColor(1, 1, 1, 1));
}

function drawWicon(opts: { resources: RuntimeResources; iconIndex: number; pos: Vec2; scale: number }): void {
  const resources = opts.resources;
  const iconIndex = opts.iconIndex;
  const pos = opts.pos;
  const scale = opts.scale;
  const tex = resources.texture(TextureId.UI_WICONS);
  const idx = int(iconIndex);
  if (idx < 0 || idx > 31) {
    return;
  }
  const grid = 8;
  const cellW = tex.width / grid;
  const cellH = tex.height / grid;
  const frame = idx * 2;
  const srcX = frame % grid * cellW;
  const srcY = Math.floor(frame / grid) * cellH;
  const iconW = cellW * 2.0;
  const iconH = cellH;
  wgl.drawTexturePro(tex, wgl.makeRectangle(srcX, srcY, iconW, iconH), wgl.makeRectangle(pos.x, pos.y, iconW * scale, iconH * scale), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
}

function weaponLabelAndIcon(view: HighScoresView, weaponId: number): [string, number | null] {
  const weapon = mapGetOrThrow(WEAPON_BY_ID, weaponId);
  const name = weaponDisplayName(weapon.weaponId, { preserveBugs: Boolean(view.state.preserveBugs) });
  return [name, weapon.iconIndex];
}
