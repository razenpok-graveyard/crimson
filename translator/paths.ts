import fs from 'node:fs';
import path from 'node:path';

export const repoRoot = process.cwd();
export const translatorDir = path.join(repoRoot, 'translator');
export const filesPath = path.join(translatorDir, 'files.txt');
export const progressPath = path.join(translatorDir, 'progress.txt');
export const pythonSourceRoot = path.resolve(process.env.PY_SOURCE_ROOT ?? path.join(repoRoot, '..', 'crimson', 'src'));
export const pythonProjectRoot = path.dirname(pythonSourceRoot);
export const tsTargetRoot = path.resolve(process.env.TS_TARGET_ROOT ?? path.join(repoRoot, 'src'));

export function parseFileList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export function parseProgress(text: string, fileCount: number): number {
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

export function assertRelativePath(relativePath: string): void {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`translator/files.txt contains an unsafe path: ${relativePath}`);
  }
  if (!relativePath.endsWith('.py')) {
    throw new Error(`translator/files.txt entry must end with .py: ${relativePath}`);
  }
}

export function tsPathForPython(relativePath: string): string {
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

export function tsImportPathForPythonModule(moduleName: string): string {
  const parts = moduleName.split('.').filter((part) => part !== '');
  const tsParts = parts.map((part) => part.replaceAll('_', '-'));
  if (moduleName.startsWith('.')) {
    return `./${tsParts.join('/')}.ts`;
  }

  const [root, ...rest] = tsParts;
  if (root === 'crimson' || root === 'grim') {
    const suffix = fs.existsSync(path.join(pythonSourceRoot, ...parts, '__init__.py'))
      ? [...rest, 'index']
      : rest;
    return `@${root}/${suffix.join('/')}.ts`;
  }

  return tsParts.join('/');
}

export function tsImportPathForPythonImport(moduleName: string, importerRelativePath: string): string {
  if (!moduleName.startsWith('.')) {
    return tsImportPathForPythonModule(moduleName);
  }

  const leadingDots = moduleName.match(/^\.+/)?.[0].length ?? 0;
  const suffix = moduleName.slice(leadingDots);
  const importerPackageParts = importerRelativePath.split('/').slice(0, -1);
  const baseParts = importerPackageParts.slice(0, importerPackageParts.length - Math.max(0, leadingDots - 1));
  const suffixParts = suffix === '' ? [] : suffix.split('.');
  return tsImportPathForPythonModule([...baseParts, ...suffixParts].join('.'));
}

export function tsImportPathForPythonNamespace(moduleName: string): string {
  if (moduleName === 'pyray' || moduleName === 'raylib') {
    return '@wgl';
  }

  return tsImportPathForPythonModule(moduleName);
}
