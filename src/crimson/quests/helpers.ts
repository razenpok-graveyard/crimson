// Port of crimson/quests/helpers.py

import { Vec2 } from '@grim/geom.ts';
import type { SpawnId } from '@crimson/creatures/spawn.ts';
import { SpawnEntry } from '@crimson/quests/types.ts';

export class EdgePoints {
  readonly left: Vec2;
  readonly right: Vec2;
  readonly top: Vec2;
  readonly bottom: Vec2;

  constructor(opts: {
    left: Vec2;
    right: Vec2;
    top: Vec2;
    bottom: Vec2;
  }) {
    this.left = opts.left;
    this.right = opts.right;
    this.top = opts.top;
    this.bottom = opts.bottom;
  }
}

export function centerPoint(width: number, height: number | null = null): Vec2 {
  if (height === null) {
    height = width;
  }
  return new Vec2(width * 0.5, height * 0.5);
}

export function edgeMidpoints(width: number, height: number | null = null, offset: number = 64.0): EdgePoints {
  if (height === null) {
    height = width;
  }
  const center = centerPoint(width, height);
  return new EdgePoints({ left: new Vec2(-offset, center.y), right: new Vec2(width + offset, center.y), top: new Vec2(center.x, -offset), bottom: new Vec2(center.x, height + offset) });
}

export function cornerPoints(width: number, height: number | null = null, offset: number = 64.0): Vec2[] {
  if (height === null) {
    height = width;
  }
  return [new Vec2(-offset, -offset), new Vec2(width + offset, -offset), new Vec2(-offset, height + offset), new Vec2(width + offset, height + offset)];
}

export function* iterAngles(count: number, opts: { step?: number | null; start?: number } = {}): IterableIterator<number> {
  let step = opts.step ?? null;
  const start = opts.start ?? 0.0;
  if (count <= 0) {
    return [][Symbol.iterator]();
  }
  if (step === null) {
    step = (Math.PI * 2.0) / count;
  }
  for (let idx = 0; idx < count; idx++) {
    yield start + idx * step;
  }
}

export function* ringPoints(center: Vec2, radius: number, count: number, opts: { step?: number | null; start?: number } = {}): IterableIterator<[Vec2, number]> {
  const step = opts.step ?? null;
  const start = opts.start ?? 0.0;
  for (const angle of iterAngles(count, { step: step, start: start })) {
    yield [center.add(Vec2.fromAngle(angle).mul(radius)), angle];
  }
}

export function* radialPoints(center: Vec2, angle: number, radiusStart: number, radiusEnd: number, radiusStep: number): IterableIterator<Vec2> {
  const direction = Vec2.fromAngle(angle);
  let radius = radiusStart;
  while (radius < radiusEnd) {
    yield center.add(direction.mul(radius));
    radius += radiusStep;
  }
}

export function headingFromCenter(point: Vec2, center: Vec2): number {
  return point.sub(center).toAngle() - (Math.PI / 2.0);
}

export function* linePoints(start: Vec2, step: Vec2, count: number): IterableIterator<Vec2> {
  for (let idx = 0; idx < count; idx++) {
    yield start.add(step.mul(idx));
  }
}

export function spawn(point: Vec2, opts: { heading?: number; spawnId: SpawnId; triggerMs: number; count: number }): SpawnEntry {
  const heading = opts.heading ?? 0.0;
  const spawnId = opts.spawnId;
  const triggerMs = opts.triggerMs;
  const count = opts.count;
  return new SpawnEntry({ pos: point, heading: heading, spawnId: spawnId, triggerMs: triggerMs, count: count });
}

export function spawnAt(point: Vec2, opts: { heading?: number; spawnId: SpawnId; triggerMs: number; count: number }): SpawnEntry {
  const heading = opts.heading ?? 0.0;
  const spawnId = opts.spawnId;
  const triggerMs = opts.triggerMs;
  const count = opts.count;
  return spawn(point, { heading: heading, spawnId: spawnId, triggerMs: triggerMs, count: count });
}
