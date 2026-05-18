// Port of crimson/net/debug_log.py

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

const _TRACE_LOCK = null;
let tracePath: string | null = null;
let traceForwarder: ((arg0: string) => void) | null = null;

function _strftimeUtcNow(format = '%Y%m%dT%H%M%S.%fZ', utc = true): string {
  const now = new Date();
  const year = String(utc ? now.getUTCFullYear() : now.getFullYear()).padStart(4, '0');
  const month = String((utc ? now.getUTCMonth() : now.getMonth()) + 1).padStart(2, '0');
  const day = String(utc ? now.getUTCDate() : now.getDate()).padStart(2, '0');
  const hour = String(utc ? now.getUTCHours() : now.getHours()).padStart(2, '0');
  const minute = String(utc ? now.getUTCMinutes() : now.getMinutes()).padStart(2, '0');
  const second = String(utc ? now.getUTCSeconds() : now.getSeconds()).padStart(2, '0');
  const microsecond = `${String(now.getUTCMilliseconds()).padStart(3, '0')}000`;
  return format.replaceAll('%Y', year).replaceAll('%m', month).replaceAll('%d', day).replaceAll('%H', hour).replaceAll('%M', minute).replaceAll('%S', second).replaceAll('%f', microsecond);
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

function pythonCompareKeys(left: any, right: any): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const item = pythonCompareKeys(left[index], right[index]);
      if (item !== 0) {
        return item;
      }
    }
    return left.length - right.length;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function formatValue(value: unknown): string {
  const text = String(value);
  return text.replaceAll('\n', '\\n');
}

function formatFields(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(fields).sort((left, right) => pythonCompareKeys(left, right))) {
    parts.push(`${key}=${formatValue(fields[key])}`);
  }
  return parts.join(" ");
}

export function lanDebugLogPath(): string | null {
  const _withManager24_0 = _TRACE_LOCK as unknown as { __enter__?: () => unknown; __exit__?: (excType: unknown, exc: unknown, tb: unknown) => unknown; start?: () => unknown; stop?: () => unknown };
  if (_withManager24_0.__enter__ !== undefined) {
    _withManager24_0.__enter__();
  } else {
    _withManager24_0.start?.();
  }
  try {
    return tracePath;
  } finally {
    if (_withManager24_0.__exit__ !== undefined) {
      _withManager24_0.__exit__(null, null, null);
    } else {
      _withManager24_0.stop?.();
    }
  }
}

export function setLanDebugForwarder(forwarder: ((arg0: string) => void) | null): void {
  // Install a callback that receives each formatted debug log line.
  //
  // This is used by LAN clients to mirror their debug logs to the host for easier
  // cross-machine analysis. The callback is invoked outside the file lock.
  const _withManager34_0 = _TRACE_LOCK as unknown as { __enter__?: () => unknown; __exit__?: (excType: unknown, exc: unknown, tb: unknown) => unknown; start?: () => unknown; stop?: () => unknown };
  if (_withManager34_0.__enter__ !== undefined) {
    _withManager34_0.__enter__();
  } else {
    _withManager34_0.start?.();
  }
  try {
    traceForwarder = forwarder;
  } finally {
    if (_withManager34_0.__exit__ !== undefined) {
      _withManager34_0.__exit__(null, null, null);
    } else {
      _withManager34_0.stop?.();
    }
  }
}

export function initLanDebugLog(opts: { baseDir: string; role: string; mode: string; buildId: string; host: string; port: number; playerCount: number; autoStart: boolean; debugEnabled: boolean }): string {
  const baseDir = opts.baseDir;
  const role = opts.role;
  const mode = opts.mode;
  const buildId = opts.buildId;
  const host = opts.host;
  const port = opts.port;
  const playerCount = opts.playerCount;
  const autoStart = opts.autoStart;
  const debugEnabled = opts.debugEnabled;
  const roleName = role.trim().toLowerCase() || 'unknown';
  const timestamp = _strftimeUtcNow();
  const path = _pathJoin(baseDir, 'logs', 'lan', `lan-${roleName}-pid${globalThis.process?.pid ?? 0}-${timestamp}.log`);
  _mkdirParents(_dirname(String(path)));

  const _withManager56_0 = _TRACE_LOCK as unknown as { __enter__?: () => unknown; __exit__?: (excType: unknown, exc: unknown, tb: unknown) => unknown; start?: () => unknown; stop?: () => unknown };
  if (_withManager56_0.__enter__ !== undefined) {
    _withManager56_0.__enter__();
  } else {
    _withManager56_0.start?.();
  }
  try {
    tracePath = path;
  } finally {
    if (_withManager56_0.__exit__ !== undefined) {
      _withManager56_0.__exit__(null, null, null);
    } else {
      _withManager56_0.stop?.();
    }
  }

  lanDebugLog(
    'init',
    { role: roleName, mode: mode, buildId: buildId, host: host, port: int(port), playerCount: int(playerCount), autoStart: autoStart, debug: debugEnabled, pid: int(globalThis.process?.pid ?? 0) },
  );
  return path;
}

export function lanDebugLog(event: string, fields: Record<string, unknown> = {}): void {
  const timestamp = new Date().toISOString().replace('Z', '+00:00');
  const payload = formatFields(fields);
  let line = `${timestamp} event=${event.trim()}`;
  if (payload) {
    line += ` ${payload}`;
  }
  line += '\n';

  let forwarder: ((arg0: string) => void) | null;
  let handle: ReturnType<typeof _openTextFile>;
  const _withManager84_0 = _TRACE_LOCK as unknown as { __enter__?: () => unknown; __exit__?: (excType: unknown, exc: unknown, tb: unknown) => unknown; start?: () => unknown; stop?: () => unknown };
  if (_withManager84_0.__enter__ !== undefined) {
    _withManager84_0.__enter__();
  } else {
    _withManager84_0.start?.();
  }
  try {
    const path = tracePath;
    forwarder = traceForwarder;
    if (path === null) {
      return;
    }
    handle = _openTextFile(String(path), { mode: 'a', encoding: 'utf-8' });
    try {
      handle.write(line);
    } finally {
      handle.close();
    }
  } finally {
    if (_withManager84_0.__exit__ !== undefined) {
      _withManager84_0.__exit__(null, null, null);
    } else {
      _withManager84_0.stop?.();
    }
  }

  if (forwarder !== null) {
    forwarder(line);
  }
}

export function closeLanDebugLog(): void {
  const _withManager97_0 = _TRACE_LOCK as unknown as { __enter__?: () => unknown; __exit__?: (excType: unknown, exc: unknown, tb: unknown) => unknown; start?: () => unknown; stop?: () => unknown };
  if (_withManager97_0.__enter__ !== undefined) {
    _withManager97_0.__enter__();
  } else {
    _withManager97_0.start?.();
  }
  try {
    tracePath = null;
    traceForwarder = null;
  } finally {
    if (_withManager97_0.__exit__ !== undefined) {
      _withManager97_0.__exit__(null, null, null);
    } else {
      _withManager97_0.stop?.();
    }
  }
}
