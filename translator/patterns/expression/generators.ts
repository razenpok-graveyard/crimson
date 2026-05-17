import { stripBalancedOuterParens } from './scanners.js';

export type SimpleGeneratorExpression = {
  expression: string;
  itemName: string;
  iterable: string;
  condition: string | null;
};

export type TupleTargetGeneratorExpression = {
  expression: string;
  targetNames: string[];
  iterable: string;
  condition: string | null;
};

export function parseTopLevelConditionalExpression(
  pythonExpression: string,
): { trueExpression: string; condition: string; falseExpression: string } | null {
  const ifIndex = findTopLevelToken(pythonExpression, ' if ');
  if (ifIndex === null) {
    return null;
  }
  const elseIndex = findTopLevelToken(pythonExpression, ' else ', ifIndex + ' if '.length);
  if (elseIndex === null) {
    return null;
  }
  const trueExpression = pythonExpression.slice(0, ifIndex).trim();
  const condition = pythonExpression.slice(ifIndex + ' if '.length, elseIndex).trim();
  const falseExpression = pythonExpression.slice(elseIndex + ' else '.length).trim();
  return trueExpression === '' || condition === '' || falseExpression === ''
    ? null
    : { trueExpression, condition, falseExpression };
}

function findTopLevelToken(value: string, token: string, startIndex = 0): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = startIndex; index <= value.length - token.length; index += 1) {
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
    if (depth === 0 && value.slice(index, index + token.length) === token) {
      return index;
    }
  }
  return null;
}

export function parseSimpleGeneratorExpression(pythonExpression: string): SimpleGeneratorExpression | null {
  const trimmed = stripBalancedOuterParens(pythonExpression.trim());
  const forIndex = findTopLevelToken(trimmed, ' for ');
  if (forIndex === null) {
    return null;
  }
  const expression = trimmed.slice(0, forIndex).replace(/,$/, '').trim();
  const rest = trimmed.slice(forIndex + ' for '.length).trim();
  const ifIndex = findTopLevelToken(rest, ' if ');
  const forClause = ifIndex === null ? rest : rest.slice(0, ifIndex).trim();
  const condition = ifIndex === null ? null : rest.slice(ifIndex + ' if '.length).trim();
  const generator = /^([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec(forClause);
  if (expression === '' || generator === null || condition === '') {
    return null;
  }
  return {
    expression,
    itemName: generator[1],
    iterable: generator[2],
    condition,
  };
}

export function parseTupleTargetGeneratorExpression(
  pythonExpression: string,
): TupleTargetGeneratorExpression | null {
  const trimmed = stripBalancedOuterParens(pythonExpression.trim());
  const forIndex = findTopLevelToken(trimmed, ' for ');
  if (forIndex === null) {
    return null;
  }
  const expression = trimmed.slice(0, forIndex).replace(/,$/, '').trim();
  const rest = trimmed.slice(forIndex + ' for '.length).trim();
  const ifIndex = findTopLevelToken(rest, ' if ');
  const forClause = ifIndex === null ? rest : rest.slice(0, ifIndex).trim();
  const condition = ifIndex === null ? null : rest.slice(ifIndex + ' if '.length).trim();
  const generator = /^([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) in (.+)$/.exec(forClause);
  if (expression === '' || generator === null || condition === '') {
    return null;
  }
  return {
    expression,
    targetNames: generator[1].split(', '),
    iterable: generator[2],
    condition,
  };
}
