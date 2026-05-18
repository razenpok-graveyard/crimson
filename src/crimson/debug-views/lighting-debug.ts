// Port of crimson/debug_views/lighting_debug.py

import { TextureId } from '@grim/assets.ts';
import type { AudioState } from '@grim/audio.ts';
import { shutdownAudio, updateAudio } from '@grim/audio.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { loadSmallFont } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { Crand } from '@grim/rand.ts';
import { rl } from '@grim/raylib-api.ts';
import { InputState } from '@grim/input.ts';
import type { View, ViewContext } from '@grim/view.ts';
import { SpawnId } from '@crimson/creatures/spawn.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import { SecondarySpawnSpec } from '@crimson/projectiles/runtime/index.ts';
import { ProjectileTemplateId, SecondaryProjectileTypeId } from '@crimson/projectiles/types.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import type { FrameContext } from '@crimson/sim/input-providers.ts';
import { initViewAudio } from '@crimson/tooling/audio-bootstrap.ts';
import { drawAimCursor } from '@crimson/ui/cursor.ts';
import { WEAPON_BY_ID, WeaponId } from '@crimson/weapons.ts';
import { WorldRuntime } from '@crimson/world/index.ts';
import { StandaloneTickHarness } from '@crimson/world/standalone-tick-harness.ts';
import { drawUiText, uiLineHeight } from '@crimson/debug-views/ui-helpers.ts';
import { registerView } from '@crimson/debug-views/registry.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import type { Projectile, SecondaryProjectile } from '@crimson/projectiles/types.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';
import * as wgl from '@wgl';

export class CircleOccluder {
  readonly pos: Vec2;
  readonly radius: number;

  constructor(opts: {
    pos: Vec2;
    radius: number;
  }) {
    this.pos = opts.pos;
    this.radius = opts.radius;
  }
}

export class ShadowLight {
  readonly pos: Vec2;
  readonly radius: number;
  readonly strength: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly focus: number;
  readonly stretch: number;

  constructor(opts: {
    pos: Vec2;
    radius: number;
    strength: number;
    dirX?: number;
    dirY?: number;
    focus?: number;
    stretch?: number;
  }) {
    this.pos = opts.pos;
    this.radius = opts.radius;
    this.strength = opts.strength;
    this.dirX = opts.dirX ?? 0.0;
    this.dirY = opts.dirY ?? 0.0;
    this.focus = opts.focus ?? 0.0;
    this.stretch = opts.stretch ?? 1.0;
  }
}

export class TransientLight {
  readonly pos: Vec2;
  readonly radius: number;
  readonly strength: number;
  readonly ttl: number;
  readonly age: number;

  constructor(opts: {
    pos: Vec2;
    radius: number;
    strength: number;
    ttl: number;
    age?: number;
  }) {
    this.pos = opts.pos;
    this.radius = opts.radius;
    this.strength = opts.strength;
    this.ttl = opts.ttl;
    this.age = opts.age ?? 0.0;
  }
}

export class EmissiveProfile {
  readonly name: string;
  readonly autoInterval: number;
  readonly rateWeaponId: number | null;
  readonly primaryTypeId: ProjectileTemplateId | null;
  readonly secondaryTypeId: SecondaryProjectileTypeId | null;
  readonly burstCount: number;
  readonly spreadRad: number;
  readonly spawnDistance: number;
  readonly secondaryTtl: number;
  readonly flashRadius: number;
  readonly flashTtl: number;
  readonly flashStrength: number;
  readonly explosionDistance: number;

  constructor(opts: {
    name: string;
    autoInterval: number;
    rateWeaponId?: number | null;
    primaryTypeId?: ProjectileTemplateId | null;
    secondaryTypeId?: SecondaryProjectileTypeId | null;
    burstCount?: number;
    spreadRad?: number;
    spawnDistance?: number;
    secondaryTtl?: number;
    flashRadius?: number;
    flashTtl?: number;
    flashStrength?: number;
    explosionDistance?: number;
  }) {
    this.name = opts.name;
    this.autoInterval = opts.autoInterval;
    this.rateWeaponId = opts.rateWeaponId ?? null;
    this.primaryTypeId = opts.primaryTypeId ?? null;
    this.secondaryTypeId = opts.secondaryTypeId ?? null;
    this.burstCount = opts.burstCount ?? 1;
    this.spreadRad = opts.spreadRad ?? 0.0;
    this.spawnDistance = opts.spawnDistance ?? 28.0;
    this.secondaryTtl = opts.secondaryTtl ?? 2.0;
    this.flashRadius = opts.flashRadius ?? 120.0;
    this.flashTtl = opts.flashTtl ?? 0.2;
    this.flashStrength = opts.flashStrength ?? 1.0;
    this.explosionDistance = opts.explosionDistance ?? 110.0;
  }
}

export class SpawnPreset {
  readonly name: string;
  readonly spawnId: SpawnId;
  readonly ringCount: number;

  constructor(opts: {
    name: string;
    spawnId: SpawnId;
    ringCount?: number;
  }) {
    this.name = opts.name;
    this.spawnId = opts.spawnId;
    this.ringCount = opts.ringCount ?? 10;
  }
}

export class StaticEmitter {
  pos: Vec2;
  angle: number;
  radius: number;
  strength: number;
  focus: number;
  stretch: number;

  constructor(opts: {
    pos: Vec2;
    angle: number;
    radius: number;
    strength: number;
    focus: number;
    stretch: number;
  }) {
    this.pos = opts.pos;
    this.angle = opts.angle;
    this.radius = opts.radius;
    this.strength = opts.strength;
    this.focus = opts.focus;
    this.stretch = opts.stretch;
  }
}

export class StaticDragState {
  kind: string;
  emitterIndex: number;
  mouseStartWorld: Vec2;
  mouseStartScreen: Vec2;
  posOffset: Vec2;
  valueStart: number;

  constructor(opts: {
    kind: string;
    emitterIndex: number;
    mouseStartWorld: Vec2;
    mouseStartScreen: Vec2;
    posOffset: Vec2;
    valueStart: number;
  }) {
    this.kind = opts.kind;
    this.emitterIndex = opts.emitterIndex;
    this.mouseStartWorld = opts.mouseStartWorld;
    this.mouseStartScreen = opts.mouseStartScreen;
    this.posOffset = opts.posOffset;
    this.valueStart = opts.valueStart;
  }
}

export class ShadowUniforms {
  readonly resolution: number;
  readonly rtResolution: number;
  readonly camera: number;
  readonly viewScale: number;
  readonly occluderCount: number;
  readonly occluders: readonly number[];
  readonly lightCount: number;
  readonly lights: readonly number[];
  readonly lightDirs: readonly number[];
  readonly lightSizeW: number;
  readonly shadowStrength: number;
  readonly ambientDarkness: number;
  readonly minT: number;
  readonly jitterPhase: number;
  readonly jitterAmount: number;
  readonly debugMode: number;

  constructor(opts: {
    resolution: number;
    rtResolution: number;
    camera: number;
    viewScale: number;
    occluderCount: number;
    occluders: readonly number[];
    lightCount: number;
    lights: readonly number[];
    lightDirs: readonly number[];
    lightSizeW: number;
    shadowStrength: number;
    ambientDarkness: number;
    minT: number;
    jitterPhase: number;
    jitterAmount: number;
    debugMode: number;
  }) {
    this.resolution = opts.resolution;
    this.rtResolution = opts.rtResolution;
    this.camera = opts.camera;
    this.viewScale = opts.viewScale;
    this.occluderCount = opts.occluderCount;
    this.occluders = opts.occluders;
    this.lightCount = opts.lightCount;
    this.lights = opts.lights;
    this.lightDirs = opts.lightDirs;
    this.lightSizeW = opts.lightSizeW;
    this.shadowStrength = opts.shadowStrength;
    this.ambientDarkness = opts.ambientDarkness;
    this.minT = opts.minT;
    this.jitterPhase = opts.jitterPhase;
    this.jitterAmount = opts.jitterAmount;
    this.debugMode = opts.debugMode;
  }
}

export class TemporalUniforms {
  readonly currentTex: number;
  readonly response: number;

  constructor(opts: {
    currentTex: number;
    response: number;
  }) {
    this.currentTex = opts.currentTex;
    this.response = opts.response;
  }
}

export class TuneParam {
  readonly key: string;
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly coarseStep: number;

  constructor(opts: {
    key: string;
    label: string;
    minimum: number;
    maximum: number;
    step: number;
    coarseStep: number;
  }) {
    this.key = opts.key;
    this.label = opts.label;
    this.minimum = opts.minimum;
    this.maximum = opts.maximum;
    this.step = opts.step;
    this.coarseStep = opts.coarseStep;
  }
}

export class AutoTunePreset {
  readonly name: string;
  readonly ambientDarkness: number;
  readonly shadowStrength: number;
  readonly lightSizeW: number;
  readonly minT: number;
  readonly rangeScale: number;
  readonly directionalFocus: number;
  readonly directionalStretch: number;
  readonly jitterAmount: number;
  readonly temporalResponse: number;
  readonly rtScale: number;

  constructor(opts: {
    name: string;
    ambientDarkness: number;
    shadowStrength: number;
    lightSizeW: number;
    minT: number;
    rangeScale: number;
    directionalFocus: number;
    directionalStretch: number;
    jitterAmount: number;
    temporalResponse: number;
    rtScale: number;
  }) {
    this.name = opts.name;
    this.ambientDarkness = opts.ambientDarkness;
    this.shadowStrength = opts.shadowStrength;
    this.lightSizeW = opts.lightSizeW;
    this.minT = opts.minT;
    this.rangeScale = opts.rangeScale;
    this.directionalFocus = opts.directionalFocus;
    this.directionalStretch = opts.directionalStretch;
    this.jitterAmount = opts.jitterAmount;
    this.temporalResponse = opts.temporalResponse;
    this.rtScale = opts.rtScale;
  }

  asTuneValues(): Map<string, number> {
    return new Map(Object.entries({ 'ambient_darkness': this.ambientDarkness, 'shadow_strength': this.shadowStrength, 'light_size_w': this.lightSizeW, 'min_t': this.minT, 'range_scale': this.rangeScale, 'directional_focus': this.directionalFocus, 'directional_stretch': this.directionalStretch, 'jitter_amount': this.jitterAmount, 'temporal_response': this.temporalResponse, 'rt_scale': this.rtScale }));
  }
}

export class ShadowFrameMetrics {
  readonly meanAlpha: number;
  readonly stdAlpha: number;
  readonly contrast: number;
  readonly coverage: number;
  readonly banding: number;

  constructor(opts: {
    meanAlpha: number;
    stdAlpha: number;
    contrast: number;
    coverage: number;
    banding: number;
  }) {
    this.meanAlpha = opts.meanAlpha;
    this.stdAlpha = opts.stdAlpha;
    this.contrast = opts.contrast;
    this.coverage = opts.coverage;
    this.banding = opts.banding;
  }
}

export class AutoTuneAccumulator {
  sampleCount: number;
  flickerCount: number;
  shadowMsSum: number;
  meanSum: number;
  stdSum: number;
  contrastSum: number;
  coverageSum: number;
  bandingSum: number;
  flickerSum: number;

  constructor(opts: {
    sampleCount?: number;
    flickerCount?: number;
    shadowMsSum?: number;
    meanSum?: number;
    stdSum?: number;
    contrastSum?: number;
    coverageSum?: number;
    bandingSum?: number;
    flickerSum?: number;
  } = {}) {
    this.sampleCount = opts.sampleCount ?? 0;
    this.flickerCount = opts.flickerCount ?? 0;
    this.shadowMsSum = opts.shadowMsSum ?? 0.0;
    this.meanSum = opts.meanSum ?? 0.0;
    this.stdSum = opts.stdSum ?? 0.0;
    this.contrastSum = opts.contrastSum ?? 0.0;
    this.coverageSum = opts.coverageSum ?? 0.0;
    this.bandingSum = opts.bandingSum ?? 0.0;
    this.flickerSum = opts.flickerSum ?? 0.0;
  }
}

export class AutoTuneResult {
  readonly preset: AutoTunePreset;
  readonly score: number;
  readonly shadowMs: number;
  readonly meanAlpha: number;
  readonly stdAlpha: number;
  readonly contrast: number;
  readonly coverage: number;
  readonly banding: number;
  readonly flicker: number;

  constructor(opts: {
    preset: AutoTunePreset;
    score: number;
    shadowMs: number;
    meanAlpha: number;
    stdAlpha: number;
    contrast: number;
    coverage: number;
    banding: number;
    flicker: number;
  }) {
    this.preset = opts.preset;
    this.score = opts.score;
    this.shadowMs = opts.shadowMs;
    this.meanAlpha = opts.meanAlpha;
    this.stdAlpha = opts.stdAlpha;
    this.contrast = opts.contrast;
    this.coverage = opts.coverage;
    this.banding = opts.banding;
    this.flicker = opts.flicker;
  }
}

export const WORLD_SIZE = 1024.0;
export const WORLD_CENTER = new Vec2(WORLD_SIZE * 0.5, WORLD_SIZE * 0.5);
export const BG = wgl.makeColor(10 / 255, 10 / 255, 12 / 255, 255 / 255);
export const UI_TEXT = wgl.makeColor(235 / 255, 235 / 255, 235 / 255, 255 / 255);
export const UI_HINT = wgl.makeColor(180 / 255, 180 / 255, 180 / 255, 255 / 255);
export const UI_WARNING = wgl.makeColor(255 / 255, 204 / 255, 96 / 255, 255 / 255);
export const UI_ERROR = wgl.makeColor(240 / 255, 80 / 255, 80 / 255, 255 / 255);
export const OCCLUDER_COLOR = wgl.makeColor(60 / 255, 180 / 255, 255 / 255, 220 / 255);
export const LIGHT_RING_COLOR = wgl.makeColor(255 / 255, 180 / 255, 80 / 255, 190 / 255);
export const LIGHT_CORE_COLOR = wgl.makeColor(255 / 255, 235 / 255, 160 / 255, 240 / 255);
export const LIGHT_SELECTED_COLOR = wgl.makeColor(255 / 255, 255 / 255, 120 / 255, 255 / 255);
export const LIGHT_HANDLE_MOVE = wgl.makeColor(120 / 255, 220 / 255, 255 / 255, 255 / 255);
export const LIGHT_HANDLE_RADIUS = wgl.makeColor(255 / 255, 200 / 255, 90 / 255, 255 / 255);
export const LIGHT_HANDLE_DIR = wgl.makeColor(255 / 255, 245 / 255, 185 / 255, 255 / 255);
export const LIGHT_HANDLE_STRENGTH = wgl.makeColor(255 / 255, 130 / 255, 170 / 255, 255 / 255);
export const LIGHT_HANDLE_STRETCH = wgl.makeColor(130 / 255, 255 / 255, 170 / 255, 255 / 255);
export const SHADOW_PREVIEW_BG = wgl.makeColor(14 / 255, 14 / 255, 18 / 255, 220 / 255);
export const SHADOW_PREVIEW_BORDER = wgl.makeColor(90 / 255, 90 / 255, 110 / 255, 240 / 255);
export const SHADOW_PREVIEW_CANVAS = wgl.makeColor(176 / 255, 176 / 255, 176 / 255, 255 / 255);
export const SHADOW_PREVIEW_TEXT = wgl.makeColor(215 / 255, 215 / 255, 215 / 255, 255 / 255);
export const SHADOW_RT_SCALE = 0.30;
export const MAX_LIGHTS = 6;
export const MAX_OCCLUDERS = 20;
export const MAX_STEPS = 56;
export const DEFAULT_LIGHT_SIZE_W = 0.33;
export const DEFAULT_SHADOW_STRENGTH = 1.01;
export const DEFAULT_MIN_T = 2.6;
export const DEFAULT_SHADOW_RANGE_SCALE = 1.52;
export const DEFAULT_AMBIENT_DARKNESS = 0.76;
export const DEFAULT_DIRECTIONAL_FOCUS = 1.12;
export const DEFAULT_DIRECTIONAL_STRETCH = 1.22;
// Keep temporal accumulation off by default; some backends/drivers produce stale
// blends with the secondary sampler path and hide shadows entirely.
export const DEFAULT_TEMPORAL_RESPONSE = 1.00;
export const DEFAULT_JITTER_AMOUNT = 0.78;
export const RT_SCALE_MIN = 0.15;
export const RT_SCALE_MAX = 0.75;
export const PLAYER_SPEED_MULTIPLIER = 4.0;
export const PLAYER_INVULNERABLE_SHIELD_TIMER = 1e-3;
export const ENEMY_RING_RADIUS = 280.0;
export const STATIC_LIGHT_RADIUS_MIN = 24.0;
export const STATIC_LIGHT_RADIUS_MAX = 900.0;
export const STATIC_LIGHT_STRENGTH_MIN = 0.05;
export const STATIC_LIGHT_STRENGTH_MAX = 2.25;
export const STATIC_LIGHT_FOCUS_MIN = 0.0;
export const STATIC_LIGHT_FOCUS_MAX = 2.0;
export const STATIC_LIGHT_STRETCH_MIN = 1.0;
export const STATIC_LIGHT_STRETCH_MAX = 4.0;
export const STATIC_HANDLE_HIT_RADIUS_PX = 14.0;
export const STATIC_HANDLE_DRAW_RADIUS_PX = 6.0;
export const AUTODIAG_ENV = 'CRIMSON_LIGHTING_DEBUG_AUTODIAG';
export const AUTODIAG_FRAMES_DEFAULT = 300;
export const AUTODIAG_SEGMENT_FRAMES = 50;
export const AUTODIAG_LOG_INTERVAL = 15;
export const DUMP_ALL_MODES_ENV = 'CRIMSON_LIGHTING_DEBUG_DUMP_ALL_MODES';
export const DUMP_ALL_SETTLE_FRAMES = 12;
export const DUMP_ALL_EMIT_INTERVAL = 6;
export const AUTO_TUNE_ENV = 'CRIMSON_LIGHTING_DEBUG_AUTO_TUNE';
export const AUTO_TUNE_SAMPLE_FRAMES_DEFAULT = 96;
export const AUTO_TUNE_WARMUP_FRAMES = 28;
export const AUTO_TUNE_METRIC_GRID = 84;
export const AUTO_TUNE_TARGET_SHADOW_MS = 2.8;
export const SHADOW_DEBUG_MODE_NAMES: readonly string[] = [
  'off',
  'solid',
  'light_count',
  'occluder_count',
  'world_gradient',
  'sdf_distance',
  'light0_radius',
  'occluder0_radius',
];
export const AUTODIAG_DEBUG_MODE_SEQUENCE: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 0] as const;
export const EMISSIVE_PROFILES: readonly EmissiveProfile[] = [
  new EmissiveProfile({
    name: 'Muzzle',
    autoInterval: 0.11,
    rateWeaponId: WeaponId.PISTOL,
    primaryTypeId: ProjectileTemplateId.PISTOL,
    flashRadius: 95.0,
    flashTtl: 0.11,
    flashStrength: 1.0,
  }),
  new EmissiveProfile({
    name: 'Ion Rifle',
    autoInterval: 0.16,
    rateWeaponId: WeaponId.ION_RIFLE,
    primaryTypeId: ProjectileTemplateId.ION_RIFLE,
    flashRadius: 140.0,
    flashTtl: 0.17,
    flashStrength: 1.0,
  }),
  new EmissiveProfile({
    name: 'Ion Minigun',
    autoInterval: 0.06,
    rateWeaponId: WeaponId.ION_MINIGUN,
    primaryTypeId: ProjectileTemplateId.ION_MINIGUN,
    burstCount: 2,
    spreadRad: 0.03,
    flashRadius: 135.0,
    flashTtl: 0.12,
    flashStrength: 0.9,
  }),
  new EmissiveProfile({
    name: 'Plasma Rifle',
    autoInterval: 0.13,
    rateWeaponId: WeaponId.PLASMA_RIFLE,
    primaryTypeId: ProjectileTemplateId.PLASMA_RIFLE,
    flashRadius: 150.0,
    flashTtl: 0.19,
    flashStrength: 1.0,
  }),
  new EmissiveProfile({
    name: 'Plasma Cannon',
    autoInterval: 0.27,
    rateWeaponId: WeaponId.PLASMA_CANNON,
    primaryTypeId: ProjectileTemplateId.PLASMA_CANNON,
    flashRadius: 210.0,
    flashTtl: 0.24,
    flashStrength: 1.0,
  }),
  new EmissiveProfile({
    name: 'Fire/Flame',
    autoInterval: 0.08,
    rateWeaponId: WeaponId.HR_FLAMER,
    primaryTypeId: ProjectileTemplateId.FIRE_BULLETS,
    burstCount: 4,
    spreadRad: 0.16,
    flashRadius: 125.0,
    flashTtl: 0.16,
    flashStrength: 0.9,
  }),
  new EmissiveProfile({
    name: 'Explosion',
    autoInterval: 0.45,
    rateWeaponId: WeaponId.ROCKET_LAUNCHER,
    secondaryTypeId: SecondaryProjectileTypeId.DETONATION,
    secondaryTtl: 0.95,
    flashRadius: 280.0,
    flashTtl: 0.3,
    flashStrength: 1.0,
    spawnDistance: 8.0,
    explosionDistance: 120.0,
  }),
];
export const SPAWN_PRESETS: readonly SpawnPreset[] = [
  new SpawnPreset({ name: 'Zombie', spawnId: SpawnId.ZOMBIE_CONST_GREY_42, ringCount: 12 }),
  new SpawnPreset({ name: 'Zombie Brute', spawnId: SpawnId.ZOMBIE_CONST_GREEN_BRUTE_43, ringCount: 10 }),
  new SpawnPreset({ name: 'Lizard', spawnId: SpawnId.LIZARD_CONST_GREY_2F, ringCount: 10 }),
  new SpawnPreset({ name: 'Lizard Boss', spawnId: SpawnId.LIZARD_CONST_YELLOW_BOSS_30, ringCount: 8 }),
  new SpawnPreset({ name: 'Alien', spawnId: SpawnId.ALIEN_CONST_GREEN_24, ringCount: 10 }),
  new SpawnPreset({ name: 'Alien Brute', spawnId: SpawnId.ALIEN_CONST_GREY_BRUTE_29, ringCount: 9 }),
  new SpawnPreset({ name: 'Spider SP1', spawnId: SpawnId.SPIDER_SP1_CONST_BLUE_40, ringCount: 11 }),
  new SpawnPreset({ name: 'Spider SP2', spawnId: SpawnId.SPIDER_SP2_RANDOM_35, ringCount: 11 }),
];
export const STATIC_OCCLUDER_LAYOUT: readonly [number, number, number][] = [
  [286.0, 246.0, 50.0],
  [460.0, 222.0, 44.0],
  [630.0, 252.0, 58.0],
  [760.0, 398.0, 64.0],
  [690.0, 564.0, 52.0],
  [510.0, 610.0, 70.0],
  [342.0, 536.0, 56.0],
  [258.0, 392.0, 48.0],
  [518.0, 404.0, 80.0],
];
export const PRIMARY_PROJECTILE_LIGHTS: Map<number, [number, number]> = new Map([
  [ProjectileTemplateId.PISTOL, [105.0, 0.75]],
  [ProjectileTemplateId.ION_RIFLE, [235.0, 1.0]],
  [ProjectileTemplateId.ION_MINIGUN, [190.0, 0.95]],
  [ProjectileTemplateId.PLASMA_RIFLE, [220.0, 1.0]],
  [ProjectileTemplateId.PLASMA_CANNON, [275.0, 1.0]],
  [ProjectileTemplateId.FIRE_BULLETS, [170.0, 0.9]],
]);
export const SECONDARY_PROJECTILE_LIGHTS: Map<number, [number, number]> = new Map([
  [SecondaryProjectileTypeId.ROCKET, [230.0, 0.95]],
  [SecondaryProjectileTypeId.HOMING_ROCKET, [245.0, 1.0]],
  [SecondaryProjectileTypeId.DETONATION, [280.0, 1.0]],
  [SecondaryProjectileTypeId.ROCKET_MINIGUN, [180.0, 0.85]],
]);
export const PRIMARY_PROJECTILE_DIRECTIONAL: Map<number, [number, number]> = new Map([
  [ProjectileTemplateId.PISTOL, [0.20, 1.15]],
  // Ion streak emissive is rendered head->tail and is not forward-cone biased.
  [ProjectileTemplateId.ION_RIFLE, [0.0, 1.0]],
  [ProjectileTemplateId.ION_MINIGUN, [0.0, 1.0]],
  // Plasma glow is omni in the native render path (head + aura/tail sprites).
  [ProjectileTemplateId.PLASMA_RIFLE, [0.0, 1.0]],
  [ProjectileTemplateId.PLASMA_CANNON, [0.0, 1.0]],
  [ProjectileTemplateId.FIRE_BULLETS, [0.55, 1.45]],
]);
export const SECONDARY_PROJECTILE_DIRECTIONAL: Map<number, [number, number]> = new Map([
  [SecondaryProjectileTypeId.ROCKET, [0.80, 2.00]],
  [SecondaryProjectileTypeId.HOMING_ROCKET, [0.86, 2.20]],
  [SecondaryProjectileTypeId.DETONATION, [0.0, 1.0]],
  [SecondaryProjectileTypeId.ROCKET_MINIGUN, [0.72, 1.80]],
]);
export const ION_PROJECTILE_TYPES: ReadonlySet<number> = new Set([
  ProjectileTemplateId.ION_RIFLE,
  ProjectileTemplateId.ION_MINIGUN,
]);
export const OMNI_PROJECTILE_TYPES: ReadonlySet<number> = new Set([
  ProjectileTemplateId.ION_RIFLE,
  ProjectileTemplateId.ION_MINIGUN,
  ProjectileTemplateId.PLASMA_RIFLE,
  ProjectileTemplateId.PLASMA_CANNON,
]);
// Ion beam visual pass draws only the last 256 units of streak; mirror that for tail lighting.
const _ION_TAIL_MAX_LENGTH = 256.0;
export const ION_TAIL_SAMPLES: readonly [number, number, number][] = [
  // (distance factor from head, strength factor, radius factor)
  [0.36, 0.52, 0.88],
  [0.74, 0.30, 0.68],
];
export const TUNE_PARAMS: readonly TuneParam[] = [
  new TuneParam({ key: 'ambient_darkness', label: 'ambient darkness', minimum: 0.20, maximum: 0.95, step: 0.02, coarseStep: 0.08 }),
  new TuneParam({ key: 'shadow_strength', label: 'light reveal', minimum: 0.10, maximum: 1.40, step: 0.03, coarseStep: 0.12 }),
  new TuneParam({ key: 'light_size_w', label: 'light size (w)', minimum: 0.05, maximum: 0.80, step: 0.01, coarseStep: 0.04 }),
  new TuneParam({ key: 'min_t', label: 'min t', minimum: 0.5, maximum: 24.0, step: 0.5, coarseStep: 2.0 }),
  new TuneParam({ key: 'range_scale', label: 'range scale', minimum: 0.6, maximum: 2.8, step: 0.05, coarseStep: 0.2 }),
  new TuneParam({ key: 'directional_focus', label: 'dir focus', minimum: 0.0, maximum: 2.0, step: 0.05, coarseStep: 0.2 }),
  new TuneParam({ key: 'directional_stretch', label: 'dir stretch', minimum: 0.5, maximum: 2.8, step: 0.05, coarseStep: 0.2 }),
  new TuneParam({ key: 'jitter_amount', label: 'jitter', minimum: 0.0, maximum: 5.0, step: 0.1, coarseStep: 0.5 }),
  new TuneParam({ key: 'temporal_response', label: 'temporal', minimum: 0.02, maximum: 1.0, step: 0.02, coarseStep: 0.1 }),
  new TuneParam({ key: 'rt_scale', label: 'shadow rt scale', minimum: RT_SCALE_MIN, maximum: RT_SCALE_MAX, step: 0.01, coarseStep: 0.05 }),
];
export const TUNE_DEFAULTS: Map<string, number> = new Map([
  ['ambient_darkness', DEFAULT_AMBIENT_DARKNESS],
  ['shadow_strength', DEFAULT_SHADOW_STRENGTH],
  ['light_size_w', DEFAULT_LIGHT_SIZE_W],
  ['min_t', DEFAULT_MIN_T],
  ['range_scale', DEFAULT_SHADOW_RANGE_SCALE],
  ['directional_focus', DEFAULT_DIRECTIONAL_FOCUS],
  ['directional_stretch', DEFAULT_DIRECTIONAL_STRETCH],
  ['jitter_amount', DEFAULT_JITTER_AMOUNT],
  ['temporal_response', DEFAULT_TEMPORAL_RESPONSE],
  ['rt_scale', SHADOW_RT_SCALE],
]);
export const AUTO_TUNE_PRESETS: readonly AutoTunePreset[] = [
  new AutoTunePreset({
    name: 'baseline',
    ambientDarkness: 0.78,
    shadowStrength: 1.02,
    lightSizeW: 0.30,
    minT: 3.0,
    rangeScale: 1.55,
    directionalFocus: 1.15,
    directionalStretch: 1.25,
    jitterAmount: 1.00,
    temporalResponse: 1.00,
    rtScale: 0.25,
  }),
  new AutoTunePreset({
    name: 'balanced_smooth',
    ambientDarkness: 0.75,
    shadowStrength: 1.00,
    lightSizeW: 0.34,
    minT: 2.5,
    rangeScale: 1.58,
    directionalFocus: 1.10,
    directionalStretch: 1.22,
    jitterAmount: 0.65,
    temporalResponse: 1.00,
    rtScale: 0.30,
  }),
  new AutoTunePreset({
    name: 'quality_soft',
    ambientDarkness: 0.72,
    shadowStrength: 0.98,
    lightSizeW: 0.36,
    minT: 2.2,
    rangeScale: 1.62,
    directionalFocus: 1.05,
    directionalStretch: 1.20,
    jitterAmount: 0.60,
    temporalResponse: 1.00,
    rtScale: 0.33,
  }),
  new AutoTunePreset({
    name: 'perf_balanced',
    ambientDarkness: 0.76,
    shadowStrength: 1.01,
    lightSizeW: 0.33,
    minT: 2.6,
    rangeScale: 1.52,
    directionalFocus: 1.12,
    directionalStretch: 1.22,
    jitterAmount: 0.78,
    temporalResponse: 1.00,
    rtScale: 0.30,
  }),
  new AutoTunePreset({
    name: 'long_penumbra',
    ambientDarkness: 0.74,
    shadowStrength: 0.98,
    lightSizeW: 0.39,
    minT: 2.0,
    rangeScale: 1.68,
    directionalFocus: 1.00,
    directionalStretch: 1.16,
    jitterAmount: 0.55,
    temporalResponse: 1.00,
    rtScale: 0.36,
  }),
  new AutoTunePreset({
    name: 'perf_safe',
    ambientDarkness: 0.77,
    shadowStrength: 1.00,
    lightSizeW: 0.32,
    minT: 2.9,
    rangeScale: 1.50,
    directionalFocus: 1.10,
    directionalStretch: 1.20,
    jitterAmount: 0.82,
    temporalResponse: 1.00,
    rtScale: 0.28,
  }),
];
export const AUTO_TUNE_STATIC_EMITTERS: readonly [number, number, number, number, number, number, number][] = [
  // (x, y, angle, radius, strength, focus, stretch)
  [386.0, 286.0, 0.45, 240.0, 1.00, 0.0, 1.0],
  [596.0, 322.0, 2.70, 215.0, 0.96, 1.20, 1.40],
  [522.0, 552.0, -1.25, 286.0, 1.04, 0.28, 1.10],
  [730.0, 486.0, -2.55, 206.0, 0.90, 1.45, 1.70],
];
const _SHADOW_VS_330 = `
#version 330

in vec3 vertexPosition;
in vec2 vertexTexCoord;
in vec4 vertexColor;

out vec2 fragTexCoord;
out vec4 fragColor;

uniform mat4 mvp;

void main() {
    fragTexCoord = vertexTexCoord;
    fragColor = vertexColor;
    gl_Position = mvp * vec4(vertexPosition, 1.0);
}
`;
const _SHADOW_FS_330 = `
#version 330

#define MAX_OCCLUDERS %d
#define MAX_LIGHTS %d
#define MAX_STEPS %d

in vec2 fragTexCoord;
in vec4 fragColor;
out vec4 finalColor;

uniform vec2 u_resolution;
uniform vec2 u_rt_resolution;
uniform vec2 u_camera;
uniform vec2 u_view_scale;
uniform int u_occluder_count;
uniform vec4 u_occluders[MAX_OCCLUDERS];
uniform int u_light_count;
uniform vec4 u_lights[MAX_LIGHTS];
uniform vec4 u_light_dirs[MAX_LIGHTS];
uniform float u_light_size_w;
uniform float u_shadow_strength;
uniform float u_ambient_darkness;
uniform float u_min_t;
uniform int u_jitter_phase;
uniform float u_jitter_amount;
uniform int u_debug_mode;

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float map_sdf(vec2 p) {
    float d = 1e6;
    for (int i = 0; i < MAX_OCCLUDERS; i++) {
        if (i >= u_occluder_count) {
            break;
        }
        vec3 occ = u_occluders[i].xyz;
        float cd = length(p - occ.xy) - occ.z;
        d = min(d, cd);
    }
    return d;
}

float softshadow(vec2 ro, vec2 rd, float mint, float maxt, float w) {
    float res = 1.0;
    float ph = 1e20;
    float jitter = (hash12(ro * 0.073 + rd * 17.31 + vec2(float(u_jitter_phase) * 0.123, maxt * 0.01)) - 0.5) * u_jitter_amount;
    float t = max(0.001, mint + jitter);
    for (int i = 0; i < MAX_STEPS && t < maxt; i++) {
        float h = map_sdf(ro + rd * t);
        if (h < 0.0005) {
            return 0.0;
        }
        float y = (h * h) / max(0.0001, 2.0 * ph);
        float d2 = max(0.0, h * h - y * y);
        float d = sqrt(d2);
        float penumbra = d / max(0.0001, w * max(0.0, t - y));
        res = min(res, clamp(penumbra, 0.0, 1.0));
        ph = h;
        t += clamp(h, 0.75, 32.0);
    }
    return clamp(res, 0.0, 1.0);
}

void main() {
    vec2 rt_safe = vec2(max(1.0, u_rt_resolution.x), max(1.0, u_rt_resolution.y));
    vec2 frag = (gl_FragCoord.xy / rt_safe) * u_resolution;
    // gl_FragCoord is bottom-left origin; world/screen helpers are top-left origin.
    frag.y = u_resolution.y - frag.y;
    vec2 safe_scale = vec2(max(0.0001, u_view_scale.x), max(0.0001, u_view_scale.y));
    vec2 world = vec2(frag.x / safe_scale.x - u_camera.x, frag.y / safe_scale.y - u_camera.y);

    if (u_debug_mode == 1) {
        finalColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    if (u_debug_mode == 2) {
        float a = clamp(float(u_light_count) / float(MAX_LIGHTS), 0.0, 1.0);
        finalColor = vec4(0.0, 0.0, 0.0, a);
        return;
    }
    if (u_debug_mode == 3) {
        float a = clamp(float(u_occluder_count) / float(MAX_OCCLUDERS), 0.0, 1.0);
        finalColor = vec4(0.0, 0.0, 0.0, a);
        return;
    }
    if (u_debug_mode == 4) {
        float gx = fract((world.x + 1024.0) * 0.02);
        float gy = fract((world.y + 1024.0) * 0.02);
        finalColor = vec4(0.0, 0.0, 0.0, 0.5 * (gx + gy));
        return;
    }
    if (u_debug_mode == 5) {
        float d = abs(map_sdf(world));
        float a = clamp(1.0 - d * 0.04, 0.0, 1.0);
        finalColor = vec4(0.0, 0.0, 0.0, a);
        return;
    }
    if (u_debug_mode == 6) {
        float radius = (u_light_count > 0) ? u_lights[0].z : 0.0;
        float a = clamp(radius / 512.0, 0.0, 1.0);
        finalColor = vec4(0.0, 0.0, 0.0, a);
        return;
    }
    if (u_debug_mode == 7) {
        float radius = (u_occluder_count > 0) ? u_occluders[0].z : 0.0;
        float a = clamp(radius / 256.0, 0.0, 1.0);
        finalColor = vec4(0.0, 0.0, 0.0, a);
        return;
    }

    float visibility = 0.0;
    for (int i = 0; i < MAX_LIGHTS; i++) {
        if (i >= u_light_count) {
            break;
        }
        vec4 light = u_lights[i];
        vec4 light_dir = u_light_dirs[i];
        vec2 to_light = light.xy - world;
        float dist = length(to_light);
        if (dist <= 0.0001) {
            continue;
        }
        float effective_radius = max(1.0, light.z);
        float directional = 1.0;
        float focus = clamp(light_dir.z, 0.0, 2.0);
        if (focus > 0.0001 && dot(light_dir.xy, light_dir.xy) > 0.0001) {
            vec2 out_dir = normalize(light_dir.xy);
            vec2 from_light = world - light.xy;
            vec2 from_light_dir = from_light / max(0.0001, length(from_light));
            float alignment = dot(out_dir, from_light_dir);
            float lobe = smoothstep(-0.35, 1.0, alignment);
            float focus_mix = min(1.0, focus);
            float focus_shape = 1.0 + max(0.0, focus - 1.0) * 2.0;
            directional = max(0.05, mix(1.0, pow(lobe, 1.25 * focus_shape), focus_mix));
            float stretch = max(1.0, light_dir.w);
            effective_radius *= mix(1.0, mix(1.0, stretch, lobe), focus_mix);
        }
        if (dist >= effective_radius) {
            continue;
        }
        vec2 dir = to_light / dist;
        float shadow = softshadow(world, dir, u_min_t, dist, u_light_size_w);
        float x = clamp(1.0 - dist / max(1.0, effective_radius), 0.0, 1.0);
        float attenuation = sqrt(x) * directional;
        float lit = clamp(shadow * attenuation * light.w * u_shadow_strength, 0.0, 1.0);
        // Saturating accumulation keeps overlap smooth and avoids harsh clipping.
        visibility = 1.0 - (1.0 - visibility) * (1.0 - lit);
    }

    float darkness = clamp(u_ambient_darkness * (1.0 - visibility), 0.0, 1.0);
    finalColor = vec4(0.0, 0.0, 0.0, darkness);
}
`.replace(/%[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[sdif]/, String(MAX_OCCLUDERS)).replace(/%[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[sdif]/, String(MAX_LIGHTS)).replace(/%[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[sdif]/, String(MAX_STEPS));
const _TEMPORAL_BLEND_FS_330 = `
#version 330

in vec2 fragTexCoord;
in vec4 fragColor;
out vec4 finalColor;

uniform sampler2D texture0;
uniform sampler2D u_current_tex;
uniform float u_response;

void main() {
    vec4 prev = texture(texture0, fragTexCoord);
    vec4 curr = texture(u_current_tex, fragTexCoord);
    float response = clamp(u_response, 0.0, 1.0);
    float darkness = mix(prev.a, curr.a, response);
    finalColor = vec4(0.0, 0.0, 0.0, darkness);
}
`;

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

function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0 && !Number.isNaN(value);
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length > 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size > 0;
  }
  return true;
}

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

export class LightingDebugView {
  protected _assetsRoot: string;
  protected _missingAssets: string[];
  protected _small: SmallFontData | null;
  protected _audio: AudioState | null;
  protected _audioRng: Crand;
  protected _console: ConsoleState | null;
  protected _runtime: WorldRuntime;
  protected _player: any;
  protected _aimTexture: rl.Texture | null;
  protected _profileIndex: number;
  protected _spawnPresetIndex: number;
  protected _autoEmitEnabled: boolean;
  protected _autoEmitTimer: number;
  protected _transientLights: TransientLight[];
  protected _staticSceneEnabled: boolean;
  protected _staticOccluders: CircleOccluder[];
  protected _staticEmitters: StaticEmitter[];
  protected _staticSelectedEmitter: number;
  protected _staticDrag: StaticDragState | null;
  protected _shadowEnabled: boolean;
  protected _showDebugOverlays: boolean;
  protected _showHelp: boolean;
  protected _shadowDebugMode: number;
  protected _shadowWarning: string | null;
  protected _shadowShader: rl.Shader | null;
  protected _shadowUniforms: ShadowUniforms | null;
  protected _temporalShader: rl.Shader | null;
  protected _temporalUniforms: TemporalUniforms | null;
  protected _shadowRt: rl.RenderTexture | null;
  protected _shadowAccumRt: rl.RenderTexture | null;
  protected _shadowAccumSwapRt: rl.RenderTexture | null;
  protected _shadowAccumReady: boolean;
  protected _shadowRtSize: [number, number];
  protected _lastShadowCamera: Vec2;
  protected _lastShadowViewScale: Vec2;
  protected _lastShadowResolution: Vec2;
  protected _lastShadowRtResolution: Vec2;
  protected _shadowOutputRtForPreview: rl.RenderTexture | null;
  protected _shadowFrameIndex: number;
  protected _lastShadowDrawMs: number;
  protected _lightSizeW: number;
  protected _shadowStrength: number;
  protected _ambientDarkness: number;
  protected _minT: number;
  protected _rangeScale: number;
  protected _directionalFocus: number;
  protected _directionalStretch: number;
  protected _temporalResponse: number;
  protected _jitterAmount: number;
  protected _shadowRtScale: number;
  protected _showTuningPanel: boolean;
  protected _tuneParamIndex: number;
  protected _lastOccluders: CircleOccluder[];
  protected _lastLights: ShadowLight[];
  protected _autodiagEnabled: boolean;
  protected _autodiagTotalFrames: number;
  protected _autodiagFrame: number;
  protected _autodiagNextEmitFrame: number;
  protected _autodiagSegment: number;
  protected _autodiagStarted: boolean;
  protected _dumpAllModesEnabled: boolean;
  protected _dumpModeSequence: readonly number[];
  protected _dumpModeIndex: number;
  protected _dumpModeFrame: number;
  protected _dumpModeTarget: number;
  protected _dumpTotalFrames: number;
  protected _dumpTotalFrame: number;
  protected _dumpModeEmitterTimer: number;
  protected _dumpModesStarted: boolean;
  protected _autoTuneEnabled: boolean;
  protected _autoTuneSampleFrames: number;
  protected _autoTuneStarted: boolean;
  protected _autoTunePresetIndex: number;
  protected _autoTunePresetFrame: number;
  protected _autoTuneAccum: AutoTuneAccumulator;
  protected _autoTunePrevSamples: number[] | null;
  protected _autoTuneResults: AutoTuneResult[];
  closeRequested: boolean;
  protected _paused: boolean;
  protected _screenshotRequested: boolean;
  protected _tickHarness: StandaloneTickHarness;

  get assetsRoot(): string {
    return this._assetsRoot;
  }
  get missingAssets(): string[] {
    return this._missingAssets;
  }
  get small(): SmallFontData | null {
    return this._small;
  }
  get audio(): AudioState | null {
    return this._audio;
  }
  get audioRng(): Crand {
    return this._audioRng;
  }
  get console(): ConsoleState | null {
    return this._console;
  }
  get runtime(): WorldRuntime {
    return this._runtime;
  }
  get player(): any {
    return this._player;
  }
  get aimTexture(): rl.Texture | null {
    return this._aimTexture;
  }
  get profileIndex(): number {
    return this._profileIndex;
  }
  get spawnPresetIndex(): number {
    return this._spawnPresetIndex;
  }
  get autoEmitEnabled(): boolean {
    return this._autoEmitEnabled;
  }
  get autoEmitTimer(): number {
    return this._autoEmitTimer;
  }
  get transientLights(): TransientLight[] {
    return this._transientLights;
  }
  get staticSceneEnabled(): boolean {
    return this._staticSceneEnabled;
  }
  get staticOccluders(): CircleOccluder[] {
    return this._staticOccluders;
  }
  get staticEmitters(): StaticEmitter[] {
    return this._staticEmitters;
  }
  get staticSelectedEmitter(): number {
    return this._staticSelectedEmitter;
  }
  get staticDrag(): StaticDragState | null {
    return this._staticDrag;
  }
  get shadowEnabled(): boolean {
    return this._shadowEnabled;
  }
  get showDebugOverlays(): boolean {
    return this._showDebugOverlays;
  }
  get showHelp(): boolean {
    return this._showHelp;
  }
  get shadowDebugMode(): number {
    return this._shadowDebugMode;
  }
  get shadowWarning(): string | null {
    return this._shadowWarning;
  }
  get shadowShader(): rl.Shader | null {
    return this._shadowShader;
  }
  get shadowUniforms(): ShadowUniforms | null {
    return this._shadowUniforms;
  }
  get temporalShader(): rl.Shader | null {
    return this._temporalShader;
  }
  get temporalUniforms(): TemporalUniforms | null {
    return this._temporalUniforms;
  }
  get shadowRt(): rl.RenderTexture | null {
    return this._shadowRt;
  }
  get shadowAccumRt(): rl.RenderTexture | null {
    return this._shadowAccumRt;
  }
  get shadowAccumSwapRt(): rl.RenderTexture | null {
    return this._shadowAccumSwapRt;
  }
  get shadowAccumReady(): boolean {
    return this._shadowAccumReady;
  }
  get shadowRtSize(): [number, number] {
    return this._shadowRtSize;
  }
  get lastShadowCamera(): Vec2 {
    return this._lastShadowCamera;
  }
  get lastShadowViewScale(): Vec2 {
    return this._lastShadowViewScale;
  }
  get lastShadowResolution(): Vec2 {
    return this._lastShadowResolution;
  }
  get lastShadowRtResolution(): Vec2 {
    return this._lastShadowRtResolution;
  }
  get shadowOutputRtForPreview(): rl.RenderTexture | null {
    return this._shadowOutputRtForPreview;
  }
  get shadowFrameIndex(): number {
    return this._shadowFrameIndex;
  }
  get lastShadowDrawMs(): number {
    return this._lastShadowDrawMs;
  }
  get lightSizeW(): number {
    return this._lightSizeW;
  }
  get shadowStrength(): number {
    return this._shadowStrength;
  }
  get ambientDarkness(): number {
    return this._ambientDarkness;
  }
  get minT(): number {
    return this._minT;
  }
  get rangeScale(): number {
    return this._rangeScale;
  }
  get directionalFocus(): number {
    return this._directionalFocus;
  }
  get directionalStretch(): number {
    return this._directionalStretch;
  }
  get temporalResponse(): number {
    return this._temporalResponse;
  }
  get jitterAmount(): number {
    return this._jitterAmount;
  }
  get shadowRtScale(): number {
    return this._shadowRtScale;
  }
  get showTuningPanel(): boolean {
    return this._showTuningPanel;
  }
  get tuneParamIndex(): number {
    return this._tuneParamIndex;
  }
  get lastOccluders(): CircleOccluder[] {
    return this._lastOccluders;
  }
  get lastLights(): ShadowLight[] {
    return this._lastLights;
  }
  get autodiagEnabled(): boolean {
    return this._autodiagEnabled;
  }
  get autodiagTotalFrames(): number {
    return this._autodiagTotalFrames;
  }
  get autodiagFrame(): number {
    return this._autodiagFrame;
  }
  get autodiagNextEmitFrame(): number {
    return this._autodiagNextEmitFrame;
  }
  get autodiagSegment(): number {
    return this._autodiagSegment;
  }
  get autodiagStarted(): boolean {
    return this._autodiagStarted;
  }
  get dumpAllModesEnabled(): boolean {
    return this._dumpAllModesEnabled;
  }
  get dumpModeSequence(): readonly number[] {
    return this._dumpModeSequence;
  }
  get dumpModeIndex(): number {
    return this._dumpModeIndex;
  }
  get dumpModeFrame(): number {
    return this._dumpModeFrame;
  }
  get dumpModeTarget(): number {
    return this._dumpModeTarget;
  }
  get dumpTotalFrames(): number {
    return this._dumpTotalFrames;
  }
  get dumpTotalFrame(): number {
    return this._dumpTotalFrame;
  }
  get dumpModeEmitterTimer(): number {
    return this._dumpModeEmitterTimer;
  }
  get dumpModesStarted(): boolean {
    return this._dumpModesStarted;
  }
  get autoTuneEnabled(): boolean {
    return this._autoTuneEnabled;
  }
  get autoTuneSampleFrames(): number {
    return this._autoTuneSampleFrames;
  }
  get autoTuneStarted(): boolean {
    return this._autoTuneStarted;
  }
  get autoTunePresetIndex(): number {
    return this._autoTunePresetIndex;
  }
  get autoTunePresetFrame(): number {
    return this._autoTunePresetFrame;
  }
  get autoTuneAccum(): AutoTuneAccumulator {
    return this._autoTuneAccum;
  }
  get autoTunePrevSamples(): number[] | null {
    return this._autoTunePrevSamples;
  }
  get autoTuneResults(): AutoTuneResult[] {
    return this._autoTuneResults;
  }
  get paused(): boolean {
    return this._paused;
  }
  get screenshotRequested(): boolean {
    return this._screenshotRequested;
  }
  get tickHarness(): StandaloneTickHarness {
    return this._tickHarness;
  }

  constructor(ctx: ViewContext) {
    this._assetsRoot = ctx.assetsDir;
    this._missingAssets = [];
    this._small = null;
    this._audio = null;
    this._audioRng = new Crand(0xBEEF);
    this._console = null;

    this._runtime = new WorldRuntime({ assetsDir: ctx.assetsDir, worldSize: WORLD_SIZE, preserveBugs: ctx.preserveBugs, audioRng: this._audioRng });
    this._runtime.reset({ playerCount: 1 });
    this._player = this._runtime.simWorld.players ? this._runtime.simWorld.players[0] : null;
    this._aimTexture = null;

    // Default to Ion Rifle so the first manual shot demonstrates shadows clearly.
    this._profileIndex = 1;
    this._spawnPresetIndex = 0;
    this._autoEmitEnabled = false;
    this._autoEmitTimer = 0.0;
    this._transientLights = [];
    this._staticSceneEnabled = false;
    this._staticOccluders = buildStaticOccluders();
    this._staticEmitters = [];
    this._staticSelectedEmitter = -1;
    this._staticDrag = null;

    this._shadowEnabled = true;
    this._showDebugOverlays = true;
    this._showHelp = true;
    this._shadowDebugMode = 0;
    this._shadowWarning = null;
    this._shadowShader = null;
    this._shadowUniforms = null;
    this._temporalShader = null;
    this._temporalUniforms = null;
    this._shadowRt = null;
    this._shadowAccumRt = null;
    this._shadowAccumSwapRt = null;
    this._shadowAccumReady = false;
    this._shadowRtSize = [0, 0];
    this._lastShadowCamera = new Vec2(0.0, 0.0);
    this._lastShadowViewScale = new Vec2(1.0, 1.0);
    this._lastShadowResolution = new Vec2(1.0, 1.0);
    this._lastShadowRtResolution = new Vec2(1.0, 1.0);
    this._shadowOutputRtForPreview = null;
    this._shadowFrameIndex = 0;
    this._lastShadowDrawMs = 0.0;

    this._lightSizeW = DEFAULT_LIGHT_SIZE_W;
    this._shadowStrength = DEFAULT_SHADOW_STRENGTH;
    this._ambientDarkness = DEFAULT_AMBIENT_DARKNESS;
    this._minT = DEFAULT_MIN_T;
    this._rangeScale = DEFAULT_SHADOW_RANGE_SCALE;
    this._directionalFocus = DEFAULT_DIRECTIONAL_FOCUS;
    this._directionalStretch = DEFAULT_DIRECTIONAL_STRETCH;
    this._temporalResponse = DEFAULT_TEMPORAL_RESPONSE;
    this._jitterAmount = DEFAULT_JITTER_AMOUNT;
    this._shadowRtScale = SHADOW_RT_SCALE;
    this._showTuningPanel = true;
    this._tuneParamIndex = 0;

    this._lastOccluders = [];
    this._lastLights = [];

    [this._autodiagEnabled, this._autodiagTotalFrames] = LightingDebugView._autodiagConfigFromEnv();
    this._autodiagFrame = 0;
    this._autodiagNextEmitFrame = 0;
    this._autodiagSegment = -1;
    this._autodiagStarted = false;

    this._dumpAllModesEnabled = LightingDebugView._boolEnv(DUMP_ALL_MODES_ENV);
    this._dumpModeSequence = Array.from(Array.from({ length: Math.max(0, SHADOW_DEBUG_MODE_NAMES.length) }, (_, i) => i));
    this._dumpModeIndex = 0;
    this._dumpModeFrame = 0;
    this._dumpModeTarget = Math.max(1, int(DUMP_ALL_SETTLE_FRAMES));
    this._dumpTotalFrames = 0;
    this._dumpTotalFrame = 0;
    this._dumpModeEmitterTimer = 0;
    this._dumpModesStarted = false;

    [this._autoTuneEnabled, this._autoTuneSampleFrames] = LightingDebugView._autoTuneConfigFromEnv();
    this._autoTuneStarted = false;
    this._autoTunePresetIndex = 0;
    this._autoTunePresetFrame = 0;
    this._autoTuneAccum = new AutoTuneAccumulator();
    this._autoTunePrevSamples = null;
    this._autoTuneResults = [];

    this.closeRequested = false;
    this._paused = false;
    this._screenshotRequested = false;
    this._tickHarness = new StandaloneTickHarness({ gameMode: GameMode.SURVIVAL, buildInputs: this._buildRunnerInputs?.bind(this) ?? null });
  }

  protected _loadTexture(textureId: TextureId): rl.Texture {
    return this._runtime.renderResources.resources.texture(textureId);
  }

  protected _drawWorld(opts: { drawAimIndicators?: boolean; entityAlpha?: number } = {}): void {
    const drawAimIndicators = opts.drawAimIndicators ?? true;
    const entityAlpha = opts.entityAlpha ?? 1.0;
    this._runtime.renderer.draw({
      renderFrame: this._runtime.buildRenderFrame(),
      drawAimIndicators: drawAimIndicators,
      entityAlpha: entityAlpha,
    });
  }

  worldToScreen(pos: Vec2): Vec2 {
    return this._runtime.renderer.worldToScreen(pos);
  }

  screenToWorld(pos: Vec2): Vec2 {
    return this._runtime.renderer.screenToWorld(pos);
  }

  protected static _autodiagConfigFromEnv(): [boolean, number] {
    const raw = (globalThis.process?.env?.[AUTODIAG_ENV] ?? null);
    if (raw === null || raw.trim() === '') {
      return [false, 0];
    }
    const value = raw.trim().toLowerCase();
    if (value === '0' || value === 'false' || value === 'off' || value === 'no') {
      return [false, 0];
    }
    if (value === '1' || value === 'true' || value === 'on' || value === 'yes') {
      return [true, AUTODIAG_FRAMES_DEFAULT];
    }
    let frames: number;
    try {
      frames = int(value);
    } catch (exc) {
      frames = AUTODIAG_FRAMES_DEFAULT;
    }
    return [true, Math.max(30, frames)];
  }

  protected static _autoTuneConfigFromEnv(): [boolean, number] {
    const raw = (globalThis.process?.env?.[AUTO_TUNE_ENV] ?? null);
    if (raw === null || raw.trim() === '') {
      return [false, 0];
    }
    const value = raw.trim().toLowerCase();
    if (value === '0' || value === 'false' || value === 'off' || value === 'no') {
      return [false, 0];
    }
    if (value === '1' || value === 'true' || value === 'on' || value === 'yes') {
      return [true, int(AUTO_TUNE_SAMPLE_FRAMES_DEFAULT)];
    }
    let frames: number;
    try {
      frames = int(value);
    } catch (exc) {
      frames = int(AUTO_TUNE_SAMPLE_FRAMES_DEFAULT);
    }
    return [true, Math.max(12, frames)];
  }

  protected static _boolEnv(name: string): boolean {
    const raw = (globalThis.process?.env?.[name] ?? null);
    if (raw === null) {
      return false;
    }
    const value = raw.trim().toLowerCase();
    if (value === '' || value === '0' || value === 'false' || value === 'off' || value === 'no') {
      return false;
    }
    return value === '1' || value === 'true' || value === 'on' || value === 'yes';
  }

  protected _setShadowDebugMode(mode: number): void {
    const nextMode = int(mode) % SHADOW_DEBUG_MODE_NAMES.length;
    if (nextMode === this._shadowDebugMode) {
      return;
    }
    this._shadowDebugMode = nextMode;
    // Debug mode switches should never blend history from a previous mode.
    this._invalidateShadowHistory();
  }

  protected _selectedTuneParam(): TuneParam {
    return TUNE_PARAMS[this._tuneParamIndex % TUNE_PARAMS.length];
  }

  protected static _tuneAttrName(key: string): string {
    if (key === 'rt_scale') {
      return '_shadow_rt_scale';
    }
    return `_${key}`;
  }

  protected _getTuneValue(key: string): number {
    if (key === 'rt_scale') {
      return this._shadowRtScale;
    }
    if (key === 'ambient_darkness') {
      return this._ambientDarkness;
    }
    if (key === 'shadow_strength') {
      return this._shadowStrength;
    }
    if (key === 'light_size_w') {
      return this._lightSizeW;
    }
    if (key === 'min_t') {
      return this._minT;
    }
    if (key === 'range_scale') {
      return this._rangeScale;
    }
    if (key === 'directional_focus') {
      return this._directionalFocus;
    }
    if (key === 'directional_stretch') {
      return this._directionalStretch;
    }
    if (key === 'jitter_amount') {
      return this._jitterAmount;
    }
    if (key === 'temporal_response') {
      return this._temporalResponse;
    }
    throw new Error(`unknown tune key: ${key}`);
  }

  protected _invalidateShadowHistory(): void {
    this._shadowAccumReady = false;
    this._shadowOutputRtForPreview = this._shadowRt;
  }

  protected _setTuneValue(key: string, value: number, opts: { invalidateHistory?: boolean } = {}): void {
    const invalidateHistory = opts.invalidateHistory ?? true;
    const current = this._getTuneValue(key);
    if (math.isclose(current, value, { relTol: 0.0, absTol: 1e-6 })) {
      return;
    }
    Reflect.set(this, LightingDebugView._tuneAttrName(key), value);
    if (invalidateHistory) {
      this._invalidateShadowHistory();
    }
  }

  protected _resetTuningDefaults(): void {
    for (let [key, _default] of Object.entries(TUNE_DEFAULTS)) {
      this._setTuneValue(key, _default, { invalidateHistory: key !== 'rt_scale' });
    }
    this._invalidateShadowHistory();
  }

  protected _adjustSelectedTune(direction: number): void {
    if (direction === 0) {
      return;
    }
    const param = this._selectedTuneParam();
    const shiftDown = InputState.isKeyDown(16) || InputState.isKeyDown(16);
    const step = shiftDown ? param.coarseStep : param.step;
    const nextValue = clampf(this._getTuneValue(param.key) + direction * step, param.minimum, param.maximum);
    this._setTuneValue(param.key, nextValue, { invalidateHistory: param.key !== 'rt_scale' });
    if (param.key === 'rt_scale') {
      this._shadowRtSize = [0, 0];
      this._invalidateShadowHistory();
    }
  }

  protected _dumpAllTotalFrames(): number {
    const modeCount = Math.max(1, this._dumpModeSequence.length);
    if (this._autodiagEnabled) {
      return Math.max(modeCount, int(this._autodiagTotalFrames));
    }
    return modeCount * int(DUMP_ALL_SETTLE_FRAMES);
  }

  protected _nextDumpModeTargetFrames(): number {
    const modesLeft = Math.max(1, this._dumpModeSequence.length - int(this._dumpModeIndex));
    const framesLeft = Math.max(modesLeft, int(this._dumpTotalFrames) - int(this._dumpTotalFrame));
    return Math.max(1, Math.floor(framesLeft / modesLeft));
  }

  protected _runAutodiag(): void {
    if (this._autoTuneEnabled) {
      this._runAutoTune();
      return;
    }
    if (this._dumpAllModesEnabled) {
      this._runDumpAllModes();
      return;
    }
    if (!this._autodiagEnabled) {
      return;
    }

    if (!this._autodiagStarted) {
      this._autodiagStarted = true;
      if (this._staticSceneEnabled) {
        this._setStaticSceneEnabled(false);
      }
      this._shadowEnabled = true;
      this._showDebugOverlays = true;
      this._showHelp = false;
      this._paused = false;
      this._autoEmitEnabled = false;
      this._spawnPresetRing();
      print(`[lighting-debug] autodiag start frames=${this._autodiagTotalFrames} seg=${AUTODIAG_SEGMENT_FRAMES}`);
    }

    const segment = Math.max(0, Math.floor(this._autodiagFrame / AUTODIAG_SEGMENT_FRAMES));
    if (segment !== this._autodiagSegment) {
      this._autodiagSegment = segment;
      this._profileIndex = segment % EMISSIVE_PROFILES.length;
      this._spawnPresetIndex = segment % SPAWN_PRESETS.length;
      this._spawnPresetRing();
      const mode = AUTODIAG_DEBUG_MODE_SEQUENCE[segment % AUTODIAG_DEBUG_MODE_SEQUENCE.length];
      this._setShadowDebugMode(mode);
      this._screenshotRequested = true;
      print(`[lighting-debug] autodiag segment ${segment} frame=${this._autodiagFrame} profile=${this._selectedProfile().name} mode=${this._shadowDebugMode}(${shadowDebugModeName(this._shadowDebugMode)})`);
    }

    if (this._autodiagFrame >= this._autodiagNextEmitFrame) {
      this._autodiagNextEmitFrame = this._autodiagFrame + 7;
      this._emitProfile();
    }

    this._autodiagFrame += 1;
    if (this._autodiagFrame >= this._autodiagTotalFrames) {
      this._screenshotRequested = true;
      this.closeRequested = true;
      print(`[lighting-debug] autodiag done frame=${this._autodiagFrame}`);
    }
  }

  protected _runDumpAllModes(): void {
    if (!this._dumpAllModesEnabled) {
      return;
    }
    if (this._dumpModeSequence.length === 0) {
      this.closeRequested = true;
      return;
    }

    if (!this._dumpModesStarted) {
      this._dumpModesStarted = true;
      if (this._staticSceneEnabled) {
        this._setStaticSceneEnabled(false);
      }
      this._shadowEnabled = true;
      this._showDebugOverlays = true;
      this._showHelp = false;
      this._showTuningPanel = false;
      this._paused = false;
      this._autoEmitEnabled = false;
      this._setTuneValue('temporal_response', 1.0);
      this._resetScene();
      this._profileIndex = 1;
      this._spawnPresetIndex = 0;
      this._dumpTotalFrames = this._dumpAllTotalFrames();
      this._dumpTotalFrame = 0;
      this._dumpModeFrame = 0;
      this._dumpModeIndex = 0;
      this._dumpModeTarget = this._nextDumpModeTargetFrames();
      this._dumpModeEmitterTimer = 0;
      print(`[lighting-debug] dump-all start modes=${this._dumpModeSequence.map((mode) => String(mode)).join(",")} total_frames=${this._dumpTotalFrames}`);
    }

    this._dumpModeEmitterTimer += 1;
    if (this._dumpModeEmitterTimer >= DUMP_ALL_EMIT_INTERVAL) {
      this._dumpModeEmitterTimer = 0;
      this._emitProfile();
    }

    const mode = int(this._dumpModeSequence[this._dumpModeIndex]);
    if (this._shadowDebugMode !== mode) {
      this._setShadowDebugMode(mode);
    }

    this._dumpModeFrame += 1;
    this._dumpTotalFrame += 1;
    if (this._dumpModeFrame < this._dumpModeTarget) {
      return;
    }

    this._screenshotRequested = true;
    print(`[lighting-debug] dump-all capture mode=${mode} (${shadowDebugModeName(mode)})`);
    this._dumpModeFrame = 0;
    this._dumpModeIndex += 1;
    if (this._dumpModeIndex >= this._dumpModeSequence.length) {
      this._screenshotRequested = true;
      this.closeRequested = true;
      print('[lighting-debug] dump-all done');
      return;
    }
    this._dumpModeTarget = this._nextDumpModeTargetFrames();
  }

  protected _applyAutoTunePreset(preset: AutoTunePreset): void {
    for (let [key, value] of preset.asTuneValues().items()) {
      this._setTuneValue(key, value, { invalidateHistory: key !== 'rt_scale' });
      if (key === 'rt_scale') {
        this._shadowRtSize = [0, 0];
      }
    }
    this._invalidateShadowHistory();
  }

  protected _seedAutoTuneScene(): void {
    this._staticEmitters = [];
    for (let [x, y, angle, radius, strength, focus, stretch] of AUTO_TUNE_STATIC_EMITTERS) {
      this._staticEmitters.push(new StaticEmitter({ pos: new Vec2(x, y), angle: angle, radius: clampf(radius, STATIC_LIGHT_RADIUS_MIN, STATIC_LIGHT_RADIUS_MAX), strength: clampf(strength, STATIC_LIGHT_STRENGTH_MIN, STATIC_LIGHT_STRENGTH_MAX), focus: clampf(focus, STATIC_LIGHT_FOCUS_MIN, STATIC_LIGHT_FOCUS_MAX), stretch: clampf(stretch, STATIC_LIGHT_STRETCH_MIN, STATIC_LIGHT_STRETCH_MAX) }));
    }
    this._staticSelectedEmitter = this._staticEmitters.length > 0 ? 0 : -1;
    this._staticDrag = null;
    this._invalidateShadowHistory();
  }

  protected _startAutoTune(): void {
    this._autoTuneStarted = true;
    this._autoTuneResults = [];
    this._autoTunePresetIndex = 0;
    this._autoTunePresetFrame = 0;
    this._autoTuneAccum = new AutoTuneAccumulator();
    this._autoTunePrevSamples = null;

    this._shadowEnabled = true;
    this._showDebugOverlays = false;
    this._showHelp = false;
    this._showTuningPanel = false;
    this._paused = false;
    this._autoEmitEnabled = false;
    this._setShadowDebugMode(0);
    if (!this._staticSceneEnabled) {
      this._setStaticSceneEnabled(true);
    }
    this._seedAutoTuneScene();

    const preset = AUTO_TUNE_PRESETS[0];
    this._applyAutoTunePreset(preset);
    print(`[lighting-debug] autotune start presets=${AUTO_TUNE_PRESETS.length} warmup=${AUTO_TUNE_WARMUP_FRAMES} sample=${this._autoTuneSampleFrames}`);
    print(`[lighting-debug] autotune preset=1/${AUTO_TUNE_PRESETS.length} name=${preset.name}`);
  }

  protected _runAutoTune(): void {
    if (!this._autoTuneEnabled) {
      return;
    }
    if (AUTO_TUNE_PRESETS.length === 0) {
      this._autoTuneEnabled = false;
      return;
    }
    if (!this._autoTuneStarted) {
      this._startAutoTune();
    }
  }

  protected _shadowRtAlphaGrid(opts: { rt: rl.RenderTexture; maxSide?: number }): [number[], number, number] | null {
    const rt = opts.rt;
    const maxSide = opts.maxSide ?? AUTO_TUNE_METRIC_GRID;
    if (!renderTextureValid(rt)) {
      return null;
    }
    const image = wgl.loadImageFromTexture(rt.texture);
    let width: ReturnType<typeof Math.max>;
    let height: ReturnType<typeof Math.max>;
    let stepX: ReturnType<typeof Math.max>;
    let stepY: ReturnType<typeof Math.max>;
    let xs: ReturnType<typeof Array.from>;
    let ys: ReturnType<typeof Array.from>;
    let values: number[];
    try {
      width = Math.max(1, int(image.width));
      height = Math.max(1, int(image.height));
      stepX = Math.max(1, Math.floor(width / Math.max(1, int(maxSide))));
      stepY = Math.max(1, Math.floor(height / Math.max(1, int(maxSide))));
      xs = Array.from(Array.from({ length: Math.max(0, Math.ceil((width - 0) / stepX)) }, (_, i) => 0 + i * stepX));
      ys = Array.from(Array.from({ length: Math.max(0, Math.ceil((height - 0) / stepY)) }, (_, i) => 0 + i * stepY));
      if (xs.length === 0 || ys.length === 0) {
        return null;
      }
      const sampleW = xs.length;
      const sampleH = ys.length;
      values = [];
      for (const y of ys) {
        for (const x of xs) {
          values.push(int(wgl.getImageColor(image, x, y).a));
        }
      }
      return [values, sampleW, sampleH];
    } finally {
      wgl.unloadImage(image);
    }
  }

  protected _autoTuneCaptureFrame(outputRt: rl.RenderTexture | null): void {
    if (!this._autoTuneEnabled || !this._autoTuneStarted) {
      return;
    }
    if (this._autoTunePresetIndex >= AUTO_TUNE_PRESETS.length) {
      return;
    }

    this._autoTunePresetFrame += 1;
    if (this._autoTunePresetFrame <= int(AUTO_TUNE_WARMUP_FRAMES)) {
      return;
    }
    if (outputRt === null) {
      return;
    }

    const sampled = this._shadowRtAlphaGrid({ rt: outputRt });
    if (sampled === null) {
      return;
    }
    const [alphaValues, sampleW, sampleH] = sampled;
    const metrics = shadowFrameMetrics(alphaValues, sampleW, sampleH);
    if (metrics === null) {
      return;
    }

    this._autoTuneAccum.sampleCount += 1;
    this._autoTuneAccum.shadowMsSum += this._lastShadowDrawMs;
    this._autoTuneAccum.meanSum += metrics.meanAlpha;
    this._autoTuneAccum.stdSum += metrics.stdAlpha;
    this._autoTuneAccum.contrastSum += metrics.contrast;
    this._autoTuneAccum.coverageSum += metrics.coverage;
    this._autoTuneAccum.bandingSum += metrics.banding;

    let diffTotal: number;
    if (this._autoTunePrevSamples !== null && this._autoTunePrevSamples.length === alphaValues.length) {
      diffTotal = 0.0;
      const _zip1662_0 = Array.from(this._autoTunePrevSamples);
      const _zip1662_1 = Array.from(alphaValues);
      for (let _zipIndex1662 = 0; _zipIndex1662 < Math.min(_zip1662_0.length, _zip1662_1.length); _zipIndex1662++) {
        let prev = _zip1662_0[_zipIndex1662];
        let curr = _zip1662_1[_zipIndex1662];
        diffTotal += Math.abs(curr - prev);
      }
      this._autoTuneAccum.flickerSum += diffTotal / alphaValues.length;
      this._autoTuneAccum.flickerCount += 1;
    }
    this._autoTunePrevSamples = Array.from(alphaValues);

    if (this._autoTuneAccum.sampleCount < int(this._autoTuneSampleFrames)) {
      return;
    }
    this._autoTuneFinalizePreset();
  }

  protected _autoTuneFinalizePreset(): void {
    if (this._autoTunePresetIndex >= AUTO_TUNE_PRESETS.length) {
      return;
    }
    const preset = AUTO_TUNE_PRESETS[this._autoTunePresetIndex];
    const accum = this._autoTuneAccum;
    const sampleCount = Math.max(1, int(accum.sampleCount));
    const flickerCount = Math.max(1, int(accum.flickerCount));
    const metrics = new ShadowFrameMetrics({ meanAlpha: accum.meanSum / sampleCount, stdAlpha: accum.stdSum / sampleCount, contrast: accum.contrastSum / sampleCount, coverage: accum.coverageSum / sampleCount, banding: accum.bandingSum / sampleCount });
    const avgShadowMs = accum.shadowMsSum / sampleCount;
    const avgFlicker = accum.flickerSum / flickerCount;
    const score = shadowQualityScore(metrics, { shadowMs: avgShadowMs, flicker: avgFlicker });
    const result = new AutoTuneResult({ preset: preset, score: score, shadowMs: avgShadowMs, meanAlpha: metrics.meanAlpha, stdAlpha: metrics.stdAlpha, contrast: metrics.contrast, coverage: metrics.coverage, banding: metrics.banding, flicker: avgFlicker });
    this._autoTuneResults.push(result);

    print(`[lighting-debug] autotune result name=${preset.name} score=${result.score.toFixed(3)} shadow_ms=${result.shadowMs.toFixed(3)} mean=${result.meanAlpha.toFixed(1)} std=${result.stdAlpha.toFixed(1)} contrast=${result.contrast.toFixed(3)} coverage=${result.coverage.toFixed(3)} banding=${result.banding.toFixed(3)} flicker=${result.flicker.toFixed(2)}`);
    this._screenshotRequested = true;

    this._autoTunePresetIndex += 1;
    if (this._autoTunePresetIndex >= AUTO_TUNE_PRESETS.length) {
      this._autoTuneEnabled = false;
      this._autoTuneStarted = false;
      if (this._autoTuneResults.length === 0) {
        this.closeRequested = true;
        return;
      }
      const ranked = Array.from(this._autoTuneResults).sort((left, right) => -1 * pythonCompareKeys(autoTuneSelectionScore(left), autoTuneSelectionScore(right)));
      for (const [rank, item] of Array.from(ranked, (item, index) => [index + 1, item] as const)) {
        print(`[lighting-debug] autotune rank ${rank}/${ranked.length} name=${item.preset.name} score=${item.score.toFixed(3)} select=${(autoTuneSelectionScore(item)).toFixed(3)} shadow_ms=${item.shadowMs.toFixed(3)} banding=${item.banding.toFixed(3)}`);
      }
      const best = ranked[0];
      this._applyAutoTunePreset(best.preset);
      print(`[lighting-debug] autotune best name=${best.preset.name} score=${best.score.toFixed(3)} values=ambient=${best.preset.ambientDarkness.toFixed(3)} reveal=${best.preset.shadowStrength.toFixed(3)} light_w=${best.preset.lightSizeW.toFixed(3)} min_t=${best.preset.minT.toFixed(3)} range=${best.preset.rangeScale.toFixed(3)} dir_focus=${best.preset.directionalFocus.toFixed(3)} dir_stretch=${best.preset.directionalStretch.toFixed(3)} jitter=${best.preset.jitterAmount.toFixed(3)} temporal=${best.preset.temporalResponse.toFixed(3)} rt_scale=${best.preset.rtScale.toFixed(3)}`);
      this._screenshotRequested = true;
      this.closeRequested = true;
      return;
    }

    this._autoTunePresetFrame = 0;
    this._autoTuneAccum = new AutoTuneAccumulator();
    this._autoTunePrevSamples = null;
    const nextPreset = AUTO_TUNE_PRESETS[this._autoTunePresetIndex];
    this._applyAutoTunePreset(nextPreset);
    print(`[lighting-debug] autotune preset=${this._autoTunePresetIndex + 1}/${AUTO_TUNE_PRESETS.length} name=${nextPreset.name}`);
  }

  protected _shadowRtAlphaStats(): [number, number, number] | null {
    const rt = this._shadowRt;
    if (rt === null || !renderTextureValid(rt)) {
      return null;
    }
    const sampled = this._shadowRtAlphaGrid({ rt: rt, maxSide: 64 });
    if (sampled === null) {
      return null;
    }
    const [alphaValues, sampleW, sampleH] = sampled;
    if (!alphaValues) {
      return null;
    }
    const minAlpha = Math.min(...alphaValues);
    const maxAlpha = Math.max(...alphaValues);
    const avg = alphaValues.reduce((total, alpha) => total + alpha, 0) / alphaValues.length;
    return [int(minAlpha), avg, int(maxAlpha)];
  }

  protected _autodiagLogShadowStats(): void {
    if (!this._autodiagEnabled) {
      return;
    }
    if (this._autodiagFrame <= 0) {
      return;
    }
    const frame = this._autodiagFrame;
    if (frame % AUTODIAG_LOG_INTERVAL !== 0 && frame !== this._autodiagTotalFrames) {
      return;
    }
    const stats = this._shadowRtAlphaStats();
    if (stats === null) {
      print(`[lighting-debug] frame=${frame} alpha=unavailable`);
      return;
    }
    const [minAlpha, avgAlpha, maxAlpha] = stats;
    print(`[lighting-debug] frame=${frame} mode=${this._shadowDebugMode}(${shadowDebugModeName(this._shadowDebugMode)}) occ=${this._lastOccluders.length} lights=${this._lastLights.length} cam=(${this._lastShadowCamera.x.toFixed(2)},${this._lastShadowCamera.y.toFixed(2)}) scale=(${this._lastShadowViewScale.x.toFixed(4)},${this._lastShadowViewScale.y.toFixed(4)}) res=(${this._lastShadowResolution.x.toFixed(0)},${this._lastShadowResolution.y.toFixed(0)}) rt=(${this._lastShadowRtResolution.x.toFixed(0)},${this._lastShadowRtResolution.y.toFixed(0)}) alpha(min/avg/max)=(${minAlpha},${avgAlpha.toFixed(1)},${maxAlpha})`);
  }

  protected _selectedProfile(): EmissiveProfile {
    return EMISSIVE_PROFILES[this._profileIndex % EMISSIVE_PROFILES.length];
  }

  protected _selectedSpawnPreset(): SpawnPreset {
    return SPAWN_PRESETS[this._spawnPresetIndex % SPAWN_PRESETS.length];
  }

  protected _applyDebugPlayerCheats(): void {
    if (this._player === null) {
      return;
    }
    this._player.speedMultiplier = PLAYER_SPEED_MULTIPLIER;
    this._player.shieldTimer = PLAYER_INVULNERABLE_SHIELD_TIMER;
  }

  protected _clearSceneContents(): void {
    this._runtime.simWorld.creatures.reset();
    this._runtime.simWorld.state.projectiles.reset();
    this._runtime.simWorld.state.secondaryProjectiles.reset();
    this._runtime.simWorld.state.particles.reset();
    this._runtime.simWorld.state.spriteEffects.reset();
    this._runtime.simWorld.state.effects.reset();
    this._runtime.simWorld.state.bonusPool.reset();
    this._runtime.renderResources.clearPendingTerrainFx();
    this._transientLights.length = 0;
    this._invalidateShadowHistory();
  }

  protected static _clampWorldPos(pos: Vec2, opts: { margin?: number } = {}): Vec2 {
    const margin = opts.margin ?? 12.0;
    return pos.clampRect(margin, margin, WORLD_SIZE - margin, WORLD_SIZE - margin);
  }

  protected static _mouseScreen(): Vec2 {
    return Vec2.fromXY((() => { const [x, y] = InputState.mousePosition(); return { x, y }; })());
  }

  protected _mouseWorld(): Vec2 {
    return this.screenToWorld(LightingDebugView._mouseScreen());
  }

  protected _setStaticSceneEnabled(enabled: boolean): void {
    const nextEnabled = enabled;
    if (this._staticSceneEnabled === nextEnabled) {
      return;
    }
    this._staticSceneEnabled = nextEnabled;
    this._staticDrag = null;
    this._staticSelectedEmitter = -1;
    this._autoEmitEnabled = false;
    this._autoEmitTimer = 0.0;
    this._invalidateShadowHistory();

    if (this._staticSceneEnabled) {
      this._clearSceneContents();
      this._seedStaticScene();
      this._runtime.updateCamera(0.0);
      return;
    }

    this._resetScene();
  }

  protected _seedStaticScene(): void {
    this._staticEmitters = [];
    const profile = this._selectedProfile();
    const [radius, strength, focus, stretch] = profileLightDefaults(profile);
    this._staticEmitters.push(new StaticEmitter({ pos: new Vec2(510.0, 400.0), angle: -2.55, radius: clampf(radius, STATIC_LIGHT_RADIUS_MIN, STATIC_LIGHT_RADIUS_MAX), strength: clampf(strength, STATIC_LIGHT_STRENGTH_MIN, STATIC_LIGHT_STRENGTH_MAX), focus: clampf(focus, STATIC_LIGHT_FOCUS_MIN, STATIC_LIGHT_FOCUS_MAX), stretch: clampf(stretch, STATIC_LIGHT_STRETCH_MIN, STATIC_LIGHT_STRETCH_MAX) }));
    this._staticSelectedEmitter = 0;
  }

  protected _makeStaticEmitter(pos: Vec2): StaticEmitter {
    const profile = this._selectedProfile();
    const [radius, strength, focus, stretch] = profileLightDefaults(profile);
    return new StaticEmitter({ pos: LightingDebugView._clampWorldPos(pos), angle: 0.0, radius: clampf(radius, STATIC_LIGHT_RADIUS_MIN, STATIC_LIGHT_RADIUS_MAX), strength: clampf(strength, STATIC_LIGHT_STRENGTH_MIN, STATIC_LIGHT_STRENGTH_MAX), focus: clampf(focus, STATIC_LIGHT_FOCUS_MIN, STATIC_LIGHT_FOCUS_MAX), stretch: clampf(stretch, STATIC_LIGHT_STRETCH_MIN, STATIC_LIGHT_STRETCH_MAX) });
  }

  protected _staticHandlePositions(emitter: StaticEmitter): Map<string, Vec2> {
    const dirVec = Vec2.fromHeading(emitter.angle);
    const dirLen = Math.max(24.0, Math.min(emitter.radius * 0.55, 180.0));
    return { 'move': emitter.pos, 'radius': emitter.pos.add(new Vec2(emitter.radius, 0.0)), 'direction': emitter.pos.add(dirVec.mul(dirLen)), 'strength': emitter.pos.add(new Vec2(0.0, -34.0)), 'stretch': emitter.pos.add(new Vec2(0.0, 34.0)) };
  }

  protected _nearestStaticEmitter(mouseScreen: Vec2, opts: { maxDistPx: number }): number {
    const maxDistPx = opts.maxDistPx;
    if (this._staticEmitters.length === 0) {
      return -1;
    }
    let bestIndex = -1;
    let bestD2 = maxDistPx * maxDistPx;
    for (const [idx, emitter] of this._staticEmitters.entries()) {
      const screen = this.worldToScreen(emitter.pos);
      const d2 = screenDistanceSq(screen, mouseScreen);
      if (d2 <= bestD2) {
        bestD2 = d2;
        bestIndex = idx;
      }
    }
    return bestIndex;
  }

  protected _setStaticEmitter(index: number, emitter: StaticEmitter): void {
    if (index >= 0 && index < this._staticEmitters.length) {
      this._staticEmitters[index] = emitter;
      this._invalidateShadowHistory();
    }
  }

  protected _placeStaticEmitterAtMouse(): void {
    const pos = this._mouseWorld();
    this._staticEmitters.push(this._makeStaticEmitter(pos));
    if (this._staticEmitters.length > MAX_LIGHTS) {
      this._staticEmitters = this._staticEmitters.slice(-MAX_LIGHTS);
    }
    this._staticSelectedEmitter = this._staticEmitters.length - 1;
    this._invalidateShadowHistory();
  }

  protected _removeStaticEmitterAtMouse(): void {
    const mouseScreen = LightingDebugView._mouseScreen();
    const idx = this._nearestStaticEmitter(mouseScreen, { maxDistPx: 18.0 });
    if (idx < 0) {
      return;
    }
    delete this._staticEmitters[idx];
    if (this._staticEmitters.length === 0) {
      this._staticSelectedEmitter = -1;
    } else {
      this._staticSelectedEmitter = Math.max(0, Math.min(this._staticSelectedEmitter, this._staticEmitters.length - 1));
    }
    this._invalidateShadowHistory();
  }

  protected _beginStaticDrag(opts: { kind: string; index: number }): void {
    const kind = opts.kind;
    const index = opts.index;
    if (!(index >= 0 && index < this._staticEmitters.length)) {
      this._staticDrag = null;
      return;
    }
    const emitter = this._staticEmitters[index];
    const mouseWorld = this._mouseWorld();
    const mouseScreen = LightingDebugView._mouseScreen();
    let valueStart = 0.0;
    if (kind === 'strength') {
      valueStart = emitter.strength;
    } else if (kind === 'stretch') {
      valueStart = emitter.stretch;
    }
    this._staticDrag = new StaticDragState({ kind: kind, emitterIndex: int(index), mouseStartWorld: mouseWorld, mouseStartScreen: mouseScreen, posOffset: emitter.pos.sub(mouseWorld), valueStart: valueStart });
  }

  protected _updateStaticDrag(): void {
    const drag = this._staticDrag;
    if (drag === null) {
      return;
    }
    if (!InputState.isMouseButtonDown(0)) {
      this._staticDrag = null;
      return;
    }
    const index = int(drag.emitterIndex);
    if (!(index >= 0 && index < this._staticEmitters.length)) {
      this._staticDrag = null;
      return;
    }
    const emitter = this._staticEmitters[index];
    const mouseWorld = this._mouseWorld();
    const mouseScreen = LightingDebugView._mouseScreen();

    const kind = drag.kind;
    if (kind === 'move') {
      const nextPos = LightingDebugView._clampWorldPos(mouseWorld.add(drag.posOffset));
      this._setStaticEmitter(index, new StaticEmitter({ pos: nextPos, angle: emitter.angle, radius: emitter.radius, strength: emitter.strength, focus: emitter.focus, stretch: emitter.stretch }));
      return;
    }
    let radius!: number;
    if (kind === 'radius') {
      radius = clampf((mouseWorld.sub(emitter.pos)).length(), STATIC_LIGHT_RADIUS_MIN, STATIC_LIGHT_RADIUS_MAX);
      this._setStaticEmitter(index, new StaticEmitter({ pos: emitter.pos, angle: emitter.angle, radius: radius, strength: emitter.strength, focus: emitter.focus, stretch: emitter.stretch }));
      return;
    }
    if (kind === 'direction') {
      const delta = mouseWorld.sub(emitter.pos);
      const length = delta.length();
      if (length > 1e-4) {
        const angle = delta.toHeading();
        const focus = clampf(length / Math.max(1.0, emitter.radius * 0.55), STATIC_LIGHT_FOCUS_MIN, STATIC_LIGHT_FOCUS_MAX);
        this._setStaticEmitter(index, new StaticEmitter({ pos: emitter.pos, angle: angle, radius: emitter.radius, strength: emitter.strength, focus: focus, stretch: emitter.stretch }));
      }
      return;
    }
    let deltaX: number;
    let strength!: number;
    if (kind === 'strength') {
      deltaX = (mouseScreen.x - drag.mouseStartScreen.x);
      strength = clampf(drag.valueStart + deltaX * 0.010, STATIC_LIGHT_STRENGTH_MIN, STATIC_LIGHT_STRENGTH_MAX);
      this._setStaticEmitter(index, new StaticEmitter({ pos: emitter.pos, angle: emitter.angle, radius: emitter.radius, strength: strength, focus: emitter.focus, stretch: emitter.stretch }));
      return;
    }
    if (kind === 'stretch') {
      deltaX = (mouseScreen.x - drag.mouseStartScreen.x);
      const stretch = clampf(drag.valueStart + deltaX * 0.010, STATIC_LIGHT_STRETCH_MIN, STATIC_LIGHT_STRETCH_MAX);
      this._setStaticEmitter(index, new StaticEmitter({ pos: emitter.pos, angle: emitter.angle, radius: emitter.radius, strength: emitter.strength, focus: emitter.focus, stretch: stretch }));
      return;
    }

    this._staticDrag = null;
  }

  protected _handleStaticMouseInput(): void {
    this._updateStaticDrag();
    if (!InputState.wasMouseButtonPressed(0)) {
      return;
    }

    const mouseScreen = LightingDebugView._mouseScreen();
    const hitRadiusSq = STATIC_HANDLE_HIT_RADIUS_PX * STATIC_HANDLE_HIT_RADIUS_PX;

    const selected = this._staticSelectedEmitter;
    if (selected >= 0 && selected < this._staticEmitters.length) {
      const emitter = this._staticEmitters[selected];
      const handles = this._staticHandlePositions(emitter);
      for (const kind of ['move', 'radius', 'direction', 'strength', 'stretch']) {
        const screen = this.worldToScreen(handles[kind]);
        if (screenDistanceSq(screen, mouseScreen) <= hitRadiusSq) {
          this._beginStaticDrag({ kind: kind, index: selected });
          return;
        }
      }
    }

    const nearest = this._nearestStaticEmitter(mouseScreen, { maxDistPx: STATIC_HANDLE_HIT_RADIUS_PX });
    if (nearest >= 0) {
      this._staticSelectedEmitter = nearest;
      this._beginStaticDrag({ kind: 'move', index: nearest });
      return;
    }

    this._placeStaticEmitterAtMouse();
    this._beginStaticDrag({ kind: 'move', index: this._staticSelectedEmitter });
  }

  protected _collectStaticShadowState(): void {
    const occluders = this._staticOccluders.slice(0, MAX_OCCLUDERS);
    this._lastOccluders = Array.from(occluders).map((occ) => new CircleOccluder({ pos: new Vec2(occ.pos.x, occ.pos.y), radius: occ.radius }));

    const lights: ShadowLight[] = [];
    for (const emitter of this._staticEmitters) {
      if (lights.length >= MAX_LIGHTS) {
        break;
      }
      const dirVec = Vec2.fromHeading(emitter.angle);
      const radius = Math.min(STATIC_LIGHT_RADIUS_MAX, emitter.radius * this._rangeScale);
      const focus = clampf(emitter.focus * this._directionalFocus, 0.0, 2.0);
      const stretch = clampf(emitter.stretch * this._directionalStretch, 1.0, 6.0);
      lights.push(new ShadowLight({ pos: new Vec2(emitter.pos.x, emitter.pos.y), radius: radius, strength: clampf(emitter.strength, STATIC_LIGHT_STRENGTH_MIN, STATIC_LIGHT_STRENGTH_MAX), dirX: dirVec.x, dirY: dirVec.y, focus: focus, stretch: stretch }));
    }
    this._lastLights = lights;
  }

  protected _resetScene(): void {
    this._runtime.reset({ seed: 0xBEEF, playerCount: 1, spawnPos: WORLD_CENTER });
    this._resetTickRunner();
    this._player = this._runtime.simWorld.players ? this._runtime.simWorld.players[0] : null;
    this._applyDebugPlayerCheats();
    this._clearSceneContents();
    this._staticEmitters = [];
    this._staticSelectedEmitter = -1;
    this._staticDrag = null;
    // Seed a default occluder ring so shadows are visible immediately on first emission.
    this._spawnPresetRing();
    this._autoEmitTimer = 0.0;
    this._shadowFrameIndex = 0;
    this._runtime.updateCamera(0.0);
  }

  protected _buildInput(): PlayerInput {
    const move = new Vec2(((InputState.isKeyDown(68) ? 1 : 0)) - ((InputState.isKeyDown(65) ? 1 : 0)), ((InputState.isKeyDown(83) ? 1 : 0)) - ((InputState.isKeyDown(87) ? 1 : 0)));
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const aim = this.screenToWorld(Vec2.fromXY(mouse));
    return new PlayerInput({ move: move, aim: aim, fireDown: false, firePressed: false, reloadPressed: false });
  }

  protected _buildRunnerInputs(frameCtx: FrameContext): PlayerInput[] {
    const _ = frameCtx;
    return [this._buildInput()];
  }

  protected _resetTickRunner(): void {
    this._tickHarness.reset();
  }

  protected static _burstAngle(profile: EmissiveProfile, index: number): number {
    const count = Math.max(1, int(profile.burstCount));
    const center = (count - 1.0) * 0.5;
    return (index - center) * profile.spreadRad;
  }

  protected _emitProfile(): void {
    const player = this._player;
    if (player === null) {
      return;
    }
    const profile = this._selectedProfile();

    const aimDelta = player.aim.sub(player.pos);
    let [aimDir, aimLen] = aimDelta.normalizedWithLength();
    if (aimLen <= 1e-5) {
      aimDir = new Vec2(1.0, 0.0);
    }
    const heading = aimDir.toHeading();
    const muzzlePos = (player.pos.add(aimDir.mul(profile.spawnDistance))).clampRect(8.0, 8.0, WORLD_SIZE - 8.0, WORLD_SIZE - 8.0);

    if (profile.secondaryTypeId === SecondaryProjectileTypeId.DETONATION) {
      const impact = (player.pos.add(aimDir.mul(profile.explosionDistance))).clampRect(16.0, 16.0, WORLD_SIZE - 16.0, WORLD_SIZE - 16.0);
      this._runtime.simWorld.state.secondaryProjectiles.spawnFromSpec(new SecondarySpawnSpec({ pos: impact, angle: heading, typeId: SecondaryProjectileTypeId.DETONATION, owner: OwnerRef.fromLocalPlayer(0), timeToLive: profile.secondaryTtl }));
      this._pushTransientLight(
        impact,
        { radius: profile.flashRadius, ttl: profile.flashTtl, strength: profile.flashStrength },
      );
      this._pushTransientLight(
        muzzlePos,
        { radius: Math.max(80.0, profile.flashRadius * 0.4), ttl: Math.max(0.08, profile.flashTtl * 0.7), strength: Math.max(0.5, profile.flashStrength * 0.65) },
      );
      return;
    }

    const count = Math.max(1, int(profile.burstCount));
    for (let i = 0; i < count; i++) {
      const angle = heading + LightingDebugView._burstAngle(profile, i);
      if (profile.primaryTypeId !== null) {
        this._runtime.simWorld.state.projectiles.spawn({
          pos: muzzlePos,
          angle: angle,
          typeId: profile.primaryTypeId,
          owner: OwnerRef.fromLocalPlayer(0),
        });
      }
      if (profile.secondaryTypeId !== null) {
        this._runtime.simWorld.state.secondaryProjectiles.spawnFromSpec(new SecondarySpawnSpec({ pos: muzzlePos, angle: angle, typeId: profile.secondaryTypeId, owner: OwnerRef.fromLocalPlayer(0), timeToLive: profile.secondaryTtl, creatures: this._runtime.simWorld.creatures.entries, targetHint: player.aim }));
      }
    }

    this._pushTransientLight(
      muzzlePos,
      { radius: profile.flashRadius, ttl: profile.flashTtl, strength: profile.flashStrength },
    );
  }

  protected _pushTransientLight(pos: Vec2, opts: { radius: number; ttl: number; strength: number }): void {
    const radius = opts.radius;
    const ttl = opts.ttl;
    const strength = opts.strength;
    const light = new TransientLight({ pos: new Vec2(pos.x, pos.y), radius: Math.max(1.0, radius), strength: Math.max(0.0, strength), ttl: Math.max(1e-3, ttl), age: 0.0 });
    this._transientLights.push(light);
    if (this._transientLights.length > 64) {
      this._transientLights = this._transientLights.slice(-64);
    }
  }

  protected _spawnPresetRing(): void {
    const player = this._player;
    if (player === null) {
      return;
    }
    const preset = this._selectedSpawnPreset();
    const count = Math.max(1, int(preset.ringCount));
    for (let idx = 0; idx < count; idx++) {
      const angle = idx / count * (Math.PI * 2.0);
      const pos = (player.pos.add(Vec2.fromAngle(angle).mul(ENEMY_RING_RADIUS))).clampRect(48.0, 48.0, WORLD_SIZE - 48.0, WORLD_SIZE - 48.0);
      const heading = angle + Math.PI;
      this._runtime.simWorld.creatures.spawnTemplate(preset.spawnId, pos, heading, this._runtime.simWorld.state.rng);
    }
  }

  protected _clearSpawnedEnemies(): void {
    this._runtime.simWorld.creatures.reset();
  }

  protected _handleDebugInput(): void {
    if (InputState.wasKeyPressed(27)) {
      this.closeRequested = true;
    }
    if (InputState.wasKeyPressed(32)) {
      this._paused = !this._paused;
    }
    if (InputState.wasKeyPressed(72)) {
      this._showHelp = !this._showHelp;
    }
    if (InputState.wasKeyPressed(113)) {
      this._shadowEnabled = !this._shadowEnabled;
    }
    if (InputState.wasKeyPressed(114)) {
      this._showDebugOverlays = !this._showDebugOverlays;
    }
    if (InputState.wasKeyPressed(115) && !this._staticSceneEnabled) {
      this._autoEmitEnabled = !this._autoEmitEnabled;
      this._autoEmitTimer = 0.0;
    }
    if (InputState.wasKeyPressed(116)) {
      this._setStaticSceneEnabled(!this._staticSceneEnabled);
    }
    if (InputState.wasKeyPressed(117)) {
      this._setShadowDebugMode(this._shadowDebugMode + 1);
    }
    if (InputState.wasKeyPressed(118)) {
      this._resetTuningDefaults();
    }
    if (InputState.wasKeyPressed(119)) {
      this._showTuningPanel = !this._showTuningPanel;
    }
    if (InputState.wasKeyPressed(120)) {
      if (this._autoTuneEnabled) {
        this._autoTuneEnabled = false;
        this._autoTuneStarted = false;
      } else {
        this._autoTuneEnabled = true;
        this._autoTuneStarted = false;
        this._autoTuneSampleFrames = int(AUTO_TUNE_SAMPLE_FRAMES_DEFAULT);
      }
    }

    if (InputState.wasKeyPressed(84)) {
      this._tuneParamIndex = (((this._tuneParamIndex + 1) % TUNE_PARAMS.length) + TUNE_PARAMS.length) % TUNE_PARAMS.length;
    }
    if (InputState.wasKeyPressed(189)) {
      this._adjustSelectedTune(-1);
    }
    if (InputState.wasKeyPressed(187)) {
      this._adjustSelectedTune(+1);
    }
    if (InputState.wasKeyPressed(48)) {
      const param = this._selectedTuneParam();
      const _default = TUNE_DEFAULTS.get(param.key) ?? null;
      if (_default !== null) {
        this._setTuneValue(param.key, _default, { invalidateHistory: param.key !== 'rt_scale' });
        if (param.key === 'rt_scale') {
          this._shadowRtSize = [0, 0];
          this._invalidateShadowHistory();
        }
      }
    }

    if (InputState.wasKeyPressed(219)) {
      this._profileIndex = (((this._profileIndex - 1) % EMISSIVE_PROFILES.length) + EMISSIVE_PROFILES.length) % EMISSIVE_PROFILES.length;
      this._autoEmitTimer = 0.0;
    }
    if (InputState.wasKeyPressed(221)) {
      this._profileIndex = (((this._profileIndex + 1) % EMISSIVE_PROFILES.length) + EMISSIVE_PROFILES.length) % EMISSIVE_PROFILES.length;
      this._autoEmitTimer = 0.0;
    }

    if (InputState.wasKeyPressed(188)) {
      this._spawnPresetIndex = (((this._spawnPresetIndex - 1) % SPAWN_PRESETS.length) + SPAWN_PRESETS.length) % SPAWN_PRESETS.length;
    }
    if (InputState.wasKeyPressed(190)) {
      this._spawnPresetIndex = (((this._spawnPresetIndex + 1) % SPAWN_PRESETS.length) + SPAWN_PRESETS.length) % SPAWN_PRESETS.length;
    }

    if (InputState.wasKeyPressed(78)) {
      this._spawnPresetRing();
    }
    if (InputState.wasKeyPressed(77)) {
      this._clearSpawnedEnemies();
    }
    if (InputState.wasKeyPressed(8)) {
      if (this._staticSceneEnabled) {
        this._seedStaticScene();
        this._clearSceneContents();
      } else {
        this._resetScene();
      }
    }
    if (InputState.wasKeyPressed(80)) {
      this._screenshotRequested = true;
    }
    if (this._staticSceneEnabled) {
      if (InputState.wasKeyPressed(46)) {
        this._seedStaticScene();
        this._clearSceneContents();
      }
      if (InputState.wasMouseButtonPressed(2)) {
        this._removeStaticEmitterAtMouse();
      }
      this._handleStaticMouseInput();
      return;
    }

    if (InputState.wasMouseButtonPressed(0)) {
      this._emitProfile();
    }
  }

  protected _updateAutoEmit(dt: number): void {
    if (!this._autoEmitEnabled || dt <= 0.0) {
      return;
    }
    const profile = this._selectedProfile();
    const interval = LightingDebugView._profileAutoInterval(profile);
    this._autoEmitTimer += dt;
    let budget = 8;
    while (this._autoEmitTimer >= interval && budget > 0) {
      this._autoEmitTimer -= interval;
      this._emitProfile();
      budget -= 1;
    }
    if (budget <= 0) {
      this._autoEmitTimer = 0.0;
    }
  }

  protected static _profileAutoInterval(profile: EmissiveProfile): number {
    const weaponId = profile.rateWeaponId;
    if (weaponId !== null) {
      const cooldown = mapGetOrThrow(WEAPON_BY_ID, weaponId).shotCooldown;
      return Math.max(0.001, cooldown);
    }
    return Math.max(0.001, profile.autoInterval);
  }

  protected _collectShadowState(): void {
    if (this._staticSceneEnabled) {
      this._collectStaticShadowState();
      return;
    }
    this._lastOccluders = collectShadowOccluders(this._player, this._runtime.simWorld.creatures.entries, { maxOccluders: MAX_OCCLUDERS });
    this._lastLights = collectShadowLights(this._runtime.simWorld.state.projectiles.entries, this._runtime.simWorld.state.secondaryProjectiles.entries, this._transientLights, { maxLights: MAX_LIGHTS, rangeScale: this._rangeScale, directionalFocus: this._directionalFocus, directionalStretch: this._directionalStretch });
  }

  async open(): Promise<void> {
    this._missingAssets.length = 0;

    const bootstrap = await initViewAudio(this._assetsRoot);
    this._runtime.config = bootstrap.config;
    this._console = bootstrap.console;
    this._audio = bootstrap.audio;
    this._audioRng = bootstrap.audioRng;
    this._runtime.audio = this._audio;
    this._runtime.audioRng = this._audioRng;
    this._runtime.syncAudioBridgeState();

    try {
      // Load after audio/bootstrap so missing PAQs can be downloaded first.
      this._small = loadSmallFont(this._assetsRoot);
    } catch (exc) {
      this._small = null;
      this._missingAssets.push('load/smallFnt.dat + load/smallWhite.tga');
    }

    this._runtime.openRuntime();
    this._aimTexture = this._loadTexture(TextureId.UI_AIM);
    this._resetScene();
    this._ensureShadowShader();
    this._ensureShadowRt();
  }

  protected _releaseShadowResources(): void {
    for (const rt of [this._shadowRt, this._shadowAccumRt, this._shadowAccumSwapRt]) {
      if (rt !== null && renderTextureValid(rt)) {
        wgl.unloadRenderTexture(rt);
      }
    }
    this._shadowRt = null;
    this._shadowAccumRt = null;
    this._shadowAccumSwapRt = null;
    this._shadowAccumReady = false;
    this._shadowOutputRtForPreview = null;
    this._shadowRtSize = [0, 0];

    const shader = this._shadowShader;
    if (shader !== null && shaderValid(shader)) {
      wgl.unloadShader(shader);
    }
    this._shadowShader = null;
    this._shadowUniforms = null;

    const temporalShader = this._temporalShader;
    if (temporalShader !== null && shaderValid(temporalShader)) {
      wgl.unloadShader(temporalShader);
    }
    this._temporalShader = null;
    this._temporalUniforms = null;
  }

  close(): void {
    this._resetTickRunner();
    this._releaseShadowResources();

    if (this._small !== null) {
      this._small = null;
    }
    if (this._audio !== null) {
      shutdownAudio(this._audio);
      this._audio = null;
      this._console = null;
    }
    this._runtime.audio = null;
    this._runtime.audioRng = this._audioRng;
    this._runtime.syncAudioBridgeState();
    this._runtime.closeRuntime();
    this._aimTexture = null;
  }

  consumeScreenshotRequest(): boolean {
    const requested = this._screenshotRequested;
    this._screenshotRequested = false;
    return requested;
  }

  protected _ensureShadowShader(): boolean {
    if (shaderValid(this._shadowShader) && this._shadowUniforms !== null) {
      return true;
    }

    let shader: ReturnType<typeof wgl.loadShaderFromMemory>;
    try {
      shader = wgl.loadShaderFromMemory(_SHADOW_VS_330, _SHADOW_FS_330);
    } catch (exc) {
      this._shadowWarning = `shadow shader init failed: ${exc instanceof Error ? exc.message : String(exc)}`;
      this._shadowShader = null;
      this._shadowUniforms = null;
      return false;
    }

    if (!shaderValid(shader)) {
      this._shadowWarning = 'shadow shader unavailable (compile/link failed)';
      this._shadowShader = null;
      this._shadowUniforms = null;
      return false;
    }

    const uniforms = new ShadowUniforms({ resolution: shaderLocation(shader, 'u_resolution'), rtResolution: shaderLocation(shader, 'u_rt_resolution'), camera: shaderLocation(shader, 'u_camera'), viewScale: shaderLocation(shader, 'u_view_scale'), occluderCount: shaderLocation(shader, 'u_occluder_count'), occluders: shaderArrayLocations(shader, 'u_occluders', MAX_OCCLUDERS), lightCount: shaderLocation(shader, 'u_light_count'), lights: shaderArrayLocations(shader, 'u_lights', MAX_LIGHTS), lightDirs: shaderArrayLocations(shader, 'u_light_dirs', MAX_LIGHTS), lightSizeW: shaderLocation(shader, 'u_light_size_w'), shadowStrength: shaderLocation(shader, 'u_shadow_strength'), ambientDarkness: shaderLocation(shader, 'u_ambient_darkness'), minT: shaderLocation(shader, 'u_min_t'), jitterPhase: shaderLocation(shader, 'u_jitter_phase'), jitterAmount: shaderLocation(shader, 'u_jitter_amount'), debugMode: shaderLocation(shader, 'u_debug_mode') });
    if (this._autodiagEnabled) {
      print(`[lighting-debug] uniform locations occ0=${uniforms.occluders.length > 0 ? uniforms.occluders[0] : -1} occ1=${uniforms.occluders.length > 1 ? uniforms.occluders[1] : -1} light0=${uniforms.lights.length > 0 ? uniforms.lights[0] : -1} light1=${uniforms.lights.length > 1 ? uniforms.lights[1] : -1}`);
    }
    const missing: string[] = [];
    for (const name of [
      'resolution',
      'rt_resolution',
      'camera',
      'view_scale',
      'occluder_count',
      'light_count',
      'light_size_w',
      'shadow_strength',
      'ambient_darkness',
      'min_t',
      'jitter_phase',
      'jitter_amount',
      'debug_mode',
    ]) {
      let value: number;
      if (name === 'resolution') {
        value = uniforms.resolution;
      } else if (name === 'rt_resolution') {
        value = uniforms.rtResolution;
      } else if (name === 'camera') {
        value = uniforms.camera;
      } else if (name === 'view_scale') {
        value = uniforms.viewScale;
      } else if (name === 'occluder_count') {
        value = uniforms.occluderCount;
      } else if (name === 'light_count') {
        value = uniforms.lightCount;
      } else if (name === 'light_size_w') {
        value = uniforms.lightSizeW;
      } else if (name === 'shadow_strength') {
        value = uniforms.shadowStrength;
      } else if (name === 'ambient_darkness') {
        value = uniforms.ambientDarkness;
      } else if (name === 'min_t') {
        value = uniforms.minT;
      } else if (name === 'jitter_phase') {
        value = uniforms.jitterPhase;
      } else if (name === 'jitter_amount') {
        value = uniforms.jitterAmount;
      } else {
        if (name !== 'debug_mode') {
          throw new Error(`unknown shadow uniform: ${name}`);
        }
        value = uniforms.debugMode;
      }
      if (int(value) < 0) {
        missing.push(name);
      }
    }
    if (uniforms.occluders.length === 0 || int(uniforms.occluders[0]) < 0) {
      missing.push('occluders');
    }
    if (uniforms.lights.length === 0 || int(uniforms.lights[0]) < 0) {
      missing.push('lights');
    }
    if (uniforms.lightDirs.length === 0 || int(uniforms.lightDirs[0]) < 0) {
      missing.push('light_dirs');
    }
    if (missing.length > 0) {
      wgl.unloadShader(shader);
      this._shadowWarning = 'shadow shader missing uniforms: ' + Array.from(missing).sort((left, right) => pythonCompareKeys(left, right)).join(", ");
      this._shadowShader = null;
      this._shadowUniforms = null;
      return false;
    }

    this._shadowShader = shader;
    this._shadowUniforms = uniforms;
    this._shadowWarning = null;
    return true;
  }

  protected _ensureTemporalShader(): boolean {
    if (shaderValid(this._temporalShader) && this._temporalUniforms !== null) {
      return true;
    }

    let shader: ReturnType<typeof wgl.loadShaderFromMemory>;
    try {
      shader = wgl.loadShaderFromMemory(_SHADOW_VS_330, _TEMPORAL_BLEND_FS_330);
    } catch (exc) {
      this._shadowWarning = `shadow temporal shader init failed: ${exc instanceof Error ? exc.message : String(exc)}`;
      this._temporalShader = null;
      this._temporalUniforms = null;
      return false;
    }

    if (!shaderValid(shader)) {
      this._shadowWarning = 'shadow temporal shader unavailable (compile/link failed)';
      this._temporalShader = null;
      this._temporalUniforms = null;
      return false;
    }

    const uniforms = new TemporalUniforms({ currentTex: shaderLocation(shader, 'u_current_tex'), response: shaderLocation(shader, 'u_response') });
    const missing: string[] = [];
    if (uniforms.currentTex < 0) {
      missing.push('u_current_tex');
    }
    if (uniforms.response < 0) {
      missing.push('u_response');
    }
    if (missing.length > 0) {
      wgl.unloadShader(shader);
      this._shadowWarning = 'shadow temporal shader missing uniforms: ' + missing.join(", ");
      this._temporalShader = null;
      this._temporalUniforms = null;
      return false;
    }

    this._temporalShader = shader;
    this._temporalUniforms = uniforms;
    if (this._shadowWarning !== null && (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(this._shadowWarning, 'temporal shader'))) {
      this._shadowWarning = null;
    }
    return true;
  }

  protected _ensureShadowRt(): boolean {
    const screenW = Math.max(1, int(wgl.getScreenWidth()));
    const screenH = Math.max(1, int(wgl.getScreenHeight()));
    const rtScale = clampf(this._shadowRtScale, RT_SCALE_MIN, RT_SCALE_MAX);
    const rtW = Math.max(1, int(screenW * rtScale));
    const rtH = Math.max(1, int(screenH * rtScale));
    const desired: [number, number] = [rtW, rtH];

    if (renderTextureValid(this._shadowRt) && renderTextureValid(this._shadowAccumRt) && renderTextureValid(this._shadowAccumSwapRt) && pythonEquals(this._shadowRtSize, desired)) {
      return true;
    }

    for (const existingRt of [this._shadowRt, this._shadowAccumRt, this._shadowAccumSwapRt]) {
      if (existingRt !== null && renderTextureValid(existingRt)) {
        wgl.unloadRenderTexture(existingRt);
      }
    }
    this._shadowRt = null;
    this._shadowAccumRt = null;
    this._shadowAccumSwapRt = null;
    this._shadowAccumReady = false;
    this._shadowOutputRtForPreview = null;
    this._shadowRtSize = [0, 0];

    let rt: rl.RenderTexture | null = null;
    let accum: rl.RenderTexture | null = null;
    let accumSwap: rl.RenderTexture | null = null;
    try {
      rt = wgl.loadRenderTexture(rtW, rtH);
      accum = wgl.loadRenderTexture(rtW, rtH);
      accumSwap = wgl.loadRenderTexture(rtW, rtH);
    } catch (exc) {
      for (const maybeRt of [rt, accum, accumSwap]) {
        if (maybeRt !== null && renderTextureValid(maybeRt)) {
          wgl.unloadRenderTexture(maybeRt);
        }
      }
      this._shadowWarning = `shadow render target init failed: ${exc instanceof Error ? exc.message : String(exc)}`;
      return false;
    }

    if (!(rt !== null)) throw new Error();
    if (!(accum !== null)) throw new Error();
    if (!(accumSwap !== null)) throw new Error();
    if (!renderTextureValid(rt) || !renderTextureValid(accum) || !renderTextureValid(accumSwap)) {
      if (renderTextureValid(rt)) {
        wgl.unloadRenderTexture(rt);
      }
      if (renderTextureValid(accum)) {
        wgl.unloadRenderTexture(accum);
      }
      if (renderTextureValid(accumSwap)) {
        wgl.unloadRenderTexture(accumSwap);
      }
      this._shadowWarning = 'shadow render target unavailable';
      return false;
    }

    wgl.setTextureFilter(rt.texture, wgl.TextureFilter.BILINEAR);
    wgl.setTextureFilter(accum.texture, wgl.TextureFilter.BILINEAR);
    wgl.setTextureFilter(accumSwap.texture, wgl.TextureFilter.BILINEAR);
    this._shadowRt = rt;
    this._shadowAccumRt = accum;
    this._shadowAccumSwapRt = accumSwap;
    this._shadowAccumReady = false;
    this._shadowOutputRtForPreview = rt;
    this._shadowRtSize = desired;
    if (this._shadowWarning !== null && (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(this._shadowWarning, 'render target'))) {
      this._shadowWarning = null;
    }
    return true;
  }

  protected _setShadowUniforms(opts: { occluders: CircleOccluder[]; lights: ShadowLight[] }): void {
    const occluders = opts.occluders;
    const lights = opts.lights;
    if (!(this._shadowShader !== null)) throw new Error();
    if (!(this._shadowUniforms !== null)) throw new Error();
    if (!(this._shadowRt !== null)) throw new Error();

    const uniforms = this._shadowUniforms;
    const shader = this._shadowShader;

    const [camera, viewScale] = this._runtime.renderer.worldParams();
    const [rtW, rtH] = this._shadowRtSize;
    const screenW = Math.max(1.0, wgl.getScreenWidth());
    const screenH = Math.max(1.0, wgl.getScreenHeight());
    this._lastShadowCamera = new Vec2(camera.x, camera.y);
    this._lastShadowViewScale = new Vec2(viewScale.x, viewScale.y);
    this._lastShadowResolution = new Vec2(screenW, screenH);
    this._lastShadowRtResolution = new Vec2(rtW, rtH);

    wgl.setShaderValue(shader, int(uniforms.resolution), wgl.ffi.new('Vector2 *', { 'x': screenW, 'y': screenH }), wgl.ShaderUniformDataType.SHADER_UNIFORM_VEC2);
    wgl.setShaderValue(shader, int(uniforms.rtResolution), wgl.ffi.new('Vector2 *', { 'x': rtW, 'y': rtH }), wgl.ShaderUniformDataType.SHADER_UNIFORM_VEC2);
    wgl.setShaderValue(shader, int(uniforms.camera), wgl.ffi.new('Vector2 *', { 'x': camera.x, 'y': camera.y }), wgl.ShaderUniformDataType.SHADER_UNIFORM_VEC2);
    wgl.setShaderValue(shader, int(uniforms.viewScale), wgl.ffi.new('Vector2 *', { 'x': viewScale.x, 'y': viewScale.y }), wgl.ShaderUniformDataType.SHADER_UNIFORM_VEC2);

    const lightCount = Math.min(lights.length, MAX_LIGHTS);
    const occluderCount = Math.min(occluders.length, MAX_OCCLUDERS);

    wgl.setShaderValue(shader, int(uniforms.occluderCount), wgl.ffi.new('int *', int(occluderCount)), wgl.ShaderUniformDataType.SHADER_UNIFORM_INT);
    wgl.setShaderValue(shader, int(uniforms.lightCount), wgl.ffi.new('int *', int(lightCount)), wgl.ShaderUniformDataType.SHADER_UNIFORM_INT);
    wgl.setShaderValue(shader, int(uniforms.lightSizeW), wgl.ffi.new('float *', this._lightSizeW), wgl.ShaderUniformDataType.SHADER_UNIFORM_FLOAT);
    wgl.setShaderValue(shader, int(uniforms.shadowStrength), wgl.ffi.new('float *', this._shadowStrength), wgl.ShaderUniformDataType.SHADER_UNIFORM_FLOAT);
    wgl.setShaderValue(shader, int(uniforms.ambientDarkness), wgl.ffi.new('float *', this._ambientDarkness), wgl.ShaderUniformDataType.SHADER_UNIFORM_FLOAT);
    wgl.setShaderValue(shader, int(uniforms.minT), wgl.ffi.new('float *', this._minT), wgl.ShaderUniformDataType.SHADER_UNIFORM_FLOAT);
    wgl.setShaderValue(shader, int(uniforms.jitterPhase), wgl.ffi.new('int *', int(this._shadowFrameIndex)), wgl.ShaderUniformDataType.SHADER_UNIFORM_INT);
    wgl.setShaderValue(shader, int(uniforms.jitterAmount), wgl.ffi.new('float *', this._jitterAmount), wgl.ShaderUniformDataType.SHADER_UNIFORM_FLOAT);
    wgl.setShaderValue(shader, int(uniforms.debugMode), wgl.ffi.new('int *', int(this._shadowDebugMode)), wgl.ShaderUniformDataType.SHADER_UNIFORM_INT);

    const occData = wgl.ffi.new('Vector4[]', int(MAX_OCCLUDERS));
    for (let i = 0; i < occluderCount; i++) {
      const occ = occluders[i];
      occData[i].x = occ.pos.x;
      occData[i].y = occ.pos.y;
      occData[i].z = occ.radius;
      occData[i].w = 1.0;
    }
    const occLoc = uniforms.occluders.length > 0 ? int(uniforms.occluders[0]) : -1;
    if (occLoc >= 0) {
      const occPtr = wgl.ffi.cast('Vector4 *', occData);
      wgl.setShaderValueV(shader, occLoc, occPtr, wgl.ShaderUniformDataType.SHADER_UNIFORM_VEC4, int(MAX_OCCLUDERS));
    }

    const lightData = wgl.ffi.new('Vector4[]', int(MAX_LIGHTS));
    const lightDirData = wgl.ffi.new('Vector4[]', int(MAX_LIGHTS));
    for (let i = 0; i < lightCount; i++) {
      const light = lights[i];
      lightData[i].x = light.pos.x;
      lightData[i].y = light.pos.y;
      lightData[i].z = light.radius;
      lightData[i].w = light.strength;
      lightDirData[i].x = light.dirX;
      lightDirData[i].y = light.dirY;
      lightDirData[i].z = light.focus;
      lightDirData[i].w = light.stretch;
    }
    const lightLoc = uniforms.lights.length > 0 ? int(uniforms.lights[0]) : -1;
    if (lightLoc >= 0) {
      const lightPtr = wgl.ffi.cast('Vector4 *', lightData);
      wgl.setShaderValueV(shader, lightLoc, lightPtr, wgl.ShaderUniformDataType.SHADER_UNIFORM_VEC4, int(MAX_LIGHTS));
    }

    const lightDirLoc = uniforms.lightDirs.length > 0 ? int(uniforms.lightDirs[0]) : -1;
    if (lightDirLoc >= 0) {
      const lightDirPtr = wgl.ffi.cast('Vector4 *', lightDirData);
      wgl.setShaderValueV(shader, lightDirLoc, lightDirPtr, wgl.ShaderUniformDataType.SHADER_UNIFORM_VEC4, int(MAX_LIGHTS));
    }
  }

  protected _copyShadowRt(src: rl.RenderTexture, dst: rl.RenderTexture): void {
    const [rtW, rtH] = this._shadowRtSize;
    const srcRect = wgl.makeRectangle(0.0, 0.0, rtW, -rtH);
    const dstRect = wgl.makeRectangle(0.0, 0.0, rtW, rtH);
    wgl.beginTextureMode(dst);
    wgl.clearBackground(wgl.makeColor(0 / 255, 0 / 255, 0 / 255, 0 / 255));
    wgl.drawTexturePro(src.texture, srcRect, dstRect, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
    wgl.endTextureMode();
  }

  protected _resolveShadowOutputRt(): rl.RenderTexture | null {
    if (this._shadowRt === null || !renderTextureValid(this._shadowRt)) {
      return null;
    }
    if (this._shadowAccumRt === null || !renderTextureValid(this._shadowAccumRt)) {
      this._shadowOutputRtForPreview = this._shadowRt;
      return this._shadowRt;
    }
    if (this._shadowAccumSwapRt === null || !renderTextureValid(this._shadowAccumSwapRt)) {
      this._shadowOutputRtForPreview = this._shadowRt;
      return this._shadowRt;
    }

    const response = clampf(this._temporalResponse, 0.0, 1.0);
    if (response >= 0.999) {
      if (this._shadowWarning !== null && (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(this._shadowWarning, 'temporal shader'))) {
        this._shadowWarning = null;
      }
      this._shadowOutputRtForPreview = this._shadowRt;
      return this._shadowRt;
    }

    if (!this._ensureTemporalShader()) {
      this._shadowOutputRtForPreview = this._shadowRt;
      return this._shadowRt;
    }

    // Keep debug modes deterministic: output should reflect the selected
    // diagnostic directly, without temporal cross-fade from mode 0.
    if (this._shadowDebugMode !== 0) {
      this._shadowOutputRtForPreview = this._shadowRt;
      return this._shadowRt;
    }

    if (!this._shadowAccumReady) {
      this._copyShadowRt(this._shadowRt, this._shadowAccumRt);
      this._shadowAccumReady = true;
      this._shadowOutputRtForPreview = this._shadowAccumRt;
      return this._shadowAccumRt;
    }

    if (!(this._temporalShader !== null)) throw new Error();
    if (!(this._temporalUniforms !== null)) throw new Error();

    const shader = this._temporalShader;
    const uniforms = this._temporalUniforms;
    const [rtW, rtH] = this._shadowRtSize;
    const srcRect = wgl.makeRectangle(0.0, 0.0, rtW, -rtH);
    const dstRect = wgl.makeRectangle(0.0, 0.0, rtW, rtH);

    wgl.setShaderValue(shader, int(uniforms.response), wgl.ffi.new('float *', response), wgl.ShaderUniformDataType.SHADER_UNIFORM_FLOAT);

    wgl.beginTextureMode(this._shadowAccumSwapRt);
    wgl.clearBackground(wgl.makeColor(0 / 255, 0 / 255, 0 / 255, 0 / 255));
    wgl.beginShaderMode(shader);
    // Bind the secondary sampler while shader mode is active; this is more stable across backends.
    wgl.setShaderValueTexture(shader, int(uniforms.currentTex), this._shadowRt.texture);
    wgl.drawTexturePro(this._shadowAccumRt.texture, srcRect, dstRect, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
    wgl.endShaderMode();
    wgl.endTextureMode();

    [this._shadowAccumRt, this._shadowAccumSwapRt] = [this._shadowAccumSwapRt, this._shadowAccumRt];
    this._shadowAccumReady = true;
    this._shadowOutputRtForPreview = this._shadowAccumRt;
    return this._shadowAccumRt;
  }

  protected _drawShadowOverlay(): void {
    const startTime = time.perfCounter();
    let outputRt: rl.RenderTexture | null = null;
    if (!this._shadowEnabled) {
      this._shadowOutputRtForPreview = null;
      this._lastShadowDrawMs = (time.perfCounter() - startTime) * 1000.0;
      return;
    }
    if (!this._ensureShadowShader()) {
      this._lastShadowDrawMs = (time.perfCounter() - startTime) * 1000.0;
      return;
    }
    if (!this._ensureShadowRt()) {
      this._lastShadowDrawMs = (time.perfCounter() - startTime) * 1000.0;
      return;
    }
    if (this._shadowRt === null || this._shadowShader === null) {
      this._lastShadowDrawMs = (time.perfCounter() - startTime) * 1000.0;
      return;
    }

    try {
      this._setShadowUniforms({ occluders: this._lastOccluders, lights: this._lastLights });
    } catch (exc) {
      this._shadowWarning = `shadow uniform update failed: ${exc instanceof Error ? exc.message : String(exc)}`;
      this._lastShadowDrawMs = (time.perfCounter() - startTime) * 1000.0;
      return;
    }

    const [rtW, rtH] = this._shadowRtSize;
    wgl.beginTextureMode(this._shadowRt);
    wgl.clearBackground(wgl.makeColor(0 / 255, 0 / 255, 0 / 255, 0 / 255));
    wgl.beginShaderMode(this._shadowShader);
    wgl.drawRectangle(0, 0, rtW, rtH, wgl.makeColor(1, 1, 1, 1));
    wgl.endShaderMode();
    wgl.endTextureMode();
    this._shadowFrameIndex = this._shadowFrameIndex + 1 & 0x7FFFFFFF;
    this._autodiagLogShadowStats();

    outputRt = this._resolveShadowOutputRt();
    if (outputRt === null) {
      outputRt = this._shadowRt;
    }
    if (outputRt === null) {
      this._lastShadowDrawMs = (time.perfCounter() - startTime) * 1000.0;
      return;
    }
    const src = wgl.makeRectangle(0.0, 0.0, rtW, -rtH);
    const dst = wgl.makeRectangle(0.0, 0.0, wgl.getScreenWidth(), wgl.getScreenHeight());
    wgl.beginBlendMode(wgl.BlendMode.ALPHA);
    wgl.drawTexturePro(outputRt.texture, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
    wgl.endBlendMode();

    this._lastShadowDrawMs = (time.perfCounter() - startTime) * 1000.0;
    this._autoTuneCaptureFrame(outputRt);
  }

  update(dt: number): void {
    this._player = this._runtime.simWorld.players ? this._runtime.simWorld.players[0] : null;
    this._handleDebugInput();
    this._runAutodiag();

    let simDt = dt;
    if (this._paused) {
      simDt = 0.0;
    }

    if (this._staticSceneEnabled) {
      this._runtime.updateCamera(0.0);
    } else if (this._player !== null) {
      this._applyDebugPlayerCheats();
      this._updateAutoEmit(simDt);
      this._tickHarness.advanceFrame(this._runtime, simDt);
    } else if (this._runtime.simWorld.players) {
      this._player = this._runtime.simWorld.players[0];
    }

    if (!this._staticSceneEnabled) {
      this._transientLights = tickTransientLights(this._transientLights, simDt);
    }
    this._collectShadowState();

    if (this._audio !== null) {
      updateAudio(this._audio, simDt);
    }
  }

  protected _worldScale(): number {
    const [camera, viewScale] = this._runtime.renderer.worldParams();
    return viewScale.avgComponent();
  }

  protected _drawShadowDebugGeometry(): void {
    const scale = this._worldScale();
    for (const occluder of this._lastOccluders) {
      let screen = this.worldToScreen(occluder.pos);
      let radius = Math.max(1.0, occluder.radius * scale);
      wgl.drawCircleLines(int(screen.x), int(screen.y), int(radius), OCCLUDER_COLOR);
    }

    for (const light of this._lastLights) {
      let screen = this.worldToScreen(light.pos);
      let radius = Math.max(1.0, light.radius * scale);
      wgl.drawCircleLines(int(screen.x), int(screen.y), int(radius), LIGHT_RING_COLOR);
      wgl.drawCircle(int(screen.x), int(screen.y), 2.0, LIGHT_CORE_COLOR);
      if (light.focus > 0.01 && (Math.abs(light.dirX) > 1e-4 || Math.abs(light.dirY) > 1e-4)) {
        const dirLen = Math.max(16.0, radius * 0.28 * light.stretch);
        const tipX = screen.x + light.dirX * dirLen;
        const tipY = screen.y + light.dirY * dirLen;
        wgl.drawLineEx(wgl.makeVector2(screen.x, screen.y), wgl.makeVector2(tipX, tipY), 2.0, LIGHT_CORE_COLOR);
      }
    }
  }

  protected _drawStaticEmitterControls(): void {
    if (!this._staticSceneEnabled) {
      return;
    }
    const scale = this._worldScale();
    for (const [idx, emitter] of this._staticEmitters.entries()) {
      const selected = idx === this._staticSelectedEmitter;
      const handles = this._staticHandlePositions(emitter);
      const centerScreen = this.worldToScreen(handles['move']);
      const radiusScreen = this.worldToScreen(handles['radius']);
      const directionScreen = this.worldToScreen(handles['direction']);
      const strengthScreen = this.worldToScreen(handles['strength']);
      const stretchScreen = this.worldToScreen(handles['stretch']);

      let radius!: number;
      if (selected) {
        radius = Math.max(1.0, emitter.radius * scale);
        wgl.drawCircleLines(int(centerScreen.x), int(centerScreen.y), int(radius), LIGHT_SELECTED_COLOR);
      }

      wgl.drawLineEx(wgl.makeVector2(centerScreen.x, centerScreen.y), wgl.makeVector2(radiusScreen.x, radiusScreen.y), 1.5, LIGHT_HANDLE_RADIUS);
      wgl.drawLineEx(wgl.makeVector2(centerScreen.x, centerScreen.y), wgl.makeVector2(directionScreen.x, directionScreen.y), 2.0, LIGHT_HANDLE_DIR);
      wgl.drawLineEx(wgl.makeVector2(centerScreen.x, centerScreen.y), wgl.makeVector2(strengthScreen.x, strengthScreen.y), 1.5, LIGHT_HANDLE_STRENGTH);
      wgl.drawLineEx(wgl.makeVector2(centerScreen.x, centerScreen.y), wgl.makeVector2(stretchScreen.x, stretchScreen.y), 1.5, LIGHT_HANDLE_STRETCH);

      const handleRadius = STATIC_HANDLE_DRAW_RADIUS_PX + (selected ? 2.0 : 0.0);
      wgl.drawCircleV(wgl.makeVector2(centerScreen.x, centerScreen.y), handleRadius, LIGHT_HANDLE_MOVE);
      wgl.drawCircleV(wgl.makeVector2(radiusScreen.x, radiusScreen.y), handleRadius, LIGHT_HANDLE_RADIUS);
      wgl.drawCircleV(wgl.makeVector2(directionScreen.x, directionScreen.y), handleRadius, LIGHT_HANDLE_DIR);
      wgl.drawCircleV(wgl.makeVector2(strengthScreen.x, strengthScreen.y), handleRadius, LIGHT_HANDLE_STRENGTH);
      wgl.drawCircleV(wgl.makeVector2(stretchScreen.x, stretchScreen.y), handleRadius, LIGHT_HANDLE_STRETCH);

      if (selected && this._small !== null) {
        drawUiText(
          this._small,
          `light ${idx + 1}/${this._staticEmitters.length} r${emitter.radius.toFixed(0)} s${emitter.strength.toFixed(2)} f${emitter.focus.toFixed(2)} st${emitter.stretch.toFixed(2)}`,
          new Vec2(centerScreen.x + 12.0, centerScreen.y - 28.0),
          { color: LIGHT_SELECTED_COLOR },
        );
      }
    }
  }

  protected _drawShadowPreview(): void {
    if (!this._showDebugOverlays) {
      return;
    }
    let previewRt = this._shadowOutputRtForPreview;
    if (previewRt === null || !renderTextureValid(previewRt)) {
      previewRt = this._shadowRt;
    }
    if (previewRt === null || !renderTextureValid(previewRt)) {
      return;
    }

    const [rtW, rtH] = this._shadowRtSize;
    if (rtW <= 0 || rtH <= 0) {
      return;
    }

    const screenW = wgl.getScreenWidth();
    const pad = 6.0;
    const margin = 12.0;
    const titleH = this._small !== null ? 12.0 : 0.0;

    let contentW = 240.0;
    let contentH = contentW * (rtH / rtW);
    const maxH = 156.0;
    if (contentH > maxH) {
      const scale = maxH / contentH;
      contentH *= scale;
      contentW *= scale;
    }

    const panelW = contentW + pad * 2.0;
    const panelH = contentH + pad * 2.0 + titleH;
    const x = screenW - panelW - margin;
    const y = margin;

    wgl.drawRectangle(int(x), int(y), int(panelW), int(panelH), SHADOW_PREVIEW_BG);
    wgl.drawRectangleLines(int(x), int(y), int(panelW), int(panelH), SHADOW_PREVIEW_BORDER);

    if (this._small !== null) {
      drawUiText(this._small, 'shadow map', new Vec2(x + pad, y + 1.0), { color: SHADOW_PREVIEW_TEXT });
    }

    const mapX = x + pad;
    const mapY = y + pad + titleH;
    wgl.drawRectangle(int(mapX), int(mapY), int(contentW), int(contentH), SHADOW_PREVIEW_CANVAS);

    const src = wgl.makeRectangle(0.0, 0.0, rtW, -rtH);
    const dst = wgl.makeRectangle(mapX, mapY, contentW, contentH);
    wgl.beginBlendMode(wgl.BlendMode.ALPHA);
    wgl.drawTexturePro(previewRt.texture, src, dst, wgl.makeVector2(0.0, 0.0), 0.0, wgl.makeColor(1, 1, 1, 1));
    wgl.endBlendMode();
  }

  protected _drawTuningPanel(): void {
    if (!this._showTuningPanel) {
      return;
    }

    const line = uiLineHeight(this._small);
    const pad = 6.0;
    const screenW = wgl.getScreenWidth();
    const screenH = wgl.getScreenHeight();
    const panelW = 338.0;
    const panelH = (TUNE_PARAMS.length + 2) * line + pad * 2.0;
    const x = screenW - panelW - 12.0;
    let y = this._showDebugOverlays ? 186.0 : 12.0;
    y = Math.min(y, Math.max(12.0, screenH - panelH - 12.0));

    wgl.drawRectangle(int(x), int(y), int(panelW), int(panelH), SHADOW_PREVIEW_BG);
    wgl.drawRectangleLines(int(x), int(y), int(panelW), int(panelH), SHADOW_PREVIEW_BORDER);

    drawUiText(
      this._small,
      'tuning (T select, -/= adjust, shift coarse, 0 reset, F7 defaults)',
      new Vec2(x + pad, y + 1.0),
      { color: SHADOW_PREVIEW_TEXT },
    );
    y += line;
    const selected = this._selectedTuneParam();
    drawUiText(this._small, `selected: ${selected.label}`, new Vec2(x + pad, y + 1.0), { color: UI_HINT });
    y += line;

    for (const [idx, param] of TUNE_PARAMS.entries()) {
      const value = this._getTuneValue(param.key);
      const marker = idx === this._tuneParamIndex ? '>' : ' ';
      drawUiText(
        this._small,
        `${marker} ${param.label} ${value.toFixed(3).padStart(6, ' ')}`,
        new Vec2(x + pad, y + 1.0),
        { color: idx === this._tuneParamIndex ? UI_TEXT : UI_HINT },
      );
      y += line;
    }
  }

  protected _drawOverlayUi(): void {
    const x = 16.0;
    let y = 12.0;
    const line = uiLineHeight(this._small);

    const profile = this._selectedProfile();
    let preset = this._selectedSpawnPreset();
    const creaturesAlive = this._runtime.simWorld.creatures.entries.filter((creature) => creature.active && creature.hp > 0.0).reduce((total, creature) => total + 1, 0);
    const primaryCount = this._runtime.simWorld.state.projectiles.entries.filter((entry) => entry.active).reduce((total, entry) => total + 1, 0);
    const secondaryCount = this._runtime.simWorld.state.secondaryProjectiles.entries.filter((entry) => entry.active).reduce((total, entry) => total + 1, 0);

    drawUiText(this._small, 'Lighting debug: 2D SDF soft shadows', new Vec2(x, y), { color: UI_TEXT });
    y += line;
    drawUiText(
      this._small,
      `scene ${this._staticSceneEnabled ? 'static look-dev' : 'dynamic sandbox'}`,
      new Vec2(x, y),
      { color: UI_TEXT },
    );
    y += line;
    drawUiText(
      this._small,
      this._staticSceneEnabled ? `profile ${this._profileIndex + 1}/${EMISSIVE_PROFILES.length}: ${profile.name}  new-light defaults` : `profile ${this._profileIndex + 1}/${EMISSIVE_PROFILES.length}: ${profile.name}  auto ${this._autoEmitEnabled ? 'on' : 'off'} (${(LightingDebugView._profileAutoInterval(profile)).toFixed(3)}s)`,
      new Vec2(x, y),
      { color: UI_TEXT },
    );
    y += line;
    if (!this._staticSceneEnabled) {
      drawUiText(
        this._small,
        `spawn preset ${this._spawnPresetIndex + 1}/${SPAWN_PRESETS.length}: ${preset.name}`,
        new Vec2(x, y),
        { color: UI_TEXT },
      );
      y += line;
    }
    drawUiText(
      this._small,
      `occluders ${this._lastOccluders.length}/${MAX_OCCLUDERS}  lights ${this._lastLights.length}/${MAX_LIGHTS}`,
      new Vec2(x, y),
      { color: UI_TEXT },
    );
    y += line;
    if (this._staticSceneEnabled) {
      drawUiText(
        this._small,
        `static emitters ${this._staticEmitters.length}/${MAX_LIGHTS}`,
        new Vec2(x, y),
        { color: UI_TEXT },
      );
      y += line;
    } else {
      drawUiText(
        this._small,
        `creatures ${creaturesAlive}  primary ${primaryCount}  secondary ${secondaryCount}`,
        new Vec2(x, y),
        { color: UI_TEXT },
      );
      y += line;
    }
    drawUiText(
      this._small,
      `shadows ${this._shadowEnabled ? 'on' : 'off'}  overlays ${this._showDebugOverlays ? 'on' : 'off'}  paused ${this._paused ? 'yes' : 'no'}`,
      new Vec2(x, y),
      { color: UI_TEXT },
    );
    y += line;
    drawUiText(
      this._small,
      `ambient ${this._ambientDarkness.toFixed(2)}  reveal ${this._shadowStrength.toFixed(2)}  light_w ${this._lightSizeW.toFixed(2)}  min_t ${this._minT.toFixed(1)}  range ${this._rangeScale.toFixed(2)}`,
      new Vec2(x, y),
      { color: UI_TEXT },
    );
    y += line;
    drawUiText(
      this._small,
      `dir focus ${this._directionalFocus.toFixed(2)} stretch ${this._directionalStretch.toFixed(2)}  jitter ${this._jitterAmount.toFixed(2)}  temporal ${this._temporalResponse.toFixed(2)}  rt ${this._shadowRtScale.toFixed(2)}`,
      new Vec2(x, y),
      { color: UI_TEXT },
    );
    y += line;
    drawUiText(
      this._small,
      this._staticSceneEnabled ? 'note: static mode uses fixed circle occluders and manual emitters' : 'note: only player + creature hitboxes cast shadows in this pass',
      new Vec2(x, y),
      { color: UI_HINT },
    );
    y += line;
    drawUiText(
      this._small,
      `shader debug ${this._shadowDebugMode}: ${shadowDebugModeName(this._shadowDebugMode)}`,
      new Vec2(x, y),
      { color: UI_TEXT },
    );
    y += line;
    if (this._autoTuneEnabled) {
      const presetCount = AUTO_TUNE_PRESETS.length;
      if (this._autoTuneStarted && 0 <= this._autoTunePresetIndex && this._autoTunePresetIndex < presetCount) {
        preset = AUTO_TUNE_PRESETS[this._autoTunePresetIndex];
        drawUiText(
          this._small,
          `autotune ${this._autoTunePresetIndex + 1}/${presetCount} ${preset.name}  frame ${this._autoTunePresetFrame}/${AUTO_TUNE_WARMUP_FRAMES + this._autoTuneSampleFrames}`,
          new Vec2(x, y),
          { color: UI_HINT },
        );
      } else {
        drawUiText(this._small, 'autotune pending', new Vec2(x, y), { color: UI_HINT });
      }
    }

    const warnX = 16.0;
    const warnY = wgl.getScreenHeight() - line * 3.0;
    if (this._shadowWarning !== null && this._shadowEnabled) {
      drawUiText(this._small, `shadow warning: ${this._shadowWarning}`, new Vec2(warnX, warnY), { color: UI_WARNING });
    }

    if (!this._showHelp) {
      this._drawTuningPanel();
      return;
    }

    y = wgl.getScreenHeight() - line * 5.0;
    drawUiText(
      this._small,
      this._staticSceneEnabled ? 'LMB place/select/drag light  RMB remove light  Del reset lights  [/] profile defaults' : 'WASD move  LMB emit  [/] projectile profile  F4 auto emit',
      new Vec2(x, y),
      { color: UI_HINT },
    );
    y += line;
    drawUiText(
      this._small,
      this._staticSceneEnabled ? 'drag handles: blue move  amber radius  white direction/focus  pink strength  green stretch' : ',/. spawn preset  N spawn ring  M clear enemies  Backspace reset scene',
      new Vec2(x, y),
      { color: UI_HINT },
    );
    y += line;
    drawUiText(
      this._small,
      'F2 shadows  F3 overlays  F5 static scene  F6 shader dbg  F7 tune defaults  F8 tuning panel  F9 autotune',
      new Vec2(x, y),
      { color: UI_HINT },
    );
    y += line;
    drawUiText(
      this._small,
      'T select tune  -/= adjust  Shift coarse  0 reset tune  H help  Space pause  P screenshot  Esc quit',
      new Vec2(x, y),
      { color: UI_HINT },
    );

    this._drawTuningPanel();
  }

  draw(): void {
    wgl.clearBackground(BG);
    this._drawWorld({ drawAimIndicators: true });
    this._drawShadowOverlay();

    if (this._showDebugOverlays) {
      this._drawShadowDebugGeometry();
      this._drawStaticEmitterControls();
      this._drawShadowPreview();
    }
    this._drawOverlayUi();

    if (this._missingAssets.length > 0) {
      drawUiText(
        this._small,
        'Missing assets: ' + this._missingAssets.join(", "),
        new Vec2(16.0, 16.0),
        { color: UI_ERROR },
      );
    }

    const resources = this._runtime.renderResources.resources;
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    drawAimCursor(resources.texture(TextureId.PARTICLES), this._aimTexture, { pos: Vec2.fromXY(mouse) });
  }
}

function isFiniteVec2(pos: Vec2): boolean {
  return Number.isFinite(pos.x) && Number.isFinite(float(pos.y));
}

function clampf(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedDirFromAngle(angle: number): [number, number] {
  if (!Number.isFinite(angle)) {
    return [0.0, 0.0];
  }
  const vec = Vec2.fromHeading(angle);
  const length = vec.length();
  if (length <= 1e-6) {
    return [0.0, 0.0];
  }
  const inv = 1.0 / length;
  return [vec.x * inv, vec.y * inv];
}

function normalizedDirFromVec(vec: Vec2 | null): [number, number] {
  if (vec === null || !isFiniteVec2(vec)) {
    return [0.0, 0.0];
  }
  const length = vec.length();
  if (length <= 1e-6) {
    return [0.0, 0.0];
  }
  const inv = 1.0 / length;
  return [vec.x * inv, vec.y * inv];
}

function screenDistanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function shadowFrameMetrics(alphaValues: number[], sampleW: number, sampleH: number): ShadowFrameMetrics | null {
  const count = alphaValues.length;
  if (count <= 0) {
    return null;
  }
  if (int(sampleW) <= 0 || int(sampleH) <= 0) {
    return null;
  }
  if (int(sampleW) * int(sampleH) !== count) {
    return null;
  }

  let total = 0.0;
  let minAlpha = 255;
  let maxAlpha = 0;
  let covered = 0;
  for (const value of alphaValues) {
    const alpha = Math.max(0, Math.min(255, int(value)));
    total += alpha;
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
    if (6 <= alpha && alpha <= 245) {
      covered += 1;
    }
  }

  const mean = total / count;
  let variance = 0.0;
  for (const value of alphaValues) {
    let diff = int(value) - mean;
    variance += diff * diff;
  }
  variance /= count;
  const std = Math.sqrt(Math.max(0.0, variance));

  let transitions = 0;
  let flat = 0;
  let hard = 0;
  const width = int(sampleW);
  const height = int(sampleH);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      let diff: number;
      if (x + 1 < width) {
        diff = Math.abs(int(alphaValues[idx]) - int(alphaValues[idx + 1]));
        transitions += 1;
        if (diff <= 2) {
          flat += 1;
        }
        if (diff >= 16) {
          hard += 1;
        }
      }
      if (y + 1 < height) {
        diff = Math.abs(int(alphaValues[idx]) - int(alphaValues[idx + width]));
        transitions += 1;
        if (diff <= 2) {
          flat += 1;
        }
        if (diff >= 16) {
          hard += 1;
        }
      }
    }
  }

  const transitionDenom = Math.max(1, transitions);
  const flatRatio = flat / transitionDenom;
  const hardRatio = hard / transitionDenom;
  const banding = clampf(flatRatio * hardRatio * 4.0, 0.0, 1.0);

  return new ShadowFrameMetrics({ meanAlpha: mean, stdAlpha: std, contrast: clampf((maxAlpha - minAlpha) / 255.0, 0.0, 1.0), coverage: clampf(covered / count, 0.0, 1.0), banding: banding });
}

function shadowQualityScore(metrics: ShadowFrameMetrics, opts: { shadowMs: number; flicker: number; targetShadowMs?: number }): number {
  const shadowMs = opts.shadowMs;
  const flicker = opts.flicker;
  const targetShadowMs = opts.targetShadowMs ?? AUTO_TUNE_TARGET_SHADOW_MS;
  const meanNormalized = clampf(metrics.meanAlpha / 255.0, 0.0, 1.0);
  const meanTarget = 0.58;
  const meanScore = 1.0 - clampf(Math.abs(meanNormalized - meanTarget) / 0.45, 0.0, 1.0);
  const spreadScore = clampf((metrics.stdAlpha / 255.0) / 0.32, 0.0, 1.0);
  const contrastScore = clampf(metrics.contrast / 0.70, 0.0, 1.0);
  const coverageScore = 1.0 - clampf(Math.abs(metrics.coverage - 0.58) / 0.58, 0.0, 1.0);
  const bandingScore = 1.0 - clampf(metrics.banding / 0.12, 0.0, 1.0);
  const flickerScore = 1.0 - clampf((flicker / 255.0) / 0.18, 0.0, 1.0);
  const perfScore = clampf(targetShadowMs / Math.max(1e-3, shadowMs), 0.0, 1.0);

  const score = (0.05 * meanScore + 0.15 * spreadScore + 0.08 * contrastScore + 0.05 * coverageScore + 0.40 * bandingScore + 0.07 * flickerScore + 0.20 * perfScore);
  return clampf(score, 0.0, 1.0);
}

function autoTuneSelectionScore(result: AutoTuneResult): number {
  let score = result.score;
  // Prefer smoother penumbras over raw contrast/brightness if quality scores are close.
  score += (0.15 - result.banding) * 0.9;
  if (result.contrast < 0.50) {
    score -= (0.50 - result.contrast) * 0.7;
  }
  return score;
}

function profileLightDefaults(profile: EmissiveProfile): [number, number, number, number] {
  let typeId: number;
  let spec: any;
  let radius: any;
  let strength: any;
  let focus: any;
  let stretch: any;
  if (profile.primaryTypeId !== null) {
    typeId = int(profile.primaryTypeId);
    spec = PRIMARY_PROJECTILE_LIGHTS.get(typeId) ?? null;
    if (spec !== null) {
      [radius, strength] = spec;
      [focus, stretch] = PRIMARY_PROJECTILE_DIRECTIONAL.get(typeId) ?? [0.0, 1.0];
      return [radius, strength, focus, stretch];
    }
  }
  if (profile.secondaryTypeId !== null) {
    typeId = int(profile.secondaryTypeId);
    spec = SECONDARY_PROJECTILE_LIGHTS.get(typeId) ?? null;
    if (spec !== null) {
      [radius, strength] = spec;
      [focus, stretch] = SECONDARY_PROJECTILE_DIRECTIONAL.get(typeId) ?? [0.0, 1.0];
      return [radius, strength, focus, stretch];
    }
  }
  return [profile.flashRadius, profile.flashStrength, 0.0, 1.0];
}

function buildStaticOccluders(): CircleOccluder[] {
  const occluders: CircleOccluder[] = [];
  for (let [x, y, radius] of STATIC_OCCLUDER_LAYOUT) {
    occluders.push(new CircleOccluder({ pos: new Vec2(x, y), radius: radius }));
  }
  return occluders;
}

function shadowOccluderRadius(size: number, lifecycleStage: number): number {
  const blended = Math.max(lifecycleStage, size * 0.35);
  return Math.max(6.0, Math.min(128.0, blended));
}

export function collectShadowOccluders(player: PlayerState | null, creatures: CreatureState[], opts: { maxOccluders?: number } = {}): CircleOccluder[] {
  const maxOccluders = opts.maxOccluders ?? MAX_OCCLUDERS;
  const occluders: CircleOccluder[] = [];

  const _append = (pos: Vec2 | null, radius: number): void => {
    if (occluders.length >= int(maxOccluders)) {
      return;
    }
    if (pos === null) {
      return;
    }
    if (!isFiniteVec2(pos)) {
      return;
    }
    const radiusF = radius;
    if (!Number.isFinite(radiusF) || radiusF <= 0.0) {
      return;
    }
    occluders.push(new CircleOccluder({ pos: new Vec2(pos.x, pos.y), radius: radiusF }));
  };

  if (player !== null && player.health > 0.0) {
    const playerSize = player.size;
    const playerHitbox = player.size * 0.4;
    _append(player.pos, shadowOccluderRadius(playerSize, playerHitbox));
  }

  for (const creature of creatures) {
    if (occluders.length >= int(maxOccluders)) {
      break;
    }
    if (!creature.active) {
      continue;
    }
    if (creature.hp <= 0.0) {
      continue;
    }
    const lifecycleStage = creature.lifecycleStage;
    if (lifecycleStage <= 0.0) {
      continue;
    }
    const size = creature.size;
    _append(creature.pos, shadowOccluderRadius(size, lifecycleStage));
  }

  return occluders;
}

function projectileLights(entry: Projectile, opts: { rangeScale?: number; directionalFocus?: number; directionalStretch?: number } = {}): ShadowLight[] {
  const rangeScale = opts.rangeScale ?? DEFAULT_SHADOW_RANGE_SCALE;
  const directionalFocus = opts.directionalFocus ?? DEFAULT_DIRECTIONAL_FOCUS;
  const directionalStretch = opts.directionalStretch ?? DEFAULT_DIRECTIONAL_STRETCH;
  if (!entry.active) {
    return [];
  }
  const typeId = int(entry.typeId);
  const spec = PRIMARY_PROJECTILE_LIGHTS.get(typeId) ?? null;
  if (spec === null) {
    return [];
  }
  const pos = entry.pos;
  if (pos === null) {
    return [];
  }
  if (!isFiniteVec2(pos)) {
    return [];
  }
  const [radius, strength] = spec;
  const [baseFocus, baseStretch] = PRIMARY_PROJECTILE_DIRECTIONAL.get(typeId) ?? [0.0, 1.0];
  let [dirX, dirY] = normalizedDirFromAngle(entry.angle);
  let focus = clampf(baseFocus * directionalFocus, 0.0, 2.0);
  let stretch = clampf(baseStretch * directionalStretch, 1.0, 6.0);
  if ((OMNI_PROJECTILE_TYPES as ReadonlySet<unknown>).has(typeId) || (Math.abs(dirX) <= 1e-6 && Math.abs(dirY) <= 1e-6)) {
    dirX = 0.0;
    dirY = 0.0;
    focus = 0.0;
    stretch = 1.0;
  }
  const scaledRadius = Math.min(900.0, radius * rangeScale);
  const head = new ShadowLight({ pos: new Vec2(pos.x, pos.y), radius: scaledRadius, strength: strength, dirX: dirX, dirY: dirY, focus: focus, stretch: stretch });

  if (!(ION_PROJECTILE_TYPES as ReadonlySet<unknown>).has(typeId)) {
    return [head];
  }

  const origin = entry.origin;
  if (origin === null || !isFiniteVec2(origin)) {
    return [head];
  }

  const tailVec = pos.sub(origin);
  const [tailDir, tailDist] = tailVec.normalizedWithLength();
  if (tailDist <= 1e-4) {
    return [head];
  }

  const tailLen = Math.min(tailDist, _ION_TAIL_MAX_LENGTH);
  const lights = [head];
  for (let [distFactor, strengthFactor, radiusFactor] of ION_TAIL_SAMPLES) {
    const sample = pos.sub(tailDir.mul(tailLen * distFactor));
    if (!isFiniteVec2(sample)) {
      continue;
    }
    const sampleStrength = strength * strengthFactor;
    const sampleRadius = Math.max(1.0, scaledRadius * radiusFactor);
    if (sampleStrength <= 0.0 || sampleRadius <= 0.0) {
      continue;
    }
    lights.push(new ShadowLight({ pos: new Vec2(sample.x, sample.y), radius: sampleRadius, strength: sampleStrength }));
  }
  return Array.from(lights);
}

function secondaryProjectileLight(entry: SecondaryProjectile, opts: { rangeScale?: number; directionalFocus?: number; directionalStretch?: number } = {}): ShadowLight | null {
  const rangeScale = opts.rangeScale ?? DEFAULT_SHADOW_RANGE_SCALE;
  const directionalFocus = opts.directionalFocus ?? DEFAULT_DIRECTIONAL_FOCUS;
  const directionalStretch = opts.directionalStretch ?? DEFAULT_DIRECTIONAL_STRETCH;
  if (!entry.active) {
    return null;
  }
  const typeId = int(entry.typeId);
  const spec = SECONDARY_PROJECTILE_LIGHTS.get(typeId) ?? null;
  if (spec === null) {
    return null;
  }
  const pos = entry.pos;
  if (pos === null) {
    return null;
  }
  if (!isFiniteVec2(pos)) {
    return null;
  }
  let [radius, strength] = spec;
  if (typeId === int(SecondaryProjectileTypeId.DETONATION)) {
    radius *= Math.max(0.5, entry.detonationScale);
  }
  const [baseFocus, baseStretch] = SECONDARY_PROJECTILE_DIRECTIONAL.get(typeId) ?? [0.0, 1.0];
  let [dirX, dirY] = normalizedDirFromVec(entry.vel);
  if (Math.abs(dirX) <= 1e-6 && Math.abs(dirY) <= 1e-6) {
    [dirX, dirY] = normalizedDirFromAngle(entry.angle);
  }
  let focus = clampf(baseFocus * directionalFocus, 0.0, 2.0);
  let stretch = clampf(baseStretch * directionalStretch, 1.0, 6.0);
  if (Math.abs(dirX) <= 1e-6 && Math.abs(dirY) <= 1e-6) {
    focus = 0.0;
    stretch = 1.0;
  }
  const scaledRadius = Math.min(900.0, radius * rangeScale);
  return new ShadowLight({ pos: new Vec2(pos.x, pos.y), radius: scaledRadius, strength: strength, dirX: dirX, dirY: dirY, focus: focus, stretch: stretch });
}

export function transientLightStrength(light: TransientLight): number {
  const ttl = Math.max(1e-6, light.ttl);
  const fade = Math.max(0.0, 1.0 - light.age / ttl);
  return Math.max(0.0, light.strength * fade);
}

export function tickTransientLights(lights: TransientLight[], dt: number): TransientLight[] {
  if (dt <= 0.0) {
    return Array.from(lights);
  }
  const nextLights: TransientLight[] = [];
  for (const light of lights) {
    const age = light.age + dt;
    if (age >= light.ttl) {
      continue;
    }
    nextLights.push((() => { const value = light; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value, age }); })());
  }
  return nextLights;
}

export function collectShadowLights(projectiles: Projectile[], secondaryProjectiles: SecondaryProjectile[], transientLights: TransientLight[], opts: { maxLights?: number; rangeScale?: number; directionalFocus?: number; directionalStretch?: number } = {}): ShadowLight[] {
  const maxLights = opts.maxLights ?? MAX_LIGHTS;
  const rangeScale = opts.rangeScale ?? DEFAULT_SHADOW_RANGE_SCALE;
  const directionalFocus = opts.directionalFocus ?? DEFAULT_DIRECTIONAL_FOCUS;
  const directionalStretch = opts.directionalStretch ?? DEFAULT_DIRECTIONAL_STRETCH;
  const lights: ShadowLight[] = [];
  const cap = Math.max(0, int(maxLights));
  if (cap <= 0) {
    return lights;
  }

  for (const transient of transientLights) {
    if (lights.length >= cap) {
      return lights;
    }
    if (!isFiniteVec2(transient.pos)) {
      continue;
    }
    const strength = transientLightStrength(transient);
    if (strength <= 0.0) {
      continue;
    }
    const radius = transient.radius;
    if (radius <= 0.0) {
      continue;
    }
    const scaledRadius = Math.min(900.0, radius * rangeScale);
    lights.push(new ShadowLight({ pos: transient.pos, radius: scaledRadius, strength: strength }));
  }

  for (const entry of projectiles) {
    if (lights.length >= cap) {
      return lights;
    }
    const extraLights = projectileLights(entry, { rangeScale: rangeScale, directionalFocus: directionalFocus, directionalStretch: directionalStretch });
    for (const light of extraLights) {
      if (lights.length >= cap) {
        return lights;
      }
      lights.push(light);
    }
  }

  for (const entry of secondaryProjectiles) {
    if (lights.length >= cap) {
      return lights;
    }
    const light = secondaryProjectileLight(entry, { rangeScale: rangeScale, directionalFocus: directionalFocus, directionalStretch: directionalStretch });
    if (light !== null) {
      lights.push(light);
    }
  }

  return lights;
}

function shaderLocation(shader: rl.Shader, name: string): number {
  let location = int(wgl.getShaderLocation(shader, name));
  if (location < 0 && (!((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(name, '['))) {
    location = int(wgl.getShaderLocation(shader, `${name}[0]`));
  }
  return int(location);
}

function shaderArrayLocations(shader: rl.Shader, name: string, count: number): number[] {
  const locations: number[] = [];
  for (let i = 0; i < Math.max(0, int(count)); i++) {
    let location = int(wgl.getShaderLocation(shader, `${name}[${i}]`));
    if (location < 0 && i === 0) {
      location = int(wgl.getShaderLocation(shader, name));
    }
    locations.push(int(location));
  }
  return Array.from(locations);
}

function shaderValid(shader: rl.Shader | null): boolean {
  if (shader === null) {
    return false;
  }
  return int(shader.id) > 0;
}

function renderTextureValid(rt: rl.RenderTexture | null): boolean {
  if (rt === null) {
    return false;
  }
  if (int(rt.id) <= 0) {
    return false;
  }
  try {
    const validator = wgl.isRenderTextureValid;
  } catch (exc) {
    if (!(exc instanceof AttributeError)) {
      throw exc;
    }
    return true;
  }
  try {
    return pythonTruthy(validator(rt));
  } catch (exc) {
    return false;
  }
}

function shadowDebugModeName(mode: number): string {
  const index = int(mode);
  if (index >= 0 && index < SHADOW_DEBUG_MODE_NAMES.length) {
    return SHADOW_DEBUG_MODE_NAMES[index];
  }
  return `mode${index}`;
}

export const buildLightingDebugView = registerView('lighting-debug', 'Lighting debug')(function buildLightingDebugView(ctx: ViewContext): View {
  return new LightingDebugView(ctx);
});
