// Port of crimson/typo/spawns.py

import { RGBA } from '@grim/color.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import { CreatureTypeId } from '@crimson/creatures/spawn.ts';

export class TypoSpawnCall {
  readonly pos: Vec2;
  readonly typeId: CreatureTypeId;
  readonly tintRgba: RGBA;

  constructor(opts: {
    pos: Vec2;
    typeId: CreatureTypeId;
    tintRgba: RGBA;
  }) {
    this.pos = opts.pos;
    this.typeId = opts.typeId;
    this.tintRgba = opts.tintRgba;
  }
}

export function tickTypoSpawns(opts: { elapsedMs: number; spawnCooldownMs: number; frameDtMs: number; playerCount: number; worldWidth: number; worldHeight: number }): [number, TypoSpawnCall[]] {
  let elapsedMs = opts.elapsedMs;
  const spawnCooldownMs = opts.spawnCooldownMs;
  const frameDtMs = opts.frameDtMs;
  let playerCount = opts.playerCount;
  const worldWidth = opts.worldWidth;
  const worldHeight = opts.worldHeight;
  elapsedMs = Math.trunc(elapsedMs);
  let cooldown = Math.trunc(spawnCooldownMs);
  const dtMs = Math.trunc(frameDtMs);
  playerCount = Math.max(1, Math.trunc(playerCount));

  cooldown -= dtMs * playerCount;

  const spawns: TypoSpawnCall[] = [];
  while (cooldown < 0) {
    cooldown += 3500 - Math.floor(elapsedMs / 800);
    cooldown = Math.max(100, cooldown);

    const t = elapsedMs * 0.001;
    const y = Math.cos(t) * 256.0 + worldHeight * 0.5;

    const tintT = elapsedMs + 1;
    const tintR = clamp(tintT * 0.0000083333334 + 0.3, 0.0, 1.0);
    const tintG = clamp(tintT * 10000.0 + 0.3, 0.0, 1.0);
    const tintB = clamp(Math.sin(tintT * 0.0001) + 0.3, 0.0, 1.0);
    const tint = new RGBA(tintR, tintG, tintB, 1.0);

    spawns.push(new TypoSpawnCall({ pos: new Vec2(worldWidth + 64.0, y), typeId: CreatureTypeId.SPIDER_SP2, tintRgba: tint }));
    spawns.push(new TypoSpawnCall({ pos: new Vec2(-64.0, y), typeId: CreatureTypeId.ALIEN, tintRgba: tint }));
  }

  return [cooldown, spawns];
}
