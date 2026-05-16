import { matchingCloseParen } from '../common.js';
import {
  nullableNameMarker,
  setNameMarker,
  splitTopLevelLogicalOperator,
  translateExpression,
} from '../expression.js';

export function isSimpleReferenceExpression(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value);
}

export function translateConditionExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const trimmed = pythonExpression.trim();
  const topLevelOrParts = splitTopLevelLogicalOperator(trimmed, 'or');
  if (topLevelOrParts !== null) {
    return topLevelOrParts
      .map((part) => translateConditionExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames))
      .join(' || ');
  }
  const topLevelAndParts = splitTopLevelLogicalOperator(trimmed, 'and');
  if (topLevelAndParts !== null) {
    return topLevelAndParts
      .map((part) => parenthesizeAndConditionOperand(translateConditionExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)))
      .join(' && ');
  }
  if (isSimpleReferenceExpression(trimmed)) {
    const translated = translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(translated)) {
      return `${translated}.size > 0`;
    }
    if (arrayNames.has(setNameMarker(trimmed)) || arrayNames.has(setNameMarker(translated))) {
      return arrayNames.has(nullableNameMarker(trimmed)) || arrayNames.has(nullableNameMarker(translated))
        ? `${translated} !== null && ${translated}.size > 0`
        : `${translated}.size > 0`;
    }
    if (arrayNames.has(trimmed) || arrayNames.has(translated)) {
      return arrayNames.has(nullableNameMarker(trimmed)) || arrayNames.has(nullableNameMarker(translated))
        ? `${translated} !== null && ${translated}.length > 0`
        : `${translated}.length > 0`;
    }
  }
  return translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
}

function parenthesizeAndConditionOperand(value: string): string {
  return value.includes(' || ') && matchingCloseParen(value, 0) !== value.length - 1 ? `(${value})` : value;
}
