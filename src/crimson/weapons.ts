// Port of crimson/weapons.py

// Weapon definitions for the rewrite runtime.
//
// Weapon ids use native 1-based values (e.g. `weapon_id=1` for Pistol).
// Projectile `type_id` values route projectile behavior and template lookups.
// By native design they reuse the same numeric ids as `WeaponId` for default
// cases, with explicit overrides for remapped templates and non-primary paths
// (particle/secondary pools).
//
// Use `projectile_type_id_for_weapon_id` for the primary projectile `type_id`.
// Weapons that use particle or secondary projectile pools raise `ValueError`.
//
// Reference material:
// - `docs/re/static/reference/weapon-table.md`
// - `docs/re/static/reference/weapon-id-map.md`

import { SfxId } from '@grim/sfx-map.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';

export class Weapon {
  readonly weaponId: WeaponId;
  readonly name: string;
  readonly ammoClass: number | null;
  readonly clipSize: number;
  readonly shotCooldown: number;
  readonly reloadTime: number;
  readonly spreadHeatInc: number;
  readonly fireSound: SfxId;
  readonly reloadSound: SfxId;
  readonly iconIndex: number;
  readonly flags: number | null;
  readonly travelBudget: number;
  readonly damageScale: number;
  readonly pelletCount: number;

  constructor(opts: {
    weaponId: WeaponId;
    name: string;
    ammoClass: number | null;
    clipSize: number;
    shotCooldown: number;
    reloadTime: number;
    spreadHeatInc: number;
    fireSound: SfxId;
    reloadSound: SfxId;
    iconIndex: number;
    flags: number | null;
    travelBudget: number;
    damageScale: number;
    pelletCount: number;
  }) {
    this.weaponId = opts.weaponId;
    this.name = opts.name;
    this.ammoClass = opts.ammoClass;
    this.clipSize = opts.clipSize;
    this.shotCooldown = opts.shotCooldown;
    this.reloadTime = opts.reloadTime;
    this.spreadHeatInc = opts.spreadHeatInc;
    this.fireSound = opts.fireSound;
    this.reloadSound = opts.reloadSound;
    this.iconIndex = opts.iconIndex;
    this.flags = opts.flags;
    this.travelBudget = opts.travelBudget;
    this.damageScale = opts.damageScale;
    this.pelletCount = opts.pelletCount;
  }
}

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

export enum WeaponId {
  NONE = 0,
  PISTOL = 1,
  ASSAULT_RIFLE = 2,
  SHOTGUN = 3,
  SAWED_OFF_SHOTGUN = 4,
  SUBMACHINE_GUN = 5,
  GAUSS_GUN = 6,
  MEAN_MINIGUN = 7,
  FLAMETHROWER = 8,
  PLASMA_RIFLE = 9,
  MULTI_PLASMA = 10,
  PLASMA_MINIGUN = 11,
  ROCKET_LAUNCHER = 12,
  SEEKER_ROCKETS = 13,
  PLASMA_SHOTGUN = 14,
  BLOW_TORCH = 15,
  HR_FLAMER = 16,
  MINI_ROCKET_SWARMERS = 17,
  ROCKET_MINIGUN = 18,
  PULSE_GUN = 19,
  JACKHAMMER = 20,
  ION_RIFLE = 21,
  ION_MINIGUN = 22,
  ION_CANNON = 23,
  SHRINKIFIER_5K = 24,
  BLADE_GUN = 25,
  SPIDER_PLASMA = 26,
  EVIL_SCYTHE = 27,
  PLASMA_CANNON = 28,
  SPLITTER_GUN = 29,
  GAUSS_SHOTGUN = 30,
  ION_SHOTGUN = 31,
  FLAMEBURST = 32,
  RAYGUN = 33,
  UNKNOWN_34 = 34,
  UNKNOWN_35 = 35,
  UNKNOWN_36 = 36,
  UNKNOWN_37 = 37,
  UNKNOWN_38 = 38,
  UNKNOWN_39 = 39,
  UNKNOWN_40 = 40,
  PLAGUE_SPREADER_GUN = 41,
  BUBBLEGUN = 42,
  RAINBOW_GUN = 43,
  GRIM_WEAPON = 44,
  FIRE_BULLETS = 45,
  UNKNOWN_46 = 46,
  UNKNOWN_47 = 47,
  UNKNOWN_48 = 48,
  UNKNOWN_49 = 49,
  TRANSMUTATOR = 50,
  BLASTER_R_300 = 51,
  LIGHTNING_RIFLE = 52,
  NUKE_LAUNCHER = 53,
}

export const WEAPON_TABLE = [
  new Weapon({
    weaponId: WeaponId.PISTOL,
    name: 'Pistol',
    ammoClass: 0,
    clipSize: 12,
    shotCooldown: 0.7117,
    reloadTime: 1.2,
    spreadHeatInc: 0.22,
    fireSound: SfxId.PISTOL_FIRE,
    reloadSound: SfxId.PISTOL_RELOAD,
    iconIndex: 0,
    flags: 5,
    travelBudget: 55,
    damageScale: 4.1,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.ASSAULT_RIFLE,
    name: 'Assault Rifle',
    ammoClass: 0,
    clipSize: 25,
    shotCooldown: 0.117,
    reloadTime: 1.2,
    spreadHeatInc: 0.09,
    fireSound: SfxId.AUTORIFLE_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 1,
    flags: 1,
    travelBudget: 50,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.SHOTGUN,
    name: 'Shotgun',
    ammoClass: 0,
    clipSize: 12,
    shotCooldown: 0.85,
    reloadTime: 1.9,
    spreadHeatInc: 0.27,
    fireSound: SfxId.SHOTGUN_FIRE,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 2,
    flags: 1,
    travelBudget: 60,
    damageScale: 1.2,
    pelletCount: 12,
  }),
  new Weapon({
    weaponId: WeaponId.SAWED_OFF_SHOTGUN,
    name: 'Sawed-off Shotgun',
    ammoClass: 0,
    clipSize: 12,
    shotCooldown: 0.87,
    reloadTime: 1.9,
    spreadHeatInc: 0.13,
    fireSound: SfxId.SHOTGUN_FIRE,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 3,
    flags: 1,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 12,
  }),
  new Weapon({
    weaponId: WeaponId.SUBMACHINE_GUN,
    name: 'Submachine Gun',
    ammoClass: 0,
    clipSize: 30,
    shotCooldown: 0.088117,
    reloadTime: 1.2,
    spreadHeatInc: 0.082,
    fireSound: SfxId.HRPM_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 4,
    flags: 5,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.GAUSS_GUN,
    name: 'Gauss Gun',
    ammoClass: 0,
    clipSize: 6,
    shotCooldown: 0.6,
    reloadTime: 1.6,
    spreadHeatInc: 0.42,
    fireSound: SfxId.GAUSS_FIRE,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 5,
    flags: 1,
    travelBudget: 215,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.MEAN_MINIGUN,
    name: 'Mean Minigun',
    ammoClass: 0,
    clipSize: 120,
    shotCooldown: 0.09,
    reloadTime: 4.0,
    spreadHeatInc: 0.062,
    fireSound: SfxId.AUTORIFLE_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 6,
    flags: 3,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.FLAMETHROWER,
    name: 'Flamethrower',
    ammoClass: 1,
    clipSize: 30,
    shotCooldown: 0.008113,
    reloadTime: 2.0,
    spreadHeatInc: 0.015,
    fireSound: SfxId.FLAMER_FIRE_01,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 7,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.PLASMA_RIFLE,
    name: 'Plasma Rifle',
    ammoClass: 0,
    clipSize: 20,
    shotCooldown: 0.2908117,
    reloadTime: 1.2,
    spreadHeatInc: 0.182,
    fireSound: SfxId.SHOCK_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 8,
    flags: null,
    travelBudget: 30,
    damageScale: 5.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.MULTI_PLASMA,
    name: 'Multi-Plasma',
    ammoClass: 0,
    clipSize: 8,
    shotCooldown: 0.6208117,
    reloadTime: 1.4,
    spreadHeatInc: 0.32,
    fireSound: SfxId.SHOCK_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 9,
    flags: null,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 3,
  }),
  new Weapon({
    weaponId: WeaponId.PLASMA_MINIGUN,
    name: 'Plasma Minigun',
    ammoClass: 0,
    clipSize: 30,
    shotCooldown: 0.11,
    reloadTime: 1.3,
    spreadHeatInc: 0.097,
    fireSound: SfxId.PLASMAMINIGUN_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 10,
    flags: null,
    travelBudget: 35,
    damageScale: 2.1,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.ROCKET_LAUNCHER,
    name: 'Rocket Launcher',
    ammoClass: 2,
    clipSize: 5,
    shotCooldown: 0.7408117,
    reloadTime: 1.2,
    spreadHeatInc: 0.42,
    fireSound: SfxId.ROCKET_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD_ALT,
    iconIndex: 11,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.SEEKER_ROCKETS,
    name: 'Seeker Rockets',
    ammoClass: 2,
    clipSize: 8,
    shotCooldown: 0.3108117,
    reloadTime: 1.2,
    spreadHeatInc: 0.32,
    fireSound: SfxId.ROCKET_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD_ALT,
    iconIndex: 12,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.PLASMA_SHOTGUN,
    name: 'Plasma Shotgun',
    ammoClass: 0,
    clipSize: 8,
    shotCooldown: 0.48,
    reloadTime: 3.1,
    spreadHeatInc: 0.11,
    fireSound: SfxId.PLASMASHOTGUN_FIRE,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 13,
    flags: null,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 14,
  }),
  new Weapon({
    weaponId: WeaponId.BLOW_TORCH,
    name: 'Blow Torch',
    ammoClass: 1,
    clipSize: 30,
    shotCooldown: 0.006113,
    reloadTime: 1.5,
    spreadHeatInc: 0.01,
    fireSound: SfxId.FLAMER_FIRE_01,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 14,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.HR_FLAMER,
    name: 'HR Flamer',
    ammoClass: 1,
    clipSize: 30,
    shotCooldown: 0.0085,
    reloadTime: 1.8,
    spreadHeatInc: 0.01,
    fireSound: SfxId.FLAMER_FIRE_01,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 15,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.MINI_ROCKET_SWARMERS,
    name: 'Mini-Rocket Swarmers',
    ammoClass: 2,
    clipSize: 5,
    shotCooldown: 1.8,
    reloadTime: 1.8,
    spreadHeatInc: 0.12,
    fireSound: SfxId.ROCKET_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD_ALT,
    iconIndex: 16,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.ROCKET_MINIGUN,
    name: 'Rocket Minigun',
    ammoClass: 2,
    clipSize: 16,
    shotCooldown: 0.12,
    reloadTime: 1.8,
    spreadHeatInc: 0.12,
    fireSound: SfxId.ROCKETMINI_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD_ALT,
    iconIndex: 17,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.PULSE_GUN,
    name: 'Pulse Gun',
    ammoClass: 3,
    clipSize: 16,
    shotCooldown: 0.1,
    reloadTime: 0.1,
    spreadHeatInc: 0.0,
    fireSound: SfxId.PULSE_FIRE,
    reloadSound: SfxId.AUTORIFLE_RELOAD,
    iconIndex: 18,
    flags: 8,
    travelBudget: 20,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.JACKHAMMER,
    name: 'Jackhammer',
    ammoClass: 0,
    clipSize: 16,
    shotCooldown: 0.14,
    reloadTime: 3.0,
    spreadHeatInc: 0.16,
    fireSound: SfxId.SHOTGUN_FIRE,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 19,
    flags: 1,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 4,
  }),
  new Weapon({
    weaponId: WeaponId.ION_RIFLE,
    name: 'Ion Rifle',
    ammoClass: 4,
    clipSize: 8,
    shotCooldown: 0.4,
    reloadTime: 1.35,
    spreadHeatInc: 0.112,
    fireSound: SfxId.SHOCK_FIRE_ALT,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 20,
    flags: 8,
    travelBudget: 15,
    damageScale: 3.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.ION_MINIGUN,
    name: 'Ion Minigun',
    ammoClass: 4,
    clipSize: 20,
    shotCooldown: 0.1,
    reloadTime: 1.8,
    spreadHeatInc: 0.09,
    fireSound: SfxId.SHOCKMINIGUN_FIRE,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 21,
    flags: 8,
    travelBudget: 20,
    damageScale: 1.4,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.ION_CANNON,
    name: 'Ion Cannon',
    ammoClass: 4,
    clipSize: 3,
    shotCooldown: 1.0,
    reloadTime: 3.0,
    spreadHeatInc: 0.68,
    fireSound: SfxId.SHOCK_FIRE_ALT,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 22,
    flags: null,
    travelBudget: 10,
    damageScale: 16.7,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.SHRINKIFIER_5K,
    name: 'Shrinkifier 5k',
    ammoClass: 0,
    clipSize: 8,
    shotCooldown: 0.21,
    reloadTime: 1.22,
    spreadHeatInc: 0.04,
    fireSound: SfxId.SHOCK_FIRE_ALT,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 23,
    flags: 8,
    travelBudget: 45,
    damageScale: 0.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.BLADE_GUN,
    name: 'Blade Gun',
    ammoClass: 0,
    clipSize: 6,
    shotCooldown: 0.35,
    reloadTime: 3.5,
    spreadHeatInc: 0.04,
    fireSound: SfxId.SHOCK_FIRE_ALT,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 24,
    flags: 8,
    travelBudget: 20,
    damageScale: 11.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.SPIDER_PLASMA,
    name: 'Spider Plasma',
    ammoClass: 0,
    clipSize: 5,
    shotCooldown: 0.2,
    reloadTime: 1.2,
    spreadHeatInc: 0.04,
    fireSound: SfxId.BLOODSPILL_01,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 25,
    flags: 8,
    travelBudget: 10,
    damageScale: 0.5,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.EVIL_SCYTHE,
    name: 'Evil Scythe',
    ammoClass: 4,
    clipSize: 3,
    shotCooldown: 1.0,
    reloadTime: 3.0,
    spreadHeatInc: 0.68,
    fireSound: SfxId.SHOCK_FIRE_ALT,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 25,
    flags: null,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.PLASMA_CANNON,
    name: 'Plasma Cannon',
    ammoClass: 0,
    clipSize: 3,
    shotCooldown: 0.9,
    reloadTime: 2.7,
    spreadHeatInc: 0.6,
    fireSound: SfxId.SHOCK_FIRE,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 25,
    flags: null,
    travelBudget: 10,
    damageScale: 28.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.SPLITTER_GUN,
    name: 'Splitter Gun',
    ammoClass: 0,
    clipSize: 6,
    shotCooldown: 0.7,
    reloadTime: 2.2,
    spreadHeatInc: 0.28,
    fireSound: SfxId.SHOCK_FIRE_ALT,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 28,
    flags: null,
    travelBudget: 30,
    damageScale: 6.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.GAUSS_SHOTGUN,
    name: 'Gauss Shotgun',
    ammoClass: 0,
    clipSize: 4,
    shotCooldown: 1.05,
    reloadTime: 2.1,
    spreadHeatInc: 0.27,
    fireSound: SfxId.GAUSS_FIRE,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 30,
    flags: 1,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.ION_SHOTGUN,
    name: 'Ion Shotgun',
    ammoClass: 4,
    clipSize: 10,
    shotCooldown: 0.85,
    reloadTime: 1.9,
    spreadHeatInc: 0.27,
    fireSound: SfxId.SHOCK_FIRE_ALT,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 31,
    flags: 1,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 8,
  }),
  new Weapon({
    weaponId: WeaponId.FLAMEBURST,
    name: 'Flameburst',
    ammoClass: 4,
    clipSize: 60,
    shotCooldown: 0.02,
    reloadTime: 3.0,
    spreadHeatInc: 0.18,
    fireSound: SfxId.FLAMER_FIRE_01,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 29,
    flags: null,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.RAYGUN,
    name: 'RayGun',
    ammoClass: 4,
    clipSize: 12,
    shotCooldown: 0.7,
    reloadTime: 2.0,
    spreadHeatInc: 0.38,
    fireSound: SfxId.SHOCK_FIRE_ALT,
    reloadSound: SfxId.SHOCK_RELOAD,
    iconIndex: 30,
    flags: null,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.PLAGUE_SPREADER_GUN,
    name: 'Plague Sphreader Gun',
    ammoClass: null,
    clipSize: 5,
    shotCooldown: 0.2,
    reloadTime: 1.2,
    spreadHeatInc: 0.04,
    fireSound: SfxId.BLOODSPILL_01,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 40,
    flags: 8,
    travelBudget: 15,
    damageScale: 0.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.BUBBLEGUN,
    name: 'Bubblegun',
    ammoClass: null,
    clipSize: 15,
    shotCooldown: 0.1613,
    reloadTime: 1.2,
    spreadHeatInc: 0.05,
    fireSound: SfxId.BLOODSPILL_01,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 41,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.RAINBOW_GUN,
    name: 'Rainbow Gun',
    ammoClass: null,
    clipSize: 10,
    shotCooldown: 0.2,
    reloadTime: 1.2,
    spreadHeatInc: 0.09,
    fireSound: SfxId.BLOODSPILL_01,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 42,
    flags: 8,
    travelBudget: 10,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.GRIM_WEAPON,
    name: 'Grim Weapon',
    ammoClass: null,
    clipSize: 3,
    shotCooldown: 0.5,
    reloadTime: 1.2,
    spreadHeatInc: 0.4,
    fireSound: SfxId.BLOODSPILL_01,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 43,
    flags: null,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.FIRE_BULLETS,
    name: 'Fire bullets',
    ammoClass: null,
    clipSize: 112,
    shotCooldown: 0.14,
    reloadTime: 1.2,
    spreadHeatInc: 0.22,
    fireSound: SfxId.AUTORIFLE_FIRE,
    reloadSound: SfxId.PISTOL_RELOAD,
    iconIndex: 44,
    flags: 1,
    travelBudget: 60,
    damageScale: 0.25,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.TRANSMUTATOR,
    name: 'Transmutator',
    ammoClass: null,
    clipSize: 50,
    shotCooldown: 0.04,
    reloadTime: 5.0,
    spreadHeatInc: 0.04,
    fireSound: SfxId.BLOODSPILL_01,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 49,
    flags: 9,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.BLASTER_R_300,
    name: 'Blaster R-300',
    ammoClass: null,
    clipSize: 20,
    shotCooldown: 0.08,
    reloadTime: 2.0,
    spreadHeatInc: 0.05,
    fireSound: SfxId.SHOCK_FIRE,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 50,
    flags: 9,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.LIGHTNING_RIFLE,
    name: 'Lighting Rifle',
    ammoClass: null,
    clipSize: 500,
    shotCooldown: 4.0,
    reloadTime: 8.0,
    spreadHeatInc: 1.0,
    fireSound: SfxId.EXPLOSION_LARGE,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 51,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
  new Weapon({
    weaponId: WeaponId.NUKE_LAUNCHER,
    name: 'Nuke Launcher',
    ammoClass: null,
    clipSize: 1,
    shotCooldown: 4.0,
    reloadTime: 8.0,
    spreadHeatInc: 1.0,
    fireSound: SfxId.EXPLOSION_LARGE,
    reloadSound: SfxId.SHOTGUN_RELOAD,
    iconIndex: 52,
    flags: 8,
    travelBudget: 45,
    damageScale: 1.0,
    pelletCount: 1,
  }),
];
export const WEAPON_BY_ID: Map<WeaponId, Weapon> = new Map(Array.from(WEAPON_TABLE, (entry) => [entry.weaponId, entry] as const));
export const WEAPON_FIXED_NAMES: Map<WeaponId, string> = new Map([
  [WeaponId.PLAGUE_SPREADER_GUN, 'Plague Spreader Gun'],
  [WeaponId.LIGHTNING_RIFLE, 'Lightning Rifle'],
  [WeaponId.FIRE_BULLETS, 'Fire Bullets'],
]);

export function weaponDisplayName(weaponId: WeaponId, opts: { preserveBugs?: boolean } = {}): string {
  const preserveBugs = opts.preserveBugs ?? false;
  let entry: NonNullable<ReturnType<typeof WEAPON_BY_ID.get>>;
  try {
    entry = mapGetOrThrow(WEAPON_BY_ID, weaponId);
  } catch (exc) {
    return `weapon_${weaponId}`;
  }
  const name = entry.name;
  if (preserveBugs) {
    return String(name);
  }
  const fixed = WEAPON_FIXED_NAMES.get(weaponId) ?? null;
  if (fixed !== null) {
    return fixed;
  }
  return String(name);
}

export function weaponEntryForProjectileTypeId(typeId: ProjectileTemplateId): Weapon {
  //
  // Native `projectile_spawn` indexes weapon metadata by projectile type id.
  // The type id is the weapon id used as the projectile stats template.
  return mapGetOrThrow(WEAPON_BY_ID, typeId);
}

export function projectileTypeIdForWeaponId(weaponId: WeaponId): ProjectileTemplateId {
  // Return the primary projectile type for a weapon that uses the main pool.

  const typeIds = PROJECTILE_TEMPLATE_OVERRIDES.get(weaponId) ?? null;
  if (typeIds !== null) {
    if (typeIds === null || typeIds.length === 0) {
      throw new Error(`weapon has no primary projectile type: ${int(weaponId)}`);
    }
    return typeIds[0];
  }
  try {
    return weaponId as unknown as ProjectileTemplateId;
  } catch (exc) {
    throw new Error(`weapon has no primary projectile type: ${int(weaponId)}`);
  }
}

export const PROJECTILE_TEMPLATE_OVERRIDES: Map<WeaponId, readonly ProjectileTemplateId[]> = new Map([
  // Derived from native `player_fire_weapon` behavior.
  // Omitted keys use the native default `type_id == weapon_id`.
  // Empty tuples are explicit non-primary projectile paths.
  [WeaponId.SAWED_OFF_SHOTGUN, [ProjectileTemplateId.SHOTGUN]],
  [WeaponId.MEAN_MINIGUN, [ProjectileTemplateId.PISTOL]],
  [WeaponId.FLAMETHROWER, []],
  [WeaponId.MULTI_PLASMA, [ProjectileTemplateId.PLASMA_RIFLE, ProjectileTemplateId.PLASMA_MINIGUN]],
  [WeaponId.ROCKET_LAUNCHER, []],
  [WeaponId.SEEKER_ROCKETS, []],
  [WeaponId.PLASMA_SHOTGUN, [ProjectileTemplateId.PLASMA_MINIGUN]],
  [WeaponId.BLOW_TORCH, []],
  [WeaponId.HR_FLAMER, []],
  [WeaponId.MINI_ROCKET_SWARMERS, []],
  [WeaponId.ROCKET_MINIGUN, []],
  [WeaponId.JACKHAMMER, [ProjectileTemplateId.SHOTGUN]],
  [WeaponId.GAUSS_SHOTGUN, [ProjectileTemplateId.GAUSS_GUN]],
  [WeaponId.ION_SHOTGUN, [ProjectileTemplateId.ION_MINIGUN]],
  [WeaponId.BUBBLEGUN, []],
]);
