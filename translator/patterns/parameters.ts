import type {
  FunctionParameter,
  OptionalFunctionParameter,
  SimpleFunctionParameter,
} from '../model.js';
import { tsExportNameForPythonName, tsTypeExpression } from '../naming.js';
import { splitTopLevelComma } from './common.js';
import { colorNameMarker, dateNameMarker, stringNameMarker, translateExpression, vectorNameMarker } from './expression.js';

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
  const typedParameter = /^([A-Za-z_][A-Za-z0-9_]*): ([^=]+?)(?: = (.+))?$/.exec(parameterText);
  if (typedParameter !== null) {
    const typeExpression = tsTypeExpression(typedParameter[2]);
    if (typeExpression.endsWith('[]')) {
      arrayNames.add(typedParameter[1]);
    }
    if (typeExpression === 'string') {
      const parameterName = tsExportNameForPythonName(typedParameter[1]);
      arrayNames.add(stringNameMarker(typedParameter[1]));
      arrayNames.add(stringNameMarker(parameterName));
    }
    if (typeExpression === 'rl.Color' || typeExpression === 'wgl.Color') {
      const parameterName = tsExportNameForPythonName(typedParameter[1]);
      arrayNames.add(colorNameMarker(typedParameter[1]));
      arrayNames.add(colorNameMarker(parameterName));
    }
    if (typeExpression === 'Vec2') {
      const parameterName = tsExportNameForPythonName(typedParameter[1]);
      arrayNames.add(vectorNameMarker(typedParameter[1]));
      arrayNames.add(vectorNameMarker(parameterName));
    }
    if (typeExpression === 'Date') {
      const parameterName = tsExportNameForPythonName(typedParameter[1]);
      arrayNames.add(dateNameMarker(typedParameter[1]));
      arrayNames.add(dateNameMarker(parameterName));
    }
    return {
      name: tsExportNameForPythonName(typedParameter[1]),
      typeExpression,
      ...(typedParameter[3] === undefined ? {} : { defaultValue: translateExpression(typedParameter[3], undefined, arrayNames) }),
    };
  }

  const untypedParameter = /^([A-Za-z_][A-Za-z0-9_]*)(?: = (.+))?$/.exec(parameterText);
  if (untypedParameter !== null) {
    return {
      name: tsExportNameForPythonName(untypedParameter[1]),
      typeExpression: 'any',
      ...(untypedParameter[2] === undefined ? {} : { defaultValue: translateExpression(untypedParameter[2], undefined, arrayNames) }),
    };
  }

  return null;
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
