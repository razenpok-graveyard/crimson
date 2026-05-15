// Port of grim/math.py

export function clamp(value: number, low: number, high: number): number {
  if (value < low) {
    return low;
  }
  if (value > high) {
    return high;
  }
  return value;
}

export function clamp01(value: number): number {
  return clamp(value, 0.0, 1.0);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
