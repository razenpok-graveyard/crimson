// Port of crimson/dbg/canonical_channels.py

import { ftolMsI32 } from '@crimson/sim/timing.ts';

export function bonusTimerMs(value: number): number {
  return Math.max(0, int(ftolMsI32(value)));
}

export class SnapshotVec2 {
  readonly x: number;
  readonly y: number;

  constructor(opts: {
    x: number;
    y: number;
  }) {
    this.x = opts.x;
    this.y = opts.y;
  }
}

export class SnapshotWeapon {
  readonly weaponId: number;
  readonly ammo: number;
  readonly clipSize: number;
  readonly reloadActive: boolean;
  readonly reloadTimer: number;
  readonly reloadTimerMax: number;
  readonly shotCooldown: number;

  constructor(opts: {
    weaponId: number;
    ammo: number;
    clipSize: number;
    reloadActive: boolean;
    reloadTimer: number;
    reloadTimerMax: number;
    shotCooldown: number;
  }) {
    this.weaponId = opts.weaponId;
    this.ammo = opts.ammo;
    this.clipSize = opts.clipSize;
    this.reloadActive = opts.reloadActive;
    this.reloadTimer = opts.reloadTimer;
    this.reloadTimerMax = opts.reloadTimerMax;
    this.shotCooldown = opts.shotCooldown;
  }
}

export class SnapshotPlayer {
  readonly index: number;
  readonly pos: SnapshotVec2;
  readonly health: number;
  readonly weapon: SnapshotWeapon;
  readonly experience: number;
  readonly level: number;

  constructor(opts: {
    index: number;
    pos: SnapshotVec2;
    health: number;
    weapon: SnapshotWeapon;
    experience: number;
    level: number;
  }) {
    this.index = opts.index;
    this.pos = opts.pos;
    this.health = opts.health;
    this.weapon = opts.weapon;
    this.experience = opts.experience;
    this.level = opts.level;
  }
}

export class SnapshotBonusTimers {
  readonly weaponPowerUpMs: number;
  readonly reflexBoostMs: number;
  readonly energizerMs: number;
  readonly doubleExperienceMs: number;
  readonly freezeMs: number;

  constructor(opts: {
    weaponPowerUpMs: number;
    reflexBoostMs: number;
    energizerMs: number;
    doubleExperienceMs: number;
    freezeMs: number;
  }) {
    this.weaponPowerUpMs = opts.weaponPowerUpMs;
    this.reflexBoostMs = opts.reflexBoostMs;
    this.energizerMs = opts.energizerMs;
    this.doubleExperienceMs = opts.doubleExperienceMs;
    this.freezeMs = opts.freezeMs;
  }
}

export class SnapshotGameplay {
  readonly modeId: number;
  readonly questStageMajor: number;
  readonly questStageMinor: number;
  readonly perkPendingCount: number;
  readonly perkChoicesDirty: boolean;
  readonly bonusTimers: SnapshotBonusTimers;

  constructor(opts: {
    modeId: number;
    questStageMajor: number;
    questStageMinor: number;
    perkPendingCount: number;
    perkChoicesDirty: boolean;
    bonusTimers: SnapshotBonusTimers;
  }) {
    this.modeId = opts.modeId;
    this.questStageMajor = opts.questStageMajor;
    this.questStageMinor = opts.questStageMinor;
    this.perkPendingCount = opts.perkPendingCount;
    this.perkChoicesDirty = opts.perkChoicesDirty;
    this.bonusTimers = opts.bonusTimers;
  }
}

export class SimStateSnapshot {
  readonly gameplay: SnapshotGameplay;
  readonly players: SnapshotPlayer[];

  constructor(opts: {
    gameplay: SnapshotGameplay;
    players: SnapshotPlayer[];
  }) {
    this.gameplay = opts.gameplay;
    this.players = opts.players;
  }
}

export class RngStreamRow {
  readonly tickCallIndex: number;
  readonly value15: number;
  readonly stateBeforeU32: number;
  readonly stateAfterU32: number;
  readonly caller: number | null;

  constructor(opts: {
    tickCallIndex: number;
    value15: number;
    stateBeforeU32: number;
    stateAfterU32: number;
    caller?: number | null;
  }) {
    this.tickCallIndex = opts.tickCallIndex;
    this.value15 = opts.value15;
    this.stateBeforeU32 = opts.stateBeforeU32;
    this.stateAfterU32 = opts.stateAfterU32;
    this.caller = opts.caller ?? null;
  }
}

export class TimingSampleRow {
  readonly tickIndex: number;
  readonly gameplayFrame: number | null;
  readonly phase: string;
  readonly writeKind: string;
  readonly frameDtF32: number | null;
  readonly frameDtMsI32: number | null;
  readonly frameDtMsF32: number | null;
  readonly timeScaleActiveEntry: boolean | null;
  readonly timeScaleActiveCurrent: boolean | null;
  readonly timeScaleFactor: number | null;
  readonly bonusReflexBoostTimer: number | null;
  readonly modeFn: string | null;
  readonly playerIndex: number | null;

  constructor(opts: {
    tickIndex: number;
    gameplayFrame?: number | null;
    phase?: string;
    writeKind?: string;
    frameDtF32?: number | null;
    frameDtMsI32?: number | null;
    frameDtMsF32?: number | null;
    timeScaleActiveEntry?: boolean | null;
    timeScaleActiveCurrent?: boolean | null;
    timeScaleFactor?: number | null;
    bonusReflexBoostTimer?: number | null;
    modeFn?: string | null;
    playerIndex?: number | null;
  }) {
    this.tickIndex = opts.tickIndex;
    this.gameplayFrame = opts.gameplayFrame ?? null;
    this.phase = opts.phase ?? '';
    this.writeKind = opts.writeKind ?? 'snapshot';
    this.frameDtF32 = opts.frameDtF32 ?? null;
    this.frameDtMsI32 = opts.frameDtMsI32 ?? null;
    this.frameDtMsF32 = opts.frameDtMsF32 ?? null;
    this.timeScaleActiveEntry = opts.timeScaleActiveEntry ?? null;
    this.timeScaleActiveCurrent = opts.timeScaleActiveCurrent ?? null;
    this.timeScaleFactor = opts.timeScaleFactor ?? null;
    this.bonusReflexBoostTimer = opts.bonusReflexBoostTimer ?? null;
    this.modeFn = opts.modeFn ?? null;
    this.playerIndex = opts.playerIndex ?? null;
  }
}

export class CreatureEntitySample {
  readonly uid: number;
  readonly generation: number;
  readonly poolKind: string;
  readonly index: number;
  readonly active: boolean;
  readonly typeId: number;
  readonly hp: number;
  readonly pos: SnapshotVec2;
  readonly flags: number;
  readonly aiMode: number;
  readonly linkIndex: number;
  readonly heading: number;
  readonly targetHeading: number;
  readonly orbitAngle: number;
  readonly orbitRadius: number;
  readonly lifecycleStage: number;

  constructor(opts: {
    uid: number;
    generation: number;
    poolKind: string;
    index: number;
    active: boolean;
    typeId: number;
    hp: number;
    pos: SnapshotVec2;
    flags: number;
    aiMode: number;
    linkIndex: number;
    heading: number;
    targetHeading: number;
    orbitAngle: number;
    orbitRadius: number;
    lifecycleStage: number;
  }) {
    this.uid = opts.uid;
    this.generation = opts.generation;
    this.poolKind = opts.poolKind;
    this.index = opts.index;
    this.active = opts.active;
    this.typeId = opts.typeId;
    this.hp = opts.hp;
    this.pos = opts.pos;
    this.flags = opts.flags;
    this.aiMode = opts.aiMode;
    this.linkIndex = opts.linkIndex;
    this.heading = opts.heading;
    this.targetHeading = opts.targetHeading;
    this.orbitAngle = opts.orbitAngle;
    this.orbitRadius = opts.orbitRadius;
    this.lifecycleStage = opts.lifecycleStage;
  }
}

export class ProjectileEntitySample {
  readonly uid: number;
  readonly generation: number;
  readonly poolKind: string;
  readonly index: number;
  readonly active: boolean;
  readonly typeId: number;
  readonly angle: number;
  readonly pos: SnapshotVec2;
  readonly vel: SnapshotVec2;
  readonly lifeTimer: number;
  readonly speedScale: number;
  readonly damagePool: number;
  readonly hitRadius: number;
  readonly travelBudget: number;
  readonly ownerId: number;

  constructor(opts: {
    uid: number;
    generation: number;
    poolKind: string;
    index: number;
    active: boolean;
    typeId: number;
    angle: number;
    pos: SnapshotVec2;
    vel: SnapshotVec2;
    lifeTimer: number;
    speedScale: number;
    damagePool: number;
    hitRadius: number;
    travelBudget: number;
    ownerId: number;
  }) {
    this.uid = opts.uid;
    this.generation = opts.generation;
    this.poolKind = opts.poolKind;
    this.index = opts.index;
    this.active = opts.active;
    this.typeId = opts.typeId;
    this.angle = opts.angle;
    this.pos = opts.pos;
    this.vel = opts.vel;
    this.lifeTimer = opts.lifeTimer;
    this.speedScale = opts.speedScale;
    this.damagePool = opts.damagePool;
    this.hitRadius = opts.hitRadius;
    this.travelBudget = opts.travelBudget;
    this.ownerId = opts.ownerId;
  }
}

export class SecondaryProjectileEntitySample {
  readonly uid: number;
  readonly generation: number;
  readonly poolKind: string;
  readonly index: number;
  readonly active: boolean;
  readonly typeId: number;
  readonly angle: number;
  readonly pos: SnapshotVec2;
  readonly vel: SnapshotVec2;
  readonly speed: number;
  readonly trailTimer: number;
  readonly ownerId: number;
  readonly targetId: number;

  constructor(opts: {
    uid: number;
    generation: number;
    poolKind: string;
    index: number;
    active: boolean;
    typeId: number;
    angle: number;
    pos: SnapshotVec2;
    vel: SnapshotVec2;
    speed: number;
    trailTimer: number;
    ownerId: number;
    targetId: number;
  }) {
    this.uid = opts.uid;
    this.generation = opts.generation;
    this.poolKind = opts.poolKind;
    this.index = opts.index;
    this.active = opts.active;
    this.typeId = opts.typeId;
    this.angle = opts.angle;
    this.pos = opts.pos;
    this.vel = opts.vel;
    this.speed = opts.speed;
    this.trailTimer = opts.trailTimer;
    this.ownerId = opts.ownerId;
    this.targetId = opts.targetId;
  }
}

export class BonusEntitySample {
  readonly uid: number;
  readonly generation: number;
  readonly poolKind: string;
  readonly index: number;
  readonly active: boolean;
  readonly bonusId: number;
  readonly picked: boolean;
  readonly timeLeft: number;
  readonly timeMax: number;
  readonly pos: SnapshotVec2;
  readonly amount: number;

  constructor(opts: {
    uid: number;
    generation: number;
    poolKind: string;
    index: number;
    active: boolean;
    bonusId: number;
    picked: boolean;
    timeLeft: number;
    timeMax: number;
    pos: SnapshotVec2;
    amount: number;
  }) {
    this.uid = opts.uid;
    this.generation = opts.generation;
    this.poolKind = opts.poolKind;
    this.index = opts.index;
    this.active = opts.active;
    this.bonusId = opts.bonusId;
    this.picked = opts.picked;
    this.timeLeft = opts.timeLeft;
    this.timeMax = opts.timeMax;
    this.pos = opts.pos;
    this.amount = opts.amount;
  }
}

export class EntitySamplesSnapshot {
  readonly creatures: CreatureEntitySample[];
  readonly projectiles: ProjectileEntitySample[];
  readonly secondaryProjectiles: SecondaryProjectileEntitySample[];
  readonly bonuses: BonusEntitySample[];

  constructor(opts: {
    creatures: CreatureEntitySample[];
    projectiles: ProjectileEntitySample[];
    secondaryProjectiles: SecondaryProjectileEntitySample[];
    bonuses: BonusEntitySample[];
  }) {
    this.creatures = opts.creatures;
    this.projectiles = opts.projectiles;
    this.secondaryProjectiles = opts.secondaryProjectiles;
    this.bonuses = opts.bonuses;
  }
}
