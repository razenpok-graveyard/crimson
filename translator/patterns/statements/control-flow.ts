import { splitTopLevelComma } from '../common.js';

export function parseZipLoopSources(iterableText: string): string[] | null {
  const zipCall = /^zip\((.+)\)$/.exec(iterableText.trim());
  if (zipCall === null) {
    return null;
  }
  const parts = splitTopLevelComma(zipCall[1]);
  const strictArgument = /^strict\s*=\s*(True|False)$/.exec(parts.at(-1)?.trim() ?? '');
  if (strictArgument !== null) {
    if (strictArgument[1] !== 'False') {
      return null;
    }
    parts.pop();
  }
  return parts.length === 0 ? null : parts;
}

export function exceptBlocksHaveSameBody(blocks: Array<{ statements: string[] }>): boolean {
  if (blocks.length <= 1) {
    return true;
  }
  const [first, ...rest] = blocks;
  const firstText = first.statements.join('\n');
  return rest.every((block) => block.statements.join('\n') === firstText);
}
