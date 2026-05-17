import type { FunctionParameter } from '../../model.js';
import { tsExportNameForPythonName, tsTypeExpression } from '../../naming.js';
import {
  indentStatementLine,
  isIndentedBlockLine,
  parseIndentedFunctionHeader,
  splitTopLevelComma,
} from '../common.js';
import { functionReturnTypeMarker, translateExpression } from '../expression.js';
import { tsFunctionReturnTypeExpression } from '../function-headers.js';
import {
  parseFunctionParametersText,
  pythonParameterNames,
  recordParameterNameBindings,
} from '../parameters.js';
import { addReassignedLocalTypeAnnotations } from './local-declarations.js';
import {
  tsLocalFunctionNameForPythonName,
  tsLocalNameForPythonParameter,
} from './names.js';
import { reassignedLocalNames } from './reassigned-locals.js';

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
) => StatementTranslationResult | null;

export function parseNestedFunctionStatement(
  lines: string[],
  index: number,
  indent: string,
  outerNameMap: Map<string, string>,
  outerDeclaredNames: Set<string>,
  outerArrayNames: ReadonlySet<string>,
  validatedTypeAliases: ReadonlySet<string>,
  relativePath: string | null,
  mapNames: ReadonlySet<string>,
  translateStatement: StatementTranslator,
): StatementTranslationResult | null {
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
  const alreadyDeclared = outerDeclaredNames.has(header.name);
  outerDeclaredNames.add(header.name);
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
    const statement = translateStatement(
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
  const prologue = parsedParams.prologue.map((line) => nestedParameterPrologueDeclaration(line, parsedParams.nameBindings, reassignedNames, statements));
  return {
    statements: [
      `${alreadyDeclared ? functionName : `const ${functionName}`} = ${async ? 'async ' : ''}(${parsedParams.params.join(', ')}): ${async ? `Promise<${returnType}>` : returnType} => {`,
      ...[...prologue, ...statements].map(indentStatementLine),
      '};',
    ],
    nextIndex,
  };
}

function nestedParameterPrologueDeclaration(
  line: string,
  nameBindings: ReadonlyMap<string, string>,
  reassignedNames: ReadonlySet<string>,
  statements: readonly string[],
): string {
  const declaration = /^const ([A-Za-z_$][A-Za-z0-9_$]*) = /.exec(line);
  if (declaration === null) {
    return line;
  }
  for (const [pythonName, tsName] of nameBindings) {
    if (tsName === declaration[1] && (reassignedNames.has(pythonName) || functionBodyAssignsName(statements, tsName))) {
      return line.replace(/^const /, 'let ');
    }
  }
  if (reassignedNames.has(declaration[1]) || functionBodyAssignsName(statements, declaration[1])) {
    return line.replace(/^const /, 'let ');
  }
  return line;
}

function functionBodyAssignsName(statements: readonly string[], name: string): boolean {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedName} (?:\\+=|-=|\\*=|/=|=) `);
  const destructuringPattern = new RegExp(`^\\[[^\\]]*\\b${escapedName}\\b[^\\]]*\\] = `);
  return statements.some((statement) => {
    const trimmed = statement.trim();
    return pattern.test(trimmed) || destructuringPattern.test(trimmed);
  });
}

function nonlocalNames(lines: string[], startIndex: number, indent: string): Set<string> {
  const names = new Set<string>();
  let index = startIndex;
  while (index < lines.length && isIndentedBlockLine(lines, index, indent)) {
    const rest = lines[index].slice(indent.length);
    if (rest.startsWith(' ')) {
      index += 1;
      continue;
    }
    const statement = rest.trim();
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
    const nameBindings = new Map<string, string>();
    recordParameterNameBindings(nameBindings, parametersText, [...parsedParams.parameters, ...parsedParams.optsParams]);
    return {
      params,
      prologue,
      declaredNames: new Set<string>(pythonParameterNames(parametersText)),
      nameBindings,
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
