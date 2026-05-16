// Port of crimson/render/world/draw.py

import { RuntimeResources, TextureId, getTexture } from '@grim/assets.ts';
import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import * as wgl from '@wgl';
import { CreatureFlags, CreatureTypeId } from '@crimson/creatures/spawn.ts';
import { EFFECT_ID_ATLAS_TABLE_BY_ID, SIZE_CODE_GRID, EffectId } from '@crimson/effects-atlas.ts';
import { PerkId } from '@crimson/perks/ids.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { CREATURE_ANIM, CREATURE_ASSET } from '@crimson/sim/world-defs.ts';
import { drawAimCursor } from '@crimson/ui/cursor.ts';
import * as viewport from './viewport.ts';
import { drawBonusHoverLabels, drawBonusPickups } from './bonuses.ts';
import { monsterVisionFadeAlpha, RAD_TO_DEG } from './constants.ts';
import { WorldRenderCtx } from './context.ts';
import { drawCreatureSprite } from './creatures.ts';
import { drawEffectPool, drawParticlePool, drawSpriteEffectPool } from './effects.ts';
import { drawAimCircle, drawClockGauge, drawDirectionArrows } from './overlays.ts';
import { profilePass } from './profile-hooks.ts';
import { drawProjectile, drawSecondaryProjectile, drawSharpshooterLaserSight } from './projectiles.ts';
import { drawPlayerTrooperSprite } from './trooper.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';

const _CREATURE_TEXTURE_IDS: Record<string, TextureId> = {
  alien: TextureId.ALIEN,
  lizard: TextureId.LIZARD,
  spider_sp1: TextureId.SPIDER_SP1,
  spider_sp2: TextureId.SPIDER_SP2,
  trooper: TextureId.TROOPER,
  zombie: TextureId.ZOMBIE,
};

const _NATIVE_CREATURE_SPRITE_DRAW_ORDER: CreatureTypeId[] = [
  CreatureTypeId.ZOMBIE,
  CreatureTypeId.SPIDER_SP1,
  CreatureTypeId.SPIDER_SP2,
  CreatureTypeId.ALIEN,
  CreatureTypeId.LIZARD,
];

function byteChannel(value: number): number {
  return int(clamp(value, 0.0, 1.0) * 255.0 + 0.5) / 255;
}

function colorFromRgba(r: number, g: number, b: number, a: number): wgl.Color {
  return wgl.makeColor(byteChannel(r), byteChannel(g), byteChannel(b), byteChannel(a));
}

function drawFilledCircle(center: Vec2, radius: number, color: wgl.Color): void {
  const segments = Math.max(24, int(radius * 1.5 + 0.5));
  const step = (Math.PI * 2.0) / segments;
  const white = wgl.getWhiteTexture();
  wgl.beginQuads(white);
  wgl.rlTexCoord2f(0.5, 0.5);
  wgl.rlColor4f(color.r, color.g, color.b, color.a);
  for (let i = 0; i < segments; i++) {
    const a0 = i * step;
    const a1 = (i + 1) * step;
    wgl.rlVertex2f(center.x, center.y);
    wgl.rlVertex2f(center.x, center.y);
    wgl.rlVertex2f(center.x + Math.cos(a0) * radius, center.y + Math.sin(a0) * radius);
    wgl.rlVertex2f(center.x + Math.cos(a1) * radius, center.y + Math.sin(a1) * radius);
  }
  wgl.endQuads();
}

export class WorldDrawContext {
  readonly camera: Vec2;
  readonly viewScale: Vec2;
  readonly scale: number;
  readonly entityAlpha: number;
  readonly trooperTexture: wgl.Texture | null;
  readonly particlesTexture: wgl.Texture | null;
  readonly monsterVision: boolean;
  readonly monsterVisionSrc: wgl.Rectangle | null;
  readonly poisonSrc: wgl.Rectangle | null;

  constructor(opts: {
    camera?: Vec2;
    viewScale?: Vec2;
    scale?: number;
    entityAlpha?: number;
    trooperTexture?: wgl.Texture | null;
    particlesTexture?: wgl.Texture | null;
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

export function drawWorld(
  renderCtx: WorldRenderCtx,
  opts: { drawAimIndicators?: boolean; entityAlpha?: number } = {},
): void {
  const drawAimIndicatorsEnabled = opts.drawAimIndicators ?? true;
  let entityAlpha = opts.entityAlpha ?? 1.0;
  entityAlpha = clamp(entityAlpha, 0.0, 1.0);
  const [camera, viewScale, scale, screenSize, outSize] = computeViewTransform(renderCtx);

  const endBg = profilePass('background');
  try {
    drawBackground(renderCtx, { camera, screenSize, outSize });
  } finally {
    endBg();
  }

  if (entityAlpha <= 1e-3) return;

  wgl.setAlphaTest(true);
  try {
    const drawCtx = buildDrawContext(renderCtx, { camera, viewScale, scale, entityAlpha });

    const endPlayersDead = profilePass('players_dead');
    try {
      drawPlayers(renderCtx, { ctx: drawCtx, alive: false });
    } finally {
      endPlayersDead();
    }

    const endCreatures = profilePass('creatures');
    try {
      drawCreatures(renderCtx, { ctx: drawCtx });
    } finally {
      endCreatures();
    }

    const endFreeze = profilePass('freeze_overlay');
    try {
      drawFreezeOverlay(renderCtx, { ctx: drawCtx });
    } finally {
      endFreeze();
    }

    const endPlayersAlive = profilePass('players_alive');
    try {
      drawPlayers(renderCtx, { ctx: drawCtx, alive: true });
    } finally {
      endPlayersAlive();
    }

    const endProjEffects = profilePass('projectiles_effects');
    try {
      drawProjectilesAndEffects(renderCtx, { ctx: drawCtx });
    } finally {
      endProjEffects();
    }

    const endBonusUi = profilePass('bonus_ui');
    try {
      drawBonusAndUi(renderCtx, { ctx: drawCtx, drawAimIndicatorsEnabled });
    } finally {
      endBonusUi();
    }
  } finally {
    wgl.setAlphaTest(false);
  }
}

export function computeViewTransform(
  renderCtx: WorldRenderCtx,
): [Vec2, Vec2, number, Vec2, Vec2] {
  const frame = renderCtx.frame;
  const outW = wgl.getScreenWidth();
  const outH = wgl.getScreenHeight();
  const outSize = new Vec2(outW, outH);
  const [camera, viewScale, screenSize] = viewport.viewTransform(
    { worldSize: frame.worldSize, config: frame.config, camera: frame.camera, outSize },
  );
  const scale = viewport.viewScaleAvg(viewScale);
  return [camera, viewScale, scale, screenSize, outSize];
}

function drawBackground(
  renderCtx: WorldRenderCtx,
  opts: { camera: Vec2; screenSize: Vec2; outSize: Vec2 },
): void {
  const { camera, screenSize, outSize } = opts;
  const ground = renderCtx.frame.ground;
  if (ground === null) {
    throw new Error('ground renderer must be initialized before live world draw');
  }
  wgl.clearBackground(wgl.makeColor(10 / 255, 10 / 255, 12 / 255, 1));
  ground.drawView(
    camera,
    { screenW: screenSize.x, screenH: screenSize.y, outW: outSize.x, outH: outSize.y },
  );
}

export function effectSrcRect(
  texture: wgl.Texture,
  effectId: EffectId,
): wgl.Rectangle | null {
  const atlas = EFFECT_ID_ATLAS_TABLE_BY_ID.get(int(effectId));
  if (atlas === undefined) return null;
  const grid = SIZE_CODE_GRID.get(int(atlas.sizeCode));
  if (!grid) return null;
  const frame = int(atlas.frame);
  const col = frame % grid;
  const row = Math.floor(frame / grid);
  const cellW = texture.width / grid;
  const cellH = texture.height / grid;
  return wgl.makeRectangle(
    cellW * col,
    cellH * row,
    Math.max(0.0, cellW - 2.0),
    Math.max(0.0, cellH - 2.0),
  );
}

function buildDrawContext(
  renderCtx: WorldRenderCtx,
  opts: { camera: Vec2; viewScale: Vec2; scale: number; entityAlpha: number },
): WorldDrawContext {
  const { camera, viewScale, scale, entityAlpha } = opts;
  const frame = renderCtx.frame;
  const resources = frame.resources;
  const trooperAsset = CREATURE_ASSET.get(CreatureTypeId.TROOPER) ?? null;
  const trooperTexture = creatureTexture(resources, trooperAsset);
  const particlesTexture = getTexture(resources, TextureId.PARTICLES);

  const monsterVision = frame.players.length > 0 && perkActive(frame.players[0], PerkId.MONSTER_VISION);
  let monsterVisionSrc: wgl.Rectangle | null = null;
  if (monsterVision) {
    monsterVisionSrc = effectSrcRect(particlesTexture, EffectId.AURA);
  }
  // Native uses `effect_select_texture(0x10)` (EffectId.AURA) for creature overlays
  // (monster vision, shadow, poison aura).
  const poisonSrc = effectSrcRect(particlesTexture, EffectId.AURA);

  return new WorldDrawContext({
    camera,
    viewScale,
    scale,
    entityAlpha,
    trooperTexture,
    particlesTexture,
    monsterVision,
    monsterVisionSrc,
    poisonSrc,
  });
}

function drawPlayer(
  renderCtx: WorldRenderCtx,
  player: PlayerState,
  opts: { ctx: WorldDrawContext },
): void {
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

  const screen = WorldRenderCtx.worldToScreenWith(player.pos, { camera: ctx.camera, viewScale: ctx.viewScale });
  const r = Math.max(1.0, 14.0 * ctx.scale);
  const tint = wgl.makeColor(90 / 255, 190 / 255, 120 / 255, int(255 * ctx.entityAlpha + 0.5) / 255);
  drawFilledCircle(new Vec2(int(screen.x), int(screen.y)), r, tint);
}

function drawPlayers(
  renderCtx: WorldRenderCtx,
  opts: { ctx: WorldDrawContext; alive: boolean },
): void {
  const { ctx, alive } = opts;
  for (const player of renderCtx.frame.players) {
    if (alive && player.health <= 0.0) continue;
    if (!alive && player.health > 0.0) continue;
    drawPlayer(renderCtx, player, { ctx });
  }
}

function iterActiveCreatureOverlayPass(creatures: CreatureState[]): CreatureState[] {
  return creatures.filter((c) => c.active);
}

function iterNativeCreatureSpritePass(creatures: CreatureState[]): CreatureState[] {
  const result: CreatureState[] = [];
  for (const typeId of _NATIVE_CREATURE_SPRITE_DRAW_ORDER) {
    for (const creature of creatures) {
      if (creature.active && creature.typeId === typeId) {
        result.push(creature);
      }
    }
  }
  return result;
}

function drawCreatureOverlays(
  renderCtx: WorldRenderCtx,
  creature: CreatureState,
  opts: { screen: Vec2; lifecycleStage: number; ctx: WorldDrawContext },
): void {
  const { screen, lifecycleStage, ctx } = opts;
  const fade = monsterVisionFadeAlpha(lifecycleStage);

  if (ctx.monsterVision && ctx.particlesTexture !== null && ctx.monsterVisionSrc !== null) {
    const mvAlpha = fade * ctx.entityAlpha;
    if (mvAlpha > 1e-3) {
      const size = 90.0 * ctx.scale;
      const dst = wgl.makeRectangle(screen.x, screen.y, size, size);
      const origin = wgl.makeVector2(size * 0.5, size * 0.5);
      const tint = wgl.makeColor(1, 1, 0, byteChannel(mvAlpha));
      wgl.drawTexturePro(ctx.particlesTexture, ctx.monsterVisionSrc, dst, origin, 0.0, tint);
    }
  }

  if (ctx.particlesTexture !== null && ctx.poisonSrc !== null && creature.plagueInfected) {
    // creature_render_all: collision_flag overlay (black 80x80 aura), drawn before red poison flag.
    const plagueAlpha = fade * ctx.entityAlpha;
    if (plagueAlpha > 1e-3) {
      const size = 80.0 * ctx.scale;
      const dst = wgl.makeRectangle(screen.x, screen.y, size, size);
      const origin = wgl.makeVector2(size * 0.5, size * 0.5);
      const tint = wgl.makeColor(0, 0, 0, byteChannel(plagueAlpha));
      wgl.drawTexturePro(ctx.particlesTexture, ctx.poisonSrc, dst, origin, 0.0, tint);
    }
  }

  if (
    ctx.particlesTexture !== null &&
    ctx.poisonSrc !== null &&
    (creature.flags & CreatureFlags.SELF_DAMAGE_TICK)
  ) {
    const poisonAlpha = fade * ctx.entityAlpha;
    if (poisonAlpha > 1e-3) {
      const size = 60.0 * ctx.scale;
      const dst = wgl.makeRectangle(screen.x, screen.y, size, size);
      const origin = wgl.makeVector2(size * 0.5, size * 0.5);
      const tint = wgl.makeColor(1, 0, 0, byteChannel(poisonAlpha));
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
    const screen = WorldRenderCtx.worldToScreenWith(creature.pos, { camera: ctx.camera, viewScale: ctx.viewScale });
    const lifecycleStage = creature.lifecycleStage;
    drawCreatureOverlays(renderCtx, creature, { screen, lifecycleStage, ctx });
  }

  const resources = frame.resources;
  for (const creature of iterNativeCreatureSpritePass(creatureEntries)) {
    const screen = WorldRenderCtx.worldToScreenWith(creature.pos, { camera: ctx.camera, viewScale: ctx.viewScale });
    const lifecycleStage = creature.lifecycleStage;

    const typeId = creature.typeId;
    const asset = CREATURE_ASSET.get(typeId)!;
    const texture = creatureTexture(resources, asset);

    if (texture === null) {
      const r = Math.max(1.0, creature.size * 0.5 * ctx.scale);
      const tint = wgl.makeColor(220 / 255, 90 / 255, 90 / 255, int(255 * ctx.entityAlpha + 0.5) / 255);
      drawFilledCircle(new Vec2(int(screen.x), int(screen.y)), r, tint);
      continue;
    }

    const info = CREATURE_ANIM.get(typeId)!;

    let tintRgba = creature.tint;

    // Energizer: tint "weak" creatures blue-ish while active.
    // Mirrors `creature_render_type` (0x00418b60) branch when
    // `_bonus_energizer_timer > 0` and `max_health < 500`.
    const energizerTimer = frame.state.bonuses.energizer;
    if (energizerTimer > 0.0 && creature.maxHp < 500.0) {
      // Native clamps to 1.0, then blends towards (0.5, 0.5, 1.0, 1.0).
      // Effect is full strength while timer >= 1 and fades out during the last second.
      let t = energizerTimer;
      if (t >= 1.0) t = 1.0;
      else if (t < 0.0) t = 0.0;
      tintRgba = RGBA.lerp(tintRgba, new RGBA(0.5, 0.5, 1.0, 1.0), t);
    }

    if (lifecycleStage < 0.0) {
      // Mirrors the main-pass alpha fade when lifecycle_stage ramps negative.
      tintRgba = tintRgba.withAlpha(Math.max(0.0, tintRgba.a + lifecycleStage * 0.1));
    }

    const scaledTint = tintRgba.scaledAlpha(ctx.entityAlpha);
    const tint = colorFromRgba(scaledTint.r, scaledTint.g, scaledTint.b, scaledTint.a);

    const sizeScale = clamp(creature.size / 64.0, 0.25, 2.0);
    const config = frame.config;
    const fxDetail = config !== null ? config.display.fxDetailEnabled(0, true) : true;
    // Mirrors `creature_render_type`: the "shadow-ish" pass is gated by fx_detail_0
    // and is disabled when the Monster Vision perk is active.
    const shadow = fxDetail && (!frame.players.length || !perkActive(frame.players[0], PerkId.MONSTER_VISION));
    const longStrip =
      (creature.flags & CreatureFlags.ANIM_PING_PONG) === 0 ||
      (creature.flags & CreatureFlags.ANIM_LONG_STRIP) !== 0;

    let phase = creature.animPhase;
    if (longStrip) {
      if (lifecycleStage < 0.0) {
        // Negative phase selects the fallback "corpse" frame in creature_render_type.
        phase = -1.0;
      } else if (lifecycleStage < 16.0) {
        // Death staging: while lifecycle_stage ramps down (16..0), creature_render_type
        // selects frames via `__ftol((base_frame + 15) - lifecycle_stage)`.
        phase = (info.base + 0x0f) - lifecycleStage - 0.5;
      }
    }

    let shadowAlpha: number | null = null;
    if (shadow) {
      // Shadow pass uses tint_a * 0.4 and fades much faster for corpses (lifecycle_stage < 0).
      let shadowA = creature.tint.a * 0.4;
      if (lifecycleStage < 0.0) {
        shadowA += lifecycleStage * (longStrip ? 0.5 : 0.1);
        shadowA = Math.max(0.0, shadowA);
      }
      shadowAlpha = int(clamp(shadowA * ctx.entityAlpha * 255.0, 0.0, 255.0) + 0.5);
    }

    drawCreatureSprite(
      renderCtx,
      texture,
      {
        typeId: typeId || CreatureTypeId.ZOMBIE,
        flags: creature.flags,
        phase,
        mirrorLong: info.mirror && lifecycleStage >= 16.0,
        shadowAlpha,
        pos: creature.pos,
        screenPos: screen,
        rotationRad: creature.heading - Math.PI / 2.0,
        scale: ctx.scale,
        sizeScale,
        tint,
        shadow,
      },
    );
  }
}

function drawFreezeOverlay(renderCtx: WorldRenderCtx, opts: { ctx: WorldDrawContext }): void {
  const ctx = opts.ctx;
  if (ctx.particlesTexture === null) return;

  const freezeTimer = renderCtx.frame.state.bonuses.freeze;
  if (freezeTimer <= 0.0) return;

  const src = effectSrcRect(ctx.particlesTexture, EffectId.FREEZE_SHATTER);
  if (src === null) return;

  const fade = freezeTimer >= 1.0 ? 1.0 : clamp(freezeTimer, 0.0, 1.0);
  const freezeAlpha = clamp(fade * ctx.entityAlpha * 0.7, 0.0, 1.0);
  if (freezeAlpha <= 1e-3) return;

  const tint = wgl.makeColor(1, 1, 1, byteChannel(freezeAlpha));
  wgl.beginBlendMode(wgl.BlendMode.ALPHA);
  const creatures = renderCtx.frame.creatures.entries;
  for (let idx = 0; idx < creatures.length; idx++) {
    const creature = creatures[idx];
    if (!creature.active) continue;
    const size = creature.size * ctx.scale;
    if (size <= 1e-3) continue;
    const creatureScreen = WorldRenderCtx.worldToScreenWith(creature.pos, { camera: ctx.camera, viewScale: ctx.viewScale });
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

  const endLaserSight = profilePass('laser_sight');
  try {
    drawSharpshooterLaserSight(renderCtx, { camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha });
  } finally {
    endLaserSight();
  }

  const endPrimaryProjectiles = profilePass('primary_projectiles');
  try {
    const projectiles = frame.state.projectiles.entries;
    for (let projIndex = 0; projIndex < projectiles.length; projIndex++) {
      const proj = projectiles[projIndex];
      if (!proj.active) continue;
      drawProjectile(
        renderCtx, proj,
        { projIndex, camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha },
      );
    }
  } finally {
    endPrimaryProjectiles();
  }

  const endParticlePool = profilePass('particle_pool');
  try {
    drawParticlePool(renderCtx, { camera: ctx.camera, viewScale: ctx.viewScale, alpha: ctx.entityAlpha });
  } finally {
    endParticlePool();
  }

  const endSecondaryProjectiles = profilePass('secondary_projectiles');
  try {
    const secondaryProjectiles = frame.state.secondaryProjectiles.entries;
    for (const proj of secondaryProjectiles) {
      if (!proj.active) continue;
      drawSecondaryProjectile(
        renderCtx, proj,
        { camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha },
      );
    }
  } finally {
    endSecondaryProjectiles();
  }

  const endSpriteEffectPool = profilePass('sprite_effect_pool');
  try {
    drawSpriteEffectPool(renderCtx, { camera: ctx.camera, viewScale: ctx.viewScale, alpha: ctx.entityAlpha });
  } finally {
    endSpriteEffectPool();
  }

  const endEffectPool = profilePass('effect_pool');
  try {
    drawEffectPool(renderCtx, { camera: ctx.camera, viewScale: ctx.viewScale, alpha: ctx.entityAlpha });
  } finally {
    endEffectPool();
  }
}

function iterVisibleAimPlayers(renderCtx: WorldRenderCtx): PlayerState[] {
  const frame = renderCtx.frame;
  const players = frame.players;
  if (!frame.lanLocalAimIndicatorsOnly) return [...players];
  const localSlot = int(frame.lanLocalPlayerSlotIndex);
  return players.filter((player) => int(player.index) === localSlot);
}

export function drawAimIndicators(
  renderCtx: WorldRenderCtx,
  opts: {
    ctx: WorldDrawContext;
    worldToScreenWith?: ((pos: Vec2, camera: Vec2, viewScale: Vec2) => Vec2) | null;
    drawAimCircleFn?: ((center: Vec2, radius: number, alpha: number) => void) | null;
    drawClockGaugeFn?: ((pos: Vec2, ms: number, scale: number, alpha: number) => void) | null;
  },
): void {
  const ctx = opts.ctx;
  const transform = opts.worldToScreenWith ?? ((pos: Vec2, camera: Vec2, viewScale: Vec2) =>
    WorldRenderCtx.worldToScreenWith(pos, { camera, viewScale }));

  const drawCircle = opts.drawAimCircleFn ?? ((center: Vec2, radius: number, alpha: number) =>
    drawAimCircle(renderCtx, { center, radius, alpha }));

  const drawGauge = opts.drawClockGaugeFn ?? ((pos: Vec2, ms: number, scale: number, alpha: number) =>
    drawClockGauge(renderCtx, { pos, ms, scale, alpha }));

  for (const player of iterVisibleAimPlayers(renderCtx)) {
    if (player.health <= 0.0) continue;

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
        drawGauge(
          new Vec2(int(aimScreen.x), int(aimScreen.y)),
          ms, ctx.scale, ctx.entityAlpha,
        );
      }
    }
  }
}

export function drawAimEnhancements(
  renderCtx: WorldRenderCtx,
  opts: {
    ctx: WorldDrawContext;
    worldToScreenWith?: ((pos: Vec2, camera: Vec2, viewScale: Vec2) => Vec2) | null;
  },
): void {
  const ctx = opts.ctx;
  const transform = opts.worldToScreenWith ?? ((pos: Vec2, camera: Vec2, viewScale: Vec2) =>
    WorldRenderCtx.worldToScreenWith(pos, { camera, viewScale }));

  for (const player of iterVisibleAimPlayers(renderCtx)) {
    if (player.health <= 0.0) continue;
    const aimScreen = transform(player.aim, ctx.camera, ctx.viewScale);
    drawAimCursor(
      ctx.particlesTexture,
      getTexture(renderCtx.frame.resources, TextureId.UI_AIM),
      { pos: aimScreen },
    );
  }
}

function creatureTexture(resources: RuntimeResources, assetName: string | null): wgl.Texture | null {
  if (assetName === null) return null;
  const textureId = _CREATURE_TEXTURE_IDS[assetName];
  if (textureId === undefined) return null;
  return getTexture(resources, textureId);
}

function drawBonusAndUi(
  renderCtx: WorldRenderCtx,
  opts: { ctx: WorldDrawContext; drawAimIndicatorsEnabled: boolean },
): void {
  const { ctx, drawAimIndicatorsEnabled } = opts;
  const endBonusPickups = profilePass('bonus_pickups');
  try {
    drawBonusPickups(renderCtx, { camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha });
  } finally {
    endBonusPickups();
  }

  const endBonusLabels = profilePass('bonus_labels');
  try {
    drawBonusHoverLabels(renderCtx, { camera: ctx.camera, viewScale: ctx.viewScale, alpha: ctx.entityAlpha });
  } finally {
    endBonusLabels();
  }

  const drawWorldAim = drawAimIndicatorsEnabled && !renderCtx.frame.demoModeActive;
  if (drawWorldAim) {
    const endAimIndicators = profilePass('aim_indicators');
    try {
      drawAimIndicators(renderCtx, { ctx });
    } finally {
      endAimIndicators();
    }
  }

  const endDirectionArrows = profilePass('direction_arrows');
  try {
    drawDirectionArrows(renderCtx, { camera: ctx.camera, viewScale: ctx.viewScale, scale: ctx.scale, alpha: ctx.entityAlpha });
  } finally {
    endDirectionArrows();
  }

  if (drawWorldAim) {
    const endAimEnhancements = profilePass('aim_enhancements');
    try {
      drawAimEnhancements(renderCtx, { ctx });
    } finally {
      endAimEnhancements();
    }
  }
}
