// Port of crimson/owner_ref.py

export const LOCAL_PLAYER_OWNER_ID = -100;

export enum OwnerKind {
  NONE = 0,
  PLAYER = 1,
  CREATURE = 2,
}

export class OwnerRef {
  readonly kind: OwnerKind;
  readonly index: number;
  readonly localHost: boolean;

  constructor(opts: {
    kind: OwnerKind;
    index?: number;
    localHost?: boolean;
  }) {
    this.kind = opts.kind;
    this.index = opts.index ?? 0;
    this.localHost = opts.localHost ?? false;
  }

  static none(): OwnerRef {
    return new OwnerRef({ kind: OwnerKind.NONE });
  }

  static fromLocalPlayer(index: number): OwnerRef {
    return new OwnerRef({ kind: OwnerKind.PLAYER, index: Math.trunc(index), localHost: true });
  }

  static fromPlayer(index: number): OwnerRef {
    return new OwnerRef({ kind: OwnerKind.PLAYER, index: Math.trunc(index), localHost: false });
  }

  static fromCreature(index: number): OwnerRef {
    return new OwnerRef({ kind: OwnerKind.CREATURE, index: Math.trunc(index), localHost: false });
  }

  static fromLegacy(ownerId: number): OwnerRef {
    const legacy = Math.trunc(ownerId);
    if (legacy === Math.trunc(LOCAL_PLAYER_OWNER_ID)) {
      return OwnerRef.fromLocalPlayer(0);
    }
    if (legacy < 0) {
      const idx = -1 - legacy;
      if (idx >= 0) {
        return OwnerRef.fromPlayer(idx);
      }
      return OwnerRef.none();
    }
    return OwnerRef.fromCreature(legacy);
  }

  toLegacy(): number {
    if (this.kind === OwnerKind.NONE) {
      return 0;
    }
    if (this.kind === OwnerKind.CREATURE) {
      return Math.trunc(this.index);
    }
    if (this.localHost && Math.trunc(this.index) === 0) {
      return Math.trunc(LOCAL_PLAYER_OWNER_ID);
    }
    return -1 - Math.trunc(this.index);
  }

  isPlayer(): boolean {
    return this.kind === OwnerKind.PLAYER;
  }

  playerIndex(): number | null {
    if (this.kind !== OwnerKind.PLAYER) {
      return null;
    }
    return Math.trunc(this.index);
  }

  playerIndexInBounds(playerCount: number): number | null {
    const idx = this.playerIndex();
    if (idx === null) {
      return null;
    }
    if (0 <= idx && idx < Math.trunc(playerCount)) {
      return Math.trunc(idx);
    }
    return null;
  }

  creatureIndex(): number | null {
    if (this.kind !== OwnerKind.CREATURE) {
      return null;
    }
    return Math.trunc(this.index);
  }

  creatureIndexInBounds(creatureCount: number): number | null {
    const idx = this.creatureIndex();
    if (idx === null) {
      return null;
    }
    if (0 <= idx && idx < Math.trunc(creatureCount)) {
      return Math.trunc(idx);
    }
    return null;
  }
}
