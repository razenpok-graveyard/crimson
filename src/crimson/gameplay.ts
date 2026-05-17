// Port of crimson/gameplay.py

import type { QuestLevel } from '@crimson/quests/level.ts';
import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { Crand } from '@grim/rand.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { _AIM_JOYSTICK_TURN_RATE, _AIM_KEYBOARD_TURN_RATE } from '@crimson/aim-constants.ts';
import { AimScheme } from '@crimson/aim-schemes.ts';
import type { DeferredFreezeCorpseFx } from '@crimson/bonuses/freeze.ts';
import { BonusHudState } from '@crimson/bonuses/hud.ts';
import { BonusPool } from '@crimson/bonuses/pool.ts';
import { EffectPool, ParticlePool, SpriteEffectPool } from '@crimson/effects.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { NATIVE_HALF_PI, NATIVE_PI, NATIVE_TAU, f32 } from '@crimson/math-parity.ts';
import { MovementControlType } from '@crimson/movement-controls.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { applyPlayerPerkTicks } from '@crimson/perks/runtime/player-ticks.ts';
import { PerkEffectIntervals, PerkSelectionState } from '@crimson/perks/state.ts';
import { ProjectilePool, SecondaryProjectilePool } from '@crimson/projectiles/runtime/index.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { PERK_COUNT_SIZE } from '@crimson/sim/state-types.ts';
import { ftolMsI32 } from '@crimson/sim/timing.ts';
import { TutorialOverlayState, TutorialState } from '@crimson/tutorial/index.ts';
import { TypoState } from '@crimson/typo/state.ts';
import { WeaponFireCtx as _WeaponFireCtx } from '@crimson/weapon-runtime/index.ts';
import { fireWeapon as _fireWeapon } from '@crimson/weapon-runtime/index.ts';
import { ownerRefForPlayer as _ownerRefForPlayer } from '@crimson/weapon-runtime/index.ts';
import { ownerRefForPlayerProjectiles as _ownerRefForPlayerProjectiles } from '@crimson/weapon-runtime/index.ts';
import { playerStartReload as _playerStartReload } from '@crimson/weapon-runtime/index.ts';
import { playerSwapAltWeapon as _playerSwapAltWeapon } from '@crimson/weapon-runtime/index.ts';
import { projectileSpawn as _projectileSpawn } from '@crimson/weapon-runtime/index.ts';
import { spawnProjectileRing as _spawnProjectileRing } from '@crimson/weapon-runtime/index.ts';
import { weaponAssignPlayer as _weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { weaponEntry as _weaponEntry } from '@crimson/weapon-runtime/index.ts';
import { WEAPON_TABLE, WeaponId } from '@crimson/weapons.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import type { SpawnSlotInit } from '@crimson/creatures/spawn.ts';
import type { GameStatus } from '@crimson/persistence/save-status.ts';
import type { PlayerInput } from '@crimson/sim/input.ts';
import type { PlayerState } from '@crimson/sim/state-types.ts';

export const WEAPON_COUNT_SIZE = Math.max(...Array.from(WEAPON_TABLE, (entry) => int(entry.weaponId))) + 1;
const _RELOAD_PRELOAD_UNDERFLOW_EPS = 1e-7;
const _RELATIVE_MOVE_HEADING_NONE = -1.0;
const _RELATIVE_MOVE_HEADING_FORWARD = 0.0;
const _RELATIVE_MOVE_HEADING_FORWARD_RIGHT = f32(0.7853982);
const _RELATIVE_MOVE_HEADING_RIGHT = f32(1.5707964);
const _RELATIVE_MOVE_HEADING_BACKWARD_RIGHT = f32(2.3561945);
const _RELATIVE_MOVE_HEADING_BACKWARD = NATIVE_PI;
const _RELATIVE_MOVE_HEADING_BACKWARD_LEFT = f32(3.926991);
const _RELATIVE_MOVE_HEADING_LEFT = f32(4.712389);
const _RELATIVE_MOVE_HEADING_FORWARD_LEFT = f32(5.4977875);
const _RELATIVE_MOVE_TURN_ALIGN_SCALE = f32(7.957747);
const _AIM_POINT_RADIUS = 60.0;
const _LOW_HEALTH_BLEED_DIR_OFFSET = 1.5707964 - 0.5;
export const LOW_HEALTH_BLOODSPILL_SFX: [SfxId, SfxId] = [SfxId.BLOODSPILL_01, SfxId.BLOODSPILL_02] as const;

export class BonusTimers {
  weaponPowerUp: number;
  reflexBoost: number;
  energizer: number;
  doubleExperience: number;
  freeze: number;

  constructor(opts: {
    weaponPowerUp?: number;
    reflexBoost?: number;
    energizer?: number;
    doubleExperience?: number;
    freeze?: number;
  } = {}) {
    this.weaponPowerUp = opts.weaponPowerUp ?? 0.0;
    this.reflexBoost = opts.reflexBoost ?? 0.0;
    this.energizer = opts.energizer ?? 0.0;
    this.doubleExperience = opts.doubleExperience ?? 0.0;
    this.freeze = opts.freeze ?? 0.0;
  }
}

export class GameplayState {
  rng: CrandLike;
  effects: EffectPool;
  particles: ParticlePool;
  spriteEffects: SpriteEffectPool;
  projectiles: ProjectilePool;
  secondaryProjectiles: SecondaryProjectilePool;
  bonuses: BonusTimers;
  timeScaleActive: boolean;
  perkIntervals: PerkEffectIntervals;
  leanMeanExpTimer: number;
  jinxedTimer: number;
  plaguebearerInfectionCount: number;
  perkSelection: PerkSelectionState;
  sfxQueue: SfxId[];
  gameMode: GameMode;
  demoModeActive: boolean;
  hardcore: boolean;
  preserveBugs: boolean;
  status: GameStatus | null;
  questLevel: QuestLevel | null;
  tutorial: TutorialState;
  tutorialOverlay: TutorialOverlayState;
  typo: TypoState;
  perkAvailable: boolean[];
  weaponAvailable: boolean[];
  friendlyFireEnabled: boolean;
  bonusSpawnGuard: boolean;
  playerAltWeaponSwapCooldownMs: number;
  bonusHud: BonusHudState;
  bonusPool: BonusPool;
  deferredFreezeCorpseFx: DeferredFreezeCorpseFx[];
  playerDeathHookSkipIndices: Set<number>;
  shockChainLinksLeft: number;
  shockChainProjectileId: number;
  survivalRewardWeaponGuardId: WeaponId;
  survivalRewardHandoutEnabled: boolean;
  survivalRewardFireSeen: boolean;
  survivalRewardDamageSeen: boolean;
  survivalRecentDeathPos: Vec2[];
  survivalRecentDeathCount: number;
  cameraShakeOffset: Vec2;
  cameraShakeTimer: number;
  cameraShakePulses: number;
  shotsFired: number[];
  shotsFiredTotal: number;
  shotsHit: number[];
  playerSpreadDampingScalar: number;
  playerSpreadDampingGate: number;
  weaponShotsFired: number[][];
  debugGodMode: boolean;

  constructor(opts: {
    rng?: CrandLike;
    effects?: EffectPool;
    particles?: ParticlePool;
    spriteEffects?: SpriteEffectPool;
    projectiles?: ProjectilePool;
    secondaryProjectiles?: SecondaryProjectilePool;
    bonuses?: BonusTimers;
    timeScaleActive?: boolean;
    perkIntervals?: PerkEffectIntervals;
    leanMeanExpTimer?: number;
    jinxedTimer?: number;
    plaguebearerInfectionCount?: number;
    perkSelection?: PerkSelectionState;
    sfxQueue?: SfxId[];
    gameMode?: GameMode;
    demoModeActive?: boolean;
    hardcore?: boolean;
    preserveBugs?: boolean;
    status?: GameStatus | null;
    questLevel?: QuestLevel | null;
    tutorial?: TutorialState;
    tutorialOverlay?: TutorialOverlayState;
    typo?: TypoState;
    perkAvailable?: boolean[];
    weaponAvailable?: boolean[];
    friendlyFireEnabled?: boolean;
    bonusSpawnGuard?: boolean;
    playerAltWeaponSwapCooldownMs?: number;
    bonusHud?: BonusHudState;
    bonusPool?: BonusPool;
    deferredFreezeCorpseFx?: DeferredFreezeCorpseFx[];
    playerDeathHookSkipIndices?: Set<number>;
    shockChainLinksLeft?: number;
    shockChainProjectileId?: number;
    survivalRewardWeaponGuardId?: WeaponId;
    survivalRewardHandoutEnabled?: boolean;
    survivalRewardFireSeen?: boolean;
    survivalRewardDamageSeen?: boolean;
    survivalRecentDeathPos?: Vec2[];
    survivalRecentDeathCount?: number;
    cameraShakeOffset?: Vec2;
    cameraShakeTimer?: number;
    cameraShakePulses?: number;
    shotsFired?: number[];
    shotsFiredTotal?: number;
    shotsHit?: number[];
    playerSpreadDampingScalar?: number;
    playerSpreadDampingGate?: number;
    weaponShotsFired?: number[][];
    debugGodMode?: boolean;
  } = {}) {
    this.rng = opts.rng ?? new Crand(0xBEEF);
    this.effects = opts.effects ?? new EffectPool();
    this.projectiles = opts.projectiles ?? new ProjectilePool();
    this.secondaryProjectiles = opts.secondaryProjectiles ?? new SecondaryProjectilePool();
    this.bonuses = opts.bonuses ?? new BonusTimers();
    this.timeScaleActive = opts.timeScaleActive ?? false;
    this.perkIntervals = opts.perkIntervals ?? new PerkEffectIntervals();
    this.leanMeanExpTimer = opts.leanMeanExpTimer ?? 0.25;
    this.jinxedTimer = opts.jinxedTimer ?? 0.0;
    this.plaguebearerInfectionCount = opts.plaguebearerInfectionCount ?? 0;
    this.perkSelection = opts.perkSelection ?? new PerkSelectionState();
    this.sfxQueue = opts.sfxQueue ?? [];
    this.gameMode = opts.gameMode ?? GameMode.SURVIVAL;
    this.demoModeActive = opts.demoModeActive ?? false;
    this.hardcore = opts.hardcore ?? false;
    this.preserveBugs = opts.preserveBugs ?? false;
    this.status = opts.status ?? null;
    this.questLevel = opts.questLevel ?? null;
    this.tutorial = opts.tutorial ?? new TutorialState();
    this.tutorialOverlay = opts.tutorialOverlay ?? new TutorialOverlayState();
    this.typo = opts.typo ?? new TypoState();
    this.perkAvailable = opts.perkAvailable ?? Array.from({ length: PERK_COUNT_SIZE }, () => false);
    this.weaponAvailable = opts.weaponAvailable ?? Array.from({ length: WEAPON_COUNT_SIZE }, () => false);
    this.friendlyFireEnabled = opts.friendlyFireEnabled ?? false;
    this.bonusSpawnGuard = opts.bonusSpawnGuard ?? false;
    this.playerAltWeaponSwapCooldownMs = opts.playerAltWeaponSwapCooldownMs ?? 0;
    this.bonusHud = opts.bonusHud ?? new BonusHudState();
    this.bonusPool = opts.bonusPool ?? new BonusPool();
    this.deferredFreezeCorpseFx = opts.deferredFreezeCorpseFx ?? [];
    this.playerDeathHookSkipIndices = opts.playerDeathHookSkipIndices ?? new Set();
    this.shockChainLinksLeft = opts.shockChainLinksLeft ?? 0;
    this.shockChainProjectileId = opts.shockChainProjectileId ?? -1;
    this.survivalRewardWeaponGuardId = opts.survivalRewardWeaponGuardId ?? WeaponId.PISTOL;
    this.survivalRewardHandoutEnabled = opts.survivalRewardHandoutEnabled ?? true;
    this.survivalRewardFireSeen = opts.survivalRewardFireSeen ?? false;
    this.survivalRewardDamageSeen = opts.survivalRewardDamageSeen ?? false;
    this.survivalRecentDeathPos = opts.survivalRecentDeathPos ?? [new Vec2(), new Vec2(), new Vec2()];
    this.survivalRecentDeathCount = opts.survivalRecentDeathCount ?? 0;
    this.cameraShakeOffset = opts.cameraShakeOffset ?? new Vec2();
    this.cameraShakeTimer = opts.cameraShakeTimer ?? 0.0;
    this.cameraShakePulses = opts.cameraShakePulses ?? 0;
    this.shotsFired = opts.shotsFired ?? Array.from({ length: 4 }, () => 0);
    this.shotsFiredTotal = opts.shotsFiredTotal ?? 0;
    this.shotsHit = opts.shotsHit ?? Array.from({ length: 4 }, () => 0);
    this.playerSpreadDampingScalar = opts.playerSpreadDampingScalar ?? 1.0;
    this.playerSpreadDampingGate = opts.playerSpreadDampingGate ?? 0.0;
    this.weaponShotsFired = opts.weaponShotsFired ?? Array.from({ length: Math.max(0, 4) }, (_, i) => i).map((_) => Array.from({ length: WEAPON_COUNT_SIZE }, () => 0));
    this.debugGodMode = opts.debugGodMode ?? false;
    this.particles = new ParticlePool({ rng: this.rng });
    this.spriteEffects = new SpriteEffectPool({ rng: this.rng });
  }
}

export function buildGameplayState(): GameplayState {
  return new GameplayState();
}

export function playerFrameDtAfterRoundtrip(opts: { dt: number; timeScaleActive: boolean; reflexBoostTimer: number }): number {
  // Mirror `player_update` frame_dt round-trip under Reflex Boost.
  //
  // Native scales frame_dt for movement (`* 0.6 / _time_scale_factor`) and then
  // restores it with `* _time_scale_factor * 1.6666666` before returning.

  const dt = opts.dt;
  const timeScaleActive = opts.timeScaleActive;
  const reflexBoostTimer = opts.reflexBoostTimer;
  const dtF32 = f32(dt);
  if (!timeScaleActive || dtF32 <= 0.0) {
    return dtF32;
  }

  const reflexF32 = f32(reflexBoostTimer);
  let timeScaleFactor = f32(0.3);
  if (reflexF32 < 1.0) {
    timeScaleFactor = f32((1.0 - reflexF32) * 0.7 + 0.3);
  }
  if (timeScaleFactor <= 0.0) {
    return dtF32;
  }

  const movementDt = f32((0.6 / timeScaleFactor) * dtF32);
  const roundtripDt = f32(timeScaleFactor * movementDt * 1.6666666);
  return roundtripDt;
}

export function awardExperience(state: GameplayState, player: PlayerState, amount: number): number {
  // Grant XP while honoring active bonus multipliers.

  let xp = int(amount);
  if (xp <= 0) {
    return 0;
  }
  if (state.bonuses.doubleExperience > 0.0) {
    xp *= 2;
  }
  player.experience += xp;
  return xp;
}

function awardExperienceOnceFromReward(player: PlayerState, rewardValue: number): number {
  // Mirror native `__ftol(player_xp + reward_value)` accumulation for one award.

  const rewardF32 = f32(rewardValue);
  if (rewardF32 <= 0.0) {
    return 0;
  }

  const before = int(player.experience);
  const totalF32 = f32(f32(before) + rewardF32);
  const after = int(totalF32);
  player.experience = int(after);
  return int(after - before);
}

export function awardExperienceFromReward(state: GameplayState, player: PlayerState, rewardValue: number): number {
  // Grant kill XP from floating reward values with native float32 store semantics.

  let gained = awardExperienceOnceFromReward(player, rewardValue);
  if (gained <= 0) {
    return 0;
  }
  if (state.bonuses.doubleExperience > 0.0) {
    gained += awardExperienceOnceFromReward(player, rewardValue);
  }
  return int(gained);
}

export function survivalLevelThreshold(level: number): number {
  // Return the XP threshold for advancing past the given level.

  level = Math.max(1, int(level));
  return int(1000.0 + (Math.pow(level, 1.8) * 1000.0));
}

export function survivalCheckLevelUp(player: PlayerState, perkState: PerkSelectionState): number {
  // Advance survival levels if XP exceeds thresholds, returning number of level-ups.

  // Native progression advances at most one level per update tick even when
  // XP jumps across multiple thresholds in a single frame.
  if (player.experience > survivalLevelThreshold(player.level)) {
    player.level += 1;
    perkState.pendingCount += 1;
    perkState.choicesDirty = true;
    return 1;
  }
  return 0;
}

export function survivalProgressionUpdate(state: GameplayState, players: PlayerState[]): void {
  // Advance survival level/perk progression.

  if (players.length === 0) {
    return;
  }
  survivalCheckLevelUp(players[0], state.perkSelection);
}

export function survivalRecordRecentDeath(state: GameplayState, opts: { pos: Vec2 }): void {
  // Track Survival recent-death samples used by one-off weapon handout gating.

  const pos = opts.pos;
  let recentCount = int(state.survivalRecentDeathCount);
  if (recentCount >= 6) {
    return;
  }

  if (recentCount < 3) {
    state.survivalRecentDeathPos[recentCount] = new Vec2(f32(pos.x), f32(pos.y));
  }

  recentCount += 1;
  state.survivalRecentDeathCount = int(recentCount);
  if (recentCount === 3) {
    state.survivalRewardFireSeen = false;
    state.survivalRewardHandoutEnabled = false;
  }
}

export function survivalUpdateWeaponHandouts(state: GameplayState, players: PlayerState[], opts: { survivalElapsedMs: number }): void {
  // Apply native `survival_update` one-off Survival weapon handout checks.

  const survivalElapsedMs = opts.survivalElapsedMs;
  if (players.length !== 1) {
    return;
  }
  const player = players[0];

  if (!state.survivalRewardDamageSeen && !state.survivalRewardFireSeen && int(survivalElapsedMs) > 64000 && state.survivalRewardHandoutEnabled) {
    if (player.weapon.weaponId === WeaponId.PISTOL) {
      _weaponAssignPlayer(player, WeaponId.SHRINKIFIER_5K, { state: state });
      state.survivalRewardWeaponGuardId = WeaponId.SHRINKIFIER_5K;
    }
    state.survivalRewardHandoutEnabled = false;
    state.survivalRewardDamageSeen = true;
    state.survivalRewardFireSeen = true;
  }

  if (int(state.survivalRecentDeathCount) === 3 && !state.survivalRewardFireSeen) {
    const [pos0, pos1, pos2] = state.survivalRecentDeathPos;
    const centroidX = f32(f32(pos0.x + pos1.x + pos2.x) * _SURVIVAL_RECENT_DEATH_CENTROID_SCALE);
    const centroidY = f32(f32(pos0.y + pos1.y + pos2.y) * _SURVIVAL_RECENT_DEATH_CENTROID_SCALE);
    const dx = player.pos.x - centroidX;
    const dy = player.pos.y - centroidY;
    if (Math.sqrt(dx * dx + dy * dy) < 16.0 && player.health < 15.0) {
      _weaponAssignPlayer(player, WeaponId.BLADE_GUN, { state: state });
      state.survivalRewardWeaponGuardId = WeaponId.BLADE_GUN;
      state.survivalRewardFireSeen = true;
      state.survivalRewardHandoutEnabled = false;
    }
  }
}

export function survivalEnforceRewardWeaponGuard(state: GameplayState, players: readonly PlayerState[]): void {
  // Revoke temporary Survival handout weapons when guard id mismatches.

  const guardId = state.survivalRewardWeaponGuardId;
  for (const player of players) {
    const weaponId = player.weapon.weaponId;
    if (weaponId === WeaponId.BLADE_GUN && guardId !== WeaponId.BLADE_GUN) {
      _weaponAssignPlayer(player, WeaponId.PISTOL, { state: state });
    }
    if (weaponId === WeaponId.SHRINKIFIER_5K && guardId !== WeaponId.SHRINKIFIER_5K) {
      _weaponAssignPlayer(player, WeaponId.PISTOL, { state: state });
    }
  }
}

function distanceF32Xy(ax: number, ay: number, bx: number, by: number): number {
  const dx = f32(ax - bx);
  const dy = f32(ay - by);
  const distSq = f32(f32(dx * dx) + f32(dy * dy));
  return f32(Math.sqrt(distSq));
}

function playerApplyMoveWithSpawnAvoidance(player: PlayerState, opts: { delta: Vec2; spawnSlots: readonly SpawnSlotInit[] | null; creatures: readonly CreatureState[] | null }): void {
  // Port of native `player_apply_move_with_spawn_avoidance` (0x0041e290).

  const delta = opts.delta;
  const spawnSlots = opts.spawnSlots;
  const creatures = opts.creatures;
  let dx = delta.x;
  let dy = delta.y;
  if (perkActive(player, PerkId.ALTERNATE_WEAPON)) {
    dx = f32(dx * 0.8);
    dy = f32(dy * 0.8);
  }

  let posX = f32(player.pos.x + dx);
  let posY = f32(player.pos.y + dy);

  if (spawnSlots !== null && spawnSlots.length > 0 && creatures !== null && creatures.length > 0) {
    for (const slot of spawnSlots) {
      const ownerIndex = int(slot.ownerCreature);
      if (!(ownerIndex >= 0 && ownerIndex < creatures.length)) {
        continue;
      }
      const owner = creatures[ownerIndex];
      const ownerPos = owner.pos;

      const radius = f32((owner.size + player.size) * 0.33333334);
      if (distanceF32Xy(ownerPos.x, ownerPos.y, posX, posY) > radius) {
        continue;
      }

      // Collision: revert, then try axis resolution.
      const oldX = f32(posX - dx);
      const oldY = f32(posY - dy);
      const oldDist = distanceF32Xy(ownerPos.x, ownerPos.y, oldX, oldY);
      const xCandidate = f32(oldX + dx);
      const yCandidate = f32(oldY + dy);

      if (radius < oldDist) {
        // X-only move.
        posX = xCandidate;
        posY = oldY;
        if (distanceF32Xy(ownerPos.x, ownerPos.y, posX, posY) <= radius) {
          // Y-only move.
          posX = f32(xCandidate - dx);
          posY = yCandidate;
          if (distanceF32Xy(ownerPos.x, ownerPos.y, posX, posY) <= radius) {
            posY = f32(yCandidate - dy);
          }
        }
      } else {
        posX = xCandidate;
        posY = yCandidate;
      }
    }
  }

  player.pos = new Vec2(posX, posY);
}

function directionFromHeadingNative(heading: number): Vec2 {
  // Native uses `fcos/fsin(heading - 1.5707964f)` (float32 half-pi literal),
  // but this path keeps x87-style precision for trig and rounds at downstream
  // float32 storage boundaries (delta/aim writes), not inside this helper.
  const radians = heading - NATIVE_HALF_PI;
  return new Vec2(Math.cos(radians), Math.sin(radians));
}

function resolveMoveModeForUpdate(inputState: PlayerInput, state: GameplayState): MovementControlType {
  const moveMode = inputState.moveMode;
  if (moveMode !== null) {
    return moveMode;
  }
  if (state.demoModeActive) {
    return MovementControlType.COMPUTER;
  }
  if (inputState.moveForwardPressed !== null && inputState.moveBackwardPressed !== null && inputState.turnLeftPressed !== null && inputState.turnRightPressed !== null) {
    return MovementControlType.STATIC;
  }
  if (inputState.moveToCursorPressed) {
    return MovementControlType.MOUSE_POINT_CLICK;
  }
  return MovementControlType.DUAL_ACTION_PAD;
}

function resolveAimSchemeForUpdate(inputState: PlayerInput, state: GameplayState): AimScheme {
  const aimScheme = inputState.aimScheme;
  if (aimScheme !== null) {
    return aimScheme;
  }
  if (state.demoModeActive) {
    return AimScheme.COMPUTER;
  }
  return AimScheme.MOUSE;
}

function playerAccelerateMoveSpeed(player: PlayerState, dt: number): void {
  dt = f32(dt);
  if (perkActive(player, PerkId.LONG_DISTANCE_RUNNER)) {
    if (player.moveSpeed < 2.0) {
      player.moveSpeed = f32(player.moveSpeed + dt * 4.0);
    }
    player.moveSpeed = f32(player.moveSpeed + dt);
    if (player.moveSpeed > 2.8) {
      player.moveSpeed = 2.8;
    }
  } else {
    player.moveSpeed = f32(player.moveSpeed + dt * 5.0);
    if (player.moveSpeed > 2.0) {
      player.moveSpeed = 2.0;
    }
  }
}

function playerDecelerateMoveSpeed(player: PlayerState, dt: number): void {
  dt = f32(dt);
  player.moveSpeed = f32(player.moveSpeed - dt * 15.0);
  if (player.moveSpeed < 0.0) {
    player.moveSpeed = 0.0;
  }
}

function playerApplyMoveSpeedCaps(player: PlayerState): void {
  if (player.weapon.weaponId === WeaponId.MEAN_MINIGUN && player.moveSpeed > 0.8) {
    player.moveSpeed = 0.8;
  }
}

function playerMoveDeltaFromHeading(opts: { player: PlayerState; movementDt: number; speedScale: number }): Vec2 {
  const player = opts.player;
  const movementDt = opts.movementDt;
  const speedScale = opts.speedScale;
  const move = directionFromHeadingNative(player.heading);
  const moveDx = f32(move.x * player.moveSpeed * speedScale);
  const moveDy = f32(move.y * player.moveSpeed * speedScale);
  return new Vec2(f32(movementDt * moveDx), f32(movementDt * moveDy));
}

function playerAimPointFromHeading(player: PlayerState, heading: number, opts: { radius?: number } = {}): Vec2 {
  const radius = opts.radius ?? _AIM_POINT_RADIUS;
  const aimDir = directionFromHeadingNative(heading);
  return new Vec2(f32(player.pos.x + aimDir.x * radius), f32(player.pos.y + aimDir.y * radius));
}

function aimHeadingFromAimPointNative(playerPos: Vec2, aimPos: Vec2): number {
  // `player_update` (0x004136b0): aim_heading = (float)(fpatan(pos_y-aim_y, pos_x-aim_x) - 1.5707964)
  // Keep atan2 wide and narrow once at store to mirror x87-style rounding.
  const dy = playerPos.y - aimPos.y;
  const dx = playerPos.x - aimPos.x;
  return f32(Math.atan2(dy, dx) - NATIVE_HALF_PI);
}

function playerUpdateAimByScheme(opts: { player: PlayerState; inputState: PlayerInput; dt: number; movementMode: MovementControlType; aimScheme: AimScheme; demoModeActive: boolean }): void {
  const player = opts.player;
  const inputState = opts.inputState;
  const dt = opts.dt;
  const movementMode = opts.movementMode;
  const aimScheme = opts.aimScheme;
  const demoModeActive = opts.demoModeActive;
  let targetAim = inputState.aim;

  if (!demoModeActive && aimScheme !== AimScheme.COMPUTER) {
    if (aimScheme === AimScheme.KEYBOARD) {
      if (movementMode === MovementControlType.RELATIVE || movementMode === MovementControlType.STATIC) {
        if (Boolean(inputState.turnRightPressed)) {
          player.aimHeading = f32(player.aimHeading + f32(dt * _AIM_KEYBOARD_TURN_RATE));
        }
        if (Boolean(inputState.turnLeftPressed)) {
          player.aimHeading = f32(player.aimHeading - f32(dt * _AIM_KEYBOARD_TURN_RATE));
        }
        targetAim = playerAimPointFromHeading(player, player.aimHeading);
      }
    } else if (aimScheme === AimScheme.JOYSTICK) {
      if (Boolean(inputState.turnRightPressed)) {
        player.aimHeading = f32(player.aimHeading + f32(dt * _AIM_JOYSTICK_TURN_RATE));
      }
      if (Boolean(inputState.turnLeftPressed)) {
        player.aimHeading = f32(player.aimHeading - f32(dt * _AIM_JOYSTICK_TURN_RATE));
      }
      targetAim = playerAimPointFromHeading(player, player.aimHeading);
    } else if (aimScheme === AimScheme.UNKNOWN) {
      targetAim = playerAimPointFromHeading(player, player.aimHeading);
    }
  }

  player.aim = targetAim;
  const aimDir = (player.aim.sub(player.pos)).normalized();
  if (aimDir.lengthSq() > 0.0) {
    player.aimDir = aimDir;
    player.aimHeading = aimHeadingFromAimPointNative(player.pos, player.aim);
  }
}

export function playerUpdate(player: PlayerState, inputState: PlayerInput, dt: number, state: GameplayState, opts: { detailPreset?: number; worldSize?: number; players?: PlayerState[] | null; creatures?: readonly CreatureState[] | null; spawnSlots?: readonly SpawnSlotInit[] | null; onPlayerLethal?: ((arg0: PlayerState) => void) | null; reloadActiveAny?: boolean | null } = {}): void {
  // Port of `player_update` (0x004136b0) for the rewrite runtime.

  const detailPreset = opts.detailPreset ?? 5;
  const worldSize = opts.worldSize ?? 1024.0;
  const players = opts.players ?? null;
  const creatures = opts.creatures ?? null;
  const spawnSlots = opts.spawnSlots ?? null;
  const onPlayerLethal = opts.onPlayerLethal ?? null;
  const reloadActiveAny = opts.reloadActiveAny ?? null;
  dt = f32(dt);
  if (dt <= 0.0) {
    return;
  }

  const prevPos = player.pos;

  if (player.health <= 0.0) {
    player.deathTimer -= dt * 20.0;
    return;
  }

  // Native low-health warning pulse (`player_update` @ 0x004136b0): once
  // `player_take_damage` has armed `low_health_timer` (!= 100.0), count down
  // while HP < 20 and emit a 3x blood splatter + bloodspill SFX burst.
  if (player.lowHealthTimer !== 100.0 && player.health < 20.0) {
    const nextLowHealthTimer = f32(player.lowHealthTimer - dt);
    player.lowHealthTimer = nextLowHealthTimer;
    if (nextLowHealthTimer < 0.0) {
      const bleedDirAngle = player.aimHeading + _LOW_HEALTH_BLEED_DIR_OFFSET;
      const bleedPos = new Vec2(f32(Math.cos(bleedDirAngle) * -6.0 + player.pos.x), f32(Math.sin(bleedDirAngle) * -6.0 + player.pos.y));
      const aimHeading = player.aimHeading;
      for (let i = 0; i < 3; i++) {
        state.effects.spawnBloodSplatter({
          pos: bleedPos,
          angle: aimHeading,
          age: 0.0,
          rng: state.rng,
          detailPreset: int(detailPreset),
          violenceDisabled: 0,
        });
      }
      const bloodspillSfx = LOW_HEALTH_BLOODSPILL_SFX[state.rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_LOW_HEALTH_BLOODSPILL }) & 1];
      state.sfxQueue.push(bloodspillSfx);
      player.lowHealthTimer = 1.0;
    }
  }

  let dampingScalar = f32(state.playerSpreadDampingScalar);
  if (state.playerSpreadDampingGate <= 0.0) {
    dampingScalar = f32(dampingScalar + f32(dt * 0.8));
    if (dampingScalar > 1.0) {
      dampingScalar = 1.0;
    }
  } else {
    dampingScalar = f32(dampingScalar - dt);
    if (dampingScalar < 0.3) {
      dampingScalar = 0.3;
    }
  }
  state.playerSpreadDampingScalar = dampingScalar;

  player.muzzleFlashAlpha = Math.max(0.0, player.muzzleFlashAlpha - dt * 2.0);
  const cooldownDecay = f32(dt * (state.bonuses.weaponPowerUp > 0.0 ? 1.5 : 1.0));
  const nextShotCooldown = f32(player.weapon.shotCooldown - cooldownDecay);
  player.weapon.shotCooldown = Math.max(0.0, nextShotCooldown);
  if (0.0 < player.weapon.shotCooldown && player.weapon.shotCooldown < 1e-6) {
    player.weapon.shotCooldown = 0.0;
  }

  const speedBonusActive = player.speedBonusTimer > 0.0;
  if (player.auxTimer > 0.0) {
    const auxDecay = player.auxTimer >= 1.0 ? 1.4 : 0.5;
    player.auxTimer = Math.max(0.0, player.auxTimer - dt * auxDecay);
  }

  const moveMode = resolveMoveModeForUpdate(inputState, state);
  const aimScheme = resolveAimSchemeForUpdate(inputState, state);

  let speedMultiplier = player.speedMultiplier;
  if (speedBonusActive) {
    speedMultiplier += 1.0;
  }

  let movementDt = dt;
  let timeScaleFactor: number;
  if (state.timeScaleActive && movementDt > 0.0) {
    const reflexF32 = f32(state.bonuses.reflexBoost);
    timeScaleFactor = f32(0.3);
    if (reflexF32 < 1.0) {
      timeScaleFactor = f32((1.0 - reflexF32) * 0.7 + 0.3);
    }
    if (timeScaleFactor > 0.0) {
      // Native computes `frame_dt = (0.6 / _time_scale_factor) * frame_dt`
      // and stores back to float before movement/heading logic.
      movementDt = f32((0.6 / timeScaleFactor) * movementDt);
    }
  }

  const perkTickStationary = Math.abs(player.moveSpeed) <= 1e-9;
  applyPlayerPerkTicks({
    player: player,
    playerPosBeforeMove: prevPos,
    dt: dt,
    state: state,
    players: players,
    stationary: perkTickStationary,
    ownerRefForPlayer: _ownerRefForPlayer,
    ownerRefForPlayerProjectiles: _ownerRefForPlayerProjectiles,
    projectileSpawn: _projectileSpawn,
  });

  // Movement.
  const rawMove = inputState.move;
  const rawMag = rawMove.length();
  let phaseSign = 1.0;
  let move = directionFromHeadingNative(player.heading);
  let speed = 0.0;
  let moveDeltaOverride: Vec2 | null = null;
  const playerControlledMovement = (!state.demoModeActive && moveMode !== MovementControlType.COMPUTER && aimScheme !== AimScheme.COMPUTER);
  let movingInput: boolean;
  let turnAlignmentScale: number;
  if (playerControlledMovement) {
    let turningLeft: boolean;
    let turningRight: boolean;
    let movingForward: boolean;
    let movingBackward: boolean;
    let turned: boolean;
    let targetHeading: number;
    if (moveMode === MovementControlType.RELATIVE) {
      turningLeft = Boolean(inputState.turnLeftPressed);
      turningRight = Boolean(inputState.turnRightPressed);
      movingForward = Boolean(inputState.moveForwardPressed);
      movingBackward = Boolean(inputState.moveBackwardPressed);
      turned = false;

      if (player.turnSpeed < 1.0) {
        player.turnSpeed = 1.0;
      }
      if (player.turnSpeed > 7.0) {
        player.turnSpeed = 7.0;
      }

      let turnStep: number;
      if (turningLeft) {
        player.turnSpeed = f32(player.turnSpeed + movementDt * 10.0);
        turnStep = f32(player.turnSpeed * movementDt * 0.5);
        player.heading = f32(player.heading - turnStep);
        player.aimHeading = f32(player.aimHeading - turnStep);
        turned = true;
      } else if (turningRight) {
        player.turnSpeed = f32(player.turnSpeed + movementDt * 10.0);
        turnStep = f32(player.turnSpeed * movementDt * 0.5);
        player.heading = f32(player.heading + turnStep);
        player.aimHeading = f32(player.aimHeading + turnStep);
        turned = true;
      }

      if (movingForward) {
        playerAccelerateMoveSpeed(player, movementDt);
        playerApplyMoveSpeedCaps(player);
        moveDeltaOverride = playerMoveDeltaFromHeading({ player: player, movementDt: movementDt, speedScale: 25.0 });
      } else if (movingBackward) {
        playerAccelerateMoveSpeed(player, movementDt);
        phaseSign = -1.0;
        moveDeltaOverride = playerMoveDeltaFromHeading({ player: player, movementDt: movementDt, speedScale: -25.0 });
      } else {
        if (!turned) {
          player.turnSpeed = 1.0;
        }
        playerDecelerateMoveSpeed(player, movementDt);
        moveDeltaOverride = playerMoveDeltaFromHeading({ player: player, movementDt: movementDt, speedScale: 25.0 });
      }
    } else if (moveMode === MovementControlType.STATIC) {
      movingForward = inputState.moveForwardPressed !== null ? Boolean(inputState.moveForwardPressed) : rawMove.y < -0.5;
      movingBackward = inputState.moveBackwardPressed !== null ? Boolean(inputState.moveBackwardPressed) : rawMove.y > 0.5;
      turningLeft = inputState.turnLeftPressed !== null ? Boolean(inputState.turnLeftPressed) : rawMove.x < -0.5;
      turningRight = inputState.turnRightPressed !== null ? Boolean(inputState.turnRightPressed) : rawMove.x > 0.5;

      targetHeading = _RELATIVE_MOVE_HEADING_NONE;
      if (turningLeft) {
        targetHeading = _RELATIVE_MOVE_HEADING_LEFT;
      }
      if (turningRight) {
        targetHeading = _RELATIVE_MOVE_HEADING_RIGHT;
      }

      if (movingForward) {
        if (turningLeft) {
          targetHeading = _RELATIVE_MOVE_HEADING_FORWARD_LEFT;
        } else if (turningRight) {
          targetHeading = _RELATIVE_MOVE_HEADING_FORWARD_RIGHT;
        } else {
          targetHeading = _RELATIVE_MOVE_HEADING_FORWARD;
        }
      }
      if (movingBackward) {
        if (turningLeft) {
          targetHeading = _RELATIVE_MOVE_HEADING_BACKWARD_LEFT;
        } else if (turningRight) {
          targetHeading = _RELATIVE_MOVE_HEADING_BACKWARD_RIGHT;
        } else {
          targetHeading = _RELATIVE_MOVE_HEADING_BACKWARD;
        }
      }

      let moveDx: number;
      let moveDy: number;
      let angleDiff: ReturnType<typeof playerHeadingApproachTargetWithDelta>[0];
      if (!movingBackward && targetHeading === _RELATIVE_MOVE_HEADING_NONE) {
        playerDecelerateMoveSpeed(player, movementDt);
        move = directionFromHeadingNative(player.heading);
        moveDx = f32(move.x * player.moveSpeed * speedMultiplier * 25.0);
        moveDy = f32(move.y * player.moveSpeed * speedMultiplier * 25.0);
      } else {
        let turnDelta: ReturnType<typeof playerHeadingApproachTargetWithDelta>[1];
        [angleDiff, turnDelta] = playerHeadingApproachTargetWithDelta(player, targetHeading, movementDt);
        player.aimHeading = f32(player.aimHeading + turnDelta);
        playerAccelerateMoveSpeed(player, movementDt);
        playerApplyMoveSpeedCaps(player);
        move = directionFromHeadingNative(player.heading);
        const turnAlign = ((NATIVE_PI - angleDiff) * speedMultiplier * _RELATIVE_MOVE_TURN_ALIGN_SCALE);
        moveDx = f32(move.x * player.moveSpeed * turnAlign);
        moveDy = f32(move.y * player.moveSpeed * turnAlign);
      }

      moveDeltaOverride = new Vec2(f32(movementDt * moveDx), f32(movementDt * moveDy));
    } else {
      movingInput = rawMag > (moveMode === MovementControlType.MOUSE_POINT_CLICK ? 0.0 : 0.2);
      turnAlignmentScale = 1.0;
      let inv: number;
      let angleDiff: ReturnType<typeof playerHeadingApproachTarget>;
      if (movingInput) {
        inv = rawMag > 1e-9 ? 1.0 / rawMag : 0.0;
        move = rawMove.mul(inv);
        targetHeading = normalizeHeadingAngle(move.toHeading());
        angleDiff = playerHeadingApproachTarget(player, targetHeading, movementDt);
        move = directionFromHeadingNative(player.heading);
        turnAlignmentScale = Math.max(0.0, (Math.PI - angleDiff) / Math.PI);
        playerAccelerateMoveSpeed(player, movementDt);
      } else {
        playerDecelerateMoveSpeed(player, movementDt);
        move = directionFromHeadingNative(player.heading);
      }

      playerApplyMoveSpeedCaps(player);
      speed = player.moveSpeed * speedMultiplier * 25.0;
      if (movingInput) {
        speed *= Math.min(1.0, rawMag);
        speed *= turnAlignmentScale;
      }
    }
  } else {
    // Demo/autoplay uses very small analog magnitudes to represent turn-in-place and
    // heading alignment slowdown; don't apply a deadzone there.
    movingInput = rawMag > (state.demoModeActive ? 0.0 : 0.2);

    turnAlignmentScale = 1.0;
    let inv: number;
    let targetHeading: ReturnType<typeof normalizeHeadingAngle>;
    let angleDiff: ReturnType<typeof playerHeadingApproachTarget>;
    if (movingInput) {
      inv = rawMag > 1e-9 ? 1.0 / rawMag : 0.0;
      move = rawMove.mul(inv);
      // Native normalizes this heading into [0, 2pi] before calling
      // `player_heading_approach_target` (see ghidra @ 0x00413fxx).
      targetHeading = normalizeHeadingAngle(move.toHeading());
      angleDiff = playerHeadingApproachTarget(player, targetHeading, movementDt);
      move = directionFromHeadingNative(player.heading);
      turnAlignmentScale = Math.max(0.0, (Math.PI - angleDiff) / Math.PI);
      playerAccelerateMoveSpeed(player, movementDt);
    } else {
      playerDecelerateMoveSpeed(player, movementDt);
      move = directionFromHeadingNative(player.heading);
    }

    playerApplyMoveSpeedCaps(player);

    speed = player.moveSpeed * speedMultiplier * 25.0;
    if (movingInput) {
      speed *= Math.min(1.0, rawMag);
      speed *= turnAlignmentScale;
    }
  }

  let moveDelta: Vec2;
  if (moveDeltaOverride === null) {
    // Native movement stores through float32 velocity/delta slots before writing
    // player position; mirror those store boundaries for replay parity.
    const moveStep = f32(speed * movementDt);
    moveDelta = new Vec2(f32(move.x * moveStep), f32(move.y * moveStep));
  } else {
    moveDelta = moveDeltaOverride;
  }
  playerApplyMoveWithSpawnAvoidance(
    player,
    { delta: moveDelta, spawnSlots: spawnSlots, creatures: creatures },
  );

  player.movePhase += phaseSign * movementDt * player.moveSpeed * 19.0;

  moveDelta = player.pos.sub(prevPos);
  const reloadStationary = Math.abs(moveDelta.x) <= 1e-9 && Math.abs(moveDelta.y) <= 1e-9;
  if (!reloadStationary) {
    // Native clears these post-perk-tick timers after movement when position changed.
    player.manBombTimer = 0.0;
    player.livingFortressTimer = 0.0;
  }
  let reloadScale = 1.0;
  if (reloadStationary && perkActive(player, PerkId.STATIONARY_RELOADER)) {
    reloadScale = 3.0;
  }

  // Reload + reload perks.
  if (perkActive(player, PerkId.ANXIOUS_LOADER) && inputState.firePressed && player.weapon.reloadTimer > 0.0) {
    const anxiousNext = f32(player.weapon.reloadTimer - 0.05);
    player.weapon.reloadTimer = anxiousNext;
    if (anxiousNext <= 0.0) {
      // Native restarts the tail of the reload at `frame_dt * 0.8` when
      // Anxious Loader overcuts the timer.
      player.weapon.reloadTimer = f32(dt * 0.8);
    }
  }

  const reloadTimerNow = f32(player.weapon.reloadTimer);
  const dtF32 = f32(dt);
  // Native preloads ammo one frame before reload timer underflows using the
  // unscaled `frame_dt` (before Stationary Reloader scale is applied). That
  // can miss reload completion when Stationary Reloader is active, leaving the
  // clip empty and causing a one-shot reload loop (fixed by default).
  let preloadDt = dtF32;
  if (!state.preserveBugs) {
    preloadDt = f32(reloadScale * dtF32);
  }

  const reloadPreloadUnderflow = f32(reloadTimerNow - preloadDt);
  // Native can complete reload and fire on the same frame when held fire
  // meets an almost-zero reload boundary. Treat near-zero underflow as
  // completion for fire-held ticks to avoid a spurious empty-shot reload loop.
  const preloadCrossed = reloadPreloadUnderflow < -_RELOAD_PRELOAD_UNDERFLOW_EPS;
  const preloadFireBoundary = inputState.fireDown && reloadPreloadUnderflow <= _RELOAD_PRELOAD_UNDERFLOW_EPS;
  if (player.weapon.reloadActive && reloadTimerNow > 0.0 && (preloadCrossed || preloadFireBoundary)) {
    player.weapon.ammo = player.weapon.clipSize;
  }

  if (player.weapon.reloadTimer > 0.0) {
    if (perkActive(player, PerkId.ANGRY_RELOADER) && player.weapon.reloadTimerMax > 0.5 && (player.weapon.reloadTimerMax * 0.5) < player.weapon.reloadTimer) {
      const half = player.weapon.reloadTimerMax * 0.5;
      const nextTimer = f32(player.weapon.reloadTimer - reloadScale * dt);
      player.weapon.reloadTimer = nextTimer;
      if (nextTimer <= half) {
        const count = 7 + int(player.weapon.reloadTimerMax * 4.0);
        state.bonusSpawnGuard = true;
        _spawnProjectileRing(
          state,
          player.pos,
          { count: count, angleOffset: 0.1, typeId: ProjectileTemplateId.PLASMA_MINIGUN, owner: _ownerRefForPlayerProjectiles(state, player.index), ownerPlayerIndex: player.index, players: players },
        );
        state.bonusSpawnGuard = false;
        state.sfxQueue.push(SfxId.EXPLOSION_SMALL);
      }
    } else {
      player.weapon.reloadTimer = f32(player.weapon.reloadTimer - reloadScale * dt);
    }
  }

  if (player.weapon.reloadTimer < 0.0) {
    player.weapon.reloadTimer = 0.0;
  }

  const hasAltWeaponPerk = perkActive(player, PerkId.ALTERNATE_WEAPON);
  const singlePlayerMode = players !== null ? (players.length === 1) : true;
  const manualReloadAllowed = (inputState.reloadPressed && !state.demoModeActive && !hasAltWeaponPerk && moveMode !== MovementControlType.MOUSE_POINT_CLICK && player.weapon.reloadTimer === 0.0 && Boolean(singlePlayerMode));
  if (manualReloadAllowed) {
    _playerStartReload(player, state);
  }

  playerUpdateAimByScheme({
    player: player,
    inputState: inputState,
    dt: dt,
    movementMode: moveMode,
    aimScheme: aimScheme,
    demoModeActive: state.demoModeActive,
  });

  // Native cools spread after perk timers/movement but before weapon fire.
  // Keeping this below `apply_player_perk_ticks` preserves Fire Cough spread
  // sampling order while still applying cooldown before `player_fire_weapon`.
  if (perkActive(player, PerkId.SHARPSHOOTER)) {
    player.spreadHeat = 0.02;
  } else {
    player.spreadHeat = Math.max(0.01, player.spreadHeat - dt * 0.4);
  }

  const fireGateOpenPreReload = player.weapon.shotCooldown <= 0.0 && player.weapon.reloadTimer === 0.0;

  // Native clears `reload_active` whenever the cooldown/timer gates are open,
  // even if ammo is empty and perk firing paths can still proceed.
  if (fireGateOpenPreReload) {
    player.weapon.reloadActive = false;
  }

  let swappedAltWeapon = false;
  const reloadKeyActive = inputState.reloadDown || inputState.reloadPressed;
  const reloadKeyReleased = reloadActiveAny !== null ? !Boolean(reloadActiveAny) : !reloadKeyActive;
  let cooldownMs: number;
  if (hasAltWeaponPerk) {
    cooldownMs = int(state.playerAltWeaponSwapCooldownMs);
    const dtMs = dt > 0.0 ? ftolMsI32(dt) : 0;
    if (cooldownMs < 1) {
      cooldownMs = 0;
    } else {
      cooldownMs -= dtMs;
    }

    if (cooldownMs < 1 && reloadKeyActive) {
      if (_playerSwapAltWeapon(player)) {
        swappedAltWeapon = true;
        const weapon = _weaponEntry(player.weapon.weaponId);
        state.sfxQueue.push(weapon.reloadSound);
        player.weapon.shotCooldown = player.weapon.shotCooldown + 0.1;
        state.playerAltWeaponSwapCooldownMs = 200;
      } else {
        state.playerAltWeaponSwapCooldownMs = 0;
      }
    } else {
      state.playerAltWeaponSwapCooldownMs = Math.max(0, int(cooldownMs));
      if (reloadKeyReleased) {
        state.playerAltWeaponSwapCooldownMs = 0;
      }
    }
  }

  // Native computes the fire gate (`shot_cooldown <= 0 && reload_timer == 0`)
  // before alt-weapon swap mutates cooldown; preserve same-tick fire eligibility.
  const forcePreSwapFireGate = swappedAltWeapon && fireGateOpenPreReload && inputState.fireDown;
  if (forcePreSwapFireGate) {
    player.weapon.shotCooldown = 0.0;
  }

  if (inputState.fireDown) {
    state.survivalRewardFireSeen = true;
  }

  _fireWeapon(new _WeaponFireCtx({ player: player, inputState: inputState, dt: dt, state: state, detailPreset: int(detailPreset), creatures: creatures, players: players, forcePreSwapFireGate: forcePreSwapFireGate, onPlayerLethal: onPlayerLethal }));

  while (player.movePhase > 14.0) {
    player.movePhase -= 14.0;
  }
  while (player.movePhase < 0.0) {
    player.movePhase += 14.0;
  }

  const halfSize = Math.max(0.0, player.size * 0.5);
  const clampedPos = player.pos.clampRect(halfSize, halfSize, worldSize - halfSize, worldSize - halfSize);
  player.pos = new Vec2(f32(clampedPos.x), f32(clampedPos.y));
  if (player.muzzleFlashAlpha > 0.8) {
    player.muzzleFlashAlpha = 0.8;
  }
}

function playerHeadingApproachTargetWithDelta(player: PlayerState, targetHeading: number, dt: number): [number, number] {
  // Native `player_heading_approach_target`: ease heading and return (diff, turn_delta).

  // Native runs this through float32 temporaries (`var_8`/`edx_1`) before the
  // direct-vs-wrapped compare and turn-sign branch. That quantization matters
  // near opposite-heading ties.
  const heading = f32(normalizeHeadingAngle(player.heading));
  player.heading = heading;
  const target = f32(targetHeading);

  const direct = f32(Math.abs(f32((target - heading))));
  let high = heading;
  if (target > high) {
    high = target;
  }
  let low = heading;
  if (target < low) {
    low = target;
  }
  const wrapped = f32(Math.abs(f32(NATIVE_TAU - high + low)));
  const diff = direct >= wrapped ? wrapped : direct;

  const dtF32 = f32(dt);
  // Native computes `player_heading_turn_delta = frame_dt * diff * 5.0` via
  // float32 temporaries/spills. Quantize `frame_dt * diff` to float32 before
  // applying the `* 5.0` to match x87 store boundaries.
  const scaled = f32(dtF32 * diff);
  let turnDelta: number;
  if (direct <= wrapped) {
    if (target > heading) {
      turnDelta = f32(scaled * 5.0);
    } else {
      turnDelta = f32(scaled * -5.0);
    }
  } else {
    if (target >= heading) {
      turnDelta = f32(scaled * -5.0);
    } else {
      turnDelta = f32(scaled * 5.0);
    }
  }

  player.heading = f32(heading + turnDelta);
  return [diff, turnDelta];
}

function playerHeadingApproachTarget(player: PlayerState, targetHeading: number, dt: number): number {
  const [diff, ] = playerHeadingApproachTargetWithDelta(player, targetHeading, dt);
  return diff;
}

function normalizeHeadingAngle(value: number): number {
  const tau = NATIVE_TAU;
  let angle = f32(value);
  while (angle < 0.0) {
    angle = f32(angle + tau);
  }
  while (angle > tau) {
    angle = f32(angle - tau);
  }
  return angle;
}

const _SURVIVAL_RECENT_DEATH_CENTROID_SCALE = 0.33333334;
