// Port of crimson/game/__init__.py

import { GameConfig } from './types.ts';

export { GameConfig };

export function runGame(config: GameConfig): void {
  // Keep package import side effects minimal so UI modules can import
  // `crimson.game.types` without pulling in the full runtime graph.
  void import('./runtime.ts').then(({ runGame: runGameRuntime }) => {
    runGameRuntime(config);
  });
}
