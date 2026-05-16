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
  translatedExpressionLooksVector,
  vectorNameMarker,
} from './expression.js';
import {
  parseFunctionParameterText,
  parseFunctionParametersText,
  pythonParameterNames,
} from './parameters.js';

export function parseStraightLineFunctionHeader(
  lines: string[],
  index: number,
): { name: string; parametersText: string; returnType: string; nextIndex: number } | null {
  const oneLine = /^def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([^:]+):$/.exec(lines[index] ?? '');
  if (oneLine !== null) {
    return {
      name: oneLine[1],
      parametersText: oneLine[2],
      returnType: oneLine[3],
      nextIndex: index + 1,
    };
  }
  const oneLineWithoutReturn = /^def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\):$/.exec(lines[index] ?? '');
  if (oneLineWithoutReturn !== null) {
    return {
      name: oneLineWithoutReturn[1],
      parametersText: oneLineWithoutReturn[2],
      returnType: 'any',
      nextIndex: index + 1,
    };
  }

  const start = /^def ([A-Za-z_][A-Za-z0-9_]*)\($/.exec(lines[index] ?? '');
  if (start === null) {
    return null;
  }

  const parameterLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const close = /^\) -> ([^:]+):$/.exec(lines[nextIndex] ?? '');
    if (close !== null) {
      return {
        name: start[1],
        parametersText: parameterLines.join(', '),
        returnType: close[1],
        nextIndex: nextIndex + 1,
      };
    }

    const parameterLine = /^    (.+),$/.exec(lines[nextIndex] ?? '');
    if (parameterLine === null) {
      return null;
    }
    parameterLines.push(parameterLine[1]);
    nextIndex += 1;
  }

  return null;
}
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
        types.add(inferPythonExpressionType(assignment[2]));
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
    const type = new Set(candidateTypes).size === 1 ? candidateTypes[0] : 'any';
    declarations.push(`let ${tsExportNameForPythonName(name)}: ${type};`);
    declaredNames.add(name);
  }
  return declarations;
}
function parseNestedFunctionStatement(
  lines: string[],
  index: number,
  indent: string,
  outerNameMap: Map<string, string>,
  validatedTypeAliases: ReadonlySet<string>,
  relativePath: string | null,
  mapNames: ReadonlySet<string>,
): { statements: string[]; nextIndex: number } | null {
  const header = parseIndentedFunctionHeader(lines, index, indent);
  if (header === null) {
    return null;
  }

  const arrayNames = new Set<string>();
  const parsedParams = parseFunctionParametersText(header.parametersText, arrayNames);
  if (parsedParams === null) {
    return null;
  }

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
  const returnType = tsTypeExpression(header.returnType);
  return {
    statements: [
      `${async ? 'async ' : ''}function ${tsExportNameForPythonName(header.name)}(${params.join(', ')}): ${async ? `Promise<${returnType}>` : returnType} {`,
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
    return { statements: [`// ${statement.replace(/^# ?/, '')}`], nextIndex: index + 1 };
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
  let ifBodyStartIndex = index + 1;
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
  if (ifCondition !== null) {
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
      `if (${translateExpression(ifCondition, nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
      ...initialBranch.statements,
      '}',
    ];
    while (nextIndex < lines.length) {
      const elifStatement = /^elif (.+):$/.exec((lines[nextIndex] ?? '').trim());
      if (elifStatement === null) {
        break;
      }
      const elifBranch = translateBranch(nextIndex + 1);
      if (elifBranch === null) {
        return null;
      }
      statements[statements.length - 1] = `} else if (${translateExpression(elifStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`;
      statements.push(...elifBranch.statements, '}');
      nextIndex = elifBranch.nextIndex;
    }
    if ((lines[nextIndex] ?? '').trim() === 'else:') {
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
    const exceptStatement = /^except (?:(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)|\([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+\))(?: as ([A-Za-z_][A-Za-z0-9_]*))?:$/.exec(afterTry);
    if (exceptStatement !== null) {
      const exceptBlock = translateBlock(tryBlock.nextIndex + 1);
      if (exceptBlock === null) {
        return null;
      }
      const hoistedTry = hoistTryBlockDeclarations(tryBlock.statements);
      const catchName = tsExportNameForPythonName(exceptStatement[1] ?? 'exc');
      return {
        statements: [
          ...hoistedTry.declarations,
          'try {',
          ...hoistedTry.statements,
          `} catch (${catchName}) {`,
          ...exceptBlock.statements,
          '}',
        ],
        nextIndex: exceptBlock.nextIndex,
      };
    }
    return null;
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

      const caseStatement = /^case (.+):$/.exec(line.slice(caseIndent.length));
      if (caseStatement === null) {
        return null;
      }
      sawCase = true;
      const translatedCase = caseStatement[1] === '_'
        ? 'default'
        : `case ${translateExpression(caseStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
      statements.push(`  ${translatedCase}:`);

      const caseStatements: string[] = [];
      nextIndex += 1;
      while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, bodyIndent)) {
        if (lines[nextIndex].trim() === '') {
          caseStatements.push('');
          nextIndex += 1;
          continue;
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
      if (caseStatements.length === 0) {
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
        `while (${translateExpression(whileStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
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

  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.mkdir\(parents=True, exist_ok=True\)$/.test(statement)) {
    return {
      statements: [],
      nextIndex: index + 1,
    };
  }

  if (statement === 'return (') {
    const expressionLines: string[] = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === ')') {
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
    const assignedRight = maybeAwaitAsyncCall(
      translateExpression(annotatedAssignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames),
    );
    declaredNames.add(annotatedAssignment[1]);
    return {
      statements: [
        `${reassignedNames.has(annotatedAssignment[1]) ? 'let' : 'const'} ${tsName}: ${tsTypeExpression(annotatedAssignment[2])} = ${assignedRight};`,
      ],
      nextIndex: index + 1,
    };
  }

  const assignment = /^(.+?) (\+=|-=|\*=|\/=|=) (.+)$/.exec(statement);
  if (assignment !== null) {
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
    if (assignment[3] === '(') {
      const expressionLines: string[] = [];
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const trimmed = lines[nextIndex].trim();
        if (trimmed === ')') {
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
      if (arg === '{') {
        const dictLiteral = collectMultilineDictLiteral(lines, nextIndex + 1);
        if (dictLiteral === null) {
          return null;
        }
        positionalParts.push(dictLiteral.expression);
        nextIndex = dictLiteral.nextIndex;
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
        keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${translateExpression(keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
      }
      nextIndex += 1;
    }
    return null;
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
): { expression: string; nextIndex: number } | null {
  const parts: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === ')') {
      return parts.length === 0
        ? null
        : {
          expression: translateExpression(parts.join(' '), nameMap, arrayNames, validatedTypeAliases),
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

function collectMultilineDictLiteral(
  lines: string[],
  startIndex: number,
): { expression: string; nextIndex: number } | null {
  const parts: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '}' || trimmed === '},') {
      return { expression: `{ ${parts.join(', ')} }`, nextIndex: nextIndex + 1 };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    const item = /^(.+),$/.exec(trimmed);
    if (item === null) {
      return null;
    }
    parts.push(item[1]);
    nextIndex += 1;
  }
  return null;
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
  if (callParts.keywordParts.length === 0) {
    return {
      expression: translatePositionalCallExpression(pythonCallee, callParts.positionalParts, nameMap, arrayNames, validatedTypeAliases, true),
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
      ...callParts.positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases)),
      `{ ${callParts.keywordParts.join(', ')} }`,
    ].join(', ')})`,
    nextIndex: callParts.nextIndex,
  };
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
): { positionalParts: string[]; keywordParts: string[]; nextIndex: number } | null {
  const positionalParts: string[] = [];
  const keywordParts: string[] = [];
  let sawKeyword = false;
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === ')' || trimmed === '),') {
      return { positionalParts, keywordParts, nextIndex: nextIndex + 1 };
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
    if (arg === '{') {
      const dictLiteral = collectMultilineDictLiteral(lines, nextIndex + 1);
      if (dictLiteral === null) {
        return null;
      }
      positionalParts.push(dictLiteral.expression);
      nextIndex = dictLiteral.nextIndex;
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
          nextIndex = callExpression.nextIndex;
          consumedNestedCall = true;
          break;
        }
        keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${translateExpression(keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
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
  const mapItemAssignment = /^([A-Za-z_][A-Za-z0-9_]*)\[(.+)\]$/.exec(pythonLeft);
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
      return {
        statements: [`${tsName} = ${assignedRight};`],
        nextIndex,
      };
    }
    declaredNames.add(localAssignment[1]);
    if (/\.(?:creatures|pickups|players)\b/.test(assignedRight)) {
      arrayNames.add(localAssignment[1]);
    }
    if (translatedExpressionLooksVector(assignedRight)) {
      arrayNames.add(vectorNameMarker(localAssignment[1]));
      arrayNames.add(vectorNameMarker(tsName));
    }
    return {
      statements: [
        `${reassignedNames.has(localAssignment[1]) ? 'let' : 'const'} ${tsName} = ${assignedRight};`,
      ],
      nextIndex,
    };
  }
  const tupleAssignment = /^([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+)$/.exec(pythonLeft);
  if (operator === '=' && tupleAssignment !== null) {
    const names = tupleAssignment[1].split(', ');
    const tsNames = names.map((name) => name === '_' ? '' : tsExportNameForPythonName(name));
    const alreadyDeclared = names.filter((name) => name !== '_').every((name) => declaredNames.has(name));
    const declaration = alreadyDeclared
      ? ''
      : names.some((name) => reassignedNames.has(name)) ? 'let ' : 'const ';
    for (const name of names) {
      if (name !== '_') {
        declaredNames.add(name);
      }
    }
    return {
      statements: [`${declaration}[${tsNames.join(', ')}] = ${assignedRight};`],
      nextIndex,
    };
  }
  if (operator === '=') {
    const tsLeft = translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (assignedRight === tsLeft) {
      return { statements: [], nextIndex };
    }
  }
  return {
    statements: [`${translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames)} ${operator} ${assignedRight};`],
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

function hoistTryBlockDeclarations(statements: string[]): { declarations: string[]; statements: string[] } {
  const declarations: string[] = [];
  const rewritten = statements.map((statement) => {
    const declaration = /^(\s*)const ([A-Za-z_$][A-Za-z0-9_$]*) = (.+);$/.exec(statement);
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
    const assignment = /^\s+([A-Za-z_][A-Za-z0-9_]*) (?:\+=|-=|\*=|\/=|=) /.exec(lines[index]);
    if (assignment !== null) {
      counts.set(assignment[1], (counts.get(assignment[1]) ?? 0) + 1);
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
