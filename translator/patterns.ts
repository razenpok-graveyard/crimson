import type {
  ConstantDefinition,
  ConstantsModule,
  EnumDefinition,
  FunctionDefinition,
  FunctionParameter,
  GuardedAttributeModule,
  ImportDefinition,
  InitReexports,
  LazyWrapperModule,
  NamespaceReexport,
  OptionalFunctionParameter,
  PackageVersionModule,
  PlatformDirsModule,
  ProtocolDefinition,
  ProtocolMethod,
  Reexport,
  SimpleExportModule,
  SimpleFunctionDefinition,
  SimpleFunctionParameter,
  SimpleModuleAssignment,
  SimpleModuleFunction,
  StraightLineModule,
  StructModule,
  TypeAlias,
} from './model.js';
import {
  tsCallableType,
  tsExportNameForPythonName,
  tsLiteralExpression,
  tsMutableNameForPythonName,
  tsPublicNameForPythonName,
  tsTypeExpression,
} from './naming.js';
import { tsImportPathForPythonImport, tsImportPathForPythonModule, tsImportPathForPythonNamespace } from './paths.js';
import { flattenFromImportBlocks, isOneLineAllAssignment, splitLeadingModuleDocstring, stripAllAssignments } from './python-utils.js';

export function parseInitReexports(trimmedPython: string): InitReexports | null {
  const docstring = splitLeadingModuleDocstring(trimmedPython);
  const body = docstring === null ? trimmedPython : docstring.remainder.trim();
  const namespaceReexports: NamespaceReexport[] = [];
  const reexports: Reexport[] = [];
  let sawAll = false;
  const lines = flattenFromImportBlocks(body.split(/\r?\n/));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }

    if (trimmed.startsWith('__all__ = ')) {
      sawAll = true;
      if (!isOneLineAllAssignment(trimmed)) {
        while (index < lines.length && lines[index].trim() !== ']') {
          index += 1;
        }
      }
      continue;
    }

    const fromPackageImport = /^from \. import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromPackageImport !== null) {
      for (const name of fromPackageImport[1].split(', ')) {
        namespaceReexports.push({
          alias: tsExportNameForPythonName(name),
          modulePath: `./${name.replaceAll('_', '-')}.ts`,
        });
      }
      continue;
    }

    const fromImport = /^from ((?:\.)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromImport === null) {
      return null;
    }

    reexports.push({
      modulePath: tsImportPathForPythonModule(fromImport[1]),
      names: fromImport[2].split(', ').map(tsExportNameForPythonName),
    });
  }

  return sawAll && namespaceReexports.length + reexports.length > 0
    ? { docstring: docstring?.value ?? null, namespaceReexports, reexports }
    : null;
}

export function parseNamespaceReexports(trimmedPython: string): NamespaceReexport[] | null {
  const reexports: NamespaceReexport[] = [];
  let sawAll = false;
  const lines = trimmedPython.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      continue;
    }

    if (trimmed.startsWith('__all__ = ')) {
      sawAll = true;
      if (!isOneLineAllAssignment(trimmed)) {
        while (index < lines.length && lines[index].trim() !== ']') {
          index += 1;
        }
      }
      continue;
    }

    const importAlias = /^import ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (importAlias !== null) {
      reexports.push({
        alias: importAlias[2],
        modulePath: tsImportPathForPythonNamespace(importAlias[1]),
      });
      continue;
    }

    const fromImportAlias = /^from ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import [A-Za-z_][A-Za-z0-9_]* as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (fromImportAlias !== null) {
      reexports.push({
        alias: fromImportAlias[2],
        modulePath: tsImportPathForPythonNamespace(fromImportAlias[1]),
      });
      continue;
    }

    return null;
  }

  return sawAll && reexports.length > 0 ? reexports : null;
}

export function parseLazyWrapperModule(trimmedPython: string): LazyWrapperModule | null {
  const lines = stripAllAssignments(trimmedPython.split(/\r?\n/));
  let index = 0;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  const typeImport = /^from ((?:\.)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*)$/.exec(lines[index] ?? '');
  if (typeImport === null) {
    return null;
  }
  index += 1;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  const header = /^def ([A-Za-z_][A-Za-z0-9_]*)\(([A-Za-z_][A-Za-z0-9_]*): ([^)]+)\) -> ([^:]+):$/.exec(lines[index] ?? '');
  if (header === null || header[4] !== 'None') {
    return null;
  }
  index += 1;

  const comments: string[] = [];
  while (index < lines.length && lines[index].trim().startsWith('#')) {
    comments.push(lines[index].trim().replace(/^# ?/, ''));
    index += 1;
  }

  const runtimeImport = /^    from ((?:\.)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*) as _[A-Za-z_][A-Za-z0-9_]*$/.exec(lines[index] ?? '');
  if (runtimeImport === null) {
    return null;
  }
  index += 1;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  const call = /^    _[A-Za-z_][A-Za-z0-9_]*\(([A-Za-z_][A-Za-z0-9_]*)\)$/.exec(lines[index] ?? '');
  if (call === null || call[1] !== header[2]) {
    return null;
  }
  index += 1;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }
  if (index !== lines.length) {
    return null;
  }

  return {
    typeName: typeImport[2],
    typeModulePath: tsImportPathForPythonModule(typeImport[1]),
    functionName: tsExportNameForPythonName(header[1]),
    parameter: {
      name: tsExportNameForPythonName(header[2]),
      typeExpression: tsTypeExpression(header[3]),
    },
    runtimeModulePath: tsImportPathForPythonModule(runtimeImport[1]),
    runtimeFunctionName: tsExportNameForPythonName(runtimeImport[2]),
    comments,
  };
}

export function parseProtocolModule(trimmedPython: string): ProtocolDefinition | null {
  const lines = trimmedPython.split(/\r?\n/);
  let index = 0;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  if (lines[index]?.trim() !== 'from typing import Protocol') {
    return null;
  }
  index += 1;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\(Protocol\):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }
  index += 1;

  const methods: ProtocolMethod[] = [];
  while (index < lines.length) {
    if (lines[index].trim() === '') {
      index += 1;
      continue;
    }

    const method = /^    def ([A-Za-z_][A-Za-z0-9_]*)\(self, \*, ([A-Za-z_][A-Za-z0-9_]*): ([^=]+) = ([^)]+)\) -> ([^:]+): \.\.\.$/.exec(lines[index]);
    if (method === null) {
      return null;
    }

    methods.push({
      name: tsExportNameForPythonName(method[1]),
      optsParams: [{
        name: tsExportNameForPythonName(method[2]),
        typeExpression: tsTypeExpression(method[3]),
      }],
      optsOptional: true,
      returnType: tsTypeExpression(method[5]),
    });
    index += 1;
  }

  return methods.length > 0 ? { name: header[1], methods } : null;
}

export function parseIntEnumModule(trimmedPython: string): EnumDefinition | null {
  const lines = trimmedPython.split(/\r?\n/);
  let index = 0;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  if (lines[index]?.trim() !== 'from enum import IntEnum') {
    return null;
  }
  index += 1;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\(IntEnum\):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }
  index += 1;

  let docstring: string | null = null;
  const members: { name: string; value: string }[] = [];
  let valueFunction: EnumDefinition['valueFunction'] | undefined;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }

    const docstringMatch = /^    """(.*)"""$/.exec(line);
    if (docstringMatch !== null && members.length === 0 && docstring === null) {
      docstring = docstringMatch[1];
      index += 1;
      continue;
    }

    const member = /^    ([A-Z][A-Z0-9_]*) = (-?(?:0x[0-9A-Fa-f]+|\d+))$/.exec(line);
    if (member !== null) {
      members.push({
        name: member[1],
        value: member[2],
      });
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

    if (trimmed.startsWith('def ')) {
      const parsedValueFunction = parseIntEnumValueFunction(lines, index, header[1]);
      if (parsedValueFunction === null) {
        return null;
      }
      valueFunction = parsedValueFunction.valueFunction;
      index = parsedValueFunction.nextIndex;
      continue;
    }

    return null;
  }

  return members.length > 0 ? { name: header[1], docstring, members, valueFunction } : null;
}

function parseIntEnumValueFunction(
  lines: string[],
  index: number,
  enumName: string,
): { valueFunction: NonNullable<EnumDefinition['valueFunction']>; nextIndex: number } | null {
  const header = /^def ([A-Za-z_][A-Za-z0-9_]*)\($/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }

  const parameter = /^    ([A-Za-z_][A-Za-z0-9_]*): int,$/.exec(lines[index + 1] ?? '');
  if (parameter === null || lines[index + 2] !== `) -> ${enumName}:`) {
    return null;
  }

  if ((lines[index + 3] ?? '').trim() !== 'try:') {
    return null;
  }
  const returnConverted = new RegExp(`^        return ${enumName}\\(int\\(${parameter[1]}\\)\\)$`).exec(lines[index + 4] ?? '');
  if (returnConverted === null) {
    return null;
  }
  if ((lines[index + 5] ?? '').trim() !== 'except (TypeError, ValueError):') {
    return null;
  }
  const fallbackReturn = new RegExp(`^        return ${enumName}\\.([A-Z][A-Z0-9_]*)$`).exec(lines[index + 6] ?? '');
  if (fallbackReturn === null) {
    return null;
  }

  return {
    valueFunction: {
      name: tsExportNameForPythonName(header[1]),
      parameterName: tsExportNameForPythonName(parameter[1]),
      fallbackMember: fallbackReturn[1],
    },
    nextIndex: index + 7,
  };
}

export function parseTypeAliases(trimmedPython: string): TypeAlias[] | null {
  const aliases: TypeAlias[] = [];
  let sawCallableImport = false;

  for (const line of trimmedPython.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }

    if (trimmed === 'from collections.abc import Callable') {
      sawCallableImport = true;
      continue;
    }

    const callableAlias = /^([A-Za-z_][A-Za-z0-9_]*) = Callable\[\[(.*)\], ([^\]]+)\]$/.exec(trimmed);
    if (callableAlias !== null) {
      aliases.push({
        name: callableAlias[1],
        typeExpression: tsCallableType(callableAlias[2], callableAlias[3]),
      });
      continue;
    }

    return null;
  }

  return sawCallableImport && aliases.length > 0 ? aliases : null;
}

export function parseConstantsModule(trimmedPython: string): ConstantsModule | null {
  const docstring = splitLeadingModuleDocstring(trimmedPython);
  const body = docstring === null ? trimmedPython : docstring.remainder.trim();
  const constants: ConstantDefinition[] = [];
  let sawAll = false;
  const lines = body.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      continue;
    }

    if (trimmed.startsWith('__all__ = ')) {
      sawAll = true;
      if (!isOneLineAllAssignment(trimmed)) {
        while (index < lines.length && lines[index].trim() !== ']') {
          index += 1;
        }
      }
      continue;
    }

    const assignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(trimmed);
    if (assignment === null) {
      return null;
    }

    constants.push({
      name: assignment[1],
      value: tsLiteralExpression(assignment[2]),
    });
  }

  return sawAll && constants.length > 0 ? { docstring: docstring?.value ?? null, constants } : null;
}

export function parseFunctionsModule(trimmedPython: string): FunctionDefinition[] | null {
  const lines = trimmedPython.split(/\r?\n/);
  const functions: FunctionDefinition[] = [];
  let index = 0;

  while (index < lines.length) {
    if (lines[index].trim() === '') {
      index += 1;
      continue;
    }

    const header = /^def ([A-Za-z_][A-Za-z0-9_]*)\($/.exec(lines[index]);
    if (header === null) {
      return null;
    }
    index += 1;

    if (lines[index]?.trim() !== '*,') {
      return null;
    }
    index += 1;

    const optsParams: FunctionParameter[] = [];
    while (index < lines.length) {
      const param = /^    ([A-Za-z_][A-Za-z0-9_]*): ([^,]+),$/.exec(lines[index]);
      if (param === null) {
        break;
      }
      optsParams.push({
        name: tsExportNameForPythonName(param[1]),
        typeExpression: tsTypeExpression(param[2]),
      });
      index += 1;
    }

    const close = /^\) -> ([^:]+):$/.exec(lines[index] ?? '');
    if (close === null) {
      return null;
    }
    index += 1;

    let ignoredParam: string | null = null;
    const ignored = /^    _ = ([A-Za-z_][A-Za-z0-9_]*)$/.exec(lines[index] ?? '');
    if (ignored !== null) {
      ignoredParam = tsExportNameForPythonName(ignored[1]);
      index += 1;
    }

    const returnLine = /^    return (.+)$/.exec(lines[index] ?? '');
    if (returnLine === null) {
      return null;
    }
    index += 1;

    functions.push({
      name: tsExportNameForPythonName(header[1]),
      optsParams,
      returnType: tsTypeExpression(close[1]),
      ignoredParam,
      returnExpression: tsLiteralExpression(returnLine[1]),
    });
  }

  return functions.length > 0 ? functions : null;
}

export function parseGuardedAttributeModule(trimmedPython: string, relativePath: string): GuardedAttributeModule | null {
  const lines = flattenFromImportBlocks(trimmedPython.split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    if (trimmed.startsWith('def ')) {
      break;
    }

    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromImport === null) {
      return null;
    }

    imports.push({
      modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
      names: fromImport[2].split(', '),
    });
    index += 1;
  }

  const header = /^def ([A-Za-z_][A-Za-z0-9_]*)\(([A-Za-z_][A-Za-z0-9_]*): ([^)]+)\) -> ([^:]+):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }
  index += 1;

  const guard = new RegExp(`^    if ${header[2]}\\.([A-Za-z_][A-Za-z0-9_]*) is None:$`).exec(lines[index] ?? '');
  if (guard === null) {
    return null;
  }
  index += 1;

  const raise = /^        raise RuntimeError\("([^"]*)"\)$/.exec(lines[index] ?? '');
  if (raise === null) {
    return null;
  }
  index += 1;

  if (lines[index] !== `    return ${header[2]}.${guard[1]}`) {
    return null;
  }
  index += 1;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }
  if (index !== lines.length) {
    return null;
  }

  return {
    imports,
    functionDefinition: {
      name: tsExportNameForPythonName(header[1]),
      parameter: {
        name: tsExportNameForPythonName(header[2]),
        typeExpression: tsTypeExpression(header[3]),
      },
      returnType: tsTypeExpression(header[4]),
      attributeName: tsExportNameForPythonName(guard[1]),
      errorMessage: raise[1],
    },
  };
}

export function parseSimpleExportModule(trimmedPython: string, relativePath: string): SimpleExportModule | null {
  const lines = flattenFromImportBlocks(trimmedPython.split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  const constants: ConstantDefinition[] = [];
  const functions: SimpleFunctionDefinition[] = [];
  const allNames: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromImport === null) {
      break;
    }

    imports.push({
      modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
      names: fromImport[2].split(', '),
    });
    index += 1;
  }

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('__all__ = ')) {
      const parsedAllNames = parseOneLineAllNames(trimmed);
      if (parsedAllNames === null) {
        return null;
      }
      allNames.push(...parsedAllNames);
      if (!isOneLineAllAssignment(trimmed)) {
        while (index < lines.length && lines[index].trim() !== ']') {
          index += 1;
        }
      }
      index += 1;
      continue;
    }

    const assignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(trimmed);
    if (assignment !== null) {
      constants.push({
        name: tsExportNameForPythonName(assignment[1]),
        value: tsLiteralExpression(assignment[2]),
      });
      index += 1;
      continue;
    }

    const header = /^def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([^:]+):$/.exec(lines[index]);
    if (header === null) {
      return null;
    }
    index += 1;

    const parameters: SimpleFunctionParameter[] = [];
    if (header[2] !== '') {
      for (const parameterText of header[2].split(', ')) {
        const parameter = /^([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(parameterText);
        if (parameter === null) {
          return null;
        }
        parameters.push({
          name: tsExportNameForPythonName(parameter[1]),
          typeExpression: tsTypeExpression(parameter[2]),
          ignored: false,
        });
      }
    }

    const comments: string[] = [];
    const docstring = /^    """(.*)"""$/.exec(lines[index] ?? '');
    if (docstring !== null) {
      comments.push(docstring[1]);
      index += 1;
    }

    while (index < lines.length && lines[index].trim() === '') {
      index += 1;
    }

    const ignored = /^    _ = ([A-Za-z_][A-Za-z0-9_]*)$/.exec(lines[index] ?? '');
    if (ignored !== null) {
      const parameter = parameters.find((candidate) => candidate.name === tsExportNameForPythonName(ignored[1]));
      if (parameter === undefined) {
        return null;
      }
      parameter.ignored = true;
      index += 1;
    }

    const returnLine = /^    return (.+)$/.exec(lines[index] ?? '');
    if (returnLine === null) {
      return null;
    }
    index += 1;

    const returnExpression = tsSimpleExpression(returnLine[1], parameters);
    if (returnExpression === null) {
      return null;
    }

    functions.push({
      name: tsExportNameForPythonName(header[1]),
      parameters,
      returnType: tsTypeExpression(header[3]),
      returnExpression,
      comments,
      exported: false,
    });
  }

  if (allNames.length === 0 || constants.length + functions.length === 0) {
    return null;
  }

  const exportedNames = new Set(allNames.map(tsExportNameForPythonName));
  return {
    imports,
    constants: constants.map((constant) => ({
      ...constant,
      exported: exportedNames.has(constant.name),
    })),
    functions: functions.map((fn) => ({
      ...fn,
      exported: exportedNames.has(fn.name),
    })),
  };
}

export function parseMsgspecStructModule(trimmedPython: string, relativePath: string): StructModule | null {
  const lines = flattenFromImportBlocks(trimmedPython.split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  const classes: StructModule['classes'] = [];
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

    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromImport === null) {
      break;
    }
    imports.push({
      modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
      names: fromImport[2].split(', ').map(tsExportNameForPythonName),
    });
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

    const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\(msgspec\.Struct(?:, [^)]+)?\):$/.exec(lines[index] ?? '');
    if (header === null) {
      return null;
    }
    index += 1;

    const docstring = parseIndentedDocstring(lines, index);
    if (docstring !== null) {
      index = docstring.nextIndex;
    }

    const fields: StructModule['classes'][number]['fields'] = [];
    while (index < lines.length) {
      const line = lines[index];
      const trimmedField = line.trim();
      if (trimmedField === '') {
        index += 1;
        continue;
      }
      if (!line.startsWith('    ')) {
        break;
      }

      const field = /^    ([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(line);
      if (field === null) {
        return null;
      }
      const defaultValue = tsStructFieldDefaultValue(field[3]);
      if (defaultValue === null) {
        return null;
      }
      fields.push({
        name: tsExportNameForPythonName(field[1]),
        typeExpression: tsStructFieldType(field[2]),
        defaultValue,
      });
      index += 1;
    }

    if (fields.length === 0) {
      return null;
    }
    classes.push({
      name: header[1],
      docstring: docstring?.value ?? null,
      fields,
    });
  }

  markStructTypeOnlyImports(imports, classes);
  return classes.length > 0 ? { imports, classes } : null;
}

function parseIndentedDocstring(
  lines: string[],
  index: number,
): { value: string; nextIndex: number } | null {
  const start = /^    """(.*)$/.exec(lines[index] ?? '');
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
    if (line === '    """') {
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
    if (!line.startsWith('    ')) {
      return null;
    }
    docLines.push(line.slice(4));
    nextIndex += 1;
  }
  return null;
}

function tsStructFieldType(pythonType: string): string {
  const listType = /^list\[(.+)\]$/.exec(pythonType.trim());
  if (listType !== null) {
    return `${tsTypeExpression(listType[1])}[]`;
  }
  return tsTypeExpression(pythonType);
}

function tsStructFieldDefaultValue(pythonValue: string): string | null {
  const trimmed = pythonValue.trim();
  if (trimmed === 'msgspec.field(default_factory=list)') {
    return '[]';
  }

  const factory = /^msgspec\.field\(default_factory=([A-Za-z_][A-Za-z0-9_]*)\)$/.exec(trimmed);
  if (factory !== null) {
    return `new ${tsExportNameForPythonName(factory[1])}()`;
  }

  return translateExpression(trimmed);
}

function markStructTypeOnlyImports(
  imports: ImportDefinition[],
  classes: StructModule['classes'],
): void {
  const valueText = classes
    .flatMap((structClass) => structClass.fields.map((field) => field.defaultValue))
    .join('\n');

  for (let index = 0; index < imports.length; index += 1) {
    const importDefinition = imports[index];
    const valueNames = importDefinition.names.filter((name) => identifierPattern(name).test(valueText));
    const typeOnlyNames = importDefinition.names.filter((name) => !identifierPattern(name).test(valueText));
    if (valueNames.length === 0) {
      importDefinition.typeOnly = true;
      continue;
    }
    if (typeOnlyNames.length === 0) {
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

export function parsePackageVersionModule(trimmedPython: string): PackageVersionModule | null {
  const lines = trimmedPython.split(/\r?\n/);
  let packageName: string | null = null;
  let sawImport = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      continue;
    }

    if (trimmed === 'from importlib.metadata import version') {
      sawImport = true;
      continue;
    }

    const versionAssignment = /^__version__ = version\("([^"]+)"\)$/.exec(trimmed);
    if (versionAssignment !== null) {
      packageName = versionAssignment[1];
      continue;
    }

    if (trimmed.startsWith('__all__ = ')) {
      if (!isOneLineAllAssignment(trimmed)) {
        while (index < lines.length && lines[index].trim() !== ']') {
          index += 1;
        }
      }
      continue;
    }

    return null;
  }

  return sawImport && packageName !== null ? { packageName } : null;
}

export function parsePlatformDirsModule(trimmedPython: string): PlatformDirsModule | null {
  const lines = trimmedPython.split(/\r?\n/);
  let index = 0;

  const expectedPreamble = [
    'import os',
    'from pathlib import Path',
    '',
    'from platformdirs import PlatformDirs',
    '',
  ];
  for (const expected of expectedPreamble) {
    if ((lines[index] ?? '') !== expected) {
      return null;
    }
    index += 1;
  }

  const appNameAssignment = /^APP_NAME = "([^"]+)"$/.exec(lines[index] ?? '');
  if (appNameAssignment === null) {
    return null;
  }
  index += 1;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  const header = /^def ([A-Za-z_][A-Za-z0-9_]*)\(\) -> Path:$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }
  index += 1;

  if ((lines[index] ?? '').trim() !== '"""Return the default per-user runtime directory.') {
    return null;
  }
  index += 1;
  const docLines = ['Return the default per-user runtime directory.'];
  while (index < lines.length && (lines[index] ?? '').trim() !== '"""') {
    docLines.push((lines[index] ?? '').replace(/^    /, ''));
    index += 1;
  }
  if ((lines[index] ?? '').trim() !== '"""') {
    return null;
  }
  index += 1;

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }

  const override = /^    override = os\.environ\.get\("([A-Za-z_][A-Za-z0-9_]*)"\) or os\.environ\.get\("([A-Za-z_][A-Za-z0-9_]*)"\)$/.exec(lines[index] ?? '');
  if (override === null) {
    return null;
  }
  index += 1;

  const expectedBody = [
    '    if override:',
    '        return Path(override).expanduser()',
    '',
    '    dirs = PlatformDirs(appname=APP_NAME, appauthor=False)',
    '    return Path(dirs.user_data_path)',
  ];
  for (const expected of expectedBody) {
    if ((lines[index] ?? '') !== expected) {
      return null;
    }
    index += 1;
  }

  while (index < lines.length && lines[index].trim() === '') {
    index += 1;
  }
  if (index !== lines.length) {
    return null;
  }

  return {
    appName: appNameAssignment[1],
    functionName: tsExportNameForPythonName(header[1]),
    docstring: docLines.join('\n'),
    primaryEnvName: override[1],
    fallbackEnvName: override[2],
  };
}

export function parseStraightLineModule(trimmedPython: string, relativePath: string): StraightLineModule | null {
  const lines = flattenFromImportBlocks(trimmedPython.split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  const leadingAssignments: SimpleModuleAssignment[] = [];
  const functions: SimpleModuleFunction[] = [];
  const assignments: SimpleModuleAssignment[] = [];
  const allNames: string[] = [];
  const moduleNameMap = new Map<string, string>();
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    if (trimmed.startsWith('def ')) {
      break;
    }
    if (trimmed.startsWith('__all__ = ')) {
      const parsedAllNames = parseOneLineAllNames(trimmed);
      if (parsedAllNames === null && !isOneLineAllAssignment(trimmed)) {
        while (index < lines.length && lines[index].trim() !== ']') {
          index += 1;
        }
      } else if (parsedAllNames !== null) {
        allNames.push(...parsedAllNames);
      }
      index += 1;
      continue;
    }
    if (trimmed === 'import os') {
      index += 1;
      continue;
    }

    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromImport !== null) {
      const names = fromImport[2].split(', ').map(tsExportNameForPythonName);
      imports.push({
        modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
        names,
      });
      index += 1;
      continue;
    }

    const assignment = parseTopLevelAssignment(lines, index);
    if (assignment === null) {
      return null;
    }
    leadingAssignments.push(assignment.assignment);
    const annotatedAssignment = /^([A-Za-z_][A-Za-z0-9_]*): /.exec(lines[index] ?? '');
    if (annotatedAssignment !== null) {
      moduleNameMap.set(annotatedAssignment[1], assignment.assignment.name);
    }
    index = assignment.nextIndex;
  }

  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === '') {
      index += 1;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]* = /.test(lines[index] ?? '')) {
      break;
    }

    const header = /^def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([^:]+):$/.exec(lines[index] ?? '');
    if (header === null) {
      return null;
    }
    index += 1;

    const parameters: FunctionParameter[] = [];
    const optsParams: OptionalFunctionParameter[] = [];
    let keywordOnly = false;
    if (header[2] !== '') {
      for (const parameterText of header[2].split(', ')) {
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
        if (keywordOnly) {
          optsParams.push({
            ...parsedParameter,
            defaultValue: parameter[3] === undefined ? null : translateExpression(parameter[3]),
          });
        } else {
          if (parameter[3] !== undefined) {
            return null;
          }
          parameters.push(parsedParameter);
        }
      }
    }

    const statements: string[] = [];
    const nameMap = new Map(moduleNameMap);
    const declaredNames = new Set<string>();
    const reassignedNames = reassignedLocalNames(lines, index);
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '') {
        if ((lines[index + 1] ?? '').startsWith('    ')) {
          statements.push('');
          index += 1;
          continue;
        }
        index += 1;
        break;
      }
      const statement = translateStraightLineStatement(
        lines,
        index,
        '    ',
        nameMap,
        declaredNames,
        reassignedNames,
      );
      if (statement === null) {
        return null;
      }
      statements.push(...statement.statements);
      index = statement.nextIndex;
    }

    functions.push({
      name: tsExportNameForPythonName(header[1]),
      exported: !header[1].startsWith('_'),
      parameters,
      optsParams,
      returnType: tsTypeExpression(header[3]),
      statements,
    });
  }

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('__all__ = ')) {
      const parsedAllNames = parseOneLineAllNames(trimmed);
      if (parsedAllNames === null && !isOneLineAllAssignment(trimmed)) {
        while (index < lines.length && lines[index].trim() !== ']') {
          index += 1;
        }
      } else if (parsedAllNames !== null) {
        allNames.push(...parsedAllNames);
      }
      index += 1;
      continue;
    }

    const assignment = parseTopLevelAssignment(lines, index);
    if (assignment === null) {
      return null;
    }
    assignments.push(assignment.assignment);
    index = assignment.nextIndex;
  }

  markTypeOnlyImports(imports, functions, [...leadingAssignments, ...assignments]);
  if (allNames.length > 0) {
    const exportedNames = new Set(allNames.map(tsPublicNameForPythonName));
    for (const fn of functions) {
      fn.exported = exportedNames.has(fn.name);
    }
    for (const assignment of [...leadingAssignments, ...assignments]) {
      assignment.exported = exportedNames.has(assignment.name);
    }
  }

  return leadingAssignments.length + functions.length + assignments.length > 0
    ? { imports, leadingAssignments, functions, assignments }
    : null;
}

function parseOneLineAllNames(trimmedLine: string): string[] | null {
  const allAssignment = /^__all__ = \[(.*)\]$/.exec(trimmedLine);
  if (allAssignment === null) {
    return null;
  }
  const namesText = allAssignment[1].trim();
  if (namesText === '') {
    return [];
  }
  const names: string[] = [];
  for (const nameText of namesText.split(', ')) {
    const name = /^"([A-Za-z_][A-Za-z0-9_]*)"$/.exec(nameText);
    if (name === null) {
      return null;
    }
    names.push(name[1]);
  }
  return names;
}

function translateStraightLineStatement(
  lines: string[],
  index: number,
  indent: string,
  nameMap: Map<string, string>,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
): { statements: string[]; nextIndex: number } | null {
  const line = lines[index];
  if (line === undefined || !line.startsWith(indent)) {
    return null;
  }
  const statement = line.slice(indent.length);
  if (statement.trim() === '' || statement.startsWith(' ')) {
    return null;
  }

  if (statement.startsWith('#')) {
    return { statements: [`// ${statement.replace(/^# ?/, '')}`], nextIndex: index + 1 };
  }

  const globalStatement = /^global ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(statement);
  if (globalStatement !== null) {
    for (const name of globalStatement[1].split(', ')) {
      nameMap.set(name, tsMutableNameForPythonName(name));
    }
    return { statements: [], nextIndex: index + 1 };
  }

  const ifStatement = /^if (.+):$/.exec(statement);
  if (ifStatement !== null) {
    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length && lines[nextIndex].startsWith(innerIndent)) {
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
        declaredNames,
        reassignedNames,
      );
      if (innerStatement === null) {
        return null;
      }
      innerStatements.push(...innerStatement.statements.map((innerLine) => `  ${innerLine}`));
      nextIndex = innerStatement.nextIndex;
    }
    if (innerStatements.length === 0) {
      return null;
    }
    const statements = [
      `if (${translateExpression(ifStatement[1], nameMap)}) {`,
      ...innerStatements,
      '}',
    ];
    if ((lines[nextIndex] ?? '').trim() === 'else:') {
      const elseIndent = `${indent}    `;
      const elseStatements: string[] = [];
      nextIndex += 1;
      while (nextIndex < lines.length && lines[nextIndex].startsWith(elseIndent)) {
        const elseStatement = translateStraightLineStatement(
          lines,
          nextIndex,
          elseIndent,
          nameMap,
          declaredNames,
          reassignedNames,
        );
        if (elseStatement === null) {
          return null;
        }
        elseStatements.push(...elseStatement.statements.map((elseLine) => `  ${elseLine}`));
        nextIndex = elseStatement.nextIndex;
      }
      if (elseStatements.length === 0) {
        return null;
      }
      statements[statements.length - 1] = '} else {';
      statements.push(...elseStatements, '}');
    }
    return {
      statements,
      nextIndex,
    };
  }

  const forOfStatement = /^for ([A-Za-z_][A-Za-z0-9_]*) in (.+):$/.exec(statement);
  if (forOfStatement !== null) {
    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length && lines[nextIndex].startsWith(innerIndent)) {
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
        declaredNames,
        reassignedNames,
      );
      if (innerStatement === null) {
        return null;
      }
      innerStatements.push(...innerStatement.statements.map((innerLine) => `  ${innerLine}`));
      nextIndex = innerStatement.nextIndex;
    }
    if (innerStatements.length === 0) {
      return null;
    }
    return {
      statements: [
        `for (const ${tsExportNameForPythonName(forOfStatement[1])} of ${translateExpression(forOfStatement[2], nameMap)}) {`,
        ...innerStatements,
        '}',
      ],
      nextIndex,
    };
  }

  if (statement === 'return') {
    return { statements: ['return;'], nextIndex: index + 1 };
  }

  const returnStatement = /^return (.+)$/.exec(statement);
  if (returnStatement !== null) {
    return { statements: [`return ${translateExpression(returnStatement[1], nameMap)};`], nextIndex: index + 1 };
  }

  const assignment = /^(.+?) (\+=|-=|\*=|\/=|=) (.+)$/.exec(statement);
  if (assignment !== null) {
    if (/^(?:float|str|bool)\($/.test(assignment[3])) {
      const valueLine = lines[index + 1]?.trim().replace(/,$/, '') ?? null;
      if (valueLine === null || lines[index + 2]?.trim() !== ')') {
        return null;
      }
      return translateStraightLineAssignment(
        assignment[1],
        assignment[2],
        translateExpression(valueLine, nameMap),
        index + 3,
        nameMap,
        declaredNames,
        reassignedNames,
      );
    }
    return translateStraightLineAssignment(
      assignment[1],
      assignment[2],
      translateExpression(assignment[3], nameMap),
      index + 1,
      nameMap,
      declaredNames,
      reassignedNames,
    );
  }

  const callStatement = /^(.+\))$/.exec(statement);
  if (callStatement !== null) {
    return { statements: [`${translateExpression(callStatement[1], nameMap)};`], nextIndex: index + 1 };
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
): { statements: string[]; nextIndex: number } {
  const localAssignment = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonLeft);
  if (operator === '=' && localAssignment !== null) {
    const globalName = nameMap.get(localAssignment[1]);
    if (globalName !== undefined) {
      return {
        statements: [`${globalName} = ${tsRight};`],
        nextIndex,
      };
    }
    const tsName = tsExportNameForPythonName(localAssignment[1]);
    if (declaredNames.has(localAssignment[1])) {
      return {
        statements: [`${tsName} = ${tsRight};`],
        nextIndex,
      };
    }
    declaredNames.add(localAssignment[1]);
    return {
      statements: [
        `${reassignedNames.has(localAssignment[1]) ? 'let' : 'const'} ${tsName} = ${tsRight};`,
      ],
      nextIndex,
    };
  }
  return {
    statements: [`${translateExpression(pythonLeft, nameMap)} ${operator} ${tsRight};`],
    nextIndex,
  };
}

function reassignedLocalNames(lines: string[], startIndex: number): Set<string> {
  const counts = new Map<string, number>();
  let index = startIndex;
  while (index < lines.length && lines[index].trim() !== '') {
    const assignment = /^\s+([A-Za-z_][A-Za-z0-9_]*) = /.exec(lines[index]);
    if (assignment !== null) {
      counts.set(assignment[1], (counts.get(assignment[1]) ?? 0) + 1);
    }
    index += 1;
  }
  return new Set(
    [...counts.entries()]
      .filter((entry) => entry[1] > 1)
      .map((entry) => entry[0]),
  );
}

function parseTopLevelAssignment(
  lines: string[],
  index: number,
): { assignment: SimpleModuleAssignment; nextIndex: number } | null {
  const line = lines[index] ?? '';
  const annotatedAssignment = /^([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(line);
  const plainAssignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(line);
  if (annotatedAssignment === null && plainAssignment === null) {
    return null;
  }

  const pythonName = annotatedAssignment?.[1] ?? plainAssignment?.[1] ?? '';
  const value = annotatedAssignment?.[3] ?? plainAssignment?.[2] ?? '';
  const annotatedType = annotatedAssignment?.[2] ?? null;
  const name = annotatedType === null
    ? tsPublicNameForPythonName(pythonName)
    : tsMutableNameForPythonName(pythonName);
  const baseAssignment = {
    name,
    declaration: annotatedType === null ? 'const' as const : 'let' as const,
    exported: annotatedType === null || !pythonName.startsWith('_'),
    typeExpression: annotatedType === null ? undefined : tsTypeExpression(annotatedType),
  };
  if (value === '(') {
    const valueLines = ['['];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === ')') {
        valueLines.push(']');
        return {
          assignment: { ...baseAssignment, valueLines },
          nextIndex: nextIndex + 1,
        };
      }

      const tupleItem = /^(.+),$/.exec(trimmed);
      if (tupleItem === null) {
        return null;
      }
      valueLines.push(`  ${translateExpression(tupleItem[1])},`);
      nextIndex += 1;
    }

    return null;
  }

  const keywordCall = /^([A-Za-z_][A-Za-z0-9_]*)\($/.exec(value);
  if (keywordCall === null) {
    return {
      assignment: { ...baseAssignment, valueLines: [translateExpression(value)] },
      nextIndex: index + 1,
    };
  }

  const callee = tsExportNameForPythonName(keywordCall[1]);
  const callPrefix = /^[A-Z]/.test(callee) ? `new ${callee}` : callee;
  const valueLines = [`${callPrefix}({`];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === ')') {
      valueLines.push('})');
      return {
        assignment: { ...baseAssignment, valueLines },
        nextIndex: nextIndex + 1,
      };
    }

    const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+),$/.exec(trimmed);
    if (keywordArg === null) {
      return null;
    }
    valueLines.push(`  ${tsExportNameForPythonName(keywordArg[1])}: ${translateExpression(keywordArg[2])},`);
    nextIndex += 1;
  }

  return null;
}

function markTypeOnlyImports(
  imports: ImportDefinition[],
  functions: SimpleModuleFunction[],
  assignments: SimpleModuleAssignment[],
): void {
  const valueText = [
    ...functions.flatMap((fn) => fn.statements),
    ...assignments.flatMap((assignment) => assignment.valueLines),
  ].join('\n');

  for (let index = 0; index < imports.length; index += 1) {
    const importDefinition = imports[index];
    const valueNames = importDefinition.names.filter((name) => identifierPattern(name).test(valueText));
    const typeOnlyNames = importDefinition.names.filter((name) => !identifierPattern(name).test(valueText));
    if (valueNames.length === 0) {
      importDefinition.typeOnly = true;
      continue;
    }
    if (typeOnlyNames.length === 0) {
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

function translateExpression(pythonExpression: string, nameMap: Map<string, string> = new Map()): string {
  const trimmed = pythonExpression.trim();
  const envComparison = /^os\.environ\.get\("([A-Za-z_][A-Za-z0-9_]*)"\) == "([^"]*)"$/.exec(trimmed);
  if (envComparison !== null) {
    return `typeof process !== 'undefined' && process.env?.${envComparison[1]} === '${envComparison[2]}'`;
  }

  const lowerBoundLengthComparison = /^(.+?) <= (.+?) < len\((.+)\)$/.exec(trimmed);
  if (lowerBoundLengthComparison !== null) {
    const value = translateExpression(lowerBoundLengthComparison[2], nameMap);
    return `${value} >= ${translateExpression(lowerBoundLengthComparison[1], nameMap)} && ${value} < ${translateExpression(lowerBoundLengthComparison[3], nameMap)}.length`;
  }

  const tupleLiteral = /^\((.*)\)$/.exec(trimmed);
  if (tupleLiteral !== null && tupleLiteral[1].includes(',')) {
    const values = tupleLiteral[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => translateExpression(part, nameMap));
    return `[${values.join(', ')}]`;
  }

  const stringLiterals: string[] = [];
  const masked = trimmed.replaceAll(
    /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/g,
    (literal) => {
      const placeholder = `__CRIMSON_STRING_${stringLiterals.length}__`;
      stringLiterals.push(tsStringLiteral(literal));
      return placeholder;
    },
  );

  const translated = masked
    .trim()
    .replaceAll(
      /\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(([A-Za-z_][A-Za-z0-9_]*)=([^)]+)\)/g,
      (_match, callee: string, argName: string, argValue: string) => (
        `${translateExpression(callee, nameMap)}({ ${tsExportNameForPythonName(argName)}: ${translateExpression(argValue, nameMap)} })`
      ),
    )
    .replaceAll(/\b(?:float|str|bool)\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, '$1')
    .replaceAll(/\blen\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, '$1.length')
    .replaceAll(/ is not None\b/g, ' !== null')
    .replaceAll(/ is None\b/g, ' === null')
    .replaceAll(/ == /g, ' === ')
    .replaceAll(/ != /g, ' !== ')
    .replaceAll(/\bmin\(/g, 'Math.min(')
    .replaceAll(/\bmax\(/g, 'Math.max(')
    .replaceAll(/\babs\(/g, 'Math.abs(')
    .replaceAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (name) => {
      if (name === 'True') {
        return 'true';
      }
      if (name === 'False') {
        return 'false';
      }
      if (name === 'None') {
        return 'null';
      }
      if (/^__CRIMSON_STRING_\d+__$/.test(name)) {
        return name;
      }
      return nameMap.get(name) ?? tsExportNameForPythonName(name);
    });
  return translated.replaceAll(/__CRIMSON_STRING_(\d+)__/g, (_match, index: string) => stringLiterals[Number(index)] ?? _match);
}

function tsStringLiteral(pythonLiteral: string): string {
  if (!pythonLiteral.startsWith('"')) {
    return pythonLiteral;
  }
  const value = pythonLiteral
    .slice(1, -1)
    .replaceAll("'", "\\'");
  return `'${value}'`;
}

function identifierPattern(identifier: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tsSimpleExpression(pythonExpression: string, parameters: SimpleFunctionParameter[]): string | null {
  let expression = pythonExpression
    .replaceAll(/\b(?:float|str|bool)\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, '$1')
    .replaceAll(/\blen\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, '$1.length')
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
  return firstIdentifier === null || emittedParameterNames.has(firstIdentifier) || /^[A-Z0-9_]+$/.test(firstIdentifier)
    ? expression
    : null;
}
