import type {
  ConstantDefinition,
  ConstantsModule,
  FunctionDefinition,
  FunctionParameter,
  GuardedAttributeModule,
  ImportDefinition,
  PackageVersionModule,
  PlatformDirsModule,
  ProtocolDefinition,
  ProtocolMethod,
  SimpleExportModule,
  SimpleFunctionParameter,
  SimpleFunctionDefinition,
  TypeAlias,
  TypeAliasValidation,
} from '../model.js';
import {
  tsCallableType,
  tsExportNameForPythonName,
  tsLiteralExpression,
  tsTypeExpression,
} from '../naming.js';
import { tsImportPathForPythonImport } from '../paths.js';
import {
  flattenFromImportBlocks,
  isOneLineAllAssignment,
  splitLeadingModuleDocstring,
} from '../python-utils.js';
import {
  isCollectionsAbcTypeImport,
  parseIndentedDocstring,
  parseOneLineAllNames,
  splitTopLevelComma,
} from './common.js';
import { translateExpression, tsRegExpExpression } from './expression.js';
import { parseFunctionParameterText, tsSimpleExpression } from './parameters.js';

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

export function parseProtocolClass(
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
    const line = lines[nextIndex] ?? '';
    if (line.trim() === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith('    ')) {
      break;
    }

    const property = /^    ([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(line);
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

    if (line.trim() === '@property') {
      const propertyMethod = parseProtocolMethod(lines, nextIndex + 1);
      if (propertyMethod === null || propertyMethod.method.parameters.length > 0 || propertyMethod.method.optsParams.length > 0) {
        return null;
      }
      methods.push({
        ...propertyMethod.method,
        property: true,
      });
      nextIndex = propertyMethod.nextIndex;
      continue;
    }

    const method = parseProtocolMethod(lines, nextIndex);
    if (method === null) {
      return null;
    }
    methods.push(method.method);
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

function parseProtocolMethod(
  lines: string[],
  index: number,
): { method: ProtocolMethod; nextIndex: number } | null {
  const oneLine = /^    def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([^:]+): \.\.\.$/.exec(lines[index] ?? '');
  if (oneLine !== null) {
    const parameters = parseProtocolParameters(oneLine[2]);
    if (parameters === null) {
      return null;
    }
    return {
      method: {
        name: tsExportNameForPythonName(oneLine[1]),
        ...parameters,
        returnType: tsTypeExpression(oneLine[3]),
      },
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
      const parameters = parseProtocolParameters(parameterLines.join(', '));
      if (parameters === null) {
        return null;
      }
      return {
        method: {
          name: tsExportNameForPythonName(start[1]),
          ...parameters,
          returnType: tsTypeExpression(close[1]),
        },
        nextIndex: nextIndex + 1,
      };
    }

    const parameterLine = /^        (.+),$/.exec(lines[nextIndex] ?? '');
    if (parameterLine === null) {
      return null;
    }
    parameterLines.push(parameterLine[1]);
    nextIndex += 1;
  }

  return null;
}

function parseProtocolParameters(parametersText: string): Pick<ProtocolMethod, 'parameters' | 'optsParams' | 'optsOptional'> | null {
  const parameters: ProtocolMethod['parameters'] = [];
  const optsParams: ProtocolMethod['optsParams'] = [];
  let keywordOnly = false;
  for (const parameterText of splitTopLevelComma(parametersText)) {
    if (parameterText === 'self') {
      continue;
    }
    if (parameterText === '*') {
      keywordOnly = true;
      continue;
    }
    const parameter = parseFunctionParameterText(parameterText, new Set());
    if (parameter === null) {
      return null;
    }
    if (keywordOnly) {
      optsParams.push(parameter);
    } else {
      parameters.push(parameter);
    }
  }
  return {
    parameters,
    optsParams,
    optsOptional: optsParams.length > 0 && optsParams.every((param) => param.defaultValue !== undefined),
  };
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
export function parseTypeAliasValidation(metadataText: string): TypeAliasValidation | undefined {
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
