import path from 'node:path';
import type { TranslationJob } from './model.js';
import {
  parseConstantsModule,
  parseFunctionsModule,
  parseGuardedAttributeModule,
  parseInitReexports,
  parseLazyWrapperModule,
  parseNamespaceReexports,
  parseProtocolModule,
  parseSimpleExportModule,
  parseTypeAliases,
} from './patterns.js';
import { repoRoot } from './paths.js';
import { isIntentionallyExcludedPath, parseModuleDocstring, stripFutureImports, stripIgnorablePythonLines } from './python-utils.js';
import {
  renderConstantsModule,
  renderEmptyModule,
  renderFunctionsModule,
  renderGuardedAttributeModule,
  renderInitReexports,
  renderLazyWrapperModule,
  renderModuleDocOnly,
  renderNamespaceReexports,
  renderProtocolModule,
  renderSimpleExportModule,
  renderTypeAliases,
} from './renderers.js';

export async function translateFile(job: TranslationJob): Promise<string> {
  if (isIntentionallyExcludedPath(job.relativePath)) {
    return renderEmptyModule(job.relativePath);
  }

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

  const typeAliases = parseTypeAliases(futureStripped);
  if (typeAliases !== null) {
    return renderTypeAliases(job.relativePath, typeAliases);
  }

  const constantsModule = parseConstantsModule(futureStripped);
  if (constantsModule !== null) {
    return renderConstantsModule(job.relativePath, constantsModule);
  }

  const guardedAttributeModule = parseGuardedAttributeModule(futureStripped, job.relativePath);
  if (guardedAttributeModule !== null) {
    return renderGuardedAttributeModule(job.relativePath, guardedAttributeModule);
  }

  const simpleExportModule = parseSimpleExportModule(futureStripped, job.relativePath);
  if (simpleExportModule !== null) {
    return renderSimpleExportModule(job.relativePath, simpleExportModule);
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
