import { tsExportNameForPythonName, tsTypeExpression } from '../naming.js';
import {
  parsePythonStringExpression,
  splitTopLevelComma,
  tsStringLiteral,
} from './common.js';
import {
  parseAdjacentPythonStringExpression,
  parseParenthesizedAdjacentPythonStringExpression,
} from './expression/adjacent-strings.js';
import {
  classBaseTypeMarker,
  classFieldTypeMarker,
  booleanNameMarker,
  colorNameMarker,
  dateNameMarker,
  instanceMethodSignatureMarker,
  mapValueMapNameMarker,
  mapValueTypeMarker,
  nullableNameMarker,
  objectNameMarker,
  pathNameMarker,
  pythonMappingNameMarker,
  receiverTypeNameMarker,
  rectangleNameMarker,
  setNameMarker,
  staticClassMethodNameMarker,
  stringNameMarker,
  tupleElementArrayNameMarker,
  tupleKeyMapNameMarker,
  vectorNameMarker,
} from './expression/markers.js';
import {
  raylibKeyboardKeyCode,
  raylibNamedColor,
  replaceTranslatedRaylibConstructors,
} from './expression/raylib.js';
import { parseBytesLiteral } from './expression/literals.js';
import {
  looksLikeNumericByteLengthExpression,
  translateConstructExpression,
  translateConstructFieldExpression,
} from './expression/constructs.js';
import type { FunctionCallSignature } from './expression/function-signatures.js';
import { parseFunctionCallSignature } from './expression/function-signatures.js';
import { functionSignatureMarker } from './function-headers.js';
import {
  parseEnumerateCallArgs,
  parseSimpleGeneratorExpression,
  parseTopLevelConditionalExpression,
  parseTupleTargetGeneratorExpression,
  type TupleTargetGeneratorExpression,
} from './expression/generators.js';
import {
  translatedDottedTokenMember,
  translateAttributeRest,
  translateIdentifierName,
  translateIdentifierNamePreservingPrivateMembers,
  tsMemberNameForPythonName,
} from './expression/names.js';
import {
  delimitersBalanced,
  matchingCloseParen,
  parenthesizeForAdditive,
  parenthesizeForLogicalAnd,
  parenthesizeForLogicalOr,
  parenthesizeForMultiplicative,
  hasTopLevelColon,
  parseCallPrefix,
  splitTopLevelAdditive,
  splitTopLevelComparisonOperators,
  splitTopLevelDivision,
  splitTopLevelFloorDivision,
  splitTopLevelLogicalOperator,
  splitTopLevelModulo,
  splitTopLevelMultiplicative,
  splitTopLevelSpacedOperator,
  stripBalancedOuterParens,
  tsPropertyAccessBase,
} from './expression/scanners.js';
import {
  tsFStringTemplateContent as renderTsFStringTemplateContent,
  tsRegExpExpression as renderTsRegExpExpression,
  tsRegExpFlagsExpression,
  tsRegExpSourceExpression as renderTsRegExpSourceExpression,
} from './expression/strings.js';
import {
  expressionLooksPathJoinPart,
  splitTopLevelPathJoin,
} from './expression/paths.js';
import { expressionIsKnownMap } from './expression/maps.js';
import { stripPrimitiveCallWrappers } from './expression/primitives.js';
import {
  nullableTypeExpressionBase,
  typeExpressionLooksMap,
} from './expression/types.js';
import {
  expressionIsKnownVector,
  expressionIsVectorScale,
  iterableElementType,
  knownClassFieldType,
  parseParenthesizedVectorMethodCall,
  translatedExpressionLooksVector,
  translatedExpressionLooksVectorArray,
  typeExpressionLooksTsEnum,
} from './expression/vectors.js';

export {
  arrayValueMapNameMarker,
  arrayElementTypeMarker,
  booleanNameMarker,
  classBaseTypeMarker,
  classFieldTypeMarker,
  colorNameMarker,
  dateNameMarker,
  functionDeclaredReturnTypeMarker,
  functionReturnTypeMarker,
  instanceMethodSignatureMarker,
  mapValueMapNameMarker,
  mapValueTypeMarker,
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
  staticClassMethodNameMarker,
  stringNameMarker,
  tupleElementArrayNameMarker,
  tupleKeyMapNameMarker,
  vectorArrayNameMarker,
  vectorNameMarker,
} from './expression/markers.js';

export {
  translatedExpressionLooksVector,
  translatedExpressionLooksVectorArray,
} from './expression/vectors.js';

export { splitTopLevelLogicalOperator } from './expression/scanners.js';
export { expressionIsKnownMap } from './expression/maps.js';

export function tsRegExpExpression(pythonLiteral: string): string {
  return renderTsRegExpExpression(pythonLiteral, translateExpression);
}

function tsRegExpSourceExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  return renderTsRegExpSourceExpression(
    pythonExpression,
    translateExpression,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
}

export function tsFStringTemplateContent(
  content: string,
  nameMap: Map<string, string> = new Map(),
  arrayNames: Set<string> = new Set(),
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): string {
  return renderTsFStringTemplateContent(
    content,
    translateExpression,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
}

function translateRaylibColorArg(pythonExpression: string, nameMap: Map<string, string>, arrayNames: Set<string>, validatedTypeAliases: ReadonlySet<string>): string {
  const translated = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases);
  return /\.[rgba]$/.test(translated) ? translated : `${translated} / 255`;
}

export function translatePositionalCallExpression(
  pythonCallee: string,
  positionalParts: string[],
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string> = new Set(),
  constructUppercase = false,
): string {
  if (positionalParts.length === 1) {
    const flattenedParts = splitTopLevelComma(positionalParts[0])
      .map((part) => part.trim())
      .filter((part) => part !== '');
    if (flattenedParts.length > 1) {
      return translatePositionalCallExpression(
        pythonCallee,
        flattenedParts,
        nameMap,
        arrayNames,
        validatedTypeAliases,
        mapNames,
        constructUppercase,
      );
    }
  }
  const callee = translateCallCalleeExpression(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  const args = positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
  if (pythonCallee === 'webbrowser.open' && args.length >= 1) {
    return `window.open(${args.join(', ')})`;
  }
  const raylibConstructor = /^(r[dl]|wgl)\.(Color|Vector2|Rectangle)$/.exec(callee);
  if (raylibConstructor !== null) {
    if (raylibConstructor[2] === 'Color' && positionalParts.length === 4) {
      return `${raylibConstructor[1]}.makeColor(${positionalParts.map((arg) => translateRaylibColorArg(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
    if (raylibConstructor[2] === 'Vector2' && args.length === 2) {
      return `${raylibConstructor[1]}.makeVector2(${args.join(', ')})`;
    }
    if (raylibConstructor[2] === 'Rectangle' && args.length === 1 && positionalParts[0]?.trim().startsWith('*') === true) {
      return translateExpression(positionalParts[0].trim().slice(1), nameMap, arrayNames, validatedTypeAliases);
    }
    if (raylibConstructor[2] === 'Rectangle' && args.length === 4) {
      return `${raylibConstructor[1]}.makeRectangle(${args.join(', ')})`;
    }
  }
  const raylibTimeCall = /^(?:r[dl]|wgl)\.(?:get_time|getTime)$/.exec(callee);
  if (raylibTimeCall !== null && args.length === 0) {
    return '(performance.now() / 1000.0)';
  }
  const raylibInputNoArgCall = /^(?:r[dl]|wgl)\.(get_char_pressed|getCharPressed|get_key_pressed|getKeyPressed)$/.exec(callee);
  if (raylibInputNoArgCall !== null && args.length === 0) {
    return raylibInputNoArgCall[1].includes('char') || raylibInputNoArgCall[1].includes('Char')
      ? 'InputState.getCharPressed()'
      : 'InputState.getKeyPressed()';
  }
  const raylibKeyInputCall = /^(?:r[dl]|wgl)\.(is_key_pressed|isKeyPressed|is_key_pressed_repeat|isKeyPressedRepeat|is_key_down|isKeyDown)$/.exec(callee);
  if (raylibKeyInputCall !== null && args.length === 1) {
    const method = raylibKeyInputCall[1].includes('repeat') || raylibKeyInputCall[1].includes('Repeat')
      ? 'wasKeyPressedRepeat'
      : raylibKeyInputCall[1].includes('down') || raylibKeyInputCall[1].includes('Down') ? 'isKeyDown' : 'wasKeyPressed';
    return `InputState.${method}(${args[0]})`;
  }
  const raylibMouseInputCall = /^(?:r[dl]|wgl)\.(is_mouse_button_pressed|isMouseButtonPressed|is_mouse_button_down|isMouseButtonDown)$/.exec(callee);
  if (raylibMouseInputCall !== null && args.length === 1) {
    const method = raylibMouseInputCall[1].includes('down') || raylibMouseInputCall[1].includes('Down')
      ? 'isMouseButtonDown'
      : 'wasMouseButtonPressed';
    return `InputState.${method}(${args[0]})`;
  }
  if (pythonCallee.endsWith('.extend') && args.length === 1) {
    return `${callee}(...${args[0]})`;
  }
  const drawRectangleRec = /^(r[dl]|wgl)\.drawRectangleRec$/.exec(callee);
  if (drawRectangleRec !== null && positionalParts.length === 2) {
    const rectangleCall = /^(?:r[dl]\.)?Rectangle\((.*)\)$/.exec(positionalParts[0].trim());
    if (rectangleCall !== null) {
      const rectArgs = splitTopLevelComma(rectangleCall[1]);
      if (rectArgs.length === 4) {
        return `${drawRectangleRec[1]}.drawRectangle(${rectArgs.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')}, ${args[1]})`;
      }
    }
    const rect = translateExpression(positionalParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `${drawRectangleRec[1]}.drawRectangle(${rect}.x, ${rect}.y, ${rect}.w, ${rect}.h, ${args[1]})`;
  }
  const drawTextureV = /^(?:r[dl]|wgl)\.drawTextureV$/.exec(callee);
  if (drawTextureV !== null && args.length === 3) {
    const [texture, position, tint] = args;
    return `(() => { const texture = ${texture}; const position = ${position}; wgl.drawTexturePro(texture, wgl.makeRectangle(0, 0, texture.width, texture.height), wgl.makeRectangle(position.x, position.y, texture.width, texture.height), wgl.makeVector2(0, 0), 0.0, ${tint}); })()`;
  }
  const raylibColor4ub = /^(r[dl]|wgl)\.rlColor4ub$/.exec(callee);
  if (raylibColor4ub !== null && positionalParts.length === 4) {
    return `${raylibColor4ub[1]}.rlColor4f(${positionalParts.map((arg) => translateRaylibColorArg(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
  }
  const reorderedArgs = (callee === 'rl.rlSetBlendFactorsSeparate' || callee === 'wgl.rlSetBlendFactorsSeparate') && args.length === 6
    ? [args[0], args[1], args[4], args[2], args[3], args[5]]
    : args;
  const raylibWindowCall = /^(r[dl]|wgl)\.(setConfigFlags|initWindow|closeWindow|beginDrawing|endDrawing)$/.exec(callee);
  if (raylibWindowCall !== null) {
    return `(${raylibWindowCall[1]} as any).${raylibWindowCall[2]}(${reorderedArgs.join(', ')})`;
  }
  const callPrefix = constructUppercase && /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
  return `${callPrefix}(${reorderedArgs.join(', ')})`;
}

export function translateCallArgumentExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string> = new Set(),
): string {
  if (pythonExpression.includes('=>')) {
    return pythonExpression;
  }
  const trimmed = pythonExpression.trim();
  if (trimmed.startsWith('**')) {
    return `...Object.values(${translateExpression(trimmed.slice(2), nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  if (trimmed.startsWith('*')) {
    return `...${translateExpression(trimmed.slice(1), nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }
  const generatorArray = generatorExpressionToArray(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (generatorArray !== null) {
    return generatorArray;
  }
  return translateBoundMethodReference(pythonExpression, nameMap, arrayNames, validatedTypeAliases)
    ?? translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
}

function translateCallCalleeExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): string {
  const staticMethodCallee = translateStaticMethodCalleeIfKnown(pythonExpression, nameMap);
  if (staticMethodCallee !== null) {
    return staticMethodCallee;
  }
  const builtinCallee = new Map([
    ['abs', 'Math.abs'],
    ['max', 'Math.max'],
    ['min', 'Math.min'],
    ['round', 'pyRound'],
  ]).get(pythonExpression);
  if (builtinCallee !== undefined) {
    return builtinCallee;
  }
  return translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases)
    .replace(/\.append$/, '.push')
    .replace(/\.extend$/, '.push')
    .replace(/\.index$/, '.indexOf');
}

function translateMapDefaultExpression(
  pythonExpression: string,
  pythonMapExpression: string,
  tsMapExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  if (
    pythonExpression.trim() === '{}'
    && (
      mapNames.has(mapValueMapNameMarker(pythonMapExpression))
      || mapNames.has(mapValueMapNameMarker(tsMapExpression))
    )
  ) {
    const valueType = nameMap.get(mapValueTypeMarker(pythonMapExpression)) ?? nameMap.get(mapValueTypeMarker(tsMapExpression));
    return valueType?.startsWith('Map<') === true ? `new ${valueType}()` : 'new Map()';
  }
  return translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
}

function translateBoundMethodReference(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): string | null {
  const knownMethod = knownInstanceMethodCall(pythonExpression, nameMap, arrayNames, validatedTypeAliases);
  if (knownMethod !== null) {
    const receiver = knownMethod.callee.slice(0, knownMethod.callee.lastIndexOf('.'));
    return `${knownMethod.callee}.bind(${receiver})`;
  }
  const reference = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)$/.exec(pythonExpression.trim());
  if (reference === null) {
    return null;
  }
  const parts = reference[1].split('.');
  const method = parts[parts.length - 1];
  if (parts.length === 2 && parts[0] === 'self' && !method.startsWith('_')) {
    return null;
  }
  if (!attributeNameLooksLikeCallbackMethod(method)) {
    return null;
  }
  const receiver = translateExpression(parts.slice(0, -1).join('.'), nameMap, arrayNames, validatedTypeAliases);
  const tsMethod = tsMemberNameForPythonName(method);
  return `${receiver}.${tsMethod}.bind(${receiver})`;
}

function attributeNameLooksLikeCallbackMethod(pythonName: string): boolean {
  const normalized = pythonName.replace(/^_+/, '');
  if (/(?:_button|_pos|_position|_rect|_color|_label|_width|_height)$/.test(normalized)) {
    return false;
  }
  return /^(?:apply|build|consume|create|draw|handle|on|play|process|registry|reset|sync|update)(?:_|$)/.test(normalized);
}

function translateInlineLambdaExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const lambda = /^lambda(?:\s+([^:]+))?:\s*(.+)$/.exec(pythonExpression);
  if (lambda === null) {
    return null;
  }
  const lambdaNameMap = new Map(nameMap);
  const params: string[] = [];
  const paramsText = lambda[1]?.trim() ?? '';
  if (paramsText !== '') {
    for (const paramText of splitTopLevelComma(paramsText)) {
      const defaulted = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(paramText);
      if (defaulted !== null) {
        const tsName = tsExportNameForPythonName(defaulted[1]);
        params.push(`${tsName} = ${translateExpression(defaulted[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
        lambdaNameMap.set(defaulted[1], tsName);
        continue;
      }
      const plain = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(paramText);
      if (plain === null) {
        return null;
      }
      const tsName = tsExportNameForPythonName(plain[1]);
      params.push(tsName);
      lambdaNameMap.set(plain[1], tsName);
    }
  }
  return `(${params.join(', ')}) => ${translateExpression(lambda[2], lambdaNameMap, arrayNames, validatedTypeAliases, mapNames)}`;
}

function translateConditionalTestExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const trimmed = pythonExpression.trim();
  const translated = translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (expressionIsKnownMap(translated, nameMap, mapNames)) {
    return `${translated}.size > 0`;
  }
  const fieldType = knownClassFieldType(trimmed, nameMap) ?? knownClassFieldType(translated, nameMap);
  if (fieldType !== null) {
    if (typeExpressionLooksMap(fieldType)) {
      return `${translated}.size > 0`;
    }
    if (fieldType.endsWith('[]') || fieldType.startsWith('readonly ') && fieldType.endsWith('[]')) {
      return `${translated}.length > 0`;
    }
  }
  if (arrayNames.has(setNameMarker(trimmed)) || arrayNames.has(setNameMarker(translated))) {
    return arrayNames.has(nullableNameMarker(trimmed)) || arrayNames.has(nullableNameMarker(translated))
      ? `${translated} !== null && ${translated}.size > 0`
      : `${translated}.size > 0`;
  }
  if (arrayNames.has(objectNameMarker(trimmed)) || arrayNames.has(objectNameMarker(translated))) {
    return arrayNames.has(nullableNameMarker(trimmed)) || arrayNames.has(nullableNameMarker(translated))
      ? `${translated} !== null && Object.keys(${translated}).length > 0`
      : `Object.keys(${translated}).length > 0`;
  }
  if (arrayNames.has(trimmed) || arrayNames.has(translated) || arrayNames.has(stringNameMarker(trimmed)) || arrayNames.has(stringNameMarker(translated))) {
    return arrayNames.has(nullableNameMarker(trimmed)) || arrayNames.has(nullableNameMarker(translated))
      ? `${translated} !== null && ${translated}.length > 0`
      : `${translated}.length > 0`;
  }
  return translated;
}

function arrayElementTypeFromTypeExpression(typeExpression: string | null): string | null {
  const trimmed = typeExpression?.trim() ?? '';
  const readonlyArray = /^readonly (.+)\[\]$/.exec(trimmed);
  if (readonlyArray !== null) {
    return readonlyArray[1].trim();
  }
  const mutableArray = /^(.+)\[\]$/.exec(trimmed);
  if (mutableArray !== null) {
    return mutableArray[1].trim();
  }
  const readonlyGeneric = /^ReadonlyArray<(.+)>$/.exec(trimmed);
  return readonlyGeneric?.[1]?.trim() ?? null;
}

function parseRaylibMethodCall(
  pythonExpression: string,
  methodNames: readonly string[],
): { method: string; argsText: string } | null {
  for (const namespace of ['rl', 'rd', 'wgl']) {
    for (const methodName of methodNames) {
      const call = parseCallPrefix(pythonExpression, `${namespace}.${methodName}`);
      if (call !== null && call.rest === '') {
        return { method: methodName, argsText: call.argsText };
      }
    }
  }
  return null;
}

function translateStaticMethodCalleeIfKnown(pythonCallee: string, nameMap: Map<string, string>): string | null {
  const dotted = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonCallee);
  if (dotted === null) {
    return null;
  }
  const receiver = translateIdentifierName(dotted[1], nameMap);
  const receiverType = nameMap.get(receiverTypeNameMarker(dotted[1])) ?? nameMap.get(receiverTypeNameMarker(receiver));
  if (receiverType === undefined) {
    return null;
  }
  const methodName = tsMemberNameForPythonName(dotted[2]);
  const staticMethod = nameMap.get(staticClassMethodNameMarker(receiverType, methodName));
  return staticMethod === undefined ? null : `${receiverType}.${staticMethod}`;
}

function enumVariableTypeName(pythonName: string, nameMap: Map<string, string>): string | null {
  const receiver = translateIdentifierName(pythonName, nameMap);
  const receiverType = nameMap.get(receiverTypeNameMarker(pythonName)) ?? nameMap.get(receiverTypeNameMarker(receiver));
  return receiverType !== undefined && typeExpressionLooksTsEnum(receiverType) ? receiverType : null;
}

function enumIterableTypeName(pythonExpression: string, nameMap: Map<string, string>): string | null {
  const trimmed = pythonExpression.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    return null;
  }
  const translated = translateIdentifierName(trimmed, nameMap);
  return typeExpressionLooksTsEnum(translated) ? translated : null;
}

function tsEnumValuesExpression(enumName: string): string {
  return `Object.values(${enumName}).filter((value): value is ${enumName} => typeof value === 'number')`;
}

export function translateExpression(
  pythonExpression: string,
  nameMap: Map<string, string> = new Map(),
  arrayNames: Set<string> = new Set(),
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): string {
  const trimmed = pythonExpression.trim();
  const adjacentStringExpression = parseAdjacentPythonStringExpression(trimmed);
  if (adjacentStringExpression !== null) {
    return translateExpression(adjacentStringExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }
  const parenthesizedAdjacentStringExpression = parseParenthesizedAdjacentPythonStringExpression(trimmed);
  if (parenthesizedAdjacentStringExpression !== null) {
    return translateExpression(parenthesizedAdjacentStringExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }
  const lambdaExpression = translateInlineLambdaExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (lambdaExpression !== null) {
    return lambdaExpression;
  }
  const bytesLiteral = parseBytesLiteral(trimmed);
  if (bytesLiteral !== null) {
    return `new Uint8Array([${bytesLiteral.join(', ')}])`;
  }
  const bytearrayCall = parseCallPrefix(trimmed, 'bytearray');
  if (bytearrayCall !== null && bytearrayCall.rest === '') {
    return `new Uint8Array(${translateExpression(bytearrayCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  const vectorOffsetKeywordCall = translateVectorOffsetKeywordCall(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (vectorOffsetKeywordCall !== null) {
    return vectorOffsetKeywordCall;
  }

  const pathlibReadBytes = /^(?:Path\((.+)\)|(.+))\.read_bytes\(\)$/.exec(trimmed);
  if (pathlibReadBytes !== null) {
    return `readFileSync(String(${translateExpression(pathlibReadBytes[1] ?? pathlibReadBytes[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}))`;
  }
  const pathlibReadText = /^(?:Path\((.+)\)|(.+))\.read_text\((.*)\)$/.exec(trimmed);
  if (pathlibReadText !== null) {
    return `readFileSync(String(${translateExpression(pathlibReadText[1] ?? pathlibReadText[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}), 'utf8')`;
  }

  const notStripCall = /^not (.+\.strip\(\))$/.exec(trimmed);
  if (notStripCall !== null && delimitersBalanced(notStripCall[1])) {
    return `!${translateExpression(notStripCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const leadingBoolCall = parseCallPrefix(trimmed, 'bool');
  if (leadingBoolCall !== null && leadingBoolCall.rest === '') {
    return translateBooleanCast(leadingBoolCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const lstripCall = /^(.+)\.lstrip\(\)$/.exec(trimmed);
  if (lstripCall !== null) {
    return `pythonLstrip(${translateExpression(lstripCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  const rstripCall = /^(.+)\.rstrip\(\)$/.exec(trimmed);
  if (rstripCall !== null) {
    return `${tsPropertyAccessBase(translateExpression(rstripCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames))}.trimEnd()`;
  }
  const stripCharsCall = /^(.+)\.strip\(([^()]+)\)$/.exec(trimmed);
  if (stripCharsCall !== null && delimitersBalanced(stripCharsCall[1]) && splitTopLevelComma(stripCharsCall[1]).length === 1) {
    return `pythonStripChars(${translateExpression(stripCharsCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(stripCharsCall[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  const stripCall = /^(.+)\.strip\(\)$/.exec(trimmed);
  if (stripCall !== null && splitTopLevelComma(stripCall[1]).length === 1) {
    return `${tsPropertyAccessBase(translateExpression(stripCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames))}.trim()`;
  }
  const findCall = /^(.+)\.find\((.+)\)$/.exec(trimmed);
  if (findCall !== null) {
    const args = splitTopLevelComma(findCall[2]);
    if (args.length === 1 || args.length === 2) {
      return `${translateExpression(findCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.indexOf(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
    }
  }
  const indexCall = /^(.+)\.index\((.*)\)$/.exec(trimmed);
  if (indexCall !== null) {
    const args = splitTopLevelComma(indexCall[2]);
    if (args.length === 1 && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
      const receiver = translateExpression(indexCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const elementType = arrayElementTypeFromTypeExpression(
        knownClassFieldType(indexCall[1], nameMap) ?? knownClassFieldType(receiver, nameMap),
      );
      const item = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `${receiver}.indexOf(${elementType === null ? item : `${item} as ${elementType}`})`;
    }
  }

  const toBytesCall = /^(.+)\.tobytes\(\)$/.exec(trimmed);
  if (toBytesCall !== null) {
    return `bytesFrom(${translateExpression(toBytesCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  if (trimmed === 'dt.date.today()' || trimmed === 'datetime.date.today()') {
    return 'new Date()';
  }
  if (
    trimmed === 'dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")'
    || trimmed === 'datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")'
  ) {
    return '_strftimeUtcNow()';
  }
  if (
    trimmed === 'dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds")'
    || trimmed === 'datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds")'
  ) {
    return "new Date().toISOString().replace('Z', '+00:00')";
  }
  if (trimmed === 'time.perf_counter_ns()') {
    return '(performance.now() * 1_000_000)';
  }
  if (trimmed === 'time.monotonic()') {
    return '(performance.now() / 1000)';
  }
  if (trimmed === 'os.getpid()') {
    return 'globalThis.process?.pid ?? 0';
  }
  const osGetenvCall = parseCallPrefix(trimmed, 'os.getenv');
  if (osGetenvCall !== null && osGetenvCall.rest === '') {
    const args = splitTopLevelComma(osGetenvCall.argsText);
    if (args.length >= 1 && args.length <= 2) {
      const key = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const fallback = args.length === 2
        ? translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames)
        : 'null';
      return `(globalThis.process?.env?.[${key}] ?? ${fallback})`;
    }
  }

  if (trimmed === 'uuid.uuid4().hex') {
    return "globalThis.crypto.randomUUID().replaceAll('-', '')";
  }

  if (trimmed === 'int.from_bytes(os.urandom(4), "little")' || trimmed === "int.from_bytes(os.urandom(4), 'little')") {
    return 'globalThis.crypto.getRandomValues(new Uint32Array(1))[0]';
  }
  const intFromBytesCall = parseCallPrefix(trimmed, 'int.from_bytes');
  if (intFromBytesCall !== null && intFromBytesCall.rest === '') {
    const args = splitTopLevelComma(intFromBytesCall.argsText);
    if (args.length >= 1 && args.length <= 2) {
      const bytes = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const endian = args[1]?.trim() ?? "'big'";
      const readExpression = endian === '"little"' || endian === "'little'"
        ? 'Array.from(bytes).reduce((value, byte, index) => value + byte * (256 ** index), 0)'
        : 'Array.from(bytes).reduce((value, byte) => value * 256 + byte, 0)';
      return `((bytes: ArrayLike<number>) => ${readExpression})(${bytes})`;
    }
  }

  const secretsTokenHexCall = parseCallPrefix(trimmed, 'secrets.token_hex');
  if (secretsTokenHexCall !== null && secretsTokenHexCall.rest === '') {
    return `secretsTokenHex(${translateExpression(secretsTokenHexCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const socketGetHostByNameCall = parseCallPrefix(trimmed, 'socket.gethostbyname');
  if (socketGetHostByNameCall !== null && socketGetHostByNameCall.rest === '') {
    return `String(${translateExpression(socketGetHostByNameCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  if (/^(?:collections\.)?defaultdict\((?:list|dict|set|int|float)?\)$/.test(trimmed)) {
    return 'new Map()';
  }

  const zlibCompressCall = parseCallPrefix(trimmed, 'zlib.compress');
  if (zlibCompressCall !== null && zlibCompressCall.rest === '') {
    const args = splitTopLevelComma(zlibCompressCall.argsText);
    if (args.length >= 1) {
      const data = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const levelArg = args
        .map((arg) => /^level=(.+)$/.exec(arg))
        .find((match): match is RegExpExecArray => match !== null);
      const opts = levelArg === undefined
        ? ''
        : `, { level: ${translateExpression(levelArg[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} }`;
      return `new Uint8Array(deflateSync(${data}${opts}))`;
    }
  }

  const zlibDecompressCall = parseCallPrefix(trimmed, 'zlib.decompress');
  if (zlibDecompressCall !== null && zlibDecompressCall.rest === '') {
    return `new Uint8Array(inflateSync(${translateExpression(zlibDecompressCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)}))`;
  }

  const zstdCompressCall = /^zstd\.ZstdCompressor\(level=(.+)\)\.compress\((.+)\)$/.exec(trimmed);
  if (zstdCompressCall !== null) {
    return `new Uint8Array(zstdCompressSync(${translateExpression(zstdCompressCall[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}, { params: { [zlibConstants.ZSTD_c_compressionLevel]: ${translateExpression(zstdCompressCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} } }))`;
  }

  for (const method of ['floor', 'ceil', 'trunc', 'sqrt', 'pow', 'cos', 'sin', 'atan2'] as const) {
    const mathCall = parseCallPrefix(trimmed, `math.${method}`);
    if (mathCall !== null && mathCall.rest === '') {
      return `Math.${method}(${splitTopLevelComma(mathCall.argsText).map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
    }
  }
  const mathDegreesCall = parseCallPrefix(trimmed, 'math.degrees');
  if (mathDegreesCall !== null && mathDegreesCall.rest === '') {
    return `(${translateExpression(mathDegreesCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)}) * (180.0 / Math.PI)`;
  }

  const chrCall = parseCallPrefix(trimmed, 'chr');
  if (chrCall !== null && chrCall.rest === '') {
    return `String.fromCodePoint(${translateExpression(chrCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const raylibKeyboardKey = /^(?:r[dl]|wgl)\.KeyboardKey\.([A-Z0-9_]+)$/.exec(trimmed);
  if (raylibKeyboardKey !== null) {
    const keyCode = raylibKeyboardKeyCode(raylibKeyboardKey[1]);
    if (keyCode !== null) {
      return String(keyCode);
    }
  }

  const raylibColorConstant = /^(r[dl]|wgl)\.([A-Z_]+)$/.exec(trimmed);
  if (raylibColorConstant !== null) {
    const color = raylibNamedColor(raylibColorConstant[2]);
    if (color !== null) {
      return `wgl.makeColor(${color.join(', ')})`;
    }
  }

  const raylibInputNoArgCall = /^(?:r[dl]|wgl)\.(get_char_pressed|getCharPressed|get_key_pressed|getKeyPressed)\(\)$/.exec(trimmed);
  if (raylibInputNoArgCall !== null) {
    return raylibInputNoArgCall[1].includes('char') || raylibInputNoArgCall[1].includes('Char')
      ? 'InputState.getCharPressed()'
      : 'InputState.getKeyPressed()';
  }

  const raylibTimeCall = /^(?:r[dl]|wgl)\.(?:get_time|getTime)\(\)$/.exec(trimmed);
  if (raylibTimeCall !== null) {
    return '(performance.now() / 1000.0)';
  }

  const raylibKeyInputCall = parseRaylibMethodCall(trimmed, ['is_key_pressed', 'isKeyPressed', 'is_key_pressed_repeat', 'isKeyPressedRepeat', 'is_key_down', 'isKeyDown']);
  if (raylibKeyInputCall !== null) {
    const method = raylibKeyInputCall.method.includes('repeat') || raylibKeyInputCall.method.includes('Repeat')
      ? 'wasKeyPressedRepeat'
      : raylibKeyInputCall.method.includes('down') || raylibKeyInputCall.method.includes('Down') ? 'isKeyDown' : 'wasKeyPressed';
    return `InputState.${method}(${translateExpression(raylibKeyInputCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const raylibGetMousePositionCall = /^(?:r[dl]|wgl)\.(?:get_mouse_position|getMousePosition)\(\)$/.exec(trimmed);
  if (raylibGetMousePositionCall !== null) {
    return '(() => { const [x, y] = InputState.mousePosition(); return { x, y }; })()';
  }

  const raylibGetMouseWheelMoveCall = /^(?:r[dl]|wgl)\.(?:get_mouse_wheel_move|getMouseWheelMove)\(\)$/.exec(trimmed);
  if (raylibGetMouseWheelMoveCall !== null) {
    return 'InputState.mouseWheelDelta()';
  }

  const raylibMouseInputCall = parseRaylibMethodCall(trimmed, ['is_mouse_button_pressed', 'isMouseButtonPressed', 'is_mouse_button_down', 'isMouseButtonDown']);
  if (raylibMouseInputCall !== null) {
    const method = raylibMouseInputCall.method.includes('down') || raylibMouseInputCall.method.includes('Down')
      ? 'isMouseButtonDown'
      : 'wasMouseButtonPressed';
    return `InputState.${method}(${translateExpression(raylibMouseInputCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const raylibMouseButton = /^(?:r[dl]|wgl)\.MouseButton\.(MOUSE_BUTTON_[A-Z_]+)$/.exec(trimmed);
  if (raylibMouseButton !== null) {
    const buttons = new Map([
      ['MOUSE_BUTTON_LEFT', 0],
      ['MOUSE_BUTTON_MIDDLE', 1],
      ['MOUSE_BUTTON_RIGHT', 2],
      ['MOUSE_BUTTON_SIDE', 3],
      ['MOUSE_BUTTON_EXTRA', 4],
      ['MOUSE_BUTTON_FORWARD', 5],
      ['MOUSE_BUTTON_BACK', 6],
    ]);
    return String(buttons.get(raylibMouseButton[1]) ?? 0);
  }

  if (trimmed === 'self.__class__.__name__' || trimmed === 'this.__class__.__name__') {
    return 'this.constructor.name';
  }

  const enumMemberValue = /^([A-Z][A-Za-z0-9_]*\.[A-Z][A-Z0-9_]*)\.value$/.exec(trimmed);
  if (enumMemberValue !== null) {
    return translateExpression(enumMemberValue[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  }
  const enumVariableValue = /^([A-Za-z_][A-Za-z0-9_]*)\.value$/.exec(trimmed);
  if (enumVariableValue !== null) {
    const receiver = translateIdentifierName(enumVariableValue[1], nameMap);
    const receiverType = nameMap.get(receiverTypeNameMarker(enumVariableValue[1])) ?? nameMap.get(receiverTypeNameMarker(receiver));
    if (receiverType !== undefined && typeExpressionLooksTsEnum(receiverType)) {
      return receiver;
    }
  }
  const enumVariableNameLower = /^([A-Za-z_][A-Za-z0-9_]*)\.name\.lower\(\)$/.exec(trimmed);
  if (enumVariableNameLower !== null) {
    const enumName = enumVariableTypeName(enumVariableNameLower[1], nameMap);
    if (enumName !== null) {
      return `String(${enumName}[${translateIdentifierName(enumVariableNameLower[1], nameMap)}]).toLowerCase()`;
    }
  }
  const enumVariableName = /^([A-Za-z_][A-Za-z0-9_]*)\.name$/.exec(trimmed);
  if (enumVariableName !== null) {
    const enumName = enumVariableTypeName(enumVariableName[1], nameMap);
    if (enumName !== null) {
      return `${enumName}[${translateIdentifierName(enumVariableName[1], nameMap)}]`;
    }
  }

  const superMethodCall = /^super\(\)\.([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/.exec(trimmed);
  if (superMethodCall !== null) {
    const args = translateCallArgsWithKeywordObject(
      superMethodCall[2],
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (superMethodCall[1] === '__init__') {
      const superArgs = args.length >= 2 && args[0] === 'ctx' && args[1].startsWith('{')
        ? args.slice(1)
        : args;
      return `super(${superArgs.join(', ')})`;
    }
    return `super.${tsMemberNameForPythonName(superMethodCall[1])}(${args.join(', ')})`;
  }

  const parenthesizedReceiverMethodCall = /^\(([\s\S]+)\)\.([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/.exec(trimmed);
  if (parenthesizedReceiverMethodCall !== null && matchingCloseParen(trimmed, 0) === parenthesizedReceiverMethodCall[1].length + 1) {
    const receiver = translateExpression(parenthesizedReceiverMethodCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const args = splitTopLevelComma(parenthesizedReceiverMethodCall[3])
      .filter((arg) => arg.trim() !== '')
      .map((arg) => translateCallArgumentExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames));
    return `${tsPropertyAccessBase(receiver)}.${tsMemberNameForPythonName(parenthesizedReceiverMethodCall[2])}(${args.join(', ')})`;
  }

  const menuViewHelper = menuViewHelperName(trimmed);
  if (menuViewHelper !== null) {
    return menuViewHelper;
  }

  const pathGlobCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.glob\((.*)\)$/.exec(trimmed);
  if (pathGlobCall !== null) {
    const args = splitTopLevelComma(pathGlobCall[2]);
    if (args.length === 1) {
      return `_globPath(String(${translateExpression(pathGlobCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}), ${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const pathNameCallAttribute = /^Path\((.+)\)\.name$/.exec(trimmed);
  if (pathNameCallAttribute !== null) {
    return `_basename(String(${translateExpression(pathNameCallAttribute[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}))`;
  }

  const pathNameAttribute = /^(.+)\.name$/.exec(trimmed);
  if (pathNameAttribute !== null) {
    const receiver = translateExpression(pathNameAttribute[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(pathNameMarker(pathNameAttribute[1])) || arrayNames.has(pathNameMarker(receiver))) {
      return `_basename(String(${receiver}))`;
    }
  }

  const pathWithNameCall = /^(?:Path\((.+)\)|(.+))\.with_name\((.+)\)$/.exec(trimmed);
  if (pathWithNameCall !== null) {
    const pathExpression = pathWithNameCall[1] ?? pathWithNameCall[2];
    const receiver = translateExpression(pathExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (pathWithNameCall[1] !== undefined || arrayNames.has(pathNameMarker(pathExpression)) || arrayNames.has(pathNameMarker(receiver))) {
      return `_pathJoin(_dirname(String(${receiver})), ${translateExpression(pathWithNameCall[3], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const pathSuffixLowerCall = /^(?:Path\((.+)\)|(.+))\.suffix\.lower\(\)$/.exec(trimmed);
  if (pathSuffixLowerCall !== null) {
    const pathExpression = pathSuffixLowerCall[1] ?? pathSuffixLowerCall[2];
    const receiver = translateExpression(pathExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (pathSuffixLowerCall[1] !== undefined || arrayNames.has(pathNameMarker(pathExpression)) || arrayNames.has(pathNameMarker(receiver))) {
      return `_pathExtname(String(${receiver})).toLowerCase()`;
    }
  }

  const pathSuffixAttribute = /^(?:Path\((.+)\)|(.+))\.suffix$/.exec(trimmed);
  if (pathSuffixAttribute !== null) {
    const pathExpression = pathSuffixAttribute[1] ?? pathSuffixAttribute[2];
    const receiver = translateExpression(pathExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (pathSuffixAttribute[1] !== undefined || arrayNames.has(pathNameMarker(pathExpression)) || arrayNames.has(pathNameMarker(receiver))) {
      return `_pathExtname(String(${receiver}))`;
    }
  }

  const pathStemAttribute = /^(?:Path\((.+)\)|(.+))\.stem$/.exec(trimmed);
  if (pathStemAttribute !== null) {
    const pathExpression = pathStemAttribute[1] ?? pathStemAttribute[2];
    const receiver = translateExpression(pathExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (pathStemAttribute[1] !== undefined || arrayNames.has(pathNameMarker(pathExpression)) || arrayNames.has(pathNameMarker(receiver))) {
      return `_pathStem(String(${receiver}))`;
    }
  }

  const pathExistsCall = /^(?:Path\((.+)\)|(.+))\.exists\(\)$/.exec(trimmed);
  if (pathExistsCall !== null) {
    const pathExpression = pathExistsCall[1] ?? pathExistsCall[2];
    const receiver = translateExpression(pathExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (pathExistsCall[1] !== undefined || arrayNames.has(pathNameMarker(pathExpression)) || arrayNames.has(pathNameMarker(receiver))) {
      return `existsSync(String(${receiver}))`;
    }
  }

  const pathIsFileCall = /^(?:Path\((.+)\)|(.+))\.is_file\(\)$/.exec(trimmed);
  if (pathIsFileCall !== null) {
    const pathExpression = pathIsFileCall[1] ?? pathIsFileCall[2];
    const receiver = translateExpression(pathExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (pathIsFileCall[1] !== undefined || arrayNames.has(pathNameMarker(pathExpression)) || arrayNames.has(pathNameMarker(receiver))) {
      return `(existsSync(String(${receiver})) && statSync(String(${receiver})).isFile())`;
    }
  }

  const pathIsAbsoluteCall = /^(?:Path\((.+)\)|(.+))\.is_absolute\(\)$/.exec(trimmed);
  if (pathIsAbsoluteCall !== null) {
    const pathExpression = pathIsAbsoluteCall[1] ?? pathIsAbsoluteCall[2];
    const receiver = translateExpression(pathExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (pathIsAbsoluteCall[1] !== undefined || arrayNames.has(pathNameMarker(pathExpression)) || arrayNames.has(pathNameMarker(receiver))) {
      return `_pathIsAbsolute(String(${receiver}))`;
    }
  }

  const pathAsPosixCall = /^(?:Path\((.+)\)|(.+))\.as_posix\(\)$/.exec(trimmed);
  if (pathAsPosixCall !== null) {
    const pathExpression = pathAsPosixCall[1] ?? pathAsPosixCall[2];
    const receiver = translateExpression(pathExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (pathAsPosixCall[1] !== undefined || arrayNames.has(pathNameMarker(pathExpression)) || arrayNames.has(pathNameMarker(receiver))) {
      return `String(${receiver}).replaceAll('\\\\', '/')`;
    }
  }

  const dateAttribute = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.(day|month|year)$/.exec(trimmed);
  if (dateAttribute !== null) {
    const receiver = translateExpression(dateAttribute[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(dateNameMarker(dateAttribute[1])) || arrayNames.has(dateNameMarker(receiver))) {
      if (dateAttribute[2] === 'day') {
        return `${receiver}.getDate()`;
      }
      if (dateAttribute[2] === 'month') {
        return `${receiver}.getMonth() + 1`;
      }
      return `${receiver}.getFullYear()`;
    }
  }

  const bytesDecodeStripCall = /^(.+)\.decode\((.*)\)\.strip\(\)$/.exec(trimmed);
  if (bytesDecodeStripCall !== null) {
    const args = splitTopLevelComma(bytesDecodeStripCall[2]);
    const encoding = args[0] === undefined ? 'utf-8' : parsePythonStringExpression(args[0])?.content ?? null;
    if (encoding !== null) {
      return `new TextDecoder(${tsStringLiteral(JSON.stringify(encoding))}).decode(${translateExpression(bytesDecodeStripCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}).trim()`;
    }
  }

  const bytesDecodeSplitlinesCall = /^(.+)\.decode\((.*)\)\.splitlines\(\)$/.exec(trimmed);
  if (bytesDecodeSplitlinesCall !== null) {
    const args = splitTopLevelComma(bytesDecodeSplitlinesCall[2]);
    const encoding = args[0] === undefined ? 'utf-8' : parsePythonStringExpression(args[0])?.content ?? null;
    if (encoding !== null) {
      return `pythonSplitlines(new TextDecoder(${tsStringLiteral(JSON.stringify(encoding))}).decode(${translateExpression(bytesDecodeSplitlinesCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}))`;
    }
  }

  const nulTerminatedLatin1Decode = /^(.+)\.split\(b(["'])\\x00\2, 1\)\[0\]\.decode\((.*)\)$/.exec(trimmed);
  if (nulTerminatedLatin1Decode !== null) {
    const args = splitTopLevelComma(nulTerminatedLatin1Decode[3]);
    const encoding = args[0] === undefined ? 'utf-8' : parsePythonStringExpression(args[0])?.content ?? null;
    if (encoding !== null && ['latin-1', 'latin1', 'iso-8859-1'].includes(encoding.toLowerCase())) {
      return `latin1DecodeUntilNull(${translateExpression(nulTerminatedLatin1Decode[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const bytesDecodeCall = /^(.+)\.decode\((.*)\)$/.exec(trimmed);
  if (bytesDecodeCall !== null) {
    const args = splitTopLevelComma(bytesDecodeCall[2]);
    const encoding = args[0] === undefined ? 'utf-8' : parsePythonStringExpression(args[0])?.content ?? null;
    if (encoding !== null) {
      return `new TextDecoder(${tsStringLiteral(JSON.stringify(encoding))}).decode(${translateExpression(bytesDecodeCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const stringEncodeCall = /^(.+)\.encode\((.*)\)$/.exec(trimmed);
  if (stringEncodeCall !== null) {
    const args = splitTopLevelComma(stringEncodeCall[2]);
    const encoding = args[0] === undefined ? null : parsePythonStringExpression(args[0]);
    const errors = args
      .map((arg) => /^errors=(.+)$/.exec(arg.trim()))
      .find((match): match is RegExpExecArray => match !== null);
    const errorsValue = errors === undefined ? null : parsePythonStringExpression(errors[1]);
    if (
      encoding !== null
      && ['latin-1', 'latin1', 'iso-8859-1'].includes(encoding.content.toLowerCase())
      && (errorsValue?.content ?? 'strict') === 'replace'
    ) {
      return `latin1EncodeReplace(${translateExpression(stringEncodeCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
    if (
      encoding !== null
      && ['latin-1', 'latin1', 'iso-8859-1'].includes(encoding.content.toLowerCase())
      && (errorsValue?.content ?? 'strict') === 'ignore'
    ) {
      return `latin1EncodeIgnore(${translateExpression(stringEncodeCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const constructField = translateConstructFieldExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames, translateExpression);
  if (constructField !== null) {
    return constructField;
  }

  const constructExpression = translateConstructExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames, translateExpression);
  if (constructExpression !== null) {
    return constructExpression;
  }

  const isAlphaCall = /^(.+)\.isalpha\(\)$/.exec(trimmed);
  if (isAlphaCall !== null) {
    return `/^\\p{L}+$/u.test(${translateExpression(isAlphaCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const isAlnumCall = /^(.+)\.isalnum\(\)$/.exec(trimmed);
  if (isAlnumCall !== null) {
    return `/^[\\p{L}\\p{N}]+$/u.test(${translateExpression(isAlnumCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const isDigitCall = /^(.+)\.isdigit\(\)$/.exec(trimmed);
  if (isDigitCall !== null) {
    return `/^\\d+$/u.test(${translateExpression(isDigitCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  if (trimmed === 'cProfile.Profile()') {
    return 'new PythonProfile()';
  }

  if (/^(?:r[dl]|wgl)\.ConfigFlags\.FLAG_WINDOW_HIDDEN$/.test(trimmed)) {
    return '0';
  }

  const pstatsStatsCall = /^pstats\.Stats\((.+)\)$/.exec(trimmed);
  if (pstatsStatsCall !== null) {
    return `pythonProfileStats(${translateExpression(pstatsStatsCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const statisticsFmeanCall = /^statistics\.fmean\((.+)\)$/.exec(trimmed);
  if (statisticsFmeanCall !== null) {
    return `pythonFmean(${translateExpression(statisticsFmeanCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const statisticsStdevCall = /^statistics\.stdev\((.+)\)$/.exec(trimmed);
  if (statisticsStdevCall !== null) {
    return `pythonStdev(${translateExpression(statisticsStdevCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const vec2FromXyCall = /^Vec2\.from_xy\((.*)\)$/.exec(trimmed);
  if (vec2FromXyCall !== null) {
    return `Vec2.fromXY(${translateExpression(vec2FromXyCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const stringJoinCall = /^((?:[fF])?(["'])(?:\\.|(?!\2)[\s\S])*\2)\.join\((.+)\)$/.exec(trimmed);
  if (stringJoinCall !== null) {
    const separator = parsePythonStringExpression(stringJoinCall[1]);
    if (separator !== null) {
      const generatorArray = generatorExpressionToArray(stringJoinCall[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const chunks = generatorArray ?? translateExpression(stringJoinCall[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `${chunks}.join(${JSON.stringify(separator.content)})`;
    }
  }

  const bytesJoinCall = /^(b(["'])(?:\\.|(?!\2)[\s\S])*\2)\.join\((.+)\)$/.exec(trimmed);
  if (bytesJoinCall !== null) {
    const separator = parseBytesLiteral(bytesJoinCall[1]);
    if (separator !== null && separator.length === 0) {
      const generatorArray = generatorExpressionToArray(bytesJoinCall[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const chunks = generatorArray ?? translateExpression(bytesJoinCall[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `concatBytes(${chunks})`;
    }
  }

  const enumCastNameLower = /^([A-Z][A-Za-z0-9_]*(?:Id|Type|Mode|Flags))\((.+)\)\.name\.lower\(\)$/.exec(trimmed);
  if (enumCastNameLower !== null) {
    const enumName = tsExportNameForPythonName(enumCastNameLower[1]);
    const value = translateExpression(enumCastNameLower[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `String(${enumName}[${value}]).toLowerCase()`;
  }
  const enumCastName = /^([A-Z][A-Za-z0-9_]*(?:Id|Type|Mode|Flags))\((.+)\)\.name$/.exec(trimmed);
  if (enumCastName !== null) {
    const enumName = tsExportNameForPythonName(enumCastName[1]);
    const value = translateExpression(enumCastName[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `${enumName}[${value}]`;
  }

  const stringLowerCall = /^(.+)\.lower\(\)$/.exec(trimmed);
  if (stringLowerCall !== null) {
    return `${translateExpression(stringLowerCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.toLowerCase()`;
  }

  const stringReplaceCall = /^(.+)\.replace\((.*)\)$/.exec(trimmed);
  if (stringReplaceCall !== null) {
    const args = splitTopLevelComma(stringReplaceCall[2]);
    if (args.length === 2 && parsePythonStringExpression(args[0]) !== null) {
      return `${translateExpression(stringReplaceCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.replaceAll(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const stringFormatCall = /^(.+)\.format\((.*)\)$/.exec(trimmed);
  if (stringFormatCall !== null && delimitersBalanced(stringFormatCall[1])) {
    const args = splitTopLevelComma(stringFormatCall[2]);
    if (args.length > 0 && args.every((arg) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg.trim()))) {
      return args.reduce((formatted, arg) => {
        const keyword = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg.trim());
        if (keyword === null) {
          return formatted;
        }
        const value = translateExpression(keyword[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
        return `${formatted}.replaceAll('{${keyword[1]}}', String(${value}))`;
      }, translateExpression(stringFormatCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames));
    }
  }

  const stringSplitlinesCall = /^(.+)\.splitlines\(\)$/.exec(trimmed);
  if (stringSplitlinesCall !== null) {
    return `pythonSplitlines(${translateExpression(stringSplitlinesCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const stringWhitespaceSplitCall = /^(.+)\.split\(\)$/.exec(trimmed);
  if (stringWhitespaceSplitCall !== null) {
    const value = translateExpression(stringWhitespaceSplitCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `(() => { const value = ${value}; const text = String(value).trim(); return text === '' ? [] : text.split(/\\s+/); })()`;
  }

  const stringIsIdentifierCall = /^(.+)\.isidentifier\(\)$/.exec(trimmed);
  if (stringIsIdentifierCall !== null) {
    return `pythonIsIdentifier(${translateExpression(stringIsIdentifierCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const colorChannel = /^([A-Za-z_][A-Za-z0-9_]*)\.([rgba])$/.exec(trimmed);
  if (colorChannel !== null) {
    const translatedName = translateExpression(colorChannel[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(colorNameMarker(colorChannel[1])) || arrayNames.has(colorNameMarker(translatedName))) {
      return `${translatedName}.${colorChannel[2]} * 255`;
    }
  }

  const rectangleDimension = /^(.+)\.(width|height)$/.exec(trimmed);
  if (rectangleDimension !== null) {
    const translatedName = translateExpression(rectangleDimension[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(rectangleNameMarker(rectangleDimension[1])) || arrayNames.has(rectangleNameMarker(translatedName))) {
      return `${translatedName}.${rectangleDimension[2] === 'width' ? 'w' : 'h'}`;
    }
  }

  const privateDottedIdentifier = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\._[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.exec(trimmed);
  if (privateDottedIdentifier !== null && shouldPreservePrivateDottedName(trimmed)) {
    return translateIdentifierNamePreservingPrivateMembers(trimmed, nameMap);
  }

  const inlineRecord = translateInlineRecordLiteral(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (inlineRecord !== null) {
    return inlineRecord;
  }

  const callWithInlineRecord = translateCallWithInlineRecordArgs(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (callWithInlineRecord !== null) {
    return callWithInlineRecord;
  }

  const oneItemTuple = /^\((.+),\)$/.exec(trimmed);
  if (oneItemTuple !== null && splitTopLevelComma(oneItemTuple[1]).length === 1) {
    return `[${translateExpression(oneItemTuple[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}]`;
  }

  const parenthesizedConditional = /^\((.+ if .+ else .+)\)$/.exec(trimmed);
  if (parenthesizedConditional !== null && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    return translateExpression(parenthesizedConditional[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const earlyConditionalExpression = parseTopLevelConditionalExpression(trimmed);
  const enumModeConditionalForLater = /^(.+) if isinstance\((.+), ([A-Z][A-Za-z0-9_]*Mode)\) else ([A-Z][A-Za-z0-9_]*Mode)\((.+)\)$/.exec(trimmed);
  if (earlyConditionalExpression !== null && enumModeConditionalForLater === null) {
    return [
      translateConditionalTestExpression(earlyConditionalExpression.condition, nameMap, arrayNames, validatedTypeAliases, mapNames),
      '?',
      translateExpression(earlyConditionalExpression.trueExpression, nameMap, arrayNames, validatedTypeAliases, mapNames),
      ':',
      translateExpression(earlyConditionalExpression.falseExpression, nameMap, arrayNames, validatedTypeAliases, mapNames),
    ].join(' ');
  }

  const dictComprehension = /^\{(.+): (.+) for ([A-Za-z_][A-Za-z0-9_]*) in (.+)\}$/.exec(trimmed);
  if (dictComprehension !== null) {
    const itemName = tsExportNameForPythonName(dictComprehension[3]);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(dictComprehension[3], itemName);
    const enumIterableType = enumIterableTypeName(dictComprehension[4], nameMap);
    if (enumIterableType !== null) {
      itemNameMap.set(receiverTypeNameMarker(dictComprehension[3]), enumIterableType);
      itemNameMap.set(receiverTypeNameMarker(itemName), enumIterableType);
    }
    const iterable = enumIterableType === null
      ? translateExpression(dictComprehension[4], nameMap, arrayNames, validatedTypeAliases, mapNames)
      : tsEnumValuesExpression(enumIterableType);
    const itemParameter = enumIterableType === null ? methodCallIterableCallbackParameter(itemName, iterable) : itemName;
    return `new Map(Array.from(${iterable}, (${itemParameter}) => [${translateExpression(dictComprehension[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(dictComprehension[2], itemNameMap, arrayNames, validatedTypeAliases, mapNames)}] as const))`;
  }

  const tupleDictComprehension = /^\{(.+): (.+) for ([A-Za-z_][A-Za-z0-9_]*), ([A-Za-z_][A-Za-z0-9_]*) in (.+)\}$/.exec(trimmed);
  if (tupleDictComprehension !== null) {
    const keyName = tsExportNameForPythonName(tupleDictComprehension[3]);
    const valueName = tsExportNameForPythonName(tupleDictComprehension[4]);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(tupleDictComprehension[3], keyName);
    itemNameMap.set(tupleDictComprehension[4], valueName);
    const iterable = translateExpression(tupleDictComprehension[5], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const keyExpression = translateExpression(tupleDictComprehension[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames);
    const valueExpression = translateExpression(tupleDictComprehension[2], itemNameMap, arrayNames, validatedTypeAliases, mapNames);
    return `Object.fromEntries(Array.from(${iterable}, ([${keyName}, ${valueName}]) => [${keyExpression}, ${valueExpression}] as const))`;
  }

  const setComprehension = translateSetComprehensionExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (setComprehension !== null) {
    return setComprehension;
  }

  const setLiteral = translateSetLiteralExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (setLiteral !== null) {
    return setLiteral;
  }

  const boolCall = parseCallPrefix(trimmed, 'bool');
  if (boolCall !== null && boolCall.rest === '') {
    return translateBooleanCast(boolCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  if (trimmed.startsWith('(') && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.includes('len(') && splitTopLevelComma(inner).length === 1) {
      return `(${translateExpression(inner, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const lengthComparison = /^(.+?) (<=|>=|<|>|==|!=) (.+)$/.exec(trimmed);
  if (
    lengthComparison !== null
    && (lengthComparison[1].includes('len(') || lengthComparison[3].includes('len('))
    && !/(?:<=|>=|<|>|==|!=)/.test(lengthComparison[1])
    && !/(?:<=|>=|<|>|==|!=)/.test(lengthComparison[3])
  ) {
    const left = translateExpression(lengthComparison[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(lengthComparison[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const operator = lengthComparison[2] === '=='
      ? '==='
      : lengthComparison[2] === '!='
        ? '!=='
        : lengthComparison[2];
    return `${left} ${operator} ${right}`;
  }

  const mathIsFinite = /^math\.isfinite\((.+)\)$/.exec(trimmed);
  if (mathIsFinite !== null) {
    return `Number.isFinite(${translateExpression(mathIsFinite[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const jsonDumps = parseCallPrefix(trimmed, 'json.dumps');
  if (jsonDumps !== null && jsonDumps.rest === '') {
    const args = splitTopLevelComma(jsonDumps.argsText);
    const keywordArgs = new Map<string, string>();
    let value: string | null = null;
    for (const arg of args) {
      const keyword = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg);
      if (keyword === null && value === null) {
        value = arg;
      } else if (keyword !== null) {
        keywordArgs.set(keyword[1], keyword[2]);
      }
    }
    if (value !== null) {
      const translatedValue = translateExpression(value, nameMap, arrayNames, validatedTypeAliases, mapNames);
      const indent = keywordArgs.get('indent');
      const sortKeys = keywordArgs.get('sort_keys');
      const defaultArg = keywordArgs.get('default');
      if (sortKeys === 'True') {
        const opts = [`sortKeys: true`];
        if (indent !== undefined) {
          opts.push(`indent: ${translateExpression(indent, nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
        }
        if (defaultArg === 'repr') {
          opts.push('defaultRepr: true');
        }
        return `pythonJsonDumps(${translatedValue}, { ${opts.join(', ')} })`;
      }
      return `JSON.stringify(${translatedValue}, null, ${indent === undefined ? '0' : translateExpression(indent, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const tupleTargetListComprehension = parseTupleTargetListComprehension(trimmed);
  if (tupleTargetListComprehension !== null) {
    return tupleTargetGeneratorExpressionToArray(tupleTargetListComprehension, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const listComprehension = parseSimpleListComprehension(trimmed);
  if (listComprehension !== null) {
    const itemName = tsExportNameForPythonName(listComprehension.itemName);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(listComprehension.itemName, itemName);
    const iterable = arrayMethodIterableExpression(listComprehension.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const elementType = iterableElementType(listComprehension.iterable, iterable, nameMap);
    if (elementType !== null) {
      itemNameMap.set(receiverTypeNameMarker(listComprehension.itemName), elementType);
      itemNameMap.set(receiverTypeNameMarker(itemName), elementType);
    }
    const translatedItem = translateExpression(listComprehension.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames);
    const itemExpression = tupleListComprehensionItemExpression(listComprehension.expression, translatedItem);
    const filtered = listComprehension.condition === null
      ? iterable
      : `${iterable}.filter((${itemName}) => ${translateExpression(listComprehension.condition!, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    return listComprehension.condition !== null && itemExpression === itemName
      ? filtered
      : `${filtered}.map((${itemName}) => ${itemExpression})`;
  }

  const listLiteral = /^\[([\s\S]*)\]$/.exec(trimmed);
  if (listLiteral !== null) {
    const items = splitTopLevelComma(listLiteral[1]).filter((item) => item.trim() !== '');
    const tupleArray = items.length > 0 && items.every((item) => {
      const stripped = item.trim();
      if (stripped.startsWith('(') && matchingCloseParen(stripped, 0) === stripped.length - 1) {
        return splitTopLevelComma(stripped.slice(1, -1)).length > 1;
      }
      if (stripped.startsWith('[') && stripped.endsWith(']')) {
        return splitTopLevelComma(stripped.slice(1, -1)).length > 1;
      }
      return false;
    });
    const expression = `[${items.map((item) => {
      const stripped = item.trim();
      return stripped.startsWith('*')
        ? `...${translateExpression(stripped.slice(1), nameMap, arrayNames, validatedTypeAliases, mapNames)}`
        : translateExpression(stripped, nameMap, arrayNames, validatedTypeAliases, mapNames);
    }).join(', ')}]`;
    return tupleArray ? `${expression} as const` : expression;
  }

  const aggregateGenerator = translateAggregateGeneratorCall(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (aggregateGenerator !== null) {
    return aggregateGenerator;
  }

  const enumerateCall = parseCallPrefix(trimmed, 'enumerate');
  if (enumerateCall !== null && enumerateCall.rest === '') {
    const enumerateArgs = parseEnumerateCallArgs(enumerateCall.argsText);
    if (enumerateArgs !== null) {
      const iterable = translateExpression(enumerateArgs.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (enumerateArgs.start === null) {
        return `Array.from(${iterable}).entries()`;
      }
      const start = translateExpression(enumerateArgs.start, nameMap, arrayNames, validatedTypeAliases, mapNames);
      return start === '0'
        ? `Array.from(${iterable}).entries()`
        : `Array.from(${iterable}, (item, index) => [index + ${start}, item] as const)`;
    }
  }

  for (const [pythonName, tsMethod] of [['any', 'some'], ['all', 'every']] as const) {
    const generatorCall = parseCallPrefix(trimmed, pythonName);
    if (generatorCall !== null && generatorCall.rest === '') {
      const generator = parseSimpleGeneratorExpression(generatorCall.argsText.trim());
      if (generator !== null) {
        const itemName = tsExportNameForPythonName(generator.itemName);
        const itemNameMap = new Map(nameMap);
        itemNameMap.set(generator.itemName, itemName);
        const iterable = arrayMethodIterableExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
        const expression = translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames);
        const condition = generator.condition === null
          ? expression
          : `(${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)}) && (${expression})`;
        return `${iterable}.${tsMethod}((${itemName}) => ${condition})`;
      }
    }
  }

  const listUnpack = /^\[\*(.+)\]$/.exec(trimmed);
  if (listUnpack !== null) {
    return `[...${translateExpression(listUnpack[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}]`;
  }

  const sortedCasefoldCall = /^sorted\((.+), key=str\.casefold\)$/.exec(trimmed);
  if (sortedCasefoldCall !== null) {
    const mapKeys = /^([A-Za-z_][A-Za-z0-9_]*)\.keys\(\)$/.exec(sortedCasefoldCall[1]);
    const iterable = mapKeys === null
      ? translateExpression(sortedCasefoldCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)
      : `Array.from(${translateExpression(mapKeys[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.keys())`;
    return `${iterable}.sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))`;
  }

  const sortedCall = parseCallPrefix(trimmed, 'sorted');
  if (sortedCall !== null && sortedCall.rest === '') {
    const sortedExpression = translateSortedCall(sortedCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (sortedExpression !== null) {
      return sortedExpression;
    }
  }

  const setUnion = topLevelSetUnion(trimmed);
  if (setUnion !== null) {
    return `new Set([...${translateExpression(setUnion.left, nameMap, arrayNames, validatedTypeAliases, mapNames)}, ...${translateExpression(setUnion.right, nameMap, arrayNames, validatedTypeAliases, mapNames)}])`;
  }

  const maxCall = parseCallPrefix(trimmed, 'max');
  if (maxCall !== null && maxCall.rest === '') {
    const maxExpression = translateMaxCall(maxCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (maxExpression !== null) {
      return maxExpression;
    }
  }

  const hasTopLevelLogicalOperator = splitTopLevelLogicalOperator(trimmed, 'or') !== null
    || splitTopLevelLogicalOperator(trimmed, 'and') !== null;
  const mapNotMembership = /^(.+) not in ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
  if (mapNotMembership !== null && !hasTopLevelLogicalOperator) {
    const mapName = translateExpression(mapNotMembership[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const value = translateExpression(mapNotMembership[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
      const key = translateMapKeyExpression(mapName, value, mapNames);
      return `!${mapName}.has(${key})`;
    }
    if (arrayNames.has(setNameMarker(mapNotMembership[2])) || arrayNames.has(setNameMarker(mapName))) {
      return `!(${mapName} as ReadonlySet<unknown>).has(${value})`;
    }
    return `!${pythonContainsExpression(mapName, value)}`;
  }

  const mapMembership = /^(.+) in ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
  if (mapMembership !== null && !hasTopLevelLogicalOperator) {
    const mapName = translateExpression(mapMembership[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const value = translateExpression(mapMembership[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
      const key = translateMapKeyExpression(mapName, value, mapNames);
      return `${mapName}.has(${key})`;
    }
    if (arrayNames.has(setNameMarker(mapMembership[2])) || arrayNames.has(setNameMarker(mapName))) {
      return `(${mapName} as ReadonlySet<unknown>).has(${value})`;
    }
    return pythonContainsExpression(mapName, value);
  }

  const mapItemsCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.items\(\)$/.exec(trimmed);
  if (mapItemsCall !== null) {
    const mapName = translateExpression(mapItemsCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
      return `${mapName}.entries()`;
    }
    return `Object.entries(${mapName})`;
  }

  const mapKeysCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.keys\(\)$/.exec(trimmed);
  if (mapKeysCall !== null) {
    const mapName = translateExpression(mapKeysCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(pythonMappingNameMarker(mapKeysCall[1])) || arrayNames.has(pythonMappingNameMarker(mapName))) {
      return `pythonMappingKeys(${mapName})`;
    }
    if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
      return `${mapName}.keys()`;
    }
    if (arrayNames.has(objectNameMarker(mapKeysCall[1])) || arrayNames.has(objectNameMarker(mapName))) {
      return `Object.keys(${mapName})`;
    }
  }

  const mapValuesCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.values\(\)$/.exec(trimmed);
  if (mapValuesCall !== null) {
    const mapName = translateExpression(mapValuesCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
      return `${mapName}.values()`;
    }
    if (arrayNames.has(objectNameMarker(mapValuesCall[1])) || arrayNames.has(objectNameMarker(mapName))) {
      return `Object.values(${mapName})`;
    }
  }

  const startsWithCall = /^(.+)\.startswith\((.*)\)$/.exec(trimmed);
  if (startsWithCall !== null && !startsWithCall[1].trim().startsWith('not ') && delimitersBalanced(startsWithCall[1])) {
    return `pythonStartsWith(${translateExpression(startsWithCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(startsWithCall[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const endsWithCall = /^(.+)\.endswith\((.*)\)$/.exec(trimmed);
  if (endsWithCall !== null && !endsWithCall[1].trim().startsWith('not ') && delimitersBalanced(endsWithCall[1])) {
    return `pythonEndsWith(${translateExpression(endsWithCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(endsWithCall[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const regexCompileCall = parseCallPrefix(trimmed, 're.compile');
  if (regexCompileCall !== null && regexCompileCall.rest === '') {
    const args = splitTopLevelComma(regexCompileCall.argsText);
    const pattern = args.find((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg));
    if (pattern !== undefined) {
      const flagsArg = args.find((arg) => /^flags=/.test(arg)) ?? args.find((arg, index) => index > 0 && arg.includes('re.'));
      const flags = tsRegExpFlagsExpression(flagsArg?.replace(/^flags=/, ''));
      const source = tsRegExpSourceExpression(pattern, nameMap, arrayNames, validatedTypeAliases, mapNames);
      return flags === '' ? `new RegExp(${source})` : `new RegExp(${source}, '${flags}')`;
    }
  }

  const regexSearchCall = parseCallPrefix(trimmed, 're.search');
  if (regexSearchCall !== null && regexSearchCall.rest === '') {
    const args = splitTopLevelComma(regexSearchCall.argsText);
    if (args.length >= 2) {
      const flagsArg = args.find((arg) => /^flags=/.test(arg)) ?? args.find((arg, index) => index > 1 && arg.includes('re.'));
      const flags = tsRegExpFlagsExpression(flagsArg?.replace(/^flags=/, ''));
      const source = tsRegExpSourceExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const value = translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const regex = flags === '' ? `new RegExp(${source})` : `new RegExp(${source}, '${flags}')`;
      return `${regex}.exec(String(${value}))`;
    }
  }

  const regexFullmatchCall = /^(.+)\.fullmatch\((.*)\)$/.exec(trimmed);
  if (regexFullmatchCall !== null) {
    const pattern = translateExpression(regexFullmatchCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const value = translateExpression(regexFullmatchCall[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `((pattern: RegExp, value: string) => { const match = pattern.exec(value); return match !== null && match[0] === value ? match : null; })(${pattern}, String(${value}))`;
  }

  const regexGroupLowerCall = /^([A-Za-z_][A-Za-z0-9_]*)\.group\((\d+)\)\.lower\(\)$/.exec(trimmed);
  if (regexGroupLowerCall !== null) {
    return `${translateExpression(regexGroupLowerCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}[${regexGroupLowerCall[2]}].toLowerCase()`;
  }

  const regexGroupCall = /^([A-Za-z_][A-Za-z0-9_]*)\.group\((\d+)\)$/.exec(trimmed);
  if (regexGroupCall !== null) {
    return `${translateExpression(regexGroupCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}[${regexGroupCall[2]}]`;
  }

  const mappingConstantSubscript = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(trimmed);
  if (mappingConstantSubscript !== null && looksLikeMappingConstantName(mappingConstantSubscript[1])) {
    const mapName = translateExpression(mappingConstantSubscript[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const key = translateMapKeyExpression(mapName, translateExpression(mappingConstantSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
    return `mapGetOrThrow(${mapName}, ${key})`;
  }

  const mappingSubscriptAttribute = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (mappingSubscriptAttribute !== null) {
    const mapName = translateExpression(mappingSubscriptAttribute[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(mapName, nameMap, mapNames) || looksLikeMappingConstantName(mappingSubscriptAttribute[1])) {
      const key = translateMapKeyExpression(mapName, translateExpression(mappingSubscriptAttribute[2], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
      return `mapGetOrThrow(${mapName}, ${key}).${tsExportNameForPythonName(mappingSubscriptAttribute[3])}`;
    }
  }

  const mapSubscript = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(trimmed);
  if (mapSubscript !== null) {
    const mapName = translateExpression(mapSubscript[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(pythonMappingNameMarker(mapSubscript[1])) || arrayNames.has(pythonMappingNameMarker(mapName))) {
      const key = translateExpression(mapSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `pythonMappingGet(${mapName}, ${key})`;
    }
    if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
      const key = translateMapKeyExpression(mapName, translateExpression(mapSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
      return `mapGetOrThrow(${mapName}, ${key})`;
    }
  }

  const typeIdentityComparison = /^type\((.+)\) is( not)? type\((.+)\)$/.exec(trimmed);
  if (typeIdentityComparison !== null) {
    const left = translateExpression(typeIdentityComparison[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(typeIdentityComparison[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `pythonTypeObject(${left}) ${typeIdentityComparison[2] === undefined ? '===' : '!=='} pythonTypeObject(${right})`;
  }

  const envComparison = /^os\.environ\.get\("([A-Za-z_][A-Za-z0-9_]*)"\) == "([^"]*)"$/.exec(trimmed);
  if (envComparison !== null) {
    return `typeof process !== 'undefined' && process.env?.${envComparison[1]} === '${envComparison[2]}'`;
  }

  const typeNameAttribute = /^type\((.+)\)\.__name__$/.exec(trimmed);
  if (typeNameAttribute !== null) {
    const value = translateExpression(typeNameAttribute[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? ((valueForType as { constructor?: { name?: string } }).constructor?.name && (valueForType as { constructor?: { name?: string } }).constructor?.name !== 'Object' ? (valueForType as { constructor: { name: string } }).constructor.name : 'dict') : typeof valueForType)(${value})`;
  }

  const typeCall = parseCallPrefix(trimmed, 'type');
  if (typeCall !== null && typeCall.rest === '') {
    return `pythonTypeObject(${translateExpression(typeCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const structUnpackPackedFloat = /^struct\.unpack\("<f", struct\.pack\("<I", (.+)\)\)\[0\]$/.exec(trimmed);
  if (structUnpackPackedFloat !== null) {
    return `(() => { _u32buf[0] = ${translateExpression(structUnpackPackedFloat[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}; return _f32buf[0]; })()`;
  }

  const boundStructFloatRoundTrip = /^_F32_UNPACK\(_F32_PACK\((.+)\)\)\[0\]$/.exec(trimmed);
  if (boundStructFloatRoundTrip !== null) {
    return `(() => { _f32buf[0] = ${translateExpression(boundStructFloatRoundTrip[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}; return _f32buf[0]; })()`;
  }

  if (trimmed === '()') {
    return '[]';
  }

  if (trimmed === 'iter(())') {
    return '[][Symbol.iterator]()';
  }

  const iterCall = parseCallPrefix(trimmed, 'iter');
  if (iterCall !== null && iterCall.rest === '') {
    const args = splitTopLevelComma(iterCall.argsText);
    if (args.length === 1) {
      const iterable = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `${tsPropertyAccessBase(iterable)}[Symbol.iterator]()`;
    }
  }

  for (const sequenceConstructor of ['list', 'tuple']) {
    const sequenceCall = parseCallPrefix(trimmed, sequenceConstructor);
    if (sequenceCall !== null && sequenceCall.rest === '') {
      const argsText = sequenceCall.argsText.trim();
      if (argsText === '') {
        return '[]';
      }
      const tupleTargetGenerator = parseTupleTargetGeneratorExpression(argsText);
      if (tupleTargetGenerator !== null) {
        return tupleTargetGeneratorExpressionToArray(tupleTargetGenerator, nameMap, arrayNames, validatedTypeAliases, mapNames);
      }
      const generator = parseSimpleGeneratorExpression(argsText);
      if (generator !== null) {
        const itemName = tsExportNameForPythonName(generator.itemName);
        const itemNameMap = new Map(nameMap);
        itemNameMap.set(generator.itemName, itemName);
        const iterable = arrayMethodIterableExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
        const filtered = generator.condition === null
          ? iterable
          : `${iterable}.filter((${itemName}) => ${translateExpression(generator.condition!, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
        return `${filtered}.map((${itemName}) => ${translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
      }
      const source = translateExpression(argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
      return expressionIsKnownMap(source, nameMap, mapNames) ? `Array.from(${source}.keys())` : `Array.from(${source})`;
    }
  }

  const rangeCall = parseCallPrefix(trimmed, 'range');
  if (rangeCall !== null && rangeCall.rest === '') {
    const rangeExpression = rangeArrayExpression(rangeCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (rangeExpression !== null) {
      return rangeExpression;
    }
  }

  const divmodCall = parseCallPrefix(trimmed, 'divmod');
  if (divmodCall !== null && divmodCall.rest === '') {
    const args = splitTopLevelComma(divmodCall.argsText);
    if (args.length === 2) {
      const value = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const divisor = translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `[Math.floor(${value} / ${divisor}), ${value} % ${divisor}]`;
    }
  }

  const nextCall = parseCallPrefix(trimmed, 'next');
  if (nextCall !== null && nextCall.rest === '') {
    const nextExpression = translateNextCall(nextCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (nextExpression !== null) {
      return nextExpression;
    }
  }

  const msgspecToBuiltinsCall = parseCallPrefix(trimmed, 'msgspec.to_builtins');
  if (msgspecToBuiltinsCall !== null && msgspecToBuiltinsCall.rest === '') {
    return `structuredClone(${translateExpression(msgspecToBuiltinsCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const structFormatCall = parseCallPrefix(trimmed, 'struct.Struct');
  if (structFormatCall !== null && structFormatCall.rest === '') {
    return `pythonStructFormat(${translateExpression(structFormatCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const structUnpackFromCall = parseCallPrefix(trimmed, 'struct.unpack_from');
  if (structUnpackFromCall !== null && (structUnpackFromCall.rest === '' || structUnpackFromCall.rest === '[0]')) {
    const args = splitTopLevelComma(structUnpackFromCall.argsText);
    if (args.length === 2 || args.length === 3) {
      const format = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const data = translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const offset = args[2] === undefined ? '' : `, ${translateExpression(args[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
      const unpacked = `pythonStructFormat(${format}).unpackFrom(${data}${offset})`;
      return structUnpackFromCall.rest === '[0]' ? `${unpacked}[0]` : unpacked;
    }
  }

  const structPackCall = parseCallPrefix(trimmed, 'struct.pack');
  if (structPackCall !== null && structPackCall.rest === '') {
    const args = splitTopLevelComma(structPackCall.argsText);
    if (args.length === 2) {
      return `pythonStructFormat(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}).pack(${translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const isinstanceCall = parseCallPrefix(trimmed, 'isinstance');
  if (isinstanceCall !== null && isinstanceCall.rest === '') {
    const args = splitTopLevelComma(isinstanceCall.argsText);
    if (args.length === 2) {
      const value = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const predicate = translateIsinstancePredicate(value, args[1].trim());
      if (predicate !== null) {
        return predicate;
      }
    }
  }
  const isinstancePath = /^isinstance\((.+), Path\)$/.exec(trimmed);
  if (isinstancePath !== null) {
    return `typeof ${translateExpression(isinstancePath[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} !== 'string'`;
  }
  const isinstanceMemoryview = /^isinstance\((.+), memoryview\)$/.exec(trimmed);
  if (isinstanceMemoryview !== null) {
    const value = translateExpression(isinstanceMemoryview[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `ArrayBuffer.isView(${value}) && !(${value} instanceof Uint8Array)`;
  }
  const isinstanceEnumMode = /^isinstance\((.+), ([A-Z][A-Za-z0-9_]*Mode)\)$/.exec(trimmed);
  if (isinstanceEnumMode !== null) {
    return `Object.values(${isinstanceEnumMode[2]}).includes(${translateExpression(isinstanceEnumMode[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} as ${isinstanceEnumMode[2]})`;
  }

  const listRepeat = /^\[(.+)\] \* (.+)$/.exec(trimmed);
  if (listRepeat !== null) {
    return `Array.from({ length: ${translateExpression(listRepeat[2], nameMap, arrayNames, validatedTypeAliases, mapNames)} }, () => ${translateExpression(listRepeat[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  const bytesRepeat = splitTopLevelMultiplicative(trimmed);
  if (bytesRepeat !== null) {
    const leftBytes = parseBytesLiteral(stripBalancedOuterParens(bytesRepeat.left));
    const rightBytes = parseBytesLiteral(stripBalancedOuterParens(bytesRepeat.right));
    if (leftBytes !== null && leftBytes.every((byte) => byte === 0)) {
      return `new Uint8Array(${translateExpression(bytesRepeat.right, nameMap, arrayNames, validatedTypeAliases, mapNames)} * ${leftBytes.length})`;
    }
    if (rightBytes !== null && rightBytes.every((byte) => byte === 0)) {
      return `new Uint8Array(${translateExpression(bytesRepeat.left, nameMap, arrayNames, validatedTypeAliases, mapNames)} * ${rightBytes.length})`;
    }
  }
  const stringRepeat = splitTopLevelMultiplicative(trimmed);
  if (stringRepeat !== null) {
    const left = stripBalancedOuterParens(stringRepeat.left);
    const right = stripBalancedOuterParens(stringRepeat.right);
    if (parsePythonStringExpression(left) !== null) {
      return `${translateExpression(left, nameMap, arrayNames, validatedTypeAliases, mapNames)}.repeat(${translateExpression(right, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
    if (parsePythonStringExpression(right) !== null) {
      return `${translateExpression(right, nameMap, arrayNames, validatedTypeAliases, mapNames)}.repeat(${translateExpression(left, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const fStringLiteral = /^f(["'])([\s\S]*)\1$/.exec(trimmed);
  if (fStringLiteral !== null) {
    return `\`${tsFStringTemplateContent(fStringLiteral[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}\``;
  }
  if (/^(["'])([\s\S]*)\1$/.test(trimmed)) {
    return tsStringLiteral(trimmed);
  }

  const strCall = parseCallPrefix(trimmed, 'str');
  if (strCall !== null) {
    const partitionCall = /^\.partition\((.+)\)$/.exec(strCall.rest);
    if (partitionCall !== null) {
      const text = translateExpression(strCall.argsText, nameMap, arrayNames, validatedTypeAliases);
      const sep = translateExpression(partitionCall[1], nameMap, arrayNames, validatedTypeAliases);
      return `(() => { const text = String(${text}); const sep = ${sep}; const index = text.indexOf(sep); return index === -1 ? [text, '', ''] : [text.slice(0, index), sep, text.slice(index + sep.length)]; })()`;
    }
  }
  if (strCall !== null && strCall.rest === '.strip().lower()') {
    return `${tsPropertyAccessBase(translateExpression(strCall.argsText, nameMap, arrayNames, validatedTypeAliases))}.trim().toLowerCase()`;
  }
  if (strCall !== null && strCall.rest === '.lower()') {
    return `String(${translateExpression(strCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)}).toLowerCase()`;
  }
  if (strCall !== null && strCall.rest === '.strip()') {
    return `${tsPropertyAccessBase(translateExpression(strCall.argsText, nameMap, arrayNames, validatedTypeAliases))}.trim()`;
  }
  if (strCall !== null && strCall.rest === '') {
    const translated = translateExpression(strCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return arrayNames.has(stringNameMarker(strCall.argsText.trim())) || arrayNames.has(stringNameMarker(translated))
      ? translated
      : `String(${translated})`;
  }

  const bytesCall = parseCallPrefix(trimmed, 'bytes');
  if (bytesCall !== null && bytesCall.rest === '') {
    if (looksLikeNumericByteLengthExpression(bytesCall.argsText.trim())) {
      return `new Uint8Array(${translateExpression(bytesCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
    return `bytesFrom(${translateExpression(bytesCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const printCall = parseCallPrefix(trimmed, 'print');
  if (printCall !== null && printCall.rest === '') {
    const args = splitTopLevelComma(printCall.argsText)
      .filter((arg) => !/^(?:flush|file|end|sep)=/.test(arg.trim()))
      .map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames));
    return `console.log(${args.join(', ')})`;
  }

  const getattrCall = parseCallPrefix(trimmed, 'getattr');
  if (getattrCall !== null && getattrCall.rest === '') {
    const args = splitTopLevelComma(getattrCall.argsText);
    if (args.length === 2 || args.length === 3) {
      const objectExpression = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const attribute = parsePythonStringExpression(args[1]);
      if (attribute !== null) {
        const fallback = args[2] === undefined
          ? null
          : translateExpression(args[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
        if (attribute.content === '__name__') {
          return fallback === null
            ? `${objectExpression}.name`
            : `${objectExpression}.name || ${fallback}`;
        }
        const property = tsStringLiteral(JSON.stringify(attribute.content));
        return fallback === null
          ? `Reflect.get((${objectExpression}) as object, ${property})`
          : `Reflect.get((${objectExpression}) as object, ${property}) ?? ${fallback}`;
      }
      const property = translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const fallback = args[2] === undefined
        ? null
        : translateExpression(args[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return fallback === null
        ? `Reflect.get((${objectExpression}) as object, ${property})`
        : `Reflect.get((${objectExpression}) as object, ${property}) ?? ${fallback}`;
    }
  }

  const setattrCall = parseCallPrefix(trimmed, 'setattr');
  if (setattrCall !== null && setattrCall.rest === '') {
    const args = splitTopLevelComma(setattrCall.argsText);
    if (args.length === 3) {
      return `Reflect.set(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(args[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const callableCall = parseCallPrefix(trimmed, 'callable');
  if (callableCall !== null && callableCall.rest === '') {
    return `typeof ${translateExpression(callableCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)} === 'function'`;
  }

  const reprCall = parseCallPrefix(trimmed, 'repr');
  if (reprCall !== null && reprCall.rest === '') {
    return `pythonRepr(${translateExpression(reprCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const castCall = parseCallPrefix(trimmed, 'cast');
  if (castCall !== null && castCall.rest === '') {
    const args = splitTopLevelComma(castCall.argsText);
    if (args.length === 2) {
      const typeText = parsePythonStringExpression(args[0])?.content ?? args[0].trim();
      const translated = translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const castType = tsCastTypeExpression(typeText);
      return castType !== null && castShouldBePreserved(typeText, castType) ? `(${translated} as ${castType})` : translated;
    }
  }

  const lenCall = parseCallPrefix(trimmed, 'len');
  if (lenCall !== null && lenCall.rest === '') {
    const value = translateExpression(lenCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(value, nameMap, mapNames)) {
      return `${value}.size`;
    }
    const fieldType = knownClassFieldType(lenCall.argsText, nameMap) ?? knownClassFieldType(value, nameMap);
    if (fieldType !== null && typeExpressionLooksMap(fieldType)) {
      return `${value}.size`;
    }
    if (arrayNames.has(setNameMarker(lenCall.argsText)) || arrayNames.has(setNameMarker(value))) {
      return `${value}.size`;
    }
    if (arrayNames.has(objectNameMarker(lenCall.argsText)) || arrayNames.has(objectNameMarker(value))) {
      return `Object.keys(${value}).length`;
    }
    if (arrayNames.has(stringNameMarker(lenCall.argsText)) || arrayNames.has(stringNameMarker(value))) {
      return `Array.from(${value}).length`;
    }
    arrayNames.add(lenCall.argsText.trim());
    arrayNames.add(value);
    return `${value}.length`;
  }

  const stringCountCall = /^(.+)\.count\((.*)\)$/.exec(trimmed);
  if (stringCountCall !== null) {
    const args = splitTopLevelComma(stringCountCall[2]);
    const value = translateExpression(stringCountCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (args.length === 1 && (arrayNames.has(stringNameMarker(stringCountCall[1])) || arrayNames.has(stringNameMarker(value)))) {
      return `pythonStringCount(${value}, ${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const intCall = parseCallPrefix(trimmed, 'int');
  if (intCall !== null && intCall.rest === '') {
    const argText = singleCallArgumentText(intCall.argsText);
    const translated = translateExpression(argText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(booleanNameMarker(argText)) || arrayNames.has(booleanNameMarker(translated)) || translatedExpressionLooksBooleanForInt(translated)) {
      return `(${translated} ? 1 : 0)`;
    }
    if (
      arrayNames.has(stringNameMarker(argText))
      || arrayNames.has(stringNameMarker(translated))
      || knownClassFieldType(argText, nameMap) === 'string'
      || knownClassFieldType(translated, nameMap) === 'string'
    ) {
      return `int(Number(${translated}))`;
    }
    return `int(${translated})`;
  }
  const floatCall = parseCallPrefix(trimmed, 'float');
  if (floatCall !== null && floatCall.rest === '') {
    const argText = singleCallArgumentText(floatCall.argsText);
    const translated = translateExpression(argText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(booleanNameMarker(argText)) || arrayNames.has(booleanNameMarker(translated)) || translatedExpressionLooksBooleanForInt(translated)) {
      return `(${translated} ? 1 : 0)`;
    }
    const numericExpression = arrayNames.has(stringNameMarker(argText)) || arrayNames.has(stringNameMarker(translated))
      ? `pythonFloat(${translated})`
      : translated;
    return splitTopLevelAdditive(numericExpression) === null ? numericExpression : `(${numericExpression})`;
  }

  const idCall = parseCallPrefix(trimmed, 'id');
  if (idCall !== null && idCall.rest === '') {
    return `pythonId(${translateExpression(idCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const roundCall = parseCallPrefix(trimmed, 'round');
  if (roundCall !== null && roundCall.rest === '') {
    const args = splitTopLevelComma(roundCall.argsText);
    if (args.length === 1) {
      return `pyRound(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  for (const [pythonName, tsName] of [['max', 'Math.max'], ['min', 'Math.min'], ['abs', 'Math.abs']] as const) {
    const builtinCall = parseCallPrefix(trimmed, pythonName);
    if (builtinCall !== null && builtinCall.rest === '') {
      const args = splitTopLevelComma(builtinCall.argsText);
      if (args.length > 0 && args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg) && parseSimpleGeneratorExpression(arg) === null)) {
        return `${tsName}(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
      }
    }
  }

  for (const primitiveName of ['float']) {
    const primitiveCall = parseCallPrefix(trimmed, primitiveName);
    if (primitiveCall !== null && primitiveCall.rest === '') {
      return translateExpression(primitiveCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    }
  }

  const setCall = parseCallPrefix(trimmed, 'set');
  if (setCall !== null && setCall.rest === '') {
    const args = splitTopLevelComma(setCall.argsText);
    if (args.length === 0) {
      return 'new Set()';
    }
    if (args.length === 1) {
      const iterable = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return expressionIsKnownMap(iterable, nameMap, mapNames) ? `new Set(${iterable}.keys())` : `new Set(${iterable})`;
    }
  }

  const dequeCall = parseCallPrefix(trimmed, 'deque');
  if (dequeCall !== null && dequeCall.rest === '') {
    const args = splitTopLevelComma(dequeCall.argsText);
    if (args.length === 0) {
      return '[]';
    }
    if (args.length === 1) {
      if (parseSimpleGeneratorExpression(args[0]) !== null) {
        return sortedIterableExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      }
      return `Array.from(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const frozenSetCall = parseCallPrefix(trimmed, 'frozenset');
  if (frozenSetCall !== null && frozenSetCall.rest === '') {
    const args = splitTopLevelComma(frozenSetCall.argsText);
    if (args.length === 0) {
      return 'new Set()';
    }
    if (args.length === 1) {
      return `new Set(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const dictCall = parseCallPrefix(trimmed, 'dict');
  if (dictCall !== null && dictCall.rest === '') {
    const args = splitTopLevelComma(dictCall.argsText);
    if (args.length === 0) {
      return '{}';
    }
    if (args.length === 1) {
      const source = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (expressionIsKnownMap(source, nameMap, mapNames)) {
        return `new Map(${source})`;
      }
      return `{ ...${source.includes(' ') ? `(${source})` : source} }`;
    }
  }

  const pathCall = parseCallPrefix(trimmed, 'Path');
  if (pathCall !== null && pathCall.rest === '') {
    return translateExpression(pathCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  if (/^Path\(__file__\)\.resolve\(\)\.parents\[\d+\]$/.test(trimmed)) {
    return "''";
  }

  const shutilWhichCall = parseCallPrefix(trimmed, 'shutil.which');
  if (shutilWhichCall !== null && shutilWhichCall.rest === '') {
    return 'null';
  }

  const subprocessCheckOutputCall = parseCallPrefix(trimmed, 'subprocess.check_output');
  if (subprocessCheckOutputCall !== null && subprocessCheckOutputCall.rest === '') {
    return 'new Uint8Array()';
  }

  if (trimmed === 'subprocess.DEVNULL') {
    return 'null';
  }

  const pathOpenCall = /^(.+)\.open\((.*)\)$/.exec(trimmed);
  if (pathOpenCall !== null) {
    const args = splitTopLevelComma(pathOpenCall[2]);
    const modeArg = args.find((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg));
    const encodingArg = args
      .map((arg) => /^encoding=(.+)$/.exec(arg))
      .find((match): match is RegExpExecArray => match !== null);
    if (modeArg !== undefined) {
      const mode = translateExpression(modeArg, nameMap, arrayNames, validatedTypeAliases, mapNames);
      const encoding = encodingArg === undefined
        ? "'utf-8'"
        : translateExpression(encodingArg[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `_openTextFile(String(${translateExpression(pathOpenCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}), { mode: ${mode}, encoding: ${encoding} })`;
    }
  }

  const earlyDictGet = /^(.+|\{[\s\S]+\})\.get\((.*)\)$/.exec(trimmed);
  if (earlyDictGet !== null && delimitersBalanced(earlyDictGet[1])) {
    const parts = splitTopLevelComma(earlyDictGet[2]);
    if (parts.length === 1 || parts.length === 2) {
      const inlineMap = translateInlineDictMapExpression(earlyDictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const mapName = inlineMap ?? translateExpression(earlyDictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const key = translateMapKeyExpression(mapName, translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
      const value = inlineMap === null && (arrayNames.has(objectNameMarker(earlyDictGet[1])) || arrayNames.has(objectNameMarker(mapName)))
        ? `${mapName}[${key}]`
        : `${mapName}.get(${key})`;
      return parts.length === 1 ? `${value} ?? null` : `${value} ?? ${translateMapDefaultExpression(parts[1], earlyDictGet[1], mapName, nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
    }
  }

  const popLeftCall = /^(.+)\.popleft\(\)$/.exec(trimmed);
  if (popLeftCall !== null) {
    return `${translateExpression(popLeftCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.shift()!`;
  }

  const dictSetdefault = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.setdefault\((.*)\)$/.exec(trimmed);
  if (dictSetdefault !== null) {
    const parts = splitTopLevelComma(dictSetdefault[2]);
    if (parts.length === 2) {
      const mapName = translateExpression(dictSetdefault[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (expressionIsKnownMap(mapName, nameMap, mapNames)) {
        const key = translateMapKeyExpression(mapName, translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
        const value = translateMapDefaultExpression(parts[1], dictSetdefault[1], mapName, nameMap, arrayNames, validatedTypeAliases, mapNames);
        return `mapGetOrInit(${mapName}, ${key}, () => ${value})`;
      }
    }
  }

  const privateDottedPositionalCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\._[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/.exec(trimmed);
  if (privateDottedPositionalCall !== null && shouldPreservePrivateDottedName(privateDottedPositionalCall[1])) {
    const args = splitTopLevelComma(privateDottedPositionalCall[2]);
    if (args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))) {
      const callee = translateIdentifierNamePreservingPrivateMembers(privateDottedPositionalCall[1], nameMap);
      return `${callee}(${args.map((arg) => translateCallArgumentExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
    }
  }

  const raylibConstructor = /^(r[dl])\.(Color|Vector2|Rectangle)\((.*)\)$/.exec(trimmed);
  if (raylibConstructor !== null) {
    const namespaceName = translateExpression(raylibConstructor[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const args = splitTopLevelComma(raylibConstructor[3]);
    if (raylibConstructor[2] === 'Color' && args.length === 4) {
      return `${namespaceName}.makeColor(${args.map((arg) => translateRaylibColorArg(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
    if (raylibConstructor[2] === 'Vector2' && args.length === 2) {
      return `${namespaceName}.makeVector2(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
    if (raylibConstructor[2] === 'Rectangle' && args.length === 1 && args[0].trim().startsWith('*')) {
      return `${namespaceName}.makeRectangle(...${translateExpression(args[0].trim().slice(1), nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
    if (raylibConstructor[2] === 'Rectangle' && args.length === 4) {
      return `${namespaceName}.makeRectangle(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
  }

  const blendFactorsSeparateCall = /^rl\.rl_set_blend_factors_separate\((.*)\)$/.exec(trimmed);
  if (blendFactorsSeparateCall !== null) {
    const args = splitTopLevelComma(blendFactorsSeparateCall[1]);
    if (args.length === 6) {
      return translatePositionalCallExpression('rl.rl_set_blend_factors_separate', args, nameMap, arrayNames, validatedTypeAliases);
    }
  }

  const tempDirPathJoin = /^Path\(tempfile\.gettempdir\(\)\) \/ "([^"\\]*)"$/.exec(trimmed);
  if (tempDirPathJoin !== null) {
    return tsStringLiteral(`"/tmp/${tempDirPathJoin[1]}"`);
  }

  const pathJoin = splitTopLevelPathJoin(trimmed);
  if (
    pathJoin !== null
    && pathJoin.parts.some((part) => {
      const translatedPart = translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames);
      return parsePythonStringExpression(part) !== null
        || /^f["']/.test(part)
        || parseCallPrefix(part, 'Path') !== null
        || arrayNames.has(pathNameMarker(part))
        || arrayNames.has(pathNameMarker(translatedPart));
    })
  ) {
    return `_pathJoin(${pathJoin.parts.map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
  }

  if (trimmed === 'Lock()') {
    return 'null';
  }

  if (trimmed === 'OrderedDict()') {
    return 'new Map()';
  }

  if (trimmed === 'Counter()') {
    return 'new Map()';
  }

  const msgpackEncoderCall = parseCallPrefix(trimmed, 'msgspec.msgpack.Encoder');
  if (msgpackEncoderCall !== null && msgpackEncoderCall.rest === '') {
    return 'new MsgpackEncoder()';
  }

  const msgpackEncodeCall = parseCallPrefix(trimmed, 'msgspec.msgpack.encode');
  if (msgpackEncodeCall !== null && msgpackEncodeCall.rest === '') {
    return `new MsgpackEncoder().encode(${translateExpression(msgpackEncodeCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const msgpackDecoderCall = parseCallPrefix(trimmed, 'msgspec.msgpack.Decoder');
  if (msgpackDecoderCall !== null && msgpackDecoderCall.rest === '') {
    const args = splitTopLevelComma(msgpackDecoderCall.argsText);
    const typeArg = args
      .map((arg) => /^type=(.+)$/.exec(arg))
      .find((match): match is RegExpExecArray => match !== null);
    const typeExpression = typeArg === undefined
      ? 'undefined'
      : translateExpression(typeArg[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const typeParameter = typeArg !== undefined && expressionCanBeTypeArgument(typeExpression) ? `<${typeExpression}>` : '';
    return `new MsgpackDecoder${typeParameter}({ type: ${typeExpression} })`;
  }

  const msgpackDecodeCall = parseCallPrefix(trimmed, 'msgspec.msgpack.decode');
  if (msgpackDecodeCall !== null && msgpackDecodeCall.rest === '') {
    const args = splitTopLevelComma(msgpackDecodeCall.argsText);
    if (args.length >= 1) {
      const typeArg = args
        .map((arg) => /^type=(.+)$/.exec(arg))
        .find((match): match is RegExpExecArray => match !== null);
      const typeExpression = typeArg === undefined
        ? 'undefined'
        : translateExpression(typeArg[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const typeParameter = typeArg !== undefined && expressionCanBeTypeArgument(typeExpression) ? `<${typeExpression}>` : '';
      return `new MsgpackDecoder${typeParameter}({ type: ${typeExpression} }).decode(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const zeroArgConstructor = /^([A-Z][A-Za-z0-9_]*)\(\)$/.exec(trimmed);
  if (zeroArgConstructor !== null) {
    return `new ${tsExportNameForPythonName(zeroArgConstructor[1])}()`;
  }
  const zeroArgTranslatedConstructor = /^([A-Za-z_][A-Za-z0-9_]*)\(\)$/.exec(trimmed);
  if (zeroArgTranslatedConstructor !== null) {
    const translatedCallee = translateIdentifierName(zeroArgTranslatedConstructor[1], nameMap);
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(translatedCallee)) {
      return `new ${translatedCallee}()`;
    }
  }

  const dictGet = /^(.+|\{[\s\S]+\})\.get\((.*)\)$/.exec(trimmed);
  if (dictGet !== null && delimitersBalanced(dictGet[1])) {
    const parts = splitTopLevelComma(dictGet[2]);
    if (parts.length === 1 || parts.length === 2) {
      const inlineMap = translateInlineDictMapExpression(dictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const mapName = inlineMap ?? translateExpression(dictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const key = translateMapKeyExpression(mapName, translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
      const value = inlineMap === null && (arrayNames.has(objectNameMarker(dictGet[1])) || arrayNames.has(objectNameMarker(mapName)))
        ? `${mapName}[${key}]`
        : `${mapName}.get(${key})`;
      return parts.length === 1 ? `${value} ?? null` : `${value} ?? ${translateMapDefaultExpression(parts[1], dictGet[1], mapName, nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
    }
  }

  const msgspecConvert = parseCallPrefix(trimmed, 'msgspec.convert');
  if (msgspecConvert !== null && msgspecConvert.rest === '') {
    const parts = splitTopLevelComma(msgspecConvert.argsText);
    const typePart = parts.find((part) => part.startsWith('type='));
    const valuePart = parts.find((part) => !part.startsWith('type='));
    if (typePart !== undefined && valuePart !== undefined) {
      const typeExpression = tsTypeExpression(typePart.slice('type='.length).trim());
      const valueExpression = translateExpression(valuePart, nameMap, arrayNames, validatedTypeAliases);
      return validatedTypeAliases.has(typeExpression)
        ? `validate${typeExpression}(${valueExpression})`
        : `${valueExpression} as ${typeExpression}`;
    }
  }

  const msgspecStructsReplace = parseCallPrefix(trimmed, 'msgspec.structs.replace');
  if (msgspecStructsReplace !== null && msgspecStructsReplace.rest === '') {
    const replacement = translateMsgspecStructsReplace(
      msgspecStructsReplace.argsText,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
    if (replacement !== null) {
      return replacement;
    }
  }

  const vectorAdditive = splitTopLevelAdditive(trimmed);
  if (
    vectorAdditive !== null
    && vectorAdditive.parts.length === 2
    && vectorAdditive.operators[0] === '+'
  ) {
    const left = translateExpression(vectorAdditive.parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(vectorAdditive.parts[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (
      (arrayNames.has(vectorAdditive.parts[0]) || arrayNames.has(left))
      && (arrayNames.has(vectorAdditive.parts[1]) || arrayNames.has(right) || right.startsWith('['))
    ) {
      return `${left}.concat(${right})`;
    }
  }
  if (
    vectorAdditive !== null
    && vectorAdditive.parts.length === 2
    && vectorAdditive.operators[0] === '+'
    && expressionIsKnownVector(vectorAdditive.parts[0], nameMap, arrayNames)
    && expressionIsKnownVector(vectorAdditive.parts[1], nameMap, arrayNames)
  ) {
    return `${translateExpression(vectorAdditive.parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}.add(${translateExpression(vectorAdditive.parts[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  if (
    vectorAdditive !== null
    && vectorAdditive.parts.length === 2
    && vectorAdditive.operators[0] === '+'
    && expressionIsVectorScale(vectorAdditive.parts[1], nameMap, arrayNames)
  ) {
    return `${translateExpression(vectorAdditive.parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}.add(${translateExpression(vectorAdditive.parts[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  if (
    vectorAdditive !== null
    && vectorAdditive.parts.length === 2
    && vectorAdditive.operators[0] === '-'
    && (expressionIsKnownVector(vectorAdditive.parts[0], nameMap, arrayNames) || expressionIsKnownVector(vectorAdditive.parts[1], nameMap, arrayNames))
  ) {
    return `${translateExpression(vectorAdditive.parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}.sub(${translateExpression(vectorAdditive.parts[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const vectorScale = splitTopLevelMultiplicative(trimmed);
  const vectorScaleContainsComparison = vectorScale !== null && (
    splitTopLevelComparisonOperators(vectorScale.left) !== null
    || splitTopLevelComparisonOperators(vectorScale.right) !== null
  );
  if (
    vectorScale !== null
    && !vectorScaleContainsComparison
    && (
      translateAggregateGeneratorCall(vectorScale.left, nameMap, arrayNames, validatedTypeAliases, mapNames) !== null
      || translateAggregateGeneratorCall(vectorScale.right, nameMap, arrayNames, validatedTypeAliases, mapNames) !== null
    )
  ) {
    return `${translateExpression(vectorScale.left, nameMap, arrayNames, validatedTypeAliases, mapNames)} * ${translateExpression(vectorScale.right, nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }
  const vectorScaleLeft = vectorScale === null ? null : stripBalancedOuterParens(vectorScale.left);
  const vectorScaleRight = vectorScale === null ? null : stripBalancedOuterParens(vectorScale.right);
  if (
    vectorScale !== null
    && !vectorScaleContainsComparison
    && vectorScaleLeft !== null
    && vectorScaleRight !== null
    && vectorScaleLeft === vectorScaleRight
    && /^[A-Za-z_][A-Za-z0-9_]*$/.test(vectorScaleLeft)
  ) {
    return `${translateExpression(vectorScaleLeft, nameMap, arrayNames, validatedTypeAliases, mapNames)} * ${translateExpression(vectorScaleRight, nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }
  if (vectorScale !== null && !vectorScaleContainsComparison && expressionIsKnownVector(vectorScale.left, nameMap, arrayNames)) {
    return `${translateExpression(vectorScale.left, nameMap, arrayNames, validatedTypeAliases, mapNames)}.mul(${translateExpression(stripBalancedOuterParens(vectorScale.right), nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const vectorDivision = splitTopLevelDivision(trimmed);
  if (
    vectorDivision !== null
    && splitTopLevelComma(vectorDivision.left).length === 1
    && splitTopLevelComma(vectorDivision.right).length === 1
    && !expressionLooksPathJoinPart(vectorDivision.left)
    && !expressionLooksPathJoinPart(vectorDivision.right)
    && expressionIsKnownVector(vectorDivision.left, nameMap, arrayNames)
  ) {
    return `${translateExpression(vectorDivision.left, nameMap, arrayNames, validatedTypeAliases, mapNames)}.div(${translateExpression(stripBalancedOuterParens(vectorDivision.right), nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const parenthesizedVectorMethod = parseParenthesizedVectorMethodCall(trimmed);
  if (parenthesizedVectorMethod !== null) {
    const receiver = translateExpression(parenthesizedVectorMethod.receiver, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownVector(parenthesizedVectorMethod.receiver, nameMap, arrayNames) || translatedExpressionLooksVector(receiver)) {
      const args = parenthesizedVectorMethod.args.some((arg) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg.trim()))
        ? translateCallArgsWithKeywordObject(parenthesizedVectorMethod.args.join(', '), nameMap, arrayNames, validatedTypeAliases, mapNames)
        : parenthesizedVectorMethod.args.map((arg) => translateCallArgumentExpression(arg, nameMap, arrayNames, validatedTypeAliases));
      return `${receiver}.${tsExportNameForPythonName(parenthesizedVectorMethod.method)}(${args.join(', ')})`;
    }
  }

  const multiplicativeWithFloorDivision = splitTopLevelMultiplicative(trimmed);
  if (
    multiplicativeWithFloorDivision !== null
    && (multiplicativeWithFloorDivision.left.includes(' // ') || multiplicativeWithFloorDivision.right.includes(' // '))
  ) {
    return `${translateExpression(stripBalancedOuterParens(multiplicativeWithFloorDivision.left), nameMap, arrayNames, validatedTypeAliases, mapNames)} * ${translateExpression(stripBalancedOuterParens(multiplicativeWithFloorDivision.right), nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }
  if (
    multiplicativeWithFloorDivision !== null
    && (
      parseTopLevelConditionalExpression(stripBalancedOuterParens(multiplicativeWithFloorDivision.left)) !== null
      || parseTopLevelConditionalExpression(stripBalancedOuterParens(multiplicativeWithFloorDivision.right)) !== null
    )
  ) {
    const left = translateExpression(stripBalancedOuterParens(multiplicativeWithFloorDivision.left), nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(stripBalancedOuterParens(multiplicativeWithFloorDivision.right), nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `${parenthesizeForMultiplicative(left)} * ${parenthesizeForMultiplicative(right)}`;
  }
  const parenthesizedMultiplicativeLeft = multiplicativeWithFloorDivision === null ? null : stripBalancedOuterParens(multiplicativeWithFloorDivision.left);
  const parenthesizedMultiplicativeRight = multiplicativeWithFloorDivision === null ? null : stripBalancedOuterParens(multiplicativeWithFloorDivision.right);
  if (
    multiplicativeWithFloorDivision !== null
    && !vectorScaleContainsComparison
    && (
      parenthesizedMultiplicativeLeft !== multiplicativeWithFloorDivision.left
      || parenthesizedMultiplicativeRight !== multiplicativeWithFloorDivision.right
    )
  ) {
    const leftWasParenthesized = parenthesizedMultiplicativeLeft !== multiplicativeWithFloorDivision.left;
    const rightWasParenthesized = parenthesizedMultiplicativeRight !== multiplicativeWithFloorDivision.right;
    const left = translateExpression(parenthesizedMultiplicativeLeft ?? multiplicativeWithFloorDivision.left, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(parenthesizedMultiplicativeRight ?? multiplicativeWithFloorDivision.right, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `${leftWasParenthesized ? `(${left})` : parenthesizeForMultiplicative(left)} * ${rightWasParenthesized ? `(${right})` : parenthesizeForMultiplicative(right)}`;
  }
  if (
    multiplicativeWithFloorDivision !== null
    && !vectorScaleContainsComparison
    && splitTopLevelAdditive(trimmed) === null
    && splitTopLevelComma(trimmed).length === 1
  ) {
    const leftRaw = multiplicativeWithFloorDivision.left;
    const rightRaw = multiplicativeWithFloorDivision.right;
    const left = translateExpression(leftRaw, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(rightRaw, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (left !== leftRaw || right !== rightRaw) {
      return `${parenthesizeTranslatedMultiplicativeOperand(leftRaw, left)} * ${parenthesizeTranslatedMultiplicativeOperand(rightRaw, right)}`;
    }
  }
  const divisionWithConditional = splitTopLevelDivision(trimmed);
  if (
    divisionWithConditional !== null
    && splitTopLevelComma(divisionWithConditional.left).length === 1
    && splitTopLevelComma(divisionWithConditional.right).length === 1
    && (
      parseTopLevelConditionalExpression(stripBalancedOuterParens(divisionWithConditional.left)) !== null
      || parseTopLevelConditionalExpression(stripBalancedOuterParens(divisionWithConditional.right)) !== null
    )
  ) {
    const left = translateExpression(divisionWithConditional.left, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(divisionWithConditional.right, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `${parenthesizeForMultiplicative(left)} / ${parenthesizeForMultiplicative(right)}`;
  }
  if (
    divisionWithConditional !== null
    && splitTopLevelComma(divisionWithConditional.left).length === 1
    && splitTopLevelComma(divisionWithConditional.right).length === 1
    && !expressionLooksPathJoinPart(divisionWithConditional.left)
    && !expressionLooksPathJoinPart(divisionWithConditional.right)
  ) {
    const left = translateExpression(divisionWithConditional.left, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(divisionWithConditional.right, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `${parenthesizeForMultiplicative(left)} / ${parenthesizeForMultiplicative(right)}`;
  }

  const vectorSubMethod = /^\((.+) - (.+)\)\.to_heading\(\)$/.exec(trimmed);
  if (vectorSubMethod !== null) {
    return `${translateExpression(vectorSubMethod[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.sub(${translateExpression(vectorSubMethod[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}).toHeading()`;
  }
  const vectorSubLengthMethod = /^\((.+) - (.+)\)\.length\(\)$/.exec(trimmed);
  if (vectorSubLengthMethod !== null) {
    return `${translateExpression(vectorSubLengthMethod[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.sub(${translateExpression(vectorSubLengthMethod[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}).length()`;
  }

  if (
    vectorAdditive !== null
    && vectorAdditive.parts.length === 2
    && /^\(.+ - .+\)\.length\(\)$/.test(vectorAdditive.parts[0])
  ) {
    return `${translateExpression(vectorAdditive.parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames)} ${vectorAdditive.operators[0]} ${translateExpression(vectorAdditive.parts[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const unaryNegativeCall = /^-([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?\(.+\))$/.exec(trimmed);
  if (unaryNegativeCall !== null && delimitersBalanced(unaryNegativeCall[1])) {
    return `-${parenthesizeForMultiplicative(translateExpression(unaryNegativeCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames))}`;
  }

  const mixedKeywordCall = translateMixedKeywordCall(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (mixedKeywordCall !== null) {
    return mixedKeywordCall;
  }
  const complexKeywordMethodCall = translateComplexKeywordMethodCall(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (complexKeywordMethodCall !== null) {
    return complexKeywordMethodCall;
  }
  const mixedKeywordCallWithRest = translateMixedKeywordCallWithRest(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (mixedKeywordCallWithRest !== null) {
    return mixedKeywordCallWithRest;
  }

  const enumModeConditional = /^(.+) if isinstance\((.+), ([A-Z][A-Za-z0-9_]*Mode)\) else ([A-Z][A-Za-z0-9_]*Mode)\((.+)\)$/.exec(trimmed);
  if (enumModeConditional !== null && enumModeConditional[3] === enumModeConditional[4]) {
    const enumName = enumModeConditional[3];
    const conditionValue = translateExpression(enumModeConditional[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `Object.values(${enumName}).includes(${conditionValue} as ${enumName}) ? ${translateExpression(enumModeConditional[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} as ${enumName} : ${translateExpression(`${enumName}(${enumModeConditional[5]})`, nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const conditionalExpression = parseTopLevelConditionalExpression(trimmed);
  if (conditionalExpression !== null) {
    return [
      translateConditionalTestExpression(conditionalExpression.condition, nameMap, arrayNames, validatedTypeAliases, mapNames),
      '?',
      translateExpression(conditionalExpression.trueExpression, nameMap, arrayNames, validatedTypeAliases, mapNames),
      ':',
      translateExpression(conditionalExpression.falseExpression, nameMap, arrayNames, validatedTypeAliases, mapNames),
    ].join(' ');
  }

  if (trimmed.startsWith('(') && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    const inner = trimmed.slice(1, -1).trim();
    if (splitTopLevelComma(inner).length === 1 && (inner.includes(' and ') || inner.includes(' or ') || /\[[^\]]*:[^\]]*\]/.test(inner))) {
      return `(${translateExpression(inner, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const topLevelOrParts = splitTopLevelLogicalOperator(trimmed, 'or');
  if (topLevelOrParts !== null) {
    const translatedParts = topLevelOrParts
      .map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
    if (translatedParts.length === 2 && translatedParts[0].startsWith('pythonSplitlines(')) {
      return `(() => { const value = ${translatedParts[0]}; return value.length > 0 ? value : ${translatedParts[1]}; })()`;
    }
    if (
      topLevelOrParts.length === 2
      && topLevelOrParts[1].trim() === '{}'
      && expressionIsKnownMap(translatedParts[0], nameMap, mapNames)
    ) {
      return `${translatedParts[0]} ?? new Map()`;
    }
    return translatedParts.map(parenthesizeForLogicalOr).join(' || ');
  }

  const topLevelAndParts = splitTopLevelLogicalOperator(trimmed, 'and');
  if (topLevelAndParts !== null) {
    return topLevelAndParts
      .map((part) => parenthesizeForLogicalAnd(translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)))
      .join(' && ');
  }

  const parenthesizedNotExpression = /^\((not .*)\)$/.exec(trimmed);
  if (parenthesizedNotExpression !== null && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    return translateExpression(parenthesizedNotExpression[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const notIdentifier = /^not ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (notIdentifier !== null) {
    const value = translateExpression(notIdentifier[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(value, nameMap, mapNames)) {
      return arrayNames.has(nullableNameMarker(notIdentifier[1])) || arrayNames.has(nullableNameMarker(value))
        ? `${value} === null || ${value}.size === 0`
        : `${value}.size === 0`;
    }
    if (arrayNames.has(notIdentifier[1]) || arrayNames.has(value)) {
      return arrayNames.has(nullableNameMarker(notIdentifier[1])) || arrayNames.has(nullableNameMarker(value))
        ? `${value} === null || ${value}.length === 0`
        : `${value}.length === 0`;
    }
    return `!${value}`;
  }

  const notPlayersCollection = /^not ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.players)$/.exec(trimmed);
  if (notPlayersCollection !== null) {
    return `${translateExpression(notPlayersCollection[1], nameMap, arrayNames, validatedTypeAliases)}.length === 0`;
  }

  const notExpression = /^not (.+)$/.exec(trimmed);
  if (notExpression !== null) {
    const operand = stripBalancedOuterParens(notExpression[1]);
    const value = translateExpression(operand, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownMap(value, nameMap, mapNames)) {
      return arrayNames.has(nullableNameMarker(operand)) || arrayNames.has(nullableNameMarker(value))
        ? `${value} === null || ${value}.size === 0`
        : `${value}.size === 0`;
    }
    if (arrayNames.has(operand) || arrayNames.has(value)) {
      return arrayNames.has(nullableNameMarker(operand)) || arrayNames.has(nullableNameMarker(value))
        ? `${value} === null || ${value}.length === 0`
        : `${value}.length === 0`;
    }
    if (/^[A-Za-z_$][A-Za-z0-9_.$]*\(.*\)$/.test(value)) {
      return `!${value}`;
    }
    const dottedField = /^(.+)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(operand);
    if (dottedField !== null) {
      const receiver = translateExpression(dottedField[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const receiverType = nameMap.get(receiverTypeNameMarker(dottedField[1])) ?? nameMap.get(receiverTypeNameMarker(receiver));
      const fieldName = tsMemberNameForPythonName(dottedField[2]);
      const fieldType = receiverType === undefined ? undefined : nameMap.get(classFieldTypeMarker(receiverType, fieldName));
      if (fieldType?.endsWith('[]') === true || fieldType?.startsWith('readonly ') === true && fieldType.endsWith('[]')) {
        return `${value}.length === 0`;
      }
      if (fieldType?.startsWith('Set<') === true || fieldType?.startsWith('ReadonlySet<') === true) {
        return `${value}.size === 0`;
      }
      if (fieldType?.startsWith('Map<') === true || fieldType?.startsWith('ReadonlyMap<') === true) {
        return `${value}.size === 0`;
      }
    }
    return /^[A-Za-z_$][A-Za-z0-9_.$()[\]]*$/.test(value) ? `!${value}` : `!(${value})`;
  }

  const lowerBoundLengthComparison = /^(.+?) <= (.+?) < len\((.+)\)$/.exec(trimmed);
  if (lowerBoundLengthComparison !== null) {
    const value = translateExpression(lowerBoundLengthComparison[2], nameMap, arrayNames, validatedTypeAliases);
    return `${value} >= ${translateExpression(lowerBoundLengthComparison[1], nameMap, arrayNames, validatedTypeAliases)} && ${value} < ${translateExpression(lowerBoundLengthComparison[3], nameMap, arrayNames, validatedTypeAliases)}.length`;
  }

  const chainedComparison = translateChainedComparison(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (chainedComparison !== null) {
    return chainedComparison;
  }

  const chainedLessEqualComparison = /^(.+?) <= (.+?) <= (.+)$/.exec(trimmed);
  if (chainedLessEqualComparison !== null) {
    const middle = translateExpression(chainedLessEqualComparison[2], nameMap, arrayNames, validatedTypeAliases);
    return `${translateExpression(chainedLessEqualComparison[1], nameMap, arrayNames, validatedTypeAliases)} <= ${middle} && ${middle} <= ${translateExpression(chainedLessEqualComparison[3], nameMap, arrayNames, validatedTypeAliases)}`;
  }

  const chainedLessComparison = /^(.+?) < (.+?) < (.+)$/.exec(trimmed);
  if (chainedLessComparison !== null) {
    const middle = translateExpression(chainedLessComparison[2], nameMap, arrayNames, validatedTypeAliases);
    return `${translateExpression(chainedLessComparison[1], nameMap, arrayNames, validatedTypeAliases)} < ${middle} && ${middle} < ${translateExpression(chainedLessComparison[3], nameMap, arrayNames, validatedTypeAliases)}`;
  }

  const notInTuple = /^(.+?) not in \((.*)\)$/.exec(trimmed);
  if (notInTuple !== null) {
    const value = translateExpression(notInTuple[1], nameMap, arrayNames, validatedTypeAliases);
    return splitTopLevelComma(notInTuple[2])
      .map((item) => `${value} !== ${translateExpression(item, nameMap, arrayNames, validatedTypeAliases)}`)
      .join(' && ');
  }

  const inTuple = /^(.+?) in \((.*)\)$/.exec(trimmed);
  if (inTuple !== null) {
    const value = translateExpression(inTuple[1], nameMap, arrayNames, validatedTypeAliases);
    return splitTopLevelComma(inTuple[2])
      .map((item) => `${value} === ${translateExpression(item, nameMap, arrayNames, validatedTypeAliases)}`)
      .join(' || ');
  }

  const notInSet = /^(.+?) not in \{(.*)\}$/.exec(trimmed);
  if (notInSet !== null) {
    const value = translateExpression(notInSet[1], nameMap, arrayNames, validatedTypeAliases);
    return splitTopLevelComma(notInSet[2])
      .map((item) => `${value} !== ${translateExpression(item, nameMap, arrayNames, validatedTypeAliases)}`)
      .join(' && ');
  }

  const inSet = /^(.+?) in \{(.*)\}$/.exec(trimmed);
  if (inSet !== null) {
    const value = translateExpression(inSet[1], nameMap, arrayNames, validatedTypeAliases);
    return splitTopLevelComma(inSet[2])
      .map((item) => `${value} === ${translateExpression(item, nameMap, arrayNames, validatedTypeAliases)}`)
      .join(' || ');
  }

  const tupleLiteral = /^\((.*)\)$/.exec(trimmed);
  if (tupleLiteral !== null && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    const tupleParts = splitTopLevelComma(tupleLiteral[1]);
    if (tupleParts.length === 1) {
      return `(${translateExpression(tupleLiteral[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
    const values = tupleParts
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => (part.startsWith('*')
        ? `...${translateExpression(part.slice(1), nameMap, arrayNames, validatedTypeAliases, mapNames)}`
        : translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)));
    const expression = `[${values.join(', ')}]`;
    return translatedItemsLookLikeLabelTupleArray(values) ? `${expression} as const` : expression;
  }

  const topLevelTupleParts = splitTopLevelComma(trimmed);
  if (topLevelTupleParts.length > 1) {
    const values = topLevelTupleParts.map((part) => {
      const stripped = part.trim();
      return stripped.startsWith('*')
        ? `...${translateExpression(stripped.slice(1), nameMap, arrayNames, validatedTypeAliases, mapNames)}`
        : translateExpression(stripped, nameMap, arrayNames, validatedTypeAliases, mapNames);
    });
    const expression = `[${values.join(', ')}]`;
    return translatedItemsLookLikeLabelTupleArray(values) ? `${expression} as const` : expression;
  }

  const earlyFullSlice = /^(.+)\[(.*):(.*)\]$/.exec(trimmed);
  if (earlyFullSlice !== null && splitTopLevelSpacedOperator(trimmed, 'in') === null) {
    const receiver = translateExpression(earlyFullSlice[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const start = earlyFullSlice[2].trim() === ''
      ? '0'
      : translateExpression(earlyFullSlice[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const end = earlyFullSlice[3].trim() === ''
      ? undefined
      : translateExpression(earlyFullSlice[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return end === undefined ? `${receiver}.slice(${start})` : `${receiver}.slice(${start}, ${end})`;
  }

  const slicedNotMembership = /^(.+?) not in (.+\[[^\]]*:[^\]]*\])$/.exec(trimmed);
  if (slicedNotMembership !== null) {
    const container = translateExpression(slicedNotMembership[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const value = translateExpression(slicedNotMembership[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return container.includes('.slice(')
      ? `!${container}.includes(${value})`
      : `!${pythonContainsExpression(container, value)}`;
  }

  const slicedMembership = /^(.+?) in (.+\[[^\]]*:[^\]]*\])$/.exec(trimmed);
  if (slicedMembership !== null) {
    const container = translateExpression(slicedMembership[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const value = translateExpression(slicedMembership[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return container.includes('.slice(')
      ? `${container}.includes(${value})`
      : pythonContainsExpression(container, value);
  }

  const parenthesizedLeftFloorDivision = splitTopLevelFloorDivision(trimmed);
  if (
    parenthesizedLeftFloorDivision !== null
    && parenthesizedLeftFloorDivision.left.trim().startsWith('(')
  ) {
    return `Math.floor(${translateExpression(parenthesizedLeftFloorDivision.left, nameMap, arrayNames, validatedTypeAliases, mapNames)} / ${translateExpression(parenthesizedLeftFloorDivision.right, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const additiveWithAggregateGenerator = splitTopLevelAdditive(trimmed);
  if (
    additiveWithAggregateGenerator !== null
    && additiveWithAggregateGenerator.parts.some((part) => (
      translateAggregateGeneratorCall(part, nameMap, arrayNames, validatedTypeAliases, mapNames) !== null
    ))
  ) {
    return joinTranslatedAdditive(additiveWithAggregateGenerator, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const additiveWithHighPrecedenceOperator = splitTopLevelAdditive(trimmed);
  if (
    additiveWithHighPrecedenceOperator !== null
    && additiveWithHighPrecedenceOperator.parts.some((part) => part.includes(' // ') || part.includes(' >> '))
  ) {
    return joinTranslatedAdditive(additiveWithHighPrecedenceOperator, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const additive = splitTopLevelAdditive(trimmed);
  if (additive !== null) {
    return joinTranslatedAdditive(additive, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const uint32Mask = /^(.+) & 0xFFFFFFFF$/i.exec(trimmed);
  if (uint32Mask !== null) {
    return `(${translateExpression(uint32Mask[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} >>> 0)`;
  }

  const bitwiseAnd = splitTopLevelSpacedOperator(trimmed, '&');
  if (bitwiseAnd !== null) {
    return `${translateExpression(stripBalancedOuterParens(bitwiseAnd.left), nameMap, arrayNames, validatedTypeAliases, mapNames)} & ${translateExpression(stripBalancedOuterParens(bitwiseAnd.right), nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const withoutOuterParens = stripBalancedOuterParens(trimmed);
  if (withoutOuterParens !== trimmed && withoutOuterParens.includes(' >> ')) {
    return translateExpression(withoutOuterParens, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const rightShift = /^(.+) >> (.+)$/.exec(trimmed);
  if (rightShift !== null) {
    return `Math.floor(${translateExpression(rightShift[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} / (2 ** ${translateExpression(rightShift[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}))`;
  }

  const modulo = splitTopLevelModulo(trimmed);
  if (modulo !== null) {
    const stringFormat = translatePythonPercentStringFormat(modulo.left, modulo.right, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (stringFormat !== null) {
      return stringFormat;
    }
    const left = parenthesizeForModulo(translateExpression(stripBalancedOuterParens(modulo.left), nameMap, arrayNames, validatedTypeAliases, mapNames));
    const right = parenthesizeForModulo(translateExpression(stripBalancedOuterParens(modulo.right), nameMap, arrayNames, validatedTypeAliases, mapNames));
    return modulo.left.includes(' - ') || modulo.left.includes(' + ') ? `(${left} + ${right}) % ${right}` : `${left} % ${right}`;
  }

  const floorDivision = splitTopLevelFloorDivision(trimmed);
  if (floorDivision !== null) {
    return `Math.floor(${translateExpression(floorDivision.left, nameMap, arrayNames, validatedTypeAliases, mapNames)} / ${translateExpression(floorDivision.right, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const identityComparison = /^(.+?) is( not)? (.+)$/.exec(trimmed);
  if (identityComparison !== null) {
    return `${translateExpression(identityComparison[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} ${identityComparison[2] === undefined ? '===' : '!=='} ${translateExpression(identityComparison[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const topLevelComparison = splitTopLevelComparisonOperators(trimmed);
  if (topLevelComparison !== null && topLevelComparison.operators.length === 1) {
    const left = translateExpression(topLevelComparison.parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(topLevelComparison.parts[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return translateComparisonClause(left, topLevelComparison.operators[0], right, arrayNames, nameMap);
  }

  const negativeIndexAttribute = /^(.+)\[-(\d+)\]\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (negativeIndexAttribute !== null) {
    const receiver = translateExpression(negativeIndexAttribute[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `${receiver}[${receiver}.length - ${negativeIndexAttribute[2]}].${tsExportNameForPythonName(negativeIndexAttribute[3])}`;
  }

  const negativeIndex = /^(.+)\[-(\d+)\]$/.exec(trimmed);
  if (negativeIndex !== null) {
    const receiver = translateExpression(negativeIndex[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `${receiver}[${receiver}.length - ${negativeIndex[2]}]`;
  }

  const simpleSubscript = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(trimmed);
  if (simpleSubscript !== null && !hasTopLevelColon(simpleSubscript[2])) {
    const receiver = translateExpression(simpleSubscript[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const key = translateExpression(simpleSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return expressionIsKnownMap(receiver, nameMap, mapNames)
      ? `${receiver}.get(${translateMapKeyExpression(receiver, key, mapNames)})!`
      : `${receiver}[${key}]`;
  }

  const fullSlice = /^(.+)\[(.*):(.*)\]$/.exec(trimmed);
  if (fullSlice !== null) {
    const receiver = translateExpression(fullSlice[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const start = fullSlice[2].trim() === ''
      ? '0'
      : translateExpression(fullSlice[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const end = fullSlice[3].trim() === ''
      ? undefined
      : translateExpression(fullSlice[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return end === undefined ? `${receiver}.slice(${start})` : `${receiver}.slice(${start}, ${end})`;
  }

  const prefixSlice = /^(.+)\[:(.+)\]$/.exec(trimmed);
  if (prefixSlice !== null) {
    return `${translateExpression(prefixSlice[1], nameMap, arrayNames, validatedTypeAliases)}.slice(0, ${translateExpression(prefixSlice[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const openEndedSlice = /^(.+)\[(.+):\]$/.exec(trimmed);
  if (openEndedSlice !== null) {
    return `${translateExpression(openEndedSlice[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.slice(${translateExpression(openEndedSlice[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const enumIdCast = /^([A-Z][A-Za-z0-9_]*(?:Id|Type|Flags))\((.+)\)$/.exec(trimmed);
  if (enumIdCast !== null) {
    return translateExpression(enumIdCast[2], nameMap, arrayNames, validatedTypeAliases);
  }

  const enumModeCast = /^([A-Z][A-Za-z0-9_]*Mode)\((.+)\)$/.exec(trimmed);
  if (enumModeCast !== null) {
    const enumName = enumModeCast[1];
    const value = translateExpression(enumModeCast[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `(() => { const value = ${value}; if (!Object.values(${enumName}).includes(value as ${enumName})) { throw new Error('invalid ${enumName}'); } return value as ${enumName}; })()`;
  }

  const privatePositionalConstructor = /^_([A-Z][A-Za-z0-9_]*)\((.*)\)$/.exec(trimmed);
  if (privatePositionalConstructor !== null) {
    const args = splitTopLevelComma(privatePositionalConstructor[2]);
    if (args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))) {
      return `new ${tsExportNameForPythonName(`_${privatePositionalConstructor[1]}`)}(${args.map((arg) => translateCallArgumentExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
    }
  }

  const positionalConstructor = /^([A-Z][A-Za-z0-9_]*)\((.*)\)$/.exec(trimmed);
  if (positionalConstructor !== null) {
    const args = splitTopLevelComma(positionalConstructor[2]);
    if (args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))) {
      if (positionalConstructor[1] === 'String') {
        return `String(${args.map((arg) => translateCallArgumentExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
      }
      return `new ${tsExportNameForPythonName(positionalConstructor[1])}(${args.map((arg) => translateCallArgumentExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
    }
  }

  const simplePositionalCall = parseSimplePositionalCall(trimmed);
  if (
    simplePositionalCall !== null
    && simplePositionalCall.args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))
    && simplePositionalCall.args.some((arg) => expressionContainsKnownDateAttribute(arg, nameMap, arrayNames, validatedTypeAliases, mapNames))
  ) {
    return translatePositionalCallExpression(
      simplePositionalCall.callee,
      simplePositionalCall.args,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
      true,
    );
  }
  if (
    simplePositionalCall !== null
    && simplePositionalCall.args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))
    && !(simplePositionalCall.args.length === 0 && simplePositionalCall.callee.includes('.'))
  ) {
    return translatePositionalCallExpression(
      simplePositionalCall.callee,
      simplePositionalCall.args,
      nameMap,
      arrayNames,
      validatedTypeAliases,
      mapNames,
    );
  }

  const withoutPrimitiveWrappers = stripPrimitiveCallWrappers(trimmed);
  if (withoutPrimitiveWrappers !== trimmed) {
    return translateExpression(withoutPrimitiveWrappers, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const stringLiterals: string[] = [];
  const masked = trimmed.replaceAll(
    /[fF]?"[^"\\]*(?:\\.[^"\\]*)*"|[fF]?'[^'\\]*(?:\\.[^'\\]*)*'/g,
    (literal) => {
      const placeholder = `__CRIMSON_STRING_${stringLiterals.length}__`;
      stringLiterals.push(/^[fF]/.test(literal) ? translateExpression(literal, nameMap, arrayNames, validatedTypeAliases, mapNames) : tsStringLiteral(literal));
      return placeholder;
    },
  );

  const translated = masked
    .trim()
    .replaceAll(
      /\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(([A-Za-z_][A-Za-z0-9_]*)=([^(),]+)\)/g,
      (_match, callee: string, argName: string, argValue: string) => (
        `${translateExpression(callee, nameMap, arrayNames, validatedTypeAliases)}({ ${tsExportNameForPythonName(argName)}: ${translateExpression(argValue, nameMap, arrayNames, validatedTypeAliases)} })`
      ),
    )
    .replaceAll(/\b[A-Z][A-Za-z0-9_]*Id\(([^()]*)\)/g, (_match, value: string) => translateExpression(value, nameMap, arrayNames, validatedTypeAliases, mapNames))
    .replaceAll(/\b(?:list|tuple)\(([^()]*)\)/g, 'Array.from($1)')
    .replaceAll(/\b(?:float|str|bool)\(([^()]*)\)/g, '$1')
    .replaceAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([rgba])\b/g, (_match, name: string, channel: string) => {
      const translatedName = translateExpression(name, nameMap, arrayNames, validatedTypeAliases, mapNames);
      return arrayNames.has(colorNameMarker(name)) || arrayNames.has(colorNameMarker(translatedName))
        ? `(${translatedName}.${channel} * 255)`
        : _match;
    })
    .replaceAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.count\(([^()]*)\)/g, (_match, name: string, countArgsText: string) => {
      const translatedName = translateExpression(name, nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (!arrayNames.has(stringNameMarker(name)) && !arrayNames.has(stringNameMarker(translatedName))) {
        return _match;
      }
      const countArgs = splitTopLevelComma(countArgsText);
      if (countArgs.length !== 1) {
        return _match;
      }
      return `pythonStringCount(${translatedName}, ${translateExpression(countArgs[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    })
    .replaceAll(/\blen\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, (_match, name: string) => {
      const translatedName = translateExpression(name, nameMap, arrayNames, validatedTypeAliases, mapNames);
      if (arrayNames.has(setNameMarker(name)) || arrayNames.has(setNameMarker(translatedName))) {
        return `${translatedName}.size`;
      }
      if (expressionIsKnownMap(translatedName, nameMap, mapNames)) {
        return `${translatedName}.size`;
      }
      return arrayNames.has(stringNameMarker(name)) || arrayNames.has(stringNameMarker(translatedName))
        ? `Array.from(${translatedName}).length`
        : `${translatedName}.length`;
    })
    .replaceAll(/\.append\(/g, '.push(')
    .replaceAll(/\.extend\(/g, '.push(...')
    .replaceAll(/\.index\(/g, '.indexOf(')
    .replaceAll(/\bstr\(/g, 'String(')
    .replaceAll(/\.strip\(\)/g, '.trim()')
    .replaceAll(/\.lower\(\)/g, '.toLowerCase()')
    .replaceAll(/\bmath\.pi\b/g, 'Math.PI')
    .replaceAll(/\bmath\.tau\b/g, '(Math.PI * 2.0)')
    .replaceAll(/\bmath\.sqrt\(/g, 'Math.sqrt(')
    .replaceAll(/\bmath\.floor\(/g, 'Math.floor(')
    .replaceAll(/\bmath\.ceil\(/g, 'Math.ceil(')
    .replaceAll(/\bmath\.trunc\(/g, 'Math.trunc(')
    .replaceAll(/\bmath\.pow\(/g, 'Math.pow(')
    .replaceAll(/\bmath\.cos\(/g, 'Math.cos(')
    .replaceAll(/\bmath\.sin\(/g, 'Math.sin(')
    .replaceAll(/\bmath\.atan2\(/g, 'Math.atan2(')
    .replaceAll(/ is not None\b/g, ' !== null')
    .replaceAll(/ is None\b/g, ' === null')
    .replaceAll(/ == /g, ' === ')
    .replaceAll(/ != /g, ' !== ')
    .replaceAll(/\bmin\(/g, 'Math.min(')
    .replaceAll(/\bmax\(/g, 'Math.max(')
    .replaceAll(/\babs\(/g, 'Math.abs(')
    .replaceAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (name, offset: number, fullText: string) => {
      if (name === 'True') {
        return 'true';
      }
      if (name === 'False') {
        return 'false';
      }
      if (name === 'None') {
        return 'null';
      }
      if (/^__CRIMSON_STRING_\d+__$/.test(name)) {
        return name;
      }
      if (fullText[offset - 1] === '.') {
        return translatedDottedTokenMember(fullText, offset, name, nameMap) ?? tsMemberNameForPythonName(name);
      }
      if (name.startsWith('_') && shouldPreservePrivateDottedToken(fullText, offset, name)) {
        return translatedDottedTokenMember(fullText, offset, name, nameMap) ?? tsMemberNameForPythonName(name);
      }
      return translateIdentifierName(name, nameMap);
    });
  return replaceKnownRectangleDimensions(
    replaceTranslatedRaylibConstructors(translated)
    .replaceAll(/__CRIMSON_STRING_(\d+)__/g, (_match, index: string) => stringLiterals[Number(index)] ?? _match)
    .replaceAll(/\.BLEND_CUSTOM_SEPARATE\b/g, '.CUSTOM')
    .replaceAll(/\.BLEND_CUSTOM\b/g, '.CUSTOM')
    .replaceAll(/\.BLEND_ADDITIVE\b/g, '.ADDITIVE')
    .replaceAll(/\.BLEND_ALPHA\b/g, '.ALPHA')
    .replaceAll(/\.BLEND_MULTIPLIED\b/g, '.MULTIPLY')
    .replaceAll(/\.BLEND_NONE\b/g, '.NONE')
    .replaceAll(/\.TEXTURE_FILTER_POINT\b/g, '.POINT')
    .replaceAll(/\.TEXTURE_FILTER_BILINEAR\b/g, '.BILINEAR')
    .replaceAll(/\.TEXTURE_WRAP_REPEAT\b/g, '.REPEAT')
    .replaceAll(/\.TEXTURE_WRAP_CLAMP\b/g, '.CLAMP'),
    arrayNames,
  );
}

function replaceKnownRectangleDimensions(tsExpression: string, arrayNames: Set<string>): string {
  return tsExpression.replaceAll(
    /\b([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\.(width|height)\b/g,
    (match, receiver: string, dimension: string) => {
      if (!arrayNames.has(rectangleNameMarker(receiver))) {
        return match;
      }
      return `${receiver}.${dimension === 'width' ? 'w' : 'h'}`;
    },
  );
}

function looksLikeMappingConstantName(pythonName: string): boolean {
  const finalName = pythonName.split('.').at(-1) ?? pythonName;
  return /^[A-Z][A-Z0-9_]*_BY_[A-Z0-9_]+$/.test(finalName);
}

function shouldPreservePrivateDottedName(pythonName: string): boolean {
  return pythonName.includes('._');
}

function shouldPreservePrivateDottedToken(fullText: string, offset: number, name: string): boolean {
  if (fullText[offset - 1] !== '.') {
    return false;
  }
  const beforeMember = fullText.slice(0, offset - 1);
  const receiverMatch = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.exec(beforeMember);
  if (receiverMatch === null) {
    return false;
  }
  return shouldPreservePrivateDottedName(`${receiverMatch[0]}.${name}`);
}

function menuViewHelperName(pythonExpression: string): string | null {
  const menuViewHelper = /^MenuView\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonExpression);
  if (menuViewHelper === null) {
    return null;
  }
  switch (menuViewHelper[1]) {
    case '_ui_element_anim':
      return 'uiElementAnim';
    case '_label_alpha':
      return 'labelAlpha';
    case '_sign_layout_scale':
      return 'signLayoutScale';
    case '_draw_ui_quad_shadow':
      return 'drawUiQuadShadow';
    case '_menu_slot_pos_x':
      return 'menuSlotPosX';
    case '_menu_slot_start_ms':
      return 'menuSlotStartMs';
    case '_menu_slot_end_ms':
      return 'menuSlotEndMs';
    default:
      return null;
  }
}

function translateCallArgsWithKeywordObject(
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string[] {
  const args = splitTopLevelComma(argsText).filter((arg) => arg !== '');
  const positionalArgs: string[] = [];
  const keywordArgs: string[] = [];
  for (const arg of args) {
    const keywordArg = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg);
    if (keywordArg === null) {
      positionalArgs.push(translateCallArgumentExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames));
      continue;
    }
    keywordArgs.push(`${tsExportNameForPythonName(keywordArg[1])}: ${translateExpression(keywordArg[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
  }
  return keywordArgs.length === 0
    ? positionalArgs
    : [...positionalArgs, `{ ${keywordArgs.join(', ')} }`];
}

function translateChainedComparison(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const comparison = splitTopLevelComparisonOperators(pythonExpression);
  if (comparison === null || comparison.operators.length < 2) {
    return null;
  }

  const parts = comparison.parts.map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
  return comparison.operators
    .map((operator, index) => translateComparisonClause(parts[index], operator, parts[index + 1], arrayNames, nameMap))
    .join(' && ');
}

function translateComparisonClause(
  left: string,
  operator: string,
  right: string,
  arrayNames: ReadonlySet<string>,
  nameMap: Map<string, string>,
): string {
  const leftOperand = parenthesizeComparisonOperand(left);
  const rightOperand = parenthesizeComparisonOperand(right);
  if ((operator === '==' || operator === '!=') && comparisonNeedsPythonEquality(left, right, arrayNames, nameMap)) {
    const equality = `pythonEquals(${leftOperand}, ${rightOperand})`;
    return operator === '==' ? equality : `!${equality}`;
  }
  return `${leftOperand} ${tsComparisonOperator(operator)} ${rightOperand}`;
}

function parenthesizeComparisonOperand(value: string): string {
  return value.includes(' ?? ') || value.includes(' && ') || value.includes(' || ')
    ? `(${value})`
    : value;
}

function parenthesizeForModulo(value: string): string {
  return value.includes(' ? ') || value.includes(' + ') || value.includes(' - ') ? `(${value})` : value;
}

function translatePythonPercentStringFormat(
  rawLeft: string,
  rawRight: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const leftRaw = stripBalancedOuterParens(rawLeft.trim());
  const leftTranslated = translateExpression(leftRaw, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (!expressionLooksStringFormatSource(leftRaw, leftTranslated, arrayNames)) {
    return null;
  }
  const rightRaw = stripBalancedOuterParens(rawRight.trim());
  const tupleArgs = /^\(([\s\S]*)\)$/.exec(rightRaw) !== null && matchingCloseParen(rightRaw, 0) === rightRaw.length - 1
    ? splitTopLevelComma(rightRaw.slice(1, -1))
    : [rightRaw];
  if (tupleArgs.length === 0 || tupleArgs.some((arg) => arg.trim() === '')) {
    return null;
  }
  return tupleArgs.reduce(
    (formatted, arg) => `${formatted}.replace(/%[-+ #0]*(?:\\d+|\\*)?(?:\\.(?:\\d+|\\*))?[sdif]/, String(${translateExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)}))`,
    parenthesizeMethodReceiver(leftTranslated),
  );
}

function expressionLooksStringFormatSource(rawExpression: string, translatedExpression: string, arrayNames: ReadonlySet<string>): boolean {
  return /^(?:[rRuUbBfF]*)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/.test(rawExpression)
    || /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)$/.test(translatedExpression)
    || arrayNames.has(stringNameMarker(rawExpression))
    || arrayNames.has(stringNameMarker(translatedExpression));
}

function parenthesizeMethodReceiver(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(value)
    || /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)$/.test(value)
    || /^\([\s\S]+\)$/.test(value)
    ? value
    : `(${value})`;
}

function parenthesizeTranslatedMultiplicativeOperand(raw: string, translated: string): string {
  if (splitTopLevelAdditive(raw) === null && splitTopLevelAdditive(translated) !== null) {
    return `(${translated})`;
  }
  return parenthesizeForMultiplicative(translated);
}

function tsComparisonOperator(operator: string): string {
  if (operator === '==') {
    return '===';
  }
  if (operator === '!=') {
    return '!==';
  }
  return operator;
}

function comparisonNeedsPythonEquality(
  left: string,
  right: string,
  arrayNames: ReadonlySet<string>,
  nameMap: Map<string, string>,
): boolean {
  const leftSubscript = /^([A-Za-z_$][A-Za-z0-9_.$]*)\[.+\]$/.exec(left);
  const rightSubscript = /^([A-Za-z_$][A-Za-z0-9_.$]*)\[.+\]$/.exec(right);
  return /\bnew [A-Z][A-Za-z0-9_$]*\(/.test(left)
    || /\bnew [A-Z][A-Za-z0-9_$]*\(/.test(right)
    || /^Array\.from\(/.test(left)
    || /^Array\.from\(/.test(right)
    || arrayNames.has(left)
    || arrayNames.has(right)
    || (leftSubscript !== null && arrayNames.has(tupleElementArrayNameMarker(leftSubscript[1])))
    || (rightSubscript !== null && arrayNames.has(tupleElementArrayNameMarker(rightSubscript[1])))
    || arrayNames.has(objectNameMarker(left))
    || arrayNames.has(objectNameMarker(right))
    || arrayNames.has(vectorNameMarker(left))
    || arrayNames.has(vectorNameMarker(right))
    || typeExpressionNeedsPythonEquality(knownClassFieldType(left, nameMap))
    || typeExpressionNeedsPythonEquality(knownClassFieldType(right, nameMap));
}

function typeExpressionNeedsPythonEquality(typeExpression: string | null): boolean {
  const baseType = nullableTypeExpressionBase(typeExpression) ?? typeExpression?.trim();
  if (baseType === undefined || baseType === '') {
    return false;
  }
  if (baseType === 'string' || baseType === 'number' || baseType === 'boolean' || baseType === 'bigint' || baseType === 'symbol') {
    return false;
  }
  if (typeExpressionLooksTsEnum(baseType)) {
    return false;
  }
  if (baseType === 'Date' || baseType === 'RegExp' || baseType === 'Error') {
    return false;
  }
  return /^[A-Z][A-Za-z0-9_$]*(?:<.*>)?$/.test(baseType);
}

export function translateMapKeyExpression(
  mapName: string,
  keyExpression: string,
  mapNames: ReadonlySet<string> = new Set(),
): string {
  if (mapNames.has(tupleKeyMapNameMarker(mapName)) && !keyExpression.startsWith('tupleKey(')) {
    return `tupleKey(${keyExpression})`;
  }
  if (mapName === 'quests' && !keyExpression.endsWith('.text')) {
    return `${keyExpression}.text`;
  }
  return keyExpression;
}

function translateAggregateGeneratorCall(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  for (const [pythonName, tsName] of [['max', 'Math.max'], ['min', 'Math.min']] as const) {
    const call = parseCallPrefix(pythonExpression, pythonName);
    if (call === null || call.rest !== '') {
      continue;
    }
    const args = splitTopLevelComma(call.argsText);
    const generatorArg = args
      .map((arg, index) => ({ arg, index }))
      .find(({ arg }) => {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
          return false;
        }
        const generatorText = stripBalancedOuterParens(arg.trim().replace(/^\*/, '').trim());
        return parseSimpleGeneratorExpression(generatorText) !== null;
      });
    if (generatorArg === undefined) {
      continue;
    }
    const generatorText = stripBalancedOuterParens(generatorArg.arg.trim().replace(/^\*/, '').trim());
    const generator = parseSimpleGeneratorExpression(generatorText);
    if (generator === null) {
      continue;
    }
    const positionalArgs = args
      .filter((arg, index) => index !== generatorArg.index && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))
      .map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames));
    const itemName = tsExportNameForPythonName(generator.itemName);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(generator.itemName, itemName);
    const translatedIterable = translateExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const iterable = expressionIsKnownMap(translatedIterable, nameMap, mapNames) ? `${translatedIterable}.keys()` : translatedIterable;
    const filteredIterable = generator.condition === null
      ? iterable
      : `Array.from(${iterable}).filter((${itemName}) => ${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    const values = `Array.from(${filteredIterable}, (${itemName}) => ${translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    const spreadArgs = [...positionalArgs, `...${values}`].join(', ');
    const defaultArg = args
      .map((arg) => /^default=(.+)$/.exec(arg))
      .find((match): match is RegExpExecArray => match !== null);
    if (defaultArg === undefined) {
      return `${tsName}(${spreadArgs})`;
    }
    const defaultValue = translateExpression(defaultArg[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `(() => { const values = ${values}; return values.length === 0 ? ${defaultValue} : ${tsName}(...values); })()`;
  }
  const sumCall = parseCallPrefix(pythonExpression, 'sum');
  if (sumCall !== null && sumCall.rest === '') {
    const args = splitTopLevelComma(sumCall.argsText);
    if (args.length >= 1 && args.length <= 2) {
      const generator = parseSimpleGeneratorExpression(args[0]);
      if (generator !== null) {
        const itemName = tsExportNameForPythonName(generator.itemName);
        const itemNameMap = new Map(nameMap);
        itemNameMap.set(generator.itemName, itemName);
        const iterable = iterableExpressionForIteration(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
        const values = generator.condition === null
          ? iterable
          : `${iterable}.filter((${itemName}) => ${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
        const initialValue = args[1] === undefined
          ? '0'
          : translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
        return `${values}.reduce((total, ${itemName}) => total + ${translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)}, ${initialValue})`;
      }
    }
  }
  const allCall = parseCallPrefix(pythonExpression, 'all');
  if (allCall !== null && allCall.rest === '') {
    const args = splitTopLevelComma(allCall.argsText);
    if (args.length === 1) {
      const generator = parseSimpleGeneratorExpression(args[0]);
      if (generator !== null) {
        const itemName = tsExportNameForPythonName(generator.itemName);
        const itemNameMap = new Map(nameMap);
        itemNameMap.set(generator.itemName, itemName);
        const iterable = arrayMethodIterableExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
        const expression = translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames);
        const condition = generator.condition === null
          ? expression
          : `(${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)}) && (${expression})`;
        return `${iterable}.every((${itemName}) => ${condition})`;
      }
    }
  }
  const anyCall = parseCallPrefix(pythonExpression, 'any');
  if (anyCall !== null && anyCall.rest === '') {
    const args = splitTopLevelComma(anyCall.argsText);
    if (args.length === 1) {
      const generator = parseSimpleGeneratorExpression(args[0]);
      if (generator !== null) {
        const itemName = tsExportNameForPythonName(generator.itemName);
        const itemNameMap = new Map(nameMap);
        itemNameMap.set(generator.itemName, itemName);
        const iterable = arrayMethodIterableExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
        const expression = translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames);
        const condition = generator.condition === null
          ? expression
          : `(${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)}) && (${expression})`;
        return `${iterable}.some((${itemName}) => ${condition})`;
      }
      return `Array.from(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}).some(pythonTruthy)`;
    }
  }
  return null;
}

function tupleTargetGeneratorExpressionToArray(
  generator: TupleTargetGeneratorExpression,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const itemNameMap = new Map(nameMap);
  const targetNames = generator.targetNames.map((targetName) => tsGeneratorTargetName(targetName));
  generator.targetNames.forEach((targetName, targetIndex) => {
    itemNameMap.set(targetName, targetNames[targetIndex]);
  });
  const mapParameter = `[${targetNames.join(', ')}]`;
  const enumerateCall = parseCallPrefix(generator.iterable, 'enumerate');
  const enumerateArgs = targetNames.length === 2 && enumerateCall !== null && enumerateCall.rest === ''
    ? parseEnumerateCallArgs(enumerateCall.argsText)
    : null;
  const iterable = enumerateArgs === null
    ? arrayMethodIterableExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames)
    : enumerateArrayExpression(enumerateArgs, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const filtered = generator.condition === null
    ? iterable
    : `${iterable}.filter((${mapParameter}) => ${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  return `${filtered}.map((${mapParameter}) => ${translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
}

function enumerateArrayExpression(
  enumerateArgs: { iterable: string; start: string | null },
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const iterable = arrayMethodIterableExpression(enumerateArgs.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const start = enumerateArgs.start === null
    ? '0'
    : translateExpression(enumerateArgs.start, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const indexExpression = start === '0' ? 'index' : `index + ${start}`;
  return `Array.from(${iterable}, (item, index) => [${indexExpression}, item] as const)`;
}

function tsGeneratorTargetName(pythonName: string): string {
  return pythonName.startsWith('_') && !/^_+$/.test(pythonName)
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
}

function generatorExpressionToArray(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const tupleTargetGenerator = parseTupleTargetGeneratorExpression(pythonExpression);
  if (tupleTargetGenerator !== null) {
    return tupleTargetGeneratorExpressionToArray(tupleTargetGenerator, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }
  const generator = parseSimpleGeneratorExpression(pythonExpression);
  if (generator === null) {
    return null;
  }
  const itemName = tsExportNameForPythonName(generator.itemName);
  const itemNameMap = new Map(nameMap);
  itemNameMap.set(generator.itemName, itemName);
  const iterable = arrayMethodIterableExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const filtered = generator.condition === null
    ? iterable
    : `${iterable}.filter((${itemName}) => ${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  return `${filtered}.map((${itemName}) => ${translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
}

function parseSimpleListComprehension(
  pythonExpression: string,
): { expression: string; itemName: string; iterable: string; condition: string | null } | null {
  const listComprehension = /^\[(.+?) for ([A-Za-z_][A-Za-z0-9_]*) in (.+?)(?: if (.+))?\]$/.exec(pythonExpression);
  if (listComprehension === null) {
    return null;
  }
  return {
    expression: listComprehension[1],
    itemName: listComprehension[2],
    iterable: listComprehension[3],
    condition: listComprehension[4] ?? null,
  };
}

function parseTupleTargetListComprehension(pythonExpression: string): TupleTargetGeneratorExpression | null {
  const trimmed = pythonExpression.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']') || !delimitersBalanced(trimmed)) {
    return null;
  }
  return parseTupleTargetGeneratorExpression(trimmed.slice(1, -1));
}

function tupleListComprehensionItemExpression(pythonExpression: string, itemExpression: string): string {
  const tupleLength = pythonTupleExpressionLength(pythonExpression);
  return tupleLength === null ? itemExpression : `${itemExpression} as [${Array.from({ length: tupleLength }, () => 'any').join(', ')}]`;
}

function translatedItemsLookLikeLabelTupleArray(items: readonly string[]): boolean {
  return items.length > 0 && items.every((item) => {
    const trimmed = item.trim();
    const tupleArray = /^\[([\s\S]*)\](?: as const)?$/.exec(trimmed);
    if (tupleArray === null) {
      return false;
    }
    const parts = splitTopLevelComma(tupleArray[1]);
    const label = parts[parts.length - 1]?.trim() ?? '';
    return parts.length > 1 && /^['"`]/.test(label);
  });
}

function pythonTupleExpressionLength(pythonExpression: string | null): number | null {
  if (pythonExpression === null) {
    return null;
  }
  const trimmed = pythonExpression.trim();
  if (!trimmed.startsWith('(') || matchingCloseParen(trimmed, 0) !== trimmed.length - 1) {
    return null;
  }
  const inner = trimmed.slice(1, -1);
  if (!inner.includes(',')) {
    return null;
  }
  const parts = splitTopLevelComma(inner).filter((part) => part.trim() !== '');
  return parts.length === 0 ? null : parts.length;
}

function parseSimplePositionalCall(pythonExpression: string): { callee: string; args: string[] } | null {
  const callStart = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(/.exec(pythonExpression);
  if (callStart === null) {
    return null;
  }
  const closeIndex = matchingCloseParen(pythonExpression, callStart[1].length);
  if (closeIndex !== pythonExpression.length - 1) {
    return null;
  }
  return {
    callee: callStart[1],
    args: splitTopLevelComma(pythonExpression.slice(callStart[1].length + 1, closeIndex)),
  };
}

function expressionContainsKnownDateAttribute(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): boolean {
  for (const match of pythonExpression.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.(day|month|year)\b/g)) {
    const receiver = translateExpression(match[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(dateNameMarker(match[1])) || arrayNames.has(dateNameMarker(receiver))) {
      return true;
    }
  }
  return false;
}

function translateSortedCall(
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const parts = splitTopLevelComma(argsText);
  if (parts.length === 0) {
    return null;
  }
  const iterablePart = parts.find((part) => !part.startsWith('key=') && !part.startsWith('reverse='));
  if (iterablePart === undefined) {
    return null;
  }

  const keyPart = parts.find((part) => part.startsWith('key='));
  const reverse = parts.some((part) => part === 'reverse=True');
  const iterable = sortedIterableExpression(iterablePart, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (keyPart === undefined) {
    const comparison = 'pythonCompareKeys(left, right)';
    return `${iterable}.sort((left, right) => ${reverse ? `-1 * ${comparison}` : comparison})`;
  }

  const lambda = /^key=lambda ([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(keyPart);
  if (lambda !== null) {
    const leftNameMap = new Map(nameMap);
    leftNameMap.set(lambda[1], 'left');
    const rightNameMap = new Map(nameMap);
    rightNameMap.set(lambda[1], 'right');
    const leftKey = translateExpression(lambda[2], leftNameMap, arrayNames, validatedTypeAliases, mapNames);
    const rightKey = translateExpression(lambda[2], rightNameMap, arrayNames, validatedTypeAliases, mapNames);
    const comparison = `pythonCompareKeys(${leftKey}, ${rightKey})`;
    return `${iterable}.sort((left, right) => ${reverse ? `-1 * ${comparison}` : comparison})`;
  }

  const keyReference = /^key=(.+)$/.exec(keyPart);
  if (keyReference !== null) {
    const key = translateExpression(keyReference[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const comparison = `pythonCompareKeys(${key}(left), ${key}(right))`;
    return `${iterable}.sort((left, right) => ${reverse ? `-1 * ${comparison}` : comparison})`;
  }
  return null;
}

function translateMaxCall(
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const parts = splitTopLevelComma(argsText);
  const keyPart = parts.find((part) => part.startsWith('key='));
  if (keyPart === undefined) {
    return null;
  }
  const iterableParts = parts.filter((part) => !part.startsWith('key='));
  if (iterableParts.length !== 1) {
    return null;
  }
  const lambda = /^key=lambda ([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(keyPart);
  if (lambda === null) {
    return null;
  }
  const iterable = translateExpression(iterableParts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const bestNameMap = new Map(nameMap);
  bestNameMap.set(lambda[1], 'best');
  const candidateNameMap = new Map(nameMap);
  candidateNameMap.set(lambda[1], 'candidate');
  const bestKey = translateExpression(lambda[2], bestNameMap, arrayNames, validatedTypeAliases, mapNames);
  const candidateKey = translateExpression(lambda[2], candidateNameMap, arrayNames, validatedTypeAliases, mapNames);
  const iterableArray = iterable.startsWith('Array.from(') || iterable.startsWith('[')
    ? iterable
    : `Array.from(${iterable})`;
  return `${iterableArray}.reduce((best, candidate) => ${candidateKey} > ${bestKey} ? candidate : best)`;
}

function sortedIterableExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const generator = parseSimpleGeneratorExpression(pythonExpression);
  if (generator !== null) {
    const itemName = tsExportNameForPythonName(generator.itemName);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(generator.itemName, itemName);
    const iterable = arrayMethodIterableExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const filtered = generator.condition === null
      ? iterable
      : `${iterable}.filter((${itemName}) => ${translateExpression(generator.condition!, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    const itemExpression = translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames);
    return itemExpression === itemName ? filtered : `${filtered}.map((${itemName}) => ${itemExpression})`;
  }
  const setIntersection = topLevelSetIntersection(pythonExpression);
  if (setIntersection !== null) {
    const left = translateExpression(setIntersection.left, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(setIntersection.right, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const leftSet = /^new Set\((.+)\)$/.exec(left);
    const rightMapKeysSet = /^new Set\(([A-Za-z_$][A-Za-z0-9_.$]*)\.keys\(\)\)$/.exec(right);
    const source = leftSet?.[1] ?? left;
    const membership = rightMapKeysSet === null ? `${right}.has(item)` : `${rightMapKeysSet[1]}.has(item)`;
    return `Array.from(${source}).filter((item) => ${membership})`;
  }
  const setDifference = topLevelSetDifference(pythonExpression);
  if (setDifference !== null) {
    const left = translateExpression(setDifference.left, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(setDifference.right, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `Array.from(${left}).filter((item) => !${right}.has(item))`;
  }
  const iterable = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (expressionIsKnownMap(iterable, nameMap, mapNames)) {
    return `Array.from(${iterable}.keys())`;
  }
  if (arrayNames.has(objectNameMarker(pythonExpression)) || arrayNames.has(objectNameMarker(iterable))) {
    return `Object.keys(${iterable})`;
  }
  return `Array.from(${iterable})`;
}

function iterableExpressionForIteration(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const iterable = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (expressionIsKnownMap(iterable, nameMap, mapNames)) {
    return `Array.from(${iterable}.keys())`;
  }
  if (arrayNames.has(objectNameMarker(pythonExpression)) || arrayNames.has(objectNameMarker(iterable))) {
    return `Object.keys(${iterable})`;
  }
  if (arrayNames.has(setNameMarker(pythonExpression)) || arrayNames.has(setNameMarker(iterable))) {
    return `Array.from(${iterable})`;
  }
  return iterable;
}

function arrayMethodIterableExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const iterable = iterableExpressionForIteration(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (expressionLooksIteratorResult(iterable)) {
    return `Array.from(${iterable})`;
  }
  if (
    arrayNames.has(pythonExpression)
    || arrayNames.has(iterable)
    || expressionLooksArrayResult(iterable)
  ) {
    return iterable;
  }
  return `Array.from(${iterable})`;
}

function expressionLooksIteratorResult(tsExpression: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_.$]*\.(?:keys|values|entries)\(\)$/.test(tsExpression);
}

function expressionLooksArrayResult(tsExpression: string): boolean {
  return (
    tsExpression.startsWith('[')
    || tsExpression.startsWith('Array.from(')
    || tsExpression.startsWith('Object.keys(')
    || /^[A-Za-z_$][A-Za-z0-9_.$()[\]]*\.(?:filter|map|slice)\(/.test(tsExpression)
  );
}

function rangeArrayExpression(
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const args = splitTopLevelComma(argsText);
  if (args.length < 1 || args.length > 3) {
    return null;
  }
  const start = args.length === 1
    ? '0'
    : translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const stop = translateExpression(args.length === 1 ? args[0] : args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const step = args.length === 3
    ? translateExpression(args[2], nameMap, arrayNames, validatedTypeAliases, mapNames)
    : '1';
  if (start === '0' && step === '1') {
    return `Array.from({ length: Math.max(0, ${stop}) }, (_, i) => i)`;
  }
  if (step === '1') {
    return `Array.from({ length: Math.max(0, ${stop} - ${start}) }, (_, i) => ${start} + i)`;
  }
  const lengthExpression = `Math.max(0, Math.ceil((${stop} - ${start}) / ${step}))`;
  return `Array.from({ length: ${lengthExpression} }, (_, i) => ${start} + i * ${step})`;
}

function topLevelSetIntersection(pythonExpression: string): { left: string; right: string } | null {
  return splitTopLevelSpacedOperator(pythonExpression, '&');
}

function topLevelSetUnion(pythonExpression: string): { left: string; right: string } | null {
  const union = splitTopLevelSpacedOperator(pythonExpression, '|');
  if (union === null) {
    return null;
  }
  const isSetExpression = (part: string): boolean => /^(?:set|frozenset)\(/.test(part.trim());
  return isSetExpression(union.left) && isSetExpression(union.right) ? union : null;
}

function topLevelSetDifference(pythonExpression: string): { left: string; right: string } | null {
  const additive = splitTopLevelAdditive(pythonExpression);
  if (additive === null || additive.parts.length !== 2 || additive.operators[0] !== '-') {
    return null;
  }
  return { left: additive.parts[0], right: additive.parts[1] };
}

function translateIsinstancePredicate(value: string, pythonTypeExpression: string): string | null {
  const trimmedType = pythonTypeExpression.trim();
  const tupleType = /^\((.*)\)$/.exec(trimmedType);
  if (tupleType !== null) {
    const parts = [...new Set(splitTopLevelComma(tupleType[1])
      .map((part) => translateIsinstancePredicate(value, part))
      .filter((part): part is string => part !== null))];
    return parts.length === 0 ? null : parts.length === 1 ? parts[0] : `(${parts.join(' || ')})`;
  }
  if (trimmedType === 'list' || trimmedType === 'tuple') {
    return `Array.isArray(${value})`;
  }
  if (trimmedType === 'Sequence') {
    return `pythonIsSequence(${value})`;
  }
  if (trimmedType === 'Mapping') {
    return `pythonIsMapping(${value})`;
  }
  if (trimmedType === 'dict') {
    return `typeof ${value} === 'object' && ${value} !== null && !Array.isArray(${value})`;
  }
  if (trimmedType === 'bool') {
    return `typeof ${value} === 'boolean'`;
  }
  if (trimmedType === 'int') {
    return `typeof ${value} === 'number' && Number.isInteger(${value})`;
  }
  if (trimmedType === 'float') {
    return `typeof ${value} === 'number'`;
  }
  if (trimmedType === 'str') {
    return `typeof ${value} === 'string'`;
  }
  if (trimmedType === 'bytes' || trimmedType === 'bytearray') {
    return `${value} instanceof Uint8Array`;
  }
  if (trimmedType === 'memoryview') {
    return `ArrayBuffer.isView(${value}) && !(${value} instanceof Uint8Array)`;
  }
  if (trimmedType === 'Path') {
    return `typeof ${value} !== 'string'`;
  }
  if (/^_?[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)?$/.test(trimmedType)) {
    return `${value} instanceof ${tsTypeExpression(trimmedType)}`;
  }
  return null;
}

function tsCastTypeExpression(pythonTypeExpression: string): string | null {
  const trimmed = pythonTypeExpression.trim();
  if (/^Mapping\[/.test(trimmed)) {
    return 'PythonMapping';
  }
  if (/^Sequence\[/.test(trimmed)) {
    return 'PythonSequence';
  }
  return tsTypeExpression(trimmed);
}

function castShouldBePreserved(pythonTypeExpression: string, tsType: string): boolean {
  return tsType === 'PythonMapping' || tsType === 'PythonSequence' || /^Callable\[/.test(pythonTypeExpression.trim());
}

function translateBooleanCast(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const orParts = splitTopLevelLogicalOperator(pythonExpression, 'or');
  if (orParts !== null) {
    return orParts
      .map((part) => translatePythonTruthy(part, nameMap, arrayNames, validatedTypeAliases, mapNames))
      .join(' || ');
  }
  const andParts = splitTopLevelLogicalOperator(pythonExpression, 'and');
  if (andParts !== null) {
    return andParts
      .map((part) => translatePythonTruthy(part, nameMap, arrayNames, validatedTypeAliases, mapNames))
      .join(' && ');
  }
  const translated = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const truthy = translatePythonTruthy(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (truthy !== translated || expressionKnownBooleanSource(pythonExpression, translated, nameMap, arrayNames)) {
    return truthy;
  }
  return `Boolean(${truthy})`;
}

function translatePythonTruthy(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const trimmed = pythonExpression.trim();
  const translated = translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (arrayNames.has(setNameMarker(trimmed)) || arrayNames.has(setNameMarker(translated))) {
    return `${translated}.size > 0`;
  }
  if (expressionIsKnownMap(translated, nameMap, mapNames)) {
    return `${translated}.size > 0`;
  }
  const fieldType = knownClassFieldType(trimmed, nameMap) ?? knownClassFieldType(translated, nameMap);
  if (fieldType !== null) {
    if (typeExpressionLooksMap(fieldType)) {
      return `${translated}.size > 0`;
    }
    if (fieldType === 'string') {
      return `${tsPropertyAccessBase(translated)}.length > 0`;
    }
    if (fieldType.endsWith('[]') || fieldType.startsWith('readonly ') && fieldType.endsWith('[]')) {
      return `${translated}.length > 0`;
    }
  }
  if (
    arrayNames.has(stringNameMarker(trimmed))
    || arrayNames.has(stringNameMarker(translated))
    || /^String\(/.test(translated)
    || /^\(.+\)\.trim\(\)$/.test(translated)
    || /^[A-Za-z_$][A-Za-z0-9_.$]*\.trim\(\)$/.test(translated)
  ) {
    return `${tsPropertyAccessBase(translated)}.length > 0`;
  }
  if (/^[A-Za-z_$][A-Za-z0-9_.$]*(?:creatures|entries|pickups|players)$/.test(translated)) {
    return `${translated}.length > 0`;
  }
  if (arrayNames.has(trimmed) || arrayNames.has(translated)) {
    return `${translated}.length > 0`;
  }
  if (expressionLooksBitwiseNumeric(translated)) {
    return `(${translated}) !== 0`;
  }
  if (expressionLooksBoolean(translated) || expressionLooksSimpleValueReference(translated)) {
    return translated;
  }
  return expressionLooksCallResult(translated) ? `pythonTruthy(${translated})` : translated;
}

function expressionKnownBooleanSource(
  pythonExpression: string,
  tsExpression: string,
  nameMap: Map<string, string>,
  arrayNames: ReadonlySet<string>,
): boolean {
  const trimmed = stripBalancedOuterParens(pythonExpression.trim());
  const translated = stripBalancedOuterParens(tsExpression.trim());
  const fieldType = knownClassFieldType(trimmed, nameMap) ?? knownClassFieldType(translated, nameMap);
  return expressionLooksBoolean(translated)
    || fieldType === 'boolean'
    || arrayNames.has(booleanNameMarker(trimmed))
    || arrayNames.has(booleanNameMarker(translated));
}

function expressionLooksBitwiseNumeric(tsExpression: string): boolean {
  return / (?:&|\||\^) /.test(tsExpression)
    || /(?:<<|>>>)/.test(tsExpression)
    || /^Math\.floor\(.+ \/ \(2 \*\* .+\)\)$/.test(tsExpression.trim());
}

function expressionLooksBoolean(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  return trimmed === 'true'
    || trimmed === 'false'
    || /^!/.test(trimmed)
    || expressionContainsComparisonOperator(trimmed)
    || /(?:&&|\|\||\binstanceof\b)/.test(trimmed)
    || /^typeof\b/.test(trimmed)
    || /^(?:Array\.isArray|Number\.is(?:Finite|Integer|NaN))\(/.test(trimmed)
    || /^(?:InputState\.(?:is|was)|wgl\.is)[A-Za-z0-9_$]*\(/.test(trimmed)
    || /\.(?:every|has|includes|some|startsWith|endsWith)\(/.test(trimmed)
    || /(?:^|\.)[A-Za-z_$][A-Za-z0-9_$]*(?:Ready|Connected|Started|Enabled|Available|Visible|Empty|Valid|Compatible|Allowed)\(\)$/.test(trimmed);
}

function translatedExpressionLooksBooleanForInt(tsExpression: string): boolean {
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
    || expressionContainsComparisonOperator(trimmed)
    || /\binstanceof\b/.test(trimmed)
    || /^typeof\b/.test(trimmed)
    || /^pythonTruthy\(/.test(trimmed)
    || /^(?:Array\.isArray|Number\.is(?:Finite|Integer|NaN))\(/.test(trimmed)
    || /^InputState\.(?:is|was)[A-Za-z0-9_$]*\(/.test(trimmed)
    || /\.(?:has|includes|startsWith|endsWith)\(/.test(trimmed);
}

function expressionContainsComparisonOperator(tsExpression: string): boolean {
  for (let index = 0; index < tsExpression.length; index += 1) {
    if (
      tsExpression.startsWith('===', index)
      || tsExpression.startsWith('!==', index)
      || tsExpression.startsWith('<=', index)
      || tsExpression.startsWith('>=', index)
    ) {
      return true;
    }
    const char = tsExpression[index];
    if (char !== '<' && char !== '>') {
      continue;
    }
    const previous = tsExpression[index - 1] ?? '';
    const next = tsExpression[index + 1] ?? '';
    if (previous === char || next === char || next === '=') {
      continue;
    }
    return true;
  }
  return false;
}

function expressionLooksSimpleValueReference(tsExpression: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(tsExpression.trim());
}

function expressionLooksCallResult(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\(.*\)$/.test(trimmed)
    || /^new [A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\(.*\)$/.test(trimmed);
}

function translateInlineDictMapExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const trimmed = pythonExpression.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  const body = trimmed.slice(1, -1).trim();
  if (body === '') {
    return 'new Map()';
  }
  const entries: string[] = [];
  for (const item of splitTopLevelComma(body)) {
    const separator = topLevelColonIndex(item);
    if (separator === null) {
      return null;
    }
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    entries.push(`[${translateExpression(key, nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(value, nameMap, arrayNames, validatedTypeAliases, mapNames)}]`);
  }
  return `new Map([${entries.join(', ')}])`;
}

function translateSetLiteralExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const trimmed = pythonExpression.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  const body = trimmed.slice(1, -1).trim();
  if (body === '') {
    return null;
  }
  const items = splitTopLevelComma(body).filter((item) => item.trim() !== '');
  if (items.length === 0 || items.some((item) => topLevelColonIndex(item) !== null)) {
    return null;
  }
  return `new Set([${items.map((item) => translateExpression(item, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')}])`;
}

function translateSetComprehensionExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const trimmed = pythonExpression.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }
  const generator = parseSimpleGeneratorExpression(trimmed.slice(1, -1));
  if (generator === null) {
    return null;
  }
  const itemName = tsExportNameForPythonName(generator.itemName);
  const itemNameMap = new Map(nameMap);
  itemNameMap.set(generator.itemName, itemName);
  const iterable = arrayMethodIterableExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const itemParameter = propertyChainIterableCallbackParameter(itemName, iterable);
  const filtered = generator.condition === null
    ? iterable
    : `${iterable}.filter((${itemName}) => ${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  return `new Set(${filtered}.map((${itemParameter}) => ${translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)}))`;
}

function methodCallIterableCallbackParameter(itemName: string, iterableExpression: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\(/.test(iterableExpression) ? `${itemName}: any` : itemName;
}

function propertyChainIterableCallbackParameter(itemName: string, iterableExpression: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(iterableExpression) ? `${itemName}: any` : itemName;
}

function translateNextCall(
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const args = splitTopLevelComma(argsText);
  if (args.length < 1 || args.length > 2) {
    return null;
  }
  const reversedCall = parseCallPrefix(args[0].trim(), 'reversed');
  if (reversedCall !== null && reversedCall.rest === '' && args.length === 1) {
    return `Array.from(${translateExpression(reversedCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)}).at(-1)!`;
  }
  const generator = parseSimpleGeneratorExpression(args[0]);
  if (generator === null) {
    const iterator = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (args.length === 1) {
      return `${tsPropertyAccessBase(iterator)}.next().value!`;
    }
    const fallback = translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `(() => { const _next = ${tsPropertyAccessBase(iterator)}.next(); return _next.done ? ${fallback} : _next.value; })()`;
  }
  const itemName = tsExportNameForPythonName(generator.itemName);
  const itemNameMap = new Map(nameMap);
  itemNameMap.set(generator.itemName, itemName);
  const iterable = iterableExpressionForIteration(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const condition = generator.condition === null
    ? ''
    : ` if (${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  const value = translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames);
  const fallback = args[1] === undefined
    ? 'undefined'
    : translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  return `(() => { for (const ${itemName} of ${iterable}) {${condition} return ${value}; } return ${fallback}; })()`;
}

function translateMsgspecStructsReplace(
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const parts = splitTopLevelComma(argsText);
  if (parts.length === 0) {
    return null;
  }

  const value = translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
  const updates: string[] = [];
  for (const part of parts.slice(1)) {
    const keyword = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(part);
    if (keyword === null) {
      return null;
    }
    const name = tsExportNameForPythonName(keyword[1]);
    const translatedValue = translateExpression(keyword[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    updates.push(name === translatedValue ? name : `${name}: ${translatedValue}`);
  }

  const updateText = updates.length === 0 ? '' : `, ${updates.join(', ')}`;
  return `(() => { const value = ${value}; return new (value.constructor as new (opts: typeof value) => typeof value)({ ...value${updateText} }); })()`;
}

function translateInlineRecordLiteral(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  if (!pythonExpression.startsWith('{') || !pythonExpression.endsWith('}') || !pythonExpression.includes(':')) {
    return null;
  }
  const body = pythonExpression.slice(1, -1).trim();
  if (body === '') {
    return '{}';
  }
  const properties: string[] = [];
  for (const item of splitTopLevelComma(body)) {
    const separator = topLevelColonIndex(item);
    if (separator === null) {
      return null;
    }
    const keyExpression = item.slice(0, separator).trim();
    const valueExpression = item.slice(separator + 1).trim();
    const key = parsePythonStringExpression(keyExpression);
    if (key === null) {
      return null;
    }
    const renderedKey = tsStringLiteral(JSON.stringify(key.content));
    properties.push(`${renderedKey}: ${translateExpression(valueExpression, nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
  }
  return `{ ${properties.join(', ')} }`;
}

function translateCallWithInlineRecordArgs(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const call = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/.exec(pythonExpression);
  if (call === null || !call[2].includes('{')) {
    return null;
  }
  const args = splitTopLevelComma(call[2]);
  const positionalParts: string[] = [];
  const keywordParts: string[] = [];
  let sawRecord = false;
  let sawKeyword = false;
  for (const arg of args) {
    const keyword = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(arg);
    if (keyword !== null) {
      sawKeyword = true;
      keywordParts.push(`${tsExportNameForPythonName(keyword[1])}: ${translateKeywordArgumentExpression(keyword[1], keyword[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
      continue;
    }
    if (sawKeyword) {
      return null;
    }
    const record = translateInlineRecordLiteral(arg, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (record !== null) {
      sawRecord = true;
      positionalParts.push(record);
      continue;
    }
    positionalParts.push(translateExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames));
  }
  if (!sawRecord) {
    return null;
  }
  const optsArg = keywordParts.length === 0 ? [] : [`{ ${keywordParts.join(', ')} }`];
  const callee = translateStaticMethodCalleeIfKnown(call[1], nameMap)
    ?? translateExpression(call[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  return `${callee}(${[...positionalParts, ...optsArg].join(', ')})`;
}

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
      depth -= 1;
      continue;
    }
    if (char === ':' && depth === 0) {
      return index;
    }
  }
  return null;
}

function joinTranslatedAdditive(
  additive: { parts: string[]; operators: string[] },
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  let output = translateAdditiveOperand(additive.parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
  for (let index = 0; index < additive.operators.length; index += 1) {
    output += ` ${additive.operators[index]} ${translateAdditiveOperand(additive.parts[index + 1], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }
  return output;
}

function translateAdditiveOperand(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const translated = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const expression = pythonExpressionLooksBooleanNumericOperand(pythonExpression, nameMap, arrayNames)
    ? `Number(${translated})`
    : translated;
  return parenthesizeForAdditive(expression);
}

function pythonExpressionLooksBooleanNumericOperand(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: ReadonlySet<string>,
): boolean {
  const trimmed = stripBalancedOuterParens(pythonExpression.trim());
  const primitiveWrapped = /^(?:float|int|bool)\(([\s\S]+)\)$/.exec(trimmed);
  const unwrapped = primitiveWrapped === null
    ? trimmed
    : stripBalancedOuterParens(primitiveWrapped[1].trim());
  if (/^(?:input_code_is_down|input_code_is_pressed)\(/.test(unwrapped)) {
    return true;
  }
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(unwrapped);
  if (identifier !== null) {
    const translated = translateIdentifierName(identifier[0], nameMap);
    return arrayNames.has(booleanNameMarker(identifier[0]))
      || arrayNames.has(booleanNameMarker(translated))
      || /(?:_pressed|_down|_active|_enabled|_ok)$/.test(identifier[0])
      || /(?:Pressed|Down|Active|Enabled|Ok)$/.test(translated);
  }
  return false;
}

function translateMixedKeywordCall(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): string | null {
  const call = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\((.*)\)$/.exec(pythonExpression);
  if (call === null || !call[2].includes('=')) {
    return null;
  }
  const closeIndex = matchingCloseParen(pythonExpression, call[1].length);
  if (closeIndex !== pythonExpression.length - 1) {
    return null;
  }

  const parts = splitTopLevelComma(call[2]);
  const keywordParts: { pythonName: string; tsName: string; expression: string }[] = [];
  const positionalParts: string[] = [];
  let sawKeyword = false;
  for (const part of parts) {
    const keyword = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(part);
    if (keyword === null) {
      if (sawKeyword) {
        return null;
      }
      positionalParts.push(part);
      continue;
    }
    sawKeyword = true;
    keywordParts.push({
      pythonName: keyword[1],
      tsName: tsExportNameForPythonName(keyword[1]),
      expression: translateKeywordArgumentExpression(keyword[1], keyword[2], nameMap, arrayNames, validatedTypeAliases, mapNames),
    });
  }
  if (keywordParts.length === 0) {
    return null;
  }
  const knownSignatureCall = translateMixedKeywordCallWithKnownInstanceSignature(
    call[1],
    positionalParts,
    keywordParts,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (knownSignatureCall !== null) {
    return knownSignatureCall;
  }
  const knownFunctionSignatureCall = translateMixedKeywordCallWithKnownFunctionSignature(
    call[1],
    positionalParts,
    keywordParts,
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (knownFunctionSignatureCall !== null) {
    return knownFunctionSignatureCall;
  }
  const callee = translateStaticMethodCalleeIfKnown(call[1], nameMap)
    ?? translateExpression(call[1], nameMap, arrayNames, validatedTypeAliases);
  const callPrefix = /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
  const optsExpression = `{ ${keywordParts.map((part) => `${part.tsName}: ${part.expression}`).join(', ')} }`;
  if (positionalParts.length === 0) {
    return `${callPrefix}(${optsExpression})`;
  }

  return `${callPrefix}(${[
    ...positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)),
    optsExpression,
  ].join(', ')})`;
}

function singleCallArgumentText(argsText: string): string {
  const parts = splitTopLevelComma(argsText).filter((part) => part !== '');
  return parts.length === 1 ? parts[0] : argsText.trim();
}

function translateComplexKeywordMethodCall(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  if (splitTopLevelComma(pythonExpression).length > 1) {
    return null;
  }
  const callOpenIndex = finalCallOpenIndex(pythonExpression);
  if (callOpenIndex === null) {
    return null;
  }
  const member = /^(.*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonExpression.slice(0, callOpenIndex));
  if (member === null) {
    return null;
  }
  const argsText = pythonExpression.slice(callOpenIndex + 1, -1);
  if (!argsText.includes('=')) {
    return null;
  }
  const receiverText = member[1];
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(receiverText) || !delimitersBalanced(receiverText)) {
    return null;
  }
  const parts = splitTopLevelComma(argsText);
  const keywordParts: string[] = [];
  const positionalParts: string[] = [];
  let sawKeyword = false;
  for (const part of parts) {
    const keyword = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(part);
    if (keyword === null) {
      if (sawKeyword) {
        return null;
      }
      positionalParts.push(part);
      continue;
    }
    sawKeyword = true;
    keywordParts.push(`${tsExportNameForPythonName(keyword[1])}: ${translateKeywordArgumentExpression(keyword[1], keyword[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
  }
  if (keywordParts.length === 0) {
    return null;
  }
  const receiver = translateExpression(receiverText, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const methodName = tsMemberNameForPythonName(member[2]);
  const optsExpression = `{ ${keywordParts.join(', ')} }`;
  return `${receiver}.${methodName}(${[
    ...positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)),
    optsExpression,
  ].join(', ')})`;
}

function translateVectorOffsetKeywordCall(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const methodCall = finalKeywordMethodCall(pythonExpression);
  if (methodCall === null || methodCall.method !== 'offset') {
    return null;
  }
  const keywordParts = keywordObjectParts(methodCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (keywordParts === null) {
    return null;
  }
  return `${translateExpression(methodCall.receiver, nameMap, arrayNames, validatedTypeAliases, mapNames)}.offset({ ${keywordParts.join(', ')} })`;
}

function finalCallOpenIndex(pythonExpression: string): number | null {
  for (let index = 0; index < pythonExpression.length; index += 1) {
    if (pythonExpression[index] === '(' && matchingCloseParen(pythonExpression, index) === pythonExpression.length - 1) {
      return index;
    }
  }
  return null;
}

function finalKeywordMethodCall(pythonExpression: string): { receiver: string; method: string; argsText: string } | null {
  if (splitTopLevelComma(pythonExpression).length > 1) {
    return null;
  }
  const callOpenIndex = finalCallOpenIndex(pythonExpression);
  if (callOpenIndex === null) {
    return null;
  }
  const member = /^(.*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonExpression.slice(0, callOpenIndex));
  if (member === null) {
    return null;
  }
  const argsText = pythonExpression.slice(callOpenIndex + 1, -1);
  return argsText.includes('=') && delimitersBalanced(member[1])
    ? { receiver: member[1], method: member[2], argsText }
    : null;
}

function keywordObjectParts(
  argsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string[] | null {
  const keywordParts: string[] = [];
  let sawKeyword = false;
  for (const part of splitTopLevelComma(argsText)) {
    const keyword = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(part);
    if (keyword === null) {
      if (sawKeyword) {
        return null;
      }
      continue;
    }
    sawKeyword = true;
    keywordParts.push(`${tsExportNameForPythonName(keyword[1])}: ${translateKeywordArgumentExpression(keyword[1], keyword[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
  }
  return keywordParts.length === 0 ? null : keywordParts;
}

function translateKeywordArgumentExpression(
  pythonKeywordName: string,
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const localReference = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonExpression.trim());
  if (localReference !== null && nameMap.has(localReference[1])) {
    return nameMap.get(localReference[1]) ?? tsExportNameForPythonName(localReference[1]);
  }
  if (localReference !== null && localReference[1].startsWith('_') && keywordNameLooksLikeCallback(pythonKeywordName)) {
    return tsMemberNameForPythonName(localReference[1]);
  }
  const callbackReference = keywordNameLooksLikeCallback(pythonKeywordName)
    ? translateKeywordDetachedMethodReference(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames)
    : null;
  return callbackReference ?? translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
}

function keywordNameLooksLikeCallback(pythonKeywordName: string): boolean {
  return /^(?:apply|build|consume|create|draw|handle|measure|on|play|process|registry|reset|sync|ui|update)(?:_|$)/.test(pythonKeywordName);
}

function translateKeywordDetachedMethodReference(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const reference = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)$/.exec(pythonExpression.trim());
  if (reference === null) {
    return null;
  }
  const parts = reference[1].split('.');
  const receiver = translateExpression(parts.slice(0, -1).join('.'), nameMap, arrayNames, validatedTypeAliases, mapNames);
  return `${receiver}.${tsMemberNameForPythonName(parts[parts.length - 1])}.bind(${receiver})`;
}

function translateMixedKeywordCallWithKnownInstanceSignature(
  pythonCallee: string,
  positionalParts: string[],
  keywordParts: { pythonName: string; tsName: string; expression: string }[],
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const knownMethod = knownInstanceMethodCall(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  if (knownMethod === null) {
    return null;
  }
  const consumedKeywords = new Set<string>();
  const args = positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
  const positionalNames = knownMethod.signature.positional.slice(args.length);
  for (let index = 0; index < positionalNames.length; index += 1) {
    const keywordPart = findKeywordPartForPositional(keywordParts, consumedKeywords, positionalNames[index]);
    if (keywordPart === undefined) {
      if (remainingPositionalNamesHaveKeyword(keywordParts, consumedKeywords, positionalNames.slice(index + 1))) {
        args.push('undefined');
        continue;
      }
      break;
    }
    args.push(keywordPart.expression);
    consumedKeywords.add(keywordPart.pythonName);
  }
  if (consumedKeywords.size === 0) {
    return null;
  }
  const remainingKeywordParts = keywordParts
    .filter((part) => !consumedKeywords.has(part.pythonName))
    .map((part) => `${part.tsName}: ${part.expression}`);
  if (remainingKeywordParts.length > 0) {
    args.push(`{ ${remainingKeywordParts.join(', ')} }`);
  }
  return `${knownMethod.callee}(${args.join(', ')})`;
}

function translateMixedKeywordCallWithKnownFunctionSignature(
  pythonCallee: string,
  positionalParts: string[],
  keywordParts: { pythonName: string; tsName: string; expression: string }[],
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const knownFunction = knownFunctionCall(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  if (knownFunction === null) {
    return null;
  }
  const consumedKeywords = new Set<string>();
  const args = positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
  const positionalNames = knownFunction.signature.positional.slice(args.length);
  for (let index = 0; index < positionalNames.length; index += 1) {
    const keywordPart = findKeywordPartForPositional(keywordParts, consumedKeywords, positionalNames[index]);
    if (keywordPart === undefined) {
      if (remainingPositionalNamesHaveKeyword(keywordParts, consumedKeywords, positionalNames.slice(index + 1))) {
        args.push('undefined');
        continue;
      }
      break;
    }
    args.push(keywordPart.expression);
    consumedKeywords.add(keywordPart.pythonName);
  }
  if (consumedKeywords.size === 0) {
    return null;
  }
  const remainingKeywordParts = keywordParts
    .filter((part) => !consumedKeywords.has(part.pythonName))
    .map((part) => `${part.tsName}: ${part.expression}`);
  if (remainingKeywordParts.length > 0) {
    args.push(`{ ${remainingKeywordParts.join(', ')} }`);
  }
  return `${knownFunction.callee}(${args.join(', ')})`;
}

function findKeywordPartForPositional(
  keywordParts: { pythonName: string; tsName: string; expression: string }[],
  consumedKeywords: ReadonlySet<string>,
  positionalName: string,
): { pythonName: string; tsName: string; expression: string } | undefined {
  return keywordParts.find((part) => (
    !consumedKeywords.has(part.pythonName)
    && (
      part.pythonName === positionalName
      || part.tsName === positionalName
      || `_${part.pythonName}` === positionalName
      || `_${part.tsName}` === positionalName
    )
  ));
}

function remainingPositionalNamesHaveKeyword(
  keywordParts: { pythonName: string; tsName: string; expression: string }[],
  consumedKeywords: ReadonlySet<string>,
  positionalNames: string[],
): boolean {
  return positionalNames.some((positionalName) => (
    findKeywordPartForPositional(keywordParts, consumedKeywords, positionalName) !== undefined
  ));
}

function knownFunctionCall(
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): { callee: string; signature: { positional: string[] } } | null {
  const callee = translateStaticMethodCalleeIfKnown(pythonCallee, nameMap)
    ?? translateExpression(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  const signatureText = nameMap.get(functionSignatureMarker(pythonCallee))
    ?? nameMap.get(functionSignatureMarker(callee))
    ?? nameMap.get(functionSignatureMarker(tsExportNameForPythonName(pythonCallee)));
  if (signatureText === undefined) {
    if (pythonCallee === 'create_console' || pythonCallee === 'createConsole') {
      return { callee, signature: { positional: ['base_dir', 'assets_dir'] } };
    }
    return null;
  }
  try {
    const signature = JSON.parse(signatureText) as { positional?: unknown };
    if (!Array.isArray(signature.positional) || !signature.positional.every((part) => typeof part === 'string')) {
      return null;
    }
    return { callee, signature: { positional: signature.positional } };
  } catch {
    return null;
  }
}

function knownInstanceMethodCall(
  pythonCallee: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): { callee: string; signature: FunctionCallSignature } | null {
  const dotted = /^(.+)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(pythonCallee);
  if (dotted === null) {
    return null;
  }
  const receiver = translateExpression(dotted[1], nameMap, arrayNames, validatedTypeAliases);
  const receiverType = nullableTypeExpressionBase(
    nameMap.get(receiverTypeNameMarker(dotted[1])) ?? nameMap.get(receiverTypeNameMarker(receiver)) ?? null,
  );
  if (receiverType === undefined) {
    return null;
  }
  const methodName = tsMemberNameForPythonName(dotted[2]);
  const signature = parseFunctionCallSignature(inheritedInstanceMethodSignature(receiverType, methodName, nameMap));
  return signature === null
    ? null
    : { callee: `${receiver}.${methodName}`, signature };
}

function inheritedInstanceMethodSignature(
  receiverType: string,
  methodName: string,
  nameMap: Map<string, string>,
): string | undefined {
  let currentType: string | undefined = nullableTypeExpressionBase(receiverType) ?? receiverType;
  const seen = new Set<string>();
  while (currentType !== undefined && !seen.has(currentType)) {
    seen.add(currentType);
    const signature = nameMap.get(instanceMethodSignatureMarker(currentType, methodName));
    if (signature !== undefined) {
      return signature;
    }
    currentType = nameMap.get(classBaseTypeMarker(currentType));
  }
  return undefined;
}

function translateMixedKeywordCallWithRest(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): string | null {
  const call = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(/.exec(pythonExpression);
  if (call === null) {
    return null;
  }
  const closeIndex = matchingCloseParen(pythonExpression, call[1].length);
  if (closeIndex === null) {
    return null;
  }
  const rest = pythonExpression.slice(closeIndex + 1);
  if (!rest.startsWith('.') || !pythonExpression.slice(call[1].length + 1, closeIndex).includes('=')) {
    return null;
  }
  const translatedCall = translateMixedKeywordCall(
    pythonExpression.slice(0, closeIndex + 1),
    nameMap,
    arrayNames,
    validatedTypeAliases,
    mapNames,
  );
  if (translatedCall === null) {
    return null;
  }
  return `${translatedCall}${translateAttributeRest(rest)}`;
}

function pythonContainsExpression(containerExpression: string, valueExpression: string): string {
  return `((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(${containerExpression}, ${valueExpression})`;
}

function expressionCanBeTypeArgument(expression: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(expression);
}
