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
import { tsImportPathForPythonImport, tsPathForPython, tsTargetRoot } from '../paths.js';
import {
  flattenFromImportBlocks,
  isOneLineAllAssignment,
  splitLeadingModuleDocstring,
} from '../python-utils.js';
import { parseProtocolClass } from './basic.js';
import {
  identifierPattern,
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
import {
  classFieldTypeMarker,
  functionReturnTypeMarker,
  nullableNameMarker,
  objectNameMarker,
  receiverTypeNameMarker,
  setNameMarker,
  staticClassMethodNameMarker,
  stringNameMarker,
  translateExpression,
} from './expression.js';
import {
  functionSignatureMarker,
  parseStraightLineFunctionHeader,
  tsFunctionReturnTypeExpression,
} from './function-headers.js';
import {
  recordImportedClassFieldTypes,
  recordImportedFunctionReturnTypes,
  recordImportedInstanceMethodSignatures,
  recordImportedStructConstructorFields,
} from './imported-classes.js';
import { parseFunctionParameterText, pythonParameterNames } from './parameters.js';
import { parseTypeAliasStatement } from './straight-line/type-aliases.js';
import {
  bytesFromHelperStatements,
  bytesPrefixSuffixHelperStatements,
  bytesStripHelperStatements,
  arrayRemoveHelperStatements,
  concatBytesHelperStatements,
  constructBinaryHelperStatements,
  globPathHelperStatements,
  latin1EncodeReplaceHelperStatements,
  mapGetOrInitHelperStatements,
  mapMoveToEndHelperStatements,
  msgpackCodecHelperStatements,
  openTextFileHelperStatements,
  pathBasenameHelperStatements,
  pathExtnameHelperStatements,
  pathFsHelperStatements,
  pathJoinHelperStatements,
  pythonEqualsHelperStatements,
  pythonFloatHelperStatements,
  pythonIdHelperStatements,
  pythonJsonDumpsHelperStatements,
  pythonRoundHelperStatements,
  pythonReprHelperStatements,
  pythonRuntimeIntrospectionHelperStatements,
  pythonSplitlinesHelperStatements,
  pythonStructFormatHelperStatements,
  pythonStringCountHelperStatements,
  pythonTruthyHelperStatements,
  secretsTokenHexHelperStatements,
  strftimeUtcNowHelperStatements,
  structFloatBufferStatements,
  tupleKeyHelperStatements,
} from './runtime-helpers.js';
import {
  nullableLocalNames,
  reassignedLocalNames,
  rewriteStructPositionalConstructors,
  translateStraightLineStatement,
} from './statements.js';
import { parseTopLevelAssignment } from './statements/top-level-assignment.js';
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
  const structMapConstructorFields = new Map<string, Set<string>>();
  const typeVarNames = new Set<string>();
  const setReturnFunctionNames = new Set<string>();
  const objectReturnFunctionNames = new Set<string>();
  const stringReturnFunctionNames = new Set<string>();
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
      || isDataclassOnlyImport(trimmed)
      || trimmed === 'from collections import OrderedDict'
      || trimmed === 'from collections import defaultdict'
      || trimmed === 'from collections import deque'
      || trimmed === 'from functools import lru_cache'
      || trimmed === 'from pathlib import Path'
      || trimmed === 'from threading import Lock'
      || trimmed.startsWith('from construct import ')
      || trimmed === 'import re'
      || trimmed === 'import shutil'
      || trimmed === 'import subprocess'
      || trimmed === 'import msgspec'
      || trimmed === 'import io'
      || trimmed === 'import secrets'
      || trimmed === 'import tempfile'
      || trimmed === 'import typer'
      || trimmed === 'import warnings'
      || trimmed === 'import zlib'
      || trimmed === 'import zstandard as zstd'
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
      recordTypeCheckingImportClassFieldTypes(typeCheckingImports.imports, relativePath, moduleNameMap);
      index = typeCheckingImports.nextIndex;
      continue;
    }
    if (isStructFloatHelperAssignment(trimmed) || isExceptionAliasAssignment(trimmed)) {
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

    const structClass = parseStructClass(lines, index, moduleNameMap, mapNames, new Set(), relativePath, imports);
    if (structClass !== null) {
      classes.push(structClass.structClass);
      structConstructorFields.set(
        structClass.structClass.name,
        structConstructorFieldNames(structClass.structClass, structConstructorFields),
      );
      recordStructMapConstructorFields(structMapConstructorFields, structClass.structClass);
      recordStructClassFieldTypes(moduleNameMap, structClass.structClass);
      index = structClass.nextIndex;
      continue;
    }

    const exceptionClass = parseSimpleExceptionClass(lines, index);
    if (exceptionClass !== null) {
      leadingStatements.push(...exceptionClass.statements);
      moduleNameMap.set(exceptionClass.name, exceptionClass.name);
      index = exceptionClass.nextIndex;
      continue;
    }

    const plainClass = parsePlainClass(lines, index, moduleNameMap, relativePath, imports);
    if (plainClass !== null) {
      plainClasses.push(plainClass.plainClass);
      index = plainClass.nextIndex;
      continue;
    }

    const aliasedFromImport = /^from (\.+(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)?|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*) as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (aliasedFromImport !== null) {
      const aliasName = tsLocalNameForPythonAlias(aliasedFromImport[3]);
      if (/^\.+$/.test(aliasedFromImport[1]) && !aliasedFromImport[2].startsWith('__')) {
        namespaceImports.push({
          alias: aliasName,
          modulePath: tsImportPathForPythonImport(`${aliasedFromImport[1]}${aliasedFromImport[2]}`, relativePath),
        });
        moduleNameMap.set(aliasedFromImport[3], aliasName);
        index += 1;
        continue;
      }
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
      recordImportedStaticClassMethods(
        modulePath,
        [{ importedName, localName: aliasName }],
        relativePath,
        moduleNameMap,
      );
      recordImportedFunctionReturnTypes(
        modulePath,
        [{ importedName, localName: aliasName }],
        relativePath,
        moduleNameMap,
      );
      recordImportedMapNames(
        modulePath,
        [{ importedName, localName: aliasName }],
        relativePath,
        mapNames,
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
      if (moduleUsesRaylibInput(lines)) {
        pushUniqueImportDefinition(imports, {
          modulePath: tsImportPathForPythonImport('grim.input', relativePath),
          names: ['InputState'],
        });
      }
      for (const name of names) {
        moduleNameMap.set(name, 'wgl');
      }
      index += 1;
      continue;
    }

    const fromImport = /^from (\.+(?:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)?|[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromImport !== null) {
      const importedNames = fromImport[2].split(', ');
      if (/^\.+$/.test(fromImport[1]) && importedNames.every((name) => !name.startsWith('__'))) {
        for (const moduleName of importedNames) {
          const alias = tsLocalNameForPythonAlias(moduleName);
          pushUniqueNamespaceImport(namespaceImports, {
            alias,
            modulePath: tsImportPathForPythonImport(`${fromImport[1]}${moduleName}`, relativePath),
          });
          moduleNameMap.set(moduleName, alias);
        }
        index += 1;
        continue;
      }
      if (importedNames.length === 1) {
        const submodulePath = tsImportPathForPythonImport(`${fromImport[1]}.${importedNames[0]}`, relativePath);
        if (tsImportPathExists(submodulePath, relativePath)) {
          const alias = tsLocalNameForPythonAlias(importedNames[0]);
          pushUniqueNamespaceImport(namespaceImports, {
            alias,
            modulePath: submodulePath,
          });
          moduleNameMap.set(importedNames[0], alias);
          index += 1;
          continue;
        }
      }
      const modulePath = tsImportPathForPythonImport(fromImport[1], relativePath);
      const importBindings = importedNames.map((name) => {
        const bindingModulePath = tsImportModulePathForPythonName(modulePath, name, relativePath);
        return {
          pythonName: name,
          modulePath: bindingModulePath,
          importedName: tsImportNameForPythonName(bindingModulePath, name, relativePath),
          defaultName: tsExportNameForPythonName(name),
        };
      });
      const importBindingsByModule = groupImportBindingsByModule(importBindings);
      for (const [bindingModulePath, moduleImportBindings] of importBindingsByModule) {
        const importNames = moduleImportBindings.map((binding) => binding.importedName);
        if (bindingModulePath === '@crimson/screens/menu.ts' && moduleImportBindings.some((binding) => binding.pythonName === 'MenuView')) {
          for (const helperName of menuViewHelperImportNames()) {
            if (!importNames.includes(helperName)) {
              importNames.push(helperName);
            }
          }
        }
        imports.push({
          modulePath: bindingModulePath,
          names: importNames,
        });
        recordImportedStructConstructorFields(
          bindingModulePath,
          moduleImportBindings.map((binding) => ({ importedName: binding.importedName, localName: binding.importedName })),
          relativePath,
          structConstructorFields,
        );
        recordImportedStaticClassMethods(
          bindingModulePath,
          moduleImportBindings.map((binding) => ({ importedName: binding.importedName, localName: binding.importedName })),
          relativePath,
          moduleNameMap,
        );
        recordImportedFunctionReturnTypes(
          bindingModulePath,
          moduleImportBindings.map((binding) => ({ importedName: binding.importedName, localName: binding.importedName })),
          relativePath,
          moduleNameMap,
        );
        recordImportedMapNames(
          bindingModulePath,
          moduleImportBindings.map((binding) => ({ importedName: binding.importedName, localName: binding.importedName })),
          relativePath,
          mapNames,
        );
      }
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
      const alias = tsLocalNameForPythonAlias(namespaceImport[3]);
      namespaceImports.push({
        alias,
        modulePath: tsImportPathForPythonImport(`${namespaceImport[1]}${namespaceImport[2]}`, relativePath),
      });
      moduleNameMap.set(namespaceImport[3], alias);
      index += 1;
      continue;
    }

    const relativeNamespaceImports = /^from (\.+) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (relativeNamespaceImports !== null) {
      for (const moduleName of relativeNamespaceImports[2].split(', ')) {
        const alias = tsLocalNameForPythonAlias(moduleName);
        pushUniqueNamespaceImport(namespaceImports, {
          alias,
          modulePath: tsImportPathForPythonImport(`${relativeNamespaceImports[1]}${moduleName}`, relativePath),
        });
        moduleNameMap.set(moduleName, alias);
      }
      index += 1;
      continue;
    }

    const leadingTypeAlias = parseTypeAliasStatement(lines, index);
    if (leadingTypeAlias !== null) {
      typeAliases.push(leadingTypeAlias.alias);
      if (leadingTypeAlias.alias.validation !== undefined) {
        validatedTypeAliases.add(leadingTypeAlias.alias.name);
      }
      pendingAssignmentComments.length = 0;
      index = leadingTypeAlias.nextIndex;
      continue;
    }

    const assignment = parseTopLevelAssignment(lines, index, moduleNameMap, mapNames);
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
      if (assignment.assignment.typeExpression?.startsWith('Map<') === true || assignment.assignment.typeExpression?.startsWith('ReadonlyMap<') === true) {
        mapNames.add(assignment.assignment.name);
      }
      if (assignment.assignment.typeExpression?.startsWith('Set<') === true || assignment.assignment.typeExpression?.startsWith('ReadonlySet<') === true) {
        setReturnFunctionNames.add(assignment.assignment.name);
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
      recordTypeCheckingImportClassFieldTypes(typeCheckingImports.imports, relativePath, moduleNameMap);
      index = typeCheckingImports.nextIndex;
      continue;
    }
    if (isStructFloatHelperAssignment((lines[index] ?? '').trim()) || isExceptionAliasAssignment((lines[index] ?? '').trim())) {
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
    const interleavedTypeAlias = parseTypeAliasStatement(lines, index);
    if (interleavedTypeAlias !== null) {
      typeAliases.push(interleavedTypeAlias.alias);
      if (interleavedTypeAlias.alias.validation !== undefined) {
        validatedTypeAliases.add(interleavedTypeAlias.alias.name);
      }
      pendingAssignmentComments.length = 0;
      index = interleavedTypeAlias.nextIndex;
      continue;
    }

    const interleavedAssignment = parseTopLevelAssignment(lines, index, moduleNameMap, mapNames);
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
        if (interleavedAssignment.assignment.typeExpression?.startsWith('Set<') === true || interleavedAssignment.assignment.typeExpression?.startsWith('ReadonlySet<') === true) {
          setReturnFunctionNames.add(interleavedAssignment.assignment.name);
        }
      }
      index = interleavedAssignment.nextIndex;
      continue;
    }

    const functionIndex = skipIgnorableFunctionDecorators(lines, index);
    if (functionIndex !== index) {
      index = functionIndex;
    }

    if (!(lines[index] ?? '').startsWith('def ')) {
      const protocolClass = parseProtocolClass(lines, index);
      if (protocolClass !== null) {
        protocols.push(protocolClass.protocol);
        index = protocolClass.nextIndex;
        continue;
      }

      const structClass = parseStructClass(lines, index, moduleNameMap, mapNames, new Set(), relativePath, imports);
      if (structClass !== null) {
        classes.push(structClass.structClass);
        structConstructorFields.set(
          structClass.structClass.name,
          structConstructorFieldNames(structClass.structClass, structConstructorFields),
        );
        recordStructMapConstructorFields(structMapConstructorFields, structClass.structClass);
        recordStructClassFieldTypes(moduleNameMap, structClass.structClass);
        index = structClass.nextIndex;
        continue;
      }

      const exceptionClass = parseSimpleExceptionClass(lines, index);
      if (exceptionClass !== null) {
        trailingStatements.push(...exceptionClass.statements);
        moduleNameMap.set(exceptionClass.name, exceptionClass.name);
        index = exceptionClass.nextIndex;
        continue;
      }

      const plainClass = parsePlainClass(lines, index, moduleNameMap, relativePath, imports);
      if (plainClass !== null) {
        plainClasses.push(plainClass.plainClass);
        index = plainClass.nextIndex;
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
    const signaturePositionalNames: string[] = [];
    const arrayNames = new Set<string>();
    const functionMapNames = new Set(mapNames);
    for (const name of setReturnFunctionNames) {
      arrayNames.add(setNameMarker(name));
    }
    for (const name of objectReturnFunctionNames) {
      arrayNames.add(objectNameMarker(name));
    }
    for (const name of stringReturnFunctionNames) {
      arrayNames.add(stringNameMarker(name));
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
          if (pythonParameterName !== null) {
            signaturePositionalNames.push(pythonParameterName);
          }
        }
      }
    }
    const signature = {
      positional: signaturePositionalNames,
      returnTupleMarkers: returnTupleMarkersForType(header.returnType),
    };
    moduleNameMap.set(functionSignatureMarker(header.name), JSON.stringify(signature));
    moduleNameMap.set(functionSignatureMarker(tsExportNameForPythonName(header.name)), JSON.stringify(signature));

    const statements: string[] = [];
    const nameMap = new Map(moduleNameMap);
    recordParameterReceiverTypes(nameMap, arrayNames, [...parameters, ...optsParams]);
    const declaredNames = new Set<string>(pythonParameterNames(header.parametersText));
    const docstring = parseIndentedDocstring(lines, index);
    if (docstring !== null) {
      for (const line of docstring.value.split('\n')) {
        statements.push(line === '' ? '//' : `// ${line}`);
      }
      index = docstring.nextIndex;
    }
    markIteratedLocalNames(lines, index, '    ', arrayNames);
    for (const name of nullableLocalNames(lines, index)) {
      arrayNames.add(nullableNameMarker(name));
      arrayNames.add(nullableNameMarker(tsExportNameForPythonName(name)));
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

    const returnType = tsFunctionReturnTypeExpression(header.returnType);
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
    if (returnType === 'string') {
      stringReturnFunctionNames.add(tsExportNameForPythonName(header.name));
    }
    moduleNameMap.set(functionReturnTypeMarker(header.name), returnType);
    moduleNameMap.set(functionReturnTypeMarker(tsExportNameForPythonName(header.name)), returnType);
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
      recordTypeCheckingImportClassFieldTypes(typeCheckingImports.imports, relativePath, moduleNameMap);
      index = typeCheckingImports.nextIndex;
      continue;
    }
    if (isStructFloatHelperAssignment(trimmed) || isExceptionAliasAssignment(trimmed)) {
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
    const typeAlias = parseTypeAliasStatement(lines, index);
    if (typeAlias !== null) {
      typeAliases.push(typeAlias.alias);
      if (typeAlias.alias.validation !== undefined) {
        validatedTypeAliases.add(typeAlias.alias.name);
      }
      pendingAssignmentComments.length = 0;
      index = typeAlias.nextIndex;
      continue;
    }

    const assignment = parseTopLevelAssignment(lines, index, moduleNameMap, mapNames);
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
    if (assignment.assignment.typeExpression?.startsWith('Map<') === true || assignment.assignment.typeExpression?.startsWith('ReadonlyMap<') === true) {
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
    structMapConstructorFields,
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
  if (moduleValueText.includes('pyRound(')) {
    const helperStatements = pythonRoundHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('pythonFloat(')) {
    const helperStatements = pythonFloatHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('pythonSplitlines(')) {
    const helperStatements = pythonSplitlinesHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('pythonTruthy(')) {
    const helperStatements = pythonTruthyHelperStatements();
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
  if (
    moduleValueText.includes('pythonIsIdentifier(')
    || moduleValueText.includes('pythonIsMapping(')
    || moduleValueText.includes('pythonMapping')
    || moduleValueText.includes('pythonIsSequence(')
    || moduleValueText.includes('pythonTypeObject(')
    || moduleValueText.includes('pythonTypeName(')
    || moduleValueText.includes('PythonMapping')
    || moduleValueText.includes('PythonSequence')
  ) {
    const helperStatements = pythonRuntimeIntrospectionHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('secretsTokenHex(')) {
    const helperStatements = secretsTokenHexHelperStatements();
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
  if (moduleValueText.includes('pythonId(')) {
    const helperStatements = pythonIdHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (
    moduleValueText.includes('MsgpackEncoder(')
    || moduleValueText.includes('MsgpackEncoder<')
    || moduleValueText.includes('MsgpackDecoder(')
    || moduleValueText.includes('MsgpackDecoder<')
  ) {
    const helperStatements = msgpackCodecHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('mapMoveToEnd(')) {
    const helperStatements = mapMoveToEndHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('arrayRemove(')) {
    const helperStatements = arrayRemoveHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('mapGetOrInit(')) {
    const helperStatements = mapGetOrInitHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('tupleKey(')) {
    const helperStatements = tupleKeyHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  const pathHelperStatements: string[] = [];
  if (moduleValueText.includes('_strftimeUtcNow(')) {
    pathHelperStatements.push(...strftimeUtcNowHelperStatements());
  }
  if (moduleValueText.includes('_pathJoin(') || moduleValueText.includes('_globPath(')) {
    if (pathHelperStatements.length > 0) {
      pathHelperStatements.push('');
    }
    pathHelperStatements.push(...pathJoinHelperStatements());
  }
  if (moduleValueText.includes('_basename(') || moduleValueText.includes('_pathExtname(')) {
    if (pathHelperStatements.length > 0) {
      pathHelperStatements.push('');
    }
    pathHelperStatements.push(...pathBasenameHelperStatements());
  }
  if (moduleValueText.includes('_pathExtname(')) {
    if (pathHelperStatements.length > 0) {
      pathHelperStatements.push('');
    }
    pathHelperStatements.push(...pathExtnameHelperStatements());
  }
  if (moduleValueText.includes('_dirname(') || moduleValueText.includes('_mkdirParents(')) {
    if (pathHelperStatements.length > 0) {
      pathHelperStatements.push('');
    }
    pathHelperStatements.push(...pathFsHelperStatements());
  }
  if (moduleValueText.includes('_globPath(')) {
    if (pathHelperStatements.length > 0) {
      pathHelperStatements.push('');
    }
    pathHelperStatements.push(...globPathHelperStatements());
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
  if (moduleValueText.includes('pythonStartsWith(') || moduleValueText.includes('pythonEndsWith(')) {
    const helperStatements = bytesPrefixSuffixHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('pythonLstrip(')) {
    const helperStatements = bytesStripHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('pythonStructFormat(')) {
    const helperStatements = pythonStructFormatHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('concatBytes(') && !moduleValueText.includes('constructStruct(')) {
    const helperStatements = concatBytesHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  }
  if (moduleValueText.includes('constructStruct(')) {
    const helperStatements = constructBinaryHelperStatements();
    if (leadingStatements.length > 0) {
      helperStatements.push('');
    }
    leadingStatements.unshift(...helperStatements);
  } else if (moduleValueText.includes('bytesFrom(') && !moduleValueText.includes('pythonStructFormat(')) {
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
    || moduleValueText.includes('existsSync(')
    || moduleValueText.includes('statSync(')
    || moduleValueText.includes('_openTextFile(')
    || moduleValueText.includes('_mkdirParents(')
    || moduleValueText.includes('_globPath(')
  ) {
    pushUniqueImportDefinition(imports, {
      modulePath: 'node:fs',
      names: [
        ...(moduleValueText.includes('readFileSync(') ? ['readFileSync'] : []),
        ...(moduleValueText.includes('writeFileSync(') || moduleValueText.includes('_openTextFile(') ? ['writeFileSync'] : []),
        ...(moduleValueText.includes('appendFileSync(') || moduleValueText.includes('_openTextFile(') ? ['appendFileSync'] : []),
        ...(moduleValueText.includes('existsSync(') ? ['existsSync'] : []),
        ...(moduleValueText.includes('statSync(') ? ['statSync'] : []),
        ...(moduleValueText.includes('_mkdirParents(') ? ['mkdirSync'] : []),
        ...(moduleValueText.includes('_globPath(') ? ['readdirSync'] : []),
      ],
    });
  }
  if (moduleValueText.includes('deflateSync(') || moduleValueText.includes('inflateSync(')) {
    pushUniqueImportDefinition(imports, {
      modulePath: 'node:zlib',
      names: [
        ...(moduleValueText.includes('deflateSync(') ? ['deflateSync'] : []),
        ...(moduleValueText.includes('inflateSync(') ? ['inflateSync'] : []),
      ],
    });
  }
  if (moduleValueText.includes('zstdCompressSync(') || moduleValueText.includes('zstdDecompressSync(') || moduleValueText.includes('zlibConstants.')) {
    pushUniqueImportDefinition(imports, {
      modulePath: 'node:zlib',
      names: [
        ...(moduleValueText.includes('zstdCompressSync(') ? ['zstdCompressSync'] : []),
        ...(moduleValueText.includes('zstdDecompressSync(') ? ['zstdDecompressSync'] : []),
        ...(moduleValueText.includes('zlibConstants.') ? ['constants as zlibConstants'] : []),
      ],
    });
  }
  if (moduleValueText.includes('drawUiQuadShadow(')) {
    pushUniqueImportDefinition(imports, {
      modulePath: '@crimson/ui/shadow.ts',
      names: ['drawUiQuadShadow'],
    });
  }
  const moduleDefinesVec2 = classes.some((structClass) => structClass.name === 'Vec2')
    || plainClasses.some((plainClass) => plainClass.name === 'Vec2');
  if (!moduleDefinesVec2 && (moduleValueText.includes('new Vec2(') || moduleValueText.includes('Vec2.'))) {
    pushUniqueImportDefinition(imports, {
      modulePath: '@grim/geom.ts',
      names: ['Vec2'],
    });
  }

  const reexports = reexportsForAllNames(imports, allNames, relativePath);
  ensureInferredTypeImports(imports, typeAliases, protocols, classes, plainClasses, [...leadingStatements, ...trailingStatements], functions, [...leadingAssignments, ...assignments]);
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
  return /^_[A-Z0-9_]+ = struct\.Struct\("<f"\)$/.test(trimmedLine)
    || /^_[A-Z0-9_]+ = _[A-Z0-9_]+\.(?:pack|unpack)$/.test(trimmedLine);
}

function isExceptionAliasAssignment(trimmedLine: string): boolean {
  const assignment = /^_[A-Z0-9_]+ = (.+)$/.exec(trimmedLine);
  if (assignment === null) {
    return false;
  }
  return exceptionAliasExpression(assignment[1]);
}

function exceptionAliasExpression(expression: string): boolean {
  const exceptionName = '(?:Exception|RuntimeError|ValueError|KeyError|OSError|FileNotFoundError|AttributeError|TypeError)';
  const exceptionTuple = new RegExp(`^\\(${exceptionName}(?:, ${exceptionName})*,?\\)$`);
  const exceptionAliasTupleConcat = new RegExp(`^_[A-Z0-9_]+ \\+ \\(${exceptionName}(?:, ${exceptionName})*,?\\)$`);
  return exceptionTuple.test(expression) || exceptionAliasTupleConcat.test(expression);
}

function isEnumOnlyImport(trimmedLine: string): boolean {
  const enumImport = /^from enum import (.+)$/.exec(trimmedLine);
  if (enumImport === null) {
    return false;
  }
  return enumImport[1].split(', ').every((name) => ['Enum', 'IntEnum', 'IntFlag', 'auto', 'unique'].includes(name));
}

function isDataclassOnlyImport(trimmedLine: string): boolean {
  const dataclassImport = /^from dataclasses import (.+)$/.exec(trimmedLine);
  if (dataclassImport === null) {
    return false;
  }
  return dataclassImport[1].split(', ').every((name) => name === 'dataclass' || name === 'field');
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

function markIteratedLocalNames(
  lines: string[],
  startIndex: number,
  indent: string,
  arrayNames: Set<string>,
): void {
  let index = startIndex;
  while (index < lines.length && isIndentedBlockLine(lines, index, indent)) {
    const trimmed = lines[index].trim();
    const enumerateLoop = /^for [A-Za-z_][A-Za-z0-9_]*, [A-Za-z_][A-Za-z0-9_]* in enumerate\(([A-Za-z_][A-Za-z0-9_]*)\):$/.exec(trimmed);
    const simpleLoop = /^for [A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)* in ([A-Za-z_][A-Za-z0-9_]*):$/.exec(trimmed);
    const iterableName = enumerateLoop?.[1] ?? simpleLoop?.[1] ?? null;
    if (iterableName !== null) {
      arrayNames.add(iterableName);
      arrayNames.add(tsExportNameForPythonName(iterableName));
    }
    for (const lenCall of trimmed.matchAll(/\blen\(([A-Za-z_][A-Za-z0-9_]*)\)/g)) {
      arrayNames.add(lenCall[1]);
      arrayNames.add(tsExportNameForPythonName(lenCall[1]));
    }
    index += 1;
  }
}

function returnTupleMarkersForType(
  pythonReturnType: string,
): ('array' | 'map' | 'object' | 'rectangle' | 'set' | 'string' | null)[] | undefined {
  const tupleReturn = /^tuple\[(.+)\]$/.exec(pythonReturnType.trim());
  if (tupleReturn === null) {
    return undefined;
  }
  return splitTopLevelComma(tupleReturn[1]).map(returnMarkerForType);
}

function returnMarkerForType(pythonType: string): 'array' | 'map' | 'object' | 'rectangle' | 'set' | 'string' | null {
  const trimmed = pythonType.trim();
  if (/^(?:r[dl]\.|wgl\.)?Rectangle$/.test(trimmed)) {
    return 'rectangle';
  }
  if (trimmed === 'str') {
    return 'string';
  }
  if (/^(?:list|Sequence|tuple)\[/.test(trimmed)) {
    return 'array';
  }
  if (/^(?:set|frozenset)\[/.test(trimmed)) {
    return 'set';
  }
  if (/^dict\[/.test(trimmed)) {
    return 'map';
  }
  if (trimmed === 'object') {
    return 'object';
  }
  return null;
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
    ...classes.map((structClass) => structClass.extendsName ?? ''),
    ...classes.flatMap((structClass) => structClass.fields.map((field) => field.defaultValue ?? '')),
    ...classes.flatMap((structClass) => structClass.postInitStatements),
    ...classes.flatMap((structClass) => structClass.methods.flatMap((method) => method.statements)),
    ...protocols.flatMap((protocol) => protocol.methods.flatMap((method) => [
      ...method.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...method.optsParams.map((parameter) => parameter.defaultValue ?? ''),
    ])),
    ...plainClasses.map((plainClass) => plainClass.extendsName ?? ''),
    ...plainClasses.flatMap((plainClass) => [
      ...plainClass.constructorDefinition.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...plainClass.constructorDefinition.optsParams.map((parameter) => parameter.defaultValue ?? ''),
      ...plainClass.methods.flatMap((method) => [
        ...method.parameters.map((parameter) => parameter.defaultValue ?? ''),
        ...method.optsParams.map((parameter) => parameter.defaultValue ?? ''),
      ]),
    ]),
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

function recordImportedStaticClassMethods(
  modulePath: string,
  names: { importedName: string; localName: string }[],
  relativePath: string,
  moduleNameMap: Map<string, string>,
): void {
  recordImportedInstanceMethodSignatures(modulePath, names, relativePath, moduleNameMap);
  recordImportedClassFieldTypes(modulePath, names, relativePath, moduleNameMap);
  for (const name of names) {
    if (importedClassSource(modulePath, name.importedName, relativePath) !== null) {
      moduleNameMap.set(importedClassNameMarker(name.localName), 'true');
    }
    const methodNames = importedStaticClassMethodNames(modulePath, name.importedName, relativePath);
    for (const methodName of methodNames) {
      moduleNameMap.set(staticClassMethodNameMarker(name.localName, methodName), methodName);
    }
  }
}

function recordImportedMapNames(
  modulePath: string,
  names: { importedName: string; localName: string }[],
  relativePath: string,
  mapNames: Set<string>,
): void {
  for (const name of names) {
    if (importedExportIsMap(modulePath, name.importedName, relativePath)) {
      mapNames.add(name.localName);
    }
  }
}

function importedStaticClassMethodNames(modulePath: string, className: string, relativePath: string): string[] {
  const classSource = importedClassSource(modulePath, className, relativePath);
  if (classSource === null) {
    return [];
  }
  return [...classSource.matchAll(/^\s+static\s+(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[<(]/gm)]
    .map((match) => match[1]);
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

function importedClassSource(modulePath: string, className: string, relativePath: string): string | null {
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
  return nextExport === -1
    ? source.slice(classStart)
    : source.slice(classStart, classStart + 1 + nextExport);
}

function importedExportIsMap(modulePath: string, exportName: string, relativePath: string): boolean {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  return sourcePath !== null && sourceExportIsMap(sourcePath, exportName, new Set());
}

function sourceExportIsMap(sourcePath: string, exportName: string, seen: Set<string>): boolean {
  const resolvedPath = path.resolve(sourcePath);
  if (seen.has(resolvedPath) || !fs.existsSync(resolvedPath)) {
    return false;
  }
  seen.add(resolvedPath);
  const source = fs.readFileSync(resolvedPath, 'utf8');
  const escapedName = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^export\\s+const\\s+${escapedName}\\s*(?::\\s*(?:Readonly)?Map\\b|=\\s*new\\s+Map\\b)`, 'm').test(source)) {
    return true;
  }
  for (const reexport of source.matchAll(/^export\s+\{([^}]+)\}\s+from\s+['"](.+)['"];?$/gm)) {
    const exportedNames = splitTopLevelComma(reexport[1]).map((part) => part.trim());
    const forwardedName = exportedNames.flatMap((part) => {
      const alias = /^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(part);
      if (alias !== null && alias[2] === exportName) {
        return [alias[1]];
      }
      return part === exportName ? [part] : [];
    })[0];
    if (forwardedName !== undefined && sourceExportIsMap(path.resolve(path.dirname(resolvedPath), reexport[2]), forwardedName, seen)) {
      return true;
    }
  }
  for (const reexportAll of source.matchAll(/^export\s+\*\s+from\s+['"](.+)['"];?$/gm)) {
    if (sourceExportIsMap(path.resolve(path.dirname(resolvedPath), reexportAll[1]), exportName, seen)) {
      return true;
    }
  }
  return false;
}

function recordParameterReceiverTypes(
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  parameters: readonly FunctionParameter[],
): void {
  for (const parameter of parameters) {
    const typeName = simpleClassTypeName(parameter.typeExpression);
    if (typeName !== null) {
      nameMap.set(receiverTypeNameMarker(parameter.name), typeName);
      if (nameMap.has(importedClassNameMarker(typeName))) {
        arrayNames.add(objectNameMarker(parameter.name));
        arrayNames.add(objectNameMarker(tsExportNameForPythonName(parameter.name)));
      }
    }
  }
}

function recordTypeCheckingImportClassFieldTypes(
  imports: readonly ImportDefinition[],
  relativePath: string,
  moduleNameMap: Map<string, string>,
): void {
  for (const importDefinition of imports) {
    recordImportedClassFieldTypes(
      importDefinition.modulePath,
      importDefinition.names.map((name) => ({ importedName: name, localName: name })),
      relativePath,
      moduleNameMap,
    );
  }
}

function simpleClassTypeName(typeExpression: string): string | null {
  const typeName = /^([A-Z][A-Za-z0-9_$]*)$/.exec(typeExpression.trim());
  return typeName?.[1] ?? null;
}

function importedClassNameMarker(className: string): string {
  return `__imported_class__:${className}`;
}

function recordStructMapConstructorFields(
  structMapConstructorFields: Map<string, Set<string>>,
  structClass: StructModule['classes'][number],
): void {
  const mapFields = structClass.fields
    .filter((field) => field.typeExpression.startsWith('Map<') || field.typeExpression.startsWith('ReadonlyMap<'))
    .map((field) => field.name);
  if (mapFields.length > 0) {
    structMapConstructorFields.set(structClass.name, new Set(mapFields));
  }
}

function recordStructClassFieldTypes(
  moduleNameMap: Map<string, string>,
  structClass: StructModule['classes'][number],
): void {
  for (const field of structClass.fields) {
    moduleNameMap.set(classFieldTypeMarker(structClass.name, field.name), field.typeExpression);
  }
}

function rewriteStructConstructorCalls(
  structConstructorFields: ReadonlyMap<string, string[]>,
  structMapConstructorFields: ReadonlyMap<string, ReadonlySet<string>>,
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
  rewriteStatementArray(leadingStatements, structConstructorFields, structMapConstructorFields);
  rewriteStatementArray(trailingStatements, structConstructorFields, structMapConstructorFields);
  for (const fn of functions) {
    rewriteStatementArray(fn.statements, structConstructorFields, structMapConstructorFields);
  }
  for (const assignment of assignments) {
    rewriteStatementArray(assignment.valueLines, structConstructorFields, structMapConstructorFields);
  }
  for (const structClass of classes) {
    rewriteStatementArray(structClass.postInitStatements, structConstructorFields, structMapConstructorFields);
    for (const method of structClass.methods) {
      rewriteStatementArray(method.statements, structConstructorFields, structMapConstructorFields);
    }
  }
  for (const plainClass of plainClasses) {
    rewriteStatementArray(plainClass.constructorDefinition.statements, structConstructorFields, structMapConstructorFields);
    for (const method of plainClass.methods) {
      rewriteStatementArray(method.statements, structConstructorFields, structMapConstructorFields);
    }
  }
}

function rewriteStatementArray(
  statements: string[],
  structConstructorFields: ReadonlyMap<string, string[]>,
  structMapConstructorFields: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  for (let index = 0; index < statements.length; index += 1) {
    statements[index] = rewriteStructPositionalConstructors(statements[index], structConstructorFields, structMapConstructorFields);
  }
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
    if (trimmed === 'import typer' || trimmed === 'import typer as typer') {
      sawTyperImport = true;
      index += 1;
      continue;
    }
    if (isTyperCliIgnorableTopLevelLine(trimmed)) {
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

    const commandName = typerCliCommandDecoratorName(trimmed, appName);
    if (commandName !== null) {
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
        commandName,
        optsParams,
      });

      index = skipTyperCliCommandBody(lines, header.nextIndex, appName);
      continue;
    }

    if (isTyperCliIgnorableTopLevelLine(trimmed)) {
      index += 1;
      continue;
    }

    const skippedDefinitionIndex = skipTyperCliHelperDefinition(lines, index);
    if (skippedDefinitionIndex !== null) {
      index = skippedDefinitionIndex;
      continue;
    }

    return null;
  }

  return commands.length > 0 ? { appName, commands } : null;
}

function isTyperCliIgnorableTopLevelLine(trimmed: string): boolean {
  return trimmed.startsWith('#')
    || /^import [A-Za-z_][A-Za-z0-9_.]*(?: as [A-Za-z_][A-Za-z0-9_]*)?(?:, [A-Za-z_][A-Za-z0-9_.]*(?: as [A-Za-z_][A-Za-z0-9_]*)?)*$/.test(trimmed)
    || /^from \.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)* import .+$/.test(trimmed);
}

function typerCliCommandDecoratorName(trimmed: string, appName: string): string | null {
  const pythonAppName = appName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  return new RegExp(`^@${pythonAppName}\\.command\\("([^"]+)"\\)$`).exec(trimmed)?.[1]
    ?? new RegExp(`^@${appName}\\.command\\("([^"]+)"\\)$`).exec(trimmed)?.[1]
    ?? null;
}

function skipTyperCliCommandBody(lines: string[], index: number, appName: string): number {
  let nextIndex = index;
  while (nextIndex < lines.length) {
    if (typerCliCommandDecoratorName(lines[nextIndex].trim(), appName) !== null) {
      return nextIndex;
    }
    nextIndex += 1;
  }
  return nextIndex;
}

function skipTyperCliHelperDefinition(lines: string[], index: number): number | null {
  let headerIndex = index;
  while (/^@[A-Za-z_][A-Za-z0-9_.]*(?:\(.*\))?$/.test(lines[headerIndex]?.trim() ?? '')) {
    headerIndex += 1;
  }
  if (!/^(?:def|class) [A-Za-z_][A-Za-z0-9_]*(?:\(|[:(])/.test(lines[headerIndex]?.trim() ?? '')) {
    return null;
  }

  let nextIndex = headerIndex + 1;
  while (nextIndex < lines.length && !/:\s*$/.test(lines[nextIndex - 1] ?? '')) {
    if (lines[nextIndex] === undefined || (!lines[nextIndex].startsWith('    ') && lines[nextIndex].trim() !== '')) {
      return null;
    }
    nextIndex += 1;
  }
  while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, '    ')) {
    nextIndex += 1;
  }
  return nextIndex;
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

function tsImportModulePathForPythonName(modulePath: string, pythonName: string, relativePath: string): string {
  if (modulePath === '@crimson/screens/menu.ts' && pythonName === '_draw_menu_cursor') {
    return modulePath;
  }
  const candidateNames = pythonName === '__version__'
    ? ['VERSION']
    : [...new Set([tsExportNameForPythonName(pythonName), tsPublicNameForPythonName(pythonName)])];
  if (candidateNames.some((name) => tsModuleExportsName(modulePath, name, relativePath))) {
    return modulePath;
  }
  for (const name of candidateNames) {
    const forwardedModulePath = tsModuleImportsNameFrom(modulePath, name, relativePath);
    if (forwardedModulePath !== null) {
      return forwardedModulePath;
    }
  }
  return modulePath;
}

function tsImportNameForPythonName(modulePath: string, pythonName: string, relativePath: string): string {
  if (modulePath === '@crimson/screens/menu.ts' && pythonName === '_draw_menu_cursor') {
    return 'drawMenuCursorHelper';
  }
  if (pythonName === '__version__' && tsModuleExportsName(modulePath, 'VERSION', relativePath)) {
    return 'VERSION';
  }
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

function groupImportBindingsByModule<T extends { modulePath: string }>(bindings: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const binding of bindings) {
    const group = groups.get(binding.modulePath) ?? [];
    group.push(binding);
    groups.set(binding.modulePath, group);
  }
  return groups;
}

function tsModuleImportsNameFrom(modulePath: string, name: string, relativePath: string): string | null {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  if (sourcePath === null || !fs.existsSync(sourcePath)) {
    return null;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const importStatement of source.matchAll(/^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](.+)['"];?$/gm)) {
    for (const importedName of splitTopLevelComma(importStatement[1]).map((part) => part.trim())) {
      const cleanName = importedName.replace(/^type\s+/, '');
      const alias = /^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(cleanName);
      const localName = alias === null ? cleanName : alias[2];
      if (localName === name) {
        return tsImportPathForNestedSourceImport(sourcePath, importStatement[2]);
      }
    }
  }
  return null;
}

function tsImportPathForNestedSourceImport(sourcePath: string, importPath: string): string {
  if (!importPath.startsWith('.')) {
    return importPath;
  }
  const importedSourcePath = path.resolve(path.dirname(sourcePath), importPath);
  return tsImportPathForSourcePath(importedSourcePath) ?? importPath;
}

function tsImportPathForSourcePath(sourcePath: string): string | null {
  const crimsonRoot = path.join(tsTargetRoot, 'crimson');
  const grimRoot = path.join(tsTargetRoot, 'grim');
  const crimsonRelative = path.relative(crimsonRoot, sourcePath);
  if (!crimsonRelative.startsWith('..') && !path.isAbsolute(crimsonRelative)) {
    return `@crimson/${crimsonRelative.split(path.sep).join('/')}`;
  }
  const grimRelative = path.relative(grimRoot, sourcePath);
  if (!grimRelative.startsWith('..') && !path.isAbsolute(grimRelative)) {
    return `@grim/${grimRelative.split(path.sep).join('/')}`;
  }
  return null;
}

function skipIgnorableFunctionDecorators(lines: string[], index: number): number {
  let nextIndex = index;
  while (/^@(?:functools\.)?lru_cache\([^)]*\)$/.test(lines[nextIndex]?.trim() ?? '')) {
    nextIndex += 1;
  }
  return (nextIndex !== index && (lines[nextIndex] ?? '').startsWith('def ')) ? nextIndex : index;
}

function menuViewHelperImportNames(): string[] {
  return [
    'uiElementAnim',
    'labelAlpha',
    'signLayoutScale',
    'menuSlotPosX',
    'menuSlotStartMs',
    'menuSlotEndMs',
  ];
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

function tsImportPathExists(importPath: string, importerRelativePath: string): boolean {
  const localPath = localPathForTsImport(importPath, importerRelativePath);
  return localPath !== null && fs.existsSync(localPath);
}

function localPathForTsImport(importPath: string, importerRelativePath: string): string | null {
  if (importPath.startsWith('@crimson/')) {
    return path.join(tsTargetRoot, 'crimson', importPath.slice('@crimson/'.length));
  }
  if (importPath.startsWith('@grim/')) {
    return path.join(tsTargetRoot, 'grim', importPath.slice('@grim/'.length));
  }
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    return path.resolve(path.dirname(path.join(tsTargetRoot, tsPathForPython(importerRelativePath))), importPath);
  }
  return null;
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
    ...classes.map((structClass) => structClass.extendsName ?? ''),
    ...classes.flatMap((structClass) => structClass.fields.map((field) => field.defaultValue ?? '')),
    ...classes.flatMap((structClass) => structClass.postInitStatements),
    ...classes.flatMap((structClass) => structClass.methods.flatMap((method) => method.statements)),
    ...protocols.flatMap((protocol) => protocol.methods.flatMap((method) => [
      ...method.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...method.optsParams.map((parameter) => parameter.defaultValue ?? ''),
    ])),
    ...plainClasses.map((plainClass) => plainClass.extendsName ?? ''),
    ...plainClasses.flatMap((plainClass) => [
      ...plainClass.constructorDefinition.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...plainClass.constructorDefinition.optsParams.map((parameter) => parameter.defaultValue ?? ''),
      ...plainClass.methods.flatMap((method) => [
        ...method.parameters.map((parameter) => parameter.defaultValue ?? ''),
        ...method.optsParams.map((parameter) => parameter.defaultValue ?? ''),
      ]),
    ]),
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
  const typeText = straightLineModuleTypeUsageText(typeAliases, protocols, classes, plainClasses, leadingStatements, functions, assignments);

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

function ensureInferredTypeImports(
  imports: ImportDefinition[],
  typeAliases: TypeAlias[],
  protocols: StraightLineModule['protocols'],
  classes: StructModule['classes'],
  plainClasses: PlainClassDefinition[],
  leadingStatements: string[],
  functions: SimpleModuleFunction[],
  assignments: SimpleModuleAssignment[],
): void {
  const typeText = straightLineModuleTypeUsageText(typeAliases, protocols, classes, plainClasses, leadingStatements, functions, assignments);
  const localTypeNames = new Set([
    ...typeAliases.map((alias) => alias.name),
    ...protocols.map((protocol) => protocol.name),
    ...classes.map((structClass) => structClass.name),
    ...plainClasses.map((plainClass) => plainClass.name),
  ]);
  if (
    identifierPattern('Vec2').test(typeText)
    && !localTypeNames.has('Vec2')
    && !imports.some((importDefinition) => importDefinition.names.some((name) => importedBindingName(name) === 'Vec2'))
  ) {
    pushUniqueImportDefinition(imports, {
      modulePath: '@grim/geom.ts',
      names: ['Vec2'],
    });
  }
}

function straightLineModuleTypeUsageText(
  typeAliases: TypeAlias[],
  protocols: StraightLineModule['protocols'],
  classes: StructModule['classes'],
  plainClasses: PlainClassDefinition[],
  leadingStatements: string[],
  functions: SimpleModuleFunction[],
  assignments: SimpleModuleAssignment[],
): string {
  return [
    ...typeAliases.map((alias) => alias.typeExpression),
    ...protocols.flatMap((protocol) => [
      ...(protocol.extendsNames ?? []),
      ...protocol.methods.flatMap((method) => [
        method.returnType,
        ...method.parameters.map((parameter) => parameter.typeExpression),
        ...method.optsParams.map((parameter) => parameter.typeExpression),
      ]),
    ]),
    ...classes.flatMap((structClass) => structClass.fields.map((field) => field.typeExpression)),
    ...classes.flatMap((structClass) => structClass.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
      straightLineStatementTypeUsageText(method.statements),
    ])),
    ...plainClasses.flatMap((plainClass) => plainClass.fields.map((field) => field.typeExpression)),
    ...plainClasses.flatMap((plainClass) => [
      ...plainClass.constructorDefinition.parameters.map((parameter) => parameter.typeExpression),
      ...plainClass.constructorDefinition.optsParams.map((parameter) => parameter.typeExpression),
      straightLineStatementTypeUsageText(plainClass.constructorDefinition.statements),
    ]),
    ...plainClasses.flatMap((plainClass) => plainClass.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
      straightLineStatementTypeUsageText(method.statements),
    ])),
    straightLineStatementTypeUsageText(leadingStatements),
    ...functions.flatMap((fn) => [
      fn.returnType,
      ...fn.parameters.map((parameter) => parameter.typeExpression),
      ...fn.optsParams.map((parameter) => parameter.typeExpression),
      straightLineStatementTypeUsageText(fn.statements),
    ]),
    ...assignments.flatMap((assignment) => assignment.typeExpression ?? []),
  ].join('\n');
}

function straightLineStatementTypeUsageText(statements: string[]): string {
  return statements
    .flatMap((statement) => [...statement.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*:\s*([^=;]+)/g)].map((match) => match[1]))
    .join('\n');
}

function markNamespaceImports(namespaceImports: NamespaceImportDefinition[], valueText: string): void {
  for (let index = 0; index < namespaceImports.length; index += 1) {
    if (!identifierPattern(namespaceImports[index].alias).test(valueText)) {
      namespaceImports.splice(index, 1);
      index -= 1;
    }
  }
}

function moduleUsesRaylibInput(lines: string[]): boolean {
  return lines.some((line) => /\br[dl]\.(?:get_char_pressed|get_key_pressed|is_key_pressed|is_key_pressed_repeat|is_key_down|get_mouse_position|get_mouse_wheel_move|is_mouse_button_pressed|is_mouse_button_down)\b/.test(line));
}

function importedBindingName(importName: string): string {
  return /^.+ as ([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(importName)?.[1] ?? importName;
}

function tsLocalNameForPythonAlias(pythonName: string): string {
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
}
