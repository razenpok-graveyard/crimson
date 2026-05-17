// Port of crimson/debug_views/spawn_plan.py

import type { SmallFontData } from '@grim/fonts/small.ts';
import { loadSmallFont, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { Crand } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import type { View, ViewContext } from '@grim/view.ts';
import { SPAWN_TEMPLATES, CreatureTypeId, SpawnEnv, SpawnSlotInit, UnsupportedSpawnTemplateError, buildSpawnPlan, spawnIdLabel, tickSpawnSlot } from '@crimson/creatures/spawn.ts';
import { drawUiText, uiLineHeight } from '@crimson/debug-views/ui-helpers.ts';
import { registerView } from '@crimson/debug-views/registry.ts';
import * as wgl from '@wgl';

export const BASE_POS = new Vec2(512.0, 512.0);
export const UI_TEXT_SCALE = 1;
export const UI_TEXT_COLOR = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 255 / 255);
export const UI_HINT_COLOR = wgl.makeColor(140 / 255, 140 / 255, 140 / 255, 255 / 255);
export const UI_ERROR_COLOR = wgl.makeColor(240 / 255, 80 / 255, 80 / 255, 255 / 255);
export const BG_COLOR = wgl.makeColor(12 / 255, 12 / 255, 14 / 255, 255 / 255);
export const GRID_COLOR = wgl.makeColor(40 / 255, 40 / 255, 48 / 255, 255 / 255);
export const LINK_COLOR = wgl.makeColor(80 / 255, 160 / 255, 255 / 255, 120 / 255);
export const OFFSET_COLOR = wgl.makeColor(255 / 255, 200 / 255, 80 / 255, 140 / 255);

function pythonCompareKeys(left: any, right: any): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const item = pythonCompareKeys(left[index], right[index]);
      if (item !== 0) {
        return item;
      }
    }
    return left.length - right.length;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export class PlanSummary {
  readonly creatureCount: number;
  readonly spawnSlotCount: number;
  readonly effectCount: number;
  readonly primaryIdx: number;

  constructor(opts: {
    creatureCount: number;
    spawnSlotCount: number;
    effectCount: number;
    primaryIdx: number;
  }) {
    this.creatureCount = opts.creatureCount;
    this.spawnSlotCount = opts.spawnSlotCount;
    this.effectCount = opts.effectCount;
    this.primaryIdx = opts.primaryIdx;
  }
}

export class SpawnPlanView {
  protected _assetsRoot: string;
  protected _missingAssets: string[];
  protected _small: SmallFontData | null;
  protected _templateIds: any[];
  protected _index: number;
  protected _seed: number;
  protected _worldScale: number;
  protected _hardcore: boolean;
  protected _questFailRetryCount: number;
  protected _demoModeActive: boolean;
  protected _plan: any;
  protected _planSummary: PlanSummary | null;
  protected _error: any;
  protected _simRunning: boolean;
  protected _simTime: number;
  protected _simSlots: SpawnSlotInit[];
  protected _simEvents: string[];

  constructor(ctx: ViewContext) {
    this._assetsRoot = ctx.assetsDir;
    this._missingAssets = [];
    this._small = null;

    this._templateIds = Array.from(SPAWN_TEMPLATES).sort((left, right) => pythonCompareKeys(left.spawnId, right.spawnId)).map((t) => t.spawnId);
    this._index = 0;

    this._seed = 0xBEEF;
    this._worldScale = 1.0;
    this._hardcore = false;
    this._questFailRetryCount = 0;
    this._demoModeActive = true;

    this._plan = null;
    this._planSummary = null;
    this._error = null;

    this._simRunning = false;
    this._simTime = 0.0;
    this._simSlots = [];
    this._simEvents = [];

    this._rebuildPlan();
  }

  open(): void {
    this._missingAssets.length = 0;
    this._small = loadSmallFont(this._assetsRoot);
  }

  close(): void {
    if (this._small !== null) {
      this._small = null;
    }
  }

  protected _drawUiLabel(label: string, value: string, pos: Vec2): void {
    const labelText = `${label}: `;
    drawUiText(this._small, labelText, pos, { scale: UI_TEXT_SCALE, color: UI_HINT_COLOR });
    const labelW = this._small ? measureSmallTextWidth(this._small, labelText) : 0.0;
    drawUiText(this._small, value, new Vec2(pos.x + labelW, pos.y), { scale: UI_TEXT_SCALE, color: UI_TEXT_COLOR });
  }

  protected _rebuildPlan(): void {
    const spawnId = this._templateIds[this._index];
    const rng = new Crand(this._seed);
    const env = new SpawnEnv({ terrainWidth: 1024.0, terrainHeight: 1024.0, demoModeActive: this._demoModeActive, hardcore: this._hardcore, questFailRetryCount: this._questFailRetryCount });
    try {
      this._plan = buildSpawnPlan(spawnId, BASE_POS, 0.0, rng, env);
      this._planSummary = new PlanSummary({ creatureCount: this._plan.creatures.length, spawnSlotCount: this._plan.spawnSlots.length, effectCount: this._plan.effects.length, primaryIdx: this._plan.primary });
      this._resetSim();
      this._error = null;
    } catch (exc) {
      if (!(exc instanceof UnsupportedSpawnTemplateError)) {
        throw exc;
      }
      this._plan = null;
      this._planSummary = null;
      this._error = String(exc);
      this._resetSim();
    }
  }

  protected _resetSim(): void {
    this._simRunning = false;
    this._simTime = 0.0;
    this._simEvents.length = 0;
    this._simSlots = [];
    if (this._plan === null) {
      return;
    }
    for (const slot of this._plan.spawnSlots) {
      this._simSlots.push(new SpawnSlotInit({ ownerCreature: slot.ownerCreature, timer: slot.timer, count: slot.count, limit: slot.limit, interval: slot.interval, childTemplateId: slot.childTemplateId }));
    }
  }

  protected _advanceTemplate(delta: number): void {
    if (this._templateIds.length === 0) {
      return;
    }
    this._index = ((this._index + delta) + this._templateIds.length) % this._templateIds.length;
    this._rebuildPlan();
  }

  protected _adjustSeed(delta: number): void {
    this._seed = ((this._seed + delta) >>> 0);
    this._rebuildPlan();
  }

  protected _adjustScale(delta: number): void {
    this._worldScale = Math.max(0.1, Math.min(4.0, this._worldScale + delta));
  }

  protected _toggleHardcore(): void {
    this._hardcore = !this._hardcore;
    this._rebuildPlan();
  }

  protected _toggleDemoMode(): void {
    this._demoModeActive = !this._demoModeActive;
    this._rebuildPlan();
  }

  protected _adjustQuestFailRetryCount(delta: number): void {
    this._questFailRetryCount = Math.max(0, Math.min(5, this._questFailRetryCount + delta));
    this._rebuildPlan();
  }

  update(dt: number): void {
    if (InputState.wasKeyPressed(39)) {
      this._advanceTemplate(1);
    }
    if (InputState.wasKeyPressed(37)) {
      this._advanceTemplate(-1);
    }

    if (InputState.wasKeyPressed(38)) {
      this._adjustSeed(1);
    }
    if (InputState.wasKeyPressed(40)) {
      this._adjustSeed(-1);
    }
    if (InputState.wasKeyPressed(82)) {
      this._seed = wgl.getRandomValue(0, 0x7FFFFFFF);
      this._rebuildPlan();
    }

    if (InputState.wasKeyPressed(219)) {
      this._adjustScale(-0.1);
    }
    if (InputState.wasKeyPressed(221)) {
      this._adjustScale(0.1);
    }

    if (InputState.wasKeyPressed(72)) {
      this._toggleHardcore();
    }
    if (InputState.wasKeyPressed(68)) {
      this._toggleDemoMode();
    }
    if (InputState.wasKeyPressed(188)) {
      this._adjustQuestFailRetryCount(-1);
    }
    if (InputState.wasKeyPressed(190)) {
      this._adjustQuestFailRetryCount(1);
    }

    if (InputState.wasKeyPressed(32)) {
      this._simRunning = !this._simRunning;
    }
    if (InputState.wasKeyPressed(8)) {
      this._resetSim();
    }

    if (this._simRunning && this._simSlots.length > 0) {
      const simDt = Math.min(Math.max(0.0, dt), 0.1);
      this._simTime += simDt;
      for (const [idx, slot] of this._simSlots.entries()) {
        const childTemplateId = tickSpawnSlot(slot, simDt);
        if (childTemplateId === null) {
          continue;
        }
        this._simEvents.push(`t=${this._simTime.toFixed(2).padStart(6, ' ')}  slot=${String(idx).padStart(2, '0')}  spawn=0x${Math.trunc(childTemplateId).toString(16).padStart(2, '0')} (${spawnIdLabel(childTemplateId)})`);
      }
      if (this._simEvents.length > 12) {
        this._simEvents = this._simEvents.slice(-12);
      }
    }
  }

  protected _worldToScreen(pos: Vec2): Vec2 {
    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    return new Vec2(screenW * 0.5 + (pos.x - BASE_POS.x) * this._worldScale, screenH * 0.5 + (pos.y - BASE_POS.y) * this._worldScale);
  }

  protected _drawGrid(): void {
    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const step = int(64 * this._worldScale);
    if (step < 24) {
      return;
    }
    let x = 0;
    while (x < screenW) {
      wgl.drawLine(x, 0, x, screenH, GRID_COLOR);
      x += step;
    }
    let y = 0;
    while (y < screenH) {
      wgl.drawLine(0, y, screenW, y, GRID_COLOR);
      y += step;
    }
  }

  draw(): void {
    wgl.clearBackground(BG_COLOR);
    this._drawGrid();

    const margin = 16.0;
    const lineH = uiLineHeight(this._small, { scale: UI_TEXT_SCALE });

    const spawnId = this._templateIds.length > 0 ? this._templateIds[this._index] : 0;
    drawUiText(
      this._small,
      `spawn-plan view  (template 0x${Math.trunc(spawnId).toString(16).padStart(2, '0')})`,
      new Vec2(margin, margin),
      { scale: 0.8, color: UI_TEXT_COLOR },
    );
    const hints = 'Left/Right: id  Up/Down: seed  R: random seed  [,]: scale  H: hardcore  D: demo-mode  ,/.: retry-count  Space: sim  Backspace: reset';
    drawUiText(this._small, hints, new Vec2(margin, margin + lineH), { scale: UI_TEXT_SCALE, color: UI_HINT_COLOR });

    let y = margin + lineH * 2.0 + 4.0;
    this._drawUiLabel('seed', `0x${Math.trunc(this._seed).toString(16).padStart(8, '0')}`, new Vec2(margin, y));
    y += lineH;
    this._drawUiLabel('world_scale', `${this._worldScale.toFixed(2)}`, new Vec2(margin, y));
    y += lineH;
    this._drawUiLabel('hardcore', String(this._hardcore), new Vec2(margin, y));
    y += lineH;
    this._drawUiLabel('retry_count', String(this._questFailRetryCount), new Vec2(margin, y));
    y += lineH;
    this._drawUiLabel('demo_mode_active', String(this._demoModeActive), new Vec2(margin, y));
    y += lineH;

    if (this._error !== null) {
      drawUiText(this._small, this._error, new Vec2(margin, y + 6.0), { scale: UI_TEXT_SCALE, color: UI_ERROR_COLOR });
      return;
    }
    if (this._plan === null || this._planSummary === null) {
      drawUiText(this._small, 'No plan.', new Vec2(margin, y + 6.0), { scale: UI_TEXT_SCALE, color: UI_ERROR_COLOR });
      return;
    }

    const summary = this._planSummary;
    this._drawUiLabel('plan', `creatures=${summary.creatureCount}  slots=${summary.spawnSlotCount}  effects=${summary.effectCount}  primary=${summary.primaryIdx}`, new Vec2(margin, y));
    y += lineH;
    const simState = this._simRunning ? 'running' : 'paused';
    this._drawUiLabel('sim', `${simState}  t=${this._simTime.toFixed(2)}s`, new Vec2(margin, y));
    y += lineH;
    for (const [idx, slot] of this._simSlots.slice(0, 3).entries()) {
      this._drawUiLabel(`slot${String(idx).padStart(2, '0')}`, `timer=${slot.timer.toFixed(2).padStart(5, ' ')} count=${String(slot.count).padStart(3, ' ')}/${String(slot.limit).padEnd(3, ' ')} interval=${slot.interval.toFixed(2).padStart(5, ' ')} child=0x${Math.trunc(slot.childTemplateId).toString(16).padStart(2, '0')}`, new Vec2(margin, y));
      y += lineH;
    }
    if (this._simEvents.length > 0) {
      drawUiText(this._small, 'events:', new Vec2(margin, y + 2.0), { scale: UI_TEXT_SCALE, color: UI_HINT_COLOR });
      y += lineH;
      for (const ev of this._simEvents.slice(-5)) {
        drawUiText(this._small, ev, new Vec2(margin, y), { scale: UI_TEXT_SCALE, color: UI_TEXT_COLOR });
        y += lineH;
      }
    }

    // Link lines.
    for (const c of this._plan.creatures) {
      if (c.aiLinkParent === null) {
        continue;
      }
      if (!(c.aiLinkParent >= 0 && c.aiLinkParent < this._plan.creatures.length)) {
        continue;
      }
      const p = this._plan.creatures[c.aiLinkParent];
      const childScreen = this._worldToScreen(c.pos);
      const parentScreen = this._worldToScreen(p.pos);
      wgl.drawLineEx(childScreen.toRl(), parentScreen.toRl(), 2.0, LINK_COLOR);
    }

    // Offset hints.
    for (const c of this._plan.creatures) {
      if (c.targetOffset === null) {
        continue;
      }
      const originScreen = this._worldToScreen(c.pos);
      const targetScreen = this._worldToScreen(c.pos.add(c.targetOffset));
      wgl.drawLineEx(originScreen.toRl(), targetScreen.toRl(), 2.0, OFFSET_COLOR);
      wgl.drawCircleLines(int(targetScreen.x), int(targetScreen.y), Math.max(2.0, 4.0 * this._worldScale), OFFSET_COLOR);
    }

    // Creature dots.
    for (const [idx, c] of this._plan.creatures.entries()) {
      const screenPos = this._worldToScreen(c.pos);
      let radius = Math.max(3.0, 6.0 * Math.sqrt(Math.max(1.0, (c.size || 50.0) / 50.0)));
      radius = Math.min(radius, 24.0);
      const color = typeColor(c.typeId);
      wgl.drawCircle(int(screenPos.x), int(screenPos.y), radius, color);
      if (idx === summary.primaryIdx) {
        wgl.drawCircleLines(int(screenPos.x), int(screenPos.y), radius + 2.0, wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 200 / 255));
      }
    }

    // Spawn-slot owners.
    for (const slot of this._plan.spawnSlots) {
      if (!(slot.ownerCreature >= 0 && slot.ownerCreature < this._plan.creatures.length)) {
        continue;
      }
      const owner = this._plan.creatures[slot.ownerCreature];
      const ownerScreen = this._worldToScreen(owner.pos);
      wgl.drawCircleLines(int(ownerScreen.x), int(ownerScreen.y), Math.max(8.0, 12.0 * this._worldScale), wgl.makeColor(120 / 255, 255 / 255, 180 / 255, 200 / 255));
    }
  }
}

function typeColor(typeId: CreatureTypeId | null): wgl.Color {
  if (typeId === CreatureTypeId.ZOMBIE) {
    return wgl.makeColor(120 / 255, 220 / 255, 120 / 255, 255 / 255);
  }
  if (typeId === CreatureTypeId.LIZARD) {
    return wgl.makeColor(120 / 255, 160 / 255, 255 / 255, 255 / 255);
  }
  if (typeId === CreatureTypeId.ALIEN) {
    return wgl.makeColor(200 / 255, 140 / 255, 255 / 255, 255 / 255);
  }
  if (typeId === CreatureTypeId.SPIDER_SP1) {
    return wgl.makeColor(255 / 255, 120 / 255, 120 / 255, 255 / 255);
  }
  if (typeId === CreatureTypeId.SPIDER_SP2) {
    return wgl.makeColor(255 / 255, 160 / 255, 120 / 255, 255 / 255);
  }
  return wgl.makeColor(200 / 255, 200 / 255, 200 / 255, 255 / 255);
}

export const viewSpawnPlan = registerView('spawn-plan', 'Spawn plan')(function viewSpawnPlan(opts: { ctx: ViewContext }): View {
  const ctx = opts.ctx;
  return new SpawnPlanView(ctx);
});
