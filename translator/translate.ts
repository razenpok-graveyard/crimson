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
  return python
    .split(/\r?\n/)
    .filter((line) => line.trim() !== 'from __future__ import annotations')
    .join('\n');
}

function renderEmptyModule(relativePath: string): string {
  return `// Port of ${relativePath}\n`;
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
    console.log(`[${job.index}/${files.length}] ${job.relativePath}`);
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
