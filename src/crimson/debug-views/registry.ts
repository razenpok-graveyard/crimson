// Port of crimson/debug_views/registry.py

import { View } from '@grim/view.ts';

export const VIEW_REGISTRY: Map<string, ViewDefinition> = new Map();

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
  const decorator = (factory: (...args: any[]) => View): (...args: any[]) => View => {
    if (VIEW_REGISTRY.has(name)) {
      throw new Error(`view already registered: ${name}`);
    }
    VIEW_REGISTRY.set(name, new ViewDefinition({ name: name, title: title, factory: factory }));
    return factory;
  };

  return decorator;
}

export function allViews(): ViewDefinition[] {
  return Array.from(VIEW_REGISTRY.keys()).sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase())).map((name) => VIEW_REGISTRY.get(name)!);
}

export function viewByName(name: string): ViewDefinition | null {
  return VIEW_REGISTRY.get(name) ?? null;
}
