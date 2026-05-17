import type {
  FunctionParameter,
  OptionalFunctionParameter,
  SimpleFunctionParameter,
} from '../model.js';
import { tsExportNameForPythonName, tsTypeExpression } from '../naming.js';
import { splitTopLevelComma } from './common.js';
import {
  colorNameMarker,
  booleanNameMarker,
  dateNameMarker,
  numberNameMarker,
  objectNameMarker,
  nullableNameMarker,
  pathNameMarker,
  rectangleNameMarker,
  stringNameMarker,
  translateExpression,
  vectorNameMarker,
} from './expression.js';

export function parseFunctionParametersText(
  parametersText: string,
  arrayNames: Set<string>,
): { parameters: FunctionParameter[]; optsParams: OptionalFunctionParameter[] } | null {
  const parameters: FunctionParameter[] = [];
  const optsParams: OptionalFunctionParameter[] = [];
  let keywordOnly = false;
  if (parametersText !== '') {
    for (const parameterText of splitTopLevelComma(parametersText)) {
      if (parameterText === '*') {
        keywordOnly = true;
        continue;
      }
      const parameter = parseFunctionParameterText(parameterText, arrayNames);
      if (parameter === null) {
        return null;
      }
      if (keywordOnly) {
        optsParams.push({
          name: parameter.name,
          typeExpression: parameter.typeExpression,
          defaultValue: parameter.defaultValue === undefined ? null : parameter.defaultValue,
        });
      } else {
        parameters.push(parameter);
      }
    }
  }
  return { parameters, optsParams };
}

export function parseFunctionParameterText(
  parameterText: string,
  arrayNames: Set<string>,
): FunctionParameter | null {
  const kwargsParameter = /^\*\*([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(parameterText);
  if (kwargsParameter !== null) {
    const parameterName = tsParameterNameForPythonName(kwargsParameter[1]);
    arrayNames.add(objectNameMarker(kwargsParameter[1]));
    arrayNames.add(objectNameMarker(parameterName));
    return {
      name: parameterName,
      typeExpression: `Record<string, ${tsTypeExpression(kwargsParameter[2])}>`,
      defaultValue: '{}',
    };
  }

  const typedParameter = /^([A-Za-z_][A-Za-z0-9_]*): ([^=]+?)(?: = (.+))?$/.exec(parameterText);
  if (typedParameter !== null) {
    const typeExpression = tsParameterTypeExpression(typedParameter[2]);
    const parameterName = tsParameterNameForPythonName(typedParameter[1]);
    if (typeExpressionIncludesArray(typeExpression)) {
      arrayNames.add(typedParameter[1]);
      arrayNames.add(parameterName);
    }
    if (typeExpressionIncludesNull(typeExpression)) {
      arrayNames.add(nullableNameMarker(typedParameter[1]));
      arrayNames.add(nullableNameMarker(parameterName));
    }
    if (typeExpression === 'string') {
      arrayNames.add(stringNameMarker(typedParameter[1]));
      arrayNames.add(stringNameMarker(parameterName));
    }
    if (typeExpression === 'number') {
      arrayNames.add(numberNameMarker(typedParameter[1]));
      arrayNames.add(numberNameMarker(parameterName));
    }
    if (typeExpression === 'boolean') {
      arrayNames.add(booleanNameMarker(typedParameter[1]));
      arrayNames.add(booleanNameMarker(parameterName));
    }
    if (typedParameter[2].trim() === 'Path') {
      arrayNames.add(pathNameMarker(typedParameter[1]));
      arrayNames.add(pathNameMarker(parameterName));
    }
    if (/^(?:r[dl]|wgl)\.Color$/.test(typeExpression)) {
      arrayNames.add(colorNameMarker(typedParameter[1]));
      arrayNames.add(colorNameMarker(parameterName));
    }
    if (typeExpression.split('|').some((part) => /^(?:r[dl]|wgl)\.Rectangle$/.test(part.trim()))) {
      arrayNames.add(rectangleNameMarker(typedParameter[1]));
      arrayNames.add(rectangleNameMarker(parameterName));
    }
    if (typeExpression === 'Vec2') {
      arrayNames.add(vectorNameMarker(typedParameter[1]));
      arrayNames.add(vectorNameMarker(parameterName));
    }
    if (typeExpression === 'Date') {
      arrayNames.add(dateNameMarker(typedParameter[1]));
      arrayNames.add(dateNameMarker(parameterName));
    }
    if (typeExpression.startsWith('Record<')) {
      arrayNames.add(objectNameMarker(typedParameter[1]));
      arrayNames.add(objectNameMarker(parameterName));
    }
    return {
      name: parameterName,
      typeExpression,
      ...(typedParameter[3] === undefined ? {} : { defaultValue: translateExpression(typedParameter[3], undefined, arrayNames) }),
    };
  }

  const untypedParameter = /^([A-Za-z_][A-Za-z0-9_]*)(?: = (.+))?$/.exec(parameterText);
  if (untypedParameter !== null) {
    return {
      name: tsParameterNameForPythonName(untypedParameter[1]),
      typeExpression: 'any',
      ...(untypedParameter[2] === undefined ? {} : { defaultValue: translateExpression(untypedParameter[2], undefined, arrayNames) }),
    };
  }

  return null;
}

export function recordParameterNameBindings(
  nameMap: Map<string, string>,
  parametersText: string,
  parameters: readonly FunctionParameter[],
): void {
  const pythonNames = pythonParameterNames(parametersText);
  for (let index = 0; index < Math.min(pythonNames.length, parameters.length); index += 1) {
    if (parameters[index].name !== tsExportNameForPythonName(pythonNames[index])) {
      nameMap.set(pythonNames[index], parameters[index].name);
    }
  }
}

function tsParameterTypeExpression(pythonType: string): string {
  const optionalStringDict = optionalStringKeyDictParameterType(pythonType);
  return optionalStringDict ?? tsTypeExpression(pythonType);
}

function optionalStringKeyDictParameterType(pythonType: string): string | null {
  const parts = splitTopLevelTypeUnion(pythonType.trim());
  if (!parts.some((part) => part.trim() === 'None')) {
    return null;
  }
  const nonNoneParts = parts.filter((part) => part.trim() !== 'None');
  if (nonNoneParts.length !== 1) {
    return null;
  }
  const dictArgs = parseGenericTypeArgs(nonNoneParts[0].trim(), 'dict');
  if (dictArgs === null || dictArgs.length !== 2 || dictArgs[0].trim() !== 'str') {
    return null;
  }
  return `Record<string, ${tsTypeExpression(dictArgs[1])}> | null`;
}

function parseGenericTypeArgs(typeText: string, typeName: string): string[] | null {
  const prefix = `${typeName}[`;
  if (!typeText.startsWith(prefix) || !typeText.endsWith(']')) {
    return null;
  }
  return splitTopLevelComma(typeText.slice(prefix.length, -1));
}

function splitTopLevelTypeUnion(typeExpression: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < typeExpression.length; index += 1) {
    const char = typeExpression[index];
    if (char === '[' || char === '(' || char === '{' || char === '<') {
      depth += 1;
      continue;
    }
    if (char === ']' || char === ')' || char === '}' || char === '>') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === '|' && depth === 0) {
      parts.push(typeExpression.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(typeExpression.slice(start).trim());
  return parts;
}

function typeExpressionIncludesArray(typeExpression: string): boolean {
  return typeExpression
    .split(' | ')
    .some((part) => part.trim().endsWith('[]'));
}

function typeExpressionIncludesNull(typeExpression: string): boolean {
  return typeExpression
    .split(' | ')
    .some((part) => part.trim() === 'null');
}

export function pythonParameterNames(parametersText: string): string[] {
  if (parametersText === '') {
    return [];
  }
  const names: string[] = [];
  for (const parameterText of splitTopLevelComma(parametersText)) {
    if (parameterText === '*') {
      continue;
    }
    const parameter = /^([A-Za-z_][A-Za-z0-9_]*)(?:: |(?: = .+)?$)/.exec(parameterText);
    if (parameter !== null) {
      names.push(parameter[1]);
    }
  }
  return names;
}

function tsParameterNameForPythonName(pythonName: string): string {
  const name = tsExportNameForPythonName(pythonName);
  return isReservedTsBindingName(name) ? `_${name}` : name;
}

function isReservedTsBindingName(name: string): boolean {
  return new Set([
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'new',
    'null',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'let',
    'static',
    'implements',
    'interface',
    'package',
    'private',
    'protected',
    'public',
  ]).has(name);
}
export function tsSimpleExpression(pythonExpression: string, parameters: SimpleFunctionParameter[]): string | null {
  const stringParameterNames = new Set(
    parameters
      .filter((parameter) => parameter.typeExpression === 'string')
      .map((parameter) => parameter.name),
  );
  let expression = pythonExpression
    .replaceAll(/\b(?:float|str|bool)\(([^()]*)\)/g, '$1')
    .replaceAll(/\blen\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, (_match, name: string) => (
      stringParameterNames.has(tsExportNameForPythonName(name)) ? `Array.from(${name}).length` : `${name}.length`
    ))
    .replaceAll(/\bmath\.pi\b/g, 'Math.PI')
    .replaceAll(/\bmin\(/g, 'Math.min(')
    .replaceAll(/\bmax\(/g, 'Math.max(')
    .replaceAll(/\babs\(/g, 'Math.abs(');
  expression = expression.replaceAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (name) => tsExportNameForPythonName(name));
  const emittedParameterNames = new Set(parameters.map((parameter) => parameter.ignored ? `_${parameter.name}` : parameter.name));
  for (const parameter of parameters) {
    if (!parameter.ignored) {
      continue;
    }
    expression = expression.replaceAll(new RegExp(`\\b${parameter.name}\\b`, 'g'), `_${parameter.name}`);
  }

  const firstIdentifier = /\b[A-Za-z_][A-Za-z0-9_]*\b/.exec(expression)?.[0] ?? null;
  return firstIdentifier === null || firstIdentifier === 'Array' || emittedParameterNames.has(firstIdentifier) || /^[A-Z0-9_]+$/.test(firstIdentifier)
    ? expression
    : null;
}
