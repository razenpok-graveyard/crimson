// Port of grim/console.py

import { RGBA } from '@grim/color.ts';
import type { GrimMonoFont } from '@grim/fonts/grim-mono.ts';
import { drawGrimMonoText, loadGrimMonoFont } from '@grim/fonts/grim-mono.ts';
import type { SmallFontData } from '@grim/fonts/small.ts';
import { drawSmallText, loadSmallFont, measureSmallTextWidth } from '@grim/fonts/small.ts';
import { Vec2 } from '@grim/geom.ts';
import { clamp } from '@grim/math.ts';
import { InputState } from '@grim/input.ts';
import { readFileSync, writeFileSync, appendFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import * as wgl from '@wgl';
import * as paq from '@grim/paq.ts';

export type CommandHandler = (arg0: string[]) => void;

export const CONSOLE_LOG_NAME = 'console.log';
export const MAX_CONSOLE_LINES = 0x1000;
export const MAX_CONSOLE_INPUT = 0x3FF;
export const DEFAULT_CONSOLE_HEIGHT = 300;
export const EXTENDED_CONSOLE_HEIGHT = 480;
export const CONSOLE_VERSION_TEXT = 'Crimsonland 1.9.93';
export const CONSOLE_ANIM_SPEED = 3.5;
export const CONSOLE_BLINK_SPEED = 3.0;
export const CONSOLE_LINE_HEIGHT = 16.0;
export const CONSOLE_MONO_SCALE = 0.5;
export const CONSOLE_SMALL_SCALE = 1.0;
export const CONSOLE_TEXT_X = 10.0;
export const CONSOLE_INPUT_X_MONO = 26.0;
export const CONSOLE_VERSION_OFFSET_X = 210.0;
export const CONSOLE_VERSION_OFFSET_Y = 18.0;
export const FPS_COUNTER_X_SHORT = 45.0;
export const FPS_COUNTER_X_LONG = 51.0;
export const FPS_COUNTER_Y = 24.0;
export const FPS_COUNTER_CAP = 400;
export const FPS_COUNTER_CAP_TEXT = '400+';
export const FPS_COUNTER_ALPHA = 0.6;
export const CONSOLE_BORDER_HEIGHT = 4.0;
export const CONSOLE_BG_COLOR = [0.140625, 0.1875, 0.2890625] as const;
export const CONSOLE_BORDER_COLOR = [0.21875, 0.265625, 0.3671875] as const;
export const CONSOLE_PROMPT_MONO = '>';
export const CONSOLE_PROMPT_SMALL_FMT = '>%s';
export const CONSOLE_CARET_TEXT = '_';
export const SCRIPT_PAQ_NAMES = ['music.paq', 'crimson.paq', 'sfx.paq'] as const;

function pythonLstrip(value: string | Uint8Array): string | Uint8Array {
  const isWhitespace = (byte: number): boolean => byte === 9 || byte === 10 || byte === 11 || byte === 12 || byte === 13 || byte === 32;
  if (typeof value === 'string') {
    return value.replace(/^\s+/, '');
  }
  let start = 0;
  while (start < value.byteLength && isWhitespace(value[start])) {
    start += 1;
  }
  return value.slice(start);
}

function pythonStripChars(value: string, chars: string): string {
  const charSet = new Set(chars);
  let start = 0;
  let end = value.length;
  while (start < end && charSet.has(value[start])) {
    start += 1;
  }
  while (end > start && charSet.has(value[end - 1])) {
    end -= 1;
  }
  return value.slice(start, end);
}

function pythonStartsWith(value: string | Uint8Array, prefix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(prefix)) {
    return prefix.some((item) => pythonStartsWith(value, item));
  }
  if (typeof value === 'string' && typeof prefix === 'string') {
    return value.startsWith(prefix);
  }
  if (typeof value === 'string' || typeof prefix === 'string') {
    return false;
  }
  return value.byteLength >= prefix.byteLength && prefix.every((byte, index) => value[index] === byte);
}

function pythonEndsWith(value: string | Uint8Array, suffix: string | Uint8Array | (string | Uint8Array)[]): boolean {
  if (Array.isArray(suffix)) {
    return suffix.some((item) => pythonEndsWith(value, item));
  }
  if (typeof value === 'string' && typeof suffix === 'string') {
    return value.endsWith(suffix);
  }
  if (typeof value === 'string' || typeof suffix === 'string') {
    return false;
  }
  const offset = value.byteLength - suffix.byteLength;
  return offset >= 0 && suffix.every((byte, index) => value[offset + index] === byte);
}

function _pathJoin(...parts: Array<string | number>): string {
  const cleaned = parts.map((part, idx) => {
    const text = String(part);
    if (idx === 0) {
      const stripped = text.replace(/\/+$/g, '');
      if (stripped === '.') {
        return '';
      }
      return text === '/' ? '/' : stripped;
    }
    return text.replace(/^\/+|\/+$/g, '');
  }).filter((part) => part.length > 0);
  if (cleaned.length === 0) {
    return '';
  }
  if (cleaned[0] === '/') {
    return `/${cleaned.slice(1).join('/')}`;
  }
  return cleaned.join('/');
}

function _pathIsAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

function _dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) {
    return '.';
  }
  if (idx === 0) {
    return '/';
  }
  return path.slice(0, idx);
}

function _mkdirParents(path: string): void {
  mkdirSync(path, { recursive: true });
}

function _openTextFile(path: string, opts: { mode: string; encoding?: 'utf-8' }): { read(size: number): Uint8Array; write(data: string | Uint8Array): void; close(): void } {
  const binary = opts.mode.includes('b');
  let readOffset = 0;
  const readBuffer = opts.mode.includes('r') ? new Uint8Array(readFileSync(path)) : new Uint8Array();
  let wrote = false;
  return {
    read(size: number): Uint8Array {
      const chunk = readBuffer.slice(readOffset, readOffset + size);
      readOffset += chunk.byteLength;
      return chunk;
    },
    write(data: string | Uint8Array): void {
      const payload = binary || typeof data !== 'string' ? data : String(data);
      if (opts.mode.includes('a')) {
        appendFileSync(path, payload);
      } else if (wrote) {
        appendFileSync(path, payload);
      } else {
        writeFileSync(path, payload);
        wrote = true;
      }
    },
    close(): void {},
  };
}

function pythonSplitlines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (/(?:\r\n|\r|\n)$/.test(text)) {
    lines.pop();
  }
  return lines;
}

function pythonFloat(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  const text = String(value).trim();
  if (/^[+-]?nan$/i.test(text)) {
    return Number.NaN;
  }
  if (/^[+-]?inf(?:inity)?$/i.test(text)) {
    return text.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  const digits = String.raw`\d(?:_?\d)*`;
  const decimalPattern = new RegExp(String.raw`^[+-]?(?:(?:${digits}(?:\.(?:${digits})?)?|\.(?:${digits}))(?:[eE][+-]?${digits})?)$`);
  if (!decimalPattern.test(text)) {
    throw new Error(`invalid float literal: ${text}`);
  }
  return Number(text.replaceAll('_', ''));
}

export class ConsoleCvar {
  name: string;
  value: string;
  valueF: number;

  constructor(opts: {
    name: string;
    value: string;
    valueF: number;
  }) {
    this.name = opts.name;
    this.value = opts.value;
    this.valueF = opts.valueF;
  }

  static fromValue(name: string, value: string): ConsoleCvar {
    return new ConsoleCvar({ name: name, value: value, valueF: parseFloat(value) });
  }
}

export class ConsoleLog {
  baseDir: string;
  lines: string[];
  flushedIndex: number;

  constructor(opts: {
    baseDir: string;
    lines?: string[];
    flushedIndex?: number;
  }) {
    this.baseDir = opts.baseDir;
    this.lines = opts.lines ?? [];
    this.flushedIndex = opts.flushedIndex ?? 0;
  }

  log(opts: { message: string }): void;
  log(message: string): void;
  log(messageOrOpts: string | { message: string }): void {
    const message: string = typeof messageOrOpts === 'object' && messageOrOpts !== null ? messageOrOpts.message : messageOrOpts as string;
    this.lines.push(message);
    if (this.lines.length > MAX_CONSOLE_LINES) {
      const overflow = this.lines.length - MAX_CONSOLE_LINES;
      this.lines.splice(0, overflow);
      this.flushedIndex = Math.max(0, this.flushedIndex - overflow);
    }
  }

  clear(): void {
    this.lines.length = 0;
    this.flushedIndex = 0;
  }

  flush(): void {
    if (this.flushedIndex >= this.lines.length) {
      return;
    }
    const path = gameBuildPath(this.baseDir, CONSOLE_LOG_NAME);
    _mkdirParents(_dirname(String(path)));
    const handle = _openTextFile(String(path), { mode: 'a', encoding: 'utf-8' });
    try {
      for (const line of this.lines.slice(this.flushedIndex)) {
        handle.write(line.trimEnd() + '\n');
      }
    } finally {
      handle.close();
    }
    this.flushedIndex = this.lines.length;
  }
}

export class ConsoleState {
  baseDir: string;
  log: ConsoleLog;
  assetsDir: string | null;
  scriptDirs: readonly string[];
  commands: Map<string, CommandHandler>;
  cvars: Map<string, ConsoleCvar>;
  openFlag: boolean;
  inputEnabled: boolean;
  inputReady: boolean;
  inputBuffer: string;
  inputCaret: number;
  history: string[];
  historyIndex: number | null;
  historyPending: string;
  scrollOffset: number;
  heightPx: number;
  echoEnabled: boolean;
  quitRequested: boolean;
  promptString: string;
  _monoFont: GrimMonoFont | null;
  _smallFont: SmallFontData | null;
  _slideT: number;
  _offsetY: number;
  _blinkTime: number;

  constructor(opts: {
    baseDir: string;
    log: ConsoleLog;
    assetsDir?: string | null;
    scriptDirs?: readonly string[];
    commands?: Map<string, CommandHandler>;
    cvars?: Map<string, ConsoleCvar>;
    openFlag?: boolean;
    inputEnabled?: boolean;
    inputReady?: boolean;
    inputBuffer?: string;
    inputCaret?: number;
    history?: string[];
    historyIndex?: number | null;
    historyPending?: string;
    scrollOffset?: number;
    heightPx?: number;
    echoEnabled?: boolean;
    quitRequested?: boolean;
    promptString?: string;
    _monoFont?: GrimMonoFont | null;
    _smallFont?: SmallFontData | null;
    _slideT?: number;
    _offsetY?: number;
    _blinkTime?: number;
  }) {
    this.baseDir = opts.baseDir;
    this.log = opts.log;
    this.assetsDir = opts.assetsDir ?? null;
    this.scriptDirs = Array.from(opts.scriptDirs ?? []);
    this.commands = opts.commands ?? new Map();
    this.cvars = opts.cvars ?? new Map();
    this.openFlag = opts.openFlag ?? false;
    this.inputEnabled = opts.inputEnabled ?? false;
    this.inputReady = opts.inputReady ?? false;
    this.inputBuffer = opts.inputBuffer ?? '';
    this.inputCaret = opts.inputCaret ?? 0;
    this.history = opts.history ?? [];
    this.historyIndex = opts.historyIndex ?? null;
    this.historyPending = opts.historyPending ?? '';
    this.scrollOffset = opts.scrollOffset ?? 0;
    this.heightPx = opts.heightPx ?? DEFAULT_CONSOLE_HEIGHT;
    this.echoEnabled = opts.echoEnabled ?? true;
    this.quitRequested = opts.quitRequested ?? false;
    this.promptString = opts.promptString ?? '> %s';
    this._monoFont = opts._monoFont ?? null;
    this._smallFont = opts._smallFont ?? null;
    this._slideT = opts._slideT ?? 1.0;
    this._offsetY = opts._offsetY ?? 0.0;
    this._blinkTime = opts._blinkTime ?? 0.0;
  }

  registerCommand(opts: { name: string; handler: CommandHandler }): void;
  registerCommand(name: string, handler: CommandHandler): void;
  registerCommand(nameOrOpts: string | { name: string; handler: CommandHandler }, handlerArg: CommandHandler | undefined = undefined): void {
    const name: string = typeof nameOrOpts === 'object' && nameOrOpts !== null ? nameOrOpts.name : nameOrOpts as string;
    const handler: CommandHandler = typeof nameOrOpts === 'object' && nameOrOpts !== null ? nameOrOpts.handler : handlerArg as CommandHandler;
    this.commands.set(name, handler);
  }

  registerCvar(opts: { name: string; value: string }): void;
  registerCvar(name: string, value: string): void;
  registerCvar(nameOrOpts: string | { name: string; value: string }, valueArg: string | undefined = undefined): void {
    const name: string = typeof nameOrOpts === 'object' && nameOrOpts !== null ? nameOrOpts.name : nameOrOpts as string;
    const value: string = typeof nameOrOpts === 'object' && nameOrOpts !== null ? nameOrOpts.value : valueArg as string;
    this.cvars.set(name, ConsoleCvar.fromValue(name, value));
  }

  addScriptDir(opts: { path: string | null }): void;
  addScriptDir(path: string | null): void;
  addScriptDir(pathOrOpts: string | null | { path: string | null }): void {
    const path: string | null = typeof pathOrOpts === 'object' && pathOrOpts !== null ? pathOrOpts.path : pathOrOpts as string | null;
    if (path === null) {
      return;
    }
    if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(this.scriptDirs, path)) {
      return;
    }
    this.scriptDirs = [...this.scriptDirs, path];
  }

  setOpen(opts: { openFlag: boolean }): void;
  setOpen(openFlag: boolean): void;
  setOpen(openFlagOrOpts: boolean | { openFlag: boolean }): void {
    const openFlag: boolean = typeof openFlagOrOpts === 'object' && openFlagOrOpts !== null ? openFlagOrOpts.openFlag : openFlagOrOpts as boolean;
    this.openFlag = openFlag;
    this.inputEnabled = openFlag;
    this.inputReady = false;
    this.historyIndex = null;
    this._flushInputQueue();
  }

  toggleOpen(): void {
    this.setOpen(!this.openFlag);
  }

  handleHotkey(): void {
    if (InputState.wasKeyPressed(192)) {
      this.toggleOpen();
    }
  }

  execLine(opts: { line: string }): void;
  execLine(line: string): void;
  execLine(lineOrOpts: string | { line: string }): void {
    const line: string = typeof lineOrOpts === 'object' && lineOrOpts !== null ? lineOrOpts.line : lineOrOpts as string;
    const tokens = this._tokenizeLine(line);
    if (tokens.length === 0) {
      return;
    }
    const [name, args] = [tokens[0], tokens.slice(1)];
    const cvar = this.cvars.get(name) ?? null;
    if (cvar !== null) {
      if (args.length > 0) {
        const value = args.join(" ");
        cvar.value = value;
        cvar.valueF = parseFloat(value);
        this.log.log(`\\"${cvar.name}\\" set to \\"${cvar.value}\\" (${cvar.valueF.toFixed(6)})`);
      } else {
        this.log.log(`\\"${cvar.name}\\" is \\"${cvar.value}\\" (${cvar.valueF.toFixed(6)})`);
      }
      return;
    }
    const handler = this.commands.get(name) ?? null;
    if (handler !== null) {
      handler(args);
      return;
    }
    this.log.log(`Unknown command \\"${name}\\"`);
  }

  update(opts: { dt: number }): void;
  update(dt: number): void;
  update(dtOrOpts: number | { dt: number }): void {
    const dt: number = typeof dtOrOpts === 'object' && dtOrOpts !== null ? dtOrOpts.dt : dtOrOpts as number;
    const frameDt = Math.min(dt, 0.1);
    this._blinkTime += frameDt;
    this._updateSlide(frameDt);
    if (!this.openFlag || !this.inputEnabled) {
      return;
    }
    const ctrlDown = InputState.isKeyDown(17) || InputState.isKeyDown(17);
    if (InputState.wasKeyPressed(38)) {
      if (ctrlDown) {
        this._scrollLines(1);
      } else {
        this._historyPrev();
      }
    }
    if (InputState.wasKeyPressed(40)) {
      if (ctrlDown) {
        this._scrollLines(-1);
      } else {
        this._historyNext();
      }
    }
    if (InputState.wasKeyPressed(33)) {
      this._scrollLines(2);
    }
    if (InputState.wasKeyPressed(34)) {
      this._scrollLines(-2);
    }
    if (InputState.wasKeyPressed(37)) {
      this.inputCaret = Math.max(0, this.inputCaret - 1);
    }
    if (InputState.wasKeyPressed(39)) {
      this.inputCaret = Math.min(this.inputBuffer.length, this.inputCaret + 1);
    }
    if (InputState.wasKeyPressed(36)) {
      this._scrollLines(0x14);
    }
    if (InputState.wasKeyPressed(35)) {
      this.scrollOffset = 0;
    }
    if (InputState.wasKeyPressed(9)) {
      this._autocomplete();
    }
    if (InputState.wasKeyPressed(8)) {
      if (this.inputCaret > 0) {
        this._exitHistoryEdit();
        this.inputBuffer = (this.inputBuffer.slice(0, this.inputCaret - 1) + this.inputBuffer.slice(this.inputCaret));
        this.inputCaret -= 1;
      }
    }
    if (InputState.wasKeyPressed(46)) {
      if (this.inputCaret < this.inputBuffer.length) {
        this._exitHistoryEdit();
        this.inputBuffer = (this.inputBuffer.slice(0, this.inputCaret) + this.inputBuffer.slice(this.inputCaret + 1));
      }
    }
    if (InputState.wasKeyPressed(13)) {
      this._submitInput();
    }
    this._pollTextInput();
  }

  draw(): void {
    const height = this.heightPx;
    if (height <= 0.0) {
      return;
    }
    const ratio = this._openRatio(height);
    if (ratio <= 0.0) {
      return;
    }
    const screenW = wgl.getScreenWidth();
    const offsetY = this._offsetY;
    wgl.drawRectangle(0, int(offsetY), int(screenW), int(height), rgba(...CONSOLE_BG_COLOR, ratio));
    const borderY = int(offsetY + height - CONSOLE_BORDER_HEIGHT);
    wgl.drawRectangle(0, borderY, int(screenW), int(CONSOLE_BORDER_HEIGHT), rgba(...CONSOLE_BORDER_COLOR, ratio));

    const versionX = screenW - CONSOLE_VERSION_OFFSET_X;
    const versionY = offsetY + height - CONSOLE_VERSION_OFFSET_Y;
    this._drawVersionText(new Vec2(versionX, versionY), rgba(1.0, 1.0, 1.0, ratio * 0.3));

    const [visible, visibleCount] = this._visibleLogBlock(height);
    const inputY = offsetY + (visibleCount + 1) * CONSOLE_LINE_HEIGHT;
    const textColor = rgba(1.0, 1.0, 1.0, ratio);
    const useMono = this._useMonoFont();
    if (useMono) {
      this._drawMonoText(CONSOLE_PROMPT_MONO, new Vec2(CONSOLE_TEXT_X, inputY), textColor);
      this._drawMonoText(this.inputBuffer, new Vec2(CONSOLE_INPUT_X_MONO, inputY), textColor);
    } else {
      const prompt = CONSOLE_PROMPT_SMALL_FMT.replaceAll('%s', this.inputBuffer);
      this._drawSmallText(prompt, new Vec2(CONSOLE_TEXT_X, inputY), textColor);
    }

    const logColor = rgba(0.6, 0.6, 0.7, ratio);
    let y = offsetY + CONSOLE_LINE_HEIGHT;
    for (const line of visible) {
      if (useMono) {
        this._drawMonoText(line, new Vec2(CONSOLE_TEXT_X, y), logColor);
      } else {
        this._drawSmallText(line, new Vec2(CONSOLE_TEXT_X, y), logColor);
      }
      y += CONSOLE_LINE_HEIGHT;
    }

    const caretAlpha = ratio * this._caretBlinkAlpha();
    const caretColor = rgba(1.0, 1.0, 1.0, caretAlpha);
    const caretY = inputY + 2.0;
    let caretX: number;
    if (useMono) {
      caretX = CONSOLE_INPUT_X_MONO + this.inputCaret * 8.0;
      this._drawMonoText(CONSOLE_CARET_TEXT, new Vec2(caretX, caretY), caretColor);
    } else {
      caretX = this._smallCaretX();
      this._drawSmallText(CONSOLE_CARET_TEXT, new Vec2(caretX, caretY), caretColor);
    }
  }

  drawFpsCounter(): void {
    const cvar = this.cvars.get('cv_showFPS') ?? null;
    if (cvar === null || cvar.valueF === 0.0) {
      return;
    }
    const fps = Math.max(0, int(wgl.getFps()));
    let text: string;
    let posX: number;
    if (fps < FPS_COUNTER_CAP) {
      text = String(fps);
      posX = wgl.getScreenWidth() - FPS_COUNTER_X_SHORT;
    } else {
      text = FPS_COUNTER_CAP_TEXT;
      posX = wgl.getScreenWidth() - FPS_COUNTER_X_LONG;
    }
    const posY = wgl.getScreenHeight() - FPS_COUNTER_Y;
    this._drawSmallText(text, new Vec2(posX, posY), rgba(1.0, 1.0, 1.0, FPS_COUNTER_ALPHA));
  }

  close(): void {
    if (this._monoFont !== null) {
      this._monoFont = null;
    }
    if (this._smallFont !== null) {
      this._smallFont = null;
    }
  }

  _tokenizeLine(opts: { line: string }): string[];
  _tokenizeLine(line: string): string[];
  _tokenizeLine(lineOrOpts: string | { line: string }): string[] {
    const line: string = typeof lineOrOpts === 'object' && lineOrOpts !== null ? lineOrOpts.line : lineOrOpts as string;
    const stripped = line.trim();
    if (!stripped) {
      return [];
    }
    if (pythonStartsWith(stripped, '//')) {
      return [];
    }
    return (() => { const value = stripped; const text = String(value).trim(); return text === '' ? [] : text.split(/\s+/); })();
  }

  _promptText(): string {
    if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(this.promptString, '%s')) {
      return this.promptString.replaceAll('%s', this.inputBuffer);
    }
    return `${this.promptString}${this.inputBuffer}`;
  }

  _historyPrev(): void {
    if (this.history.length === 0) {
      return;
    }
    if (this.historyIndex === null) {
      this.historyIndex = this.history.length - 1;
      this.historyPending = this.inputBuffer;
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1;
    }
    this.inputBuffer = this.history[this.historyIndex];
    this.inputCaret = this.inputBuffer.length;
  }

  _historyNext(): void {
    if (this.historyIndex === null) {
      return;
    }
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      this.inputBuffer = this.history[this.historyIndex];
    } else {
      this.historyIndex = null;
      this.inputBuffer = this.historyPending;
    }
    this.inputCaret = this.inputBuffer.length;
  }

  _exitHistoryEdit(): void {
    if (this.historyIndex !== null) {
      this.historyIndex = null;
      this.historyPending = this.inputBuffer;
    }
  }

  _submitInput(): void {
    const line = this.inputBuffer.trim();
    this.inputReady = true;
    this.inputBuffer = '';
    this.inputCaret = 0;
    this.historyIndex = null;
    if (!line) {
      return;
    }
    if (this.echoEnabled) {
      if (((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(this.promptString, '%s')) {
        this.log.log(this.promptString.replaceAll('%s', line));
      } else {
        this.log.log(`${this.promptString}${line}`);
      }
    }
    if (this.history.length === 0 || this.history[this.history.length - 1] !== line) {
      this.history.push(line);
    }
    this.execLine(line);
    this.inputReady = false;
    this.scrollOffset = 0;
  }

  _pollTextInput(): void {
    while (true) {
      const value = InputState.getCharPressed();
      if (value === 0) {
        break;
      }
      if (value < 0x20 || value > 0xFF) {
        continue;
      }
      if (this.inputBuffer.length >= MAX_CONSOLE_INPUT) {
        continue;
      }
      const char = String.fromCodePoint(value);
      this._exitHistoryEdit();
      this.inputBuffer = (this.inputBuffer.slice(0, this.inputCaret) + char + this.inputBuffer.slice(this.inputCaret));
      this.inputCaret += 1;
    }
  }

  _autocomplete(): void {
    if (!this.inputBuffer) {
      return;
    }
    const tokenStart = this.inputBuffer.length - pythonLstrip(this.inputBuffer).length;
    if (tokenStart >= this.inputBuffer.length) {
      return;
    }
    let tokenEnd = this.inputBuffer.indexOf(' ', tokenStart);
    if (tokenEnd === -1) {
      tokenEnd = this.inputBuffer.length;
    }
    if (this.inputCaret > tokenEnd) {
      return;
    }
    const prefix = this.inputBuffer.slice(tokenStart, this.inputCaret);
    if (!prefix) {
      return;
    }
    let match = this._autocompleteName(prefix, this.cvars.keys());
    if (match === null) {
      match = this._autocompleteName(prefix, this.commands.keys());
    }
    if (match === null) {
      return;
    }
    this.inputBuffer = this.inputBuffer.slice(0, tokenStart) + match + this.inputBuffer.slice(tokenEnd);
    this.inputCaret = tokenStart + Array.from(match).length;
  }

  _autocompleteName(opts: { prefix: string; names: Iterable<string> }): string | null;
  _autocompleteName(prefix: string, names: Iterable<string>): string | null;
  _autocompleteName(prefixOrOpts: string | { prefix: string; names: Iterable<string> }, namesArg: Iterable<string> | undefined = undefined): string | null {
    const prefix: string = typeof prefixOrOpts === 'object' && prefixOrOpts !== null ? prefixOrOpts.prefix : prefixOrOpts as string;
    const names: Iterable<string> = typeof prefixOrOpts === 'object' && prefixOrOpts !== null ? prefixOrOpts.names : namesArg as Iterable<string>;
    for (const name of names) {
      if (name === prefix) {
        return name;
      }
    }
    for (const name of names) {
      if (pythonStartsWith(name, prefix)) {
        return name;
      }
    }
    return null;
  }

  _scrollLines(opts: { delta: number }): void;
  _scrollLines(delta: number): void;
  _scrollLines(deltaOrOpts: number | { delta: number }): void {
    const delta: number = typeof deltaOrOpts === 'object' && deltaOrOpts !== null ? deltaOrOpts.delta : deltaOrOpts as number;
    const maxOffset = this._maxScrollOffset();
    if (maxOffset <= 0) {
      this.scrollOffset = 0;
      return;
    }
    this.scrollOffset = Math.max(0, Math.min(maxOffset, this.scrollOffset + int(delta)));
  }

  _maxVisibleLines(opts: { height?: number | null }): number;
  _maxVisibleLines(height?: number | null): number;
  _maxVisibleLines(heightOrOpts: number | null | { height?: number | null } = null): number {
    const height: number | null = typeof heightOrOpts === 'object' && heightOrOpts !== null ? heightOrOpts.height ?? null : heightOrOpts ?? null;
    const useHeight = height !== null ? height : this.heightPx;
    if (useHeight <= 0.0) {
      return 0;
    }
    return Math.max(int(Math.floor(useHeight / CONSOLE_LINE_HEIGHT)) - 2, 0);
  }

  _maxScrollOffset(): number {
    const maxLines = this._maxVisibleLines();
    const logCount = this.log.lines.length;
    const visible = Math.min(logCount, maxLines);
    return Math.max(0, logCount - visible);
  }

  _visibleLogBlock(opts: { height: number }): [string[], number];
  _visibleLogBlock(height: number): [string[], number];
  _visibleLogBlock(heightOrOpts: number | { height: number }): [string[], number] {
    const height: number = typeof heightOrOpts === 'object' && heightOrOpts !== null ? heightOrOpts.height : heightOrOpts as number;
    const maxLines = this._maxVisibleLines(height);
    const logCount = this.log.lines.length;
    const visibleCount = Math.min(logCount, maxLines);
    if (visibleCount <= 0) {
      return [[], 0];
    }
    const maxOffset = Math.max(0, logCount - visibleCount);
    if (this.scrollOffset > maxOffset) {
      this.scrollOffset = maxOffset;
    }
    const start = Math.max(0, logCount - visibleCount - this.scrollOffset);
    const end = Math.min(logCount, start + visibleCount);
    return [this.log.lines.slice(start, end), visibleCount];
  }

  _updateSlide(opts: { dt: number }): void;
  _updateSlide(dt: number): void;
  _updateSlide(dtOrOpts: number | { dt: number }): void {
    const dt: number = typeof dtOrOpts === 'object' && dtOrOpts !== null ? dtOrOpts.dt : dtOrOpts as number;
    if (this.openFlag) {
      this._slideT = Math.max(0.0, this._slideT - dt * CONSOLE_ANIM_SPEED);
    } else {
      this._slideT = Math.min(1.0, this._slideT + dt * CONSOLE_ANIM_SPEED);
    }
    const height = this.heightPx;
    if (height <= 0.0) {
      this._offsetY = -height;
      return;
    }
    const eased = Math.sin((1.0 - this._slideT) * Math.PI / 2.0);
    this._offsetY = eased * height - height;
  }

  _openRatio(opts: { height: number }): number;
  _openRatio(height: number): number;
  _openRatio(heightOrOpts: number | { height: number }): number {
    const height: number = typeof heightOrOpts === 'object' && heightOrOpts !== null ? heightOrOpts.height : heightOrOpts as number;
    if (height <= 0.0) {
      return 0.0;
    }
    return clamp((height + this._offsetY) / height, 0.0, 1.0);
  }

  _caretBlinkAlpha(): number {
    const pulse = Math.sin(this._blinkTime * CONSOLE_BLINK_SPEED);
    const value = Math.max(0.2, Math.abs(pulse) ** 2);
    return clamp(value, 0.0, 1.0);
  }

  _useMonoFont(): boolean {
    const cvar = this.cvars.get('con_monoFont') ?? null;
    if (cvar === null) {
      return false;
    }
    return Boolean(cvar.valueF);
  }

  _ensureMonoFont(): GrimMonoFont | null {
    if (this._monoFont !== null) {
      return this._monoFont;
    }
    if (this.assetsDir === null) {
      throw new Error('missing assets dir');
    }
    this._monoFont = loadGrimMonoFont(this.assetsDir);
    return this._monoFont;
  }

  _ensureSmallFont(): SmallFontData | null {
    if (this._smallFont !== null) {
      return this._smallFont;
    }
    if (this.assetsDir === null) {
      throw new Error('missing assets dir');
    }
    this._smallFont = loadSmallFont(this.assetsDir);
    return this._smallFont;
  }

  _drawMonoText(opts: { text: string; pos: Vec2; color: wgl.Color }): void;
  _drawMonoText(text: string, pos: Vec2, color: wgl.Color): void;
  _drawMonoText(textOrOpts: string | { text: string; pos: Vec2; color: wgl.Color }, posArg: Vec2 | undefined = undefined, colorArg: wgl.Color | undefined = undefined): void {
    const text: string = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.text : textOrOpts as string;
    const pos: Vec2 = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.pos : posArg as Vec2;
    const color: wgl.Color = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.color : colorArg as wgl.Color;
    const font = this._ensureMonoFont();
    if (font === null) {
      wgl.drawText(text, int(pos.x), int(pos.y), int(16 * CONSOLE_MONO_SCALE), color);
      return;
    }
    const advance = font.advance * CONSOLE_MONO_SCALE;
    drawGrimMonoText(font, text, new Vec2(pos.x - advance, pos.y), CONSOLE_MONO_SCALE, color);
  }

  _drawSmallText(opts: { text: string; pos: Vec2; color: wgl.Color }): void;
  _drawSmallText(text: string, pos: Vec2, color: wgl.Color): void;
  _drawSmallText(textOrOpts: string | { text: string; pos: Vec2; color: wgl.Color }, posArg: Vec2 | undefined = undefined, colorArg: wgl.Color | undefined = undefined): void {
    const text: string = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.text : textOrOpts as string;
    const pos: Vec2 = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.pos : posArg as Vec2;
    const color: wgl.Color = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.color : colorArg as wgl.Color;
    const font = this._ensureSmallFont();
    if (font === null) {
      wgl.drawText(text, int(pos.x), int(pos.y), int(16 * CONSOLE_SMALL_SCALE), color);
      return;
    }
    drawSmallText(font, text, pos, color);
  }

  _drawVersionText(pos: Vec2, color: wgl.Color): void {
    const font = this._ensureSmallFont();
    if (font === null) {
      this._drawMonoText(CONSOLE_VERSION_TEXT, pos, color);
      return;
    }
    drawSmallText(font, CONSOLE_VERSION_TEXT, pos, color);
  }

  _smallCaretX(): number {
    const font = this._ensureSmallFont();
    if (font === null) {
      return CONSOLE_TEXT_X + 16.0 + this.inputCaret * 8.0;
    }
    const promptW = measureSmallTextWidth(font, CONSOLE_PROMPT_SMALL_FMT.replaceAll('%s', ''));
    const inputW = measureSmallTextWidth(font, this.inputBuffer.slice(0, this.inputCaret));
    return CONSOLE_TEXT_X + promptW + inputW;
  }

  _flushInputQueue(): void {
    while (InputState.getCharPressed()) {
    }
    while (InputState.getKeyPressed()) {
    }
  }

  tokenizeLine(opts: { line: string }): string[];
  tokenizeLine(line: string): string[];
  tokenizeLine(lineOrOpts: string | { line: string }): string[] {
    const line: string = typeof lineOrOpts === 'object' && lineOrOpts !== null ? lineOrOpts.line : lineOrOpts as string;
    return this._tokenizeLine(line);
  }

  promptText(): string {
    return this._promptText();
  }

  historyPrev(): void {
    this._historyPrev();
  }

  historyNext(): void {
    this._historyNext();
  }

  exitHistoryEdit(): void {
    this._exitHistoryEdit();
  }

  submitInput(): void {
    this._submitInput();
  }

  pollTextInput(): void {
    this._pollTextInput();
  }

  autocomplete(): void {
    this._autocomplete();
  }

  autocompleteName(opts: { prefix: string; names: Iterable<string> }): string | null;
  autocompleteName(prefix: string, names: Iterable<string>): string | null;
  autocompleteName(prefixOrOpts: string | { prefix: string; names: Iterable<string> }, namesArg: Iterable<string> | undefined = undefined): string | null {
    const prefix: string = typeof prefixOrOpts === 'object' && prefixOrOpts !== null ? prefixOrOpts.prefix : prefixOrOpts as string;
    const names: Iterable<string> = typeof prefixOrOpts === 'object' && prefixOrOpts !== null ? prefixOrOpts.names : namesArg as Iterable<string>;
    return this._autocompleteName(prefix, names);
  }

  scrollLines(opts: { delta: number }): void;
  scrollLines(delta: number): void;
  scrollLines(deltaOrOpts: number | { delta: number }): void {
    const delta: number = typeof deltaOrOpts === 'object' && deltaOrOpts !== null ? deltaOrOpts.delta : deltaOrOpts as number;
    this._scrollLines(delta);
  }

  maxVisibleLines(opts: { height?: number | null }): number;
  maxVisibleLines(height?: number | null): number;
  maxVisibleLines(heightOrOpts: number | null | { height?: number | null } = null): number {
    const height: number | null = typeof heightOrOpts === 'object' && heightOrOpts !== null ? heightOrOpts.height ?? null : heightOrOpts ?? null;
    return this._maxVisibleLines(height);
  }

  maxScrollOffset(): number {
    return this._maxScrollOffset();
  }

  visibleLogBlock(opts: { height: number }): [string[], number];
  visibleLogBlock(height: number): [string[], number];
  visibleLogBlock(heightOrOpts: number | { height: number }): [string[], number] {
    const height: number = typeof heightOrOpts === 'object' && heightOrOpts !== null ? heightOrOpts.height : heightOrOpts as number;
    return this._visibleLogBlock(height);
  }

  updateSlide(opts: { dt: number }): void;
  updateSlide(dt: number): void;
  updateSlide(dtOrOpts: number | { dt: number }): void {
    const dt: number = typeof dtOrOpts === 'object' && dtOrOpts !== null ? dtOrOpts.dt : dtOrOpts as number;
    this._updateSlide(dt);
  }

  openRatio(opts: { height: number }): number;
  openRatio(height: number): number;
  openRatio(heightOrOpts: number | { height: number }): number {
    const height: number = typeof heightOrOpts === 'object' && heightOrOpts !== null ? heightOrOpts.height : heightOrOpts as number;
    return this._openRatio(height);
  }

  caretBlinkAlpha(): number {
    return this._caretBlinkAlpha();
  }

  useMonoFont(): boolean {
    return this._useMonoFont();
  }

  ensureMonoFont(): GrimMonoFont | null {
    return this._ensureMonoFont();
  }

  ensureSmallFont(): SmallFontData | null {
    return this._ensureSmallFont();
  }

  drawMonoText(opts: { text: string; pos: Vec2; color: wgl.Color }): void;
  drawMonoText(text: string, pos: Vec2, color: wgl.Color): void;
  drawMonoText(textOrOpts: string | { text: string; pos: Vec2; color: wgl.Color }, posArg: Vec2 | undefined = undefined, colorArg: wgl.Color | undefined = undefined): void {
    const text: string = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.text : textOrOpts as string;
    const pos: Vec2 = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.pos : posArg as Vec2;
    const color: wgl.Color = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.color : colorArg as wgl.Color;
    this._drawMonoText(text, pos, color);
  }

  drawSmallText(opts: { text: string; pos: Vec2; color: wgl.Color }): void;
  drawSmallText(text: string, pos: Vec2, color: wgl.Color): void;
  drawSmallText(textOrOpts: string | { text: string; pos: Vec2; color: wgl.Color }, posArg: Vec2 | undefined = undefined, colorArg: wgl.Color | undefined = undefined): void {
    const text: string = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.text : textOrOpts as string;
    const pos: Vec2 = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.pos : posArg as Vec2;
    const color: wgl.Color = typeof textOrOpts === 'object' && textOrOpts !== null ? textOrOpts.color : colorArg as wgl.Color;
    this._drawSmallText(text, pos, color);
  }

  drawVersionText(pos: Vec2, color: wgl.Color): void {
    this._drawVersionText(pos, color);
  }

  smallCaretX(): number {
    return this._smallCaretX();
  }

  flushInputQueue(): void {
    this._flushInputQueue();
  }
}

export function gameBuildPath(baseDir: string, name: string): string {
  return _pathJoin(baseDir, name);
}

function parseFloat(value: string): number {
  try {
    return pythonFloat(value);
  } catch (exc) {
    return 0.0;
  }
}

function normalizeScriptPath(name: string): string {
  const raw = pythonStripChars(name.trim(), '\"\'');
  const normalized = raw.replaceAll('\\', '/');
  return normalized;
}

function resolveScriptPath(console: ConsoleState, target: string): string | null {
  if (_pathIsAbsolute(String(target))) {
    return (existsSync(String(target)) && statSync(String(target)).isFile()) ? target : null;
  }
  for (const base of console.scriptDirs) {
    const candidate = _pathJoin(base, target);
    if ((existsSync(String(candidate)) && statSync(String(candidate)).isFile())) {
      return candidate;
    }
  }
  return null;
}

function primaryScriptDirs(console: ConsoleState): string[] {
  const dirs: string[] = [console.baseDir];
  if (console.assetsDir !== null && (!((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(dirs, console.assetsDir))) {
    dirs.push(console.assetsDir);
  }
  return Array.from(dirs);
}

function resolveScriptPathIn(target: string, roots: Iterable<string>): string | null {
  if (_pathIsAbsolute(String(target))) {
    return (existsSync(String(target)) && statSync(String(target)).isFile()) ? target : null;
  }
  for (const base of roots) {
    const candidate = _pathJoin(base, target);
    if ((existsSync(String(candidate)) && statSync(String(candidate)).isFile())) {
      return candidate;
    }
  }
  return null;
}

function* iterScriptPaqPaths(console: ConsoleState): Iterable<string> {
  const roots: string[] = [];
  if (console.assetsDir !== null) {
    roots.push(console.assetsDir);
  }
  if (!((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(roots, console.baseDir)) {
    roots.push(console.baseDir);
  }
  for (const root of roots) {
    for (const name of SCRIPT_PAQ_NAMES) {
      const path = _pathJoin(root, name);
      if ((existsSync(String(path)) && statSync(String(path)).isFile())) {
        yield path;
      }
    }
  }
}

function loadScriptFromPaq(console: ConsoleState, target: string): string | null {
  if (_pathIsAbsolute(String(target))) {
    return null;
  }
  const normalized = String(target).replaceAll('\\', '/').replaceAll('\\', '/');
  const normalizedLower = normalized.toLowerCase();
  for (const paqPath of iterScriptPaqPaths(console)) {
    try {
      for (let [name, data] of paq.iterEntries(paqPath)) {
        const entryName = name.replaceAll('\\', '/');
        if (entryName === normalized || entryName.toLowerCase() === normalizedLower) {
          return new TextDecoder('utf-8').decode(data);
        }
      }
    } catch (exc) {
      continue;
    }
  }
  return null;
}

function rgba(r: number, g: number, b: number, a: number): wgl.Color {
  const c = new RGBA(r, g, b, a).clamped();
  return wgl.makeColor(int(c.r * 255.0) / 255, int(c.g * 255.0) / 255, int(c.b * 255.0) / 255, int(c.a * 255.0) / 255);
}

export function createConsole(baseDir: string, assetsDir: string | null = null): ConsoleState {
  let scriptDirs: readonly string[] = [baseDir];
  if (assetsDir !== null && assetsDir !== baseDir) {
    scriptDirs = [...scriptDirs, assetsDir];
  }
  const console = new ConsoleState({ baseDir: baseDir, log: new ConsoleLog({ baseDir: baseDir }), assetsDir: assetsDir, scriptDirs: scriptDirs });
  console.registerCvar('version', CONSOLE_VERSION_TEXT);
  console.registerCvar('con_monoFont', '1');
  if (console.openFlag) {
    console._slideT = 0.0;
    console._offsetY = 0.0;
  } else {
    console._slideT = 1.0;
    console._offsetY = -console.heightPx;
  }
  registerCoreCommands(console);
  return console;
}

function makeNoopCommand(console: ConsoleState, name: string): CommandHandler {
  const _handler = (args: string[]): void => {
    console.log.log(`command ${name} called with ${args.length} args`);
  };

  return _handler;
}

export function registerBootCommands(console: ConsoleState, handlers: Record<string, CommandHandler> | null = null): void {
  const resolved = handlers || {};
  const commands: [string, string, string, string, string, string, string, string, string, string] = ['setGammaRamp', 'snd_addGameTune', 'generateterrain', 'telltimesurvived', 'setresourcepaq', 'loadtexture', 'openurl', 'sndfreqadjustment', 'rendermode', 'togglertx'];
  for (const name of commands) {
    let handler = resolved[name] ?? null;
    if (handler === null) {
      handler = makeNoopCommand(console, name);
    }
    console.registerCommand(name, handler);
  }
}

export function registerCoreCvars(console: ConsoleState, width: number, height: number): void {
  // Defaults match `register_core_cvars` (0x00402c00) in `crimsonland.exe`.
  console.registerCvar('cv_silentloads', '1');
  console.registerCvar('cv_bodiesFade', '1');
  console.registerCvar('cv_uiTransparency', '1');
  console.registerCvar('cv_uiPointFilterPanels', '0');
  console.registerCvar('cv_enableMousePointAndClickMovement', '0');
  console.registerCvar('cv_verbose', '0');
  console.registerCvar('cv_terrainBodiesTransparency', '0');
  console.registerCvar('cv_uiSmallIndicators', '0');
  console.registerCvar('cv_aimEnhancementFade', '0.7');
  console.registerCvar('cv_friendlyFire', '0');
  console.registerCvar('cv_lanLockstepEnabled', '0');
  console.registerCvar('cv_lanPlayerRings', '0');
  console.registerCvar('cv_showFPS', '0');
  console.registerCvar('cv_padAimDistMul', '96');
  console.registerCvar('v_width', String(width));
  console.registerCvar('v_height', String(height));
}

export function registerCoreCommands(console: ConsoleState): void {
  const cmdlist = (args: string[]): void => {
    for (const name of console.commands.keys()) {
      console.log.log(name);
    }
    console.log.log(`${console.commands.size} commands`);
  };

  const varsCmd = (args: string[]): void => {
    for (const name of console.cvars.keys()) {
      console.log.log(name);
    }
    console.log.log(`${console.cvars.size} variables`);
  };

  const cmdSet = (args: string[]): void => {
    if (args.length < 2) {
      console.log.log('Usage: set <var> <value>');
      return;
    }
    const name = args[0];
    const value = args.slice(1).join(" ");
    console.registerCvar(name, value);
    console.log.log(`'${name}' set to '${value}'`);
  };

  const cmdEcho = (args: string[]): void => {
    if (args.length === 0) {
      console.log.log(`echo is ${console.echoEnabled ? 'on' : 'off'}`);
      return;
    }
    const mode = args[0].toLowerCase();
    if (mode === 'on' || mode === 'off') {
      console.echoEnabled = mode === 'on';
      console.log.log(`echo ${mode}`);
      return;
    }
    console.log.log(args.join(" "));
  };

  const cmdQuit = (args: string[]): void => {
    console.quitRequested = true;
  };

  const cmdClear = (args: string[]): void => {
    console.log.clear();
    console.scrollOffset = 0;
  };

  const cmdExtend = (args: string[]): void => {
    console.heightPx = EXTENDED_CONSOLE_HEIGHT;
  };

  const cmdMinimize = (args: string[]): void => {
    console.heightPx = DEFAULT_CONSOLE_HEIGHT;
  };

  const cmdExec = (args: string[]): void => {
    if (args.length === 0) {
      console.log.log('exec <script>');
      return;
    }
    const target = normalizeScriptPath(args[0]);
    let scriptText: string | null;
    let primaryDirs: ReturnType<typeof primaryScriptDirs>;
    let path: string | null;
    try {
      scriptText = null;
      primaryDirs = primaryScriptDirs(console);
      path = resolveScriptPathIn(target, primaryDirs);
      if (path === null) {
        scriptText = loadScriptFromPaq(console, target);
      }
      if (path === null && scriptText === null) {
        const fallbackDirs = Array.from(console.scriptDirs).filter((path) => !((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(primaryDirs, path));
        path = resolveScriptPathIn(target, fallbackDirs);
      }
      if (path === null && scriptText === null) {
        console.log.log(`Cannot open file '${args[0]}'`);
        return;
      }
      console.log.log(`Executing '${args[0]}'`);
      if (scriptText === null) {
        if (!(path !== null)) throw new Error();
        scriptText = readFileSync(String(path), 'utf8');
      }
      for (const rawLine of pythonSplitlines(scriptText)) {
        const line = rawLine.trim();
        if (line) {
          console.execLine(line);
        }
      }
    } catch (exc) {
      console.log.log(`Cannot open file '${args[0]}'`);
    }
  };

  console.registerCommand('cmdlist', cmdlist);
  console.registerCommand('vars', varsCmd);
  console.registerCommand('set', cmdSet);
  console.registerCommand('echo', cmdEcho);
  console.registerCommand('quit', cmdQuit);
  console.registerCommand('clear', cmdClear);
  console.registerCommand('extendconsole', cmdExtend);
  console.registerCommand('minimizeconsole', cmdMinimize);
  console.registerCommand('exec', cmdExec);
}
