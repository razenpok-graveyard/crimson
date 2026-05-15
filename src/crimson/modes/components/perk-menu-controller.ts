// Port of crimson/modes/components/perk_menu_controller.py

import { Vec2 } from '@grim/geom.ts';
import { type RuntimeResources, TextureId, getTexture } from '@grim/assets.ts';
import { measureSmallTextWidth, SmallFontData } from '@grim/fonts/small.ts';
import { clamp } from '@grim/math.ts';
import * as wgl from '@wgl';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { PerkId, perkDisplayName, perkDisplayDescription } from '@crimson/perks/ids.ts';
import { type PlayerState } from '@crimson/sim/state-types.ts';
import { uiOrigin, uiScale } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { PERK_MENU_TRANSITION_MS, PerkMenuLayout, UiButtonState, buttonDraw, buttonUpdate, buttonWidth, drawMenuItem, drawUiText, menuItemHitRect, perkMenuComputeLayout, perkMenuPanelSlideX } from '@crimson/ui/perk-menu.ts';

export type PlaySfxFn = (sfxId: SfxId) => void;
export type OnCloseFn = () => void;

const UI_TEXT_COLOR = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 1.0);
const UI_SPONSOR_COLOR = wgl.makeColor(1.0, 1.0, 1.0, int(255 * 0.5) / 255);

export class PerkMenuUiContext {
  readonly player: PlayerState;
  readonly violenceDisabled: number;
  readonly preserveBugs: boolean;
  readonly resources: RuntimeResources;
  readonly mouse: Vec2;
  readonly fxDetail: boolean;
  readonly playSfx: PlaySfxFn | null;

  constructor(opts: {
    player: PlayerState;
    violenceDisabled: number;
    preserveBugs: boolean;
    resources: RuntimeResources;
    mouse: Vec2;
    fxDetail?: boolean;
    playSfx?: PlaySfxFn | null;
  }) {
    this.player = opts.player;
    this.violenceDisabled = opts.violenceDisabled;
    this.preserveBugs = opts.preserveBugs;
    this.resources = opts.resources;
    this.mouse = opts.mouse;
    this.fxDetail = opts.fxDetail ?? false;
    this.playSfx = opts.playSfx ?? null;
  }
}

export class PerkMenuController {
  private static readonly _DESC_WRAP_WIDTH_PX = 256.0;

  private _cancelLabel: string;
  private _onClose: OnCloseFn | null;
  private _layout!: PerkMenuLayout;
  private _cancelButton!: UiButtonState;
  private _open!: boolean;
  private _selectedIndex!: number;
  private _timelineMs!: number;
  private _wrappedDescCache!: Map<string, string>;

  constructor(opts?: { cancelLabel?: string; onClose?: OnCloseFn | null }) {
    this._cancelLabel = opts?.cancelLabel ?? 'Cancel';
    this._onClose = opts?.onClose ?? null;
    this.reset();
  }

  get open(): boolean {
    return this._open;
  }

  set open(value: boolean) {
    if (!value && this._open) {
      this.close();
    } else {
      this._open = value;
    }
  }

  get selectedIndex(): number {
    return this._selectedIndex;
  }

  set selectedIndex(value: number) {
    this._selectedIndex = int(value);
  }

  get timelineMs(): number {
    return this._timelineMs;
  }

  set timelineMs(value: number) {
    this._timelineMs = value;
  }

  get active(): boolean {
    return this._open || this._timelineMs > 1e-3;
  }

  reset(): void {
    this._layout = new PerkMenuLayout();
    this._cancelButton = new UiButtonState({ label: this._cancelLabel });
    this._open = false;
    this._selectedIndex = 0;
    this._timelineMs = 0.0;
    this._wrappedDescCache = new Map();
  }

  private _prewrappedPerkDesc(
    perkId: PerkId,
    font: SmallFontData,
    opts: { violenceDisabled: number; preserveBugs: boolean },
  ): string {
    const key = `${perkId}:${int(opts.violenceDisabled)}:${opts.preserveBugs ? 1 : 0}`;
    const cached = this._wrappedDescCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const desc = perkDisplayDescription(perkId, { violenceDisabled: int(opts.violenceDisabled), preserveBugs: opts.preserveBugs });
    const wrapped = PerkMenuController._wrapSmallTextNative(
      font,
      desc,
      PerkMenuController._DESC_WRAP_WIDTH_PX,
      { scale: 1.0 },
    );
    this._wrappedDescCache.set(key, wrapped);
    return wrapped;
  }

  private static _wrapSmallTextNative(
    font: SmallFontData,
    text: string,
    maxWidthPx: number,
    _opts: { scale: number },
  ): string {
    const wrapped = Array.from(text);
    if (wrapped.length === 0) {
      return '';
    }

    const maxWidth = maxWidthPx;
    let remaining = maxWidth;
    let i = 0;
    while (i < wrapped.length) {
      const ch = wrapped[i];
      if (ch === '\r') {
        i += 1;
        continue;
      }
      if (ch === '\n') {
        remaining = maxWidth;
        i += 1;
        continue;
      }

      remaining -= measureSmallTextWidth(font, ch);
      if (remaining < 0.0) {
        let j = i;
        while (j > 0 && wrapped[j] !== ' ' && wrapped[j] !== '\n') {
          j -= 1;
        }
        if (wrapped[j] === ' ') {
          wrapped[j] = '\n';
          i = j;
        }
        remaining = maxWidth;
      }
      i += 1;
    }

    return wrapped.join('');
  }

  close(): void {
    if (!this._open) {
      return;
    }
    this._open = false;
    if (this._onClose !== null) {
      this._onClose();
    }
  }

  openMenu(opts?: { playSfx?: PlaySfxFn | null }): void {
    if (this._open) {
      return;
    }
    if (opts?.playSfx) {
      opts.playSfx(SfxId.UI_PANELCLICK);
    }
    this._open = true;
    this._selectedIndex = 0;
  }

  tickTimeline(dtUiMs: number): void {
    if (this._open) {
      this._timelineMs = clamp(this._timelineMs + dtUiMs, 0.0, PERK_MENU_TRANSITION_MS);
    } else {
      this._timelineMs = clamp(this._timelineMs - dtUiMs, 0.0, PERK_MENU_TRANSITION_MS);
    }
  }

  handleInput(
    ctx: PerkMenuUiContext,
    choices: readonly PerkId[],
    opts: { dtUiMs: number },
  ): number | null {
    if (choices.length === 0) {
      this.close();
      return null;
    }

    if (this._selectedIndex >= choices.length) {
      this._selectedIndex = 0;
    }

    if (InputState.wasKeyPressed(40)) {
      this._selectedIndex = (this._selectedIndex + 1) % choices.length;
    }
    if (InputState.wasKeyPressed(38)) {
      this._selectedIndex = (this._selectedIndex - 1 + choices.length) % choices.length;
    }

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const scale = uiScale(screenW, screenH);
    const origin = uiOrigin(screenW, screenH, scale);
    const slideX = perkMenuPanelSlideX(this._timelineMs, { width: this._layout.panelSize.x });

    const click = InputState.wasMouseButtonPressed(0);

    const masterOwned = int(ctx.player.perkCounts[PerkId.PERK_MASTER]) > 0;
    const expertOwned = int(ctx.player.perkCounts[PerkId.PERK_EXPERT]) > 0;
    const computed = perkMenuComputeLayout(this._layout, {
      screenW,
      origin,
      scale,
      choiceCount: choices.length,
      expertOwned,
      masterOwned,
      panelSlideX: slideX,
    });

    const preserveBugs = ctx.preserveBugs;
    for (let idx = 0; idx < choices.length; idx++) {
      const perkId = choices[idx];
      const label = perkDisplayName(perkId, { violenceDisabled: int(ctx.violenceDisabled), preserveBugs });
      const itemPos = computed.listPos.offset({ dx: 0.0, dy: idx * computed.listStepY });
      const rect = menuItemHitRect(ctx.resources, label, { pos: itemPos, scale });
      if (rect.contains(ctx.mouse)) {
        this._selectedIndex = idx;
        if (click) {
          if (ctx.playSfx) {
            ctx.playSfx(SfxId.UI_BUTTONCLICK);
          }
          this.close();
          return idx;
        }
        break;
      }
    }

    const cancelW = buttonWidth(ctx.resources, this._cancelButton.label, {
      scale,
      forceWide: this._cancelButton.forceWide,
    });
    if (
      buttonUpdate(this._cancelButton, {
        pos: computed.cancelPos,
        width: cancelW,
        dtMs: opts.dtUiMs,
        mouse: ctx.mouse,
        click,
      })
    ) {
      if (ctx.playSfx) {
        ctx.playSfx(SfxId.UI_BUTTONCLICK);
      }
      this.close();
      return null;
    }

    if (InputState.wasKeyPressed(13) || InputState.wasKeyPressed(32)) {
      if (ctx.playSfx) {
        ctx.playSfx(SfxId.UI_BUTTONCLICK);
      }
      this.close();
      return this._selectedIndex;
    }

    return null;
  }

  draw(ctx: PerkMenuUiContext, choices: readonly PerkId[]): void {
    const menuT = clamp(this._timelineMs / PERK_MENU_TRANSITION_MS, 0.0, 1.0);
    if (menuT <= 1e-3) {
      return;
    }

    if (choices.length === 0) {
      return;
    }
    if (this._selectedIndex >= choices.length) {
      this._selectedIndex = 0;
    }

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const scale = uiScale(screenW, screenH);
    const origin = uiOrigin(screenW, screenH, scale);
    const slideX = perkMenuPanelSlideX(this._timelineMs, { width: this._layout.panelSize.x });

    const masterOwned = int(ctx.player.perkCounts[PerkId.PERK_MASTER]) > 0;
    const expertOwned = int(ctx.player.perkCounts[PerkId.PERK_EXPERT]) > 0;
    const computed = perkMenuComputeLayout(this._layout, {
      screenW,
      origin,
      scale,
      choiceCount: choices.length,
      expertOwned,
      masterOwned,
      panelSlideX: slideX,
    });

    const panelTex = getTexture(ctx.resources, TextureId.UI_MENU_PANEL);
    const panelDst = wgl.makeRectangle(
      computed.panel.x,
      computed.panel.y,
      computed.panel.w,
      computed.panel.h,
    );
    drawClassicMenuPanel(panelTex, { dst: panelDst, shadow: ctx.fxDetail ?? false });

    const titleTex = getTexture(ctx.resources, TextureId.UI_TEXT_PICK_A_PERK);
    const titleSrc = wgl.makeRectangle(0.0, 0.0, titleTex.width, titleTex.height);
    const titleDst = wgl.makeRectangle(
      computed.title.x,
      computed.title.y,
      computed.title.w,
      computed.title.h,
    );
    wgl.drawTexturePro(titleTex, titleSrc, titleDst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    let sponsor: string | null = null;
    if (masterOwned) {
      sponsor = 'extra perks sponsored by the Perk Master';
    } else if (expertOwned) {
      sponsor = 'extra perk sponsored by the Perk Expert';
    }
    if (sponsor) {
      drawUiText(ctx.resources, sponsor, computed.sponsorPos, {
        scale,
        color: UI_SPONSOR_COLOR,
      });
    }

    const preserveBugs = ctx.preserveBugs;
    for (let idx = 0; idx < choices.length; idx++) {
      const perkId = choices[idx];
      const label = perkDisplayName(perkId, { violenceDisabled: int(ctx.violenceDisabled), preserveBugs });
      const itemPos = computed.listPos.offset({ dx: 0.0, dy: idx * computed.listStepY });
      const rect = menuItemHitRect(ctx.resources, label, { pos: itemPos, scale });
      const hovered = rect.contains(ctx.mouse) || idx === this._selectedIndex;
      drawMenuItem(ctx.resources, label, { pos: itemPos, scale, hovered });
    }

    const selected = choices[this._selectedIndex];
    let desc = perkDisplayDescription(selected, {
      violenceDisabled: int(ctx.violenceDisabled),
      preserveBugs,
    });
    desc = this._prewrappedPerkDesc(selected, ctx.resources.smallFont, {
      violenceDisabled: int(ctx.violenceDisabled),
      preserveBugs,
    });
    drawUiText(ctx.resources, desc, computed.desc.topLeft, {
      scale,
      color: UI_TEXT_COLOR,
    });

    const cancelW = buttonWidth(ctx.resources, this._cancelButton.label, {
      scale,
      forceWide: this._cancelButton.forceWide,
    });
    buttonDraw(ctx.resources, this._cancelButton, {
      pos: computed.cancelPos,
      width: cancelW,
      scale,
    });
  }
}
