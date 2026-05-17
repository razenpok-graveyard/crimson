import {
  splitTopLevelComma,
} from '../common.js';
import {
  arrayElementTypeMarker,
  classFieldTypeMarker,
  functionReturnTypeMarker,
  numberNameMarker,
  receiverTypeNameMarker,
  vectorArrayNameMarker,
  vectorNameMarker,
} from './markers.js';
import {
  translateIdentifierName,
} from './names.js';
import {
  matchingCloseParen,
  splitTopLevelMultiplicative,
  stripBalancedOuterParens,
} from './scanners.js';
import {
  nullableTypeExpressionBase,
} from './types.js';

export function translatedExpressionLooksVector(tsExpression: string): boolean {
  const trimmed = stripBalancedOuterParens(tsExpression.trim());
  if (/^(?:Vec2\.|new Vec2\b|projOrigin\()/.test(trimmed) && !/\.(?:length|toHeading)\(\)$/.test(trimmed)) {
    return true;
  }
  if (/\bnew Vec2\b/.test(trimmed) && trimmed.includes('?')) {
    return true;
  }
  if (/\.(?:aim|pos|vel)$/.test(trimmed)) {
    return true;
  }
  return finalVectorMethodCall(trimmed);
}

export function translatedExpressionLooksVectorArray(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  return /^\[.*(?:new Vec2\b|Vec2\.)/.test(trimmed)
    || /^Array\.from\([\s\S]*=> [\s\S]*(?:new Vec2\b|Vec2\.)/.test(trimmed)
    || /^Array\.from\([\s\S]*\)\.map\([\s\S]*=> [\s\S]*(?:new Vec2\b|Vec2\.)/.test(trimmed);
}

export function expressionIsVectorScale(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
): boolean {
  const scale = splitTopLevelMultiplicative(pythonExpression);
  return scale !== null && expressionIsKnownVector(scale.left, nameMap, arrayNames);
}

export function expressionIsKnownVector(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
): boolean {
  const trimmed = stripBalancedOuterParens(pythonExpression);
  const translated = translateIdentifierName(trimmed, nameMap);
  const receiverType = nameMap.get(receiverTypeNameMarker(trimmed)) ?? nameMap.get(receiverTypeNameMarker(translated));
  if (receiverType === 'Vec2' || receiverType === 'wgl.Vector2') {
    return true;
  }
  const callReturnType = knownCallReturnType(trimmed, nameMap);
  if (callReturnType === 'Vec2' || callReturnType === 'wgl.Vector2') {
    return true;
  }
  if (arrayNames.has(numberNameMarker(trimmed)) || arrayNames.has(numberNameMarker(translated))) {
    return false;
  }
  const fieldType = knownClassFieldType(trimmed, nameMap) ?? knownClassFieldType(translated, nameMap);
  if (fieldType === 'Vec2' || fieldType === 'wgl.Vector2') {
    return true;
  }
  if (trimmed.startsWith('Vec2.') || trimmed.startsWith('Vec2(')) {
    return true;
  }
  if (/^(?:camera|focus|screen_size|screenSize)$/.test(trimmed)) {
    return true;
  }
  if (/\.(?:aim|pos|vel|[A-Za-z0-9_]*(?:_pos|_offset))$/.test(trimmed)) {
    return true;
  }
  if (/\.(?:aim|pos|vel|[A-Za-z0-9_$]*(?:Pos|Offset))$/.test(translated)) {
    return true;
  }
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(trimmed);
  if (identifier !== null) {
    return arrayNames.has(vectorNameMarker(identifier[0])) || arrayNames.has(vectorNameMarker(translated));
  }
  const indexedIdentifier = /^([A-Za-z_][A-Za-z0-9_]*)\[.+\]$/.exec(trimmed);
  if (indexedIdentifier !== null) {
    const translatedBase = translateIdentifierName(indexedIdentifier[1], nameMap);
    return arrayNames.has(vectorArrayNameMarker(indexedIdentifier[1])) || arrayNames.has(vectorArrayNameMarker(translatedBase));
  }
  return translatedExpressionLooksVector(trimmed);
}

export function iterableElementType(pythonExpression: string, tsExpression: string, nameMap: Map<string, string>): string | null {
  const sources = [
    pythonExpression,
    tsExpression,
    stripIterableSlice(pythonExpression),
    stripIterableSlice(tsExpression),
  ].filter((source): source is string => source !== null);
  for (const source of sources) {
    const direct = nameMap.get(arrayElementTypeMarker(source));
    if (direct !== undefined) {
      return direct;
    }
    const fieldType = knownClassFieldType(source, nameMap);
    const fieldElementType = fieldType === null ? null : arrayElementTypeExpression(fieldType);
    if (fieldElementType !== null) {
      return fieldElementType;
    }
  }
  return null;
}

export function typeExpressionLooksTsEnum(typeExpression: string): boolean {
  const baseType = nullableTypeExpressionBase(typeExpression) ?? typeExpression;
  return /^[A-Z][A-Za-z0-9_$]*(?:Id|Mode|Type|Flags)$/.test(baseType.trim());
}

export function parseParenthesizedVectorMethodCall(value: string): { receiver: string; method: string; args: string[] } | null {
  if (!value.startsWith('(')) {
    return null;
  }
  const closeIndex = matchingCloseParen(value, 0);
  if (closeIndex === null || value[closeIndex + 1] !== '.') {
    return null;
  }
  const methodCall = /^\.([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/.exec(value.slice(closeIndex + 1));
  if (methodCall === null) {
    return null;
  }
  return {
    receiver: value.slice(1, closeIndex),
    method: methodCall[1],
    args: splitTopLevelComma(methodCall[2]),
  };
}

function knownCallReturnType(
  pythonExpression: string,
  nameMap: Map<string, string>,
): string | null {
  const call = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(/.exec(pythonExpression);
  if (call === null) {
    return null;
  }
  const callee = translateIdentifierName(call[1], nameMap);
  return nameMap.get(functionReturnTypeMarker(call[1])) ?? nameMap.get(functionReturnTypeMarker(callee)) ?? null;
}

export function knownClassFieldType(tsExpression: string, nameMap: Map<string, string>): string | null {
  const dottedField = /^(.+)\.([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(tsExpression);
  if (dottedField === null) {
    return null;
  }
  const receiverType = nameMap.get(receiverTypeNameMarker(dottedField[1]))
    ?? nullableTypeExpressionBase(knownClassFieldType(dottedField[1], nameMap));
  return receiverType === undefined ? null : nameMap.get(classFieldTypeMarker(receiverType, dottedField[2])) ?? null;
}

function stripIterableSlice(expression: string): string | null {
  const trimmed = expression.trim();
  const pythonSlice = /^(.+)\[[^\]]*:[^\]]*\]$/.exec(trimmed);
  if (pythonSlice !== null) {
    return pythonSlice[1].trim();
  }
  const tsSlice = /^(.+)\.slice\([^)]*\)$/.exec(trimmed);
  return tsSlice?.[1]?.trim() ?? null;
}

function arrayElementTypeExpression(typeExpression: string): string | null {
  const mutableArray = /^(.+)\[\]$/.exec(typeExpression.trim());
  if (mutableArray !== null) {
    return mutableArray[1].trim();
  }
  const readonlyArray = /^readonly (.+)\[\]$/.exec(typeExpression.trim());
  if (readonlyArray !== null) {
    return readonlyArray[1].trim();
  }
  const readonlyGeneric = /^ReadonlyArray<(.+)>$/.exec(typeExpression.trim());
  return readonlyGeneric?.[1]?.trim() ?? null;
}

function finalVectorMethodCall(tsExpression: string): boolean {
  const vectorMethods = new Set([
    'add',
    'sub',
    'offset',
    'mul',
    'rotated',
    'normalized',
    'perpLeft',
    'perpRight',
    'perp_left',
    'perp_right',
    'worldToScreen',
    'worldToScreenWith',
    'world_to_screen',
    'world_to_screen_with',
    '_worldToScreen',
    '_worldToScreenWith',
    '_world_to_screen',
    '_world_to_screen_with',
    'screenToWorld',
    'screenToWorldWith',
    'screen_to_world',
    'screen_to_world_with',
    '_screenToWorld',
    '_screenToWorldWith',
    '_screen_to_world',
    '_screen_to_world_with',
    'mulComponents',
    'divComponents',
    'mul_components',
    'div_components',
  ]);
  const methodPattern = /\.([A-Za-z_$][A-Za-z0-9_$]*)\(/g;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = methodPattern.exec(tsExpression)) !== null) {
    lastMatch = match;
  }
  if (lastMatch === null || !vectorMethods.has(lastMatch[1])) {
    return false;
  }
  const openIndex = lastMatch.index + lastMatch[0].length - 1;
  return matchingCloseParen(tsExpression, openIndex) === tsExpression.length - 1;
}
