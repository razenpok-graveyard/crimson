export function renderProfileHooksModule(relativePath: string): string {
  return `// Port of ${relativePath}

export interface RenderProfileSink {
  onPassDuration(passName: string, durationMs: number): void;
}

let _activeSink: RenderProfileSink | null = null;
const _passStack: Array<[string, number]> = [];

export function setActiveSink(sink: RenderProfileSink | null): RenderProfileSink | null {
  const prev = _activeSink;
  _activeSink = sink;
  return prev;
}

export function clearPassStack(): void {
  _passStack.length = 0;
}

export function currentPassName(): string | null {
  if (_passStack.length === 0) return null;
  return _passStack[_passStack.length - 1][0];
}

export function beginPass(name: string): void {
  _passStack.push([String(name), performance.now()]);
}

export function endPass(_name: string): void {
  if (_passStack.length === 0) return;
  const popped = _passStack.pop();
  if (popped === undefined) return;
  const [passName, startMs] = popped;
  const durationMs = Math.max(0, performance.now() - startMs);
  if (_activeSink === null) return;
  _activeSink.onPassDuration(passName, durationMs);
}

export function profilePass(name: string): () => void {
  beginPass(name);
  return () => endPass(name);
}
`;
}
