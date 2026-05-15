// Port of grim/view.py

export class ViewContext {
  readonly assetsDir: string;
  readonly preserveBugs: boolean;

  constructor(opts: {
    assetsDir?: string;
    preserveBugs?: boolean;
  } = {}) {
    this.assetsDir = opts.assetsDir ?? 'artifacts/assets';
    this.preserveBugs = opts.preserveBugs ?? false;
  }
}

export interface View {
  open(): void;
  update(dt: number): void;
  draw(): void;
  close(): void;
}
