// Port of crimson/screens/panels/network_session.py

import { playSfx, updateAudio } from '@grim/audio.ts';
import { drawSmallText, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { InputState } from '@grim/input.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GameState, NetcodeMode } from '@crimson/game/types.ts';
import { LockstepEndpoint, NetworkSessionConfig, NetworkSessionMode, PendingNetworkSession, RollbackEndpoint } from '@crimson/game/types.ts';
import { ROOM_CODE_LENGTH } from '@crimson/net/relay-protocol.ts';
import { parseOptionalRoomCode } from '@crimson/net/room-code.ts';
import { QuestLevel } from '@crimson/quests/level.ts';
import { UiButtonState, buttonDraw, buttonUpdate, buttonWidth } from '@crimson/ui/perk-menu.ts';
import { pollTextInput } from '@crimson/ui/text-input.ts';
import { requireRuntimeResources } from '@crimson/screens/assets.ts';
import type { MenuEntry } from '@crimson/screens/menu.ts';
import { MENU_PANEL_OFFSET_Y, MENU_PANEL_WIDTH, uiElementAnim } from '@crimson/screens/menu.ts';
import { PANEL_TIMELINE_END_MS, PANEL_TIMELINE_START_MS, PanelMenuView } from '@crimson/screens/panels/base.ts';
import * as wgl from '@wgl';

export class SessionLayout {
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

export class NetworkSessionPanelView extends PanelMenuView {
  protected _MODES: readonly NetworkSessionMode[] = ['survival', 'rush', 'quests'];
  protected _backButton: UiButtonState;
  protected _role: string;
  protected _modeIdx: number;
  protected _playerCount: number;
  protected _questLevel: string;
  protected _bindHost: string;
  protected _host: string;
  protected _roomCode: string;
  protected _netcodeMode: NetcodeMode;
  protected _portText: string;
  protected _activeField: string;
  protected _error: string;

  constructor(state: GameState) {
    super(state, { title: 'Network Session', panelOffset: new Vec2(-63.0, MENU_PANEL_OFFSET_Y), panelHeight: 278.0, backAction: 'open_play_game' });
    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });

    this._role = 'host';
    this._modeIdx = 0;
    this._playerCount = 2;
    this._questLevel = '1.1';
    this._bindHost = '127.0.0.1';
    this._host = '127.0.0.1';
    this._roomCode = '';
    this._netcodeMode = 'rollback';
    this._portText = '31993';
    this._activeField = '';
    this._error = '';
  }

  protected _parsedQuestLevel(): QuestLevel | null {
    const value = this._questLevel.trim();
    if (!value) {
      return null;
    }
    return QuestLevel.parse(value);
  }

  open(): void {
    super.open();

    this._backButton = new UiButtonState({ label: 'Back', forceWide: false });

    const pending = this.state.pendingNetworkSession;
    if (pending !== null) {
      this._role = String(pending.role);
      const cfg = pending.config;
      try {
        this._modeIdx = this._MODES.indexOf(String(cfg.mode) as NetworkSessionMode);
      } catch (exc) {
        this._modeIdx = 0;
      }
      this._playerCount = Math.max(1, Math.min(4, int(cfg.playerCount)));
      this._questLevel = String(cfg.questLevel || '1.1');
      const netcodeRaw = cfg.netcodeMode.trim().toLowerCase();
      this._netcodeMode = netcodeRaw === 'lockstep' ? 'lockstep' : 'rollback';
      const endpoint = cfg.endpoint;
      if (endpoint instanceof LockstepEndpoint) {
        this._bindHost = String(endpoint.bindHost || '0.0.0.0');
        this._host = String(endpoint.host || '127.0.0.1');
        this._roomCode = '';
        this._portText = String(Math.max(1, int(endpoint.port)));
      } else {
        this._bindHost = String(endpoint.relayHost || '127.0.0.1');
        this._host = String(endpoint.relayHost || '127.0.0.1');
        this._roomCode = Array.from(String(endpoint.roomCode || '').toLowerCase()).filter((ch) => /^[\p{L}\p{N}]+$/u.test(ch)).map((ch) => ch).join("").slice(0, int(ROOM_CODE_LENGTH));
        this._portText = String(Math.max(1, int(endpoint.relayPort)));
      }
    }

    this._activeField = '';
    this._error = '';
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

    if (InputState.wasKeyPressed(9)) {
      this._role = this._role === 'host' ? 'join' : 'host';
      this._activeField = '';
    }

    if (this._role === 'host') {
      if (InputState.wasKeyPressed(77)) {
        this._modeIdx = ((int(this._modeIdx) + 1) + this._MODES.length) % this._MODES.length;
      }
      if (InputState.wasKeyPressed(219)) {
        this._playerCount = Math.max(1, int(this._playerCount) - 1);
      }
      if (InputState.wasKeyPressed(221)) {
        this._playerCount = Math.min(4, int(this._playerCount) + 1);
      }
      if (InputState.wasKeyPressed(76)) {
        this._activeField = 'quest_level';
      }
    }

    if (InputState.wasKeyPressed(72)) {
      this._activeField = 'host';
    }
    if (InputState.wasKeyPressed(66)) {
      this._activeField = 'bind_host';
    }
    if (InputState.wasKeyPressed(67) && this._netcodeMode === 'rollback') {
      this._activeField = 'room_code';
    }
    if (InputState.wasKeyPressed(78)) {
      this._netcodeMode = this._netcodeMode === 'rollback' ? 'lockstep' : 'rollback';
      if (this._netcodeMode === 'lockstep') {
        this._roomCode = '';
        if (!this._host.trim()) {
          this._host = '127.0.0.1';
        }
      }
      this._activeField = '';
    }
    if (InputState.wasKeyPressed(80)) {
      this._activeField = 'port';
    }

    const typed = pollTextInput(64, { allowSpace: false });
    if (typed) {
      if (this._activeField === 'quest_level') {
        this._questLevel = (this._questLevel + typed).slice(0, 8);
      } else if (this._activeField === 'bind_host') {
        this._bindHost = (this._bindHost + typed).slice(0, 64);
      } else if (this._activeField === 'host') {
        this._host = (this._host + typed).slice(0, 64);
      } else if (this._activeField === 'room_code') {
        this._roomCode = Array.from((this._roomCode + typed).toLowerCase()).filter((ch) => /^[\p{L}\p{N}]+$/u.test(ch)).map((ch) => ch).join("").slice(0, int(ROOM_CODE_LENGTH));
      } else if (this._activeField === 'port') {
        this._portText = Array.from((this._portText + typed)).filter((ch) => /^\d+$/u.test(ch)).map((ch) => ch).join("").slice(0, 5);
      }
    }

    if (InputState.wasKeyPressed(8)) {
      if (this._activeField === 'quest_level' && this._questLevel) {
        this._questLevel = this._questLevel.slice(0, -1);
      } else if (this._activeField === 'bind_host' && this._bindHost) {
        this._bindHost = this._bindHost.slice(0, -1);
      } else if (this._activeField === 'host' && this._host) {
        this._host = this._host.slice(0, -1);
      } else if (this._activeField === 'room_code' && this._roomCode) {
        this._roomCode = this._roomCode.slice(0, -1);
      } else if (this._activeField === 'port' && this._portText) {
        this._portText = this._portText.slice(0, -1);
      }
    }

    if (InputState.wasKeyPressed(13)) {
      this._startSession();
    }
  }

  protected _drawEntry(entry: MenuEntry): void {
    const _ = entry;
    return;
  }

  protected _layout(): SessionLayout {
    const [panelScale, localShift] = this._menuItemScale(0);
    const panelW = MENU_PANEL_WIDTH * panelScale;
    const [, slideX] = uiElementAnim(this, { index: 1, startMs: PANEL_TIMELINE_START_MS, endMs: PANEL_TIMELINE_END_MS, width: panelW });
    const panelTopLeft = (new Vec2(this._panelPos.x + slideX, this._panelPos.y + this._widescreenYShift).add(this._panelOffset.mul(panelScale)));
    const basePos = panelTopLeft.add(new Vec2(212.0 * panelScale, 40.0 * panelScale));

    const resources = requireRuntimeResources(this.state);
    const backW = buttonWidth(resources, this._backButton.label, { scale: panelScale, forceWide: this._backButton.forceWide });
    const panelH = this._panelHeight * panelScale;
    const backPos = panelTopLeft.add(new Vec2(panelW - backW - 22.0 * panelScale, panelH - 44.0 * panelScale));

    return new SessionLayout({ scale: panelScale, panelTopLeft: panelTopLeft, basePos: basePos, backPos: backPos, backW: backW });
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

  protected _currentMode(): NetworkSessionMode {
    const idx = Math.max(0, Math.min(int(this._modeIdx), this._MODES.length - 1));
    return this._MODES[idx];
  }

  protected _parsePort(): number {
    let port: ReturnType<typeof int>;
    try {
      port = int(Number(this._portText));
    } catch (exc) {
      port = 31993;
    }
    return Math.max(1, Math.min(65535, int(port)));
  }

  protected _modeStartAction(mode: NetworkSessionMode): string {
    if (mode === 'rush') {
      return 'start_rush_lan';
    }
    if (mode === 'quests') {
      return 'start_quest_lan';
    }
    return 'start_survival_lan';
  }

  protected _startSession(): void {
    this._error = '';
    const mode = this._currentMode();
    const port = this._parsePort();
    let questLevel: ReturnType<typeof this._parsedQuestLevel>;
    try {
      questLevel = this._parsedQuestLevel();
    } catch (exc) {
      this._error = 'Quest level must use the format major.minor.';
      return;
    }

    if (mode === 'quests' && questLevel === null) {
      this._error = 'Quest level is required for quest network sessions.';
      return;
    }

    let endpoint: any;
    let config: any;
    if (this._netcodeMode === 'lockstep') {
      if (!this._host.trim()) {
        this._error = 'Host is required for lockstep sessions.';
        return;
      }
      endpoint = new LockstepEndpoint({ bindHost: String(this._bindHost.trim() || '0.0.0.0'), host: String(this._host.trim()), port: int(port) });
      config = new NetworkSessionConfig({ mode: mode, endpoint: endpoint, netcodeMode: 'lockstep', playerCount: Math.max(1, Math.min(4, int(this._playerCount))), questLevel: questLevel, rollbackMaxTicks: 8, reconnectTimeoutMs: 15_000, inputDelayTicks: 1, preserveBugs: false });
    } else {
      if (!this._host.trim()) {
        this._error = 'Relay host is required for rollback sessions.';
        return;
      }
      if (this._role === 'join' && !this._roomCode.trim()) {
        this._error = 'Room code is required to join rollback sessions.';
        return;
      }
      let roomCode: ReturnType<typeof parseOptionalRoomCode>;
      try {
        roomCode = parseOptionalRoomCode(this._roomCode);
      } catch (exc) {
        this._error = `Room code must be ${int(ROOM_CODE_LENGTH)} uppercase letters or digits.`;
        return;
      }
      endpoint = new RollbackEndpoint({ relayHost: String(this._host.trim()), relayPort: int(port), roomCode: roomCode });
      config = new NetworkSessionConfig({ mode: mode, endpoint: endpoint, netcodeMode: 'rollback', playerCount: Math.max(1, Math.min(4, int(this._playerCount))), questLevel: questLevel, rollbackMaxTicks: 8, reconnectTimeoutMs: 15_000, inputDelayTicks: 1, preserveBugs: false });
    }

    const pending = new PendingNetworkSession({ role: this._role === 'host' ? 'host' : 'join', config: config, autoStart: false });
    this.state.pendingNetworkSession = pending;
    this._beginCloseTransition(this._modeStartAction(mode));
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
    const activeColor = wgl.makeColor(232 / 255, 197 / 255, 117 / 255, 255 / 255);

    drawSmallText(font, 'Network Session', basePos, titleColor);
    let y = basePos.y + font.cellSize * titleScale + 6.0 * scale;
    drawSmallText(font, 'TAB role | M mode | [/] players | N netcode | H/B/P/C/L edit | ENTER continue', new Vec2(basePos.x, y), bodyColor);
    y += font.cellSize * 0.9 * scale + 10.0 * scale;

    const mode = this._currentMode();
    const roleLabel = this._role === 'host' ? 'Host' : 'Join';

    const labelW = Math.max(measureSmallTextWidth(font, 'Role:'), measureSmallTextWidth(font, 'Mode:'), measureSmallTextWidth(font, 'Players:'), measureSmallTextWidth(font, 'Netcode:'), measureSmallTextWidth(font, 'Bind:'), measureSmallTextWidth(font, 'Host:'), measureSmallTextWidth(font, 'Relay:'), measureSmallTextWidth(font, 'Code:'), measureSmallTextWidth(font, 'Port:'), measureSmallTextWidth(font, 'Quest:'));
    const valueX = basePos.x + labelW + 10.0 * scale;
    const lineH = font.cellSize * textScale + 3.0 * scale;

    drawSmallText(font, 'Role:', new Vec2(basePos.x, y), labelColor);
    drawSmallText(font, roleLabel, new Vec2(valueX, y), valueColor);
    y += lineH;

    drawSmallText(font, 'Mode:', new Vec2(basePos.x, y), labelColor);
    drawSmallText(font, String(mode), new Vec2(valueX, y), valueColor);
    y += lineH;

    drawSmallText(font, 'Players:', new Vec2(basePos.x, y), labelColor);
    drawSmallText(font, String(this._playerCount), new Vec2(valueX, y), valueColor);
    y += lineH;

    drawSmallText(font, 'Netcode:', new Vec2(basePos.x, y), labelColor);
    drawSmallText(font, String(this._netcodeMode), new Vec2(valueX, y), valueColor);
    y += lineH;

    if (this._netcodeMode === 'lockstep') {
      drawSmallText(font, 'Bind:', new Vec2(basePos.x, y), labelColor);
      const bindTint = this._activeField === 'bind_host' ? activeColor : valueColor;
      drawSmallText(font, this._bindHost || '-', new Vec2(valueX, y), bindTint);
      y += lineH;

      drawSmallText(font, 'Host:', new Vec2(basePos.x, y), labelColor);
      const hostTint = this._activeField === 'host' ? activeColor : valueColor;
      drawSmallText(font, this._host || '-', new Vec2(valueX, y), hostTint);
      y += lineH;
    } else {
      drawSmallText(font, 'Relay:', new Vec2(basePos.x, y), labelColor);
      const relayTint = this._activeField === 'host' ? activeColor : valueColor;
      drawSmallText(font, this._host || '-', new Vec2(valueX, y), relayTint);
      y += lineH;

      drawSmallText(font, 'Code:', new Vec2(basePos.x, y), labelColor);
      const codeTint = this._activeField === 'room_code' ? activeColor : valueColor;
      drawSmallText(font, this._roomCode || '-', new Vec2(valueX, y), codeTint);
      y += lineH;
    }

    drawSmallText(font, 'Port:', new Vec2(basePos.x, y), labelColor);
    const portTint = this._activeField === 'port' ? activeColor : valueColor;
    drawSmallText(font, this._portText || '-', new Vec2(valueX, y), portTint);
    y += lineH;

    if (mode === 'quests') {
      drawSmallText(font, 'Quest:', new Vec2(basePos.x, y), labelColor);
      const questTint = this._activeField === 'quest_level' ? activeColor : valueColor;
      drawSmallText(font, this._questLevel || '-', new Vec2(valueX, y), questTint);
      y += lineH;
    }

    if (this._error) {
      y += font.cellSize * 0.9 * scale + 6.0 * scale;
      drawSmallText(font, this._error, new Vec2(basePos.x, y), wgl.makeColor(240 / 255, 90 / 255, 90 / 255, 255 / 255));
    }

    buttonDraw(
      resources,
      this._backButton,
      { pos: layout.backPos, width: layout.backW, scale: scale },
    );
  }
}
