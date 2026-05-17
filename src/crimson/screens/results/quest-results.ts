// Port of crimson/screens/results/quest_results.py

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
import { NAME_MAX_EDIT, TABLE_MAX, rankIndex, readHighscoreTable, scoresPathForMode, upsertHighscoreRecord } from '@crimson/persistence/highscores.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import type { QuestFinalTime } from '@crimson/quests/results.ts';
import { QuestResultsBreakdownAnim, tickQuestResultsBreakdownAnim } from '@crimson/quests/results.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { formatOrdinal, formatTimeMmSs } from '@crimson/ui/formatting.ts';
import { menuWidescreenYShift, uiScale } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth, drawUiText } from '@crimson/ui/perk-menu.ts';
import { flushTextInputEvents, gameplayControlsHeld, updateNameEntryText } from '@crimson/ui/text-input.ts';
import { WEAPON_BY_ID, weaponDisplayName } from '@crimson/weapons.ts';
import * as wgl from '@wgl';

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
export const QUEST_RESULTS_PANEL_POS_X = -45.0;
export const QUEST_RESULTS_PANEL_POS_Y = 110.0;
export const QUEST_RESULTS_PANEL_GEOM_X0 = -63.0;
export const QUEST_RESULTS_PANEL_GEOM_Y0 = -81.0;
export const QUEST_RESULTS_PANEL_W = 510.0;
export const QUEST_RESULTS_PANEL_H = 378.0;
export const TEXTURE_TOP_BANNER_W = 256.0;
export const TEXTURE_TOP_BANNER_H = 64.0;
// `quest_results_screen_update` uses the classic UI element sums for positioning:
//   content_x = (pos_x + offset_x + slide_x) + 180.0 + 40.0
//   banner_x  = content_x - 18.0
//   score_x   = content_x + 30.0
export const QUEST_RESULTS_CONTENT_X = 220.0;
export const QUEST_RESULTS_BANNER_X_FROM_CONTENT = -18.0;
export const QUEST_RESULTS_SCORE_CARD_X_FROM_CONTENT = 30.0;
export const INPUT_BOX_W = 166.0;
export const INPUT_BOX_H = 18.0;
// Capture (1024x768) shows the quest results panel uses the same ui_element
// timeline pattern as other screens: fully hidden until 100ms, then slides in
// over 300ms (end=100, start=400).
export const PANEL_SLIDE_START_MS = 400.0;
export const PANEL_SLIDE_END_MS = 100.0;
export const COLOR_TEXT = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255);
export const COLOR_TEXT_MUTED = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255);
export const COLOR_TEXT_SUBTLE = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.7) / 255);
export const COLOR_GREEN = wgl.makeColor(25 / 255, 200 / 255, 25 / 255, 255 / 255);
// `sub_41e070` initializes DAT_004965f8..600 to this blue tint (149,175,198),
// reused by quest/game-over captions and score-card separator outlines.
export const COLOR_UI_ACCENT = wgl.makeColor(149 / 255, 175 / 255, 198 / 255, 255 / 255);

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

function pythonEquals(left: object | string | number | boolean | null | undefined, right: object | string | number | boolean | null | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (left !== null && left !== undefined && typeof left === 'object') {
    const equal = Reflect.get(left, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(left, right));
    }
  }
  if (right !== null && right !== undefined && typeof right === 'object') {
    const equal = Reflect.get(right, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(right, left));
    }
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => pythonEquals(value, right[index]));
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && pythonEquals(Reflect.get(left, key), Reflect.get(right, key)));
  }
  return false;
}

export class QuestResultsPanelLayout {
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

export class QuestResultsUi {
  assetsRoot: string;
  baseDir: string;
  config: CrimsonConfig;
  preserveBugs: boolean;
  phase: number; // -1 init, 0 breakdown, 1 name entry (if qualifies), 2 results/buttons
  rank: number;
  highlightRank: number | null;
  questLevel: QuestLevel | null;
  questTitle: string;
  unlockWeaponName: string;
  unlockPerkName: string;
  record: HighScoreRecord | null;
  breakdown: QuestFinalTime | null;
  _breakdownAnim: QuestResultsBreakdownAnim | null;
  _scoresPath: string | null;
  inputText: string;
  inputCaret: number;
  _saved: boolean;
  _introMs: number;
  _cursorPulseTime: number;
  _panelOpenSfxPlayed: boolean;
  _closing: boolean;
  _closeAction: string | null;
  _consumeEnter: boolean;
  _deferNameInputUntilControlsReleased: boolean;
  _okButton: UiButtonState;
  _playNextButton: UiButtonState;
  _playAgainButton: UiButtonState;
  _highScoresButton: UiButtonState;
  _mainMenuButton: UiButtonState;

  constructor(opts: {
    assetsRoot: string;
    baseDir: string;
    config: CrimsonConfig;
    preserveBugs?: boolean;
    phase?: number;
    rank?: number;
    highlightRank?: number | null;
    questLevel?: QuestLevel | null;
    questTitle?: string;
    unlockWeaponName?: string;
    unlockPerkName?: string;
    record?: HighScoreRecord | null;
    breakdown?: QuestFinalTime | null;
    _breakdownAnim?: QuestResultsBreakdownAnim | null;
    _scoresPath?: string | null;
    inputText?: string;
    inputCaret?: number;
    _saved?: boolean;
    _introMs?: number;
    _cursorPulseTime?: number;
    _panelOpenSfxPlayed?: boolean;
    _closing?: boolean;
    _closeAction?: string | null;
    _consumeEnter?: boolean;
    _deferNameInputUntilControlsReleased?: boolean;
    _okButton?: UiButtonState;
    _playNextButton?: UiButtonState;
    _playAgainButton?: UiButtonState;
    _highScoresButton?: UiButtonState;
    _mainMenuButton?: UiButtonState;
  }) {
    this.assetsRoot = opts.assetsRoot;
    this.baseDir = opts.baseDir;
    this.config = opts.config;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.phase = opts.phase ?? -1;
    this.rank = opts.rank ?? TABLE_MAX;
    this.highlightRank = opts.highlightRank ?? null;
    this.questLevel = opts.questLevel ?? null;
    this.questTitle = opts.questTitle ?? '';
    this.unlockWeaponName = opts.unlockWeaponName ?? '';
    this.unlockPerkName = opts.unlockPerkName ?? '';
    this.record = opts.record ?? null;
    this.breakdown = opts.breakdown ?? null;
    this._breakdownAnim = opts._breakdownAnim ?? null;
    this._scoresPath = opts._scoresPath ?? null;
    this.inputText = opts.inputText ?? '';
    this.inputCaret = opts.inputCaret ?? 0;
    this._saved = opts._saved ?? false;
    this._introMs = opts._introMs ?? 0.0;
    this._cursorPulseTime = opts._cursorPulseTime ?? 0.0;
    this._panelOpenSfxPlayed = opts._panelOpenSfxPlayed ?? false;
    this._closing = opts._closing ?? false;
    this._closeAction = opts._closeAction ?? null;
    this._consumeEnter = opts._consumeEnter ?? false;
    this._deferNameInputUntilControlsReleased = opts._deferNameInputUntilControlsReleased ?? false;
    this._okButton = opts._okButton ?? new UiButtonState({ label: 'OK', forceWide: false });
    this._playNextButton = opts._playNextButton ?? new UiButtonState({ label: 'Play Next', forceWide: true });
    this._playAgainButton = opts._playAgainButton ?? new UiButtonState({ label: 'Play Again', forceWide: true });
    this._highScoresButton = opts._highScoresButton ?? new UiButtonState({ label: 'High scores', forceWide: true });
    this._mainMenuButton = opts._mainMenuButton ?? new UiButtonState({ label: 'Main Menu', forceWide: true });
  }

  open(opts: { record: HighScoreRecord; breakdown: QuestFinalTime; questLevel: QuestLevel; questTitle: string; unlockWeaponName: string; unlockPerkName: string; playerNameDefault: string }): void {
    const record = opts.record;
    const breakdown = opts.breakdown;
    const questLevel = opts.questLevel;
    const questTitle = opts.questTitle;
    const unlockWeaponName = opts.unlockWeaponName;
    const unlockPerkName = opts.unlockPerkName;
    const playerNameDefault = opts.playerNameDefault;
    this.close();
    this.phase = -1;
    this.rank = TABLE_MAX;
    this.highlightRank = null;
    this.questLevel = questLevel;
    this.questTitle = String(questTitle || '');
    this.unlockWeaponName = String(unlockWeaponName || '');
    this.unlockPerkName = String(unlockPerkName || '');
    this.record = record.copy();
    this.breakdown = breakdown;
    this._breakdownAnim = QuestResultsBreakdownAnim.start();
    this._saved = false;

    // Native behavior: the final quest replaces "Play Next" with "Show End Note".
    if (pythonEquals(this.questLevel, new QuestLevel({ major: 5, minor: 10 }))) {
      this._playNextButton.label = 'Show End Note';
    } else {
      this._playNextButton.label = 'Play Next';
    }

    if (!(this.questLevel !== null)) throw new Error('quest results require quest level');
    const hardcore = this.config.gameplay.hardcore;
    this._scoresPath = scoresPathForMode(this.baseDir, GameMode.QUESTS, { hardcore: hardcore, questStageMajor: int(this.questLevel.major), questStageMinor: int(this.questLevel.minor), playerCount: this.config.gameplay.playerCount });

    let records: ReturnType<typeof readHighscoreTable>;
    try {
      records = readHighscoreTable(this._scoresPath, { gameModeId: GameMode.QUESTS });
      this.rank = int(rankIndex(records, this.record));
    } catch (exc) {
      this.rank = TABLE_MAX;
    }

    this.inputText = String(playerNameDefault || '').slice(0, NAME_MAX_EDIT);
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

  close(): void {
    return;
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

  _armNameInputAfterControlRelease(): void {
    this._deferNameInputUntilControlsReleased = true;
    flushTextInputEvents();
    InputState.wasKeyPressed(13);
    InputState.wasKeyPressed(335);
  }

  worldEntityAlpha(): number {
    if (!this._closing) {
      return 1.0;
    }
    const tMs = this._introMs;
    if (tMs <= PANEL_SLIDE_END_MS) {
      return 0.0;
    }
    if (tMs >= PANEL_SLIDE_START_MS) {
      return 1.0;
    }
    const span = (PANEL_SLIDE_START_MS - PANEL_SLIDE_END_MS);
    if (span <= 1e-6) {
      return 1.0;
    }
    const alpha = (tMs - PANEL_SLIDE_END_MS) / span;
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

  _drawNameEntryStats(opts: { pos: Vec2; scale: number; alpha: number; showWeaponRow: boolean; resources: RuntimeResources; font: SmallFontData }): void {
    const pos = opts.pos;
    const scale = opts.scale;
    const alpha = opts.alpha;
    const showWeaponRow = opts.showWeaponRow;
    const resources = opts.resources;
    const font = opts.font;
    if (this.record === null) {
      return;
    }
    const record = this.record;
    const qualifies = int(this.rank) < TABLE_MAX;
    const rankText = qualifies ? formatOrdinal(int(this.rank) + 1) : '--';
    const x = pos.x;
    const y = pos.y;

    const seconds = int(record.survivalElapsedMs) * 0.001;
    const scoreValue = `${seconds.toFixed(2)} secs`;
    const xpValue = `${int(record.scoreXp)}`;

    const alphaF = Math.max(0.0, Math.min(1.0, alpha));
    const colLabel = wgl.makeColor(230 / 255, 230 / 255, 230 / 255, int(255 * alphaF * 0.8) / 255);
    const colScoreValue = wgl.makeColor(230 / 255, 230 / 255, 255 / 255, int(255 * alphaF) / 255);
    const colRow = wgl.makeColor(230 / 255, 230 / 255, 230 / 255, int(255 * alphaF * 0.7) / 255);
    const colLine = wgl.makeColor(COLOR_UI_ACCENT.r, COLOR_UI_ACCENT.g, COLOR_UI_ACCENT.b, int(255 * alphaF * 0.7) / 255);
    const iconTint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * alphaF) / 255);

    const leftCenterX = x + 36.0 * scale;
    const rightLabelX = x + 100.0 * scale;
    const rightCenterX = rightLabelX + 32.0 * scale;

    const scoreW = this._textWidth(font, 'Score', 1.0 * scale);
    this._drawSmall(font, 'Score', new Vec2(leftCenterX - scoreW * 0.5, y), 1.0 * scale, colLabel);
    const scoreValueW = this._textWidth(font, scoreValue, 1.0 * scale);
    this._drawSmall(font, scoreValue, new Vec2(leftCenterX - scoreValueW * 0.5, y + 15.0 * scale), 1.0 * scale, colScoreValue);
    const rankLabel = `Rank: ${rankText}`;
    const rankW = this._textWidth(font, rankLabel, 1.0 * scale);
    this._drawSmall(font, rankLabel, new Vec2(leftCenterX - rankW * 0.5, y + 30.0 * scale), 1.0 * scale, colLabel);

    // Native path: FUN_00441220 sets current color from DAT_004ccca8 just before
    // drawing "Experience", so it uses the accent-blue tint (alpha*0.7).
    this._drawSmall(font, 'Experience', new Vec2(rightLabelX, y), 1.0 * scale, colLine);
    const xpValueW = this._textWidth(font, xpValue, 1.0 * scale);
    this._drawSmall(font, xpValue, new Vec2(rightCenterX - xpValueW * 0.5, y + 15.0 * scale), 1.0 * scale, colLabel);

    // Native vertical separator drawn via FUN_00441220 from x+84, height 48.
    const sepX = x + 84.0 * scale;
    wgl.drawLine(int(sepX), int(y), int(sepX), int(y + 48.0 * scale), colLine);

    const rowTop = y + 52.0 * scale;
    wgl.drawLine(int(x - 12.0 * scale), int(rowTop), int(x + 180.0 * scale), int(rowTop), colLine);
    if (!showWeaponRow) {
      return;
    }

    const rowY = rowTop;
    const wicons = resources.texture(TextureId.UI_WICONS);
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

    wgl.drawLine(int(x - 12.0 * scale), int(rowY + 48.0 * scale), int(x + 180.0 * scale), int(rowY + 48.0 * scale), colLine);
  }

  _panelLayout(opts: { screenW: number; scale: number }): QuestResultsPanelLayout {
    const screenW = opts.screenW;
    const scale = opts.scale;
    // Match MenuView._ui_element_anim offset math (linear, with a 100ms hold hidden).
    const tMs = this._introMs;
    let panelSlideX: number;
    if (tMs < PANEL_SLIDE_END_MS) {
      panelSlideX = -QUEST_RESULTS_PANEL_W;
    } else if (tMs < PANEL_SLIDE_START_MS) {
      const span = (PANEL_SLIDE_START_MS - PANEL_SLIDE_END_MS);
      const p = span > 1e-6 ? (tMs - PANEL_SLIDE_END_MS) / span : 1.0;
      panelSlideX = -((1.0 - p) * QUEST_RESULTS_PANEL_W);
    } else {
      panelSlideX = 0.0;
    }

    let panelPos = new Vec2((QUEST_RESULTS_PANEL_GEOM_X0 + QUEST_RESULTS_PANEL_POS_X + panelSlideX) * scale, 0.0);
    const layoutW = scale ? screenW / scale : screenW;
    const widescreenShiftY = menuWidescreenYShift(layoutW);
    panelPos = new Vec2(panelPos.x, (QUEST_RESULTS_PANEL_GEOM_Y0 + QUEST_RESULTS_PANEL_POS_Y + widescreenShiftY) * scale);
    const panel = Rect.fromTopLeft(panelPos, QUEST_RESULTS_PANEL_W * scale, QUEST_RESULTS_PANEL_H * scale);
    return new QuestResultsPanelLayout({ panel: panel, topLeft: panelPos });
  }

  update(dt: number, opts: { playSfx?: ((arg0: SfxId) => void) | null; rng?: CrandLike | null; mouse?: wgl.Vector2 | null } = {}): string | null {
    const playSfx = opts.playSfx ?? null;
    let rng = opts.rng ?? null;
    let mouse = opts.mouse ?? null;
    const dtS = Math.min(dt, 0.1);
    const dtMs = dtS * 1000.0;
    this._cursorPulseTime += dtS * 1.1;
    if (mouse === null) {
      mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    }
    if (rng === null) {
      rng = new Crand(0);
    }

    if (this.record === null || this.breakdown === null) {
      return null;
    }

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
    if (!this._panelOpenSfxPlayed && playSfx !== null && this._introMs >= PANEL_SLIDE_START_MS - 1e-3) {
      playSfx(SfxId.UI_PANELCLICK);
      this._panelOpenSfxPlayed = true;
    }
    if (this._consumeEnter) {
      this._consumeEnter = false;
      InputState.wasKeyPressed(13);
    }

    if (InputState.wasKeyPressed(27)) {
      if (playSfx !== null) {
        playSfx(SfxId.UI_BUTTONCLICK);
      }
      this._beginCloseTransition('main_menu');
      return null;
    }

    let qualifies = int(this.rank) < TABLE_MAX;

    let anim: QuestResultsBreakdownAnim | null;
    let click: any;
    if (this.phase === 0) {
      anim = this._breakdownAnim;
      if (anim === null) {
        this._breakdownAnim = QuestResultsBreakdownAnim.start();
        anim = this._breakdownAnim;
      }

      click = InputState.wasMouseButtonPressed(0);
      if (InputState.wasKeyPressed(32) || click) {
        anim.setFinal(this.breakdown);
        if (qualifies) {
          this.phase = 1;
          this._armNameInputAfterControlRelease();
        } else {
          this.phase = 2;
        }
        return null;
      }

      const clinks = tickQuestResultsBreakdownAnim(anim, { frameDtMs: int(dtS * 1000.0), target: this.breakdown });
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

    let screenW: number;
    let screenH: number;
    let scale: ReturnType<typeof uiScale>;
    let panelLayout: QuestResultsPanelLayout;
    let contentPos: Vec2;
    let resources: ReturnType<typeof runtimeResourcesFor>;
    if (this.phase === 1) {
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
      contentPos = panelLayout.topLeft.offset({ dx: QUEST_RESULTS_CONTENT_X * scale });
      const inputPos = contentPos.offset({ dy: 150.0 * scale });
      const okPos = inputPos.add(new Vec2(170.0 * scale, -8.0 * scale));
      resources = runtimeResourcesFor(this.assetsRoot);
      const okW = buttonWidth(resources, this._okButton.label, { scale: scale, forceWide: this._okButton.forceWide });
      const okClicked = buttonUpdate(this._okButton, { pos: okPos, width: okW, dtMs: dtMs, mouse: mouse, click: click });

      if (okClicked || InputState.wasKeyPressed(13)) {
        if (this.inputText.trim()) {
          if (playSfx !== null) {
            playSfx(SfxId.UI_TYPEENTER);
          }
          if (!this._saved && this._scoresPath !== null) {
            const candidate = this.record.copy();
            candidate.setName(this.inputText);
            let table: ReturnType<typeof upsertHighscoreRecord>[0];
            let idx: ReturnType<typeof upsertHighscoreRecord>[1];
            try {
              [table, idx] = upsertHighscoreRecord(this._scoresPath, candidate);
              this.highlightRank = int(idx) < TABLE_MAX ? int(idx) : null;
              if (int(idx) < TABLE_MAX) {
                this.rank = int(idx);
              }
            } catch (exc) {
              this.highlightRank = null;
            }
            this._saved = true;
          }
          this.config.profile.setPlayerNameInput(this.inputText);
          this.config.save();
          this.phase = 2;
          return null;
        }
        if (playSfx !== null) {
          playSfx(SfxId.SHOCK_HIT_01);
        }
      }
      return null;
    }

    let varC14: number;
    let buttonPos: Vec2;
    if (this.phase === 2) {
      click = InputState.wasMouseButtonPressed(0);
      if (InputState.wasKeyPressed(13)) {
        if (playSfx !== null) {
          playSfx(SfxId.UI_BUTTONCLICK);
        }
        this._beginCloseTransition('play_again');
        return null;
      }
      if (InputState.wasKeyPressed(78)) {
        if (playSfx !== null) {
          playSfx(SfxId.UI_BUTTONCLICK);
        }
        this._beginCloseTransition('play_next');
        return null;
      }
      if (InputState.wasKeyPressed(72)) {
        if (playSfx !== null) {
          playSfx(SfxId.UI_BUTTONCLICK);
        }
        this._beginCloseTransition('high_scores');
        return null;
      }

      screenW = wgl.getScreenWidth();
      screenH = wgl.getScreenHeight();
      scale = uiScale(screenW, screenH);
      panelLayout = this._panelLayout({ screenW: screenW, scale: scale });
      qualifies = int(this.rank) < TABLE_MAX;
      contentPos = panelLayout.topLeft.offset({ dx: QUEST_RESULTS_CONTENT_X * scale });
      const scoreCardPos = contentPos.offset({ dx: QUEST_RESULTS_SCORE_CARD_X_FROM_CONTENT * scale });

      const varC12 = panelLayout.topLeft.y + ((qualifies ? 96.0 : 108.0) * scale);
      varC14 = varC12 + 84.0 * scale;
      if (this.unlockWeaponName) {
        varC14 += 30.0 * scale;
      }
      if (this.unlockPerkName) {
        varC14 += 30.0 * scale;
      }

      buttonPos = new Vec2(scoreCardPos.x + 20.0 * scale, varC14 + 6.0 * scale);
      resources = runtimeResourcesFor(this.assetsRoot);

      const playNextW = buttonWidth(resources, this._playNextButton.label, { scale: scale, forceWide: this._playNextButton.forceWide });
      if (buttonUpdate(this._playNextButton, { pos: buttonPos, width: playNextW, dtMs: dtMs, mouse: mouse, click: click })) {
        if (playSfx !== null) {
          playSfx(SfxId.UI_BUTTONCLICK);
        }
        this._beginCloseTransition('play_next');
        return null;
      }
      buttonPos = buttonPos.offset({ dy: 32.0 * scale });

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
      return null;
    }

    return null;
  }

  draw(opts: { mouse?: wgl.Vector2 | null } = {}): void {
    let mouse = opts.mouse ?? null;
    if (this.record === null || this.breakdown === null) {
      return;
    }
    if (mouse === null) {
      mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    }

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const scale = uiScale(screenW, screenH);

    const resources = runtimeResourcesFor(this.assetsRoot);
    const font = resources.smallFont;
    const panelLayout = this._panelLayout({ screenW: screenW, scale: scale });
    const panel = panelLayout.panel;

    const fxDetail = this.config.display.fxDetailEnabled({ level: 0, default: false });
    drawClassicMenuPanel(
      resources.texture(TextureId.UI_MENU_PANEL),
      { dst: panel.toRl(), tint: wgl.makeColor(1, 1, 1, 1), shadow: fxDetail },
    );

    const contentPos = panelLayout.topLeft.offset({ dx: QUEST_RESULTS_CONTENT_X * scale });
    const bannerPos = contentPos.add(new Vec2(QUEST_RESULTS_BANNER_X_FROM_CONTENT * scale, 36.0 * scale));
    const textWellDone = resources.texture(TextureId.UI_TEXT_WELL_DONE);
    const src = wgl.makeRectangle(0.0, 0.0, textWellDone.width, textWellDone.height);
    const dst = wgl.makeRectangle(bannerPos.x, bannerPos.y, TEXTURE_TOP_BANNER_W * scale, TEXTURE_TOP_BANNER_H * scale);
    wgl.drawTexturePro(textWellDone, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    const qualifies = int(this.rank) < TABLE_MAX;

    let step: number;
    let highlightAlpha: number;
    let baseTimeMs: number;
    let lifeBonusMs: number;
    let perkBonusMs: number;
    let finalTimeMs: number;
    let y: number;
    let caretAlpha: number;
    let scoreCardPos: Vec2 | number;
    let varC14: number;
    let buttonPos: Vec2;
    if (this.phase === 0) {
      const labelX = contentPos.x + 32.0 * scale;
      const valueX = labelX + 132.0 * scale;

      const anim = this._breakdownAnim;
      step = 4;
      highlightAlpha = 1.0;
      baseTimeMs = int(this.breakdown.baseTimeMs);
      lifeBonusMs = int(this.breakdown.lifeBonusMs);
      perkBonusMs = int(this.breakdown.unpickedPerkBonusMs);
      finalTimeMs = int(this.breakdown.finalTimeMs);
      if (anim !== null && !anim.done) {
        step = int(anim.step);
        highlightAlpha = anim.highlightAlpha();
        baseTimeMs = int(anim.baseTimeMs);
        lifeBonusMs = int(anim.lifeBonusMs);
        perkBonusMs = int(anim.unpickedPerkBonusS) * 1000;
        finalTimeMs = int(anim.finalTimeMs);
      }

      const _rowColor = (idx: number, opts: { final?: boolean } = {}): wgl.Color => {
        const final = opts.final ?? false;
        if (anim === null || anim.done) {
          return COLOR_TEXT;
        }
        let alpha = 0.2;
        if (idx < step) {
          alpha = 0.4;
        } else if (idx === step) {
          alpha = 1.0;
          if (final) {
            alpha *= highlightAlpha;
          }
        }
        let rgb: [number, number, number] = [255, 255, 255];
        if (idx === step) {
          rgb = [COLOR_GREEN.r, COLOR_GREEN.g, COLOR_GREEN.b];
        }
        return wgl.makeColor(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, int(255 * Math.max(0.0, Math.min(1.0, alpha))) / 255);
      };

      y = panelLayout.topLeft.y + 156.0 * scale;
      const baseValue = formatTimeMmSs(baseTimeMs);
      const lifeValue = formatTimeMmSs(lifeBonusMs);
      const perkValue = formatTimeMmSs(perkBonusMs);
      const finalValue = formatTimeMmSs(finalTimeMs);

      this._drawSmall(font, 'Base Time:', new Vec2(labelX, y), 1.0 * scale, _rowColor(0));
      this._drawSmall(font, baseValue, new Vec2(valueX, y), 1.0 * scale, _rowColor(0));
      y += 20.0 * scale;

      this._drawSmall(font, 'Life Bonus:', new Vec2(labelX, y), 1.0 * scale, _rowColor(1));
      this._drawSmall(font, lifeValue, new Vec2(valueX, y), 1.0 * scale, _rowColor(1));
      y += 20.0 * scale;

      this._drawSmall(font, 'Unpicked Perk Bonus:', new Vec2(labelX, y), 1.0 * scale, _rowColor(2));
      this._drawSmall(font, perkValue, new Vec2(valueX, y), 1.0 * scale, _rowColor(2));
      y += 20.0 * scale;

      // Final time underline + row (matches the extra quad draw in native).
      const lineY = y + 1.0 * scale;
      const lineColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, _rowColor(3, { final: true }).a);
      wgl.drawRectangle(int(labelX - 4.0 * scale), int(lineY), int(168.0 * scale), int(1.0 * scale), lineColor);

      y += 8.0 * scale;
      this._drawSmall(font, 'Final Time:', new Vec2(labelX, y), 1.0 * scale, _rowColor(3, { final: true }));
      this._drawSmall(font, finalValue, new Vec2(valueX, y), 1.0 * scale, _rowColor(3, { final: true }));
    } else if (this.phase === 1) {
      const textY = panelLayout.topLeft.y + 118.0 * scale;
      const namePrompt = this.preserveBugs ? 'State your name trooper!' : 'State your name, trooper!';
      this._drawSmall(font, namePrompt, new Vec2(contentPos.x + 42.0 * scale, textY), 1.0 * scale, COLOR_UI_ACCENT);

      const inputPos = contentPos.offset({ dy: 150.0 * scale });
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

      const okPos = inputPos.add(new Vec2(170.0 * scale, -8.0 * scale));
      const okW = buttonWidth(resources, this._okButton.label, { scale: scale, forceWide: this._okButton.forceWide });
      buttonDraw(resources, this._okButton, { pos: okPos, width: okW, scale: scale });

      // Native phase 1 still renders the quest score card while entering the name.
      scoreCardPos = inputPos.add(new Vec2(26.0 * scale, 46.0 * scale));
      this._drawNameEntryStats({
        pos: scoreCardPos,
        scale: scale,
        alpha: 1.0,
        showWeaponRow: true,
        resources: resources,
        font: font,
      });
    } else {
      scoreCardPos = contentPos.offset({ dx: QUEST_RESULTS_SCORE_CARD_X_FROM_CONTENT * scale });
      const varC12 = panelLayout.topLeft.y + ((qualifies ? 96.0 : 108.0) * scale);
      if (!qualifies) {
        this._drawSmall(font, 'Score too low for top100.', new Vec2(scoreCardPos.x + 8.0 * scale, panelLayout.topLeft.y + 102.0 * scale), 1.0 * scale, wgl.makeColor(200 / 255, 200 / 255, 200 / 255, 255 / 255));
      }

      const cardY = varC12 + 16.0 * scale;
      this._drawNameEntryStats({
        pos: new Vec2(scoreCardPos.x, cardY),
        scale: scale,
        alpha: 1.0,
        showWeaponRow: false,
        resources: resources,
        font: font,
      });

      // Unlock lines (their presence shifts the buttons down in native).
      varC14 = varC12 + 84.0 * scale;
      if (this.unlockWeaponName) {
        this._drawSmall(font, 'Weapon unlocked:', new Vec2(scoreCardPos.x, varC14 + 1.0 * scale), 1.0 * scale, COLOR_TEXT_SUBTLE);
        this._drawSmall(font, this.unlockWeaponName, new Vec2(scoreCardPos.x, varC14 + 14.0 * scale), 1.0 * scale, COLOR_TEXT);
        varC14 += 30.0 * scale;
      }
      if (this.unlockPerkName) {
        this._drawSmall(font, 'Perk unlocked:', new Vec2(scoreCardPos.x, varC14 + 1.0 * scale), 1.0 * scale, COLOR_TEXT_SUBTLE);
        this._drawSmall(font, this.unlockPerkName, new Vec2(scoreCardPos.x, varC14 + 14.0 * scale), 1.0 * scale, COLOR_TEXT);
        varC14 += 30.0 * scale;
      }

      // Buttons
      buttonPos = new Vec2(scoreCardPos.x + 20.0 * scale, varC14 + 6.0 * scale);
      const playNextW = buttonWidth(resources, this._playNextButton.label, { scale: scale, forceWide: this._playNextButton.forceWide });
      buttonDraw(
        resources,
        this._playNextButton,
        { pos: buttonPos, width: playNextW, scale: scale },
      );
      buttonPos = buttonPos.offset({ dy: 32.0 * scale });
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

  beginCloseTransition(opts: { action: string }): void;
  beginCloseTransition(action: string): void;
  beginCloseTransition(actionOrOpts: string | { action: string }): void {
    const action: string = typeof actionOrOpts === 'object' && actionOrOpts !== null ? actionOrOpts.action : actionOrOpts as string;
    this._beginCloseTransition(action);
  }

  armNameInputAfterControlRelease(): void {
    this._armNameInputAfterControlRelease();
  }

  textWidth(font: SmallFontData, text: string, scale: number): number {
    return this._textWidth(font, text, scale);
  }

  drawSmall(font: SmallFontData, text: string, pos: Vec2, scale: number, color: wgl.Color): void {
    this._drawSmall(font, text, pos, scale, color);
  }

  drawNameEntryStats(opts: { pos: Vec2; scale: number; alpha: number; showWeaponRow: boolean; resources: RuntimeResources; font: SmallFontData }): void {
    const pos = opts.pos;
    const scale = opts.scale;
    const alpha = opts.alpha;
    const showWeaponRow = opts.showWeaponRow;
    const resources = opts.resources;
    const font = opts.font;
    this._drawNameEntryStats({ pos: pos, scale: scale, alpha: alpha, showWeaponRow: showWeaponRow, resources: resources, font: font });
  }

  panelLayout(opts: { screenW: number; scale: number }): QuestResultsPanelLayout {
    const screenW = opts.screenW;
    const scale = opts.scale;
    return this._panelLayout({ screenW: screenW, scale: scale });
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
