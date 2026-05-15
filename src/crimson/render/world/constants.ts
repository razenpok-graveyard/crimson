// Port of crimson/render/world/constants.py

import { clamp } from '@grim/math.ts';

export const RAD_TO_DEG = 57.29577951308232;

export function monsterVisionFadeAlpha(lifecycleStage: number): number {
  if (lifecycleStage >= 0.0) {
    return 1.0;
  }
  return clamp((lifecycleStage + 10.0) * 0.1, 0.0, 1.0);
}
