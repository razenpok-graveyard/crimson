import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface TranslationJob {
  index: number;
  relativePath: string;
  sourcePath: string;
  targetPath: string;
  python: string;
}

const repoRoot = process.cwd();
const translatorDir = path.join(repoRoot, 'translator');
const filesPath = path.join(translatorDir, 'files.txt');
const progressPath = path.join(translatorDir, 'progress.txt');
const pythonSourceRoot = path.resolve(process.env.PY_SOURCE_ROOT ?? path.join(repoRoot, '..', 'crimson', 'src'));
const tsTargetRoot = path.resolve(process.env.TS_TARGET_ROOT ?? path.join(repoRoot, 'src'));

function parseFileList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

function parseProgress(text: string, fileCount: number): number {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`translator/progress.txt must contain one non-negative integer, got ${JSON.stringify(trimmed)}`);
  }

  const progress = Number(trimmed);
  if (!Number.isSafeInteger(progress)) {
    throw new Error(`translator/progress.txt is too large: ${trimmed}`);
  }
  if (progress > fileCount) {
    throw new Error(`translator/progress.txt is ${progress}, but translator/files.txt only has ${fileCount} files`);
  }
  return progress;
}

function assertRelativePath(relativePath: string): void {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`translator/files.txt contains an unsafe path: ${relativePath}`);
  }
  if (!relativePath.endsWith('.py')) {
    throw new Error(`translator/files.txt entry must end with .py: ${relativePath}`);
  }
}

function tsPathForPython(relativePath: string): string {
  const parts = relativePath.split('/');
  const file = parts.pop();
  if (file === undefined) {
    throw new Error(`invalid Python path: ${relativePath}`);
  }

  const tsParts = parts.map((part) => part.replaceAll('_', '-'));
  if (file === '__init__.py') {
    tsParts.push('index.ts');
  } else {
    tsParts.push(file.slice(0, -'.py'.length).replaceAll('_', '-') + '.ts');
  }
  return tsParts.join('/');
}

async function translateFile(job: TranslationJob): Promise<string> {
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

function stripIgnorablePythonLines(python: string): string {
  return stripAllAssignments(stripFutureImports(python).split(/\r?\n/)).join('\n');
}

function stripFutureImports(python: string): string {
  return python
    .split(/\r?\n/)
    .filter((line) => line.trim() !== 'from __future__ import annotations')
    .join('\n');
}

function isOneLineAllAssignment(trimmedLine: string): boolean {
  return /^__all__ = \[[^\]]*\]$/.test(trimmedLine);
}

function stripAllAssignments(lines: string[]): string[] {
  const stripped: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed.startsWith('__all__ = ')) {
      stripped.push(lines[index]);
      continue;
    }

    if (isOneLineAllAssignment(trimmed)) {
      continue;
    }

    while (index < lines.length && lines[index].trim() !== ']') {
      index += 1;
    }
  }

  return stripped;
}

function renderEmptyModule(relativePath: string): string {
  return `// Port of ${relativePath}\n`;
}

function isIntentionallyExcludedPath(relativePath: string): boolean {
  return relativePath.startsWith('crimson/debug_views/');
}

function parseModuleDocstring(trimmedPython: string): { raw: string; value: string } | null {
  for (const quote of ['"""', "'''"]) {
    if (!trimmedPython.startsWith(quote) || !trimmedPython.endsWith(quote)) {
      continue;
    }
    return {
      raw: trimmedPython,
      value: trimmedPython.slice(quote.length, -quote.length),
    };
  }
  return null;
}

function renderModuleDocOnly(relativePath: string, docstring: string): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const line of docstring.split(/\r?\n/)) {
    lines.push(line === '' ? '//' : `// ${line}`);
  }
  lines.push('');
  return lines.join('\n');
}

interface Reexport {
  names: string[];
  modulePath: string;
}

interface NamespaceReexport {
  alias: string;
  modulePath: string;
}

interface TypeAlias {
  name: string;
  typeExpression: string;
}

interface ConstantDefinition {
  name: string;
  value: string;
}

interface ConstantsModule {
  docstring: string | null;
  constants: ConstantDefinition[];
}

interface FunctionParameter {
  name: string;
  typeExpression: string;
}

interface FunctionDefinition {
  name: string;
  optsParams: FunctionParameter[];
  returnType: string;
  ignoredParam: string | null;
  returnExpression: string;
}

interface LazyWrapperModule {
  typeName: string;
  typeModulePath: string;
  functionName: string;
  parameter: FunctionParameter;
  runtimeModulePath: string;
  runtimeFunctionName: string;
  comments: string[];
}

interface ProtocolMethod {
  name: string;
  optsParams: FunctionParameter[];
  optsOptional: boolean;
  returnType: string;
}

interface ProtocolDefinition {
  name: string;
  methods: ProtocolMethod[];
}

interface InitReexports {
  docstring: string | null;
  namespaceReexports: NamespaceReexport[];
  reexports: Reexport[];
}

function parseInitReexports(trimmedPython: string): InitReexports | null {
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

function flattenFromImportBlocks(lines: string[]): string[] {
  const flattened: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const fromImportBlock = /^from ((?:\.)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import \($/.exec(trimmed);
    if (fromImportBlock === null) {
      flattened.push(lines[index]);
      continue;
    }

    const names: string[] = [];
    index += 1;
    while (index < lines.length && lines[index].trim() !== ')') {
      const name = lines[index].trim().replace(/,$/, '');
      if (name !== '') {
        names.push(name);
      }
      index += 1;
    }

    flattened.push(`from ${fromImportBlock[1]} import ${names.join(', ')}`);
  }

  return flattened;
}

function splitLeadingModuleDocstring(trimmedPython: string): { value: string; remainder: string } | null {
  for (const quote of ['"""', "'''"]) {
    if (!trimmedPython.startsWith(quote)) {
      continue;
    }

    const closeIndex = trimmedPython.indexOf(quote, quote.length);
    if (closeIndex === -1) {
      return null;
    }

    return {
      value: trimmedPython.slice(quote.length, closeIndex),
      remainder: trimmedPython.slice(closeIndex + quote.length),
    };
  }

  return null;
}

function tsExportNameForPythonName(pythonName: string): string {
  if (!pythonName.includes('_') || /^[A-Z0-9_]+$/.test(pythonName)) {
    return pythonName;
  }

  return pythonName.replaceAll(/_([a-zA-Z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

function tsImportPathForPythonModule(moduleName: string): string {
  const parts = moduleName.split('.').filter((part) => part !== '');
  const tsParts = parts.map((part) => part.replaceAll('_', '-'));
  if (moduleName.startsWith('.')) {
    return `./${tsParts.join('/')}.ts`;
  }

  const [root, ...rest] = tsParts;
  if (root === 'crimson' || root === 'grim') {
    return `@${root}/${rest.join('/')}.ts`;
  }

  return `${tsParts.join('/')}.ts`;
}

function parseNamespaceReexports(trimmedPython: string): NamespaceReexport[] | null {
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

function tsImportPathForPythonNamespace(moduleName: string): string {
  if (moduleName === 'pyray' || moduleName === 'raylib') {
    return '@wgl';
  }

  return tsImportPathForPythonModule(moduleName);
}

function renderNamespaceReexports(relativePath: string, reexports: NamespaceReexport[]): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const reexport of reexports) {
    lines.push(`export * as ${reexport.alias} from '${reexport.modulePath}';`);
  }
  lines.push('');
  return lines.join('\n');
}

function parseLazyWrapperModule(trimmedPython: string): LazyWrapperModule | null {
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

function renderLazyWrapperModule(relativePath: string, module: LazyWrapperModule): string {
  const runtimeAlias = `${module.runtimeFunctionName}Runtime`;
  const lines = [
    `// Port of ${relativePath}`,
    '',
    `import type { ${module.typeName} } from '${module.typeModulePath}';`,
    '',
    `export type { ${module.typeName} };`,
    '',
    `export function ${module.functionName}(${module.parameter.name}: ${module.parameter.typeExpression}): void {`,
  ];

  for (const comment of module.comments) {
    lines.push(`  // ${comment}`);
  }
  lines.push(`  void import('${module.runtimeModulePath}').then(({ ${module.runtimeFunctionName}: ${runtimeAlias} }) => {`);
  lines.push(`    ${runtimeAlias}(${module.parameter.name});`);
  lines.push('  });');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function parseProtocolModule(trimmedPython: string): ProtocolDefinition | null {
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

function renderProtocolModule(relativePath: string, protocol: ProtocolDefinition): string {
  const lines = [`// Port of ${relativePath}`, '', `export interface ${protocol.name} {`];
  for (const method of protocol.methods) {
    const optsType = method.optsParams
      .map((param) => `${param.name}${method.optsOptional ? '?' : ''}: ${param.typeExpression}`)
      .join('; ');
    lines.push(`  ${method.name}(opts${method.optsOptional ? '?' : ''}: { ${optsType} }): ${method.returnType};`);
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function parseTypeAliases(trimmedPython: string): TypeAlias[] | null {
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

function tsCallableType(argsText: string, returnText: string): string {
  const args = argsText.trim();
  const params = args === ''
    ? ''
    : args
      .split(', ')
      .map((arg, index) => `arg${index}: ${tsTypeExpression(arg)}`)
      .join(', ');
  return `(${params}) => ${tsTypeExpression(returnText)}`;
}

function tsTypeExpression(pythonType: string): string {
  const trimmed = pythonType.trim();
  if (trimmed === 'None') {
    return 'void';
  }
  if (trimmed === 'float' || trimmed === 'int') {
    return 'number';
  }
  if (trimmed === 'str') {
    return 'string';
  }
  if (trimmed === 'bool') {
    return 'boolean';
  }
  return tsExportNameForPythonName(trimmed);
}

function renderTypeAliases(relativePath: string, aliases: TypeAlias[]): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const alias of aliases) {
    lines.push(`export type ${alias.name} = ${alias.typeExpression};`);
  }
  lines.push('');
  return lines.join('\n');
}

function parseConstantsModule(trimmedPython: string): ConstantsModule | null {
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

function tsLiteralExpression(pythonValue: string): string {
  const trimmed = pythonValue.trim();
  if (trimmed === 'True') {
    return 'true';
  }
  if (trimmed === 'False') {
    return 'false';
  }
  if (trimmed === 'None') {
    return 'null';
  }
  return trimmed;
}

function renderConstantsModule(relativePath: string, constantsModule: ConstantsModule): string {
  const lines = [`// Port of ${relativePath}`, ''];
  if (constantsModule.docstring !== null) {
    for (const line of constantsModule.docstring.split(/\r?\n/)) {
      lines.push(line === '' ? '//' : `// ${line}`);
    }
    lines.push('');
  }

  for (const constant of constantsModule.constants) {
    lines.push(`export const ${constant.name} = ${constant.value};`);
  }
  lines.push('');
  return lines.join('\n');
}

function parseFunctionsModule(trimmedPython: string): FunctionDefinition[] | null {
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

function renderFunctionsModule(relativePath: string, functions: FunctionDefinition[]): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const fn of functions) {
    const optsType = fn.optsParams.map((param) => `${param.name}: ${param.typeExpression}`).join('; ');
    lines.push(`export function ${fn.name}(`);
    lines.push(`  opts: { ${optsType} },`);
    lines.push(`): ${fn.returnType} {`);
    if (fn.ignoredParam !== null) {
      lines.push(`  const _ = opts.${fn.ignoredParam};`);
    }
    lines.push(`  return ${fn.returnExpression};`);
    lines.push('}');
  }
  lines.push('');
  return lines.join('\n');
}

function renderInitReexports(relativePath: string, initReexports: InitReexports): string {
  const lines = [`// Port of ${relativePath}`, ''];
  if (initReexports.docstring !== null) {
    for (const line of initReexports.docstring.split(/\r?\n/)) {
      lines.push(line === '' ? '//' : `// ${line}`);
    }
    lines.push('');
  }

  for (const reexport of initReexports.namespaceReexports) {
    lines.push(`export * as ${reexport.alias} from '${reexport.modulePath}';`);
  }
  if (initReexports.namespaceReexports.length > 0 && initReexports.reexports.length > 0) {
    lines.push('');
  }

  for (const reexport of initReexports.reexports) {
    lines.push(`export { ${reexport.names.join(', ')} } from '${reexport.modulePath}';`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const files = parseFileList(await readFile(filesPath, 'utf8'));
  const progress = parseProgress(await readFile(progressPath, 'utf8'), files.length);
  const selected = files.slice(0, progress);

  console.log(`translator progress: ${progress}/${files.length}`);
  if (selected.length === 0) {
    console.log('no files selected; increment translator/progress.txt to start translating');
    return;
  }

  for (const relativePath of selected) {
    assertRelativePath(relativePath);
  }

  const jobs: TranslationJob[] = [];
  for (const [index, relativePath] of selected.entries()) {
    const sourcePath = path.join(pythonSourceRoot, relativePath);
    const python = await readFile(sourcePath, 'utf8').catch((cause: unknown) => {
      throw new Error(`failed to read Python source ${sourcePath}`, { cause });
    });
    jobs.push({
      index: index + 1,
      relativePath,
      sourcePath,
      targetPath: path.join(tsTargetRoot, tsPathForPython(relativePath)),
      python,
    });
  }

  for (const job of jobs) {
    console.log(`Translating ${job.relativePath} => ${path.relative(repoRoot, job.targetPath)}`);
    const ts = await translateFile(job);
    await mkdir(path.dirname(job.targetPath), { recursive: true });
    await writeFile(job.targetPath, ts);
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
    if (error.cause instanceof Error) {
      console.error(`caused by: ${error.cause.message}`);
    }
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
