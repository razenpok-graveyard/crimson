// Port of crimson/weapon_runtime/__init__.py

export { initDefaultAltWeapon, mostUsedWeaponIdForPlayer, playerStartReload, playerSwapAltWeapon, weaponAssignPlayer, weaponEntry } from './assign.ts';
export { prepareWeaponAvailability, weaponPickRandomAvailable } from './availability.ts';
export { WeaponFireCtx, WeaponFireResult, fireWeapon } from './fire.ts';
export { ownerRefForPlayer, ownerRefForPlayerProjectiles, projectileSpawn, spawnProjectileRing, travelBudgetForTypeId } from './spawn.ts';
