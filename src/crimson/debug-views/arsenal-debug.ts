// Port of crimson/debug_views/arsenal_debug.py

import { TextureId } from '@grim/assets.ts';
import type { AudioState } from '@grim/audio.ts';
import { shutdownAudio, updateAudio } from '@grim/audio.ts';
import type { ConsoleState } from '@grim/console.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { loadSmallFont } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { Crand } from '@grim/rand.ts';
import type { rl } from '@grim/raylib-api.ts';
import { InputState } from '@grim/input.ts';
import type { View, ViewContext } from '@grim/view.ts';
import { BONUS_TABLE, BonusId } from '@crimson/bonuses/index.ts';
import { SpawnId } from '@crimson/creatures/spawn.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { ProjectileTemplateId } from '@crimson/projectiles/types.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import type { FrameContext } from '@crimson/sim/input-providers.ts';
import { initViewAudio } from '@crimson/tooling/audio-bootstrap.ts';
import { drawAimCursor } from '@crimson/ui/cursor.ts';
import { weaponAssignPlayer } from '@crimson/weapon-runtime/index.ts';
import { MultiPlasmaFanMode, ParticleStreamMode, PrimaryPelletsMode, SecondaryShotMode, SwarmerDumpMode, resolveFireRecipe } from '@crimson/weapon-runtime/fire-recipes.ts';
import { WEAPON_BY_ID, WEAPON_TABLE, WeaponId, projectileTypeIdForWeaponId } from '@crimson/weapons.ts';
import { WorldRuntime } from '@crimson/world/index.ts';
import { StandaloneTickHarness } from '@crimson/world/standalone-tick-harness.ts';
import { drawUiText, uiLineHeight } from '@crimson/debug-views/ui-helpers.ts';
import { registerView } from '@crimson/debug-views/registry.ts';
import * as wgl from '@wgl';

export const WORLD_SIZE = 1024.0;
export const BG = wgl.makeColor(10 / 255, 10 / 255, 12 / 255, 255 / 255);
export const UI_TEXT = wgl.makeColor(235 / 255, 235 / 255, 235 / 255, 255 / 255);
export const UI_HINT = wgl.makeColor(180 / 255, 180 / 255, 180 / 255, 255 / 255);
export const UI_ERROR = wgl.makeColor(240 / 255, 80 / 255, 80 / 255, 255 / 255);
export const ARSENAL_PLAYER_MOVE_SPEED_MULTIPLIER = 6.0;
export const ARSENAL_PLAYER_INVULNERABLE_SHIELD_TIMER = 1e-3;
export const ARSENAL_BONUS_RING_RADIUS = 140.0;
export const DEFAULT_SPAWN_IDS = [
  SpawnId.ZOMBIE_CONST_GREY_42,
  SpawnId.ZOMBIE_CONST_GREEN_BRUTE_43,
  SpawnId.LIZARD_CONST_GREY_2F,
  SpawnId.LIZARD_CONST_YELLOW_BOSS_30,
  SpawnId.ALIEN_CONST_GREEN_24,
  SpawnId.ALIEN_CONST_GREY_BRUTE_29,
  SpawnId.ALIEN_CONST_RED_FAST_2B,
  SpawnId.SPIDER_SP1_CONST_BLUE_40,
  SpawnId.SPIDER_SP1_CONST_WHITE_FAST_3E,
  SpawnId.SPIDER_SP2_RANDOM_35,
];

function mapGetOrThrow<K, V>(map: ReadonlyMap<K, V>, key: unknown): V {
  const typedKey = key as K;
  if (!map.has(typedKey)) {
    throw new Error(`missing map key: ${String(key)}`);
  }
  return map.get(typedKey) as V;
}

function pythonCompareKeys(left: any, right: any): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const item = pythonCompareKeys(left[index], right[index]);
      if (item !== 0) {
        return item;
      }
    }
    return left.length - right.length;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

export class ArsenalDebugView {
  protected _assetsRoot: string;
  protected _missingAssets: string[];
  protected _small: SmallFontData | null;
  protected _audioRng: Crand;
  protected _runtime: WorldRuntime;
  protected _player: any;
  protected _aimTexture: rl.Texture | null;
  protected _audio: AudioState | null;
  protected _console: ConsoleState | null;
  protected _weaponIds: number[];
  protected _weaponIndex: number;
  protected _spawnIds: any[];
  protected _spawnRingRadius: number;
  closeRequested: boolean;
  protected _paused: boolean;
  protected _screenshotRequested: boolean;
  protected _tickHarness: StandaloneTickHarness;

  get assetsRoot(): string {
    return this._assetsRoot;
  }
  get missingAssets(): string[] {
    return this._missingAssets;
  }
  get small(): SmallFontData | null {
    return this._small;
  }
  get audioRng(): Crand {
    return this._audioRng;
  }
  get runtime(): WorldRuntime {
    return this._runtime;
  }
  get player(): any {
    return this._player;
  }
  get aimTexture(): rl.Texture | null {
    return this._aimTexture;
  }
  get audio(): AudioState | null {
    return this._audio;
  }
  get console(): ConsoleState | null {
    return this._console;
  }
  get weaponIds(): number[] {
    return this._weaponIds;
  }
  get weaponIndex(): number {
    return this._weaponIndex;
  }
  get spawnIds(): any[] {
    return this._spawnIds;
  }
  get spawnRingRadius(): number {
    return this._spawnRingRadius;
  }
  get paused(): boolean {
    return this._paused;
  }
  get screenshotRequested(): boolean {
    return this._screenshotRequested;
  }
  get tickHarness(): StandaloneTickHarness {
    return this._tickHarness;
  }

  constructor(ctx: ViewContext) {
    this._assetsRoot = ctx.assetsDir;
    this._missingAssets = [];
    this._small = null;
    this._audioRng = new Crand(0xBEEF);

    this._runtime = new WorldRuntime({ assetsDir: ctx.assetsDir, worldSize: WORLD_SIZE, preserveBugs: ctx.preserveBugs, audioRng: this._audioRng });
    this._runtime.reset({ playerCount: 1 });

    this._player = this._runtime.simWorld.players ? this._runtime.simWorld.players[0] : null;
    this._aimTexture = null;
    this._audio = null;
    this._console = null;

    this._weaponIds = Array.from(new Set(Array.from(WEAPON_TABLE).map((entry) => int(entry.weaponId)))).sort((left, right) => pythonCompareKeys(left, right));
    this._weaponIndex = 0;
    this._spawnIds = Array.from(DEFAULT_SPAWN_IDS);
    this._spawnRingRadius = 280.0;

    this.closeRequested = false;
    this._paused = false;
    this._screenshotRequested = false;
    this._tickHarness = new StandaloneTickHarness({ gameMode: GameMode.SURVIVAL, buildInputs: this._buildRunnerInputs.bind(this) });
  }

  protected _loadTexture(textureId: TextureId): rl.Texture {
    return this._runtime.renderResources.resources.texture(textureId);
  }

  protected _drawWorld(opts: { drawAimIndicators?: boolean; entityAlpha?: number } = {}): void {
    const drawAimIndicators = opts.drawAimIndicators ?? true;
    const entityAlpha = opts.entityAlpha ?? 1.0;
    this._runtime.renderer.draw({
      renderFrame: this._runtime.buildRenderFrame(),
      drawAimIndicators: drawAimIndicators,
      entityAlpha: entityAlpha,
    });
  }

  worldToScreen(pos: Vec2): Vec2 {
    return this._runtime.renderer.worldToScreen(pos);
  }

  screenToWorld(pos: Vec2): Vec2 {
    return this._runtime.renderer.screenToWorld(pos);
  }

  protected _applyDebugPlayerCheats(): void {
    const player = this._player;
    if (player === null) {
      return;
    }
    player.speedMultiplier = ARSENAL_PLAYER_MOVE_SPEED_MULTIPLIER;
    player.shieldTimer = ARSENAL_PLAYER_INVULNERABLE_SHIELD_TIMER;
  }

  protected _selectedWeaponId(): WeaponId {
    if (this._weaponIds.length === 0) {
      return WeaponId.NONE;
    }
    return this._weaponIds[this._weaponIndex % this._weaponIds.length];
  }

  protected _applyWeapon(): void {
    if (this._player === null) {
      return;
    }
    weaponAssignPlayer(this._player, this._selectedWeaponId(), { state: this._runtime.simWorld.state });
  }

  protected _resetScene(): void {
    this._runtime.reset({ seed: 0xBEEF, playerCount: 1, spawnPos: new Vec2(WORLD_SIZE * 0.5, WORLD_SIZE * 0.5) });
    this._resetTickRunner();
    this._player = this._runtime.simWorld.players ? this._runtime.simWorld.players[0] : null;
    this._applyWeapon();
    this._resetCreatures();
    this._runtime.updateCamera(0.0);
  }

  protected _resetCreatures(): void {
    this._runtime.simWorld.creatures.reset();
    this._runtime.simWorld.state.projectiles.reset();
    this._runtime.simWorld.state.secondaryProjectiles.reset();
    this._runtime.simWorld.state.particles.reset();
    this._runtime.simWorld.state.spriteEffects.reset();
    this._runtime.simWorld.state.effects.reset();
    this._runtime.simWorld.state.bonusPool.reset();
    this._runtime.renderResources.clearPendingTerrainFx();

    const player = this._player;
    if (player === null) {
      return;
    }

    const count = Math.max(1, this._spawnIds.length);
    const playerPos = player.pos;
    for (let idx = 0; idx < count; idx++) {
      const spawnId = this._spawnIds[idx % this._spawnIds.length];
      const angle = idx / count * (Math.PI * 2.0);
      const spawnPos = playerPos.add(Vec2.fromAngle(angle).mul(this._spawnRingRadius)).clampRect(48.0, 48.0, WORLD_SIZE - 48.0, WORLD_SIZE - 48.0);
      const heading = angle + Math.PI;
      this._runtime.simWorld.creatures.spawnTemplate(spawnId, spawnPos, heading, this._runtime.simWorld.state.rng);
    }
  }

  protected _spawnAllBonuses(): void {
    const player = this._player;
    if (player === null) {
      return;
    }

    const bonusPool = this._runtime.simWorld.state.bonusPool;
    bonusPool.reset();

    const bonusIds = Array.from(BONUS_TABLE).filter((entry) => entry.bonusId !== BonusId.UNUSED).map((entry) => entry.bonusId);
    const count = Math.max(1, bonusIds.length);

    const playerPos = player.pos;
    const rng = this._runtime.simWorld.state.rng.rand;
    const currentWeaponId = player.weapon.weaponId;

    for (const [idx, bonusId] of bonusIds.entries()) {
      const angle = idx / count * (Math.PI * 2.0);
      const pos = playerPos.add(Vec2.fromAngle(angle).mul(ARSENAL_BONUS_RING_RADIUS));

      let amountOverride = -1;
      let weaponId: number;
      if (bonusId === BonusId.WEAPON && this._weaponIds.length > 0) {
        weaponId = int(currentWeaponId);
        for (let i = 0; i < 8; i++) {
          weaponId = int(this._weaponIds[int(rng()) % this._weaponIds.length]);
          if (weaponId !== currentWeaponId) {
            break;
          }
        }
        amountOverride = int(weaponId);
      }

      bonusPool.spawnAt(pos, bonusId, int(amountOverride), { state: this._runtime.simWorld.state, worldWidth: WORLD_SIZE, worldHeight: WORLD_SIZE });
    }
  }

  protected _handleDebugInput(): void {
    if (InputState.wasKeyPressed(27)) {
      this.closeRequested = true;
    }

    if (InputState.wasKeyPressed(32)) {
      this._paused = !this._paused;
    }

    if (InputState.wasKeyPressed(219)) {
      this._weaponIndex = ((this._weaponIndex - 1) + Math.max(1, this._weaponIds.length)) % Math.max(1, this._weaponIds.length);
      this._applyWeapon();
    }
    if (InputState.wasKeyPressed(221)) {
      this._weaponIndex = ((this._weaponIndex + 1) + Math.max(1, this._weaponIds.length)) % Math.max(1, this._weaponIds.length);
      this._applyWeapon();
    }

    if (InputState.wasKeyPressed(84)) {
      this._resetCreatures();
    }

    if (InputState.wasKeyPressed(66)) {
      this._spawnAllBonuses();
    }

    if (InputState.wasKeyPressed(8)) {
      this._resetScene();
    }

    if (InputState.wasKeyPressed(80)) {
      this._screenshotRequested = true;
    }
  }

  protected _buildInput(): PlayerInput {
    const move = new Vec2(((InputState.isKeyDown(68) ? 1 : 0)) - ((InputState.isKeyDown(65) ? 1 : 0)), ((InputState.isKeyDown(83) ? 1 : 0)) - ((InputState.isKeyDown(87) ? 1 : 0)));

    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const aim = this.screenToWorld(Vec2.fromXY(mouse));

    const fireDown = InputState.isMouseButtonDown(0);
    const firePressed = InputState.wasMouseButtonPressed(0);
    const reloadPressed = InputState.wasKeyPressed(82);

    return new PlayerInput({ move: move, aim: aim, fireDown: fireDown, firePressed: firePressed, reloadPressed: reloadPressed });
  }

  protected _buildRunnerInputs(frameCtx: FrameContext): PlayerInput[] {
    const _ = frameCtx;
    return [this._buildInput()];
  }

  protected _resetTickRunner(): void {
    this._tickHarness.reset();
  }

  protected _weaponProjectileDesc(weaponId: WeaponId): string {
    const weapon = mapGetOrThrow(WEAPON_BY_ID, weaponId);
    const recipe = resolveFireRecipe(weaponId, { pelletCount: int(weapon.pelletCount), fireBulletsActive: false });
    if (recipe === null) {
      return 'unsupported/unmapped';
    }
    if (recipe.mode instanceof PrimaryPelletsMode) {
      const typeId = recipe.mode.typeId;
      if (typeId === null) {
        return 'unsupported/unmapped';
      }
      return projectileTypeLabel(int(typeId));
    } else if (recipe.mode instanceof SecondaryShotMode) {
      const typeId = recipe.mode.typeId;
      return `secondary type ${int(typeId)}`;
    } else if (recipe.mode instanceof ParticleStreamMode) {
      const style = recipe.mode.style;
      const slow = recipe.mode.slow;
      if (style === null) {
        return slow ? 'slow particle stream' : 'particle stream';
      }
      return `particle style ${int(style)}`;
    } else if (recipe.mode instanceof MultiPlasmaFanMode) {
      return 'plasma fan';
    } else if (recipe.mode instanceof SwarmerDumpMode) {
      return 'secondary swarm dump';
    }
    let typeId: ReturnType<typeof projectileTypeIdForWeaponId>;
    try {
      typeId = projectileTypeIdForWeaponId(weaponId);
    } catch (exc) {
      return 'unsupported/unmapped';
    }
    return projectileTypeLabel(int(typeId));
  }

  protected _weaponDebugLines(): string[] {
    const player = this._player;
    if (player === null) {
      return ['Arsenal debug: missing player'];
    }

    const weapon = mapGetOrThrow(WEAPON_BY_ID, player.weapon.weaponId);
    const weaponId = player.weapon.weaponId;
    const name = weapon.name;
    const indexLabel = `${this._weaponIndex + 1}/${Math.max(1, this._weaponIds.length)}`;

    const lines = ['Arsenal', `${name} (id ${weaponId})  [${indexLabel}]`, `projectile: ${this._weaponProjectileDesc(weaponId)}`, `ammo ${player.weapon.ammo.toFixed(1)}/${player.weapon.clipSize.toFixed(1)}  reload ${player.weapon.reloadTimer.toFixed(2)}/${player.weapon.reloadTimerMax.toFixed(2)}`, `shot_cd ${player.weapon.shotCooldown.toFixed(3)}  spread ${player.spreadHeat.toFixed(3)}  muzzle ${player.muzzleFlashAlpha.toFixed(2)}`];

    lines.push(...[`clip ${fmtInt(weapon.clipSize)}  reload ${fmtFloat(weapon.reloadTime)}  cooldown ${fmtFloat(weapon.shotCooldown)}`, `pellets ${fmtInt(weapon.pelletCount)}  spreadInc ${fmtFloat(weapon.spreadHeatInc)}  dmgScale ${fmtFloat(weapon.damageScale)}  meta ${fmtInt(weapon.travelBudget)}`, `ammoClass ${fmtInt(weapon.ammoClass)}  flags ${fmtHex(weapon.flags)}  icon ${fmtInt(weapon.iconIndex)}`, `sfx fire ${weapon.fireSound}  reload ${weapon.reloadSound}`]);
    return lines;
  }

  async open(): Promise<void> {
    this._missingAssets.length = 0;
    const bootstrap = await initViewAudio(this._assetsRoot);
    this._runtime.config = bootstrap.config;
    this._console = bootstrap.console;
    this._audio = bootstrap.audio;
    this._audioRng = bootstrap.audioRng;
    this._runtime.audio = this._audio;
    this._runtime.audioRng = this._audioRng;
    this._runtime.syncAudioBridgeState();

    this._small = loadSmallFont(this._assetsRoot);

    this._runtime.openRuntime();
    this._aimTexture = this._loadTexture(TextureId.UI_AIM);
    this._resetScene();
  }

  close(): void {
    this._resetTickRunner();
    if (this._small !== null) {
      this._small = null;
    }
    if (this._audio !== null) {
      shutdownAudio(this._audio);
      this._audio = null;
      this._console = null;
    }
    this._runtime.audio = null;
    this._runtime.audioRng = this._audioRng;
    this._runtime.syncAudioBridgeState();
    this._runtime.closeRuntime();
    this._aimTexture = null;
  }

  consumeScreenshotRequest(): boolean {
    const requested = this._screenshotRequested;
    this._screenshotRequested = false;
    return requested;
  }

  update(dt: number): void {
    this._handleDebugInput();

    if (this._paused) {
      dt = 0.0;
    }

    const player = this._player;
    if (player === null) {
      return;
    }

    this._applyDebugPlayerCheats();
    this._tickHarness.advanceFrame(this._runtime, dt);

    if (this._audio !== null) {
      updateAudio(this._audio, dt);
    }
  }

  draw(): void {
    wgl.clearBackground(BG);

    if (this._runtime.renderResources.ground !== null) {
      this._runtime.renderResources.ground.processPending();
    }

    this._drawWorld({ drawAimIndicators: true });

    const warnX = 24.0;
    let warnY = 24.0;
    const warnLine = uiLineHeight(this._small);
    if (this._missingAssets.length > 0) {
      drawUiText(
        this._small,
        'Missing assets (ui): ' + this._missingAssets.join(", "),
        new Vec2(warnX, warnY),
        { color: UI_ERROR },
      );
      warnY += warnLine;
    }

    const x = 16.0;
    let y = 12.0;
    const line = uiLineHeight(this._small);

    for (const text of this._weaponDebugLines()) {
      drawUiText(this._small, text, new Vec2(x, y), { color: UI_TEXT });
      y += line;
    }

    if (this._player !== null) {
      const alive = this._runtime.simWorld.creatures.entries.filter((c) => c.active && c.hp > 0.0).reduce((total, c) => total + 1, 0);
      const total = this._runtime.simWorld.creatures.entries.filter((c) => c.active).reduce((total, c) => total + 1, 0);
      drawUiText(this._small, `creatures alive ${alive}/${total}`, new Vec2(x, y), { color: UI_TEXT });
      y += line;
    }

    y += 6.0;
    drawUiText(
      this._small,
      'WASD move  LMB fire  R reload  [/] cycle weapons  Space pause  T respawn  B spawn all bonuses  Backspace reset  Esc quit',
      new Vec2(x, y),
      { color: UI_HINT },
    );
    y += line;
    drawUiText(this._small, 'P screenshot', new Vec2(x, y), { color: UI_HINT });

    const resources = this._runtime.renderResources.resources;
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    drawAimCursor(resources.texture(TextureId.PARTICLES), this._aimTexture, { pos: Vec2.fromXY(mouse) });
  }
}

function fmtFloat(value: number | null, opts: { digits?: number } = {}): string {
  const digits = opts.digits ?? 3;
  if (value === null) {
    return '—';
  }
  return `${value.toFixed(digits)}`;
}

function fmtInt(value: number | null): string {
  if (value === null) {
    return '—';
  }
  return `${int(value)}`;
}

function fmtHex(value: number | null): string {
  if (value === null) {
    return '—';
  }
  value = int(value);
  return `0x${Math.trunc(value).toString(16).padStart(2, '0')} (${value})`;
}

function projectileTypeLabel(typeId: number): string {
  let name: string;
  try {
    name = String(ProjectileTemplateId[typeId]).toLowerCase().replaceAll('_', ' ');
  } catch (exc) {
    name = 'unknown';
  }
  return `${name} (id ${typeId})`;
}

export const buildArsenalDebugView = registerView('arsenal', 'Arsenal')(function buildArsenalDebugView(ctx: ViewContext): View {
  return new ArsenalDebugView(ctx);
});
