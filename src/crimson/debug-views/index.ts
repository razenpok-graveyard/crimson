// Port of crimson/debug_views/__init__.py

export { allViews, viewByName } from '@crimson/debug-views/registry.ts';

function registerBuiltinViews(): void {
  void import('@crimson/debug-views/arsenal-debug.ts');
  void import('@crimson/debug-views/lighting-debug.ts');
  void import('@crimson/debug-views/spawn-plan.ts');
}

registerBuiltinViews();
