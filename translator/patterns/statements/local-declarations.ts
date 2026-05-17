import { tsExportNameForPythonName, tsTypeExpression } from '../../naming.js';
import { matchingCloseParen, splitTopLevelComma } from '../common.js';
import {
  arrayElementTypeMarker,
  arrayValueMapNameMarker,
  booleanNameMarker,
  classFieldTypeMarker,
  colorNameMarker,
  dateNameMarker,
  expressionIsKnownMap,
  functionReturnTypeMarker,
  mapValueMapNameMarker,
  nullableNameMarker,
  numberArrayNameMarker,
  numberNameMarker,
  objectNameMarker,
  pathArrayNameMarker,
  pathNameMarker,
  pythonMappingNameMarker,
  receiverTypeNameMarker,
  rectangleNameMarker,
  setNameMarker,
  stringNameMarker,
  translatedExpressionLooksVector,
  translatedExpressionLooksVectorArray,
  translateExpression,
  tupleElementArrayNameMarker,
  vectorArrayNameMarker,
  vectorNameMarker,
} from '../expression.js';
import { splitInlineComment } from './inline-comments.js';
import { addMutableName } from './utils.js';

function topLevelColonIndex(value: string): number | null {
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
    if (char === ':' && depth === 0) {
      return index;
    }
  }
  return null;
}

const reassignedLocalTypePrefix = '\u0000reassigned-local-type:';

export function addReassignedLocalTypeAnnotations(
  lines: string[],
  startIndex: number,
  reassignedNames: Set<string>,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): void {
  const typesByName = new Map<string, string[]>();
  const localTypes = new Map<string, string>();
  let firstStatementIndex = startIndex;
  while (firstStatementIndex < lines.length && lines[firstStatementIndex].trim() === '') {
    firstStatementIndex += 1;
  }
  const baseIndent = /^(\s+)/.exec(lines[firstStatementIndex] ?? '')?.[1] ?? null;
  if (baseIndent === null) {
    return;
  }

  let index = firstStatementIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() !== '' && !line.startsWith(baseIndent)) {
      break;
    }
    const lineIndent = /^(\s*)/.exec(line)?.[1] ?? '';
    if (lineIndent !== baseIndent) {
      index += 1;
      continue;
    }
    const statement = splitInlineComment(line.trim()).code;
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(statement);
    if (assignment !== null) {
      const type = inferredReassignedLocalType(assignment[2], nameMap, arrayNames, validatedTypeAliases, mapNames, localTypes);
      if (type !== null) {
        localTypes.set(assignment[1], type);
      }
      if (reassignedNames.has(assignment[1])) {
        addReassignedLocalType(typesByName, assignment[1], type);
      }
    }
    const annotatedAssignment = /^([A-Za-z_][A-Za-z0-9_]*): (.+?) = (.+)$/.exec(statement);
    if (annotatedAssignment !== null) {
      const type = tsTypeExpression(annotatedAssignment[2]);
      localTypes.set(annotatedAssignment[1], type);
      if (reassignedNames.has(annotatedAssignment[1])) {
        addReassignedLocalType(typesByName, annotatedAssignment[1], type);
      }
    }
    index += 1;
  }

  for (const [name, types] of typesByName) {
    if (types.length > 1 || types[0] === 'CrandLike') {
      reassignedNames.add(reassignedLocalTypeMarker(name, types.join(' | ')));
    }
  }
}


export function nullableLocalDeclarationType(
  pythonName: string,
  tsName: string,
  assignedRight: string,
  arrayNames: ReadonlySet<string>,
): string | null {
  if (!arrayNames.has(nullableNameMarker(pythonName)) && !arrayNames.has(nullableNameMarker(tsName))) {
    return null;
  }
  if (translatedExpressionLooksNumber(assignedRight)) {
    return 'number | null';
  }
  return null;
}

export function localTupleDeclarationType(
  assignedRight: string,
  pythonRight: string | null,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string>,
): string | null {
  const tupleArrayType = homogeneousTupleArrayDeclarationType(assignedRight, nameMap, arrayNames);
  if (tupleArrayType !== null) {
    return tupleArrayType;
  }
  if (!pythonExpressionCouldBeTupleLiteral(pythonRight)) {
    return null;
  }
  const length = numericTupleExpressionLength(assignedRight) ?? numericOuterPythonTupleExpressionLength(pythonRight);
  if (length === null) {
    const returnTupleType = tupleFunctionReturnTypeForOuterPythonTuple(pythonRight, nameMap);
    return returnTupleType;
  }
  return `[${Array.from({ length }, () => 'number').join(', ')}]`;
}

export function objectRecordDeclarationType(
  assignedRight: string,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string>,
): string | null {
  const objectLiteral = /^\{ ([\s\S]*) \}$/.exec(assignedRight.trim());
  if (objectLiteral === null) {
    return null;
  }
  const items = splitTopLevelComma(objectLiteral[1]);
  if (items.length === 0) {
    return null;
  }
  const valueTypes: string[] = [];
  for (const item of items) {
    const separator = topLevelColonIndex(item);
    if (separator === null) {
      return null;
    }
    const keyExpression = item.slice(0, separator).trim();
    if (!/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(keyExpression)) {
      return null;
    }
    const valueType = recordObjectValueType(item.slice(separator + 1).trim(), nameMap, arrayNames);
    if (valueType === null) {
      return null;
    }
    valueTypes.push(valueType);
  }
  const uniqueTypes = [...new Set(valueTypes)];
  return uniqueTypes.length === 1 ? `Record<string, ${uniqueTypes[0]}>` : null;
}

function recordObjectValueType(
  value: string,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string>,
): string | null {
  const arrayItems = parseTsArrayLiteralItems(value);
  if (arrayItems !== null) {
    const itemTypes = arrayItems.map((item) => inferExpressionType(item, nameMap, arrayNames));
    if (itemTypes.some((type) => type === null)) {
      return null;
    }
    return `[${itemTypes.join(', ')}]`;
  }
  return inferExpressionType(value, nameMap, arrayNames);
}

function homogeneousTupleArrayDeclarationType(
  assignedRight: string,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string>,
): string | null {
  const rows = parseTsArrayLiteralItems(assignedRight);
  if (rows === null || rows.length === 0) {
    return null;
  }
  const rowItems = rows.map(parseTsArrayLiteralItems);
  if (rowItems.some((items) => items === null)) {
    return null;
  }
  const firstLength = rowItems[0]?.length ?? 0;
  if (firstLength < 2 || rowItems.some((items) => items?.length !== firstLength)) {
    return null;
  }

  const elementTypes: string[] = [];
  for (let itemIndex = 0; itemIndex < firstLength; itemIndex += 1) {
    const itemTypes = rowItems.map((items) => inferExpressionType(items?.[itemIndex] ?? '', nameMap, arrayNames));
    if (itemTypes.some((type) => type === null)) {
      return null;
    }
    const commonType = commonTupleElementType(itemTypes.filter((type): type is string => type !== null));
    if (commonType === null) {
      return null;
    }
    elementTypes.push(commonType);
  }
  return `[${elementTypes.join(', ')}][]`;
}

function parseTsArrayLiteralItems(expression: string): string[] | null {
  const trimmed = expression.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }
  return splitTopLevelComma(trimmed.slice(1, -1));
}

function commonTupleElementType(types: string[]): string | null {
  const unique = [...new Set(types)];
  return unique.length === 1 ? unique[0] : null;
}

function inferExpressionType(
  expression: string,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string>,
): string | null {
  const trimmed = expression.trim();
  if (/^(?:'[^']*'|"[^"]*"|`[^`]*`)$/.test(trimmed)) {
    return 'string';
  }
  if (translatedExpressionLooksNumber(trimmed) || /^[A-Z][A-Z0-9_]*(?:_X|_Y|_W|_H|_COUNT|_INDEX|_MS)$/.test(trimmed)) {
    return 'number';
  }
  if (translatedExpressionLooksBoolean(trimmed) || /^!\(.+\)$/.test(trimmed)) {
    return 'boolean';
  }
  if (translatedExpressionLooksVector(trimmed) || arrayNames.has(vectorNameMarker(trimmed))) {
    return 'Vec2';
  }
  const fieldType = knownDottedFieldType(trimmed, nameMap);
  if (fieldType !== null) {
    return fieldType;
  }
  const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.exec(trimmed);
  if (identifier !== null) {
    if (arrayNames.has(numberNameMarker(trimmed))) {
      return 'number';
    }
    if (arrayNames.has(booleanNameMarker(trimmed))) {
      return 'boolean';
    }
    if (arrayNames.has(stringNameMarker(trimmed))) {
      return 'string';
    }
    if (arrayNames.has(vectorNameMarker(trimmed))) {
      return 'Vec2';
    }
    const elementType = nameMap.get(arrayElementTypeMarker(trimmed));
    if (elementType !== undefined) {
      return `${elementType}[]`;
    }
  }

  const arrayFrom = /^Array\.from\((.+)\)$/.exec(trimmed);
  if (arrayFrom !== null) {
    const elementType = nameMap.get(arrayElementTypeMarker(arrayFrom[1].trim()));
    return elementType === undefined ? null : `${elementType}[]`;
  }

  const tupleMap = /^([A-Za-z_$][A-Za-z0-9_$]*)\.map\(\(\[([^\]]+)\]\) => ([A-Za-z_$][A-Za-z0-9_$]*)\)$/.exec(trimmed);
  if (tupleMap !== null) {
    const sourceElementType = nameMap.get(arrayElementTypeMarker(tupleMap[1]));
    const tupleTypes = tupleTypeElements(sourceElementType);
    if (tupleTypes !== null) {
      const names = tupleMap[2].split(',').map((name) => name.trim());
      const nameIndex = names.indexOf(tupleMap[3]);
      if (nameIndex >= 0 && tupleTypes[nameIndex] !== undefined) {
        return `${tupleTypes[nameIndex]}[]`;
      }
    }
  }

  const arrayItems = parseTsArrayLiteralItems(trimmed);
  if (arrayItems !== null) {
    const itemTypes = arrayItems.map((item) => inferExpressionType(item, nameMap, arrayNames));
    if (itemTypes.length === 0 || itemTypes.some((type) => type === null)) {
      return null;
    }
    const itemType = commonTupleElementType(itemTypes.filter((type): type is string => type !== null));
    return itemType === null ? null : `${itemType}[]`;
  }

  return null;
}

function inferredArrayElementType(
  expression: string,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string>,
): string | null {
  const typeExpression = inferExpressionType(expression, nameMap, arrayNames);
  return arrayElementTypeFromTypeExpression(typeExpression ?? '');
}

function tupleTypeElements(typeExpression: string | null | undefined): string[] | null {
  if (typeExpression === undefined || typeExpression === null) {
    return null;
  }
  const trimmed = typeExpression.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }
  return splitTopLevelComma(trimmed.slice(1, -1));
}

export function recordLocalTupleDeclarationMarkers(
  pythonName: string,
  tsName: string,
  tupleType: string | null,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
): void {
  const elementType = arrayElementTypeFromTypeExpression(tupleType ?? '');
  if (elementType === null) {
    return;
  }
  arrayNames.add(pythonName);
  arrayNames.add(tsName);
  nameMap.set(arrayElementTypeMarker(pythonName), elementType);
  nameMap.set(arrayElementTypeMarker(tsName), elementType);
}

export function applyTupleTargetTypeMarkers(
  targets: string[],
  elementType: string | null,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
): void {
  const tupleTypes = tupleTypeElements(elementType);
  if (tupleTypes === null || tupleTypes.length !== targets.length) {
    return;
  }
  for (const [targetIndex, target] of targets.entries()) {
    applyLocalTypeMarkers(target, tupleTypes[targetIndex], nameMap, arrayNames);
  }
}

function applyLocalTypeMarkers(
  pythonName: string,
  typeExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
): void {
  const tsName = tsExportNameForPythonName(pythonName);
  if (typeExpression === 'number') {
    arrayNames.add(numberNameMarker(pythonName));
    arrayNames.add(numberNameMarker(tsName));
    return;
  }
  if (typeExpression === 'boolean') {
    arrayNames.add(booleanNameMarker(pythonName));
    arrayNames.add(booleanNameMarker(tsName));
    return;
  }
  if (typeExpression === 'string') {
    arrayNames.add(stringNameMarker(pythonName));
    arrayNames.add(stringNameMarker(tsName));
    return;
  }
  if (typeExpression === 'Vec2' || typeExpression === 'wgl.Vector2') {
    arrayNames.add(vectorNameMarker(pythonName));
    arrayNames.add(vectorNameMarker(tsName));
    return;
  }
  const elementType = arrayElementTypeFromTypeExpression(typeExpression);
  if (elementType !== null) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
    nameMap.set(arrayElementTypeMarker(pythonName), elementType);
    nameMap.set(arrayElementTypeMarker(tsName), elementType);
  }
}

function tupleFunctionReturnTypeForOuterPythonTuple(
  pythonExpression: string | null,
  nameMap: ReadonlyMap<string, string>,
): string | null {
  const length = outerPythonTupleExpressionLength(pythonExpression);
  if (length === null) {
    return null;
  }
  const returnType = nameMap.get(functionReturnTypeMarker('__current__')) ?? null;
  if (returnType === null || !returnType.startsWith('[') || !returnType.endsWith(']')) {
    return null;
  }
  const returnTypeLength = splitTopLevelComma(returnType.slice(1, -1)).length;
  return returnTypeLength === length ? returnType : null;
}

function outerPythonTupleExpressionLength(pythonExpression: string | null): number | null {
  if (pythonExpression === null) {
    return null;
  }
  const trimmed = pythonExpression.trim();
  if (!trimmed.startsWith('(') || matchingCloseParen(trimmed, 0) !== trimmed.length - 1) {
    return null;
  }
  const length = splitTopLevelComma(trimmed.slice(1, -1)).length;
  return length > 1 ? length : null;
}

function numericOuterPythonTupleExpressionLength(pythonExpression: string | null): number | null {
  if (pythonExpression === null) {
    return null;
  }
  const trimmed = pythonExpression.trim();
  if (!trimmed.startsWith('(') || matchingCloseParen(trimmed, 0) !== trimmed.length - 1) {
    return null;
  }
  const items = splitTopLevelComma(trimmed.slice(1, -1));
  return items.length > 1 && items.every(pythonTupleItemLooksNumeric) ? items.length : null;
}

function pythonTupleItemLooksNumeric(item: string): boolean {
  const trimmed = item.trim();
  if (
    trimmed === ''
    || trimmed === 'None'
    || trimmed === 'True'
    || trimmed === 'False'
    || /^(?:[rbuRBU]*)?(["'])/.test(trimmed)
  ) {
    return false;
  }
  return /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)
    || /^(?:int|float|f32)\(/.test(trimmed)
    || /(?:^|\.)rand\(/.test(trimmed)
    || (
      /(?:[+\-*/%&|^]|<<|>>)/.test(trimmed)
      && !/(?:["']|\b(?:None|True|False)\b)/.test(trimmed)
    );
}

export function pythonExpressionCouldBeTupleLiteral(pythonExpression: string | null): boolean {
  return pythonTupleExpressionLength(pythonExpression) !== null;
}

export function pythonTupleExpressionLength(pythonExpression: string | null): number | null {
  if (pythonExpression === null) {
    return null;
  }
  const trimmed = pythonExpression.trim();
  if (trimmed === '' || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return null;
  }
  if (trimmed.startsWith('(') && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    const length = splitTopLevelComma(trimmed.slice(1, -1)).length;
    return length > 1 ? length : null;
  }
  const length = splitTopLevelComma(trimmed).length;
  if (length > 1) {
    return length;
  }
  const nestedTuple = /\(([^)]*,[^)]*)\)/.exec(trimmed);
  return nestedTuple === null ? null : splitTopLevelComma(nestedTuple[1]).length;
}

function addReassignedLocalType(typesByName: Map<string, string[]>, name: string, type: string | null): void {
  if (type === null) {
    return;
  }
  const types = typesByName.get(name) ?? [];
  if (!types.includes(type)) {
    types.push(type);
  }
  typesByName.set(name, types);
}

function reassignedLocalTypeMarker(name: string, type: string): string {
  return `${reassignedLocalTypePrefix}${name}:${type}`;
}

export function reassignedLocalTypeAnnotation(reassignedNames: ReadonlySet<string>, name: string): string | null {
  const prefix = `${reassignedLocalTypePrefix}${name}:`;
  for (const marker of reassignedNames) {
    if (marker.startsWith(prefix)) {
      return marker.slice(prefix.length);
    }
  }
  return null;
}

function inferredReassignedLocalType(
  pythonRight: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
  localTypes: ReadonlyMap<string, string>,
): string | null {
  const translated = translateExpression(pythonRight, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(translated)
    || /^int\(/.test(translated)
    || /^Math\./.test(translated)
    || /^clamp\(/.test(translated)) {
    return 'number';
  }
  if (/^(?:true|false)$/.test(translated)) {
    return 'boolean';
  }
  if (/^(?:'[^']*'|"[^"]*"|`[^`]*`)$/.test(translated) || /^String\(/.test(translated)) {
    return 'string';
  }
  if (translated === 'null') {
    return 'null';
  }
  if (translated.startsWith('[') || translated.startsWith('Array.from(')) {
    return 'unknown[]';
  }
  if (translated.startsWith('new Map(')) {
    return 'Map<unknown, unknown>';
  }
  if (/^new Crand\(/.test(translated)) {
    return 'CrandLike';
  }
  if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeVector2\(/.test(translated) || /^new Vec2\(/.test(translated)) {
    return 'Vec2';
  }
  if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeRectangle\(/.test(translated)) {
    return 'rl.Rectangle';
  }
  if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeColor\(/.test(translated) || /^new RGBA\(/.test(translated)) {
    return 'rl.Color';
  }
  const localType = localTypes.get(translated);
  if (localType !== undefined) {
    return localType;
  }
  const fieldType = knownDottedFieldType(translated, nameMap);
  if (fieldType === 'number' || fieldType === 'string' || fieldType === 'boolean') {
    return fieldType;
  }
  const dottedReference = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\.[A-Za-z_$][A-Za-z0-9_$]*$/.exec(translated);
  if (dottedReference !== null) {
    return localTypes.has(dottedReference[1]) || nameMap.has(receiverTypeNameMarker(dottedReference[1]))
      ? `typeof ${translated}`
      : null;
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(translated)) {
    return `typeof ${translated}`;
  }
  const call = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\(/.exec(translated);
  if (call !== null) {
    const returnType = nameMap.get(functionReturnTypeMarker(call[1]));
    if (returnType === 'number' || returnType === 'string' || returnType === 'boolean') {
      return returnType;
    }
  }
  return null;
}

function numericTupleExpressionLength(tsExpression: string): number | null {
  const trimmed = tsExpression.trim();
  const ternary = splitTopLevelTernaryExpression(trimmed);
  if (ternary !== null) {
    const trueLength = numericTupleExpressionLength(ternary.trueExpression);
    const falseLength = numericTupleExpressionLength(ternary.falseExpression);
    return trueLength !== null && trueLength === falseLength ? trueLength : null;
  }
  const arrayLiteral = /^\[([\s\S]*)\]$/.exec(trimmed);
  if (arrayLiteral === null || matchingCloseBracket(trimmed, 0) !== trimmed.length - 1) {
    return null;
  }
  const parts = splitTopLevelComma(arrayLiteral[1]);
  if (parts.length < 2 || parts.some((part) => !translatedExpressionLooksNumber(part))) {
    return null;
  }
  return parts.length;
}

function splitTopLevelTernaryExpression(value: string): { trueExpression: string; falseExpression: string } | null {
  let depth = 0;
  let quote: string | null = null;
  let questionIndex: number | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && !charIsEscaped(value, index)) {
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
    if (char === '?' && depth === 0 && questionIndex === null) {
      questionIndex = index;
      continue;
    }
    if (char === ':' && depth === 0 && questionIndex !== null) {
      return {
        trueExpression: value.slice(questionIndex + 1, index).trim(),
        falseExpression: value.slice(index + 1).trim(),
      };
    }
  }
  return null;
}

function matchingCloseBracket(value: string, openIndex: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== null) {
      if (char === quote && !charIsEscaped(value, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}

export function parseTopLevelSubscriptAssignmentTarget(value: string): { receiver: string; key: string } | null {
  const trimmed = value.trim();
  if (!trimmed.endsWith(']')) {
    return null;
  }
  let quote: string | null = null;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let finalOpenIndex: number | null = null;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (quote !== null) {
      if (char === quote && !charIsEscaped(trimmed, index)) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')') {
      parenDepth -= 1;
      continue;
    }
    if (char === '{') {
      braceDepth += 1;
      continue;
    }
    if (char === '}') {
      braceDepth -= 1;
      continue;
    }
    if (char === '[') {
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        finalOpenIndex = index;
      }
      bracketDepth += 1;
      continue;
    }
    if (char === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) {
        return null;
      }
    }
  }
  if (quote !== null || parenDepth !== 0 || braceDepth !== 0 || bracketDepth !== 0 || finalOpenIndex === null) {
    return null;
  }
  if (matchingCloseBracket(trimmed, finalOpenIndex) !== trimmed.length - 1) {
    return null;
  }
  const receiver = trimmed.slice(0, finalOpenIndex).trim();
  const key = trimmed.slice(finalOpenIndex + 1, -1).trim();
  return receiver === '' || key === '' ? null : { receiver, key };
}

function charIsEscaped(value: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function assignedArrayElementType(assignedRight: string, nameMap: Map<string, string>): string | null {
  for (const match of assignedRight.matchAll(/Array\.from\(([^)]+)\)/g)) {
    const elementType = arrayElementTypeFromExpression(match[1], nameMap);
    if (elementType !== null) {
      return elementType;
    }
  }
  return arrayElementTypeFromExpression(assignedRight, nameMap);
}

function arrayElementTypeFromExpression(expression: string, nameMap: ReadonlyMap<string, string>): string | null {
  const fieldType = knownDottedFieldType(expression.trim(), nameMap);
  return fieldType === null ? null : arrayElementTypeFromTypeExpression(fieldType);
}

function knownDottedFieldType(expression: string, nameMap: ReadonlyMap<string, string>): string | null {
  const dotted = /^(.+)\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(expression);
  if (dotted === null) {
    return null;
  }
  const receiverType = nameMap.get(receiverTypeNameMarker(dotted[1])) ?? knownDottedFieldType(dotted[1], nameMap);
  return receiverType == null ? null : nameMap.get(classFieldTypeMarker(receiverType, dotted[2])) ?? null;
}

export function arrayElementTypeFromTypeExpression(typeExpression: string): string | null {
  const trimmed = typeExpression.trim();
  const mutableArray = /^(.+)\[\]$/.exec(trimmed);
  if (mutableArray !== null) {
    return mutableArray[1].trim();
  }
  const readonlyArray = /^readonly (.+)\[\]$/.exec(trimmed);
  if (readonlyArray !== null) {
    return readonlyArray[1].trim();
  }
  const readonlyGeneric = /^ReadonlyArray<(.+)>$/.exec(trimmed);
  return readonlyGeneric?.[1]?.trim() ?? null;
}

export function assignedRightAsKnownVector(
  pythonName: string,
  tsName: string,
  assignedRight: string,
  arrayNames: ReadonlySet<string>,
): string {
  if (!arrayNames.has(vectorNameMarker(pythonName)) && !arrayNames.has(vectorNameMarker(tsName))) {
    return assignedRight;
  }
  const makeVector = /^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeVector2\(([\s\S]+)\)$/.exec(assignedRight);
  if (makeVector === null) {
    return assignedRight;
  }
  const args = splitTopLevelComma(makeVector[1]);
  return args.length === 2 ? `new Vec2(${args.join(', ')})` : assignedRight;
}

export function recordLocalAssignmentMarkers(
  pythonName: string,
  tsName: string,
  assignedRight: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  mapNames: ReadonlySet<string>,
): void {
  if (arrayNames.has(assignedRight)) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
  }
  for (const marker of [
    colorNameMarker,
    booleanNameMarker,
    dateNameMarker,
    nullableNameMarker,
    numberArrayNameMarker,
    numberNameMarker,
    objectNameMarker,
    pathNameMarker,
    pathArrayNameMarker,
    pythonMappingNameMarker,
    rectangleNameMarker,
    setNameMarker,
    stringNameMarker,
    tupleElementArrayNameMarker,
    vectorArrayNameMarker,
    vectorNameMarker,
  ]) {
    if (arrayNames.has(marker(assignedRight))) {
      arrayNames.add(marker(pythonName));
      arrayNames.add(marker(tsName));
    }
  }
  if (mapNames.has(assignedRight)) {
    addMutableName(mapNames, pythonName);
    addMutableName(mapNames, tsName);
  }
  const assignedFieldType = knownDottedFieldType(assignedRight, nameMap);
  if (assignedFieldType !== null) {
    nameMap.set(receiverTypeNameMarker(pythonName), assignedFieldType);
    nameMap.set(receiverTypeNameMarker(tsName), assignedFieldType);
    if (assignedFieldType === 'number') {
      arrayNames.add(numberNameMarker(pythonName));
      arrayNames.add(numberNameMarker(tsName));
    } else if (assignedFieldType === 'boolean') {
      arrayNames.add(booleanNameMarker(pythonName));
      arrayNames.add(booleanNameMarker(tsName));
    } else if (assignedFieldType === 'string') {
      arrayNames.add(stringNameMarker(pythonName));
      arrayNames.add(stringNameMarker(tsName));
    } else if (assignedFieldType === 'Vec2') {
      arrayNames.add(vectorNameMarker(pythonName));
      arrayNames.add(vectorNameMarker(tsName));
    }
  }
  if (/^[A-Za-z_$][A-Za-z0-9_.$]*(?:creatures|pickups|players)$/.test(assignedRight)) {
    arrayNames.add(pythonName);
  }
  const isArrayFromBooleanChain = /^Array\.from\(/.test(assignedRight) && /\)\.(?:every|some)\(/.test(assignedRight);
  if (/^Array\.from\(/.test(assignedRight) && !isArrayFromBooleanChain) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
  }
  if (assignedRightLooksNumericArray(assignedRight)) {
    arrayNames.add(numberArrayNameMarker(pythonName));
    arrayNames.add(numberArrayNameMarker(tsName));
  }
  const arrayElementType = assignedArrayElementType(assignedRight, nameMap);
  if (arrayElementType !== null) {
    nameMap.set(arrayElementTypeMarker(pythonName), arrayElementType);
    nameMap.set(arrayElementTypeMarker(tsName), arrayElementType);
  }
  if (assignedRight.startsWith('[') || (assignedRight.startsWith('Array.from(') && !isArrayFromBooleanChain) || /^[A-Za-z_$][A-Za-z0-9_.$()]+\.(?:filter|map)\(/.test(assignedRight)) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
    const elementType = inferredArrayElementType(assignedRight, nameMap, arrayNames);
    if (elementType !== null) {
      nameMap.set(arrayElementTypeMarker(pythonName), elementType);
      nameMap.set(arrayElementTypeMarker(tsName), elementType);
    }
  }
  if (assignedRight.startsWith('_pathJoin(')) {
    arrayNames.add(pathNameMarker(pythonName));
    arrayNames.add(pathNameMarker(tsName));
  }
  if (assignedRight === '{}' || assignedRight.startsWith('{ ...') || assignedRight.startsWith('{ ')) {
    arrayNames.add(objectNameMarker(pythonName));
    arrayNames.add(objectNameMarker(tsName));
  }
  if (/\bas PythonMapping\)?$/.test(assignedRight)) {
    arrayNames.add(pythonMappingNameMarker(pythonName));
    arrayNames.add(pythonMappingNameMarker(tsName));
  }
  if (/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?makeRectangle\(/.test(assignedRight)) {
    arrayNames.add(rectangleNameMarker(pythonName));
    arrayNames.add(rectangleNameMarker(tsName));
  }
  if (/^(?:'[^']*'|"[^"]*"|`[^`]*`)$/.test(assignedRight)) {
    arrayNames.add(stringNameMarker(pythonName));
    arrayNames.add(stringNameMarker(tsName));
  }
  if (/\.trim\(\)$/.test(assignedRight)) {
    arrayNames.add(stringNameMarker(pythonName));
    arrayNames.add(stringNameMarker(tsName));
  }
  if (assignedRight.startsWith('new Map(')) {
    addMutableName(mapNames, pythonName);
    addMutableName(mapNames, tsName);
  }
  const mapGetAssignment = /^([A-Za-z_$][A-Za-z0-9_.$]*)\.get\(.*\)!?(?: \?\? null)?$/.exec(assignedRight);
  const mapGetOrThrowAssignment = /^mapGetOrThrow\(([A-Za-z_$][A-Za-z0-9_.$]*), .+\)(?: \?\? null)?$/.exec(assignedRight);
  const mapGetSource = mapGetAssignment?.[1] ?? mapGetOrThrowAssignment?.[1] ?? null;
  const mapDefaultAssignment = /^([A-Za-z_$][A-Za-z0-9_.$]*)\.get\(.*\) \?\? new Map(?:<[^)]*>)?\(\)$/.exec(assignedRight);
  const mapGetOrInitMapAssignment = /^mapGetOrInit\([A-Za-z_$][A-Za-z0-9_.$]*, .+, \(\) => new Map(?:<[^)]*>)?\(\)\)$/.exec(assignedRight);
  if (mapDefaultAssignment !== null || mapGetOrInitMapAssignment !== null) {
    addMutableName(mapNames, pythonName);
    addMutableName(mapNames, tsName);
  }
  if (/^[A-Za-z_$][A-Za-z0-9_.$]*\.get\(.*\)!$/.test(assignedRight) && !expressionIsKnownMap(assignedRight, nameMap, mapNames)) {
    arrayNames.add(objectNameMarker(pythonName));
    arrayNames.add(objectNameMarker(tsName));
  }
  if (mapGetSource !== null && mapNames.has(arrayValueMapNameMarker(mapGetSource))) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
    if (assignedRight.endsWith(' ?? null')) {
      arrayNames.add(nullableNameMarker(pythonName));
      arrayNames.add(nullableNameMarker(tsName));
    }
  }
  if (mapGetSource !== null && mapNames.has(mapValueMapNameMarker(mapGetSource))) {
    addMutableName(mapNames, pythonName);
    addMutableName(mapNames, tsName);
  }
  const subscriptAssignment = /^([A-Za-z_$][A-Za-z0-9_.$]*)\[.+\]$/.exec(assignedRight);
  if (subscriptAssignment !== null && arrayNames.has(tupleElementArrayNameMarker(subscriptAssignment[1]))) {
    arrayNames.add(pythonName);
    arrayNames.add(tsName);
  }
  const callAssignment = /^(?:await )?([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\(/.exec(assignedRight);
  if (callAssignment !== null) {
    const returnType = nameMap.get(functionReturnTypeMarker(callAssignment[1]));
    if (returnType !== undefined && /^[A-Z][A-Za-z0-9_$]*$/.test(returnType)) {
      nameMap.set(receiverTypeNameMarker(pythonName), returnType);
      nameMap.set(receiverTypeNameMarker(tsName), returnType);
    }
    if (returnType?.endsWith('[]') === true || returnType?.startsWith('readonly ') === true && returnType.endsWith('[]')) {
      arrayNames.add(pythonName);
      arrayNames.add(tsName);
      const elementType = arrayElementTypeFromTypeExpression(returnType);
      if (elementType !== null) {
        nameMap.set(arrayElementTypeMarker(pythonName), elementType);
        nameMap.set(arrayElementTypeMarker(tsName), elementType);
      }
    }
  }
  if (assignedRight.startsWith('new Set(') || (callAssignment !== null && arrayNames.has(setNameMarker(callAssignment[1])))) {
    arrayNames.add(setNameMarker(pythonName));
    arrayNames.add(setNameMarker(tsName));
  }
  if (callAssignment !== null && arrayNames.has(objectNameMarker(callAssignment[1]))) {
    arrayNames.add(objectNameMarker(pythonName));
    arrayNames.add(objectNameMarker(tsName));
  }
  if (callAssignment !== null && arrayNames.has(stringNameMarker(callAssignment[1]))) {
    arrayNames.add(stringNameMarker(pythonName));
    arrayNames.add(stringNameMarker(tsName));
  }
  if (translatedExpressionLooksNumber(assignedRight)) {
    arrayNames.add(numberNameMarker(pythonName));
    arrayNames.add(numberNameMarker(tsName));
  }
  if (translatedExpressionLooksBoolean(assignedRight)) {
    arrayNames.add(booleanNameMarker(pythonName));
    arrayNames.add(booleanNameMarker(tsName));
  }
  if (translatedExpressionLooksVector(assignedRight)) {
    arrayNames.add(vectorNameMarker(pythonName));
    arrayNames.add(vectorNameMarker(tsName));
  }
  if (callAssignment !== null && nameMap.get(functionReturnTypeMarker(callAssignment[1])) === 'Vec2') {
    arrayNames.add(vectorNameMarker(pythonName));
    arrayNames.add(vectorNameMarker(tsName));
  }
  if (translatedExpressionLooksVectorArray(assignedRight)) {
    arrayNames.add(vectorArrayNameMarker(pythonName));
    arrayNames.add(vectorArrayNameMarker(tsName));
  }
  if (assignedRight === 'new Date()') {
    arrayNames.add(dateNameMarker(pythonName));
    arrayNames.add(dateNameMarker(tsName));
  }
}

function assignedRightLooksNumericArray(assignedRight: string): boolean {
  const trimmed = assignedRight.trim();
  if (/^\[[\d\s.,+\-*/%()]+\]$/.test(trimmed) && /\d/.test(trimmed)) {
    return true;
  }
  if (/\.map\(\(\[([A-Za-z_$][A-Za-z0-9_$]*),\s*[A-Za-z_$][A-Za-z0-9_$]*\]\) => \1\)$/.test(trimmed)) {
    return true;
  }
  return /\.map\(\([^)]*\) => (?:int|Number|Math\.[A-Za-z_$][A-Za-z0-9_$]*)\(/.test(trimmed);
}

function translatedExpressionLooksNumber(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return true;
  }
  if (/^(?:int|f32|Math\.[A-Za-z_$][A-Za-z0-9_$]*)\(/.test(trimmed)) {
    return true;
  }
  if (
    !translatedExpressionLooksVector(trimmed)
    && !/["'`]/.test(trimmed)
    && / [+\-*/%] /.test(trimmed)
  ) {
    return true;
  }
  return false;
}

function translatedExpressionLooksBoolean(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  if (trimmed.includes(' ? ')
    || trimmed.includes('=>')
    || trimmed.includes(' || ')
    || trimmed.includes(' + ')
    || trimmed.includes(' - ')
    || trimmed.includes(' * ')
    || trimmed.includes(' / ')
    || trimmed.includes(' % ')
    || trimmed.includes(',')) {
    return false;
  }
  return trimmed === 'true'
    || trimmed === 'false'
    || /^!/.test(trimmed)
    || /(?:===|!==|<=|>=|<|>|&&|\|\||\binstanceof\b)/.test(trimmed)
    || /^typeof\b/.test(trimmed)
    || /^(?:Array\.isArray|Number\.is(?:Finite|Integer|NaN))\(/.test(trimmed)
    || /\.(?:every|has|includes|some|startsWith|endsWith)\(/.test(trimmed);
}
