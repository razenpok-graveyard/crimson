export function stripIgnorablePythonLines(python: string): string {
  return stripAllAssignments(stripFutureImports(python).split(/\r?\n/)).join('\n');
}

export function stripFutureImports(python: string): string {
  return python
    .split(/\r?\n/)
    .filter((line) => line.trim() !== 'from __future__ import annotations')
    .join('\n');
}

export function isOneLineAllAssignment(trimmedLine: string): boolean {
  return /^__all__ = \[[^\]]*\]$/.test(trimmedLine);
}

export function stripAllAssignments(lines: string[]): string[] {
  const stripped: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed.startsWith('__all__ = ')) {
      stripped.push(lines[index]);
      continue;
    }

    if (isOneLineAllAssignment(trimmed)) {
      continue;
    }

    while (index < lines.length && lines[index].trim() !== ']') {
      index += 1;
    }
  }

  return stripped;
}

export function isIntentionallyExcludedPath(relativePath: string): boolean {
  return relativePath.startsWith('crimson/debug_views/');
}

export function parseModuleDocstring(trimmedPython: string): { raw: string; value: string } | null {
  for (const quote of ['"""', "'''"]) {
    if (!trimmedPython.startsWith(quote) || !trimmedPython.endsWith(quote)) {
      continue;
    }
    return {
      raw: trimmedPython,
      value: trimmedPython.slice(quote.length, -quote.length),
    };
  }
  return null;
}

export function splitLeadingModuleDocstring(trimmedPython: string): { value: string; remainder: string } | null {
  for (const quote of ['"""', "'''"]) {
    if (!trimmedPython.startsWith(quote)) {
      continue;
    }

    const closeIndex = trimmedPython.indexOf(quote, quote.length);
    if (closeIndex === -1) {
      return null;
    }

    return {
      value: trimmedPython.slice(quote.length, closeIndex),
      remainder: trimmedPython.slice(closeIndex + quote.length),
    };
  }

  return null;
}

export function flattenFromImportBlocks(lines: string[]): string[] {
  const flattened: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const fromImportBlock = /^from ((?:\.)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import \($/.exec(trimmed);
    if (fromImportBlock === null) {
      flattened.push(lines[index]);
      continue;
    }

    const names: string[] = [];
    index += 1;
    while (index < lines.length && lines[index].trim() !== ')') {
      const name = lines[index].trim().replace(/,$/, '');
      if (name !== '') {
        names.push(name);
      }
      index += 1;
    }

    flattened.push(`from ${fromImportBlock[1]} import ${names.join(', ')}`);
  }

  return flattened;
}
