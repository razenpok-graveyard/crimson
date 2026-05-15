export function renderBrowserInputModule(relativePath: string): string {
  return `// Port of ${relativePath}

export class ActionMap {
  bindings: Map<string, number[]> = new Map();

  constructor(opts: { bindings?: Map<string, readonly number[]> | Record<string, readonly number[]> } = {}) {
    const bindings = opts.bindings;
    if (bindings instanceof Map) {
      for (const [action, keys] of bindings) {
        this.bindings.set(action, Array.from(keys, int));
      }
    } else if (bindings !== undefined) {
      for (const [action, keys] of Object.entries(bindings)) {
        this.bindings.set(action, Array.from(keys, int));
      }
    }
  }

  bind(action: string, ...keys: number[]): void {
    if (keys.length === 0) throw new Error('bind requires at least one key');
    this.bindings.set(action, keys.map((key) => int(key)));
  }

  isDown(action: string): boolean {
    const keys = this.bindings.get(action);
    if (!keys) return false;
    return keys.some(k => InputState.isKeyDown(k));
  }

  wasPressed(action: string): boolean {
    const keys = this.bindings.get(action);
    if (!keys) return false;
    return keys.some(k => InputState.wasKeyPressed(k));
  }
}

export class InputState {
  private static _keysDown = new Set<number>();
  private static _keysPressed = new Set<number>();
  private static _keysRepeated = new Set<number>();
  private static _mouseButtons = new Set<number>();
  private static _mouseButtonsPressed = new Set<number>();
  private static _mouseX = 0;
  private static _mouseY = 0;
  private static _charQueue: number[] = [];
  private static _keyPressedQueue: number[] = [];
  private static _wheelDelta = 0;
  private static _initialized = false;

  static init(canvas: HTMLCanvasElement): void {
    if (this._initialized) return;
    this._initialized = true;

    window.addEventListener('keydown', (e) => {
      const code = e.keyCode;
      if (!this._keysDown.has(code)) {
        this._keysPressed.add(code);
        this._keyPressedQueue.push(code);
      } else if (e.repeat) {
        this._keysRepeated.add(code);
      }
      this._keysDown.add(code);
      if (!e.metaKey && !e.ctrlKey && e.keyCode !== 123) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this._keysDown.delete(e.keyCode);
    });

    window.addEventListener('keypress', (e) => {
      if (e.charCode >= 0x20 && e.charCode <= 0xFF) {
        this._charQueue.push(e.charCode);
      }
    });

    canvas.addEventListener('mousedown', (e) => {
      const btn = e.button;
      if (!this._mouseButtons.has(btn)) {
        this._mouseButtonsPressed.add(btn);
      }
      this._mouseButtons.add(btn);
    });

    canvas.addEventListener('mouseup', (e) => {
      this._mouseButtons.delete(e.button);
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this._mouseX = e.clientX - rect.left;
      this._mouseY = e.clientY - rect.top;
    });

    canvas.addEventListener('wheel', (e) => {
      if (e.deltaY < 0) this._wheelDelta += 1;
      else if (e.deltaY > 0) this._wheelDelta -= 1;
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  static isKeyDown(key: number): boolean {
    return this._keysDown.has(key);
  }

  static wasKeyPressed(key: number): boolean {
    return this._keysPressed.has(key);
  }

  static wasKeyPressedRepeat(key: number): boolean {
    return this._keysRepeated.has(key);
  }

  static isMouseButtonDown(button: number): boolean {
    return this._mouseButtons.has(button);
  }

  static wasMouseButtonPressed(button: number): boolean {
    return this._mouseButtonsPressed.has(button);
  }

  static firstKeyPressed(): number | null {
    if (this._keysPressed.size === 0) return null;
    return this._keysPressed.values().next().value ?? null;
  }

  static mousePosition(): [number, number] {
    return [int(this._mouseX), int(this._mouseY)];
  }

  static getCharPressed(): number {
    return this._charQueue.shift() ?? 0;
  }

  static getKeyPressed(): number {
    return this._keyPressedQueue.shift() ?? 0;
  }

  static mouseWheelDelta(): number {
    return this._wheelDelta;
  }

  static endFrame(): void {
    this._keysPressed.clear();
    this._keysRepeated.clear();
    this._mouseButtonsPressed.clear();
    this._wheelDelta = 0;
  }
}

export function isKeyDown(key: number): boolean {
  return InputState.isKeyDown(key);
}

export function wasKeyPressed(key: number): boolean {
  return InputState.wasKeyPressed(key);
}

export function isMouseButtonDown(button: number): boolean {
  return InputState.isMouseButtonDown(button);
}

export function wasMouseButtonPressed(button: number): boolean {
  return InputState.wasMouseButtonPressed(button);
}

export function mousePosition(): [number, number] {
  return InputState.mousePosition();
}
`;
}
