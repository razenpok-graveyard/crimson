import { matchingCloseParen, splitTopLevelComma } from '../common.js';
import { tsExportNameForPythonName } from '../../naming.js';
import {
  classFieldTypeMarker,
  nullableNameMarker,
  receiverTypeNameMarker,
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
    const arrayGuardedExpressions = collectArrayGuardedExpressions(topLevelAndParts, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return topLevelAndParts
      .map((part) => {
        const guardedTruthiness = translateArrayGuardedTruthiness(part, arrayGuardedExpressions, nameMap, arrayNames, validatedTypeAliases, mapNames);
        return parenthesizeAndConditionOperand(guardedTruthiness ?? translateConditionExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
      })
      .join(' && ');
  }
  const walrusAssignment = /^([A-Za-z_][A-Za-z0-9_]*) := (.+)$/.exec(trimmed);
  if (walrusAssignment !== null) {
    const tsName = tsExportNameForPythonName(walrusAssignment[1]);
    return `(${tsName} = ${translateExpression(walrusAssignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
    const fieldType = simpleReferenceFieldType(trimmed, translated, nameMap);
    if (fieldType !== null && (fieldType.endsWith('[]') || /^readonly .+\[]$/.test(fieldType))) {
      return fieldType.includes('null') || fieldType.includes('undefined')
        ? `${translated} !== null && ${translated} !== undefined && ${translated}.length > 0`
        : `${translated}.length > 0`;
    }
  }
  return translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
}

function simpleReferenceFieldType(
  pythonExpression: string,
  tsExpression: string,
  nameMap: ReadonlyMap<string, string>,
): string | null {
  const pythonFieldType = dottedFieldType(pythonExpression, nameMap);
  if (pythonFieldType !== null) {
    return pythonFieldType;
  }
  return dottedFieldType(tsExpression, nameMap);
}

function dottedFieldType(
  expression: string,
  nameMap: ReadonlyMap<string, string>,
): string | null {
  const dotted = /^(.+)\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(expression);
  if (dotted === null) {
    return null;
  }
  const receiverType = nameMap.get(receiverTypeNameMarker(dotted[1]));
  return receiverType === undefined ? null : nameMap.get(classFieldTypeMarker(receiverType, dotted[2])) ?? null;
}

function parenthesizeAndConditionOperand(value: string): string {
  return value.includes(' || ') && matchingCloseParen(value, 0) !== value.length - 1 ? `(${value})` : value;
}

function collectArrayGuardedExpressions(
  parts: readonly string[],
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): Set<string> {
  const result = new Set<string>();
  for (const part of parts) {
    const expression = arrayGuardedExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expression !== null) {
      result.add(expression);
    }
  }
  return result;
}

function arrayGuardedExpression(
  part: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const trimmed = part.trim();
  const isinstanceCall = /^isinstance\(([\s\S]+)\)$/.exec(trimmed);
  if (isinstanceCall !== null) {
    const args = splitTopLevelComma(isinstanceCall[1]);
    if (args.length === 2 && /^(?:list|tuple)(?:\[.+\])?$/.test(args[1].trim())) {
      return translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
    }
  }
  const translated = translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const arrayIsArray = /^Array\.isArray\((.+)\)$/.exec(translated);
  return arrayIsArray === null ? null : arrayIsArray[1].trim();
}

function translateArrayGuardedTruthiness(
  part: string,
  arrayGuardedExpressions: ReadonlySet<string>,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const trimmed = part.trim();
  if (!isSimpleReferenceExpression(trimmed)) {
    return null;
  }
  const translated = translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  return arrayGuardedExpressions.has(translated) ? `${translated}.length > 0` : null;
}
