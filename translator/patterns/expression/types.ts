export function nullableTypeExpressionBase(typeExpression: string | null): string | undefined {
  if (typeExpression === null) {
    return undefined;
  }
  const parts = splitTopLevelTypeUnion(typeExpression)
    .map((part) => part.trim().replace(/^readonly\s+/, ''))
    .filter((part) => part !== 'null' && part !== 'undefined');
  return parts.length === 1 ? parts[0] : undefined;
}

export function typeExpressionLooksMap(typeExpression: string): boolean {
  const normalized = nullableTypeExpressionBase(typeExpression) ?? typeExpression.trim();
  return /^(?:ReadonlyMap|Map)<|^Map\b|^ReadonlyMap\b/.test(normalized);
}

function splitTopLevelTypeUnion(typeExpression: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < typeExpression.length; index += 1) {
    const char = typeExpression[index];
    if (char === '<' || char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === '>' || char === ')' || char === ']' || char === '}') {
      depth -= 1;
      continue;
    }
    if (char === '|' && depth === 0) {
      parts.push(typeExpression.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(typeExpression.slice(start));
  return parts;
}
