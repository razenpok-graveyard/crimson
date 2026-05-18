// Port of crimson/screens/results/game_over.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId, runtimeResourcesFor } from '@grim/assets.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { Crand } from '@grim/rand.ts';
import type { rl } from '@grim/raylib-api.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { GameMode } from '@crimson/game-modes.ts';
import type { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import { NAME_MAX_EDIT, TABLE_MAX, rankIndex, readHighscoreTable, scoresPathForConfig, upsertHighscoreRecord } from '@crimson/persistence/highscores.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { formatOrdinal, formatTimeMmSs } from '@crimson/ui/formatting.ts';
import { menuWidescreenYShift, uiScale } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth, drawUiText } from '@crimson/ui/perk-menu.ts';
import { flushTextInputEvents, gameplayControlsHeld, updateNameEntryText } from '@crimson/ui/text-input.ts';
import { WEAPON_BY_ID, weaponDisplayName } from '@crimson/weapons.ts';
import * as wgl from '@wgl';

export const GAME_OVER_PANEL_X = -45.0;
// `ui_menu_layout_init` sets game-over panel pos to (-45, 110):
//   _DAT_0048cc60 = 0xc2340000 (-45.0)
//   _DAT_0048cc64 = 0x42dc0000 (110.0)
export const GAME_OVER_PANEL_Y = 110.0;
// `DAT_0048cc48` is cloned from the 3-slice menu panel layout (`ui_menu_item_element._pad4+0xac`)
// in `ui_menu_layout_init`; trace confirms a 510x378 bbox for both phase 0 and phase 1.
export const GAME_OVER_PANEL_W = 510.0;
export const GAME_OVER_PANEL_H = 378.0;
// Measured from ui_render_trace at 1024x768 (stable timeline):
// panel top-left is (pos_x + 21, pos_y - 81) and size is 510x254, plus a shadow pass at +7,+7.
export const GAME_OVER_PANEL_OFFSET_X = 21.0;
export const GAME_OVER_PANEL_OFFSET_Y = -81.0;
export const TEXTURE_TOP_BANNER_W = 256.0;
export const TEXTURE_TOP_BANNER_H = 64.0;
// `game_over_screen_update` (0x0040ffc0) computes banner/content X from:
//   local_10 = quad0_x0 + pos_x + 180.0
//   local_18 = offset_x + local_10 + 44.0 - 10.0
// so banner/content anchor is +214 from the panel-left edge in steady state.
export const GAME_OVER_BANNER_X_OFFSET = 214.0;
export const INPUT_BOX_W = 166.0; // `_DAT_0048259c = 0xa6` before `ui_text_input_update`
export const INPUT_BOX_H = 18.0;
export const PANEL_SLIDE_DURATION_MS = 250.0;
export const COLOR_TEXT = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255);
export const COLOR_TEXT_MUTED = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255);
export const COLOR_SCORE_LABEL = wgl.makeColor(230 / 255, 230 / 255, 230 / 255, 255 / 255);
export const COLOR_SCORE_VALUE = wgl.makeColor(230 / 255, 230 / 255, 255 / 255, 255 / 255);

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export class GameOverPanelLayout {
  readonly panel: Rect;
  readonly topLeft: Vec2;

  constructor(opts: {
    panel: Rect;
    topLeft: Vec2;
  }) {
    this.panel = opts.panel;
    this.topLeft = opts.topLeft;
  }
}

export class GameOverUi {
  assetsRoot: string;
  baseDir: string;
  config: CrimsonConfig;
  preserveBugs: boolean;
  inputText: string;
  inputCaret: number;
  phase: number; // -1 init, 0 name entry (if qualifies), 1 results/buttons
  rank: number;
  _candidateRecord: HighScoreRecord | null;
  _saved: boolean;
  _dt: number;
  _hoverWeapon: number;
  _hoverTime: number;
  _hoverHitRatio: number;
  _introMs: number;
  _cursorPulseTime: number;
  _panelOpenSfxPlayed: boolean;
  _closing: boolean;
  _closeAction: string | null;
  // Buttons (rendered via existing ui_button implementation)
  _okButton: UiButtonState;
  _playAgainButton: UiButtonState;
  _highScoresButton: UiButtonState;
  _mainMenuButton: UiButtonState;
  _consumeEnter: boolean;
  _deferNameInputUntilControlsReleased: boolean;

  constructor(opts: {
    assetsRoot: string;
    baseDir: string;
    config: CrimsonConfig;
    preserveBugs?: boolean;
    inputText?: string;
    inputCaret?: number;
    phase?: number;
    rank?: number;
    _candidateRecord?: HighScoreRecord | null;
    _saved?: boolean;
    _dt?: number;
    _hoverWeapon?: number;
    _hoverTime?: number;
    _hoverHitRatio?: number;
    _introMs?: number;
    _cursorPulseTime?: number;
    _panelOpenSfxPlayed?: boolean;
    _closing?: boolean;
    _closeAction?: string | null;
    _okButton?: UiButtonState;
    _playAgainButton?: UiButtonState;
    _highScoresButton?: UiButtonState;
    _mainMenuButton?: UiButtonState;
    _consumeEnter?: boolean;
    _deferNameInputUntilControlsReleased?: boolean;
  }) {
    this.assetsRoot = opts.assetsRoot;
    this.baseDir = opts.baseDir;
    this.config = opts.config;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.inputText = opts.inputText ?? '';
    this.inputCaret = opts.inputCaret ?? 0;
    this.phase = opts.phase ?? -1;
    this.rank = opts.rank ?? TABLE_MAX;
    this._candidateRecord = opts._candidateRecord ?? null;
    this._saved = opts._saved ?? false;
    this._dt = opts._dt ?? 0.0;
    this._hoverWeapon = opts._hoverWeapon ?? 0.0;
    this._hoverTime = opts._hoverTime ?? 0.0;
    this._hoverHitRatio = opts._hoverHitRatio ?? 0.0;
    this._introMs = opts._introMs ?? 0.0;
    this._cursorPulseTime = opts._cursorPulseTime ?? 0.0;
    this._panelOpenSfxPlayed = opts._panelOpenSfxPlayed ?? false;
    this._closing = opts._closing ?? false;
    this._closeAction = opts._closeAction ?? null;
    this._okButton = opts._okButton ?? new UiButtonState({ label: 'OK', forceWide: false });
    this._playAgainButton = opts._playAgainButton ?? new UiButtonState({ label: 'Play Again', forceWide: true });
    this._highScoresButton = opts._highScoresButton ?? new UiButtonState({ label: 'High scores', forceWide: true });
    this._mainMenuButton = opts._mainMenuButton ?? new UiButtonState({ label: 'Main Menu', forceWide: true });
    this._consumeEnter = opts._consumeEnter ?? false;
    this._deferNameInputUntilControlsReleased = opts._deferNameInputUntilControlsReleased ?? false;
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

  close(): void {
    return;
  }

  consumeEnter(): boolean {
    if (this._consumeEnter) {
      this._consumeEnter = false;
      return true;
    }
    return false;
  }

  worldEntityAlpha(): number {
    if (!this._closing) {
      return 1.0;
    }
    if (PANEL_SLIDE_DURATION_MS <= 1e-6) {
      return 0.0;
    }
    const alpha = this._introMs / PANEL_SLIDE_DURATION_MS;
    if (alpha < 0.0) {
      return 0.0;
    }
    if (alpha > 1.0) {
      return 1.0;
    }
    return alpha;
  }

  _textWidth(font: SmallFontData, text: string, scale: number): number {
    return measureSmallTextWidth(font, text);
  }

  _drawSmall(font: SmallFontData, text: string, pos: Vec2, scale: number, color: wgl.Color): void {
    drawSmallText(font, text, pos, color);
  }

  _panelLayout(opts: { screenW: number; scale: number }): GameOverPanelLayout {
    const screenW = opts.screenW;
    const scale = opts.scale;
    // Keep consistent with the main menu panel offsets.
    const t = PANEL_SLIDE_DURATION_MS > 1e-6 ? this._introMs / PANEL_SLIDE_DURATION_MS : 1.0;
    const eased = easeOutCubic(t);
    const panelSlideX = -GAME_OVER_PANEL_W * (1.0 - eased);

    let panelPos = new Vec2((GAME_OVER_PANEL_X + panelSlideX) * scale, 0.0);
    const layoutW = scale ? screenW / scale : screenW;
    const widescreenShiftY = menuWidescreenYShift(layoutW);
    panelPos = new Vec2(panelPos.x, (GAME_OVER_PANEL_Y + widescreenShiftY) * scale);
    const panelOrigin = new Vec2(-(GAME_OVER_PANEL_OFFSET_X * scale), -(GAME_OVER_PANEL_OFFSET_Y * scale));
    const topLeft = panelPos.sub(panelOrigin);
    const panel = Rect.fromTopLeft(topLeft, GAME_OVER_PANEL_W * scale, GAME_OVER_PANEL_H * scale);
    return new GameOverPanelLayout({ panel: panel, topLeft: topLeft });
  }

  _beginCloseTransition(opts: { action: string }): void;
  _beginCloseTransition(action: string): void;
  _beginCloseTransition(actionOrOpts: string | { action: string }): void {
    const action: string = typeof actionOrOpts === 'object' && actionOrOpts !== null ? actionOrOpts.action : actionOrOpts as string;
    if (this._closing) {
      return;
    }
    this._closing = true;
    this._closeAction = action;
  }

  update(dt: number, opts: { record: HighScoreRecord; playerNameDefault: string; playSfx?: ((arg0: SfxId) => void) | null; rng?: CrandLike | null; mouse?: wgl.Vector2 | null }): string | null {
    const record = opts.record;
    const playerNameDefault = opts.playerNameDefault;
    const playSfx = opts.playSfx ?? null;
    let rng = opts.rng ?? null;
    let mouse = opts.mouse ?? null;
    this._dt = Math.min(dt, 0.1);
    const dtMs = this._dt * 1000.0;
    this._cursorPulseTime += this._dt * 1.1;
    if (mouse === null) {
      mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    }
    if (rng === null) {
      rng = new Crand(0);
    }

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
    if (!this._panelOpenSfxPlayed && playSfx !== null && this._introMs >= PANEL_SLIDE_DURATION_MS - 1e-3) {
      playSfx(SfxId.UI_PANELCLICK);
      this._panelOpenSfxPlayed = true;
    }
    if (this._consumeEnter) {
      this._consumeEnter = false;
      InputState.wasKeyPressed(13);
    }
    let candidate: any;
    let path: ReturnType<typeof scoresPathForConfig>;
    if (this.phase === -1) {
      // If in the top 100, prompt for a name. Otherwise show score-too-low message and buttons.
      let gameModeId: GameMode;
      try {
        gameModeId = (() => { const value = this.config.gameplay.mode; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
      } catch (exc) {
        gameModeId = GameMode.DEMO;
      }
      candidate = record.copy();
      candidate.gameModeId = gameModeId;
      this._candidateRecord = candidate;

      path = scoresPathForConfig(this.baseDir, this.config);
      const records = readHighscoreTable(path, { gameModeId: gameModeId });
      const idx = rankIndex(records, candidate);
      this.rank = int(idx);
      flushTextInputEvents();
      // Match native `grim_was_key_pressed(ENTER)` after the input flush.
      InputState.wasKeyPressed(13);
      InputState.wasKeyPressed(335);
      if (idx < TABLE_MAX) {
        this.phase = 0;
        this.inputText = playerNameDefault.slice(0, NAME_MAX_EDIT);
        this.inputCaret = this.inputText.length;
        this._deferNameInputUntilControlsReleased = true;
        return null;
      } else {
        this.phase = 1;
      }
    }

    // Basic text input behavior for the name-entry phase.
    let click: any;
    let screenW: number;
    let screenH: number;
    let scale: ReturnType<typeof uiScale>;
    let panelLayout: GameOverPanelLayout;
    let bannerPos: Vec2;
    let buttonPos: Vec2;
    if (this.phase === 0) {
      if (this._deferNameInputUntilControlsReleased) {
        flushTextInputEvents();
        InputState.wasKeyPressed(13);
        InputState.wasKeyPressed(335);
        if (!gameplayControlsHeld(this.config)) {
          this._deferNameInputUntilControlsReleased = false;
        }
        return null;
      }
      click = InputState.wasMouseButtonPressed(0);
      [this.inputText, this.inputCaret] = updateNameEntryText(this.inputText, this.inputCaret, { maxLen: NAME_MAX_EDIT, rng: rng, playSfx: playSfx });

      screenW = wgl.getScreenWidth();
      screenH = wgl.getScreenHeight();
      scale = uiScale(screenW, screenH);
      panelLayout = this._panelLayout({ screenW: screenW, scale: scale });
      bannerPos = panelLayout.topLeft.add(new Vec2(GAME_OVER_BANNER_X_OFFSET * scale, 40.0 * scale));
      const formPos = bannerPos.add(new Vec2(8.0 * scale, 84.0 * scale));
      const okPos = formPos.add(new Vec2(170.0 * scale, 32.0 * scale));
      const okW = buttonWidth(resources, this._okButton.label, { scale: scale, forceWide: this._okButton.forceWide });
      const okClicked = buttonUpdate(this._okButton, { pos: okPos, width: okW, dtMs: dtMs, mouse: mouse, click: click });

      if (okClicked || InputState.wasKeyPressed(13)) {
        if (this.inputText.trim()) {
          if (playSfx !== null) {
            playSfx(SfxId.UI_TYPEENTER);
          }
          candidate = (this._candidateRecord || record).copy();
          candidate.setName(this.inputText);
          this.config.profile.setPlayerNameInput(this.inputText);
          this.config.save();
          path = scoresPathForConfig(this.baseDir, this.config);
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
      click = InputState.wasMouseButtonPressed(0);
      screenW = wgl.getScreenWidth();
      screenH = wgl.getScreenHeight();
      scale = uiScale(screenW, screenH);
      panelLayout = this._panelLayout({ screenW: screenW, scale: scale });
      bannerPos = panelLayout.topLeft.add(new Vec2(GAME_OVER_BANNER_X_OFFSET * scale, 40.0 * scale));
      buttonPos = bannerPos.add(new Vec2(52.0 * scale, (this.rank < TABLE_MAX ? 210.0 : 208.0) * scale));
      const playAgainW = buttonWidth(resources, this._playAgainButton.label, { scale: scale, forceWide: this._playAgainButton.forceWide });
      if (buttonUpdate(this._playAgainButton, { pos: buttonPos, width: playAgainW, dtMs: dtMs, mouse: mouse, click: click })) {
        if (playSfx !== null) {
          playSfx(SfxId.UI_BUTTONCLICK);
        }
        this._beginCloseTransition('play_again');
        return null;
      }
      buttonPos = buttonPos.offset({ dy: 32.0 * scale });

      const highScoresW = buttonWidth(resources, this._highScoresButton.label, { scale: scale, forceWide: this._highScoresButton.forceWide });
      if (buttonUpdate(this._highScoresButton, { pos: buttonPos, width: highScoresW, dtMs: dtMs, mouse: mouse, click: click })) {
        if (playSfx !== null) {
          playSfx(SfxId.UI_BUTTONCLICK);
        }
        this._beginCloseTransition('high_scores');
        return null;
      }
      buttonPos = buttonPos.offset({ dy: 32.0 * scale });

      const mainMenuW = buttonWidth(resources, this._mainMenuButton.label, { scale: scale, forceWide: this._mainMenuButton.forceWide });
      if (buttonUpdate(this._mainMenuButton, { pos: buttonPos, width: mainMenuW, dtMs: dtMs, mouse: mouse, click: click })) {
        if (playSfx !== null) {
          playSfx(SfxId.UI_BUTTONCLICK);
        }
        this._beginCloseTransition('main_menu');
        return null;
      }
    }
    return null;
  }

  _drawScoreCard(opts: { pos: Vec2; record: HighScoreRecord; resources: RuntimeResources; font: SmallFontData; alpha: number; showWeaponRow: boolean; scale: number; mouse: wgl.Vector2 }): void {
    const pos = opts.pos;
    const record = opts.record;
    const resources = opts.resources;
    const font = opts.font;
    const alpha = opts.alpha;
    const showWeaponRow = opts.showWeaponRow;
    const scale = opts.scale;
    const mouse = opts.mouse;
    const dtHover = this._dt * 2.0;
    const labelColor = wgl.makeColor(COLOR_SCORE_LABEL.r, COLOR_SCORE_LABEL.g, COLOR_SCORE_LABEL.b, int(255 * alpha * 0.8) / 255);
    const valueColor = wgl.makeColor(COLOR_SCORE_VALUE.r, COLOR_SCORE_VALUE.g, COLOR_SCORE_VALUE.b, int(255 * alpha) / 255);
    const hintColor = wgl.makeColor(COLOR_SCORE_LABEL.r, COLOR_SCORE_LABEL.g, COLOR_SCORE_LABEL.b, int(255 * alpha * 0.7) / 255);

    const cardOrigin = pos.offset({ dx: 4.0 * scale });
    const modeRaw = int(record.gameModeId);
    let modeId: GameMode;
    try {
      modeId = (() => { const value = modeRaw; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
    } catch (exc) {
      modeId = GameMode.DEMO;
    }

    // Left column: Score + value + Rank.
    const scoreLabel = 'Score';
    const scoreLabelW = this._textWidth(font, scoreLabel, 1.0 * scale);
    this._drawSmall(font, scoreLabel, cardOrigin.offset({ dx: 32.0 * scale - scoreLabelW * 0.5 }), 1.0 * scale, labelColor);

    let seconds: number;
    let scoreValue: string;
    switch (modeId) {
      case GameMode.RUSH:
      case GameMode.QUESTS:
        seconds = int(record.survivalElapsedMs) * 0.001;
        scoreValue = `${seconds.toFixed(2)} secs`;
        break;
      default:
        scoreValue = `${int(record.scoreXp)}`;
        break;
    }
    const scoreValueW = this._textWidth(font, scoreValue, 1.0 * scale);
    this._drawSmall(font, scoreValue, cardOrigin.add(new Vec2(32.0 * scale - scoreValueW * 0.5, 15.0 * scale)), 1.0 * scale, valueColor);

    const rankValue = formatOrdinal(int(this.rank) + 1);
    const rankText = `Rank: ${rankValue}`;
    const rankW = this._textWidth(font, rankText, 1.0 * scale);
    this._drawSmall(font, rankText, cardOrigin.add(new Vec2(32.0 * scale - rankW * 0.5, 30.0 * scale)), 1.0 * scale, labelColor);

    // Separator between columns (mirrors FUN_00441220 + offset adjustments).
    const separatorX = cardOrigin.x + 80.0 * scale;
    wgl.drawLine(int(separatorX), int(cardOrigin.y), int(separatorX), int(cardOrigin.y + 48.0 * scale), labelColor);

    // Right column: Game time + gauge, or Experience in quest mode.
    const col2Pos = cardOrigin.offset({ dx: 96.0 * scale });
    let src: wgl.Rectangle | null;
    let dst: wgl.Rectangle;
    switch (modeId) {
      case GameMode.QUESTS:
        this._drawSmall(font, 'Experience', col2Pos, 1.0 * scale, labelColor);
        const xpValue = `${int(record.scoreXp)}`;
        const xpW = this._textWidth(font, xpValue, 1.0 * scale);
        this._drawSmall(font, xpValue, col2Pos.add(new Vec2(32.0 * scale - xpW * 0.5, 15.0 * scale)), 1.0 * scale, labelColor);
        this._hoverTime = Math.max(0.0, this._hoverTime - dtHover);
        break;
      default:
        this._drawSmall(font, 'Game time', col2Pos.offset({ dx: 6.0 * scale }), 1.0 * scale, labelColor);
        const timeRectPos = col2Pos.add(new Vec2(8.0 * scale, 16.0 * scale));
        const timeRect = Rect.fromTopLeft(timeRectPos, 64.0 * scale, 29.0 * scale);
        const hoveringTime = timeRect.contains(mouse);
        this._hoverTime = Math.max(0.0, Math.min(1.0, this._hoverTime + (hoveringTime ? dtHover : -dtHover)));

        const elapsedMs = int(record.survivalElapsedMs);
        const clockTable = resources.texture(TextureId.UI_CLOCK_TABLE);
        src = wgl.makeRectangle(0.0, 0.0, clockTable.width, clockTable.height);
        const clockTablePos = col2Pos.add(new Vec2(8.0 * scale, 14.0 * scale));
        dst = wgl.makeRectangle(clockTablePos.x, clockTablePos.y, 32.0 * scale, 32.0 * scale);
        wgl.drawTexturePro(clockTable, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha) / 255));
        const clockPointer = resources.texture(TextureId.UI_CLOCK_POINTER);
        src = wgl.makeRectangle(0.0, 0.0, clockPointer.width, clockPointer.height);
        // NOTE: Raylib's draw_texture_pro uses dst.x/y as the rotation origin position;
        // offset by half-size so the 32x32 quad stays aligned with the table.
        const clockPointerPos = col2Pos.add(new Vec2(24.0 * scale, 30.0 * scale));
        dst = wgl.makeRectangle(clockPointerPos.x, clockPointerPos.y, 32.0 * scale, 32.0 * scale);
        seconds = Math.max(0, Math.floor(elapsedMs / 1000));
        const rotation = seconds * 6.0;
        const origin = wgl.makeVector2(16.0 * scale, 16.0 * scale);
        wgl.drawTexturePro(clockPointer, src, dst, origin, rotation, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha) / 255));

        const timeText = formatTimeMmSs(elapsedMs);
        this._drawSmall(font, timeText, col2Pos.add(new Vec2(40.0 * scale, 19.0 * scale)), 1.0 * scale, labelColor);
        break;
    }
    // Second row: weapon icon + frags + hit ratio (suppressed while entering the name).
    const rowPos = cardOrigin.offset({ dy: 52.0 * scale });
    this._hoverWeapon = Math.max(0.0, Math.min(1.0, this._hoverWeapon));
    this._hoverHitRatio = Math.max(0.0, Math.min(1.0, this._hoverHitRatio));
    let hit!: any;
    let tooltipPos: number | Vec2;
    if (showWeaponRow) {
      const weaponPos = rowPos;
      const weaponRect = Rect.fromTopLeft(weaponPos, 64.0 * scale, 32.0 * scale);
      const hoveringWeapon = weaponRect.contains(mouse);
      this._hoverWeapon = Math.max(0.0, Math.min(1.0, this._hoverWeapon + (hoveringWeapon ? dtHover : -dtHover)));

      const wicons = resources.texture(TextureId.UI_WICONS);
      src = weaponIconSrc(wicons, record.mostUsedWeaponId);
      if (src !== null) {
        dst = wgl.makeRectangle(weaponPos.x, weaponPos.y, 64.0 * scale, 32.0 * scale);
        wgl.drawTexturePro(wicons, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alpha) / 255));
      }

      const weaponId = record.mostUsedWeaponId;
      const weaponName = weaponDisplayName(weaponId, { preserveBugs: this.preserveBugs });
      const nameW = this._textWidth(font, weaponName, 1.0 * scale);
      const namePos = new Vec2(cardOrigin.x + Math.max(0.0, (32.0 * scale - nameW * 0.5)), rowPos.y + 32.0 * scale);
      this._drawSmall(font, weaponName, namePos, 1.0 * scale, hintColor);

      const fragsText = `Frags: ${int(record.creatureKillCount)}`;
      const statsPos = rowPos.offset({ dx: 110.0 * scale });
      this._drawSmall(font, fragsText, statsPos.offset({ dy: 1.0 * scale }), 1.0 * scale, labelColor);

      const fired = Math.max(0, int(record.shotsFired));
      hit = Math.max(0, int(record.shotsHit));
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

    let t: number;
    let col: wgl.Color;
    if (this._hoverWeapon > 0.5) {
      t = (this._hoverWeapon - 0.5) * 2.0;
      col = wgl.makeColor(labelColor.r, labelColor.g, labelColor.b, int(255 * alpha * t) / 255);
      this._drawSmall(font, 'Most used weapon during the game', tooltipPos.offset({ dx: -20.0 * scale }), 1.0 * scale, col);
    }
    if (this._hoverTime > 0.5) {
      t = (this._hoverTime - 0.5) * 2.0;
      col = wgl.makeColor(labelColor.r, labelColor.g, labelColor.b, int(255 * alpha * t) / 255);
      this._drawSmall(font, 'The time the game lasted', tooltipPos.offset({ dx: 12.0 * scale }), 1.0 * scale, col);
    }
    if (this._hoverHitRatio > 0.5) {
      t = (this._hoverHitRatio - 0.5) * 2.0;
      col = wgl.makeColor(labelColor.r, labelColor.g, labelColor.b, int(255 * alpha * t) / 255);
      const hitRatioTooltip = this.preserveBugs ? 'The % of shot bullets hit the target' : 'The % of bullets that hit the target';
      this._drawSmall(font, hitRatioTooltip, tooltipPos.offset({ dx: -22.0 * scale }), 1.0 * scale, col);
    }
  }

  draw(opts: { record: HighScoreRecord; bannerKind: string; resources: RuntimeResources; mouse?: wgl.Vector2 | null }): void {
    const record = opts.record;
    const bannerKind = opts.bannerKind;
    const resources = opts.resources;
    let mouse = opts.mouse ?? null;
    if (mouse === null) {
      mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    }
    const font = resources.smallFont;

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const scale = uiScale(screenW, screenH);

    const panelLayout = this._panelLayout({ screenW: screenW, scale: scale });
    const panel = panelLayout.panel;
    const panelTopLeft = panelLayout.topLeft;

    // Panel background
    const fxDetail = this.config.display.fxDetailEnabled({ level: 0, default: false });
    drawClassicMenuPanel(
      resources.texture(TextureId.UI_MENU_PANEL),
      { dst: panel.toRl(), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail },
    );

    // Banner (Reaper / Well done)
    const bannerPos = panelTopLeft.add(new Vec2(GAME_OVER_BANNER_X_OFFSET * scale, 40.0 * scale));
    const banner = bannerKind === 'reaper' ? resources.texture(TextureId.UI_TEXT_REAPER) : resources.texture(TextureId.UI_TEXT_WELL_DONE);
    drawTextureCentered(banner, bannerPos, TEXTURE_TOP_BANNER_W * scale, TEXTURE_TOP_BANNER_H * scale, 1.0);

    let caretAlpha: number;
    if (this.phase === 0) {
      const formPos = bannerPos.add(new Vec2(8.0 * scale, 84.0 * scale));
      this._drawSmall(font, 'State your name, trooper!', formPos.offset({ dx: 42.0 * scale }), 1.0 * scale, COLOR_TEXT);

      const inputPos = formPos.offset({ dy: 40.0 * scale });
      wgl.drawRectangleLines(int(inputPos.x), int(inputPos.y), int(INPUT_BOX_W * scale), int(INPUT_BOX_H * scale), wgl.makeColor(1, 1, 1, 1));
      wgl.drawRectangle(int(inputPos.x + 1.0 * scale), int(inputPos.y + 1.0 * scale), int((INPUT_BOX_W - 2.0) * scale), int((INPUT_BOX_H - 2.0) * scale), wgl.makeColor(0 / 255, 0 / 255, 0 / 255, 255 / 255));
      drawUiText(
        resources,
        this.inputText,
        inputPos.add(new Vec2(4.0 * scale, 2.0 * scale)),
        { scale: 1.0 * scale, color: COLOR_TEXT_MUTED },
      );
      caretAlpha = 1.0;
      if (Math.sin((performance.now() / 1000.0) * 4.0) > 0.0) {
        caretAlpha = 0.4;
      }
      const caretColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * caretAlpha) / 255);
      const caretX = (inputPos.x + 4.0 * scale + this._textWidth(font, this.inputText.slice(0, this.inputCaret), 1.0 * scale));
      wgl.drawRectangle(int(caretX), int(inputPos.y + 2.0 * scale), int(1.0 * scale), int(14.0 * scale), caretColor);

      const okPos = formPos.add(new Vec2(170.0 * scale, 32.0 * scale));
      const okW = buttonWidth(resources, this._okButton.label, { scale: scale, forceWide: this._okButton.forceWide });
      buttonDraw(
        resources,
        this._okButton,
        { pos: okPos, width: okW, scale: scale },
      );

      const scorePos = formPos.add(new Vec2(16.0 * scale, 116.0 * scale));
      this._drawScoreCard({
        pos: scorePos,
        record: record,
        resources: resources,
        font: font,
        alpha: 1.0,
        showWeaponRow: false,
        scale: scale,
        mouse: mouse,
      });
    } else {
      const scoreCardPos = bannerPos.add(new Vec2(30.0 * scale, (this.rank < TABLE_MAX ? 80.0 : 78.0) * scale));
      if (this.rank >= TABLE_MAX && bannerKind === 'reaper') {
        this._drawSmall(font, 'Score too low for top100.', bannerPos.add(new Vec2(38.0 * scale, 62.0 * scale)), 1.0 * scale, wgl.makeColor(200 / 255, 200 / 255, 200 / 255, 255 / 255));
      }

      this._drawScoreCard({
        pos: scoreCardPos,
        record: record,
        resources: resources,
        font: font,
        alpha: 1.0,
        showWeaponRow: true,
        scale: scale,
        mouse: mouse,
      });
    }

    // Buttons phase rendering.
    let buttonPos: Vec2;
    if (this.phase === 1) {
      buttonPos = bannerPos.add(new Vec2(52.0 * scale, (this.rank < TABLE_MAX ? 210.0 : 208.0) * scale));
      const playAgainW = buttonWidth(resources, this._playAgainButton.label, { scale: scale, forceWide: this._playAgainButton.forceWide });
      buttonDraw(
        resources,
        this._playAgainButton,
        { pos: buttonPos, width: playAgainW, scale: scale },
      );
      buttonPos = buttonPos.offset({ dy: 32.0 * scale });

      const highScoresW = buttonWidth(resources, this._highScoresButton.label, { scale: scale, forceWide: this._highScoresButton.forceWide });
      buttonDraw(
        resources,
        this._highScoresButton,
        { pos: buttonPos, width: highScoresW, scale: scale },
      );
      buttonPos = buttonPos.offset({ dy: 32.0 * scale });

      const mainMenuW = buttonWidth(resources, this._mainMenuButton.label, { scale: scale, forceWide: this._mainMenuButton.forceWide });
      buttonDraw(
        resources,
        this._mainMenuButton,
        { pos: buttonPos, width: mainMenuW, scale: scale },
      );
    }

    drawMenuCursor(
      resources.texture(TextureId.PARTICLES),
      resources.texture(TextureId.UI_CURSOR),
      { pos: Vec2.fromXY(mouse), pulseTime: this._cursorPulseTime },
    );
  }

  textWidth(font: SmallFontData, text: string, scale: number): number {
    return this._textWidth(font, text, scale);
  }

  drawSmall(font: SmallFontData, text: string, pos: Vec2, scale: number, color: wgl.Color): void {
    this._drawSmall(font, text, pos, scale, color);
  }

  panelLayout(opts: { screenW: number; scale: number }): GameOverPanelLayout {
    const screenW = opts.screenW;
    const scale = opts.scale;
    return this._panelLayout({ screenW: screenW, scale: scale });
  }

  beginCloseTransition(opts: { action: string }): void;
  beginCloseTransition(action: string): void;
  beginCloseTransition(actionOrOpts: string | { action: string }): void {
    const action: string = typeof actionOrOpts === 'object' && actionOrOpts !== null ? actionOrOpts.action : actionOrOpts as string;
    this._beginCloseTransition(action);
  }

  drawScoreCard(opts: { pos: Vec2; record: HighScoreRecord; resources: RuntimeResources; font: SmallFontData; alpha: number; showWeaponRow: boolean; scale: number; mouse: wgl.Vector2 }): void {
    const pos = opts.pos;
    const record = opts.record;
    const resources = opts.resources;
    const font = opts.font;
    const alpha = opts.alpha;
    const showWeaponRow = opts.showWeaponRow;
    const scale = opts.scale;
    const mouse = opts.mouse;
    this._drawScoreCard({ pos: pos, record: record, resources: resources, font: font, alpha: alpha, showWeaponRow: showWeaponRow, scale: scale, mouse: mouse });
  }
}

export function weaponIconSrc(texture: rl.Texture, weaponIdNative: number): wgl.Rectangle | null {
  const weaponId = int(weaponIdNative);
  const iconIndex = mapGetOrThrow(WEAPON_BY_ID, weaponId).iconIndex;
  if (iconIndex < 0 || iconIndex > 31) {
    return null;
  }
  const grid = 8;
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  const frame = int(iconIndex) * 2;
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  return wgl.makeRectangle(col * cellW, row * cellH, cellW * 2, cellH);
}

export function drawTextureCentered(tex: rl.Texture, pos: Vec2, w: number, h: number, alpha: number): void {
  const src = wgl.makeRectangle(0.0, 0.0, tex.width, tex.height);
  const dst = wgl.makeRectangle(pos.x, pos.y, w, h);
  const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * Math.max(0.0, Math.min(1.0, alpha))) / 255);
  wgl.drawTexturePro(tex, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, tint);
}

export function easeOutCubic(t: number): number {
  t = Math.max(0.0, Math.min(1.0, t));
  return 1.0 - (1.0 - t) ** 3;
}
