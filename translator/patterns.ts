import type {
  ConstantDefinition,
  ConstantsModule,
  FunctionDefinition,
  FunctionParameter,
  GuardedAttributeModule,
  ImportDefinition,
  InitReexports,
  LazyWrapperModule,
  NamespaceReexport,
  ProtocolDefinition,
  ProtocolMethod,
  Reexport,
  SimpleExportModule,
  SimpleFunctionDefinition,
  SimpleFunctionParameter,
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
  let sawAll = false;
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
      sawAll = true;
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

    const ignored = /^    _ = ([A-Za-z_][A-Za-z0-9_]*)$/.exec(lines[index] ?? '');
    if (ignored !== null) {
      const parameter = parameters.find((candidate) => candidate.name === tsExportNameForPythonName(ignored[1]));
      if (parameter === undefined) {
        return null;
      }
      parameter.ignored = true;
      index += 1;
    }

    const returnLine = /^    return ([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(lines[index] ?? '');
    if (returnLine === null) {
      return null;
    }
    index += 1;

    const receiverName = tsExportNameForPythonName(returnLine[1]);
    if (!parameters.some((parameter) => parameter.name === receiverName)) {
      return null;
    }

    functions.push({
      name: tsExportNameForPythonName(header[1]),
      parameters,
      returnType: tsTypeExpression(header[3]),
      returnExpression: `${receiverName}.${tsExportNameForPythonName(returnLine[2])}`,
    });
  }

  return sawAll && constants.length + functions.length > 0
    ? { imports, constants, functions }
    : null;
}
