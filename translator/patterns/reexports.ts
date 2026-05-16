import fs from 'node:fs';
import path from 'node:path';
import type {
  InitReexports,
  LazyWrapperModule,
  NamespaceReexport,
  Reexport,
} from '../model.js';
import { tsExportNameForPythonName, tsTypeExpression } from '../naming.js';
import { tsImportPathForPythonModule, tsImportPathForPythonNamespace, tsTargetRoot } from '../paths.js';
import {
  flattenFromImportBlocks,
  isOneLineAllAssignment,
  splitLeadingModuleDocstring,
  stripAllAssignments,
} from '../python-utils.js';

export function parseInitReexports(trimmedPython: string, relativePath: string): InitReexports | null {
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
      names: fromImport[2].split(', ').map((name) => {
        const exportName = tsExportNameForPythonName(name);
        return tsModuleExportsTypeOnly(tsImportPathForPythonModule(fromImport[1]), exportName, relativePath)
          ? `type ${exportName}`
          : exportName;
      }),
    });
  }

  return sawAll && namespaceReexports.length + reexports.length > 0
    ? { docstring: docstring?.value ?? null, namespaceReexports, reexports }
    : null;
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
