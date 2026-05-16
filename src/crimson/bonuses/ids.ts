// Port of crimson/bonuses/ids.py

// Bonus ids extracted from bonus_metadata_init (bonus_meta_label).

export class BonusMeta {
  readonly bonusId: BonusId;
  readonly name: string;
  readonly description: string | null;
  readonly iconId: number | null;
  readonly nativeAmount: number | null;
  readonly applySeconds: number | null;
  readonly notes: string | null;

  constructor(opts: {
    bonusId: BonusId;
    name: string;
    description: string | null;
    iconId: number | null;
    nativeAmount: number | null;
    applySeconds?: number | null;
    notes?: string | null;
  }) {
    this.bonusId = opts.bonusId;
    this.name = opts.name;
    this.description = opts.description;
    this.iconId = opts.iconId;
    this.nativeAmount = opts.nativeAmount;
    this.applySeconds = opts.applySeconds ?? null;
    this.notes = opts.notes ?? null;
  }
}

export enum BonusId {
  UNUSED = 0,
  POINTS = 1,
  ENERGIZER = 2,
  WEAPON = 3,
  WEAPON_POWER_UP = 4,
  NUKE = 5,
  DOUBLE_EXPERIENCE = 6,
  SHOCK_CHAIN = 7,
  FIREBLAST = 8,
  REFLEX_BOOST = 9,
  SHIELD = 10,
  FREEZE = 11,
  MEDIKIT = 12,
  SPEED = 13,
  FIRE_BULLETS = 14,
}

export const BONUS_TABLE = [
  new BonusMeta({
    bonusId: BonusId.UNUSED,
    name: '(unused)',
    description: null,
    iconId: null,
    nativeAmount: null,
    notes: '`DAT_004853dc` is set to `0`, disabling this entry.',
  }),
  new BonusMeta({
    bonusId: BonusId.POINTS,
    name: 'Points',
    description: 'You gain some experience points.',
    iconId: 12,
    nativeAmount: 500,
    notes: '`bonus_apply` adds the stored native amount to score.',
  }),
  new BonusMeta({
    bonusId: BonusId.ENERGIZER,
    name: 'Energizer',
    description: 'Suddenly monsters run away from you and you can eat them.',
    iconId: 10,
    nativeAmount: 8,
    applySeconds: 8.0,
    notes: '`bonus_apply` updates `bonus_energizer_timer` (fixed +8 seconds, scaled by Bonus Economist).',
  }),
  new BonusMeta({
    bonusId: BonusId.WEAPON,
    name: 'Weapon',
    description: 'You get a new weapon.',
    iconId: -1,
    nativeAmount: 3,
    notes: '`bonus_apply` treats the stored native amount as weapon id; often overridden.',
  }),
  new BonusMeta({
    bonusId: BonusId.WEAPON_POWER_UP,
    name: 'Weapon Power Up',
    description: 'Your firerate and load time increase for a short period.',
    iconId: 7,
    nativeAmount: 10,
    notes: '`bonus_apply` updates `bonus_weapon_power_up_timer`.',
  }),
  new BonusMeta({
    bonusId: BonusId.NUKE,
    name: 'Nuke',
    description: 'An amazing explosion of ATOMIC power.',
    iconId: 1,
    nativeAmount: 0,
    notes: '`bonus_apply` performs the large explosion + shake sequence.',
  }),
  new BonusMeta({
    bonusId: BonusId.DOUBLE_EXPERIENCE,
    name: 'Double Experience',
    description: 'Every experience point you get is doubled when this bonus is active.',
    iconId: 4,
    nativeAmount: 0,
    applySeconds: 6.0,
    notes: '`bonus_apply` updates `bonus_double_xp_timer` (fixed +6 seconds, scaled by Bonus Economist).',
  }),
  new BonusMeta({
    bonusId: BonusId.SHOCK_CHAIN,
    name: 'Shock Chain',
    description: 'Chain of shocks shock the crowd.',
    iconId: 3,
    nativeAmount: 0,
    notes: '`bonus_apply` spawns chained lightning via `projectile_spawn` type `0x15`; `shock_chain_links_left` / `shock_chain_projectile_id` track the active chain.',
  }),
  new BonusMeta({
    bonusId: BonusId.FIREBLAST,
    name: 'Fireblast',
    description: 'Fireballs all over the place.',
    iconId: 2,
    nativeAmount: 0,
    notes: '`bonus_apply` spawns a radial projectile burst (type `9`).',
  }),
  new BonusMeta({
    bonusId: BonusId.REFLEX_BOOST,
    name: 'Reflex Boost',
    description: 'You get more time to react as the game slows down.',
    iconId: 5,
    nativeAmount: 3,
    notes: '`bonus_apply` updates `bonus_reflex_boost_timer`.',
  }),
  new BonusMeta({
    bonusId: BonusId.SHIELD,
    name: 'Shield',
    description: 'Force field protects you for a while.',
    iconId: 6,
    nativeAmount: 7,
    notes: '`bonus_apply` updates `player_shield_timer` (`DAT_00490bc8`).',
  }),
  new BonusMeta({
    bonusId: BonusId.FREEZE,
    name: 'Freeze',
    description: 'Monsters are frozen.',
    iconId: 8,
    nativeAmount: 5,
    notes: '`bonus_apply` updates `bonus_freeze_timer`.',
  }),
  new BonusMeta({
    bonusId: BonusId.MEDIKIT,
    name: 'MediKit',
    description: 'You regain some of your health.',
    iconId: 14,
    nativeAmount: 10,
    notes: '`bonus_apply` restores health in 10-point increments.',
  }),
  new BonusMeta({
    bonusId: BonusId.SPEED,
    name: 'Speed',
    description: 'Your movement speed increases for a while.',
    iconId: 9,
    nativeAmount: 8,
    notes: '`bonus_apply` updates `player_speed_bonus_timer` (`DAT_00490bc4`).',
  }),
  new BonusMeta({
    bonusId: BonusId.FIRE_BULLETS,
    name: 'Fire Bullets',
    description: 'For few seconds -- make them count.',
    iconId: 11,
    // Native stored amount is 4; the pickup adds a fixed 5 seconds (scaled by Bonus Economist).
    nativeAmount: 4,
    applySeconds: 5.0,
    notes: '`bonus_apply` updates `player_fire_bullets_timer` (`DAT_00490bcc`) (fixed +5 seconds, scaled by Bonus Economist). While active, `projectile_spawn` overrides player-owned projectiles to type `0x2d` (pellet count from `weapon_projectile_pellet_count[weapon_id]`).',
  }),
];
export const BONUS_BY_ID = new Map(Array.from(BONUS_TABLE, (entry) => [entry.bonusId, entry] as const));
const _BONUS_FIXED_NAMES: Map<BonusId, string> = new Map();
const _BONUS_FIXED_DESCRIPTIONS = new Map([
  [BonusId.WEAPON_POWER_UP, 'Your fire rate and load time increase for a short period.'],
  [BonusId.FIRE_BULLETS, 'For a few seconds -- make them count.'],
]);

export function bonusDisplayName(bonusId: BonusId, opts: { preserveBugs?: boolean } = {}): string {
  const preserveBugs = opts.preserveBugs ?? false;
  const entry = BONUS_BY_ID.get(bonusId) ?? null;
  if (entry === null) {
    return 'unknown';
  }
  if (!preserveBugs) {
    const fixed = _BONUS_FIXED_NAMES.get(bonusId) ?? null;
    if (fixed !== null) {
      return fixed;
    }
  }
  return entry.name;
}

export function bonusDisplayDescription(bonusId: BonusId, opts: { preserveBugs?: boolean } = {}): string | null {
  const preserveBugs = opts.preserveBugs ?? false;
  const entry = BONUS_BY_ID.get(bonusId) ?? null;
  if (entry === null) {
    return null;
  }
  if (!preserveBugs) {
    const fixed = _BONUS_FIXED_DESCRIPTIONS.get(bonusId) ?? null;
    if (fixed !== null) {
      return fixed;
    }
  }
  return entry.description;
}

export function bonusLabel(bonusId: BonusId, opts: { preserveBugs?: boolean } = {}): string {
  const preserveBugs = opts.preserveBugs ?? false;
  const entry = BONUS_BY_ID.get(bonusId) ?? null;
  if (entry === null) {
    return 'unknown';
  }
  return bonusDisplayName(entry.bonusId, { preserveBugs: preserveBugs });
}
