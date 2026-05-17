// Port of crimson/screens/panels/network_lobby.py

import { playSfx, updateAudio } from '@grim/audio.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { debugEnabled } from '@crimson/debug.ts';
import type { GameState } from '@crimson/game/types.ts';
import { LockstepEndpoint } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { LobbyState } from '@crimson/net/lockstep-protocol.ts';
import { LockstepRuntime } from '@crimson/net/lockstep-runtime.ts';
import { RoomState } from '@crimson/net/relay-protocol.ts';
import { RollbackRuntime } from '@crimson/net/rollback-runtime.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import type { MenuEntry } from '@crimson/screens/menu.ts';
import { MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, uiElementAnim } from '@crimson/screens/menu.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS, PanelMenuView } from '@crimson/screens/panels/base.ts';
import * as wgl from '@wgl';

export class LobbyLayout {
  readonly scale: number;
  readonly panelTopLeft: Vec2;
  readonly basePos: Vec2;
  readonly backPos: Vec2;
  readonly backW: number;

  constructor(opts: {
    scale: number;
    panelTopLeft: Vec2;
    basePos: Vec2;
    backPos: Vec2;
    backW: number;
  }) {
    this.scale = opts.scale;
    this.panelTopLeft = opts.panelTopLeft;
    this.basePos = opts.basePos;
    this.backPos = opts.backPos;
    this.backW = opts.backW;
  }
}

export class NetworkLobbyPanelView extends PanelMenuView {
  protected _backButton: UiButtonState;
  protected _error: string;

  get backButton(): UiButtonState {
    return this._backButton;
  }
  get error(): string {
    return this._error;
  }

  constructor(state: GameState) {
    super(state, { title: 'Network Lobby', panelOffset: new Vec2(-63.0, MENU_PANEL_OFFSET_Y), panelHeight: 278.0, backAction: 'open_play_game' });
    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });
    this._error = '';
  }

  open(): void {
    super.open();
    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });
    this._error = '';
  }

  protected _beginCloseTransition(action: string): void {
    if (action === 'open_play_game') {
      const runtime = this.state.networkRuntime;
      if (runtime !== null) {
        runtime.close();
      }
      this.state.networkRuntime = null;
      this.state.networkInLobby = false;
      this.state.networkWaitingForPlayers = false;
      this.state.networkExpectedPlayers = 1;
      this.state.networkConnectedPlayers = 1;
    }
    super._beginCloseTransition(action);
  }

  update(dt: number): void {
    this._assertOpen();
    if (this.state.audio !== null) {
      updateAudio(this.state.audio, dt);
    }
    if (this._ground !== null) {
      this._ground.processPending();
    }
    this._cursorPulseTime += Math.min(dt, 0.1) * 1.1;
    const dtMs = int(Math.min(dt, 0.1) * 1000.0);

    if (this._closing) {
      if (dtMs > 0 && this._pendingAction === null) {
        this._timelineMs -= dtMs;
        if (this._timelineMs < 0 && this._closeAction !== null) {
          this._pendingAction = this._closeAction;
          this._closeAction = null;
        }
      }
      return;
    }

    if (dtMs > 0) {
      this._timelineMs = Math.min(this._timelineMaxMs, this._timelineMs + dtMs);
      if (this._timelineMs >= this._timelineMaxMs) {
        this.state.menuSignLocked = true;
        if (!this._panelOpenSfxPlayed && (this.state.audio !== null)) {
          playSfx(this.state.audio, SfxId.UI_PANELCLICK);
          this._panelOpenSfxPlayed = true;
        }
      }
    }

    const enabled = this._timelineMs >= PANEL_TIMELINE_START_MS;
    this._updateBackButton({ dtMs: dtMs, enabled: enabled });
    if (this._closing || this._timelineMs < this._timelineMaxMs) {
      return;
    }

    const pending = this.state.pendingNetworkSession;
    const runtime = this.state.networkRuntime;
    if (pending === null || runtime === null) {
      this._error = 'Network runtime is not running.';
      return;
    }

    const error = String(runtime.error || '');
    if (error) {
      this._error = error;
      return;
    }

    const event = runtime.matchStart();
    if (event === null) {
      return;
    }

    const modeRaw = int(event.modeId);
    let modeId: GameMode;
    try {
      modeId = (() => { const value = modeRaw; if (!Object.values(GameMode).includes(value as GameMode)) { throw new Error('invalid GameMode'); } return value as GameMode; })();
    } catch (exc) {
      this._error = `Unsupported network mode id: ${modeRaw}`;
      return;
    }
    const playerCount = int(event.playerCount);
    const questLevel = event.questLevel;

    this.state.networkInLobby = true;
    this.state.networkWaitingForPlayers = false;
    this.state.networkExpectedPlayers = Math.max(1, Math.min(4, playerCount));
    this.state.networkConnectedPlayers = int(this.state.networkExpectedPlayers);
    this.state.config.gameplay.playerCount = int(this.state.networkExpectedPlayers);
    this.state.config.gameplay.mode = modeId;
    switch (modeId) {
      case GameMode.QUESTS:
        this.state.pendingQuestLevel = questLevel;
        break;
      default:
        break;
    }
    let action: string;
    switch (modeId) {
      case GameMode.SURVIVAL:
        action = 'start_survival';
        break;
      case GameMode.RUSH:
        action = 'start_rush';
        break;
      case GameMode.QUESTS:
        action = 'start_quest';
        break;
      default:
        this._error = `Unsupported network mode id: ${int(modeId)}`;
        return;
    }
    this._beginCloseTransition(action);
  }

  protected _drawEntry(entry: MenuEntry): void {
    const _ = entry;
    return;
  }

  protected _layout(): LobbyLayout {
    const [panelScale, localShift] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW });
    const panelTopLeft = (new Vec2(this._panelPos.x + slideX, this._panelPos.y + this._widescreenYShift).add(this._panelOffset.mul(panelScale)));
    const basePos = panelTopLeft.add(new Vec2(212.0 * panelScale, 40.0 * panelScale));

    const resources = requireRuntimeResources(this.state);
    const backW = buttonWidth(resources, this._backButton.label, { scale: panelScale, forceWide: this._backButton.forceWide });
    const panelH = this._panelHeight * panelScale;
    const backPos = panelTopLeft.add(new Vec2(panelW - backW - 22.0 * panelScale, panelH - 44.0 * panelScale));

    return new LobbyLayout({ scale: panelScale, panelTopLeft: panelTopLeft, basePos: basePos, backPos: backPos, backW: backW });
  }

  protected _updateBackButton(opts: { dtMs: number; enabled: boolean }): void {
    const dtMs = opts.dtMs;
    const enabled = opts.enabled;
    if (!enabled) {
      return;
    }
    if (InputState.wasKeyPressed(27)) {
      this._beginCloseTransition(this._backAction);
      return;
    }

    const layout = this._layout();
    const mouse = (() => { const [x, y] = InputState.mousePosition(); return { x, y }; })();
    const click = InputState.wasMouseButtonPressed(0);

    this._backButton.enabled = true;
    if (buttonUpdate(this._backButton, { pos: layout.backPos, width: layout.backW, dtMs: dtMs, mouse: mouse, click: Boolean(click) })) {
      this._beginCloseTransition(this._backAction);
    }
  }

  protected _drawContents(): void {
    const layout = this._layout();
    const resources = requireRuntimeResources(this.state);
    const font = resources.smallFont;
    const scale = layout.scale;
    const basePos = layout.basePos;
    const textScale = 1.0 * scale;

    const titleScale = 1.2 * scale;
    const titleColor = wgl.makeColor(255 / 255, 255 / 255, 255 / 255, 255 / 255);
    const bodyColor = wgl.makeColor(190 / 255, 210 / 255, 230 / 255, 220 / 255);
    const labelColor = wgl.makeColor(190 / 255, 190 / 255, 200 / 255, 230 / 255);
    const valueColor = wgl.makeColor(225 / 255, 235 / 255, 247 / 255, 255 / 255);

    drawSmallText(font, 'Network Lobby', basePos, titleColor);
    let y = basePos.y + font.cellSize * titleScale + 6.0 * scale;
    drawSmallText(font, 'Waiting for peers to connect and ready up.', new Vec2(basePos.x, y), bodyColor);
    y += font.cellSize * 0.9 * scale + 10.0 * scale;

    const pending = this.state.pendingNetworkSession;
    const role = pending !== null ? String(pending.role) : '';
    const cfg = pending !== null ? pending.config : null;
    let roomCode = '';
    let relayText = '127.0.0.1:31993';
    if (cfg !== null) {
      const endpoint = cfg.endpoint;
      if (endpoint instanceof LockstepEndpoint) {
        roomCode = '-';
        relayText = `${endpoint.host}:${int(endpoint.port)}`;
      } else {
        roomCode = endpoint.roomCode || '-';
        relayText = `${endpoint.relayHost}:${int(endpoint.relayPort)}`;
      }
    }

    const runtime: RollbackRuntime | LockstepRuntime | null = this.state.networkRuntime;
    const lobbyState: LobbyState | RoomState | null = runtime !== null ? runtime.lobbyState() : null;
    if (lobbyState instanceof RoomState) {
      const candidate = lobbyState.roomCode;
      if (candidate) {
        roomCode = candidate;
      }
    }

    const sessionId = lobbyState !== null ? String(lobbyState.sessionId) : '';
    let expected = lobbyState !== null ? int(lobbyState.playerCount) : int(this.state.networkExpectedPlayers);
    expected = Math.max(1, Math.min(4, int(expected)));
    const slots = lobbyState !== null ? lobbyState.slots : null;
    let connected: number;
    if (Array.isArray(slots)) {
      connected = slots.filter((slot) => slot.connected).reduce((total, slot) => total + 1, 0);
    } else {
      connected = int(this.state.networkConnectedPlayers);
    }
    connected = Math.max(0, Math.min(4, int(connected)));

    const dots = '.'.repeat(int((this._cursorPulseTime * 2.5) % 4));
    const connectedText = `${connected}/${expected}${dots}`;
    const roleLabel = role === 'host' ? 'Host' : 'Client';
    const codeText = roomCode || '-';

    const labelW = Math.max(measureSmallTextWidth(font, 'Connected:'), measureSmallTextWidth(font, 'Role:'), measureSmallTextWidth(font, 'Code:'), measureSmallTextWidth(font, 'Address:'), measureSmallTextWidth(font, 'Session:'));
    const valueX = basePos.x + labelW + 10.0 * scale;
    const lineH = font.cellSize * textScale + 3.0 * scale;

    drawSmallText(font, 'Connected:', new Vec2(basePos.x, y), labelColor);
    drawSmallText(font, connectedText, new Vec2(valueX, y), valueColor);
    y += lineH;

    drawSmallText(font, 'Role:', new Vec2(basePos.x, y), labelColor);
    drawSmallText(font, roleLabel, new Vec2(valueX, y), valueColor);
    y += lineH;

    drawSmallText(font, 'Code:', new Vec2(basePos.x, y), labelColor);
    drawSmallText(font, codeText, new Vec2(valueX, y), valueColor);
    y += lineH;

    drawSmallText(font, 'Address:', new Vec2(basePos.x, y), labelColor);
    drawSmallText(font, relayText, new Vec2(valueX, y), valueColor);
    y += lineH;

    if (sessionId) {
      drawSmallText(font, 'Session:', new Vec2(basePos.x, y), labelColor);
      drawSmallText(font, sessionId, new Vec2(valueX, y), wgl.makeColor(155 / 255, 175 / 255, 200 / 255, 255 / 255));
      y += lineH;
    }

    if (Array.isArray(slots) && slots.length > 0) {
      y += 8.0 * scale;
      drawSmallText(font, 'Slots:', new Vec2(basePos.x, y), wgl.makeColor(200 / 255, 200 / 255, 210 / 255, 255 / 255));
      y += lineH * 0.9;

      const colSlotX = basePos.x;
      const colNameX = basePos.x + 44.0 * scale;
      const colStateX = basePos.x + 186.0 * scale;
      const rowH = font.cellSize * textScale + 2.0 * scale;
      for (const slot of slots.slice(0, 4)) {
        const label = slot.isHost ? 'host' : (slot.peerName || 'peer');
        const state = slot.ready ? 'READY' : slot.connected ? 'CONNECTED' : 'EMPTY';
        const stateColor = slot.ready ? wgl.makeColor(160 / 255, 220 / 255, 160 / 255, 255 / 255) : wgl.makeColor(210 / 255, 210 / 255, 210 / 255, 255 / 255);

        drawSmallText(font, `[${int(slot.slotIndex)}]`, new Vec2(colSlotX, y), valueColor);
        drawSmallText(font, label, new Vec2(colNameX, y), valueColor);
        drawSmallText(font, state, new Vec2(colStateX, y), stateColor);
        y += rowH;
      }
    }

    if (this._error) {
      y += 8.0 * scale;
      drawSmallText(font, this._error, new Vec2(basePos.x, y), wgl.makeColor(240 / 255, 90 / 255, 90 / 255, 255 / 255));
      y += lineH;
    }

    if (debugEnabled()) {
      y += 10.0 * scale;
      drawSmallText(font, 'Debug:', new Vec2(basePos.x, y), wgl.makeColor(232 / 255, 197 / 255, 117 / 255, 255 / 255));
      y += lineH;
      drawSmallText(font, `logs: ${String(this.state.baseDir)}/logs/lan/`, new Vec2(basePos.x, y), wgl.makeColor(232 / 255, 197 / 255, 117 / 255, 255 / 255));
    }

    buttonDraw(
      resources,
      this._backButton,
      { pos: layout.backPos, width: layout.backW, scale: scale },
    );
  }
}
