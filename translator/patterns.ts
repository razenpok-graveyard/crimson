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
  PackageVersionModule,
  ProtocolDefinition,
  ProtocolMethod,
  Reexport,
  SimpleExportModule,
  SimpleFunctionDefinition,
  SimpleFunctionParameter,
  SimpleModuleAssignment,
  SimpleModuleFunction,
  StraightLineModule,
  TypeAlias,
} from './model.js';
import { tsCallableType, tsExportNameForPythonName, tsLiteralExpression, tsTypeExpression } from './naming.js';
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

    return null;
  }

  return members.length > 0 ? { name: header[1], docstring, members } : null;
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

export function parseStraightLineModule(trimmedPython: string, relativePath: string): StraightLineModule | null {
  const lines = flattenFromImportBlocks(trimmedPython.split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  const functions: SimpleModuleFunction[] = [];
  const assignments: SimpleModuleAssignment[] = [];
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

    const names = fromImport[2].split(', ').map(tsExportNameForPythonName);
    imports.push({
      modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
      names,
    });
    index += 1;
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
    if (header[2] !== '') {
      for (const parameterText of header[2].split(', ')) {
        const parameter = /^([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(parameterText);
        if (parameter === null) {
          return null;
        }
        parameters.push({
          name: tsExportNameForPythonName(parameter[1]),
          typeExpression: tsTypeExpression(parameter[2]),
        });
      }
    }

    const statements: string[] = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '') {
        index += 1;
        break;
      }
      const statement = translateStraightLineStatement(lines, index, '    ');
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

    const assignment = parseTopLevelAssignment(lines, index);
    if (assignment === null) {
      return null;
    }
    assignments.push(assignment.assignment);
    index = assignment.nextIndex;
  }

  markTypeOnlyImports(imports, functions, assignments);

  return functions.length + assignments.length > 0
    ? { imports, functions, assignments }
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
): { statements: string[]; nextIndex: number } | null {
  const line = lines[index];
  if (line === undefined || !line.startsWith(indent)) {
    return null;
  }
  const statement = line.slice(indent.length);
  if (statement.trim() === '' || statement.startsWith(' ')) {
    return null;
  }

  const ifStatement = /^if (.+):$/.exec(statement);
  if (ifStatement !== null) {
    const innerIndent = `${indent}    `;
    const innerStatements: string[] = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length && lines[nextIndex].startsWith(innerIndent)) {
      const innerStatement = translateStraightLineStatement(lines, nextIndex, innerIndent);
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
        `if (${translateExpression(ifStatement[1])}) {`,
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
    return { statements: [`return ${translateExpression(returnStatement[1])};`], nextIndex: index + 1 };
  }

  const assignment = /^(.+?) (\+=|-=|\*=|\/=|=) (.+)$/.exec(statement);
  if (assignment !== null) {
    return {
      statements: [`${translateExpression(assignment[1])} ${assignment[2]} ${translateExpression(assignment[3])};`],
      nextIndex: index + 1,
    };
  }

  return null;
}

function parseTopLevelAssignment(
  lines: string[],
  index: number,
): { assignment: SimpleModuleAssignment; nextIndex: number } | null {
  const assignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(lines[index] ?? '');
  if (assignment === null) {
    return null;
  }

  const name = tsExportNameForPythonName(assignment[1]);
  const value = assignment[2];
  const keywordCall = /^([A-Za-z_][A-Za-z0-9_]*)\($/.exec(value);
  if (keywordCall === null) {
    return {
      assignment: { name, valueLines: [translateExpression(value)] },
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
        assignment: { name, valueLines },
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

  for (const importDefinition of imports) {
    importDefinition.typeOnly = importDefinition.names.every((name) => !identifierPattern(name).test(valueText));
  }
}

function translateExpression(pythonExpression: string): string {
  return pythonExpression
    .trim()
    .replaceAll(/\b(?:float|str|bool)\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, '$1')
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
      return tsExportNameForPythonName(name);
    });
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
