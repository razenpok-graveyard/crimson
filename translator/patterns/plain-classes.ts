import type {
  ImportDefinition,
  OptionalFunctionParameter,
  PlainClassDefinition,
  PlainClassFieldDefinition,
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
import {
  arrayValueMapNameMarker,
  classBaseTypeMarker,
  classFieldTypeMarker,
  functionReturnTypeMarker,
  instanceMethodSignatureMarker,
  objectNameMarker,
  receiverTypeNameMarker,
  translateExpression,
  tupleElementArrayNameMarker,
  tupleKeyMapNameMarker,
} from './expression.js';
import { parseFunctionParametersText, pythonParameterNames } from './parameters.js';
import {
  reassignedLocalNames,
  translateStraightLineStatement,
} from './statements.js';
import { parseTopLevelAssignment } from './statements/top-level-assignment.js';

function tsAttributeNameForPythonName(pythonName: string): string {
  if (/^__[^_].*__$/.test(pythonName)) {
    return pythonName;
  }
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName.replace(/^_+/, ''))}`
    : tsExportNameForPythonName(pythonName);
}

function skipSlotsAssignment(lines: string[], index: number): number {
  const line = lines[index] ?? '';
  if (!line.startsWith('    ') || !line.trim().startsWith('__slots__ = ')) {
    return index;
  }
  const trimmed = line.trim();
  if (trimmed.includes('(') && !trimmed.includes(')')) {
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      if ((lines[nextIndex] ?? '').trim() === ')') {
        return nextIndex + 1;
      }
      if (!(lines[nextIndex] ?? '').startsWith('    ')) {
        return index;
      }
      nextIndex += 1;
    }
    return index;
  }
  return index + 1;
}

function parsePlainClassFieldAssignment(
  lines: string[],
  index: number,
  moduleNameMap: ReadonlyMap<string, string>,
): { field: PlainClassFieldDefinition; pythonName: string; nextIndex: number } | null {
  const firstLine = lines[index] ?? '';
  if (!firstLine.startsWith('    ') || firstLine.startsWith('        ')) {
    return null;
  }
  const unindentedLines = lines.slice(index).map((line) => (
    line.startsWith('    ') ? line.slice('    '.length) : line
  ));
  const assignment = parseTopLevelAssignment(unindentedLines, 0, new Map(moduleNameMap));
  if (assignment === null || assignment.assignment.pythonName === undefined) {
    return null;
  }
  const pythonName = assignment.assignment.pythonName;
  const fieldName = tsAttributeNameForPythonName(pythonName);
  const typeExpression = assignment.assignment.typeExpression
    ?? inferPlainClassFieldType(assignment.assignment.valueLines.join(' '), new Map(), moduleNameMap);
  if (typeExpression === null) {
    return null;
  }
  return {
    field: {
      name: fieldName,
      typeExpression,
      readonly: false,
      private: plainClassFieldIsPrivate(pythonName),
      defaultValueLines: assignment.assignment.valueLines,
    },
    pythonName,
    nextIndex: index + assignment.nextIndex,
  };
}

function recordPlainClassFieldMarkers(
  pythonFieldName: string,
  fieldName: string,
  typeExpression: string,
  arrayNames: Set<string>,
  mapNames: Set<string>,
  pythonType: string | null = null,
): void {
  if (typeExpression.trim().endsWith('[]')) {
    arrayNames.add(`self.${pythonFieldName}`);
    arrayNames.add(`this.${fieldName}`);
    if (typeExpression.includes('[') && typeExpression.includes(']')) {
      arrayNames.add(tupleElementArrayNameMarker(`self.${pythonFieldName}`));
      arrayNames.add(tupleElementArrayNameMarker(`this.${fieldName}`));
    }
  }
  if (typeExpression.startsWith('Map<') || typeExpression.startsWith('ReadonlyMap<')) {
    mapNames.add(`self.${pythonFieldName}`);
    mapNames.add(`this.${fieldName}`);
    if (pythonType !== null && pythonMapTypeHasTupleKey(pythonType)) {
      mapNames.add(tupleKeyMapNameMarker(`self.${pythonFieldName}`));
      mapNames.add(tupleKeyMapNameMarker(`this.${fieldName}`));
    }
    if (/Map<[^,]+, [^>]*\[]>/.test(typeExpression) || /ReadonlyMap<[^,]+, readonly [^>]*\[]>/.test(typeExpression)) {
      mapNames.add(arrayValueMapNameMarker(`self.${pythonFieldName}`));
      mapNames.add(arrayValueMapNameMarker(`this.${fieldName}`));
    }
  }
  if (typeExpression.startsWith('Record<')) {
    arrayNames.add(objectNameMarker(`self.${pythonFieldName}`));
    arrayNames.add(objectNameMarker(`this.${fieldName}`));
  }
}

export function parsePlainClass(
  lines: string[],
  index: number,
  moduleNameMap: ReadonlyMap<string, string> = new Map(),
  relativePath: string | null = null,
  imports: ImportDefinition[] | null = null,
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
  nextIndex = skipSlotsAssignment(lines, nextIndex);
  while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
    nextIndex += 1;
  }
  if ((lines[nextIndex] ?? '').startsWith('    ') && lines[nextIndex].trim() === 'pass') {
    return {
      plainClass: {
        name: className,
        ...(extendsName === undefined ? {} : { extendsName }),
        docstring: docstring?.value ?? null,
        fields: [],
        constructorDefinition: {
          parameters: [],
          optsParams: [],
          statements: [],
        },
        methods: [],
      },
      nextIndex: nextIndex + 1,
    };
  }

  const fieldMap = new Map<string, PlainClassDefinition['fields'][number]>();
  const fieldNameMap = new Map<string, string>();
  const fieldArrayNames = new Set<string>();
  const fieldMapNames = new Set<string>();
  while (nextIndex < lines.length) {
    const classField = parsePlainClassFieldAssignment(lines, nextIndex, moduleNameMap);
    if (classField === null) {
      break;
    }
    fieldNameMap.set(classField.pythonName, classField.field.name);
    recordPlainClassFieldMarkers(classField.pythonName, classField.field.name, classField.field.typeExpression, fieldArrayNames, fieldMapNames);
    if (!plainClassBaseDeclaresField(extendsName, classField.field.name, moduleNameMap)) {
      fieldMap.set(classField.field.name, classField.field);
    }
    nextIndex = classField.nextIndex;
    while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
      nextIndex += 1;
    }
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
  const constructorStatements: string[] = [];
  const constructorNameMap = new Map<string, string>([...moduleNameMap, ['self', 'this']]);
  const constructorMapNames = new Set<string>(fieldMapNames);
  for (const parameter of constructorParams.parameters) {
    constructorNameMap.set(parameter.name, parameter.name);
  }
  for (const parameter of constructorParams.optsParams) {
    constructorNameMap.set(parameter.name, parameter.name);
  }
  for (const pythonParameterName of pythonParameterNames(constructorParametersText === 'self' ? '' : constructorParametersText.slice('self, '.length))) {
    constructorNameMap.set(pythonParameterName, tsExportNameForPythonName(pythonParameterName));
  }
  const constructorExtraParametersText = constructorParametersText === 'self' ? '' : constructorParametersText.slice('self, '.length);
  const constructorDeclaredNames = new Set<string>(pythonParameterNames(constructorExtraParametersText));
  const constructorReassignedNames = constructorHeader === null
    ? new Set<string>()
    : reassignedLocalNames(lines, constructorHeader.nextIndex);
  let bodyIndex = constructorHeader?.nextIndex ?? nextIndex;
  if (constructorHeader !== null) {
    while (bodyIndex < lines.length && isIndentedBlockLine(lines, bodyIndex, '        ')) {
      if (lines[bodyIndex].trim() === '') {
        constructorStatements.push('');
        bodyIndex += 1;
        continue;
      }
      const statement = lines[bodyIndex].slice('        '.length);
      const localConstructorAssignment = /^([A-Za-z_][A-Za-z0-9_]*) = (_?[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)?)\($/.exec(statement);
      if (localConstructorAssignment !== null) {
        fieldTypes.set(
          tsExportNameForPythonName(localConstructorAssignment[1]),
          inferConstructorCallTypeExpression(localConstructorAssignment[2], constructorNameMap, constructorArrayNames, constructorMapNames),
        );
      }
      const annotatedFieldAssignment = /^self\.([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(statement);
      const fieldAssignment = /^self\.([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(statement);
      const assignment = annotatedFieldAssignment ?? fieldAssignment;
      if (assignment !== null) {
        const pythonFieldName = assignment[1];
        const fieldName = tsAttributeNameForPythonName(pythonFieldName);
        fieldNameMap.set(pythonFieldName, fieldName);
        const valueText = annotatedFieldAssignment === null ? assignment[2] : assignment[3];
        const multilineConstructorCall = /^(_?[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)?)\($/.exec(valueText.trim());
        const typeExpression = annotatedFieldAssignment === null
          ? multilineConstructorCall === null
            ? inferPlainClassFieldType(valueText, fieldTypes, constructorNameMap)
            : inferConstructorCallTypeExpression(multilineConstructorCall[1], constructorNameMap, constructorArrayNames, constructorMapNames)
          : tsTypeExpression(assignment[2]);
        if (typeExpression === null) {
          return null;
        }
        if (multilineConstructorCall !== null) {
          const pythonType = annotatedFieldAssignment === null ? null : assignment[2];
          recordPlainClassFieldMarkers(pythonFieldName, fieldName, typeExpression, fieldArrayNames, fieldMapNames, pythonType);
          recordPlainClassFieldMarkers(pythonFieldName, fieldName, typeExpression, constructorArrayNames, constructorMapNames, pythonType);
          if (!plainClassBaseDeclaresField(extendsName, fieldName, moduleNameMap)) {
            fieldMap.set(fieldName, {
              name: fieldName,
              typeExpression,
              readonly: false,
              private: plainClassFieldIsPrivate(pythonFieldName),
            });
          }
          constructorNameMap.set(pythonFieldName, fieldName);
          const translated = translateStraightLineStatement(
            lines,
            bodyIndex,
            '        ',
            constructorNameMap,
            constructorDeclaredNames,
            constructorReassignedNames,
            constructorArrayNames,
            new Set(),
            relativePath,
            constructorMapNames,
            imports,
          );
          if (translated === null) {
            return null;
          }
          constructorStatements.push(...translated.statements);
          bodyIndex = translated.nextIndex;
          continue;
        }
        const value = valueText.trim() === '{}' && (typeExpression.startsWith('Map<') || typeExpression.startsWith('ReadonlyMap<'))
          ? 'new Map()'
          : translateExpression(valueText, constructorNameMap, constructorArrayNames, new Set(), constructorMapNames);
        const pythonType = annotatedFieldAssignment === null ? null : assignment[2];
        recordPlainClassFieldMarkers(pythonFieldName, fieldName, typeExpression, fieldArrayNames, fieldMapNames, pythonType);
        recordPlainClassFieldMarkers(pythonFieldName, fieldName, typeExpression, constructorArrayNames, constructorMapNames, pythonType);
        if (!plainClassBaseDeclaresField(extendsName, fieldName, moduleNameMap)) {
          fieldMap.set(fieldName, {
            name: fieldName,
            typeExpression,
            readonly: false,
            private: plainClassFieldIsPrivate(pythonFieldName),
          });
        }
        constructorStatements.push(`this.${fieldName} = ${value};`);
        constructorNameMap.set(pythonFieldName, fieldName);
        bodyIndex += 1;
        continue;
      }
      const translated = translateStraightLineStatement(
        lines,
        bodyIndex,
        '        ',
        constructorNameMap,
        constructorDeclaredNames,
        constructorReassignedNames,
        constructorArrayNames,
        new Set(),
        relativePath,
        constructorMapNames,
        imports,
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
  const classNameMap = new Map(moduleNameMap);
  collectPlainClassMethodAssignedFields(
    lines,
    bodyIndex,
    fieldTypes,
    moduleNameMap,
    extendsName,
    fieldMap,
    fieldNameMap,
    fieldArrayNames,
    fieldMapNames,
  );
  classNameMap.set(receiverTypeNameMarker('self'), className);
  classNameMap.set(receiverTypeNameMarker('this'), className);
  if (extendsName !== undefined) {
    classNameMap.set(classBaseTypeMarker(className), extendsName);
  }
  recordPlainClassFieldTypes(classNameMap, className, fieldMap);
  recordPlainClassMethodHeaders(lines, bodyIndex, className, classNameMap);
  const pendingMethodComments: string[] = [];
  const takePendingMethodComments = (): string[] | undefined => {
    if (pendingMethodComments.length === 0) {
      return undefined;
    }
    const comments = [...pendingMethodComments];
    pendingMethodComments.length = 0;
    return comments;
  };
  const pendingMethodCommentFields = (): Pick<SimpleModuleFunction, 'leadingComments'> | Record<string, never> => {
    const comments = takePendingMethodComments();
    return comments === undefined ? {} : { leadingComments: comments };
  };
  nextIndex = bodyIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (trimmed.startsWith('#')) {
      pendingMethodComments.push(trimmed.replace(/^# ?/, ''));
      nextIndex += 1;
      continue;
    }
    if (!lines[nextIndex].startsWith('    ')) {
      break;
    }
    if (trimmed === '@property') {
      const propertyMethod = parsePlainClassMethod(lines, nextIndex + 1, fieldNameMap, classNameMap, false, fieldArrayNames, fieldMapNames, null, relativePath, imports);
      if (propertyMethod === null || propertyMethod.method.parameters.length > 0 || propertyMethod.method.optsParams.length > 0) {
        return null;
      }
      methods.push({
        ...propertyMethod.method,
        ...pendingMethodCommentFields(),
        name: `get ${propertyMethod.method.name}`,
      });
      recordPlainClassMethodReturnType(classNameMap, className, propertyMethod.method);
      nextIndex = propertyMethod.nextIndex;
      continue;
    }
    const propertySetter = /^@([A-Za-z_][A-Za-z0-9_]*)\.setter$/.exec(trimmed);
    if (propertySetter !== null) {
      const setterMethod = parsePlainClassMethod(lines, nextIndex + 1, fieldNameMap, classNameMap, false, fieldArrayNames, fieldMapNames, null, relativePath, imports);
      if (
        setterMethod === null
        || setterMethod.method.name !== tsExportNameForPythonName(propertySetter[1])
        || setterMethod.method.parameters.length !== 1
        || setterMethod.method.optsParams.length > 0
      ) {
        return null;
      }
      methods.push({
        ...setterMethod.method,
        ...pendingMethodCommentFields(),
        name: `set ${setterMethod.method.name}`,
      });
      recordPlainClassMethodReturnType(classNameMap, className, setterMethod.method);
      nextIndex = setterMethod.nextIndex;
      continue;
    }
    if (trimmed === '@staticmethod') {
      const staticMethod = parsePlainClassMethod(lines, nextIndex + 1, fieldNameMap, classNameMap, true, fieldArrayNames, fieldMapNames, null, relativePath, imports);
      if (staticMethod === null) {
        return null;
      }
      methods.push({
        ...staticMethod.method,
        ...pendingMethodCommentFields(),
      });
      staticMethodNames.add(staticMethod.method.name);
      recordPlainClassMethodReturnType(classNameMap, className, staticMethod.method);
      nextIndex = staticMethod.nextIndex;
      continue;
    }
    if (trimmed === '@classmethod') {
      const classMethod = parsePlainClassMethod(lines, nextIndex + 1, fieldNameMap, classNameMap, true, fieldArrayNames, fieldMapNames, className, relativePath, imports);
      if (classMethod === null) {
        return null;
      }
      methods.push({
        ...classMethod.method,
        ...pendingMethodCommentFields(),
      });
      staticMethodNames.add(classMethod.method.name);
      recordPlainClassMethodReturnType(classNameMap, className, classMethod.method);
      nextIndex = classMethod.nextIndex;
      continue;
    }
    const method = parsePlainClassMethod(lines, nextIndex, fieldNameMap, classNameMap, false, fieldArrayNames, fieldMapNames, null, relativePath, imports);
    if (method === null) {
      return null;
    }
    methods.push({
      ...method.method,
      ...pendingMethodCommentFields(),
    });
    recordPlainClassMethodReturnType(classNameMap, className, method.method);
    nextIndex = method.nextIndex;
  }

  refineAnyFieldsFromConstructorAssignments(fieldMap, methods);

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
    readonly: field.readonly && !mutableFields.has(field.name),
  }));
  const methodsWithBaseSignatures = adaptPlainClassMethodsToBaseSignatures(methods, extendsName, classNameMap);
  const abstractHookMethods = methodsWithBaseSignatures
    .filter(isNotImplementedHookMethod)
    .map(abstractHookMethodDefinition);
  const abstractHookMethodByName = new Map(abstractHookMethods.map((method) => [method.name, method]));
  const rewrittenMethods = methodsWithBaseSignatures.map((method) => (
    method.static === true
      ? abstractHookMethodByName.get(method.name) ?? method
      : {
        ...(abstractHookMethodByName.get(method.name) ?? method),
        statements: rewritePlainClassAbstractHookCalls(
          rewritePlainClassStaticMethodCalls(method.statements, className, staticMethodNames),
          abstractHookMethods,
        ),
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

function collectPlainClassMethodAssignedFields(
  lines: string[],
  startIndex: number,
  fieldTypes: ReadonlyMap<string, string>,
  moduleNameMap: ReadonlyMap<string, string>,
  extendsName: string | undefined,
  fieldMap: Map<string, PlainClassDefinition['fields'][number]>,
  fieldNameMap: Map<string, string>,
  fieldArrayNames: Set<string>,
  fieldMapNames: Set<string>,
): void {
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      nextIndex += 1;
      continue;
    }
    if (!lines[nextIndex].startsWith('    ')) {
      break;
    }
    const decorator = trimmed === '@property' || trimmed === '@staticmethod' || trimmed === '@classmethod'
      ? trimmed
      : /^@[A-Za-z_][A-Za-z0-9_]*\.setter$/.test(trimmed) ? trimmed : null;
    const headerIndex = decorator === null ? nextIndex : nextIndex + 1;
    const header = parseIndentedFunctionHeader(lines, headerIndex, '    ');
    if (header === null) {
      nextIndex += 1;
      continue;
    }
    nextIndex = header.nextIndex;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, '        ')) {
      const statement = lines[nextIndex].slice('        '.length);
      const annotatedFieldAssignment = /^self\.([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(statement);
      const fieldAssignment = /^self\.([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(statement);
      const assignment = annotatedFieldAssignment ?? fieldAssignment;
      if (assignment !== null) {
        const pythonFieldName = assignment[1];
        const fieldName = tsAttributeNameForPythonName(pythonFieldName);
        const valueText = annotatedFieldAssignment === null ? assignment[2] : assignment[3];
        const pythonType = annotatedFieldAssignment === null ? null : assignment[2];
        const typeExpression = pythonType === null
          ? inferPlainClassFieldType(valueText, fieldTypes, moduleNameMap)
          : tsTypeExpression(pythonType);
        fieldNameMap.set(pythonFieldName, fieldName);
        if (typeExpression !== null) {
          recordPlainClassFieldMarkers(pythonFieldName, fieldName, typeExpression, fieldArrayNames, fieldMapNames, pythonType);
          if (!plainClassBaseDeclaresField(extendsName, fieldName, moduleNameMap) && !fieldMap.has(fieldName)) {
            fieldMap.set(fieldName, {
              name: fieldName,
              typeExpression,
              readonly: false,
              private: plainClassFieldIsPrivate(pythonFieldName),
              definiteAssignment: true,
            });
          }
        }
      }
      nextIndex += 1;
    }
  }
}

function plainClassFieldIsPrivate(pythonName: string): boolean {
  return pythonName.startsWith('_') && pythonName !== '_timeline_ms';
}

function plainClassBaseDeclaresField(
  extendsName: string | undefined,
  fieldName: string,
  nameMap: ReadonlyMap<string, string>,
): boolean {
  return extendsName !== undefined && nameMap.has(classFieldTypeMarker(extendsName, fieldName));
}

function recordPlainClassFieldTypes(
  nameMap: Map<string, string>,
  className: string,
  fieldMap: ReadonlyMap<string, PlainClassDefinition['fields'][number]>,
): void {
  for (const field of fieldMap.values()) {
    nameMap.set(classFieldTypeMarker(className, field.name), field.typeExpression);
  }
}

function recordPlainClassMethodHeaders(
  lines: string[],
  startIndex: number,
  className: string,
  nameMap: Map<string, string>,
): void {
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      nextIndex += 1;
      continue;
    }
    if (!lines[nextIndex].startsWith('    ')) {
      break;
    }
    const decorator = trimmed === '@property' || trimmed === '@staticmethod' || trimmed === '@classmethod'
      ? trimmed
      : /^@[A-Za-z_][A-Za-z0-9_]*\.setter$/.test(trimmed) ? trimmed : null;
    const headerIndex = decorator === null ? nextIndex : nextIndex + 1;
    const header = parseIndentedFunctionHeader(lines, headerIndex, '    ');
    if (header === null) {
      nextIndex += 1;
      continue;
    }
    if (header.name !== '__init__') {
      const methodName = tsAttributeNameForPythonName(header.name);
      const returnType = tsTypeExpression(header.returnType);
      nameMap.set(functionReturnTypeMarker(`this.${methodName}`), returnType);
      nameMap.set(functionReturnTypeMarker(`${className}.${methodName}`), returnType);
      const positionalNames = plainClassMethodSignaturePositionalNames(
        header.parametersText,
        decorator === '@staticmethod' || decorator === '@classmethod',
      );
      nameMap.set(instanceMethodSignatureMarker(className, methodName), JSON.stringify({ positional: positionalNames }));
    }
    nextIndex = header.nextIndex;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, '        ')) {
      nextIndex += 1;
    }
  }
}

function plainClassMethodSignaturePositionalNames(parametersText: string, staticMethod: boolean): string[] {
  const parts = parametersText === '' ? [] : splitTopLevelComma(parametersText);
  const names: string[] = [];
  const startIndex = staticMethod ? 0 : 1;
  for (const part of parts.slice(startIndex)) {
    if (part === '*') {
      break;
    }
    const name = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(part.trim())?.[1] ?? null;
    if (name !== null) {
      names.push(name);
    }
  }
  return names;
}

function isNotImplementedHookMethod(method: SimpleModuleFunction): boolean {
  return (
    method.static !== true
    && method.name.startsWith('_')
    && method.statements.length === 1
    && method.statements[0] === "throw new Error('NotImplementedError');"
  );
}

function abstractHookMethodDefinition(method: SimpleModuleFunction): SimpleModuleFunction {
  if (method.parameters.length === 0 || method.optsParams.length === 0) {
    return { ...method, abstract: true, statements: [] };
  }
  return {
    ...methodWithPositionalParametersAsOpts(method),
    abstract: true,
    statements: [],
  };
}

function adaptPlainClassMethodsToBaseSignatures(
  methods: SimpleModuleFunction[],
  extendsName: string | undefined,
  nameMap: ReadonlyMap<string, string>,
): SimpleModuleFunction[] {
  if (extendsName === undefined) {
    return methods;
  }
  return methods.map((method) => {
    if (
      method.static === true
      || method.parameters.length === 0
      || method.optsParams.length === 0
      || !baseMethodUsesOptsOnlySignature(extendsName, method.name, nameMap)
    ) {
      return method;
    }
    return methodWithPositionalParametersAsOpts(method);
  });
}

function methodWithPositionalParametersAsOpts(method: SimpleModuleFunction): SimpleModuleFunction {
  const combinedOpts: OptionalFunctionParameter[] = [
    ...method.parameters.map((parameter) => ({ ...parameter, defaultValue: null })),
    ...method.optsParams,
  ];
  return {
    ...method,
    parameters: [],
    optsParams: combinedOpts,
  };
}

function baseMethodUsesOptsOnlySignature(
  extendsName: string,
  methodName: string,
  nameMap: ReadonlyMap<string, string>,
): boolean {
  const signatureText = nameMap.get(instanceMethodSignatureMarker(extendsName, methodName));
  if (signatureText === undefined) {
    return false;
  }
  try {
    const signature = JSON.parse(signatureText) as { positional?: unknown };
    return Array.isArray(signature.positional) && signature.positional.length === 0;
  } catch {
    return false;
  }
}

function rewritePlainClassAbstractHookCalls(
  statements: string[],
  hookMethods: SimpleModuleFunction[],
): string[] {
  if (hookMethods.length === 0) {
    return statements;
  }
  const hooksByName = new Map(hookMethods.map((method) => [method.name, method]));
  return statements.map((statement) => {
    const call = /^this\.([A-Za-z_$][A-Za-z0-9_$]*)\((.*)\);$/.exec(statement.trim());
    if (call === null) {
      return statement;
    }
    const method = hooksByName.get(call[1]);
    if (method === undefined || method.parameters.length > 0 || method.optsParams.length === 0) {
      return statement;
    }
    const args = splitTopLevelComma(call[2]);
    const optsArg = args.at(-1)?.trim() ?? '';
    if (!optsArg.startsWith('{') || !optsArg.endsWith('}')) {
      return statement;
    }
    const positionalArgCount = args.length - 1;
    const positionalOpts = method.optsParams.slice(0, positionalArgCount);
    if (positionalOpts.length !== positionalArgCount) {
      return statement;
    }
    const optsParts = optsArg.slice(1, -1).trim() === ''
      ? []
      : splitTopLevelComma(optsArg.slice(1, -1)).map((part) => part.trim());
    const combinedOpts = [
      ...positionalOpts.map((param, index) => `${param.name}: ${args[index]}`),
      ...optsParts,
    ];
    return `this.${method.name}({ ${combinedOpts.join(', ')} });`;
  });
}

function refineAnyFieldsFromConstructorAssignments(
  fieldMap: Map<string, PlainClassDefinition['fields'][number]>,
  methods: SimpleModuleFunction[],
): void {
  for (const method of methods) {
    for (const statement of method.statements) {
      const constructorAssignment = /^this\.([A-Za-z_$][A-Za-z0-9_$]*) = new ([A-Z][A-Za-z0-9_$]*)\(/.exec(statement.trim());
      if (constructorAssignment === null) {
        continue;
      }
      const field = fieldMap.get(constructorAssignment[1]);
      if (field?.typeExpression !== 'any') {
        continue;
      }
      fieldMap.set(field.name, {
        ...field,
        typeExpression: `${constructorAssignment[2]} | null`,
      });
    }
  }
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

function recordPlainClassMethodReturnType(
  nameMap: Map<string, string>,
  className: string,
  method: SimpleModuleFunction,
): void {
  nameMap.set(functionReturnTypeMarker(`this.${method.name}`), method.returnType);
  nameMap.set(functionReturnTypeMarker(`${className}.${method.name}`), method.returnType);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferPlainClassFieldType(
  valueText: string,
  fieldTypes: ReadonlyMap<string, string>,
  nameMap: ReadonlyMap<string, string> = new Map(),
): string | null {
  if (valueText.trim() === 'None') {
    return 'any';
  }
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
  const noneGuardedConstructor = /^([A-Z_][A-Za-z0-9_]*)\(.+\) if ([A-Za-z_][A-Za-z0-9_]*) is None else \2$/.exec(valueText.trim());
  if (noneGuardedConstructor !== null) {
    const directType = fieldTypes.get(tsExportNameForPythonName(noneGuardedConstructor[2]));
    return directType === undefined
      ? tsExportNameForPythonName(noneGuardedConstructor[1])
      : directType
        .split(' | ')
        .filter((part) => part !== 'null' && part !== 'undefined')
        .join(' | ');
  }
  const maskedNumber = /^([A-Za-z_][A-Za-z0-9_]*) & 0x[0-9A-Fa-f]+$/.exec(valueText.trim());
  if (maskedNumber !== null) {
    const directType = fieldTypes.get(tsExportNameForPythonName(maskedNumber[1]));
    if (directType?.split(' | ').some((part) => part === 'number') === true) {
      return 'number';
    }
  }
  if (/^int\.from_bytes\(.+\)$/.test(valueText.trim())) {
    return 'number';
  }
  if (/^-?\d+(?:\.\d+)?(?:\s*[+\-*/]\s*(?:-?\d+(?:\.\d+)?|(?:int|float)\(.+\)|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?))*$/.test(valueText.trim())) {
    return 'number';
  }
  if (/^(?:max|min)\(/.test(valueText.trim())) {
    return 'number';
  }
  const constructorCall = /^_?([A-Z][A-Za-z0-9_]*)\(.*\)$/.exec(valueText.trim());
  if (constructorCall !== null) {
    return tsExportNameForPythonName(valueText.trim().slice(0, valueText.trim().indexOf('(')));
  }
  const functionCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\(.*\)$/.exec(valueText.trim());
  if (functionCall !== null) {
    const callee = translatedFunctionCallee(functionCall[1], nameMap);
    const returnType = nameMap.get(functionReturnTypeMarker(callee))
      ?? nameMap.get(functionReturnTypeMarker(functionCall[1]));
    if (returnType !== undefined) {
      return returnType;
    }
  }
  const directParameterType = fieldTypes.get(tsExportNameForPythonName(valueText));
  if (directParameterType !== undefined) {
    return directParameterType;
  }
  if (/^[A-Z][A-Z0-9_]*$/.test(valueText.trim())) {
    return 'number';
  }
  const literalType = inferPythonExpressionType(valueText);
  return literalType === 'any' ? null : literalType;
}

function translatedFunctionCallee(functionName: string, nameMap: ReadonlyMap<string, string>): string {
  return functionName
    .split('.')
    .map((part, index) => index === 0
      ? nameMap.get(part) ?? tsExportNameForPythonName(part)
      : tsExportNameForPythonName(part))
    .join('.');
}

function inferConstructorCallTypeExpression(
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  mapNames: ReadonlySet<string>,
): string {
  if (pythonCallee === 'Path') {
    return 'string';
  }
  return translateExpression(pythonCallee, nameMap, arrayNames, new Set(), mapNames);
}

function pythonMapTypeHasTupleKey(pythonType: string): boolean {
  const mapType = /^(?:dict|OrderedDict|defaultdict)\[(.+)\]$/.exec(pythonType.trim());
  if (mapType === null) {
    return false;
  }
  return splitTopLevelComma(mapType[1])[0]?.trim().startsWith('tuple[') === true;
}

function parsePlainClassMethod(
  lines: string[],
  index: number,
  fieldNameMap: Map<string, string>,
  moduleNameMap: ReadonlyMap<string, string>,
  staticMethod = false,
  initialArrayNames: ReadonlySet<string> = new Set(),
  initialMapNames: ReadonlySet<string> = new Set(),
  classBindingName: string | null = null,
  relativePath: string | null = null,
  imports: ImportDefinition[] | null = null,
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
  const mapNames = new Set<string>(initialMapNames);
  for (const parameter of [...parsedParams.parameters, ...parsedParams.optsParams]) {
    if (parameter.typeExpression.startsWith('Map<') || parameter.typeExpression.startsWith('ReadonlyMap<')) {
      mapNames.add(parameter.name);
    }
  }
  const nameMap = new Map<string, string>(moduleNameMap);
  if (classBindingName !== null) {
    if (classReceiver === null) {
      return null;
    }
    nameMap.set(classReceiver, classBindingName);
  } else if (!staticMethod) {
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
      new Set(),
      relativePath,
      mapNames,
      imports,
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
