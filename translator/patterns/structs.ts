import type {
  FunctionParameter,
  ImportDefinition,
  NamespaceImportDefinition,
  OptionalFunctionParameter,
  ProtocolDefinition,
  ProtocolMethod,
  SimpleModuleFunction,
  StructModule,
  TypeAlias,
} from '../model.js';
import { tsExportNameForPythonName, tsPublicNameForPythonName, tsTypeExpression } from '../naming.js';
import { tsImportPathForPythonImport } from '../paths.js';
import { flattenFromImportBlocks } from '../python-utils.js';
import {
  identifierPattern,
  isCollectionsAbcTypeImport,
  isIndentedBlockLine,
  isTypingOnlyImport,
  isTypeAliasExpression,
  parseIndentedFunctionHeader,
  parseOneLineAllNames,
  parseTypeCheckingImports,
  parseTypeCheckingTypeAliasFallback,
  splitTopLevelComma,
  stripTypeOnlyStatementSyntax,
} from './common.js';
import {
  arrayValueMapNameMarker,
  receiverTypeNameMarker,
  translateExpression,
  tupleElementArrayNameMarker,
  tupleKeyMapNameMarker,
} from './expression.js';
import {
  functionSignatureMarker,
  parseStraightLineFunctionHeader,
} from './function-headers.js';
import { recordImportedInstanceMethodSignatures, recordImportedStructConstructorFields, recordImportedTupleTypeAliases } from './imported-classes.js';
import { parseFunctionParameterText, parseFunctionParametersText, pythonParameterNames } from './parameters.js';
import {
  reassignedLocalNames,
  rewriteStructPositionalConstructors,
  translateStraightLineStatement,
} from './statements.js';

export { parsePlainClass } from './plain-classes.js';

export function parseMsgspecStructModule(trimmedPython: string, relativePath: string): StructModule | null {
  const lines = flattenFromImportBlocks(trimmedPython.split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  const namespaceImports: NamespaceImportDefinition[] = [];
  const typeAliases: TypeAlias[] = [];
  const functions: SimpleModuleFunction[] = [];
  const classes: StructModule['classes'] = [];
  const protocols: StructModule['protocols'] = [];
  const structConstructorFields = new Map<string, string[]>();
  const tupleTypeAliases = new Set<string>();
  const moduleNameMap = new Map<string, string>();
  let allNames: string[] = [];
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
    if (trimmed === 'import uuid') {
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
      || trimmed === 'from collections import OrderedDict'
      || trimmed === 'from collections import defaultdict'
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
    const modulePath = tsImportPathForPythonImport(fromImport[1], relativePath);
    const importBindings = fromImport[2].split(', ').map((name) => ({
      pythonName: name,
      importedName: tsStructImportNameForPythonName(name),
      defaultName: tsExportNameForPythonName(name),
    }));
    const names = importBindings.map((binding) => binding.importedName);
    imports.push({
      modulePath,
      names,
    });
    recordImportedInstanceMethodSignatures(
      modulePath,
      names.map((name) => ({ importedName: name, localName: name })),
      relativePath,
      moduleNameMap,
    );
    recordImportedStructConstructorFields(
      modulePath,
      names.map((name) => ({ importedName: name, localName: name })),
      relativePath,
      structConstructorFields,
    );
    recordImportedTupleTypeAliases(
      modulePath,
      names.map((name) => ({ importedName: name, localName: name })),
      relativePath,
      tupleTypeAliases,
    );
    for (const binding of importBindings) {
      if (binding.importedName !== binding.defaultName) {
        moduleNameMap.set(binding.pythonName, binding.importedName);
      }
    }
    if (modulePath === '@crimson/bonuses/hud.ts') {
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
    const allAssignment = parseStructAllAssignment(lines, index);
    if (allAssignment !== null) {
      allNames = allAssignment.names;
      index = allAssignment.nextIndex;
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

    const annotatedTypeAlias = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = (.+)$/.exec(trimmed);
    if (annotatedTypeAlias !== null) {
      if (!isTypeAliasExpression(annotatedTypeAlias[2])) {
        return null;
      }
      typeAliases.push({
        name: tsExportNameForPythonName(annotatedTypeAlias[1]),
        typeExpression: tsTypeExpression(annotatedTypeAlias[2]),
      });
      index += 1;
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

    const structClass = parseStructClass(lines, index, moduleNameMap, new Set(), tupleTypeAliases);
    if (structClass === null) {
      return null;
    }
    structConstructorFields.set(
      structClass.structClass.name,
      structConstructorFieldNames(structClass.structClass, structConstructorFields),
    );
    classes.push(rewriteStructClassConstructorCalls(structClass.structClass, structConstructorFields));
    index = structClass.nextIndex;
  }

  markStructTypeOnlyImports(imports, typeAliases, functions, classes, protocols);
  markStructNamespaceImports(namespaceImports, typeAliases, functions, classes, protocols);
  const reexports = structReexportsForAllNames(imports, allNames);
  return typeAliases.length + functions.length + classes.length + protocols.length + reexports.length > 0
    ? { imports, namespaceImports, reexports, typeAliases, functions, classes, protocols }
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

function structConstructorFieldNames(
  structClass: StructModule['classes'][number],
  structConstructorFields: ReadonlyMap<string, string[]>,
): string[] {
  const inheritedFields = structClass.extendsName === undefined
    ? []
    : structConstructorFields.get(structClass.extendsName) ?? [];
  return uniqueNames([...inheritedFields, ...structClass.fields.map((field) => field.name)]);
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    if (!seen.has(name)) {
      seen.add(name);
      unique.push(name);
    }
  }
  return unique;
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
  tupleTypeAliases: ReadonlySet<string> = new Set(),
): { structClass: StructModule['classes'][number]; nextIndex: number } | null {
  const dataclass = /^@dataclass\((?<options>[^)]*)\)$/.exec(lines[index] ?? '');
  const classIndex = dataclass === null ? index : index + 1;
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)(?:\((?<bases>[^)]*)\))?:$/.exec(lines[classIndex] ?? '');
  if (header === null || (dataclass !== null && header.groups?.bases !== undefined)) {
    return null;
  }
  const parsedBases = dataclass === null ? parseStructClassBases(header.groups?.bases ?? '', moduleNameMap) : { extendsName: undefined, options: dataclass.groups?.options ?? '' };
  if (parsedBases === null) {
    return null;
  }
  const options = dataclass?.groups?.options ?? parsedBases.options;
  const readonlyFields = options.includes('frozen=True');
  const tagString = /(?:^|, )tag=(["'])(.*?)\1/.exec(options);
  const tagged = options.includes('tag=True') || tagString !== null;
  const genericBase = /(?:^|, )Generic\[([^\]]+)\]/.exec(options);
  const typeParams = genericBase === null
    ? undefined
    : genericBase[1].split(', ').map(tsExportNameForPythonName);
  const className = tsExportNameForPythonName(header[1]);
  let nextIndex = classIndex + 1;

  const docstring = parseIndentedDocstring(lines, nextIndex);
  if (docstring !== null) {
    nextIndex = docstring.nextIndex;
  }

  const fields: StructModule['classes'][number]['fields'] = [];
  const methods: SimpleModuleFunction[] = [];
  const staticMethodNames = new Set<string>();
  const arrayFieldNames = new Set<string>();
  const mapFieldNames = new Set<string>(initialMapNames);
  const classNameMap = new Map(moduleNameMap);
  let postInitStatements: string[] = [];
  const pendingFieldComments: string[] = [];
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
    if (trimmedField.startsWith('#')) {
      pendingFieldComments.push(trimmedField.replace(/^# ?/, ''));
      nextIndex += 1;
      continue;
    }

    if (trimmedField === '@property') {
      pendingFieldComments.length = 0;
      const propertyMethod = parseStructMethod(lines, nextIndex + 1, false, arrayFieldNames, mapFieldNames, classNameMap);
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

    const propertySetter = /^@([A-Za-z_][A-Za-z0-9_]*)\.setter$/.exec(trimmedField);
    if (propertySetter !== null) {
      pendingFieldComments.length = 0;
      const setterMethod = parseStructMethod(lines, nextIndex + 1, false, arrayFieldNames, mapFieldNames, classNameMap);
      if (
        setterMethod === null
        || setterMethod.method.name !== tsAttributeNameForPythonName(propertySetter[1])
        || setterMethod.method.parameters.length !== 1
        || setterMethod.method.optsParams.length > 0
      ) {
        return null;
      }
      methods.push({
        ...setterMethod.method,
        name: `set ${setterMethod.method.name}`,
      });
      nextIndex = setterMethod.nextIndex;
      continue;
    }

    if (trimmedField === '@staticmethod') {
      pendingFieldComments.length = 0;
      const staticMethod = parseStructMethod(lines, nextIndex + 1, true, arrayFieldNames, mapFieldNames, classNameMap);
      if (staticMethod === null) {
        return null;
      }
      staticMethodNames.add(staticMethod.method.name);
      methods.push(staticMethod.method);
      nextIndex = staticMethod.nextIndex;
      continue;
    }

    if (trimmedField === '@classmethod') {
      pendingFieldComments.length = 0;
      const classMethod = parseStructMethod(lines, nextIndex + 1, true, arrayFieldNames, mapFieldNames, classNameMap, className);
      if (classMethod === null) {
        return null;
      }
      staticMethodNames.add(classMethod.method.name);
      methods.push(classMethod.method);
      nextIndex = classMethod.nextIndex;
      continue;
    }

    const method = parseStructMethod(lines, nextIndex, false, arrayFieldNames, mapFieldNames, classNameMap);
    if (method !== null) {
      pendingFieldComments.length = 0;
      if (method.method.name === '__post_init__') {
        postInitStatements = method.method.statements;
      } else {
        methods.push(method.method);
      }
      nextIndex = method.nextIndex;
      continue;
    }

    const parsedFieldLine = splitInlineComment(line);
    const field = /^    ([A-Za-z_][A-Za-z0-9_]*): (.+?)(?: = (.+))?$/.exec(parsedFieldLine.code);
    if (field === null) {
      return null;
    }
    const defaultValueText = field[3] === undefined
      ? null
      : collectStructFieldDefaultValue(lines, nextIndex, field[3]);
    if (defaultValueText === null && field[3] !== undefined) {
      return null;
    }
    const defaultValue = defaultValueText === null ? null : tsStructFieldDefaultValue(defaultValueText.value);
    const fieldName = tsAttributeNameForPythonName(field[1]);
    const typeExpression = tsStructFieldType(field[2], tupleTypeAliases);
    const fieldTypeName = simpleClassTypeName(typeExpression);
    if (fieldTypeName !== null) {
      classNameMap.set(receiverTypeNameMarker(`self.${field[1]}`), fieldTypeName);
      classNameMap.set(receiverTypeNameMarker(`this.${fieldName}`), fieldTypeName);
    }
    if (typeExpression.endsWith('[]')) {
      arrayFieldNames.add(`self.${field[1]}`);
      arrayFieldNames.add(`this.${fieldName}`);
      if (pythonListElementCanBeTuple(field[2])) {
        arrayFieldNames.add(tupleElementArrayNameMarker(`self.${field[1]}`));
        arrayFieldNames.add(tupleElementArrayNameMarker(`this.${fieldName}`));
      }
    }
    if (typeExpression.startsWith('Map<')) {
      mapFieldNames.add(`self.${field[1]}`);
      mapFieldNames.add(`this.${fieldName}`);
      if (pythonMapTypeHasTupleKey(field[2], tupleTypeAliases)) {
        mapFieldNames.add(tupleKeyMapNameMarker(`self.${field[1]}`));
        mapFieldNames.add(tupleKeyMapNameMarker(`this.${fieldName}`));
      }
      if (pythonMapValueIsList(field[2])) {
        mapFieldNames.add(arrayValueMapNameMarker(`self.${field[1]}`));
        mapFieldNames.add(arrayValueMapNameMarker(`this.${fieldName}`));
      }
    }
    fields.push({
      name: fieldName,
      typeExpression,
      defaultValue,
      ...(pendingFieldComments.length === 0 ? {} : { leadingComments: [...pendingFieldComments] }),
      ...(parsedFieldLine.comment === null ? {} : { trailingComment: parsedFieldLine.comment }),
    });
    pendingFieldComments.length = 0;
    nextIndex = defaultValueText?.nextIndex ?? nextIndex + 1;
  }

  const rewrittenMethods = methods.map((method) => (
    method.static === true
      ? method
      : {
        ...method,
        statements: rewriteStructStaticMethodCalls(method.statements, className, staticMethodNames),
      }
  ));
  const aliasMethods = structPrivateMethodAliases(rewrittenMethods, className);

  return {
    structClass: {
      name: className,
      ...(parsedBases.extendsName === undefined ? {} : { extendsName: parsedBases.extendsName }),
      docstring: docstring?.value ?? null,
      tagged,
      ...(tagString === null ? {} : { tagValue: tagString[2] }),
      readonlyFields,
      typeParams,
      fields,
      postInitStatements: rewriteStructStaticMethodCalls(postInitStatements, className, staticMethodNames),
      methods: [...rewrittenMethods, ...aliasMethods],
    },
    nextIndex,
  };
}

function tsStructImportNameForPythonName(pythonName: string): string {
  return /^_+[A-Z][A-Z0-9_]*$/.test(pythonName)
    ? tsPublicNameForPythonName(pythonName)
    : tsExportNameForPythonName(pythonName);
}

function structPrivateMethodAliases(
  methods: readonly SimpleModuleFunction[],
  className: string,
): SimpleModuleFunction[] {
  const existingMethodKeys = new Set(methods.map((method) => methodKey(method.name, method.static === true)));
  const aliasMethods: SimpleModuleFunction[] = [];
  const pushAlias = (method: SimpleModuleFunction, name: string, staticMethod: boolean, target: string): void => {
    const key = methodKey(name, staticMethod);
    if (existingMethodKeys.has(key)) {
      return;
    }
    existingMethodKeys.add(key);
    aliasMethods.push(methodAlias(method, name, staticMethod, target));
  };

  for (const method of methods) {
    const publicName = privateMethodPublicAlias(method.name);
    if (publicName === null) {
      continue;
    }

    if (method.static === true) {
      pushAlias(method, publicName, true, `${className}.${method.name}`);
      pushAlias(method, method.name, false, `${className}.${method.name}`);
      pushAlias(method, publicName, false, `${className}.${method.name}`);
    } else {
      pushAlias(method, publicName, false, `this.${method.name}`);
    }
  }

  return aliasMethods;
}

function methodKey(name: string, staticMethod: boolean): string {
  return `${staticMethod ? 'static' : 'instance'}:${name}`;
}

function privateMethodPublicAlias(methodName: string): string | null {
  if (!/^_[A-Za-z_$][A-Za-z0-9_$]*$/.test(methodName)) {
    return null;
  }
  const publicName = tsPublicNameForPythonName(methodName);
  return publicName === methodName ? null : publicName;
}

function methodAlias(
  sourceMethod: SimpleModuleFunction,
  name: string,
  staticMethod: boolean,
  target: string,
): SimpleModuleFunction {
  const call = `${sourceMethod.async === true ? 'await ' : ''}${target}(${methodAliasArguments(sourceMethod).join(', ')})`;
  return {
    name,
    exported: false,
    static: staticMethod,
    async: sourceMethod.async,
    typeParams: sourceMethod.typeParams,
    parameters: sourceMethod.parameters,
    optsParams: sourceMethod.optsParams,
    returnType: sourceMethod.returnType,
    statements: [sourceMethod.returnType === 'void' ? `${call};` : `return ${call};`],
  };
}

function methodAliasArguments(method: SimpleModuleFunction): string[] {
  const args = method.parameters.map((parameter) => parameter.name);
  if (method.optsParams.length > 0) {
    args.push(`{ ${method.optsParams.map((parameter) => `${parameter.name}: ${parameter.name}`).join(', ')} }`);
  }
  return args;
}

function rewriteStructStaticMethodCalls(
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
      const escapedMethodName = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\bthis\\.${escapedMethodName}\\(`, 'g');
      rewritten = rewritten.replace(pattern, `${className}.${methodName}(`);
    }
    return rewritten;
  });
}

function parseStructClassBases(
  basesText: string,
  moduleNameMap: ReadonlyMap<string, string>,
): { extendsName: string | undefined; options: string } | null {
  const bases = splitTopLevelComma(basesText);
  if (bases.length === 0) {
    return null;
  }
  if (bases[0] === 'msgspec.Struct') {
    return { extendsName: undefined, options: bases.slice(1).join(', ') };
  }
  if (!bases.slice(1).some(isMsgspecClassOption)) {
    return null;
  }
  return {
    extendsName: moduleNameMap.get(bases[0]) ?? tsExportNameForPythonName(bases[0]),
    options: bases.slice(1).join(', '),
  };
}

function isMsgspecClassOption(baseText: string): boolean {
  return /^(?:tag|forbid_unknown_fields|frozen)=/.test(baseText.trim());
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

function collectStructFieldDefaultValue(
  lines: string[],
  index: number,
  initialValue: string,
): { value: string; nextIndex: number } | null {
  let parenBalance = topLevelParenBalance(initialValue);
  if (parenBalance <= 0) {
    return { value: initialValue, nextIndex: index + 1 };
  }

  const valueLines = [initialValue];
  let nextIndex = index + 1;
  while (nextIndex < lines.length && parenBalance > 0) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed === '' || !line.startsWith('    ')) {
      return null;
    }
    valueLines.push(trimmed);
    parenBalance += topLevelParenBalance(trimmed);
    nextIndex += 1;
  }
  return parenBalance === 0
    ? { value: valueLines.join(' '), nextIndex }
    : null;
}

function topLevelParenBalance(value: string): number {
  let balance = 0;
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
    if (char === '(') {
      balance += 1;
    } else if (char === ')') {
      balance -= 1;
    }
  }
  return balance;
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
      const parsedParameter = parseFunctionParameterText(parameterText, arrayNames);
      if (parsedParameter === null) {
        return null;
      }
      const pythonParameterName = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(parameterText)?.[1] ?? null;
      if (parsedParameter.typeExpression.startsWith('Map<')) {
        mapNames.add(parsedParameter.name);
        if (pythonParameterName !== null) {
          mapNames.add(pythonParameterName);
        }
        const parameterType = pythonParameterType(parameterText);
        if (parameterType !== null && pythonMapTypeHasTupleKey(parameterType)) {
          mapNames.add(tupleKeyMapNameMarker(parsedParameter.name));
          if (pythonParameterName !== null) {
            mapNames.add(tupleKeyMapNameMarker(pythonParameterName));
          }
        }
        if (parameterType !== null && pythonMapValueIsList(parameterType)) {
          mapNames.add(arrayValueMapNameMarker(parsedParameter.name));
          if (pythonParameterName !== null) {
            mapNames.add(arrayValueMapNameMarker(pythonParameterName));
          }
        }
      }
      if (keywordOnly) {
        optsParams.push({
          ...parsedParameter,
          defaultValue: parsedParameter.defaultValue === undefined ? null : parsedParameter.defaultValue,
        });
      } else {
        parameters.push(parsedParameter);
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
  for (const parameter of [...parameters, ...optsParams]) {
    const parameterTypeName = simpleClassTypeName(parameter.typeExpression);
    if (parameterTypeName !== null) {
      nameMap.set(receiverTypeNameMarker(parameter.name), parameterTypeName);
    }
  }
  const declaredNames = new Set<string>(pythonParameterNames(extraParameters));
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
  if (/^__[^_].*__$/.test(pythonName)) {
    return pythonName;
  }
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
}

function pythonParameterType(parameterText: string): string | null {
  const parameter = /^[*]*[A-Za-z_][A-Za-z0-9_]*: (.+?)(?: = .+)?$/.exec(parameterText.trim());
  return parameter?.[1] ?? null;
}

function pythonMapTypeArgs(pythonType: string): string[] | null {
  const mapType = /^(?:dict|OrderedDict|defaultdict)\[(.+)\]$/.exec(pythonType.trim());
  return mapType === null ? null : splitTopLevelComma(mapType[1]);
}

function pythonMapTypeHasTupleKey(pythonType: string, tupleTypeAliases: ReadonlySet<string> = new Set()): boolean {
  const mapKeyType = pythonMapTypeArgs(pythonType)?.[0];
  return mapKeyType !== undefined && pythonMapKeyHasTupleIdentity(mapKeyType, tupleTypeAliases);
}

function pythonMapKeyHasTupleIdentity(pythonType: string, tupleTypeAliases: ReadonlySet<string>): boolean {
  const trimmed = pythonType.trim();
  return trimmed.startsWith('tuple[') || tupleTypeAliases.has(trimmed) || tupleTypeAliases.has(tsExportNameForPythonName(trimmed));
}

function pythonMapValueIsList(pythonType: string): boolean {
  return pythonMapTypeArgs(pythonType)?.[1]?.trim().startsWith('list[') === true;
}

function pythonListElementCanBeTuple(pythonType: string): boolean {
  const listType = /^list\[(.+)\]$/.exec(pythonType.trim());
  return listType !== null && listType[1].includes('tuple[');
}

function simpleClassTypeName(typeExpression: string): string | null {
  const typeParts = typeExpression
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part !== 'null' && part !== 'undefined');
  if (typeParts.length !== 1) {
    return null;
  }
  const typeName = /^([A-Z][A-Za-z0-9_$]*)$/.exec(typeParts[0]);
  return typeName?.[1] ?? null;
}

function parseSimpleProtocolClass(
  lines: string[],
  index: number,
): { protocol: ProtocolDefinition; nextIndex: number } | null {
  const classIndex = lines[index]?.trim() === '@runtime_checkable' ? index + 1 : index;
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\((.+)\):$/.exec(lines[classIndex] ?? '');
  if (header === null) {
    return null;
  }
  const bases = splitTopLevelComma(header[2]);
  if (!bases.includes('Protocol')) {
    return null;
  }
  const extendsNames = bases
    .filter((base) => base !== 'Protocol')
    .map((base) => tsTypeExpression(base));

  const methods: ProtocolMethod[] = [];
  let nextIndex = classIndex + 1;
  const docstring = parseIndentedDocstring(lines, nextIndex);
  if (docstring !== null) {
    nextIndex = docstring.nextIndex;
  }
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!lines[nextIndex].startsWith('    ')) {
      break;
    }

    const property = /^    ([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(lines[nextIndex] ?? '');
    if (property !== null) {
      methods.push({
        name: tsExportNameForPythonName(property[1]),
        property: true,
        readonly: false,
        parameters: [],
        optsParams: [],
        optsOptional: false,
        returnType: tsTypeExpression(property[2]),
      });
      nextIndex += 1;
      continue;
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
    ? {
      protocol: {
        name: header[1],
        ...(extendsNames.length === 0 ? {} : { extendsNames }),
        methods,
      },
      nextIndex,
    }
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

function tsStructFieldType(pythonType: string, tupleTypeAliases: ReadonlySet<string> = new Set()): string {
  const normalized = pythonType.replace(/\bPath\b/g, 'str');
  const mapArgs = pythonMapTypeArgs(normalized);
  if (mapArgs !== null && pythonMapKeyHasTupleIdentity(mapArgs[0], tupleTypeAliases)) {
    return `Map<string, ${tsTypeExpression(mapArgs[1])}>`;
  }
  return tsTypeExpression(normalized);
}

function tsStructFieldDefaultValue(pythonValue: string): string | null {
  const trimmed = pythonValue
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/,\s*\)$/g, ')');
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
  if (trimmed === 'msgspec.field(default_factory=OrderedDict)') {
    return 'new Map()';
  }

  const dataclassFactory = /^field\(default_factory=([A-Za-z_][A-Za-z0-9_]*)\)$/.exec(trimmed);
  if (dataclassFactory !== null) {
    return `new ${tsExportNameForPythonName(dataclassFactory[1])}()`;
  }

  if (trimmed === 'field(init=False)') {
    return 'undefined!';
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
    const factoryName = tsExportNameForPythonName(factory[1]);
    return /^[A-Z]/.test(factoryName) ? `new ${factoryName}()` : `${factoryName}()`;
  }

  const zeroArgConstructor = /^([A-Z][A-Za-z0-9_]*)\(\)$/.exec(trimmed);
  if (zeroArgConstructor !== null) {
    return `new ${tsExportNameForPythonName(zeroArgConstructor[1])}()`;
  }

  if (/^cast\([^,]+, None\)$/.test(trimmed)) {
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
      structClass.extendsName ?? '',
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
    ...protocols.flatMap((protocol) => [
      ...(protocol.extendsNames ?? []),
      ...protocol.methods.flatMap((method) => [
        method.returnType,
        ...method.parameters.map((parameter) => parameter.typeExpression),
        ...method.optsParams.map((parameter) => parameter.typeExpression),
      ]),
    ]),
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
      structClass.extendsName ?? '',
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
    ...protocols.flatMap((protocol) => [
      ...(protocol.extendsNames ?? []),
      ...protocol.methods.flatMap((method) => [
        method.returnType,
        ...method.parameters.map((parameter) => parameter.typeExpression),
        ...method.optsParams.map((parameter) => parameter.typeExpression),
      ]),
    ]),
  ].join('\n');

  for (let index = 0; index < namespaceImports.length; index += 1) {
    if (!identifierPattern(namespaceImports[index].alias).test(usageText)) {
      namespaceImports.splice(index, 1);
      index -= 1;
    }
  }
}

function parseStructAllAssignment(lines: string[], index: number): { names: string[]; nextIndex: number } | null {
  const trimmed = lines[index]?.trim() ?? '';
  const oneLineNames = parseOneLineAllNames(trimmed);
  if (oneLineNames !== null) {
    return { names: oneLineNames, nextIndex: index + 1 };
  }
  if (trimmed !== '__all__ = [') {
    return null;
  }

  const names: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const inner = lines[nextIndex].trim();
    if (inner === ']') {
      return { names, nextIndex: nextIndex + 1 };
    }
    const name = /^"([A-Za-z_][A-Za-z0-9_]*)",?$/.exec(inner);
    if (name === null) {
      return null;
    }
    names.push(name[1]);
    nextIndex += 1;
  }
  return null;
}

function structReexportsForAllNames(imports: ImportDefinition[], allNames: readonly string[]): StructModule['reexports'] {
  if (allNames.length === 0) {
    return [];
  }

  const exportedNames = new Set(allNames.map(tsPublicNameForPythonName));
  const byModule = new Map<string, string[]>();
  for (const importDefinition of imports) {
    const names = importDefinition.names
      .filter((name) => exportedNames.has(importedBindingName(name)))
      .map((name) => `${importDefinition.typeOnly ? 'type ' : ''}${name}`);
    if (names.length === 0) {
      continue;
    }
    const existing = byModule.get(importDefinition.modulePath) ?? [];
    for (const name of names) {
      if (!existing.includes(name)) {
        existing.push(name);
      }
    }
    byModule.set(importDefinition.modulePath, existing);
  }

  return [...byModule.entries()].map(([modulePath, names]) => ({ modulePath, names }));
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
