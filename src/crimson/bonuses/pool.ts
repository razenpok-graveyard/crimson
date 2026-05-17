// Port of crimson/bonuses/pool.py

import { Vec2 } from '@grim/geom.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { perkActive } from '@crimson/perks/helpers.ts';
import type { CreatureDamageApplier } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { GameplayState, PlayerState } from '@crimson/sim/state-types.ts';
import { BonusPickupEvent } from '@crimson/sim/state-types.ts';
import { weaponPickRandomAvailable } from '@crimson/weapon-runtime/availability.ts';
import { WEAPON_BY_ID, WeaponId, weaponDisplayName } from '@crimson/weapons.ts';
import { bonusApply } from '@crimson/bonuses/apply.ts';
import { BONUS_BY_ID, BonusId, bonusDisplayName } from '@crimson/bonuses/ids.ts';
import { bonusPickRandomType } from '@crimson/bonuses/selection.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';
import { PerkId } from '@crimson/perks/index.ts';

export const BONUS_POOL_SIZE = 16;
export const BONUS_SPAWN_MARGIN = 32.0;
export const BONUS_SPAWN_MIN_DISTANCE = 32.0;
export const BONUS_PICKUP_RADIUS = 26.0;
export const BONUS_PICKUP_DECAY_RATE = 3.0;
export const BONUS_PICKUP_LINGER = 0.5;
export const BONUS_TIME_MAX = 10.0;
export const BONUS_WEAPON_NEAR_RADIUS = 56.0;
export const BONUS_AIM_HOVER_RADIUS = 24.0;
export const BONUS_TELEKINETIC_PICKUP_MS = 650.0;

export class BonusEntry {
  bonusId: BonusId;
  picked: boolean;
  timeLeft: number;
  timeMax: number;
  pos: Vec2;
  amount: number;

  constructor(opts: {
    bonusId?: BonusId;
    picked?: boolean;
    timeLeft?: number;
    timeMax?: number;
    pos?: Vec2;
    amount?: number;
  } = {}) {
    this.bonusId = opts.bonusId ?? BonusId.UNUSED;
    this.picked = opts.picked ?? false;
    this.timeLeft = opts.timeLeft ?? 0.0;
    this.timeMax = opts.timeMax ?? 0.0;
    this.pos = opts.pos ?? new Vec2();
    this.amount = opts.amount ?? 0;
  }
}

export class BonusPool {
  protected _entries: BonusEntry[];
  protected _sentinel: BonusEntry;
  protected _creatureDamageApplier: CreatureDamageApplier | null;

  get sentinel(): BonusEntry {
    return this._sentinel;
  }

  constructor(opts: { size?: number } = {}) {
    const size = opts.size ?? BONUS_POOL_SIZE;
    this._entries = Array.from({ length: Math.max(0, int(size)) }, (_, i) => i).map((_) => new BonusEntry());
    // Native bonus code uses a writable sentinel entry when allocation/spacing
    // checks fail. Some callers still mutate it, which affects RNG consumption.
    this._sentinel = new BonusEntry();
    this._creatureDamageApplier = null;
  }

  get entries(): BonusEntry[] {
    return this._entries;
  }

  get creatureDamageApplier(): CreatureDamageApplier | null {
    return this._creatureDamageApplier;
  }

  set creatureDamageApplier(value: CreatureDamageApplier | null) {
    this._creatureDamageApplier = value;
  }

  reset(): void {
    for (const entry of this._entries) {
      entry.bonusId = BonusId.UNUSED;
      entry.picked = false;
      entry.timeLeft = 0.0;
      entry.timeMax = 0.0;
      entry.amount = 0;
    }
  }

  iterActive(): BonusEntry[] {
    return this._entries.filter((entry) => entry.bonusId !== BonusId.UNUSED);
  }

  protected _allocSlot(): BonusEntry | null {
    for (const entry of this._entries) {
      if (bonusEntryIsEmpty(entry)) {
        return entry;
      }
    }
    return null;
  }

  protected _allocSlotOrSentinel(): BonusEntry {
    const entry = this._allocSlot();
    if (entry !== null) {
      return entry;
    }
    return this._sentinel;
  }

  protected _isSentinelEntry(entry: BonusEntry): boolean {
    return entry === this._sentinel;
  }

  protected _clearEntry(entry: BonusEntry): void {
    entry.bonusId = BonusId.UNUSED;
    entry.picked = false;
    entry.timeLeft = 0.0;
    entry.timeMax = 0.0;
    entry.amount = 0;
  }

  spawnAt(pos: Vec2, bonusId: BonusId, durationOverride: number = -1, opts: { state: GameplayState; worldWidth?: number; worldHeight?: number }): BonusEntry | null {
    const state = opts.state;
    const worldWidth = opts.worldWidth ?? 1024.0;
    const worldHeight = opts.worldHeight ?? 1024.0;
    if (state.gameMode === GameMode.RUSH) {
      return null;
    }
    if (bonusId === BonusId.UNUSED) {
      return null;
    }
    const entry = this._allocSlot();
    if (entry === null) {
      return null;
    }

    entry.bonusId = bonusId;
    entry.picked = false;
    entry.pos = pos.clampRect(BONUS_SPAWN_MARGIN, BONUS_SPAWN_MARGIN, worldWidth - BONUS_SPAWN_MARGIN, worldHeight - BONUS_SPAWN_MARGIN);
    entry.timeLeft = BONUS_TIME_MAX;
    entry.timeMax = BONUS_TIME_MAX;

    let amount = durationOverride;
    if (amount === -1) {
      const meta = BONUS_BY_ID.get(bonusId) ?? null;
      amount = meta !== null ? int(meta.nativeAmount || 0) : 0;
    }
    entry.amount = int(amount);
    return entry;
  }

  spawnAtPos(pos: Vec2, opts: { state: GameplayState; players: PlayerState[]; worldWidth?: number; worldHeight?: number }): BonusEntry {
    const state = opts.state;
    const players = opts.players;
    const worldWidth = opts.worldWidth ?? 1024.0;
    const worldHeight = opts.worldHeight ?? 1024.0;
    if (state.gameMode === GameMode.RUSH) {
      return this._sentinel;
    }
    if (pos.x < BONUS_SPAWN_MARGIN || pos.y < BONUS_SPAWN_MARGIN || pos.x > worldWidth - BONUS_SPAWN_MARGIN || pos.y > worldHeight - BONUS_SPAWN_MARGIN) {
      return this._sentinel;
    }

    let entry = this._allocSlotOrSentinel();

    const bonusId = bonusPickRandomType(this, state, players);
    const minDistSq = BONUS_SPAWN_MIN_DISTANCE * BONUS_SPAWN_MIN_DISTANCE;
    for (const activeEntry of this._entries) {
      if (activeEntry.bonusId === BonusId.UNUSED) {
        continue;
      }
      if (Vec2.distanceSq(pos, activeEntry.pos) < minDistSq) {
        entry = this._sentinel;
        break;
      }
    }

    entry.bonusId = bonusId;
    entry.picked = false;
    entry.pos = pos;
    entry.timeLeft = BONUS_TIME_MAX;
    entry.timeMax = BONUS_TIME_MAX;

    const rng = state.rng;
    if (entry.bonusId === BonusId.WEAPON) {
      entry.amount = int(weaponPickRandomAvailable(state));
    } else if (entry.bonusId === BonusId.POINTS) {
      entry.amount = (rng.rand({ caller: RngCallerStatic.BONUS_SPAWN_AT_POS_POINTS_AMOUNT }) & 7) < 3 ? 1000 : 500;
    } else {
      const meta = BONUS_BY_ID.get(entry.bonusId) ?? null;
      entry.amount = meta !== null ? int(meta.nativeAmount || 0) : 0;
    }
    return entry;
  }

  trySpawnOnKill(pos: Vec2, opts: { state: GameplayState; players: PlayerState[]; detailPreset?: number; worldWidth?: number; worldHeight?: number }): BonusEntry | null {
    const state = opts.state;
    const players = opts.players;
    const detailPreset = opts.detailPreset ?? 5;
    const worldWidth = opts.worldWidth ?? 1024.0;
    const worldHeight = opts.worldHeight ?? 1024.0;

    const gameMode = state.gameMode;
    if (gameMode === GameMode.TYPO) {
      return null;
    }
    if (state.demoModeActive) {
      return null;
    }
    if (gameMode === GameMode.RUSH) {
      return null;
    }
    if (gameMode === GameMode.TUTORIAL) {
      return null;
    }
    if (state.bonusSpawnGuard) {
      return null;
    }

    const rng = state.rng;
    // Native special-case: while any player has Pistol, 3/4 chance to force a Weapon drop.
    let entry: any;
    let weaponId: ReturnType<typeof weaponPickRandomAvailable>;
    let matches: any;
    if (players.length > 0 && players.some((player) => player.weapon.weaponId === WeaponId.PISTOL)) {
      if ((rng.rand({ caller: RngCallerStatic.BONUS_TRY_SPAWN_ON_KILL_PISTOL_FORCE_WEAPON }) & 3) < 3) {
        entry = this.spawnAtPos(pos, { state: state, players: players, worldWidth: worldWidth, worldHeight: worldHeight });

        entry.bonusId = BonusId.WEAPON;
        weaponId = weaponPickRandomAvailable(state);
        entry.amount = int(weaponId);
        if (weaponId === WeaponId.PISTOL) {
          weaponId = weaponPickRandomAvailable(state);
          entry.amount = int(weaponId);
        }

        matches = this._entries.filter((bonus) => bonus.bonusId === entry.bonusId).reduce((total, bonus) => total + 1, 0);
        if (matches > 1) {
          this._clearEntry(entry);
          return null;
        }

        if (entry.amount === WeaponId.PISTOL || (players && perkActive(players[0], PerkId.MY_FAVOURITE_WEAPON))) {
          this._clearEntry(entry);
          return null;
        }

        if (this._isSentinelEntry(entry)) {
          return null;
        }
        this._spawnOnKillBurst({ entry: entry, state: state, detailPreset: detailPreset });
        return entry;
      }
    }

    const baseRoll = rng.rand({ caller: RngCallerStatic.BONUS_TRY_SPAWN_ON_KILL_BASE_GATE });
    let allowWithoutMagnet: boolean;
    if (baseRoll % 9 !== 1) {
      allowWithoutMagnet = false;
      let hasPistol: boolean;
      if (players.length > 0) {
        hasPistol = false;
        if (Boolean(state.preserveBugs)) {
          hasPistol = players[0].weapon.weaponId === WeaponId.PISTOL;
        } else {
          hasPistol = players.some((player) => player.weapon.weaponId === WeaponId.PISTOL);
        }
        if (hasPistol) {
          allowWithoutMagnet = (rng.rand({ caller: RngCallerStatic.BONUS_TRY_SPAWN_ON_KILL_PISTOL_ALLOW_WITHOUT_MAGNET }) % 5 === 1);
        }
      }

      let hasBonusMagnet: boolean;
      if (!allowWithoutMagnet) {
        hasBonusMagnet = false;
        if (players.length > 0) {
          if (Boolean(state.preserveBugs)) {
            hasBonusMagnet = perkActive(players[0], PerkId.BONUS_MAGNET);
          } else {
            hasBonusMagnet = players.some((player) => perkActive(player, PerkId.BONUS_MAGNET));
          }
        }
        if (!hasBonusMagnet) {
          return null;
        }
        if (rng.rand({ caller: RngCallerStatic.BONUS_TRY_SPAWN_ON_KILL_BONUS_MAGNET }) % 10 !== 2) {
          return null;
        }
      }
    }

    entry = this.spawnAtPos(pos, { state: state, players: players, worldWidth: worldWidth, worldHeight: worldHeight });

    let nearPlayer: boolean;
    if (entry.bonusId === BonusId.WEAPON) {
      const nearSq = BONUS_WEAPON_NEAR_RADIUS * BONUS_WEAPON_NEAR_RADIUS;
      nearPlayer = false;
      if (players.length > 0) {
        if (Boolean(state.preserveBugs)) {
          // Native checks player 1 position only.
          nearPlayer = Vec2.distanceSq(pos, players[0].pos) < nearSq;
        } else {
          nearPlayer = players.some((player) => Vec2.distanceSq(pos, player.pos) < nearSq);
        }
      }
      if (nearPlayer) {
        entry.bonusId = BonusId.POINTS;
        entry.amount = 100;
      }
    }

    if (entry.bonusId !== BonusId.POINTS) {
      matches = this._entries.filter((bonus) => bonus.bonusId === entry.bonusId).reduce((total, bonus) => total + 1, 0);
      if (matches > 1) {
        this._clearEntry(entry);
        return null;
      }
    }

    if (players.length > 0) {
      if (Boolean(state.preserveBugs)) {
        weaponId = players[0].weapon.weaponId;
        const suppressionWeaponId = weaponIdFromNativeAmount(entry.amount);
        if (suppressionWeaponId === weaponId) {
          this._clearEntry(entry);
          return null;
        }
      } else {
        const carriedWeaponIds = allCarriedWeaponIds(players);
        const bonusWeaponId = weaponIdFromWeaponEntry(entry);
        if (entry.bonusId === BonusId.WEAPON && (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(carriedWeaponIds, bonusWeaponId))) {
          this._clearEntry(entry);
          return null;
        }
      }
    }

    if (this._isSentinelEntry(entry)) {
      return null;
    }
    this._spawnOnKillBurst({ entry: entry, state: state, detailPreset: detailPreset });
    return entry;
  }

  protected _spawnOnKillBurst(opts: { entry: BonusEntry; state: GameplayState; detailPreset: number }): void {
    const entry = opts.entry;
    const state = opts.state;
    const detailPreset = opts.detailPreset;
    const rng = state.rng;
    for (let i = 0; i < 16; i++) {
      state.effects.spawnBurstParticle({
        pos: entry.pos,
        rotationDraw: rng.rand({ caller: RngCallerStatic.BONUS_TRY_SPAWN_ON_KILL_BURST_ROTATION }),
        velXDraw: rng.rand({ caller: RngCallerStatic.BONUS_TRY_SPAWN_ON_KILL_BURST_VEL_X }),
        velYDraw: rng.rand({ caller: RngCallerStatic.BONUS_TRY_SPAWN_ON_KILL_BURST_VEL_Y }),
        scaleStepDraw: rng.rand({ caller: RngCallerStatic.BONUS_TRY_SPAWN_ON_KILL_BURST_SCALE_STEP }),
        detailPreset: detailPreset,
      });
    }
  }

  update(dt: number, opts: { state: GameplayState; players: PlayerState[]; creatures: readonly CreatureState[]; detailPreset?: number; deferFreezeCorpseFx?: boolean; freezeCorpseIndices?: Set<number> | null }): BonusPickupEvent[] {
    const state = opts.state;
    const players = opts.players;
    const creatures = opts.creatures;
    const detailPreset = opts.detailPreset ?? 5;
    const deferFreezeCorpseFx = opts.deferFreezeCorpseFx ?? false;
    const freezeCorpseIndices = opts.freezeCorpseIndices ?? null;
    if (dt <= 0.0) {
      return [];
    }

    const pickups: BonusPickupEvent[] = [];
    for (const entry of this._entries) {
      if (bonusEntryIsEmpty(entry)) {
        continue;
      }

      const decay = dt * (entry.picked ? BONUS_PICKUP_DECAY_RATE : 1.0);
      entry.timeLeft -= decay;
      if (!entry.picked && state.gameMode === GameMode.TUTORIAL) {
        entry.timeLeft = 5.0;
      }
      let expiredToUnused = false;
      if (entry.timeLeft < 0.0) {
        if (entry.picked) {
          this._clearEntry(entry);
          continue;
        }
        // Native `bonus_update` sets bonus_id to NONE before pickup checks
        // and still allows one final in-range pickup in that tick.
        entry.bonusId = BonusId.UNUSED;
        expiredToUnused = true;
      }

      if (entry.picked) {
        continue;
      }

      let pickedNow = false;
      for (const player of players) {
        if (Vec2.distanceSq(entry.pos, player.pos) < BONUS_PICKUP_RADIUS * BONUS_PICKUP_RADIUS) {
          bonusApply(
            state,
            player,
            entry.bonusId,
            { amount: entry.amount, origin: entry.pos, creatures: creatures, players: players, detailPreset: int(detailPreset), deferFreezeCorpseFx: deferFreezeCorpseFx, freezeCorpseIndices: freezeCorpseIndices },
          );
          entry.picked = true;
          entry.timeLeft = BONUS_PICKUP_LINGER;
          pickups.push(new BonusPickupEvent({ playerIndex: player.index, bonusId: entry.bonusId, amount: entry.amount, pos: entry.pos }));
          pickedNow = true;
          break;
        }
      }

      if (expiredToUnused && !pickedNow) {
        this._clearEntry(entry);
      }
    }

    return pickups;
  }
}

function bonusEntryIsEmpty(entry: BonusEntry): boolean {
  return entry.bonusId === BonusId.UNUSED && !entry.picked && entry.timeLeft <= 0.0 && entry.timeMax <= 0.0 && int(entry.amount) === 0;
}

function weaponIdFromNativeAmount(amount: number): WeaponId | null {
  // Keep native amount-domain behavior: any raw bonus amount that happens to
  // match a weapon id can trip suppression checks under `--preserve-bugs`.
  const weaponId = int(amount);
  if (!WEAPON_BY_ID.has(weaponId)) {
    return null;
  }
  return weaponId;
}

function weaponIdFromWeaponEntry(entry: BonusEntry): WeaponId | null {
  if (entry.bonusId !== BonusId.WEAPON) {
    return null;
  }
  return weaponIdFromNativeAmount(entry.amount);
}

function allCarriedWeaponIds(players: readonly PlayerState[]): Set<WeaponId> {
  const carried: Set<WeaponId> = new Set();
  for (const player of players) {
    const weaponId = player.weapon.weaponId;
    if (weaponId > WeaponId.NONE) {
      carried.add(weaponId);
    }
    if (player.altWeapon === null) {
      continue;
    }
    const alt = player.altWeapon.weaponId;
    if (alt > WeaponId.NONE) {
      carried.add(alt);
    }
  }
  return carried;
}

export function bonusFindAimHoverEntry(player: PlayerState, bonusPool: BonusPool): [number, BonusEntry] | null {
  // Return the first bonus entry within the aim hover radius, matching the exe scan order.

  const aimPos = player.aim;
  const radiusSq = BONUS_AIM_HOVER_RADIUS * BONUS_AIM_HOVER_RADIUS;
  for (const [idx, entry] of bonusPool.entries.entries()) {
    if (entry.bonusId === BonusId.UNUSED) {
      continue;
    }
    if (Vec2.distanceSq(aimPos, entry.pos) < radiusSq) {
      return [idx, entry];
    }
  }
  return null;
}

export function bonusLabelForEntry(entry: BonusEntry, opts: { preserveBugs?: boolean } = {}): string {
  // Return the classic label text for a bonus entry (`bonus_label_for_entry`).

  const preserveBugs = opts.preserveBugs ?? false;
  const bonusId = entry.bonusId;
  if (bonusId === BonusId.WEAPON) {
    const weaponId = weaponIdFromWeaponEntry(entry);
    if (weaponId === null) {
      return 'Weapon';
    }
    return weaponDisplayName(weaponId, { preserveBugs: preserveBugs });
  }
  if (bonusId === BonusId.POINTS) {
    const points = int(entry.amount);
    const pointsLabel = bonusDisplayName(BonusId.POINTS, { preserveBugs: preserveBugs });
    return `${pointsLabel}: ${points}`;
  }
  const meta = BONUS_BY_ID.get(bonusId) ?? null;
  if (meta !== null) {
    return bonusDisplayName(meta.bonusId, { preserveBugs: preserveBugs });
  }
  return 'Bonus';
}
