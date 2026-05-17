// Port of crimson/typo/typing.py

export const TYPING_MAX_CHARS = 17;

export class TypingBuffer {
  text: string;
  submitCount: number;
  matchCount: number;

  constructor(opts: {
    text?: string;
    submitCount?: number;
    matchCount?: number;
  } = {}) {
    this.text = opts.text ?? '';
    this.submitCount = opts.submitCount ?? 0;
    this.matchCount = opts.matchCount ?? 0;
  }

  clear(): void {
    this.text = '';
  }

  backspace(): void {
    if (this.text) {
      this.text = this.text.slice(0, -1);
    }
  }

  pushChar(opts: { ch: string }): void;
  pushChar(ch: string): void;
  pushChar(chOrOpts: string | { ch: string }): void {
    const ch: string = typeof chOrOpts === 'object' && chOrOpts !== null && 'ch' in chOrOpts ? chOrOpts.ch : chOrOpts as string;
    if (!ch) {
      return;
    }
    if (this.text.length >= TYPING_MAX_CHARS) {
      return;
    }
    this.text += ch[0];
  }

  submit(opts: { matched: boolean }): string | null {
    const matched = opts.matched;
    if (!this.text) {
      return null;
    }

    const entered = this.text;
    this.submitCount += 1;
    if (matched) {
      this.matchCount += 1;
    }
    this.clear();
    return entered;
  }
}
