// Port of crimson/net/debug_log.py

import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

const _TRACE_LOCK = null;
let tracePath: string | null = null;
let traceForwarder: ((arg0: string) => void) | null = null;

function _strftimeUtcNow(): string {
  const now = new Date();
  const year = String(now.getUTCFullYear()).padStart(4, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hour = String(now.getUTCHours()).padStart(2, '0');
  const minute = String(now.getUTCMinutes()).padStart(2, '0');
  const second = String(now.getUTCSeconds()).padStart(2, '0');
  const microsecond = `${String(now.getUTCMilliseconds()).padStart(3, '0')}000`;
  return `${year}${month}${day}T${hour}${minute}${second}.${microsecond}Z`;
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

function _openTextFile(path: string, opts: { mode: string; encoding?: 'utf-8' }): { write(text: string): void; close(): void } {
  return {
    write(text: string): void {
      if (opts.mode.includes('a')) {
        appendFileSync(path, text, { encoding: opts.encoding ?? 'utf-8' });
      } else {
        writeFileSync(path, text, { encoding: opts.encoding ?? 'utf-8' });
      }
    },
    close(): void {},
  };
}

function formatValue(value: unknown): string {
  const text = String(value);
  return text.replaceAll('\n', '\\n');
}

function formatFields(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const key of Object.keys(fields).sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
    parts.push(`${key}=${formatValue(fields[key])}`);
  }
  return parts.join(" ");
}

export function lanDebugLogPath(): string | null {
  {
    return tracePath;
  }
}

export function setLanDebugForwarder(forwarder: ((arg0: string) => void) | null): void {
  // Install a callback that receives each formatted debug log line.
  //
  // This is used by LAN clients to mirror their debug logs to the host for easier
  // cross-machine analysis. The callback is invoked outside the file lock.
  {
    traceForwarder = forwarder;
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

  {
    tracePath = path;
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
  {
    const path = tracePath;
    forwarder = traceForwarder;
    if (path === null) {
      return;
    }
    const handle = _openTextFile(String(path), { mode: 'a', encoding: 'utf-8' });
    try {
      handle.write(line);
    } finally {
      handle.close();
    }
  }

  if (forwarder !== null) {
    forwarder(line);
  }
}

export function closeLanDebugLog(): void {
  {
    tracePath = null;
    traceForwarder = null;
  }
}
