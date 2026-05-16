import { parsePythonStringExpression } from '../common.js';
import { parseCallPrefix } from './scanners.js';

export function expressionLooksPathJoinPart(value: string): boolean {
  const trimmed = value.trim();
  return parsePythonStringExpression(trimmed) !== null
    || /^f["']/.test(trimmed)
    || parseCallPrefix(trimmed, 'Path') !== null;
}

export function splitTopLevelPathJoin(value: string): { parts: string[] } | null {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && value[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      continue;
    }
    if (
      depth === 0
      && char === '/'
      && value[index - 1] === ' '
      && value[index + 1] === ' '
    ) {
      parts.push(value.slice(start, index - 1).trim());
      start = index + 2;
    }
  }
  if (parts.length === 0) {
    return null;
  }
  parts.push(value.slice(start).trim());
  return { parts };
}
