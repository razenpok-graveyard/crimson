import type { ImportDefinition } from '../model.js';
import {
  tsExportNameForPythonName,
  tsMutableNameForPythonName,
  tsTypeExpression,
} from '../naming.js';
import { tsImportPathForPythonImport } from '../paths.js';
import {
  combinePythonStringExpressions,
  indentStatementLine,
  isIndentedBlockLine,
  matchingCloseParen,
  parsePythonStringExpression,
  splitTopLevelComma,
} from './common.js';
import {
  expressionIsKnownMap,
  translateCallArgumentExpression,
  translateExpression,
  translateMapKeyExpression,
  translatePositionalCallExpression,
  arrayElementTypeMarker,
  arrayValueMapNameMarker,
  booleanNameMarker,
  classBaseTypeMarker,
  classFieldTypeMarker,
  colorNameMarker,
  dateNameMarker,
  functionDeclaredReturnTypeMarker,
  functionReturnTypeMarker,
  instanceMethodSignatureMarker,
  mapValueMapNameMarker,
  mapValueTypeMarker,
  nullableNameMarker,
  numberArrayNameMarker,
  numberNameMarker,
  objectNameMarker,
  pathArrayNameMarker,
  pathNameMarker,
  pythonMappingNameMarker,
  rectangleNameMarker,
  receiverTypeNameMarker,
  setNameMarker,
  stringNameMarker,
  translatedExpressionLooksVectorArray,
  translatedExpressionLooksVector,
  tupleElementArrayNameMarker,
  tupleKeyMapNameMarker,
  vectorArrayNameMarker,
  vectorNameMarker,
} from './expression.js';
import {
  functionSignatureMarker,
  parseStraightLineFunctionHeader,
} from './function-headers.js';
import {
  parseEnumerateCallArgs,
  type EnumerateCallArgs,
} from './expression/generators.js';
import {
  parseFunctionParameterText,
  pythonParameterNames,
} from './parameters.js';
import { nullableTypeExpressionBase } from './expression/types.js';
import {
  isSimpleReferenceExpression,
  translateConditionExpression,
} from './statements/conditions.js';
import {
  exceptBlocksHaveSameBody,
  parseZipLoopSources,
} from './statements/control-flow.js';
import {
  parseExceptClause,
  translateKeyErrorLookupStatement,
  translateRaiseExpression,
  tsExceptGuardExpression,
} from './statements/exceptions.js';
import { splitInlineComment } from './statements/inline-comments.js';
import {
  tsAttributeNameForPythonName,
  tsLocalDeclarationNameForAssignment,
  tsLocalImportNameForPythonName,
} from './statements/names.js';
import { translateClassPatternMatchStatement } from './statements/match.js';
import { parseNestedFunctionStatement } from './statements/nested-functions.js';
import {
  predeclareIfBranchAssignments,
  predeclareLoopBlockAssignments,
  predeclareMatchCaseAssignments,
  predeclareTryFinallyAssignments,
} from './statements/predeclare.js';
import {
  pythonListTypeIsNumeric,
  pythonMapTypeHasTupleKey,
  pythonMapValueIsList,
  pythonMapValueIsMap,
} from './statements/python-types.js';
import { reassignedLocalNames } from './statements/reassigned-locals.js';
import {
  addMutableName,
  appendTrailingCommentToResult,
  caseBodyStops,
  collectMultilineParenthesizedExpression,
  hoistTryBlockDeclarations,
  lineStartsAtIndent,
  operatorIsAssignment,
  parenthesisDelta,
  pushImportDefinition,
} from './statements/utils.js';
import {
  parseWithItems,
  type WithItem,
  withItemExpressionIsIterator,
} from './statements/with-items.js';
import {
  addReassignedLocalTypeAnnotations,
  applyTupleTargetTypeMarkers,
  arrayElementTypeFromTypeExpression,
  assignedRightAsKnownVector,
  localTupleDeclarationType,
  nullableLocalDeclarationType,
  objectRecordDeclarationType,
  parseTopLevelSubscriptAssignmentTarget,
  pythonExpressionCouldBeTupleLiteral,
  pythonTupleExpressionLength,
  reassignedLocalTypeAnnotation,
  recordLocalAssignmentMarkers,
  recordLocalTupleDeclarationMarkers,
} from './statements/local-declarations.js';

export {
  functionSignatureMarker,
  parseStraightLineFunctionHeader,
} from './function-headers.js';

export { addReassignedLocalTypeAnnotations, markAssignedLocalCollectionNames } from './statements/local-declarations.js';
export { nullableLocalNames, reassignedLocalNames } from './statements/reassigned-locals.js';
export { rewriteStructPositionalConstructors } from './statements/struct-rewrites.js';

type FunctionReturnMarker = 'array' | 'map' | 'object' | 'rectangle' | 'set' | 'string' | 'vector';

type FunctionCallSignature = {
  positional: string[];
  returnTupleMarkers?: (FunctionReturnMarker | null)[];
};

type MultilineKeywordPart = {
  pythonName: string;
  expression: string;
};

type MultilineCallParts = {
  positionalParts: string[];
  keywordParts: string[];
  keywordArgParts: MultilineKeywordPart[];
  nextIndex: number;
};

export function translateStraightLineStatement(
  lines: string[],
  index: number,
  indent: string,
  nameMap: Map<string, string>,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  relativePath: string | null = null,
  mapNames: ReadonlySet<string> = new Set(),
  imports: ImportDefinition[] | null = null,
): { statements: string[]; nextIndex: number } | null {
  const line = lines[index];
  if (line === undefined || !line.startsWith(indent)) {
    return null;
  }
  const rawStatement = line.slice(indent.length);
  if (rawStatement.trim() === '' || rawStatement.startsWith(' ')) {
    return null;
  }

  if (rawStatement.startsWith('#')) {
    const comment = rawStatement.replace(/^# ?/, '');
    return { statements: [comment === '' ? '//' : `// ${comment}`], nextIndex: index + 1 };
  }

  const parsedStatement = splitInlineComment(rawStatement);
  const statement = parsedStatement.code;
  const trailingComment = parsedStatement.comment;

  const globalStatement = /^global ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(statement);
  if (globalStatement !== null) {
    for (const name of globalStatement[1].split(', ')) {
      nameMap.set(name, tsMutableNameForPythonName(name));
    }
    return { statements: [], nextIndex: index + 1 };
  }

  const nonlocalStatement = /^nonlocal ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(statement);
  if (nonlocalStatement !== null) {
    return { statements: [], nextIndex: index + 1 };
  }

  const localDeleteStatement = /^del [A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*$/.exec(statement);
  if (localDeleteStatement !== null) {
    return { statements: [], nextIndex: index + 1 };
  }

  const assertStatement = /^assert (.+?)(?:, (.+))?$/.exec(statement);
  if (assertStatement !== null) {
    const condition = translateConditionExpression(assertStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const message = assertStatement[2] === undefined
      ? ''
      : translateExpression(assertStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return {
      statements: [`if (!(${condition})) throw new Error(${message});`],
      nextIndex: index + 1,
    };
  }

  const sideEffectImport = /^from (\.+) import ([A-Za-z_][A-Za-z0-9_]*) as (_[A-Za-z_][A-Za-z0-9_]*)(?:\s+#.*)?$/.exec(statement);
  if (sideEffectImport !== null && relativePath !== null) {
    const modulePath = tsImportPathForPythonImport(`${sideEffectImport[1]}${sideEffectImport[2]}`, relativePath);
    let nextIndex = index + 1;
    while (
      nextIndex < lines.length
      && (lines[nextIndex] ?? '').trim() === ''
      && ((lines[nextIndex] ?? '') === '' || (lines[nextIndex] ?? '').startsWith(indent))
    ) {
      nextIndex += 1;
    }
    const nextLine = lines[nextIndex] ?? '';
    const skipAliasKeepalive = lineStartsAtIndent(nextLine, indent) && nextLine.trim() === `_ = ${sideEffectImport[3]}`;
    return {
      statements: [`void import('${modulePath}');`],
      nextIndex: skipAliasKeepalive ? nextIndex + 1 : index + 1,
    };
  }

  const localFromImport = /^from (\.+(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)?|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)(?:\s+#.*)?$/.exec(statement);
  if (localFromImport !== null && relativePath !== null && imports !== null) {
    const names = localFromImport[2].split(', ');
    const importedNames = names.map(tsLocalImportNameForPythonName);
    pushImportDefinition(imports, {
      modulePath: tsImportPathForPythonImport(localFromImport[1], relativePath),
      names: importedNames,
    });
    for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
      nameMap.set(names[nameIndex], importedNames[nameIndex]);
    }
    return { statements: [], nextIndex: index + 1 };
  }

  const nestedFunction = parseNestedFunctionStatement(
    lines,
    index,
    indent,
    nameMap,
    declaredNames,
    arrayNames,
    validatedTypeAliases,
    relativePath,
    mapNames,
    translateStraightLineStatement,
  );
  if (nestedFunction !== null) {
    return nestedFunction;
  }

  const pathStringCastIf = /^if isinstance\(([A-Za-z_][A-Za-z0-9_]*), Path\):$/.exec(statement);
  if (pathStringCastIf !== null) {
    const name = pathStringCastIf[1];
    const nextLine = lines[index + 1] ?? '';
    if (nextLine === `${indent}    ${name} = str(${name})`) {
      const tsName = tsExportNameForPythonName(name);
      return {
        statements: [
          `if (typeof ${tsName} !== 'string') {`,
          `  ${tsName} = String(${tsName});`,
          '}',
        ],
        nextIndex: index + 2,
      };
    }
  }

  const oneLineIfStatement = /^if (.+):$/.exec(statement);
  let ifCondition: string | null = oneLineIfStatement?.[1] ?? null;
  let translatedIfCondition: string | null = null;
  let ifBodyStartIndex = index + 1;
  if (ifCondition === null) {
    const multilineIfCall = /^if ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(statement);
    if (multilineIfCall !== null) {
      const callExpression = parseMultilineCallExpressionWithColonClose(
        lines,
        index + 1,
        multilineIfCall[1],
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (callExpression === null) {
        return null;
      }
      translatedIfCondition = callExpression.expression;
      ifBodyStartIndex = callExpression.nextIndex;
    }
  }
  if (ifCondition === null && translatedIfCondition === null) {
    const multilineIfCondition = /^if (.+\()$/.exec(statement);
    if (multilineIfCondition !== null) {
      const conditionLines = [multilineIfCondition[1]];
      let conditionIndex = index + 1;
      while (conditionIndex < lines.length) {
        const conditionLine = lines[conditionIndex] ?? '';
        const conditionTrimmed = conditionLine.trim();
        const close = /^\)(.*):$/.exec(conditionTrimmed);
        if (conditionLine.startsWith(indent) && close !== null) {
          const conditionBody = `${conditionLines.join(' ')})${close[1]}`
            .replaceAll(/,\s*\)/g, ')')
            .replaceAll(/\(\s+/g, '(')
            .replaceAll(/\s+\)/g, ')');
          ifCondition = conditionBody;
          ifBodyStartIndex = conditionIndex + 1;
          break;
        }
        if (!conditionLine.startsWith(`${indent}    `) || conditionTrimmed === '') {
          return null;
        }
        conditionLines.push(conditionTrimmed);
        conditionIndex += 1;
      }
      if (ifCondition === null) {
        return null;
      }
    }
  }
  if (ifCondition === null && statement === 'if (') {
    const conditionLines: string[] = [];
    let conditionIndex = index + 1;
    while (conditionIndex < lines.length) {
      const conditionLine = lines[conditionIndex] ?? '';
      const conditionTrimmed = conditionLine.trim();
      const close = /^\)(.*):$/.exec(conditionTrimmed);
      if (conditionLine.startsWith(indent) && close !== null) {
        const conditionBody = conditionLines
          .join(' ')
          .replaceAll(/,\s*\)/g, ')')
          .replaceAll(/\(\s+/g, '(')
          .replaceAll(/\s+\)/g, ')');
        const suffix = close[1].trimEnd();
        ifCondition = suffix === '' ? conditionBody : `(${conditionBody})${suffix}`;
        ifBodyStartIndex = conditionIndex + 1;
        break;
      }
      if (!conditionLine.startsWith(`${indent}    `) || conditionTrimmed === '') {
        return null;
      }
      conditionLines.push(conditionTrimmed);
      conditionIndex += 1;
    }
    if (ifCondition === null) {
      return null;
    }
  }
  if (ifCondition !== null || translatedIfCondition !== null) {
    const innerIndent = `${indent}    `;
    const translateBranch = (startIndex: number): { statements: string[]; nextIndex: number } | null => {
      const branchStatements: string[] = [];
      const branchDeclaredNames = new Set(declaredNames);
      let nextIndex = startIndex;
      while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
        if (lines[nextIndex].trim() === '') {
          branchStatements.push('');
          nextIndex += 1;
          continue;
        }
        const innerStatement = translateStraightLineStatement(
          lines,
          nextIndex,
          innerIndent,
          nameMap,
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
        branchStatements.push(...innerStatement.statements.map(indentStatementLine));
        nextIndex = innerStatement.nextIndex;
      }
      return branchStatements.length === 0 ? null : { statements: branchStatements, nextIndex };
    };

    const branchDeclarations = predeclareIfBranchAssignments(lines, index, indent, declaredNames, reassignedNames, nameMap, arrayNames, ifBodyStartIndex);
    const initialBranch = translateBranch(ifBodyStartIndex);
    if (initialBranch === null) {
      return null;
    }
    let nextIndex = initialBranch.nextIndex;
    const statements = [
      ...branchDeclarations,
      `if (${translatedIfCondition ?? translateConditionExpression(ifCondition ?? '', nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
      ...initialBranch.statements,
      '}',
    ];
    while (nextIndex < lines.length) {
      const nextLine = lines[nextIndex] ?? '';
      if (!lineStartsAtIndent(nextLine, indent)) {
        break;
      }
      const elifStatement = /^elif (.+):$/.exec(nextLine.trim());
      if (elifStatement === null) {
        break;
      }
      const elifBranch = translateBranch(nextIndex + 1);
      if (elifBranch === null) {
        return null;
      }
      statements[statements.length - 1] = `} else if (${translateConditionExpression(elifStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`;
      statements.push(...elifBranch.statements, '}');
      nextIndex = elifBranch.nextIndex;
    }
    if (lineStartsAtIndent(lines[nextIndex] ?? '', indent) && (lines[nextIndex] ?? '').trim() === 'else:') {
      const elseBranch = translateBranch(nextIndex + 1);
      if (elseBranch === null) {
        return null;
      }
      statements[statements.length - 1] = '} else {';
      statements.push(...elseBranch.statements, '}');
      nextIndex = elseBranch.nextIndex;
    }
    return {
      statements,
      nextIndex,
    };
  }

  if (statement === 'try:') {
    const keyErrorLookup = translateKeyErrorLookupStatement(
      lines,
      index,
      indent,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (keyErrorLookup !== null) {
      return keyErrorLookup;
    }
    const enumValueFallback = translateEnumValueFallbackStatement(lines, index, indent, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (enumValueFallback !== null) {
      return enumValueFallback;
    }
    const listIndexFallback = translateListIndexValueErrorFallbackStatement(
      lines,
      index,
      indent,
      nameMap,
      declaredNames,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (listIndexFallback !== null) {
      return listIndexFallback;
    }

    const innerIndent = `${indent}    `;
    const tryFinallyPredeclarations = predeclareTryFinallyAssignments(lines, index, indent, declaredNames, reassignedNames, nameMap);
    const translateBlock = (startIndex: number): { statements: string[]; nextIndex: number } | null => {
      const blockStatements: string[] = [];
      let nextIndex = startIndex;
      while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
        if (lines[nextIndex].trim() === '') {
          blockStatements.push('');
          nextIndex += 1;
          continue;
        }
        const innerStatement = translateStraightLineStatement(
          lines,
          nextIndex,
          innerIndent,
          nameMap,
          declaredNames,
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
        blockStatements.push(...innerStatement.statements.map(indentStatementLine));
        nextIndex = innerStatement.nextIndex;
      }
      return { statements: blockStatements, nextIndex };
    };

    const tryBlock = translateBlock(index + 1);
    if (tryBlock === null) {
      return null;
    }
    const afterTry = (lines[tryBlock.nextIndex] ?? '').trim();
    if (afterTry === 'finally:') {
      const finallyBlock = translateBlock(tryBlock.nextIndex + 1);
      if (finallyBlock === null) {
        return null;
      }
      const hoistedTry = hoistTryBlockDeclarations(tryBlock.statements);
      return {
        statements: [
          ...tryFinallyPredeclarations,
          ...hoistedTry.declarations,
          'try {',
          ...hoistedTry.statements,
          '} finally {',
          ...finallyBlock.statements,
          '}',
        ],
        nextIndex: finallyBlock.nextIndex,
      };
    }
    const exceptClause = parseExceptClause(afterTry);
    if (exceptClause !== null) {
      const exceptBlocks: Array<{ catchName: string; statements: string[]; types: string[] }> = [];
      let exceptIndex = tryBlock.nextIndex;
      while (exceptIndex < lines.length) {
        const clause = parseExceptClause((lines[exceptIndex] ?? '').trim());
        if (clause === null) {
          break;
        }
        const exceptBlock = translateBlock(exceptIndex + 1);
        if (exceptBlock === null) {
          return null;
        }
        exceptBlocks.push({
          catchName: tsExportNameForPythonName(clause.name ?? 'exc'),
          statements: exceptBlock.statements,
          types: clause.types,
        });
        exceptIndex = exceptBlock.nextIndex;
      }
      if (exceptBlocks.length === 0 || !exceptBlocksHaveSameBody(exceptBlocks)) {
        return null;
      }
      const elseBlock = lineStartsAtIndent(lines[exceptIndex] ?? '', indent) && (lines[exceptIndex] ?? '').trim() === 'else:'
        ? translateBlock(exceptIndex + 1)
        : null;
      if (elseBlock === null && lineStartsAtIndent(lines[exceptIndex] ?? '', indent) && (lines[exceptIndex] ?? '').trim() === 'else:') {
        return null;
      }
      const hoistedTry = hoistTryBlockDeclarations(tryBlock.statements);
      const catchName = exceptBlocks[0].catchName;
      const exceptGuard = tsExceptGuardExpression(
        exceptBlocks.flatMap((block) => block.types),
        catchName,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      const catchStatements = exceptGuard === null ? exceptBlocks[0].statements : [
        `  if (!(${exceptGuard})) {`,
        `    throw ${catchName};`,
        '  }',
        ...exceptBlocks[0].statements,
      ];
      if (elseBlock !== null) {
        const trySucceededName = `_trySucceeded${index}`;
        return {
          statements: [
            ...tryFinallyPredeclarations,
            ...hoistedTry.declarations,
            `let ${trySucceededName} = false;`,
            'try {',
            ...hoistedTry.statements,
            `  ${trySucceededName} = true;`,
            `} catch (${catchName}) {`,
            ...catchStatements,
            '}',
            `if (${trySucceededName}) {`,
            ...elseBlock.statements,
            '}',
          ],
          nextIndex: elseBlock.nextIndex,
        };
      }
      return {
        statements: [
          ...tryFinallyPredeclarations,
          ...hoistedTry.declarations,
          'try {',
          ...hoistedTry.statements,
          `} catch (${catchName}) {`,
          ...catchStatements,
          '}',
        ],
        nextIndex: exceptIndex,
      };
    }
    return null;
  }

  const zstdStreamReadWith = /^with zstd\.ZstdDecompressor\(\)\.stream_reader\(io\.BytesIO\((.+)\)\) as ([A-Za-z_][A-Za-z0-9_]*):$/.exec(statement);
  if (zstdStreamReadWith !== null) {
    const innerIndent = `${indent}    `;
    const readLine = lines[index + 1] ?? '';
    const readStatement = new RegExp(`^([A-Za-z_][A-Za-z0-9_]*) = ${zstdStreamReadWith[2]}\\.read\\((.+)\\)$`).exec(readLine.trim());
    if (!readLine.startsWith(innerIndent) || readStatement === null) {
      return null;
    }
    const targetName = tsMutableNameForPythonName(readStatement[1]);
    return {
      statements: [
        `const ${targetName} = new Uint8Array(zstdDecompressSync(${translateExpression(zstdStreamReadWith[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}, { maxOutputLength: ${translateExpression(readStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)} }));`,
      ],
      nextIndex: index + 2,
    };
  }

  const multilineWithCallStatement = /^with ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(statement);
  const multilineWithCall = multilineWithCallStatement === null
    ? null
    : parseMultilineCallExpressionWithAsClose(
      lines,
      index + 1,
      multilineWithCallStatement[1],
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
  const withStatement = multilineWithCall === null ? /^with (.+):$/.exec(statement) : null;
  if (withStatement !== null || multilineWithCall !== null) {
    const withItems = multilineWithCall !== null
      ? [{
        pythonName: multilineWithCall.pythonName,
        name: multilineWithCall.name,
        expression: multilineWithCall.expression,
        close: true as const,
        iterator: withItemExpressionIsIterator(multilineWithCall.expression, nameMap),
      }]
      : parseWithItems(withStatement![1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (withItems === null) {
      return null;
    }
    for (const item of withItems) {
      if (item.close) {
        declaredNames.add(item.pythonName);
        nameMap.set(item.pythonName, item.name);
      }
    }

    const innerIndent = `${indent}    `;
    const blockStatements: string[] = [];
    let nextIndex = multilineWithCall?.nextIndex ?? index + 1;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
      if (lines[nextIndex].trim() === '') {
        blockStatements.push('');
        nextIndex += 1;
        continue;
      }
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
        declaredNames,
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
      blockStatements.push(...innerStatement.statements.map(indentStatementLine));
      nextIndex = innerStatement.nextIndex;
    }
    if (blockStatements.length === 0) {
      return null;
    }

    const namedItems = withItems.filter((item): item is Extract<WithItem, { close: true }> => item.close);
    const anonymousItems = withItems.filter((item): item is Extract<WithItem, { close: false }> => !item.close);
    if (namedItems.length === 0) {
      const hoistedBlock = hoistTryBlockDeclarations(blockStatements);
      let wrappedStatements = hoistedBlock.statements;
      let wrappedAnyItem = false;
      for (let itemIndex = anonymousItems.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const item = anonymousItems[itemIndex];
        if (item.expression === 'maybeAlphaTest()') {
          wrappedAnyItem = true;
          wrappedStatements = [
            'wgl.setAlphaTest(true);',
            'try {',
            ...wrappedStatements,
            '} finally {',
            '  wgl.setAlphaTest(false);',
            '}',
          ];
          continue;
        }
        if (/^[A-Za-z_$][A-Za-z0-9_.$]*$/.test(item.expression.trim())) {
          wrappedAnyItem = true;
          const managerName = `_withManager${index}_${itemIndex}`;
          wrappedStatements = [
            `const ${managerName} = ${item.expression} as unknown as { __enter__?: () => unknown; __exit__?: (excType: unknown, exc: unknown, tb: unknown) => unknown; start?: () => unknown; stop?: () => unknown };`,
            `if (${managerName}.__enter__ !== undefined) {`,
            `  ${managerName}.__enter__();`,
            `} else {`,
            `  ${managerName}.start?.();`,
            `}`,
            'try {',
            ...wrappedStatements,
            '} finally {',
            `  if (${managerName}.__exit__ !== undefined) {`,
            `    ${managerName}.__exit__(null, null, null);`,
            `  } else {`,
            `    ${managerName}.stop?.();`,
            `  }`,
            '}',
          ];
          continue;
        }
        if (!/^[A-Za-z_$][A-Za-z0-9_.$]*\(/.test(item.expression.trim())) {
          continue;
        }
        wrappedAnyItem = true;
        const cleanupName = `_withExit${index}_${itemIndex}`;
        wrappedStatements = [
          `const ${cleanupName} = ${item.expression};`,
          'try {',
          ...wrappedStatements,
          '} finally {',
          `  ${cleanupName}();`,
          '}',
        ];
      }
      if (!wrappedAnyItem) {
        return {
          statements: [
            ...hoistedBlock.declarations,
            '{',
            ...hoistedBlock.statements,
            '}',
          ],
          nextIndex,
        };
      }
      return {
        statements: [
          ...hoistedBlock.declarations,
          ...wrappedStatements,
        ],
        nextIndex,
      };
    }
    const iteratorItems = namedItems.filter((item) => item.iterator === true);
    if (iteratorItems.length > 0) {
      if (namedItems.length !== 1) {
        return null;
      }
      const item = iteratorItems[0];
      const iterName = `_${item.name}Value`;
      const hoistedBlock = hoistTryBlockDeclarations(blockStatements);
      return {
        statements: [
          `let ${item.name}: any;`,
          ...hoistedBlock.declarations.map((declaration) => (
            declaration.replace(/^let ([A-Za-z_$][A-Za-z0-9_$]*): (.+);$/, 'let $1 = undefined as unknown as $2;')
          )),
          `for (const ${iterName} of ${item.expression}) {`,
          `  ${item.name} = ${iterName};`,
          ...hoistedBlock.statements,
          '}',
        ],
        nextIndex,
      };
    }

    const hoistedBlock = hoistTryBlockDeclarations(blockStatements);
    return {
      statements: [
        ...namedItems.map((item) => `const ${item.name} = ${item.expression};`),
        ...hoistedBlock.declarations,
        'try {',
        ...hoistedBlock.statements,
        '} finally {',
        ...[...namedItems].reverse().map((item) => `  ${item.name}.close();`),
        '}',
      ],
      nextIndex,
    };
  }

  const matchStatement = /^match (.+):$/.exec(statement);
  if (matchStatement !== null) {
    const classPatternMatch = translateClassPatternMatchStatement(
      lines,
      index,
      indent,
      matchStatement[1],
      nameMap,
      declaredNames,
      reassignedNames,
      arrayNames,
      validatedTypeAliases,
      relativePath,
      mapNames,
      imports,
      translateStraightLineStatement,
    );
    if (classPatternMatch !== null) {
      return classPatternMatch;
    }

    const caseIndent = `${indent}    `;
    const bodyIndent = `${caseIndent}    `;
    const branchDeclarations = predeclareMatchCaseAssignments(lines, index, indent, declaredNames, reassignedNames, nameMap);
    const statements = [
      ...branchDeclarations,
      `switch (${translateExpression(matchStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
    ];
    let nextIndex = index + 1;
    let sawCase = false;

    while (nextIndex < lines.length) {
      const line = lines[nextIndex] ?? '';
      if (line.trim() === '') {
        nextIndex += 1;
        continue;
      }
      if (!line.startsWith(caseIndent)) {
        break;
      }

      const parsedCaseLine = splitInlineComment(line.slice(caseIndent.length));
      const caseStatement = /^case (.+):$/.exec(parsedCaseLine.code);
      if (caseStatement === null) {
        return null;
      }
      sawCase = true;
      const translatedCases = caseStatement[1] === '_'
        ? ['default']
        : caseStatement[1].split(' | ').map((casePattern) => `case ${translateExpression(casePattern, nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
      translatedCases.forEach((translatedCase, caseIndex) => {
        statements.push(`  ${translatedCase}:${caseIndex === 0 && parsedCaseLine.comment !== null ? ` // ${parsedCaseLine.comment}` : ''}`);
      });

      const caseStatements: string[] = [];
      nextIndex += 1;
      let caseHadPass = false;
      while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, bodyIndent)) {
        if (lines[nextIndex].trim() === '') {
          caseStatements.push('');
          nextIndex += 1;
          continue;
        }
        if (lines[nextIndex].trim() === 'pass') {
          caseHadPass = true;
        }
        const innerStatement = translateStraightLineStatement(
          lines,
          nextIndex,
          bodyIndent,
          nameMap,
          declaredNames,
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
        caseStatements.push(...innerStatement.statements);
        nextIndex = innerStatement.nextIndex;
      }
      if (!caseHadPass && caseStatements.length === 0) {
        return null;
      }
      statements.push(...caseStatements.map((caseLine) => indentStatementLine(indentStatementLine(caseLine))));
      if (!caseBodyStops(caseStatements)) {
        statements.push('    break;');
      }
    }

    if (!sawCase) {
      return null;
    }
    statements.push('}');
    return { statements, nextIndex };
  }

  const whileStatement = /^while (.+):$/.exec(statement);
  if (whileStatement !== null) {
    const innerIndent = `${indent}    `;
    const loopDeclarations = predeclareLoopBlockAssignments(lines, index, indent, declaredNames, nameMap);
    const innerStatements: string[] = [];
    let sawBodyLine = false;
    let nextIndex = index + 1;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
      if (lines[nextIndex].trim() === '') {
        innerStatements.push('');
        nextIndex += 1;
        continue;
      }
      sawBodyLine = true;
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
        declaredNames,
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
      innerStatements.push(...innerStatement.statements.map(indentStatementLine));
      nextIndex = innerStatement.nextIndex;
    }
    if (!sawBodyLine) {
      return null;
    }
    return {
      statements: [
        ...loopDeclarations,
        `while (${translateConditionExpression(whileStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
        ...innerStatements,
        '}',
      ],
      nextIndex,
    };
  }

  const enumerateStatement = /^for (.+) in enumerate\((.+)\):$/.exec(statement);
  if (enumerateStatement !== null) {
    const enumerateTarget = parseForTargetPattern(enumerateStatement[1]);
    if (enumerateTarget === null) {
      return null;
    }
    const enumerateParts = splitTopLevelComma(enumerateStatement[1]);
    if (enumerateParts.length !== 2) {
      return null;
    }
    const enumerateArgs = parseEnumerateCallArgs(enumerateStatement[2]);
    if (enumerateArgs === null) {
      return null;
    }
    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    const branchDeclaredNames = new Set(declaredNames);
    for (const pythonName of enumerateTarget.pythonNames) {
      branchDeclaredNames.add(pythonName);
    }
    let nextIndex = index + 1;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
      if (lines[nextIndex].trim() === '') {
        innerStatements.push('');
        nextIndex += 1;
        continue;
      }
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
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
      innerStatements.push(...innerStatement.statements.map(indentStatementLine));
      nextIndex = innerStatement.nextIndex;
    }
    if (innerStatements.length === 0) {
      return null;
    }
    return {
      statements: [
        `for (const ${enumerateTarget.pattern} of ${enumerateForOfExpression(enumerateArgs, nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
        ...innerStatements,
        '}',
      ],
      nextIndex,
    };
  }

  const multilineTupleForOfStatement = /^for ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) in \($/.exec(statement);
  if (multilineTupleForOfStatement !== null) {
    const iterableItems: string[] = [];
    let iterableIndex = index + 1;
    while (iterableIndex < lines.length) {
      const iterableLine = lines[iterableIndex] ?? '';
      const trimmed = iterableLine.trim();
      if (iterableLine.startsWith(indent) && trimmed === '):') {
        break;
      }
      if (!iterableLine.startsWith(`${indent}    `) || trimmed === '') {
        return null;
      }
      if (trimmed === '(') {
        const tupleParts: string[] = [];
        iterableIndex += 1;
        while (iterableIndex < lines.length) {
          const tupleLine = lines[iterableIndex] ?? '';
          const tupleTrimmed = tupleLine.trim();
          if (tupleLine.startsWith(`${indent}    `) && tupleTrimmed === '),') {
            break;
          }
          if (!tupleLine.startsWith(`${indent}        `) || tupleTrimmed === '' || !tupleTrimmed.endsWith(',')) {
            return null;
          }
          tupleParts.push(translateExpression(tupleTrimmed.slice(0, -1), nameMap, arrayNames, validatedTypeAliases, mapNames));
          iterableIndex += 1;
        }
        if ((lines[iterableIndex] ?? '').trim() !== '),' || tupleParts.length === 0) {
          return null;
        }
        iterableItems.push(`[${tupleParts.join(', ')}]`);
        iterableIndex += 1;
        continue;
      }
      const tupleItem = /^(.+),$/.exec(trimmed);
      if (tupleItem === null) {
        return null;
      }
      const tupleExpression = tupleItem[1].startsWith('(') && tupleItem[1].endsWith(')')
        ? tupleItem[1].slice(1, -1)
        : tupleItem[1];
      const parts = splitTopLevelComma(tupleExpression);
      iterableItems.push(parts.length > 1
        ? `[${parts.map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')}]`
        : translateExpression(tupleExpression, nameMap, arrayNames, validatedTypeAliases, mapNames));
      iterableIndex += 1;
    }
    if ((lines[iterableIndex] ?? '').trim() !== '):') {
      return null;
    }

    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    let nextIndex = iterableIndex + 1;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
      if (lines[nextIndex].trim() === '') {
        innerStatements.push('');
        nextIndex += 1;
        continue;
      }
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
        declaredNames,
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
      innerStatements.push(...innerStatement.statements.map(indentStatementLine));
      nextIndex = innerStatement.nextIndex;
    }
    if (innerStatements.length === 0) {
      return null;
    }

    const targets = multilineTupleForOfStatement[1].split(', ').map(tsExportNameForPythonName);
    return {
      statements: [
        `for (const [${targets.join(', ')}] of [`,
        ...iterableItems.map((item) => `  ${item},`),
        ']) {',
        ...innerStatements,
        '}',
      ],
      nextIndex,
    };
  }

  const multilineValueForOfStatement = /^for ([A-Za-z_][A-Za-z0-9_]*) in \($/.exec(statement);
  if (multilineValueForOfStatement !== null) {
    const iterableItems: string[] = [];
    let iterableIndex = index + 1;
    let sliceLimit: string | null = null;
    while (iterableIndex < lines.length) {
      const iterableLine = lines[iterableIndex] ?? '';
      const trimmed = iterableLine.trim();
      const close = /^\)(?:\[:(.+)\])?:$/.exec(trimmed);
      if (iterableLine.startsWith(indent) && close !== null) {
        sliceLimit = close[1] ?? null;
        break;
      }
      if (!iterableLine.startsWith(`${indent}    `) || trimmed === '') {
        return null;
      }
      const tupleItem = /^(.+),$/.exec(trimmed);
      if (tupleItem === null) {
        return null;
      }
      iterableItems.push(translateExpression(tupleItem[1], nameMap, arrayNames, validatedTypeAliases, mapNames));
      iterableIndex += 1;
    }
    if (!/^\)(?:\[:(.+)\])?:$/.test((lines[iterableIndex] ?? '').trim())) {
      return null;
    }

    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    const branchDeclaredNames = new Set(declaredNames);
    branchDeclaredNames.add(multilineValueForOfStatement[1]);
    let nextIndex = iterableIndex + 1;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
      if (lines[nextIndex].trim() === '') {
        innerStatements.push('');
        nextIndex += 1;
        continue;
      }
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
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
      innerStatements.push(...innerStatement.statements.map(indentStatementLine));
      nextIndex = innerStatement.nextIndex;
    }
    if (innerStatements.length === 0) {
      return null;
    }

    return {
      statements: [
        `for (const ${tsExportNameForPythonName(multilineValueForOfStatement[1])} of [`,
        ...iterableItems.map((item) => `  ${item},`),
        sliceLimit === null
          ? ']) {'
          : `].slice(0, ${translateExpression(sliceLimit, nameMap, arrayNames, validatedTypeAliases, mapNames)})) {`,
        ...innerStatements,
        '}',
      ],
      nextIndex,
    };
  }

  const tupleForOfStatement = /^for ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) in (.+):$/.exec(statement);
  if (tupleForOfStatement !== null) {
    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    const targets = tupleForOfStatement[1].split(', ');
    const iterableExpression = translateExpression(tupleForOfStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const branchDeclaredNames = new Set(declaredNames);
    for (const target of targets) {
      branchDeclaredNames.add(target);
    }
    applyTupleTargetTypeMarkers(
      targets,
      nameMap.get(arrayElementTypeMarker(tupleForOfStatement[2])) ?? nameMap.get(arrayElementTypeMarker(iterableExpression)) ?? null,
      nameMap,
      arrayNames,
    );
    let nextIndex = index + 1;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
      if (lines[nextIndex].trim() === '') {
        innerStatements.push('');
        nextIndex += 1;
        continue;
      }
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
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
      innerStatements.push(...innerStatement.statements.map(indentStatementLine));
      nextIndex = innerStatement.nextIndex;
    }
    if (innerStatements.length === 0) {
      return null;
    }
    const zipLoopSources = parseZipLoopSources(tupleForOfStatement[2]);
    if (zipLoopSources !== null) {
      if (zipLoopSources.length !== targets.length) {
        return null;
      }
      const zipIndexName = `_zipIndex${index}`;
      const zipSourceNames = zipLoopSources.map((_source, sourceIndex) => `_zip${index}_${sourceIndex}`);
      return {
        statements: [
          ...zipLoopSources.map((source, sourceIndex) => (
            `const ${zipSourceNames[sourceIndex]} = Array.from(${translateExpression(source, nameMap, arrayNames, validatedTypeAliases, mapNames)});`
          )),
          `for (let ${zipIndexName} = 0; ${zipIndexName} < Math.min(${zipSourceNames.map((sourceName) => `${sourceName}.length`).join(', ')}); ${zipIndexName}++) {`,
          ...targets.map((target, targetIndex) => (
            `  let ${tsExportNameForPythonName(target)} = ${zipSourceNames[targetIndex]}[${zipIndexName}];`
          )),
          ...innerStatements,
          '}',
        ],
        nextIndex,
      };
    }
    return {
      statements: [
        `for (let [${targets.map(tsExportNameForPythonName).join(', ')}] of ${iterableExpression}) {`,
        ...innerStatements,
        '}',
      ],
      nextIndex,
    };
  }

  const forOfStatement = /^for ([A-Za-z_][A-Za-z0-9_]*) in (.+):$/.exec(statement);
  if (forOfStatement !== null) {
    const rangeLoop = /^range\((.+)\)$/.exec(forOfStatement[2]);
    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    const branchDeclaredNames = new Set(declaredNames);
    branchDeclaredNames.add(forOfStatement[1]);
    if (iterableIsPathArray(forOfStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)) {
      const itemName = tsExportNameForPythonName(forOfStatement[1]);
      arrayNames.add(pathNameMarker(forOfStatement[1]));
      arrayNames.add(pathNameMarker(itemName));
    }
    const mapValuesLoop = /^(.+)\.values\(\)$/.exec(forOfStatement[2]);
    if (mapValuesLoop !== null) {
      const source = translateExpression(mapValuesLoop[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const itemName = tsExportNameForPythonName(forOfStatement[1]);
      if (mapNames.has(mapValueMapNameMarker(mapValuesLoop[1])) || mapNames.has(mapValueMapNameMarker(source))) {
        addMutableName(mapNames, forOfStatement[1]);
        addMutableName(mapNames, itemName);
      }
      if (mapNames.has(arrayValueMapNameMarker(mapValuesLoop[1])) || mapNames.has(arrayValueMapNameMarker(source))) {
        arrayNames.add(forOfStatement[1]);
        arrayNames.add(itemName);
      }
    }
    let nextIndex = index + 1;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
      if (lines[nextIndex].trim() === '') {
        innerStatements.push('');
        nextIndex += 1;
        continue;
      }
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
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
      innerStatements.push(...innerStatement.statements.map(indentStatementLine));
      nextIndex = innerStatement.nextIndex;
    }
    if (innerStatements.length === 0) {
      return null;
    }
    if (rangeLoop !== null) {
      const rangeArgs = splitTopLevelComma(rangeLoop[1]);
      if (rangeArgs.length < 1 || rangeArgs.length > 3) {
        return null;
      }
      const loopName = forOfStatement[1] === '_' ? 'i' : tsExportNameForPythonName(forOfStatement[1]);
      const start = rangeArgs.length === 1 ? '0' : translateExpression(rangeArgs[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const stop = translateExpression(rangeArgs.length === 1 ? rangeArgs[0] : rangeArgs[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const step = rangeArgs.length === 3
        ? translateExpression(rangeArgs[2], nameMap, arrayNames, validatedTypeAliases, mapNames)
        : null;
      return {
        statements: [
          step === null
            ? `for (let ${loopName} = ${start}; ${loopName} < ${stop}; ${loopName}++) {`
            : `for (let ${loopName} = ${start}; ${step} >= 0 ? ${loopName} < ${stop} : ${loopName} > ${stop}; ${loopName} += ${step}) {`,
          ...innerStatements,
          '}',
        ],
        nextIndex,
      };
    }
    const loopVariableReassigned = reassignedNames.has(forOfStatement[1]) || blockAssignsName(lines, index + 1, innerIndent, forOfStatement[1]);
    return {
      statements: [
        `for (${loopVariableReassigned ? 'let' : 'const'} ${tsExportNameForPythonName(forOfStatement[1])} of ${translateExpression(forOfStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
        ...innerStatements,
        '}',
      ],
      nextIndex,
    };
  }

  if (statement === 'return') {
    return { statements: ['return;'], nextIndex: index + 1 };
  }
  if (statement === 'return [') {
    const listComprehension = parseMultilineListComprehension(
      lines,
      index + 1,
      indent,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (listComprehension !== null) {
      return {
        statements: [`return ${listComprehension.expression};`],
        nextIndex: listComprehension.nextIndex,
      };
    }
    const listLiteral = collectMultilineListLiteral(
      lines,
      index + 1,
      indent,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (listLiteral !== null) {
      return {
        statements: [
          'return [',
          ...listLiteral.items.map((item) => `  ${item},`),
          '];',
        ],
        nextIndex: listLiteral.nextIndex,
      };
    }
  }
  if (statement === 'break') {
    return { statements: ['break;'], nextIndex: index + 1 };
  }
  if (statement === 'continue') {
    return { statements: ['continue;'], nextIndex: index + 1 };
  }
  if (statement === 'pass') {
    return { statements: [], nextIndex: index + 1 };
  }

  const yieldFromStatement = /^yield from (.+)$/.exec(statement);
  if (yieldFromStatement !== null) {
    return { statements: [`yield* ${translateExpression(yieldFromStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)};`], nextIndex: index + 1 };
  }

  const yieldStatement = /^yield (.+)$/.exec(statement);
  if (yieldStatement !== null) {
    const parts = splitTopLevelComma(yieldStatement[1]);
    const expression = parts.length > 1
      ? `[${parts.map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')}]`
      : translateExpression(yieldStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return { statements: [`yield ${expression};`], nextIndex: index + 1 };
  }

  const pathlibMkdirParents = /^(.+)\.mkdir\(parents=True, exist_ok=True\)$/.exec(statement);
  if (pathlibMkdirParents !== null) {
    if (imports === null) {
      return {
        statements: [],
        nextIndex: index + 1,
      };
    }
    const parentPath = /^(.+)\.parent$/.exec(pathlibMkdirParents[1]);
    const translatedPath = parentPath === null
      ? `String(${translateExpression(pathlibMkdirParents[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`
      : `_dirname(String(${translateExpression(parentPath[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}))`;
    return {
      statements: [`_mkdirParents(${translatedPath});`],
      nextIndex: index + 1,
    };
  }

  if (statement === 'return (') {
    const expressionLines: string[] = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (lineStartsAtIndent(lines[nextIndex] ?? '', indent) && trimmed === ')') {
        return {
          statements: [`return ${translateReturnExpression(expressionLines.join(' '), nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
          nextIndex: nextIndex + 1,
        };
      }
      if (trimmed === '') {
        nextIndex += 1;
        continue;
      }
      expressionLines.push(trimmed);
      nextIndex += 1;
    }
    return null;
  }

  if (statement === 'return {') {
    const expressionLines = ['{'];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (lineStartsAtIndent(lines[nextIndex] ?? '', indent) && trimmed === '}') {
        expressionLines.push('}');
        return {
          statements: [`return ${translateReturnExpression(expressionLines.join(' '), nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
          nextIndex: nextIndex + 1,
        };
      }
      if (trimmed === '') {
        nextIndex += 1;
        continue;
      }
      expressionLines.push(trimmed);
      nextIndex += 1;
    }
    return null;
  }

  const multilineReturnTupleCall = /^return (.+), ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(statement);
  if (multilineReturnTupleCall !== null) {
    const callExpression = parseMultilineCallExpression(
      lines,
      index + 1,
      multilineReturnTupleCall[2],
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (callExpression === null) {
      return null;
    }
    const leadingParts = splitTopLevelComma(multilineReturnTupleCall[1])
      .map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
    return {
      statements: [`return [${[...leadingParts, callExpression.expression].join(', ')}];`],
      nextIndex: callExpression.nextIndex,
    };
  }

  const multilineReturnCall = /^return ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(statement);
  if (multilineReturnCall !== null) {
    const callExpression = parseMultilineCallExpression(
      lines,
      index + 1,
      multilineReturnCall[1],
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (callExpression === null) {
      return null;
    }
    return { statements: [`return ${callExpression.expression};`], nextIndex: callExpression.nextIndex };
  }

  const multilineReturnStringJoinCall = /^return (((?:[fF])?(["'])(?:\\.|(?!\3)[\s\S])*\3)\.join)\($/.exec(statement);
  if (multilineReturnStringJoinCall !== null) {
    const callExpression = parseMultilineCallExpression(
      lines,
      index + 1,
      multilineReturnStringJoinCall[1],
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (callExpression === null) {
      return null;
    }
    return { statements: [`return ${callExpression.expression};`], nextIndex: callExpression.nextIndex };
  }

  const multilineReturnExpression = /^return (.+)$/.exec(statement);
  if (multilineReturnExpression !== null && parenthesisDelta(multilineReturnExpression[1]) > 0) {
    const expression = collectMultilineParenthesizedExpression(lines, index, multilineReturnExpression[1]);
    if (expression !== null) {
      return {
        statements: [`return ${translateReturnExpression(expression.expression, nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
        nextIndex: expression.nextIndex,
      };
    }
    return null;
  }

  const returnStatement = /^return (.+)$/.exec(statement);
  if (returnStatement !== null) {
    return { statements: [`return ${translateReturnExpression(returnStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)};`], nextIndex: index + 1 };
  }

  const raiseFromStatement = /^raise ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\) from .+$/.exec(statement);
  if (raiseFromStatement !== null) {
    return {
      statements: [`throw ${translateRaiseExpression(raiseFromStatement[1], raiseFromStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
      nextIndex: index + 1,
    };
  }

  const raiseStatement = /^raise ([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/.exec(statement);
  if (raiseStatement !== null) {
    return {
      statements: [`throw ${translateRaiseExpression(raiseStatement[1], raiseStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
      nextIndex: index + 1,
    };
  }
  const qualifiedRaiseStatement = /^raise ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/.exec(statement);
  if (qualifiedRaiseStatement !== null) {
    return {
      statements: [`throw ${translateRaiseExpression(qualifiedRaiseStatement[1], qualifiedRaiseStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
      nextIndex: index + 1,
    };
  }
  const bareRaiseStatement = /^raise ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(statement);
  if (bareRaiseStatement !== null) {
    return {
      statements: [`throw ${translateRaiseExpression(bareRaiseStatement[1], '', nameMap, arrayNames, validatedTypeAliases, mapNames, true)};`],
      nextIndex: index + 1,
    };
  }

  const multilineRaiseCall = /^raise ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(statement);
  if (multilineRaiseCall !== null) {
    const callParts = parseMultilineCallParts(
      lines,
      index + 1,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (callParts === null) {
      return null;
    }
    const message = callParts.positionalParts[0] === undefined
      ? `'${multilineRaiseCall[1]}'`
      : translateCallArgumentExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return {
      statements: [`throw ${translateRaiseExpression(multilineRaiseCall[1], message, nameMap, arrayNames, validatedTypeAliases, mapNames, true)};`],
      nextIndex: callParts.nextIndex,
    };
  }
  if (statement === 'raise') {
    return { statements: ['throw exc;'], nextIndex: index + 1 };
  }

  const annotatedMultilineDictAssignment = /^([A-Za-z_][A-Za-z0-9_]*): (.+?) = \{$/.exec(statement);
  if (annotatedMultilineDictAssignment !== null) {
    const tsName = tsExportNameForPythonName(annotatedMultilineDictAssignment[1]);
    const typeExpression = tsTypeExpression(annotatedMultilineDictAssignment[2]);
    const dictLiteral = collectMultilineDictLiteral(
      lines,
      index + 1,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (dictLiteral === null) {
      return null;
    }
    declaredNames.add(annotatedMultilineDictAssignment[1]);
    if (typeExpression === 'BuiltinObject' || typeExpression.startsWith('Record<')) {
      arrayNames.add(objectNameMarker(annotatedMultilineDictAssignment[1]));
      arrayNames.add(objectNameMarker(tsName));
    }
    if (typeExpression.startsWith('Map<')) {
      addMutableName(mapNames, annotatedMultilineDictAssignment[1]);
      addMutableName(mapNames, tsName);
    }
    return appendTrailingCommentToResult({
      statements: [
        `${reassignedNames.has(annotatedMultilineDictAssignment[1]) ? 'let' : 'const'} ${tsName}: ${typeExpression} = ${dictLiteral.expression};`,
      ],
      nextIndex: dictLiteral.nextIndex,
    }, trailingComment);
  }

  const annotatedMultilineListAssignment = /^([A-Za-z_][A-Za-z0-9_]*): (.+?) = \[$/.exec(statement);
  if (annotatedMultilineListAssignment !== null) {
    const pythonName = annotatedMultilineListAssignment[1];
    const annotation = annotatedMultilineListAssignment[2].trim();
    const tsName = tsExportNameForPythonName(pythonName);
    const typeExpression = tsTypeExpression(annotation);
    const alreadyDeclared = declaredNames.has(pythonName);
    const listComprehension = parseMultilineListComprehension(
      lines,
      index + 1,
      indent,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    const listLiteral = listComprehension === null
      ? collectMultilineListLiteral(
        lines,
        index + 1,
        indent,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      )
      : null;
    if (listComprehension === null && listLiteral === null) {
      return null;
    }
    declaredNames.add(pythonName);
    if (typeExpression.endsWith('[]')) {
      arrayNames.add(pythonName);
      arrayNames.add(tsName);
      if (pythonListTypeIsNumeric(annotation)) {
        arrayNames.add(numberArrayNameMarker(pythonName));
        arrayNames.add(numberArrayNameMarker(tsName));
      }
    }
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
    if (listComprehension?.tupleElements === true) {
      arrayNames.add(tupleElementArrayNameMarker(pythonName));
      arrayNames.add(tupleElementArrayNameMarker(tsName));
    }
    if (annotation === 'list[Path]') {
      arrayNames.add(pathArrayNameMarker(pythonName));
      arrayNames.add(pathArrayNameMarker(tsName));
    }
    if (listComprehension !== null) {
      return appendTrailingCommentToResult({
        statements: [
          alreadyDeclared
            ? `${tsName} = ${listComprehension.expression};`
            : `${reassignedNames.has(pythonName) ? 'let' : 'const'} ${tsName}: ${typeExpression} = ${listComprehension.expression};`,
        ],
        nextIndex: listComprehension.nextIndex,
      }, trailingComment);
    }
    return appendTrailingCommentToResult({
      statements: [
        alreadyDeclared
          ? `${tsName} = [`
          : `${reassignedNames.has(pythonName) ? 'let' : 'const'} ${tsName}: ${typeExpression} = [`,
        ...(listLiteral?.items ?? []).map((item) => `  ${item},`),
        '];',
      ],
      nextIndex: listLiteral?.nextIndex ?? index + 1,
    }, trailingComment);
  }

  const annotatedAttributeAssignment = /^((?:self|this)\.[A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(statement);
  if (annotatedAttributeAssignment !== null) {
    const pythonLeft = annotatedAttributeAssignment[1];
    const annotation = annotatedAttributeAssignment[2].trim();
    const tsLeft = translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const typeExpression = tsTypeExpression(annotation);
    let assignedRight = maybeAwaitAsyncCall(
      translateExpression(annotatedAttributeAssignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames),
      nameMap,
    );
    if (typeExpression.startsWith('Map<')) {
      addMutableName(mapNames, pythonLeft);
      addMutableName(mapNames, tsLeft);
      if (pythonMapTypeHasTupleKey(annotation)) {
        addMutableName(mapNames, tupleKeyMapNameMarker(pythonLeft));
        addMutableName(mapNames, tupleKeyMapNameMarker(tsLeft));
      }
      if (pythonMapValueIsList(annotation)) {
        addMutableName(mapNames, arrayValueMapNameMarker(pythonLeft));
        addMutableName(mapNames, arrayValueMapNameMarker(tsLeft));
      }
      if (pythonMapValueIsMap(annotation)) {
        addMutableName(mapNames, mapValueMapNameMarker(pythonLeft));
        addMutableName(mapNames, mapValueMapNameMarker(tsLeft));
      }
      if (assignedRight === '{}') {
        assignedRight = 'new Map()';
      }
    }
    return appendTrailingCommentToResult({
      statements: [`${tsLeft} = ${assignedRight};`],
      nextIndex: index + 1,
    }, trailingComment);
  }

  const annotatedAssignment = /^([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(statement);
  if (annotatedAssignment !== null) {
    const tsName = tsExportNameForPythonName(annotatedAssignment[1]);
    const typeExpression = tsTypeExpression(annotatedAssignment[2]);
    const receiverType = nullableTypeExpressionBase(typeExpression);
    if (receiverType !== undefined && /^[A-Z][A-Za-z0-9_$]*$/.test(receiverType)) {
      nameMap.set(receiverTypeNameMarker(annotatedAssignment[1]), receiverType);
      nameMap.set(receiverTypeNameMarker(tsName), receiverType);
    }
    const alreadyDeclared = declaredNames.has(annotatedAssignment[1]);
    const continuedRight = parenthesisDelta(annotatedAssignment[3]) > 0
      ? collectMultilineParenthesizedExpression(lines, index, annotatedAssignment[3])
      : null;
    if (parenthesisDelta(annotatedAssignment[3]) > 0 && continuedRight === null) {
      return null;
    }
    let assignedRight = maybeAwaitAsyncCall(
      translateExpression(continuedRight?.expression ?? annotatedAssignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames),
      nameMap,
    );
    declaredNames.add(annotatedAssignment[1]);
    if (typeExpression.startsWith('Set<') || typeExpression.startsWith('ReadonlySet<')) {
      arrayNames.add(setNameMarker(annotatedAssignment[1]));
      arrayNames.add(setNameMarker(tsName));
    }
    const annotation = annotatedAssignment[2].trim();
    if (typeExpression.endsWith('[]')) {
      arrayNames.add(annotatedAssignment[1]);
      arrayNames.add(tsName);
      const elementType = arrayElementTypeFromTypeExpression(typeExpression);
      if (elementType !== null) {
        nameMap.set(arrayElementTypeMarker(annotatedAssignment[1]), elementType);
        nameMap.set(arrayElementTypeMarker(tsName), elementType);
      }
      if (pythonListTypeIsNumeric(annotation)) {
        arrayNames.add(numberArrayNameMarker(annotatedAssignment[1]));
        arrayNames.add(numberArrayNameMarker(tsName));
      }
    }
    if (assignedRight.startsWith('[')) {
      arrayNames.add(annotatedAssignment[1]);
      arrayNames.add(tsName);
    }
    if (assignedRight === '{}' && !typeExpression.startsWith('Map<')) {
      arrayNames.add(objectNameMarker(annotatedAssignment[1]));
      arrayNames.add(objectNameMarker(tsName));
    }
    if (annotation === 'Path') {
      arrayNames.add(pathNameMarker(annotatedAssignment[1]));
      arrayNames.add(pathNameMarker(tsName));
    }
    if (annotation === 'list[Path]') {
      arrayNames.add(pathArrayNameMarker(annotatedAssignment[1]));
      arrayNames.add(pathArrayNameMarker(tsName));
    }
    if (typeExpression === 'BuiltinObject' || typeExpression.startsWith('Record<')) {
      arrayNames.add(objectNameMarker(annotatedAssignment[1]));
      arrayNames.add(objectNameMarker(tsName));
    }
    if (typeExpression === 'Date') {
      arrayNames.add(dateNameMarker(annotatedAssignment[1]));
      arrayNames.add(dateNameMarker(tsName));
    }
    if (typeExpression === 'boolean') {
      arrayNames.add(booleanNameMarker(annotatedAssignment[1]));
      arrayNames.add(booleanNameMarker(tsName));
    }
    if (typeExpression.startsWith('Map<')) {
      addMutableName(mapNames, annotatedAssignment[1]);
      addMutableName(mapNames, tsName);
      if (pythonMapTypeHasTupleKey(annotation)) {
        addMutableName(mapNames, tupleKeyMapNameMarker(annotatedAssignment[1]));
        addMutableName(mapNames, tupleKeyMapNameMarker(tsName));
      }
      if (pythonMapValueIsList(annotation)) {
        addMutableName(mapNames, arrayValueMapNameMarker(annotatedAssignment[1]));
        addMutableName(mapNames, arrayValueMapNameMarker(tsName));
      }
      if (pythonMapValueIsMap(annotation)) {
        addMutableName(mapNames, mapValueMapNameMarker(annotatedAssignment[1]));
        addMutableName(mapNames, mapValueMapNameMarker(tsName));
      }
      if (assignedRight === '{}') {
        assignedRight = 'new Map()';
      }
    }
    return appendTrailingCommentToResult({
      statements: [
        alreadyDeclared
          ? `${tsName} = ${assignedRight};`
          : `${reassignedNames.has(annotatedAssignment[1]) ? 'let' : 'const'} ${tsName}: ${typeExpression} = ${assignedRight};`,
      ],
      nextIndex: continuedRight?.nextIndex ?? index + 1,
    }, trailingComment);
  }

  const annotatedDeclaration = /^([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(statement);
  if (annotatedDeclaration !== null) {
    const tsName = tsExportNameForPythonName(annotatedDeclaration[1]);
    declaredNames.add(annotatedDeclaration[1]);
    return {
      statements: [`let ${tsName}: ${tsTypeExpression(annotatedDeclaration[2])};`],
      nextIndex: index + 1,
    };
  }

  if (statement === '(') {
    const tupleAssignment = parseMultilineTupleAssignmentStatement(
      lines,
      index,
      indent,
      nameMap,
      declaredNames,
      reassignedNames,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (tupleAssignment !== null) {
      return tupleAssignment;
    }
  }

  const sliceAssignment = /^(.+)\[:\s*(.+)\] = (.+)$/.exec(statement);
  if (sliceAssignment !== null) {
    const target = translateExpression(sliceAssignment[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const end = translateExpression(sliceAssignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const zeroRepeat = /^b(["'])\\x00\1 \* (.+)$/.exec(sliceAssignment[3]);
    if (zeroRepeat !== null) {
      return appendTrailingCommentToResult({
        statements: [`${target}.fill(0, 0, ${translateExpression(zeroRepeat[2], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
        nextIndex: index + 1,
      }, trailingComment);
    }
    return appendTrailingCommentToResult({
      statements: [`${target}.set(${translateExpression(sliceAssignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}, 0);`],
      nextIndex: index + 1,
    }, trailingComment);
  }

  const rangeSliceAssignment = /^(.+)\[(.+)\s*:\s*(.+)\] = (.+)$/.exec(statement);
  if (rangeSliceAssignment !== null) {
    const target = translateExpression(rangeSliceAssignment[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const start = translateExpression(rangeSliceAssignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const end = translateExpression(rangeSliceAssignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const zeroRepeat = /^b(["'])\\x00\1 \* (.+)$/.exec(rangeSliceAssignment[4]);
    if (zeroRepeat !== null) {
      return appendTrailingCommentToResult({
        statements: [`${target}.fill(0, ${start}, ${end});`],
        nextIndex: index + 1,
      }, trailingComment);
    }
    return appendTrailingCommentToResult({
      statements: [`${target}.set(${translateExpression(rangeSliceAssignment[4], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${start});`],
      nextIndex: index + 1,
    }, trailingComment);
  }

  const assignment = /^(.+?) (\/\/=|\+=|-=|\*=|\/=|\|=|&=|\^=|=) (.+)$/.exec(statement);
  if (assignment !== null) {
    const mapPopAssignment = /^(.+)\.pop\((.+)\)$/.exec(assignment[3]);
    if (operatorIsAssignment(assignment[2]) && mapPopAssignment !== null) {
      const popAssignment = translateMapPopAssignment(
        assignment[1],
        mapPopAssignment[1],
        mapPopAssignment[2],
        index + 1,
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (popAssignment !== null) {
        return appendTrailingCommentToResult(popAssignment, trailingComment);
      }
    }

    const multilineCallAssignment = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(assignment[3]);
    if (
      operatorIsAssignment(assignment[2])
      && multilineCallAssignment !== null
      && !['float', 'str', 'bool'].includes(multilineCallAssignment[1])
    ) {
      const callExpression = parseMultilineCallExpression(
        lines,
        index + 1,
        multilineCallAssignment[1],
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (callExpression !== null) {
        return appendTrailingCommentToResult(translateStraightLineAssignment(
          assignment[1],
          assignment[2],
          callExpression.expression,
          callExpression.nextIndex,
          nameMap,
          declaredNames,
          reassignedNames,
          arrayNames,
          validatedTypeAliases,
          mapNames,
        ), trailingComment);
      }
    }
    if (assignment[3] === '{') {
      const setComprehension = parseMultilineSetComprehensionExpression(
        lines,
        index + 1,
        indent,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (setComprehension !== null) {
        return translateStraightLineAssignment(
          assignment[1],
          assignment[2],
          setComprehension.expression,
          setComprehension.nextIndex,
          nameMap,
          declaredNames,
          reassignedNames,
          arrayNames,
          validatedTypeAliases,
          mapNames,
        );
      }
      const dictComprehension = parseMultilineDictComprehensionExpression(
        lines,
        index + 1,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (dictComprehension !== null) {
        return translateStraightLineAssignment(
          assignment[1],
          assignment[2],
          dictComprehension.expression,
          dictComprehension.nextIndex,
          nameMap,
          declaredNames,
          reassignedNames,
          arrayNames,
          validatedTypeAliases,
          mapNames,
        );
      }
      const dictLiteral = collectMultilineDictLiteral(
        lines,
        index + 1,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (dictLiteral === null) {
        return null;
      }
      return translateStraightLineAssignment(
        assignment[1],
        assignment[2],
        dictLiteral.expression,
        dictLiteral.nextIndex,
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
    }
    if (assignment[3] === '[') {
      const listComprehension = parseMultilineListComprehension(
        lines,
        index + 1,
        indent,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (listComprehension !== null) {
        const localName = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(assignment[1]);
        if (localName !== null) {
          const tsName = tsExportNameForPythonName(localName[1]);
          arrayNames.add(localName[1]);
          arrayNames.add(tsName);
          if (listComprehension.tupleElements) {
            arrayNames.add(tupleElementArrayNameMarker(localName[1]));
            arrayNames.add(tupleElementArrayNameMarker(tsName));
          }
        }
        return translateStraightLineAssignment(
          assignment[1],
          assignment[2],
          listComprehension.expression,
          listComprehension.nextIndex,
          nameMap,
          declaredNames,
          reassignedNames,
          arrayNames,
          validatedTypeAliases,
          mapNames,
        );
      }
      const listLiteral = collectMultilineListLiteral(
        lines,
        index + 1,
        indent,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (listLiteral === null) {
        return null;
      }
      const localName = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(assignment[1]);
      if (localName !== null && listLiteralItemsLookLikeTupleArray(listLiteral.items)) {
        const tsName = tsExportNameForPythonName(localName[1]);
        arrayNames.add(tupleElementArrayNameMarker(localName[1]));
        arrayNames.add(tupleElementArrayNameMarker(tsName));
      }
      return translateStraightLineAssignment(
        assignment[1],
        assignment[2],
        multilineListLiteralExpression(listLiteral.items),
        listLiteral.nextIndex,
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
    }
    if (assignment[3] === '(') {
      const expression = collectMultilineParenthesizedExpression(lines, index, assignment[3]);
      if (expression !== null) {
        return translateStraightLineAssignment(
          assignment[1],
          assignment[2],
          translateExpression(expression.expression, nameMap, arrayNames, validatedTypeAliases, mapNames),
          expression.nextIndex,
          nameMap,
          declaredNames,
          reassignedNames,
          arrayNames,
          validatedTypeAliases,
          mapNames,
          expression.expression,
        );
      }
      return null;
    }
    if (/^(?:float|str|bool)\($/.test(assignment[3])) {
      const wrappedExpression = parseWrappedMultilineExpression(
        lines,
        index + 1,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (wrappedExpression === null) {
        return null;
      }
      return appendTrailingCommentToResult(translateStraightLineAssignment(
        assignment[1],
        assignment[2],
        wrappedExpression.expression,
        wrappedExpression.nextIndex,
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      ), trailingComment);
    }
    const multilineSubscriptAssignment = /^(.+)\[$/.exec(assignment[3]);
    if (multilineSubscriptAssignment !== null) {
      const subscriptExpression = collectMultilineSubscriptExpression(
        lines,
        index + 1,
        multilineSubscriptAssignment[1],
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (subscriptExpression === null) {
        return null;
      }
      return appendTrailingCommentToResult(translateStraightLineAssignment(
        assignment[1],
        assignment[2],
        subscriptExpression.expression,
        subscriptExpression.nextIndex,
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      ), trailingComment);
    }
    if (parenthesisDelta(assignment[3]) > 0) {
      const expression = collectMultilineParenthesizedExpression(lines, index, assignment[3]);
      if (expression !== null) {
        return appendTrailingCommentToResult(translateStraightLineAssignment(
          assignment[1],
          assignment[2],
          translateExpression(expression.expression, nameMap, arrayNames, validatedTypeAliases, mapNames),
          expression.nextIndex,
          nameMap,
          declaredNames,
          reassignedNames,
          arrayNames,
          validatedTypeAliases,
          mapNames,
          expression.expression,
        ), trailingComment);
      }
    }
    return appendTrailingCommentToResult(translateStraightLineAssignment(
      assignment[1],
      assignment[2],
      translateExpression(assignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames),
      index + 1,
      nameMap,
      declaredNames,
      reassignedNames,
      arrayNames,
      validatedTypeAliases,
      mapNames,
      assignment[3],
    ), trailingComment);
  }

  const multilineNestedCallStatement = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(statement);
  if (multilineNestedCallStatement !== null) {
    const nestedCallExpression = parseMultilineCallExpressionWithOuterClose(
      lines,
      index + 1,
      multilineNestedCallStatement[2],
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (nestedCallExpression === null) {
      return null;
    }
    const outerCallee = translateExpression(multilineNestedCallStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)
      .replace(/\.append$/, '.push')
      .replace(/\.extend$/, '.push');
    return {
      statements: [`${outerCallee}(${nestedCallExpression.expression});`],
      nextIndex: nestedCallExpression.nextIndex,
    };
  }

  const multilineKeywordCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(statement);
  if (multilineKeywordCall !== null) {
    if (multilineKeywordCall[1] === 'MenuView._draw_ui_quad') {
      const callParts = parseMultilineCallParts(
        lines,
        index + 1,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (callParts === null) {
        return null;
      }
      const argByName = new Map(callParts.keywordArgParts.map((part) => [part.pythonName, part.expression]));
      const args = ['texture', 'src', 'dst', 'origin', 'rotation_deg', 'tint'].map((name) => argByName.get(name));
      if (args.some((arg) => arg === undefined)) {
        return null;
      }
      return {
        statements: [`wgl.drawTexturePro(${args.join(', ')});`],
        nextIndex: callParts.nextIndex,
      };
    }
    if (multilineKeywordCall[1] === 'warnings.warn') {
      const callParts = parseMultilineCallParts(
        lines,
        index + 1,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (callParts === null || callParts.positionalParts.length === 0) {
        return null;
      }
      return {
        statements: [`console.warn(${translateCallArgumentExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases)});`],
        nextIndex: callParts.nextIndex,
      };
    }
    const signatureCallParts = parseMultilineCallParts(
      lines,
      index + 1,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (signatureCallParts !== null) {
      const pathlibWriteText = /^(.+)\.write_text$/.exec(multilineKeywordCall[1]);
      if (pathlibWriteText !== null && signatureCallParts.positionalParts.length >= 1) {
        const target = translateExpression(pathlibWriteText[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
        const text = translateCallArgumentExpression(signatureCallParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
        const encoding = signatureCallParts.keywordArgParts.find((part) => part.pythonName === 'encoding')?.expression ?? null;
        return {
          statements: [`writeFileSync(String(${target}), ${text}${encoding === null ? '' : `, { encoding: ${encoding} }`});`],
          nextIndex: signatureCallParts.nextIndex,
        };
      }
      const callee = translateExpression(multilineKeywordCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const signatureCall = translateMultilineCallWithLocalSignature(
        multilineKeywordCall[1],
        callee,
        signatureCallParts,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (signatureCall !== null) {
        return {
          statements: [`${signatureCall};`],
          nextIndex: signatureCallParts.nextIndex,
        };
      }
    }

    const positionalParts: string[] = [];
    const keywordParts: string[] = [];
    let sawKeyword = false;
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const logicalArg = collectContinuedCallArgument(lines, nextIndex);
      const trimmed = logicalArg.text;
      if (trimmed === ')') {
        const callee = translateExpression(multilineKeywordCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
        if (keywordParts.length === 0) {
          return {
            statements: [`${translatePositionalCallExpression(multilineKeywordCall[1], positionalParts, nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
            nextIndex: logicalArg.nextIndex,
          };
        }
        if (positionalParts.length === 0) {
          return {
            statements: [
              `${callee}({`,
              ...keywordParts.map((part) => `  ${part},`),
              '});',
            ],
            nextIndex: logicalArg.nextIndex,
          };
        }
        return {
          statements: [
            `${callee}(`,
            ...positionalParts.map((part) => `  ${translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases)},`),
            `  { ${keywordParts.join(', ')} },`,
            ');',
          ],
          nextIndex: logicalArg.nextIndex,
        };
      }

      const arg = trimmed.replace(/,$/, '');
      const lambdaKeyword = /^([A-Za-z_][A-Za-z0-9_]*)=lambda (.+): \($/.exec(arg);
      if (lambdaKeyword !== null) {
        const lambdaExpression = parseMultilineLambdaTupleExpression(
          lines,
          nextIndex + 1,
          lambdaKeyword[2],
          nameMap,
          arrayNames,
          validatedTypeAliases,
          mapNames,
        );
        if (lambdaExpression === null) {
          return null;
        }
        keywordParts.push(`${tsExportNameForPythonName(lambdaKeyword[1])}: ${lambdaExpression.expression}`);
        nextIndex = lambdaExpression.nextIndex;
        sawKeyword = true;
        continue;
      }
      const lambdaCallKeyword = /^([A-Za-z_][A-Za-z0-9_]*)=lambda (.+): ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(arg);
      if (lambdaCallKeyword !== null) {
        const lambdaExpression = parseMultilineLambdaCallExpression(
          lines,
          nextIndex + 1,
          lambdaCallKeyword[2],
          lambdaCallKeyword[3],
          nameMap,
          arrayNames,
          validatedTypeAliases,
          mapNames,
        );
        if (lambdaExpression === null) {
          return null;
        }
        keywordParts.push(`${tsExportNameForPythonName(lambdaCallKeyword[1])}: ${lambdaExpression.expression}`);
        nextIndex = lambdaExpression.nextIndex;
        sawKeyword = true;
        continue;
      }
      if (arg === '{') {
        const dictLiteral = collectMultilineDictLiteral(
          lines,
          nextIndex + 1,
          nameMap,
          arrayNames,
          validatedTypeAliases,
          mapNames,
        );
        if (dictLiteral === null) {
          return null;
        }
        positionalParts.push(dictLiteral.expression);
        nextIndex = dictLiteral.nextIndex;
        continue;
      }
      if (arg === '(' || arg === '[') {
        if (arg === '(') {
          const parenthesized = collectMultilineParenthesizedExpression(lines, nextIndex, arg);
          if (parenthesized !== null) {
            positionalParts.push(translateExpression(parenthesized.expression.replace(/,$/, ''), nameMap, arrayNames, validatedTypeAliases, mapNames));
            nextIndex = parenthesized.nextIndex;
            continue;
          }
        }
        const sequenceLiteral = collectMultilineSequenceLiteral(
          lines,
          nextIndex + 1,
          arg === '(' ? ')' : ']',
          nameMap,
          arrayNames,
          validatedTypeAliases,
          mapNames,
        );
        if (sequenceLiteral === null) {
          return null;
        }
        positionalParts.push(`[${sequenceLiteral.items.join(', ')}]`);
        nextIndex = sequenceLiteral.nextIndex;
        continue;
      }
      const conditionalArg = parseMultilineConditionalArgument(
        lines,
        nextIndex,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (conditionalArg !== null) {
        if (sawKeyword) {
          return null;
        }
        positionalParts.push(conditionalArg.expression);
        nextIndex = conditionalArg.nextIndex;
        continue;
      }
      const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg);
      if (keywordArg === null) {
        if (sawKeyword) {
          return null;
        }
        const nestedCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(arg);
        if (nestedCall !== null) {
          const callExpression = parseMultilineCallExpression(
            lines,
            nextIndex + 1,
            nestedCall[1],
            nameMap,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
          if (callExpression === null) {
            return null;
          }
          positionalParts.push(callExpression.expression);
          nextIndex = callExpression.nextIndex;
          continue;
        }
        positionalParts.push(arg);
      } else {
        sawKeyword = true;
        if (keywordArg[2] === '{') {
          const dictLiteral = collectMultilineDictLiteral(
            lines,
            nextIndex + 1,
            nameMap,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
          if (dictLiteral === null) {
            return null;
          }
          keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${dictLiteral.expression}`);
          nextIndex = dictLiteral.nextIndex;
          continue;
        }
        const nestedCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(keywordArg[2]);
        if (nestedCall !== null) {
          const callExpression = parseMultilineCallExpression(
            lines,
            nextIndex + 1,
            nestedCall[1],
            nameMap,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
          if (callExpression === null) {
            return null;
          }
          keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${callExpression.expression}`);
          nextIndex = callExpression.nextIndex;
          continue;
        }
        keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${translateKeywordCallArgumentExpression(keywordArg[1], keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
      }
      nextIndex = logicalArg.nextIndex;
    }
    return null;
  }

  const multilineCallStatement = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(/.exec(statement);
  if (multilineCallStatement !== null && parenthesisDelta(statement) > 0) {
    const expression = collectMultilineParenthesizedExpression(lines, index, statement);
    if (expression !== null) {
      const callExpression = translateCollectedMultilineCallExpression(
        expression.expression,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (callExpression !== null) {
        return appendTrailingCommentToResult({
          statements: [`${callExpression};`],
          nextIndex: expression.nextIndex,
        }, trailingComment);
      }
    }
  }

  if (statement === 'super().__init__(') {
    const callParts = parseMultilineCallParts(
      lines,
      index + 1,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (callParts === null) {
      return null;
    }
    const shouldFoldContext = callParts.keywordParts.length > 0 && callParts.positionalParts.length === 1 && callParts.positionalParts[0].trim() === 'ctx';
    const positionalParts = shouldFoldContext
      ? []
      : callParts.positionalParts;
    const contextKeywordParts = shouldFoldContext
      ? ['assetsUrl: ctx.assetsDir', 'preserveBugs: ctx.preserveBugs']
      : [];
    const args = [
      ...positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)),
      ...(callParts.keywordParts.length === 0 ? [] : [`{ ${[...contextKeywordParts, ...callParts.keywordParts].join(', ')} }`]),
    ];
    return {
      statements: [`super(${args.join(', ')});`],
      nextIndex: callParts.nextIndex,
    };
  }

  if (/^(?:r[dl]|wgl)\.(?:hide_cursor|show_cursor|hideCursor|showCursor)\(\)$/.test(statement)) {
    return {
      statements: [],
      nextIndex: index + 1,
    };
  }

  const callStatement = /^(.+\))$/.exec(statement);
  if (callStatement !== null) {
    const structPackIntoCall = /^struct\.pack_into\((.*)\)$/.exec(callStatement[1]);
    if (structPackIntoCall !== null) {
      const args = splitTopLevelComma(structPackIntoCall[1]);
      if (args.length === 4) {
        return {
          statements: [`pythonStructFormat(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}).packInto(${translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(args[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(args[3], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
          nextIndex: index + 1,
        };
      }
    }
    const pathlibWriteBytes = /^(?:Path\((.+)\)|(.+))\.write_bytes\((.+)\)$/.exec(callStatement[1]);
    if (pathlibWriteBytes !== null) {
      return {
        statements: [`writeFileSync(String(${translateExpression(pathlibWriteBytes[1] ?? pathlibWriteBytes[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}), ${translateExpression(pathlibWriteBytes[3], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
        nextIndex: index + 1,
      };
    }
    const pathlibWriteText = /^(?:Path\((.+)\)|(.+))\.write_text\((.*)\)$/.exec(callStatement[1]);
    if (pathlibWriteText !== null) {
      const args = splitTopLevelComma(pathlibWriteText[3]);
      if (args.length >= 1) {
        const target = translateExpression(pathlibWriteText[1] ?? pathlibWriteText[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
        const text = translateCallArgumentExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
        const encodingArg = args.find((arg) => arg.trim().startsWith('encoding='));
        const encoding = encodingArg === undefined ? null : translateExpression(encodingArg.trim().slice('encoding='.length), nameMap, arrayNames, validatedTypeAliases, mapNames);
        return {
          statements: [`writeFileSync(String(${target}), ${text}${encoding === null ? '' : `, { encoding: ${encoding} }`});`],
          nextIndex: index + 1,
        };
      }
    }
    const listInsertCall = /^(.+)\.insert\((.*)\)$/.exec(callStatement[1]);
    if (listInsertCall !== null) {
      const args = splitTopLevelComma(listInsertCall[2]);
      if (args.length === 2) {
        return {
          statements: [`${translateExpression(listInsertCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.splice(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}, 0, ${translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
          nextIndex: index + 1,
        };
      }
    }
    const mapItemAppend = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]\.append\((.+)\)$/.exec(callStatement[1]);
    if (mapItemAppend !== null) {
      const mapName = translateExpression(mapItemAppend[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
        const key = translateMapKeyExpression(mapName, translateExpression(mapItemAppend[2], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
        return {
          statements: [`mapGetOrInit(${mapName}, ${key}, () => []).push(${translateExpression(mapItemAppend[3], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
          nextIndex: index + 1,
        };
      }
    }
    const setDefaultAppend = /^(.+)\.setdefault\((.*)\)\.append\((.+)\)$/.exec(callStatement[1]);
    if (setDefaultAppend !== null) {
      const args = splitTopLevelComma(setDefaultAppend[2]);
      if (args.length === 2) {
        const mapName = translateExpression(setDefaultAppend[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
        if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
          const key = translateMapKeyExpression(mapName, translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
          return {
            statements: [`mapGetOrInit(${mapName}, ${key}, () => ${translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}).push(${translateExpression(setDefaultAppend[3], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
            nextIndex: index + 1,
          };
        }
      }
    }
    const removeCall = /^(.+)\.remove\((.+)\)$/.exec(callStatement[1]);
    if (removeCall !== null) {
      const target = translateExpression(removeCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (arrayNames.has(removeCall[1]) || arrayNames.has(target)) {
        return {
          statements: [`arrayRemove(${target}, ${translateExpression(removeCall[2], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
          nextIndex: index + 1,
        };
      }
    }
    const discardCall = /^(.+)\.discard\((.+)\)$/.exec(callStatement[1]);
    if (discardCall !== null) {
      const target = translateExpression(discardCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return {
        statements: [`${target}.delete(${translateExpression(discardCall[2], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
        nextIndex: index + 1,
      };
    }
    const sortKeyCall = /^(.+)\.sort\((.*)\)$/.exec(callStatement[1]);
    if (sortKeyCall !== null) {
      const args = splitTopLevelComma(sortKeyCall[2]);
      const keyArg = args.find((arg) => arg.trim().startsWith('key='));
      if (keyArg !== undefined) {
        const lambda = /^key=lambda ([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(keyArg.trim());
        if (lambda !== null) {
          const target = translateExpression(sortKeyCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
          const paramName = tsExportNameForPythonName(lambda[1]);
          const keyNameMap = new Map(nameMap);
          keyNameMap.set(lambda[1], paramName);
          const keyExpression = translateExpression(lambda[2], keyNameMap, arrayNames, validatedTypeAliases, mapNames);
          const reverse = args.some((arg) => /^reverse=True$/.test(arg.trim()));
          return {
            statements: [`${target}.sort((left, right) => ${reverse ? '-1 * ' : ''}pythonCompareKeys(((${paramName}) => ${keyExpression})(left), ((${paramName}) => ${keyExpression})(right)));`],
            nextIndex: index + 1,
          };
        }
      }
    }
    const sortCall = /^(.+)\.sort\(\)$/.exec(callStatement[1]);
    if (sortCall !== null) {
      const target = translateExpression(sortCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const numericSort = arrayNames.has(numberArrayNameMarker(sortCall[1])) || arrayNames.has(numberArrayNameMarker(target));
      return {
        statements: [`${target}.sort(${numericSort ? '(a, b) => a - b' : ''});`],
        nextIndex: index + 1,
      };
    }
    const dictPopDefaultNone = /^(.+)\.pop\((.+), None\)$/.exec(callStatement[1]);
    if (dictPopDefaultNone !== null) {
      const mapName = translateExpression(dictPopDefaultNone[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
        return {
          statements: [`${mapName}.delete(${translateMapKeyExpression(mapName, translateExpression(dictPopDefaultNone[2], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames)});`],
          nextIndex: index + 1,
        };
      }
      return {
        statements: [`delete ${mapName}[${translateExpression(dictPopDefaultNone[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}];`],
        nextIndex: index + 1,
      };
    }
    const moveToEndCall = /^(.+)\.move_to_end\((.*)\)$/.exec(callStatement[1]);
    if (moveToEndCall !== null) {
      const args = splitTopLevelComma(moveToEndCall[2]);
      if (args.length >= 1 && args.length <= 2) {
        const mapName = translateExpression(moveToEndCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
        const key = translateMapKeyExpression(mapName, translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
        const lastArg = args[1] === undefined ? 'true' : /^last=(.+)$/.exec(args[1])?.[1] ?? args[1];
        return {
          statements: [`mapMoveToEnd(${mapName}, ${key}, ${translateExpression(lastArg, nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
          nextIndex: index + 1,
        };
      }
    }
    const updateCall = /^(.+)\.update\((.*)\)$/.exec(callStatement[1]);
    if (updateCall !== null) {
      const target = translateExpression(updateCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (arrayNames.has(setNameMarker(updateCall[1])) || arrayNames.has(setNameMarker(target))) {
        const updateStatements = translateSetUpdateStatements(
          target,
          updateCall[2],
          nameMap,
          arrayNames,
          validatedTypeAliases,
          mapNames,
        );
        if (updateStatements !== null) {
          return {
            statements: updateStatements,
            nextIndex: index + 1,
          };
        }
      }
    }
    const superMethodCall = /^super\(\)\.([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/.exec(callStatement[1]);
    if (superMethodCall !== null) {
      return {
        statements: [`${translateExpression(callStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
        nextIndex: index + 1,
      };
    }
    const setattrCall = /^setattr\(.+\)$/.exec(callStatement[1]);
    if (setattrCall !== null) {
      return {
        statements: [`${translateExpression(callStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
        nextIndex: index + 1,
      };
    }
    const clearCall = /^(.+)\.clear\(\)$/.exec(callStatement[1]);
    if (clearCall !== null && isSimpleReferenceExpression(clearCall[1]) && !['self', 'cls', 'this'].includes(clearCall[1])) {
      const target = translateExpression(clearCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (arrayNames.has(clearCall[1]) || arrayNames.has(target)) {
        return {
          statements: [`${target}.length = 0;`],
          nextIndex: index + 1,
        };
      }
      if (
        mapNames.has(clearCall[1])
        || expressionIsKnownMap(target, nameMap, mapNames)
        || arrayNames.has(setNameMarker(clearCall[1]))
        || arrayNames.has(setNameMarker(target))
      ) {
        return {
          statements: [`${target}.clear();`],
          nextIndex: index + 1,
        };
      }
      return {
        statements: [
          '((target: unknown) => {',
          '  if (target !== null && typeof target === \'object\' && typeof (target as { clear?: unknown }).clear === \'function\') {',
          '    (target as { clear: () => void }).clear();',
          '  } else if (target !== null && typeof target === \'object\' && \'length\' in target) {',
          '    (target as { length: number }).length = 0;',
          '  }',
          `})(${target});`,
        ],
        nextIndex: index + 1,
      };
    }
    const raylibSetTexture = /^r[dl]\.rl_set_texture\((.+)\.id\)$/.exec(callStatement[1]);
    if (
      raylibSetTexture !== null
      && (lines[index + 1] ?? '').trim() === 'rl.rl_begin(rd.RL_QUADS)'
    ) {
      return {
        statements: [`wgl.beginQuads(${translateExpression(raylibSetTexture[1], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
        nextIndex: index + 2,
      };
    }
    if (callStatement[1] === 'rl.rl_end()') {
      return {
        statements: ['wgl.endQuads();'],
        nextIndex: (lines[index + 1] ?? '').trim() === 'rl.rl_set_texture(0)' ? index + 2 : index + 1,
      };
    }
    if (callStatement[1] === 'ui.draw()' && nameMap.get('self') === 'this') {
      return {
        statements: [
          'const resources = this.state.resources;',
          'if (resources === null) {',
          '  return;',
          '}',
          'ui.draw({ resources });',
        ],
        nextIndex: index + 1,
      };
    }
    const simpleCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/.exec(callStatement[1]);
    if (simpleCall !== null) {
      const args = splitTopLevelComma(simpleCall[2]);
      if (args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))) {
        return {
          statements: [`${translatePositionalCallExpression(simpleCall[1], args, nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
          nextIndex: index + 1,
        };
      }
    }
    return { statements: [`${translateExpression(callStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)};`], nextIndex: index + 1 };
  }

  return null;
}

function translateReturnExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const translated = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const returnType = nameMap.get(functionReturnTypeMarker('__current__'));
  const trimmed = translated.trim();
  const enumReturnCast = /^([A-Z][A-Za-z0-9_]*(?:Id|Mode|Type|Flags|Scheme))\((.+)\)$/.exec(pythonExpression.trim());
  if (enumReturnCast !== null && returnType === tsExportNameForPythonName(enumReturnCast[1])) {
    return `${translateExpression(enumReturnCast[2], nameMap, arrayNames, validatedTypeAliases, mapNames)} as unknown as ${returnType}`;
  }
  if (returnType?.startsWith('[') === true && trimmed.startsWith('Array.from(')) {
    return `${translated} as ${returnType}`;
  }
  if (returnType?.startsWith('Map<') === true && trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return `new Map(Object.entries(${translated}))`;
  }
  if (returnType?.startsWith('Map<') === true && trimmed.startsWith('Object.fromEntries(')) {
    return `new Map(Object.entries(${translated}))`;
  }
  return translated;
}

function parseWrappedMultilineExpression(
  lines: string[],
  startIndex: number,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): { expression: string; nextIndex: number } | null {
  const parts: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    const close = /^\)(.*)$/.exec(trimmed);
    if (close !== null) {
      const suffix = close[1].trim();
      const expression = suffix === ''
        ? parts.join(' ')
        : `${parts.join(' ')} ${suffix}`;
      return parts.length === 0
        ? null
        : {
          expression: translateExpression(expression, nameMap, arrayNames, validatedTypeAliases, mapNames),
          nextIndex: nextIndex + 1,
        };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }

    const expressionLine = trimmed.replace(/,$/, '');
    const multilineCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(expressionLine);
    if (multilineCall !== null) {
      const callExpression = parseMultilineCallExpression(
        lines,
        nextIndex + 1,
        multilineCall[1],
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (callExpression === null) {
        return null;
      }
      parts.push(callExpression.expression);
      nextIndex = callExpression.nextIndex;
      continue;
    }

    parts.push(expressionLine);
    nextIndex += 1;
  }
  return null;
}

function parseMultilineListComprehension(
  lines: string[],
  startIndex: number,
  indent: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { expression: string; nextIndex: number; tupleElements: boolean } | null {
  const innerIndent = `${indent}    `;
  const firstLine = lines[startIndex] ?? '';
  if (!firstLine.startsWith(innerIndent)) {
    return null;
  }
  const firstExpression = firstLine.trim().replace(/,$/, '');
  const inlineGenerator = /^(.+?) for ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*) in (.+?)(?: if (.+))?$/.exec(firstExpression);
  if (inlineGenerator !== null) {
    const closeLine = lines[startIndex + 1] ?? '';
    if (!closeLine.startsWith(indent) || closeLine.trim() !== ']') {
      return null;
    }
    const itemNameMap = new Map(nameMap);
    const targetNames = inlineGenerator[2].split(', ');
    for (const targetName of targetNames) {
      itemNameMap.set(targetName, tsExportNameForPythonName(targetName));
    }
    const mapParameter = targetNames.length === 1
      ? tsExportNameForPythonName(targetNames[0])
      : `[${targetNames.map(tsExportNameForPythonName).join(', ')}]`;
    const iterable = iterableExpressionForIteration(inlineGenerator[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const filtered = inlineGenerator[4] === undefined
      ? iterable
      : `${iterable}.filter((${mapParameter}) => ${translateExpression(inlineGenerator[4], itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    const itemExpression = translateExpression(inlineGenerator[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames);
    return {
      expression: `${filtered}.map((${mapParameter}) => ${tupleListComprehensionItemExpression(inlineGenerator[1], itemExpression)})`,
      nextIndex: startIndex + 2,
      tupleElements: pythonExpressionCouldBeTupleLiteral(inlineGenerator[1]),
    };
  }

  let itemExpression = '';
  let nextIndex: number;
  let tupleElements = false;
  const multilineCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(firstExpression);
  if (firstExpression === '(') {
    const tupleItems: string[] = [];
    nextIndex = startIndex + 1;
    while (nextIndex < lines.length) {
      const line = lines[nextIndex] ?? '';
      const trimmed = line.trim();
      if (line.startsWith(innerIndent) && (trimmed === ')' || trimmed === '),')) {
        itemExpression = `[${tupleItems.join(', ')}]`;
        tupleElements = true;
        nextIndex += 1;
        break;
      }
      if (trimmed === '') {
        nextIndex += 1;
        continue;
      }
      if (!line.startsWith(`${innerIndent}    `) || !trimmed.endsWith(',')) {
        return null;
      }
      tupleItems.push(translateExpression(trimmed.slice(0, -1), nameMap, arrayNames, validatedTypeAliases, mapNames));
      nextIndex += 1;
    }
    if (!tupleElements) {
      return null;
    }
  } else if (multilineCall !== null) {
    const callExpression = parseMultilineCallExpression(
      lines,
      startIndex + 1,
      multilineCall[1],
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (callExpression === null) {
      return null;
    }
    itemExpression = callExpression.expression;
    nextIndex = callExpression.nextIndex;
  } else {
    itemExpression = translateExpression(firstExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
    nextIndex = startIndex + 1;
  }

  const forLine = lines[nextIndex] ?? '';
  if (!forLine.startsWith(innerIndent)) {
    return null;
  }
  const forClause = /^for ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*) in (.+)$/.exec(forLine.trim());
  if (forClause === null) {
    return null;
  }
  let closeIndex = nextIndex + 1;
  let filterExpression: string | null = null;
  const ifClause = /^if (.+)$/.exec((lines[closeIndex] ?? '').trim());
  if (ifClause !== null) {
    filterExpression = ifClause[1];
    closeIndex += 1;
  }
  const closeLine = lines[closeIndex] ?? '';
  if (!closeLine.startsWith(indent) || closeLine.trim() !== ']') {
    return null;
  }
  const itemNameMap = new Map(nameMap);
  const targetNames = forClause[1].split(', ');
  for (const targetName of targetNames) {
    itemNameMap.set(targetName, tsExportNameForPythonName(targetName));
  }
  const mapParameter = targetNames.length === 1
    ? tsExportNameForPythonName(targetNames[0])
    : `[${targetNames.map(tsExportNameForPythonName).join(', ')}]`;
  const enumerateIterable = parseEnumerateIterableExpression(forClause[2]);
  if (targetNames.length === 2 && enumerateIterable !== null && enumerateIterable.start === null && filterExpression === null) {
    const indexName = tsExportNameForPythonName(targetNames[0]);
    const itemName = tsExportNameForPythonName(targetNames[1]);
    const iterable = iterableExpressionForIteration(enumerateIterable.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return {
      expression: `${iterable}.map((${itemName}, ${indexName}) => ${itemExpression})`,
      nextIndex: closeIndex + 1,
      tupleElements,
    };
  }
  const iterable = targetNames.length > 1 && enumerateIterable !== null
    ? enumerateArrayExpression(enumerateIterable, nameMap, arrayNames, validatedTypeAliases, mapNames)
    : iterableExpressionForIteration(forClause[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const filtered = filterExpression === null
    ? iterable
    : `${iterable}.filter((${mapParameter}) => ${translateExpression(filterExpression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  return {
    expression: `${filtered}.map((${mapParameter}) => ${itemExpression})`,
    nextIndex: closeIndex + 1,
    tupleElements,
  };
}

function tupleListComprehensionItemExpression(pythonExpression: string, itemExpression: string): string {
  const tupleLength = pythonTupleExpressionLength(pythonExpression);
  return tupleLength === null ? itemExpression : tupleArrayExpressionFromLength(itemExpression, tupleLength);
}

function tupleArrayExpressionFromLength(itemExpression: string, length: number): string {
  return `${itemExpression} as [${Array.from({ length }, () => 'any').join(', ')}]`;
}

function iterableExpressionForIteration(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const iterable = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (expressionIsKnownMap(iterable, nameMap, mapNames)) {
    return `Array.from(${iterable}.keys())`;
  }
  if (arrayNames.has(objectNameMarker(pythonExpression)) || arrayNames.has(objectNameMarker(iterable))) {
    return `Object.keys(${iterable})`;
  }
  if (arrayNames.has(setNameMarker(pythonExpression)) || arrayNames.has(setNameMarker(iterable))) {
    return `Array.from(${iterable})`;
  }
  return iterable;
}

function parseEnumerateIterableExpression(pythonExpression: string): EnumerateCallArgs | null {
  const enumerateCall = /^enumerate\((.+)\)$/.exec(pythonExpression.trim());
  return enumerateCall === null ? null : parseEnumerateCallArgs(enumerateCall[1]);
}

function parseForTargetPattern(pythonTarget: string): { pattern: string; pythonNames: string[] } | null {
  const target = pythonTarget.trim();
  const simpleTarget = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(target);
  if (simpleTarget !== null) {
    return {
      pattern: target === '_' ? '_' : tsExportNameForPythonName(target),
      pythonNames: target === '_' ? [] : [target],
    };
  }

  const wrappedTarget = /^\((.*)\)$|^\[(.*)\]$/.exec(target);
  const innerTarget = wrappedTarget?.[1] ?? wrappedTarget?.[2] ?? target;
  const parts = splitTopLevelComma(innerTarget);
  if (parts.length < 2) {
    return null;
  }
  const parsedParts = parts.map(parseForTargetPattern);
  if (parsedParts.some((part) => part === null)) {
    return null;
  }
  return {
    pattern: `[${parsedParts.map((part) => part?.pattern ?? '').join(', ')}]`,
    pythonNames: parsedParts.flatMap((part) => part?.pythonNames ?? []),
  };
}

function enumerateForOfExpression(
  enumerateArgs: EnumerateCallArgs,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const iterable = iterableExpressionForIteration(enumerateArgs.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (enumerateArgs.start === null) {
    return `${iterable}.entries()`;
  }
  const start = translateExpression(enumerateArgs.start, nameMap, arrayNames, validatedTypeAliases, mapNames);
  return start === '0'
    ? `${iterable}.entries()`
    : `Array.from(${iterable}, (item, index) => [index + ${start}, item] as const)`;
}

function enumerateArrayExpression(
  enumerateArgs: EnumerateCallArgs,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const iterable = iterableExpressionForIteration(enumerateArgs.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const start = enumerateArgs.start === null
    ? '0'
    : translateExpression(enumerateArgs.start, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const indexExpression = start === '0' ? 'index' : `index + ${start}`;
  return `Array.from(${iterable}, (item, index) => [${indexExpression}, item] as const)`;
}

function translateSetUpdateStatements(
  target: string,
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string[] | null {
  const args = splitTopLevelComma(argsText);
  if (args.length !== 1) {
    return null;
  }
  const generator = parseSimpleGeneratorExpression(args[0]);
  if (generator !== null) {
    const itemName = tsExportNameForPythonName(generator.itemName);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(generator.itemName, itemName);
    const iterable = iterableExpressionForIteration(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const value = translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames);
    return [
      `for (const ${itemName} of ${iterable}) {`,
      ...(generator.condition === null
        ? []
        : [`  if (!(${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})) continue;`]),
      `  ${target}.add(${value});`,
      '}',
    ];
  }
  return [
    `for (const item of ${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
    `  ${target}.add(item);`,
    '}',
  ];
}

function parseSimpleGeneratorExpression(pythonExpression: string): { expression: string; itemName: string; iterable: string; condition: string | null } | null {
  const trimmed = stripBalancedOuterParens(pythonExpression.trim());
  const generator = /^(.+?)(?:,)? for ([A-Za-z_][A-Za-z0-9_]*) in (.+?)(?: if (.+))?$/.exec(trimmed);
  if (generator === null) {
    return null;
  }
  return {
    expression: generator[1],
    itemName: generator[2],
    iterable: generator[3],
    condition: generator[4] ?? null,
  };
}

function translateEnumValueFallbackStatement(
  lines: string[],
  index: number,
  indent: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { statements: string[]; nextIndex: number } | null {
  const innerIndent = `${indent}    `;
  const tryReturn = new RegExp(`^${escapeRegExp(innerIndent)}return ([A-Za-z_][A-Za-z0-9_]*)\\((.+)\\)$`).exec(lines[index + 1] ?? '');
  if (tryReturn === null || (lines[index + 2] ?? '') !== `${indent}except ValueError:`) {
    return null;
  }
  const fallbackReturn = new RegExp(`^${escapeRegExp(innerIndent)}return ${tryReturn[1]}\\.([A-Z][A-Z0-9_]*)$`).exec(lines[index + 3] ?? '');
  if (fallbackReturn === null) {
    return null;
  }
  const enumName = translateExpression(tryReturn[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const value = translateExpression(tryReturn[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
  return {
    statements: [
      `if (Object.values(${enumName}).includes(${value} as ${enumName})) {`,
      `  return ${value} as ${enumName};`,
      '}',
      `return ${translateExpression(`${tryReturn[1]}.${fallbackReturn[1]}`, nameMap, arrayNames, validatedTypeAliases, mapNames)};`,
    ],
    nextIndex: index + 4,
  };
}

function translateListIndexValueErrorFallbackStatement(
  lines: string[],
  index: number,
  indent: string,
  nameMap: Map<string, string>,
  declaredNames: Set<string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { statements: string[]; nextIndex: number } | null {
  const innerIndent = `${indent}    `;
  const tryAssignmentLine = lines[index + 1] ?? '';
  const exceptLine = lines[index + 2] ?? '';
  const fallbackLine = lines[index + 3] ?? '';
  if (
    !tryAssignmentLine.startsWith(innerIndent)
    || !lineStartsAtIndent(exceptLine, indent)
    || !fallbackLine.startsWith(innerIndent)
    || exceptLine.trim() !== 'except ValueError:'
  ) {
    return null;
  }

  const tryAssignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)\.index\((.+)\)$/.exec(tryAssignmentLine.trim());
  if (tryAssignment === null) {
    return null;
  }
  const fallbackAssignment = new RegExp(`^${tryAssignment[1]} = (.+)$`).exec(fallbackLine.trim());
  if (fallbackAssignment === null) {
    return null;
  }

  const pythonName = tryAssignment[1];
  const tsName = nameMap.get(pythonName) ?? tsExportNameForPythonName(pythonName);
  const receiver = translateExpression(tryAssignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const value = translateExpression(tryAssignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const fallback = translateExpression(fallbackAssignment[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const declaration = nameMap.has(pythonName) || declaredNames.has(pythonName) ? '' : 'let ';
  declaredNames.add(pythonName);
  arrayNames.add(numberNameMarker(pythonName));
  arrayNames.add(numberNameMarker(tsName));
  return {
    statements: [
      `${declaration}${tsName} = ${receiver}.indexOf(${value});`,
      `if (${tsName} < 0) {`,
      `  ${tsName} = ${fallback};`,
      '}',
    ],
    nextIndex: index + 4,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function blockAssignsName(lines: string[], startIndex: number, blockIndent: string, name: string): boolean {
  const escapedName = escapeRegExp(name);
  const directAssignment = new RegExp(`^${escapedName}(?:\\s*(?://=|\\+=|-=|\\*=|/=|\\|=|&=|\\^=|=)|\\s*:)\\s`);
  const tupleAssignment = new RegExp(`^(?:[A-Za-z_][A-Za-z0-9_]*,\\s*)*${escapedName}(?:\\s*,\\s*[A-Za-z_][A-Za-z0-9_]*)+\\s*=\\s`);
  for (let nextIndex = startIndex; nextIndex < lines.length; nextIndex += 1) {
    const line = lines[nextIndex] ?? '';
    if (line.trim() !== '' && !line.startsWith(blockIndent)) {
      break;
    }
    const statement = splitInlineComment(line.trim()).code;
    if (directAssignment.test(statement) || tupleAssignment.test(statement)) {
      return true;
    }
  }
  return false;
}

function collectMultilineListLiteral(
  lines: string[],
  startIndex: number,
  indent: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { items: string[]; nextIndex: number } | null {
  const innerIndent = `${indent}    `;
  const items: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (line.startsWith(indent) && trimmed === ']') {
      return { items, nextIndex: nextIndex + 1 };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith(innerIndent)) {
      return null;
    }
    const item = trimmed.replace(/,$/, '');
    const multilineCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(item);
    if (multilineCall !== null) {
      const callExpression = parseMultilineCallExpression(
        lines,
        nextIndex + 1,
        multilineCall[1],
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (callExpression === null) {
        return null;
      }
      items.push(callExpression.expression);
      nextIndex = callExpression.nextIndex;
      continue;
    }
    items.push(translateExpression(item, nameMap, arrayNames, validatedTypeAliases, mapNames));
    nextIndex += 1;
  }
  return null;
}

function multilineListLiteralExpression(items: string[]): string {
  const expression = `[${items.join(', ')}]`;
  return listLiteralItemsLookLikeTupleArray(items) ? `${expression} as const` : expression;
}

function listLiteralItemsLookLikeTupleArray(items: readonly string[]): boolean {
  return items.length > 0 && items.every((item) => {
    const trimmed = item.trim();
    const tupleArray = /^\[([\s\S]*)\](?: as const)?$/.exec(trimmed);
    return tupleArray !== null && splitTopLevelComma(tupleArray[1]).length > 1;
  });
}

export function collectMultilineSequenceLiteral(
  lines: string[],
  startIndex: number,
  closeLine: ')' | ']',
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { items: string[]; nextIndex: number } | null {
  const items: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === closeLine || trimmed === `${closeLine},`) {
      return { items, nextIndex: nextIndex + 1 };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }

    const item = trimmed.replace(/,$/, '');
    const multilineCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(item);
    if (multilineCall !== null) {
      const callExpression = parseMultilineCallExpression(
        lines,
        nextIndex + 1,
        multilineCall[1],
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (callExpression === null) {
        return null;
      }
      items.push(callExpression.expression);
      nextIndex = callExpression.nextIndex;
      continue;
    }

    items.push(translateSequenceItemExpression(item, nameMap, arrayNames, validatedTypeAliases, mapNames));
    nextIndex += 1;
  }
  return null;
}

function translateSequenceItemExpression(
  item: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const starred = /^\*(.+)$/.exec(item.trim());
  return starred === null
    ? translateExpression(item, nameMap, arrayNames, validatedTypeAliases, mapNames)
    : `...${translateExpression(starred[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
}

function collectMultilineDictLiteral(
  lines: string[],
  startIndex: number,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { expression: string; nextIndex: number } | null {
  const parts: string[] = [];
  const entries: string[] = [];
  let requiresMap = false;
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    const closingGet = /^\}\.get\((.*)\)$/.exec(trimmed);
    if (closingGet !== null) {
      const args = splitTopLevelComma(closingGet[1]);
      if (args.length !== 1 && args.length !== 2) {
        return null;
      }
      const mapExpression = `new Map([${entries.join(', ')}])`;
      const key = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const value = `${mapExpression}.get(${key})`;
      return {
        expression: args.length === 1
          ? `${value} ?? null`
          : `${value} ?? ${translateMapDefaultExpression(args[1], '', mapExpression, nameMap, arrayNames, validatedTypeAliases, mapNames)}`,
        nextIndex: nextIndex + 1,
      };
    }
    if (trimmed === '}' || trimmed === '},') {
      return {
        expression: requiresMap ? `new Map([${entries.join(', ')}])` : `{ ${parts.join(', ')} }`,
        nextIndex: nextIndex + 1,
      };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    const item = /^(.+?): (.*)$/.exec(trimmed);
    if (item === null) {
      return null;
    }
    nextIndex += 1;
    const valueParts = [item[2]];
    while (!valueEndsWithTopLevelComma(valueParts.join(' '))) {
      if (nextIndex >= lines.length) {
        return null;
      }
      valueParts.push(lines[nextIndex].trim());
      nextIndex += 1;
    }
    const value = stripBalancedOuterParens(valueParts.join(' ').replace(/,\s*$/, ''));
    const translatedValue = translateExpression(value, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const stringKey = parsePythonStringExpression(item[1]);
    if (stringKey === null) {
      requiresMap = true;
    }
    entries.push(`[${translateExpression(item[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translatedValue}]`);
    parts.push(`${renderObjectLiteralKey(item[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}: ${translatedValue}`);
  }
  return null;
}

function renderObjectLiteralKey(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const stringKey = parsePythonStringExpression(pythonExpression);
  if (stringKey !== null) {
    return JSON.stringify(stringKey.content);
  }
  return `[${translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames)}]`;
}

function valueEndsWithTopLevelComma(value: string): boolean {
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
    if (char === ',' && depth === 0 && value.slice(index + 1).trim() === '') {
      return true;
    }
  }
  return false;
}

function stripBalancedOuterParens(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('(')) {
    return trimmed;
  }
  const closeIndex = matchingCloseParen(trimmed, 0);
  return closeIndex === trimmed.length - 1 ? trimmed.slice(1, -1).trim() : trimmed;
}

function parseMultilineLambdaTupleExpression(
  lines: string[],
  startIndex: number,
  paramsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { expression: string; nextIndex: number } | null {
  const lambdaNameMap = new Map(nameMap);
  const params: string[] = [];
  for (const paramText of splitTopLevelComma(paramsText)) {
    const defaulted = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(paramText);
    if (defaulted !== null) {
      const tsName = tsExportNameForPythonName(defaulted[1]);
      const defaultValue = translateExpression(defaulted[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (defaultValue === tsName) {
        lambdaNameMap.set(defaulted[1], tsName);
      } else {
        const paramName = `${tsName}Param`;
        params.push(`${paramName} = ${defaultValue}`);
        lambdaNameMap.set(defaulted[1], paramName);
      }
      continue;
    }
    const plain = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(paramText);
    if (plain === null) {
      return null;
    }
    const tsName = tsExportNameForPythonName(plain[1]);
    params.push(tsName);
    lambdaNameMap.set(plain[1], tsName);
  }

  const statements: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '),') {
      return {
        expression: `(${params.join(', ')}) => { ${statements.join(' ')} }`,
        nextIndex: nextIndex + 1,
      };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    const multilineCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(trimmed);
    if (multilineCall !== null) {
      const callExpression = parseMultilineCallExpression(
        lines,
        nextIndex + 1,
        multilineCall[1],
        lambdaNameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (callExpression === null) {
        return null;
      }
      statements.push(`${callExpression.expression};`);
      nextIndex = callExpression.nextIndex;
      continue;
    }
    const expressionItem = /^(.+),$/.exec(trimmed);
    if (expressionItem === null) {
      return null;
    }
    statements.push(`${translateExpression(expressionItem[1], lambdaNameMap, arrayNames, validatedTypeAliases, mapNames)};`);
    nextIndex += 1;
  }
  return null;
}

function parseMultilineLambdaCallExpression(
  lines: string[],
  startIndex: number,
  paramsText: string,
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { expression: string; nextIndex: number } | null {
  const lambdaNameMap = new Map(nameMap);
  const params: string[] = [];
  for (const paramText of splitTopLevelComma(paramsText)) {
    const defaulted = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(paramText);
    if (defaulted !== null) {
      const tsName = tsExportNameForPythonName(defaulted[1]);
      const defaultValue = translateExpression(defaulted[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (defaultValue === tsName) {
        lambdaNameMap.set(defaulted[1], tsName);
      } else {
        const paramName = `${tsName}Param`;
        params.push(`${paramName} = ${defaultValue}`);
        lambdaNameMap.set(defaulted[1], paramName);
      }
      continue;
    }
    const plain = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(paramText);
    if (plain === null) {
      return null;
    }
    const tsName = tsExportNameForPythonName(plain[1]);
    params.push(tsName);
    lambdaNameMap.set(plain[1], tsName);
  }

  const callExpression = parseMultilineCallExpression(
    lines,
    startIndex,
    pythonCallee,
    lambdaNameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (callExpression === null) {
    return null;
  }
  return {
    expression: `(${params.join(', ')}) => ${callExpression.expression}`,
    nextIndex: callExpression.nextIndex,
  };
}

export function parseMultilineCallExpression(
  lines: string[],
  startIndex: number,
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): { expression: string; nextIndex: number } | null {
  const callParts = parseMultilineCallParts(lines, startIndex, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (callParts === null) {
    return null;
  }

  return {
    expression: translateMultilineCallExpressionFromParts(
      pythonCallee,
      callParts,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    ),
    nextIndex: callParts.nextIndex,
  };
}

function translateMultilineCallExpressionFromParts(
  pythonCallee: string,
  callParts: MultilineCallParts,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const msgspecStructsReplace = translateMultilineMsgspecStructsReplace(
    pythonCallee,
    callParts,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (msgspecStructsReplace !== null) {
    return msgspecStructsReplace;
  }
  if (pythonCallee === 'subprocess.check_output') {
    return 'new Uint8Array()';
  }
  if (pythonCallee === 'cast' && callParts.positionalParts.length === 2 && callParts.keywordParts.length === 0) {
    const typeText = callParts.positionalParts[0].trim();
    return `${translateExpression(callParts.positionalParts[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} as ${tsTypeExpression(typeText)}`;
  }
  if (
    /^[A-Z][A-Za-z0-9_]*(?:Id|Type|Flags)$/.test(pythonCallee)
    && callParts.positionalParts.length === 1
    && callParts.keywordParts.length === 0
  ) {
    return translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
  }
  if (pythonCallee === 'msgspec.msgpack.encode' && callParts.positionalParts.length === 1 && callParts.keywordParts.length === 0) {
    return `new MsgpackEncoder().encode(${translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  if (pythonCallee === 'msgspec.msgpack.decode' && callParts.positionalParts.length >= 1) {
    const typeArg = callParts.keywordArgParts.find((part) => part.pythonName === 'type');
    const typeExpression = typeArg === undefined ? 'undefined' : typeArg.expression;
    const typeParameter = typeArg !== undefined && /^[A-Z][A-Za-z0-9_$]*$/.test(typeExpression) ? `<${typeExpression}>` : '';
    return `new MsgpackDecoder${typeParameter}({ type: ${typeExpression} }).decode(${translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  if (pythonCallee === 'str' && callParts.positionalParts.length === 1 && callParts.keywordParts.length === 0) {
    return `String(${callParts.positionalParts[0]})`;
  }
  const stringJoinCallee = /^((?:[fF])?(["'])(?:\\.|(?!\2)[\s\S])*\2)\.join$/.exec(pythonCallee);
  if (stringJoinCallee !== null && callParts.positionalParts.length === 1 && callParts.keywordParts.length === 0) {
    const separator = parsePythonStringExpression(stringJoinCallee[1]);
    if (separator !== null) {
      return `${translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}.join(${JSON.stringify(separator.content)})`;
    }
  }
  if ((pythonCallee === 'list' || pythonCallee === 'tuple') && callParts.keywordParts.length === 0) {
    if (callParts.positionalParts.length === 0) {
      return '[]';
    }
    if (callParts.positionalParts.length === 1) {
      return `Array.from(${translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }
  const dictGetCallee = /^(.+)\.get$/.exec(pythonCallee);
  if (
    dictGetCallee !== null
    && callParts.keywordParts.length === 0
    && (callParts.positionalParts.length === 1 || callParts.positionalParts.length === 2)
  ) {
    const mapName = translateExpression(dictGetCallee[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const key = translateMapKeyExpression(mapName, translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
    const value = arrayNames.has(objectNameMarker(dictGetCallee[1])) || arrayNames.has(objectNameMarker(mapName))
      ? `${mapName}[${key}]`
      : `${mapName}.get(${key})`;
    return callParts.positionalParts.length === 1
      ? `${value} ?? null`
      : `${value} ?? ${translateMapDefaultExpression(callParts.positionalParts[1], dictGetCallee[1], mapName, nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const callee = translateExpression(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  const callPrefix = /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
  const sequenceGenerator = translateMultilineSequenceGenerator(
    pythonCallee,
    callParts.positionalParts,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (sequenceGenerator !== null && callParts.keywordParts.length === 0) {
    return sequenceGenerator;
  }
  const signatureCall = translateMultilineCallWithLocalSignature(
    pythonCallee,
    callPrefix,
    callParts,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (signatureCall !== null) {
    return signatureCall;
  }
  if (callParts.keywordParts.length === 0) {
    return translatePositionalCallExpression(pythonCallee, callParts.positionalParts, nameMap, arrayNames, validatedTypeAliases, mapNames, true);
  }
  if (callParts.positionalParts.length === 0) {
    return `${callPrefix}({ ${callParts.keywordParts.join(', ')} })`;
  }
  return `${callPrefix}(${[
    ...callParts.positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)),
    `{ ${callParts.keywordParts.join(', ')} }`,
  ].join(', ')})`;
}

function translateCollectedMultilineCallExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const call = parseFullCallExpression(pythonExpression);
  if (call === null) {
    return null;
  }
  const callParts = parseInlineCallParts(
    call.argsText,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (callParts === null) {
    return null;
  }
  return translateMultilineCallExpressionFromParts(
    call.pythonCallee,
    callParts,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
}

function parseInlineCallParts(
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): MultilineCallParts | null {
  const positionalParts: string[] = [];
  const keywordParts: string[] = [];
  const keywordArgParts: MultilineKeywordPart[] = [];
  let sawKeyword = false;
  for (const arg of splitTopLevelComma(argsText)) {
    const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg);
    if (keywordArg === null) {
      if (sawKeyword) {
        return null;
      }
      positionalParts.push(translateInlineCallArgumentIfNeeded(
        arg,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      ) ?? arg);
      continue;
    }

    sawKeyword = true;
    const expression = translateInlineCallArgumentIfNeeded(
      keywordArg[2],
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    ) ?? translateKeywordCallArgumentExpression(keywordArg[1], keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${expression}`);
    keywordArgParts.push({ pythonName: keywordArg[1], expression });
  }
  return { positionalParts, keywordParts, keywordArgParts, nextIndex: 0 };
}

function translateInlineCallArgumentIfNeeded(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const call = parseFullCallExpression(pythonExpression);
  if (call === null) {
    return null;
  }
  const callParts = parseInlineCallParts(
    call.argsText,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (callParts === null) {
    return null;
  }
  return translateMultilineCallExpressionFromParts(
    call.pythonCallee,
    callParts,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
}

function translateKeywordCallArgumentExpression(
  pythonKeywordName: string,
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const localReference = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonExpression.trim());
  if (localReference !== null && nameMap.has(localReference[1])) {
    return nameMap.get(localReference[1]) ?? tsExportNameForPythonName(localReference[1]);
  }
  if (localReference !== null && localReference[1].startsWith('_') && keywordNameLooksLikeLocalCallback(pythonKeywordName)) {
    return tsAttributeNameForPythonName(localReference[1]);
  }
  const callbackReference = keywordNameLooksLikeCallback(pythonKeywordName)
    ? translateDetachedMethodReference(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames)
    : null;
  return callbackReference ?? translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
}

function keywordNameLooksLikeCallback(pythonKeywordName: string): boolean {
  return /^(?:build|consume|create|draw|handle|measure|on|play|process|registry|reset|sync|ui|update)(?:_|$)/.test(pythonKeywordName);
}

function keywordNameLooksLikeLocalCallback(pythonKeywordName: string): boolean {
  return /^(?:apply|build|consume|create|draw|handle|measure|on|play|process|registry|reset|sync|ui|update)(?:_|$)/.test(pythonKeywordName);
}

function translateDetachedMethodReference(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const reference = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)$/.exec(pythonExpression.trim());
  if (reference === null) {
    return null;
  }
  const parts = reference[1].split('.');
  const receiver = translateExpression(parts.slice(0, -1).join('.'), nameMap, arrayNames, validatedTypeAliases, mapNames);
  return `${receiver}.${tsAttributeNameForPythonName(parts[parts.length - 1])}.bind(${receiver})`;
}

function parseFullCallExpression(pythonExpression: string): { pythonCallee: string; argsText: string } | null {
  const trimmed = pythonExpression.trim();
  const callStart = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(/.exec(trimmed);
  if (callStart === null) {
    return null;
  }
  const closeIndex = matchingCloseParen(trimmed, callStart[1].length);
  if (closeIndex !== trimmed.length - 1) {
    return null;
  }
  return {
    pythonCallee: callStart[1],
    argsText: trimmed.slice(callStart[1].length + 1, closeIndex),
  };
}

function translateMultilineMsgspecStructsReplace(
  pythonCallee: string,
  callParts: MultilineCallParts,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  if (
    pythonCallee !== 'msgspec.structs.replace'
    || callParts.positionalParts.length !== 1
    || callParts.keywordArgParts.length === 0
  ) {
    return null;
  }
  const value = translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const updates = callParts.keywordArgParts.map((part) => {
    const name = tsExportNameForPythonName(part.pythonName);
    return name === part.expression ? name : `${name}: ${part.expression}`;
  });
  return `(() => { const value = ${value}; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value, ${updates.join(', ')} }); })()`;
}

function translateMultilineCallWithLocalSignature(
  pythonCallee: string,
  callPrefix: string,
  callParts: MultilineCallParts,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  if (callParts.keywordArgParts.length === 0) {
    return null;
  }
  const signature = parseKnownFunctionCallSignature(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  if (signature === null) {
    return null;
  }

  const consumedKeywords = new Set<string>();
  const args = callParts.positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
  for (const pythonName of signature.positional.slice(args.length)) {
    const keywordPart = callParts.keywordArgParts.find((part) => (
      part.pythonName === pythonName
      || tsExportNameForPythonName(part.pythonName) === pythonName
      || `_${part.pythonName}` === pythonName
      || `_${tsExportNameForPythonName(part.pythonName)}` === pythonName
    ));
    if (keywordPart === undefined) {
      break;
    }
    args.push(keywordPart.expression);
    consumedKeywords.add(keywordPart.pythonName);
  }
  if (consumedKeywords.size === 0) {
    return null;
  }

  const keywordParts = callParts.keywordArgParts
    .filter((part) => !consumedKeywords.has(part.pythonName))
    .map((part) => `${tsExportNameForPythonName(part.pythonName)}: ${part.expression}`);
  if (keywordParts.length > 0) {
    args.push(`{ ${keywordParts.join(', ')} }`);
  }
  return `${callPrefix}(${args.join(', ')})`;
}

function parseKnownFunctionCallSignature(
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): FunctionCallSignature | null {
  const localSignature = parseLocalFunctionCallSignature(pythonCallee, nameMap);
  if (localSignature !== null) {
    return localSignature;
  }
  const dotted = /^(.+)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonCallee);
  if (dotted === null) {
    return null;
  }
  const receiver = translateExpression(dotted[1], nameMap, arrayNames, validatedTypeAliases);
  const receiverType = nameMap.get(receiverTypeNameMarker(dotted[1])) ?? nameMap.get(receiverTypeNameMarker(receiver));
  const methodName = tsAttributeNameForPythonName(dotted[2]);
  if (receiverType !== undefined) {
    const receiverSignature = parseFunctionCallSignatureText(
      inheritedInstanceMethodSignatureText(receiverType, methodName, nameMap),
    );
    if (receiverSignature !== null) {
      return receiverSignature;
    }
  }
  return knownMethodCallSignature(methodName);
}

function inheritedInstanceMethodSignatureText(
  receiverType: string,
  methodName: string,
  nameMap: ReadonlyMap<string, string>,
): string | undefined {
  let currentType: string | undefined = receiverType;
  const seen = new Set<string>();
  while (currentType !== undefined && !seen.has(currentType)) {
    seen.add(currentType);
    const signature = nameMap.get(instanceMethodSignatureMarker(currentType, methodName));
    if (signature !== undefined) {
      return signature;
    }
    currentType = nameMap.get(classBaseTypeMarker(currentType));
  }
  return undefined;
}

function knownMethodCallSignature(methodName: string): FunctionCallSignature | null {
  if (methodName === 'spawnAt') {
    return { positional: ['pos', 'bonusId', 'durationOverride'] };
  }
  if (methodName === 'normalizedWithLength') {
    return { positional: [], returnTupleMarkers: ['vector', null] };
  }
  return null;
}

function parseFunctionCallSignatureText(signatureText: string | undefined): FunctionCallSignature | null {
  if (signatureText === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(signatureText) as Partial<FunctionCallSignature>;
    if (!Array.isArray(parsed.positional) || !parsed.positional.every((name) => typeof name === 'string')) {
      return null;
    }
    return {
      positional: parsed.positional,
      returnTupleMarkers: parsed.returnTupleMarkers,
    };
  } catch {
    return null;
  }
}

function parseLocalFunctionCallSignature(
  pythonCallee: string,
  nameMap: Map<string, string>,
): FunctionCallSignature | null {
  const signatureText = nameMap.get(functionSignatureMarker(pythonCallee))
    ?? nameMap.get(functionSignatureMarker(tsExportNameForPythonName(pythonCallee)));
  if (signatureText === undefined) {
    return knownExternalFunctionCallSignature(pythonCallee);
  }
  try {
    const parsed = JSON.parse(signatureText) as Partial<FunctionCallSignature>;
    if (!Array.isArray(parsed.positional) || !parsed.positional.every((name) => typeof name === 'string')) {
      return null;
    }
    if (
      parsed.returnTupleMarkers !== undefined
      && (
        !Array.isArray(parsed.returnTupleMarkers)
        || !parsed.returnTupleMarkers.every((marker) => marker === null || marker === 'array' || marker === 'map' || marker === 'object' || marker === 'rectangle' || marker === 'set' || marker === 'string' || marker === 'vector')
      )
    ) {
      return null;
    }
    return {
      positional: parsed.positional,
      returnTupleMarkers: parsed.returnTupleMarkers,
    };
  } catch {
    return null;
  }
}

function knownExternalFunctionCallSignature(pythonCallee: string): FunctionCallSignature | null {
  const signatures: Record<string, FunctionCallSignature> = {
    tick_quest_completion_transition: {
      positional: ['completion_transition_ms', 'frame_dt_ms'],
    },
    tickQuestCompletionTransition: {
      positional: ['completion_transition_ms', 'frame_dt_ms'],
    },
    tick_quest_mode_spawns: {
      positional: ['entries', 'quest_spawn_timeline_ms', 'frame_dt_ms'],
    },
    tickQuestModeSpawns: {
      positional: ['entries', 'quest_spawn_timeline_ms', 'frame_dt_ms'],
    },
    create_console: {
      positional: ['base_dir', 'assets_dir'],
    },
    createConsole: {
      positional: ['base_dir', 'assets_dir'],
    },
  };
  return signatures[pythonCallee] ?? null;
}

function applyTupleAssignmentReturnMarkers(
  names: string[],
  assignedRight: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  mapNames: ReadonlySet<string>,
): void {
  const call = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\(/.exec(assignedRight.trim());
  if (call === null) {
    return;
  }
  const signature = parseLocalFunctionCallSignature(call[1], nameMap) ?? knownDottedMethodCallSignature(call[1]);
  if (signature?.returnTupleMarkers === undefined) {
    return;
  }
  for (let index = 0; index < names.length; index += 1) {
    const pythonName = names[index];
    if (pythonName === '_') {
      continue;
    }
    const marker = signature.returnTupleMarkers[index];
    if (marker === undefined || marker === null) {
      continue;
    }
    const tsName = tsExportNameForPythonName(pythonName);
    if (marker === 'array') {
      arrayNames.add(pythonName);
      arrayNames.add(tsName);
    } else if (marker === 'map') {
      addMutableName(mapNames, pythonName);
      addMutableName(mapNames, tsName);
    } else if (marker === 'object') {
      arrayNames.add(objectNameMarker(pythonName));
      arrayNames.add(objectNameMarker(tsName));
    } else if (marker === 'rectangle') {
      arrayNames.add(rectangleNameMarker(pythonName));
      arrayNames.add(rectangleNameMarker(tsName));
    } else if (marker === 'set') {
      arrayNames.add(setNameMarker(pythonName));
      arrayNames.add(setNameMarker(tsName));
    } else if (marker === 'string') {
      arrayNames.add(stringNameMarker(pythonName));
      arrayNames.add(stringNameMarker(tsName));
    } else if (marker === 'vector') {
      arrayNames.add(vectorNameMarker(pythonName));
      arrayNames.add(vectorNameMarker(tsName));
    }
  }
}

function knownDottedMethodCallSignature(callee: string): FunctionCallSignature | null {
  const dotted = /^.+\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(callee);
  return dotted === null ? null : knownMethodCallSignature(dotted[1]);
}

function parseMultilineConditionalArgument(
  lines: string[],
  startIndex: number,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { expression: string; nextIndex: number } | null {
  const trueExpression = (lines[startIndex] ?? '').trim();
  if (trueExpression === '' || trueExpression.endsWith(',')) {
    return null;
  }
  const condition = /^if (.+)$/.exec((lines[startIndex + 1] ?? '').trim());
  if (condition === null) {
    return null;
  }
  const elseLine = (lines[startIndex + 2] ?? '').trim();
  if (!elseLine.startsWith('else ')) {
    return null;
  }
  const falseExpression = elseLine.slice('else '.length).replace(/,$/, '');
  if (falseExpression === '') {
    return null;
  }
  return {
    expression: `${translateExpression(condition[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} ? ${translateExpression(trueExpression, nameMap, arrayNames, validatedTypeAliases, mapNames)} : ${translateExpression(falseExpression, nameMap, arrayNames, validatedTypeAliases, mapNames)}`,
    nextIndex: startIndex + 3,
  };
}

function parseMultilineCallExpressionWithOuterClose(
  lines: string[],
  startIndex: number,
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): { expression: string; nextIndex: number } | null {
  const closeIndex = findNestedCallOuterClose(lines, startIndex);
  if (closeIndex === null) {
    return null;
  }

  const patchedLines = [...lines];
  const line = patchedLines[closeIndex] ?? '';
  patchedLines[closeIndex] = `${line.slice(0, line.indexOf(')'))})`;
  const expression = parseMultilineCallExpression(
    patchedLines,
    startIndex,
    pythonCallee,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (expression === null || expression.nextIndex !== closeIndex + 1) {
    return null;
  }
  return expression;
}

function parseMultilineCallExpressionWithColonClose(
  lines: string[],
  startIndex: number,
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): { expression: string; nextIndex: number } | null {
  const closeIndex = findMultilineCallColonClose(lines, startIndex);
  if (closeIndex === null) {
    return null;
  }

  const patchedLines = [...lines];
  patchedLines[closeIndex] = (patchedLines[closeIndex] ?? '').replace(/\):\s*$/, ')');
  const expression = parseMultilineCallExpression(
    patchedLines,
    startIndex,
    pythonCallee,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (expression === null || expression.nextIndex !== closeIndex + 1) {
    return null;
  }
  return expression;
}

function parseMultilineCallExpressionWithAsClose(
  lines: string[],
  startIndex: number,
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): { expression: string; nextIndex: number; pythonName: string; name: string } | null {
  const close = findMultilineCallAsClose(lines, startIndex);
  if (close === null) {
    return null;
  }

  const patchedLines = [...lines];
  patchedLines[close.index] = (patchedLines[close.index] ?? '').replace(/\)\s+as\s+[A-Za-z_][A-Za-z0-9_]*:\s*$/, ')');
  const expression = parseMultilineCallExpression(
    patchedLines,
    startIndex,
    pythonCallee,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (expression === null || expression.nextIndex !== close.index + 1) {
    return null;
  }
  return {
    expression: expression.expression,
    nextIndex: expression.nextIndex,
    pythonName: close.pythonName,
    name: tsExportNameForPythonName(close.pythonName),
  };
}

function findNestedCallOuterClose(lines: string[], startIndex: number): number | null {
  let depth = 1;
  for (let nextIndex = startIndex; nextIndex < lines.length; nextIndex += 1) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '') {
      continue;
    }
    for (const char of trimmed) {
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth < 0) {
          return nextIndex;
        }
      }
    }
  }
  return null;
}

function findMultilineCallColonClose(lines: string[], startIndex: number): number | null {
  let depth = 1;
  for (let nextIndex = startIndex; nextIndex < lines.length; nextIndex += 1) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '') {
      continue;
    }
    let quote: string | null = null;
    for (let charIndex = 0; charIndex < trimmed.length; charIndex += 1) {
      const char = trimmed[charIndex];
      if (quote !== null) {
        if (char === quote && trimmed[charIndex - 1] !== '\\') {
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
          return trimmed.slice(charIndex + 1).trim() === ':' ? nextIndex : null;
        }
      }
    }
  }
  return null;
}

function findMultilineCallAsClose(lines: string[], startIndex: number): { index: number; pythonName: string } | null {
  let depth = 1;
  for (let nextIndex = startIndex; nextIndex < lines.length; nextIndex += 1) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '') {
      continue;
    }
    let quote: string | null = null;
    for (let charIndex = 0; charIndex < trimmed.length; charIndex += 1) {
      const char = trimmed[charIndex];
      if (quote !== null) {
        if (char === quote && trimmed[charIndex - 1] !== '\\') {
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
          const suffix = /^as ([A-Za-z_][A-Za-z0-9_]*):$/.exec(trimmed.slice(charIndex + 1).trim());
          return suffix === null ? null : { index: nextIndex, pythonName: suffix[1] };
        }
      }
    }
  }
  return null;
}

function translateMultilineSequenceGenerator(
  pythonCallee: string,
  positionalParts: string[],
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  if (pythonCallee !== 'list' && pythonCallee !== 'tuple') {
    return null;
  }
  if (positionalParts.length !== 2) {
    return null;
  }
  const generatorClause = /^for ([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec(positionalParts[1]);
  if (generatorClause === null) {
    return null;
  }
  const itemName = tsExportNameForPythonName(generatorClause[1]);
  const itemNameMap = new Map(nameMap);
  itemNameMap.set(generatorClause[1], itemName);
  const itemExpression = positionalParts[0].startsWith('new ')
    ? positionalParts[0]
    : translateExpression(positionalParts[0], itemNameMap, arrayNames, validatedTypeAliases, mapNames);
  const iterable = translateExpression(generatorClause[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
  return `${iterable}.map((${itemName}) => ${itemExpression})`;
}

function parseMultilineCallParts(
  lines: string[],
  startIndex: number,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): MultilineCallParts | null {
  const positionalParts: string[] = [];
  const keywordParts: string[] = [];
  const keywordArgParts: MultilineKeywordPart[] = [];
  let sawKeyword = false;
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const logicalArg = collectContinuedCallArgument(lines, nextIndex);
    const trimmed = logicalArg.text;
    if (trimmed === ')' || trimmed === '),') {
      return { positionalParts, keywordParts, keywordArgParts, nextIndex: logicalArg.nextIndex };
    }

    const arg = trimmed.replace(/,$/, '');
    const lambdaKeyword = /^([A-Za-z_][A-Za-z0-9_]*)=lambda (.+): \($/.exec(arg);
    if (lambdaKeyword !== null) {
      const lambdaExpression = parseMultilineLambdaTupleExpression(
        lines,
        nextIndex + 1,
        lambdaKeyword[2],
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (lambdaExpression === null) {
        return null;
      }
      keywordParts.push(`${tsExportNameForPythonName(lambdaKeyword[1])}: ${lambdaExpression.expression}`);
      keywordArgParts.push({ pythonName: lambdaKeyword[1], expression: lambdaExpression.expression });
      nextIndex = lambdaExpression.nextIndex;
      sawKeyword = true;
      continue;
    }
    const lambdaCallKeyword = /^([A-Za-z_][A-Za-z0-9_]*)=lambda (.+): ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(arg);
    if (lambdaCallKeyword !== null) {
      const lambdaExpression = parseMultilineLambdaCallExpression(
        lines,
        nextIndex + 1,
        lambdaCallKeyword[2],
        lambdaCallKeyword[3],
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (lambdaExpression === null) {
        return null;
      }
      keywordParts.push(`${tsExportNameForPythonName(lambdaCallKeyword[1])}: ${lambdaExpression.expression}`);
      keywordArgParts.push({ pythonName: lambdaCallKeyword[1], expression: lambdaExpression.expression });
      nextIndex = lambdaExpression.nextIndex;
      sawKeyword = true;
      continue;
    }
    if (arg === '{') {
      const dictLiteral = collectMultilineDictLiteral(
        lines,
        nextIndex + 1,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (dictLiteral === null) {
        return null;
      }
      positionalParts.push(dictLiteral.expression);
      nextIndex = dictLiteral.nextIndex;
      continue;
    }
    if (arg === '(' || arg === '[') {
      if (sawKeyword) {
        return null;
      }
      if (arg === '(') {
        const parenthesized = collectMultilineParenthesizedExpression(lines, nextIndex, arg);
        if (parenthesized !== null) {
          positionalParts.push(translateExpression(parenthesized.expression.replace(/,$/, ''), nameMap, arrayNames, validatedTypeAliases, mapNames));
          nextIndex = parenthesized.nextIndex;
          continue;
        }
      }
      const sequenceLiteral = collectMultilineSequenceLiteral(
        lines,
        nextIndex + 1,
        arg === '(' ? ')' : ']',
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
      if (sequenceLiteral === null) {
        return null;
      }
      positionalParts.push(`[${sequenceLiteral.items.join(', ')}]`);
      nextIndex = sequenceLiteral.nextIndex;
      continue;
    }
    const stringLiteral = parsePythonStringExpression(arg);
    if (stringLiteral !== null && !trimmed.endsWith(',')) {
      const adjacentStrings = [arg];
      nextIndex += 1;
      while (nextIndex < lines.length) {
        const adjacentTrimmed = lines[nextIndex].trim();
        const adjacentArg = adjacentTrimmed.replace(/,$/, '');
        if (parsePythonStringExpression(adjacentArg) === null) {
          break;
        }
        adjacentStrings.push(adjacentArg);
        nextIndex += 1;
        if (adjacentTrimmed.endsWith(',')) {
          break;
        }
      }
      positionalParts.push(combinePythonStringExpressions(adjacentStrings));
      continue;
    }
    const conditionalArg = parseMultilineConditionalArgument(
      lines,
      nextIndex,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (conditionalArg !== null) {
      if (sawKeyword) {
        return null;
      }
      positionalParts.push(conditionalArg.expression);
      nextIndex = conditionalArg.nextIndex;
      continue;
    }

    const inlineLambdaKeywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(lambda(?:\s+[^:]+)?:\s*.+)$/.exec(arg);
    if (inlineLambdaKeywordArg !== null) {
      const expression = translateCallArgumentExpression(inlineLambdaKeywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
      sawKeyword = true;
      keywordParts.push(`${tsExportNameForPythonName(inlineLambdaKeywordArg[1])}: ${expression}`);
      keywordArgParts.push({ pythonName: inlineLambdaKeywordArg[1], expression });
      nextIndex = logicalArg.nextIndex;
      continue;
    }
    if (!sawKeyword && /^lambda(?:\s+[^:]+)?:\s*.+$/.test(arg)) {
      positionalParts.push(translateCallArgumentExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames));
      nextIndex = logicalArg.nextIndex;
      continue;
    }

    const argParts = splitTopLevelComma(arg);
    let consumedNestedCall = false;
    for (const argPart of argParts) {
      const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(argPart);
      if (keywordArg === null) {
        if (sawKeyword) {
          return null;
        }
        const multilineSubscript = argParts.length === 1 ? /^(.+)\[$/.exec(argPart) : null;
        if (multilineSubscript !== null) {
          const subscriptExpression = collectMultilineSubscriptExpression(
            lines,
            nextIndex + 1,
            multilineSubscript[1],
            nameMap,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
          if (subscriptExpression === null) {
            return null;
          }
          positionalParts.push(subscriptExpression.expression);
          nextIndex = subscriptExpression.nextIndex;
          consumedNestedCall = true;
          break;
        }
        const nestedCall = argParts.length === 1
          ? /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(argPart)
          : null;
        if (nestedCall !== null) {
          const callExpression = parseMultilineCallExpression(
            lines,
            nextIndex + 1,
            nestedCall[1],
            nameMap,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
          if (callExpression === null) {
            return null;
          }
          positionalParts.push(callExpression.expression);
          nextIndex = callExpression.nextIndex;
          consumedNestedCall = true;
          break;
        }
        positionalParts.push(argPart);
      } else {
        sawKeyword = true;
        if (keywordArg[2] === '{') {
          const dictLiteral = collectMultilineDictLiteral(
            lines,
            nextIndex + 1,
            nameMap,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
          if (dictLiteral === null) {
            return null;
          }
          keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${dictLiteral.expression}`);
          keywordArgParts.push({ pythonName: keywordArg[1], expression: dictLiteral.expression });
          nextIndex = dictLiteral.nextIndex;
          consumedNestedCall = true;
          break;
        }
        if (keywordArg[2] === '(') {
          const parenthesized = collectMultilineParenthesizedExpression(lines, nextIndex, keywordArg[2]);
          if (parenthesized === null) {
            return null;
          }
          const expression = translateExpression(parenthesized.expression.replace(/,$/, ''), nameMap, arrayNames, validatedTypeAliases, mapNames);
          keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${expression}`);
          keywordArgParts.push({ pythonName: keywordArg[1], expression });
          nextIndex = parenthesized.nextIndex;
          consumedNestedCall = true;
          break;
        }
        if (keywordArg[2] === '[') {
          const sequenceLiteral = collectMultilineSequenceLiteral(
            lines,
            nextIndex + 1,
            ']',
            nameMap,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
          if (sequenceLiteral === null) {
            return null;
          }
          const expression = `[${sequenceLiteral.items.join(', ')}]`;
          keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${expression}`);
          keywordArgParts.push({ pythonName: keywordArg[1], expression });
          nextIndex = sequenceLiteral.nextIndex;
          consumedNestedCall = true;
          break;
        }
        const nestedCall = argParts.length === 1
          ? /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(keywordArg[2])
          : null;
        if (nestedCall !== null) {
          const callExpression = parseMultilineCallExpression(
            lines,
            nextIndex + 1,
            nestedCall[1],
            nameMap,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
          if (callExpression === null) {
            return null;
          }
          keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${callExpression.expression}`);
          keywordArgParts.push({ pythonName: keywordArg[1], expression: callExpression.expression });
          nextIndex = callExpression.nextIndex;
          consumedNestedCall = true;
          break;
        }
        const expression = translateKeywordCallArgumentExpression(keywordArg[1], keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
        keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${expression}`);
        keywordArgParts.push({ pythonName: keywordArg[1], expression });
      }
    }
    if (!consumedNestedCall) {
      nextIndex = logicalArg.nextIndex;
    }
  }
  return null;
}

function collectContinuedCallArgument(lines: string[], startIndex: number): { text: string; nextIndex: number } {
  const parts: string[] = [];
  let nextIndex = startIndex;
  let depth = 0;
  while (nextIndex < lines.length) {
    const trimmed = splitInlineComment(lines[nextIndex].trim()).code.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    parts.push(trimmed);
    nextIndex += 1;
    depth += parenthesisDelta(trimmed);
    if (
      parts.length === 1
      && /^[A-Za-z_][A-Za-z0-9_]*=lambda .+: (?:\(|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\()$/.test(trimmed)
    ) {
      break;
    }
    if (depth <= 0 && (trimmed === ')' || trimmed === '),' || trimmed.endsWith(','))) {
      break;
    }

    let lookaheadIndex = nextIndex;
    while (lookaheadIndex < lines.length && (lines[lookaheadIndex] ?? '').trim() === '') {
      lookaheadIndex += 1;
    }
    const nextTrimmed = (lines[lookaheadIndex] ?? '').trim();
    if (depth <= 0 && (nextTrimmed === '' || nextTrimmed === ')' || nextTrimmed === '),')) {
      break;
    }
    if (depth <= 0 && !callArgumentLineContinues(trimmed, nextTrimmed)) {
      break;
    }
    nextIndex = lookaheadIndex;
  }
  return { text: parts.join(' '), nextIndex };
}

function callArgumentLineContinues(currentLine: string, nextLine: string): boolean {
  return /^[*/%&|^]|^\+(?!\+)|^-(?!-)|^(?:and|or|if|else)\b/.test(nextLine)
    || /(?:[+\-*/%&|^]|\band|\bor)$/.test(currentLine);
}

function collectMultilineSubscriptExpression(
  lines: string[],
  startIndex: number,
  pythonReceiver: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { expression: string; nextIndex: number } | null {
  const indexLines: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === ']' || trimmed === '],') {
      if (indexLines.length === 0) {
        return null;
      }
      const indexText = indexLines.join(' ');
      const slice = /^(.*):(.*)$/.exec(indexText);
      if (slice !== null) {
        const receiver = translateExpression(pythonReceiver, nameMap, arrayNames, validatedTypeAliases, mapNames);
        const start = slice[1].trim() === ''
          ? '0'
          : translateExpression(slice[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
        const end = slice[2].trim() === ''
          ? null
          : translateExpression(slice[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
        return {
          expression: end === null ? `${receiver}.slice(${start})` : `${receiver}.slice(${start}, ${end})`,
          nextIndex: nextIndex + 1,
        };
      }
      return {
        expression: `${translateExpression(pythonReceiver, nameMap, arrayNames, validatedTypeAliases, mapNames)}[${translateExpression(indexText, nameMap, arrayNames, validatedTypeAliases, mapNames)}]`,
        nextIndex: nextIndex + 1,
      };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    indexLines.push(trimmed.replace(/,$/, ''));
    nextIndex += 1;
  }
  return null;
}

function parseMultilineTupleAssignmentStatement(
  lines: string[],
  index: number,
  indent: string,
  nameMap: Map<string, string>,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { statements: string[]; nextIndex: number } | null {
  const innerIndent = `${indent}    `;
  const targets: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    const close = /^\) (\/\/=|\+=|-=|\*=|\/=|\|=|&=|\^=|=) (.+)$/.exec(line.slice(indent.length));
    if (lineStartsAtIndent(line, indent) && close !== null) {
      if (targets.length === 0) {
        return null;
      }
      const right = translateExpression(close[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (close[1] === '=' && targets.every((target) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target))) {
        return {
          statements: [`[${targets.map((target) => translateExpression(target, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')}] = ${right};`],
          nextIndex: nextIndex + 1,
        };
      }
      return translateStraightLineAssignment(
        targets.join(', '),
        close[1],
        right,
        nextIndex + 1,
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        mapNames,
        close[2],
      );
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith(innerIndent) || !trimmed.endsWith(',')) {
      return null;
    }
    targets.push(trimmed.slice(0, -1));
    nextIndex += 1;
  }
  return null;
}

function translateStraightLineAssignment(
  pythonLeft: string,
  operator: string,
  tsRight: string,
  nextIndex: number,
  nameMap: Map<string, string>,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
  pythonRight: string | null = null,
): { statements: string[]; nextIndex: number } {
  const fullSliceAssignment = /^(.+)\[:\]$/.exec(pythonLeft);
  if (operator === '=' && fullSliceAssignment !== null) {
    const tsLeft = translateExpression(fullSliceAssignment[1], nameMap, arrayNames, validatedTypeAliases);
    return {
      statements: [`${tsLeft}.splice(0, ${tsLeft}.length, ...${tsRight});`],
      nextIndex,
    };
  }

  const assignedRight = operator === '=' ? maybeAwaitAsyncCall(tsRight, nameMap) : tsRight;
  const topLevelMapItemAssignment = parseTopLevelSubscriptAssignmentTarget(pythonLeft);
  if (topLevelMapItemAssignment !== null) {
    const mapName = translateExpression(topLevelMapItemAssignment.receiver, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
      const key = translateMapKeyExpression(mapName, translateExpression(topLevelMapItemAssignment.key, nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
      if (operator === '=') {
        const mapAssignedRight = pythonRight === null
          ? assignedRight
          : translateMapDefaultExpression(pythonRight, topLevelMapItemAssignment.receiver, mapName, nameMap, arrayNames, validatedTypeAliases, mapNames);
        return {
          statements: [`${mapName}.set(${key}, ${mapAssignedRight});`],
          nextIndex,
        };
      }
      const binaryOperator = operator.slice(0, -1);
      return {
        statements: [`${mapName}.set(${key}, (${mapName}.get(${key}) ?? 0) ${binaryOperator} ${assignedRight});`],
        nextIndex,
      };
    }
  }
  const mapItemAssignment = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(pythonLeft);
  if (operator === '=' && mapItemAssignment !== null) {
    const mapName = translateExpression(mapItemAssignment[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
      const key = translateMapKeyExpression(mapName, translateExpression(mapItemAssignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
      return {
        statements: [`${mapName}.set(${key}, ${assignedRight});`],
        nextIndex,
      };
    }
  }
  if (operator !== '=' && mapItemAssignment !== null) {
    const mapName = translateExpression(mapItemAssignment[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
      const key = translateMapKeyExpression(mapName, translateExpression(mapItemAssignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
      const binaryOperator = operator.slice(0, -1);
      return {
        statements: [`${mapName}.set(${key}, (${mapName}.get(${key}) ?? 0) ${binaryOperator} ${assignedRight});`],
        nextIndex,
      };
    }
  }
  const localAssignment = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonLeft);
  if (operator === '=' && localAssignment !== null) {
    if (localAssignment[1] === '_' && reassignedNames.has(localAssignment[1])) {
      return {
        statements: [`void ${assignedRight};`],
        nextIndex,
      };
    }
    const globalName = nameMap.get(localAssignment[1]);
    if (globalName !== undefined) {
      return {
        statements: [`${globalName} = ${assignedRight};`],
        nextIndex,
      };
    }
    const tsName = tsExportNameForPythonName(localAssignment[1]);
    if (assignedRight === tsName) {
      return { statements: [], nextIndex };
    }
    if (declaredNames.has(localAssignment[1])) {
      const localAssignedRight = assignedRightAsKnownVector(localAssignment[1], tsName, assignedRight, arrayNames);
      recordLocalAssignmentMarkers(localAssignment[1], tsName, localAssignedRight, nameMap, arrayNames, mapNames);
      return {
        statements: [`${tsName} = ${localAssignedRight};`],
        nextIndex,
      };
    }
    declaredNames.add(localAssignment[1]);
    const localTsName = tsLocalDeclarationNameForAssignment(tsName, assignedRight);
    if (localTsName !== tsName) {
      nameMap.set(localAssignment[1], localTsName);
    }
    const localAssignedRight = assignedRightAsKnownVector(localAssignment[1], localTsName, assignedRight, arrayNames);
    recordLocalAssignmentMarkers(localAssignment[1], localTsName, localAssignedRight, nameMap, arrayNames, mapNames);
    const nullableType = nullableLocalDeclarationType(localAssignment[1], localTsName, localAssignedRight, arrayNames);
    const tupleType = localTupleDeclarationType(localAssignedRight, pythonRight, nameMap, arrayNames);
    recordLocalTupleDeclarationMarkers(localAssignment[1], localTsName, tupleType, nameMap, arrayNames);
    const objectRecordType = objectRecordDeclarationType(localAssignedRight, nameMap, arrayNames);
    const widenedRuntimeType = reassignedNames.has(localAssignment[1]) && /^new Crand\(/.test(localAssignedRight)
      ? 'CrandLike'
      : null;
    const reassignedType = reassignedLocalTypeAnnotation(reassignedNames, localAssignment[1]);
    const declarationType = nullableType ?? tupleType ?? objectRecordType ?? widenedRuntimeType ?? reassignedType;
    const initializer = tupleType !== null && localAssignedRight.startsWith('Array.from(')
      ? `${localAssignedRight} as ${tupleType}`
      : localAssignedRight;
    return {
      statements: [
        `${reassignedNames.has(localAssignment[1]) ? 'let' : 'const'} ${localTsName}${declarationType === null ? '' : `: ${declarationType}`} = ${initializer};`,
      ],
      nextIndex,
    };
  }
  const singletonTupleAssignment = /^\(([A-Za-z_][A-Za-z0-9_]*),\)$/.exec(pythonLeft);
  if (operator === '=' && singletonTupleAssignment !== null) {
    const name = singletonTupleAssignment[1];
    const tsName = tsExportNameForPythonName(name);
    const declaration = declaredNames.has(name)
      ? ''
      : `${reassignedNames.has(name) ? 'let' : 'const'} `;
    declaredNames.add(name);
    return {
      statements: [`${declaration}[${tsName}] = ${assignedRight};`],
      nextIndex,
    };
  }

  const tupleTargets = operator === '=' ? splitTopLevelComma(pythonLeft) : [];
  const hasLocalTupleTarget = tupleTargets.some((target) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(target.trim()) && target.trim() !== '_');
  const hasNonLocalTupleTarget = tupleTargets.some((target) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target.trim()));
  if (tupleTargets.length > 1 && hasLocalTupleTarget && hasNonLocalTupleTarget) {
    const markerNames = tupleTargets.map((target) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(target.trim()) ? target.trim() : '_'));
    const hasExistingLocalTarget = tupleTargets.some((target) => {
      const localTarget = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(target.trim());
      return localTarget !== null && declaredNames.has(localTarget[1]);
    });
    const bindings: string[] = [];
    const preDeclarations: string[] = [];
    const postAssignments: string[] = [];
    for (const [targetIndex, rawTarget] of tupleTargets.entries()) {
      const target = rawTarget.trim();
      if (target === '_') {
        bindings.push('');
        continue;
      }
      const localTarget = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
      if (localTarget !== null) {
        const tsName = tsExportNameForPythonName(localTarget[1]);
        bindings.push(tsName);
        if (!declaredNames.has(localTarget[1])) {
          if (hasExistingLocalTarget) {
            preDeclarations.push(`let ${tsName}: any;`);
          }
          declaredNames.add(localTarget[1]);
        }
        continue;
      }
      const binding = tupleAssignmentBindingName(target, targetIndex);
      bindings.push(binding);
      if (hasExistingLocalTarget) {
        preDeclarations.push(`let ${binding}: any;`);
      }
      postAssignments.push(`${translateExpression(target, nameMap, arrayNames, validatedTypeAliases, mapNames)} = ${binding};`);
    }
    applyTupleAssignmentReturnMarkers(markerNames, assignedRight, nameMap, arrayNames, mapNames);
    const declaration = hasExistingLocalTarget
      ? ''
      : markerNames.some((name) => name !== '_' && reassignedNames.has(name)) ? 'let ' : 'const ';
    return {
      statements: [
        ...preDeclarations,
        `${declaration}[${bindings.join(', ')}] = ${assignedRight};`,
        ...postAssignments,
      ],
      nextIndex,
    };
  }
  if (operator === '=' && tupleTargets.length > 1 && hasNonLocalTupleTarget && !hasLocalTupleTarget) {
    return {
      statements: [
        `[${tupleTargets.map((target) => {
          const trimmed = target.trim();
          return trimmed === '_' ? '' : translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
        }).join(', ')}] = ${assignedRight};`,
      ],
      nextIndex,
    };
  }

  const tupleAssignment = /^([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+)$/.exec(pythonLeft);
  if (operator === '=' && tupleAssignment !== null) {
    const names = tupleAssignment[1].split(', ');
    const tsNames = names.map((name) => name === '_' ? '' : tsExportNameForPythonName(name));
    const alreadyDeclared = names.filter((name) => name !== '_').every((name) => declaredNames.has(name));
    const someAlreadyDeclared = names.some((name) => name !== '_' && declaredNames.has(name));
    const declaration = alreadyDeclared
      ? ''
      : someAlreadyDeclared ? ''
      : names.some((name) => reassignedNames.has(name)) ? 'let ' : 'const ';
    const preDeclarations = alreadyDeclared || !someAlreadyDeclared
      ? []
      : names
        .filter((name) => name !== '_' && !declaredNames.has(name))
        .map((name) => `let ${tsExportNameForPythonName(name)}: any;`);
    for (const name of names) {
      if (name !== '_') {
        declaredNames.add(name);
      }
    }
    applyTupleAssignmentReturnMarkers(names, assignedRight, nameMap, arrayNames, mapNames);
    return {
      statements: [
        ...preDeclarations,
        `${declaration}[${tsNames.join(', ')}] = ${assignedRight};`,
      ],
      nextIndex,
    };
  }
  if (operator === '=') {
    const tsLeft = translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (assignedRight === tsLeft) {
      return { statements: [], nextIndex };
    }
    if (expressionIsKnownMap(tsLeft, nameMap, mapNames)) {
      return {
        statements: [`${tsLeft} = ${mapAssignmentValueExpression(assignedRight)};`],
        nextIndex,
      };
    }
  }
  if (operator === '//=') {
    const tsLeft = translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return {
      statements: [`${tsLeft} = Math.floor(${tsLeft} / ${assignedRight});`],
      nextIndex,
    };
  }
  if (operator === '&=' && /^0xFFFFFFFF$/i.test(assignedRight.trim())) {
    const tsLeft = translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return {
      statements: [`${tsLeft} = ${tsLeft} >>> 0;`],
      nextIndex,
    };
  }
  return {
    statements: [`${translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames)} ${operator} ${assignedRight};`],
    nextIndex,
  };
}

function tupleAssignmentBindingName(target: string, targetIndex: number): string {
  const words = target
    .split(/[^A-Za-z0-9_]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (words.length === 0) {
    return `_tupleItem${targetIndex}`;
  }
  return `_${words
    .map((word) => tsExportNameForPythonName(word))
    .map((word, wordIndex) => (wordIndex === 0 ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`))
    .join('')}`;
}

function mapAssignmentValueExpression(assignedRight: string): string {
  const fromEntries = /^Object\.fromEntries\(([\s\S]+)\)$/.exec(assignedRight.trim());
  if (fromEntries !== null) {
    return `new Map(${fromEntries[1]})`;
  }
  if (assignedRight.trim() === '{}') {
    return 'new Map()';
  }
  return assignedRight.trim().startsWith('{') && assignedRight.trim().endsWith('}')
    ? `new Map(Object.entries(${assignedRight}))`
    : assignedRight;
}

function translateMapPopAssignment(
  pythonLeft: string,
  pythonMapExpression: string,
  pythonKeyExpression: string,
  nextIndex: number,
  nameMap: Map<string, string>,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { statements: string[]; nextIndex: number } | null {
  const localAssignment = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonLeft);
  if (localAssignment === null) {
    return null;
  }

  const mapName = translateExpression(pythonMapExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const args = splitTopLevelComma(pythonKeyExpression);
  if (args.length < 1 || args.length > 2) {
    return null;
  }
  const key = translateMapKeyExpression(mapName, translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
  const defaultExpression = args[1] === undefined
    ? null
    : translateMapDefaultExpression(args[1], pythonMapExpression, mapName, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (/^new Map(?:<[^)]*>)?\(\)$/.test(defaultExpression ?? '')) {
    addMutableName(mapNames, localAssignment[1]);
    addMutableName(mapNames, tsExportNameForPythonName(localAssignment[1]));
  }
  const valueExpression = expressionIsKnownMap(mapName, nameMap, mapNames)
    ? defaultExpression === null ? `mapGetOrThrow(${mapName}, ${key})` : `${mapName}.get(${key}) ?? ${defaultExpression}`
    : defaultExpression === null ? `${mapName}[${key}]` : `${mapName}[${key}] ?? ${defaultExpression}`;
  const deleteStatement = expressionIsKnownMap(mapName, nameMap, mapNames) ? `${mapName}.delete(${key});` : `delete ${mapName}[${key}];`;
  const globalName = nameMap.get(localAssignment[1]);
  if (globalName !== undefined) {
    return {
      statements: [
        `${globalName} = ${valueExpression};`,
        deleteStatement,
      ],
      nextIndex,
    };
  }

  const tsName = tsExportNameForPythonName(localAssignment[1]);
  if (declaredNames.has(localAssignment[1])) {
    return {
      statements: [
        `${tsName} = ${valueExpression};`,
        deleteStatement,
      ],
      nextIndex,
    };
  }

  declaredNames.add(localAssignment[1]);
  return {
    statements: [
      `${reassignedNames.has(localAssignment[1]) ? 'let' : 'const'} ${tsName} = ${valueExpression};`,
      deleteStatement,
    ],
    nextIndex,
  };
}

function translateMapDefaultExpression(
  pythonExpression: string,
  pythonMapExpression: string,
  tsMapExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  if (
    pythonExpression.trim() === '{}'
    && (
      mapNames.has(mapValueMapNameMarker(pythonMapExpression))
      || mapNames.has(mapValueMapNameMarker(tsMapExpression))
    )
  ) {
    const valueType = nameMap.get(mapValueTypeMarker(pythonMapExpression)) ?? nameMap.get(mapValueTypeMarker(tsMapExpression));
    return valueType?.startsWith('Map<') === true ? `new ${valueType}()` : 'new Map()';
  }
  return translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
}

function iterableIsPathArray(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): boolean {
  const prefixSlice = /^(.+)\[:.+\]$/.exec(pythonExpression.trim());
  const baseExpression = prefixSlice?.[1] ?? pythonExpression.trim();
  const translated = translateExpression(baseExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  return arrayNames.has(pathArrayNameMarker(baseExpression)) || arrayNames.has(pathArrayNameMarker(translated));
}

function maybeAwaitAsyncCall(tsExpression: string, nameMap: ReadonlyMap<string, string> = new Map()): string {
  const call = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\(/.exec(tsExpression);
  if (call !== null) {
    const declaredReturnType = nameMap.get(functionDeclaredReturnTypeMarker(call[1]));
    if (declaredReturnType !== undefined) {
      return declaredReturnType.startsWith('Promise<') ? `await ${tsExpression}` : tsExpression;
    }
    const returnType = nameMap.get(functionReturnTypeMarker(call[1]));
    if (returnType !== undefined) {
      if (returnType.startsWith('Promise<')) {
        return `await ${tsExpression}`;
      }
      if (!returnType.startsWith('ReturnType<typeof ')) {
        return tsExpression;
      }
    }
  }
  return /^(?:load[A-Z][A-Za-z0-9_]*|initAudioState|initViewAudio)\(.*\)$/.test(tsExpression) ? `await ${tsExpression}` : tsExpression;
}

function parseMultilineDictComprehensionExpression(
  lines: string[],
  startIndex: number,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { expression: string; nextIndex: number } | null {
  const keyValue = /^(.+): (.+)$/.exec((lines[startIndex] ?? '').trim());
  const forClause = /^for ([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec((lines[startIndex + 1] ?? '').trim());
  if (keyValue === null || forClause === null) {
    return null;
  }
  let closeIndex = startIndex + 2;
  let filterExpression: string | null = null;
  const ifClause = /^if (.+)$/.exec((lines[closeIndex] ?? '').trim());
  if (ifClause !== null) {
    filterExpression = ifClause[1];
    closeIndex += 1;
  }
  if ((lines[closeIndex] ?? '').trim() !== '}') {
    return null;
  }

  const itemName = tsExportNameForPythonName(forClause[1]);
  const itemNameMap = new Map(nameMap);
  itemNameMap.set(forClause[1], itemName);
  const iterable = translateExpression(forClause[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const key = translateExpression(keyValue[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames);
  const value = translateExpression(keyValue[2], itemNameMap, arrayNames, validatedTypeAliases, mapNames);
  const itemParameter = methodCallIterableCallbackParameter(itemName, iterable);
  const source = filterExpression === null
    ? iterable
    : `${iterable}.filter((${itemParameter}) => ${translateExpression(filterExpression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  return {
    expression: `new Map(Array.from(${source}, (${itemParameter}) => [${key}, ${value}] as const))`,
    nextIndex: closeIndex + 1,
  };
}

function parseMultilineSetComprehensionExpression(
  lines: string[],
  startIndex: number,
  indent: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): { expression: string; nextIndex: number } | null {
  const innerIndent = `${indent}    `;
  const bodyLines: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (lineStartsAtIndent(line, indent) && trimmed === '}') {
      break;
    }
    if (trimmed !== '') {
      if (!line.startsWith(innerIndent)) {
        return null;
      }
      bodyLines.push(trimmed.replace(/,$/, ''));
    }
    nextIndex += 1;
  }
  if ((lines[nextIndex] ?? '').trim() !== '}' || bodyLines.length < 2) {
    return null;
  }

  const forIndex = bodyLines.findIndex((line) => line.startsWith('for '));
  if (forIndex <= 0) {
    return null;
  }
  const itemExpression = bodyLines.slice(0, forIndex).join(' ');
  if (topLevelColonIndex(itemExpression) !== null) {
    return null;
  }

  const forClause = /^for (.+) in (.+)$/.exec(bodyLines[forIndex]);
  if (forClause === null) {
    return null;
  }
  const targetNames = splitTopLevelComma(forClause[1])
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (targetNames.length === 0 || targetNames.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))) {
    return null;
  }
  const conditions: string[] = [];
  for (const conditionLine of bodyLines.slice(forIndex + 1)) {
    const ifClause = /^if (.+)$/.exec(conditionLine);
    if (ifClause === null) {
      return null;
    }
    conditions.push(ifClause[1]);
  }

  const itemNameMap = new Map(nameMap);
  for (const targetName of targetNames) {
    itemNameMap.set(targetName, tsExportNameForPythonName(targetName));
  }
  const tsTargetNames = targetNames.map(tsExportNameForPythonName);
  const enumerateIterable = parseEnumerateIterableExpression(forClause[2]);
  const iterable = targetNames.length === 2 && enumerateIterable !== null
    ? enumerateArrayExpression(enumerateIterable, nameMap, arrayNames, validatedTypeAliases, mapNames)
    : iterableExpressionForIteration(forClause[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const itemParameter = targetNames.length === 1
    ? methodCallIterableCallbackParameter(tsTargetNames[0], iterable)
    : `[${tsTargetNames.join(', ')}]`;
  const translatedConditions = conditions.map((condition) => translateConditionExpression(condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames));
  const source = translatedConditions.length === 0
    ? iterable
    : `${iterable}.filter((${itemParameter}) => ${translatedConditions.join(' && ')})`;
  return {
    expression: `new Set(${source}.map((${itemParameter}) => ${translateExpression(itemExpression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)}))`,
    nextIndex: nextIndex + 1,
  };
}

function topLevelColonIndex(value: string): number | null {
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
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ':' && depth === 0) {
      return index;
    }
  }
  return null;
}

function methodCallIterableCallbackParameter(itemName: string, iterableExpression: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\(/.test(iterableExpression) ? `${itemName}: any` : itemName;
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
