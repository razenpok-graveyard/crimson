// Port of crimson/modes/rush_mode.py

import { TextureId } from '@grim/assets.ts';
import type { AudioState } from '@grim/audio.ts';
import type { CrimsonConfig } from '@grim/config.ts';
import type { ConsoleState } from '@grim/console.ts';
import { Vec2 } from '@grim/geom.ts';
import type { Crand } from '@grim/rand.ts';
import { InputState } from '@grim/input.ts';
import type { ViewContext } from '@grim/view.ts';
import { debugEnabled } from '@crimson/debug.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { lanDebugLog } from '@crimson/net/debug-log.ts';
import type { ModeStateSnapshotV2 } from '@crimson/net/rollback-resync-v5.ts';
import { RushRuntimeSnapshotV2, RushStateSnapshotV2 } from '@crimson/net/rollback-resync-v5.ts';
import { GameStatusData } from '@crimson/persistence/save-status.ts';
import type { Replay } from '@crimson/replay/index.ts';
import { ReplayHeader, ReplayRecorder } from '@crimson/replay/index.ts';
import { DEFAULT_CHECKPOINT_SAMPLE_RATE } from '@crimson/replay/checkpoints.ts';
import { advanceUnlockTerrain } from '@crimson/sim/bootstrap.ts';
import { buildRushSession, enforceRushLoadout } from '@crimson/sim/session-builders.ts';
import type { DeterministicSession, DeterministicSessionTick } from '@crimson/sim/sessions.ts';
import { RushSpawnState } from '@crimson/sim/sessions.ts';
import { drawMenuCursor } from '@crimson/ui/cursor.ts';
import { HudRenderContext, drawHudOverlay, hudFlagsForGameMode } from '@crimson/ui/hud.ts';
import type { LanSession, LanStepAction } from '@crimson/modes/base-gameplay-mode.ts';
import { BaseGameplayMode } from '@crimson/modes/base-gameplay-mode.ts';
import { buildHighscoreRecordForGameOver } from '@crimson/modes/components/highscore-record-builder.ts';
import * as wgl from '@wgl';

export const WORLD_SIZE = 1024.0;
export const UI_TEXT_SCALE = 1.0;
export const UI_TEXT_COLOR = wgl.makeColor(220 / 255, 220 / 255, 220 / 255, 255 / 255);
export const UI_HINT_COLOR = wgl.makeColor(140 / 255, 140 / 255, 140 / 255, 255 / 255);
export const UI_ERROR_COLOR = wgl.makeColor(240 / 255, 80 / 255, 80 / 255, 255 / 255);

export class RushMode extends BaseGameplayMode {
  protected _spawnState: RushSpawnState;

  constructor(ctx: ViewContext, opts: { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand });
  constructor(opts: { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
  constructor(ctxOrOpts: ViewContext | { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean }, maybeOpts?: { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand }) {
    const ctx = maybeOpts === undefined ? { assetsDir: (ctxOrOpts as { assetsUrl?: string }).assetsUrl ?? '', preserveBugs: (ctxOrOpts as { preserveBugs?: boolean }).preserveBugs ?? false } as ViewContext : ctxOrOpts as ViewContext;
    const opts = maybeOpts ?? (ctxOrOpts as { config: CrimsonConfig; console?: ConsoleState | null; audio?: AudioState | null; audioRng: Crand } & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean });
    const config = opts.config;
    const console = opts.console ?? null;
    const audio = opts.audio ?? null;
    const audioRng = opts.audioRng;
    super({ assetsUrl: ctx.assetsDir, preserveBugs: ctx.preserveBugs, worldSize: WORLD_SIZE, defaultGameModeId: GameMode.RUSH, demoModeActive: false, questFailRetryCount: 0, hardcore: false, config: config, console: console, audio: audio, audioRng: audioRng });
    this._replayRecorder = null;
    this._spawnState = new RushSpawnState();
    this._simSession = this._newSimSession();
  }

  protected _newSimSession(): DeterministicSession {
    const [session, spawnState] = buildRushSession({ world: this.simWorld.worldState, worldSize: this.worldSize, damageScaleByType: this.simWorld.damageScaleByType, detailPreset: 5, violenceDisabled: 0, gameTuneStarted: Boolean(this.simWorld.gameTuneStarted), finalizePostRenderLifecycle: true });
    this._spawnState = spawnState;
    return session;
  }

  open(): void {
    super.open();
    this._resetGameplayFrameClock();
    this._resetLanCaptureClock();

    const status = this.state.status;
    const baseStatus = this.saveStatus;
    const simUnlockIndex = status !== null ? int(status.questUnlockIndex) : 0;
    const simUnlockIndexFull = status !== null ? int(status.questUnlockIndexFull) : 0;
    const statusUnlockIndex = baseStatus !== null ? int(baseStatus.questUnlockIndex) : int(simUnlockIndex);
    const statusUnlockIndexFull = baseStatus !== null ? int(baseStatus.questUnlockIndexFull) : int(simUnlockIndexFull);
    const questUnlockIndex = int(simUnlockIndex);
    const terrain = advanceUnlockTerrain(this.state.rng, { unlockIndex: int(questUnlockIndex), width: int(this.worldSize), height: int(this.worldSize) });
    lanDebugLog(
      'terrain_prelude',
      { mode: 'RushMode', lanEnabled: Boolean(this._lanEnabled), lanRole: String(this._lanRole), statusQuestUnlockIndex: int(statusUnlockIndex), statusQuestUnlockIndexFull: int(statusUnlockIndexFull), simQuestUnlockIndex: int(simUnlockIndex), simQuestUnlockIndexFull: int(simUnlockIndexFull), questUnlockIndex: int(questUnlockIndex), terrainSlots: terrain.terrainSlots, terrainSeed: terrain.terrainSeed },
    );
    this.applyTerrainSetup({
      terrainSlots: terrain.terrainSlots,
      seed: terrain.terrainSeed,
    });
    this.simWorld.state.rng.srand(int(this.state.rng.state));
    this._simSession = this._newSimSession();
    enforceRushLoadout(this.simWorld.worldState);
    const replayStatus = status === null ? new GameStatusData() : status.asData();
    const recordReplay = !Boolean(this._lanEnabled) || String(this._lanRole) === 'host';
    if (recordReplay) {
      this._replayRecorder = new ReplayRecorder(new ReplayHeader({ gameModeId: GameMode.RUSH, seed: int(this._runResetSeed), tickRate: int(this._gameplayTickRate()), questFailRetryCount: int(this.questFailRetryCount), hardcore: Boolean(this.hardcore), preserveBugs: Boolean(this.state.preserveBugs), detailPreset: int(this._deterministicDetailPreset()), violenceDisabled: int(this._deterministicViolenceDisabled()), worldSize: this.worldSize, playerCount: this.simWorld.players.length, status: replayStatus }));
      this._replayCheckpointsSampleRate = int(DEFAULT_CHECKPOINT_SAMPLE_RATE);
    } else {
      this._replayRecorder = null;
    }
    ((target: unknown) => {
      if (target !== null && typeof target === 'object' && typeof (target as { clear?: unknown }).clear === 'function') {
        (target as { clear: () => void }).clear();
      } else if (target !== null && typeof target === 'object' && 'length' in target) {
        (target as { length: number }).length = 0;
      }
    })(this._replayCheckpoints);
    this._replayCheckpointsLastTick = null;
  }

  close(): void {
    this._simSession = null;
    super.close();
  }

  protected _handleInput(): void {
    if (this._gameOverActive) {
      if (InputState.wasKeyPressed(27)) {
        this._action = 'back_to_menu';
        this.closeRequested = true;
      }
      return;
    }

    if (!Boolean(this._lanEnabled) && InputState.wasKeyPressed(9)) {
      this._paused = !this._paused;
    }

    if (InputState.wasKeyPressed(27)) {
      this._action = 'open_pause_menu';
      return;
    }
  }

  protected _enterGameOver(): void {
    if (this._gameOverActive) {
      return;
    }

    const gameModeId = (() => { const value = this.config.gameplay.mode; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
    const record = buildHighscoreRecordForGameOver({ state: this.state, player: this.player, survivalElapsedMs: int(this._sessionElapsedMs()), creatureKillCount: int(this.creatures.killCount), gameModeId: gameModeId });

    this._gameOverRecord = record;
    this._gameOverUi.open();
    this._gameOverActive = true;
    this._saveReplay();
  }

  protected _replayCheckpointElapsedMs(): number {
    return this._sessionElapsedMs();
  }

  protected _replayClaimedStatsComplete(): boolean {
    return Boolean(this._gameOverActive);
  }

  protected _replayClaimedStatsElapsedMs(): number {
    return int(this._sessionElapsedMs());
  }

  protected _replayOutputBasename(opts: { stamp: string; replay: Replay }): string {
    const stamp = opts.stamp;
    const replay = opts.replay;
    const _ = replay;
    const kills = int(this.creatures.killCount);
    return `rush_${stamp}_kills${kills}`;
  }

  protected _lanModeName(): "rush" {
    return 'rush';
  }

  protected _lanMatchSession(): DeterministicSession | null {
    return this._simSession;
  }

  protected _lanPrepareFrame(role: string, dtUiMs: number, session: LanSession, dtTick: number): boolean {
    const _ = [role, dtUiMs, dtTick];
    session.detailPreset = int(this._deterministicDetailPreset());
    session.violenceDisabled = int(this._deterministicViolenceDisabled());
    return true;
  }

  protected _lanOnTickApplied(tick: DeterministicSessionTick, frameTickIndex: number | null, dtTick: number): LanStepAction {
    const _ = [tick, dtTick];
    const elapsedMs = this._sessionElapsedMs();
    const spawnCooldownMs = this._spawnState.spawnCooldownMs;
    if (frameTickIndex !== null) {
      this._storeNetRuntimeSnapshot({
        snapshot: new RushStateSnapshotV2({ tickIndex: int(frameTickIndex), replayState: this._netReplaySnapshotState(), runtimeState: new RushRuntimeSnapshotV2({ elapsedMs: elapsedMs, spawnCooldownMs: spawnCooldownMs, killCount: int(this.creatures.killCount) }) }),
      });
    }
    if (!this._anyPlayerAlive()) {
      this._enterGameOver();
      return 'stop_after_finalize';
    }
    return 'continue';
  }

  protected _applyResyncSnapshot(snapshot: ModeStateSnapshotV2): void {
    if (!(snapshot instanceof RushStateSnapshotV2)) {
      return;
    }
    const rs = snapshot.runtimeState;
    if (this._simSession !== null) {
      this._simSession.elapsedMs = rs.elapsedMs;
    }
    this._spawnState.spawnCooldownMs = rs.spawnCooldownMs;
    this.creatures.killCount = int(rs.killCount);
  }

  update(dt: number): void {
    const frame = this._beginModeUpdate(dt);
    if (frame === null) {
      return;
    }

    if (this._gameOverActive) {
      this._updateGameOverUi(frame.dt);
      return;
    }

    if (Boolean(this._lanEnabled) && this._lanRuntime !== null) {
      this._updateLanMatch({ dt: frame.dt, dtUiMs: 0.0 });
      return;
    }

    const anyAlive = this._anyPlayerAlive();
    const simDt = (!this._paused && anyAlive) ? frame.dt : 0.0;
    const session = this._simSession;

    if (this._lanWaitGateActive()) {
      this._resetGameplayFrameClock();
      return;
    }
    if (simDt <= 0.0) {
      this._resetGameplayFrameClock();
      if (!anyAlive) {
        this._enterGameOver();
      }
      return;
    }
    if (session === null) {
      return;
    }

    const tickDt = this._gameplayTickDt({ session: session });

    const _onTick = (tick: any, tickIndex: number | null): boolean => {
      const _ = tickIndex;
      const action = this._lanOnTickApplied(tick, null, tickDt);
      return action !== 'continue';
    };

    const _onCheckpoint = (tickIndex: number, tick: any): void => {
      this._recordReplayCheckpointFromTick({
        tickIndex: int(tickIndex),
        tick: tick,
      });
    };

    this._runDeterministicSessionTicks({
      dtFrame: simDt,
      session: session,
      recorder: this._replayRecorder,
      onTick: _onTick,
      onCheckpoint: _onCheckpoint,
    });
  }

  protected _drawGameCursor(): void {
    const resources = this.renderResources.resources;
    const mousePos = this._uiMouse;
    drawMenuCursor(
      resources.texture(TextureId.PARTICLES),
      resources.texture(TextureId.UI_CURSOR),
      { pos: mousePos, pulseTime: this._cursorPulseTime },
    );
  }

  draw(): void {
    this._drawWorld({
      drawAimIndicators: !this._gameOverActive,
      entityAlpha: this._worldEntityAlpha(),
    });
    this._drawScreenFade();

    let hudBottom = 0.0;
    if (!this._gameOverActive) {
      const hudFlags = hudFlagsForGameMode(this._configGameModeId());
      this._drawTargetHealthBar();
      hudBottom = drawHudOverlay(new HudRenderContext({ resources: this.renderResources.resources, state: this._hudState, font: this._small, showHealth: hudFlags.showHealth, showWeapon: hudFlags.showWeapon, showXp: hudFlags.showXp, showTime: hudFlags.showTime, showQuestHud: hudFlags.showQuestHud, smallIndicators: this._hudSmallIndicators() }), { player: this.player, players: this.simWorld.players, bonusHud: this.state.bonusHud, elapsedMs: this._sessionElapsedMs(), frameDtMs: this._lastDtMs });
    }

    let yExtra: number;
    if (debugEnabled() && !this._gameOverActive) {
      const x = 18.0;
      const y = Math.max(18.0, hudBottom + 10.0);
      const line = this._uiLineHeight();
      this._drawUiText(`rush: t=${(this._sessionElapsedMs() / 1000.0).toFixed(1).padStart(6, ' ')}s`, new Vec2(x, y), UI_TEXT_COLOR);
      this._drawUiText(`kills=${this.creatures.killCount}`, new Vec2(x, y + line), UI_HINT_COLOR);
      yExtra = y + line * 2.0;
      if (this._paused) {
        this._drawUiText('paused (TAB)', new Vec2(x, yExtra), UI_HINT_COLOR);
        yExtra += line;
      }
      if (this.player.health <= 0.0) {
        this._drawUiText('game over', new Vec2(x, yExtra), UI_ERROR_COLOR);
        yExtra += line;
      }
      this._drawLanDebugInfo({ x: x, y: yExtra, lineH: line });
    }

    if (this._gameOverActive) {
      this._drawGameCursor();
      if (this._gameOverRecord !== null) {
        this._gameOverUi.draw({
          record: this._gameOverRecord,
          bannerKind: this._gameOverBanner,
          resources: this.renderResources.resources,
          mouse: this._uiMousePos(),
        });
      }
    }
    this._drawLanWaitOverlay();
  }
}
