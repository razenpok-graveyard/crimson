// Port of crimson/sim/state_types.py

import { Vec2 } from '@grim/geom.ts';
import type { BonusId } from '@crimson/bonuses/ids.ts';
import { WeaponId } from '@crimson/weapons.ts';
import type { GameplayState as GameplayStateType } from '@crimson/gameplay.ts';

export type GameplayState = GameplayStateType;

export const PERK_COUNT_SIZE = 0x80;

export class WeaponSlot {
  weaponId: WeaponId;
  clipSize: number;
  ammo: number;
  reloadActive: boolean;
  reloadTimer: number;
  reloadTimerMax: number;
  shotCooldown: number;

  constructor(opts: {
    weaponId: WeaponId;
    clipSize?: number;
    ammo?: number;
    reloadActive?: boolean;
    reloadTimer?: number;
    reloadTimerMax?: number;
    shotCooldown?: number;
  }) {
    this.weaponId = opts.weaponId;
    this.clipSize = opts.clipSize ?? 0;
    this.ammo = opts.ammo ?? 0.0;
    this.reloadActive = opts.reloadActive ?? false;
    this.reloadTimer = opts.reloadTimer ?? 0.0;
    this.reloadTimerMax = opts.reloadTimerMax ?? 0.0;
    this.shotCooldown = opts.shotCooldown ?? 0.0;
  }
}

export class PlayerState {
  index: number;
  pos: Vec2;
  health: number;
  size: number;
  speedMultiplier: number;
  moveSpeed: number;
  movePhase: number;
  heading: number;
  turnSpeed: number;
  deathTimer: number;
  lowHealthTimer: number;
  aim: Vec2;
  aimHeading: number;
  aimDir: Vec2;
  evilEyesTargetCreature: number;
  autoTarget: number;
  bonusAimHoverIndex: number;
  bonusAimHoverTimerMs: number;
  weapon: WeaponSlot;
  altWeapon: WeaponSlot | null;
  shotSeq: number;
  weaponResetLatch: number;
  auxTimer: number;
  spreadHeat: number;
  muzzleFlashAlpha: number;
  experience: number;
  level: number;
  perkCounts: number[];
  plaguebearerActive: boolean;
  hotTemperedTimer: number;
  manBombTimer: number;
  livingFortressTimer: number;
  fireCoughTimer: number;
  speedBonusTimer: number;
  shieldTimer: number;
  fireBulletsTimer: number;

  constructor(opts: {
    index: number;
    pos: Vec2;
    health?: number;
    size?: number;
    speedMultiplier?: number;
    moveSpeed?: number;
    movePhase?: number;
    heading?: number;
    turnSpeed?: number;
    deathTimer?: number;
    lowHealthTimer?: number;
    aim?: Vec2;
    aimHeading?: number;
    aimDir?: Vec2;
    evilEyesTargetCreature?: number;
    autoTarget?: number;
    bonusAimHoverIndex?: number;
    bonusAimHoverTimerMs?: number;
    weapon?: WeaponSlot;
    altWeapon?: WeaponSlot | null;
    shotSeq?: number;
    weaponResetLatch?: number;
    auxTimer?: number;
    spreadHeat?: number;
    muzzleFlashAlpha?: number;
    experience?: number;
    level?: number;
    perkCounts?: number[];
    plaguebearerActive?: boolean;
    hotTemperedTimer?: number;
    manBombTimer?: number;
    livingFortressTimer?: number;
    fireCoughTimer?: number;
    speedBonusTimer?: number;
    shieldTimer?: number;
    fireBulletsTimer?: number;
  }) {
    this.index = opts.index;
    this.pos = opts.pos;
    this.health = opts.health ?? 100.0;
    this.size = opts.size ?? 48.0;
    this.speedMultiplier = opts.speedMultiplier ?? 2.0;
    this.moveSpeed = opts.moveSpeed ?? 0.0;
    this.movePhase = opts.movePhase ?? 0.0;
    this.heading = opts.heading ?? 0.0;
    this.turnSpeed = opts.turnSpeed ?? 1.0;
    this.deathTimer = opts.deathTimer ?? 16.0;
    this.lowHealthTimer = opts.lowHealthTimer ?? 100.0;
    this.aim = opts.aim ?? new Vec2();
    this.aimHeading = opts.aimHeading ?? 0.0;
    this.aimDir = opts.aimDir ?? new Vec2(1.0, 0.0);
    this.evilEyesTargetCreature = opts.evilEyesTargetCreature ?? -1;
    this.autoTarget = opts.autoTarget ?? -1;
    this.bonusAimHoverIndex = opts.bonusAimHoverIndex ?? -1;
    this.bonusAimHoverTimerMs = opts.bonusAimHoverTimerMs ?? 0.0;
    this.weapon = opts.weapon ?? new WeaponSlot({ weaponId: WeaponId.PISTOL });
    this.altWeapon = opts.altWeapon ?? null;
    this.shotSeq = opts.shotSeq ?? 0;
    this.weaponResetLatch = opts.weaponResetLatch ?? 0;
    this.auxTimer = opts.auxTimer ?? 0.0;
    this.spreadHeat = opts.spreadHeat ?? 0.01;
    this.muzzleFlashAlpha = opts.muzzleFlashAlpha ?? 0.0;
    this.experience = opts.experience ?? 0;
    this.level = opts.level ?? 1;
    this.perkCounts = opts.perkCounts ?? Array.from({ length: PERK_COUNT_SIZE }, () => 0);
    this.plaguebearerActive = opts.plaguebearerActive ?? false;
    this.hotTemperedTimer = opts.hotTemperedTimer ?? 0.0;
    this.manBombTimer = opts.manBombTimer ?? 0.0;
    this.livingFortressTimer = opts.livingFortressTimer ?? 0.0;
    this.fireCoughTimer = opts.fireCoughTimer ?? 0.0;
    this.speedBonusTimer = opts.speedBonusTimer ?? 0.0;
    this.shieldTimer = opts.shieldTimer ?? 0.0;
    this.fireBulletsTimer = opts.fireBulletsTimer ?? 0.0;
  }
}

export class BonusPickupEvent {
  readonly playerIndex: number;
  readonly bonusId: BonusId;
  readonly amount: number;
  readonly pos: Vec2;

  constructor(opts: {
    playerIndex: number;
    bonusId: BonusId;
    amount: number;
    pos: Vec2;
  }) {
    this.playerIndex = opts.playerIndex;
    this.bonusId = opts.bonusId;
    this.amount = opts.amount;
    this.pos = opts.pos;
  }
}
