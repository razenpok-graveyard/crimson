// Port of crimson/runtime_resources_view.py

import type { RuntimeResources } from '@grim/assets.ts';
import { loadRuntimeResources, unloadRuntimeResources } from '@grim/assets.ts';
import type { View } from '@grim/view.ts';

export class RuntimeResourcesView {
  private readonly _view: View;
  private readonly _assetsDir: string;
  private _resources: RuntimeResources | null;

  constructor(view: View, opts: { assetsDir: string }) {
    const assetsDir = opts.assetsDir;
    this._view = view;
    this._assetsDir = assetsDir;
    this._resources = null;
  }

  async open(): Promise<void> {
    this._resources = await loadRuntimeResources(this._assetsDir);
    try {
      this._view.open();
    } catch (exc) {
      unloadRuntimeResources(this._resources);
      this._resources = null;
      throw exc;
    }
  }

  update(dt: number): void {
    this._view.update(dt);
  }

  draw(): void {
    this._view.draw();
  }

  close(): void {
    try {
      this._view.close();
    } finally {
      unloadRuntimeResources(this._resources);
      this._resources = null;
    }
  }
}
