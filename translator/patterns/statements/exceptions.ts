import { splitTopLevelComma } from '../common.js';
import { translateExpression } from '../expression.js';
import { splitInlineComment } from './inline-comments.js';
import { lineStartsAtIndent } from './utils.js';

export function parseExceptClause(statement: string): { name: string | null; types: string[] } | null {
  const code = splitInlineComment(statement).code;
  const typeNamePattern = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*';
  const identifierNamePattern = '[A-Za-z_][A-Za-z0-9_]*';
  const clause = new RegExp(`^except (?:(` + typeNamePattern + `)|\\((${typeNamePattern}(?:, ${typeNamePattern})+),?\\))(?: as (${identifierNamePattern}))?:$`).exec(code);
  if (clause === null) {
    return null;
  }
  return {
    name: clause[3] ?? null,
    types: (clause[1] ?? clause[2]).split(',').map((typeName) => typeName.trim()),
  };
}

export function tsExceptGuardExpression(
  pythonTypes: string[],
  catchName: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const guards: string[] = [];
  for (const pythonType of pythonTypes) {
    const translatedType = tsExceptionGuardType(translateExpression(pythonType, nameMap, arrayNames, validatedTypeAliases, mapNames));
    if (!tsExceptionTypeIsGuardable(translatedType)) {
      return null;
    }
    guards.push(`${catchName} instanceof ${translatedType}`);
  }
  return guards.length === 0 ? null : guards.join(' || ');
}

function tsExceptionGuardType(tsType: string): string {
  if (tsType === 'IndexError') {
    return 'RangeError';
  }
  return tsType;
}

function tsExceptionTypeIsGuardable(tsType: string): boolean {
  if (!/^[A-Z][A-Za-z0-9_$]*$/.test(tsType)) {
    return false;
  }
  return !new Set(['Exception', 'RuntimeError', 'ValueError', 'KeyError', 'OSError', 'FileNotFoundError']).has(tsType);
}

export function translateRaiseExpression(
  pythonCallee: string,
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
  argsAlreadyTranslated = false,
): string {
  const args = argsAlreadyTranslated ? [argsText] : splitTopLevelComma(argsText);
  const message = args[0] === undefined || args[0] === ''
    ? `'${pythonCallee}'`
    : argsAlreadyTranslated ? args[0] : translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const translatedCallee = translateExpression(pythonCallee, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (translatedCallee === 'TypeError') {
    return `new TypeError(${message})`;
  }
  if (translatedCallee === 'IndexError') {
    return `new RangeError(${message})`;
  }
  if (
    translatedCallee.includes('.')
    || ['Exception', 'RuntimeError', 'UserWarning', 'ValueError', 'KeyError', 'OSError', 'FileNotFoundError', 'AttributeError', 'NotImplementedError'].includes(translatedCallee)
  ) {
    return `new Error(${message})`;
  }
  return `new ${translatedCallee}(${message})`;
}

export function translateKeyErrorLookupStatement(
  lines: string[],
  index: number,
  indent: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { statements: string[]; nextIndex: number } | null {
  const innerIndent = `${indent}    `;
  const returnLine = lines[index + 1] ?? '';
  const exceptLine = lines[index + 2] ?? '';
  const raiseLine = lines[index + 3] ?? '';
  if (
    !returnLine.startsWith(innerIndent)
    || !lineStartsAtIndent(exceptLine, indent)
    || !raiseLine.startsWith(innerIndent)
  ) {
    return null;
  }

  const lookup = /^return ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(returnLine.trim());
  const exceptClause = /^except KeyError as ([A-Za-z_][A-Za-z0-9_]*):$/.exec(exceptLine.trim());
  const raise = /^raise ValueError\((.+)\) from ([A-Za-z_][A-Za-z0-9_]*)$/.exec(raiseLine.trim());
  if (lookup === null || exceptClause === null || raise === null || raise[2] !== exceptClause[1]) {
    return null;
  }

  const receiver = translateExpression(lookup[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const key = translateExpression(lookup[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const errorExpression = translateRaiseExpression(
    'ValueError',
    raise[1],
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  return {
    statements: [
      `if (!Object.prototype.hasOwnProperty.call(${receiver}, ${key})) {`,
      `  throw ${errorExpression};`,
      '}',
      `return (${receiver} as Record<string, number>)[${key}];`,
    ],
    nextIndex: index + 4,
  };
}
