import { combinePythonStringExpressions } from '../common.js';
import { matchingCloseParen } from './scanners.js';

export function parseAdjacentPythonStringExpression(trimmedExpression: string): string | null {
  const parts: string[] = [];
  let index = 0;
  while (index < trimmedExpression.length) {
    while (/\s/.test(trimmedExpression[index] ?? '')) {
      index += 1;
    }
    if (index >= trimmedExpression.length) {
      break;
    }
    const literal = parseLeadingPythonStringLiteral(trimmedExpression.slice(index));
    if (literal === null) {
      return null;
    }
    parts.push(literal);
    index += literal.length;
  }
  return parts.length > 1 ? combinePythonStringExpressions(parts) : null;
}

export function parseParenthesizedAdjacentPythonStringExpression(trimmedExpression: string): string | null {
  if (!trimmedExpression.startsWith('(') || matchingCloseParen(trimmedExpression, 0) !== trimmedExpression.length - 1) {
    return null;
  }
  return parseAdjacentPythonStringExpression(trimmedExpression.slice(1, -1).trim());
}

function parseLeadingPythonStringLiteral(value: string): string | null {
  const prefix = /^[fF]?/.exec(value)?.[0] ?? '';
  const quote = value[prefix.length];
  if (quote !== '"' && quote !== "'") {
    return null;
  }
  let index = prefix.length + 1;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === quote) {
      return value.slice(0, index + 1);
    }
    index += 1;
  }
  return null;
}
