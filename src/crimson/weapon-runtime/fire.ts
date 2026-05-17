// Port of crimson/weapon_runtime/fire.py

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import type { CrandLike } from '@grim/rand.ts';
import { NATIVE_TAU, f32, headingFromDeltaF32 } from '@crimson/math-parity.ts';
import { PerkId } from '@crimson/perks/index.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import { SecondarySpawnSpec } from '@crimson/projectiles/runtime/index.ts';
import { ProjectileTemplateId, SecondaryProjectileTypeId } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { PlayerInput } from '@crimson/sim/input.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { WEAPON_TABLE, WeaponId, weaponEntryForProjectileTypeId } from '@crimson/weapons.ts';
import { playerStartReload, weaponEntry } from '@crimson/weapon-runtime/assign.ts';
import { MaskCenteredJitter, ModuloCenteredJitter, ModuloSpeedScale, MultiPlasmaFanMode, NoJitter, NoSpeedScale, ParticleStreamMode, PrimaryPelletsMode, SecondaryShotMode, SwarmerDumpMode, UseAimTargetHint, resolveFireRecipe } from '@crimson/weapon-runtime/fire-recipes.ts';
import { ownerRefForPlayer, ownerRefForPlayerProjectiles, travelBudgetForTypeId } from '@crimson/weapon-runtime/spawn.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import { playerTakeDamage } from '@crimson/player-damage.ts';

export const WEAPON_COUNT_SIZE = Math.max(...Array.from(WEAPON_TABLE, (entry) => int(entry.weaponId))) + 1;
export const NATIVE_FIRE_MUZZLE_SPRITES: Map<number, readonly [number, number, number][]> = new Map([
  [WeaponId.PISTOL, [[25.0, 1.0, 0.23], [15.0, 2.0, 0.213]]],
  [WeaponId.ASSAULT_RIFLE, [[25.0, 1.0, 0.23], [15.0, 2.0, 0.213]]],
  [WeaponId.SHOTGUN, [[25.0, 1.0, 0.25], [15.0, 2.0, 0.223]]],
  [WeaponId.SAWED_OFF_SHOTGUN, [[25.0, 1.0, 0.26], [15.0, 2.0, 0.233]]],
  [WeaponId.SUBMACHINE_GUN, [[25.0, 1.0, 0.23], [15.0, 2.0, 0.213]]],
  [WeaponId.GAUSS_GUN, [[25.0, 1.0, 0.33], [15.0, 2.0, 0.263]]],
  [WeaponId.ROCKET_LAUNCHER, [[25.0, 1.0, 0.34], [15.0, 2.0, 0.283]]],
  [WeaponId.SEEKER_ROCKETS, [[25.0, 1.0, 0.31], [15.0, 2.0, 0.243]]],
  [WeaponId.MINI_ROCKET_SWARMERS, [[25.0, 1.0, 0.34], [15.0, 2.0, 0.283]]],
  [WeaponId.ROCKET_MINIGUN, [[25.0, 1.0, 0.34]]],
  [WeaponId.JACKHAMMER, [[15.0, 2.0, 0.223]]],
  [WeaponId.SHRINKIFIER_5K, [[25.0, 1.0, 0.23], [15.0, 2.0, 0.213]]],
  [WeaponId.GAUSS_SHOTGUN, [[25.0, 1.0, 0.33], [15.0, 2.0, 0.263]]],
]);
export const NATIVE_FIRE_MUZZLE_AFTER_PROJECTILE: ReadonlySet<number> = new Set([
  WeaponId.PISTOL,
  WeaponId.SHRINKIFIER_5K,
]);
export const PELLET_JITTER_CALLER_BY_WEAPON: Map<WeaponId, number> = new Map([
  [WeaponId.SHOTGUN, RngCallerStatic.PLAYER_UPDATE_SHOTGUN_PELLET_JITTER],
  [WeaponId.SAWED_OFF_SHOTGUN, RngCallerStatic.PLAYER_UPDATE_SAWED_OFF_SHOTGUN_PELLET_JITTER],
  [WeaponId.JACKHAMMER, RngCallerStatic.PLAYER_UPDATE_JACKHAMMER_PELLET_JITTER],
  [WeaponId.ION_SHOTGUN, RngCallerStatic.PLAYER_UPDATE_ION_SHOTGUN_PELLET_JITTER],
  [WeaponId.GAUSS_SHOTGUN, RngCallerStatic.PLAYER_UPDATE_GAUSS_SHOTGUN_PELLET_JITTER],
  [WeaponId.PLASMA_SHOTGUN, RngCallerStatic.PLAYER_UPDATE_PLASMA_SHOTGUN_PELLET_JITTER],
]);
export const PELLET_SPEED_SCALE_CALLER_BY_WEAPON: Map<WeaponId, number> = new Map([
  [WeaponId.SHOTGUN, RngCallerStatic.PLAYER_UPDATE_SHOTGUN_PELLET_SPEED_SCALE],
  [WeaponId.SAWED_OFF_SHOTGUN, RngCallerStatic.PLAYER_UPDATE_SAWED_OFF_SHOTGUN_PELLET_SPEED_SCALE],
  [WeaponId.JACKHAMMER, RngCallerStatic.PLAYER_UPDATE_JACKHAMMER_PELLET_SPEED_SCALE],
  [WeaponId.ION_SHOTGUN, RngCallerStatic.PLAYER_UPDATE_ION_SHOTGUN_PELLET_SPEED_SCALE],
  [WeaponId.GAUSS_SHOTGUN, RngCallerStatic.PLAYER_UPDATE_GAUSS_SHOTGUN_PELLET_SPEED_SCALE],
  [WeaponId.PLASMA_SHOTGUN, RngCallerStatic.PLAYER_UPDATE_PLASMA_SHOTGUN_PELLET_SPEED_SCALE],
]);

export class WeaponFireCtx {
  player: PlayerState;
  inputState: PlayerInput;
  dt: number;
  state: GameplayState;
  detailPreset: number;
  creatures: readonly CreatureState[] | null;
  players: readonly PlayerState[] | null;
  forcePreSwapFireGate: boolean;
  onPlayerLethal: ((arg0: PlayerState) => void) | null;

  constructor(opts: {
    player: PlayerState;
    inputState: PlayerInput;
    dt: number;
    state: GameplayState;
    detailPreset?: number;
    creatures?: readonly CreatureState[] | null;
    players?: readonly PlayerState[] | null;
    forcePreSwapFireGate?: boolean;
    onPlayerLethal?: ((arg0: PlayerState) => void) | null;
  }) {
    this.player = opts.player;
    this.inputState = opts.inputState;
    this.dt = opts.dt;
    this.state = opts.state;
    this.detailPreset = opts.detailPreset ?? 5;
    this.creatures = opts.creatures ?? null;
    this.players = opts.players ?? null;
    this.forcePreSwapFireGate = opts.forcePreSwapFireGate ?? false;
    this.onPlayerLethal = opts.onPlayerLethal ?? null;
  }
}

export class WeaponFireResult {
  readonly fired: boolean;
  readonly shotCount: number;
  readonly ammoCost: number;

  constructor(opts: {
    fired: boolean;
    shotCount?: number;
    ammoCost?: number;
  }) {
    this.fired = opts.fired;
    this.shotCount = opts.shotCount ?? 0;
    this.ammoCost = opts.ammoCost ?? 0.0;
  }
}

function spawnNativeFireMuzzleSprites(opts: { state: GameplayState; weaponId: number; muzzle: Vec2; aimHeading: number; fireBulletsActive: boolean }): void {
  const state = opts.state;
  const weaponId = opts.weaponId;
  const muzzle = opts.muzzle;
  const aimHeading = opts.aimHeading;
  const fireBulletsActive = opts.fireBulletsActive;
  let specs: any;
  if (fireBulletsActive) {
    specs = [[25.0, 1.0, 0.413]];
  } else {
    specs = NATIVE_FIRE_MUZZLE_SPRITES.get(int(weaponId)) ?? [];
  }
  if (specs.length === 0) {
    return;
  }

  for (let [speed, scale, alpha] of specs) {
    state.spriteEffects.spawn({
      pos: muzzle,
      vel: Vec2.fromHeading(aimHeading).mul(speed),
      scale: scale,
      color: new RGBA(0.5, 0.5, 0.5, alpha),
    });
  }
}

function nativeShotAngleWithJitter(opts: { aim: Vec2; playerPos: Vec2; spreadHeat: number; rng: CrandLike }): number {
  // Native gameplay fire owns two exact `player_update` draw sites for the
  // disc-spread direction and magnitude before the later projectile work.
  const aim = opts.aim;
  const playerPos = opts.playerPos;
  const spreadHeat = opts.spreadHeat;
  const rng = opts.rng;
  const aimDx = f32(aim.x - playerPos.x);
  const aimDy = f32(aim.y - playerPos.y);
  const distSq = f32(f32(aimDx * aimDx) + f32(aimDy * aimDy));
  const dist = f32(Math.sqrt(distSq));
  const maxOffset = f32(f32(dist * spreadHeat) * 0.5);

  const dirAngle = f32((rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_SHOT_JITTER_DIR }) & 0x1FF) * (NATIVE_TAU / 512.0));
  const mag = f32((rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_SHOT_JITTER_MAG }) & 0x1FF) * (1.0 / 512.0));
  const offset = f32(maxOffset * mag);

  const dirX = f32(Math.cos(dirAngle));
  const dirY = f32(Math.sin(dirAngle));
  const aimJitterX = f32(aim.x + f32(dirX * offset));
  const aimJitterY = f32(aim.y + f32(dirY * offset));

  const shotDx = f32(aimJitterX - playerPos.x);
  const shotDy = f32(aimJitterY - playerPos.y);
  return headingFromDeltaF32({ dx: shotDx, dy: shotDy });
}

function applyPelletJitter(opts: { shotAngle: number; rng: CrandLike; jitterRule: NoJitter | ModuloCenteredJitter | MaskCenteredJitter; caller?: number | null }): number {
  const shotAngle = opts.shotAngle;
  const rng = opts.rng;
  const jitterRule = opts.jitterRule;
  const caller = opts.caller ?? null;
  if (jitterRule instanceof NoJitter) {
    return shotAngle;
  } else if (jitterRule instanceof ModuloCenteredJitter) {
    const modulo = jitterRule.modulo;
    const center = jitterRule.center;
    const step = jitterRule.step;
    return shotAngle + (rng.rand({ caller: caller }) % int(modulo) - int(center)) * step;
  } else if (jitterRule instanceof MaskCenteredJitter) {
    const mask = jitterRule.mask;
    const center = jitterRule.center;
    const step = jitterRule.step;
    return shotAngle + ((rng.rand({ caller: caller }) & int(mask)) - int(center)) * step;
  } else {
    throw new Error('unreachable match case');
  }
}

function applySpeedScaleRule(opts: { state: GameplayState; projId: number; speedRule: NoSpeedScale | ModuloSpeedScale; caller?: number | null }): void {
  const state = opts.state;
  const projId = opts.projId;
  const speedRule = opts.speedRule;
  const caller = opts.caller ?? null;
  if (speedRule instanceof NoSpeedScale) {
    return;
  } else if (speedRule instanceof ModuloSpeedScale) {
    const base = speedRule.base;
    const modulo = speedRule.modulo;
    const step = speedRule.step;
    state.projectiles.entries[int(projId)].speedScale = base + state.rng.rand({ caller: caller }) % int(modulo) * step;
  }
}

export function fireWeapon(ctx: WeaponFireCtx): WeaponFireResult {
  const player = ctx.player;
  const inputState = ctx.inputState;
  const dt = ctx.dt;
  const state = ctx.state;
  const creatures = ctx.creatures;
  const players = ctx.players;
  const forcePreSwapFireGate = ctx.forcePreSwapFireGate;
  const onPlayerLethal = ctx.onPlayerLethal;

  const weaponId = player.weapon.weaponId;
  const weapon = weaponEntry(weaponId);

  if (!forcePreSwapFireGate && player.weapon.shotCooldown > 0.0) {
    return new WeaponFireResult({ fired: false });
  }
  if (!inputState.fireDown) {
    return new WeaponFireResult({ fired: false });
  }

  let ammoCost = 1.0;
  const isFireBullets = player.fireBulletsTimer > 0.0;
  if (!forcePreSwapFireGate && player.weapon.reloadTimer > 0.0) {
    if (player.experience <= 0) {
      return new WeaponFireResult({ fired: false });
    }
    let ammoClass: number;
    if (perkActive(player, PerkId.REGRESSION_BULLETS)) {
      ammoClass = weapon.ammoClass !== null ? int(weapon.ammoClass) : 0;

      const reloadTime = weapon.reloadTime;
      const factor = ammoClass === 1 ? 4.0 : 200.0;
      player.experience = int(player.experience - reloadTime * factor);
      if (player.experience < 0) {
        player.experience = 0;
      }
    } else if (perkActive(player, PerkId.AMMUNITION_WITHIN)) {
      ammoClass = weapon.ammoClass !== null ? int(weapon.ammoClass) : 0;


      const cost = ammoClass === 1 ? 0.15 : 1.0;
      playerTakeDamage(
        state,
        player,
        cost,
        { dt: dt, players: players, onLethal: onPlayerLethal !== null ? (() => onPlayerLethal(player)) : null },
      );
    } else {
      return new WeaponFireResult({ fired: false });
    }
  }

  const pelletCount = int(weapon.pelletCount);
  const fireBulletsWeapon = weaponEntryForProjectileTypeId(ProjectileTemplateId.FIRE_BULLETS);

  let shotCooldown = f32(weapon.shotCooldown);
  const weaponSpreadHeat = weapon.spreadHeatInc;
  const fireBulletsSpreadHeat = fireBulletsWeapon.spreadHeatInc;

  if (isFireBullets && pelletCount === 1) {
    shotCooldown = f32(fireBulletsWeapon.shotCooldown);
  }

  const spreadHeatBase = isFireBullets ? fireBulletsSpreadHeat : weaponSpreadHeat;
  const spreadInc = spreadHeatBase * 1.3;

  if (perkActive(player, PerkId.FASTSHOT)) {
    shotCooldown = f32(shotCooldown * 0.88);
  }
  if (perkActive(player, PerkId.SHARPSHOOTER)) {
    shotCooldown = f32(shotCooldown * 1.05);
  }
  player.weapon.shotCooldown = Math.max(0.0, f32(shotCooldown));

  const aim = inputState.aim;
  const aimDelta = aim.sub(player.pos);
  const aimHeading = headingFromDeltaF32({ dx: aimDelta.x, dy: aimDelta.y });

  const muzzle = player.pos.add(Vec2.fromHeading(aimHeading).rotated(-0.150915).mul(16.0));
  const weaponFlags = int(weapon.flags || 0);
  if (weaponFlags & 0x1) {
    // Native gameplay fire uses four exact `player_update` RNG sites for
    // the casing effect before the later shot-angle jitter work.
    const shellCasingDraws: [number, number, number, number] = [state.rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_CASING_ANGLE }), state.rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_CASING_SPEED }), state.rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_CASING_ROTATION }), state.rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_CASING_ROTATION_STEP })];
    state.effects.spawnShellCasing({
      pos: muzzle,
      aimHeading: aimHeading,
      draws: shellCasingDraws,
      detailPreset: int(ctx.detailPreset),
    });
  }

  const shotAngle = nativeShotAngleWithJitter({ aim: aim, playerPos: player.pos, spreadHeat: player.spreadHeat, rng: state.rng });
  let particleAngle = Vec2.fromHeading(shotAngle).toAngle();
  if (weaponId === WeaponId.FLAMETHROWER || weaponId === WeaponId.BLOW_TORCH || weaponId === WeaponId.HR_FLAMER) {
    particleAngle = Vec2.fromHeading(aimHeading).toAngle();
  }

  // Native gameplay fire consumes one exact `player_update` RNG draw for shot
  // SFX variant selection on every non-Fire-Bullets shot.
  if (!isFireBullets) {
    state.rng.rand({ caller: RngCallerStatic.PLAYER_UPDATE_SHOT_SFX });
  }

  const owner = ownerRefForPlayer(player.index);
  const projectileOwner = ownerRefForPlayerProjectiles(state, player.index);
  let shotCount = 1;
  const spawnMuzzleAfterProjectile = isFireBullets || (NATIVE_FIRE_MUZZLE_AFTER_PROJECTILE as ReadonlySet<unknown>).has(int(weaponId));
  if (!spawnMuzzleAfterProjectile) {
    spawnNativeFireMuzzleSprites({
      state: state,
      weaponId: int(weaponId),
      muzzle: muzzle,
      aimHeading: aimHeading,
      fireBulletsActive: isFireBullets,
    });
  }

  const recipe = resolveFireRecipe(weaponId, { pelletCount: pelletCount, fireBulletsActive: isFireBullets });
  ammoCost = recipe.ammoCost;

  if (recipe.mode instanceof PrimaryPelletsMode) {
    const typeId = recipe.mode.typeId;
    const count = recipe.mode.count;
    const jitterRule = recipe.mode.jitter;
    const speedRule = recipe.mode.speedScale;
    if (typeId === null) {
      throw new Error(`missing projectile type in recipe for weapon ${int(weaponId)}`);
    }
    const pellets = Math.max(0, int(count !== null ? count : 0));
    shotCount = pellets;
    const meta = travelBudgetForTypeId(typeId);
    const pelletJitterCaller = isFireBullets ? null : PELLET_JITTER_CALLER_BY_WEAPON.get(weaponId) ?? null;
    const pelletSpeedCaller = isFireBullets ? null : PELLET_SPEED_SCALE_CALLER_BY_WEAPON.get(weaponId) ?? null;
    for (let i = 0; i < pellets; i++) {
      let angle = applyPelletJitter({ shotAngle: shotAngle, rng: state.rng, jitterRule: jitterRule, caller: pelletJitterCaller });
      const projId = state.projectiles.spawn({ pos: muzzle, angle: angle, typeId: typeId, owner: projectileOwner, travelBudget: meta });
      applySpeedScaleRule({
        state: state,
        projId: int(projId),
        speedRule: speedRule,
        caller: pelletSpeedCaller,
      });
    }
  } else if (recipe.mode instanceof SecondaryShotMode) {
    const typeId = recipe.mode.typeId;
    const targeting = recipe.mode.targeting;
    let targetHint = null;
    let spawnCreatures = null;
    if (targeting instanceof UseAimTargetHint) {
      targetHint = aim;
      spawnCreatures = creatures;
    } else {
    }
    state.secondaryProjectiles.spawnFromSpec(new SecondarySpawnSpec({ pos: muzzle, angle: shotAngle, typeId: typeId, owner: owner, targetHint: targetHint, creatures: spawnCreatures, preserveBugs: state.preserveBugs }));
  } else if (recipe.mode instanceof ParticleStreamMode) {
    const style = recipe.mode.style;
    const slow = recipe.mode.slow;
    if (slow) {
      state.particles.spawnParticleSlow({
        pos: muzzle,
        angle: Vec2.fromHeading(shotAngle).toAngle(),
        owner: owner,
      });
    } else {
      const particleId = state.particles.spawnParticle({ pos: muzzle, angle: particleAngle, intensity: 1.0, owner: owner });
      if (style !== null) {
        state.particles.entries[particleId].styleId = style;
      }
    }
  } else if (recipe.mode instanceof MultiPlasmaFanMode) {
    // Multi-Plasma: 5-shot fixed spread using type 0x09 and 0x0B.
    shotCount = 5;
    const spreadSmall = Math.PI / 10;
    const spreadLarge = Math.PI / 6;
    const patterns: readonly [number, ProjectileTemplateId][] = [[-spreadSmall, ProjectileTemplateId.PLASMA_RIFLE], [-spreadLarge, ProjectileTemplateId.PLASMA_MINIGUN], [0.0, ProjectileTemplateId.PLASMA_RIFLE], [spreadLarge, ProjectileTemplateId.PLASMA_MINIGUN], [spreadSmall, ProjectileTemplateId.PLASMA_RIFLE]];
    for (let [angleOffset, typeId] of patterns) {
      state.projectiles.spawn({
        pos: muzzle,
        angle: shotAngle + angleOffset,
        typeId: typeId,
        owner: projectileOwner,
        travelBudget: travelBudgetForTypeId(typeId),
      });
    }
  } else if (recipe.mode instanceof SwarmerDumpMode) {
    // Mini-Rocket Swarmers -> secondary type 2 (fires the full clip in a spread).
    const rocketCount = Math.max(1, int(player.weapon.ammo));
    let step: number;
    let angle: number;
    if (state.preserveBugs) {
      // Native bug: step scales by ammo (`ammo * pi/3`), which aliases to identical headings
      // for some clip sizes (e.g. 6 rockets), causing visible clumping.
      step = rocketCount * (Math.PI / 3.0);
      angle = (shotAngle - Math.PI) - step * rocketCount * 0.5;
    } else {
      const spread = Math.PI * (2.0 / 3.0);
      step = rocketCount <= 1 ? 0.0 : spread / (rocketCount - 1);
      angle = shotAngle - spread * 0.5;
    }
    for (let i = 0; i < rocketCount; i++) {
      state.secondaryProjectiles.spawnFromSpec(new SecondarySpawnSpec({ pos: muzzle, angle: angle, typeId: SecondaryProjectileTypeId.HOMING_ROCKET, owner: owner, targetHint: aim, creatures: creatures, preserveBugs: state.preserveBugs }));
      angle += step;
    }
    ammoCost = rocketCount;
    shotCount = rocketCount;
  }
  if (int(player.index) >= 0 && int(player.index) < state.shotsFired.length) {
    state.shotsFired[int(player.index)] += int(shotCount);
    if (0 <= weaponId && weaponId < WEAPON_COUNT_SIZE) {
      state.weaponShotsFired[int(player.index)][weaponId] += int(shotCount);
    }
  }

  if (spawnMuzzleAfterProjectile) {
    spawnNativeFireMuzzleSprites({
      state: state,
      weaponId: int(weaponId),
      muzzle: muzzle,
      aimHeading: aimHeading,
      fireBulletsActive: isFireBullets,
    });
  }

  if (!perkActive(player, PerkId.SHARPSHOOTER)) {
    player.spreadHeat = Math.min(0.48, Math.max(0.0, player.spreadHeat + spreadInc));
  }

  let muzzleInc = weaponSpreadHeat;
  if (isFireBullets && pelletCount === 1) {
    muzzleInc = fireBulletsSpreadHeat;
  }
  player.muzzleFlashAlpha = Math.min(1.0, player.muzzleFlashAlpha);
  player.muzzleFlashAlpha = Math.min(1.0, player.muzzleFlashAlpha + muzzleInc);
  player.muzzleFlashAlpha = Math.min(0.8, player.muzzleFlashAlpha);

  player.shotSeq += 1;
  if (state.bonuses.reflexBoost <= 0.0 && !isFireBullets) {
    // Native allows ammo to cross below zero for reload-time firing paths
    // (for example Regression Bullets), and replay checkpoints rely on that.
    player.weapon.ammo = player.weapon.ammo - ammoCost;
  }
  let reloadStartGateOpen = player.weapon.reloadTimer <= 0.0;
  if (forcePreSwapFireGate) {
    // Alt-weapon same-tick fire uses the pre-swap gate (reload_timer==0) for
    // reload restart eligibility after ammo drains below zero.
    reloadStartGateOpen = true;
  }
  if (player.weapon.ammo <= 0.0 && reloadStartGateOpen) {
    playerStartReload(player, state);
  }
  return new WeaponFireResult({ fired: true, shotCount: int(shotCount), ammoCost: ammoCost });
}
