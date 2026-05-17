import type { SimpleModuleAssignment } from '../../model.js';
import {
  tsExportNameForPythonName,
  tsMutableNameForPythonName,
  tsPublicNameForPythonName,
  tsTypeExpression,
} from '../../naming.js';
import { inferPythonExpressionType, splitTopLevelComma } from '../common.js';
import { translateExpression } from '../expression.js';
import {
  collectMultilineSequenceLiteral,
  parseMultilineCallExpression,
} from '../statements.js';
import { splitInlineComment } from './inline-comments.js';

export function parseTopLevelAssignment(
  lines: string[],
  index: number,
  nameMap: Map<string, string> = new Map(),
  mapNames: ReadonlySet<string> = new Set(),
): { assignment: SimpleModuleAssignment; nextIndex: number } | null {
  const parsedLine = splitInlineComment(lines[index] ?? '');
  const line = parsedLine.code;
  const annotatedAssignment = /^([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(line);
  const plainAssignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(line);
  if (annotatedAssignment === null && plainAssignment === null) {
    return null;
  }

  const pythonName = annotatedAssignment?.[1] ?? plainAssignment?.[1] ?? '';
  const value = annotatedAssignment?.[3] ?? plainAssignment?.[2] ?? '';
  const annotatedType = annotatedAssignment?.[2] ?? null;
  const assignmentShapeType = annotatedType === null ? null : stripFinalTypeExpression(annotatedType);
  const publicUppercaseName = !pythonName.startsWith('_') && /^[A-Z0-9_]+$/.test(pythonName);
  const dictKeyType = /^dict\[([^,\]]+), .+\]$/.exec(assignmentShapeType?.trim() ?? '')?.[1] ?? null;
  const privateUppercaseName = (
    pythonName.startsWith('_')
    && /^[A-Z0-9_]+$/.test(pythonName.replace(/^_+/, ''))
    && (
      /^frozenset\[/.test(assignmentShapeType?.trim() ?? '')
      || /^tuple\[/.test(assignmentShapeType?.trim() ?? '')
      || (dictKeyType !== null && mapKeyTypeHasStableIdentity(dictKeyType))
    )
  );
  const name = annotatedType === null
    ? pythonName.startsWith('_') ? tsExportNameForPythonName(pythonName) : tsPublicNameForPythonName(pythonName)
    : publicUppercaseName ? tsPublicNameForPythonName(pythonName) : privateUppercaseName ? tsPublicNameForPythonName(pythonName) : tsMutableNameForPythonName(pythonName);
  const typeExpression = annotatedType === null ? undefined : tsTopLevelAssignmentTypeExpression(annotatedType);
  const baseAssignment = {
    pythonName,
    name,
    declaration: annotatedType === null || publicUppercaseName || privateUppercaseName ? 'const' as const : 'let' as const,
    exported: !pythonName.startsWith('_') || privateUppercaseName,
    typeExpression,
    trailingComment: parsedLine.comment ?? undefined,
  };
  if (value === '(') {
    const stringValue = parseParenthesizedStringAssignment(lines, index + 1, nameMap, mapNames);
    if (stringValue !== null) {
      return {
        assignment: { ...baseAssignment, valueLines: [stringValue.expression] },
        nextIndex: stringValue.nextIndex,
      };
    }

    const valueLines = ['['];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === ')') {
        valueLines.push(']');
        return {
          assignment: { ...baseAssignment, valueLines },
          nextIndex: nextIndex + 1,
        };
      }
      if (trimmed === '') {
        nextIndex += 1;
        continue;
      }
      if (trimmed.startsWith('#')) {
        valueLines.push(`  // ${trimmed.replace(/^# ?/, '')}`);
        nextIndex += 1;
        continue;
      }

      const tupleItem = /^(.+),$/.exec(trimmed);
      if (tupleItem === null) {
        return null;
      }
      const translatedItem = translateSequenceItemExpression(tupleItem[1], nameMap, mapNames);
      valueLines.push(`  ${translatedItem},`);
      nextIndex += 1;
    }

    return null;
  }

  if (value === '[') {
    const valueLines = ['['];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === ']') {
        valueLines.push(']');
        return {
          assignment: { ...baseAssignment, valueLines },
          nextIndex: nextIndex + 1,
        };
      }
      if (trimmed === '') {
        nextIndex += 1;
        continue;
      }
      if (trimmed.startsWith('#')) {
        valueLines.push(`  // ${trimmed.replace(/^# ?/, '')}`);
        nextIndex += 1;
        continue;
      }

      const callItem = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(trimmed);
      if (callItem !== null) {
        const callValue = parseMultilineKeywordCallValueLines(lines, nextIndex + 1, callItem[1], nameMap);
        if (callValue === null) {
          return null;
        }
        valueLines.push(...callValue.valueLines.map((line) => `  ${line}`));
        nextIndex = callValue.nextIndex;
        continue;
      }

      const listItem = /^(.+),$/.exec(trimmed);
      if (listItem === null) {
        return null;
      }
      const translatedItem = translateSequenceItemExpression(listItem[1], nameMap, mapNames);
      valueLines.push(`  ${translatedItem},`);
      nextIndex += 1;
    }
    return null;
  }

  if (value === '{') {
    const dictComprehension = parseMultilineDictComprehension(lines, index + 1, annotatedType);
    if (dictComprehension !== null) {
      return {
        assignment: { ...baseAssignment, valueLines: dictComprehension.valueLines },
        nextIndex: dictComprehension.nextIndex,
      };
    }

    const valueLines = ['new Map(['];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === '}') {
        valueLines.push('])');
        return {
          assignment: { ...baseAssignment, valueLines },
          nextIndex: nextIndex + 1,
        };
      }
      if (trimmed.startsWith('#')) {
        valueLines.push(`  // ${trimmed.replace(/^# ?/, '')}`);
        nextIndex += 1;
        continue;
      }

      const parsedItemLine = splitInlineComment(trimmed);
      const dictItem = /^(.+): (.+),$/.exec(parsedItemLine.code);
      if (dictItem !== null) {
        const key = translateExpression(dictItem[1], nameMap, new Set(), new Set(), mapNames);
        const itemValue = translateExpression(dictItem[2], nameMap, new Set(), new Set(), mapNames);
        valueLines.push(`  [${key}, ${itemValue}],${parsedItemLine.comment === null ? '' : ` // ${parsedItemLine.comment}`}`);
        nextIndex += 1;
        continue;
      }

      const multilineSequenceDictItem = /^(.+): ([([])$/.exec(parsedItemLine.code);
      if (multilineSequenceDictItem !== null) {
        const sequenceLiteral = collectMultilineSequenceLiteral(
          lines,
          nextIndex + 1,
          multilineSequenceDictItem[2] === '(' ? ')' : ']',
          nameMap,
          new Set(),
          new Set(),
          mapNames,
        );
        if (sequenceLiteral === null) {
          return null;
        }
        const key = translateExpression(multilineSequenceDictItem[1], nameMap, new Set(), new Set(), mapNames);
        valueLines.push(`  [${key}, [`);
        valueLines.push(...sequenceLiteral.items.map((item) => `    ${item},`));
        valueLines.push('  ]],');
        nextIndex = sequenceLiteral.nextIndex;
        continue;
      }

      const multilineDictItem = /^(.+): ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(parsedItemLine.code);
      if (multilineDictItem === null) {
        return null;
      }
      const callExpression = parseMultilineCallExpression(
        lines,
        nextIndex + 1,
        multilineDictItem[2],
        nameMap,
        new Set(),
      );
      if (callExpression === null) {
        return null;
      }
      const key = translateExpression(multilineDictItem[1], nameMap, new Set(), new Set(), mapNames);
      valueLines.push(`  [${key}, ${callExpression.expression}],`);
      nextIndex = callExpression.nextIndex;
    }

    return null;
  }

  if (value === '{}' && assignmentShapeType?.trim().startsWith('dict[') === true) {
    return {
      assignment: { ...baseAssignment, declaration: 'const', valueLines: ['new Map()'] },
      nextIndex: index + 1,
    };
  }

  const typedDictCall = /^dict\((.*)\)$/.exec(value);
  if (typedDictCall !== null && assignmentShapeType?.trim().startsWith('dict[') === true) {
    const args = splitTopLevelComma(typedDictCall[1]);
    if (args.length <= 1) {
      return {
        assignment: {
          ...baseAssignment,
          declaration: 'const',
          valueLines: [
            args.length === 0
              ? 'new Map()'
              : `new Map(${translateExpression(args[0], nameMap, new Set(), new Set(), mapNames)})`,
          ],
        },
        nextIndex: index + 1,
      };
    }
  }

  const oneLineFrozenSet = /^frozenset\(\{(.*)\}\)$/.exec(value);
  if (oneLineFrozenSet !== null) {
    const items = splitTopLevelComma(oneLineFrozenSet[1]).filter((item) => item !== '');
    return {
      assignment: {
        ...baseAssignment,
        typeExpression: baseAssignment.typeExpression ?? inferredReadonlySetTypeExpression(items),
        valueLines: [
          'new Set([',
          ...items.map((item) => `  ${translateExpression(item, nameMap, new Set(), new Set(), mapNames)},`),
          '])',
        ],
      },
      nextIndex: index + 1,
    };
  }

  if (value === 'frozenset(') {
    const frozenSet = parseMultilineFrozenSet(lines, index + 1);
    if (frozenSet === null) {
      return null;
    }
    return {
      assignment: {
        ...baseAssignment,
        typeExpression: baseAssignment.typeExpression ?? inferredReadonlySetTypeExpression(frozenSet.items),
        valueLines: frozenSet.valueLines,
      },
      nextIndex: frozenSet.nextIndex,
    };
  }

  const setUnion = /^[A-Z][A-Z0-9_]*(?: \| [A-Z][A-Z0-9_]*)+$/.exec(value);
  if (setUnion !== null) {
    const setNames = value.split(' | ').map((setName) => translateExpression(setName, nameMap, new Set(), new Set(), mapNames));
    return {
      assignment: {
        ...baseAssignment,
        typeExpression: baseAssignment.typeExpression ?? 'ReadonlySet<number>',
        valueLines: [
          'new Set([',
          ...setNames.map((setName) => `  ...${setName},`),
          '])',
        ],
      },
      nextIndex: index + 1,
    };
  }

  const tupleGeneratorCall = /^tuple\($/.exec(value);
  if (tupleGeneratorCall !== null) {
    const generator = collectMultilineExpression(lines, index + 1, ')');
    if (generator === null) {
      return null;
    }
    const valueLines = valueLinesForTupleGenerator(generator.expression, annotatedType);
    if (valueLines === null) {
      return null;
    }
    return {
      assignment: { ...baseAssignment, valueLines },
      nextIndex: generator.nextIndex,
    };
  }

  const tuplePlusTupleGeneratorCall = /^\((.*),\) \+ tuple\($/.exec(value);
  if (tuplePlusTupleGeneratorCall !== null) {
    const generator = collectMultilineExpression(lines, index + 1, ')');
    if (generator === null) {
      return null;
    }
    const generatorValueLines = valueLinesForTupleGenerator(generator.expression, annotatedType);
    if (generatorValueLines === null || generatorValueLines.length !== 1) {
      return null;
    }
    const prefixValues = splitTopLevelComma(tuplePlusTupleGeneratorCall[1])
      .filter((part) => part !== '')
      .map((part) => translateExpression(part, nameMap, new Set(), new Set(), mapNames));
    return {
      assignment: {
        ...baseAssignment,
        valueLines: [
          '[',
          ...prefixValues.map((part) => `  ${part},`),
          `  ...${generatorValueLines[0]},`,
          ']',
        ],
      },
      nextIndex: generator.nextIndex,
    };
  }

  if (value === 'Struct(') {
    const valueLines = ['constructStruct(['];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === ')') {
        valueLines.push('])');
        return {
          assignment: { ...baseAssignment, valueLines },
          nextIndex: nextIndex + 1,
        };
      }
      if (trimmed === '') {
        nextIndex += 1;
        continue;
      }
      const arg = /^(.+),$/.exec(trimmed);
      if (arg === null) {
        return null;
      }
      valueLines.push(`  ${translateExpression(arg[1], nameMap, new Set(), new Set(), mapNames)},`);
      nextIndex += 1;
    }
    return null;
  }

  const keywordCall = /^([A-Za-z_][A-Za-z0-9_]*)\($/.exec(value);
  if (keywordCall === null) {
    return {
      assignment: { ...baseAssignment, valueLines: [translateExpression(value, nameMap, new Set(), new Set(), mapNames)] },
      nextIndex: index + 1,
    };
  }

  const callee = tsExportNameForPythonName(keywordCall[1]);
  const callPrefix = /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
  const valueLines = [`${callPrefix}({`];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === ')') {
      valueLines.push('})');
      return {
        assignment: { ...baseAssignment, valueLines },
        nextIndex: nextIndex + 1,
      };
    }

    const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+),$/.exec(trimmed);
    if (keywordArg === null) {
      return null;
    }
    valueLines.push(`  ${tsExportNameForPythonName(keywordArg[1])}: ${translateExpression(keywordArg[2], nameMap, new Set(), new Set(), mapNames)},`);
    nextIndex += 1;
  }

  return null;
}

function parseParenthesizedStringAssignment(
  lines: string[],
  startIndex: number,
  nameMap: Map<string, string>,
  mapNames: ReadonlySet<string>,
): { expression: string; nextIndex: number } | null {
  const parts: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === ')') {
      if (parts.length === 0) {
        return null;
      }
      return {
        expression: parts.length === 1 ? parts[0] : `(${parts.join(' + ')})`,
        nextIndex: nextIndex + 1,
      };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!isStringLiteralExpression(trimmed)) {
      return null;
    }
    parts.push(translateExpression(trimmed, nameMap, new Set(), new Set(), mapNames));
    nextIndex += 1;
  }
  return null;
}

function isStringLiteralExpression(value: string): boolean {
  return /^(?:[rRuUbBfF]*)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(value);
}

function translateSequenceItemExpression(
  item: string,
  nameMap: Map<string, string>,
  mapNames: ReadonlySet<string>,
): string {
  const starred = /^\*(.+)$/.exec(item.trim());
  return starred === null
    ? translateExpression(item, nameMap, new Set(), new Set(), mapNames)
    : `...${translateExpression(starred[1], nameMap, new Set(), new Set(), mapNames)}`;
}

function parseMultilineKeywordCallValueLines(
  lines: string[],
  startIndex: number,
  pythonCallee: string,
  nameMap: Map<string, string>,
): { valueLines: string[]; nextIndex: number } | null {
  const callee = translateExpression(pythonCallee, nameMap);
  const callPrefix = /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
  const valueLines = [`${callPrefix}({`];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '),' || trimmed === ')') {
      valueLines.push('}),');
      return {
        valueLines,
        nextIndex: nextIndex + 1,
      };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (trimmed.startsWith('#')) {
      valueLines.push(`  // ${trimmed.replace(/^# ?/, '')}`);
      nextIndex += 1;
      continue;
    }
    const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+),$/.exec(trimmed);
    if (keywordArg === null) {
      return null;
    }
    valueLines.push(`  ${tsExportNameForPythonName(keywordArg[1])}: ${translateExpression(keywordArg[2], nameMap)},`);
    nextIndex += 1;
  }
  return null;
}

function mapKeyTypeHasStableIdentity(pythonType: string): boolean {
  return ['str', 'int', 'float', 'bool'].includes(pythonType.trim()) || /Id$/.test(pythonType.trim());
}

function stripFinalTypeExpression(pythonType: string): string {
  const trimmed = pythonType.trim();
  const finalType = /^Final\[(.+)\]$/.exec(trimmed);
  return finalType === null ? trimmed : finalType[1];
}

function tsTopLevelAssignmentTypeExpression(pythonType: string): string {
  const dictType = /^dict\[(.+), (.+)\]$/.exec(pythonType.trim());
  if (dictType !== null && dictType[1] === 'QuestLevel') {
    return `Map<string, ${tsTypeExpression(dictType[2])}>`;
  }
  return tsTypeExpression(pythonType);
}

function parseMultilineFrozenSet(
  lines: string[],
  startIndex: number,
): { items: string[]; valueLines: string[]; nextIndex: number } | null {
  const opener = (lines[startIndex] ?? '').trim();
  if (opener !== '{' && opener !== '(') {
    return null;
  }
  const closingItems = opener === '{' ? new Set(['}', '},']) : new Set([')', '),']);
  const items: string[] = [];
  const valueLines = ['new Set(['];
  let nextIndex = startIndex + 1;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (closingItems.has(trimmed)) {
      if ((lines[nextIndex + 1] ?? '').trim() !== ')') {
        return null;
      }
      valueLines.push('])');
      return { items, valueLines, nextIndex: nextIndex + 2 };
    }
    if (trimmed.startsWith('#')) {
      valueLines.push(`  // ${trimmed.replace(/^# ?/, '')}`);
      nextIndex += 1;
      continue;
    }
    const item = /^(.+),$/.exec(trimmed);
    if (item === null) {
      return null;
    }
    items.push(item[1]);
    valueLines.push(`  ${translateExpression(item[1])},`);
    nextIndex += 1;
  }
  return null;
}

function inferredReadonlySetTypeExpression(items: string[]): string {
  const itemTypes = items
    .map((item) => inferPythonExpressionType(item))
    .filter((type) => type !== 'any');
  const uniqueTypes = [...new Set(itemTypes)];
  return `ReadonlySet<${uniqueTypes.length === 1 ? uniqueTypes[0] : 'unknown'}>`;
}

function parseMultilineDictComprehension(
  lines: string[],
  startIndex: number,
  annotatedType: string | null,
): { valueLines: string[]; nextIndex: number } | null {
  const keyValue = /^(.+): (.+)$/.exec((lines[startIndex] ?? '').trim());
  const forClause = /^for ([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec((lines[startIndex + 1] ?? '').trim());
  const ifNotNone = /^if (.+) is not None$/.exec((lines[startIndex + 2] ?? '').trim());
  if (
    keyValue === null
    || forClause === null
    || ifNotNone === null
    || (lines[startIndex + 3] ?? '').trim() !== '}'
  ) {
    return null;
  }

  const valueType = dictValueType(annotatedType);
  const iterVar = tsExportNameForPythonName(forClause[1]);
  const iterable = translateExpression(forClause[2]);
  const guard = nonNullHookAttrTypeGuard(forClause[2], forClause[1], ifNotNone[1], valueType);
  return {
    valueLines: [
      'new Map(',
      `  ${iterable}`,
      `    .filter((${iterVar})${guard} => ${translateExpression(`${ifNotNone[1]} is not None`)})`,
      `    .map((${iterVar}) => [${translateExpression(keyValue[1])}, ${translateExpression(keyValue[2])}]),`,
      ')',
    ],
    nextIndex: startIndex + 4,
  };
}

function collectMultilineExpression(
  lines: string[],
  startIndex: number,
  closeLine: string,
): { expression: string; nextIndex: number } | null {
  const parts: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === closeLine) {
      return parts.length === 0
        ? null
        : { expression: parts.join(' '), nextIndex: nextIndex + 1 };
    }
    if (trimmed !== '') {
      parts.push(trimmed.replace(/,$/, ''));
    }
    nextIndex += 1;
  }
  return null;
}

function valueLinesForTupleGenerator(
  generatorExpression: string,
  annotatedType: string | null,
): string[] | null {
  const filteredGenerator = /^(.+) for ([A-Za-z_][A-Za-z0-9_]*) in (.+) if (.+) is not None$/.exec(generatorExpression);
  if (filteredGenerator !== null) {
    const iterVar = tsExportNameForPythonName(filteredGenerator[2]);
    const iterable = translateExpression(filteredGenerator[3]);
    const guard = nonNullHookAttrTypeGuard(
      filteredGenerator[3],
      filteredGenerator[2],
      filteredGenerator[4],
      tupleElementType(annotatedType),
    );
    return [
      `${iterable}`,
      `  .filter((${iterVar})${guard} => ${translateExpression(`${filteredGenerator[4]} is not None`)})`,
      `  .map((${iterVar}) => ${translateExpression(filteredGenerator[1])})`,
    ];
  }

  const nestedGenerator = /^(.+) for ([A-Za-z_][A-Za-z0-9_]*) in (.+) for ([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec(generatorExpression);
  if (nestedGenerator !== null) {
    const outerVar = tsExportNameForPythonName(nestedGenerator[2]);
    return [
      `${translateExpression(nestedGenerator[3])}.flatMap((${outerVar}) => ${translateExpression(nestedGenerator[5])})`,
    ];
  }

  return null;
}

function tupleElementType(annotatedType: string | null): string | null {
  const tupleType = /^tuple\[(.+), \.\.\.\]$/.exec(annotatedType?.trim() ?? '');
  return tupleType === null ? null : tsTypeExpression(tupleType[1]);
}

function dictValueType(annotatedType: string | null): string | null {
  const dictType = /^dict\[(.+), (.+)\]$/.exec(annotatedType?.trim() ?? '');
  return dictType === null ? null : tsTypeExpression(dictType[2]);
}

function nonNullHookAttrTypeGuard(
  iterableExpression: string,
  pythonVarName: string,
  pythonAttrExpression: string,
  valueType: string | null,
): string {
  if (translateExpression(iterableExpression) !== 'PERK_HOOKS_IN_ORDER' || valueType === null) {
    return '';
  }
  const attr = new RegExp(`^${pythonVarName}\\.([A-Za-z_][A-Za-z0-9_]*)$`).exec(pythonAttrExpression);
  if (attr === null) {
    return '';
  }
  const varName = tsExportNameForPythonName(pythonVarName);
  return `: ${varName} is PerkHooks & { ${tsExportNameForPythonName(attr[1])}: ${valueType} }`;
}
