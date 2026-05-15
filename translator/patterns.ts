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
  NamespaceImportDefinition,
  NamespaceReexport,
  OptionalFunctionParameter,
  PackageVersionModule,
  PlatformDirsModule,
  PlainClassDefinition,
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
  TypeAliasValidation,
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
      parameters: [],
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
  const exceptLine = (lines[index + 5] ?? '').trim();
  if (exceptLine !== 'except (TypeError, ValueError):' && exceptLine !== 'except (TypeError, ValueError, OverflowError):') {
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
      rejectsOverflow: exceptLine.includes('OverflowError'),
    },
    nextIndex: index + 7,
  };
}

function parseStringEnumClass(
  lines: string[],
  index: number,
): { enumDefinition: EnumDefinition; nextIndex: number } | null {
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\((str, Enum|IntEnum)\):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }
  const stringValued = header[2] === 'str, Enum';

  let nextIndex = index + 1;
  let docstring: string | null = null;
  const members: EnumDefinition['members'] = [];
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    const trimmed = line.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith('    ')) {
      break;
    }

    const docstringMatch = /^    """(.*)"""$/.exec(line);
    if (docstringMatch !== null && members.length === 0 && docstring === null) {
      docstring = docstringMatch[1];
      nextIndex += 1;
      continue;
    }

    const member = stringValued
      ? /^    ([A-Z][A-Z0-9_]*) = (["'][^"']*["'])$/.exec(line)
      : /^    ([A-Z][A-Z0-9_]*) = (-?(?:0x[0-9A-Fa-f]+|\d+))$/.exec(line);
    if (member === null) {
      return null;
    }
    members.push({
      name: member[1],
      value: stringValued ? translateExpression(member[2]) : member[2],
    });
    nextIndex += 1;
  }

  return members.length > 0
    ? {
      enumDefinition: {
        name: header[1],
        docstring,
        members,
      },
      nextIndex,
    }
    : null;
}

export function parseTypeAliases(trimmedPython: string): TypeAlias[] | null {
  const aliases: TypeAlias[] = [];
  let sawTypeAliasImport = false;
  const lines = trimmedPython.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      continue;
    }

    if (isCollectionsAbcTypeImport(trimmed)) {
      sawTypeAliasImport = true;
      continue;
    }
    const typingImport = /^from typing import (.+)$/.exec(trimmed);
    if (typingImport !== null && typingImport[1].split(', ').includes('TypeAlias')) {
      sawTypeAliasImport = true;
      continue;
    }
    if (trimmed === 'import msgspec') {
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

    const callableAlias = /^([A-Za-z_][A-Za-z0-9_]*) = Callable\[\[(.*)\], ([^\]]+)\]$/.exec(trimmed);
    if (callableAlias !== null) {
      aliases.push({
        name: callableAlias[1],
        typeExpression: tsCallableType(callableAlias[2], callableAlias[3]),
      });
      continue;
    }

    const annotatedAlias = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = Annotated\[(.+?), msgspec\.Meta\((.+)\)\]$/.exec(trimmed);
    if (annotatedAlias !== null) {
      aliases.push({
        name: annotatedAlias[1],
        typeExpression: tsTypeExpression(annotatedAlias[2]),
        validation: parseTypeAliasValidation(annotatedAlias[3]),
      });
      continue;
    }

    const plainTypeAlias = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = (.+)$/.exec(trimmed);
    if (plainTypeAlias !== null) {
      aliases.push({
        name: plainTypeAlias[1],
        typeExpression: tsTypeExpression(plainTypeAlias[2]),
      });
      continue;
    }

    return null;
  }

  return sawTypeAliasImport && aliases.length > 0 ? aliases : null;
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
  const typeAliases: TypeAlias[] = [];
  const classes: StructModule['classes'] = [];
  const protocols: StructModule['protocols'] = [];
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
    if (
      isCollectionsAbcTypeImport(trimmed)
      || trimmed === 'from pathlib import Path'
      || trimmed === 'from typing import Protocol'
      || trimmed === 'from typing import TYPE_CHECKING'
      || trimmed === 'from typing import cast'
    ) {
      index += 1;
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

    const protocol = parseSimpleProtocolClass(lines, index);
    if (protocol !== null) {
      protocols.push(protocol.protocol);
      index = protocol.nextIndex;
      continue;
    }

    const structClass = parseStructClass(lines, index);
    if (structClass === null) {
      return null;
    }
    classes.push(structClass.structClass);
    index = structClass.nextIndex;
  }

  markStructTypeOnlyImports(imports, typeAliases, classes, protocols);
  return typeAliases.length + classes.length + protocols.length > 0 ? { imports, typeAliases, classes, protocols } : null;
}

function isTypeAliasExpression(pythonExpression: string): boolean {
  const trimmed = pythonExpression.trim();
  if (/^(?:True|False|None|-?\d+(?:\.\d+)?|["'])/.test(trimmed)) {
    return false;
  }
  return /[\[\]|]/.test(trimmed) || /^(?:Callable|Sequence|dict|list|tuple)\b/.test(trimmed) || /^[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)?$/.test(trimmed);
}

function isCollectionsAbcTypeImport(trimmedLine: string): boolean {
  const typeImport = /^from collections\.abc import (.+)$/.exec(trimmedLine);
  if (typeImport === null) {
    return false;
  }
  return typeImport[1]
    .split(', ')
    .every((name) => ['Callable', 'Sequence'].includes(name));
}

function parseTypeCheckingImports(
  lines: string[],
  index: number,
  relativePath: string,
): { imports: ImportDefinition[]; nextIndex: number } | null {
  const imports: ImportDefinition[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex];
    if (line.trim() === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith('    ')) {
      break;
    }
    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(line.trim());
    if (fromImport === null) {
      return null;
    }
    imports.push({
      modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
      names: fromImport[2].split(', ').map(tsExportNameForPythonName),
    });
    nextIndex += 1;
  }
  return { imports, nextIndex };
}

function parseStructClass(
  lines: string[],
  index: number,
): { structClass: StructModule['classes'][number]; nextIndex: number } | null {
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\(msgspec\.Struct(?<options>(?:, [^)]+)?)\):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }
  const readonlyFields = header.groups?.options?.includes('frozen=True') ?? false;
  let nextIndex = index + 1;

  const docstring = parseIndentedDocstring(lines, nextIndex);
  if (docstring !== null) {
    nextIndex = docstring.nextIndex;
  }

  const fields: StructModule['classes'][number]['fields'] = [];
  const methods: SimpleModuleFunction[] = [];
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

    const method = parseStructMethod(lines, nextIndex);
    if (method !== null) {
      methods.push(method.method);
      nextIndex = method.nextIndex;
      continue;
    }

    const field = /^    ([A-Za-z_][A-Za-z0-9_]*): (.+?)(?: = (.+))?$/.exec(line);
    if (field === null) {
      return null;
    }
    const defaultValue = field[3] === undefined ? null : tsStructFieldDefaultValue(field[3]);
    fields.push({
      name: tsExportNameForPythonName(field[1]),
      typeExpression: tsStructFieldType(field[2]),
      defaultValue,
    });
    nextIndex += 1;
  }

  if (fields.length === 0) {
    return null;
  }
  return {
    structClass: {
      name: header[1],
      docstring: docstring?.value ?? null,
      readonlyFields,
      fields,
      methods,
    },
    nextIndex,
  };
}

function parseIndentedFunctionHeader(
  lines: string[],
  index: number,
  indent: string,
): { name: string; parametersText: string; returnType: string; nextIndex: number } | null {
  const oneLine = new RegExp(`^${indent}def ([A-Za-z_][A-Za-z0-9_]*)\\((.*)\\) -> ([^:]+):$`).exec(lines[index] ?? '');
  if (oneLine !== null) {
    return {
      name: oneLine[1],
      parametersText: oneLine[2],
      returnType: oneLine[3],
      nextIndex: index + 1,
    };
  }

  const start = new RegExp(`^${indent}def ([A-Za-z_][A-Za-z0-9_]*)\\($`).exec(lines[index] ?? '');
  if (start === null) {
    return null;
  }

  const parameterIndent = `${indent}    `;
  const parameterLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const close = new RegExp(`^${indent}\\) -> ([^:]+):$`).exec(lines[nextIndex] ?? '');
    if (close !== null) {
      return {
        name: start[1],
        parametersText: parameterLines.join(', '),
        returnType: close[1],
        nextIndex: nextIndex + 1,
      };
    }

    const line = lines[nextIndex] ?? '';
    if (!line.startsWith(parameterIndent)) {
      return null;
    }
    parameterLines.push(line.slice(parameterIndent.length).replace(/,$/, ''));
    nextIndex += 1;
  }
  return null;
}

function parseStructMethod(
  lines: string[],
  index: number,
): { method: SimpleModuleFunction; nextIndex: number } | null {
  const header = parseIndentedFunctionHeader(lines, index, '    ');
  if (header === null) {
    return null;
  }
  const parametersText = header.parametersText;
  if (parametersText !== 'self' && !parametersText.startsWith('self, ')) {
    return null;
  }

  const parameters: FunctionParameter[] = [];
  const optsParams: OptionalFunctionParameter[] = [];
  const arrayNames = new Set<string>();
  const extraParameters = parametersText === 'self' ? '' : parametersText.slice('self, '.length);
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
  const nameMap = new Map<string, string>([['self', 'this']]);
  const declaredNames = new Set<string>();
  const reassignedNames = reassignedLocalNames(lines, index + 1);
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
    );
    if (statement === null) {
      return null;
    }
    statements.push(...statement.statements);
    nextIndex = statement.nextIndex;
  }

  return {
    method: {
      name: tsExportNameForPythonName(header.name),
      exported: false,
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

function parseFunctionParametersText(
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
  return { parameters, optsParams };
}

function parsePlainClass(
  lines: string[],
  index: number,
): { plainClass: PlainClassDefinition; nextIndex: number } | null {
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }

  let nextIndex = index + 1;
  while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
    nextIndex += 1;
  }
  const constructorHeader = parseIndentedFunctionHeader(lines, nextIndex, '    ');
  if (constructorHeader === null || constructorHeader.name !== '__init__') {
    return null;
  }
  const constructorParametersText = constructorHeader.parametersText;
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
  const constructorNameMap = new Map<string, string>([['self', 'this']]);
  for (const parameter of constructorParams.optsParams) {
    constructorNameMap.set(parameter.name, parameter.name);
  }
  let bodyIndex = constructorHeader.nextIndex;
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
    const method = parsePlainClassMethod(lines, nextIndex, fieldNameMap);
    if (method === null) {
      return null;
    }
    methods.push(method.method);
    nextIndex = method.nextIndex;
  }

  const mutableFields = new Set<string>();
  for (const method of methods) {
    for (const statement of method.statements) {
      const assignment = /this\.([A-Za-z_][A-Za-z0-9_]*) = /.exec(statement);
      if (assignment !== null) {
        mutableFields.add(assignment[1]);
      }
    }
  }
  const fields = [...fieldMap.values()].map((field) => ({
    ...field,
    readonly: !mutableFields.has(field.name),
  }));

  return {
    plainClass: {
      name: header[1],
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
  const nameMap = new Map<string, string>([['self', 'this'], ...fieldNameMap]);
  const declaredNames = new Set<string>();
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
    );
    if (statement === null) {
      return null;
    }
    statements.push(...statement.statements);
    nextIndex = statement.nextIndex;
  }
  return {
    method: {
      name: tsExportNameForPythonName(header.name),
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

    const method = /^    def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([^:]+): \.\.\.$/.exec(lines[nextIndex] ?? '');
    if (method === null) {
      return null;
    }
    const parameters = parseProtocolParameters(method[2]);
    if (parameters === null) {
      return null;
    }
    methods.push({
      name: tsExportNameForPythonName(method[1]),
      parameters,
      optsParams: [],
      optsOptional: false,
      returnType: tsTypeExpression(method[3]),
    });
    nextIndex += 1;
  }

  return methods.length > 0
    ? { protocol: { name: header[1], methods }, nextIndex }
    : null;
}

function parseProtocolParameters(parametersText: string): FunctionParameter[] | null {
  if (parametersText === 'self') {
    return [];
  }
  if (!parametersText.startsWith('self, ')) {
    return null;
  }
  const parameters: FunctionParameter[] = [];
  for (const parameterText of parametersText.slice('self, '.length).split(', ')) {
    const parameter = /^([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(parameterText);
    if (parameter === null) {
      return null;
    }
    parameters.push({
      name: tsExportNameForPythonName(parameter[1]),
      typeExpression: tsTypeExpression(parameter[2]),
    });
  }
  return parameters;
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
  classes: StructModule['classes'],
  protocols: StructModule['protocols'],
): void {
  const valueText = classes
    .flatMap((structClass) => [
      ...structClass.fields.map((field) => field.defaultValue ?? ''),
      ...structClass.methods.flatMap((method) => method.statements),
    ])
    .join('\n');
  const typeText = [
    ...typeAliases.map((alias) => alias.typeExpression),
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
    const valueNames = importDefinition.names.filter((name) => identifierPattern(name).test(valueText));
    const typeOnlyNames = importDefinition.names.filter((name) => (
      !identifierPattern(name).test(valueText) && identifierPattern(name).test(typeText)
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
  const moduleDocstring = splitLeadingModuleDocstring(trimmedPython);
  const lines = flattenFromImportBlocks((moduleDocstring?.remainder.trim() ?? trimmedPython).split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  const namespaceImports: NamespaceImportDefinition[] = [];
  const leadingAssignments: SimpleModuleAssignment[] = [];
  const leadingStatements: string[] = [];
  const trailingStatements: string[] = [];
  const typeAliases: TypeAlias[] = [];
  const enums: EnumDefinition[] = [];
  const validatedTypeAliases = new Set<string>();
  const classes: StructModule['classes'] = [];
  const plainClasses: PlainClassDefinition[] = [];
  const functions: SimpleModuleFunction[] = [];
  const assignments: SimpleModuleAssignment[] = [];
  const allNames: string[] = [];
  const moduleNameMap = new Map<string, string>();
  const mapNames = new Set<string>();
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
    if (
      isCollectionsAbcTypeImport(trimmed)
      || trimmed === 'from enum import Enum'
      || trimmed === 'from enum import IntEnum'
      || trimmed === 'from pathlib import Path'
      || trimmed === 'from typing import Annotated, TypeAlias'
      || trimmed === 'from typing import TYPE_CHECKING'
      || trimmed === 'import msgspec'
      || trimmed === 'import tempfile'
    ) {
      index += 1;
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

    const annotatedTypeAlias = parseAnnotatedTypeAlias(lines, index);
    if (annotatedTypeAlias !== null) {
      typeAliases.push(annotatedTypeAlias.alias);
      if (annotatedTypeAlias.alias.validation !== undefined) {
        validatedTypeAliases.add(annotatedTypeAlias.alias.name);
      }
      index = annotatedTypeAlias.nextIndex;
      continue;
    }

    const stringEnumClass = parseStringEnumClass(lines, index);
    if (stringEnumClass !== null) {
      enums.push(stringEnumClass.enumDefinition);
      moduleNameMap.set(stringEnumClass.enumDefinition.name, stringEnumClass.enumDefinition.name);
      index = stringEnumClass.nextIndex;
      continue;
    }

    const structClass = parseStructClass(lines, index);
    if (structClass !== null) {
      classes.push(structClass.structClass);
      index = structClass.nextIndex;
      continue;
    }

    const plainClass = parsePlainClass(lines, index);
    if (plainClass !== null) {
      plainClasses.push(plainClass.plainClass);
      index = plainClass.nextIndex;
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

    const assignment = parseTopLevelAssignment(lines, index);
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
    if (/^[A-Za-z_][A-Za-z0-9_]* = /.test(lines[index] ?? '')) {
      break;
    }
    if (!(lines[index] ?? '').startsWith('def ')) {
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
    let keywordOnly = false;
    if (header.parametersText !== '') {
      for (const parameterText of splitTopLevelComma(header.parametersText)) {
        if (parameterText === '*') {
          keywordOnly = true;
          continue;
        }
        const parameter = /^([A-Za-z_][A-Za-z0-9_]*): ([^=]+?)(?: = (.+))?$/.exec(parameterText);
        if (parameter === null) {
          return null;
        }
        const baseTypeExpression = tsTypeExpression(parameter[2]);
        const parsedParameter = {
          name: tsExportNameForPythonName(parameter[1]),
          typeExpression: baseTypeExpression,
        };
        if (baseTypeExpression.endsWith('[]')) {
          arrayNames.add(parameter[1]);
        }
        if (keywordOnly) {
          optsParams.push({
            ...parsedParameter,
            defaultValue: parameter[3] === undefined ? null : translateExpression(parameter[3], undefined, arrayNames),
          });
        } else {
          parameters.push(parameter[3] === undefined
            ? parsedParameter
            : {
              ...parsedParameter,
              defaultValue: translateExpression(parameter[3], undefined, arrayNames),
            });
        }
      }
    }

    const statements: string[] = [];
    const nameMap = new Map(moduleNameMap);
    const declaredNames = new Set<string>();
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
        arrayNames,
        validatedTypeAliases,
        relativePath,
        mapNames,
      );
      if (statement === null) {
        return null;
      }
      statements.push(...statement.statements);
      index = statement.nextIndex;
    }

    functions.push({
      name: tsExportNameForPythonName(header.name),
      exported: !header.name.startsWith('_'),
      async: statements.some((statement) => statement.includes('await ')),
      parameters,
      optsParams,
      returnType: tsTypeExpression(header.returnType),
      statements,
    });
    moduleNameMap.set(header.name, tsExportNameForPythonName(header.name));
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

    const assignment = parseTopLevelAssignment(lines, index);
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

  const reexports = reexportsForAllNames(imports, allNames);
  markTypeOnlyImports(imports, typeAliases, classes, plainClasses, [...leadingStatements, ...trailingStatements], functions, [...leadingAssignments, ...assignments]);
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

  return typeAliases.length + enums.length + leadingAssignments.length + leadingStatements.length + classes.length + plainClasses.length + functions.length + trailingStatements.length + assignments.length + reexports.length > 0
    ? { docstring: moduleDocstring?.value ?? null, imports, namespaceImports, reexports, typeAliases, enums, leadingAssignments, leadingStatements, classes, plainClasses, functions, trailingStatements, assignments }
    : null;
}

function parseStraightLineFunctionHeader(
  lines: string[],
  index: number,
): { name: string; parametersText: string; returnType: string; nextIndex: number } | null {
  const oneLine = /^def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([^:]+):$/.exec(lines[index] ?? '');
  if (oneLine !== null) {
    return {
      name: oneLine[1],
      parametersText: oneLine[2],
      returnType: oneLine[3],
      nextIndex: index + 1,
    };
  }
  const oneLineWithoutReturn = /^def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\):$/.exec(lines[index] ?? '');
  if (oneLineWithoutReturn !== null) {
    return {
      name: oneLineWithoutReturn[1],
      parametersText: oneLineWithoutReturn[2],
      returnType: 'any',
      nextIndex: index + 1,
    };
  }

  const start = /^def ([A-Za-z_][A-Za-z0-9_]*)\($/.exec(lines[index] ?? '');
  if (start === null) {
    return null;
  }

  const parameterLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const close = /^\) -> ([^:]+):$/.exec(lines[nextIndex] ?? '');
    if (close !== null) {
      return {
        name: start[1],
        parametersText: parameterLines.join(', '),
        returnType: close[1],
        nextIndex: nextIndex + 1,
      };
    }

    const parameterLine = /^    (.+),$/.exec(lines[nextIndex] ?? '');
    if (parameterLine === null) {
      return null;
    }
    parameterLines.push(parameterLine[1]);
    nextIndex += 1;
  }

  return null;
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

function parseAnnotatedTypeAlias(
  lines: string[],
  index: number,
): { alias: TypeAlias; nextIndex: number } | null {
  const oneLineAnnotated = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = Annotated\[(.+?), msgspec\.Meta\((.+)\)\]$/.exec(lines[index]?.trim() ?? '');
  if (oneLineAnnotated !== null) {
    return {
      alias: {
        name: oneLineAnnotated[1],
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
            name: start[1],
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
      alias: { name: plainAlias[1], typeExpression: tsTypeExpression(plainAlias[2]) },
      nextIndex: index + 1,
    };
  }

  const typeStatement = /^type ([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(lines[index]?.trim() ?? '');
  if (typeStatement !== null) {
    return {
      alias: { name: typeStatement[1], typeExpression: tsTypeExpression(typeStatement[2]) },
      nextIndex: index + 1,
    };
  }
  return null;
}

function parseTypeAliasValidation(metadataText: string): TypeAliasValidation | undefined {
  const validation: TypeAliasValidation = {};
  for (const part of splitTopLevelComma(metadataText)) {
    const keyword = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(part.trim());
    if (keyword === null) {
      continue;
    }
    const value = keyword[2].trim();
    switch (keyword[1]) {
      case 'min_length':
        validation.minLength = translateExpression(value);
        break;
      case 'max_length':
        validation.maxLength = translateExpression(value);
        break;
      case 'pattern':
        validation.pattern = tsRegExpExpression(value);
        break;
      case 'ge':
        validation.ge = translateExpression(value);
        break;
      case 'le':
        validation.le = translateExpression(value);
        break;
      default:
        break;
    }
  }

  return Object.keys(validation).length === 0 ? undefined : validation;
}

function tsRegExpExpression(pythonLiteral: string): string {
  const literal = /^([rRfF]{0,2})(["'])([\s\S]*)\2$/.exec(pythonLiteral);
  if (literal === null) {
    return `new RegExp(${translateExpression(pythonLiteral)})`;
  }

  const prefix = literal[1].toLowerCase();
  const content = literal[3];
  if (prefix.includes('f')) {
    return `new RegExp(\`${tsFStringTemplateContent(content)}\`)`;
  }

  return `new RegExp(${JSON.stringify(content)})`;
}

function tsFStringTemplateContent(
  content: string,
  nameMap: Map<string, string> = new Map(),
  arrayNames: Set<string> = new Set(),
  validatedTypeAliases: ReadonlySet<string> = new Set(),
): string {
  let translated = '';
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '{' && next === '{') {
      translated += '{';
      index += 1;
      continue;
    }
    if (char === '}' && next === '}') {
      translated += '}';
      index += 1;
      continue;
    }
    if (char === '{') {
      const closeIndex = content.indexOf('}', index + 1);
      if (closeIndex !== -1) {
        const expression = content.slice(index + 1, closeIndex).trim();
        const formatSeparator = expression.indexOf(':');
        let expressionText = formatSeparator === -1 ? expression : expression.slice(0, formatSeparator).trim();
        const format = formatSeparator === -1 ? null : expression.slice(formatSeparator + 1).trim();
        const conversion = /^(.*)!([rsa])$/.exec(expressionText);
        expressionText = conversion === null ? expressionText : conversion[1].trim();
        const baseExpression = translateExpression(expressionText, nameMap, arrayNames, validatedTypeAliases);
        const translatedExpression = conversion?.[2] === 'r' || conversion?.[2] === 'a'
          ? `JSON.stringify(${baseExpression})`
          : baseExpression;
        const zeroPaddedInteger = format === null ? null : /^0(\d+)d$/.exec(format);
        if (zeroPaddedInteger !== null) {
          translated += `\${String(${translatedExpression}).padStart(${zeroPaddedInteger[1]}, '0')}`;
        } else {
          translated += `\${${translatedExpression}}`;
        }
        index = closeIndex;
        continue;
      }
    }
    if (char === '\\') {
      translated += '\\\\';
      continue;
    }
    if (char === '`') {
      translated += '\\`';
      continue;
    }
    if (char === '$' && next === '{') {
      translated += '\\$';
      continue;
    }
    translated += char;
  }
  return translated;
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

function reexportsForAllNames(imports: ImportDefinition[], allNames: string[]): Reexport[] {
  if (allNames.length === 0) {
    return [];
  }

  const exportedNames = new Set(allNames.map(tsPublicNameForPythonName));
  const byModule = new Map<string, string[]>();
  for (const importDefinition of imports) {
    const names = importDefinition.names.filter((name) => exportedNames.has(name));
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

function attachPendingAssignmentComments(assignment: SimpleModuleAssignment, pendingComments: string[]): void {
  if (pendingComments.length === 0) {
    return;
  }
  assignment.comments = [...pendingComments];
  pendingComments.length = 0;
}

function avoidImportedPrivateNameCollision(assignment: SimpleModuleAssignment, imports: ImportDefinition[]): void {
  if (!(assignment.pythonName?.startsWith('_') ?? false)) {
    return;
  }
  const importedNames = new Set(imports.flatMap((importDefinition) => importDefinition.names));
  if (importedNames.has(assignment.name)) {
    assignment.name = `_${assignment.name}`;
  }
}

function isIndentedBlockLine(lines: string[], index: number, indent: string): boolean {
  const line = lines[index] ?? '';
  return line.startsWith(indent) || (line.trim() === '' && (lines[index + 1] ?? '').startsWith(indent));
}

function indentStatementLine(line: string): string {
  return line === '' ? '' : `  ${line}`;
}

function operatorIsAssignment(operator: string): boolean {
  return operator === '=';
}

function inferPythonExpressionType(pythonExpression: string): string {
  const trimmed = pythonExpression.trim();
  if (/^(?:"[^"]*"|'[^']*')$/.test(trimmed)) {
    return 'string';
  }
  if (/^(?:True|False)$/.test(trimmed)) {
    return 'boolean';
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return 'number';
  }
  return 'any';
}

function predeclareIfBranchAssignments(
  lines: string[],
  index: number,
  indent: string,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
): string[] {
  const innerIndent = `${indent}    `;
  const assignedTypes = new Map<string, Set<string>>();
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(innerIndent)) {
      const rest = line.slice(innerIndent.length);
      const assignment = rest.startsWith(' ') ? null : /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(rest);
      if (assignment !== null && reassignedNames.has(assignment[1]) && !declaredNames.has(assignment[1])) {
        const types = assignedTypes.get(assignment[1]) ?? new Set<string>();
        types.add(inferPythonExpressionType(assignment[2]));
        assignedTypes.set(assignment[1], types);
      }
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(indent) && (/^elif .+:$/.test(trimmed) || trimmed === 'else:')) {
      nextIndex += 1;
      continue;
    }
    break;
  }

  const declarations: string[] = [];
  for (const [name, types] of assignedTypes) {
    const type = types.size === 1 ? [...types][0] : 'any';
    declarations.push(`let ${tsExportNameForPythonName(name)}: ${type};`);
    declaredNames.add(name);
  }
  return declarations;
}

function translateRaylibColorArg(pythonExpression: string, nameMap: Map<string, string>, arrayNames: Set<string>, validatedTypeAliases: ReadonlySet<string>): string {
  const translated = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases);
  return /\.[rgba]$/.test(translated) ? translated : `${translated} / 255`;
}

function translatePositionalCallExpression(
  pythonCallee: string,
  positionalParts: string[],
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  constructUppercase = false,
): string {
  const callee = translateExpression(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  const args = positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases));
  const reorderedArgs = callee === 'rl.rlSetBlendFactorsSeparate' && args.length === 6
    ? [args[0], args[1], args[4], args[2], args[3], args[5]]
    : args;
  const callPrefix = constructUppercase && /^[A-Z]/.test(callee) ? `new ${callee}` : callee;
  return `${callPrefix}(${reorderedArgs.join(', ')})`;
}

function translateCallArgumentExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): string {
  return translateBoundMethodReference(pythonExpression, nameMap, arrayNames, validatedTypeAliases)
    ?? translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases);
}

function translateBoundMethodReference(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): string | null {
  const reference = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){2,})$/.exec(pythonExpression.trim());
  if (reference === null) {
    return null;
  }
  const parts = reference[1].split('.');
  const translatedRoot = nameMap.get(parts[0]) ?? tsExportNameForPythonName(parts[0]);
  if (translatedRoot !== 'this') {
    return null;
  }
  const receiver = translateExpression(parts.slice(0, -1).join('.'), nameMap, arrayNames, validatedTypeAliases);
  const method = tsExportNameForPythonName(parts[parts.length - 1]);
  return `${receiver}.${method}.bind(${receiver})`;
}

function parseNestedFunctionStatement(
  lines: string[],
  index: number,
  indent: string,
  outerNameMap: Map<string, string>,
  validatedTypeAliases: ReadonlySet<string>,
  relativePath: string | null,
  mapNames: ReadonlySet<string>,
): { statements: string[]; nextIndex: number } | null {
  const header = parseIndentedFunctionHeader(lines, index, indent);
  if (header === null) {
    return null;
  }

  const arrayNames = new Set<string>();
  const parsedParams = parseFunctionParametersText(header.parametersText, arrayNames);
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

  const nestedNameMap = new Map(outerNameMap);
  const statements: string[] = [];
  const declaredNames = new Set<string>();
  const reassignedNames = reassignedLocalNames(lines, header.nextIndex);
  const innerIndent = `${indent}    `;
  let nextIndex = header.nextIndex;
  while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
    if (lines[nextIndex].trim() === '') {
      statements.push('');
      nextIndex += 1;
      continue;
    }
    const statement = translateStraightLineStatement(
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
  const returnType = tsTypeExpression(header.returnType);
  return {
    statements: [
      `${async ? 'async ' : ''}function ${tsExportNameForPythonName(header.name)}(${params.join(', ')}): ${async ? `Promise<${returnType}>` : returnType} {`,
      ...[...prologue, ...statements].map(indentStatementLine),
      '}',
    ],
    nextIndex,
  };
}

function renderInlineParameter(param: FunctionParameter): string {
  const defaultValue = param.defaultValue === undefined || param.defaultValue === null ? '' : ` = ${param.defaultValue}`;
  return `${param.name}: ${param.typeExpression}${defaultValue}`;
}

function translateStraightLineStatement(
  lines: string[],
  index: number,
  indent: string,
  nameMap: Map<string, string>,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  relativePath: string | null = null,
  mapNames: ReadonlySet<string> = new Set(),
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

  const sideEffectImport = /^from (\.+) import ([A-Za-z_][A-Za-z0-9_]*) as (_[A-Za-z_][A-Za-z0-9_]*)(?:\s+#.*)?$/.exec(statement);
  if (sideEffectImport !== null && relativePath !== null) {
    return {
      statements: [`void import('${tsImportPathForPythonImport(`${sideEffectImport[1]}${sideEffectImport[2]}`, relativePath)}');`],
      nextIndex: index + 1,
    };
  }

  const nestedFunction = parseNestedFunctionStatement(
    lines,
    index,
    indent,
    nameMap,
    validatedTypeAliases,
    relativePath,
    mapNames,
  );
  if (nestedFunction !== null) {
    return nestedFunction;
  }

  const ifStatement = /^if (.+):$/.exec(statement);
  if (ifStatement !== null) {
    const innerIndent = `${indent}    `;
    const translateBranch = (startIndex: number): { statements: string[]; nextIndex: number } | null => {
      const branchStatements: string[] = [];
      let nextIndex = startIndex;
      while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
        if (lines[nextIndex].trim() === '') {
          branchStatements.push('');
          nextIndex += 1;
          continue;
        }
        const innerStatement = translateStraightLineStatement(
          lines,
          nextIndex,
          innerIndent,
          nameMap,
          declaredNames,
          reassignedNames,
          arrayNames,
          validatedTypeAliases,
          relativePath,
          mapNames,
        );
        if (innerStatement === null) {
          return null;
        }
        branchStatements.push(...innerStatement.statements.map(indentStatementLine));
        nextIndex = innerStatement.nextIndex;
      }
      return branchStatements.length === 0 ? null : { statements: branchStatements, nextIndex };
    };

    const branchDeclarations = predeclareIfBranchAssignments(lines, index, indent, declaredNames, reassignedNames);
    const initialBranch = translateBranch(index + 1);
    if (initialBranch === null) {
      return null;
    }
    let nextIndex = initialBranch.nextIndex;
    const statements = [
      ...branchDeclarations,
      `if (${translateExpression(ifStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
      ...initialBranch.statements,
      '}',
    ];
    while (nextIndex < lines.length) {
      const elifStatement = /^elif (.+):$/.exec((lines[nextIndex] ?? '').trim());
      if (elifStatement === null) {
        break;
      }
      const elifBranch = translateBranch(nextIndex + 1);
      if (elifBranch === null) {
        return null;
      }
      statements[statements.length - 1] = `} else if (${translateExpression(elifStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`;
      statements.push(...elifBranch.statements, '}');
      nextIndex = elifBranch.nextIndex;
    }
    if ((lines[nextIndex] ?? '').trim() === 'else:') {
      const elseBranch = translateBranch(nextIndex + 1);
      if (elseBranch === null) {
        return null;
      }
      statements[statements.length - 1] = '} else {';
      statements.push(...elseBranch.statements, '}');
      nextIndex = elseBranch.nextIndex;
    }
    return {
      statements,
      nextIndex,
    };
  }

  if (statement === 'try:') {
    const innerIndent = `${indent}    `;
    const translateBlock = (startIndex: number): { statements: string[]; nextIndex: number } | null => {
      const blockStatements: string[] = [];
      let nextIndex = startIndex;
      while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
        if (lines[nextIndex].trim() === '') {
          blockStatements.push('');
          nextIndex += 1;
          continue;
        }
        const innerStatement = translateStraightLineStatement(
          lines,
          nextIndex,
          innerIndent,
          nameMap,
          declaredNames,
          reassignedNames,
          arrayNames,
          validatedTypeAliases,
          relativePath,
          mapNames,
        );
        if (innerStatement === null) {
          return null;
        }
        blockStatements.push(...innerStatement.statements.map(indentStatementLine));
        nextIndex = innerStatement.nextIndex;
      }
      return { statements: blockStatements, nextIndex };
    };

    const tryBlock = translateBlock(index + 1);
    if (tryBlock === null) {
      return null;
    }
    const afterTry = (lines[tryBlock.nextIndex] ?? '').trim();
    if (afterTry === 'finally:') {
      const finallyBlock = translateBlock(tryBlock.nextIndex + 1);
      if (finallyBlock === null) {
        return null;
      }
      return {
        statements: [
          'try {',
          ...tryBlock.statements,
          '} finally {',
          ...finallyBlock.statements,
          '}',
        ],
        nextIndex: finallyBlock.nextIndex,
      };
    }
    if (afterTry === 'except Exception:') {
      const exceptBlock = translateBlock(tryBlock.nextIndex + 1);
      if (exceptBlock === null) {
        return null;
      }
      return {
        statements: [
          'try {',
          ...tryBlock.statements,
          '} catch (exc) {',
          ...exceptBlock.statements,
          '}',
        ],
        nextIndex: exceptBlock.nextIndex,
      };
    }
    return null;
  }

  const forOfStatement = /^for ([A-Za-z_][A-Za-z0-9_]*) in (.+):$/.exec(statement);
  if (forOfStatement !== null) {
    const rangeLoop = /^range\((.+)\)$/.exec(forOfStatement[2]);
    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length && isIndentedBlockLine(lines, nextIndex, innerIndent)) {
      if (lines[nextIndex].trim() === '') {
        innerStatements.push('');
        nextIndex += 1;
        continue;
      }
      const innerStatement = translateStraightLineStatement(
        lines,
        nextIndex,
        innerIndent,
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        relativePath,
        mapNames,
      );
      if (innerStatement === null) {
        return null;
      }
      innerStatements.push(...innerStatement.statements.map(indentStatementLine));
      nextIndex = innerStatement.nextIndex;
    }
    if (innerStatements.length === 0) {
      return null;
    }
    if (rangeLoop !== null) {
      const rangeArgs = splitTopLevelComma(rangeLoop[1]);
      if (rangeArgs.length < 1 || rangeArgs.length > 2) {
        return null;
      }
      const loopName = forOfStatement[1] === '_' ? 'i' : tsExportNameForPythonName(forOfStatement[1]);
      const start = rangeArgs.length === 1 ? '0' : translateExpression(rangeArgs[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const stop = translateExpression(rangeArgs.at(-1) ?? '', nameMap, arrayNames, validatedTypeAliases, mapNames);
      return {
        statements: [
          `for (let ${loopName} = ${start}; ${loopName} < ${stop}; ${loopName}++) {`,
          ...innerStatements,
          '}',
        ],
        nextIndex,
      };
    }
    return {
      statements: [
        `for (const ${tsExportNameForPythonName(forOfStatement[1])} of ${translateExpression(forOfStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}) {`,
        ...innerStatements,
        '}',
      ],
      nextIndex,
    };
  }

  if (statement === 'return') {
    return { statements: ['return;'], nextIndex: index + 1 };
  }
  if (statement === 'break') {
    return { statements: ['break;'], nextIndex: index + 1 };
  }
  if (statement === 'continue') {
    return { statements: ['continue;'], nextIndex: index + 1 };
  }

  if (statement === 'return (') {
    const expressionLines: string[] = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === ')') {
        return {
          statements: [`return ${translateExpression(expressionLines.join(' '), nameMap, arrayNames, validatedTypeAliases, mapNames)};`],
          nextIndex: nextIndex + 1,
        };
      }
      if (trimmed === '') {
        nextIndex += 1;
        continue;
      }
      expressionLines.push(trimmed);
      nextIndex += 1;
    }
    return null;
  }

  const multilineReturnCall = /^return ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(statement);
  if (multilineReturnCall !== null) {
    const callExpression = parseMultilineCallExpression(
      lines,
      index + 1,
      multilineReturnCall[1],
      nameMap,
      arrayNames,
      validatedTypeAliases,
    );
    if (callExpression === null) {
      return null;
    }
    return { statements: [`return ${callExpression.expression};`], nextIndex: callExpression.nextIndex };
  }

  const returnStatement = /^return (.+)$/.exec(statement);
  if (returnStatement !== null) {
    return { statements: [`return ${translateExpression(returnStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)};`], nextIndex: index + 1 };
  }

  const raiseStatement = /^raise ([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/.exec(statement);
  if (raiseStatement !== null) {
    return {
      statements: [`throw new Error(${translateExpression(raiseStatement[2], nameMap, arrayNames, validatedTypeAliases, mapNames)});`],
      nextIndex: index + 1,
    };
  }
  if (statement === 'raise') {
    return { statements: ['throw exc;'], nextIndex: index + 1 };
  }

  const assignment = /^(.+?) (\+=|-=|\*=|\/=|=) (.+)$/.exec(statement);
  if (assignment !== null) {
    const multilineCallAssignment = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(assignment[3]);
    if (
      operatorIsAssignment(assignment[2])
      && multilineCallAssignment !== null
      && !['float', 'str', 'bool'].includes(multilineCallAssignment[1])
    ) {
      const callExpression = parseMultilineCallExpression(
        lines,
        index + 1,
        multilineCallAssignment[1],
        nameMap,
        arrayNames,
        validatedTypeAliases,
      );
      if (callExpression === null) {
        return null;
      }
      return translateStraightLineAssignment(
        assignment[1],
        assignment[2],
        callExpression.expression,
        callExpression.nextIndex,
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
    }
    if (assignment[3] === '(') {
      const expressionLines: string[] = [];
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const trimmed = lines[nextIndex].trim();
        if (trimmed === ')') {
          return translateStraightLineAssignment(
            assignment[1],
            assignment[2],
            translateExpression(expressionLines.join(' '), nameMap, arrayNames, validatedTypeAliases, mapNames),
            nextIndex + 1,
            nameMap,
            declaredNames,
            reassignedNames,
            arrayNames,
            validatedTypeAliases,
            mapNames,
          );
        }
        if (trimmed !== '') {
          expressionLines.push(trimmed);
        }
        nextIndex += 1;
      }
      return null;
    }
    if (/^(?:float|str|bool)\($/.test(assignment[3])) {
      const wrappedExpression = parseWrappedMultilineExpression(
        lines,
        index + 1,
        nameMap,
        arrayNames,
        validatedTypeAliases,
      );
      if (wrappedExpression === null) {
        return null;
      }
      return translateStraightLineAssignment(
        assignment[1],
        assignment[2],
        wrappedExpression.expression,
        wrappedExpression.nextIndex,
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        mapNames,
      );
    }
    return translateStraightLineAssignment(
      assignment[1],
      assignment[2],
      translateExpression(assignment[3], nameMap, arrayNames, validatedTypeAliases, mapNames),
      index + 1,
      nameMap,
      declaredNames,
      reassignedNames,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
  }

  const multilineKeywordCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(statement);
  if (multilineKeywordCall !== null) {
    const positionalParts: string[] = [];
    const keywordParts: string[] = [];
    let sawKeyword = false;
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === ')') {
        const callee = translateExpression(multilineKeywordCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
        if (keywordParts.length === 0) {
          return {
            statements: [`${translatePositionalCallExpression(multilineKeywordCall[1], positionalParts, nameMap, arrayNames, validatedTypeAliases)};`],
            nextIndex: nextIndex + 1,
          };
        }
        if (positionalParts.length === 0) {
          return {
            statements: [
              `${callee}({`,
              ...keywordParts.map((part) => `  ${part},`),
              '});',
            ],
            nextIndex: nextIndex + 1,
          };
        }
        return {
          statements: [
            `${callee}(`,
            ...positionalParts.map((part) => `  ${translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases)},`),
            `  { ${keywordParts.join(', ')} },`,
            ');',
          ],
          nextIndex: nextIndex + 1,
        };
      }

      const arg = trimmed.replace(/,$/, '');
      const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg);
      if (keywordArg === null) {
        if (sawKeyword) {
          return null;
        }
        const nestedCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(arg);
        if (nestedCall !== null) {
          const callExpression = parseMultilineCallExpression(
            lines,
            nextIndex + 1,
            nestedCall[1],
            nameMap,
            arrayNames,
            validatedTypeAliases,
          );
          if (callExpression === null) {
            return null;
          }
          positionalParts.push(callExpression.expression);
          nextIndex = callExpression.nextIndex;
          continue;
        }
        positionalParts.push(arg);
      } else {
        sawKeyword = true;
        keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${translateExpression(keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
      }
      nextIndex += 1;
    }
    return null;
  }

  const callStatement = /^(.+\))$/.exec(statement);
  if (callStatement !== null) {
    return { statements: [`${translateExpression(callStatement[1], nameMap, arrayNames, validatedTypeAliases, mapNames)};`], nextIndex: index + 1 };
  }

  return null;
}

function parseWrappedMultilineExpression(
  lines: string[],
  startIndex: number,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
): { expression: string; nextIndex: number } | null {
  const parts: string[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === ')') {
      return parts.length === 0
        ? null
        : {
          expression: translateExpression(parts.join(' '), nameMap, arrayNames, validatedTypeAliases),
          nextIndex: nextIndex + 1,
        };
    }
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }

    const expressionLine = trimmed.replace(/,$/, '');
    const multilineCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(expressionLine);
    if (multilineCall !== null) {
      const callExpression = parseMultilineCallExpression(
        lines,
        nextIndex + 1,
        multilineCall[1],
        nameMap,
        arrayNames,
        validatedTypeAliases,
      );
      if (callExpression === null) {
        return null;
      }
      parts.push(callExpression.expression);
      nextIndex = callExpression.nextIndex;
      continue;
    }

    parts.push(expressionLine);
    nextIndex += 1;
  }
  return null;
}

function parseMultilineCallExpression(
  lines: string[],
  startIndex: number,
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
): { expression: string; nextIndex: number } | null {
  const positionalParts: string[] = [];
  const keywordParts: string[] = [];
  let sawKeyword = false;
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed === ')' || trimmed === '),') {
      const callee = translateExpression(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
      const callPrefix = /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
      if (keywordParts.length === 0) {
        return {
          expression: translatePositionalCallExpression(pythonCallee, positionalParts, nameMap, arrayNames, validatedTypeAliases, true),
          nextIndex: nextIndex + 1,
        };
      }
      if (positionalParts.length === 0) {
        return {
          expression: `${callPrefix}({ ${keywordParts.join(', ')} })`,
          nextIndex: nextIndex + 1,
        };
      }
      return {
        expression: `${callPrefix}(${[
          ...positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases)),
          `{ ${keywordParts.join(', ')} }`,
        ].join(', ')})`,
        nextIndex: nextIndex + 1,
      };
    }

    const arg = trimmed.replace(/,$/, '');
    const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg);
    if (keywordArg === null) {
      if (sawKeyword) {
        return null;
      }
      const nestedCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\($/.exec(arg);
      if (nestedCall !== null) {
        const callExpression = parseMultilineCallExpression(
          lines,
          nextIndex + 1,
          nestedCall[1],
          nameMap,
          arrayNames,
          validatedTypeAliases,
        );
        if (callExpression === null) {
          return null;
        }
        positionalParts.push(callExpression.expression);
        nextIndex = callExpression.nextIndex;
        continue;
      }
      positionalParts.push(arg);
    } else {
      sawKeyword = true;
      keywordParts.push(`${tsExportNameForPythonName(keywordArg[1])}: ${translateExpression(keywordArg[2], nameMap, arrayNames, validatedTypeAliases)}`);
    }
    nextIndex += 1;
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
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): { statements: string[]; nextIndex: number } {
  const fullSliceAssignment = /^(.+)\[:\]$/.exec(pythonLeft);
  if (operator === '=' && fullSliceAssignment !== null) {
    const tsLeft = translateExpression(fullSliceAssignment[1], nameMap, arrayNames, validatedTypeAliases);
    return {
      statements: [`${tsLeft}.splice(0, ${tsLeft}.length, ...${tsRight});`],
      nextIndex,
    };
  }

  const assignedRight = operator === '=' ? maybeAwaitAsyncCall(tsRight) : tsRight;
  const mapItemAssignment = /^([A-Za-z_][A-Za-z0-9_]*)\[(.+)\]$/.exec(pythonLeft);
  if (operator === '=' && mapItemAssignment !== null) {
    const mapName = translateExpression(mapItemAssignment[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      return {
        statements: [`${mapName}.set(${translateExpression(mapItemAssignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${assignedRight});`],
        nextIndex,
      };
    }
  }
  const localAssignment = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonLeft);
  if (operator === '=' && localAssignment !== null) {
    const globalName = nameMap.get(localAssignment[1]);
    if (globalName !== undefined) {
      return {
        statements: [`${globalName} = ${assignedRight};`],
        nextIndex,
      };
    }
    const tsName = tsExportNameForPythonName(localAssignment[1]);
    if (assignedRight === tsName) {
      return { statements: [], nextIndex };
    }
    if (declaredNames.has(localAssignment[1])) {
      return {
        statements: [`${tsName} = ${assignedRight};`],
        nextIndex,
      };
    }
    declaredNames.add(localAssignment[1]);
    return {
      statements: [
        `${reassignedNames.has(localAssignment[1]) ? 'let' : 'const'} ${tsName} = ${assignedRight};`,
      ],
      nextIndex,
    };
  }
  const tupleAssignment = /^([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+)$/.exec(pythonLeft);
  if (operator === '=' && tupleAssignment !== null) {
    const names = tupleAssignment[1].split(', ');
    const tsNames = names.map(tsExportNameForPythonName);
    const alreadyDeclared = names.every((name) => declaredNames.has(name));
    for (const name of names) {
      declaredNames.add(name);
    }
    return {
      statements: [`${alreadyDeclared ? '' : 'const '}[${tsNames.join(', ')}] = ${assignedRight};`],
      nextIndex,
    };
  }
  return {
    statements: [`${translateExpression(pythonLeft, nameMap, arrayNames, validatedTypeAliases, mapNames)} ${operator} ${assignedRight};`],
    nextIndex,
  };
}

function maybeAwaitAsyncCall(tsExpression: string): string {
  return /^load[A-Z][A-Za-z0-9_]*\(.*\)$/.test(tsExpression) ? `await ${tsExpression}` : tsExpression;
}

function reassignedLocalNames(lines: string[], startIndex: number): Set<string> {
  const counts = new Map<string, number>();
  let firstStatementIndex = startIndex;
  while (firstStatementIndex < lines.length && lines[firstStatementIndex].trim() === '') {
    firstStatementIndex += 1;
  }
  const baseIndent = /^(\s+)/.exec(lines[firstStatementIndex] ?? '')?.[1] ?? null;
  if (baseIndent === null) {
    return new Set();
  }

  let index = firstStatementIndex;
  while (index < lines.length) {
    if (lines[index].trim() !== '' && !lines[index].startsWith(baseIndent)) {
      break;
    }
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
  const publicUppercaseName = !pythonName.startsWith('_') && /^[A-Z0-9_]+$/.test(pythonName);
  const name = annotatedType === null
    ? pythonName.startsWith('_') ? tsExportNameForPythonName(pythonName) : tsPublicNameForPythonName(pythonName)
    : publicUppercaseName ? tsPublicNameForPythonName(pythonName) : tsMutableNameForPythonName(pythonName);
  const baseAssignment = {
    pythonName,
    name,
    declaration: annotatedType === null || publicUppercaseName ? 'const' as const : 'let' as const,
    exported: !pythonName.startsWith('_'),
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

  if (value === '{') {
    const valueLines = ['new Map(['];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === '}') {
        valueLines.push('])');
        return {
          assignment: { ...baseAssignment, valueLines },
          nextIndex: nextIndex + 1,
        };
      }

      const dictItem = /^(.+): (.+),$/.exec(trimmed);
      if (dictItem === null) {
        return null;
      }
      valueLines.push(`  [${translateExpression(dictItem[1])}, ${translateExpression(dictItem[2])}],`);
      nextIndex += 1;
    }

    return null;
  }

  if (value === '{}' && annotatedType?.trim().startsWith('dict[') === true) {
    return {
      assignment: { ...baseAssignment, declaration: 'const', valueLines: ['new Map()'] },
      nextIndex: index + 1,
    };
  }

  const keywordCall = /^([A-Za-z_][A-Za-z0-9_]*)\($/.exec(value);
  if (keywordCall === null) {
    return {
      assignment: { ...baseAssignment, valueLines: [translateExpression(value)] },
      nextIndex: index + 1,
    };
  }

  const callee = tsExportNameForPythonName(keywordCall[1]);
  const callPrefix = /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
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
  typeAliases: TypeAlias[],
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
    ...plainClasses.flatMap((plainClass) => plainClass.constructorDefinition.statements),
    ...plainClasses.flatMap((plainClass) => plainClass.methods.flatMap((method) => method.statements)),
    ...leadingStatements,
    ...functions.flatMap((fn) => fn.statements),
    ...assignments.flatMap((assignment) => assignment.valueLines),
  ].join('\n'));
  const typeText = [
    ...typeAliases.map((alias) => alias.typeExpression),
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
    const valueNames = importDefinition.names.filter((name) => identifierPattern(name).test(valueText));
    const typeOnlyNames = importDefinition.names.filter((name) => (
      !identifierPattern(name).test(valueText) && identifierPattern(name).test(typeText)
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

function stripTypeOnlyStatementSyntax(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const nestedFunction = /^(\s*)(?:async )?function ([A-Za-z_$][A-Za-z0-9_$]*)\(/.exec(line);
      return nestedFunction === null ? line : `${nestedFunction[1]}function ${nestedFunction[2]}`;
    })
    .join('\n');
}

function translateExpression(
  pythonExpression: string,
  nameMap: Map<string, string> = new Map(),
  arrayNames: Set<string> = new Set(),
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): string {
  const trimmed = pythonExpression.trim();
  const listComprehension = /^\[(.+) for ([A-Za-z_][A-Za-z0-9_]*) in (.+)\]$/.exec(trimmed);
  if (listComprehension !== null) {
    const itemName = tsExportNameForPythonName(listComprehension[2]);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(listComprehension[2], itemName);
    return `${translateExpression(listComprehension[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}.map((${itemName}) => ${translateExpression(listComprehension[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const sortedCasefoldCall = /^sorted\((.+), key=str\.casefold\)$/.exec(trimmed);
  if (sortedCasefoldCall !== null) {
    const mapKeys = /^([A-Za-z_][A-Za-z0-9_]*)\.keys\(\)$/.exec(sortedCasefoldCall[1]);
    const iterable = mapKeys === null
      ? translateExpression(sortedCasefoldCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)
      : `Array.from(${translateExpression(mapKeys[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.keys())`;
    return `${iterable}.sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))`;
  }

  const mapMembership = /^(.+) in ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (mapMembership !== null) {
    const mapName = translateExpression(mapMembership[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      return `${mapName}.has(${translateExpression(mapMembership[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const mapSubscript = /^([A-Za-z_][A-Za-z0-9_]*)\[(.+)\]$/.exec(trimmed);
  if (mapSubscript !== null) {
    const mapName = translateExpression(mapSubscript[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      return `${mapName}.get(${translateExpression(mapSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})!`;
    }
  }

  const envComparison = /^os\.environ\.get\("([A-Za-z_][A-Za-z0-9_]*)"\) == "([^"]*)"$/.exec(trimmed);
  if (envComparison !== null) {
    return `typeof process !== 'undefined' && process.env?.${envComparison[1]} === '${envComparison[2]}'`;
  }
  if (trimmed === '()') {
    return '[]';
  }
  const fStringLiteral = /^f(["'])([\s\S]*)\1$/.exec(trimmed);
  if (fStringLiteral !== null) {
    return `\`${tsFStringTemplateContent(fStringLiteral[2], nameMap, arrayNames, validatedTypeAliases)}\``;
  }

  const strCall = parseCallPrefix(trimmed, 'str');
  if (strCall !== null && strCall.rest === '.strip().lower()') {
    return `${tsPropertyAccessBase(translateExpression(strCall.argsText, nameMap, arrayNames, validatedTypeAliases))}.trim().toLowerCase()`;
  }
  if (strCall !== null && strCall.rest === '.strip()') {
    return `${tsPropertyAccessBase(translateExpression(strCall.argsText, nameMap, arrayNames, validatedTypeAliases))}.trim()`;
  }

  for (const primitiveName of ['float', 'str', 'bool']) {
    const primitiveCall = parseCallPrefix(trimmed, primitiveName);
    if (primitiveCall !== null && primitiveCall.rest === '') {
      return translateExpression(primitiveCall.argsText, nameMap, arrayNames, validatedTypeAliases);
    }
  }

  const pathCall = parseCallPrefix(trimmed, 'Path');
  if (pathCall !== null && pathCall.rest === '') {
    return translateExpression(pathCall.argsText, nameMap, arrayNames, validatedTypeAliases);
  }

  const raylibConstructor = /^rl\.(Color|Vector2|Rectangle)\((.*)\)$/.exec(trimmed);
  if (raylibConstructor !== null) {
    const args = splitTopLevelComma(raylibConstructor[2]);
    if (raylibConstructor[1] === 'Color' && args.length === 4) {
      return `rl.makeColor(${args.map((arg) => translateRaylibColorArg(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
    if (raylibConstructor[1] === 'Vector2' && args.length === 2) {
      return `rl.makeVector2(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
    if (raylibConstructor[1] === 'Rectangle' && args.length === 4) {
      return `rl.makeRectangle(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
  }

  const blendFactorsSeparateCall = /^rl\.rl_set_blend_factors_separate\((.*)\)$/.exec(trimmed);
  if (blendFactorsSeparateCall !== null) {
    const args = splitTopLevelComma(blendFactorsSeparateCall[1]);
    if (args.length === 6) {
      return translatePositionalCallExpression('rl.rl_set_blend_factors_separate', args, nameMap, arrayNames, validatedTypeAliases);
    }
  }

  const tempDirPathJoin = /^Path\(tempfile\.gettempdir\(\)\) \/ "([^"\\]*)"$/.exec(trimmed);
  if (tempDirPathJoin !== null) {
    return tsStringLiteral(`"/tmp/${tempDirPathJoin[1]}"`);
  }

  const zeroArgConstructor = /^([A-Z][A-Za-z0-9_]*)\(\)$/.exec(trimmed);
  if (zeroArgConstructor !== null) {
    return `new ${tsExportNameForPythonName(zeroArgConstructor[1])}()`;
  }

  const dictGet = /^(.+)\.get\((.*)\)$/.exec(trimmed);
  if (dictGet !== null) {
    const parts = splitTopLevelComma(dictGet[2]);
    if (parts.length === 1 || parts.length === 2) {
      const value = `${translateExpression(dictGet[1], nameMap, arrayNames, validatedTypeAliases)}.get(${translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases)})`;
      return parts.length === 1 ? `${value} ?? null` : `${value} ?? ${translateExpression(parts[1], nameMap, arrayNames, validatedTypeAliases)}`;
    }
  }

  const msgspecConvert = parseCallPrefix(trimmed, 'msgspec.convert');
  if (msgspecConvert !== null && msgspecConvert.rest === '') {
    const parts = splitTopLevelComma(msgspecConvert.argsText);
    const typePart = parts.find((part) => part.startsWith('type='));
    const valuePart = parts.find((part) => !part.startsWith('type='));
    if (typePart !== undefined && valuePart !== undefined) {
      const typeExpression = tsTypeExpression(typePart.slice('type='.length).trim());
      const valueExpression = translateExpression(valuePart, nameMap, arrayNames, validatedTypeAliases);
      return validatedTypeAliases.has(typeExpression)
        ? `validate${typeExpression}(${valueExpression})`
        : `${valueExpression} as ${typeExpression}`;
    }
  }

  const mixedKeywordCall = translateMixedKeywordCall(trimmed, nameMap, arrayNames, validatedTypeAliases);
  if (mixedKeywordCall !== null) {
    return mixedKeywordCall;
  }

  const conditionalExpression = /^(.+) if (.+) else (.+)$/.exec(trimmed);
  if (conditionalExpression !== null) {
    return [
      translateExpression(conditionalExpression[2], nameMap, arrayNames, validatedTypeAliases),
      '?',
      translateExpression(conditionalExpression[1], nameMap, arrayNames, validatedTypeAliases),
      ':',
      translateExpression(conditionalExpression[3], nameMap, arrayNames, validatedTypeAliases),
    ].join(' ');
  }

  if (trimmed.includes(' and ')) {
    return trimmed
      .split(' and ')
      .map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases))
      .join(' && ');
  }

  if (trimmed.includes(' or ')) {
    return trimmed
      .split(' or ')
      .map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases))
      .join(' || ');
  }

  const lowerBoundLengthComparison = /^(.+?) <= (.+?) < len\((.+)\)$/.exec(trimmed);
  if (lowerBoundLengthComparison !== null) {
    const value = translateExpression(lowerBoundLengthComparison[2], nameMap, arrayNames, validatedTypeAliases);
    return `${value} >= ${translateExpression(lowerBoundLengthComparison[1], nameMap, arrayNames, validatedTypeAliases)} && ${value} < ${translateExpression(lowerBoundLengthComparison[3], nameMap, arrayNames, validatedTypeAliases)}.length`;
  }

  const chainedLessEqualComparison = /^(.+?) <= (.+?) <= (.+)$/.exec(trimmed);
  if (chainedLessEqualComparison !== null) {
    const middle = translateExpression(chainedLessEqualComparison[2], nameMap, arrayNames, validatedTypeAliases);
    return `${translateExpression(chainedLessEqualComparison[1], nameMap, arrayNames, validatedTypeAliases)} <= ${middle} && ${middle} <= ${translateExpression(chainedLessEqualComparison[3], nameMap, arrayNames, validatedTypeAliases)}`;
  }

  const notInTuple = /^(.+?) not in \((.*)\)$/.exec(trimmed);
  if (notInTuple !== null) {
    const value = translateExpression(notInTuple[1], nameMap, arrayNames, validatedTypeAliases);
    return splitTopLevelComma(notInTuple[2])
      .map((item) => `${value} !== ${translateExpression(item, nameMap, arrayNames, validatedTypeAliases)}`)
      .join(' && ');
  }

  const inTuple = /^(.+?) in \((.*)\)$/.exec(trimmed);
  if (inTuple !== null) {
    const value = translateExpression(inTuple[1], nameMap, arrayNames, validatedTypeAliases);
    return splitTopLevelComma(inTuple[2])
      .map((item) => `${value} === ${translateExpression(item, nameMap, arrayNames, validatedTypeAliases)}`)
      .join(' || ');
  }

  const floorDivision = /^(.+) \/\/ (.+)$/.exec(trimmed);
  if (floorDivision !== null) {
    return `Math.floor(${translateExpression(floorDivision[1], nameMap, arrayNames, validatedTypeAliases)} / ${translateExpression(floorDivision[2], nameMap, arrayNames, validatedTypeAliases)})`;
  }

  const identityComparison = /^(.+?) is( not)? (.+)$/.exec(trimmed);
  if (identityComparison !== null) {
    return `${translateExpression(identityComparison[1], nameMap, arrayNames, validatedTypeAliases)} ${identityComparison[2] === undefined ? '===' : '!=='} ${translateExpression(identityComparison[3], nameMap, arrayNames, validatedTypeAliases)}`;
  }

  const binaryComparison = /^(.+?) (<=|>=|<|>|==|!=) (.+)$/.exec(trimmed);
  if (binaryComparison !== null) {
    const operator = binaryComparison[2] === '=='
      ? '==='
      : binaryComparison[2] === '!='
        ? '!=='
        : binaryComparison[2];
    return `${translateExpression(binaryComparison[1], nameMap, arrayNames, validatedTypeAliases)} ${operator} ${translateExpression(binaryComparison[3], nameMap, arrayNames, validatedTypeAliases)}`;
  }

  const notIdentifier = /^not ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (notIdentifier !== null) {
    const value = translateExpression(notIdentifier[1], nameMap, arrayNames, validatedTypeAliases);
    return arrayNames.has(notIdentifier[1]) ? `!${value}.length` : `!${value}`;
  }

  const notPlayersCollection = /^not ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.players)$/.exec(trimmed);
  if (notPlayersCollection !== null) {
    return `${translateExpression(notPlayersCollection[1], nameMap, arrayNames, validatedTypeAliases)}.length === 0`;
  }

  const notExpression = /^not (.+)$/.exec(trimmed);
  if (notExpression !== null) {
    const value = translateExpression(notExpression[1], nameMap, arrayNames, validatedTypeAliases);
    if (/^[A-Za-z_$][A-Za-z0-9_.$]*\(.*\)$/.test(value)) {
      return `!${value}`;
    }
    return /^[A-Za-z_$][A-Za-z0-9_.$()[\]]*$/.test(value) ? `!${value}` : `!(${value})`;
  }

  const prefixSlice = /^(.+)\[:(-?\d+)\]$/.exec(trimmed);
  if (prefixSlice !== null) {
    return `${translateExpression(prefixSlice[1], nameMap, arrayNames, validatedTypeAliases)}.slice(0, ${prefixSlice[2]})`;
  }

  const openEndedSlice = /^(.+)\[(\d+):\]$/.exec(trimmed);
  if (openEndedSlice !== null) {
    return `${translateExpression(openEndedSlice[1], nameMap, arrayNames, validatedTypeAliases)}.slice(${openEndedSlice[2]})`;
  }

  const enumIdCast = /^([A-Z][A-Za-z0-9_]*Id)\((.+)\)$/.exec(trimmed);
  if (enumIdCast !== null) {
    return translateExpression(enumIdCast[2], nameMap, arrayNames, validatedTypeAliases);
  }

  const positionalConstructor = /^([A-Z][A-Za-z0-9_]*)\((.*)\)$/.exec(trimmed);
  if (positionalConstructor !== null) {
    const args = splitTopLevelComma(positionalConstructor[2]);
    if (args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))) {
      return `new ${tsExportNameForPythonName(positionalConstructor[1])}(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
  }

  const tupleLiteral = /^\((.*)\)$/.exec(trimmed);
  if (tupleLiteral !== null && tupleLiteral[1].includes(',')) {
    const values = tupleLiteral[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases));
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
        `${translateExpression(callee, nameMap, arrayNames, validatedTypeAliases)}({ ${tsExportNameForPythonName(argName)}: ${translateExpression(argValue, nameMap, arrayNames, validatedTypeAliases)} })`
      ),
    )
    .replaceAll(/\b(?:float|str|bool)\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, '$1')
    .replaceAll(/\blen\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, '$1.length')
    .replaceAll(/\.append\(/g, '.push(')
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
  return replaceTranslatedRaylibConstructors(translated)
    .replaceAll(/__CRIMSON_STRING_(\d+)__/g, (_match, index: string) => stringLiterals[Number(index)] ?? _match)
    .replaceAll(/\.BLEND_CUSTOM_SEPARATE\b/g, '.CUSTOM')
    .replaceAll(/\.BLEND_CUSTOM\b/g, '.CUSTOM')
    .replaceAll(/\.BLEND_ADDITIVE\b/g, '.ADDITIVE')
    .replaceAll(/\.BLEND_ALPHA\b/g, '.ALPHA')
    .replaceAll(/\.BLEND_MULTIPLIED\b/g, '.MULTIPLY')
    .replaceAll(/\.BLEND_NONE\b/g, '.NONE');
}

function replaceTranslatedRaylibConstructors(value: string): string {
  let output = '';
  let index = 0;
  const constructorPattern = /rl\.(Color|Vector2|Rectangle)\(/g;
  while (index < value.length) {
    constructorPattern.lastIndex = index;
    const match = constructorPattern.exec(value);
    if (match === null) {
      output += value.slice(index);
      break;
    }

    const argsStart = constructorPattern.lastIndex;
    const closeIndex = matchingCloseParen(value, argsStart - 1);
    if (closeIndex === null) {
      output += value.slice(index);
      break;
    }

    output += value.slice(index, match.index);
    const args = splitTopLevelComma(value.slice(argsStart, closeIndex));
    if (match[1] === 'Color' && args.length === 4) {
      output += `rl.makeColor(${args.map((arg) => /\.[rgba]$/.test(arg.trim()) ? arg.trim() : `${arg.trim()} / 255`).join(', ')})`;
    } else if (match[1] === 'Vector2' && args.length === 2) {
      output += `rl.makeVector2(${args.map((arg) => arg.trim()).join(', ')})`;
    } else if (match[1] === 'Rectangle' && args.length === 4) {
      output += `rl.makeRectangle(${args.map((arg) => arg.trim()).join(', ')})`;
    } else {
      output += value.slice(match.index, closeIndex + 1);
    }
    index = closeIndex + 1;
  }
  return output;
}

function matchingCloseParen(value: string, openIndex: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < value.length; index += 1) {
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
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}

function translateMixedKeywordCall(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
): string | null {
  const call = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/.exec(pythonExpression);
  if (call === null || !call[2].includes('=')) {
    return null;
  }

  const parts = splitTopLevelComma(call[2]);
  const keywordParts: string[] = [];
  const positionalParts: string[] = [];
  let sawKeyword = false;
  for (const part of parts) {
    const keyword = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(part);
    if (keyword === null) {
      if (sawKeyword) {
        return null;
      }
      positionalParts.push(part);
      continue;
    }
    sawKeyword = true;
    keywordParts.push(`${tsExportNameForPythonName(keyword[1])}: ${translateExpression(keyword[2], nameMap, arrayNames, validatedTypeAliases)}`);
  }
  if (keywordParts.length === 0) {
    return null;
  }
  const callee = translateExpression(call[1], nameMap, arrayNames, validatedTypeAliases);
  const callPrefix = /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
  if (positionalParts.length === 0) {
    return `${callPrefix}({ ${keywordParts.join(', ')} })`;
  }

  return `${callPrefix}(${[
    ...positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases)),
    `{ ${keywordParts.join(', ')} }`,
  ].join(', ')})`;
}

function parseCallPrefix(expression: string, callee: string): { argsText: string; rest: string } | null {
  const prefix = `${callee}(`;
  if (!expression.startsWith(prefix)) {
    return null;
  }

  let depth = 0;
  let quote: string | null = null;
  for (let index = callee.length; index < expression.length; index += 1) {
    const char = expression[index];
    if (quote !== null) {
      if (char === quote && expression[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          argsText: expression.slice(prefix.length, index),
          rest: expression.slice(index + 1),
        };
      }
      if (depth < 0) {
        return null;
      }
    }
  }
  return null;
}

function tsPropertyAccessBase(expression: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]+\])*$/.test(expression)
    ? expression
    : `(${expression})`;
}

function splitTopLevelComma(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
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
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      continue;
    }
    if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter((part) => part !== '');
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
