// Port of crimson/screens/results/game_over.py

import { type RuntimeResources, TextureId, getTexture, runtimeResourcesFor } from '@grim/assets.ts';
import { InputState } from '@grim/input.ts';
import { type CrimsonConfig, fxDetailEnabled, setPlayerNameInput } from '@grim/config.ts';
import { drawSmallText, measureSmallTextWidth, SmallFontData } from '@grim/fonts/small.ts';
import { Vec2, Rect } from '@grim/geom.ts';
import { Crand, type CrandLike } from '@grim/rand.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { NAME_MAX_EDIT, TABLE_MAX, HighScoreRecord, rankIndex, readHighscoreTable, scoresPathForConfig, upsertHighscoreRecord } from '@crimson/persistence/highscores.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { formatOrdinal, formatTimeMmSs } from '@crimson/ui/formatting.ts';
import { menuWidescreenYShift, uiScale } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth, drawUiText } from '@crimson/ui/perk-menu.ts';
import { flushTextInputEvents, gameplayControlsHeld, updateNameEntryText } from '@crimson/ui/text-input.ts';
import { WEAPON_BY_ID, weaponDisplayName } from '@crimson/weapons.ts';

export { HighScoreRecord };

const GAME_OVER_PANEL_X = -45.0;
// `ui_menu_layout_init` sets game-over panel pos to (-45, 110):
//   _DAT_0048cc60 = 0xc2340000 (-45.0)
//   _DAT_0048cc64 = 0x42dc0000 (110.0)
const GAME_OVER_PANEL_Y = 110.0;
// `DAT_0048cc48` is cloned from the 3-slice menu panel layout (`ui_menu_item_element._pad4+0xac`)
// in `ui_menu_layout_init`; trace confirms a 510x378 bbox for both phase 0 and phase 1.
const GAME_OVER_PANEL_W = 510.0;
const GAME_OVER_PANEL_H = 378.0;

// Measured from ui_render_trace at 1024x768 (stable timeline):
// panel top-left is (pos_x + 21, pos_y - 81) and size is 510x254, plus a shadow pass at +7,+7.
const GAME_OVER_PANEL_OFFSET_X = 21.0;
const GAME_OVER_PANEL_OFFSET_Y = -81.0;

const TEXTURE_TOP_BANNER_W = 256.0;
const TEXTURE_TOP_BANNER_H = 64.0;

// `game_over_screen_update` (0x0040ffc0) computes banner/content X from:
//   local_10 = quad0_x0 + pos_x + 180.0
//   local_18 = offset_x + local_10 + 44.0 - 10.0
// so banner/content anchor is +214 from the panel-left edge in steady state.
const GAME_OVER_BANNER_X_OFFSET = 214.0;

const INPUT_BOX_W = 166.0; // `_DAT_0048259c = 0xa6` before `ui_text_input_update`
const INPUT_BOX_H = 18.0;

const PANEL_SLIDE_DURATION_MS = 250.0;

const COLOR_TEXT = wgl.makeColor(1.0, 1.0, 1.0, 1.0);
const COLOR_TEXT_MUTED = wgl.makeColor(1.0, 1.0, 1.0, int(255 * 0.8) / 255);
const COLOR_SCORE_LABEL = wgl.makeColor(230 / 255, 230 / 255, 230 / 255, 1.0);
const COLOR_SCORE_VALUE = wgl.makeColor(230 / 255, 230 / 255, 255 / 255, 1.0);

const KEY_ENTER = 13;
const KEY_NUMPAD_ENTER = 335;
const KEY_ESCAPE = 27;
const KEY_SPACE = 32;
const MOUSE_BUTTON_LEFT = 0;

function weaponIconSrc(
  texture: wgl.Texture,
  weaponIdNative: number,
): wgl.Rectangle | null {
  const weaponId = int(weaponIdNative);
  const entry = WEAPON_BY_ID.get(weaponId);
  if (entry === undefined) throw new Error(`Unknown weapon id: ${weaponIdNative}`);
  const iconIndex = entry.iconIndex;
  if (iconIndex < 0 || iconIndex > 31) return null;
  const grid = 8;
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  const frame = int(iconIndex) * 2;
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  return wgl.makeRectangle(col * cellW, row * cellH, cellW * 2, cellH);
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

class GameOverPanelLayout {
  readonly panel: Rect;
  readonly topLeft: Vec2;

  constructor(opts: { panel: Rect; topLeft: Vec2 }) {
    this.panel = opts.panel;
    this.topLeft = opts.topLeft;
  }
}

function drawTextureCentered(
  tex: wgl.Texture,
  pos: Vec2,
  w: number,
  h: number,
  alpha: number,
): void {
  const src = wgl.makeRectangle(0.0, 0.0, tex.width, tex.height);
  const dst = wgl.makeRectangle(pos.x, pos.y, w, h);
  const a = Math.max(0.0, Math.min(1.0, alpha));
  const tint = wgl.makeColor(1.0, 1.0, 1.0, int(255 * a) / 255);
  wgl.drawTexturePro(tex, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, tint);
}

function easeOutCubic(t: number): number {
  const clamped = Math.max(0.0, Math.min(1.0, t));
  return 1.0 - Math.pow(1.0 - clamped, 3);
}

export class GameOverUi {
  assetsRoot: string;
  baseDir: string;
  config: CrimsonConfig;
  preserveBugs = false;

  inputText = '';
  inputCaret = 0;
  phase = -1; // -1 init, 0 name entry (if qualifies), 1 results/buttons
  rank = TABLE_MAX;
  private _candidateRecord: HighScoreRecord | null = null;
  private _saved = false;
  private _dt = 0.0;

  private _hoverWeapon = 0.0;
  private _hoverTime = 0.0;
  private _hoverHitRatio = 0.0;
  private _introMs = 0.0;
  private _cursorPulseTime = 0.0;
  private _panelOpenSfxPlayed = false;
  private _closing = false;
  private _closeAction: string | null = null;

  // Buttons (rendered via existing ui_button implementation)
  private _okButton = new UiButtonState({ label: 'OK', forceWide: false });
  private _playAgainButton = new UiButtonState({ label: 'Play Again', forceWide: true });
  private _highScoresButton = new UiButtonState({ label: 'High scores', forceWide: true });
  private _mainMenuButton = new UiButtonState({ label: 'Main Menu', forceWide: true });

  private _consumeEnter = false;
  private _deferNameInputUntilControlsReleased = false;

  constructor(opts: { assetsRoot: string; baseDir?: string; config: CrimsonConfig; preserveBugs?: boolean }) {
    this.assetsRoot = opts.assetsRoot;
    this.baseDir = opts.baseDir ?? '';
    this.config = opts.config;
    this.preserveBugs = opts.preserveBugs ?? false;
  }

  open(): void {
    this.close();
    this.phase = -1;
    this.rank = TABLE_MAX;
    this._candidateRecord = null;
    this._saved = false;
    this._dt = 0.0;
    this._hoverWeapon = 0.0;
    this._hoverTime = 0.0;
    this._hoverHitRatio = 0.0;
    this._introMs = 0.0;
    this._cursorPulseTime = 0.0;
    this._panelOpenSfxPlayed = false;
    this._closing = false;
    this._closeAction = null;
    this.inputText = '';
    this.inputCaret = 0;
    this._consumeEnter = true;
    this._deferNameInputUntilControlsReleased = false;
  }

  close(): void {}

  consumeEnter(): boolean {
    if (this._consumeEnter) {
      this._consumeEnter = false;
      return true;
    }
    return false;
  }

  worldEntityAlpha(): number {
    if (!this._closing) return 1.0;
    if (PANEL_SLIDE_DURATION_MS <= 1e-6) return 0.0;
    const alpha = this._introMs / PANEL_SLIDE_DURATION_MS;
    if (alpha < 0.0) return 0.0;
    if (alpha > 1.0) return 1.0;
    return alpha;
  }

  private _textWidth(font: SmallFontData, text: string, scale: number): number {
    void scale;
    return measureSmallTextWidth(font, text);
  }

  private _drawSmall(font: SmallFontData, text: string, pos: Vec2, scale: number, color: wgl.Color): void {
    void scale;
    drawSmallText(font, text, pos, color);
  }

  private _panelLayout(opts: { screenW: number; scale: number }): GameOverPanelLayout {
    // Keep consistent with the main menu panel offsets.
    const t = PANEL_SLIDE_DURATION_MS > 1e-6 ? this._introMs / PANEL_SLIDE_DURATION_MS : 1.0;
    const eased = easeOutCubic(t);
    const panelSlideX = -GAME_OVER_PANEL_W * (1.0 - eased);

    const panelPosX = (GAME_OVER_PANEL_X + panelSlideX) * opts.scale;
    const layoutW = opts.scale ? opts.screenW / opts.scale : opts.screenW;
    const widescreenShiftY = menuWidescreenYShift(layoutW);
    const panelPosY = (GAME_OVER_PANEL_Y + widescreenShiftY) * opts.scale;
    const panelOriginX = -(GAME_OVER_PANEL_OFFSET_X * opts.scale);
    const panelOriginY = -(GAME_OVER_PANEL_OFFSET_Y * opts.scale);
    const topLeftX = panelPosX - panelOriginX;
    const topLeftY = panelPosY - panelOriginY;
    const topLeft = new Vec2(topLeftX, topLeftY);
    const panel = Rect.fromTopLeft(topLeft, GAME_OVER_PANEL_W * opts.scale, GAME_OVER_PANEL_H * opts.scale);
    return new GameOverPanelLayout({ panel, topLeft });
  }

  private _beginCloseTransition(action: string): void {
    if (this._closing) return;
    this._closing = true;
    this._closeAction = action;
  }

  update(
    dt: number,
    opts: {
      record: HighScoreRecord;
      playerNameDefault: string;
      playSfx?: ((id: SfxId) => void) | null;
      rng?: CrandLike | null;
      mouse?: { x: number; y: number } | null;
    },
  ): string | null {
    this._dt = Math.min(dt, 0.1);
    const dtMs = this._dt * 1000.0;
    this._cursorPulseTime += this._dt * 1.1;
    const mouse = opts.mouse ?? { x: InputState.mousePosition()[0], y: InputState.mousePosition()[1] };
    const playSfx = opts.playSfx ?? null;
    const resources = runtimeResourcesFor(this.assetsRoot);

    if (this._closing) {
      this._introMs = Math.max(0.0, this._introMs - dtMs);
      if (this._introMs <= 1e-3 && this._closeAction !== null) {
        const action = this._closeAction;
        this._closeAction = null;
        this._closing = false;
        return action;
      }
      return null;
    }

    this._introMs = Math.min(PANEL_SLIDE_DURATION_MS, this._introMs + dtMs);
    if (
      !this._panelOpenSfxPlayed &&
      playSfx !== null &&
      this._introMs >= PANEL_SLIDE_DURATION_MS - 1e-3
    ) {
      playSfx(SfxId.UI_PANELCLICK);
      this._panelOpenSfxPlayed = true;
    }
    if (this._consumeEnter) {
      this._consumeEnter = false;
      InputState.wasKeyPressed(KEY_ENTER);
    }
    if (this.phase === -1) {
      // If in the top 100, prompt for a name. Otherwise show score-too-low message and buttons.
      const gameModeRaw = this.config.gameplay.mode;
      const gameModeId = Object.values(GameMode).includes(gameModeRaw) ? gameModeRaw : GameMode.DEMO;
      const candidate = opts.record.copy();
      candidate.gameModeId = gameModeId;
      this._candidateRecord = candidate;

      const path = scoresPathForConfig(this.baseDir, this.config);
      const records = readHighscoreTable(path, { gameModeId });
      const idx = rankIndex(records, candidate);
      this.rank = idx;
      flushTextInputEvents();
      // Match native `grim_was_key_pressed(ENTER)` after the input flush.
      InputState.wasKeyPressed(KEY_ENTER);
      InputState.wasKeyPressed(KEY_NUMPAD_ENTER);

      if (idx < TABLE_MAX) {
        this.phase = 0;
        this.inputText = opts.playerNameDefault.slice(0, NAME_MAX_EDIT);
        this.inputCaret = this.inputText.length;
        this._deferNameInputUntilControlsReleased = true;
        return null;
      } else {
        this.phase = 1;
      }
    }

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const scale = uiScale(screenW, screenH);
    const rng = opts.rng ?? new Crand(0);

    // Basic text input behavior for the name-entry phase.
    if (this.phase === 0) {
      if (this._deferNameInputUntilControlsReleased) {
        flushTextInputEvents();
        InputState.wasKeyPressed(KEY_ENTER);
        InputState.wasKeyPressed(KEY_NUMPAD_ENTER);
        if (!gameplayControlsHeld(this.config)) {
          this._deferNameInputUntilControlsReleased = false;
        }
        return null;
      }
      const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);
      const [newText, newCaret] = updateNameEntryText(
        this.inputText,
        this.inputCaret,
        { maxLen: NAME_MAX_EDIT, rng, playSfx },
      );
      this.inputText = newText;
      this.inputCaret = newCaret;

      const panelLayout = this._panelLayout({ screenW, scale });
      const bannerPos = panelLayout.topLeft.add(new Vec2(GAME_OVER_BANNER_X_OFFSET * scale, 40.0 * scale));
      const formPos = bannerPos.add(new Vec2(8.0 * scale, 84.0 * scale));
      const okPos = formPos.add(new Vec2(170.0 * scale, 32.0 * scale));
      const okW = buttonWidth(resources, this._okButton.label, { scale, forceWide: this._okButton.forceWide });
      const okClicked = buttonUpdate(this._okButton, { pos: okPos, width: okW, dtMs, mouse, click });

      if (okClicked || InputState.wasKeyPressed(KEY_ENTER)) {
        if (this.inputText.trim()) {
          if (playSfx !== null) {
            playSfx(SfxId.UI_TYPEENTER);
          }
          const candidate = (this._candidateRecord ?? opts.record).copy();
          candidate.setName(this.inputText);
          setPlayerNameInput(this.config.profile, this.inputText);
          this.config.save();
          const path = scoresPathForConfig(this.baseDir, this.config);
          if (!this._saved) {
            upsertHighscoreRecord(path, candidate);
            this._saved = true;
          }
          this.phase = 1;
          return null;
        }
        if (playSfx !== null) {
          playSfx(SfxId.SHOCK_HIT_01);
        }
      }
    } else {
      // Buttons phase: let the caller handle navigation; we just report actions.
      const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);
      const panelLayout = this._panelLayout({ screenW, scale });
      const bannerPos = panelLayout.topLeft.add(new Vec2(GAME_OVER_BANNER_X_OFFSET * scale, 40.0 * scale));
      let btnPos = bannerPos.add(new Vec2(
        52.0 * scale,
        (this.rank < TABLE_MAX ? 210.0 : 208.0) * scale,
      ));

      const playAgainW = buttonWidth(resources, this._playAgainButton.label, {
        scale,
        forceWide: this._playAgainButton.forceWide,
      });
      if (buttonUpdate(this._playAgainButton, { pos: btnPos, width: playAgainW, dtMs, mouse, click })) {
        if (playSfx !== null) playSfx(SfxId.UI_BUTTONCLICK);
        this._beginCloseTransition('play_again');
        return null;
      }
      btnPos = btnPos.offset({ dy: 32.0 * scale });

      const highScoresW = buttonWidth(resources, this._highScoresButton.label, {
        scale,
        forceWide: this._highScoresButton.forceWide,
      });
      if (buttonUpdate(this._highScoresButton, { pos: btnPos, width: highScoresW, dtMs, mouse, click })) {
        if (playSfx !== null) playSfx(SfxId.UI_BUTTONCLICK);
        this._beginCloseTransition('high_scores');
        return null;
      }
      btnPos = btnPos.offset({ dy: 32.0 * scale });

      const mainMenuW = buttonWidth(resources, this._mainMenuButton.label, {
        scale,
        forceWide: this._mainMenuButton.forceWide,
      });
      if (buttonUpdate(this._mainMenuButton, { pos: btnPos, width: mainMenuW, dtMs, mouse, click })) {
        if (playSfx !== null) playSfx(SfxId.UI_BUTTONCLICK);
        this._beginCloseTransition('main_menu');
        return null;
      }
    }
    return null;
  }

  private _drawScoreCard(
    opts: {
      pos: Vec2;
      record: HighScoreRecord;
      resources: RuntimeResources;
      font: SmallFontData;
      alpha: number;
      showWeaponRow: boolean;
      scale: number;
      mouse: { x: number; y: number };
    },
  ): void {
    const { pos, record, resources, font, alpha, showWeaponRow, scale, mouse } = opts;
    const dtHover = this._dt * 2.0;
    const labelColor = wgl.makeColor(
      COLOR_SCORE_LABEL.r, COLOR_SCORE_LABEL.g, COLOR_SCORE_LABEL.b,
      int(255 * alpha * 0.8) / 255,
    );
    const valueColor = wgl.makeColor(
      COLOR_SCORE_VALUE.r, COLOR_SCORE_VALUE.g, COLOR_SCORE_VALUE.b,
      int(255 * alpha) / 255,
    );
    const hintColor = wgl.makeColor(
      COLOR_SCORE_LABEL.r, COLOR_SCORE_LABEL.g, COLOR_SCORE_LABEL.b,
      int(255 * alpha * 0.7) / 255,
    );

    const cardOrigin = pos.offset({ dx: 4.0 * scale });
    const modeRaw = int(record.gameModeId);
    const modeId = Object.values(GameMode).includes(modeRaw) ? modeRaw : GameMode.DEMO;

    // Left column: Score + value + Rank.
    const scoreLabel = 'Score';
    const scoreLabelW = this._textWidth(font, scoreLabel, 1.0 * scale);
    this._drawSmall(
      font, scoreLabel,
      cardOrigin.offset({ dx: 32.0 * scale - scoreLabelW * 0.5 }),
      1.0 * scale,
      labelColor,
    );

    let scoreValue: string;
    if (modeId === GameMode.RUSH || modeId === GameMode.QUESTS) {
      const seconds = int(record.survivalElapsedMs) * 0.001;
      scoreValue = `${seconds.toFixed(2)} secs`;
    } else {
      scoreValue = `${int(record.scoreXp)}`;
    }
    const scoreValueW = this._textWidth(font, scoreValue, 1.0 * scale);
    this._drawSmall(
      font, scoreValue,
      cardOrigin.add(new Vec2(32.0 * scale - scoreValueW * 0.5, 15.0 * scale)),
      1.0 * scale,
      valueColor,
    );

    const rankValue = formatOrdinal(int(this.rank) + 1);
    const rankText = `Rank: ${rankValue}`;
    const rankW = this._textWidth(font, rankText, 1.0 * scale);
    this._drawSmall(
      font, rankText,
      cardOrigin.add(new Vec2(32.0 * scale - rankW * 0.5, 30.0 * scale)),
      1.0 * scale,
      labelColor,
    );

    // Separator between columns (mirrors FUN_00441220 + offset adjustments).
    const separatorX = cardOrigin.x + 80.0 * scale;
    drawLine(
      int(separatorX),
      int(cardOrigin.y),
      int(separatorX),
      int(cardOrigin.y + 48.0 * scale),
      labelColor,
    );

    // Right column: Game time + gauge, or Experience in quest mode.
    const col2Pos = cardOrigin.offset({ dx: 96.0 * scale });
    if (modeId === GameMode.QUESTS) {
      this._drawSmall(font, 'Experience', col2Pos, 1.0 * scale, labelColor);
      const xpValue = `${int(record.scoreXp)}`;
      const xpW = this._textWidth(font, xpValue, 1.0 * scale);
      this._drawSmall(
        font, xpValue,
        col2Pos.add(new Vec2(32.0 * scale - xpW * 0.5, 15.0 * scale)),
        1.0 * scale,
        labelColor,
      );
      this._hoverTime = Math.max(0.0, this._hoverTime - dtHover);
    } else {
      this._drawSmall(font, 'Game time', col2Pos.offset({ dx: 6.0 * scale }), 1.0 * scale, labelColor);
      const timeRectPos = col2Pos.add(new Vec2(8.0 * scale, 16.0 * scale));
      const timeRect = Rect.fromTopLeft(timeRectPos, 64.0 * scale, 29.0 * scale);
      const hoveringTime = timeRect.contains(mouse);
      this._hoverTime = Math.max(0.0, Math.min(1.0, this._hoverTime + (hoveringTime ? dtHover : -dtHover)));

      const elapsedMs = int(record.survivalElapsedMs);
      const clockTable = getTexture(resources, TextureId.UI_CLOCK_TABLE);
      const clockTableSrc = wgl.makeRectangle(0.0, 0.0, clockTable.width, clockTable.height);
      const clockTablePos = col2Pos.add(new Vec2(8.0 * scale, 14.0 * scale));
      const clockTableDst = wgl.makeRectangle(clockTablePos.x, clockTablePos.y, 32.0 * scale, 32.0 * scale);
      const texTint = wgl.makeColor(1.0, 1.0, 1.0, int(255 * alpha) / 255);
      wgl.drawTexturePro(clockTable, clockTableSrc, clockTableDst, wgl.makeVector2(0.0, 0.0), 0.0, texTint);

      const clockPointer = getTexture(resources, TextureId.UI_CLOCK_POINTER);
      const clockPointerSrc = wgl.makeRectangle(0.0, 0.0, clockPointer.width, clockPointer.height);
      // NOTE: Raylib's draw_texture_pro uses dst.x/y as the rotation origin position;
      // offset by half-size so the 32x32 quad stays aligned with the table.
      const clockPointerPos = col2Pos.add(new Vec2(24.0 * scale, 30.0 * scale));
      const clockPointerDst = wgl.makeRectangle(clockPointerPos.x, clockPointerPos.y, 32.0 * scale, 32.0 * scale);
      const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
      const rotation = seconds * 6.0;
      const origin = wgl.makeVector2(16.0 * scale, 16.0 * scale);
      wgl.drawTexturePro(clockPointer, clockPointerSrc, clockPointerDst, origin, rotation, texTint);

      const timeText = formatTimeMmSs(elapsedMs);
      this._drawSmall(font, timeText, col2Pos.add(new Vec2(40.0 * scale, 19.0 * scale)), 1.0 * scale, labelColor);
    }

    // Second row: weapon icon + frags + hit ratio (suppressed while entering the name).
    const rowPos = cardOrigin.offset({ dy: 52.0 * scale });
    this._hoverWeapon = Math.max(0.0, Math.min(1.0, this._hoverWeapon));
    this._hoverHitRatio = Math.max(0.0, Math.min(1.0, this._hoverHitRatio));
    let tooltipPos: Vec2;
    if (showWeaponRow) {
      const weaponPos = rowPos;
      const weaponRect = Rect.fromTopLeft(weaponPos, 64.0 * scale, 32.0 * scale);
      const hoveringWeapon = weaponRect.contains(mouse);
      this._hoverWeapon = Math.max(0.0, Math.min(1.0, this._hoverWeapon + (hoveringWeapon ? dtHover : -dtHover)));

      const wicons = getTexture(resources, TextureId.UI_WICONS);
      const src = weaponIconSrc(wicons, record.mostUsedWeaponId);
      if (src !== null) {
        const dst = wgl.makeRectangle(weaponPos.x, weaponPos.y, 64.0 * scale, 32.0 * scale);
        const tint = wgl.makeColor(1.0, 1.0, 1.0, int(255 * alpha) / 255);
        wgl.drawTexturePro(wicons, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, tint);
      }

      const weaponId = record.mostUsedWeaponId;
      const weaponName = weaponDisplayName(weaponId, { preserveBugs: this.preserveBugs });
      const nameW = this._textWidth(font, weaponName, 1.0 * scale);
      const namePos = new Vec2(
        cardOrigin.x + Math.max(0.0, 32.0 * scale - nameW * 0.5),
        rowPos.y + 32.0 * scale,
      );
      this._drawSmall(font, weaponName, namePos, 1.0 * scale, hintColor);

      const fragsText = `Frags: ${int(record.creatureKillCount)}`;
      const statsPos = rowPos.offset({ dx: 110.0 * scale });
      this._drawSmall(font, fragsText, statsPos.offset({ dy: 1.0 * scale }), 1.0 * scale, labelColor);

      const fired = Math.max(0, int(record.shotsFired));
      const hit = Math.max(0, int(record.shotsHit));
      const ratio = fired > 0 ? int((hit * 100) / fired) : 0;
      const hitText = `Hit %: ${ratio}%`;
      this._drawSmall(font, hitText, statsPos.offset({ dy: 15.0 * scale }), 1.0 * scale, labelColor);

      const hitRectPos = statsPos.offset({ dy: 15.0 * scale });
      const hitRect = Rect.fromTopLeft(hitRectPos, 64.0 * scale, 17.0 * scale);
      const hoveringHit = hitRect.contains(mouse);
      this._hoverHitRatio = Math.max(0.0, Math.min(1.0, this._hoverHitRatio + (hoveringHit ? dtHover : -dtHover)));
      tooltipPos = rowPos.offset({ dy: 48.0 * scale });
    } else {
      this._hoverWeapon = Math.max(0.0, this._hoverWeapon - dtHover);
      this._hoverHitRatio = 0.0;
      tooltipPos = rowPos;
    }

    this._hoverWeapon = Math.max(0.0, Math.min(1.0, this._hoverWeapon));
    this._hoverTime = Math.max(0.0, Math.min(1.0, this._hoverTime));
    this._hoverHitRatio = Math.max(0.0, Math.min(1.0, this._hoverHitRatio));

    if (this._hoverWeapon > 0.5) {
      const t = (this._hoverWeapon - 0.5) * 2.0;
      const col = wgl.makeColor(labelColor.r, labelColor.g, labelColor.b, int(255 * alpha * t) / 255);
      this._drawSmall(
        font,
        'Most used weapon during the game',
        tooltipPos.offset({ dx: -20.0 * scale }),
        1.0 * scale,
        col,
      );
    }
    if (this._hoverTime > 0.5) {
      const t = (this._hoverTime - 0.5) * 2.0;
      const col = wgl.makeColor(labelColor.r, labelColor.g, labelColor.b, int(255 * alpha * t) / 255);
      this._drawSmall(
        font,
        'The time the game lasted',
        tooltipPos.offset({ dx: 12.0 * scale }),
        1.0 * scale,
        col,
      );
    }
    if (this._hoverHitRatio > 0.5) {
      const t = (this._hoverHitRatio - 0.5) * 2.0;
      const col = wgl.makeColor(labelColor.r, labelColor.g, labelColor.b, int(255 * alpha * t) / 255);
      const hitRatioTooltip = this.preserveBugs
        ? 'The % of shot bullets hit the target'
        : 'The % of bullets that hit the target';
      this._drawSmall(
        font,
        hitRatioTooltip,
        tooltipPos.offset({ dx: -22.0 * scale }),
        1.0 * scale,
        col,
      );
    }
  }

  draw(
    opts: {
      record: HighScoreRecord;
      bannerKind: string;
      resources: RuntimeResources;
      mouse?: { x: number; y: number } | null;
    },
  ): void {
    const mouse = opts.mouse ?? { x: InputState.mousePosition()[0], y: InputState.mousePosition()[1] };
    const resources = opts.resources;
    const font = resources.smallFont;
    const record = opts.record;
    const bannerKind = opts.bannerKind;

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const scale = uiScale(screenW, screenH);

    const panelLayout = this._panelLayout({ screenW, scale });
    const panel = panelLayout.panel;
    const panelTopLeft = panelLayout.topLeft;

    // Panel background
    const fxDetail = fxDetailEnabled(this.config.display, 0);
    drawClassicMenuPanel(
      getTexture(resources, TextureId.UI_MENU_PANEL),
      { dst: wgl.makeRectangle(panel.x, panel.y, panel.w, panel.h), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail },
    );

    // Banner (Reaper / Well done)
    const bannerPos = panelTopLeft.add(new Vec2(GAME_OVER_BANNER_X_OFFSET * scale, 40.0 * scale));
    const banner = bannerKind === 'reaper'
      ? getTexture(resources, TextureId.UI_TEXT_REAPER)
      : getTexture(resources, TextureId.UI_TEXT_WELL_DONE);
    drawTextureCentered(
      banner, bannerPos,
      TEXTURE_TOP_BANNER_W * scale,
      TEXTURE_TOP_BANNER_H * scale,
      1.0,
    );

    if (this.phase === 0) {
      const formPos = bannerPos.add(new Vec2(8.0 * scale, 84.0 * scale));
      this._drawSmall(
        font, 'State your name, trooper!',
        formPos.offset({ dx: 42.0 * scale }),
        1.0 * scale,
        COLOR_TEXT,
      );

      const inputPos = formPos.offset({ dy: 40.0 * scale });
      wgl.drawRectangle(
        int(inputPos.x),
        int(inputPos.y),
        int(INPUT_BOX_W * scale),
        1,
        wgl.makeColor(1, 1, 1, 1),
      );
      wgl.drawRectangle(
        int(inputPos.x),
        int(inputPos.y + INPUT_BOX_H * scale - 1),
        int(INPUT_BOX_W * scale),
        1,
        wgl.makeColor(1, 1, 1, 1),
      );
      wgl.drawRectangle(
        int(inputPos.x),
        int(inputPos.y),
        1,
        int(INPUT_BOX_H * scale),
        wgl.makeColor(1, 1, 1, 1),
      );
      wgl.drawRectangle(
        int(inputPos.x + INPUT_BOX_W * scale - 1),
        int(inputPos.y),
        1,
        int(INPUT_BOX_H * scale),
        wgl.makeColor(1, 1, 1, 1),
      );
      wgl.drawRectangle(
        int(inputPos.x + 1.0 * scale),
        int(inputPos.y + 1.0 * scale),
        int((INPUT_BOX_W - 2.0) * scale),
        int((INPUT_BOX_H - 2.0) * scale),
        wgl.makeColor(0, 0, 0, 1),
      );
      drawUiText(
        resources, this.inputText,
        inputPos.add(new Vec2(4.0 * scale, 2.0 * scale)),
        { scale: 1.0 * scale, color: COLOR_TEXT_MUTED },
      );
      let caretAlpha = 1.0;
      if (Math.sin(performance.now() * 0.004) > 0.0) {
        caretAlpha = 0.4;
      }
      const caretColor = wgl.makeColor(1.0, 1.0, 1.0, int(255 * caretAlpha) / 255);
      const caretX = inputPos.x + 4.0 * scale + this._textWidth(font, this.inputText.slice(0, this.inputCaret), 1.0 * scale);
      wgl.drawRectangle(
        int(caretX),
        int(inputPos.y + 2.0 * scale),
        int(1.0 * scale),
        int(14.0 * scale),
        wgl.makeColor(caretColor.r, caretColor.g, caretColor.b, caretColor.a),
      );

      const okPos = formPos.add(new Vec2(170.0 * scale, 32.0 * scale));
      const okW = buttonWidth(resources, this._okButton.label, { scale, forceWide: this._okButton.forceWide });
      buttonDraw(resources, this._okButton, { pos: okPos, width: okW, scale });

      const scorePos = formPos.add(new Vec2(16.0 * scale, 116.0 * scale));
      this._drawScoreCard({
        pos: scorePos,
        record,
        resources,
        font,
        alpha: 1.0,
        showWeaponRow: false,
        scale,
        mouse,
      });
    } else {
      const scoreCardPos = bannerPos.add(new Vec2(
        30.0 * scale,
        (this.rank < TABLE_MAX ? 80.0 : 78.0) * scale,
      ));
      if (this.rank >= TABLE_MAX && bannerKind === 'reaper') {
        this._drawSmall(
          font,
          'Score too low for top100.',
          bannerPos.add(new Vec2(38.0 * scale, 62.0 * scale)),
          1.0 * scale,
          wgl.makeColor(200 / 255, 200 / 255, 200 / 255, 1.0),
        );
      }

      this._drawScoreCard({
        pos: scoreCardPos,
        record,
        resources,
        font,
        alpha: 1.0,
        showWeaponRow: true,
        scale,
        mouse,
      });
    }

    // Buttons phase rendering.
    if (this.phase === 1) {
      let btnPos = bannerPos.add(new Vec2(
        52.0 * scale,
        (this.rank < TABLE_MAX ? 210.0 : 208.0) * scale,
      ));
      const playAgainW = buttonWidth(resources, this._playAgainButton.label, {
        scale,
        forceWide: this._playAgainButton.forceWide,
      });
      buttonDraw(resources, this._playAgainButton, { pos: btnPos, width: playAgainW, scale });
      btnPos = btnPos.offset({ dy: 32.0 * scale });

      const highScoresW = buttonWidth(resources, this._highScoresButton.label, {
        scale,
        forceWide: this._highScoresButton.forceWide,
      });
      buttonDraw(resources, this._highScoresButton, { pos: btnPos, width: highScoresW, scale });
      btnPos = btnPos.offset({ dy: 32.0 * scale });

      const mainMenuW = buttonWidth(resources, this._mainMenuButton.label, {
        scale,
        forceWide: this._mainMenuButton.forceWide,
      });
      buttonDraw(resources, this._mainMenuButton, { pos: btnPos, width: mainMenuW, scale });
    }

    drawMenuCursor(
      getTexture(resources, TextureId.PARTICLES),
      getTexture(resources, TextureId.UI_CURSOR),
      { pos: new Vec2(mouse.x, mouse.y), pulseTime: this._cursorPulseTime },
    );
  }
}
