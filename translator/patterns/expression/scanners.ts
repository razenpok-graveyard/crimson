import { splitTopLevelComma } from '../common.js';

export function splitTopLevelMultiplicative(value: string): { left: string; right: string } | null {
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
      && char === '*'
      && value[index - 1] === ' '
      && value[index + 1] === ' '
    ) {
      return {
        left: value.slice(0, index - 1).trim(),
        right: value.slice(index + 2).trim(),
      };
    }
  }
  return null;
}

export function splitTopLevelModulo(value: string): { left: string; right: string } | null {
  return splitTopLevelSpacedOperator(value, '%');
}

export function splitTopLevelDivision(value: string): { left: string; right: string } | null {
  return splitTopLevelSpacedOperator(value, '/');
}

export function splitTopLevelFloorDivision(value: string): { left: string; right: string } | null {
  return splitTopLevelSpacedOperator(value, '//');
}

export function splitTopLevelSpacedOperator(value: string, operator: string): { left: string; right: string } | null {
  let depth = 0;
  let quote: string | null = null;
  const token = ` ${operator} `;
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
    if (depth === 0 && value.slice(index, index + token.length) === token) {
      return {
        left: value.slice(0, index).trim(),
        right: value.slice(index + token.length).trim(),
      };
    }
  }
  return null;
}

export function parenthesizeForLogicalAnd(value: string): string {
  return value.includes(' || ') && matchingCloseParen(value, 0) !== value.length - 1 ? `(${value})` : value;
}

export function parenthesizeForLogicalOr(value: string): string {
  return value.includes(' && ') && matchingCloseParen(value, 0) !== value.length - 1 ? `(${value})` : value;
}

export function parenthesizeForAdditive(value: string): string {
  return value.includes(' ? ')
    || splitTopLevelSpacedOperator(value, '&') !== null
    || splitTopLevelSpacedOperator(value, '^') !== null
    || splitTopLevelSpacedOperator(value, '|') !== null
    || splitTopLevelSpacedOperator(value, '<<') !== null
    || splitTopLevelSpacedOperator(value, '>>') !== null
    || splitTopLevelSpacedOperator(value, '>>>') !== null
    ? `(${value})`
    : value;
}

export function splitTopLevelLogicalOperator(value: string, operator: 'and' | 'or'): string[] | null {
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
      depth = Math.max(0, depth - 1);
      continue;
    }
    const token = ` ${operator} `;
    if (depth === 0 && value.slice(index, index + token.length) === token) {
      parts.push(value.slice(start, index).trim());
      start = index + token.length;
      index += token.length - 1;
    }
  }
  if (parts.length === 0) {
    return null;
  }
  parts.push(value.slice(start).trim());
  return parts;
}

export function parenthesizeForMultiplicative(value: string): string {
  return value.includes(' ? ')
    || splitTopLevelSpacedOperator(value, '&') !== null
    || splitTopLevelSpacedOperator(value, '^') !== null
    || splitTopLevelSpacedOperator(value, '|') !== null
    || splitTopLevelSpacedOperator(value, '<<') !== null
    || splitTopLevelSpacedOperator(value, '>>') !== null
    || splitTopLevelSpacedOperator(value, '>>>') !== null
    ? `(${value})`
    : value;
}

export function stripBalancedOuterParens(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('(')) {
    return trimmed;
  }
  const closeIndex = matchingCloseParen(trimmed, 0);
  if (closeIndex !== trimmed.length - 1) {
    return trimmed;
  }
  const inner = trimmed.slice(1, -1).trim();
  return splitTopLevelComma(inner).length > 1 ? trimmed : inner;
}

export function splitTopLevelAdditive(value: string): { parts: string[]; operators: string[] } | null {
  const parts: string[] = [];
  const operators: string[] = [];
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
      && (char === '+' || char === '-')
      && value[index - 1] === ' '
      && value[index + 1] === ' '
    ) {
      parts.push(value.slice(start, index - 1).trim());
      operators.push(char);
      start = index + 2;
    }
  }
  if (operators.length === 0) {
    return null;
  }
  parts.push(value.slice(start).trim());
  return { parts, operators };
}

export function splitTopLevelComparisonOperators(value: string): { parts: string[]; operators: string[] } | null {
  const parts: string[] = [];
  const operators: string[] = [];
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
    if (depth !== 0 || value[index - 1] !== ' ') {
      continue;
    }

    const twoCharOperator = value.slice(index, index + 2);
    const operator = ['<=', '>=', '==', '!='].includes(twoCharOperator) && value[index + 2] === ' '
      ? twoCharOperator
      : (char === '<' || char === '>') && value[index + 1] === ' '
        ? char
        : null;
    if (operator === null) {
      continue;
    }

    const part = value.slice(start, index - 1).trim();
    if (part === '') {
      return null;
    }
    parts.push(part);
    operators.push(operator);
    start = index + operator.length + 1;
    index = start - 1;
  }

  if (operators.length === 0) {
    return null;
  }
  const finalPart = value.slice(start).trim();
  if (finalPart === '') {
    return null;
  }
  parts.push(finalPart);
  return { parts, operators };
}

export function matchingCloseParen(value: string, openIndex: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < value.length; index += 1) {
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
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}

export function delimitersBalanced(value: string): boolean {
  const stack: string[] = [];
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
      stack.push(char);
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      const open = stack.pop();
      if (
        (char === ')' && open !== '(')
        || (char === ']' && open !== '[')
        || (char === '}' && open !== '{')
      ) {
        return false;
      }
    }
  }
  return quote === null && stack.length === 0;
}

export function hasTopLevelColon(value: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && expressionCharIsNotEscaped(value, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
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
    if (char === ':' && depth === 0) {
      return true;
    }
  }
  return false;
}

export function parseCallPrefix(expression: string, callee: string): { argsText: string; rest: string } | null {
  const prefix = `${callee}(`;
  if (!expression.startsWith(prefix)) {
    return null;
  }

  let depth = 0;
  let quote: string | null = null;
  for (let index = callee.length; index < expression.length; index += 1) {
    const char = expression[index];
    if (quote !== null) {
      if (char === quote && expression[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          argsText: expression.slice(prefix.length, index),
          rest: expression.slice(index + 1),
        };
      }
      if (depth < 0) {
        return null;
      }
    }
  }
  return null;
}

export function tsPropertyAccessBase(expression: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]+\])*$/.test(expression)
    ? expression
    : `(${expression})`;
}

function expressionCharIsNotEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 0;
}
