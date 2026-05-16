import type {
  FunctionParameter,
  ImportDefinition,
  NamespaceImportDefinition,
  OptionalFunctionParameter,
  PlainClassDefinition,
  ProtocolDefinition,
  ProtocolMethod,
  SimpleModuleFunction,
  StructModule,
  TypeAlias,
} from '../model.js';
import { tsExportNameForPythonName, tsTypeExpression } from '../naming.js';
import { tsImportPathForPythonImport } from '../paths.js';
import { flattenFromImportBlocks, isOneLineAllAssignment } from '../python-utils.js';
import {
  identifierPattern,
  inferPythonExpressionType,
  isCollectionsAbcTypeImport,
  isIndentedBlockLine,
  isTypingOnlyImport,
  isTypeAliasExpression,
  parseIndentedFunctionHeader,
  parseTypeCheckingImports,
  parseTypeCheckingTypeAliasFallback,
  splitTopLevelComma,
  stripTypeOnlyStatementSyntax,
} from './common.js';
import { stringNameMarker, translateExpression } from './expression.js';
import { parseFunctionParametersText, pythonParameterNames } from './parameters.js';
import {
  functionSignatureMarker,
  parseStraightLineFunctionHeader,
  reassignedLocalNames,
  rewriteStructPositionalConstructors,
  translateStraightLineStatement,
} from './statements.js';

export function parseMsgspecStructModule(trimmedPython: string, relativePath: string): StructModule | null {
  const lines = flattenFromImportBlocks(trimmedPython.split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  const namespaceImports: NamespaceImportDefinition[] = [];
  const typeAliases: TypeAlias[] = [];
  const functions: SimpleModuleFunction[] = [];
  const classes: StructModule['classes'] = [];
  const protocols: StructModule['protocols'] = [];
  const structConstructorFields = new Map<string, string[]>();
  const moduleNameMap = new Map<string, string>();
  let sawMsgspecImport = false;
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    if (trimmed === 'import msgspec') {
      sawMsgspecImport = true;
      index += 1;
      continue;
    }
    if (trimmed === 'import socket') {
      namespaceImports.push({
        alias: 'socket',
        modulePath: '@grim/python-socket.ts',
      });
      moduleNameMap.set('socket', 'socket');
      index += 1;
      continue;
    }
    if (
      isCollectionsAbcTypeImport(trimmed)
      || isTypingOnlyImport(trimmed)
      || trimmed === 'from pathlib import Path'
      || isDataclassImport(trimmed)
    ) {
      index += 1;
      continue;
    }
    if (trimmed === 'if TYPE_CHECKING:') {
      const typeCheckingAlias = parseTypeCheckingTypeAliasFallback(lines, index, relativePath);
      if (typeCheckingAlias !== null) {
        imports.push(...typeCheckingAlias.imports);
        typeAliases.push(...typeCheckingAlias.typeAliases);
        index = typeCheckingAlias.nextIndex;
        continue;
      }
      const typeCheckingImports = parseTypeCheckingImports(lines, index, relativePath);
      if (typeCheckingImports === null) {
        return null;
      }
      imports.push(...typeCheckingImports.imports);
      index = typeCheckingImports.nextIndex;
      continue;
    }

    const raylibApiImport = /^from grim\.raylib_api import ((?:r[dl])(?:, r[dl])*)$/.exec(trimmed);
    if (raylibApiImport !== null) {
      const names = raylibApiImport[1].split(', ');
      imports.push({
        modulePath: tsImportPathForPythonImport('grim.raylib_api', relativePath),
        names,
      });
      namespaceImports.push({
        alias: 'wgl',
        modulePath: '@wgl',
      });
      for (const name of names) {
        moduleNameMap.set(name, 'wgl');
      }
      index += 1;
      continue;
    }

    const namespaceImport = /^from (\.+) import ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (namespaceImport !== null) {
      const alias = tsExportNameForPythonName(namespaceImport[2]);
      namespaceImports.push({
        alias,
        modulePath: tsImportPathForPythonImport(`${namespaceImport[1]}${namespaceImport[2]}`, relativePath),
      });
      moduleNameMap.set(namespaceImport[2], alias);
      index += 1;
      continue;
    }

    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromImport === null) {
      break;
    }
    imports.push({
      modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
      names: fromImport[2].split(', ').map(tsExportNameForPythonName),
    });
    if (tsImportPathForPythonImport(fromImport[1], relativePath) === '@crimson/bonuses/hud.ts') {
      for (const name of fromImport[2].split(', ')) {
        if (name === '_TimerRef') {
          structConstructorFields.set('TimerRef', ['kind', 'key', 'playerIndex']);
        }
      }
    }
    index += 1;
  }

  if (!sawMsgspecImport) {
    return null;
  }

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
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
    if (trimmed === 'if TYPE_CHECKING:') {
      const typeCheckingAlias = parseTypeCheckingTypeAliasFallback(lines, index, relativePath);
      if (typeCheckingAlias !== null) {
        imports.push(...typeCheckingAlias.imports);
        typeAliases.push(...typeCheckingAlias.typeAliases);
        index = typeCheckingAlias.nextIndex;
        continue;
      }
      const typeCheckingImports = parseTypeCheckingImports(lines, index, relativePath);
      if (typeCheckingImports === null) {
        return null;
      }
      imports.push(...typeCheckingImports.imports);
      index = typeCheckingImports.nextIndex;
      continue;
    }

    const typeAlias = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(trimmed);
    if (typeAlias !== null) {
      if (!isTypeAliasExpression(typeAlias[2])) {
        return null;
      }
      typeAliases.push({
        name: tsExportNameForPythonName(typeAlias[1]),
        typeExpression: tsTypeExpression(typeAlias[2]),
      });
      index += 1;
      continue;
    }

    const fn = parseStructModuleFunction(lines, index, structConstructorFields, moduleNameMap);
    if (fn !== null) {
      functions.push(fn.fn);
      moduleNameMap.set(functionSignatureMarker(fn.pythonName), JSON.stringify({ positional: fn.signaturePositionalNames }));
      moduleNameMap.set(fn.pythonName, fn.fn.name);
      index = fn.nextIndex;
      continue;
    }

    const protocol = parseSimpleProtocolClass(lines, index);
    if (protocol !== null) {
      protocols.push(protocol.protocol);
      index = protocol.nextIndex;
      continue;
    }

    const structClass = parseStructClass(lines, index, moduleNameMap);
    if (structClass === null) {
      return null;
    }
    structConstructorFields.set(
      structClass.structClass.name,
      structClass.structClass.fields.map((field) => field.name),
    );
    classes.push(rewriteStructClassConstructorCalls(structClass.structClass, structConstructorFields));
    index = structClass.nextIndex;
  }

  markStructTypeOnlyImports(imports, typeAliases, functions, classes, protocols);
  markStructNamespaceImports(namespaceImports, typeAliases, functions, classes, protocols);
  return typeAliases.length + functions.length + classes.length + protocols.length > 0
    ? { imports, namespaceImports, typeAliases, functions, classes, protocols }
    : null;
}

function rewriteStructClassConstructorCalls(
  structClass: StructModule['classes'][number],
  structConstructorFields: ReadonlyMap<string, string[]>,
): StructModule['classes'][number] {
  return {
    ...structClass,
    postInitStatements: structClass.postInitStatements.map((statement) => rewriteStructPositionalConstructors(statement, structConstructorFields)),
    methods: structClass.methods.map((method) => ({
      ...method,
      statements: method.statements.map((statement) => rewriteStructPositionalConstructors(statement, structConstructorFields)),
    })),
  };
}

function parseStructModuleFunction(
  lines: string[],
  index: number,
  structConstructorFields: ReadonlyMap<string, string[]> = new Map(),
  moduleNameMap: ReadonlyMap<string, string> = new Map(),
): { fn: SimpleModuleFunction; nextIndex: number; pythonName: string; signaturePositionalNames: string[] } | null {
  const header = parseStraightLineFunctionHeader(lines, index);
  if (header === null) {
    return null;
  }

  const arrayNames = new Set<string>();
  const signaturePositionalNames: string[] = [];
  let keywordOnly = false;
  for (const parameterText of splitTopLevelComma(header.parametersText)) {
    if (parameterText === '*') {
      keywordOnly = true;
      continue;
    }
    if (keywordOnly || parameterText === '') {
      continue;
    }
    const parameterName = /^\*\*?([A-Za-z_][A-Za-z0-9_]*)|^([A-Za-z_][A-Za-z0-9_]*)/.exec(parameterText);
    const pythonParameterName = parameterName?.[1] ?? parameterName?.[2] ?? null;
    if (pythonParameterName !== null) {
      signaturePositionalNames.push(pythonParameterName);
    }
  }
  const parsedParams = parseFunctionParametersText(header.parametersText, arrayNames);
  if (parsedParams === null) {
    return null;
  }

  const statements: string[] = [];
  const nameMap = new Map(moduleNameMap);
  nameMap.set(functionSignatureMarker(header.name), JSON.stringify({ positional: signaturePositionalNames }));
  const declaredNames = new Set<string>(pythonParameterNames(header.parametersText));
  let nextIndex = header.nextIndex;
  const docstring = parseIndentedDocstring(lines, nextIndex);
  if (docstring !== null) {
    for (const line of docstring.value.split('\n')) {
      statements.push(line === '' ? '//' : `// ${line}`);
    }
    nextIndex = docstring.nextIndex;
  }

  const reassignedNames = reassignedLocalNames(lines, nextIndex);
  while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, '    ')) {
    if (lines[nextIndex].trim() === '') {
      statements.push('');
      nextIndex += 1;
      continue;
    }
    const statement = translateStraightLineStatement(
      lines,
      nextIndex,
      '    ',
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
    fn: {
      name: tsExportNameForPythonName(header.name),
      exported: !header.name.startsWith('_'),
      async: statements.some((statement) => statement.includes('await ')),
      parameters: parsedParams.parameters,
      optsParams: parsedParams.optsParams,
      returnType: tsTypeExpression(header.returnType),
      statements: statements.map((statement) => rewriteStructPositionalConstructors(statement, structConstructorFields)),
    },
    nextIndex,
    pythonName: header.name,
    signaturePositionalNames,
  };
}

export function parseStructClass(
  lines: string[],
  index: number,
  moduleNameMap: ReadonlyMap<string, string> = new Map(),
  initialMapNames: ReadonlySet<string> = new Set(),
): { structClass: StructModule['classes'][number]; nextIndex: number } | null {
  const dataclass = /^@dataclass\((?<options>[^)]*)\)$/.exec(lines[index] ?? '');
  const classIndex = dataclass === null ? index : index + 1;
  const header = dataclass === null
    ? /^class ([A-Za-z_][A-Za-z0-9_]*)\(msgspec\.Struct(?<options>(?:, [^)]+)?)\):$/.exec(lines[classIndex] ?? '')
    : /^class ([A-Za-z_][A-Za-z0-9_]*):$/.exec(lines[classIndex] ?? '');
  if (header === null) {
    return null;
  }
  const options = dataclass?.groups?.options ?? header.groups?.options ?? '';
  const readonlyFields = options.includes('frozen=True');
  const tagged = options.includes('tag=True');
  const className = tsExportNameForPythonName(header[1]);
  let nextIndex = classIndex + 1;

  const docstring = parseIndentedDocstring(lines, nextIndex);
  if (docstring !== null) {
    nextIndex = docstring.nextIndex;
  }

  const fields: StructModule['classes'][number]['fields'] = [];
  const methods: SimpleModuleFunction[] = [];
  const arrayFieldNames = new Set<string>();
  const mapFieldNames = new Set<string>(initialMapNames);
  let postInitStatements: string[] = [];
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    const trimmedField = line.trim();
    if (trimmedField === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith('    ')) {
      break;
    }

    if (trimmedField === 'pass') {
      nextIndex += 1;
      continue;
    }

    if (trimmedField === '@property') {
      const propertyMethod = parseStructMethod(lines, nextIndex + 1, false, arrayFieldNames, mapFieldNames, moduleNameMap);
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

    if (trimmedField === '@staticmethod') {
      const staticMethod = parseStructMethod(lines, nextIndex + 1, true, arrayFieldNames, mapFieldNames, moduleNameMap);
      if (staticMethod === null) {
        return null;
      }
      methods.push(staticMethod.method);
      nextIndex = staticMethod.nextIndex;
      continue;
    }

    if (trimmedField === '@classmethod') {
      const classMethod = parseStructMethod(lines, nextIndex + 1, true, arrayFieldNames, mapFieldNames, moduleNameMap, className);
      if (classMethod === null) {
        return null;
      }
      methods.push(classMethod.method);
      nextIndex = classMethod.nextIndex;
      continue;
    }

    const method = parseStructMethod(lines, nextIndex, false, arrayFieldNames, mapFieldNames, moduleNameMap);
    if (method !== null) {
      if (method.method.name === '__post_init__') {
        postInitStatements = method.method.statements;
      } else {
        methods.push(method.method);
      }
      nextIndex = method.nextIndex;
      continue;
    }

    const field = /^    ([A-Za-z_][A-Za-z0-9_]*): (.+?)(?: = (.+))?$/.exec(line);
    if (field === null) {
      return null;
    }
    const defaultValue = field[3] === undefined ? null : tsStructFieldDefaultValue(field[3]);
    const fieldName = tsAttributeNameForPythonName(field[1]);
    const typeExpression = tsStructFieldType(field[2]);
    if (typeExpression.endsWith('[]')) {
      arrayFieldNames.add(`self.${field[1]}`);
      arrayFieldNames.add(`this.${fieldName}`);
    }
    if (typeExpression.startsWith('Map<')) {
      mapFieldNames.add(`self.${field[1]}`);
      mapFieldNames.add(`this.${fieldName}`);
    }
    fields.push({
      name: fieldName,
      typeExpression,
      defaultValue,
    });
    nextIndex += 1;
  }

  return {
    structClass: {
      name: className,
      docstring: docstring?.value ?? null,
      tagged,
      readonlyFields,
      fields,
      postInitStatements,
      methods,
    },
    nextIndex,
  };
}

function parseStructMethod(
  lines: string[],
  index: number,
  staticMethod = false,
  initialArrayNames: ReadonlySet<string> = new Set(),
  initialMapNames: ReadonlySet<string> = new Set(),
  moduleNameMap: ReadonlyMap<string, string> = new Map(),
  classBindingName: string | null = null,
): { method: SimpleModuleFunction; nextIndex: number } | null {
  const header = parseIndentedFunctionHeader(lines, index, '    ');
  if (header === null) {
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

  const parameters: FunctionParameter[] = [];
  const optsParams: OptionalFunctionParameter[] = [];
  const arrayNames = new Set<string>(initialArrayNames);
  const mapNames = new Set<string>(initialMapNames);
  const extraParameters = classBindingName !== null
    ? parameterParts.slice(1).join(', ')
    : staticMethod
    ? parametersText
    : parametersText === 'self' ? '' : parametersText.slice('self, '.length);
  let keywordOnly = false;
  if (extraParameters !== '') {
    for (const parameterText of splitTopLevelComma(extraParameters)) {
      if (parameterText === '*') {
        keywordOnly = true;
        continue;
      }
      const parameter = /^([A-Za-z_][A-Za-z0-9_]*): ([^=]+?)(?: = (.+))?$/.exec(parameterText);
      if (parameter === null) {
        return null;
      }
      const parsedParameter = {
        name: tsExportNameForPythonName(parameter[1]),
        typeExpression: tsTypeExpression(parameter[2]),
      };
      if (parsedParameter.typeExpression.endsWith('[]')) {
        arrayNames.add(parameter[1]);
      }
      if (parsedParameter.typeExpression.startsWith('Map<')) {
        mapNames.add(parsedParameter.name);
      }
      if (parsedParameter.typeExpression === 'string') {
        arrayNames.add(stringNameMarker(parameter[1]));
        arrayNames.add(stringNameMarker(parsedParameter.name));
      }
      if (keywordOnly) {
        optsParams.push({
          ...parsedParameter,
          defaultValue: parameter[3] === undefined ? null : translateExpression(parameter[3], undefined, arrayNames),
        });
      } else if (parameter[3] === undefined) {
        parameters.push(parsedParameter);
      } else {
        parameters.push({
          ...parsedParameter,
          defaultValue: translateExpression(parameter[3], undefined, arrayNames),
        });
      }
    }
  }

  const statements: string[] = [];
  const nameMap = new Map<string, string>(moduleNameMap);
  if (classBindingName !== null) {
    if (classReceiver === null) {
      return null;
    }
    nameMap.set(classReceiver, classBindingName);
  } else if (!staticMethod) {
    nameMap.set('self', 'this');
  }
  const declaredNames = new Set<string>(pythonParameterNames(extraParameters));
  const reassignedNames = reassignedLocalNames(lines, header.nextIndex);
  let nextIndex = header.nextIndex;
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
      new Set(),
      null,
      mapNames,
    );
    if (statement === null) {
      return null;
    }
    statements.push(...statement.statements);
    nextIndex = statement.nextIndex;
  }

  return {
    method: {
      name: header.name === '__post_init__' ? '__post_init__' : tsAttributeNameForPythonName(header.name),
      exported: false,
      static: staticMethod,
      async: statements.some((statement) => statement.includes('await ')),
      parameters,
      optsParams,
      returnType: tsTypeExpression(header.returnType),
      statements,
    },
    nextIndex,
  };
}

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
      const propertyMethod = parsePlainClassMethod(lines, nextIndex + 1, fieldNameMap, moduleNameMap);
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
    const method = parsePlainClassMethod(lines, nextIndex, fieldNameMap, moduleNameMap);
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

  return {
    plainClass: {
      name: tsExportNameForPythonName(header[1]),
      ...(extendsName === undefined ? {} : { extendsName }),
      docstring: docstring?.value ?? null,
      fields,
      constructorDefinition: {
        parameters: constructorParams.parameters,
        optsParams: constructorParams.optsParams,
        statements: constructorStatements,
      },
      methods,
    },
    nextIndex,
  };
}

function inferPlainClassFieldType(valueText: string, fieldTypes: ReadonlyMap<string, string>): string | null {
  if (/^Path\([A-Za-z_][A-Za-z0-9_]*\)$/.test(valueText)) {
    return 'string';
  }
  if (/^-?\d+(?:\.\d+)?(?:\s*[+\-*/]\s*(?:-?\d+(?:\.\d+)?|(?:int|float)\(.+\)|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?))*$/.test(valueText.trim())) {
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
): { method: SimpleModuleFunction; nextIndex: number } | null {
  const header = parseIndentedFunctionHeader(lines, index, '    ');
  if (header === null || header.name === '__init__') {
    return null;
  }
  const parametersText = header.parametersText;
  if (parametersText !== 'self' && !parametersText.startsWith('self, ')) {
    return null;
  }
  const arrayNames = new Set<string>();
  const parsedParams = parseFunctionParametersText(
    parametersText === 'self' ? '' : parametersText.slice('self, '.length),
    arrayNames,
  );
  if (parsedParams === null) {
    return null;
  }

  const statements: string[] = [];
  const nameMap = new Map<string, string>([...moduleNameMap, ['self', 'this'], ...fieldNameMap]);
  const declaredNames = new Set<string>(pythonParameterNames(
    parametersText === 'self' ? '' : parametersText.slice('self, '.length),
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
      async: statements.some((statement) => statement.includes('await ')),
      parameters: parsedParams.parameters,
      optsParams: parsedParams.optsParams,
      returnType: tsTypeExpression(header.returnType),
      statements,
    },
    nextIndex,
  };
}

function parseSimpleProtocolClass(
  lines: string[],
  index: number,
): { protocol: ProtocolDefinition; nextIndex: number } | null {
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\(Protocol\):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }

  const methods: ProtocolMethod[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!lines[nextIndex].startsWith('    ')) {
      break;
    }

    const method = parseProtocolMethodHeader(lines, nextIndex);
    if (method === null) {
      return null;
    }
    const parameters = parseProtocolParameters(method.parametersText);
    if (parameters === null) {
      return null;
    }
    methods.push({
      name: method.name === '__call__' ? '__call__' : tsExportNameForPythonName(method.name),
      parameters: parameters.parameters,
      optsParams: parameters.optsParams,
      optsOptional: false,
      returnType: tsTypeExpression(method.returnType),
    });
    nextIndex = method.nextIndex;
  }

  return methods.length > 0
    ? { protocol: { name: header[1], methods }, nextIndex }
    : null;
}

function parseProtocolMethodHeader(
  lines: string[],
  index: number,
): { name: string; parametersText: string; returnType: string; nextIndex: number } | null {
  const oneLine = /^    def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([^:]+): \.\.\.$/.exec(lines[index] ?? '');
  if (oneLine !== null) {
    return {
      name: oneLine[1],
      parametersText: oneLine[2],
      returnType: oneLine[3],
      nextIndex: index + 1,
    };
  }

  const start = /^    def ([A-Za-z_][A-Za-z0-9_]*)\($/.exec(lines[index] ?? '');
  if (start === null) {
    return null;
  }

  const parameterLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const close = /^    \) -> ([^:]+): \.\.\.$/.exec(lines[nextIndex] ?? '');
    if (close !== null) {
      return {
        name: start[1],
        parametersText: parameterLines.join(', '),
        returnType: close[1],
        nextIndex: nextIndex + 1,
      };
    }
    const parameter = /^        (.+),$/.exec(lines[nextIndex] ?? '');
    if (parameter === null) {
      return null;
    }
    parameterLines.push(parameter[1]);
    nextIndex += 1;
  }
  return null;
}

function parseProtocolParameters(parametersText: string): { parameters: FunctionParameter[]; optsParams: FunctionParameter[] } | null {
  if (parametersText === 'self') {
    return { parameters: [], optsParams: [] };
  }
  if (!parametersText.startsWith('self, ')) {
    return null;
  }
  return parseFunctionParametersText(parametersText.slice('self, '.length), new Set());
}

function parseIndentedDocstring(
  lines: string[],
  index: number,
  indent = '    ',
): { value: string; nextIndex: number } | null {
  const line = lines[index];
  if (line === undefined || !line.startsWith(indent)) {
    return null;
  }

  const start = /^"""(.*)$/.exec(line.slice(indent.length));
  if (start === null) {
    return null;
  }
  if (start[1].endsWith('"""')) {
    return {
      value: start[1].slice(0, -3),
      nextIndex: index + 1,
    };
  }

  const docLines = [start[1]];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (line === `${indent}"""`) {
      return {
        value: docLines.join('\n'),
        nextIndex: nextIndex + 1,
      };
    }
    if (line === '') {
      docLines.push('');
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith(indent)) {
      return null;
    }
    docLines.push(line.slice(indent.length));
    nextIndex += 1;
  }
  return null;
}

function tsStructFieldType(pythonType: string): string {
  if (pythonType.trim() === 'Path') {
    return 'string';
  }
  const listType = /^list\[(.+)\]$/.exec(pythonType.trim());
  if (listType !== null) {
    return `${tsTypeExpression(listType[1])}[]`;
  }
  return tsTypeExpression(pythonType);
}

function tsStructFieldDefaultValue(pythonValue: string): string | null {
  const trimmed = pythonValue.trim();
  const joinedPath = /^Path\("([^"]+)"\) \/ "([^"]+)"$/.exec(trimmed);
  if (joinedPath !== null) {
    return `'${joinedPath[1]}/${joinedPath[2]}'`;
  }
  const pathValue = /^Path\("([^"]+)"\)$/.exec(trimmed);
  if (pathValue !== null) {
    return `'${pathValue[1]}'`;
  }

  if (trimmed === 'msgspec.field(default_factory=list)') {
    return '[]';
  }
  if (trimmed === 'msgspec.field(default_factory=dict)') {
    return 'new Map()';
  }

  const dataclassFactory = /^field\(default_factory=([A-Za-z_][A-Za-z0-9_]*)\)$/.exec(trimmed);
  if (dataclassFactory !== null) {
    return `new ${tsExportNameForPythonName(dataclassFactory[1])}()`;
  }

  const lambdaFactory = /^msgspec\.field\(default_factory=lambda: (.+)\)$/.exec(trimmed);
  if (lambdaFactory !== null) {
    return translateExpression(lambdaFactory[1]);
  }

  const dottedFactory = /^msgspec\.field\(default_factory=([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\)$/.exec(trimmed);
  if (dottedFactory !== null) {
    return `${translateExpression(dottedFactory[1])}()`;
  }

  const factory = /^msgspec\.field\(default_factory=([A-Za-z_][A-Za-z0-9_]*)\)$/.exec(trimmed);
  if (factory !== null) {
    return `new ${tsExportNameForPythonName(factory[1])}()`;
  }

  const zeroArgConstructor = /^([A-Z][A-Za-z0-9_]*)\(\)$/.exec(trimmed);
  if (zeroArgConstructor !== null) {
    return `new ${tsExportNameForPythonName(zeroArgConstructor[1])}()`;
  }

  if (/^cast\([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])?, None\)$/.test(trimmed)) {
    return 'undefined!';
  }

  return translateExpression(trimmed);
}

function markStructTypeOnlyImports(
  imports: ImportDefinition[],
  typeAliases: TypeAlias[],
  functions: SimpleModuleFunction[],
  classes: StructModule['classes'],
  protocols: StructModule['protocols'],
): void {
  const valueText = stripTypeOnlyStatementSyntax([
    ...classes.flatMap((structClass) => [
      ...structClass.fields.map((field) => field.defaultValue ?? ''),
      ...structClass.postInitStatements,
      ...structClass.methods.flatMap((method) => method.statements),
    ]),
    ...functions.flatMap((fn) => fn.statements),
  ].join('\n'));
  const typeText = [
    ...typeAliases.map((alias) => alias.typeExpression),
    ...functions.flatMap((fn) => [
      fn.returnType,
      ...fn.parameters.map((parameter) => parameter.typeExpression),
      ...fn.optsParams.map((parameter) => parameter.typeExpression),
    ]),
    ...classes.flatMap((structClass) => structClass.fields.map((field) => field.typeExpression)),
    ...classes.flatMap((structClass) => structClass.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
    ])),
    ...protocols.flatMap((protocol) => protocol.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
    ])),
  ].join('\n');

  for (let index = 0; index < imports.length; index += 1) {
    const importDefinition = imports[index];
    const valueNames = importDefinition.names.filter((name) => identifierPattern(importedBindingName(name)).test(valueText));
    const typeOnlyNames = importDefinition.names.filter((name) => (
      !identifierPattern(importedBindingName(name)).test(valueText) && identifierPattern(importedBindingName(name)).test(typeText)
    ));
    if (valueNames.length + typeOnlyNames.length === 0) {
      imports.splice(index, 1);
      index -= 1;
      continue;
    }
    if (valueNames.length === 0) {
      importDefinition.names = typeOnlyNames;
      importDefinition.typeOnly = true;
      continue;
    }
    if (typeOnlyNames.length === 0) {
      importDefinition.names = valueNames;
      importDefinition.typeOnly = false;
      continue;
    }
    imports.splice(
      index,
      1,
      { ...importDefinition, names: typeOnlyNames, typeOnly: true },
      { ...importDefinition, names: valueNames, typeOnly: false },
    );
    index += 1;
  }
}

function markStructNamespaceImports(
  namespaceImports: NamespaceImportDefinition[],
  typeAliases: TypeAlias[],
  functions: SimpleModuleFunction[],
  classes: StructModule['classes'],
  protocols: StructModule['protocols'],
): void {
  const usageText = [
    ...typeAliases.map((alias) => alias.typeExpression),
    ...classes.flatMap((structClass) => [
      ...structClass.fields.map((field) => field.typeExpression),
      ...structClass.fields.map((field) => field.defaultValue ?? ''),
      ...structClass.postInitStatements,
      ...structClass.methods.flatMap((method) => [
        method.returnType,
        ...method.parameters.map((parameter) => parameter.typeExpression),
        ...method.optsParams.map((parameter) => parameter.typeExpression),
        ...method.statements,
      ]),
    ]),
    ...functions.flatMap((fn) => [
      fn.returnType,
      ...fn.parameters.map((parameter) => parameter.typeExpression),
      ...fn.optsParams.map((parameter) => parameter.typeExpression),
      ...fn.statements,
    ]),
    ...protocols.flatMap((protocol) => protocol.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
    ])),
  ].join('\n');

  for (let index = 0; index < namespaceImports.length; index += 1) {
    if (!identifierPattern(namespaceImports[index].alias).test(usageText)) {
      namespaceImports.splice(index, 1);
      index -= 1;
    }
  }
}

function importedBindingName(importName: string): string {
  return /^.+ as ([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(importName)?.[1] ?? importName;
}

function isDataclassImport(trimmedLine: string): boolean {
  const dataclassImport = /^from dataclasses import (.+)$/.exec(trimmedLine);
  if (dataclassImport === null) {
    return false;
  }
  return dataclassImport[1].split(', ').every((name) => name === 'dataclass' || name === 'field');
}
