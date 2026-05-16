import type { EnumDefinition } from '../model.js';
import { tsExportNameForPythonName } from '../naming.js';
import { isOneLineAllAssignment } from '../python-utils.js';
import { translateExpression } from './expression.js';

export function parseIntEnumModule(trimmedPython: string): EnumDefinition | null {
  const lines = trimmedPython.split(/\r?\n/);
  let index = 0;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  if (lines[index]?.trim() !== 'from enum import IntEnum') {
    return null;
  }
  index += 1;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\(IntEnum\):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }
  index += 1;

  let docstring: string | null = null;
  const members: EnumDefinition['members'] = [];
  const pendingMemberComments: string[] = [];
  let valueFunction: EnumDefinition['valueFunction'] | undefined;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    if (trimmed.startsWith('#')) {
      pendingMemberComments.push(trimmed.replace(/^# ?/, ''));
      index += 1;
      continue;
    }

    const docstringMatch = /^    """(.*)"""$/.exec(line);
    if (docstringMatch !== null && members.length === 0 && docstring === null) {
      docstring = docstringMatch[1];
      index += 1;
      continue;
    }

    const parsedLine = splitInlineComment(line);
    const member = /^    ([A-Z][A-Z0-9_]*) = (-?(?:0x[0-9A-Fa-f]+|\d+))$/.exec(parsedLine.code);
    if (member !== null) {
      members.push({
        name: member[1],
        value: member[2],
        leadingComments: pendingMemberComments.splice(0),
        trailingComment: parsedLine.comment ?? undefined,
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith('__all__ = ')) {
      if (!isOneLineAllAssignment(trimmed)) {
        while (index < lines.length && lines[index].trim() !== ']') {
          index += 1;
        }
      }
      index += 1;
      continue;
    }

    if (trimmed.startsWith('def ')) {
      const parsedValueFunction = parseIntEnumValueFunction(lines, index, header[1]);
      if (parsedValueFunction === null) {
        return null;
      }
      valueFunction = parsedValueFunction.valueFunction;
      index = parsedValueFunction.nextIndex;
      continue;
    }

    return null;
  }

  return members.length > 0 ? { name: header[1], docstring, members, valueFunction } : null;
}

function parseIntEnumValueFunction(
  lines: string[],
  index: number,
  enumName: string,
): { valueFunction: NonNullable<EnumDefinition['valueFunction']>; nextIndex: number } | null {
  const header = /^def ([A-Za-z_][A-Za-z0-9_]*)\($/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }

  const parameter = /^    ([A-Za-z_][A-Za-z0-9_]*): int,$/.exec(lines[index + 1] ?? '');
  if (parameter === null || lines[index + 2] !== `) -> ${enumName}:`) {
    return null;
  }

  if ((lines[index + 3] ?? '').trim() !== 'try:') {
    return null;
  }
  const returnConverted = new RegExp(`^        return ${enumName}\\(int\\(${parameter[1]}\\)\\)$`).exec(lines[index + 4] ?? '');
  if (returnConverted === null) {
    return null;
  }
  const exceptLine = (lines[index + 5] ?? '').trim();
  if (exceptLine !== 'except (TypeError, ValueError):' && exceptLine !== 'except (TypeError, ValueError, OverflowError):') {
    return null;
  }
  const fallbackReturn = new RegExp(`^        return ${enumName}\\.([A-Z][A-Z0-9_]*)$`).exec(lines[index + 6] ?? '');
  if (fallbackReturn === null) {
    return null;
  }

  return {
    valueFunction: {
      name: tsExportNameForPythonName(header[1]),
      parameterName: tsExportNameForPythonName(parameter[1]),
      fallbackMember: fallbackReturn[1],
      rejectsOverflow: exceptLine.includes('OverflowError'),
    },
    nextIndex: index + 7,
  };
}

export function parseStringEnumClass(
  lines: string[],
  index: number,
): { enumDefinition: EnumDefinition; nextIndex: number } | null {
  const classIndex = (lines[index] ?? '').trim() === '@unique' ? index + 1 : index;
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\((str, Enum|Enum|IntEnum|IntFlag)\):$/.exec(lines[classIndex] ?? '');
  if (header === null) {
    return null;
  }
  const stringValued = header[2] === 'str, Enum';
  const autoValued = header[2] === 'Enum';

  let nextIndex = classIndex + 1;
  let docstring: string | null = null;
  const members: EnumDefinition['members'] = [];
  const pendingMemberComments: string[] = [];
  let nextAutoValue = 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    const trimmed = line.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith('    ')) {
      break;
    }
    if (trimmed.startsWith('#')) {
      pendingMemberComments.push(trimmed.replace(/^# ?/, ''));
      nextIndex += 1;
      continue;
    }

    const docstringMatch = /^    """(.*)"""$/.exec(line);
    if (docstringMatch !== null && members.length === 0 && docstring === null) {
      docstring = docstringMatch[1];
      nextIndex += 1;
      continue;
    }

    const parsedLine = splitInlineComment(line);
    const member = stringValued
      ? /^    ([A-Z][A-Z0-9_]*) = (["'][^"']*["'])$/.exec(parsedLine.code)
      : autoValued
        ? /^    ([A-Z][A-Z0-9_]*) = (auto\(\)|["'][^"']*["']|-?(?:0x[0-9A-Fa-f]+|\d+))$/.exec(parsedLine.code)
        : /^    ([A-Z][A-Z0-9_]*) = (-?(?:0x[0-9A-Fa-f]+|\d+))$/.exec(parsedLine.code);
    if (member === null) {
      return null;
    }
    const value = autoValued && member[2] === 'auto()'
      ? String(nextAutoValue)
      : stringValued || /^["']/.test(member[2]) ? translateExpression(member[2]) : member[2];
    members.push({
      name: member[1],
      value,
      leadingComments: pendingMemberComments.splice(0),
      trailingComment: parsedLine.comment ?? undefined,
    });
    const numericValue = Number.parseInt(value, 0);
    nextAutoValue = Number.isFinite(numericValue) ? numericValue + 1 : nextAutoValue + 1;
    nextIndex += 1;
  }

  return members.length > 0
    ? {
      enumDefinition: {
        name: header[1],
        docstring,
        members,
      },
      nextIndex,
    }
    : null;
}

function splitInlineComment(line: string): { code: string; comment: string | null } {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === quote && line[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && /\s/.test(line[index - 1] ?? '')) {
      return {
        code: line.slice(0, index).trimEnd(),
        comment: line.slice(index + 1).trim(),
      };
    }
  }
  return { code: line, comment: null };
}
