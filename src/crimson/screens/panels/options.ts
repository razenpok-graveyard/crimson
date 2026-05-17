// Port of crimson/screens/panels/options.py

import { TextureId } from '@grim/assets.ts';
import { setMusicVolume, setSfxVolume } from '@grim/audio.ts';
import { applyDetailPreset } from '@grim/config.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Rect, Vec2 } from '@grim/geom.ts';
import type { rl } from '@grim/raylib-api.ts';
import { InputState } from '@grim/input.ts';
import type { GameState } from '@crimson/game/types.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import { MENU_LABEL_ROW_HEIGHT, MENU_LABEL_ROW_OPTIONS, MENU_PANEL_WIDTH, drawMenuCursorHelper, uiElementAnim } from '@crimson/screens/menu.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS, PanelMenuView } from '@crimson/screens/panels/base.ts';
import { mouseInsideRectWithPadding } from '@crimson/screens/panels/hit-test.ts';
import * as wgl from '@wgl';

export class SliderState {
  value: number;
  minValue: number;
  maxValue: number;

  constructor(opts: {
    value: number;
    minValue: number;
    maxValue: number;
  }) {
    this.value = opts.value;
    this.minValue = opts.minValue;
    this.maxValue = opts.maxValue;
  }
}

export class OptionsContentLayout {
  readonly scale: number;
  readonly basePos: Vec2;
  readonly labelPos: Vec2;
  readonly sliderPos: Vec2;

  constructor(opts: {
    scale: number;
    basePos: Vec2;
    labelPos: Vec2;
    sliderPos: Vec2;
  }) {
    this.scale = opts.scale;
    this.basePos = opts.basePos;
    this.labelPos = opts.labelPos;
    this.sliderPos = opts.sliderPos;
  }
}

export class OptionsMenuView extends PanelMenuView {
  protected _LABELS: string[] = [
    'Sound volume:',
    'Music volume:',
    'Graphics detail:',
    'Mouse sensitivity:',
  ];
  protected _controlsButton: UiButtonState;
  protected _sliderSfx: SliderState;
  protected _sliderMusic: SliderState;
  protected _sliderDetail: SliderState;
  protected _sliderMouse: SliderState;
  protected _uiInfoTexts: boolean;
  protected _activeSlider: string | null;
  protected _dirty: boolean;

  get LABELS(): string[] {
    return this._LABELS;
  }
  get controlsButton(): UiButtonState {
    return this._controlsButton;
  }
  get sliderSfx(): SliderState {
    return this._sliderSfx;
  }
  get sliderMusic(): SliderState {
    return this._sliderMusic;
  }
  get sliderDetail(): SliderState {
    return this._sliderDetail;
  }
  get sliderMouse(): SliderState {
    return this._sliderMouse;
  }
  get uiInfoTexts(): boolean {
    return this._uiInfoTexts;
  }
  get activeSlider(): string | null {
    return this._activeSlider;
  }
  get dirty(): boolean {
    return this._dirty;
  }

  constructor(state: GameState) {
    super(state, { title: 'Options', backAction: 'open_pause_menu' });
    this._controlsButton = new UiButtonState({ label: 'Controls', forceWide: true });
    this._sliderSfx = new SliderState({ value: 10, minValue: 0, maxValue: 10 });
    this._sliderMusic = new SliderState({ value: 10, minValue: 0, maxValue: 10 });
    this._sliderDetail = new SliderState({ value: 5, minValue: 1, maxValue: 5 });
    this._sliderMouse = new SliderState({ value: 10, minValue: 1, maxValue: 10 });
    this._uiInfoTexts = true;
    this._activeSlider = null;
    this._dirty = false;
  }

  open(): void {
    super.open();
    this._controlsButton = new UiButtonState({ label: 'Controls', forceWide: true });
    this._activeSlider = null;
    this._dirty = false;
    this._syncFromConfig();
  }

  update(dt: number): void {
    super.update(dt);
    if (this._closing) {
      return;
    }
    const entry = this._entry;
    if (entry === null || !this._entryEnabled(entry)) {
      return;
    }

    const config = this.state.config;
    const layout = this._contentLayout();
    const basePos = layout.basePos;
    const labelPos = layout.labelPos;
    const sliderPos = layout.sliderPos;
    const scale = layout.scale;

    let resources = requireRuntimeResources(this.state);
    const rectOn = resources.texture(TextureId.UI_RECT_ON);
    const rectOff = resources.texture(TextureId.UI_RECT_OFF);

    if (this._updateSlider('sfx', this._sliderSfx, sliderPos.offset({ dy: 47.0 * scale }), rectOn, rectOff, scale)) {
      config.audio.sfxVolume = this._sliderSfx.value * 0.1;
      setSfxVolume(this.state.audio, config.audio.sfxVolume);
      this._dirty = true;
    }

    if (this._updateSlider('music', this._sliderMusic, sliderPos.offset({ dy: 67.0 * scale }), rectOn, rectOff, scale)) {
      config.audio.musicVolume = this._sliderMusic.value * 0.1;
      setMusicVolume(this.state.audio, config.audio.musicVolume);
      this._dirty = true;
    }

    if (this._updateSlider('detail', this._sliderDetail, sliderPos.offset({ dy: 87.0 * scale }), rectOn, rectOff, scale)) {
      const preset = applyDetailPreset(config, this._sliderDetail.value);
      this._sliderDetail.value = preset;
      this._dirty = true;
    }

    if (this._updateSlider('mouse', this._sliderMouse, sliderPos.offset({ dy: 107.0 * scale }), rectOn, rectOff, scale)) {
      let sensitivity = this._sliderMouse.value * 0.1;
      if (sensitivity < 0.1) {
        sensitivity = 0.1;
      }
      if (sensitivity > 1.0) {
        sensitivity = 1.0;
      }
      config.display.mouseSensitivity = sensitivity;
      this._dirty = true;
    }

    if (this._updateCheckbox(labelPos.offset({ dy: 135.0 * scale }), scale)) {
      config.gameplay.showInfoTexts = this._uiInfoTexts;
      this._dirty = true;
    }

    // `sub_4475d0`: controls button is aligned with the panel content base.
    const controlsPos = basePos.offset({ dy: 155.0 * scale });
    const dtMs = Math.min(dt, 0.1) * 1000.0;
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);
    resources = requireRuntimeResources(this.state);
    const width = buttonWidth(resources, this._controlsButton.label, { scale: scale, forceWide: this._controlsButton.forceWide });
    if (buttonUpdate(this._controlsButton, { pos: controlsPos, width: width, dtMs: dtMs, mouse: mouse, click: click })) {
      this._beginCloseTransition('open_controls');
    }
  }

  draw(): void {
    this._assertOpen();
    this._drawBackground();
    drawScreenFade(this.state);
    const entry = this._entry;
    if (!(entry !== null)) throw new Error('OptionsMenuView entry must be initialized before draw()');
    this._drawPanel();
    this._drawEntry(entry);
    this._drawSign();
    this._drawOptionsContents();
    drawMenuCursorHelper(
      this.state,
      { resources: requireRuntimeResources(this.state), pulseTime: this._cursorPulseTime },
    );
  }

  protected _beginCloseTransition(action: string): void {
    if (this._dirty) {
      let _trySucceeded150 = false;
      try {
        this.state.config.save();
        _trySucceeded150 = true;
      } catch (exc) {
        this.state.console.log.log(`config: save failed: ${exc instanceof Error ? exc.message : String(exc)}`);
      }
      if (_trySucceeded150) {
        this._dirty = false;
      }
    }
    super._beginCloseTransition(action);
  }

  protected _syncFromConfig(): void {
    const config = this.state.config;
    this._uiInfoTexts = config.gameplay.showInfoTexts;

    const sfxVolume = config.audio.sfxVolume;
    const musicVolume = config.audio.musicVolume;
    let detailPreset = config.display.detailPreset;
    const mouseSensitivity = config.display.mouseSensitivity;

    this._sliderSfx.value = Math.max(this._sliderSfx.minValue, Math.min(this._sliderSfx.maxValue, int(sfxVolume * 10.0)));
    this._sliderMusic.value = Math.max(this._sliderMusic.minValue, Math.min(this._sliderMusic.maxValue, int(musicVolume * 10.0)));
    if (detailPreset < this._sliderDetail.minValue) {
      detailPreset = this._sliderDetail.minValue;
    }
    if (detailPreset > this._sliderDetail.maxValue) {
      detailPreset = this._sliderDetail.maxValue;
    }
    this._sliderDetail.value = detailPreset;
    this._sliderMouse.value = Math.max(this._sliderMouse.minValue, Math.min(this._sliderMouse.maxValue, int(mouseSensitivity * 10.0 + 0.5)));
  }

  protected _contentLayout(): OptionsContentLayout {
    const [panelScale, localShift] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [angleRad, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW });
    const panelTopLeft = (new Vec2(this._panelPos.x + slideX, this._panelPos.y + this._widescreenYShift).add(this._panelOffset.mul(panelScale)));
    const basePos = panelTopLeft.add(new Vec2(212.0 * panelScale, 40.0 * panelScale));
    // `sub_4475d0`: title label is anchored at panel_top + 40.
    const labelPos = basePos.offset({ dx: 8.0 * panelScale });
    const sliderPos = labelPos.offset({ dx: 130.0 * panelScale });
    return new OptionsContentLayout({ basePos: basePos, labelPos: labelPos, sliderPos: sliderPos, scale: panelScale });
  }

  protected _updateSlider(sliderId: string, slider: SliderState, pos: Vec2, rectOn: rl.Texture, rectOff: rl.Texture, scale: number): boolean {
    const rectW = rectOn.width * scale;
    const rectH = rectOn.height * scale;
    if (rectW <= 0.0 || rectH <= 0.0) {
      return false;
    }
    const barW = rectW * slider.maxValue;
    const mousePos = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
    const hovered = mouseInsideRectWithPadding(mousePos, { pos: pos, width: barW, height: 18.0 * scale, leftPad: 3.0 * scale, topPad: 1.0 * scale });

    let changed = false;
    if (hovered) {
      if (InputState.wasKeyPressed(37)) {
        slider.value = Math.max(slider.minValue, slider.value - 1);
        changed = true;
      }
      if (InputState.wasKeyPressed(39)) {
        slider.value = Math.min(slider.maxValue, slider.value + 1);
        changed = true;
      }
    }
    const mouseDown = InputState.isMouseButtonDown(0);
    if (hovered && InputState.wasMouseButtonPressed(0)) {
      this._activeSlider = sliderId;
    }
    let idx: number;
    if (this._activeSlider === sliderId && mouseDown) {
      const relative = mousePos.x - pos.x;
      idx = int(Math.floor(relative / rectW)) + 1;
      if (idx < slider.minValue) {
        idx = slider.minValue;
      }
      if (idx > slider.maxValue) {
        idx = slider.maxValue;
      }
      if (slider.value !== idx) {
        slider.value = idx;
        changed = true;
      }
    }
    if (this._activeSlider === sliderId && !mouseDown) {
      this._activeSlider = null;
    }

    return changed;
  }

  protected _updateCheckbox(pos: Vec2, scale: number): boolean {
    const resources = requireRuntimeResources(this.state);
    const checkOn = resources.texture(TextureId.UI_CHECK_ON);
    const font = resources.smallFont;
    const textScale = 1.0 * scale;
    const label = 'UI Info texts';
    const labelW = measureSmallTextWidth(font, label);
    const rectW = checkOn.width * scale + 6.0 * scale + labelW;
    const rectH = Math.max(checkOn.height * scale, font.cellSize * textScale);
    const mousePos = Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
    const hovered = Rect.fromTopLeft(pos, rectW, rectH).contains(mousePos);
    if (hovered && InputState.wasMouseButtonPressed(0)) {
      this._uiInfoTexts = !this._uiInfoTexts;
      return true;
    }
    return false;
  }

  protected _drawOptionsContents(): void {
    const resources = requireRuntimeResources(this.state);
    const labelsTex = resources.texture(TextureId.UI_ITEM_TEXTS);
    const layout = this._contentLayout();
    const basePos = layout.basePos;
    const labelPos = layout.labelPos;
    const sliderPos = layout.sliderPos;
    const scale = layout.scale;

    const font = resources.smallFont;
    const textColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.8) / 255);

    const titleW = 128.0;
    const src = wgl.makeRectangle(0.0, MENU_LABEL_ROW_OPTIONS * MENU_LABEL_ROW_HEIGHT, titleW, MENU_LABEL_ROW_HEIGHT);
    const dst = wgl.makeRectangle(basePos.x, basePos.y, titleW * scale, MENU_LABEL_ROW_HEIGHT * scale);
    wgl.drawTexturePro(labelsTex, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));

    const yOffsets: [number, number, number, number] = [47.0, 67.0, 87.0, 107.0];
    const _zip312_0 = Array.from(this._LABELS);
    const _zip312_1 = Array.from(yOffsets);
    for (let _zipIndex312 = 0; _zipIndex312 < Math.min(_zip312_0.length, _zip312_1.length); _zipIndex312++) {
      let label = _zip312_0[_zipIndex312];
      let offset = _zip312_1[_zipIndex312];
      drawSmallText(font, label, labelPos.offset({ dy: offset * scale }), textColor);
    }

    const rectOn = resources.texture(TextureId.UI_RECT_ON);
    const rectOff = resources.texture(TextureId.UI_RECT_OFF);
    const rectW = rectOn.width * scale;
    const rectH = rectOn.height * scale;

    this._drawSlider(this._sliderSfx, sliderPos.offset({ dy: 47.0 * scale }), rectOn, rectOff, rectW, rectH);
    this._drawSlider(this._sliderMusic, sliderPos.offset({ dy: 67.0 * scale }), rectOn, rectOff, rectW, rectH);
    this._drawSlider(this._sliderDetail, sliderPos.offset({ dy: 87.0 * scale }), rectOn, rectOff, rectW, rectH);
    this._drawSlider(this._sliderMouse, sliderPos.offset({ dy: 107.0 * scale }), rectOn, rectOff, rectW, rectH);

    const checkTex = this._uiInfoTexts ? resources.texture(TextureId.UI_CHECK_ON) : resources.texture(TextureId.UI_CHECK_OFF);
    const checkW = checkTex.width * scale;
    const checkH = checkTex.height * scale;
    const checkPos = labelPos.offset({ dy: 135.0 * scale });
    wgl.drawTexturePro(checkTex, wgl.makeRectangle(0.0, 0.0, checkTex.width, checkTex.height), wgl.makeRectangle(checkPos.x, checkPos.y, checkW, checkH), wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
    drawSmallText(font, 'UI Info texts', checkPos.add(new Vec2(checkW + 6.0 * scale, 1.0 * scale)), textColor);

    const buttonPos = basePos.offset({ dy: 155.0 * scale });
    const buttonW = buttonWidth(resources, this._controlsButton.label, { scale: scale, forceWide: this._controlsButton.forceWide });
    buttonDraw(
      resources,
      this._controlsButton,
      { pos: buttonPos, width: buttonW, scale: scale },
    );
  }

  protected _drawSlider(slider: SliderState, pos: Vec2, rectOn: rl.Texture, rectOff: rl.Texture, rectW: number, rectH: number): void {
    for (let idx = 0; idx < slider.maxValue; idx++) {
      const tex = idx < slider.value ? rectOn : rectOff;
      const dst = wgl.makeRectangle(pos.x + idx * rectW, pos.y, rectW, rectH);
      const tint = idx < slider.value ? wgl.makeColor(1, 1, 1, 1) : wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(255 * 0.5) / 255);
      wgl.drawTexturePro(tex, wgl.makeRectangle(0.0, 0.0, tex.width, tex.height), dst, wgl.makeVector2(0.0, 0.0), 0.0, tint);
    }
  }
}
