// Port of grim/geom.py

import { clamp } from '@grim/math.ts';
import { rl } from '@grim/raylib-api.ts';
import * as wgl from '@wgl';

export interface SupportsXY {
  x: number;
  y: number;
}

function pyRound(value: number, ndigits = 0): number {
  const factor = 10 ** ndigits;
  const scaled = value * factor;
  const floorValue = Math.floor(scaled);
  const frac = scaled - floorValue;
  if (frac < 0.5) {
    return floorValue / factor;
  }
  if (frac > 0.5) {
    return (floorValue + 1) / factor;
  }
  return (floorValue % 2 === 0 ? floorValue : floorValue + 1) / factor;
}

export class Vec2 {
  readonly x: number;
  readonly y: number;

  constructor(opts?: { x?: number; y?: number });
  constructor(x?: number, y?: number);
  constructor(optsOrX: { x?: number; y?: number } | number = {}, y: number = 0.0) {
    if (typeof optsOrX === 'object' && optsOrX !== null) {
      this.x = optsOrX.x ?? 0.0;
      this.y = optsOrX.y ?? 0.0;
      return;
    }
    this.x = optsOrX ?? 0.0;
    this.y = y;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  add(other: Vec2): Vec2 {
    return new Vec2({ x: this.x + other.x, y: this.y + other.y });
  }

  sub(other: Vec2): Vec2 {
    return new Vec2({ x: this.x - other.x, y: this.y - other.y });
  }

  mul(scalar: number): Vec2 {
    return new Vec2({ x: this.x * scalar, y: this.y * scalar });
  }

  __rmul__(scalar: number): Vec2 {
    return this.mul(scalar);
  }

  div(scalar: number): Vec2 {
    return new Vec2({ x: this.x / scalar, y: this.y / scalar });
  }

  mulComponents(other: Vec2): Vec2 {
    return new Vec2({ x: this.x * other.x, y: this.y * other.y });
  }

  divComponents(other: Vec2): Vec2 {
    return new Vec2({ x: this.x / other.x, y: this.y / other.y });
  }

  avgComponent(): number {
    return (this.x + this.y) * 0.5;
  }

  normalized(): Vec2 {
    const magnitudeSq = this.lengthSq();
    if (magnitudeSq <= 0.0) {
      return new Vec2();
    }
    const invMagnitude = 1.0 / Math.sqrt(magnitudeSq);
    return new Vec2({ x: this.x * invMagnitude, y: this.y * invMagnitude });
  }

  normalizedWithLength(opts: { epsilon?: number } = {}): [Vec2, number] {
    const epsilon = opts.epsilon ?? 1e-6;
    const magnitude = this.length();
    if (magnitude <= epsilon) {
      return [new Vec2(), 0.0];
    }
    return [this.div(magnitude), magnitude];
  }

  distanceTo(other: Vec2): number {
    return other.sub(this).length();
  }

  directionTo(other: Vec2, opts: { epsilon?: number } = {}): Vec2 {
    const epsilon = opts.epsilon ?? 1e-6;
    const [direction, ] = other.sub(this).normalizedWithLength({ epsilon: epsilon });
    return direction;
  }

  static fromAngle(theta: number): Vec2 {
    return new Vec2({ x: Math.cos(theta), y: Math.sin(theta) });
  }

  static fromPolar(theta: number, radius: number = 1.0): Vec2 {
    return Vec2.fromAngle(theta).mul(radius);
  }

  static fromXY(value: SupportsXY): Vec2 {
    return new Vec2({ x: value.x, y: value.y });
  }

  static fromHeading(heading: number): Vec2 {
    return Vec2.fromAngle(heading - Math.PI / 2.0);
  }

  toAngle(): number {
    return Math.atan2(this.y, this.x);
  }

  toHeading(): number {
    return this.toAngle() + Math.PI / 2.0;
  }

  toPolar(): [number, number] {
    return [this.toAngle(), this.length()];
  }

  offset(opts: { dx?: number; dy?: number } = {}): Vec2 {
    const dx = opts.dx ?? 0.0;
    const dy = opts.dy ?? 0.0;
    return new Vec2({ x: this.x + dx, y: this.y + dy });
  }

  perpLeft(): Vec2 {
    return new Vec2({ x: -this.y, y: this.x });
  }

  perpRight(): Vec2 {
    return new Vec2({ x: this.y, y: -this.x });
  }

  toRl(): wgl.Vector2 {

    return rl.makeVector2(this.x, this.y);
  }

  toDict(opts: { ndigits?: number | null } = {}): Map<string, number> {
    const ndigits = opts.ndigits ?? null;
    if (ndigits === null) {
      return new Map(Object.entries({ 'x': this.x, 'y': this.y }));
    }
    return new Map(Object.entries({ 'x': pyRound(this.x, ndigits), 'y': pyRound(this.y, ndigits) }));
  }

  rotated(theta: number): Vec2 {
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    return new Vec2({ x: this.x * cosTheta - this.y * sinTheta, y: this.x * sinTheta + this.y * cosTheta });
  }

  clampRect(minX: number, minY: number, maxX: number, maxY: number): Vec2 {
    return new Vec2({ x: clamp(this.x, minX, maxX), y: clamp(this.y, minY, maxY) });
  }

  static distanceSq(a: Vec2, b: Vec2): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy;
  }

  static lerp(a: Vec2, b: Vec2, t: number): Vec2 {
    return new Vec2({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
}

export class Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;

  constructor(opts: {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  } = {}) {
    this.x = opts.x ?? 0.0;
    this.y = opts.y ?? 0.0;
    this.w = opts.w ?? 0.0;
    this.h = opts.h ?? 0.0;
  }

  static fromXywh(value: Rect | wgl.Rectangle): Rect {
    return new Rect({ x: value.x, y: value.y, w: value.w, h: value.h });
  }

  static fromTopLeft(topLeft: SupportsXY, width: number, height: number): Rect {
    return new Rect({ x: topLeft.x, y: topLeft.y, w: width, h: height });
  }

  static fromPosSize(pos: Vec2, size: Vec2): Rect {
    return new Rect({ x: pos.x, y: pos.y, w: size.x, h: size.y });
  }

  get left(): number {
    return this.x;
  }

  get top(): number {
    return this.y;
  }

  get topLeft(): Vec2 {
    return new Vec2({ x: this.x, y: this.y });
  }

  get topRight(): Vec2 {
    return new Vec2({ x: this.right, y: this.y });
  }

  get bottomLeft(): Vec2 {
    return new Vec2({ x: this.x, y: this.bottom });
  }

  get bottomRight(): Vec2 {
    return new Vec2({ x: this.right, y: this.bottom });
  }

  get size(): Vec2 {
    return new Vec2({ x: this.w, y: this.h });
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  get right(): number {
    return this.x + this.w;
  }

  get bottom(): number {
    return this.y + this.h;
  }

  get center(): Vec2 {
    return new Vec2({ x: this.x + this.w * 0.5, y: this.y + this.h * 0.5 });
  }

  static fromCenter(center: SupportsXY, width: number, height: number): Rect {
    return new Rect({ x: center.x - width * 0.5, y: center.y - height * 0.5, w: width, h: height });
  }

  offset(opts: { dx?: number; dy?: number } = {}): Rect {
    const dx = opts.dx ?? 0.0;
    const dy = opts.dy ?? 0.0;
    return new Rect({ x: this.x + dx, y: this.y + dy, w: this.w, h: this.h });
  }

  inset(opts: { dx?: number; dy?: number } = {}): Rect {
    const dx = opts.dx ?? 0.0;
    const dy = opts.dy ?? 0.0;
    return new Rect({ x: this.x + dx, y: this.y + dy, w: Math.max(0.0, this.w - 2.0 * dx), h: Math.max(0.0, this.h - 2.0 * dy) });
  }

  contains(point: SupportsXY): boolean {
    const px = point.x;
    const py = point.y;
    return this.x <= px && px <= this.right && this.y <= py && py <= this.bottom;
  }

  toRl(): wgl.Rectangle {

    return rl.makeRectangle(this.x, this.y, this.w, this.h);
  }
}
