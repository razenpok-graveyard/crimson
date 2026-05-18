// Port of crimson/effects.py

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import type { CallerStatic, CrandLike } from '@grim/rand.ts';
import { Crand } from '@grim/rand.ts';
import { creatureLifecycleIsCollidable } from '@crimson/creatures/lifecycle.ts';
import { EffectId } from '@crimson/effects-atlas.ts';
import { f32 } from '@crimson/math-parity.ts';
import { OwnerRef } from '@crimson/owner-ref.ts';
import type { CreatureDamageApplier } from '@crimson/projectiles/types.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import type { CreatureState } from '@crimson/creatures/runtime.ts';

type CreatureKillHandler = (arg0: number, arg1: OwnerRef) => void;

export const EFFECT_POOL_SIZE = 0x200;
export const PARTICLE_POOL_SIZE = 0x80;
export const SPRITE_EFFECT_POOL_SIZE = 0x180;
export const FX_QUEUE_CAPACITY = 0x80;
export const FX_QUEUE_MAX_COUNT = 0x7F;
export const FX_QUEUE_ROTATED_CAPACITY = 0x40;
export const FX_QUEUE_ROTATED_MAX_COUNT = 0x3F;

export enum ParticleStyleId {
  FLAMETHROWER = 0,
  BLOW_TORCH = 1,
  HR_FLAMER = 2,
  BUBBLEGUN = 8,
}

export class Particle {
  active: boolean;
  renderFlag: boolean;
  pos: Vec2;
  vel: Vec2;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  age: number;
  intensity: number;
  angle: number;
  spin: number;
  styleId: ParticleStyleId;
  targetId: number;
  owner: OwnerRef;

  constructor(opts: {
    active?: boolean;
    renderFlag?: boolean;
    pos?: Vec2;
    vel?: Vec2;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    age?: number;
    intensity?: number;
    angle?: number;
    spin?: number;
    styleId?: ParticleStyleId;
    targetId?: number;
    owner?: OwnerRef;
  } = {}) {
    this.active = opts.active ?? false;
    this.renderFlag = opts.renderFlag ?? false;
    this.pos = opts.pos ?? new Vec2();
    this.vel = opts.vel ?? new Vec2();
    this.scaleX = opts.scaleX ?? 1.0;
    this.scaleY = opts.scaleY ?? 1.0;
    this.scaleZ = opts.scaleZ ?? 1.0;
    this.age = opts.age ?? 0.0;
    this.intensity = opts.intensity ?? 0.0;
    this.angle = opts.angle ?? 0.0;
    this.spin = opts.spin ?? 0.0;
    this.styleId = opts.styleId ?? ParticleStyleId.FLAMETHROWER;
    this.targetId = opts.targetId ?? -1;
    this.owner = opts.owner ?? OwnerRef.fromLocalPlayer(0);
  }
}

export class SpriteEffect {
  active: boolean;
  color: RGBA;
  rotation: number;
  pos: Vec2;
  vel: Vec2;
  scale: number;

  constructor(opts: {
    active?: boolean;
    color?: RGBA;
    rotation?: number;
    pos?: Vec2;
    vel?: Vec2;
    scale?: number;
  } = {}) {
    this.active = opts.active ?? false;
    this.color = opts.color ?? new RGBA({ a: 0.0 });
    this.rotation = opts.rotation ?? 0.0;
    this.pos = opts.pos ?? new Vec2();
    this.vel = opts.vel ?? new Vec2();
    this.scale = opts.scale ?? 1.0;
  }
}

export class FxQueueEntry {
  effectId: number;
  rotation: number;
  pos: Vec2;
  height: number;
  width: number;
  color: RGBA;

  constructor(opts: {
    effectId?: number;
    rotation?: number;
    pos?: Vec2;
    height?: number;
    width?: number;
    color?: RGBA;
  } = {}) {
    this.effectId = opts.effectId ?? 0;
    this.rotation = opts.rotation ?? 0.0;
    this.pos = opts.pos ?? new Vec2();
    this.height = opts.height ?? 0.0;
    this.width = opts.width ?? 0.0;
    this.color = opts.color ?? new RGBA();
  }
}

export class FxQueueRotatedEntry {
  topLeft: Vec2;
  color: RGBA;
  rotation: number;
  scale: number;
  creatureTypeId: number;

  constructor(opts: {
    topLeft?: Vec2;
    color?: RGBA;
    rotation?: number;
    scale?: number;
    creatureTypeId?: number;
  } = {}) {
    this.topLeft = opts.topLeft ?? new Vec2();
    this.color = opts.color ?? new RGBA();
    this.rotation = opts.rotation ?? 0.0;
    this.scale = opts.scale ?? 1.0;
    this.creatureTypeId = opts.creatureTypeId ?? 0;
  }
}

export class EffectEntry {
  pos: Vec2;
  effectId: number;
  vel: Vec2;
  rotation: number;
  scale: number;
  halfWidth: number;
  halfHeight: number;
  age: number;
  lifetime: number;
  flags: number;
  color: RGBA;
  rotationStep: number;
  scaleStep: number;

  constructor(opts: {
    pos?: Vec2;
    effectId?: number;
    vel?: Vec2;
    rotation?: number;
    scale?: number;
    halfWidth?: number;
    halfHeight?: number;
    age?: number;
    lifetime?: number;
    flags?: number;
    color?: RGBA;
    rotationStep?: number;
    scaleStep?: number;
  } = {}) {
    this.pos = opts.pos ?? new Vec2();
    this.effectId = opts.effectId ?? 0;
    this.vel = opts.vel ?? new Vec2();
    this.rotation = opts.rotation ?? 0.0;
    this.scale = opts.scale ?? 1.0;
    this.halfWidth = opts.halfWidth ?? 0.0;
    this.halfHeight = opts.halfHeight ?? 0.0;
    this.age = opts.age ?? 0.0;
    this.lifetime = opts.lifetime ?? 0.0;
    this.flags = opts.flags ?? 0;
    this.color = opts.color ?? new RGBA();
    this.rotationStep = opts.rotationStep ?? 0.0;
    this.scaleStep = opts.scaleStep ?? 0.0;
  }
}

export class ParticlePool {
  protected _entries: Particle[];
  protected _rng: CrandLike;
  protected _creatureDamageApplier: CreatureDamageApplier | null;

  get rng(): CrandLike {
    return this._rng;
  }

  constructor(opts: { size?: number; rng?: CrandLike | null; creatureDamageApplier?: CreatureDamageApplier | null } = {}) {
    const size = opts.size ?? PARTICLE_POOL_SIZE;
    const rng = opts.rng ?? null;
    const creatureDamageApplier = opts.creatureDamageApplier ?? null;
    this._entries = Array.from({ length: Math.max(0, int(size)) }, (_, i) => i).map((_) => new Particle());
    this._rng = rng === null ? new Crand(0) : rng;
    this._creatureDamageApplier = creatureDamageApplier;
  }

  get entries(): Particle[] {
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
      entry.active = false;
    }
  }

  protected _allocSlot(opts: { caller?: CallerStatic } = {}): number {
    const caller = opts.caller ?? null;
    for (const [i, entry] of this._entries.entries()) {
      if (!entry.active) {
        return i;
      }
    }
    if (this._entries.length === 0) {
      throw new Error('Particle pool has zero entries');
    }
    // Native: `crt_rand() & 0x7f` (pool size is 0x80).
    return this._rng.rand({ caller: caller }) % this._entries.length;
  }

  spawnParticle(opts: { pos: Vec2; angle: number; intensity?: number; owner?: OwnerRef }): number {
    const pos = opts.pos;
    const angle = opts.angle;
    const intensity = opts.intensity ?? 1.0;
    const owner = opts.owner ?? OwnerRef.fromLocalPlayer(0);
    // Port of `fx_spawn_particle` (0x00420130).

    const idx = this._allocSlot({ caller: RngCallerStatic.FX_SPAWN_PARTICLE_ALLOC });
    const entry = this._entries[idx];
    entry.active = true;
    entry.renderFlag = true;
    entry.pos = pos;
    entry.vel = Vec2.fromAngle(angle).mul(90.0);
    entry.scaleX = 1.0;
    entry.scaleY = 1.0;
    entry.scaleZ = 1.0;
    entry.age = 0.0;
    entry.intensity = intensity;
    entry.angle = angle;
    entry.spin = this._rng.rand({ caller: RngCallerStatic.FX_SPAWN_PARTICLE_SPIN }) % 628 * 0.01;
    entry.styleId = ParticleStyleId.FLAMETHROWER;
    entry.targetId = -1;
    entry.owner = owner;
    return idx;
  }

  spawnParticleSlow(opts: { pos: Vec2; angle: number; owner?: OwnerRef }): number {
    const pos = opts.pos;
    const angle = opts.angle;
    const owner = opts.owner ?? OwnerRef.fromLocalPlayer(0);
    // Port of `fx_spawn_particle_slow` (0x00420240).

    const idx = this._allocSlot({ caller: RngCallerStatic.FX_SPAWN_PARTICLE_SLOW_ALLOC });
    const entry = this._entries[idx];
    entry.active = true;
    entry.renderFlag = true;
    entry.pos = pos;
    entry.vel = Vec2.fromAngle(angle).mul(30.0);
    entry.scaleX = 1.0;
    entry.scaleY = 1.0;
    entry.scaleZ = 1.0;
    entry.age = 0.0;
    entry.intensity = 1.0;
    entry.angle = angle;
    entry.spin = this._rng.rand({ caller: RngCallerStatic.FX_SPAWN_PARTICLE_SLOW_SPIN }) % 628 * 0.01;
    entry.styleId = ParticleStyleId.BUBBLEGUN;
    entry.targetId = -1;
    entry.owner = owner;
    return idx;
  }

  iterActive(): Particle[] {
    return this._entries.filter((entry) => entry.active);
  }

  update(dt: number, opts: { creatures?: readonly CreatureState[] | null; applyCreatureDamage?: CreatureDamageApplier | null; killCreature?: CreatureKillHandler | null; fxQueue?: FxQueue | null; spriteEffects?: SpriteEffectPool | null } = {}): number[] {
    const creatures = opts.creatures ?? null;
    const applyCreatureDamage = opts.applyCreatureDamage ?? null;
    const killCreature = opts.killCreature ?? null;
    const fxQueue = opts.fxQueue ?? null;
    const spriteEffects = opts.spriteEffects ?? null;
    // Advance particles and deactivate expired entries.
    //
    // This is a minimal port of the particle loop inside `projectile_update`
    // (0x00420b90). It captures the per-style decay/movement rules that drive
    // visual lifetimes and the weapon-driven collision damage.
    //
    // Returns indices of particles that were deactivated this tick.

    if (dt <= 0.0) {
      return [];
    }
    dt = f32(dt);
    const damageApplier = applyCreatureDamage || this._creatureDamageApplier;

    const _creatureFindInRadius = (opts: { pos: Vec2; radius: number }): number => {
      const pos = opts.pos;
      let radius = opts.radius;
      if (creatures === null) {
        return -1;
      }
      const maxIndex = Math.min(creatures.length, 0x180);
      radius = f32(radius);

      for (let creatureIdx = 0; creatureIdx < maxIndex; creatureIdx++) {
        const creature = creatures[creatureIdx];
        if (!creature.active) {
          continue;
        }
        // Native particle `creature_find_in_radius` is hitbox-gated, not
        // HP-gated: freshly killed creatures (hp<=0, hitbox>5) can still
        // receive same-tick style-0 damage callbacks.
        if (!creatureLifecycleIsCollidable(creature.lifecycleStage)) {
          continue;
        }

        const size = f32(creature.size);
        const dx = f32(creature.pos.x - pos.x);
        const dy = f32(creature.pos.y - pos.y);
        const distSq = f32(f32(dx * dx) + f32(dy * dy));
        const dist = f32(f32(Math.sqrt(distSq)) - radius);
        const threshold = f32(f32(size * 0.14285715) + 3.0);
        if (threshold < dist) {
          continue;
        }
        return int(creatureIdx);
      }

      return -1;
    };

    const expired: number[] = [];
    const rng = this._rng;

    for (const [idx, entry] of this._entries.entries()) {
      if (!entry.active) {
        continue;
      }

      const style = int(entry.styleId) & 0xFF;

      let moveScale: number;
      let move: Vec2;
      if (style === int(ParticleStyleId.BUBBLEGUN)) {
        entry.intensity = f32(entry.intensity - dt * 0.11);
        entry.spin = f32(entry.spin + dt * 5.0);
        moveScale = entry.intensity;
        if (moveScale <= 0.15) {
          moveScale *= 0.55;
        }
        move = entry.vel.mul(dt * moveScale);
        entry.pos = new Vec2(f32(entry.pos.x + move.x), f32(entry.pos.y + move.y));
      } else {
        entry.intensity = f32(entry.intensity - dt * 0.9);
        entry.spin = f32(entry.spin + dt);
        moveScale = Math.max(entry.intensity, 0.15) * 2.5;
        move = entry.vel.mul(dt * moveScale);
        entry.pos = new Vec2(f32(entry.pos.x + move.x), f32(entry.pos.y + move.y));
      }

      const alive = entry.intensity > (style === int(ParticleStyleId.FLAMETHROWER) ? 0.0 : 0.8);
      let targetId: number;
      if (!alive) {
        entry.active = false;
        expired.push(idx);
        if (style === int(ParticleStyleId.BUBBLEGUN) && entry.targetId !== -1) {
          targetId = int(entry.targetId);
          entry.targetId = -1;
          if (killCreature !== null) {
            killCreature(targetId, entry.owner);
          } else if (creatures !== null && targetId >= 0 && targetId < creatures.length) {
            creatures[targetId].hp = -1.0;
            creatures[targetId].active = false;
          }
        }
        continue;
      }

      let jitterCaller: RngCallerStatic;
      let jitter: ReturnType<typeof f32>;
      let vel!: Vec2;
      if (entry.renderFlag) {
        // Random walk drift (native adjusts angle based on `crt_rand`).
        jitterCaller = RngCallerStatic.PROJECTILE_UPDATE_PARTICLE_JITTER_ALT;
        if (style === int(ParticleStyleId.FLAMETHROWER)) {
          jitterCaller = RngCallerStatic.PROJECTILE_UPDATE_PARTICLE_JITTER_FLAMETHROWER;
        } else if (style === int(ParticleStyleId.BUBBLEGUN)) {
          jitterCaller = RngCallerStatic.PROJECTILE_UPDATE_PARTICLE_JITTER_BUBBLEGUN;
        }
        jitter = f32((rng.rand({ caller: jitterCaller }) % 100 - 50) * 0.06 * Math.max(entry.intensity, 0.0) * dt);
        let speed: number;
        if (style === int(ParticleStyleId.FLAMETHROWER)) {
          jitter = f32(jitter * 1.96);
          speed = 82.0;
        } else if (style === int(ParticleStyleId.BUBBLEGUN)) {
          jitter = f32(jitter * 1.1);
          speed = 62.0;
        } else {
          jitter = f32(jitter * 1.1);
          speed = 82.0;
        }
        entry.angle = f32(entry.angle - jitter);
        vel = Vec2.fromAngle(entry.angle).mul(speed);
        entry.vel = new Vec2(f32(vel.x), f32(vel.y));
      }

      const alpha = clamp(entry.intensity, 0.0, 1.0);
      const shade = 1.0 - Math.max(entry.intensity, 0.0) * 0.95;
      entry.age = alpha;
      entry.scaleX = shade;
      entry.scaleY = shade;
      // Native only updates scale_x/scale_y; scale_z stays at its spawn value (1.0).

      if (style === int(ParticleStyleId.BUBBLEGUN) && !entry.renderFlag && entry.targetId !== -1 && creatures !== null) {
        targetId = int(entry.targetId);
        if (targetId >= 0 && targetId < creatures.length && creatures[targetId].active) {
          entry.pos = creatures[targetId].pos;
        }
      }

      if (entry.renderFlag && creatures !== null) {
        const hitIdx = _creatureFindInRadius({ pos: entry.pos, radius: Math.max(entry.intensity, 0.0) * 8.0 });
        if (hitIdx !== -1) {
          entry.renderFlag = false;
          const creature = creatures[hitIdx];
          let hitAngle: Vec2 | number;
          if (style === int(ParticleStyleId.BUBBLEGUN)) {
            entry.targetId = int(hitIdx);
            entry.pos = creature.pos;
            entry.vel = new Vec2();
          } else {
            entry.angle = ((entry.angle % (Math.PI * 2.0)) + (Math.PI * 2.0)) % (Math.PI * 2.0);
            hitAngle = (new Vec2((entry.pos.x - entry.vel.x * dt) - creature.pos.x, (entry.pos.y - entry.vel.y * dt) - creature.pos.y)).toAngle();
            hitAngle = ((hitAngle % (Math.PI * 2.0)) + (Math.PI * 2.0)) % (Math.PI * 2.0);
            const deflectStep = (Math.PI * 2.0) * 0.2;
            if (entry.angle <= hitAngle) {
              entry.angle = f32(entry.angle + deflectStep);
            } else {
              entry.angle = f32(entry.angle - deflectStep);
            }

            const bounceVelocity = Vec2.fromAngle(entry.angle).mul(82.0);
            const speedScale = f32(rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_PARTICLE_BOUNCE_SPEED_SCALE }) % 10 * 0.1);
            entry.vel = new Vec2(f32(bounceVelocity.x * speedScale), f32(bounceVelocity.y * speedScale));

            const damage = Math.max(0.0, entry.intensity * 10.0);
            if (damage > 0.0) {
              if (damageApplier !== null) {
                damageApplier(int(hitIdx), damage, 4, new Vec2(), entry.owner);
              } else {
                creature.hp -= damage;
              }
            }

            const tint = creature.tint;
            const tintSum = tint.r + tint.g + tint.b;
            if (tintSum > 1.6) {
              const factor = 1.0 - entry.intensity * 0.01;
              creature.tint = tint.scaled(factor).clamped();
            }

            if (spriteEffects !== null && (idx % 3 === 0)) {
              const spriteVel = new Vec2((rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_PARTICLE_SPRITE_VEL_X }) % 60 - 30), (rng.rand({ caller: RngCallerStatic.PROJECTILE_UPDATE_PARTICLE_SPRITE_VEL_Y }) % 60 - 30));
              spriteEffects.spawn({
                pos: creature.pos,
                vel: spriteVel,
                scale: 13.0,
                color: new RGBA(1.0, 1.0, 1.0, 0.7),
              });
            }

            if (fxQueue !== null) {
              fxQueue.addRandom({
                pos: creature.pos,
                rng: rng,
              });
            }

            creature.pos = new Vec2(f32(creature.pos.x + entry.vel.x * dt), f32(creature.pos.y + entry.vel.y * dt));
          }
        }
      }
    }

    return expired;
  }
}

export class SpriteEffectPool {
  protected _entries: SpriteEffect[];
  protected _rng: CrandLike;

  get rng(): CrandLike {
    return this._rng;
  }

  constructor(opts: { size?: number; rng?: CrandLike | null } = {}) {
    const size = opts.size ?? SPRITE_EFFECT_POOL_SIZE;
    const rng = opts.rng ?? null;
    this._entries = Array.from({ length: Math.max(0, int(size)) }, (_, i) => i).map((_) => new SpriteEffect());
    this._rng = rng === null ? new Crand(0) : rng;
  }

  get entries(): SpriteEffect[] {
    return this._entries;
  }

  reset(): void {
    for (const entry of this._entries) {
      entry.active = false;
    }
  }

  spawn(opts: { pos: Vec2; vel: Vec2; scale?: number; color?: RGBA | null }): number {
    const pos = opts.pos;
    const vel = opts.vel;
    const scale = opts.scale ?? 1.0;
    const color = opts.color ?? null;
    // Port of `fx_spawn_sprite` (0x0041fbb0).

    let idx = null;
    for (const [i, entry] of this._entries.entries()) {
      if (!entry.active) {
        idx = i;
        break;
      }
    }
    if (idx === null) {
      if (this._entries.length === 0) {
        throw new Error('Sprite effect pool has zero entries');
      }
      idx = this._rng.rand({ caller: RngCallerStatic.FX_SPAWN_SPRITE_ALLOC }) % this._entries.length;
    }

    const entry = this._entries[idx];
    entry.active = true;
    entry.color = color === null ? new RGBA() : color;
    entry.rotation = (this._rng.rand({ caller: RngCallerStatic.FX_SPAWN_SPRITE_ROTATION }) % 628 * 0.01);
    entry.pos = pos;
    entry.vel = vel;
    entry.scale = scale;
    return idx;
  }

  iterActive(): SpriteEffect[] {
    return this._entries.filter((entry) => entry.active);
  }

  update(dt: number): number[] {
    if (dt <= 0.0) {
      return [];
    }

    const expired: number[] = [];
    for (const [idx, entry] of this._entries.entries()) {
      if (!entry.active) {
        continue;
      }
      entry.pos = entry.pos.add(entry.vel.mul(dt));
      entry.rotation += dt * 3.0;
      entry.color = entry.color.withAlpha(entry.color.a - dt);
      entry.scale += dt * 60.0;
      if (entry.color.a <= 0.0) {
        entry.active = false;
        expired.push(idx);
      }
    }
    return expired;
  }
}

// Per-frame terrain decal queue (`fx_queue` / `fx_queue_add`).
export class FxQueue {
  protected _entries: FxQueueEntry[];
  protected _count: number;
  protected _maxCount: number;
  violenceDisabled: number;

  get maxCount(): number {
    return this._maxCount;
  }

  constructor(opts: { capacity?: number; maxCount?: number } = {}) {
    let capacity = opts.capacity ?? FX_QUEUE_CAPACITY;
    let maxCount = opts.maxCount ?? FX_QUEUE_MAX_COUNT;
    capacity = Math.max(0, int(capacity));
    maxCount = Math.max(0, Math.min(int(maxCount), capacity));
    this._entries = Array.from({ length: Math.max(0, capacity) }, (_, i) => i).map((_) => new FxQueueEntry());
    this._count = 0;
    this._maxCount = maxCount;
    // Mirrors native `config_violence_disabled` gate in `fx_queue_add_random`.
    // Nonzero suppresses violence-linked random decals.
    this.violenceDisabled = 0;
  }

  get entries(): FxQueueEntry[] {
    return this._entries;
  }

  get count(): number {
    return this._count;
  }

  clear(): void {
    this._count = 0;
  }

  iterActive(): FxQueueEntry[] {
    return this._entries.slice(0, this._count);
  }

  add(opts: { effectId: number; pos: Vec2; width: number; height: number; rotation: number; rgba: RGBA }): boolean {
    const effectId = opts.effectId;
    const pos = opts.pos;
    const width = opts.width;
    const height = opts.height;
    const rotation = opts.rotation;
    const rgba = opts.rgba;
    // Port of `fx_queue_add` (0x0041e840).

    if (this._count >= this._maxCount) {
      return false;
    }

    const entry = this._entries[this._count];
    entry.effectId = int(effectId);
    entry.rotation = rotation;
    entry.pos = pos;
    entry.height = height;
    entry.width = width;
    entry.color = rgba;
    this._count += 1;
    return true;
  }

  addRandom(opts: { pos: Vec2; rng: CrandLike }): boolean {
    const pos = opts.pos;
    const rng = opts.rng;
    // Port of `fx_queue_add_random` (effect ids 3..7 with grayscale tint).
    if (int(this.violenceDisabled) !== 0) {
      return false;
    }
    // Native `fx_queue_add_random` always consumes RNG even when the queue
    // is full, then lets `fx_queue_add` fail silently.
    const gray = (rng.rand({ caller: RngCallerStatic.FX_QUEUE_ADD_RANDOM_GRAY }) & 0xF) * 0.01 + 0.84;
    const w = (rng.rand({ caller: RngCallerStatic.FX_QUEUE_ADD_RANDOM_WIDTH }) % 24 - 12) + 30.0;
    const rotation = rng.rand({ caller: RngCallerStatic.FX_QUEUE_ADD_RANDOM_ROTATION }) % 628 * 0.01;
    const effectId = rng.rand({ caller: RngCallerStatic.FX_QUEUE_ADD_RANDOM_EFFECT_ID }) % 5 + 3;
    return this.add({ effectId: effectId, pos: pos, width: w, height: w, rotation: rotation, rgba: new RGBA(gray, gray, gray, 1.0) });
  }
}

// Rotated corpse queue (`fx_queue_rotated` / `fx_queue_add_rotated`).
export class FxQueueRotated {
  protected _entries: FxQueueRotatedEntry[];
  protected _count: number;
  protected _maxCount: number;

  get maxCount(): number {
    return this._maxCount;
  }

  constructor(opts: { capacity?: number; maxCount?: number } = {}) {
    let capacity = opts.capacity ?? FX_QUEUE_ROTATED_CAPACITY;
    let maxCount = opts.maxCount ?? FX_QUEUE_ROTATED_MAX_COUNT;
    capacity = Math.max(0, int(capacity));
    maxCount = Math.max(0, Math.min(int(maxCount), capacity));
    this._entries = Array.from({ length: Math.max(0, capacity) }, (_, i) => i).map((_) => new FxQueueRotatedEntry());
    this._count = 0;
    this._maxCount = maxCount;
  }

  get entries(): FxQueueRotatedEntry[] {
    return this._entries;
  }

  get count(): number {
    return this._count;
  }

  clear(): void {
    this._count = 0;
  }

  iterActive(): FxQueueRotatedEntry[] {
    return this._entries.slice(0, this._count);
  }

  add(opts: { topLeft: Vec2; rgba: RGBA; rotation: number; scale: number; creatureTypeId: number; terrainBodiesTransparency?: number; terrainTextureFailed?: boolean }): boolean {
    const topLeft = opts.topLeft;
    const rgba = opts.rgba;
    const rotation = opts.rotation;
    const scale = opts.scale;
    const creatureTypeId = opts.creatureTypeId;
    const terrainBodiesTransparency = opts.terrainBodiesTransparency ?? 0.0;
    const terrainTextureFailed = opts.terrainTextureFailed ?? false;
    // Port of `fx_queue_add_rotated` (0x00427840).

    if (terrainTextureFailed) {
      return false;
    }
    if (this._count >= this._maxCount) {
      return false;
    }

    const color = rgba;
    let a = color.a;
    if (terrainBodiesTransparency !== 0.0) {
      a = a / terrainBodiesTransparency;
    } else {
      a = a * 0.8;
    }

    const entry = this._entries[this._count];
    entry.topLeft = topLeft;
    entry.color = color.withAlpha(a);
    entry.rotation = rotation;
    entry.scale = scale;
    entry.creatureTypeId = int(creatureTypeId);

    this._count += 1;
    return true;
  }
}

// Effect pool (`effect_spawn`, `effects_update`).
//
// This pool renders transient particle quads and can optionally enqueue decals
// into `FxQueue` on expiry (flags bit `0x80`).
export class EffectPool {
  protected _entries: EffectEntry[];
  protected _free: any[];
  protected _detailToggle: number;
  protected _overwriteCursor: number;

  get detailToggle(): number {
    return this._detailToggle;
  }
  get overwriteCursor(): number {
    return this._overwriteCursor;
  }

  constructor(opts: { size?: number } = {}) {
    let size = opts.size ?? EFFECT_POOL_SIZE;
    size = Math.max(0, int(size));
    this._entries = Array.from({ length: Math.max(0, size) }, (_, i) => i).map((_) => new EffectEntry());
    this._free = Array.from(Array.from({ length: Math.max(0, Math.ceil((-1 - size - 1) / -1)) }, (_, i) => size - 1 + i * -1));
    this._detailToggle = 0;
    this._overwriteCursor = 0;
  }

  get entries(): EffectEntry[] {
    return this._entries;
  }

  reset(): void {
    for (const entry of this._entries) {
      entry.flags = 0;
    }
    this._free = Array.from(Array.from({ length: Math.max(0, Math.ceil((-1 - this._entries.length - 1) / -1)) }, (_, i) => this._entries.length - 1 + i * -1));
    this._detailToggle = 0;
    this._overwriteCursor = 0;
  }

  iterActive(): EffectEntry[] {
    return this._entries.filter((entry) => entry.flags);
  }

  protected _allocSlot(opts: { detailPreset: number }): number | null {
    const detailPreset = opts.detailPreset;
    // Native: if detail_preset < 3, skip every other spawn attempt.
    if (int(detailPreset) < 3) {
      const skip = this._detailToggle & 1;
      this._detailToggle += 1;
      if (skip) {
        return null;
      }
    }

    if (this._free.length > 0) {
      return this._free.pop();
    }

    if (this._entries.length === 0) {
      return null;
    }

    const idx = this._overwriteCursor % this._entries.length;
    this._overwriteCursor = idx + 1;
    return idx;
  }

  spawn(opts: { effectId: number; pos: Vec2; vel: Vec2; rotation: number; scale: number; halfWidth: number; halfHeight: number; age: number; lifetime: number; flags: number; color: RGBA; rotationStep: number; scaleStep: number; detailPreset: number }): number | null {
    const effectId = opts.effectId;
    const pos = opts.pos;
    const vel = opts.vel;
    const rotation = opts.rotation;
    const scale = opts.scale;
    const halfWidth = opts.halfWidth;
    const halfHeight = opts.halfHeight;
    const age = opts.age;
    const lifetime = opts.lifetime;
    const flags = opts.flags;
    const color = opts.color;
    const rotationStep = opts.rotationStep;
    const scaleStep = opts.scaleStep;
    const detailPreset = opts.detailPreset;
    const idx = this._allocSlot({ detailPreset: int(detailPreset) });
    if (idx === null) {
      return null;
    }

    const entry = this._entries[idx];
    entry.pos = pos;
    entry.effectId = int(effectId);
    entry.vel = vel;
    entry.rotation = rotation;
    entry.scale = scale;
    entry.halfWidth = halfWidth;
    entry.halfHeight = halfHeight;
    entry.age = age;
    entry.lifetime = lifetime;
    entry.flags = int(flags);
    entry.color = color;
    entry.rotationStep = rotationStep;
    entry.scaleStep = scaleStep;
    return idx;
  }

  free(idx: number): void {
    if (!(idx >= 0 && idx < this._entries.length)) {
      return;
    }
    const entry = this._entries[idx];
    entry.flags = 0;
    this._free.push(idx);
  }

  update(dt: number, opts: { fxQueue?: FxQueue | null } = {}): void {
    const fxQueue = opts.fxQueue ?? null;
    // Advance active effects and enqueue terrain decals on expiry.

    if (dt <= 0.0) {
      return;
    }

    for (const [idx, entry] of this._entries.entries()) {
      const flags = int(entry.flags);
      if (!flags) {
        continue;
      }

      const age = entry.age + dt;
      entry.age = age;
      const lifetime = entry.lifetime;

      if (age < lifetime) {
        if (age >= 0.0) {
          entry.pos = entry.pos.add(entry.vel.mul(dt));
          if (flags & 0x4) {
            entry.rotation += entry.rotationStep * dt;
          }
          if (flags & 0x8) {
            entry.scale += entry.scaleStep * dt;
          }
          if (flags & 0x10) {
            const nextAlpha = lifetime > 1e-9 ? 1.0 - age / lifetime : 0.0;
            entry.color = entry.color.withAlpha(nextAlpha);
          }
        }
        continue;
      }

      if (fxQueue !== null && (flags & 0x80)) {
        // On expiry, the native code overrides alpha before queuing.
        const alpha = (flags & 0x100) ? 0.35 : 0.8;
        fxQueue.add({
          effectId: int(entry.effectId),
          pos: entry.pos,
          width: entry.halfWidth * 2.0,
          height: entry.halfHeight * 2.0,
          rotation: entry.rotation,
          rgba: entry.color.withAlpha(alpha),
        });
      }

      this.free(idx);
    }
  }

  spawnShellCasing(opts: { pos: Vec2; aimHeading: number; draws: [number, number, number, number]; detailPreset: number }): void {
    const pos = opts.pos;
    const aimHeading = opts.aimHeading;
    const draws = opts.draws;
    const detailPreset = opts.detailPreset;
    // Port of the casing spawn in native gameplay fire (`effect_id 0x12`).

    const [angleDraw, speedDraw, rotationDraw, rotationStepDraw] = draws;

    const angle = aimHeading + (int(angleDraw) & 0x3F) * 0.01;
    const speed = (int(speedDraw) & 0x3F) * 0.022727273 + 1.0;
    const velocity = Vec2.fromAngle(angle).mul(speed * 100.0);

    const rotation = ((int(rotationDraw) & 0x3F) - 0x20) * 0.1;
    const rotationStep = (int(rotationStepDraw) % 20 * 0.1 - 1.0) * 14.0;

    this.spawn({
      effectId: int(EffectId.CASING),
      pos: pos,
      vel: velocity,
      rotation: rotation,
      scale: 1.0,
      halfWidth: 2.0,
      halfHeight: 2.0,
      age: 0.0,
      lifetime: 0.15,
      flags: 0x1C5,
      color: new RGBA(1.0, 1.0, 1.0, 0.6),
      rotationStep: rotationStep,
      scaleStep: 0.0,
      detailPreset: int(detailPreset),
    });
  }

  spawnBloodSplatter(opts: { pos: Vec2; angle: number; age: number; rng: CrandLike; detailPreset: number; violenceDisabled: number }): void {
    const pos = opts.pos;
    const angle = opts.angle;
    const age = opts.age;
    const rng = opts.rng;
    const detailPreset = opts.detailPreset;
    const violenceDisabled = opts.violenceDisabled;
    // Port of `effect_spawn_blood_splatter` (0x0042eb10).

    if (int(violenceDisabled) !== 0) {
      return;
    }

    const lifetime = 0.25 - age;
    const base = angle + Math.PI;
    const direction = Vec2.fromAngle(base);

    for (let i = 0; i < 2; i++) {
      const r0 = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_BLOOD_SPLATTER_ROTATION });
      const rotation = ((r0 & 0x3F) - 0x20) * 0.1 + base;
      const r1 = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_BLOOD_SPLATTER_HALF });
      const half = ((r1 & 7) + 1);
      const r2 = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_BLOOD_SPLATTER_SPEED_X });
      const speedX = ((r2 & 0x3F) + 100);
      const r3 = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_BLOOD_SPLATTER_SPEED_Y });
      const speedY = ((r3 & 0x3F) + 100);
      const velocity = new Vec2(direction.x * speedX, direction.y * speedY);
      const r4 = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_BLOOD_SPLATTER_SCALE_STEP });
      const scaleStep = (r4 & 0x7F) * 0.03 + 0.1;

      this.spawn({
        effectId: int(EffectId.BLOOD_SPLATTER),
        pos: pos,
        vel: velocity,
        rotation: rotation,
        scale: 1.0,
        halfWidth: half,
        halfHeight: half,
        age: age,
        lifetime: lifetime,
        flags: 0xC9,
        color: new RGBA(1.0, 1.0, 1.0, 0.5),
        rotationStep: 0.0,
        scaleStep: scaleStep,
        detailPreset: int(detailPreset),
      });
    }
  }

  spawnBurst(opts: { pos: Vec2; count: number; rng: CrandLike; detailPreset: number; lifetime?: number; scaleStep?: number | null; color?: RGBA }): void {
    const pos = opts.pos;
    let count = opts.count;
    const rng = opts.rng;
    const detailPreset = opts.detailPreset;
    const lifetime = opts.lifetime ?? 0.5;
    const scaleStep = opts.scaleStep ?? null;
    const color = opts.color ?? new RGBA(0.4, 0.5, 1.0, 0.5);
    // Port of `effect_spawn_burst` (0x0042ef60).

    count = Math.max(0, int(count));
    for (let i = 0; i < count; i++) {
      const r0 = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_BURST_ROTATION });
      const r1 = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_BURST_VEL_X });
      const r2 = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_BURST_VEL_Y });
      let sampledScaleStep: any;
      if (scaleStep === null) {
        const r3 = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_BURST_SCALE_STEP });
        sampledScaleStep = r3;
      } else {
        sampledScaleStep = null;
      }

      this.spawnBurstParticle({
        pos: pos,
        rotationDraw: r0,
        velXDraw: r1,
        velYDraw: r2,
        scaleStepDraw: sampledScaleStep,
        scaleStep: scaleStep,
        lifetime: lifetime,
        color: color,
        detailPreset: detailPreset,
      });
    }
  }

  spawnBurstParticle(opts: { pos: Vec2; rotationDraw: number; velXDraw: number; velYDraw: number; scaleStepDraw?: number | null; scaleStep?: number | null; lifetime?: number; color?: RGBA; detailPreset: number }): void {
    const pos = opts.pos;
    const rotationDraw = opts.rotationDraw;
    const velXDraw = opts.velXDraw;
    const velYDraw = opts.velYDraw;
    const scaleStepDraw = opts.scaleStepDraw ?? null;
    const scaleStep = opts.scaleStep ?? null;
    const lifetime = opts.lifetime ?? 0.5;
    const color = opts.color ?? new RGBA(0.4, 0.5, 1.0, 0.5);
    const detailPreset = opts.detailPreset;
    const rotation = (int(rotationDraw) & 0x7F) * 0.049087387;
    const velocity = new Vec2(((int(velXDraw) & 0x7F) - 0x40), ((int(velYDraw) & 0x7F) - 0x40));
    let step: number;
    if (scaleStep === null) {
      if (!(scaleStepDraw !== null)) throw new Error();
      step = int(scaleStepDraw) % 100 * 0.01 + 0.1;
    } else {
      step = scaleStep;
    }

    this.spawn({
      effectId: int(EffectId.BURST),
      pos: pos,
      vel: velocity,
      rotation: rotation,
      scale: 1.0,
      halfWidth: 32.0,
      halfHeight: 32.0,
      age: 0.0,
      lifetime: lifetime,
      flags: 0x1D,
      color: color,
      rotationStep: 0.0,
      scaleStep: step,
      detailPreset: int(detailPreset),
    });
  }

  spawnRing(opts: { pos: Vec2; detailPreset: number; color: RGBA; lifetime?: number; scaleStep?: number }): void {
    const pos = opts.pos;
    const detailPreset = opts.detailPreset;
    const color = opts.color;
    const lifetime = opts.lifetime ?? 0.25;
    const scaleStep = opts.scaleStep ?? 50.0;
    // Ring/halo burst used by bonus pickup effects (`bonus_apply`).

    this.spawn({
      effectId: int(EffectId.RING),
      pos: pos,
      vel: new Vec2(),
      rotation: 0.0,
      scale: 1.0,
      halfWidth: 32.0,
      halfHeight: 32.0,
      age: 0.0,
      lifetime: lifetime,
      flags: 0x19,
      color: color,
      rotationStep: 0.0,
      scaleStep: scaleStep,
      detailPreset: int(detailPreset),
    });
  }

  spawnFreezeShard(opts: { pos: Vec2; angle: number; rng: CrandLike; detailPreset: number }): void {
    const pos = opts.pos;
    const angle = opts.angle;
    const rng = opts.rng;
    const detailPreset = opts.detailPreset;
    // Port of `effect_spawn_freeze_shard` (0x0042ec80).

    const lifetime = (rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_FREEZE_SHARD_LIFETIME }) & 0xF) * 0.01 + 0.2;
    const base = angle + Math.PI;

    const rotation = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_FREEZE_SHARD_ROTATION }) % 100 * 0.01 + base;
    const half = (rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_FREEZE_SHARD_HALF }) % 5 + 7);

    const velocity = Vec2.fromAngle(base).mul(114.0);

    const rotationStep = (rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_FREEZE_SHARD_ROTATION_STEP }) % 20 * 0.1 - 1.0) * 4.0;
    const scaleStep = -(rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_FREEZE_SHARD_SCALE_STEP }) & 0xF) * 0.1;

    const effectId = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_FREEZE_SHARD_EFFECT_ID }) % 3 + 8;
    this.spawn({
      effectId: int(effectId),
      pos: pos,
      vel: velocity,
      rotation: rotation,
      scale: 1.0,
      halfWidth: half,
      halfHeight: half,
      age: 0.0,
      lifetime: lifetime,
      flags: 0x1CD,
      color: new RGBA(1.0, 1.0, 1.0, 0.5),
      rotationStep: rotationStep,
      scaleStep: scaleStep,
      detailPreset: int(detailPreset),
    });
  }

  spawnFreezeShatter(opts: { pos: Vec2; angle: number; rng: CrandLike; detailPreset: number }): void {
    const pos = opts.pos;
    const angle = opts.angle;
    const rng = opts.rng;
    const detailPreset = opts.detailPreset;
    // Port of `effect_spawn_freeze_shatter` (0x0042ee00).

    const lifetime = 1.1;
    for (let idx = 0; idx < 4; idx++) {
      const rotation = idx * (Math.PI / 2.0) + angle;
      const velocity = Vec2.fromAngle(rotation).mul(42.0);
      const half = (rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_FREEZE_SHATTER_HALF }) % 10 + 18);
      const rotationStep = (rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_FREEZE_SHATTER_ROTATION_STEP }) % 20 * 0.1 - 1.0) * 1.9;

      this.spawn({
        effectId: int(EffectId.FREEZE_SHATTER),
        pos: pos,
        vel: velocity,
        rotation: rotation,
        scale: 1.0,
        halfWidth: half,
        halfHeight: half,
        age: 0.0,
        lifetime: lifetime,
        flags: 0x5D,
        color: new RGBA(1.0, 1.0, 1.0, 0.5),
        rotationStep: rotationStep,
        scaleStep: 0.0,
        detailPreset: int(detailPreset),
      });
    }

    for (let i = 0; i < 4; i++) {
      const shardAngle = (rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_FREEZE_SHATTER_SHARD_ANGLE }) % 612 * 0.01);
      this.spawnFreezeShard({
        pos: pos,
        angle: shardAngle,
        rng: rng,
        detailPreset: int(detailPreset),
      });
    }
  }

  spawnExplosionBurst(opts: { pos: Vec2; scale: number; rng: CrandLike; detailPreset: number }): void {
    const pos = opts.pos;
    const scale = opts.scale;
    const rng = opts.rng;
    let detailPreset = opts.detailPreset;
    // Port of `effect_spawn_explosion_burst` (0x0042f6c0).

    detailPreset = int(detailPreset);

    // Shockwave ring.
    this.spawn({
      effectId: int(EffectId.RING),
      pos: pos,
      vel: new Vec2(),
      rotation: 0.0,
      scale: 1.0,
      halfWidth: 32.0,
      halfHeight: 32.0,
      age: -0.1,
      lifetime: 0.35,
      flags: 0x19,
      color: new RGBA(0.6, 0.6, 0.6, 1.0),
      rotationStep: 0.0,
      scaleStep: scale * 25.0,
      detailPreset: detailPreset,
    });

    // Dark explosion puffs (high detail only).
    let rotation: number;
    if (detailPreset > 3) {
      for (let idx = 0; idx < 2; idx++) {
        const age = idx * 0.2 - 0.5;
        const lifetime = idx * 0.2 + 0.6;
        rotation = (rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_EXPLOSION_BURST_PUFF_ROTATION }) % 614 * 0.02);
        this.spawn({
          effectId: int(EffectId.EXPLOSION_PUFF),
          pos: pos,
          vel: new Vec2(),
          rotation: rotation,
          scale: 1.0,
          halfWidth: 32.0,
          halfHeight: 32.0,
          age: age,
          lifetime: lifetime,
          flags: 0x5D,
          color: new RGBA(0.1, 0.1, 0.1, 1.0),
          rotationStep: 1.4,
          scaleStep: scale * 5.0,
          detailPreset: detailPreset,
        });
      }
    }

    // Bright flash.
    this.spawn({
      effectId: int(EffectId.BURST),
      pos: pos,
      vel: new Vec2(),
      rotation: 0.0,
      scale: 1.0,
      halfWidth: 32.0,
      halfHeight: 32.0,
      age: 0.0,
      lifetime: 0.3,
      flags: 0x19,
      color: new RGBA(1.0, 1.0, 1.0, 1.0),
      rotationStep: 0.0,
      scaleStep: scale * 45.0,
      detailPreset: detailPreset,
    });

    let count: number;
    if (detailPreset < 2) {
      count = 1;
    } else {
      count = 3 + (detailPreset > 3 ? 1 : 0);
    }

    // Extra shockwave particles.
    for (let i = 0; i < count; i++) {
      rotation = (rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_EXPLOSION_BURST_ROTATION }) % 314 * 0.02);
      const velocity = new Vec2(((rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_EXPLOSION_BURST_VEL_X }) & 0x3F) * 2 - 0x40), ((rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_EXPLOSION_BURST_VEL_Y }) & 0x3F) * 2 - 0x40));
      const scaleStep = ((rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_EXPLOSION_BURST_SCALE_STEP }) - 3 & 7) * scale);
      const rotationStep = rng.rand({ caller: RngCallerStatic.EFFECT_SPAWN_EXPLOSION_BURST_ROTATION_STEP }) + 3 & 7;
      this.spawn({
        effectId: int(EffectId.EXPLOSION_BURST),
        pos: pos,
        vel: velocity,
        rotation: rotation,
        scale: 1.0,
        halfWidth: 32.0,
        halfHeight: 32.0,
        age: 0.0,
        lifetime: 0.7,
        flags: 0x1D,
        color: new RGBA(1.0, 1.0, 1.0, 1.0),
        rotationStep: rotationStep,
        scaleStep: scaleStep,
        detailPreset: detailPreset,
      });
    }
  }
}
