// Port of crimson/typo/runtime.py

import { Vec2 } from '@grim/geom.ts';
import { SfxId } from '@grim/sfx-map.ts';
import { CreatureTypeId, CreatureAiMode, CreatureFlags, CreatureInit } from '@crimson/creatures/spawn.ts';
import { RngCallerStatic } from '@crimson/rng-caller-static.ts';
import { PlayerInput } from '@crimson/sim/input.ts';
import { TypoCharCommand, TypoBackspaceCommand, TypoSubmitCommand } from '@crimson/sim/input-providers.ts';
import type { WorldState } from '@crimson/sim/world-state.ts';
import { enforceTypoPlayerFrame } from './player.ts';
import { tickTypoSpawns } from './spawns.ts';
import type { MidStepContext, PostStepContext } from '@crimson/sim/sessions.ts';

function _requireSinglePlayerTypo(command: { playerIndex: number }): void {
  if (int(command.playerIndex) !== 0) {
    throw new Error('Typ-o Shooter commands are single-player only');
  }
}

function _typeclickSfx(world: WorldState, opts: { caller: RngCallerStatic }): SfxId {
  const caller = opts.caller;
  if ((world.state.rng.rand({ caller }) & 1) === 0) {
    return SfxId.UI_TYPECLICK_01;
  }
  return SfxId.UI_TYPECLICK_02;
}

export function applyTypoCommand(
  world: WorldState,
  command: TypoCharCommand | TypoBackspaceCommand | TypoSubmitCommand,
): void {
  _requireSinglePlayerTypo(command);
  const typo = world.state.typo;
  const typing = typo.typing;

  if (command instanceof TypoCharCommand) {
    if (command.ch) {
      typing.pushChar(command.ch);
      world.state.sfxQueue.push(
        _typeclickSfx(world, { caller: RngCallerStatic.TYPO_GAMEPLAY_TYPECLICK_CHAR }),
      );
    }
  } else if (command instanceof TypoBackspaceCommand) {
    typing.backspace();
    world.state.sfxQueue.push(
      _typeclickSfx(world, { caller: RngCallerStatic.TYPO_GAMEPLAY_TYPECLICK_BACKSPACE }),
    );
  } else if (command instanceof TypoSubmitCommand) {
    if (!typing.text) return;
    world.state.sfxQueue.push(SfxId.UI_TYPEENTER);

    const activeMask = world.creatures.entries.map((entry) => entry.active);
    const targetIdx = typo.names.findByName(typing.text, { activeMask });
    const entered = typing.submit({ matched: targetIdx !== null });

    typo.pendingFireTarget = null;
    typo.pendingReload = false;

    if (entered === null) return;

    if (targetIdx !== null) {
      const creature = world.creatures.entries[int(targetIdx)];
      if (creature.active) {
        typo.pendingFireTarget = new Vec2(
          creature.pos.x,
          creature.pos.y,
        );
      }
      return;
    }

    if (entered === 'reload') {
      typo.pendingReload = true;
    }
  } else {
    const commandTypeName = Object.getPrototypeOf(command).constructor.name;
    throw new Error(`unhandled Typ-o command: ${commandTypeName}`);
  }
}

export function typoBeforeStep(world: WorldState): void {
  for (const player of world.players) {
    enforceTypoPlayerFrame(player, { state: world.state });
  }
}

export function typoMidStep(ctx: MidStepContext): void {
  const typo = ctx.world.state.typo;

  const [cooldown, spawns] = tickTypoSpawns({
    elapsedMs: int(ctx.elapsedBeforeMs),
    spawnCooldownMs: int(typo.spawnCooldownMs),
    frameDtMs: int(ctx.dtSimMs),
    playerCount: ctx.world.players.length,
    worldWidth: ctx.worldSize,
    worldHeight: ctx.worldSize,
  });
  typo.spawnCooldownMs = int(cooldown);

  for (const call of spawns) {
    const heading =
      (ctx.world.state.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TINTED_HEADING }) % 314) * 0.01;
    let size =
      (ctx.world.state.rng.rand({ caller: RngCallerStatic.CREATURE_SPAWN_TINTED_SIZE }) % 20) + 47;
    let flags = 0;
    let moveSpeed = 1.7;

    if (
      int(call.typeId) === int(CreatureTypeId.SPIDER_SP1) ||
      int(call.typeId) === int(CreatureTypeId.SPIDER_SP2)
    ) {
      flags |= CreatureFlags.AI7_LINK_TIMER;
      moveSpeed *= 1.2;
      size *= 0.8;
    }

    const init = new CreatureInit({ originTemplateId: 0, pos: call.pos, heading, phaseSeed: 0.0 });
    init.typeId = call.typeId;
    init.flags = flags;
    init.aiMode = CreatureAiMode.CHASE_PLAYER;
    init.health = 1.0;
    init.maxHealth = 1.0;
    init.moveSpeed = moveSpeed;
    init.rewardValue = 1.0;
    init.size = size;
    init.contactDamage = 100.0;
    init.tint = call.tintRgba.toTuple();

    const creatureIdx = ctx.world.creatures.spawnInit(init);
    if (creatureIdx === null || creatureIdx === undefined) continue;

    const activeMask = ctx.world.creatures.entries.map((entry) => entry.active);
    typo.names.assignRandom(
      int(creatureIdx),
      ctx.world.state.rng,
      {
        scoreXp: ctx.world.players.length > 0 ? int(ctx.world.players[0].experience) : 0,
        activeMask,
        dictionaryWords: typo.dictionaryWords,
        highscoreNames: typo.highscoreNames,
      },
    );
  }
}

export function typoPostStep(ctx: PostStepContext): void {
  const state = ctx.world.state;
  state.bonuses.weaponPowerUp = 0.0;
  state.bonuses.reflexBoost = 0.0;
  state.timeScaleActive = false;
  state.bonusPool.reset();
}

export function typoInputTransform(world: WorldState, inputs: PlayerInput[]): PlayerInput[] {
  if (inputs.length === 0) {
    world.state.typo.pendingFireTarget = null;
    world.state.typo.pendingReload = false;
    return [];
  }

  const typo = world.state.typo;
  const primary = inputs[0];
  let aim = primary.aim;
  let fireDown = primary.fireDown;
  let firePressed = primary.firePressed;
  let reloadPressed = primary.reloadPressed;

  if (typo.pendingFireTarget !== null) {
    aim = typo.pendingFireTarget;
    fireDown = true;
    firePressed = true;
  }
  if (typo.pendingReload) {
    reloadPressed = true;
  }

  typo.pendingFireTarget = null;
  typo.pendingReload = false;

  const transformedPrimary = new PlayerInput({
    move: new Vec2(),
    aim: new Vec2(aim.x, aim.y),
    moveMode: primary.moveMode,
    aimScheme: primary.aimScheme,
    fireDown,
    firePressed,
    reloadPressed,
    reloadDown: false,
    moveToCursorPressed: primary.moveToCursorPressed,
    moveForwardPressed: primary.moveForwardPressed,
    moveBackwardPressed: primary.moveBackwardPressed,
    turnLeftPressed: primary.turnLeftPressed,
    turnRightPressed: primary.turnRightPressed,
  });

  return [transformedPrimary];
}
