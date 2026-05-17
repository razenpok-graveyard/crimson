import type { ImportDefinition } from '../../model.js';
import { tsExportNameForPythonName } from '../../naming.js';
import {
  indentStatementLine,
  isIndentedBlockLine,
  matchingCloseParen,
  splitTopLevelComma,
} from '../common.js';
import { translateExpression } from '../expression.js';
import { splitInlineComment } from './inline-comments.js';
import { tsAttributeNameForPythonName } from './names.js';
import {
  caseBodyStops,
  parenthesisDelta,
} from './utils.js';

type StatementTranslationResult = { statements: string[]; nextIndex: number };

type StatementTranslator = (
  lines: string[],
  index: number,
  indent: string,
  nameMap: Map<string, string>,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  relativePath: string | null,
  mapNames: ReadonlySet<string>,
  imports: ImportDefinition[] | null,
) => StatementTranslationResult | null;

type ClassPatternBranch = {
  condition: string | null;
  comment: string | null;
  statements: string[];
};

function parseClassPatternCase(
  pattern: string,
  subject: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { condition: string; captures: string[]; nameMap: Map<string, string>; declaredNames: Set<string> } | null {
  const normalizedPattern = stripOuterPatternParens(pattern);
  const alternatives = splitTopLevelPatternOr(normalizedPattern);
  if (alternatives.length > 1) {
    const branches = alternatives.map((part) => parseClassPatternCase(part, subject, nameMap, arrayNames, validatedTypeAliases, mapNames));
    if (branches.some((branch) => branch === null)) {
      return null;
    }
    const typedBranches = branches as Array<NonNullable<(typeof branches)[number]>>;
    const firstCaptures = typedBranches[0].captures;
    const firstDeclaredNames = [...typedBranches[0].declaredNames].sort();
    for (const branch of typedBranches.slice(1)) {
      if (
        branch.captures.length !== firstCaptures.length
        || branch.captures.some((capture, index) => capture !== firstCaptures[index])
        || [...branch.declaredNames].sort().join('\u0000') !== firstDeclaredNames.join('\u0000')
      ) {
        return null;
      }
    }
    return {
      condition: typedBranches.map((branch) => branch.condition).join(' || '),
      captures: firstCaptures,
      nameMap: typedBranches[0].nameMap,
      declaredNames: typedBranches[0].declaredNames,
    };
  }

  const classPattern = /^([A-Z][A-Za-z0-9_]*)\((.*)\)$/.exec(normalizedPattern);
  if (classPattern === null) {
    return null;
  }
  const className = translateExpression(classPattern[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const branchNameMap = new Map(nameMap);
  const branchDeclaredNames = new Set<string>();
  const captures: string[] = [];
  const argsText = classPattern[2].trim();
  if (argsText !== '') {
    for (const arg of splitTopLevelComma(argsText)) {
      const keywordCapture = /^([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z_][A-Za-z0-9_]*)$/.exec(arg.trim());
      if (keywordCapture === null) {
        return null;
      }
      const propertyName = tsAttributeNameForPythonName(keywordCapture[1]);
      const localName = tsExportNameForPythonName(keywordCapture[2]);
      branchNameMap.set(keywordCapture[2], localName);
      branchDeclaredNames.add(keywordCapture[2]);
      captures.push(`const ${localName} = ${subject}.${propertyName};`);
    }
  }
  return {
    condition: `${subject} instanceof ${className}`,
    captures,
    nameMap: branchNameMap,
    declaredNames: branchDeclaredNames,
  };
}

function stripOuterPatternParens(pattern: string): string {
  let trimmed = pattern.trim();
  while (trimmed.startsWith('(') && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function splitTopLevelPatternOr(pattern: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | '\'' | null = null;
  let start = 0;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (quote !== null) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === '\'') {
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
    if (char === '|' && depth === 0) {
      parts.push(pattern.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(pattern.slice(start).trim());
  return parts.filter((part) => part !== '');
}

function parseMatchCaseHeader(
  lines: string[],
  index: number,
  caseIndent: string,
): { pattern: string; comment: string | null; nextIndex: number } | null {
  const firstLine = lines[index] ?? '';
  if (!firstLine.startsWith(caseIndent)) {
    return null;
  }
  const first = splitInlineComment(firstLine.slice(caseIndent.length).trim());
  if (!first.code.startsWith('case ')) {
    return null;
  }

  const patternParts: string[] = [];
  let balance = 0;
  let nextIndex = index;
  while (nextIndex < lines.length) {
    const rawLine = lines[nextIndex] ?? '';
    if (!rawLine.startsWith(caseIndent)) {
      return null;
    }
    const parsedLine = splitInlineComment(rawLine.slice(caseIndent.length).trim());
    let code = parsedLine.code;
    if (nextIndex === index) {
      code = code.slice('case '.length).trim();
    }
    const finalLine = code.endsWith(':');
    if (finalLine) {
      code = code.slice(0, -1).trim();
    }
    if (code !== '') {
      patternParts.push(code);
    }
    balance += parenthesisDelta(code);
    nextIndex += 1;
    if (finalLine && balance === 0) {
      return {
        pattern: stripOuterPatternParens(patternParts.join(' ')),
        comment: parsedLine.comment,
        nextIndex,
      };
    }
  }
  return null;
}

export function translateClassPatternMatchStatement(
  lines: string[],
  index: number,
  indent: string,
  subjectExpression: string,
  nameMap: Map<string, string>,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  relativePath: string | null,
  mapNames: ReadonlySet<string>,
  imports: ImportDefinition[] | null,
  translateStatement: StatementTranslator,
): StatementTranslationResult | null {
  const subject = translateExpression(subjectExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const caseIndent = `${indent}    `;
  const bodyIndent = `${caseIndent}    `;
  const branches: ClassPatternBranch[] = [];
  let nextIndex = index + 1;
  let sawClassPattern = false;

  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    if (line.trim() === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith(caseIndent)) {
      break;
    }

    const caseHeader = parseMatchCaseHeader(lines, nextIndex, caseIndent);
    if (caseHeader === null) {
      return null;
    }

    let condition: string | null = null;
    let captures: string[] = [];
    let branchNameMap = nameMap;
    let branchDeclaredNames = declaredNames;
    if (caseHeader.pattern !== '_') {
      const parsedClassPattern = parseClassPatternCase(
        caseHeader.pattern,
        subject,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (parsedClassPattern === null) {
        return null;
      }
      sawClassPattern = true;
      condition = parsedClassPattern.condition;
      captures = parsedClassPattern.captures;
      branchNameMap = parsedClassPattern.nameMap;
      branchDeclaredNames = new Set([...declaredNames, ...parsedClassPattern.declaredNames]);
    }

    const bodyStatements: string[] = [];
    nextIndex = caseHeader.nextIndex;
    let caseHadPass = false;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, bodyIndent)) {
      if (lines[nextIndex].trim() === '') {
        bodyStatements.push('');
        nextIndex += 1;
        continue;
      }
      if (lines[nextIndex].trim() === 'pass') {
        caseHadPass = true;
      }
      const innerStatement = translateStatement(
        lines,
        nextIndex,
        bodyIndent,
        branchNameMap,
        branchDeclaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        relativePath,
        mapNames,
        imports,
      );
      if (innerStatement === null) {
        return null;
      }
      bodyStatements.push(...innerStatement.statements);
      nextIndex = innerStatement.nextIndex;
    }
    if (!caseHadPass && bodyStatements.length === 0) {
      return null;
    }
    branches.push({
      condition,
      comment: caseHeader.comment,
      statements: [
        ...captures,
        ...bodyStatements,
      ],
    });
  }

  if (!sawClassPattern || branches.length === 0) {
    return null;
  }

  const statements: string[] = [];
  const matchEndsCurrentBlock = nextIndex >= lines.length || !isIndentedBlockLine(lines, nextIndex, indent);
  const needsUnreachableDefault = matchEndsCurrentBlock && branches.every((branch) => branch.condition !== null && caseBodyStops(branch.statements));
  for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
    const item = branches[branchIndex];
    const header = branchIndex === 0
      ? `if (${item.condition}) {`
      : item.condition === null
        ? '} else {'
        : `} else if (${item.condition}) {`;
    statements.push(`${header}${item.comment === null ? '' : ` // ${item.comment}`}`);
    statements.push(...item.statements.map(indentStatementLine));
  }
  if (needsUnreachableDefault) {
    statements.push('} else {');
    statements.push('  throw new Error(\'unreachable match case\');');
  }
  statements.push('}');

  return { statements, nextIndex };
}
