import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TranslationJob } from './model.js';
import { tsExportNameForPythonName } from './naming.js';
import {
  parseConstantsModule,
  parseFunctionsModule,
  parseGuardedAttributeModule,
  parseBrowserInputModule,
  parseIntEnumModule,
  parseInitReexports,
  parseLazyWrapperModule,
  parseNamespaceReexports,
  parsePackageVersionModule,
  parsePlatformDirsModule,
  parseProfileHooksModule,
  parseQuestLevelModule,
  parseProtocolModule,
  parseMsgspecStructModule,
  parseSimpleExportModule,
  parseStraightLineModule,
  parseTypeAliases,
  parseTyperCliModule,
} from './patterns/index.js';
import { pythonProjectRoot, repoRoot } from './paths.js';
import { parseModuleDocstring, stripFutureImports, stripIgnorablePythonLines } from './python-utils.js';
import {
  renderConstantsModule,
  renderEmptyModule,
  renderExcludedRuntimeModule,
  renderFunctionsModule,
  renderGuardedAttributeModule,
  renderBrowserInputModule,
  renderIntEnumModule,
  renderInitReexports,
  renderLazyWrapperModule,
  renderModuleDocOnly,
  renderNamespaceReexports,
  renderPackageVersionModule,
  renderPlatformDirsModule,
  renderProfileHooksModule,
  renderQuestLevelModule,
  renderProtocolModule,
  renderMsgspecStructModule,
  renderSimpleExportModule,
  renderStraightLineModule,
  renderTypeAliases,
  renderTyperCliModule,
} from './renderers/index.js';

export async function translateFile(job: TranslationJob): Promise<string> {
  const futureStripped = stripFutureImports(job.python).trim();
  const initReexports = parseInitReexports(futureStripped, job.relativePath);
  if (initReexports !== null) {
    return renderInitReexports(job.relativePath, initReexports);
  }

  const namespaceReexports = parseNamespaceReexports(futureStripped);
  if (namespaceReexports !== null) {
    return renderNamespaceReexports(job.relativePath, namespaceReexports);
  }

  const lazyWrapperModule = parseLazyWrapperModule(futureStripped);
  if (lazyWrapperModule !== null) {
    return renderLazyWrapperModule(job.relativePath, lazyWrapperModule);
  }

  const protocolModule = parseProtocolModule(futureStripped);
  if (protocolModule !== null) {
    return renderProtocolModule(job.relativePath, protocolModule);
  }

  const intEnumModule = parseIntEnumModule(futureStripped);
  if (intEnumModule !== null) {
    return renderIntEnumModule(job.relativePath, intEnumModule);
  }

  const typeAliases = parseTypeAliases(futureStripped);
  if (typeAliases !== null) {
    return renderTypeAliases(job.relativePath, typeAliases);
  }

  const constantsModule = parseConstantsModule(futureStripped);
  if (constantsModule !== null) {
    return renderConstantsModule(job.relativePath, constantsModule);
  }

  const packageVersionModule = parsePackageVersionModule(futureStripped);
  if (packageVersionModule !== null) {
    const version = await readPythonProjectVersion(packageVersionModule.packageName);
    return renderPackageVersionModule(job.relativePath, version);
  }

  const platformDirsModule = parsePlatformDirsModule(futureStripped);
  if (platformDirsModule !== null) {
    return renderPlatformDirsModule(job.relativePath, platformDirsModule);
  }

  const guardedAttributeModule = parseGuardedAttributeModule(futureStripped, job.relativePath);
  if (guardedAttributeModule !== null) {
    return renderGuardedAttributeModule(job.relativePath, guardedAttributeModule);
  }

  if (parseBrowserInputModule(futureStripped)) {
    return renderBrowserInputModule(job.relativePath);
  }

  if (parseProfileHooksModule(futureStripped)) {
    return renderProfileHooksModule(job.relativePath);
  }

  if (parseQuestLevelModule(futureStripped)) {
    return renderQuestLevelModule(job.relativePath);
  }

  const existingExcludedRuntimePort = await readExistingExcludedRuntimePort(futureStripped, job.targetPath);
  if (existingExcludedRuntimePort !== null) {
    return existingExcludedRuntimePort;
  }
  if (usesUnsupportedRuntimeIo(futureStripped) && isExcludedRuntimeModule(job.relativePath)) {
    return renderExcludedRuntimeModule(job.relativePath, excludedRuntimeExportNames(futureStripped));
  }

  const simpleExportModule = parseSimpleExportModule(futureStripped, job.relativePath);
  if (simpleExportModule !== null) {
    return renderSimpleExportModule(job.relativePath, simpleExportModule);
  }

  const msgspecStructModule = parseMsgspecStructModule(futureStripped, job.relativePath);
  if (msgspecStructModule !== null) {
    return renderMsgspecStructModule(job.relativePath, msgspecStructModule);
  }

  const straightLineModule = parseStraightLineModule(futureStripped, job.relativePath);
  if (straightLineModule !== null) {
    return renderStraightLineModule(job.relativePath, straightLineModule);
  }

  const typerCliModule = parseTyperCliModule(futureStripped);
  if (typerCliModule !== null) {
    return renderTyperCliModule(job.relativePath, typerCliModule);
  }

  const functionsModule = parseFunctionsModule(futureStripped);
  if (functionsModule !== null) {
    return renderFunctionsModule(job.relativePath, functionsModule);
  }

  const trimmed = stripIgnorablePythonLines(job.python).trim();
  if (trimmed === '') {
    return renderEmptyModule(job.relativePath);
  }

  const docstring = parseModuleDocstring(trimmed);
  if (docstring !== null && trimmed === docstring.raw) {
    return renderModuleDocOnly(job.relativePath, docstring.value);
  }

  throw new Error(
    `translator not implemented for ${job.relativePath} -> ${path.relative(repoRoot, job.targetPath)}`,
  );
}

async function readExistingExcludedRuntimePort(trimmedPython: string, targetPath: string): Promise<string | null> {
  if (!usesUnsupportedRuntimeIo(trimmedPython)) {
    return null;
  }
  try {
    const existing = await readFile(targetPath, 'utf8');
    if (/^\/\/ Port of .+\.py$/.test(existing.trim())) {
      return null;
    }
    return existing;
  } catch {
    return null;
  }
}

function usesUnsupportedRuntimeIo(trimmedPython: string): boolean {
  return [
    /\bshutil\.(?:copy|copy2|copyfileobj|copytree|move|rmtree)\(/m,
    /^import tempfile$/m,
    /^import structlog$/m,
    /^\s*import hashlib$/m,
    /^import faulthandler$/m,
    /^import urllib\.(?:error|request)$/m,
    /^from PIL import /m,
    /^import ast$/m,
    /^import importlib$/m,
    /^class RGBA\(msgspec\.Struct, frozen=True\):$/m,
    /\brl\.load_shader_from_memory\(/m,
    /\brl\.begin_shader_mode\(/m,
  ].some((pattern) => pattern.test(trimmedPython));
}

function isExcludedRuntimeModule(relativePath: string): boolean {
  return /(?:^|\/)(?:dbg|replay|net)(?:\/|$)/.test(relativePath);
}

function excludedRuntimeExportNames(trimmedPython: string): string[] {
  const allNames = parseAllExportNames(trimmedPython);
  const names = allNames.length > 0
    ? allNames
    : topLevelDefinitionNames(trimmedPython);
  return [...new Set(names.map(tsExportNameForPythonName))];
}

function parseAllExportNames(trimmedPython: string): string[] {
  const lines = trimmedPython.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const oneLineAll = /^__all__ = \[(.*)\]$/.exec(trimmed);
    if (oneLineAll !== null) {
      return parseQuotedNameList(oneLineAll[1]);
    }
    if (trimmed !== '__all__ = [') {
      continue;
    }
    const names: string[] = [];
    index += 1;
    while (index < lines.length && lines[index].trim() !== ']') {
      const name = /^["']([A-Za-z_][A-Za-z0-9_]*)["'],?$/.exec(lines[index].trim());
      if (name === null) {
        return [];
      }
      names.push(name[1]);
      index += 1;
    }
    return names;
  }
  return [];
}

function parseQuotedNameList(namesText: string): string[] {
  const trimmed = namesText.trim();
  if (trimmed === '') {
    return [];
  }
  const names: string[] = [];
  for (const part of trimmed.split(',').map((value) => value.trim()).filter((value) => value !== '')) {
    const name = /^["']([A-Za-z_][A-Za-z0-9_]*)["']$/.exec(part);
    if (name === null) {
      return [];
    }
    names.push(name[1]);
  }
  return names;
}

function topLevelDefinitionNames(trimmedPython: string): string[] {
  const names: string[] = [];
  for (const line of trimmedPython.split(/\r?\n/)) {
    const definition = /^(?:class|def) ([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
    if (definition !== null) {
      names.push(definition[1]);
    }
  }
  return names;
}

async function readPythonProjectVersion(packageName: string): Promise<string> {
  const pyprojectPath = path.join(pythonProjectRoot, 'pyproject.toml');
  const pyproject = await readFile(pyprojectPath, 'utf8');
  const projectLines: string[] = [];
  let inProject = false;
  for (const line of pyproject.split(/\r?\n/)) {
    if (/^\[[^\]]+\]$/.test(line)) {
      if (inProject) {
        break;
      }
      inProject = line === '[project]';
      continue;
    }
    if (inProject) {
      projectLines.push(line);
    }
  }
  if (!inProject || projectLines.length === 0) {
    throw new Error(`failed to find [project] in ${path.join(pythonProjectRoot, 'pyproject.toml')}`);
  }
  const projectBlock = projectLines.join('\n');
  const name = /^name = "([^"]+)"$/m.exec(projectBlock)?.[1] ?? null;
  const version = /^version = "([^"]+)"$/m.exec(projectBlock)?.[1] ?? null;
  if (name !== packageName || version === null) {
    throw new Error(`failed to resolve version for Python package ${packageName}`);
  }
  return version;
}
