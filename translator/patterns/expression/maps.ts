import {
  classFieldTypeMarker,
  mapValueMapNameMarker,
  receiverTypeNameMarker,
} from './markers.js';

export function expressionIsKnownMap(
  tsExpression: string,
  nameMap: Map<string, string>,
  mapNames: ReadonlySet<string> = new Set(),
): boolean {
  if (mapNames.has(tsExpression)) {
    return true;
  }
  const mapGet = /^([A-Za-z_$][A-Za-z0-9_.$]*)\.get\(.*\)!?(?: \?\? null)?$/.exec(tsExpression);
  if (mapGet !== null && mapNames.has(mapValueMapNameMarker(mapGet[1]))) {
    return true;
  }
  const mapGetOrThrow = /^mapGetOrThrow\(([A-Za-z_$][A-Za-z0-9_.$]*), .+\)$/.exec(tsExpression);
  if (mapGetOrThrow !== null && mapNames.has(mapValueMapNameMarker(mapGetOrThrow[1]))) {
    return true;
  }
  if (mapGetOrThrow !== null) {
    const valueType = knownMapValueType(mapGetOrThrow[1], nameMap);
    if (valueType?.startsWith('Map<') === true || valueType?.startsWith('ReadonlyMap<') === true) {
      return true;
    }
  }
  const dottedField = /^(.+)\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(tsExpression);
  if (dottedField === null) {
    return false;
  }
  const receiverType = nameMap.get(receiverTypeNameMarker(dottedField[1]));
  const fieldType = receiverType === undefined ? undefined : nameMap.get(classFieldTypeMarker(receiverType, dottedField[2]));
  return fieldType?.startsWith('Map<') === true || fieldType?.startsWith('ReadonlyMap<') === true;
}

function knownMapValueType(
  tsExpression: string,
  nameMap: Map<string, string>,
): string | null {
  const dottedField = /^(.+)\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(tsExpression);
  if (dottedField === null) {
    return null;
  }
  const receiverType = nameMap.get(receiverTypeNameMarker(dottedField[1]));
  const fieldType = receiverType === undefined ? undefined : nameMap.get(classFieldTypeMarker(receiverType, dottedField[2]));
  if (fieldType === undefined) {
    return null;
  }
  const mapArgs = /^ReadonlyMap<(.+)>$/.exec(fieldType) ?? /^Map<(.+)>$/.exec(fieldType);
  if (mapArgs === null) {
    return null;
  }
  const args = splitTopLevelTypeComma(mapArgs[1]);
  return args.length === 2 ? args[1].trim() : null;
}

function splitTopLevelTypeComma(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '<') {
      angleDepth += 1;
      continue;
    }
    if (char === '>') {
      angleDepth = Math.max(0, angleDepth - 1);
      continue;
    }
    if (char === '(' || char === '[' || char === '{') {
      parenDepth += 1;
      continue;
    }
    if (char === ')' || char === ']' || char === '}') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === ',' && angleDepth === 0 && parenDepth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter((part) => part !== '');
}
