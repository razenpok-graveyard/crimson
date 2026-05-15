// Port of crimson/debug_views/registry.py

import type { View } from '@grim/view.ts';

const viewRegistry: Map<string, ViewDefinition> = new Map();

export class ViewDefinition {
  readonly name: string;
  readonly title: string;
  readonly factory: (...args: any[]) => View;

  constructor(opts: {
    name: string;
    title: string;
    factory: (...args: any[]) => View;
  }) {
    this.name = opts.name;
    this.title = opts.title;
    this.factory = opts.factory;
  }
}

export function registerView(name: string, title: string): (arg0: (...args: any[]) => View) => (...args: any[]) => View {
  function decorator(factory: (...args: any[]) => View): (...args: any[]) => View {
    if (viewRegistry.has(name)) {
      throw new Error(`view already registered: ${name}`);
    }
    viewRegistry.set(name, new ViewDefinition({ name: name, title: title, factory: factory }));
    return factory;
  }

  return decorator;
}

export function allViews(): ViewDefinition[] {
  return Array.from(viewRegistry.keys()).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase())).map((name) => viewRegistry.get(name)!);
}

export function viewByName(name: string): ViewDefinition | null {
  return viewRegistry.get(name) ?? null;
}
