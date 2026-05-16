// Port of crimson/schema_inventory.py

import { readFileSync, readdirSync } from 'node:fs';
import pathModule from 'node:path';

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

function _posixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function _normalizedPosixPath(value: string): string {
  return _posixPath(pathModule.normalize(value));
}

function _stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, '');
}

function _rglobPy(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = pathModule.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.py')) {
        out.push(_posixPath(entryPath));
      }
    }
  };
  visit(root);
  return out.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function _topLevelImportStatements(text: string): string[] {
  const statements: string[] = [];
  const lines = text.split(/\r?\n/);
  let tripleQuote: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const wasInTripleQuote = tripleQuote !== null;
    tripleQuote = _nextTripleQuoteState(raw, tripleQuote);
    if (wasInTripleQuote || tripleQuote !== null) {
      continue;
    }
    if (/^\s/.test(raw)) {
      continue;
    }
    let statement = _stripPythonLineComment(raw).trim();
    if (!/^(?:import|from)\s/.test(statement)) {
      continue;
    }
    let parenDepth = _parenDepthDelta(statement);
    while ((parenDepth > 0 || statement.endsWith('\\')) && index + 1 < lines.length) {
      index += 1;
      const continuation = _stripPythonLineComment(lines[index]).trim();
      statement = `${statement.replace(/\\$/, '')} ${continuation}`;
      parenDepth += _parenDepthDelta(continuation);
    }
    statements.push(statement.replace(/\s+/g, ' ').trim());
  }
  return statements;
}

function _recordImportStatement(statement: string, currentModule: string, imports: Record<string, string>): void {
  const importStatement = /^import\s+(.+)$/.exec(statement);
  if (importStatement !== null) {
    for (const alias of _parseImportAliases(importStatement[1])) {
      imports[alias.asname ?? alias.name] = alias.name;
    }
    return;
  }

  const fromImport = /^from\s+([A-Za-z0-9_.]*)\s+import\s+(.+)$/.exec(statement);
  if (fromImport === null) {
    return;
  }
  const moduleSpec = fromImport[1];
  const level = moduleSpec.match(/^\.+/)?.[0].length ?? 0;
  const importedModule = moduleSpec.slice(level) || null;
  const importModule = _resolveImportModule({ currentModule, importedModule, level });
  for (const alias of _parseImportAliases(fromImport[2])) {
    if (alias.name === '*') {
      continue;
    }
    const target = alias.asname ?? alias.name;
    imports[target] = importModule ? `${importModule}.${alias.name}` : alias.name;
  }
}

function _parseImportAliases(value: string): Array<{ name: string; asname: string | null }> {
  let body = value.trim();
  if (body.startsWith('(') && body.endsWith(')')) {
    body = body.slice(1, -1);
  }
  return _splitTopLevelComma(body)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const alias = /^(.+?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(part);
      if (alias !== null) {
        return { name: alias[1].trim(), asname: alias[2] };
      }
      return { name: part, asname: null };
    });
}

function _classDefinitions(text: string): Array<{ name: string; bases: string[]; lineno: number }> {
  const definitions: Array<{ name: string; bases: string[]; lineno: number }> = [];
  const lines = text.split(/\r?\n/);
  let tripleQuote: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const wasInTripleQuote = tripleQuote !== null;
    tripleQuote = _nextTripleQuoteState(raw, tripleQuote);
    if (wasInTripleQuote || tripleQuote !== null) {
      continue;
    }
    let header = _stripPythonLineComment(raw).trim();
    if (!header.startsWith('class ')) {
      continue;
    }
    const lineno = index + 1;
    let parenDepth = _parenDepthDelta(header);
    while ((!header.endsWith(':') || parenDepth > 0) && index + 1 < lines.length) {
      index += 1;
      const continuation = _stripPythonLineComment(lines[index]).trim();
      header = `${header} ${continuation}`;
      parenDepth += _parenDepthDelta(continuation);
    }
    const parsed = _parseClassHeader(header);
    if (parsed !== null) {
      definitions.push({ ...parsed, lineno });
    }
  }
  return definitions;
}

function _parseClassHeader(header: string): { name: string; bases: string[] } | null {
  const classHeader = /^class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\((.*)\))?\s*:\s*$/.exec(header.replace(/\s+/g, ' '));
  if (classHeader === null) {
    return null;
  }
  const bases = classHeader[2] === undefined
    ? []
    : _splitTopLevelComma(classHeader[2])
      .map((part) => part.trim())
      .filter((part) => part.length > 0 && !/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(part));
  return { name: classHeader[1], bases };
}

function _splitTopLevelComma(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && !_characterIsEscaped(value, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      continue;
    }
    if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function _parenDepthDelta(value: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && !_characterIsEscaped(value, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
    }
  }
  return depth;
}

function _stripPythonLineComment(value: string): string {
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && !_characterIsEscaped(value, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') {
      return value.slice(0, index);
    }
  }
  return value;
}

function _nextTripleQuoteState(value: string, activeQuote: string | null): string | null {
  let quote = activeQuote;
  let index = 0;
  while (index < value.length) {
    if (quote !== null) {
      const closeIndex = value.indexOf(quote, index);
      if (closeIndex === -1) {
        return quote;
      }
      index = closeIndex + quote.length;
      quote = null;
      continue;
    }
    const singleIndex = value.indexOf("'''", index);
    const doubleIndex = value.indexOf('"""', index);
    if (singleIndex === -1 && doubleIndex === -1) {
      return null;
    }
    if (doubleIndex === -1 || (singleIndex !== -1 && singleIndex < doubleIndex)) {
      quote = "'''";
      index = singleIndex + 3;
    } else {
      quote = '"""';
      index = doubleIndex + 3;
    }
  }
  return quote;
}

function _characterIsEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

export class StructClass {
  readonly className: string;
  readonly fullName: string;
  readonly module: string;
  readonly path: string;
  readonly lineno: number;

  constructor(opts: {
    className: string;
    fullName: string;
    module: string;
    path: string;
    lineno: number;
  }) {
    this.className = opts.className;
    this.fullName = opts.fullName;
    this.module = opts.module;
    this.path = opts.path;
    this.lineno = opts.lineno;
    Object.freeze(this);
  }
}

export class InventorySummary {
  readonly totalStructs: number;
  readonly countsByBucket: Record<string, number>;
  readonly duplicateNames: Record<string, StructClass[]>;

  constructor(opts: {
    totalStructs: number;
    countsByBucket: Record<string, number>;
    duplicateNames: Record<string, StructClass[]>;
  }) {
    this.totalStructs = opts.totalStructs;
    this.countsByBucket = opts.countsByBucket;
    this.duplicateNames = opts.duplicateNames;
    Object.freeze(this);
  }
}

function _moduleNameForPath(opts: { sourceRoot: string; pyPath: string }): string {
  const sourceRoot = _stripTrailingSlashes(_normalizedPosixPath(opts.sourceRoot));
  const pyPath = _normalizedPosixPath(opts.pyPath);
  if (!(pyPath === sourceRoot || pyPath.startsWith(`${sourceRoot}/`))) {
    throw new Error(`${opts.pyPath} is not in the subpath of ${opts.sourceRoot}`);
  }
  const rel = pyPath.slice(sourceRoot.length).replace(/^\/+/, '');
  const parts = rel.split('/').filter((part) => part.length > 0);
  if (parts.length > 0 && parts[parts.length - 1].endsWith('.py')) {
    parts[parts.length - 1] = parts[parts.length - 1].slice(0, -3);
  }
  if (parts.length > 0 && parts[parts.length - 1] === '__init__') {
    parts.pop();
  }
  return parts.filter((part) => part.length > 0).join('.');
}

function _resolveImportModule(opts: {
  currentModule: string;
  importedModule: string | null;
  level: number;
}): string {
  if (opts.level <= 0) {
    return String(opts.importedModule ?? '');
  }

  const parts = opts.currentModule.split('.').filter((part) => part.length > 0);
  const baseParts = opts.level <= parts.length ? parts.slice(0, parts.length - opts.level) : [];
  if (opts.importedModule !== null) {
    baseParts.push(...opts.importedModule.split('.').filter((part) => part.length > 0));
  }
  return baseParts.join('.');
}

function _baseName(base: string): string | null {
  const trimmed = base.trim();
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(trimmed) ? trimmed : null;
}

function _resolveSymbol(symbol: string, opts: { imports: Record<string, string> }): string {
  if (symbol in opts.imports) {
    return opts.imports[symbol];
  }
  if (!symbol.includes('.')) {
    return symbol;
  }
  const [root, ...rest] = symbol.split('.');
  if (root in opts.imports) {
    return `${opts.imports[root]}.${rest.join('.')}`;
  }
  return symbol;
}

class _ClassInfo {
  readonly className: string;
  readonly fullName: string;
  readonly module: string;
  readonly path: string;
  readonly lineno: number;
  readonly resolvedBases: readonly string[];

  constructor(opts: {
    className: string;
    fullName: string;
    module: string;
    path: string;
    lineno: number;
    resolvedBases: readonly string[];
  }) {
    this.className = opts.className;
    this.fullName = opts.fullName;
    this.module = opts.module;
    this.path = opts.path;
    this.lineno = opts.lineno;
    this.resolvedBases = opts.resolvedBases;
    Object.freeze(this);
  }
}

function _iterClassInfos(sourceRoot: string): _ClassInfo[] {
  const infos: _ClassInfo[] = [];
  for (const pyPath of _rglobPy(sourceRoot)) {
    const module = _moduleNameForPath({ sourceRoot, pyPath });
    let text: string;
    try {
      text = readFileSync(pyPath, 'utf8');
    } catch {
      continue;
    }

    const imports: Record<string, string> = {};
    for (const statement of _topLevelImportStatements(text)) {
      _recordImportStatement(statement, module, imports);
    }

    for (const classDef of _classDefinitions(text)) {
      const fullName = module ? `${module}.${classDef.name}` : classDef.name;
      const bases: string[] = [];
      for (const base of classDef.bases) {
        const raw = _baseName(base);
        if (raw === null) {
          continue;
        }
        bases.push(_resolveSymbol(raw, { imports }));
      }
      infos.push(new _ClassInfo({
        className: classDef.name,
        fullName,
        module,
        path: _posixPath(pyPath),
        lineno: classDef.lineno,
        resolvedBases: bases,
      }));
    }
  }
  return infos;
}

function _bucketForPath(path: string): string {
  const parts = path.split('/');
  if (parts.length >= 3 && parts[0] === 'src' && parts[1] === 'crimson') {
    return parts[2];
  }
  if (parts.length >= 2 && parts[0] === 'src') {
    return parts[1];
  }
  return 'other';
}

export function listStructClasses(opts: { sourceRoot: string }): StructClass[] {
  const infos = _iterClassInfos(opts.sourceRoot);

  const byFullName = new Map(infos.map((info) => [info.fullName, info]));
  const structFullNames = new Set<string>();

  for (const info of infos) {
    if (info.resolvedBases.includes('msgspec.Struct')) {
      structFullNames.add(info.fullName);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const info of infos) {
      if (structFullNames.has(info.fullName)) {
        continue;
      }
      for (const base of info.resolvedBases) {
        if (structFullNames.has(base)) {
          structFullNames.add(info.fullName);
          changed = true;
          break;
        }
        if (!base.includes('.')) {
          const sameModuleBase = info.module ? `${info.module}.${base}` : base;
          if (structFullNames.has(sameModuleBase)) {
            structFullNames.add(info.fullName);
            changed = true;
            break;
          }
        }
      }
    }
  }

  const structs: StructClass[] = [];
  for (const fullName of Array.from(structFullNames).sort()) {
    const info = byFullName.get(fullName);
    if (info === undefined) {
      continue;
    }
    structs.push(new StructClass({
      className: info.className,
      fullName: info.fullName,
      module: info.module,
      path: info.path,
      lineno: info.lineno,
    }));
  }
  return structs;
}

export function summarizeInventory(opts: { structs: StructClass[] }): InventorySummary {
  const counts = new Map<string, number>();
  const byName = new Map<string, StructClass[]>();
  for (const item of opts.structs) {
    const bucket = _bucketForPath(item.path);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    const existing = byName.get(item.className) ?? [];
    existing.push(item);
    byName.set(item.className, existing);
  }
  const countsByBucket = Object.fromEntries(
    Array.from(counts.entries()).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
  const duplicateNames: Record<string, StructClass[]> = {};
  for (const [name, items] of Array.from(byName.entries()).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) {
    if (items.length > 1) {
      duplicateNames[name] = [...items].sort((a, b) => {
        const pathCmp = a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
        if (pathCmp !== 0) return pathCmp;
        return a.lineno - b.lineno;
      });
    }
  }
  return new InventorySummary({
    totalStructs: opts.structs.length,
    countsByBucket,
    duplicateNames,
  });
}

function _sortJsonKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => _sortJsonKeys(item));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return Object.fromEntries(entries.map(([key, item]) => [key, _sortJsonKeys(item)]));
  }
  return value;
}

function _ensureAsciiJson(text: string): string {
  let out = '';
  for (let idx = 0; idx < text.length; idx++) {
    const code = text.charCodeAt(idx);
    if (code <= 0x7F) {
      out += text[idx];
    } else {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    }
  }
  return out;
}

export function inventoryAsJson(opts: { summary: InventorySummary; structs: StructClass[] }): string {
  const payload: JsonValue = {
    total_structs: int(opts.summary.totalStructs),
    counts_by_bucket: Object.fromEntries(
      Object.entries(opts.summary.countsByBucket).map(([k, v]) => [String(k), int(v)]),
    ),
    duplicate_names: Object.fromEntries(
      Object.entries(opts.summary.duplicateNames).map(([name, items]) => [
        String(name),
        items.map((item) => ({
          path: item.path,
          lineno: int(item.lineno),
          module: item.module,
          full_name: item.fullName,
        })),
      ]),
    ),
    structs: opts.structs.map((item) => ({
      class_name: item.className,
      full_name: item.fullName,
      module: item.module,
      path: item.path,
      lineno: int(item.lineno),
    })),
  };
  return _ensureAsciiJson(JSON.stringify(_sortJsonKeys(payload), null, 2));
}
