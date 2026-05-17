// Port of crimson/render/world/draw.py

import type { RuntimeResources } from '@grim/assets.ts';
import { TextureId } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import type { rl } from '@grim/raylib-api.ts';
import { CreatureFlags, CreatureTypeId } from '@crimson/creatures/spawn.ts';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { CREATURE_ANIM, CREATURE_ASSET } from '@crimson/sim/world-defs.ts';
import { drawAimCursor } from '@crimson/ui/cursor.ts';
import { drawBonusHoverLabels, drawBonusPickups } from '@crimson/render/world/bonuses.ts';
import { RAD_TO_DEG, monsterVisionFadeAlpha } from '@crimson/render/world/constants.ts';
import { WorldRenderCtx } from '@crimson/render/world/context.ts';
import { drawCreatureSprite } from '@crimson/render/world/creatures.ts';
import { drawEffectPool, drawParticlePool, drawSpriteEffectPool } from '@crimson/render/world/effects.ts';
import { drawAimCircle, drawClockGauge, drawDirectionArrows } from '@crimson/render/world/overlays.ts';
import { profilePass } from '@crimson/render/world/profile-hooks.ts';
import { drawProjectile, drawSecondaryProjectile, drawSharpshooterLaserSight } from '@crimson/render/world/projectiles.ts';
import { drawPlayerTrooperSprite } from '@crimson/render/world/trooper.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import * as wgl from '@wgl';
import * as viewport from '@crimson/render/world/viewport.ts';

type WorldToScreenWithFn = (arg0: Vec2, arg1: Vec2, arg2: Vec2) => Vec2;
type DrawAimCircleFn = (arg0: Vec2, arg1: number, arg2: number) => void;
type DrawClockGaugeFn = (arg0: Vec2, arg1: number, arg2: number, arg3: number) => void;

const CREATURE_TEXTURE_IDS: Map<string, TextureId> = new Map([
  ['alien', TextureId.ALIEN],
  ['lizard', TextureId.LIZARD],
  ['spider_sp1', TextureId.SPIDER_SP1],
  ['spider_sp2', TextureId.SPIDER_SP2],
  ['trooper', TextureId.TROOPER],
  ['zombie', TextureId.ZOMBIE],
]);
const NATIVE_CREATURE_SPRITE_DRAW_ORDER: readonly CreatureTypeId[] = [
  CreatureTypeId.ZOMBIE,
  CreatureTypeId.SPIDER_SP1,
  CreatureTypeId.SPIDER_SP2,
  CreatureTypeId.ALIEN,
  CreatureTypeId.LIZARD,
];

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export class WorldDrawContext {
  readonly camera: Vec2;
  readonly viewScale: Vec2;
  readonly scale: number;
  readonly entityAlpha: number;
  readonly trooperTexture: rl.Texture | null;
  readonly particlesTexture: rl.Texture | null;
  readonly monsterVision: boolean;
  readonly monsterVisionSrc: wgl.Rectangle | null;
  readonly poisonSrc: wgl.Rectangle | null;

  constructor(opts: {
    camera?: Vec2;
    viewScale?: Vec2;
    scale?: number;
    entityAlpha?: number;
    trooperTexture?: rl.Texture | null;
    particlesTexture?: rl.Texture | null;
    monsterVision?: boolean;
    monsterVisionSrc?: wgl.Rectangle | null;
    poisonSrc?: wgl.Rectangle | null;
  } = {}) {
    this.camera = opts.camera ?? new Vec2();
    this.viewScale = opts.viewScale ?? new Vec2(1.0, 1.0);
    this.scale = opts.scale ?? 1.0;
    this.entityAlpha = opts.entityAlpha ?? 1.0;
    this.trooperTexture = opts.trooperTexture ?? null;
    this.particlesTexture = opts.particlesTexture ?? null;
    this.monsterVision = opts.monsterVision ?? false;
    this.monsterVisionSrc = opts.monsterVisionSrc ?? null;
    this.poisonSrc = opts.poisonSrc ?? null;
  }
}

export function drawWorld(renderCtx: WorldRenderCtx, opts: { drawAimIndicators?: boolean; entityAlpha?: number } = {}): void {
  const drawAimIndicators = opts.drawAimIndicators ?? true;
  let entityAlpha = opts.entityAlpha ?? 1.0;
  entityAlpha = clamp(entityAlpha, 0.0, 1.0);
  const [camera, viewScale, scale, screenSize, outSize] = computeViewTransform(renderCtx);
  const _withExit78_0 = profilePass('background');
  try {
    drawBackground(renderCtx, { camera: camera, screenSize: screenSize, outSize: outSize });
  } finally {
    _withExit78_0();
  }
  if (entityAlpha <= 1e-3) {
    return;
  }

  let drawCtx: ReturnType<typeof buildDrawContext>;
  let _withExit91_0: ReturnType<typeof profilePass>;
  let _withExit93_0: ReturnType<typeof profilePass>;
  let _withExit95_0: ReturnType<typeof profilePass>;
  let _withExit97_0: ReturnType<typeof profilePass>;
  let _withExit99_0: ReturnType<typeof profilePass>;
  let _withExit101_0: ReturnType<typeof profilePass>;
  wgl.setAlphaTest(true);
  try {
    drawCtx = buildDrawContext(renderCtx, { camera: camera, viewScale: viewScale, scale: scale, entityAlpha: entityAlpha });
    _withExit91_0 = profilePass('players_dead');
    try {
      drawPlayers(renderCtx, { ctx: drawCtx, alive: false });
    } finally {
      _withExit91_0();
    }
    _withExit93_0 = profilePass('creatures');
    try {
      drawCreatures(renderCtx, { ctx: drawCtx });
    } finally {
      _withExit93_0();
    }
    _withExit95_0 = profilePass('freeze_overlay');
    try {
      drawFreezeOverlay(renderCtx, { ctx: drawCtx });
    } finally {
      _withExit95_0();
    }
    _withExit97_0 = profilePass('players_alive');
    try {
      drawPlayers(renderCtx, { ctx: drawCtx, alive: true });
    } finally {
      _withExit97_0();
    }
    _withExit99_0 = profilePass('projectiles_effects');
    try {
      drawProjectilesAndEffects(renderCtx, { ctx: drawCtx });
    } finally {
      _withExit99_0();
    }
    _withExit101_0 = profilePass('bonus_ui');
    try {
      drawBonusAndUi(renderCtx, { ctx: drawCtx, drawAimIndicatorsEnabled: drawAimIndicators });
    } finally {
      _withExit101_0();
    }
  } finally {
    wgl.setAlphaTest(false);
  }
}

function computeViewTransform(renderCtx: WorldRenderCtx): [Vec2, Vec2, number, Vec2, Vec2] {
  const frame = renderCtx.frame;
  const outW = wgl.getScreenWidth();
  const outH = wgl.getScreenHeight();
  const outSize = new Vec2(outW, outH);
  const [camera, viewScale, screenSize] = viewport.viewTransform({ worldSize: frame.worldSize, config: frame.config, camera: frame.camera, outSize: outSize });
  const scale = viewport.viewScaleAvg(viewScale);
  return [camera, viewScale, scale, screenSize, outSize];
}

function drawBackground(renderCtx: WorldRenderCtx, opts: { camera: Vec2; screenSize: Vec2; outSize: Vec2 }): void {
  const camera = opts.camera;
  const screenSize = opts.screenSize;
  const outSize = opts.outSize;
  const clearColor = wgl.makeColor(10 / 255, 10 / 255, 12 / 255, 255 / 255);
  const ground = renderCtx.frame.ground;
  if (!(ground !== null)) throw new Error('ground renderer must be initialized before live world draw');
  wgl.clearBackground(clearColor);
  ground.drawView(
    camera,
    { screenW: screenSize.x, screenH: screenSize.y, outW: outSize.x, outH: outSize.y },
  );
}

function effectSrcRect(texture: rl.Texture, effectId: EffectId): wgl.Rectangle | null {
  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(effectId)) ?? null;
  if (atlas === null) {
    return null;
  }
  const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode)) ?? null;
  if (!grid) {
    return null;
  }
  const frame = int(atlas.frame);
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  return wgl.makeRectangle(cellW * col, cellH * row, Math.max(0.0, cellW - 2.0), Math.max(0.0, cellH - 2.0));
}

function buildDrawContext(renderCtx: WorldRenderCtx, opts: { camera: Vec2; viewScale: Vec2; scale: number; entityAlpha: number }): WorldDrawContext {
  const camera = opts.camera;
  const viewScale = opts.viewScale;
  const scale = opts.scale;
  const entityAlpha = opts.entityAlpha;
  const frame = renderCtx.frame;
  const resources = frame.resources;
  const trooperAsset = CREATURE_ASSET.get(CreatureTypeId.TROOPER) ?? null;
  const trooperTexture = creatureTexture(resources, trooperAsset);
  const particlesTexture = resources.texture(TextureId.PARTICLES);

  const monsterVision = frame.players.length > 0 && perkActive(frame.players[0], PerkId.MONSTER_VISION);
  let monsterVisionSrc = null;
  if (monsterVision) {
    monsterVisionSrc = effectSrcRect(particlesTexture, EffectId.AURA);
  }

  // Native uses `effect_select_texture(0x10)` (EffectId.AURA) for creature overlays
  // (monster vision, shadow, poison aura).
  const poisonSrc = effectSrcRect(particlesTexture, EffectId.AURA);

  return new WorldDrawContext({ camera: camera, viewScale: viewScale, scale: scale, entityAlpha: entityAlpha, trooperTexture: trooperTexture, particlesTexture: particlesTexture, monsterVision: monsterVision, monsterVisionSrc: monsterVisionSrc, poisonSrc: poisonSrc });
}

function drawPlayer(renderCtx: WorldRenderCtx, player: PlayerState, opts: { ctx: WorldDrawContext }): void {
  const ctx = opts.ctx;
  if (ctx.trooperTexture !== null) {
    drawPlayerTrooperSprite(
      renderCtx,
      ctx.trooperTexture,
      player,
      { camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha },
    );
    return;
  }

  const screen = WorldRenderCtx._worldToScreenWith(player.pos, { camera: ctx.camera, viewScale: ctx.viewScale });
  const tint = wgl.makeColor(90 / 255, 190 / 255, 120 / 255, int(255 * ctx.entityAlpha + 0.5) / 255);
  wgl.drawCircle(int(screen.x), int(screen.y), Math.max(1.0, 14.0 * ctx.scale), tint);
}

function drawPlayers(renderCtx: WorldRenderCtx, opts: { ctx: WorldDrawContext; alive: boolean }): void {
  const ctx = opts.ctx;
  const alive = opts.alive;
  for (const player of renderCtx.frame.players) {
    if (alive && player.health <= 0.0) {
      continue;
    }
    if (!alive && player.health > 0.0) {
      continue;
    }
    drawPlayer(renderCtx, player, { ctx: ctx });
  }
}

function* iterActiveCreatureOverlayPass(creatures: readonly CreatureState[]): IterableIterator<CreatureState> {
  for (const creature of creatures) {
    if (creature.active) {
      yield creature;
    }
  }
}

function* iterNativeCreatureSpritePass(creatures: readonly CreatureState[]): IterableIterator<CreatureState> {
  for (const typeId of NATIVE_CREATURE_SPRITE_DRAW_ORDER) {
    for (const creature of creatures) {
      if (creature.active && creature.typeId === typeId) {
        yield creature;
      }
    }
  }
}

function drawCreatureOverlays(renderCtx: WorldRenderCtx, creature: CreatureState, opts: { screen: Vec2; lifecycleStage: number; ctx: WorldDrawContext }): void {
  const screen = opts.screen;
  const lifecycleStage = opts.lifecycleStage;
  const ctx = opts.ctx;
  const fade = monsterVisionFadeAlpha(lifecycleStage);
  let size: number;
  let dst: wgl.Rectangle;
  let origin: wgl.Vector2;
  let tint: wgl.Color;
  if (ctx.monsterVision && ctx.particlesTexture !== null && ctx.monsterVisionSrc !== null) {
    const mvAlpha = fade * ctx.entityAlpha;
    if (mvAlpha > 1e-3) {
      size = 90.0 * ctx.scale;
      dst = wgl.makeRectangle(screen.x, screen.y, size, size);
      origin = wgl.makeVector2(size * 0.5, size * 0.5);
      tint = wgl.makeColor(255 / 255, 255 / 255, 0 / 255, int(clamp(mvAlpha, 0.0, 1.0) * 255.0 + 0.5) / 255);
      wgl.drawTexturePro(ctx.particlesTexture, ctx.monsterVisionSrc, dst, origin, 0.0, tint);
    }
  }

  if (ctx.particlesTexture !== null && ctx.poisonSrc !== null && creature.plagueInfected) {
    // creature_render_all: collision_flag overlay (black 80x80 aura), drawn before red poison flag.
    const plagueAlpha = fade * ctx.entityAlpha;
    if (plagueAlpha > 1e-3) {
      size = 80.0 * ctx.scale;
      dst = wgl.makeRectangle(screen.x, screen.y, size, size);
      origin = wgl.makeVector2(size * 0.5, size * 0.5);
      tint = wgl.makeColor(0 / 255, 0 / 255, 0 / 255, int(clamp(plagueAlpha, 0.0, 1.0) * 255.0 + 0.5) / 255);
      wgl.drawTexturePro(ctx.particlesTexture, ctx.poisonSrc, dst, origin, 0.0, tint);
    }
  }

  if (ctx.particlesTexture !== null && ctx.poisonSrc !== null && (creature.flags & CreatureFlags.SELF_DAMAGE_TICK)) {
    const poisonAlpha = fade * ctx.entityAlpha;
    if (poisonAlpha > 1e-3) {
      size = 60.0 * ctx.scale;
      dst = wgl.makeRectangle(screen.x, screen.y, size, size);
      origin = wgl.makeVector2(size * 0.5, size * 0.5);
      tint = wgl.makeColor(255 / 255, 0 / 255, 0 / 255, int(clamp(poisonAlpha, 0.0, 1.0) * 255.0 + 0.5) / 255);
      wgl.drawTexturePro(ctx.particlesTexture, ctx.poisonSrc, dst, origin, 0.0, tint);
    }
  }
}

function drawCreatures(renderCtx: WorldRenderCtx, opts: { ctx: WorldDrawContext }): void {
  const ctx = opts.ctx;
  const frame = renderCtx.frame;
  const creatureEntries = frame.creatures.entries;

  // Native `creature_render_all` batches all overlays across the active pool
  // before any species-specific sprite passes.
  for (const creature of iterActiveCreatureOverlayPass(creatureEntries)) {
    let screen = WorldRenderCtx._worldToScreenWith(creature.pos, { camera: ctx.camera, viewScale: ctx.viewScale });
    let lifecycleStage = creature.lifecycleStage;
    drawCreatureOverlays(renderCtx, creature, { screen: screen, lifecycleStage: lifecycleStage, ctx: ctx });
  }

  const resources = frame.resources;
  for (const creature of iterNativeCreatureSpritePass(creatureEntries)) {
    let screen = WorldRenderCtx._worldToScreenWith(creature.pos, { camera: ctx.camera, viewScale: ctx.viewScale });
    let lifecycleStage = creature.lifecycleStage;

    const typeId = creature.typeId;
    const asset = mapGetOrThrow(CREATURE_ASSET, typeId);
    const texture = creatureTexture(resources, asset);

    let tint: wgl.Color;
    if (texture === null) {
      tint = wgl.makeColor(220 / 255, 90 / 255, 90 / 255, int(255 * ctx.entityAlpha + 0.5) / 255);
      wgl.drawCircle(int(screen.x), int(screen.y), Math.max(1.0, creature.size * 0.5 * ctx.scale), tint);
      continue;
    }

    const info = mapGetOrThrow(CREATURE_ANIM, typeId);

    let tintRgba = creature.tint;

    // Energizer: tint "weak" creatures blue-ish while active.
    // Mirrors `creature_render_type` (0x00418b60) branch when
    // `_bonus_energizer_timer > 0` and `max_health < 500`.
    const energizerTimer = frame.state.bonuses.energizer;
    let t: typeof energizerTimer;
    if (energizerTimer > 0.0 && creature.maxHp < 500.0) {
      // Native clamps to 1.0, then blends towards (0.5, 0.5, 1.0, 1.0).
      // Effect is full strength while timer >= 1 and fades out during the last second.
      t = energizerTimer;
      if (t >= 1.0) {
        t = 1.0;
      } else if (t < 0.0) {
        t = 0.0;
      }
      tintRgba = RGBA.lerp(tintRgba, new RGBA(0.5, 0.5, 1.0, 1.0), t);
    }

    if (lifecycleStage < 0.0) {
      // Mirrors the main-pass alpha fade when lifecycle_stage ramps negative.
      tintRgba = tintRgba.withAlpha(Math.max(0.0, tintRgba.a + lifecycleStage * 0.1));
    }

    tint = tintRgba.scaledAlpha(ctx.entityAlpha).clamped().toRl();

    const sizeScale = clamp(creature.size / 64.0, 0.25, 2.0);
    const fxDetail = frame.config !== null ? frame.config.display.fxDetailEnabled({ level: 0, default: true }) : true;
    // Mirrors `creature_render_type`: the "shadow-ish" pass is gated by fx_detail_0
    // and is disabled when the Monster Vision perk is active.
    const shadow = fxDetail && (frame.players.length === 0 || !perkActive(frame.players[0], PerkId.MONSTER_VISION));
    const longStrip = (creature.flags & CreatureFlags.ANIM_PING_PONG) === 0 || (creature.flags & CreatureFlags.ANIM_LONG_STRIP) !== 0;

    let phase = creature.animPhase;
    if (longStrip) {
      if (lifecycleStage < 0.0) {
        // Negative phase selects the fallback "corpse" frame in creature_render_type.
        phase = -1.0;
      } else if (lifecycleStage < 16.0) {
        // Death staging: while lifecycle_stage ramps down (16..0), creature_render_type
        // selects frames via `__ftol((base_frame + 15) - lifecycle_stage)`.
        phase = (info.base + 0x0F) - lifecycleStage - 0.5;
      }
    }

    let shadowAlpha = null;
    let shadowA: number;
    if (shadow) {
      // Shadow pass uses tint_a * 0.4 and fades much faster for corpses (lifecycle_stage < 0).
      shadowA = creature.tint.a * 0.4;
      if (lifecycleStage < 0.0) {
        shadowA += lifecycleStage * (longStrip ? 0.5 : 0.1);
        shadowA = Math.max(0.0, shadowA);
      }
      shadowAlpha = int(clamp(shadowA * ctx.entityAlpha * 255.0, 0.0, 255.0) + 0.5);
    }

    drawCreatureSprite(
      renderCtx,
      texture,
      { typeId: typeId || CreatureTypeId.ZOMBIE, flags: creature.flags, phase: phase, mirrorLong: Boolean(info.mirror) && lifecycleStage >= 16.0, shadowAlpha: shadowAlpha, pos: creature.pos, screenPos: screen, rotationRad: creature.heading - Math.PI / 2.0, scale: ctx.scale, sizeScale: sizeScale, tint: tint, shadow: shadow },
    );
  }
}

function drawFreezeOverlay(renderCtx: WorldRenderCtx, opts: { ctx: WorldDrawContext }): void {
  const ctx = opts.ctx;
  if (ctx.particlesTexture === null) {
    return;
  }

  const freezeTimer = renderCtx.frame.state.bonuses.freeze;
  if (freezeTimer <= 0.0) {
    return;
  }

  const src = effectSrcRect(ctx.particlesTexture, EffectId.FREEZE_SHATTER);
  if (src === null) {
    return;
  }

  const fade = freezeTimer >= 1.0 ? 1.0 : clamp(freezeTimer, 0.0, 1.0);
  const freezeAlpha = clamp(fade * ctx.entityAlpha * 0.7, 0.0, 1.0);
  if (freezeAlpha <= 1e-3) {
    return;
  }

  const tint = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, int(freezeAlpha * 255.0 + 0.5) / 255);
  wgl.beginBlendMode(wgl.BlendMode.ALPHA);
  for (const [idx, creature] of renderCtx.frame.creatures.entries.entries()) {
    if (!creature.active) {
      continue;
    }
    const size = creature.size * ctx.scale;
    if (size <= 1e-3) {
      continue;
    }
    const creatureScreen = renderCtx._worldToScreenWith(creature.pos, { camera: ctx.camera, viewScale: ctx.viewScale });
    const dst = wgl.makeRectangle(creatureScreen.x, creatureScreen.y, size, size);
    const origin = wgl.makeVector2(size * 0.5, size * 0.5);
    const rotationDeg = (idx * 0.01 + creature.heading) * RAD_TO_DEG;
    wgl.drawTexturePro(ctx.particlesTexture, src, dst, origin, rotationDeg, tint);
  }
  wgl.endBlendMode();
}

function drawProjectilesAndEffects(renderCtx: WorldRenderCtx, opts: { ctx: WorldDrawContext }): void {
  const ctx = opts.ctx;
  const frame = renderCtx.frame;
  const _withExit410_0 = profilePass('laser_sight');
  try {
    drawSharpshooterLaserSight(
      renderCtx,
      { camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha },
    );
  } finally {
    _withExit410_0();
  }

  const _withExit419_0 = profilePass('primary_projectiles');
  try {
    for (const [projIndex, proj] of frame.state.projectiles.entries.entries()) {
      if (!proj.active) {
        continue;
      }
      drawProjectile(
        renderCtx,
        proj,
        { projIndex: projIndex, camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha },
      );
    }
  } finally {
    _withExit419_0();
  }

  const _withExit433_0 = profilePass('particle_pool');
  try {
    drawParticlePool(
      renderCtx,
      { camera: ctx.camera, viewScale: ctx.viewScale, alpha: ctx.entityAlpha },
    );
  } finally {
    _withExit433_0();
  }

  const _withExit441_0 = profilePass('secondary_projectiles');
  try {
    for (const proj of frame.state.secondaryProjectiles.entries) {
      if (!proj.active) {
        continue;
      }
      drawSecondaryProjectile(
        renderCtx,
        proj,
        { camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha },
      );
    }
  } finally {
    _withExit441_0();
  }

  const _withExit454_0 = profilePass('sprite_effect_pool');
  try {
    drawSpriteEffectPool(
      renderCtx,
      { camera: ctx.camera, viewScale: ctx.viewScale, alpha: ctx.entityAlpha },
    );
  } finally {
    _withExit454_0();
  }
  const _withExit461_0 = profilePass('effect_pool');
  try {
    drawEffectPool(
      renderCtx,
      { camera: ctx.camera, viewScale: ctx.viewScale, alpha: ctx.entityAlpha },
    );
  } finally {
    _withExit461_0();
  }
}

function iterVisibleAimPlayers(renderCtx: WorldRenderCtx): PlayerState[] {
  const frame = renderCtx.frame;
  const players = frame.players;
  if (!Boolean(frame.lanLocalAimIndicatorsOnly)) {
    return Array.from(players);
  }
  const localSlot = int(frame.lanLocalPlayerSlotIndex);
  return players.filter((player) => int(player.index) === localSlot).map((player) => player);
}

export function drawAimIndicators(renderCtx: WorldRenderCtx, opts: { ctx: WorldDrawContext; worldToScreenWith?: WorldToScreenWithFn | null; drawAimCircleFn?: DrawAimCircleFn | null; drawClockGaugeFn?: DrawClockGaugeFn | null }): void {
  const ctx = opts.ctx;
  const worldToScreenWith = opts.worldToScreenWith ?? null;
  const drawAimCircleFn = opts.drawAimCircleFn ?? null;
  const drawClockGaugeFn = opts.drawClockGaugeFn ?? null;
  let transform = worldToScreenWith;
  if (transform === null) {
    transform = (pos: Vec2, camera: Vec2, viewScale: Vec2): Vec2 => {
      return renderCtx._worldToScreenWith(pos, { camera: camera, viewScale: viewScale });
    };
  }

  let drawCircle = drawAimCircleFn;
  if (drawCircle === null) {
    drawCircle = (center: Vec2, radius: number, alpha: number): void => {
      drawAimCircle(
        renderCtx,
        { center: center, radius: radius, alpha: alpha },
      );
    };
  }

  let drawGauge = drawClockGaugeFn;
  if (drawGauge === null) {
    drawGauge = (pos: Vec2, ms: number, scale: number, alpha: number): void => {
      drawClockGauge(
        renderCtx,
        { pos: pos, ms: ms, scale: scale, alpha: alpha },
      );
    };
  }

  for (const player of iterVisibleAimPlayers(renderCtx)) {
    if (player.health <= 0.0) {
      continue;
    }

    const aim = player.aim;
    const dist = player.pos.distanceTo(player.aim);
    const radius = Math.max(6.0, dist * player.spreadHeat * 0.5);
    const aimScreen = transform(aim, ctx.camera, ctx.viewScale);
    const screenRadius = Math.max(1.0, radius * ctx.scale);
    drawCircle(aimScreen, screenRadius, ctx.entityAlpha);

    const reloadTimer = player.weapon.reloadTimer;
    const reloadMax = player.weapon.reloadTimerMax;
    if (reloadMax > 1e-6 && reloadTimer > 1e-6) {
      const progress = reloadTimer / reloadMax;
      if (progress > 0.0) {
        const ms = int(progress * 60000.0);
        drawGauge(new Vec2(int(aimScreen.x), int(aimScreen.y)), ms, ctx.scale, ctx.entityAlpha);
      }
    }
  }
}

export function drawAimEnhancements(renderCtx: WorldRenderCtx, opts: { ctx: WorldDrawContext; worldToScreenWith?: WorldToScreenWithFn | null }): void {
  const ctx = opts.ctx;
  const worldToScreenWith = opts.worldToScreenWith ?? null;
  let transform = worldToScreenWith;
  if (transform === null) {
    transform = (pos: Vec2, camera: Vec2, viewScale: Vec2): Vec2 => {
      return renderCtx._worldToScreenWith(pos, { camera: camera, viewScale: viewScale });
    };
  }

  for (const player of iterVisibleAimPlayers(renderCtx)) {
    if (player.health <= 0.0) {
      continue;
    }
    const aimScreen = transform(player.aim, ctx.camera, ctx.viewScale);
    drawAimCursor(ctx.particlesTexture, renderCtx.frame.resources.texture(TextureId.UI_AIM), { pos: aimScreen });
  }
}

function creatureTexture(resources: RuntimeResources, assetName: string | null): rl.Texture | null {
  if (assetName === null) {
    return null;
  }
  const textureId = CREATURE_TEXTURE_IDS.get(assetName) ?? null;
  if (textureId === null) {
    return null;
  }
  return resources.texture(textureId);
}

function drawBonusAndUi(renderCtx: WorldRenderCtx, opts: { ctx: WorldDrawContext; drawAimIndicatorsEnabled: boolean }): void {
  const ctx = opts.ctx;
  const drawAimIndicatorsEnabled = opts.drawAimIndicatorsEnabled;
  const _withExit574_0 = profilePass('bonus_pickups');
  try {
    drawBonusPickups(
      renderCtx,
      { camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha },
    );
  } finally {
    _withExit574_0();
  }
  const _withExit582_0 = profilePass('bonus_labels');
  try {
    drawBonusHoverLabels(
      renderCtx,
      { camera: ctx.camera, viewScale: ctx.viewScale, alpha: ctx.entityAlpha },
    );
  } finally {
    _withExit582_0();
  }

  const drawWorldAim = drawAimIndicatorsEnabled && !renderCtx.frame.demoModeActive;
  if (drawWorldAim) {
    const _withExit592_0 = profilePass('aim_indicators');
    try {
      drawAimIndicators(renderCtx, { ctx: ctx });
    } finally {
      _withExit592_0();
    }
  }

  const _withExit595_0 = profilePass('direction_arrows');
  try {
    drawDirectionArrows(
      renderCtx,
      { camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha },
    );
  } finally {
    _withExit595_0();
  }

  if (drawWorldAim) {
    const _withExit605_0 = profilePass('aim_enhancements');
    try {
      drawAimEnhancements(renderCtx, { ctx: ctx });
    } finally {
      _withExit605_0();
    }
  }
}
