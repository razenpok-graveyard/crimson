import { splitTopLevelComma } from '../common.js';
import {
  matchingCloseParen,
  splitTopLevelAdditive,
} from './scanners.js';

export function stripPrimitiveCallWrappers(value: string): string {
  let output = value;
  let changed = true;
  while (changed) {
    changed = false;
    let nextOutput = '';
    let index = 0;
    while (index < output.length) {
      const match = /^(float|str|bool)\(/.exec(output.slice(index));
      const previous = index === 0 ? '' : output[index - 1];
      if (match === null || /[A-Za-z0-9_]/.test(previous)) {
        nextOutput += output[index];
        index += 1;
        continue;
      }
      const openIndex = index + match[1].length;
      const closeIndex = matchingCloseParen(output, openIndex);
      if (closeIndex === null || output[closeIndex + 1] === '.') {
        nextOutput += output[index];
        index += 1;
        continue;
      }
      const inner = normalizedPrimitiveWrapperInner(output.slice(openIndex + 1, closeIndex));
      nextOutput += primitiveWrapperNeedsParens(inner) ? `(${inner})` : inner;
      index = closeIndex + 1;
      changed = true;
    }
    output = nextOutput;
  }
  return output;
}

function normalizedPrimitiveWrapperInner(inner: string): string {
  const parts = splitTopLevelComma(inner);
  return parts.length === 1 && inner.trim().endsWith(',') ? parts[0] : inner;
}

function primitiveWrapperNeedsParens(inner: string): boolean {
  return splitTopLevelAdditive(inner) !== null || / [|&^] | << | >> /.test(inner);
}
