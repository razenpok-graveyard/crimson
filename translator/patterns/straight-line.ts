import fs from 'node:fs';
import path from 'node:path';
import type {
  EnumDefinition,
  FunctionParameter,
  ImportDefinition,
  NamespaceImportDefinition,
  OptionalFunctionParameter,
  PlainClassDefinition,
  Reexport,
  SimpleModuleAssignment,
  SimpleModuleFunction,
  StraightLineModule,
  StructModule,
  TyperCliModule,
  TypeAlias,
} from '../model.js';
import {
  tsExportNameForPythonName,
  tsMutableNameForPythonName,
  tsPublicNameForPythonName,
  tsTypeExpression,
} from '../naming.js';
import { tsImportPathForPythonImport, tsTargetRoot } from '../paths.js';
import {
  flattenFromImportBlocks,
  isOneLineAllAssignment,
  splitLeadingModuleDocstring,
} from '../python-utils.js';
import { parseProtocolClass, parseTypeAliasValidation } from './basic.js';
import {
  identifierPattern,
  isBareTypeAliasExpression,
  isCollectionsAbcTypeImport,
  isIndentedBlockLine,
  isTypingOnlyImport,
  parseIndentedDocstring,
  parseOneLineAllNames,
  parseTypeCheckingImports,
  parseTypeCheckingTypeAliasFallback,
  splitTopLevelComma,
  stripTypeOnlyStatementSyntax,
} from './common.js';
import { parseStringEnumClass } from './enums.js';
import { objectNameMarker, setNameMarker, translateExpression } from './expression.js';
import { parseFunctionParameterText, pythonParameterNames } from './parameters.js';
import { bytesFromHelperStatements, constructBinaryHelperStatements } from './runtime-helpers.js';
import {
  parseStraightLineFunctionHeader,
  parseTopLevelAssignment,
  reassignedLocalNames,
  rewriteStructPositionalConstructors,
  translateStraightLineStatement,
} from './statements.js';
import { parsePlainClass, parseStructClass } from './structs.js';

export function parseStraightLineModule(trimmedPython: string, relativePath: string): StraightLineModule | null {
  const moduleDocstring = splitLeadingModuleDocstring(trimmedPython);
  const lines = flattenFromImportBlocks((moduleDocstring?.remainder.trim() ?? trimmedPython).split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  const namespaceImports: NamespaceImportDefinition[] = [];
  const leadingAssignments: SimpleModuleAssignment[] = [];
  const leadingStatements: string[] = [];
  const trailingStatements: string[] = [];
  const typeAliases: TypeAlias[] = [];
  const protocols: StraightLineModule['protocols'] = [];
  const enums: EnumDefinition[] = [];
  const validatedTypeAliases = new Set<string>();
  const classes: StructModule['classes'] = [];
  const plainClasses: PlainClassDefinition[] = [];
  const functions: SimpleModuleFunction[] = [];
  const assignments: SimpleModuleAssignment[] = [];
  const allNames: string[] = [];
  const moduleNameMap = new Map<string, string>();
  const mapNames = new Set<string>();
  const structConstructorFields = new Map<string, string[]>();
  const typeVarNames = new Set<string>();
  const setReturnFunctionNames = new Set<string>();
  const objectReturnFunctionNames = new Set<string>();
  const pendingAssignmentComments: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    if (trimmed.startsWith('#')) {
      pendingAssignmentComments.push(trimmed.replace(/^# ?/, ''));
      index += 1;
      continue;
    }
    if (trimmed.startsWith('def ')) {
      break;
    }
    if (trimmed.startsWith('__all__ = ')) {
      const allAssignment = parseAllAssignment(lines, index);
      if (allAssignment === null) {
        return null;
      }
      allNames.push(...allAssignment.names);
      index = allAssignment.nextIndex;
      continue;
    }
    if (trimmed === 'import os') {
      index += 1;
      continue;
    }
    if (trimmed === 'import math') {
      index += 1;
      continue;
    }
    if (trimmed === 'import struct') {
      index += 1;
      continue;
    }
    if (trimmed === 'import json') {
      index += 1;
      continue;
    }
    if (trimmed === 'import datetime' || trimmed === 'import datetime as dt') {
      index += 1;
      continue;
    }
    if (trimmed === 'import socket') {
      pushUniqueNamespaceImport(namespaceImports, {
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
      || isEnumOnlyImport(trimmed)
      || trimmed === 'from dataclasses import dataclass'
      || trimmed === 'from pathlib import Path'
      || trimmed === 'from threading import Lock'
      || trimmed.startsWith('from construct import ')
      || trimmed === 'import msgspec'
      || trimmed === 'import tempfile'
      || trimmed === 'import typer'
      || trimmed === 'import warnings'
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
    if (isStructFloatHelperAssignment(trimmed)) {
      index += 1;
      continue;
    }
    const typeVar = parseTypeVarAssignment(trimmed);
    if (typeVar !== null) {
      typeVarNames.add(typeVar);
      index += 1;
      continue;
    }

    const typeAlias = parseTypeAliasStatement(lines, index);
    if (typeAlias !== null) {
      typeAliases.push(typeAlias.alias);
      if (typeAlias.alias.validation !== undefined) {
        validatedTypeAliases.add(typeAlias.alias.name);
      }
      index = typeAlias.nextIndex;
      continue;
    }

    const stringEnumClass = parseStringEnumClass(lines, index);
    if (stringEnumClass !== null) {
      enums.push(stringEnumClass.enumDefinition);
      moduleNameMap.set(stringEnumClass.enumDefinition.name, stringEnumClass.enumDefinition.name);
      index = stringEnumClass.nextIndex;
      continue;
    }

    const protocolClass = parseProtocolClass(lines, index);
    if (protocolClass !== null) {
      protocols.push(protocolClass.protocol);
      index = protocolClass.nextIndex;
      continue;
    }

    const structClass = parseStructClass(lines, index, moduleNameMap, mapNames);
    if (structClass !== null) {
      classes.push(structClass.structClass);
      structConstructorFields.set(structClass.structClass.name, structClass.structClass.fields.map((field) => field.name));
      index = structClass.nextIndex;
      continue;
    }

    const plainClass = parsePlainClass(lines, index);
    if (plainClass !== null) {
      plainClasses.push(plainClass.plainClass);
      index = plainClass.nextIndex;
      continue;
    }

    const exceptionClass = parseSimpleExceptionClass(lines, index);
    if (exceptionClass !== null) {
      leadingStatements.push(...exceptionClass.statements);
      moduleNameMap.set(exceptionClass.name, exceptionClass.name);
      index = exceptionClass.nextIndex;
      continue;
    }

    const aliasedFromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*) as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (aliasedFromImport !== null) {
      const aliasName = tsExportNameForPythonName(aliasedFromImport[3]);
      const modulePath = tsImportPathForPythonImport(aliasedFromImport[1], relativePath);
      const importedName = tsImportNameForPythonName(modulePath, aliasedFromImport[2], relativePath);
      imports.push({
        modulePath,
        names: [`${importedName} as ${aliasName}`],
      });
      recordImportedStructConstructorFields(
        modulePath,
        [{ importedName, localName: aliasName }],
        relativePath,
        structConstructorFields,
      );
      moduleNameMap.set(aliasedFromImport[3], aliasName);
      index += 1;
      continue;
    }

    const raylibApiImport = /^from grim\.raylib_api import ((?:r[dl])(?:, r[dl])*)$/.exec(trimmed);
    if (raylibApiImport !== null) {
      const names = raylibApiImport[1].split(', ');
      pushUniqueImportDefinition(imports, {
        modulePath: tsImportPathForPythonImport('grim.raylib_api', relativePath),
        names,
      });
      pushUniqueNamespaceImport(namespaceImports, {
        alias: 'wgl',
        modulePath: '@wgl',
      });
      for (const name of names) {
        moduleNameMap.set(name, 'wgl');
      }
      index += 1;
      continue;
    }

    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromImport !== null) {
      const modulePath = tsImportPathForPythonImport(fromImport[1], relativePath);
      const importBindings = fromImport[2].split(', ').map((name) => ({
        pythonName: name,
        importedName: tsImportNameForPythonName(modulePath, name, relativePath),
        defaultName: tsExportNameForPythonName(name),
      }));
      imports.push({
        modulePath,
        names: importBindings.map((binding) => binding.importedName),
      });
      recordImportedStructConstructorFields(
        modulePath,
        importBindings.map((binding) => ({ importedName: binding.importedName, localName: binding.importedName })),
        relativePath,
        structConstructorFields,
      );
      for (const binding of importBindings) {
        if (binding.importedName !== binding.defaultName) {
          moduleNameMap.set(binding.pythonName, binding.importedName);
        }
      }
      index += 1;
      continue;
    }

    const namespaceImport = /^from (\.+) import ([A-Za-z_][A-Za-z0-9_]*) as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (namespaceImport !== null) {
      const alias = tsExportNameForPythonName(namespaceImport[3]);
      namespaceImports.push({
        alias,
        modulePath: tsImportPathForPythonImport(`${namespaceImport[1]}${namespaceImport[2]}`, relativePath),
      });
      moduleNameMap.set(namespaceImport[3], alias);
      index += 1;
      continue;
    }

    const assignment = parseTopLevelAssignment(lines, index, moduleNameMap);
    if (assignment === null) {
      const topLevelStatement = translateStraightLineStatement(
        lines,
        index,
        '',
        moduleNameMap,
        new Set(),
        new Set(),
        new Set(),
        validatedTypeAliases,
        relativePath,
        mapNames,
      );
      if (topLevelStatement === null) {
        return null;
      }
      leadingStatements.push(...topLevelStatement.statements);
      index = topLevelStatement.nextIndex;
      continue;
    }
    attachPendingAssignmentComments(assignment.assignment, pendingAssignmentComments);
    avoidImportedPrivateNameCollision(assignment.assignment, imports);
    leadingAssignments.push(assignment.assignment);
    const namedAssignment = /^([A-Za-z_][A-Za-z0-9_]*)(?:: .+?)? = /.exec(lines[index] ?? '');
    if (namedAssignment !== null) {
      moduleNameMap.set(namedAssignment[1], assignment.assignment.name);
      if (assignment.assignment.typeExpression?.startsWith('Map<') === true) {
        mapNames.add(assignment.assignment.name);
      }
    }
    index = assignment.nextIndex;
  }

  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === '') {
      index += 1;
    }
    if ((lines[index] ?? '').trim().startsWith('__all__ = ')) {
      break;
    }
    if ((lines[index] ?? '').trim().startsWith('#')) {
      pendingAssignmentComments.push((lines[index] ?? '').trim().replace(/^# ?/, ''));
      index += 1;
      continue;
    }

    const typeCheckingAlias = parseTypeCheckingTypeAliasFallback(lines, index, relativePath);
    if (typeCheckingAlias !== null) {
      imports.push(...typeCheckingAlias.imports);
      typeAliases.push(...typeCheckingAlias.typeAliases);
      index = typeCheckingAlias.nextIndex;
      continue;
    }
    if ((lines[index] ?? '').trim() === 'if TYPE_CHECKING:') {
      const typeCheckingImports = parseTypeCheckingImports(lines, index, relativePath);
      if (typeCheckingImports === null) {
        return null;
      }
      imports.push(...typeCheckingImports.imports);
      index = typeCheckingImports.nextIndex;
      continue;
    }
    if (isStructFloatHelperAssignment((lines[index] ?? '').trim())) {
      pendingAssignmentComments.length = 0;
      index += 1;
      continue;
    }
    const typeVar = parseTypeVarAssignment((lines[index] ?? '').trim());
    if (typeVar !== null) {
      typeVarNames.add(typeVar);
      pendingAssignmentComments.length = 0;
      index += 1;
      continue;
    }

    const interleavedAssignment = parseTopLevelAssignment(lines, index, moduleNameMap);
    if (interleavedAssignment !== null) {
      attachPendingAssignmentComments(interleavedAssignment.assignment, pendingAssignmentComments);
      avoidImportedPrivateNameCollision(interleavedAssignment.assignment, imports);
      assignments.push(interleavedAssignment.assignment);
      const namedAssignment = /^([A-Za-z_][A-Za-z0-9_]*)(?:: .+?)? = /.exec(lines[index] ?? '');
      if (namedAssignment !== null) {
        moduleNameMap.set(namedAssignment[1], interleavedAssignment.assignment.name);
        if (interleavedAssignment.assignment.typeExpression?.startsWith('Map<') === true) {
          mapNames.add(interleavedAssignment.assignment.name);
        }
      }
      index = interleavedAssignment.nextIndex;
      continue;
    }

    if (!(lines[index] ?? '').startsWith('def ')) {
      const protocolClass = parseProtocolClass(lines, index);
      if (protocolClass !== null) {
        protocols.push(protocolClass.protocol);
        index = protocolClass.nextIndex;
        continue;
      }

      const structClass = parseStructClass(lines, index, moduleNameMap, mapNames);
      if (structClass !== null) {
        classes.push(structClass.structClass);
        structConstructorFields.set(structClass.structClass.name, structClass.structClass.fields.map((field) => field.name));
        index = structClass.nextIndex;
        continue;
      }

      const plainClass = parsePlainClass(lines, index);
      if (plainClass !== null) {
        plainClasses.push(plainClass.plainClass);
        index = plainClass.nextIndex;
        continue;
      }

      const exceptionClass = parseSimpleExceptionClass(lines, index);
      if (exceptionClass !== null) {
        trailingStatements.push(...exceptionClass.statements);
        moduleNameMap.set(exceptionClass.name, exceptionClass.name);
        index = exceptionClass.nextIndex;
        continue;
      }

      break;
    }

    const header = parseStraightLineFunctionHeader(lines, index);
    if (header === null) {
      return null;
    }
    index = header.nextIndex;

    const parameters: FunctionParameter[] = [];
    const optsParams: OptionalFunctionParameter[] = [];
    const arrayNames = new Set<string>();
    const functionMapNames = new Set(mapNames);
    for (const name of setReturnFunctionNames) {
      arrayNames.add(setNameMarker(name));
    }
    for (const name of objectReturnFunctionNames) {
      arrayNames.add(objectNameMarker(name));
    }
    let keywordOnly = false;
    if (header.parametersText !== '') {
      for (const parameterText of splitTopLevelComma(header.parametersText)) {
        if (parameterText === '*') {
          keywordOnly = true;
          continue;
        }
        const parameter = parseFunctionParameterText(parameterText, arrayNames);
        if (parameter === null) {
          return null;
        }
        const parameterName = /^\*\*?([A-Za-z_][A-Za-z0-9_]*)|^([A-Za-z_][A-Za-z0-9_]*)/.exec(parameterText);
        const pythonParameterName = parameterName?.[1] ?? parameterName?.[2] ?? null;
        if (parameter.typeExpression.startsWith('Map<')) {
          functionMapNames.add(parameter.name);
          if (pythonParameterName !== null) {
            functionMapNames.add(pythonParameterName);
          }
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

    const statements: string[] = [];
    const nameMap = new Map(moduleNameMap);
    const declaredNames = new Set<string>(pythonParameterNames(header.parametersText));
    const docstring = parseIndentedDocstring(lines, index);
    if (docstring !== null) {
      for (const line of docstring.value.split('\n')) {
        statements.push(line === '' ? '//' : `// ${line}`);
      }
      index = docstring.nextIndex;
    }
    const reassignedNames = reassignedLocalNames(lines, index);
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '') {
        if ((lines[index + 1] ?? '').startsWith('    ')) {
          if (statements.length > 0 && statements.at(-1) !== '') {
            statements.push('');
          }
          index += 1;
          continue;
        }
        index += 1;
        break;
      }
      if (!isIndentedBlockLine(lines, index, '    ')) {
        break;
      }
      const statement = translateStraightLineStatement(
        lines,
        index,
        '    ',
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        relativePath,
        functionMapNames,
        imports,
      );
      if (statement === null) {
        return null;
      }
      statements.push(...statement.statements);
      index = statement.nextIndex;
    }

    const returnType = tsTypeExpression(header.returnType);
    functions.push({
      name: tsExportNameForPythonName(header.name),
      exported: !header.name.startsWith('_'),
      async: statements.some((statement) => statement.includes('await ')),
      typeParams: simpleFunctionTypeParams(typeVarNames, parameters, optsParams, returnType),
      parameters,
      optsParams,
      returnType,
      statements,
    });
    moduleNameMap.set(header.name, tsExportNameForPythonName(header.name));
    if (returnType.startsWith('Set<') || returnType.startsWith('ReadonlySet<')) {
      setReturnFunctionNames.add(tsExportNameForPythonName(header.name));
    }
    if (returnType === 'BuiltinObject' || returnType.startsWith('Record<')) {
      objectReturnFunctionNames.add(tsExportNameForPythonName(header.name));
    }
  }

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('__all__ = ')) {
      const allAssignment = parseAllAssignment(lines, index);
      if (allAssignment === null) {
        return null;
      }
      allNames.push(...allAssignment.names);
      index = allAssignment.nextIndex;
      continue;
    }
    if (trimmed.startsWith('#')) {
      pendingAssignmentComments.push(trimmed.replace(/^# ?/, ''));
      index += 1;
      continue;
    }

    const typeCheckingAlias = parseTypeCheckingTypeAliasFallback(lines, index, relativePath);
    if (typeCheckingAlias !== null) {
      imports.push(...typeCheckingAlias.imports);
      typeAliases.push(...typeCheckingAlias.typeAliases);
      index = typeCheckingAlias.nextIndex;
      continue;
    }
    if (trimmed === 'if TYPE_CHECKING:') {
      const typeCheckingImports = parseTypeCheckingImports(lines, index, relativePath);
      if (typeCheckingImports === null) {
        return null;
      }
      imports.push(...typeCheckingImports.imports);
      index = typeCheckingImports.nextIndex;
      continue;
    }
    if (isStructFloatHelperAssignment(trimmed)) {
      pendingAssignmentComments.length = 0;
      index += 1;
      continue;
    }
    const typeVar = parseTypeVarAssignment(trimmed);
    if (typeVar !== null) {
      typeVarNames.add(typeVar);
      pendingAssignmentComments.length = 0;
      index += 1;
      continue;
    }

    const assignment = parseTopLevelAssignment(lines, index, moduleNameMap);
    if (assignment === null) {
      const trailingStatement = translateStraightLineStatement(
        lines,
        index,
        '',
        moduleNameMap,
        new Set(),
        new Set(),
        new Set(),
        validatedTypeAliases,
        relativePath,
        mapNames,
      );
      if (trailingStatement === null) {
        return null;
      }
      trailingStatements.push(...trailingStatement.statements);
      index = trailingStatement.nextIndex;
      continue;
    }
    attachPendingAssignmentComments(assignment.assignment, pendingAssignmentComments);
    avoidImportedPrivateNameCollision(assignment.assignment, imports);
    assignments.push(assignment.assignment);
    if (assignment.assignment.typeExpression?.startsWith('Map<') === true) {
      mapNames.add(assignment.assignment.name);
    }
    index = assignment.nextIndex;
  }

  if (allNames.length === 0 && functions.length > 0 && functions.every((fn) => !fn.exported)) {
    for (const fn of functions) {
      fn.exported = true;
    }
  }

  rewriteStructConstructorCalls(
    structConstructorFields,
    leadingStatements,
    trailingStatements,
    functions,
    [...leadingAssignments, ...assignments],
    classes,
    plainClasses,
  );

  if (straightLineModuleUsesPythonRepr([...leadingStatements, ...trailingStatements], classes, plainClasses, functions, [...leadingAssignments, ...assignments])) {
    const helperStatements = pythonReprHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (straightLineModuleUsesStructFloatBuffers([...leadingStatements, ...trailingStatements], classes, plainClasses, functions, [...leadingAssignments, ...assignments])) {
    const helperStatements = structFloatBufferStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  const moduleValueText = moduleValueUsageText(typeAliases, protocols, classes, plainClasses, [...leadingStatements, ...trailingStatements], functions, [...leadingAssignments, ...assignments]);
  if (moduleValueText.includes('latin1EncodeReplace(')) {
    const helperStatements = latin1EncodeReplaceHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('pythonStringCount(')) {
    const helperStatements = pythonStringCountHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('pythonJsonDumps(')) {
    const helperStatements = pythonJsonDumpsHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('pythonEquals(')) {
    const helperStatements = pythonEqualsHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  const pathHelperStatements: string[] = [];
  if (moduleValueText.includes('_strftimeUtcNow(')) {
    pathHelperStatements.push(...strftimeUtcNowHelperStatements());
  }
  if (moduleValueText.includes('_pathJoin(')) {
    if (pathHelperStatements.length > 0) {
      pathHelperStatements.push('');
    }
    pathHelperStatements.push(...pathJoinHelperStatements());
  }
  if (moduleValueText.includes('_dirname(') || moduleValueText.includes('_mkdirParents(')) {
    if (pathHelperStatements.length > 0) {
      pathHelperStatements.push('');
    }
    pathHelperStatements.push(...pathFsHelperStatements());
  }
  if (moduleValueText.includes('_openTextFile(')) {
    if (pathHelperStatements.length > 0) {
      pathHelperStatements.push('');
    }
    pathHelperStatements.push(...openTextFileHelperStatements());
  }
  if (pathHelperStatements.length > 0) {
    if (leadingStatements.length > 0) {
      pathHelperStatements.push('');
    }
    leadingStatements.unshift(...pathHelperStatements);
  }
  if (moduleValueText.includes('constructStruct(')) {
    const helperStatements = constructBinaryHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  } else if (moduleValueText.includes('bytesFrom(')) {
    const helperStatements = bytesFromHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (
    moduleValueText.includes('readFileSync(')
    || moduleValueText.includes('writeFileSync(')
    || moduleValueText.includes('appendFileSync(')
    || moduleValueText.includes('_openTextFile(')
    || moduleValueText.includes('_mkdirParents(')
  ) {
    pushUniqueImportDefinition(imports, {
      modulePath: 'node:fs',
      names: [
        ...(moduleValueText.includes('readFileSync(') ? ['readFileSync'] : []),
        ...(moduleValueText.includes('writeFileSync(') || moduleValueText.includes('_openTextFile(') ? ['writeFileSync'] : []),
        ...(moduleValueText.includes('appendFileSync(') || moduleValueText.includes('_openTextFile(') ? ['appendFileSync'] : []),
        ...(moduleValueText.includes('_mkdirParents(') ? ['mkdirSync'] : []),
      ],
    });
  }

  const reexports = reexportsForAllNames(imports, allNames, relativePath);
  markTypeOnlyImports(imports, typeAliases, protocols, classes, plainClasses, [...leadingStatements, ...trailingStatements], functions, [...leadingAssignments, ...assignments]);
  markNamespaceImports(namespaceImports, moduleValueUsageText(typeAliases, protocols, classes, plainClasses, [...leadingStatements, ...trailingStatements], functions, [...leadingAssignments, ...assignments]));
  if (allNames.length > 0) {
    const exportedNames = new Set(allNames.map(tsPublicNameForPythonName));
    for (const alias of typeAliases) {
      alias.exported = exportedNames.has(alias.name);
    }
    for (const fn of functions) {
      fn.exported = exportedNames.has(fn.name);
    }
    for (const assignment of [...leadingAssignments, ...assignments]) {
      const publicName = tsPublicNameForPythonName(assignment.pythonName ?? assignment.name);
      assignment.exported = exportedNames.has(publicName);
      if (assignment.exported) {
        assignment.name = publicName;
      }
    }
  }

  return typeAliases.length + protocols.length + enums.length + leadingAssignments.length + leadingStatements.length + classes.length + plainClasses.length + functions.length + trailingStatements.length + assignments.length + reexports.length > 0
    ? { docstring: moduleDocstring?.value ?? null, imports, namespaceImports, reexports, typeAliases, protocols, enums, leadingAssignments, leadingStatements, classes, plainClasses, functions, trailingStatements, assignments }
    : null;
}

function isStructFloatHelperAssignment(trimmedLine: string): boolean {
  return /^_[A-Z0-9_]+ = struct\.Struct\("[^"]+"\)$/.test(trimmedLine)
    || /^_[A-Z0-9_]+ = _[A-Z0-9_]+\.(?:pack|unpack)$/.test(trimmedLine);
}

function isEnumOnlyImport(trimmedLine: string): boolean {
  const enumImport = /^from enum import (.+)$/.exec(trimmedLine);
  if (enumImport === null) {
    return false;
  }
  return enumImport[1].split(', ').every((name) => ['Enum', 'IntEnum', 'IntFlag'].includes(name));
}

function parseTypeVarAssignment(trimmedLine: string): string | null {
  const typeVar = /^([A-Za-z_][A-Za-z0-9_]*) = TypeVar\("([A-Za-z_][A-Za-z0-9_]*)"\)$/.exec(trimmedLine);
  if (typeVar === null || typeVar[1] !== typeVar[2]) {
    return null;
  }
  return tsPublicNameForPythonName(typeVar[1]);
}

function simpleFunctionTypeParams(
  typeVarNames: ReadonlySet<string>,
  parameters: readonly FunctionParameter[],
  optsParams: readonly OptionalFunctionParameter[],
  returnType: string,
): string[] | undefined {
  if (typeVarNames.size === 0) {
    return undefined;
  }
  const typeText = [
    returnType,
    ...parameters.map((parameter) => parameter.typeExpression),
    ...optsParams.map((parameter) => parameter.typeExpression),
  ].join('\n');
  const usedTypeVars = [...typeVarNames].filter((name) => identifierPattern(name).test(typeText));
  return usedTypeVars.length === 0 ? undefined : usedTypeVars;
}

function straightLineModuleUsesPythonRepr(
  statements: string[],
  classes: StructModule['classes'],
  plainClasses: PlainClassDefinition[],
  functions: SimpleModuleFunction[],
  assignments: SimpleModuleAssignment[],
): boolean {
  return [
    ...statements,
    ...classes.flatMap((structClass) => [
      ...structClass.fields.map((field) => field.defaultValue ?? ''),
      ...structClass.postInitStatements,
      ...structClass.methods.flatMap((method) => method.statements),
    ]),
    ...plainClasses.flatMap((plainClass) => [
      ...plainClass.constructorDefinition.statements,
      ...plainClass.methods.flatMap((method) => method.statements),
    ]),
    ...functions.flatMap((fn) => fn.statements),
    ...assignments.flatMap((assignment) => assignment.valueLines),
  ].some((line) => line.includes('pythonRepr('));
}

function straightLineModuleUsesStructFloatBuffers(
  statements: string[],
  classes: StructModule['classes'],
  plainClasses: PlainClassDefinition[],
  functions: SimpleModuleFunction[],
  assignments: SimpleModuleAssignment[],
): boolean {
  return [
    ...statements,
    ...classes.flatMap((structClass) => [
      ...structClass.fields.map((field) => field.defaultValue ?? ''),
      ...structClass.postInitStatements,
      ...structClass.methods.flatMap((method) => method.statements),
    ]),
    ...plainClasses.flatMap((plainClass) => [
      ...plainClass.constructorDefinition.statements,
      ...plainClass.methods.flatMap((method) => method.statements),
    ]),
    ...functions.flatMap((fn) => fn.statements),
    ...assignments.flatMap((assignment) => assignment.valueLines),
  ].some((line) => line.includes('_f32buf') || line.includes('_u32buf'));
}

function moduleValueUsageText(
  typeAliases: TypeAlias[],
  protocols: StraightLineModule['protocols'],
  classes: StructModule['classes'],
  plainClasses: PlainClassDefinition[],
  statements: string[],
  functions: SimpleModuleFunction[],
  assignments: SimpleModuleAssignment[],
): string {
  return stripTypeOnlyStatementSyntax([
    ...typeAliases.flatMap((alias) => [
      alias.validation?.minLength ?? '',
      alias.validation?.maxLength ?? '',
      alias.validation?.pattern ?? '',
      alias.validation?.ge ?? '',
      alias.validation?.le ?? '',
    ]),
    ...classes.flatMap((structClass) => structClass.fields.map((field) => field.defaultValue ?? '')),
    ...classes.flatMap((structClass) => structClass.methods.flatMap((method) => method.statements)),
    ...protocols.flatMap((protocol) => protocol.methods.flatMap((method) => [
      ...method.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...method.optsParams.map((parameter) => parameter.defaultValue ?? ''),
    ])),
    ...plainClasses.flatMap((plainClass) => plainClass.constructorDefinition.statements),
    ...plainClasses.flatMap((plainClass) => plainClass.methods.flatMap((method) => method.statements)),
    ...statements,
    ...functions.flatMap((fn) => fn.statements),
    ...functions.flatMap((fn) => [
      ...fn.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...fn.optsParams.map((parameter) => parameter.defaultValue ?? ''),
    ]),
    ...assignments.flatMap((assignment) => assignment.valueLines),
  ].join('\n'));
}

function recordImportedStructConstructorFields(
  modulePath: string,
  names: { importedName: string; localName: string }[],
  relativePath: string,
  structConstructorFields: Map<string, string[]>,
): void {
  for (const name of names) {
    const fields = importedStructConstructorFields(modulePath, name.importedName, relativePath);
    if (fields !== null) {
      structConstructorFields.set(name.localName, fields);
    }
  }
}

function importedStructConstructorFields(modulePath: string, className: string, relativePath: string): string[] | null {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  if (sourcePath === null || !fs.existsSync(sourcePath)) {
    return null;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const escapedName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const classStart = source.search(new RegExp(`export\\s+class\\s+${escapedName}\\b`));
  if (classStart === -1) {
    return null;
  }
  const nextExport = source.slice(classStart + 1).search(/\nexport\s+/);
  const classSource = nextExport === -1
    ? source.slice(classStart)
    : source.slice(classStart, classStart + 1 + nextExport);
  const constructor = /constructor\(opts: \{([\s\S]*?)\}\s*=?.*?\)/.exec(classSource);
  if (constructor === null) {
    return null;
  }
  const fields = [...constructor[1].matchAll(/(?:^|[;\n])\s*([A-Za-z_$][A-Za-z0-9_$]*)\??:/g)]
    .map((match) => match[1]);
  return fields.length === 0 ? null : fields;
}

function rewriteStructConstructorCalls(
  structConstructorFields: ReadonlyMap<string, string[]>,
  leadingStatements: string[],
  trailingStatements: string[],
  functions: SimpleModuleFunction[],
  assignments: SimpleModuleAssignment[],
  classes: StructModule['classes'],
  plainClasses: PlainClassDefinition[],
): void {
  if (structConstructorFields.size === 0) {
    return;
  }
  rewriteStatementArray(leadingStatements, structConstructorFields);
  rewriteStatementArray(trailingStatements, structConstructorFields);
  for (const fn of functions) {
    rewriteStatementArray(fn.statements, structConstructorFields);
  }
  for (const assignment of assignments) {
    rewriteStatementArray(assignment.valueLines, structConstructorFields);
  }
  for (const structClass of classes) {
    rewriteStatementArray(structClass.postInitStatements, structConstructorFields);
    for (const method of structClass.methods) {
      rewriteStatementArray(method.statements, structConstructorFields);
    }
  }
  for (const plainClass of plainClasses) {
    rewriteStatementArray(plainClass.constructorDefinition.statements, structConstructorFields);
    for (const method of plainClass.methods) {
      rewriteStatementArray(method.statements, structConstructorFields);
    }
  }
}

function rewriteStatementArray(statements: string[], structConstructorFields: ReadonlyMap<string, string[]>): void {
  for (let index = 0; index < statements.length; index += 1) {
    statements[index] = rewriteStructPositionalConstructors(statements[index], structConstructorFields);
  }
}

function structFloatBufferStatements(): string[] {
  return [
    'const _f32buf = new Float32Array(1);',
    'const _u32buf = new Uint32Array(_f32buf.buffer);',
  ];
}

function pythonReprHelperStatements(): string[] {
  return [
    'function pythonRepr(value: unknown): string {',
    "  if (typeof value === 'number') {",
    '    if (Number.isNaN(value)) {',
    "      return 'nan';",
    '    }',
    '    if (value === Infinity) {',
    "      return 'inf';",
    '    }',
    '    if (value === -Infinity) {',
    "      return '-inf';",
    '    }',
    '    return String(value);',
    '  }',
    "  if (typeof value === 'string') {",
    '    return JSON.stringify(value);',
    '  }',
    '  if (value === true) {',
    "    return 'True';",
    '  }',
    '  if (value === false) {',
    "    return 'False';",
    '  }',
    '  if (value === null) {',
    "    return 'None';",
    '  }',
    '  return String(value);',
    '}',
  ];
}

function latin1EncodeReplaceHelperStatements(): string[] {
  return [
    'function latin1EncodeReplace(text: string): number[] {',
    '  const bytes: number[] = [];',
    '  for (const char of text) {',
    '    const codePoint = char.codePointAt(0) ?? 0;',
    '    bytes.push(codePoint <= 0xff ? codePoint : 0x3f);',
    '  }',
    '  return bytes;',
    '}',
  ];
}

function pythonStringCountHelperStatements(): string[] {
  return [
    'function pythonStringCount(text: string, needle: string): number {',
    "  if (needle === '') {",
    '    return Array.from(text).length + 1;',
    '  }',
    '  let count = 0;',
    '  let start = 0;',
    '  while (true) {',
    '    const index = text.indexOf(needle, start);',
    '    if (index === -1) {',
    '      return count;',
    '    }',
    '    count += 1;',
    '    start = index + needle.length;',
    '  }',
    '}',
  ];
}

function pythonJsonDumpsHelperStatements(): string[] {
  return [
    'function pythonJsonDumps(value: object | string | number | boolean | null, opts: { sortKeys?: boolean; indent?: number } = {}): string {',
    '  const normalized = opts.sortKeys === true ? pythonSortJsonKeys(value) : value;',
    '  return JSON.stringify(normalized, null, opts.indent ?? 0);',
    '}',
    '',
    'function pythonSortJsonKeys(value: object | string | number | boolean | null): object | string | number | boolean | null {',
    '  if (Array.isArray(value)) {',
    '    return value.map((item) => pythonSortJsonKeys(item));',
    '  }',
    "  if (value !== null && typeof value === 'object') {",
    '    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);',
    '    return Object.fromEntries(entries.map(([key, item]) => [key, pythonSortJsonKeys(item)]));',
    '  }',
    '  return value;',
    '}',
  ];
}

function pythonEqualsHelperStatements(): string[] {
  return [
    'function pythonEquals(left: object | string | number | boolean | null | undefined, right: object | string | number | boolean | null | undefined): boolean {',
    '  if (left === right) {',
    '    return true;',
    '  }',
    "  if (left !== null && left !== undefined && typeof left === 'object') {",
    "    const equal = Reflect.get(left, 'equal');",
    "    if (typeof equal === 'function') {",
    '      return Boolean(equal.call(left, right));',
    '    }',
    '  }',
    "  if (right !== null && right !== undefined && typeof right === 'object') {",
    "    const equal = Reflect.get(right, 'equal');",
    "    if (typeof equal === 'function') {",
    '      return Boolean(equal.call(right, left));',
    '    }',
    '  }',
    '  if (Array.isArray(left) || Array.isArray(right)) {',
    '    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {',
    '      return false;',
    '    }',
    '    return left.every((value, index) => pythonEquals(value, right[index]));',
    '  }',
    "  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {",
    '    const leftKeys = Object.keys(left);',
    '    const rightKeys = Object.keys(right);',
    '    if (leftKeys.length !== rightKeys.length) {',
    '      return false;',
    '    }',
    '    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && pythonEquals(Reflect.get(left, key), Reflect.get(right, key)));',
    '  }',
    '  return false;',
    '}',
  ];
}

function strftimeUtcNowHelperStatements(): string[] {
  return [
    'function _strftimeUtcNow(): string {',
    '  const now = new Date();',
    "  const year = String(now.getUTCFullYear()).padStart(4, '0');",
    "  const month = String(now.getUTCMonth() + 1).padStart(2, '0');",
    "  const day = String(now.getUTCDate()).padStart(2, '0');",
    "  const hour = String(now.getUTCHours()).padStart(2, '0');",
    "  const minute = String(now.getUTCMinutes()).padStart(2, '0');",
    "  const second = String(now.getUTCSeconds()).padStart(2, '0');",
    "  const microsecond = `${String(now.getUTCMilliseconds()).padStart(3, '0')}000`;",
    '  return `${year}${month}${day}T${hour}${minute}${second}.${microsecond}Z`;',
    '}',
  ];
}

function pathJoinHelperStatements(): string[] {
  return [
    'function _pathJoin(...parts: Array<string | number>): string {',
    '  const cleaned = parts.map((part, idx) => {',
    '    const text = String(part);',
    '    if (idx === 0) {',
    "      const stripped = text.replace(/\\/+$/g, '');",
    "      if (stripped === '.') {",
    "        return '';",
    '      }',
    "      return text === '/' ? '/' : stripped;",
    '    }',
    "    return text.replace(/^\\/+|\\/+$/g, '');",
    '  }).filter((part) => part.length > 0);',
    '  if (cleaned.length === 0) {',
    "    return '';",
    '  }',
    "  if (cleaned[0] === '/') {",
    "    return `/${cleaned.slice(1).join('/')}`;",
    '  }',
    "  return cleaned.join('/');",
    '}',
  ];
}

function pathFsHelperStatements(): string[] {
  return [
    'function _dirname(path: string): string {',
    "  const idx = path.lastIndexOf('/');",
    '  if (idx < 0) {',
    "    return '.';",
    '  }',
    '  if (idx === 0) {',
    "    return '/';",
    '  }',
    '  return path.slice(0, idx);',
    '}',
    '',
    'function _mkdirParents(path: string): void {',
    '  mkdirSync(path, { recursive: true });',
    '}',
  ];
}

function openTextFileHelperStatements(): string[] {
  return [
    "function _openTextFile(path: string, opts: { mode: string; encoding?: 'utf-8' }): { write(text: string): void; close(): void } {",
    '  return {',
    '    write(text: string): void {',
    "      if (opts.mode.includes('a')) {",
    "        appendFileSync(path, text, { encoding: opts.encoding ?? 'utf-8' });",
    '      } else {',
    "        writeFileSync(path, text, { encoding: opts.encoding ?? 'utf-8' });",
    '      }',
    '    },',
    '    close(): void {},',
    '  };',
    '}',
  ];
}

export function parseTyperCliModule(trimmedPython: string): TyperCliModule | null {
  const lines = flattenFromImportBlocks(trimmedPython.split(/\r?\n/));
  let sawTyperImport = false;
  let appName: string | null = null;
  const commands: TyperCliModule['commands'] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    if (trimmed === 'import typer') {
      sawTyperImport = true;
      index += 1;
      continue;
    }
    if (trimmed === 'from pathlib import Path') {
      index += 1;
      continue;
    }
    const fromImport = /^from \.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)* import .+$/.exec(trimmed);
    if (fromImport !== null) {
      index += 1;
      continue;
    }
    const appAssignment = /^([A-Za-z_][A-Za-z0-9_]*) = typer\.Typer\(.+\)$/.exec(trimmed);
    if (appAssignment === null) {
      return null;
    }
    appName = tsPublicNameForPythonName(appAssignment[1]);
    index += 1;
    break;
  }

  if (!sawTyperImport || appName === null) {
    return null;
  }

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }

    const commandDecorator = new RegExp(`^@${appName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}\\.command\\("([^"]+)"\\)$`).exec(trimmed)
      ?? new RegExp(`^@${appName}\\.command\\("([^"]+)"\\)$`).exec(trimmed);
    if (commandDecorator === null) {
      return null;
    }

    const header = parseTyperCliFunctionHeader(lines, index + 1);
    if (header === null) {
      return null;
    }

    const optsParams = parseTyperCliParameters(header.parametersText);
    if (optsParams === null) {
      return null;
    }
    commands.push({
      name: tsExportNameForPythonName(header.name),
      commandName: commandDecorator[1],
      optsParams,
    });

    index = header.nextIndex;
    while (index < lines.length && isIndentedBlockLine(lines, index, '    ')) {
      index += 1;
    }
  }

  return commands.length > 0 ? { appName, commands } : null;
}

function parseTyperCliFunctionHeader(
  lines: string[],
  index: number,
): { name: string; parametersText: string; nextIndex: number } | null {
  const start = /^def ([A-Za-z_][A-Za-z0-9_]*)\($/.exec(lines[index] ?? '');
  if (start === null) {
    return null;
  }

  const parameterLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    if (/^\) -> [^:]+:$/.test(lines[nextIndex] ?? '')) {
      return {
        name: start[1],
        parametersText: parameterLines.join(' '),
        nextIndex: nextIndex + 1,
      };
    }
    const line = lines[nextIndex];
    if (line === undefined || (!line.startsWith('    ') && line.trim() !== '')) {
      return null;
    }
    if (line.trim() !== '') {
      parameterLines.push(line.trim());
    }
    nextIndex += 1;
  }
  return null;
}

function parseTyperCliParameters(parametersText: string): TyperCliModule['commands'][number]['optsParams'] | null {
  if (parametersText === '') {
    return [];
  }
  const params: TyperCliModule['commands'][number]['optsParams'] = [];
  for (const parameterText of splitTopLevelComma(parametersText)) {
    const parameter = /^([A-Za-z_][A-Za-z0-9_]*): ([^=]+?)(?: = (.+))?$/.exec(parameterText);
    if (parameter === null) {
      return null;
    }
    params.push({
      name: tsExportNameForPythonName(parameter[1]),
      typeExpression: tsTypeExpression(parameter[2]),
      optional: parameter[3] !== undefined,
    });
  }
  return params;
}

function parseAllAssignment(
  lines: string[],
  index: number,
): { names: string[]; nextIndex: number } | null {
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

function parseSimpleExceptionClass(
  lines: string[],
  index: number,
): { name: string; statements: string[]; nextIndex: number } | null {
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\((ValueError|UserWarning|Exception|RuntimeError)\):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }

  const statements: string[] = [];
  let nextIndex = index + 1;
  const docstring = parseIndentedDocstring(lines, nextIndex);
  if (docstring !== null) {
    for (const line of docstring.value.split('\n')) {
      statements.push(line === '' ? '//' : `// ${line}`);
    }
    nextIndex = docstring.nextIndex;
  }
  while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
    nextIndex += 1;
  }
  if ((lines[nextIndex] ?? '').trim() === 'pass') {
    nextIndex += 1;
  }
  if ((lines[nextIndex] ?? '').startsWith('    ')) {
    return null;
  }

  statements.push(`export class ${header[1]} extends Error {`);
  statements.push('  constructor(message?: string) {');
  statements.push('    super(message);');
  statements.push(`    this.name = '${header[1]}';`);
  statements.push('  }');
  statements.push('}');
  statements.push('');
  return { name: header[1], statements, nextIndex };
}

function parseTypeAliasStatement(
  lines: string[],
  index: number,
): { alias: TypeAlias; nextIndex: number } | null {
  const oneLineAnnotated = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = Annotated\[(.+?), msgspec\.Meta\((.+)\)\]$/.exec(lines[index]?.trim() ?? '');
  if (oneLineAnnotated !== null) {
    return {
      alias: {
        name: tsExportNameForPythonName(oneLineAnnotated[1]),
        typeExpression: tsTypeExpression(oneLineAnnotated[2]),
        validation: parseTypeAliasValidation(oneLineAnnotated[3]),
      },
      nextIndex: index + 1,
    };
  }

  const start = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = Annotated\[$/.exec(lines[index]?.trim() ?? '');
  if (start !== null) {
    const baseType = /^    (.+),$/.exec(lines[index + 1] ?? '');
    if (baseType === null) {
      return null;
    }
    let nextIndex = index + 2;
    while (nextIndex < lines.length) {
      if (lines[nextIndex].trim() === ']') {
        const metadataBlock = lines.slice(index + 2, nextIndex).join('\n').trim();
        const metadata = /^msgspec\.Meta\(([\s\S]*)\)\s*,?$/.exec(metadataBlock);
        return {
          alias: {
            name: tsExportNameForPythonName(start[1]),
            typeExpression: tsTypeExpression(baseType[1]),
            validation: metadata === null ? undefined : parseTypeAliasValidation(metadata[1]),
          },
          nextIndex: nextIndex + 1,
        };
      }
      nextIndex += 1;
    }
    return null;
  }

  const plainAlias = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = (.+)$/.exec(lines[index]?.trim() ?? '');
  if (plainAlias !== null) {
    return {
      alias: { name: tsExportNameForPythonName(plainAlias[1]), typeExpression: tsTypeExpression(plainAlias[2]) },
      nextIndex: index + 1,
    };
  }

  const typeStatement = /^type ([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(lines[index]?.trim() ?? '');
  if (typeStatement !== null) {
    return {
      alias: { name: tsExportNameForPythonName(typeStatement[1]), typeExpression: tsTypeExpression(typeStatement[2]) },
      nextIndex: index + 1,
    };
  }

  const plainTypeAlias = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(lines[index]?.trim() ?? '');
  if (plainTypeAlias !== null && isBareTypeAliasExpression(plainTypeAlias[2])) {
    return {
      alias: { name: tsExportNameForPythonName(plainTypeAlias[1]), typeExpression: tsTypeExpression(plainTypeAlias[2]) },
      nextIndex: index + 1,
    };
  }
  return null;
}

function reexportsForAllNames(imports: ImportDefinition[], allNames: string[], relativePath: string): Reexport[] {
  if (allNames.length === 0) {
    return [];
  }

  const exportedNames = new Set(allNames.map(tsPublicNameForPythonName));
  const byModule = new Map<string, string[]>();
  for (const importDefinition of imports) {
    const names = importDefinition.names
      .filter((name) => exportedNames.has(name))
      .map((name) => tsReexportName(importDefinition.modulePath, name, relativePath));
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

function tsReexportName(modulePath: string, name: string, relativePath: string): string {
  return tsModuleExportsTypeOnly(modulePath, name, relativePath) ? `type ${name}` : name;
}

function tsImportNameForPythonName(modulePath: string, pythonName: string, relativePath: string): string {
  const exactName = tsExportNameForPythonName(pythonName);
  const publicName = tsPublicNameForPythonName(pythonName);
  if (
    exactName !== publicName
    && !tsModuleExportsName(modulePath, exactName, relativePath)
    && tsModuleExportsName(modulePath, publicName, relativePath)
  ) {
    return publicName;
  }
  return exactName;
}

function tsModuleExportsName(modulePath: string, name: string, relativePath: string): boolean {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  if (sourcePath === null || !fs.existsSync(sourcePath)) {
    return false;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^export\\s+(?:declare\\s+)?(?:const|let|var|function|class|type|interface|enum)\\s+${escapedName}\\b`, 'm').test(source)
    || new RegExp(`^export\\s+\\{[^}]*\\b${escapedName}\\b[^}]*\\}`, 'm').test(source);
}

function tsModuleExportsTypeOnly(modulePath: string, name: string, relativePath: string): boolean {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  if (sourcePath === null || !fs.existsSync(sourcePath)) {
    return false;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^export\\s+(?:type\\s+${escapedName}\\b|interface\\s+${escapedName}\\b)`, 'm').test(source);
}

function tsSourcePathForImportPath(modulePath: string, relativePath: string): string | null {
  if (modulePath.startsWith('@crimson/')) {
    return path.join(tsTargetRoot, 'crimson', modulePath.slice('@crimson/'.length));
  }
  if (modulePath.startsWith('@grim/')) {
    return path.join(tsTargetRoot, 'grim', modulePath.slice('@grim/'.length));
  }
  if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
    return path.resolve(tsTargetRoot, path.dirname(relativePath), modulePath);
  }
  return null;
}
function attachPendingAssignmentComments(assignment: SimpleModuleAssignment, pendingComments: string[]): void {
  if (pendingComments.length === 0) {
    return;
  }
  assignment.comments = [...pendingComments];
  pendingComments.length = 0;
}

function pushUniqueImportDefinition(imports: ImportDefinition[], importDefinition: ImportDefinition): void {
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

function pushUniqueNamespaceImport(
  namespaceImports: NamespaceImportDefinition[],
  namespaceImport: NamespaceImportDefinition,
): void {
  if (namespaceImports.some((candidate) => (
    candidate.modulePath === namespaceImport.modulePath
    && candidate.alias === namespaceImport.alias
  ))) {
    return;
  }
  namespaceImports.push(namespaceImport);
}

function avoidImportedPrivateNameCollision(assignment: SimpleModuleAssignment, imports: ImportDefinition[]): void {
  if (!(assignment.pythonName?.startsWith('_') ?? false)) {
    return;
  }
  const importedNames = new Set(imports.flatMap((importDefinition) => importDefinition.names.map(importedBindingName)));
  if (importedNames.has(assignment.name)) {
    assignment.name = `_${assignment.name}`;
  }
}
function markTypeOnlyImports(
  imports: ImportDefinition[],
  typeAliases: TypeAlias[],
  protocols: StraightLineModule['protocols'],
  classes: StructModule['classes'],
  plainClasses: PlainClassDefinition[],
  leadingStatements: string[],
  functions: SimpleModuleFunction[],
  assignments: SimpleModuleAssignment[],
): void {
  const valueText = stripTypeOnlyStatementSyntax([
    ...typeAliases.flatMap((alias) => [
      alias.validation?.minLength ?? '',
      alias.validation?.maxLength ?? '',
      alias.validation?.pattern ?? '',
      alias.validation?.ge ?? '',
      alias.validation?.le ?? '',
    ]),
    ...classes.flatMap((structClass) => structClass.fields.map((field) => field.defaultValue ?? '')),
    ...classes.flatMap((structClass) => structClass.methods.flatMap((method) => method.statements)),
    ...protocols.flatMap((protocol) => protocol.methods.flatMap((method) => [
      ...method.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...method.optsParams.map((parameter) => parameter.defaultValue ?? ''),
    ])),
    ...plainClasses.flatMap((plainClass) => plainClass.constructorDefinition.statements),
    ...plainClasses.flatMap((plainClass) => plainClass.methods.flatMap((method) => method.statements)),
    ...leadingStatements,
    ...functions.flatMap((fn) => fn.statements),
    ...functions.flatMap((fn) => [
      ...fn.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...fn.optsParams.map((parameter) => parameter.defaultValue ?? ''),
    ]),
    ...assignments.flatMap((assignment) => assignment.valueLines),
  ].join('\n'));
  const typeText = [
    ...typeAliases.map((alias) => alias.typeExpression),
    ...protocols.flatMap((protocol) => protocol.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
    ])),
    ...classes.flatMap((structClass) => structClass.fields.map((field) => field.typeExpression)),
    ...classes.flatMap((structClass) => structClass.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
    ])),
    ...plainClasses.flatMap((plainClass) => plainClass.fields.map((field) => field.typeExpression)),
    ...plainClasses.flatMap((plainClass) => [
      ...plainClass.constructorDefinition.parameters.map((parameter) => parameter.typeExpression),
      ...plainClass.constructorDefinition.optsParams.map((parameter) => parameter.typeExpression),
    ]),
    ...plainClasses.flatMap((plainClass) => plainClass.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
    ])),
    ...functions.flatMap((fn) => [
      fn.returnType,
      ...fn.parameters.map((parameter) => parameter.typeExpression),
      ...fn.optsParams.map((parameter) => parameter.typeExpression),
    ]),
    ...assignments.flatMap((assignment) => assignment.typeExpression ?? []),
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

function markNamespaceImports(namespaceImports: NamespaceImportDefinition[], valueText: string): void {
  for (let index = 0; index < namespaceImports.length; index += 1) {
    if (!identifierPattern(namespaceImports[index].alias).test(valueText)) {
      namespaceImports.splice(index, 1);
      index -= 1;
    }
  }
}

function importedBindingName(importName: string): string {
  return /^.+ as ([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(importName)?.[1] ?? importName;
}
