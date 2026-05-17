import type {
  FunctionParameter,
  ImportDefinition,
} from '../model.js';
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
  parseIndentedFunctionHeader,
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
  classFieldTypeMarker,
  colorNameMarker,
  dateNameMarker,
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
  tsFunctionReturnTypeExpression,
} from './function-headers.js';
import {
  parseFunctionParameterText,
  parseFunctionParametersText,
  pythonParameterNames,
} from './parameters.js';
import {
  isSimpleReferenceExpression,
  translateConditionExpression,
} from './statements/conditions.js';
import {
  parseExceptClause,
  tsExceptGuardExpression,
} from './statements/exceptions.js';
import { splitInlineComment } from './statements/inline-comments.js';
import {
  tsAttributeNameForPythonName,
  tsLocalDeclarationNameForAssignment,
  tsLocalFunctionNameForPythonName,
  tsLocalImportNameForPythonName,
  tsLocalNameForPythonParameter,
} from './statements/names.js';
import {
  predeclareIfBranchAssignments,
  predeclareLoopBlockAssignments,
  predeclareMatchCaseAssignments,
  predeclareTryFinallyAssignments,
} from './statements/predeclare.js';
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

export {
  functionSignatureMarker,
  parseStraightLineFunctionHeader,
} from './function-headers.js';

export { nullableLocalNames, reassignedLocalNames } from './statements/reassigned-locals.js';
export { rewriteStructPositionalConstructors } from './statements/struct-rewrites.js';

const reassignedLocalTypePrefix = '\u0000reassigned-local-type:';

export function addReassignedLocalTypeAnnotations(
  lines: string[],
  startIndex: number,
  reassignedNames: Set<string>,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): void {
  const typesByName = new Map<string, string[]>();
  const localTypes = new Map<string, string>();
  let firstStatementIndex = startIndex;
  while (firstStatementIndex < lines.length && lines[firstStatementIndex].trim() === '') {
    firstStatementIndex += 1;
  }
  const baseIndent = /^(\s+)/.exec(lines[firstStatementIndex] ?? '')?.[1] ?? null;
  if (baseIndent === null) {
    return;
  }

  let index = firstStatementIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() !== '' && !line.startsWith(baseIndent)) {
      break;
    }
    const lineIndent = /^(\s*)/.exec(line)?.[1] ?? '';
    if (lineIndent !== baseIndent) {
      index += 1;
      continue;
    }
    const statement = splitInlineComment(line.trim()).code;
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(statement);
    if (assignment !== null) {
      const type = inferredReassignedLocalType(assignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames, localTypes);
      if (type !== null) {
        localTypes.set(assignment[1], type);
      }
      if (reassignedNames.has(assignment[1])) {
        addReassignedLocalType(typesByName, assignment[1], type);
      }
    }
    const annotatedAssignment = /^([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(statement);
    if (annotatedAssignment !== null) {
      const type = tsTypeExpression(annotatedAssignment[2]);
      localTypes.set(annotatedAssignment[1], type);
      if (reassignedNames.has(annotatedAssignment[1])) {
        addReassignedLocalType(typesByName, annotatedAssignment[1], type);
      }
    }
    index += 1;
  }

  for (const [name, types] of typesByName) {
    if (types.length > 1) {
      reassignedNames.add(reassignedLocalTypeMarker(name, types.join(' | ')));
    }
  }
}

type WithItem = {
  pythonName: string;
  name: string;
  expression: string;
  close: true;
} | {
  expression: string;
  close: false;
};

type FunctionReturnMarker = 'array' | 'map' | 'object' | 'rectangle' | 'set' | 'string';

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
  if (pattern.includes(' | ')) {
    const conditions: string[] = [];
    for (const part of pattern.split(' | ')) {
      const branch = parseClassPatternCase(part, subject, nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (branch === null || branch.captures.length > 0 || branch.declaredNames.size > 0) {
        return null;
      }
      conditions.push(branch.condition);
    }
    return {
      condition: conditions.join(' || '),
      captures: [],
      nameMap,
      declaredNames: new Set(),
    };
  }

  const classPattern = /^([A-Z][A-Za-z0-9_]*)\((.*)\)$/.exec(pattern);
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

function translateClassPatternMatchStatement(
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
): { statements: string[]; nextIndex: number } | null {
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

    const parsedCaseLine = splitInlineComment(line.slice(caseIndent.length));
    const caseStatement = /^case (.+):$/.exec(parsedCaseLine.code);
    if (caseStatement === null) {
      return null;
    }

    let condition: string | null = null;
    let captures: string[] = [];
    let branchNameMap = nameMap;
    let branchDeclaredNames = declaredNames;
    if (caseStatement[1] !== '_') {
      const parsedClassPattern = parseClassPatternCase(
        caseStatement[1],
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

    const bodyStartIndex = nextIndex + 1;
    const bodyStatements: string[] = [];
    nextIndex = bodyStartIndex;
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
      const innerStatement = translateStraightLineStatement(
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
      comment: parsedCaseLine.comment,
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
  statements.push('}');

  return { statements, nextIndex };
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
  const parsedParams = parseNestedFunctionParameters(
    header.parametersText,
    arrayNames,
    outerNameMap,
    validatedTypeAliases,
    mapNames,
  );
  if (parsedParams === null) {
    return null;
  }

  const functionName = tsLocalFunctionNameForPythonName(header.name);
  outerNameMap.set(header.name, functionName);

  const nestedNameMap = new Map(outerNameMap);
  nestedNameMap.set(header.name, functionName);
  for (const [pythonName, tsName] of parsedParams.nameBindings) {
    nestedNameMap.set(pythonName, tsName);
  }
  const statements: string[] = [];
  const declaredNames = parsedParams.declaredNames;
  for (const name of nonlocalNames(lines, header.nextIndex, `${indent}    `)) {
    declaredNames.add(name);
  }
  const reassignedNames = reassignedLocalNames(lines, header.nextIndex);
  addReassignedLocalTypeAnnotations(lines, header.nextIndex, reassignedNames, nestedNameMap, arrayNames, validatedTypeAliases, mapNames);
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
  outerNameMap.set(functionReturnTypeMarker(header.name), returnType);
  outerNameMap.set(functionReturnTypeMarker(functionName), returnType);
  return {
    statements: [
      `const ${functionName} = ${async ? 'async ' : ''}(${parsedParams.params.join(', ')}): ${async ? `Promise<${returnType}>` : returnType} => {`,
      ...[...parsedParams.prologue, ...statements].map(indentStatementLine),
      '};',
    ],
    nextIndex,
  };
}

function nonlocalNames(lines: string[], startIndex: number, indent: string): Set<string> {
  const names = new Set<string>();
  let index = startIndex;
  while (index < lines.length && isIndentedBlockLine(lines, index, indent)) {
    const statement = lines[index].slice(indent.length).trim();
    const nonlocalStatement = /^nonlocal ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(statement);
    if (nonlocalStatement !== null) {
      for (const name of nonlocalStatement[1].split(', ')) {
        names.add(name);
      }
    }
    index += 1;
  }
  return names;
}

function parseNestedFunctionParameters(
  parametersText: string,
  arrayNames: Set<string>,
  nameMap: Map<string, string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): {
  params: string[];
  prologue: string[];
  declaredNames: Set<string>;
  nameBindings: Map<string, string>;
} | null {
  const parameterParts = parametersText === '' ? [] : splitTopLevelComma(parametersText);
  const hasVariadicArgs = parameterParts.some((part) => /^\*[A-Za-z_][A-Za-z0-9_]*/.test(part.trim()));
  if (!hasVariadicArgs) {
    const parsedParams = parseFunctionParametersText(parametersText, arrayNames);
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
    return {
      params,
      prologue,
      declaredNames: new Set<string>(pythonParameterNames(parametersText)),
      nameBindings: new Map(),
    };
  }

  const params: string[] = [];
  const prologue: string[] = [];
  const declaredNames = new Set<string>();
  const nameBindings = new Map<string, string>();
  let afterVariadicArgs = false;
  for (const rawPart of parameterParts) {
    const part = rawPart.trim();
    if (part === '*') {
      afterVariadicArgs = true;
      continue;
    }

    const variadicArgs = /^\*([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(part);
    if (variadicArgs !== null) {
      const name = variadicArgs[1];
      const tsName = tsLocalNameForPythonParameter(name);
      const typeExpression = variadicArgs[2].trim() === 'Any' ? 'any' : tsTypeExpression(variadicArgs[2]);
      params.push(`...${tsName}: ${typeExpression}[]`);
      declaredNames.add(name);
      nameBindings.set(name, tsName);
      afterVariadicArgs = true;
      continue;
    }

    const variadicKeywords = /^\*\*([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(part);
    if (variadicKeywords !== null) {
      const name = variadicKeywords[1];
      const tsName = tsLocalNameForPythonParameter(name);
      const typeExpression = variadicKeywords[2].trim() === 'Any' ? 'any' : tsTypeExpression(variadicKeywords[2]);
      prologue.push(`const ${tsName}: Record<string, ${typeExpression}> = {};`);
      declaredNames.add(name);
      nameBindings.set(name, tsName);
      continue;
    }

    const parameter = parseNestedFunctionParameterText(part, arrayNames, nameMap, validatedTypeAliases, mapNames);
    if (parameter === null) {
      return null;
    }
    declaredNames.add(parameter.pythonName);
    nameBindings.set(parameter.pythonName, parameter.name);
    if (afterVariadicArgs) {
      prologue.push(`const ${parameter.name}: ${parameter.typeExpression} = ${parameter.defaultValue ?? 'undefined'};`);
    } else {
      params.push(renderInlineParameter(parameter));
    }
  }

  return { params, prologue, declaredNames, nameBindings };
}

function parseNestedFunctionParameterText(
  parameterText: string,
  arrayNames: Set<string>,
  nameMap: Map<string, string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): (FunctionParameter & { pythonName: string }) | null {
  const typedParameter = /^([A-Za-z_][A-Za-z0-9_]*): ([^=]+?)(?: = (.+))?$/.exec(parameterText);
  if (typedParameter !== null) {
    const pythonName = typedParameter[1];
    return {
      pythonName,
      name: tsLocalNameForPythonParameter(pythonName),
      typeExpression: tsTypeExpression(typedParameter[2]),
      ...(typedParameter[3] === undefined ? {} : { defaultValue: translateExpression(typedParameter[3], nameMap, arrayNames, validatedTypeAliases, mapNames) }),
    };
  }

  const untypedParameter = /^([A-Za-z_][A-Za-z0-9_]*)(?: = (.+))?$/.exec(parameterText);
  if (untypedParameter !== null) {
    const pythonName = untypedParameter[1];
    return {
      pythonName,
      name: tsLocalNameForPythonParameter(pythonName),
      typeExpression: 'any',
      ...(untypedParameter[2] === undefined ? {} : { defaultValue: translateExpression(untypedParameter[2], nameMap, arrayNames, validatedTypeAliases, mapNames) }),
    };
  }

  return null;
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
    return {
      statements: [`void import('${tsImportPathForPythonImport(`${sideEffectImport[1]}${sideEffectImport[2]}`, relativePath)}');`],
      nextIndex: index + 1,
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

    const branchDeclarations = predeclareIfBranchAssignments(lines, index, indent, declaredNames, reassignedNames, nameMap);
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
    const tryFinallyPredeclarations = predeclareTryFinallyAssignments(lines, index, indent, declaredNames, nameMap);
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
          ...tryFinallyPredeclarations,
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

  const enumerateStatement = /^for ([A-Za-z_][A-Za-z0-9_]*), ([A-Za-z_][A-Za-z0-9_]*) in enumerate\((.+)\):$/.exec(statement);
  if (enumerateStatement !== null) {
    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    const branchDeclaredNames = new Set(declaredNames);
    branchDeclaredNames.add(enumerateStatement[1]);
    branchDeclaredNames.add(enumerateStatement[2]);
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
    let assignedRight = maybeAwaitAsyncCall(
      translateExpression(annotatedAssignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames),
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
        `${reassignedNames.has(annotatedAssignment[1]) ? 'let' : 'const'} ${tsName}: ${typeExpression} = ${assignedRight};`,
      ],
      nextIndex: index + 1,
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
      if (callExpression === null) {
        return null;
      }
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
        keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${translateCallArgumentExpression(keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
      }
      nextIndex = logicalArg.nextIndex;
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
    const pathlibWriteBytes = /^(?:Path\((.+)\)|(.+))\.write_bytes\((.+)\)$/.exec(callStatement[1]);
    if (pathlibWriteBytes !== null) {
      return {
        statements: [`writeFileSync(String(${translateExpression(pathlibWriteBytes[1] ?? pathlibWriteBytes[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}), ${translateExpression(pathlibWriteBytes[3], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
        nextIndex: index + 1,
      };
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
  const enumerateIterable = /^enumerate\((.+)\)$/.exec(forClause[2]);
  if (targetNames.length === 2 && enumerateIterable !== null && filterExpression === null) {
    const indexName = tsExportNameForPythonName(targetNames[0]);
    const itemName = tsExportNameForPythonName(targetNames[1]);
    const iterable = iterableExpressionForIteration(enumerateIterable[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return {
      expression: `${iterable}.map((${itemName}, ${indexName}) => ${itemExpression})`,
      nextIndex: closeIndex + 1,
      tupleElements,
    };
  }
  const iterable = targetNames.length > 1 && enumerateIterable !== null
    ? `Array.from(${iterableExpressionForIteration(enumerateIterable[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.entries())`
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

  const msgspecStructsReplace = translateMultilineMsgspecStructsReplace(
    pythonCallee,
    callParts,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (msgspecStructsReplace !== null) {
    return {
      expression: msgspecStructsReplace,
      nextIndex: callParts.nextIndex,
    };
  }
  if (pythonCallee === 'subprocess.check_output') {
    return {
      expression: 'new Uint8Array()',
      nextIndex: callParts.nextIndex,
    };
  }
  if (
    /^[A-Z][A-Za-z0-9_]*(?:Id|Type|Flags)$/.test(pythonCallee)
    && callParts.positionalParts.length === 1
    && callParts.keywordParts.length === 0
  ) {
    return {
      expression: translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames),
      nextIndex: callParts.nextIndex,
    };
  }
  if (pythonCallee === 'msgspec.msgpack.encode' && callParts.positionalParts.length === 1 && callParts.keywordParts.length === 0) {
    return {
      expression: `new MsgpackEncoder().encode(${translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`,
      nextIndex: callParts.nextIndex,
    };
  }
  if (pythonCallee === 'msgspec.msgpack.decode' && callParts.positionalParts.length >= 1) {
    const typeArg = callParts.keywordArgParts.find((part) => part.pythonName === 'type');
    const typeExpression = typeArg === undefined ? 'undefined' : typeArg.expression;
    const typeParameter = typeArg !== undefined && /^[A-Z][A-Za-z0-9_$]*$/.test(typeExpression) ? `<${typeExpression}>` : '';
    return {
      expression: `new MsgpackDecoder${typeParameter}({ type: ${typeExpression} }).decode(${translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`,
      nextIndex: callParts.nextIndex,
    };
  }
  if (pythonCallee === 'str' && callParts.positionalParts.length === 1 && callParts.keywordParts.length === 0) {
    return {
      expression: `String(${callParts.positionalParts[0]})`,
      nextIndex: callParts.nextIndex,
    };
  }
  const stringJoinCallee = /^((?:[fF])?(["'])(?:\\.|(?!\2)[\s\S])*\2)\.join$/.exec(pythonCallee);
  if (stringJoinCallee !== null && callParts.positionalParts.length === 1 && callParts.keywordParts.length === 0) {
    const separator = parsePythonStringExpression(stringJoinCallee[1]);
    if (separator !== null) {
      return {
        expression: `${translateExpression(callParts.positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}.join(${JSON.stringify(separator.content)})`,
        nextIndex: callParts.nextIndex,
      };
    }
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
      part.pythonName === pythonName || tsExportNameForPythonName(part.pythonName) === pythonName
    ));
    if (keywordPart === undefined) {
      break;
    }
    args.push(keywordPart.expression);
    consumedKeywords.add(keywordPart.pythonName);
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
  if (receiverType === undefined) {
    return null;
  }
  return parseFunctionCallSignatureText(
    nameMap.get(instanceMethodSignatureMarker(receiverType, tsAttributeNameForPythonName(dotted[2]))),
  );
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
  const signatureText = nameMap.get(functionSignatureMarker(pythonCallee));
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
        || !parsed.returnTupleMarkers.every((marker) => marker === null || marker === 'array' || marker === 'map' || marker === 'object' || marker === 'rectangle' || marker === 'set' || marker === 'string')
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
        const expression = translateCallArgumentExpression(keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
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
  while (nextIndex < lines.length) {
    const trimmed = splitInlineComment(lines[nextIndex].trim()).code.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    parts.push(trimmed);
    nextIndex += 1;
    if (trimmed === ')' || trimmed === '),' || trimmed.endsWith(',')) {
      break;
    }

    let lookaheadIndex = nextIndex;
    while (lookaheadIndex < lines.length && (lines[lookaheadIndex] ?? '').trim() === '') {
      lookaheadIndex += 1;
    }
    const nextTrimmed = (lines[lookaheadIndex] ?? '').trim();
    if (nextTrimmed === '' || nextTrimmed === ')' || nextTrimmed === '),') {
      break;
    }
    if (!callArgumentLineContinues(trimmed, nextTrimmed)) {
      break;
    }
    nextIndex = lookaheadIndex;
  }
  return { text: parts.join(' ').replace(/\s+/g, ' '), nextIndex };
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
      return {
        expression: `${translateExpression(pythonReceiver, nameMap, arrayNames, validatedTypeAliases, mapNames)}[${translateExpression(indexLines.join(' '), nameMap, arrayNames, validatedTypeAliases, mapNames)}]`,
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
    const tupleType = localTupleDeclarationType(localAssignedRight, pythonRight);
    const reassignedType = reassignedLocalTypeAnnotation(reassignedNames, localAssignment[1]);
    const declarationType = nullableType ?? tupleType ?? reassignedType;
    return {
      statements: [
        `${reassignedNames.has(localAssignment[1]) ? 'let' : 'const'} ${localTsName}${declarationType === null ? '' : `: ${declarationType}`} = ${localAssignedRight};`,
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
    const bindings: string[] = [];
    const postAssignments: string[] = [];
    for (const [targetIndex, rawTarget] of tupleTargets.entries()) {
      const target = rawTarget.trim();
      if (target === '_') {
        bindings.push('');
        continue;
      }
      const localTarget = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(target);
      if (localTarget !== null && !declaredNames.has(localTarget[1])) {
        const tsName = tsExportNameForPythonName(localTarget[1]);
        bindings.push(tsName);
        declaredNames.add(localTarget[1]);
        continue;
      }
      const binding = tupleAssignmentBindingName(target, targetIndex);
      bindings.push(binding);
      postAssignments.push(`${translateExpression(target, nameMap, arrayNames, validatedTypeAliases, mapNames)} = ${binding};`);
      if (localTarget !== null) {
        declaredNames.add(localTarget[1]);
      }
    }
    applyTupleAssignmentReturnMarkers(markerNames, assignedRight, nameMap, arrayNames, mapNames);
    return {
      statements: [
        `const [${bindings.join(', ')}] = ${assignedRight};`,
        ...postAssignments,
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
  return assignedRight.trim().startsWith('{') && assignedRight.trim().endsWith('}')
    ? `new Map(Object.entries(${assignedRight}))`
    : assignedRight;
}

function nullableLocalDeclarationType(
  pythonName: string,
  tsName: string,
  assignedRight: string,
  arrayNames: ReadonlySet<string>,
): string | null {
  if (!arrayNames.has(nullableNameMarker(pythonName)) && !arrayNames.has(nullableNameMarker(tsName))) {
    return null;
  }
  if (translatedExpressionLooksNumber(assignedRight)) {
    return 'number | null';
  }
  return null;
}

function localTupleDeclarationType(assignedRight: string, pythonRight: string | null): string | null {
  if (!pythonExpressionCouldBeTupleLiteral(pythonRight)) {
    return null;
  }
  const length = numericTupleExpressionLength(assignedRight);
  if (length === null) {
    return null;
  }
  return `[${Array.from({ length }, () => 'number').join(', ')}]`;
}

function pythonExpressionCouldBeTupleLiteral(pythonExpression: string | null): boolean {
  return pythonTupleExpressionLength(pythonExpression) !== null;
}

function pythonTupleExpressionLength(pythonExpression: string | null): number | null {
  if (pythonExpression === null) {
    return null;
  }
  const trimmed = pythonExpression.trim();
  if (trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return null;
  }
  if (trimmed.startsWith('(') && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    const length = splitTopLevelComma(trimmed.slice(1, -1)).length;
    return length > 1 ? length : null;
  }
  const length = splitTopLevelComma(trimmed).length;
  if (length > 1) {
    return length;
  }
  const nestedTuple = /\(([^)]*,[^)]*)\)/.exec(trimmed);
  return nestedTuple === null ? null : splitTopLevelComma(nestedTuple[1]).length;
}

function addReassignedLocalType(typesByName: Map<string, string[]>, name: string, type: string | null): void {
  if (type === null) {
    return;
  }
  const types = typesByName.get(name) ?? [];
  if (!types.includes(type)) {
    types.push(type);
  }
  typesByName.set(name, types);
}

function reassignedLocalTypeMarker(name: string, type: string): string {
  return `${reassignedLocalTypePrefix}${name}:${type}`;
}

function reassignedLocalTypeAnnotation(reassignedNames: ReadonlySet<string>, name: string): string | null {
  const prefix = `${reassignedLocalTypePrefix}${name}:`;
  for (const marker of reassignedNames) {
    if (marker.startsWith(prefix)) {
      return marker.slice(prefix.length);
    }
  }
  return null;
}

function inferredReassignedLocalType(
  pythonRight: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
  localTypes: ReadonlyMap<string, string>,
): string | null {
  const translated = translateExpression(pythonRight, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(translated)
    || /^int\(/.test(translated)
    || /^Math\./.test(translated)
    || /^clamp\(/.test(translated)) {
    return 'number';
  }
  if (/^(?:true|false)$/.test(translated)) {
    return 'boolean';
  }
  if (/^(?:'[^']*'|"[^"]*"|`[^`]*`)$/.test(translated) || /^String\(/.test(translated)) {
    return 'string';
  }
  if (translated === 'null') {
    return 'null';
  }
  if (translated.startsWith('[') || translated.startsWith('Array.from(')) {
    return 'unknown[]';
  }
  if (translated.startsWith('new Map(')) {
    return 'Map<unknown, unknown>';
  }
  if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeVector2\(/.test(translated) || /^new Vec2\(/.test(translated)) {
    return 'Vec2';
  }
  if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeRectangle\(/.test(translated)) {
    return 'rl.Rectangle';
  }
  if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeColor\(/.test(translated) || /^new RGBA\(/.test(translated)) {
    return 'rl.Color';
  }
  const localType = localTypes.get(translated);
  if (localType !== undefined) {
    return localType;
  }
  const fieldType = knownDottedFieldType(translated, nameMap);
  if (fieldType === 'number' || fieldType === 'string' || fieldType === 'boolean') {
    return fieldType;
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(translated)) {
    return `typeof ${translated}`;
  }
  const call = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\(/.exec(translated);
  if (call !== null) {
    const returnType = nameMap.get(functionReturnTypeMarker(call[1]));
    if (returnType === 'number' || returnType === 'string' || returnType === 'boolean') {
      return returnType;
    }
  }
  return null;
}

function numericTupleExpressionLength(tsExpression: string): number | null {
  const trimmed = tsExpression.trim();
  const ternary = splitTopLevelTernaryExpression(trimmed);
  if (ternary !== null) {
    const trueLength = numericTupleExpressionLength(ternary.trueExpression);
    const falseLength = numericTupleExpressionLength(ternary.falseExpression);
    return trueLength !== null && trueLength === falseLength ? trueLength : null;
  }
  const arrayLiteral = /^\[([\s\S]*)\]$/.exec(trimmed);
  if (arrayLiteral === null || matchingCloseBracket(trimmed, 0) !== trimmed.length - 1) {
    return null;
  }
  const parts = splitTopLevelComma(arrayLiteral[1]);
  if (parts.length < 2 || parts.some((part) => !translatedExpressionLooksNumber(part))) {
    return null;
  }
  return parts.length;
}

function splitTopLevelTernaryExpression(value: string): { trueExpression: string; falseExpression: string } | null {
  let depth = 0;
  let quote: string | null = null;
  let questionIndex: number | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && !charIsEscaped(value, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
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
    if (char === '?' && depth === 0 && questionIndex === null) {
      questionIndex = index;
      continue;
    }
    if (char === ':' && depth === 0 && questionIndex !== null) {
      return {
        trueExpression: value.slice(questionIndex + 1, index).trim(),
        falseExpression: value.slice(index + 1).trim(),
      };
    }
  }
  return null;
}

function matchingCloseBracket(value: string, openIndex: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && !charIsEscaped(value, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}

function parseTopLevelSubscriptAssignmentTarget(value: string): { receiver: string; key: string } | null {
  const trimmed = value.trim();
  if (!trimmed.endsWith(']')) {
    return null;
  }
  let quote: string | null = null;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let finalOpenIndex: number | null = null;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (quote !== null) {
      if (char === quote && !charIsEscaped(trimmed, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')') {
      parenDepth -= 1;
      continue;
    }
    if (char === '{') {
      braceDepth += 1;
      continue;
    }
    if (char === '}') {
      braceDepth -= 1;
      continue;
    }
    if (char === '[') {
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        finalOpenIndex = index;
      }
      bracketDepth += 1;
      continue;
    }
    if (char === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) {
        return null;
      }
    }
  }
  if (quote !== null || parenDepth !== 0 || braceDepth !== 0 || bracketDepth !== 0 || finalOpenIndex === null) {
    return null;
  }
  if (matchingCloseBracket(trimmed, finalOpenIndex) !== trimmed.length - 1) {
    return null;
  }
  const receiver = trimmed.slice(0, finalOpenIndex).trim();
  const key = trimmed.slice(finalOpenIndex + 1, -1).trim();
  return receiver === '' || key === '' ? null : { receiver, key };
}

function charIsEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function assignedArrayElementType(assignedRight: string, nameMap: Map<string, string>): string | null {
  for (const match of assignedRight.matchAll(/Array\.from\(([^)]+)\)/g)) {
    const elementType = arrayElementTypeFromExpression(match[1], nameMap);
    if (elementType !== null) {
      return elementType;
    }
  }
  return arrayElementTypeFromExpression(assignedRight, nameMap);
}

function arrayElementTypeFromExpression(expression: string, nameMap: Map<string, string>): string | null {
  const fieldType = knownDottedFieldType(expression.trim(), nameMap);
  return fieldType === null ? null : arrayElementTypeFromTypeExpression(fieldType);
}

function knownDottedFieldType(expression: string, nameMap: Map<string, string>): string | null {
  const dotted = /^(.+)\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(expression);
  if (dotted === null) {
    return null;
  }
  const receiverType = nameMap.get(receiverTypeNameMarker(dotted[1])) ?? knownDottedFieldType(dotted[1], nameMap);
  return receiverType == null ? null : nameMap.get(classFieldTypeMarker(receiverType, dotted[2])) ?? null;
}

function arrayElementTypeFromTypeExpression(typeExpression: string): string | null {
  const trimmed = typeExpression.trim();
  const mutableArray = /^(.+)\[\]$/.exec(trimmed);
  if (mutableArray !== null) {
    return mutableArray[1].trim();
  }
  const readonlyArray = /^readonly (.+)\[\]$/.exec(trimmed);
  if (readonlyArray !== null) {
    return readonlyArray[1].trim();
  }
  const readonlyGeneric = /^ReadonlyArray<(.+)>$/.exec(trimmed);
  return readonlyGeneric?.[1]?.trim() ?? null;
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
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  mapNames: ReadonlySet<string>,
): void {
  if (arrayNames.has(assignedRight)) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
  }
  for (const marker of [
    colorNameMarker,
    booleanNameMarker,
    dateNameMarker,
    nullableNameMarker,
    numberNameMarker,
    objectNameMarker,
    pathNameMarker,
    pathArrayNameMarker,
    pythonMappingNameMarker,
    rectangleNameMarker,
    setNameMarker,
    stringNameMarker,
    tupleElementArrayNameMarker,
    vectorArrayNameMarker,
    vectorNameMarker,
  ]) {
    if (arrayNames.has(marker(assignedRight))) {
      arrayNames.add(marker(pythonName));
      arrayNames.add(marker(tsName));
    }
  }
  if (mapNames.has(assignedRight)) {
    addMutableName(mapNames, pythonName);
    addMutableName(mapNames, tsName);
  }
  if (/^[A-Za-z_$][A-Za-z0-9_.$]*(?:creatures|pickups|players)$/.test(assignedRight)) {
    arrayNames.add(pythonName);
  }
  const isArrayFromBooleanChain = /^Array\.from\(/.test(assignedRight) && /\)\.(?:every|some)\(/.test(assignedRight);
  if (/^Array\.from\(/.test(assignedRight) && !isArrayFromBooleanChain) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
  }
  const arrayElementType = assignedArrayElementType(assignedRight, nameMap);
  if (arrayElementType !== null) {
    nameMap.set(arrayElementTypeMarker(pythonName), arrayElementType);
    nameMap.set(arrayElementTypeMarker(tsName), arrayElementType);
  }
  if (assignedRight.startsWith('[') || (assignedRight.startsWith('Array.from(') && !isArrayFromBooleanChain) || /^[A-Za-z_$][A-Za-z0-9_.$()]+\.(?:filter|map)\(/.test(assignedRight)) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
  }
  if (assignedRight.startsWith('_pathJoin(')) {
    arrayNames.add(pathNameMarker(pythonName));
    arrayNames.add(pathNameMarker(tsName));
  }
  if (assignedRight === '{}' || assignedRight.startsWith('{ ...')) {
    arrayNames.add(objectNameMarker(pythonName));
    arrayNames.add(objectNameMarker(tsName));
  }
  if (/\bas PythonMapping\)?$/.test(assignedRight)) {
    arrayNames.add(pythonMappingNameMarker(pythonName));
    arrayNames.add(pythonMappingNameMarker(tsName));
  }
  if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeRectangle\(/.test(assignedRight)) {
    arrayNames.add(rectangleNameMarker(pythonName));
    arrayNames.add(rectangleNameMarker(tsName));
  }
  if (/^(?:'[^']*'|"[^"]*"|`[^`]*`)$/.test(assignedRight)) {
    arrayNames.add(stringNameMarker(pythonName));
    arrayNames.add(stringNameMarker(tsName));
  }
  if (/\.trim\(\)$/.test(assignedRight)) {
    arrayNames.add(stringNameMarker(pythonName));
    arrayNames.add(stringNameMarker(tsName));
  }
  if (assignedRight.startsWith('new Map(')) {
    addMutableName(mapNames, pythonName);
    addMutableName(mapNames, tsName);
  }
  const mapGetAssignment = /^([A-Za-z_$][A-Za-z0-9_.$]*)\.get\(.*\)!?(?: \?\? null)?$/.exec(assignedRight);
  const mapDefaultAssignment = /^([A-Za-z_$][A-Za-z0-9_.$]*)\.get\(.*\) \?\? new Map(?:<[^)]*>)?\(\)$/.exec(assignedRight);
  const mapGetOrInitMapAssignment = /^mapGetOrInit\([A-Za-z_$][A-Za-z0-9_.$]*, .+, \(\) => new Map(?:<[^)]*>)?\(\)\)$/.exec(assignedRight);
  if (mapDefaultAssignment !== null || mapGetOrInitMapAssignment !== null) {
    addMutableName(mapNames, pythonName);
    addMutableName(mapNames, tsName);
  }
  if (/^[A-Za-z_$][A-Za-z0-9_.$]*\.get\(.*\)!$/.test(assignedRight) && !expressionIsKnownMap(assignedRight, nameMap, mapNames)) {
    arrayNames.add(objectNameMarker(pythonName));
    arrayNames.add(objectNameMarker(tsName));
  }
  if (mapGetAssignment !== null && mapNames.has(arrayValueMapNameMarker(mapGetAssignment[1]))) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
    if (assignedRight.endsWith(' ?? null')) {
      arrayNames.add(nullableNameMarker(pythonName));
      arrayNames.add(nullableNameMarker(tsName));
    }
  }
  if (mapGetAssignment !== null && mapNames.has(mapValueMapNameMarker(mapGetAssignment[1]))) {
    addMutableName(mapNames, pythonName);
    addMutableName(mapNames, tsName);
  }
  const subscriptAssignment = /^([A-Za-z_$][A-Za-z0-9_.$]*)\[.+\]$/.exec(assignedRight);
  if (subscriptAssignment !== null && arrayNames.has(tupleElementArrayNameMarker(subscriptAssignment[1]))) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
  }
  const callAssignment = /^(?:await )?([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\(/.exec(assignedRight);
  if (callAssignment !== null) {
    const returnType = nameMap.get(functionReturnTypeMarker(callAssignment[1]));
    if (returnType?.endsWith('[]') === true || returnType?.startsWith('readonly ') === true && returnType.endsWith('[]')) {
      arrayNames.add(pythonName);
      arrayNames.add(tsName);
    }
  }
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
  if (translatedExpressionLooksNumber(assignedRight)) {
    arrayNames.add(numberNameMarker(pythonName));
    arrayNames.add(numberNameMarker(tsName));
  }
  if (translatedExpressionLooksBoolean(assignedRight)) {
    arrayNames.add(booleanNameMarker(pythonName));
    arrayNames.add(booleanNameMarker(tsName));
  }
  if (translatedExpressionLooksVector(assignedRight)) {
    arrayNames.add(vectorNameMarker(pythonName));
    arrayNames.add(vectorNameMarker(tsName));
  }
  if (callAssignment !== null && nameMap.get(functionReturnTypeMarker(callAssignment[1])) === 'Vec2') {
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

function translatedExpressionLooksNumber(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return true;
  }
  if (/^(?:int|f32|Math\.[A-Za-z_$][A-Za-z0-9_$]*)\(/.test(trimmed)) {
    return true;
  }
  if (
    !translatedExpressionLooksVector(trimmed)
    && !/["'`]/.test(trimmed)
    && / [+\-*/%] /.test(trimmed)
  ) {
    return true;
  }
  return false;
}

function translatedExpressionLooksBoolean(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  if (trimmed.includes(' ? ')
    || trimmed.includes('=>')
    || trimmed.includes(' || ')
    || trimmed.includes(' + ')
    || trimmed.includes(' - ')
    || trimmed.includes(' * ')
    || trimmed.includes(' / ')
    || trimmed.includes(' % ')
    || trimmed.includes(',')) {
    return false;
  }
  return trimmed === 'true'
    || trimmed === 'false'
    || /^!/.test(trimmed)
    || /(?:===|!==|<=|>=|<|>|&&|\|\||\binstanceof\b)/.test(trimmed)
    || /^typeof\b/.test(trimmed)
    || /^(?:Array\.isArray|Number\.is(?:Finite|Integer|NaN))\(/.test(trimmed)
    || /\.(?:every|has|includes|some|startsWith|endsWith)\(/.test(trimmed);
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
    ? defaultExpression === null ? `${mapName}.get(${key})!` : `${mapName}.get(${key}) ?? ${defaultExpression}`
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

function parseZipLoopSources(iterableText: string): string[] | null {
  const zipCall = /^zip\((.+)\)$/.exec(iterableText.trim());
  if (zipCall === null) {
    return null;
  }
  const parts = splitTopLevelComma(zipCall[1]);
  const strictArgument = /^strict\s*=\s*(True|False)$/.exec(parts.at(-1)?.trim() ?? '');
  if (strictArgument !== null) {
    if (strictArgument[1] !== 'False') {
      return null;
    }
    parts.pop();
  }
  return parts.length === 0 ? null : parts;
}

function exceptBlocksHaveSameBody(blocks: Array<{ statements: string[] }>): boolean {
  if (blocks.length <= 1) {
    return true;
  }
  const [first, ...rest] = blocks;
  const firstText = first.statements.join('\n');
  return rest.every((block) => block.statements.join('\n') === firstText);
}

function pythonListTypeIsNumeric(pythonType: string): boolean {
  return /^list\[(?:int|float)\]$/.test(pythonType.trim());
}

function pythonMapTypeArgs(pythonType: string): string[] | null {
  const mapType = /^(?:dict|OrderedDict|defaultdict)\[(.+)\]$/.exec(pythonType.trim());
  if (mapType !== null) {
    return splitTopLevelComma(mapType[1]);
  }
  const counterType = /^Counter\[(.+)\]$/.exec(pythonType.trim());
  return counterType === null ? null : [counterType[1], 'int'];
}

function pythonMapTypeHasTupleKey(pythonType: string): boolean {
  return pythonMapTypeArgs(pythonType)?.[0]?.trim().startsWith('tuple[') === true;
}

function pythonMapValueIsList(pythonType: string): boolean {
  return pythonMapTypeArgs(pythonType)?.[1]?.trim().startsWith('list[') === true;
}

function pythonMapValueIsMap(pythonType: string): boolean {
  return pythonMapTypeArgs(pythonType)?.[1]?.trim().startsWith('dict[') === true;
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
  return /^(?:load[A-Z][A-Za-z0-9_]*|initAudioState)\(.*\)$/.test(tsExpression) ? `await ${tsExpression}` : tsExpression;
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
