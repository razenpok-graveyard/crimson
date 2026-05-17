// Port of crimson/screens/quest_views/quest_results.py

import { QuestLevel } from '@crimson/quests/level.ts';
import { trackedQuestCompletedCounterIndex } from '@crimson/quests/status.ts';
import { playSfx, updateAudio } from '@grim/audio.ts';
import { SfxId } from '@grim/sfx-map.ts';
import type { GroundRenderer } from '@grim/terrain-render.ts';
import type { GameState } from '@crimson/game/types.ts';
import { HighScoresRequest } from '@crimson/game/types.ts';
import { GameMode } from '@crimson/game-modes.ts';
import { questByLevel } from '@crimson/quests/index.ts';
import { ensureMenuGround, menuGroundCamera } from '@crimson/screens/menu.ts';
import { drawScreenFade } from '@crimson/screens/transitions.ts';
import { nextQuestLevel, playerNameDefault } from '@crimson/screens/quest-views/shared.ts';
import { HighScoreRecord } from '@crimson/persistence/highscores.ts';
import { computeQuestFinalTime } from '@crimson/quests/results.ts';
import { QuestResultsUi } from '@crimson/screens/results/quest-results.ts';
import { weaponDisplayName } from '@crimson/weapons.ts';
import { PERK_BY_ID, PerkId, perkDisplayName } from '@crimson/perks/index.ts';
import * as wgl from '@wgl';

function pythonEquals(left: object | string | number | boolean | null | undefined, right: object | string | number | boolean | null | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (left !== null && left !== undefined && typeof left === 'object') {
    const equal = Reflect.get(left, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(left, right));
    }
  }
  if (right !== null && right !== undefined && typeof right === 'object') {
    const equal = Reflect.get(right, 'equal');
    if (typeof equal === 'function') {
      return Boolean(equal.call(right, left));
    }
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => pythonEquals(value, right[index]));
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && pythonEquals(Reflect.get(left, key), Reflect.get(right, key)));
  }
  return false;
}

export class QuestResultsView {
  state: GameState;
  protected _ground: GroundRenderer | null;
  protected _questLevel: QuestLevel | null;
  protected _questTitle: string;
  protected _unlockWeaponName: string;
  protected _unlockPerkName: string;
  protected _ui: QuestResultsUi | null;
  protected _action: string | null;

  get ground(): GroundRenderer | null {
    return this._ground;
  }
  get questLevel(): QuestLevel | null {
    return this._questLevel;
  }
  get questTitle(): string {
    return this._questTitle;
  }
  get unlockWeaponName(): string {
    return this._unlockWeaponName;
  }
  get unlockPerkName(): string {
    return this._unlockPerkName;
  }
  get ui(): QuestResultsUi | null {
    return this._ui;
  }
  get action(): string | null {
    return this._action;
  }

  constructor(state: GameState) {
    this.state = state;
    this._ground = null;
    this._questLevel = null;
    this._questTitle = '';
    this._unlockWeaponName = '';
    this._unlockPerkName = '';
    this._ui = null;
    this._action = null;
  }

  open(): void {

    this._action = null;
    this._ground = this.state.pauseBackground !== null ? null : ensureMenuGround(this.state);
    this.state.questFailRetryCount = 0;
    const outcome = this.state.questOutcome;
    this.state.questOutcome = null;
    this._questLevel = null;
    this._questTitle = '';
    this._unlockWeaponName = '';
    this._unlockPerkName = '';
    this._ui = null;
    if (outcome === null) {
      return;
    }
    const level = outcome.level;
    this._questLevel = level;
    const [major, minor] = [level.major, level.minor];

    const quest = questByLevel(level);

    this._questTitle = quest !== null ? String(quest.title || '') : '';
    if (quest !== null) {
      const weaponIdNative = quest.unlockWeaponId !== null ? int(quest.unlockWeaponId) : 0;
      if (weaponIdNative > 0) {

        this._unlockWeaponName = weaponDisplayName(weaponIdNative, { preserveBugs: this.state.preserveBugs });
      }


      const perkIdNative = quest.unlockPerkId !== null ? int(quest.unlockPerkId) : 0;
      if (perkIdNative !== int(PerkId.ANTIPERK)) {
        const perkId = perkIdNative;
        const perkEntry = PERK_BY_ID.get(perkId) ?? null;
        if (perkEntry !== null && perkEntry.name) {
          const violenceDisabled = this.state.config.display.violenceDisabled;
          this._unlockPerkName = perkDisplayName(perkId, { violenceDisabled: violenceDisabled, preserveBugs: this.state.preserveBugs });
        } else {
          this._unlockPerkName = `perk_${perkIdNative}`;
        }
      }
    }

    const record = HighScoreRecord.blank();
    record.gameModeId = GameMode.QUESTS;
    record.questStageMajor = major;
    record.questStageMinor = minor;
    record.scoreXp = int(outcome.experience);
    record.creatureKillCount = int(outcome.killCount);
    record.mostUsedWeaponId = outcome.mostUsedWeaponId;
    const fired = Math.max(0, int(outcome.shotsFired));
    const hit = Math.max(0, Math.min(int(outcome.shotsHit), fired));
    record.shotsFired = fired;
    record.shotsHit = hit;

    let playerHealthValues = Array.from(outcome.playerHealthValues).map((v) => v);
    if (playerHealthValues.length === 0) {
      playerHealthValues = [outcome.playerHealth];
      if (outcome.player2Health !== null) {
        playerHealthValues = playerHealthValues.concat([outcome.player2Health]);
      }
    }
    const breakdown = computeQuestFinalTime({ baseTimeMs: int(outcome.baseTimeMs), playerHealth: outcome.playerHealth, player2Health: outcome.player2Health !== null ? outcome.player2Health : null, playerHealthValues: playerHealthValues, pendingPerkCount: int(outcome.pendingPerkCount) });
    record.survivalElapsedMs = int(breakdown.finalTimeMs);
    const playerNameDefaultValue = playerNameDefault(this.state.config) || 'Player';
    record.setName(playerNameDefaultValue);

    const globalIndex = int(level.globalIndex);
    const completedIdx = trackedQuestCompletedCounterIndex(level);
    if (completedIdx !== null) {
      try {
        this.state.status.incrementQuestPlayCount(completedIdx);
      } catch (exc) {
        this._logNonfatal('failed to increment quest play count', exc);
      }
    }

    // Advance quest unlock progression when completing the currently-unlocked quest.
    if (globalIndex >= 0) {
      const nextUnlock = int(globalIndex + 1);
      const hardcore = this.state.config.gameplay.hardcore;
      try {
        if (hardcore) {
          if (nextUnlock > int(this.state.status.questUnlockIndexFull)) {
            this.state.status.questUnlockIndexFull = nextUnlock;
          }
        } else {
          if (nextUnlock > int(this.state.status.questUnlockIndex)) {
            this.state.status.questUnlockIndex = nextUnlock;
          }
        }
      } catch (exc) {
        this._logNonfatal('failed to update quest unlock progression', exc);
      }
    }

    try {
      this.state.status.saveIfDirty();
    } catch (exc) {
      this._logNonfatal('failed to save status', exc);
    }

    this._ui = new QuestResultsUi({ assetsRoot: this.state.assetsDir, baseDir: this.state.baseDir, config: this.state.config, preserveBugs: this.state.preserveBugs });
    this._ui.open({
      record: record,
      breakdown: breakdown,
      questLevel: level,
      questTitle: String(this._questTitle || ''),
      unlockWeaponName: String(this._unlockWeaponName || ''),
      unlockPerkName: String(this._unlockPerkName || ''),
      playerNameDefault: playerNameDefaultValue,
    });
  }

  close(): void {
    if (this._ui !== null) {
      this._ui.close();
      this._ui = null;
    }
    this._ground = null;
    this._questLevel = null;
    this._questTitle = '';
    this._unlockWeaponName = '';
    this._unlockPerkName = '';
  }

  update(dt: number): void {
    if (this.state.audio !== null) {
      updateAudio(this.state.audio, dt);
    }
    if (this._ground !== null) {
      this._ground.processPending();
    }
    const ui = this._ui;
    if (ui === null) {
      return;
    }
    const audio = this.state.audio;
    const _play = (name: SfxId): void => {
      if (audio === null) {
        return;
      }
      playSfx(audio, name);
    };

    const action = ui.update(dt, { playSfx: audio !== null ? _play : null });
    if (action === 'play_again') {
      if (!(this._questLevel !== null)) throw new Error();
      this._setPendingQuestLevel(this._questLevel);
      this._action = 'start_quest';
      return;
    }
    if (action === 'play_next') {
      if (pythonEquals(this._questLevel, new QuestLevel({ major: 5, minor: 10 }))) {
        this._action = 'end_note';
        return;
      }
      if (!(this._questLevel !== null)) throw new Error();
      const nextLevel = nextQuestLevel(this._questLevel);
      if (nextLevel !== null) {
        this._setPendingQuestLevel(nextLevel);
        this._action = 'start_quest';
      } else {
        this._action = 'back_to_menu';
      }
      return;
    }
    if (action === 'high_scores') {
      this._openHighScoresList();
      return;
    }
    if (action === 'main_menu') {
      this._action = 'back_to_menu';
      return;
    }
  }

  draw(): void {
    wgl.clearBackground(wgl.makeColor(0, 0, 0, 1));
    const ui = this._ui;
    let bgAlpha = 1.0;
    if (ui !== null) {
      bgAlpha = ui.worldEntityAlpha();
    }
    const pauseBackground = this.state.pauseBackground;
    if (pauseBackground !== null) {
      pauseBackground.drawPauseBackground({ entityAlpha: bgAlpha });
    } else if (this._ground !== null) {
      this._ground.draw(menuGroundCamera(this.state));
    }
    drawScreenFade(this.state);
    if (ui !== null) {
      const resources = this.state.resources;
      if (resources === null) {
        return;
      }
      ui.draw({ resources });
      return;
    }

    wgl.drawText('Quest results unavailable.', 32, 140, 28, wgl.makeColor(235 / 255, 235 / 255, 235 / 255, 255 / 255));
    wgl.drawText('Press ESC to return to the menu.', 32, 180, 18, wgl.makeColor(190 / 255, 190 / 255, 200 / 255, 255 / 255));
  }

  takeAction(): string | null {
    const action = this._action;
    this._action = null;
    return action;
  }

  protected _openHighScoresList(): void {
    let highlightRank = null;
    if (this._ui !== null) {
      highlightRank = this._ui.highlightRank;
    }
    if (!(this._questLevel !== null)) throw new Error();
    this.state.pendingHighScores = new HighScoresRequest({ gameModeId: GameMode.QUESTS, questLevel: this._questLevel, highlightRank: highlightRank });
    this._action = 'open_high_scores';
  }

  protected _setPendingQuestLevel(level: QuestLevel): void {
    this.state.pendingQuestLevel = level;
    this.state.config.gameplay.mode = GameMode.QUESTS;
    this.state.config.gameplay.questLevel = level;
    try {
      this.state.config.save();
    } catch (exc) {
      this._logNonfatal('failed to save quest selection config', exc);
    }
  }

  protected _logNonfatal(message: string, exc: unknown): void {
    this.state.console.log.log(`quest results: ${message}: ${exc instanceof Error ? exc.message : String(exc)}`);
  }
}
