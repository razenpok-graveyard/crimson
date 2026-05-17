// Port of crimson/sim/world_defs.py

import { CreatureTypeId } from '@crimson/creatures/spawn.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';

export class CreatureAnimInfo {
  readonly base: number;
  readonly animRate: number;
  readonly mirror: boolean;

  constructor(opts: {
    base: number;
    animRate: number;
    mirror: boolean;
  }) {
    this.base = opts.base;
    this.animRate = opts.animRate;
    this.mirror = opts.mirror;
  }
}

export const CREATURE_ANIM: Map<CreatureTypeId, CreatureAnimInfo> = new Map([
  [CreatureTypeId.ZOMBIE, new CreatureAnimInfo({ base: 0x20, animRate: 1.2, mirror: false })],
  [CreatureTypeId.LIZARD, new CreatureAnimInfo({ base: 0x10, animRate: 1.6, mirror: true })],
  [CreatureTypeId.ALIEN, new CreatureAnimInfo({ base: 0x20, animRate: 1.35, mirror: false })],
  [CreatureTypeId.SPIDER_SP1, new CreatureAnimInfo({ base: 0x10, animRate: 1.5, mirror: true })],
  [CreatureTypeId.SPIDER_SP2, new CreatureAnimInfo({ base: 0x10, animRate: 1.5, mirror: true })],
  [CreatureTypeId.TROOPER, new CreatureAnimInfo({ base: 0x00, animRate: 1.0, mirror: false })],
]);
export const CREATURE_ASSET: Map<CreatureTypeId, string> = new Map([
  [CreatureTypeId.ZOMBIE, 'zombie'],
  [CreatureTypeId.LIZARD, 'lizard'],
  [CreatureTypeId.ALIEN, 'alien'],
  [CreatureTypeId.SPIDER_SP1, 'spider_sp1'],
  [CreatureTypeId.SPIDER_SP2, 'spider_sp2'],
  [CreatureTypeId.TROOPER, 'trooper'],
]);
export const KNOWN_PROJ_FRAMES: Map<number, [number, number]> = new Map([
  // Based on docs/atlas.md (projectile `type_id` values index the weapon table).
  [ProjectileTemplateId.PULSE_GUN, [2, 0]],
  [ProjectileTemplateId.SPLITTER_GUN, [4, 3]],
  [ProjectileTemplateId.BLADE_GUN, [4, 6]],
  [ProjectileTemplateId.ION_MINIGUN, [4, 2]],
  [ProjectileTemplateId.ION_CANNON, [4, 2]],
  [ProjectileTemplateId.SHRINKIFIER, [4, 2]],
  [ProjectileTemplateId.FIRE_BULLETS, [4, 2]],
  [ProjectileTemplateId.ION_RIFLE, [4, 2]],
]);
export const PLASMA_PARTICLE_TYPES: ReadonlySet<ProjectileTemplateId> = new Set([
  ProjectileTemplateId.PLASMA_RIFLE,
  ProjectileTemplateId.PLASMA_MINIGUN,
  ProjectileTemplateId.PLASMA_CANNON,
  ProjectileTemplateId.SPIDER_PLASMA,
  ProjectileTemplateId.SHRINKIFIER,
]);
export const ION_TYPES: ReadonlySet<ProjectileTemplateId> = new Set([
  ProjectileTemplateId.ION_RIFLE,
  ProjectileTemplateId.ION_MINIGUN,
  ProjectileTemplateId.ION_CANNON,
]);
export const FIRE_BULLETS_TYPES: ReadonlySet<ProjectileTemplateId> = new Set([
  ProjectileTemplateId.FIRE_BULLETS,
]);
// "Beam" in the original renderer is really the Ion/Fire streak + chain UV family.
export const BEAM_TYPES: ReadonlySet<number> = new Set([
  ...ION_TYPES,
  ...FIRE_BULLETS_TYPES,
]);
