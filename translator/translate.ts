import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TranslationJob } from './model.js';
import {
  assertRelativePath,
  filesPath,
  parseFileList,
  parseProgress,
  progressPath,
  pythonSourceRoot,
  repoRoot,
  tsPathForPython,
  tsTargetRoot,
} from './paths.js';
import { translateFile } from './translator-core.js';

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
