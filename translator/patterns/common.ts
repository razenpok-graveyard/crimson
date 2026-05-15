import type { ImportDefinition } from '../model.js';
import { tsExportNameForPythonName } from '../naming.js';
import { tsImportPathForPythonImport } from '../paths.js';

export function isTypeAliasExpression(pythonExpression: string): boolean {
  const trimmed = pythonExpression.trim();
  if (/^(?:True|False|None|-?\d+(?:\.\d+)?|["'])/.test(trimmed)) {
    return false;
  }
  return /[\[\]|]/.test(trimmed) || /^(?:Callable|Literal|Sequence|dict|list|tuple)\b/.test(trimmed) || /^[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)?$/.test(trimmed);
}

export function isBareTypeAliasExpression(pythonExpression: string): boolean {
  const trimmed = pythonExpression.trim();
  if (/^[A-Z][A-Z0-9_]*(?: \| [A-Z][A-Z0-9_]*)+$/.test(trimmed)) {
    return false;
  }
  return /[\[\]|]/.test(trimmed) || /^(?:Callable|Literal|Sequence|dict|list|tuple)\b/.test(trimmed);
}

export function isCollectionsAbcTypeImport(trimmedLine: string): boolean {
  const typeImport = /^from collections\.abc import (.+)$/.exec(trimmedLine);
  if (typeImport === null) {
    return false;
  }
  return typeImport[1]
    .split(', ')
    .every((name) => ['Callable', 'Sequence'].includes(name));
}

export function isTypingOnlyImport(trimmedLine: string): boolean {
  const typeImport = /^from typing import (.+)$/.exec(trimmedLine);
  if (typeImport === null) {
    return false;
  }
  return typeImport[1]
    .split(', ')
    .every((name) => ['Annotated', 'Callable', 'Literal', 'Protocol', 'TYPE_CHECKING', 'TypeAlias', 'cast'].includes(name));
}

export function parseTypeCheckingImports(
  lines: string[],
  index: number,
  relativePath: string,
): { imports: ImportDefinition[]; nextIndex: number } | null {
  const imports: ImportDefinition[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (line.trim() === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith('    ')) {
      break;
    }
    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(line.trim());
    if (fromImport === null) {
      return null;
    }
    imports.push({
      modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
      names: fromImport[2].split(', ').map(tsExportNameForPythonName),
    });
    nextIndex += 1;
  }
  return { imports, nextIndex };
}
export function parseIndentedFunctionHeader(
  lines: string[],
  index: number,
  indent: string,
): { name: string; parametersText: string; returnType: string; nextIndex: number } | null {
  const oneLine = new RegExp(`^${indent}def ([A-Za-z_][A-Za-z0-9_]*)\\((.*)\\) -> ([^:]+):$`).exec(lines[index] ?? '');
  if (oneLine !== null) {
    return {
      name: oneLine[1],
      parametersText: oneLine[2],
      returnType: oneLine[3],
      nextIndex: index + 1,
    };
  }

  const start = new RegExp(`^${indent}def ([A-Za-z_][A-Za-z0-9_]*)\\($`).exec(lines[index] ?? '');
  if (start === null) {
    return null;
  }

  const parameterIndent = `${indent}    `;
  const parameterLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const close = new RegExp(`^${indent}\\) -> ([^:]+):$`).exec(lines[nextIndex] ?? '');
    if (close !== null) {
      return {
        name: start[1],
        parametersText: parameterLines.join(', '),
        returnType: close[1],
        nextIndex: nextIndex + 1,
      };
    }

    const line = lines[nextIndex] ?? '';
    if (!line.startsWith(parameterIndent)) {
      return null;
    }
    parameterLines.push(line.slice(parameterIndent.length).replace(/,$/, ''));
    nextIndex += 1;
  }
  return null;
}
export function parseIndentedDocstring(
  lines: string[],
  index: number,
  indent = '    ',
): { value: string; nextIndex: number } | null {
  const line = lines[index];
  if (line === undefined || !line.startsWith(indent)) {
    return null;
  }

  const start = /^"""(.*)$/.exec(line.slice(indent.length));
  if (start === null) {
    return null;
  }
  if (start[1].endsWith('"""')) {
    return {
      value: start[1].slice(0, -3),
      nextIndex: index + 1,
    };
  }

  const docLines = [start[1]];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (line === `${indent}"""`) {
      return {
        value: docLines.join('\n'),
        nextIndex: nextIndex + 1,
      };
    }
    if (line === '') {
      docLines.push('');
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith(indent)) {
      return null;
    }
    docLines.push(line.slice(indent.length));
    nextIndex += 1;
  }
  return null;
}
export function parseOneLineAllNames(trimmedLine: string): string[] | null {
  const allAssignment = /^__all__ = \[(.*)\]$/.exec(trimmedLine);
  if (allAssignment === null) {
    return null;
  }
  const namesText = allAssignment[1].trim();
  if (namesText === '') {
    return [];
  }
  const names: string[] = [];
  for (const nameText of namesText.split(', ')) {
    const name = /^"([A-Za-z_][A-Za-z0-9_]*)"$/.exec(nameText);
    if (name === null) {
      return null;
    }
    names.push(name[1]);
  }
  return names;
}
export function isIndentedBlockLine(lines: string[], index: number, indent: string): boolean {
  const line = lines[index] ?? '';
  return line.startsWith(indent) || (line.trim() === '' && (lines[index + 1] ?? '').startsWith(indent));
}

export function indentStatementLine(line: string): string {
  return line === '' ? '' : `  ${line}`;
}
export function inferPythonExpressionType(pythonExpression: string): string {
  const trimmed = pythonExpression.trim();
  if (/^(?:"[^"]*"|'[^']*')$/.test(trimmed)) {
    return 'string';
  }
  if (/^(?:True|False)$/.test(trimmed)) {
    return 'boolean';
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return 'number';
  }
  if (/^(?:int|float)\(.+\)$/.test(trimmed)) {
    return 'number';
  }
  if (/^(?:proj_origin|Vec2|rl\.Vector2)\(/.test(trimmed)) {
    return '{ x: number; y: number }';
  }
  return 'any';
}
export function stripTypeOnlyStatementSyntax(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const nestedFunction = /^(\s*)(?:async )?function ([A-Za-z_$][A-Za-z0-9_$]*)\(/.exec(line);
      const withoutNestedFunctionReturnType = nestedFunction === null ? line : `${nestedFunction[1]}function ${nestedFunction[2]}`;
      return withoutNestedFunctionReturnType.replace(/\(([^()]+)\): [^=]+ =>/g, '($1) =>');
    })
    .join('\n');
}
export function matchingCloseParen(value: string, openIndex: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && value[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}
export function splitTopLevelComma(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && value[index - 1] !== '\\') {
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
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter((part) => part !== '');
}

export function tsStringLiteral(pythonLiteral: string): string {
  if (!pythonLiteral.startsWith('"')) {
    return pythonLiteral;
  }
  const value = pythonLiteral
    .slice(1, -1)
    .replaceAll("'", "\\'");
  return `'${value}'`;
}

export function parsePythonStringExpression(expression: string): { fString: boolean; content: string } | null {
  const stringExpression = /^([fF]?)(["'])([\s\S]*)\2$/.exec(expression.trim());
  if (stringExpression === null) {
    return null;
  }
  return { fString: stringExpression[1] !== '', content: stringExpression[3] };
}

export function combinePythonStringExpressions(expressions: string[]): string {
  const parts = expressions.map(parsePythonStringExpression);
  if (parts.some((part) => part === null)) {
    return expressions.join(' + ');
  }
  const typedParts = parts as { fString: boolean; content: string }[];
  const prefix = typedParts.some((part) => part.fString) ? 'f' : '';
  const content = typedParts
    .map((part) => part.content)
    .join('')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
  return `${prefix}"${content}"`;
}

export function identifierPattern(identifier: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
