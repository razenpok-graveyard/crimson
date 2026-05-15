// Port of crimson/screens/panels/hit_test.py

import type { SupportsXY, Vec2 } from '@grim/geom.ts';

export function mouseInsideRectWithPadding(mouse: SupportsXY, opts: { pos: Vec2; width: number; height: number; leftPad?: number; topPad?: number }): boolean {
  const pos = opts.pos;
  const width = opts.width;
  const height = opts.height;
  const leftPad = opts.leftPad ?? 10.0;
  const topPad = opts.topPad ?? 2.0;
  // Port of `ui_mouse_inside_rect_with_padding` (0x00403430).

  const x = pos.x;
  const y = pos.y;
  return x - leftPad <= mouse.x && mouse.x <= x + width && y - topPad <= mouse.y && mouse.y <= y + height;
}
