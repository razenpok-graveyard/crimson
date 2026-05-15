import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TranslationJob } from './model.js';
import {
  parseConstantsModule,
  parseFunctionsModule,
  parseGuardedAttributeModule,
  parseIntEnumModule,
  parseInitReexports,
  parseLazyWrapperModule,
  parseNamespaceReexports,
  parsePackageVersionModule,
  parsePlatformDirsModule,
  parseProtocolModule,
  parseMsgspecStructModule,
  parseSimpleExportModule,
  parseStraightLineModule,
  parseTypeAliases,
} from './patterns.js';
import { pythonProjectRoot, repoRoot } from './paths.js';
import { parseModuleDocstring, stripFutureImports, stripIgnorablePythonLines } from './python-utils.js';
import {
  renderConstantsModule,
  renderEmptyModule,
  renderFunctionsModule,
  renderGuardedAttributeModule,
  renderIntEnumModule,
  renderInitReexports,
  renderLazyWrapperModule,
  renderModuleDocOnly,
  renderNamespaceReexports,
  renderPackageVersionModule,
  renderPlatformDirsModule,
  renderProtocolModule,
  renderMsgspecStructModule,
  renderSimpleExportModule,
  renderStraightLineModule,
  renderTypeAliases,
} from './renderers.js';

export async function translateFile(job: TranslationJob): Promise<string> {
  const futureStripped = stripFutureImports(job.python).trim();
  const initReexports = parseInitReexports(futureStripped);
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
