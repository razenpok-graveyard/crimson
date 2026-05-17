// Port of crimson/modes/components/perk_menu_controller.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { measureSmallTextWidth } from '@grim/fonts/small.ts';
import { clamp } from '@grim/math.ts';
import type { rl } from '@grim/raylib-api.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { PerkId, perkDisplayDescription, perkDisplayName } from '@crimson/perks/index.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import { uiOrigin, uiScale } from '@crimson/ui/layout.ts';
import { drawClassicMenuPanel } from '@crimson/ui/menu-panel.ts';
import { PERK_MENU_TRANSITION_MS, PerkMenuLayout, UiButtonState, buttonDraw, buttonUpdate, buttonWidth, drawMenuItem, drawUiText, menuItemHitRect, perkMenuComputeLayout, perkMenuPanelSlideX } from '@crimson/ui/perk-menu.ts';
import * as wgl from '@wgl';

export type PlaySfxFn = (arg0: SfxId) => void;
export type OnCloseFn = () => void;

export const UI_TEXT_COLOR = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 255 / 255);
export const UI_SPONSOR_COLOR = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.5) / 255);

function tupleKey(value: readonly unknown[] | string): string {
  return typeof value === 'string' ? value : value.join(',');
}

export class PerkMenuUiContext {
  readonly player: PlayerState;
  readonly violenceDisabled: number;
  readonly preserveBugs: boolean;
  readonly resources: RuntimeResources;
  readonly mouse: rl.Vector2;
  readonly fxDetail: boolean;
  readonly playSfx: PlaySfxFn | null;

  constructor(opts: {
    player: PlayerState;
    violenceDisabled: number;
    preserveBugs: boolean;
    resources: RuntimeResources;
    mouse: rl.Vector2;
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
  protected _DESC_WRAP_WIDTH_PX: number = 256.0;
  protected _cancelLabel: string;
  protected _onClose: OnCloseFn | null;
  protected _selectedIndex!: number;
  _timelineMs!: number;
  protected _layout!: PerkMenuLayout;
  protected _cancelButton!: UiButtonState;
  protected _open!: boolean;
  protected _wrappedDescCache!: Map<string, string>;

  constructor(opts: { cancelLabel?: string; onClose?: OnCloseFn | null } = {}) {
    const cancelLabel = opts.cancelLabel ?? 'Cancel';
    const onClose = opts.onClose ?? null;
    this._cancelLabel = cancelLabel;
    this._onClose = onClose;
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
    return int(this._selectedIndex);
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

  protected _prewrappedPerkDesc(perkId: PerkId, font: SmallFontData, opts: { violenceDisabled: number; preserveBugs: boolean }): string {
    const violenceDisabled = opts.violenceDisabled;
    const preserveBugs = opts.preserveBugs;
    const key = [int(perkId), int(violenceDisabled), (preserveBugs ? 1 : 0)];
    const cached = this._wrappedDescCache.get(tupleKey(key)) ?? null;
    if (cached !== null) {
      return cached;
    }
    const desc = perkDisplayDescription(perkId, { violenceDisabled: int(violenceDisabled), preserveBugs: preserveBugs });
    const wrapped = PerkMenuController._wrapSmallTextNative(font, desc, this._DESC_WRAP_WIDTH_PX, { scale: 1.0 });
    this._wrappedDescCache.set(tupleKey(key), wrapped);
    return wrapped;
  }

  protected static _wrapSmallTextNative(font: SmallFontData, text: string, maxWidthPx: number, opts: { scale: number }): string {
    const scale = opts.scale;
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
      let j: any;
      if (remaining < 0.0) {
        j = i;
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

    return wrapped.join("");
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

  openMenu(opts: { playSfx?: PlaySfxFn | null } = {}): void {
    const playSfx = opts.playSfx ?? null;
    if (this._open) {
      return;
    }
    if (playSfx !== null) {
      playSfx(SfxId.UI_PANELCLICK);
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

  handleInput(ctx: PerkMenuUiContext, choices: readonly PerkId[], opts: { dtUiMs: number }): number | null {
    const dtUiMs = opts.dtUiMs;
    if (choices.length === 0) {
      this.close();
      return null;
    }

    if (this._selectedIndex >= choices.length) {
      this._selectedIndex = 0;
    }

    if (InputState.wasKeyPressed(40)) {
      this._selectedIndex = ((this._selectedIndex + 1) + choices.length) % choices.length;
    }
    if (InputState.wasKeyPressed(38)) {
      this._selectedIndex = ((this._selectedIndex - 1) + choices.length) % choices.length;
    }

    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const scale = uiScale(screenW, screenH);
    const origin = uiOrigin(screenW, screenH, scale);
    const slideX = perkMenuPanelSlideX(this._timelineMs, { width: this._layout.panelSize.x });

    const click = InputState.wasMouseButtonPressed(0);

    const masterOwned = int(ctx.player.perkCounts[int(PerkId.PERK_MASTER)]) > 0;
    const expertOwned = int(ctx.player.perkCounts[int(PerkId.PERK_EXPERT)]) > 0;
    const computed = perkMenuComputeLayout(this._layout, { screenW: screenW, origin: origin, scale: scale, choiceCount: choices.length, expertOwned: expertOwned, masterOwned: masterOwned, panelSlideX: slideX });

    const preserveBugs = ctx.preserveBugs;
    for (const [idx, perkId] of choices.entries()) {
      const label = perkDisplayName(perkId, { violenceDisabled: int(ctx.violenceDisabled), preserveBugs: preserveBugs });
      const itemPos = computed.listPos.offset({ dy: idx * computed.listStepY });
      const rect = menuItemHitRect(ctx.resources, label, { pos: itemPos, scale: scale });
      if (rect.contains(ctx.mouse)) {
        this._selectedIndex = idx;
        if (click) {
          if (ctx.playSfx !== null) {
            ctx.playSfx(SfxId.UI_BUTTONCLICK);
          }
          this.close();
          return int(idx);
        }
        break;
      }
    }

    const cancelW = buttonWidth(ctx.resources, this._cancelButton.label, { scale: scale, forceWide: this._cancelButton.forceWide });
    if (buttonUpdate(this._cancelButton, { pos: computed.cancelPos, width: cancelW, dtMs: dtUiMs, mouse: ctx.mouse, click: click })) {
      if (ctx.playSfx !== null) {
        ctx.playSfx(SfxId.UI_BUTTONCLICK);
      }
      this.close();
      return null;
    }

    if (InputState.wasKeyPressed(13) || InputState.wasKeyPressed(32)) {
      if (ctx.playSfx !== null) {
        ctx.playSfx(SfxId.UI_BUTTONCLICK);
      }
      this.close();
      return int(this._selectedIndex);
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

    const masterOwned = int(ctx.player.perkCounts[int(PerkId.PERK_MASTER)]) > 0;
    const expertOwned = int(ctx.player.perkCounts[int(PerkId.PERK_EXPERT)]) > 0;
    const computed = perkMenuComputeLayout(this._layout, { screenW: screenW, origin: origin, scale: scale, choiceCount: choices.length, expertOwned: expertOwned, masterOwned: masterOwned, panelSlideX: slideX });

    const panelTex = ctx.resources.texture(TextureId.UI_MENU_PANEL);
    drawClassicMenuPanel(panelTex, { dst: computed.panel.toRl(), shadow: ctx.fxDetail });

    const titleTex = ctx.resources.texture(TextureId.UI_TEXT_PICK_A_PERK);
    const src = wgl.makeRectangle(0.0, 0.0, titleTex.width, titleTex.height);
    wgl.drawTexturePro(titleTex, src, computed.title.toRl(), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    let sponsor = null;
    if (masterOwned) {
      sponsor = 'extra perks sponsored by the Perk Master';
    } else if (expertOwned) {
      sponsor = 'extra perk sponsored by the Perk Expert';
    }
    if (sponsor) {
      drawUiText(ctx.resources, sponsor, computed.sponsorPos, { scale: scale, color: UI_SPONSOR_COLOR });
    }

    const preserveBugs = ctx.preserveBugs;
    for (const [idx, perkId] of choices.entries()) {
      const label = perkDisplayName(perkId, { violenceDisabled: int(ctx.violenceDisabled), preserveBugs: preserveBugs });
      const itemPos = computed.listPos.offset({ dy: idx * computed.listStepY });
      const rect = menuItemHitRect(ctx.resources, label, { pos: itemPos, scale: scale });
      const hovered = rect.contains(ctx.mouse) || (idx === this._selectedIndex);
      drawMenuItem(ctx.resources, label, { pos: itemPos, scale: scale, hovered: hovered });
    }

    const selected = choices[this._selectedIndex];
    let desc = perkDisplayDescription(selected, { violenceDisabled: int(ctx.violenceDisabled), preserveBugs: preserveBugs });
    desc = this._prewrappedPerkDesc(selected, ctx.resources.smallFont, { violenceDisabled: int(ctx.violenceDisabled), preserveBugs: preserveBugs });
    drawUiText(
      ctx.resources,
      desc,
      computed.desc.topLeft,
      { scale: scale, color: UI_TEXT_COLOR },
    );

    const cancelW = buttonWidth(ctx.resources, this._cancelButton.label, { scale: scale, forceWide: this._cancelButton.forceWide });
    buttonDraw(
      ctx.resources,
      this._cancelButton,
      { pos: computed.cancelPos, width: cancelW, scale: scale },
    );
  }
}
