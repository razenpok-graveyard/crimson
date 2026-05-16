// Port of crimson/creatures/anim.py

import { CreatureAiMode, CreatureFlags } from '@crimson/creatures/spawn.ts';

const _FLAG_ANIM_PING_PONG = int(CreatureFlags.ANIM_PING_PONG);
const _FLAG_ANIM_LONG_STRIP = int(CreatureFlags.ANIM_LONG_STRIP);
const _FLAG_RANGED_ATTACK_SHOCK = int(CreatureFlags.RANGED_ATTACK_SHOCK);

const _f32buf = new Float32Array(1);
const _u32buf = new Uint32Array(_f32buf.buffer);

function f32(value: number): number {
  // Round-trip through float32 to match the game's stored float behavior.
  return (() => { _f32buf[0] = value; return _f32buf[0]; })();
}

function u32(value: number): number {
  return (value >>> 0);
}

function i32(value: number): number {
  value = value >>> 0;
  if (value & 0x80000000) {
    return value - 0x100000000;
  }
  return value;
}

export function creatureCorpseFrameForType(typeId: number): number {
  // Resolve the bodyset frame index used for corpse decals (`fx_queue_render`).

  return _CREATURE_CORPSE_FRAMES.get(int(typeId)) ?? int(typeId) & 0xF;
}

export function creatureAnimIsLongStrip(flags: number): boolean {
  // From creature_update_all / creature_render_type:
  // long strip when (flags & 4) == 0 OR (flags & 0x40) != 0
  const flagsBits = int(flags);
  return (flagsBits & _FLAG_ANIM_PING_PONG) === 0 || (flagsBits & _FLAG_ANIM_LONG_STRIP) !== 0;
}

export function creatureAnimPhaseStep(opts: { animRate: number; moveSpeed: number; dt: number; size: number; localScale?: number; flags?: number; aiMode?: number; quantizeF32?: boolean }): number {
  // Compute the per-frame animation phase increment (creature_update_all).
  let animRate = opts.animRate;
  let moveSpeed = opts.moveSpeed;
  let dt = opts.dt;
  let size = opts.size;
  let localScale = opts.localScale ?? 1.0;
  const flags = opts.flags ?? 0;
  const aiMode = opts.aiMode ?? CreatureAiMode.ORBIT_PLAYER;
  const quantizeF32 = opts.quantizeF32 ?? true;
  if (size === 0.0) {
    return 0.0;
  }

  if (quantizeF32) {
    animRate = f32(animRate);
    moveSpeed = f32(moveSpeed);
    dt = f32(dt);
    size = f32(size);
    localScale = f32(localScale);
  }

  const speedScale = (quantizeF32 ? f32(30.0) : 30.0) / size;
  const flagsBits = int(flags);
  const isLongStrip = (flagsBits & _FLAG_ANIM_PING_PONG) === 0 || (flagsBits & _FLAG_ANIM_LONG_STRIP) !== 0;
  let stripMul = quantizeF32 ? f32(25.0) : 25.0;
  if (!isLongStrip) {
    stripMul = quantizeF32 ? f32(22.0) : 22.0;
  } else if (aiMode === CreatureAiMode.HOLD_TIMER) {
    // Long-strip creatures stop advancing animation phase in ai_mode == 7.
    return 0.0;
  }

  const step = animRate * moveSpeed * dt * speedScale * localScale * stripMul;
  return quantizeF32 ? f32(step) : step;
}

export function creatureAnimAdvancePhase(phase: number, opts: { animRate: number; moveSpeed: number; dt: number; size: number; localScale?: number; flags?: number; aiMode?: number; quantizeF32?: boolean }): [number, number] {
  // Advance anim_phase and wrap it the same way as creature_update_all.
  //
  // Returns (new_phase, applied_step).
  const animRate = opts.animRate;
  const moveSpeed = opts.moveSpeed;
  const dt = opts.dt;
  const size = opts.size;
  const localScale = opts.localScale ?? 1.0;
  const flags = opts.flags ?? 0;
  const aiMode = opts.aiMode ?? CreatureAiMode.ORBIT_PLAYER;
  const quantizeF32 = opts.quantizeF32 ?? true;
  if (quantizeF32) {
    phase = f32(phase);
  }

  const step = creatureAnimPhaseStep({ animRate: animRate, moveSpeed: moveSpeed, dt: dt, size: size, localScale: localScale, flags: flags, aiMode: aiMode, quantizeF32: quantizeF32 });
  if (step === 0.0) {
    return [phase, 0.0];
  }

  phase = phase + step;
  if (quantizeF32) {
    phase = f32(phase);
  }

  const flagsBits = int(flags);
  const isLongStrip = (flagsBits & _FLAG_ANIM_PING_PONG) === 0 || (flagsBits & _FLAG_ANIM_LONG_STRIP) !== 0;
  let limit: number;
  if (isLongStrip) {
    limit = quantizeF32 ? f32(31.0) : 31.0;
    while (phase > limit) {
      phase = phase - limit;
      if (quantizeF32) {
        phase = f32(phase);
      }
    }
  } else {
    limit = quantizeF32 ? f32(15.0) : 15.0;
    if (phase > limit) {
      while (phase > limit) {
        phase = phase - limit;
        if (quantizeF32) {
          phase = f32(phase);
        }
      }
    }
  }

  return [phase, step];
}

export function creatureAnimSelectFrame(phase: number, opts: { baseFrame: number; mirrorLong: boolean; flags?: number }): [number, boolean, string] {
  // Select an 8x8 atlas frame index (creature_render_type).
  //
  // Returns (frame_index, mirror_applied, mode).
  //
  // Note: mirror_applied refers to the long-strip ping-pong index mirroring
  // (frame = 0x1f - frame) when the per-type mirror flag is set, not a texture flip.
  const baseFrame = opts.baseFrame;
  const mirrorLong = opts.mirrorLong;
  const flags = opts.flags ?? 0;
  const flagsBits = int(flags);
  const isLongStrip = (flagsBits & _FLAG_ANIM_PING_PONG) === 0 || (flagsBits & _FLAG_ANIM_LONG_STRIP) !== 0;
  if (isLongStrip) {
    let frame: number;
    let mirrored: boolean;
    if (phase < 0.0) {
      // Negative anim_phase is used as a special render state in the game; keep the
      // same fallback frame selection.
      frame = baseFrame + 0x0F;
      mirrored = false;
    } else {
      // Matches __ftol(phase + 0.5f) used by the original binary.
      frame = int(phase + 0.5);
      mirrored = false;
      if (mirrorLong && frame > 0x0F) {
        frame = 0x1F - frame;
        mirrored = true;
      }
    }
    if ((flagsBits & _FLAG_RANGED_ATTACK_SHOCK) !== 0) {
      frame += 0x20;
    }
    return [frame, mirrored, 'long'];
  }

  // Ping-pong strip:
  //   idx = (__ftol(phase + 0.5f) & 0x8000000f); then normalize negatives; then mirror >7.
  const raw = int(phase + 0.5);
  let idx = i32(u32(raw) & 0x8000000F);
  if (idx < 0) {
    idx = i32(u32(((idx - 1) | 0xFFFFFFF0) + 1));
  }
  if (idx > 7) {
    idx = 0x0F - idx;
  }
  let frame = baseFrame + 0x10 + idx;
  return [frame, false, 'ping-pong'];
}

const _CREATURE_CORPSE_FRAMES: Map<number, number> = new Map([
  [0, 0], // zombie
  [1, 3], // lizard
  [2, 4], // alien
  [3, 1], // spider sp1
  [4, 2], // spider sp2
  [5, 7], // trooper
  [7, 6], // ping-pong strip corpse fallback
]);
