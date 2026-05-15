// Port of crimson/wire/float32_wire.py

import { f32 } from '@crimson/math-parity.ts';

function fieldLabel(field: string | null): string {
  if (field && field.trim()) {
    return field;
  }
  return 'value';
}

export function wireF32(value: number, opts: { field?: string | null } = {}): number {
  const field = opts.field ?? null;
  const label = fieldLabel(field);
  const narrowed = f32(value);
  if (!Number.isFinite(narrowed)) {
    throw new Error(`${label} must be finite`);
  }
  return narrowed;
}

export function wireF32Opt(value: number | null, opts: { field?: string | null } = {}): number | null {
  const field = opts.field ?? null;
  if (value === null) {
    return null;
  }
  return wireF32(value, { field: field });
}

export function assertWireF32(value: number, opts: { field?: string | null } = {}): number {
  const field = opts.field ?? null;
  const label = fieldLabel(field);
  const candidate = value;
  if (!Number.isFinite(candidate)) {
    throw new Error(`${label} must be finite`);
  }
  const narrowed = f32(candidate);
  if (candidate !== narrowed) {
    throw new Error(`${label} must be f32-canonical`);
  }
  return candidate;
}
