import type {
  PlainClassDefinition,
  SimpleModuleFunction,
} from '../model.js';
import { tsExportNameForPythonName, tsTypeExpression } from '../naming.js';
import {
  inferPythonExpressionType,
  isIndentedBlockLine,
  parseIndentedDocstring,
  parseIndentedFunctionHeader,
  splitTopLevelComma,
} from './common.js';
import { translateExpression } from './expression.js';
import { parseFunctionParametersText, pythonParameterNames } from './parameters.js';
import {
  reassignedLocalNames,
  translateStraightLineStatement,
} from './statements.js';

function tsAttributeNameForPythonName(pythonName: string): string {
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
}

export function parsePlainClass(
  lines: string[],
  index: number,
  moduleNameMap: ReadonlyMap<string, string> = new Map(),
): { plainClass: PlainClassDefinition; nextIndex: number } | null {
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)(?:\(([A-Za-z_][A-Za-z0-9_]*)\))?:$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }
  const extendsName = header[2] === undefined
    ? undefined
    : moduleNameMap.get(header[2]) ?? tsExportNameForPythonName(header[2]);
  const className = tsExportNameForPythonName(header[1]);

  let nextIndex = index + 1;
  const docstring = parseIndentedDocstring(lines, nextIndex);
  if (docstring !== null) {
    nextIndex = docstring.nextIndex;
  }
  while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
    nextIndex += 1;
  }

  const parsedConstructorHeader = parseIndentedFunctionHeader(lines, nextIndex, '    ');
  const constructorHeader = parsedConstructorHeader?.name === '__init__' ? parsedConstructorHeader : null;
  const constructorParametersText = constructorHeader?.parametersText ?? 'self';
  if (constructorParametersText !== 'self' && !constructorParametersText.startsWith('self, ')) {
    return null;
  }

  const constructorArrayNames = new Set<string>();
  const constructorParams = parseFunctionParametersText(
    constructorParametersText === 'self' ? '' : constructorParametersText.slice('self, '.length),
    constructorArrayNames,
  );
  if (constructorParams === null) {
    return null;
  }

  const fieldTypes = new Map<string, string>();
  for (const parameter of [...constructorParams.parameters, ...constructorParams.optsParams]) {
    fieldTypes.set(parameter.name, parameter.typeExpression);
  }
  const fieldMap = new Map<string, PlainClassDefinition['fields'][number]>();
  const fieldNameMap = new Map<string, string>();
  const fieldArrayNames = new Set<string>();
  const constructorStatements: string[] = [];
  const constructorNameMap = new Map<string, string>([...moduleNameMap, ['self', 'this']]);
  for (const parameter of constructorParams.optsParams) {
    constructorNameMap.set(parameter.name, parameter.name);
  }
  let bodyIndex = constructorHeader?.nextIndex ?? nextIndex;
  if (constructorHeader !== null) {
    while (bodyIndex < lines.length && isIndentedBlockLine(lines, bodyIndex, '        ')) {
      if (lines[bodyIndex].trim() === '') {
        constructorStatements.push('');
        bodyIndex += 1;
        continue;
      }
      const statement = lines[bodyIndex].slice('        '.length);
      const annotatedFieldAssignment = /^self\.([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(statement);
      const fieldAssignment = /^self\.([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(statement);
      const assignment = annotatedFieldAssignment ?? fieldAssignment;
      if (assignment !== null) {
        const pythonFieldName = assignment[1];
        const fieldName = tsAttributeNameForPythonName(pythonFieldName);
        fieldNameMap.set(pythonFieldName, fieldName);
        constructorNameMap.set(pythonFieldName, fieldName);
        const valueText = annotatedFieldAssignment === null ? assignment[2] : assignment[3];
        const value = translateExpression(valueText, constructorNameMap, constructorArrayNames);
        const typeExpression = annotatedFieldAssignment === null
          ? inferPlainClassFieldType(valueText, fieldTypes)
          : tsTypeExpression(assignment[2]);
        if (typeExpression === null) {
          return null;
        }
        if (typeExpression.trim().endsWith('[]')) {
          fieldArrayNames.add(`self.${pythonFieldName}`);
          fieldArrayNames.add(`this.${fieldName}`);
        }
        fieldMap.set(fieldName, {
          name: fieldName,
          typeExpression,
          readonly: true,
          private: pythonFieldName.startsWith('_'),
        });
        constructorStatements.push(`this.${fieldName} = ${value};`);
        bodyIndex += 1;
        continue;
      }
      const translated = translateStraightLineStatement(
        lines,
        bodyIndex,
        '        ',
        constructorNameMap,
        new Set(),
        new Set(),
        constructorArrayNames,
      );
      if (translated === null) {
        return null;
      }
      constructorStatements.push(...translated.statements);
      bodyIndex = translated.nextIndex;
    }
  }

  const methods: SimpleModuleFunction[] = [];
  const staticMethodNames = new Set<string>();
  nextIndex = bodyIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!lines[nextIndex].startsWith('    ')) {
      break;
    }
    if (trimmed === '@property') {
      const propertyMethod = parsePlainClassMethod(lines, nextIndex + 1, fieldNameMap, moduleNameMap, false, fieldArrayNames);
      if (propertyMethod === null || propertyMethod.method.parameters.length > 0 || propertyMethod.method.optsParams.length > 0) {
        return null;
      }
      methods.push({
        ...propertyMethod.method,
        name: `get ${propertyMethod.method.name}`,
      });
      nextIndex = propertyMethod.nextIndex;
      continue;
    }
    if (trimmed === '@staticmethod') {
      const staticMethod = parsePlainClassMethod(lines, nextIndex + 1, fieldNameMap, moduleNameMap, true, fieldArrayNames);
      if (staticMethod === null) {
        return null;
      }
      methods.push(staticMethod.method);
      staticMethodNames.add(staticMethod.method.name);
      nextIndex = staticMethod.nextIndex;
      continue;
    }
    if (trimmed === '@classmethod') {
      const classMethod = parsePlainClassMethod(lines, nextIndex + 1, fieldNameMap, moduleNameMap, true, fieldArrayNames, className);
      if (classMethod === null) {
        return null;
      }
      methods.push(classMethod.method);
      staticMethodNames.add(classMethod.method.name);
      nextIndex = classMethod.nextIndex;
      continue;
    }
    const method = parsePlainClassMethod(lines, nextIndex, fieldNameMap, moduleNameMap, false, fieldArrayNames);
    if (method === null) {
      return null;
    }
    methods.push(method.method);
    nextIndex = method.nextIndex;
  }

  const mutableFields = new Set<string>();
  for (const method of methods) {
    for (const statement of method.statements) {
      const assignment = /this\.([A-Za-z_][A-Za-z0-9_]*) (?:\+=|-=|\*=|\/=|=)|this\.([A-Za-z_][A-Za-z0-9_]*)(?:\+\+|--)/.exec(statement);
      if (assignment !== null) {
        mutableFields.add(assignment[1] ?? assignment[2]);
      }
    }
  }
  const fields = [...fieldMap.values()].map((field) => ({
    ...field,
    readonly: !mutableFields.has(field.name),
  }));
  const rewrittenMethods = methods.map((method) => (
    method.static === true
      ? method
      : {
        ...method,
        statements: rewritePlainClassStaticMethodCalls(method.statements, className, staticMethodNames),
      }
  ));

  return {
    plainClass: {
      name: className,
      ...(extendsName === undefined ? {} : { extendsName }),
      docstring: docstring?.value ?? null,
      fields,
      constructorDefinition: {
        parameters: constructorParams.parameters,
        optsParams: constructorParams.optsParams,
        statements: constructorStatements,
      },
      methods: rewrittenMethods,
    },
    nextIndex,
  };
}

function rewritePlainClassStaticMethodCalls(
  statements: string[],
  className: string,
  staticMethodNames: ReadonlySet<string>,
): string[] {
  if (staticMethodNames.size === 0) {
    return statements;
  }
  return statements.map((statement) => {
    let rewritten = statement;
    for (const methodName of staticMethodNames) {
      const pattern = new RegExp(`\\bthis\\.${escapeRegExp(methodName)}\\(`, 'g');
      rewritten = rewritten.replace(pattern, `${className}.${methodName}(`);
    }
    return rewritten;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferPlainClassFieldType(valueText: string, fieldTypes: ReadonlyMap<string, string>): string | null {
  if (/^Path\([A-Za-z_][A-Za-z0-9_]*\)$/.test(valueText)) {
    return 'string';
  }
  const nonNoneDefault = /^([A-Za-z_][A-Za-z0-9_]*) if \1 is not None else ([A-Z][A-Za-z0-9_]*)\(\)$/.exec(valueText.trim());
  if (nonNoneDefault !== null) {
    const directType = fieldTypes.get(tsExportNameForPythonName(nonNoneDefault[1]));
    return directType === undefined
      ? tsExportNameForPythonName(nonNoneDefault[2])
      : directType
        .split(' | ')
        .filter((part) => part !== 'null' && part !== 'undefined')
        .join(' | ');
  }
  if (/^-?\d+(?:\.\d+)?(?:\s*[+\-*/]\s*(?:-?\d+(?:\.\d+)?|(?:int|float)\(.+\)|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?))*$/.test(valueText.trim())) {
    return 'number';
  }
  if (/^(?:max|min)\(/.test(valueText.trim())) {
    return 'number';
  }
  const directParameterType = fieldTypes.get(tsExportNameForPythonName(valueText));
  if (directParameterType !== undefined) {
    return directParameterType;
  }
  const literalType = inferPythonExpressionType(valueText);
  return literalType === 'any' ? null : literalType;
}

function parsePlainClassMethod(
  lines: string[],
  index: number,
  fieldNameMap: Map<string, string>,
  moduleNameMap: ReadonlyMap<string, string>,
  staticMethod = false,
  initialArrayNames: ReadonlySet<string> = new Set(),
  classBindingName: string | null = null,
): { method: SimpleModuleFunction; nextIndex: number } | null {
  const header = parseIndentedFunctionHeader(lines, index, '    ');
  if (header === null || header.name === '__init__') {
    return null;
  }
  const parametersText = header.parametersText;
  if (classBindingName === null && !staticMethod && parametersText !== 'self' && !parametersText.startsWith('self, ')) {
    return null;
  }
  const parameterParts = parametersText === '' ? [] : splitTopLevelComma(parametersText);
  const classReceiver = classBindingName === null ? null : parameterParts[0]?.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:: .+)?$/)?.[1] ?? null;
  if (classBindingName !== null && classReceiver === null) {
    return null;
  }
  const extraParameters = staticMethod
    ? classBindingName === null ? parametersText : parameterParts.slice(1).join(', ')
    : parametersText === 'self' ? '' : parametersText.slice('self, '.length);
  const arrayNames = new Set<string>(initialArrayNames);
  const parsedParams = parseFunctionParametersText(
    extraParameters,
    arrayNames,
  );
  if (parsedParams === null) {
    return null;
  }

  const statements: string[] = [];
  const nameMap = new Map<string, string>(moduleNameMap);
  if (classBindingName !== null) {
    if (classReceiver === null) {
      return null;
    }
    nameMap.set(classReceiver, classBindingName);
  } else if (!staticMethod) {
    for (const [name, value] of fieldNameMap) {
      nameMap.set(name, value);
    }
    nameMap.set('self', 'this');
  }
  const declaredNames = new Set<string>(pythonParameterNames(
    extraParameters,
  ));
  const reassignedNames = reassignedLocalNames(lines, header.nextIndex);
  let nextIndex = header.nextIndex;
  const docstring = parseIndentedDocstring(lines, nextIndex, '        ');
  if (docstring !== null) {
    for (const line of docstring.value.split('\n')) {
      statements.push(line === '' ? '//' : `// ${line}`);
    }
    nextIndex = docstring.nextIndex;
  }
  while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, '        ')) {
    if (lines[nextIndex].trim() === '') {
      statements.push('');
      nextIndex += 1;
      continue;
    }
    const statement = translateStraightLineStatement(
      lines,
      nextIndex,
      '        ',
      nameMap,
      declaredNames,
      reassignedNames,
      arrayNames,
    );
    if (statement === null) {
      return null;
    }
    statements.push(...statement.statements);
    nextIndex = statement.nextIndex;
  }
  return {
    method: {
      name: tsAttributeNameForPythonName(header.name),
      exported: false,
      static: staticMethod,
      async: statements.some((statement) => statement.includes('await ')),
      parameters: parsedParams.parameters,
      optsParams: parsedParams.optsParams,
      returnType: tsTypeExpression(header.returnType),
      statements,
    },
    nextIndex,
  };
}
