import type { ImportDefinition, TypeAlias } from '../model.js';
import { tsExportNameForPythonName } from '../naming.js';
import { tsImportPathForPythonImport } from '../paths.js';

export function isTypeAliasExpression(pythonExpression: string): boolean {
  const trimmed = pythonExpression.trim();
  if (/^(?:True|False|None|-?\d+(?:\.\d+)?|["'])/.test(trimmed)) {
    return false;
  }
  if (!hasBalancedSquareBrackets(trimmed)) {
    return false;
  }
  if (trimmed.includes('(') || trimmed.includes('{')) {
    return false;
  }
  return /[\[\]|]/.test(trimmed) || /^(?:Callable|Literal|Sequence|dict|list|tuple)\b/.test(trimmed) || /^[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)?$/.test(trimmed);
}

export function isBareTypeAliasExpression(pythonExpression: string): boolean {
  const trimmed = pythonExpression.trim();
  if (/^(?:True|False|None|-?\d+(?:\.\d+)?|["'])/.test(trimmed)) {
    return false;
  }
  if (/^[A-Z][A-Z0-9_]*(?: \| [A-Z][A-Z0-9_]*)+$/.test(trimmed)) {
    return false;
  }
  if (!hasBalancedSquareBrackets(trimmed)) {
    return false;
  }
  if (trimmed.includes('(') || trimmed.includes('{')) {
    return false;
  }
  return /[\[\]|]/.test(trimmed) || /^(?:Callable|Literal|Sequence|dict|list|tuple)\b/.test(trimmed);
}

function hasBalancedSquareBrackets(value: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && !characterIsEscaped(value, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

export function isCollectionsAbcTypeImport(trimmedLine: string): boolean {
  const typeImport = /^from collections\.abc import (.+)$/.exec(trimmedLine);
  if (typeImport === null) {
    return false;
  }
  return typeImport[1]
    .split(', ')
    .every((name) => ['Callable', 'Iterable', 'Iterator', 'Mapping', 'MutableSequence', 'Sequence'].includes(name));
}

export function isTypingOnlyImport(trimmedLine: string): boolean {
  const typeImport = /^from typing import (.+)$/.exec(trimmedLine);
  if (typeImport === null) {
    return false;
  }
  return typeImport[1]
    .split(', ')
    .every((name) => ['Annotated', 'Any', 'Callable', 'Final', 'Literal', 'Protocol', 'TYPE_CHECKING', 'TypeAlias', 'TypeVar', 'cast', 'runtime_checkable'].includes(name));
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
    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import (.+)$/.exec(line.trim());
    if (fromImport === null) {
      return null;
    }
    const names = parseImportNames(fromImport[2]);
    if (names === null) {
      return null;
    }
    imports.push({
      modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
      names,
    });
    nextIndex += 1;
  }
  return { imports, nextIndex };
}

export function parseTypeCheckingTypeAliasFallback(
  lines: string[],
  index: number,
  relativePath: string,
): { imports: ImportDefinition[]; typeAliases: TypeAlias[]; nextIndex: number } | null {
  if ((lines[index] ?? '').trim() !== 'if TYPE_CHECKING:') {
    return null;
  }

  const importedBindings = new Map<string, { modulePath: string; importedName: string }>();
  const importedRecords: Array<{ modulePath: string; imported: string; binding: string }> = [];
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
    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import (.+)$/.exec(line.trim());
    if (fromImport === null) {
      return null;
    }
    const modulePath = tsImportPathForPythonImport(fromImport[1], relativePath);
    const names = parsePythonImportNames(fromImport[2]);
    if (names === null) {
      return null;
    }
    for (const name of names) {
      importedBindings.set(name.binding, {
        modulePath,
        importedName: tsExportNameForPythonName(name.imported),
      });
      importedRecords.push({ modulePath, imported: name.imported, binding: name.binding });
    }
    nextIndex += 1;
  }

  while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
    nextIndex += 1;
  }
  if ((lines[nextIndex] ?? '').trim() !== 'else:') {
    return null;
  }

  const importsByPath = new Map<string, string[]>();
  const fallbackBindings = new Set<string>();
  const typeAliases: TypeAlias[] = [];
  nextIndex += 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (line.trim() === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith('    ')) {
      break;
    }
    const fallbackAlias = /^    ([A-Za-z_][A-Za-z0-9_]*): TypeAlias = object$/.exec(line);
    if (fallbackAlias === null) {
      return null;
    }
    const imported = importedBindings.get(fallbackAlias[1]);
    if (imported === undefined) {
      return null;
    }
    fallbackBindings.add(fallbackAlias[1]);
    const aliasName = tsExportNameForPythonName(fallbackAlias[1]);
    const importAlias = `${aliasName}Type`;
    addImportName(importsByPath, imported.modulePath, `${imported.importedName} as ${importAlias}`);
    typeAliases.push({
      name: aliasName,
      typeExpression: importAlias,
    });
    nextIndex += 1;
  }

  if (typeAliases.length === 0) {
    return null;
  }

  for (const record of importedRecords) {
    if (fallbackBindings.has(record.binding)) {
      continue;
    }
    addImportName(importsByPath, record.modulePath, parseImportNames(`${record.imported}${record.imported === record.binding ? '' : ` as ${record.binding}`}`)?.[0] ?? '');
  }

  return {
    imports: [...importsByPath.entries()].map(([modulePath, names]) => ({ modulePath, names })),
    typeAliases,
    nextIndex,
  };
}

function addImportName(importsByPath: Map<string, string[]>, modulePath: string, name: string): void {
  if (name === '') {
    return;
  }
  const names = importsByPath.get(modulePath) ?? [];
  names.push(name);
  importsByPath.set(modulePath, names);
}

function parseImportNames(importsText: string): string[] | null {
  const names = parsePythonImportNames(importsText);
  if (names === null) {
    return null;
  }
  return names.map((name) => (
    tsExportNameForPythonName(name.imported) === tsExportNameForPythonName(name.binding)
      ? tsExportNameForPythonName(name.imported)
      : `${tsExportNameForPythonName(name.imported)} as ${tsExportNameForPythonName(name.binding)}`
  ));
}

function parsePythonImportNames(importsText: string): Array<{ imported: string; binding: string }> | null {
  const names: Array<{ imported: string; binding: string }> = [];
  for (const part of importsText.split(', ')) {
    const aliasedName = /^([A-Za-z_][A-Za-z0-9_]*) as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(part);
    if (aliasedName !== null) {
      names.push({ imported: aliasedName[1], binding: aliasedName[2] });
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
      return null;
    }
    names.push({ imported: part, binding: part });
  }
  return names;
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
  if (/^[fF](?:"[^"]*"|'[^']*')$/.test(trimmed)) {
    return 'string';
  }
  if (/^(?:True|False)$/.test(trimmed)) {
    return 'boolean';
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return 'number';
  }
  if (/^(?:int|float)\(/.test(trimmed)) {
    return 'number';
  }
  if (/^str\(/.test(trimmed) || /\.(?:strip|lower|upper)\(\)/.test(trimmed)) {
    return 'string';
  }
  if (/^bool\(/.test(trimmed)) {
    return 'boolean';
  }
  const listComprehension = /^\[(.+?) for [A-Za-z_][A-Za-z0-9_]* in .+\]$/.exec(trimmed);
  if (listComprehension !== null) {
    return `${inferPythonExpressionType(listComprehension[1])}[]`;
  }
  const listLiteral = /^\[(.*)\]$/.exec(trimmed);
  if (listLiteral !== null) {
    const itemTypes = listLiteral[1]
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '')
      .map(inferPythonExpressionType);
    const uniqueTypes = [...new Set(itemTypes.filter((type) => type !== 'any'))];
    return `${uniqueTypes.length === 1 ? uniqueTypes[0] : 'any'}[]`;
  }
  const enumCast = /^([A-Z][A-Za-z0-9_]*(?:Id|Mode|Type|Flags))\(.+\)$/.exec(trimmed);
  if (enumCast !== null) {
    return tsExportNameForPythonName(enumCast[1]);
  }
  if (/^(?:(?:r[dl]|wgl)\.)?(?:Rectangle|makeRectangle)\(/.test(trimmed)) {
    return 'wgl.Rectangle';
  }
  if (/^(?:(?:r[dl]|wgl)\.)?(?:Color|makeColor)\(/.test(trimmed)) {
    return 'wgl.Color';
  }
  if (/\.(?:to_rl|to_wgl|toRl|toWgl)\(\)$/.test(trimmed)) {
    return 'wgl.Color';
  }
  if (/^(?:(?:r[dl]|wgl)\.)?(?:Vector2|makeVector2)\(/.test(trimmed)) {
    return 'wgl.Vector2';
  }
  if (/^(?:proj_origin|Vec2)\(/.test(trimmed) || /^Vec2\./.test(trimmed)) {
    return 'Vec2';
  }
  if (/^(?:self\.)?(?:camera|focus|screen_size)$/.test(trimmed) || trimmed === 'screenSize') {
    return 'Vec2';
  }
  if (/\b(?:camera|focus|screen_size|screenSize)\b/.test(trimmed) && /\s(?:\+|-|\*)\s/.test(trimmed)) {
    return 'Vec2';
  }
  if (/\bVec2\(/.test(trimmed) && /\s(?:\+|-)\s/.test(trimmed)) {
    return 'Vec2';
  }
  if (!/["'`]/.test(trimmed) && /\s(?:%|\*|\/\/|\/|-)\s/.test(trimmed)) {
    return 'number';
  }
  const enumMember = /^([A-Z][A-Za-z0-9_]*(?:Id|Mode|Type))\.[A-Z0-9_]+$/.exec(trimmed);
  if (enumMember !== null) {
    return tsExportNameForPythonName(enumMember[1]);
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(trimmed)) {
    return `typeof ${trimmed.split('.').map(tsExportNameForPythonName).join('.')}`;
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
      if (char === quote && !characterIsEscaped(value, index)) {
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
      if (char === quote && !characterIsEscaped(value, index)) {
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

function characterIsEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
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
