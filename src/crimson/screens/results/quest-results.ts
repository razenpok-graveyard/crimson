// Port of crimson/screens/results/quest_results.py

import { type RuntimeResources, TextureId, getTexture, runtimeResourcesFor } from '@grim/assets.ts';
import { InputState } from '@grim/input.ts';
import { type CrimsonConfig, fxDetailEnabled, setPlayerNameInput } from '@grim/config.ts';
import { drawSmallText, measureSmallTextWidth, SmallFontData } from '@grim/fonts/small.ts';
import { Vec2, Rect } from '@grim/geom.ts';
import { Crand, type CrandLike } from '@grim/rand.ts';
import * as wgl from '@wgl';
import { SfxId } from '@grim/sfx-map.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { type HighScoreRecord, TABLE_MAX, NAME_MAX_EDIT, rankIndex, readHighscoreTable, scoresPathForMode, upsertHighscoreRecord } from '@crimson/persistence/highscores.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import { type QuestFinalTime, QuestResultsBreakdownAnim, tickQuestResultsBreakdownAnim } from '@crimson/quests/results.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { formatOrdinal, formatTimeMmSs } from '@crimson/ui/formatting.ts';
import { menuWidescreenYShift, uiScale } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth, drawUiText } from '@crimson/ui/perk-menu.ts';
import { flushTextInputEvents, gameplayControlsHeld, updateNameEntryText } from '@crimson/ui/text-input.ts';
import { WEAPON_BY_ID, weaponDisplayName } from '@crimson/weapons.ts';

// `quest_results_screen_update` base layout (Crimsonland classic UI panel).
// Values are derived from `ui_menu_assets_init` + `ui_menu_layout_init` and how
// the quest results screen composes `ui_menuPanel` geometry:
//   panel_left = geom_x0 + pos_x + slide_x
//   panel_top  = geom_y0 + pos_y
//
// Where:
// - pos_x/pos_y are `ui_element_t` position fields set to (-45, 110)
// - geom_x0/geom_y0 are the first vertex coordinates of the `ui_menuPanel` geo,
//   after `ui_menu_assets_init` transforms it into an 8-vertex 3-slice panel.
const QUEST_RESULTS_PANEL_POS_X = -45.0;
const QUEST_RESULTS_PANEL_POS_Y = 110.0;
const QUEST_RESULTS_PANEL_GEOM_X0 = -63.0;
const QUEST_RESULTS_PANEL_GEOM_Y0 = -81.0;

const QUEST_RESULTS_PANEL_W = 510.0;
const QUEST_RESULTS_PANEL_H = 378.0;

const TEXTURE_TOP_BANNER_W = 256.0;
const TEXTURE_TOP_BANNER_H = 64.0;

// `quest_results_screen_update` uses the classic UI element sums for positioning:
//   content_x = (pos_x + offset_x + slide_x) + 180.0 + 40.0
//   banner_x  = content_x - 18.0
//   score_x   = content_x + 30.0
const QUEST_RESULTS_CONTENT_X = 220.0;
const QUEST_RESULTS_BANNER_X_FROM_CONTENT = -18.0;
const QUEST_RESULTS_SCORE_CARD_X_FROM_CONTENT = 30.0;

const INPUT_BOX_W = 166.0;
const INPUT_BOX_H = 18.0;

// Capture (1024x768) shows the quest results panel uses the same ui_element
// timeline pattern as other screens: fully hidden until 100ms, then slides in
// over 300ms (end=100, start=400).
const PANEL_SLIDE_START_MS = 400.0;
const PANEL_SLIDE_END_MS = 100.0;

const COLOR_TEXT = wgl.makeColor(1.0, 1.0, 1.0, 1.0);
const COLOR_TEXT_MUTED = wgl.makeColor(1.0, 1.0, 1.0, int(255 * 0.8) / 255);
const COLOR_TEXT_SUBTLE = wgl.makeColor(1.0, 1.0, 1.0, int(255 * 0.7) / 255);
const COLOR_GREEN = wgl.makeColor(25 / 255, 200 / 255, 25 / 255, 1.0);
// `sub_41e070` initializes DAT_004965f8..600 to this blue tint (149,175,198),
// reused by quest/game-over captions and score-card separator outlines.
const COLOR_UI_ACCENT = wgl.makeColor(149 / 255, 175 / 255, 198 / 255, 1.0);

const KEY_ENTER = 13;
const KEY_KP_ENTER = 335;
const KEY_ESCAPE = 27;
const KEY_SPACE = 32;
const KEY_H = 72;
const KEY_N = 78;
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

class QuestResultsPanelLayout {
  readonly panel: Rect;
  readonly topLeft: Vec2;

  constructor(opts: { panel: Rect; topLeft: Vec2 }) {
    this.panel = opts.panel;
    this.topLeft = opts.topLeft;
  }
}

export class QuestResultsUi {
  assetsRoot: string;
  baseDir: string;
  config: CrimsonConfig;
  preserveBugs = false;

  phase = -1; // -1 init, 0 breakdown, 1 name entry (if qualifies), 2 results/buttons
  rank = TABLE_MAX;
  highlightRank: number | null = null;

  questLevel: QuestLevel | null = null;
  questTitle = '';
  unlockWeaponName = '';
  unlockPerkName = '';

  record: HighScoreRecord | null = null;
  breakdown: QuestFinalTime | null = null;
  private _scoresPath: string | null = null;
  private _breakdownAnim: QuestResultsBreakdownAnim | null = null;

  inputText = '';
  inputCaret = 0;
  private _saved = false;

  private _introMs = 0.0;
  private _cursorPulseTime = 0.0;
  private _panelOpenSfxPlayed = false;
  private _closing = false;
  private _closeAction: string | null = null;
  private _consumeEnter = false;
  private _deferNameInputUntilControlsReleased = false;

  private _okButton = new UiButtonState({ label: 'OK', forceWide: false });
  private _playNextButton = new UiButtonState({ label: 'Play Next', forceWide: true });
  private _playAgainButton = new UiButtonState({ label: 'Play Again', forceWide: true });
  private _highScoresButton = new UiButtonState({ label: 'High scores', forceWide: true });
  private _mainMenuButton = new UiButtonState({ label: 'Main Menu', forceWide: true });

  constructor(opts: { assetsRoot: string; baseDir?: string; config: CrimsonConfig; preserveBugs?: boolean }) {
    this.assetsRoot = opts.assetsRoot;
    this.baseDir = opts.baseDir ?? '';
    this.config = opts.config;
    this.preserveBugs = opts.preserveBugs ?? false;
  }

  open(opts: {
    record: HighScoreRecord;
    breakdown: QuestFinalTime;
    questLevel: QuestLevel;
    questTitle: string;
    unlockWeaponName: string;
    unlockPerkName: string;
    playerNameDefault: string;
  }): void {
    this.close();
    this.phase = -1;
    this.rank = TABLE_MAX;
    this.highlightRank = null;
    this.questLevel = opts.questLevel;
    this.questTitle = opts.questTitle || '';
    this.unlockWeaponName = opts.unlockWeaponName || '';
    this.unlockPerkName = opts.unlockPerkName || '';
    this.record = opts.record.copy();
    this.breakdown = opts.breakdown;
    this._breakdownAnim = QuestResultsBreakdownAnim.start();
    this._saved = false;

    // Native behavior: the final quest replaces "Play Next" with "Show End Note".
    if (this.questLevel && this.questLevel.equal(new QuestLevel({ major: 5, minor: 10 }))) {
      this._playNextButton.label = 'Show End Note';
    } else {
      this._playNextButton.label = 'Play Next';
    }

    this._scoresPath = scoresPathForMode(
      this.baseDir,
      GameMode.QUESTS,
      {
        hardcore: this.config.gameplay.hardcore,
        questStageMajor: int(this.questLevel.major),
        questStageMinor: int(this.questLevel.minor),
        playerCount: this.config.gameplay.playerCount,
      },
    );
    try {
      const records = readHighscoreTable(this._scoresPath, { gameModeId: GameMode.QUESTS });
      this.rank = rankIndex(records, this.record);
    } catch {
      this.rank = TABLE_MAX;
    }

    this.inputText = (opts.playerNameDefault || '').slice(0, NAME_MAX_EDIT);
    this.inputCaret = this.inputText.length;

    this._introMs = 0.0;
    this._cursorPulseTime = 0.0;
    this._panelOpenSfxPlayed = false;
    this._closing = false;
    this._closeAction = null;
    this._consumeEnter = true;
    this._deferNameInputUntilControlsReleased = false;
    this.phase = 0;
  }

  close(): void {}

  private _beginCloseTransition(action: string): void {
    if (this._closing) return;
    this._closing = true;
    this._closeAction = action;
  }

  private _armNameInputAfterControlRelease(): void {
    this._deferNameInputUntilControlsReleased = true;
    flushTextInputEvents();
    InputState.wasKeyPressed(KEY_ENTER);
    InputState.wasKeyPressed(KEY_KP_ENTER);
  }

  private _textWidth(font: SmallFontData, text: string, scale: number): number {
    void scale;
    return measureSmallTextWidth(font, text);
  }

  private _drawSmall(font: SmallFontData, text: string, pos: Vec2, scale: number, color: wgl.Color): void {
    void scale;
    drawSmallText(font, text, pos, color);
  }

  worldEntityAlpha(): number {
    if (!this._closing) return 1.0;
    const tMs = this._introMs;
    if (tMs <= PANEL_SLIDE_END_MS) return 0.0;
    if (tMs >= PANEL_SLIDE_START_MS) return 1.0;
    const span = PANEL_SLIDE_START_MS - PANEL_SLIDE_END_MS;
    if (span <= 1e-6) return 1.0;
    const alpha = (tMs - PANEL_SLIDE_END_MS) / span;
    if (alpha < 0.0) return 0.0;
    if (alpha > 1.0) return 1.0;
    return alpha;
  }

  private _panelLayout(opts: { screenW: number; scale: number }): QuestResultsPanelLayout {
    // Match MenuView._ui_element_anim offset math (linear, with a 100ms hold hidden).
    const screenW = opts.screenW;
    const scale = opts.scale;
    const tMs = this._introMs;
    let panelSlideX: number;
    if (tMs < PANEL_SLIDE_END_MS) {
      panelSlideX = -QUEST_RESULTS_PANEL_W;
    } else if (tMs < PANEL_SLIDE_START_MS) {
      const span = PANEL_SLIDE_START_MS - PANEL_SLIDE_END_MS;
      const p = span > 1e-6 ? (tMs - PANEL_SLIDE_END_MS) / span : 1.0;
      panelSlideX = -((1.0 - p) * QUEST_RESULTS_PANEL_W);
    } else {
      panelSlideX = 0.0;
    }

    const panelPosX = (QUEST_RESULTS_PANEL_GEOM_X0 + QUEST_RESULTS_PANEL_POS_X + panelSlideX) * scale;
    const layoutW = scale ? screenW / scale : screenW;
    const widescreenShiftY = menuWidescreenYShift(layoutW);
    const panelPosY = (QUEST_RESULTS_PANEL_GEOM_Y0 + QUEST_RESULTS_PANEL_POS_Y + widescreenShiftY) * scale;
    const topLeft = new Vec2(panelPosX, panelPosY);
    const panel = Rect.fromTopLeft(topLeft, QUEST_RESULTS_PANEL_W * scale, QUEST_RESULTS_PANEL_H * scale);
    return new QuestResultsPanelLayout({ panel, topLeft });
  }

  private _drawNameEntryStats(
    opts: {
      pos: Vec2;
      scale: number;
      alpha: number;
      showWeaponRow: boolean;
      resources: RuntimeResources;
      font: SmallFontData;
    },
  ): void {
    if (this.record === null) return;
    const record = this.record;
    const qualifies = int(this.rank) < TABLE_MAX;
    const rankText = qualifies ? formatOrdinal(int(this.rank) + 1) : '--';
    const x = opts.pos.x;
    const y = opts.pos.y;
    const scale = opts.scale;
    const resources = opts.resources;
    const font = opts.font;

    const seconds = int(record.survivalElapsedMs) * 0.001;
    const scoreValue = `${seconds.toFixed(2)} secs`;
    const xpValue = `${int(record.scoreXp)}`;

    const alphaF = Math.max(0.0, Math.min(1.0, opts.alpha));
    const colLabel = wgl.makeColor(230 / 255, 230 / 255, 230 / 255, int(255 * alphaF * 0.8) / 255);
    const colScoreValue = wgl.makeColor(230 / 255, 230 / 255, 255 / 255, int(255 * alphaF) / 255);
    const colRow = wgl.makeColor(230 / 255, 230 / 255, 230 / 255, int(255 * alphaF * 0.7) / 255);
    const colLine = wgl.makeColor(
      COLOR_UI_ACCENT.r, COLOR_UI_ACCENT.g, COLOR_UI_ACCENT.b,
      int(255 * alphaF * 0.7) / 255,
    );
    const iconTint = wgl.makeColor(1.0, 1.0, 1.0, int(255 * alphaF) / 255);

    const leftCenterX = x + 36.0 * scale;
    const rightLabelX = x + 100.0 * scale;
    const rightCenterX = rightLabelX + 32.0 * scale;

    const scoreW = this._textWidth(font, 'Score', 1.0 * scale);
    this._drawSmall(font, 'Score', new Vec2(leftCenterX - scoreW * 0.5, y), 1.0 * scale, colLabel);
    const scoreValueW = this._textWidth(font, scoreValue, 1.0 * scale);
    this._drawSmall(
      font, scoreValue,
      new Vec2(leftCenterX - scoreValueW * 0.5, y + 15.0 * scale),
      1.0 * scale,
      colScoreValue,
    );
    const rankLabel = `Rank: ${rankText}`;
    const rankW = this._textWidth(font, rankLabel, 1.0 * scale);
    this._drawSmall(
      font, rankLabel,
      new Vec2(leftCenterX - rankW * 0.5, y + 30.0 * scale),
      1.0 * scale,
      colLabel,
    );

    // Native path: FUN_00441220 sets current color from DAT_004ccca8 just before
    // drawing "Experience", so it uses the accent-blue tint (alpha*0.7).
    this._drawSmall(font, 'Experience', new Vec2(rightLabelX, y), 1.0 * scale, colLine);
    const xpValueW = this._textWidth(font, xpValue, 1.0 * scale);
    this._drawSmall(
      font, xpValue,
      new Vec2(rightCenterX - xpValueW * 0.5, y + 15.0 * scale),
      1.0 * scale,
      colLabel,
    );

    // Native vertical separator drawn via FUN_00441220 from x+84, height 48.
    const sepX = x + 84.0 * scale;
    drawLine(int(sepX), int(y), int(sepX), int(y + 48.0 * scale), colLine);

    const rowTop = y + 52.0 * scale;
    drawLine(int(x - 12.0 * scale), int(rowTop), int(x + 180.0 * scale), int(rowTop), colLine);
    if (!opts.showWeaponRow) return;

    const rowY = rowTop;
    const wicons = getTexture(resources, TextureId.UI_WICONS);
    const src = weaponIconSrc(wicons, record.mostUsedWeaponId);
    if (src !== null) {
      const dst = wgl.makeRectangle(x + 4.0 * scale, rowY, 64.0 * scale, 32.0 * scale);
      wgl.drawTexturePro(wicons, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, iconTint);
    }

    const weaponId = record.mostUsedWeaponId;
    const weaponName = weaponDisplayName(weaponId, { preserveBugs: this.preserveBugs });
    const nameW = this._textWidth(font, weaponName, 1.0 * scale);
    const nameX = Math.max(x + 4.0 * scale, leftCenterX - nameW * 0.5);
    this._drawSmall(font, weaponName, new Vec2(nameX, rowY + 32.0 * scale), 1.0 * scale, colRow);

    const fragsText = `Frags: ${int(record.creatureKillCount)}`;
    this._drawSmall(font, fragsText, new Vec2(x + 114.0 * scale, rowY + 1.0 * scale), 1.0 * scale, colRow);

    const fired = Math.max(0, int(record.shotsFired));
    const hit = Math.max(0, Math.min(int(record.shotsHit), fired));
    const ratio = fired > 0 ? int((hit * 100) / fired) : 0;
    const hitText = `Hit %: ${ratio}%`;
    this._drawSmall(font, hitText, new Vec2(x + 114.0 * scale, rowY + 15.0 * scale), 1.0 * scale, colRow);

    drawLine(
      int(x - 12.0 * scale), int(rowY + 48.0 * scale),
      int(x + 180.0 * scale), int(rowY + 48.0 * scale),
      colLine,
    );
  }

  update(
    dt: number,
    opts: {
      playSfx?: ((id: SfxId) => void) | null;
      rng?: CrandLike | null;
      mouse?: { x: number; y: number } | null;
    },
  ): string | null {
    const dtS = Math.min(dt, 0.1);
    const dtMs = dtS * 1000.0;
    this._cursorPulseTime += dtS * 1.1;
    const mouse = opts.mouse ?? { x: InputState.mousePosition()[0], y: InputState.mousePosition()[1] };
    const playSfx = opts.playSfx ?? null;
    const resources = runtimeResourcesFor(this.assetsRoot);

    if (this.record === null || this.breakdown === null) return null;

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

    this._introMs = Math.min(PANEL_SLIDE_START_MS, this._introMs + dtMs);
    if (
      !this._panelOpenSfxPlayed &&
      playSfx !== null &&
      this._introMs >= PANEL_SLIDE_START_MS - 1e-3
    ) {
      playSfx(SfxId.UI_PANELCLICK);
      this._panelOpenSfxPlayed = true;
    }
    if (this._consumeEnter) {
      this._consumeEnter = false;
      InputState.wasKeyPressed(KEY_ENTER);
    }

    if (InputState.wasKeyPressed(KEY_ESCAPE)) {
      if (playSfx !== null) playSfx(SfxId.UI_BUTTONCLICK);
      this._beginCloseTransition('main_menu');
      return null;
    }

    const qualifies = this.rank < TABLE_MAX;

    if (this.phase === 0) {
      let anim = this._breakdownAnim;
      if (anim === null) {
        this._breakdownAnim = QuestResultsBreakdownAnim.start();
        anim = this._breakdownAnim;
      }

      const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);
      if (InputState.wasKeyPressed(KEY_SPACE) || click) {
        anim.setFinal(this.breakdown);
        if (qualifies) {
          this.phase = 1;
          this._armNameInputAfterControlRelease();
        } else {
          this.phase = 2;
        }
        return null;
      }

      const clinks = tickQuestResultsBreakdownAnim(anim, {
        frameDtMs: int(dtS * 1000.0),
        target: this.breakdown,
      });
      if (clinks > 0 && playSfx !== null) {
        playSfx(SfxId.UI_CLINK_01);
      }
      if (anim.done) {
        if (qualifies) {
          this.phase = 1;
          this._armNameInputAfterControlRelease();
        } else {
          this.phase = 2;
        }
      }
      return null;
    }

    if (this.phase === 1) {
      if (this._deferNameInputUntilControlsReleased) {
        flushTextInputEvents();
        InputState.wasKeyPressed(KEY_ENTER);
        InputState.wasKeyPressed(KEY_KP_ENTER);
        if (!gameplayControlsHeld(this.config)) {
          this._deferNameInputUntilControlsReleased = false;
        }
        return null;
      }
      const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);
      const rng = opts.rng ?? new Crand(0);
      const [newText, newCaret] = updateNameEntryText(
        this.inputText,
        this.inputCaret,
        { maxLen: NAME_MAX_EDIT, rng, playSfx },
      );
      this.inputText = newText;
      this.inputCaret = newCaret;

      const screenW = wgl.getScreenWidth();
      const screenH = wgl.getScreenHeight();
      const scale = uiScale(screenW, screenH);
      const panelLayout = this._panelLayout({ screenW, scale });
      const contentPos = panelLayout.topLeft.offset({ dx: QUEST_RESULTS_CONTENT_X * scale });
      const inputPos = contentPos.offset({ dy: 150.0 * scale });
      const okPos = inputPos.add(new Vec2(170.0 * scale, -8.0 * scale));
      const okW = buttonWidth(resources, this._okButton.label, { scale, forceWide: this._okButton.forceWide });
      const okClicked = buttonUpdate(this._okButton, { pos: okPos, width: okW, dtMs, mouse, click });

      if (okClicked || InputState.wasKeyPressed(KEY_ENTER)) {
        if (this.inputText.trim()) {
          if (playSfx !== null) playSfx(SfxId.UI_TYPEENTER);
          if (!this._saved && this._scoresPath !== null) {
            const candidate = this.record.copy();
            candidate.setName(this.inputText);
            try {
              const [, idx] = upsertHighscoreRecord(this._scoresPath, candidate);
              this.highlightRank = int(idx) < TABLE_MAX ? int(idx) : null;
              if (int(idx) < TABLE_MAX) {
                this.rank = int(idx);
              }
            } catch {
              this.highlightRank = null;
            }
            this._saved = true;
          }
          setPlayerNameInput(this.config.profile, this.inputText);
          this.config.save();
          this.phase = 2;
          return null;
        }
        if (playSfx !== null) playSfx(SfxId.SHOCK_HIT_01);
      }
      return null;
    }

    if (this.phase === 2) {
      const click = InputState.wasMouseButtonPressed(MOUSE_BUTTON_LEFT);
      if (InputState.wasKeyPressed(KEY_ENTER)) {
        if (playSfx !== null) playSfx(SfxId.UI_BUTTONCLICK);
        this._beginCloseTransition('play_again');
        return null;
      }
      if (InputState.wasKeyPressed(KEY_N)) {
        if (playSfx !== null) playSfx(SfxId.UI_BUTTONCLICK);
        this._beginCloseTransition('play_next');
        return null;
      }
      if (InputState.wasKeyPressed(KEY_H)) {
        if (playSfx !== null) playSfx(SfxId.UI_BUTTONCLICK);
        this._beginCloseTransition('high_scores');
        return null;
      }

      const screenW = wgl.getScreenWidth();
      const screenH = wgl.getScreenHeight();
      const scale = uiScale(screenW, screenH);
      const panelLayout = this._panelLayout({ screenW, scale });
      const contentPos = panelLayout.topLeft.offset({ dx: QUEST_RESULTS_CONTENT_X * scale });
      const scoreCardPos = contentPos.offset({ dx: QUEST_RESULTS_SCORE_CARD_X_FROM_CONTENT * scale });

      let varC12 = panelLayout.topLeft.y + (qualifies ? 96.0 : 108.0) * scale;
      let varC14 = varC12 + 84.0 * scale;
      if (this.unlockWeaponName) {
        varC14 += 30.0 * scale;
      }
      if (this.unlockPerkName) {
        varC14 += 30.0 * scale;
      }

      let btnPos = new Vec2(scoreCardPos.x + 20.0 * scale, varC14 + 6.0 * scale);

      const playNextW = buttonWidth(resources, this._playNextButton.label, {
        scale,
        forceWide: this._playNextButton.forceWide,
      });
      if (buttonUpdate(this._playNextButton, { pos: btnPos, width: playNextW, dtMs, mouse, click })) {
        if (playSfx !== null) playSfx(SfxId.UI_BUTTONCLICK);
        this._beginCloseTransition('play_next');
        return null;
      }
      btnPos = btnPos.offset({ dy: 32.0 * scale });

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
      return null;
    }

    return null;
  }

  draw(
    opts: {
      resources: RuntimeResources;
      mouse?: { x: number; y: number } | null;
    },
  ): void {
    if (this.record === null || this.breakdown === null) return;
    const mouse = opts.mouse ?? { x: InputState.mousePosition()[0], y: InputState.mousePosition()[1] };
    const resources = opts.resources;
    const font = resources.smallFont;

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const scale = uiScale(screenW, screenH);

    const panelLayout = this._panelLayout({ screenW, scale });
    const panel = panelLayout.panel;

    const fxDetail = fxDetailEnabled(this.config.display, 0);
    drawClassicMenuPanel(
      getTexture(resources, TextureId.UI_MENU_PANEL),
      { dst: wgl.makeRectangle(panel.x, panel.y, panel.w, panel.h), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail },
    );

    const contentPos = panelLayout.topLeft.offset({ dx: QUEST_RESULTS_CONTENT_X * scale });
    const bannerPos = contentPos.add(new Vec2(QUEST_RESULTS_BANNER_X_FROM_CONTENT * scale, 36.0 * scale));
    const textWellDone = getTexture(resources, TextureId.UI_TEXT_WELL_DONE);
    const bannerSrc = wgl.makeRectangle(0.0, 0.0, textWellDone.width, textWellDone.height);
    const bannerDst = wgl.makeRectangle(bannerPos.x, bannerPos.y, TEXTURE_TOP_BANNER_W * scale, TEXTURE_TOP_BANNER_H * scale);
    wgl.drawTexturePro(textWellDone, bannerSrc, bannerDst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    const qualifies = this.rank < TABLE_MAX;

    if (this.phase === 0) {
      const labelX = contentPos.x + 32.0 * scale;
      const valueX = labelX + 132.0 * scale;

      const anim = this._breakdownAnim;
      let step = 4;
      let highlightAlpha = 1.0;
      let baseTimeMs = int(this.breakdown.baseTimeMs);
      let lifeBonusMs = int(this.breakdown.lifeBonusMs);
      let perkBonusMs = int(this.breakdown.unpickedPerkBonusMs);
      let finalTimeMs = int(this.breakdown.finalTimeMs);
      if (anim !== null && !anim.done) {
        step = int(anim.step);
        highlightAlpha = anim.highlightAlpha();
        baseTimeMs = int(anim.baseTimeMs);
        lifeBonusMs = int(anim.lifeBonusMs);
        perkBonusMs = int(anim.unpickedPerkBonusS * 1000);
        finalTimeMs = int(anim.finalTimeMs);
      }

      const rowColor = (idx: number, final = false): wgl.Color => {
        if (anim === null || anim.done) return COLOR_TEXT;
        let a = 0.2;
        if (idx < step) {
          a = 0.4;
        } else if (idx === step) {
          a = 1.0;
          if (final) a *= highlightAlpha;
        }
        let rgb: [number, number, number] = [1.0, 1.0, 1.0];
        if (idx === step) {
          rgb = [COLOR_GREEN.r, COLOR_GREEN.g, COLOR_GREEN.b];
        }
        return wgl.makeColor(rgb[0], rgb[1], rgb[2], int(255 * Math.max(0.0, Math.min(1.0, a))) / 255);
      };

      let y = panelLayout.topLeft.y + 156.0 * scale;
      const baseValue = formatTimeMmSs(baseTimeMs);
      const lifeValue = formatTimeMmSs(lifeBonusMs);
      const perkValue = formatTimeMmSs(perkBonusMs);
      const finalValue = formatTimeMmSs(finalTimeMs);

      this._drawSmall(font, 'Base Time:', new Vec2(labelX, y), 1.0 * scale, rowColor(0));
      this._drawSmall(font, baseValue, new Vec2(valueX, y), 1.0 * scale, rowColor(0));
      y += 20.0 * scale;

      this._drawSmall(font, 'Life Bonus:', new Vec2(labelX, y), 1.0 * scale, rowColor(1));
      this._drawSmall(font, lifeValue, new Vec2(valueX, y), 1.0 * scale, rowColor(1));
      y += 20.0 * scale;

      this._drawSmall(font, 'Unpicked Perk Bonus:', new Vec2(labelX, y), 1.0 * scale, rowColor(2));
      this._drawSmall(font, perkValue, new Vec2(valueX, y), 1.0 * scale, rowColor(2));
      y += 20.0 * scale;

      // Final time underline + row (matches the extra quad draw in native).
      const lineY = y + 1.0 * scale;
      const lineColor = wgl.makeColor(1.0, 1.0, 1.0, rowColor(3, true).a);
      wgl.drawRectangle(
        int(labelX - 4.0 * scale), int(lineY),
        int(168.0 * scale), int(1.0 * scale),
        wgl.makeColor(lineColor.r, lineColor.g, lineColor.b, lineColor.a),
      );

      y += 8.0 * scale;
      this._drawSmall(font, 'Final Time:', new Vec2(labelX, y), 1.0 * scale, rowColor(3, true));
      this._drawSmall(font, finalValue, new Vec2(valueX, y), 1.0 * scale, rowColor(3, true));

    } else if (this.phase === 1) {
      const textY = panelLayout.topLeft.y + 118.0 * scale;
      const namePrompt = this.preserveBugs ? 'State your name trooper!' : 'State your name, trooper!';
      this._drawSmall(
        font, namePrompt,
        new Vec2(contentPos.x + 42.0 * scale, textY),
        1.0 * scale,
        COLOR_UI_ACCENT,
      );

      const inputPos = contentPos.offset({ dy: 150.0 * scale });
      wgl.drawRectangle(
        int(inputPos.x), int(inputPos.y),
        int(INPUT_BOX_W * scale), 1,
        wgl.makeColor(1, 1, 1, 1),
      );
      wgl.drawRectangle(
        int(inputPos.x), int(inputPos.y + INPUT_BOX_H * scale - 1),
        int(INPUT_BOX_W * scale), 1,
        wgl.makeColor(1, 1, 1, 1),
      );
      wgl.drawRectangle(
        int(inputPos.x), int(inputPos.y),
        1, int(INPUT_BOX_H * scale),
        wgl.makeColor(1, 1, 1, 1),
      );
      wgl.drawRectangle(
        int(inputPos.x + INPUT_BOX_W * scale - 1), int(inputPos.y),
        1, int(INPUT_BOX_H * scale),
        wgl.makeColor(1, 1, 1, 1),
      );
      wgl.drawRectangle(
        int(inputPos.x + 1.0 * scale), int(inputPos.y + 1.0 * scale),
        int((INPUT_BOX_W - 2.0) * scale), int((INPUT_BOX_H - 2.0) * scale),
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
        int(caretX), int(inputPos.y + 2.0 * scale),
        int(1.0 * scale), int(14.0 * scale),
        wgl.makeColor(caretColor.r, caretColor.g, caretColor.b, caretColor.a),
      );

      const okPos = inputPos.add(new Vec2(170.0 * scale, -8.0 * scale));
      const okW = buttonWidth(resources, this._okButton.label, { scale, forceWide: this._okButton.forceWide });
      buttonDraw(resources, this._okButton, { pos: okPos, width: okW, scale });

      // Native phase 1 still renders the quest score card while entering the name.
      const scoreCardPos = inputPos.add(new Vec2(26.0 * scale, 46.0 * scale));
      this._drawNameEntryStats({
        pos: scoreCardPos,
        scale,
        alpha: 1.0,
        showWeaponRow: true,
        resources,
        font,
      });

    } else {
      const scoreCardPos = contentPos.offset({ dx: QUEST_RESULTS_SCORE_CARD_X_FROM_CONTENT * scale });
      let varC12 = panelLayout.topLeft.y + (qualifies ? 96.0 : 108.0) * scale;
      if (!qualifies) {
        this._drawSmall(
          font,
          'Score too low for top100.',
          new Vec2(scoreCardPos.x + 8.0 * scale, panelLayout.topLeft.y + 102.0 * scale),
          1.0 * scale,
          wgl.makeColor(200 / 255, 200 / 255, 200 / 255, 1.0),
        );
      }

      const cardY = varC12 + 16.0 * scale;
      this._drawNameEntryStats({
        pos: new Vec2(scoreCardPos.x, cardY),
        scale,
        alpha: 1.0,
        showWeaponRow: false,
        resources,
        font,
      });

      // Unlock lines (their presence shifts the buttons down in native).
      let varC14 = varC12 + 84.0 * scale;
      if (this.unlockWeaponName) {
        this._drawSmall(
          font,
          'Weapon unlocked:',
          new Vec2(scoreCardPos.x, varC14 + 1.0 * scale),
          1.0 * scale,
          COLOR_TEXT_SUBTLE,
        );
        this._drawSmall(
          font,
          this.unlockWeaponName,
          new Vec2(scoreCardPos.x, varC14 + 14.0 * scale),
          1.0 * scale,
          COLOR_TEXT,
        );
        varC14 += 30.0 * scale;
      }
      if (this.unlockPerkName) {
        this._drawSmall(
          font,
          'Perk unlocked:',
          new Vec2(scoreCardPos.x, varC14 + 1.0 * scale),
          1.0 * scale,
          COLOR_TEXT_SUBTLE,
        );
        this._drawSmall(
          font,
          this.unlockPerkName,
          new Vec2(scoreCardPos.x, varC14 + 14.0 * scale),
          1.0 * scale,
          COLOR_TEXT,
        );
        varC14 += 30.0 * scale;
      }

      // Buttons
      let btnPos = new Vec2(scoreCardPos.x + 20.0 * scale, varC14 + 6.0 * scale);
      const playNextW = buttonWidth(resources, this._playNextButton.label, {
        scale,
        forceWide: this._playNextButton.forceWide,
      });
      buttonDraw(resources, this._playNextButton, { pos: btnPos, width: playNextW, scale });
      btnPos = btnPos.offset({ dy: 32.0 * scale });

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
