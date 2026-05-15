// Port of crimson/math_parity.py

// Float/trig helpers for native movement math parity.

import { Vec2 } from '@grim/geom.ts';

const _f32buf = new Float32Array(1);
const _u32buf = new Uint32Array(_f32buf.buffer);

function f32FromBits(bits: number): number {
  return (() => { _u32buf[0] = (int(bits) >>> 0); return _f32buf[0]; })();
}

export function f32(value: number): number {
  return (() => { _f32buf[0] = value; return _f32buf[0]; })();
}

export function f32Vec2(value: Vec2): Vec2 {
  return new Vec2(f32(value.x), f32(value.y));
}

function sinF32(radians: number): number {
  return f32(Math.sin(radians));
}

function cosF32(radians: number): number {
  return f32(Math.cos(radians));
}

export function atan2F32(y: number, x: number): number {
  return f32(Math.atan2(y, x));
}

export function headingFromDeltaF32(opts: { dx: number; dy: number }): number {
  const dx = opts.dx;
  const dy = opts.dy;
  const heading = f32(Math.atan2(dy, dx) + NATIVE_HALF_PI);
  // `fpatan` boundary case: native can encode left-axis headings as `-pi/2`
  // (instead of `3pi/2`) and that representation feeds branchy angle_approach
  // decisions. Treat near-axis, near-horizontal vectors as the negative branch
  // to match native tie-break behavior around signed-zero boundaries.
  if (dx < 0.0 && Math.abs(heading - _NATIVE_LEFT_AXIS_HEADING_POS) <= _NATIVE_LEFT_AXIS_HEADING_EPS && Math.abs(dy) <= _NATIVE_LEFT_AXIS_DY_EPS) {
    return f32(heading - NATIVE_TAU);
  }
  return heading;
}

export function headingAddPiF32(heading: number): number {
  return f32(heading + NATIVE_PI);
}

export function headingToDirectionF32(heading: number): Vec2 {
  const radians = f32(heading) - NATIVE_HALF_PI;
  return new Vec2(cosF32(radians), sinF32(radians));
}

// Native movement/heading code uses these exact float32 literals.
export const NATIVE_PI = f32FromBits(0x40490FDB);
export const NATIVE_HALF_PI = f32FromBits(0x3FC90FDB);
export const NATIVE_TAU = f32FromBits(0x40C90FDB);
export const NATIVE_TURN_RATE_SCALE = f32FromBits(0x3FAAAAAB);
const _NATIVE_LEFT_AXIS_HEADING_POS = f32(NATIVE_TAU - NATIVE_HALF_PI);
const _NATIVE_LEFT_AXIS_HEADING_EPS = 1e-6;
const _NATIVE_LEFT_AXIS_DY_EPS = 5e-4;
