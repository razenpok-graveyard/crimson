import type {
  FunctionParameter,
  ImportDefinition,
  SimpleModuleAssignment,
} from '../model.js';
import {
  tsExportNameForPythonName,
  tsMutableNameForPythonName,
  tsPublicNameForPythonName,
  tsTypeExpression,
} from '../naming.js';
import { tsImportPathForPythonImport } from '../paths.js';
import {
  combinePythonStringExpressions,
  indentStatementLine,
  inferPythonExpressionType,
  isIndentedBlockLine,
  matchingCloseParen,
  parseIndentedFunctionHeader,
  parsePythonStringExpression,
  splitTopLevelComma,
} from './common.js';
import {
  translateCallArgumentExpression,
  translateExpression,
  translateMapKeyExpression,
  translatePositionalCallExpression,
  dateNameMarker,
  nullableNameMarker,
  objectNameMarker,
  pathArrayNameMarker,
  pathNameMarker,
  rectangleNameMarker,
  setNameMarker,
  splitTopLevelLogicalOperator,
  stringNameMarker,
  translatedExpressionLooksVectorArray,
  translatedExpressionLooksVector,
  vectorArrayNameMarker,
  vectorNameMarker,
} from './expression.js';
import {
  functionSignatureMarker,
  parseStraightLineFunctionHeader,
  tsFunctionReturnTypeExpression,
} from './function-headers.js';
import {
  parseFunctionParameterText,
  parseFunctionParametersText,
  pythonParameterNames,
} from './parameters.js';

export {
  functionSignatureMarker,
  parseStraightLineFunctionHeader,
} from './function-headers.js';

type WithItem = {
  pythonName: string;
  name: string;
  expression: string;
  close: true;
} | {
  expression: string;
  close: false;
};

type FunctionReturnMarker = 'array' | 'object' | 'rectangle' | 'set' | 'string';

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

function pushImportDefinition(imports: ImportDefinition[], importDefinition: ImportDefinition): void {
  const existing = imports.find((candidate) => (
    candidate.modulePath === importDefinition.modulePath
    && candidate.typeOnly === importDefinition.typeOnly
  ));
  if (existing === undefined) {
    imports.push(importDefinition);
    return;
  }
  for (const name of importDefinition.names) {
    if (!existing.names.includes(name)) {
      existing.names.push(name);
    }
  }
}
function operatorIsAssignment(operator: string): boolean {
  return operator === '=';
}

function tsLocalFunctionNameForPythonName(pythonName: string): string {
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
}

function isSimpleReferenceExpression(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value);
}

function translateConditionExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const trimmed = pythonExpression.trim();
  const topLevelOrParts = splitTopLevelLogicalOperator(trimmed, 'or');
  if (topLevelOrParts !== null) {
    return topLevelOrParts
      .map((part) => translateConditionExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames))
      .join(' || ');
  }
  const topLevelAndParts = splitTopLevelLogicalOperator(trimmed, 'and');
  if (topLevelAndParts !== null) {
    return topLevelAndParts
      .map((part) => parenthesizeAndConditionOperand(translateConditionExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)))
      .join(' && ');
  }
  if (isSimpleReferenceExpression(trimmed)) {
    const translated = translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(translated)) {
      return `${translated}.size > 0`;
    }
    if (arrayNames.has(setNameMarker(trimmed)) || arrayNames.has(setNameMarker(translated))) {
      return arrayNames.has(nullableNameMarker(trimmed)) || arrayNames.has(nullableNameMarker(translated))
        ? `${translated} !== null && ${translated}.size > 0`
        : `${translated}.size > 0`;
    }
    if (arrayNames.has(trimmed) || arrayNames.has(translated)) {
      return arrayNames.has(nullableNameMarker(trimmed)) || arrayNames.has(nullableNameMarker(translated))
        ? `${translated} !== null && ${translated}.length > 0`
        : `${translated}.length > 0`;
    }
  }
  return translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
}

function parenthesizeAndConditionOperand(value: string): string {
  return value.includes(' || ') && matchingCloseParen(value, 0) !== value.length - 1 ? `(${value})` : value;
}
function caseBodyStops(statements: string[]): boolean {
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const trimmed = statements[index].trim();
    if (trimmed === '') {
      continue;
    }
    return /^(?:return|throw|break|continue)\b/.test(trimmed);
  }
  return false;
}
function predeclareIfBranchAssignments(
  lines: string[],
  index: number,
  indent: string,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
): string[] {
  const innerIndent = `${indent}    `;
  const assignedTypes = new Map<string, Set<string>>();
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(innerIndent)) {
      const rest = line.slice(innerIndent.length);
      const assignment = rest.startsWith(' ') ? null : /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(rest);
      if (assignment !== null && reassignedNames.has(assignment[1]) && !declaredNames.has(assignment[1])) {
        const types = assignedTypes.get(assignment[1]) ?? new Set<string>();
        types.add(inferPredeclaredAssignmentType(lines, nextIndex, innerIndent, assignment[2]));
        assignedTypes.set(assignment[1], types);
      }
      const tupleAssignment = rest.startsWith(' ') ? null : /^([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) = (.+)$/.exec(rest);
      if (tupleAssignment !== null) {
        for (const name of tupleAssignment[1].split(', ')) {
          if (name === '_' || !reassignedNames.has(name) || declaredNames.has(name)) {
            continue;
          }
          const types = assignedTypes.get(name) ?? new Set<string>();
          types.add(inferPythonExpressionType(tupleAssignment[2]));
          assignedTypes.set(name, types);
        }
      }
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(indent) && (/^elif .+:$/.test(trimmed) || trimmed === 'else:')) {
      nextIndex += 1;
      continue;
    }
    break;
  }

  const declarations: string[] = [];
  for (const [name, types] of assignedTypes) {
    const concreteTypes = [...types].filter((type) => type !== 'any');
    const candidateTypes = concreteTypes.length > 0 ? concreteTypes : [...types];
    const uniqueTypes = [...new Set(candidateTypes)];
    const type = uniqueTypes.length === 1 ? uniqueTypes[0] : uniqueTypes.join(' | ');
    declarations.push(`let ${tsExportNameForPythonName(name)}: ${type};`);
    declaredNames.add(name);
  }
  return declarations;
}

function inferPredeclaredAssignmentType(
  lines: string[],
  index: number,
  indent: string,
  assignedExpression: string,
): string {
  if (assignedExpression !== '(') {
    return inferPythonExpressionType(assignedExpression);
  }
  const expressionLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (lineStartsAtIndent(line, indent) && trimmed === ')') {
      return expressionLines.length === 0
        ? 'any'
        : inferPythonExpressionType(expressionLines.join(' '));
    }
    if (trimmed !== '') {
      expressionLines.push(trimmed);
    }
    nextIndex += 1;
  }
  return 'any';
}

function parseNestedFunctionStatement(
  lines: string[],
  index: number,
  indent: string,
  outerNameMap: Map<string, string>,
  outerArrayNames: ReadonlySet<string>,
  validatedTypeAliases: ReadonlySet<string>,
  relativePath: string | null,
  mapNames: ReadonlySet<string>,
): { statements: string[]; nextIndex: number } | null {
  const header = parseIndentedFunctionHeader(lines, index, indent);
  if (header === null) {
    return null;
  }

  const arrayNames = new Set<string>(outerArrayNames);
  const parsedParams = parseFunctionParametersText(header.parametersText, arrayNames);
  if (parsedParams === null) {
    return null;
  }

  const functionName = tsLocalFunctionNameForPythonName(header.name);
  outerNameMap.set(header.name, functionName);

  const prologue: string[] = [];
  const params = parsedParams.parameters.map(renderInlineParameter);
  if (parsedParams.optsParams.length > 0) {
    const optsType = parsedParams.optsParams
      .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
      .join('; ');
    const allOptsHaveDefaults = parsedParams.optsParams.every((param) => param.defaultValue !== null);
    params.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
    for (const param of parsedParams.optsParams) {
      prologue.push(param.defaultValue === null
        ? `const ${param.name} = opts.${param.name};`
        : `const ${param.name} = opts.${param.name} ?? ${param.defaultValue};`);
    }
  }

  const nestedNameMap = new Map(outerNameMap);
  nestedNameMap.set(header.name, functionName);
  const statements: string[] = [];
  const declaredNames = new Set<string>(pythonParameterNames(header.parametersText));
  const reassignedNames = reassignedLocalNames(lines, header.nextIndex);
  const innerIndent = `${indent}    `;
  let nextIndex = header.nextIndex;
  while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
    if (lines[nextIndex].trim() === '') {
      statements.push('');
      nextIndex += 1;
      continue;
    }
    const statement = translateStraightLineStatement(
      lines,
      nextIndex,
      innerIndent,
      nestedNameMap,
      declaredNames,
      reassignedNames,
      arrayNames,
      validatedTypeAliases,
      relativePath,
      mapNames,
    );
    if (statement === null) {
      return null;
    }
    statements.push(...statement.statements);
    nextIndex = statement.nextIndex;
  }

  const async = statements.some((statement) => statement.includes('await '));
  const returnType = tsFunctionReturnTypeExpression(header.returnType);
  return {
    statements: [
      `${async ? 'async ' : ''}function ${functionName}(${params.join(', ')}): ${async ? `Promise<${returnType}>` : returnType} {`,
      ...[...prologue, ...statements].map(indentStatementLine),
      '}',
    ],
    nextIndex,
  };
}

function renderInlineParameter(param: FunctionParameter): string {
  const defaultValue = param.defaultValue === undefined || param.defaultValue === null ? '' : ` = ${param.defaultValue}`;
  return `${param.name}: ${param.typeExpression}${defaultValue}`;
}

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
  const statement = line.slice(indent.length);
  if (statement.trim() === '' || statement.startsWith(' ')) {
    return null;
  }

  if (statement.startsWith('#')) {
    const comment = statement.replace(/^# ?/, '');
    return { statements: [comment === '' ? '//' : `// ${comment}`], nextIndex: index + 1 };
  }

  const globalStatement = /^global ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(statement);
  if (globalStatement !== null) {
    for (const name of globalStatement[1].split(', ')) {
      nameMap.set(name, tsMutableNameForPythonName(name));
    }
    return { statements: [], nextIndex: index + 1 };
  }

  const sideEffectImport = /^from (\.+) import ([A-Za-z_][A-Za-z0-9_]*) as (_[A-Za-z_][A-Za-z0-9_]*)(?:\s+#.*)?$/.exec(statement);
  if (sideEffectImport !== null && relativePath !== null) {
    return {
      statements: [`void import('${tsImportPathForPythonImport(`${sideEffectImport[1]}${sideEffectImport[2]}`, relativePath)}');`],
      nextIndex: index + 1,
    };
  }

  const localFromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)(?:\s+#.*)?$/.exec(statement);
  if (localFromImport !== null && relativePath !== null && imports !== null) {
    const names = localFromImport[2].split(', ');
    pushImportDefinition(imports, {
      modulePath: tsImportPathForPythonImport(localFromImport[1], relativePath),
      names: names.map(tsExportNameForPythonName),
    });
    for (const name of names) {
      nameMap.set(name, tsExportNameForPythonName(name));
    }
    return { statements: [], nextIndex: index + 1 };
  }

  const nestedFunction = parseNestedFunctionStatement(
    lines,
    index,
    indent,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    relativePath,
    mapNames,
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
        branchStatements.push(...innerStatement.statements.map(indentStatementLine));
        nextIndex = innerStatement.nextIndex;
      }
      return branchStatements.length === 0 ? null : { statements: branchStatements, nextIndex };
    };

    const branchDeclarations = predeclareIfBranchAssignments(lines, index, indent, declaredNames, reassignedNames);
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

    const innerIndent = `${indent}    `;
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
      return {
        statements: [
          'try {',
          ...tryBlock.statements,
          '} finally {',
          ...finallyBlock.statements,
          '}',
        ],
        nextIndex: finallyBlock.nextIndex,
      };
    }
    const exceptClause = parseExceptClause(afterTry);
    if (exceptClause !== null) {
      const exceptBlocks: Array<{ catchName: string; statements: string[] }> = [];
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
        });
        exceptIndex = exceptBlock.nextIndex;
      }
      if (exceptBlocks.length === 0 || !exceptBlocksHaveSameBody(exceptBlocks)) {
        return null;
      }
      const hoistedTry = hoistTryBlockDeclarations(tryBlock.statements);
      const catchName = exceptBlocks[0].catchName;
      return {
        statements: [
          ...hoistedTry.declarations,
          'try {',
          ...hoistedTry.statements,
          `} catch (${catchName}) {`,
          ...exceptBlocks[0].statements,
          '}',
        ],
        nextIndex: exceptIndex,
      };
    }
    return null;
  }

  const withStatement = /^with (.+):$/.exec(statement);
  if (withStatement !== null) {
    const withItems = parseWithItems(withStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
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
    let nextIndex = index + 1;
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
    if (namedItems.length === 0) {
      return {
        statements: [
          '{',
          ...blockStatements,
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
    const caseIndent = `${indent}    `;
    const bodyIndent = `${caseIndent}    `;
    const statements = [`switch (${translateExpression(matchStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`];
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
      const translatedCase = caseStatement[1] === '_'
        ? 'default'
        : `case ${translateExpression(caseStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
      statements.push(`  ${translatedCase}:${parsedCaseLine.comment === null ? '' : ` // ${parsedCaseLine.comment}`}`);

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
        `while (${translateConditionExpression(whileStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
        ...innerStatements,
        '}',
      ],
      nextIndex,
    };
  }

  const enumerateStatement = /^for ([A-Za-z_][A-Za-z0-9_]*), ([A-Za-z_][A-Za-z0-9_]*) in enumerate\((.+)\):$/.exec(statement);
  if (enumerateStatement !== null) {
    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
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
    return {
      statements: [
        `for (const [${tsExportNameForPythonName(enumerateStatement[1])}, ${tsExportNameForPythonName(enumerateStatement[2])}] of ${translateExpression(enumerateStatement[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}.entries()) {`,
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
    const branchDeclaredNames = new Set(declaredNames);
    for (const target of targets) {
      branchDeclaredNames.add(target);
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
        `for (let [${targets.map(tsExportNameForPythonName).join(', ')}] of ${translateExpression(tupleForOfStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
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
      if (rangeArgs.length < 1 || rangeArgs.length > 2) {
        return null;
      }
      const loopName = forOfStatement[1] === '_' ? 'i' : tsExportNameForPythonName(forOfStatement[1]);
      const start = rangeArgs.length === 1 ? '0' : translateExpression(rangeArgs[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const stop = translateExpression(rangeArgs.at(-1) ?? '', nameMap, arrayNames, validatedTypeAliases, mapNames);
      return {
        statements: [
          `for (let ${loopName} = ${start}; ${loopName} < ${stop}; ${loopName}++) {`,
          ...innerStatements,
          '}',
        ],
        nextIndex,
      };
    }
    return {
      statements: [
        `for (const ${tsExportNameForPythonName(forOfStatement[1])} of ${translateExpression(forOfStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
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
          statements: [`return ${translateExpression(expressionLines.join(' '), nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
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

  const returnStatement = /^return (.+)$/.exec(statement);
  if (returnStatement !== null) {
    return { statements: [`return ${translateExpression(returnStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)};`], nextIndex: index + 1 };
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
      : translateCallArgumentExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases);
    return {
      statements: [`throw ${translateRaiseExpression(multilineRaiseCall[1], message, nameMap, arrayNames, validatedTypeAliases, mapNames, true)};`],
      nextIndex: callParts.nextIndex,
    };
  }
  if (statement === 'raise') {
    return { statements: ['throw exc;'], nextIndex: index + 1 };
  }

  const annotatedAssignment = /^([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(statement);
  if (annotatedAssignment !== null) {
    const tsName = tsExportNameForPythonName(annotatedAssignment[1]);
    const typeExpression = tsTypeExpression(annotatedAssignment[2]);
    let assignedRight = maybeAwaitAsyncCall(
      translateExpression(annotatedAssignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames),
    );
    declaredNames.add(annotatedAssignment[1]);
    if (typeExpression.startsWith('Set<') || typeExpression.startsWith('ReadonlySet<')) {
      arrayNames.add(setNameMarker(annotatedAssignment[1]));
      arrayNames.add(setNameMarker(tsName));
    }
    if (typeExpression.endsWith('[]')) {
      arrayNames.add(annotatedAssignment[1]);
      arrayNames.add(tsName);
    }
    if (annotatedAssignment[2].trim() === 'Path') {
      arrayNames.add(pathNameMarker(annotatedAssignment[1]));
      arrayNames.add(pathNameMarker(tsName));
    }
    if (annotatedAssignment[2].trim() === 'list[Path]') {
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
    if (typeExpression.startsWith('Map<')) {
      addMutableName(mapNames, annotatedAssignment[1]);
      addMutableName(mapNames, tsName);
      if (assignedRight === '{}') {
        assignedRight = 'new Map()';
      }
    }
    return {
      statements: [
        `${reassignedNames.has(annotatedAssignment[1]) ? 'let' : 'const'} ${tsName}: ${typeExpression} = ${assignedRight};`,
      ],
      nextIndex: index + 1,
    };
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
        return popAssignment;
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
      if (callExpression === null) {
        return null;
      }
      return translateStraightLineAssignment(
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
      );
    }
    if (assignment[3] === '{') {
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
      return translateStraightLineAssignment(
        assignment[1],
        assignment[2],
        `[${listLiteral.items.join(', ')}]`,
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
      const expressionLines: string[] = [];
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const trimmed = lines[nextIndex].trim();
        if (lineStartsAtIndent(lines[nextIndex] ?? '', indent) && trimmed === ')') {
          return translateStraightLineAssignment(
            assignment[1],
            assignment[2],
            translateExpression(expressionLines.join(' '), nameMap, arrayNames, validatedTypeAliases, mapNames),
            nextIndex + 1,
            nameMap,
            declaredNames,
            reassignedNames,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
        }
        if (trimmed !== '') {
          expressionLines.push(trimmed);
        }
        nextIndex += 1;
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
      return translateStraightLineAssignment(
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
      );
    }
    return translateStraightLineAssignment(
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
    );
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

    const positionalParts: string[] = [];
    const keywordParts: string[] = [];
    let sawKeyword = false;
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === ')') {
        const callee = translateExpression(multilineKeywordCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
        if (keywordParts.length === 0) {
          return {
            statements: [`${translatePositionalCallExpression(multilineKeywordCall[1], positionalParts, nameMap, arrayNames, validatedTypeAliases)};`],
            nextIndex: nextIndex + 1,
          };
        }
        if (positionalParts.length === 0) {
          return {
            statements: [
              `${callee}({`,
              ...keywordParts.map((part) => `  ${part},`),
              '});',
            ],
            nextIndex: nextIndex + 1,
          };
        }
        return {
          statements: [
            `${callee}(`,
            ...positionalParts.map((part) => `  ${translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases)},`),
            `  { ${keywordParts.join(', ')} },`,
            ');',
          ],
          nextIndex: nextIndex + 1,
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
        keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${translateCallArgumentExpression(keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
      }
      nextIndex += 1;
    }
    return null;
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
    const args = [
      ...callParts.positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)),
      ...(callParts.keywordParts.length === 0 ? [] : [`{ ${callParts.keywordParts.join(', ')} }`]),
    ];
    return {
      statements: [`super(${args.join(', ')});`],
      nextIndex: callParts.nextIndex,
    };
  }

  const callStatement = /^(.+\))$/.exec(statement);
  if (callStatement !== null) {
    const pathlibWriteBytes = /^Path\((.+)\)\.write_bytes\((.+)\)$/.exec(callStatement[1]);
    if (pathlibWriteBytes !== null) {
      return {
        statements: [`writeFileSync(String(${translateExpression(pathlibWriteBytes[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}), ${translateExpression(pathlibWriteBytes[2], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
        nextIndex: index + 1,
      };
    }
    const dictPopDefaultNone = /^(.+)\.pop\((.+), None\)$/.exec(callStatement[1]);
    if (dictPopDefaultNone !== null) {
      const mapName = translateExpression(dictPopDefaultNone[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (mapNames.has(mapName)) {
        return {
          statements: [`${mapName}.delete(${translateMapKeyExpression(mapName, translateExpression(dictPopDefaultNone[2], nameMap, arrayNames, validatedTypeAliases, mapNames))});`],
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
        const key = translateMapKeyExpression(mapName, translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames));
        const lastArg = args[1] === undefined ? 'true' : /^last=(.+)$/.exec(args[1])?.[1] ?? args[1];
        return {
          statements: [`mapMoveToEnd(${mapName}, ${key}, ${translateExpression(lastArg, nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
          nextIndex: index + 1,
        };
      }
    }
    const superMethodCall = /^super\(\)\.([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/.exec(callStatement[1]);
    if (superMethodCall !== null) {
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
        || mapNames.has(target)
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
    const simpleCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/.exec(callStatement[1]);
    if (simpleCall !== null) {
      const args = splitTopLevelComma(simpleCall[2]);
      if (args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))) {
        return {
          statements: [`${translatePositionalCallExpression(simpleCall[1], args, nameMap, arrayNames, validatedTypeAliases)};`],
          nextIndex: index + 1,
        };
      }
    }
    return { statements: [`${translateExpression(callStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)};`], nextIndex: index + 1 };
  }

  return null;
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
): { expression: string; nextIndex: number } | null {
  const innerIndent = `${indent}    `;
  const firstLine = lines[startIndex] ?? '';
  if (!firstLine.startsWith(innerIndent)) {
    return null;
  }
  const firstExpression = firstLine.trim().replace(/,$/, '');
  let itemExpression: string;
  let nextIndex: number;
  const multilineCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(firstExpression);
  if (multilineCall !== null) {
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
  const forClause = /^for ([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec(forLine.trim());
  if (forClause === null) {
    return null;
  }
  const closeLine = lines[nextIndex + 1] ?? '';
  if (!closeLine.startsWith(indent) || closeLine.trim() !== ']') {
    return null;
  }
  const itemName = tsExportNameForPythonName(forClause[1]);
  const iterable = translateExpression(forClause[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
  return {
    expression: `${iterable}.map((${itemName}) => ${itemExpression})`,
    nextIndex: nextIndex + 2,
  };
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

function collectMultilineSequenceLiteral(
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

    items.push(translateExpression(item, nameMap, arrayNames, validatedTypeAliases, mapNames));
    nextIndex += 1;
  }
  return null;
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

function parseMultilineCallExpression(
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
    return {
      expression: sequenceGenerator,
      nextIndex: callParts.nextIndex,
    };
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
    return {
      expression: signatureCall,
      nextIndex: callParts.nextIndex,
    };
  }
  if (callParts.keywordParts.length === 0) {
    return {
      expression: translatePositionalCallExpression(pythonCallee, callParts.positionalParts, nameMap, arrayNames, validatedTypeAliases, mapNames, true),
      nextIndex: callParts.nextIndex,
    };
  }
  if (callParts.positionalParts.length === 0) {
    return {
      expression: `${callPrefix}({ ${callParts.keywordParts.join(', ')} })`,
      nextIndex: callParts.nextIndex,
    };
  }
  return {
    expression: `${callPrefix}(${[
      ...callParts.positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)),
      `{ ${callParts.keywordParts.join(', ')} }`,
    ].join(', ')})`,
    nextIndex: callParts.nextIndex,
  };
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
  const signature = parseLocalFunctionCallSignature(pythonCallee, nameMap);
  if (signature === null) {
    return null;
  }

  const consumedKeywords = new Set<string>();
  const args = callParts.positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
  for (const pythonName of signature.positional.slice(args.length)) {
    const keywordPart = callParts.keywordArgParts.find((part) => part.pythonName === pythonName);
    if (keywordPart === undefined) {
      break;
    }
    args.push(keywordPart.expression);
    consumedKeywords.add(pythonName);
  }

  const keywordParts = callParts.keywordArgParts
    .filter((part) => !consumedKeywords.has(part.pythonName))
    .map((part) => `${tsExportNameForPythonName(part.pythonName)}: ${part.expression}`);
  if (keywordParts.length > 0) {
    args.push(`{ ${keywordParts.join(', ')} }`);
  }
  return `${callPrefix}(${args.join(', ')})`;
}

function parseLocalFunctionCallSignature(
  pythonCallee: string,
  nameMap: Map<string, string>,
): FunctionCallSignature | null {
  const signatureText = nameMap.get(functionSignatureMarker(pythonCallee));
  if (signatureText === undefined) {
    return null;
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
        || !parsed.returnTupleMarkers.every((marker) => marker === null || marker === 'array' || marker === 'object' || marker === 'rectangle' || marker === 'set' || marker === 'string')
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

function applyTupleAssignmentReturnMarkers(
  names: string[],
  assignedRight: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
): void {
  const call = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\(/.exec(assignedRight.trim());
  if (call === null) {
    return;
  }
  const signature = parseLocalFunctionCallSignature(call[1], nameMap);
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
    }
  }
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
    const trimmed = lines[nextIndex].trim();
    if (trimmed === ')' || trimmed === '),') {
      return { positionalParts, keywordParts, keywordArgParts, nextIndex: nextIndex + 1 };
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

    const argParts = splitTopLevelComma(arg);
    let consumedNestedCall = false;
    for (const argPart of argParts) {
      const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(argPart);
      if (keywordArg === null) {
        if (sawKeyword) {
          return null;
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
        const expression = translateCallArgumentExpression(keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
        keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${expression}`);
        keywordArgParts.push({ pythonName: keywordArg[1], expression });
      }
    }
    if (!consumedNestedCall) {
      nextIndex += 1;
    }
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
): { statements: string[]; nextIndex: number } {
  const fullSliceAssignment = /^(.+)\[:\]$/.exec(pythonLeft);
  if (operator === '=' && fullSliceAssignment !== null) {
    const tsLeft = translateExpression(fullSliceAssignment[1], nameMap, arrayNames, validatedTypeAliases);
    return {
      statements: [`${tsLeft}.splice(0, ${tsLeft}.length, ...${tsRight});`],
      nextIndex,
    };
  }

  const assignedRight = operator === '=' ? maybeAwaitAsyncCall(tsRight) : tsRight;
  const mapItemAssignment = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(pythonLeft);
  if (operator === '=' && mapItemAssignment !== null) {
    const mapName = translateExpression(mapItemAssignment[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      const key = translateMapKeyExpression(mapName, translateExpression(mapItemAssignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames));
      return {
        statements: [`${mapName}.set(${key}, ${assignedRight});`],
        nextIndex,
      };
    }
  }
  const localAssignment = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonLeft);
  if (operator === '=' && localAssignment !== null) {
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
      recordLocalAssignmentMarkers(localAssignment[1], tsName, localAssignedRight, arrayNames, mapNames);
      return {
        statements: [`${tsName} = ${localAssignedRight};`],
        nextIndex,
      };
    }
    declaredNames.add(localAssignment[1]);
    const localAssignedRight = assignedRightAsKnownVector(localAssignment[1], tsName, assignedRight, arrayNames);
    recordLocalAssignmentMarkers(localAssignment[1], tsName, localAssignedRight, arrayNames, mapNames);
    return {
      statements: [
        `${reassignedNames.has(localAssignment[1]) ? 'let' : 'const'} ${tsName} = ${localAssignedRight};`,
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
    applyTupleAssignmentReturnMarkers(names, assignedRight, nameMap, arrayNames);
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
  }
  if (operator === '//=') {
    const tsLeft = translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return {
      statements: [`${tsLeft} = Math.floor(${tsLeft} / ${assignedRight});`],
      nextIndex,
    };
  }
  return {
    statements: [`${translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames)} ${operator} ${assignedRight};`],
    nextIndex,
  };
}

function assignedRightAsKnownVector(
  pythonName: string,
  tsName: string,
  assignedRight: string,
  arrayNames: ReadonlySet<string>,
): string {
  if (!arrayNames.has(vectorNameMarker(pythonName)) && !arrayNames.has(vectorNameMarker(tsName))) {
    return assignedRight;
  }
  const makeVector = /^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeVector2\(([\s\S]+)\)$/.exec(assignedRight);
  if (makeVector === null) {
    return assignedRight;
  }
  const args = splitTopLevelComma(makeVector[1]);
  return args.length === 2 ? `new Vec2(${args.join(', ')})` : assignedRight;
}

function recordLocalAssignmentMarkers(
  pythonName: string,
  tsName: string,
  assignedRight: string,
  arrayNames: Set<string>,
  mapNames: ReadonlySet<string>,
): void {
  if (/^[A-Za-z_$][A-Za-z0-9_.$]*(?:creatures|pickups|players)$/.test(assignedRight)) {
    arrayNames.add(pythonName);
  }
  if (/^Array\.from\(/.test(assignedRight)) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
  }
  if (assignedRight.startsWith('[')) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
  }
  if (assignedRight === '{}' || assignedRight.startsWith('{ ...')) {
    arrayNames.add(objectNameMarker(pythonName));
    arrayNames.add(objectNameMarker(tsName));
  }
  if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeRectangle\(/.test(assignedRight)) {
    arrayNames.add(rectangleNameMarker(pythonName));
    arrayNames.add(rectangleNameMarker(tsName));
  }
  if (/^(?:'[^']*'|"[^"]*"|`[^`]*`)$/.test(assignedRight)) {
    arrayNames.add(stringNameMarker(pythonName));
    arrayNames.add(stringNameMarker(tsName));
  }
  if (assignedRight.startsWith('new Map(')) {
    addMutableName(mapNames, pythonName);
    addMutableName(mapNames, tsName);
  }
  const callAssignment = /^(?:await )?([A-Za-z_$][A-Za-z0-9_$]*)\(/.exec(assignedRight);
  if (assignedRight.startsWith('new Set(') || (callAssignment !== null && arrayNames.has(setNameMarker(callAssignment[1])))) {
    arrayNames.add(setNameMarker(pythonName));
    arrayNames.add(setNameMarker(tsName));
  }
  if (callAssignment !== null && arrayNames.has(objectNameMarker(callAssignment[1]))) {
    arrayNames.add(objectNameMarker(pythonName));
    arrayNames.add(objectNameMarker(tsName));
  }
  if (callAssignment !== null && arrayNames.has(stringNameMarker(callAssignment[1]))) {
    arrayNames.add(stringNameMarker(pythonName));
    arrayNames.add(stringNameMarker(tsName));
  }
  if (translatedExpressionLooksVector(assignedRight)) {
    arrayNames.add(vectorNameMarker(pythonName));
    arrayNames.add(vectorNameMarker(tsName));
  }
  if (translatedExpressionLooksVectorArray(assignedRight)) {
    arrayNames.add(vectorArrayNameMarker(pythonName));
    arrayNames.add(vectorArrayNameMarker(tsName));
  }
  if (assignedRight === 'new Date()') {
    arrayNames.add(dateNameMarker(pythonName));
    arrayNames.add(dateNameMarker(tsName));
  }
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
  const key = translateMapKeyExpression(mapName, translateExpression(pythonKeyExpression, nameMap, arrayNames, validatedTypeAliases, mapNames));
  const valueExpression = mapNames.has(mapName) ? `${mapName}.get(${key})!` : `${mapName}[${key}]`;
  const deleteStatement = mapNames.has(mapName) ? `${mapName}.delete(${key});` : `delete ${mapName}[${key}];`;
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

function translateRaiseExpression(
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
  if (
    translatedCallee.includes('.')
    || ['Exception', 'RuntimeError', 'UserWarning', 'ValueError'].includes(translatedCallee)
  ) {
    return `new Error(${message})`;
  }
  return `new ${translatedCallee}(${message})`;
}

function parseExceptClause(statement: string): { name: string | null } | null {
  const clause = /^except (?:(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|\((?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)(?:, [A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)+\))(?: as ([A-Za-z_][A-Za-z0-9_]*))?:$/.exec(statement);
  return clause === null ? null : { name: clause[1] ?? null };
}

function translateKeyErrorLookupStatement(
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

function parseWithItems(
  itemsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): WithItem[] | null {
  const items: WithItem[] = [];
  for (const itemText of splitTopLevelComma(itemsText)) {
    const item = /^(.+) as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(itemText);
    if (item !== null) {
      items.push({
        pythonName: item[2],
        name: tsExportNameForPythonName(item[2]),
        expression: translateExpression(item[1], nameMap, arrayNames, validatedTypeAliases, mapNames),
        close: true,
      });
      continue;
    }
    items.push({
      expression: translateExpression(itemText, nameMap, arrayNames, validatedTypeAliases, mapNames),
      close: false,
    });
  }
  return items.length === 0 ? null : items;
}

function exceptBlocksHaveSameBody(blocks: Array<{ statements: string[] }>): boolean {
  if (blocks.length <= 1) {
    return true;
  }
  const [first, ...rest] = blocks;
  const firstText = first.statements.join('\n');
  return rest.every((block) => block.statements.join('\n') === firstText);
}

function addMutableName(names: ReadonlySet<string>, name: string): void {
  if (names instanceof Set) {
    names.add(name);
  }
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

function lineStartsAtIndent(line: string, indent: string): boolean {
  return line.startsWith(indent) && !line.slice(indent.length).startsWith(' ');
}

function hoistTryBlockDeclarations(statements: string[]): { declarations: string[]; statements: string[] } {
  const declarations: string[] = [];
  const rewritten = statements.map((statement) => {
    const destructuringDeclaration = /^(\s*)const \[([A-Za-z_$][A-Za-z0-9_$]*(?:, [A-Za-z_$][A-Za-z0-9_$]*)*)\] = (.+);$/.exec(statement);
    if (destructuringDeclaration !== null) {
      const typeExpression = tsTypeForAssignedExpression(destructuringDeclaration[3]);
      if (typeExpression !== null) {
        const names = destructuringDeclaration[2].split(', ');
        names.forEach((name, nameIndex) => {
          declarations.push(`let ${name}: ${typeExpression}[${nameIndex}];`);
        });
        return `${destructuringDeclaration[1]}[${destructuringDeclaration[2]}] = ${destructuringDeclaration[3]};`;
      }
    }
    const declaration = /^(\s*)(?:const|let) ([A-Za-z_$][A-Za-z0-9_$]*) = (.+);$/.exec(statement);
    if (declaration === null) {
      return statement;
    }
    const typeExpression = tsTypeForAssignedExpression(declaration[3]);
    if (typeExpression === null) {
      return statement;
    }
    declarations.push(`let ${declaration[2]}: ${typeExpression};`);
    return `${declaration[1]}${declaration[2]} = ${declaration[3]};`;
  });
  return { declarations, statements: rewritten };
}

function tsTypeForAssignedExpression(expression: string): string | null {
  const trimmed = expression.trim();
  const awaited = /^await (.+)$/.exec(trimmed);
  if (awaited !== null) {
    const innerType = tsTypeForAssignedExpression(awaited[1]);
    return innerType === null ? null : `Awaited<${innerType}>`;
  }
  const constructor = /^new ([A-Za-z_$][A-Za-z0-9_$]*)\(/.exec(trimmed);
  if (constructor !== null) {
    return constructor[1];
  }
  const enumMode = /\b([A-Z][A-Za-z0-9_]*Mode)\b/.exec(trimmed);
  if (enumMode !== null) {
    return enumMode[1];
  }
  const call = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\(/.exec(trimmed);
  if (call !== null) {
    return `ReturnType<typeof ${call[1]}>`;
  }
  if (/^(?:true|false)$/.test(trimmed)) {
    return 'boolean';
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return 'number';
  }
  if (/^(?:"[^"]*"|'[^']*'|`[^`]*`)$/.test(trimmed)) {
    return 'string';
  }
  return null;
}

export function rewriteStructPositionalConstructors(
  statement: string,
  structConstructorFields: ReadonlyMap<string, string[]>,
): string {
  if (structConstructorFields.size === 0) {
    return statement;
  }

  let output = '';
  let index = 0;
  const constructorPattern = /new ([A-Za-z_$][A-Za-z0-9_$]*)\(/g;
  while (index < statement.length) {
    constructorPattern.lastIndex = index;
    const match = constructorPattern.exec(statement);
    if (match === null) {
      output += statement.slice(index);
      break;
    }

    const fields = structConstructorFields.get(match[1]);
    const argsStart = constructorPattern.lastIndex;
    const closeIndex = matchingCloseParen(statement, argsStart - 1);
    if (fields === undefined || closeIndex === null) {
      output += statement.slice(index, constructorPattern.lastIndex);
      index = constructorPattern.lastIndex;
      continue;
    }

    const argsText = statement.slice(argsStart, closeIndex);
    const args = splitTopLevelComma(argsText);
    if (argsText.trim() === '') {
      output += statement.slice(index, closeIndex + 1);
      index = closeIndex + 1;
      continue;
    }
    if (args.length > fields.length || args[0]?.trim().startsWith('{') === true) {
      output += statement.slice(index, closeIndex + 1);
      index = closeIndex + 1;
      continue;
    }

    const lastArg = args.at(-1)?.trim() ?? '';
    const keywordObject = /^\{ (.+) \}$/.exec(lastArg);
    const positionalArgs = keywordObject === null ? args : args.slice(0, -1);
    if (positionalArgs.length > fields.length) {
      output += statement.slice(index, closeIndex + 1);
      index = closeIndex + 1;
      continue;
    }

    const fieldAssignments = fields
      .slice(0, positionalArgs.length)
      .map((field, argIndex) => `${field}: ${positionalArgs[argIndex]}`);
    if (keywordObject !== null) {
      fieldAssignments.push(keywordObject[1]);
    }

    output += statement.slice(index, match.index);
    output += `new ${match[1]}({ ${fieldAssignments.join(', ')} })`;
    index = closeIndex + 1;
  }
  return output;
}

function maybeAwaitAsyncCall(tsExpression: string): string {
  return /^(?:load[A-Z][A-Za-z0-9_]*|initAudioState)\(.*\)$/.test(tsExpression) ? `await ${tsExpression}` : tsExpression;
}

export function reassignedLocalNames(lines: string[], startIndex: number): Set<string> {
  const counts = new Map<string, number>();
  let firstStatementIndex = startIndex;
  while (firstStatementIndex < lines.length && lines[firstStatementIndex].trim() === '') {
    firstStatementIndex += 1;
  }
  const baseIndent = /^(\s+)/.exec(lines[firstStatementIndex] ?? '')?.[1] ?? null;
  if (baseIndent === null) {
    return new Set();
  }

  let index = firstStatementIndex;
  while (index < lines.length) {
    if (lines[index].trim() !== '' && !lines[index].startsWith(baseIndent)) {
      break;
    }
    const assignment = /^\s+([A-Za-z_][A-Za-z0-9_]*) (?:\+=|-=|\*=|\/=|\|=|&=|\^=|=) /.exec(lines[index]);
    if (assignment !== null) {
      counts.set(assignment[1], (counts.get(assignment[1]) ?? 0) + 1);
    }
    const annotatedAssignment = /^\s+([A-Za-z_][A-Za-z0-9_]*): .+ = /.exec(lines[index]);
    if (annotatedAssignment !== null) {
      counts.set(annotatedAssignment[1], (counts.get(annotatedAssignment[1]) ?? 0) + 1);
    }
    const tupleAssignment = /^\s+([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) = /.exec(lines[index]);
    if (tupleAssignment !== null) {
      for (const name of tupleAssignment[1].split(', ')) {
        if (name !== '_') {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    index += 1;
  }
  return new Set(
    [...counts.entries()]
      .filter((entry) => entry[1] > 1)
      .map((entry) => entry[0]),
  );
}

export function parseTopLevelAssignment(
  lines: string[],
  index: number,
  nameMap: Map<string, string> = new Map(),
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
  const publicUppercaseName = !pythonName.startsWith('_') && /^[A-Z0-9_]+$/.test(pythonName);
  const dictKeyType = /^dict\[([^,\]]+), .+\]$/.exec(annotatedType?.trim() ?? '')?.[1] ?? null;
  const privateUppercaseName = (
    pythonName.startsWith('_')
    && /^[A-Z0-9_]+$/.test(pythonName.replace(/^_+/, ''))
    && (
      /^frozenset\[/.test(annotatedType?.trim() ?? '')
      || /^tuple\[/.test(annotatedType?.trim() ?? '')
      || (dictKeyType !== null && mapKeyTypeHasStableIdentity(dictKeyType))
    )
  );
  const name = annotatedType === null
    ? pythonName.startsWith('_') ? tsExportNameForPythonName(pythonName) : tsPublicNameForPythonName(pythonName)
    : publicUppercaseName ? tsPublicNameForPythonName(pythonName) : privateUppercaseName ? tsExportNameForPythonName(pythonName) : tsMutableNameForPythonName(pythonName);
  const typeExpression = annotatedType === null ? undefined : tsTopLevelAssignmentTypeExpression(annotatedType);
  const baseAssignment = {
    pythonName,
    name,
    declaration: annotatedType === null || publicUppercaseName || privateUppercaseName ? 'const' as const : 'let' as const,
    exported: !pythonName.startsWith('_'),
    typeExpression,
    trailingComment: parsedLine.comment ?? undefined,
  };
  if (value === '(') {
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

      const tupleItem = /^(.+),$/.exec(trimmed);
      if (tupleItem === null) {
        return null;
      }
      valueLines.push(`  ${translateExpression(tupleItem[1], nameMap)},`);
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
      valueLines.push(`  ${translateExpression(listItem[1], nameMap)},`);
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
        valueLines.push(`  [${translateExpression(dictItem[1], nameMap)}, ${translateExpression(dictItem[2], nameMap)}],${parsedItemLine.comment === null ? '' : ` // ${parsedItemLine.comment}`}`);
        nextIndex += 1;
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
      valueLines.push(`  [${translateExpression(multilineDictItem[1], nameMap)}, ${callExpression.expression}],`);
      nextIndex = callExpression.nextIndex;
    }

    return null;
  }

  if (value === '{}' && annotatedType?.trim().startsWith('dict[') === true) {
    return {
      assignment: { ...baseAssignment, declaration: 'const', valueLines: ['new Map()'] },
      nextIndex: index + 1,
    };
  }

  const oneLineFrozenSet = /^frozenset\(\{(.*)\}\)$/.exec(value);
  if (oneLineFrozenSet !== null) {
    const items = splitTopLevelComma(oneLineFrozenSet[1]).filter((item) => item !== '');
    return {
      assignment: {
        ...baseAssignment,
        typeExpression: baseAssignment.typeExpression ?? 'ReadonlySet<number>',
        valueLines: [
          'new Set([',
          ...items.map((item) => `  ${translateExpression(item, nameMap)},`),
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
        typeExpression: baseAssignment.typeExpression ?? 'ReadonlySet<number>',
        valueLines: frozenSet.valueLines,
      },
      nextIndex: frozenSet.nextIndex,
    };
  }

  const setUnion = /^[A-Z][A-Z0-9_]*(?: \| [A-Z][A-Z0-9_]*)+$/.exec(value);
  if (setUnion !== null) {
    const setNames = value.split(' | ').map((setName) => translateExpression(setName, nameMap));
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
      .map((part) => translateExpression(part, nameMap));
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
      valueLines.push(`  ${translateExpression(arg[1], nameMap)},`);
      nextIndex += 1;
    }
    return null;
  }

  const keywordCall = /^([A-Za-z_][A-Za-z0-9_]*)\($/.exec(value);
  if (keywordCall === null) {
    return {
      assignment: { ...baseAssignment, valueLines: [translateExpression(value, nameMap)] },
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
    valueLines.push(`  ${tsExportNameForPythonName(keywordArg[1])}: ${translateExpression(keywordArg[2], nameMap)},`);
    nextIndex += 1;
  }

  return null;
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
): { valueLines: string[]; nextIndex: number } | null {
  if ((lines[startIndex] ?? '').trim() !== '{') {
    return null;
  }
  const valueLines = ['new Set(['];
  let nextIndex = startIndex + 1;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '}' || trimmed === '},') {
      if ((lines[nextIndex + 1] ?? '').trim() !== ')') {
        return null;
      }
      valueLines.push('])');
      return { valueLines, nextIndex: nextIndex + 2 };
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
    valueLines.push(`  ${translateExpression(item[1])},`);
    nextIndex += 1;
  }
  return null;
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
  const source = filterExpression === null
    ? iterable
    : `${iterable}.filter((${itemName}) => ${translateExpression(filterExpression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  return {
    expression: `new Map(Array.from(${source}, (${itemName}) => [${key}, ${value}] as const))`,
    nextIndex: closeIndex + 1,
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
