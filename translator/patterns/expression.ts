import { tsExportNameForPythonName, tsTypeExpression } from '../naming.js';
import {
  combinePythonStringExpressions,
  parsePythonStringExpression,
  splitTopLevelComma,
  tsStringLiteral,
} from './common.js';

export function tsRegExpExpression(pythonLiteral: string): string {
  const literal = /^([rRfF]{0,2})(["'])([\s\S]*)\2$/.exec(pythonLiteral);
  if (literal === null) {
    return `new RegExp(${translateExpression(pythonLiteral)})`;
  }

  const prefix = literal[1].toLowerCase();
  const content = literal[3];
  if (prefix.includes('f')) {
    return `new RegExp(\`${tsFStringTemplateContent(content)}\`)`;
  }

  return `new RegExp(${JSON.stringify(content)})`;
}

export function tsFStringTemplateContent(
  content: string,
  nameMap: Map<string, string> = new Map(),
  arrayNames: Set<string> = new Set(),
  validatedTypeAliases: ReadonlySet<string> = new Set(),
): string {
  let translated = '';
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];
    if (char === '{' && next === '{') {
      translated += '{';
      index += 1;
      continue;
    }
    if (char === '}' && next === '}') {
      translated += '}';
      index += 1;
      continue;
    }
    if (char === '{') {
      const closeIndex = content.indexOf('}', index + 1);
      if (closeIndex !== -1) {
        const expression = content.slice(index + 1, closeIndex).trim();
        const formatSeparator = expression.indexOf(':');
        let expressionText = formatSeparator === -1 ? expression : expression.slice(0, formatSeparator).trim();
        const format = formatSeparator === -1 ? null : expression.slice(formatSeparator + 1).trim();
        const conversion = /^(.*)!([rsa])$/.exec(expressionText);
        expressionText = conversion === null ? expressionText : conversion[1].trim();
        const baseExpression = translateExpression(expressionText, nameMap, arrayNames, validatedTypeAliases);
        const translatedExpression = conversion?.[2] === 'r' || conversion?.[2] === 'a'
          ? `pythonRepr(${baseExpression})`
          : baseExpression === 'exc'
            ? 'exc instanceof Error ? exc.message : String(exc)'
            : baseExpression;
        const zeroPaddedInteger = format === null ? null : /^0(\d+)d$/.exec(format);
        if (zeroPaddedInteger !== null) {
          translated += `\${String(${translatedExpression}).padStart(${zeroPaddedInteger[1]}, '0')}`;
        } else {
          translated += `\${${translatedExpression}}`;
        }
        index = closeIndex;
        continue;
      }
    }
    if (char === '\\') {
      translated += '\\\\';
      continue;
    }
    if (char === '`') {
      translated += '\\`';
      continue;
    }
    if (char === '$' && next === '{') {
      translated += '\\$';
      continue;
    }
    translated += char;
  }
  return translated;
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
  const callee = translateCallCalleeExpression(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  const args = positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
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
  const reorderedArgs = (callee === 'rl.rlSetBlendFactorsSeparate' || callee === 'wgl.rlSetBlendFactorsSeparate') && args.length === 6
    ? [args[0], args[1], args[4], args[2], args[3], args[5]]
    : args;
  const callPrefix = constructUppercase && /^[A-Z]/.test(callee) ? `new ${callee}` : callee;
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
  return translateBoundMethodReference(pythonExpression, nameMap, arrayNames, validatedTypeAliases)
    ?? translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
}

function translateCallCalleeExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): string {
  return translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases)
    .replace(/\.append$/, '.push')
    .replace(/\.extend$/, '.push');
}

function translateBoundMethodReference(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): string | null {
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

export function vectorNameMarker(name: string): string {
  return `__vector__:${name}`;
}

export function stringNameMarker(name: string): string {
  return `__string__:${name}`;
}

export function colorNameMarker(name: string): string {
  return `__color__:${name}`;
}

export function rectangleNameMarker(name: string): string {
  return `__rectangle__:${name}`;
}

export function setNameMarker(name: string): string {
  return `__set__:${name}`;
}

export function objectNameMarker(name: string): string {
  return `__object__:${name}`;
}

export function dateNameMarker(name: string): string {
  return `__date__:${name}`;
}

export function pathNameMarker(name: string): string {
  return `__path__:${name}`;
}

export function pathArrayNameMarker(name: string): string {
  return `__path_array__:${name}`;
}

export function nullableNameMarker(name: string): string {
  return `__nullable__:${name}`;
}

export function translatedExpressionLooksVector(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  if (/^(?:Vec2\.|new Vec2\b)/.test(trimmed) && !/\.(?:length|toHeading)\(\)$/.test(trimmed)) {
    return true;
  }
  if (/\.(?:aim|pos|vel)$/.test(trimmed)) {
    return true;
  }
  return finalVectorMethodCall(trimmed);
}

export function translateExpression(
  pythonExpression: string,
  nameMap: Map<string, string> = new Map(),
  arrayNames: Set<string> = new Set(),
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): string {
  const trimmed = pythonExpression.trim();
  const lambdaExpression = translateInlineLambdaExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (lambdaExpression !== null) {
    return lambdaExpression;
  }
  const bytesLiteral = parseBytesLiteral(trimmed);
  if (bytesLiteral !== null) {
    return `new Uint8Array([${bytesLiteral.join(', ')}])`;
  }

  const pathlibReadBytes = /^Path\((.+)\)\.read_bytes\(\)$/.exec(trimmed);
  if (pathlibReadBytes !== null) {
    return `readFileSync(String(${translateExpression(pathlibReadBytes[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}))`;
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
  if (trimmed === 'os.getpid()') {
    return 'globalThis.process?.pid ?? 0';
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
      return `${translateExpression(raylibColorConstant[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.makeColor(${color.join(', ')})`;
    }
  }

  const raylibInputNoArgCall = /^(?:r[dl]|wgl)\.(get_char_pressed|getCharPressed|get_key_pressed|getKeyPressed)\(\)$/.exec(trimmed);
  if (raylibInputNoArgCall !== null) {
    return raylibInputNoArgCall[1].includes('char') || raylibInputNoArgCall[1].includes('Char')
      ? 'InputState.getCharPressed()'
      : 'InputState.getKeyPressed()';
  }

  const raylibKeyInputCall = /^(?:r[dl]|wgl)\.(is_key_pressed|isKeyPressed|is_key_pressed_repeat|isKeyPressedRepeat|is_key_down|isKeyDown)\((.*)\)$/.exec(trimmed);
  if (raylibKeyInputCall !== null) {
    const method = raylibKeyInputCall[1].includes('repeat') || raylibKeyInputCall[1].includes('Repeat')
      ? 'wasKeyPressedRepeat'
      : raylibKeyInputCall[1].includes('down') || raylibKeyInputCall[1].includes('Down') ? 'isKeyDown' : 'wasKeyPressed';
    return `InputState.${method}(${translateExpression(raylibKeyInputCall[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
      return `super(${args.join(', ')})`;
    }
    return `super.${tsMemberNameForPythonName(superMethodCall[1])}(${args.join(', ')})`;
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

  const pathNameAttribute = /^(.+)\.name$/.exec(trimmed);
  if (pathNameAttribute !== null) {
    const receiver = translateExpression(pathNameAttribute[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(pathNameMarker(pathNameAttribute[1])) || arrayNames.has(pathNameMarker(receiver))) {
      return `_basename(String(${receiver}))`;
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
  }

  const constructField = parseConstructFieldExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (constructField !== null) {
    return constructField;
  }

  const constructExpression = translateConstructExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (constructExpression !== null) {
    return constructExpression;
  }

  const stringJoinCall = /^((?:[fF])?(["'])(?:\\.|(?!\2)[\s\S])*\2)\.join\((.+)\)$/.exec(trimmed);
  if (stringJoinCall !== null) {
    const separator = parsePythonStringExpression(stringJoinCall[1]);
    if (separator !== null) {
      return `${translateExpression(stringJoinCall[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}.join(${JSON.stringify(separator.content)})`;
    }
  }

  const stringReplaceCall = /^(.+)\.replace\((.*)\)$/.exec(trimmed);
  if (stringReplaceCall !== null) {
    const args = splitTopLevelComma(stringReplaceCall[2]);
    if (args.length === 2 && parsePythonStringExpression(args[0]) !== null) {
      return `${translateExpression(stringReplaceCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.replaceAll(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const stringSplitlinesCall = /^(.+)\.splitlines\(\)$/.exec(trimmed);
  if (stringSplitlinesCall !== null) {
    return `pythonSplitlines(${translateExpression(stringSplitlinesCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
      translateExpression(earlyConditionalExpression.condition, nameMap, arrayNames, validatedTypeAliases, mapNames),
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
    return `new Map(Array.from(${translateExpression(dictComprehension[4], nameMap, arrayNames, validatedTypeAliases, mapNames)}, (${itemName}) => [${translateExpression(dictComprehension[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(dictComprehension[2], itemNameMap, arrayNames, validatedTypeAliases, mapNames)}] as const))`;
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

  const boolCall = parseCallPrefix(trimmed, 'bool');
  if (boolCall !== null && boolCall.rest === '') {
    return translateBooleanCast(boolCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
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
      if (sortKeys === 'True') {
        const opts = [`sortKeys: true`];
        if (indent !== undefined) {
          opts.push(`indent: ${translateExpression(indent, nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
        }
        return `pythonJsonDumps(${translatedValue}, { ${opts.join(', ')} })`;
      }
      return `JSON.stringify(${translatedValue}, null, ${indent === undefined ? '0' : translateExpression(indent, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const listComprehension = parseSimpleListComprehension(trimmed);
  if (listComprehension !== null) {
    const itemName = tsExportNameForPythonName(listComprehension.itemName);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(listComprehension.itemName, itemName);
    const iterable = translateExpression(listComprehension.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const translatedItem = translateExpression(listComprehension.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames);
    const filtered = listComprehension.condition === null
      ? iterable
      : `${iterable}.filter((${itemName}) => ${translateExpression(listComprehension.condition!, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    return listComprehension.condition !== null && translatedItem === itemName
      ? filtered
      : `${filtered}.map((${itemName}) => ${translatedItem})`;
  }

  const aggregateGenerator = translateAggregateGeneratorCall(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (aggregateGenerator !== null) {
    return aggregateGenerator;
  }

  for (const [pythonName, tsMethod] of [['any', 'some'], ['all', 'every']] as const) {
    const generatorCall = parseCallPrefix(trimmed, pythonName);
    if (generatorCall !== null && generatorCall.rest === '') {
      const generator = /^(.+?)(?:,)? for ([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec(generatorCall.argsText.trim());
      if (generator !== null) {
        const itemName = tsExportNameForPythonName(generator[2]);
        const itemNameMap = new Map(nameMap);
        itemNameMap.set(generator[2], itemName);
        return `${translateExpression(generator[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}.${tsMethod}((${itemName}) => ${translateExpression(generator[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
    if (mapNames.has(mapName)) {
      const key = translateMapKeyExpression(mapName, value);
      return `!${mapName}.has(${key})`;
    }
    return `!${pythonContainsExpression(mapName, value)}`;
  }

  const mapMembership = /^(.+) in ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
  if (mapMembership !== null && !hasTopLevelLogicalOperator) {
    const mapName = translateExpression(mapMembership[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const value = translateExpression(mapMembership[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      const key = translateMapKeyExpression(mapName, value);
      return `${mapName}.has(${key})`;
    }
    return pythonContainsExpression(mapName, value);
  }

  const mapItemsCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.items\(\)$/.exec(trimmed);
  if (mapItemsCall !== null) {
    const mapName = translateExpression(mapItemsCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      return `${mapName}.entries()`;
    }
    return `Object.entries(${mapName})`;
  }

  const mappingConstantSubscript = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(trimmed);
  if (mappingConstantSubscript !== null && looksLikeMappingConstantName(mappingConstantSubscript[1])) {
    const mapName = translateExpression(mappingConstantSubscript[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const key = translateMapKeyExpression(mapName, translateExpression(mappingConstantSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames));
    return `${mapName}.get(${key})!`;
  }

  const mapSubscript = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(trimmed);
  if (mapSubscript !== null) {
    const mapName = translateExpression(mapSubscript[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      const key = translateMapKeyExpression(mapName, translateExpression(mapSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames));
      return `${mapName}.get(${key})!`;
    }
  }

  const envComparison = /^os\.environ\.get\("([A-Za-z_][A-Za-z0-9_]*)"\) == "([^"]*)"$/.exec(trimmed);
  if (envComparison !== null) {
    return `typeof process !== 'undefined' && process.env?.${envComparison[1]} === '${envComparison[2]}'`;
  }

  const typeNameAttribute = /^type\((.+)\)\.__name__$/.exec(trimmed);
  if (typeNameAttribute !== null) {
    const value = translateExpression(typeNameAttribute[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `((valueForType: unknown) => valueForType === null ? 'NoneType' : Array.isArray(valueForType) ? 'list' : valueForType instanceof Map ? 'dict' : typeof valueForType === 'boolean' ? 'bool' : typeof valueForType === 'number' ? Number.isInteger(valueForType) ? 'int' : 'float' : typeof valueForType === 'string' ? 'str' : typeof valueForType === 'object' ? 'dict' : typeof valueForType)(${value})`;
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

  for (const sequenceConstructor of ['list', 'tuple']) {
    const sequenceCall = parseCallPrefix(trimmed, sequenceConstructor);
    if (sequenceCall !== null && sequenceCall.rest === '') {
      const argsText = sequenceCall.argsText.trim();
      if (argsText === '') {
        return '[]';
      }
      const generator = /^(.+?)(?:,)? for ([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec(argsText);
      if (generator !== null) {
        const itemName = tsExportNameForPythonName(generator[2]);
        const itemNameMap = new Map(nameMap);
        itemNameMap.set(generator[2], itemName);
        return `${translateExpression(generator[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}.map((${itemName}) => ${translateExpression(generator[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
      }
      return `Array.from(${translateExpression(argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const rangeCall = parseCallPrefix(trimmed, 'range');
  if (rangeCall !== null && rangeCall.rest === '') {
    const args = splitTopLevelComma(rangeCall.argsText);
    if (args.length === 1) {
      const stop = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `Array.from({ length: Math.max(0, ${stop}) }, (_, i) => i)`;
    }
    if (args.length === 2) {
      const start = translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const stop = translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `Array.from({ length: Math.max(0, ${stop} - ${start}) }, (_, i) => ${start} + i)`;
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

  const msgspecToBuiltinsCall = parseCallPrefix(trimmed, 'msgspec.to_builtins');
  if (msgspecToBuiltinsCall !== null && msgspecToBuiltinsCall.rest === '') {
    return `structuredClone(${translateExpression(msgspecToBuiltinsCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const isinstanceSequence = /^isinstance\((.+), \((.+)\)\)$/.exec(trimmed);
  if (isinstanceSequence !== null) {
    const types = splitTopLevelComma(isinstanceSequence[2]);
    if (types.length > 0 && types.every((type) => type === 'list' || type === 'tuple')) {
      return `Array.isArray(${translateExpression(isinstanceSequence[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }
  const isinstanceSingleSequence = /^isinstance\((.+), (list|tuple)\)$/.exec(trimmed);
  if (isinstanceSingleSequence !== null) {
    return `Array.isArray(${translateExpression(isinstanceSingleSequence[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  const isinstancePrimitive = /^isinstance\((.+), (bool|int|float|str|dict)\)$/.exec(trimmed);
  if (isinstancePrimitive !== null) {
    const value = translateExpression(isinstancePrimitive[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (isinstancePrimitive[2] === 'bool') {
      return `typeof ${value} === 'boolean'`;
    }
    if (isinstancePrimitive[2] === 'int') {
      return `typeof ${value} === 'number' && Number.isInteger(${value})`;
    }
    if (isinstancePrimitive[2] === 'float') {
      return `typeof ${value} === 'number'`;
    }
    if (isinstancePrimitive[2] === 'str') {
      return `typeof ${value} === 'string'`;
    }
    return `typeof ${value} === 'object' && ${value} !== null && !Array.isArray(${value})`;
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

  const fStringLiteral = /^f(["'])([\s\S]*)\1$/.exec(trimmed);
  if (fStringLiteral !== null) {
    return `\`${tsFStringTemplateContent(fStringLiteral[2], nameMap, arrayNames, validatedTypeAliases)}\``;
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
    return `bytesFrom(${translateExpression(bytesCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
          ? `Reflect.get(${objectExpression}, ${property})`
          : `Reflect.get(${objectExpression}, ${property}) ?? ${fallback}`;
      }
    }
  }

  const reprCall = parseCallPrefix(trimmed, 'repr');
  if (reprCall !== null && reprCall.rest === '') {
    return `String(${translateExpression(reprCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const lenCall = parseCallPrefix(trimmed, 'len');
  if (lenCall !== null && lenCall.rest === '') {
    const value = translateExpression(lenCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(value)) {
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
    return `${value}.length`;
  }

  const castCall = parseCallPrefix(trimmed, 'cast');
  if (castCall !== null && castCall.rest === '') {
    const args = splitTopLevelComma(castCall.argsText);
    if (args.length === 2) {
      return translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    }
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
    return `int(${translateExpression(intCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
      return `new Set(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
      return `{ ...${source.includes(' ') ? `(${source})` : source} }`;
    }
  }

  const pathCall = parseCallPrefix(trimmed, 'Path');
  if (pathCall !== null && pathCall.rest === '') {
    return translateExpression(pathCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames);
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

  const earlyDictGet = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|\{[\s\S]+\})\.get\((.*)\)$/.exec(trimmed);
  if (earlyDictGet !== null) {
    const parts = splitTopLevelComma(earlyDictGet[2]);
    if (parts.length === 1 || parts.length === 2) {
      const inlineMap = translateInlineDictMapExpression(earlyDictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const mapName = inlineMap ?? translateExpression(earlyDictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const key = translateMapKeyExpression(mapName, translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames));
      const value = inlineMap === null && (arrayNames.has(objectNameMarker(earlyDictGet[1])) || arrayNames.has(objectNameMarker(mapName)))
        ? `${mapName}[${key}]`
        : `${mapName}.get(${key})`;
      return parts.length === 1 ? `${value} ?? null` : `${value} ?? ${translateExpression(parts[1], nameMap, arrayNames, validatedTypeAliases)}`;
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
    && pathJoin.parts.some((part) => parsePythonStringExpression(part) !== null || /^f["']/.test(part) || parseCallPrefix(part, 'Path') !== null)
  ) {
    return `_pathJoin(${pathJoin.parts.map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
  }

  if (trimmed === 'Lock()') {
    return 'null';
  }

  if (trimmed === 'OrderedDict()') {
    return 'new Map()';
  }

  const msgpackEncoderCall = parseCallPrefix(trimmed, 'msgspec.msgpack.Encoder');
  if (msgpackEncoderCall !== null && msgpackEncoderCall.rest === '') {
    return 'new MsgpackEncoder()';
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
    return `new MsgpackDecoder({ type: ${typeExpression} })`;
  }

  const zeroArgConstructor = /^([A-Z][A-Za-z0-9_]*)\(\)$/.exec(trimmed);
  if (zeroArgConstructor !== null) {
    return `new ${tsExportNameForPythonName(zeroArgConstructor[1])}()`;
  }

  const dictGet = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|\{[\s\S]+\})\.get\((.*)\)$/.exec(trimmed);
  if (dictGet !== null) {
    const parts = splitTopLevelComma(dictGet[2]);
    if (parts.length === 1 || parts.length === 2) {
      const inlineMap = translateInlineDictMapExpression(dictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const mapName = inlineMap ?? translateExpression(dictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const key = translateMapKeyExpression(mapName, translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames));
      const value = inlineMap === null && (arrayNames.has(objectNameMarker(dictGet[1])) || arrayNames.has(objectNameMarker(mapName)))
        ? `${mapName}[${key}]`
        : `${mapName}.get(${key})`;
      return parts.length === 1 ? `${value} ?? null` : `${value} ?? ${translateExpression(parts[1], nameMap, arrayNames, validatedTypeAliases)}`;
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
  if (vectorScale !== null && expressionIsKnownVector(vectorScale.left, nameMap, arrayNames)) {
    return `${translateExpression(vectorScale.left, nameMap, arrayNames, validatedTypeAliases, mapNames)}.mul(${translateExpression(stripBalancedOuterParens(vectorScale.right), nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const parenthesizedVectorMethod = parseParenthesizedVectorMethodCall(trimmed);
  if (parenthesizedVectorMethod !== null) {
    const receiver = translateExpression(parenthesizedVectorMethod.receiver, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (expressionIsKnownVector(parenthesizedVectorMethod.receiver, nameMap, arrayNames) || translatedExpressionLooksVector(receiver)) {
      return `${receiver}.${tsExportNameForPythonName(parenthesizedVectorMethod.method)}(${parenthesizedVectorMethod.args.map((arg) => translateCallArgumentExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
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

  const mixedKeywordCall = translateMixedKeywordCall(trimmed, nameMap, arrayNames, validatedTypeAliases);
  if (mixedKeywordCall !== null) {
    return mixedKeywordCall;
  }
  const mixedKeywordCallWithRest = translateMixedKeywordCallWithRest(trimmed, nameMap, arrayNames, validatedTypeAliases);
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
      translateExpression(conditionalExpression.condition, nameMap, arrayNames, validatedTypeAliases, mapNames),
      '?',
      translateExpression(conditionalExpression.trueExpression, nameMap, arrayNames, validatedTypeAliases, mapNames),
      ':',
      translateExpression(conditionalExpression.falseExpression, nameMap, arrayNames, validatedTypeAliases, mapNames),
    ].join(' ');
  }

  if (trimmed.startsWith('(') && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner.includes(',') && (inner.includes(' and ') || inner.includes(' or ') || /\[[^\]]*:[^\]]*\]/.test(inner))) {
      return `(${translateExpression(inner, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  const topLevelOrParts = splitTopLevelLogicalOperator(trimmed, 'or');
  if (topLevelOrParts !== null) {
    return topLevelOrParts
      .map((part) => parenthesizeForLogicalOr(translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)))
      .join(' || ');
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
    if (mapNames.has(value)) {
      return `${value}.size === 0`;
    }
    return arrayNames.has(notIdentifier[1]) || arrayNames.has(value) ? `${value}.length === 0` : `!${value}`;
  }

  const notPlayersCollection = /^not ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\.players)$/.exec(trimmed);
  if (notPlayersCollection !== null) {
    return `${translateExpression(notPlayersCollection[1], nameMap, arrayNames, validatedTypeAliases)}.length === 0`;
  }

  const notExpression = /^not (.+)$/.exec(trimmed);
  if (notExpression !== null) {
    const operand = stripBalancedOuterParens(notExpression[1]);
    const value = translateExpression(operand, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(operand) || arrayNames.has(value)) {
      return `${value}.length === 0`;
    }
    if (/^[A-Za-z_$][A-Za-z0-9_.$]*\(.*\)$/.test(value)) {
      return `!${value}`;
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
      .map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
    return `[${values.join(', ')}]`;
  }

  const topLevelTupleParts = splitTopLevelComma(trimmed);
  if (topLevelTupleParts.length > 1) {
    return `[${topLevelTupleParts.map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')}]`;
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
    return `${translateExpression(stripBalancedOuterParens(modulo.left), nameMap, arrayNames, validatedTypeAliases, mapNames)} % ${translateExpression(stripBalancedOuterParens(modulo.right), nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const additiveWithFloorDivision = /^(.+?) ([+-]) (.+ \/\/ .+)$/.exec(trimmed);
  if (additiveWithFloorDivision !== null) {
    return `${translateExpression(additiveWithFloorDivision[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} ${additiveWithFloorDivision[2]} ${translateExpression(additiveWithFloorDivision[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const floorDivision = splitTopLevelFloorDivision(trimmed);
  if (floorDivision !== null) {
    return `Math.floor(${translateExpression(floorDivision.left, nameMap, arrayNames, validatedTypeAliases, mapNames)} / ${translateExpression(floorDivision.right, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const uint32Mask = /^(.+) & 0xFFFFFFFF$/i.exec(trimmed);
  if (uint32Mask !== null) {
    return `(${translateExpression(uint32Mask[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} >>> 0)`;
  }

  const identityComparison = /^(.+?) is( not)? (.+)$/.exec(trimmed);
  if (identityComparison !== null) {
    return `${translateExpression(identityComparison[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} ${identityComparison[2] === undefined ? '===' : '!=='} ${translateExpression(identityComparison[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const binaryComparison = /^(.+?) (<=|>=|<|>|==|!=) (.+)$/.exec(trimmed);
  if (binaryComparison !== null) {
    const left = translateExpression(binaryComparison[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(binaryComparison[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return translateComparisonClause(left, binaryComparison[2], right, arrayNames);
  }

  const prefixSlice = /^(.+)\[:(.+)\]$/.exec(trimmed);
  if (prefixSlice !== null) {
    return `${translateExpression(prefixSlice[1], nameMap, arrayNames, validatedTypeAliases)}.slice(0, ${translateExpression(prefixSlice[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const openEndedSlice = /^(.+)\[(.+):\]$/.exec(trimmed);
  if (openEndedSlice !== null) {
    return `${translateExpression(openEndedSlice[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.slice(${translateExpression(openEndedSlice[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const enumIdCast = /^([A-Z][A-Za-z0-9_]*Id)\((.+)\)$/.exec(trimmed);
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
      return `new ${tsExportNameForPythonName(`_${privatePositionalConstructor[1]}`)}(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
  }

  const positionalConstructor = /^([A-Z][A-Za-z0-9_]*)\((.*)\)$/.exec(trimmed);
  if (positionalConstructor !== null) {
    const args = splitTopLevelComma(positionalConstructor[2]);
    if (args.every((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))) {
      if (positionalConstructor[1] === 'String') {
        return `String(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
      }
      return `new ${tsExportNameForPythonName(positionalConstructor[1])}(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
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
      return arrayNames.has(stringNameMarker(name)) || arrayNames.has(stringNameMarker(translatedName))
        ? `Array.from(${translatedName}).length`
        : `${translatedName}.length`;
    })
    .replaceAll(/\.append\(/g, '.push(')
    .replaceAll(/\.extend\(/g, '.push(...')
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
    .replaceAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (name) => {
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

function translateIdentifierName(name: string, nameMap: Map<string, string>): string {
  if (!name.includes('.')) {
    return nameMap.get(name) ?? tsExportNameForPythonName(name);
  }
  const parts = name.split('.');
  const root = nameMap.get(parts[0]) ?? tsExportNameForPythonName(parts[0]);
  return [
    root,
    ...parts.slice(1).map((part) => nameMap.get(part) ?? tsExportNameForPythonName(part)),
  ].join('.');
}

function translateIdentifierNamePreservingPrivateMembers(name: string, nameMap: Map<string, string>): string {
  if (!name.includes('.')) {
    return nameMap.get(name) ?? tsExportNameForPythonName(name);
  }
  const parts = name.split('.');
  const root = nameMap.get(parts[0]) ?? tsExportNameForPythonName(parts[0]);
  return [
    root,
    ...parts.slice(1).map((part) => nameMap.get(part) ?? tsMemberNameForPythonName(part)),
  ].join('.');
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

function raylibKeyboardKeyCode(name: string): number | null {
  const keyCodes: Record<string, number> = {
    KEY_NULL: 0,
    KEY_SPACE: 32,
    KEY_APOSTROPHE: 222,
    KEY_COMMA: 188,
    KEY_MINUS: 189,
    KEY_PERIOD: 190,
    KEY_SLASH: 191,
    KEY_ZERO: 48,
    KEY_ONE: 49,
    KEY_TWO: 50,
    KEY_THREE: 51,
    KEY_FOUR: 52,
    KEY_FIVE: 53,
    KEY_SIX: 54,
    KEY_SEVEN: 55,
    KEY_EIGHT: 56,
    KEY_NINE: 57,
    KEY_SEMICOLON: 186,
    KEY_EQUAL: 187,
    KEY_A: 65,
    KEY_B: 66,
    KEY_C: 67,
    KEY_D: 68,
    KEY_E: 69,
    KEY_F: 70,
    KEY_G: 71,
    KEY_H: 72,
    KEY_I: 73,
    KEY_J: 74,
    KEY_K: 75,
    KEY_L: 76,
    KEY_M: 77,
    KEY_N: 78,
    KEY_O: 79,
    KEY_P: 80,
    KEY_Q: 81,
    KEY_R: 82,
    KEY_S: 83,
    KEY_T: 84,
    KEY_U: 85,
    KEY_V: 86,
    KEY_W: 87,
    KEY_X: 88,
    KEY_Y: 89,
    KEY_Z: 90,
    KEY_LEFT_BRACKET: 219,
    KEY_BACKSLASH: 220,
    KEY_RIGHT_BRACKET: 221,
    KEY_GRAVE: 192,
    KEY_ESCAPE: 27,
    KEY_ENTER: 13,
    KEY_TAB: 9,
    KEY_BACKSPACE: 8,
    KEY_INSERT: 45,
    KEY_DELETE: 46,
    KEY_RIGHT: 39,
    KEY_LEFT: 37,
    KEY_DOWN: 40,
    KEY_UP: 38,
    KEY_PAGE_UP: 33,
    KEY_PAGE_DOWN: 34,
    KEY_HOME: 36,
    KEY_END: 35,
    KEY_CAPS_LOCK: 20,
    KEY_SCROLL_LOCK: 145,
    KEY_NUM_LOCK: 144,
    KEY_PRINT_SCREEN: 44,
    KEY_PAUSE: 19,
    KEY_F1: 112,
    KEY_F2: 113,
    KEY_F3: 114,
    KEY_F4: 115,
    KEY_F5: 116,
    KEY_F6: 117,
    KEY_F7: 118,
    KEY_F8: 119,
    KEY_F9: 120,
    KEY_F10: 121,
    KEY_F11: 122,
    KEY_F12: 123,
    KEY_LEFT_SHIFT: 16,
    KEY_LEFT_CONTROL: 17,
    KEY_LEFT_ALT: 18,
    KEY_RIGHT_SHIFT: 16,
    KEY_RIGHT_CONTROL: 17,
    KEY_RIGHT_ALT: 18,
    KEY_KP_0: 96,
    KEY_KP_1: 97,
    KEY_KP_2: 98,
    KEY_KP_3: 99,
    KEY_KP_4: 100,
    KEY_KP_5: 101,
    KEY_KP_6: 102,
    KEY_KP_7: 103,
    KEY_KP_8: 104,
    KEY_KP_9: 105,
    KEY_KP_DECIMAL: 110,
    KEY_KP_DIVIDE: 111,
    KEY_KP_MULTIPLY: 106,
    KEY_KP_SUBTRACT: 109,
    KEY_KP_ADD: 107,
    KEY_KP_ENTER: 13,
    KEY_KP_EQUAL: 187,
  };
  return keyCodes[name] ?? null;
}

function raylibNamedColor(name: string): [number, number, number, number] | null {
  const colors: Record<string, [number, number, number, number]> = {
    LIGHTGRAY: [200 / 255, 200 / 255, 200 / 255, 1],
    GRAY: [130 / 255, 130 / 255, 130 / 255, 1],
    DARKGRAY: [80 / 255, 80 / 255, 80 / 255, 1],
    YELLOW: [253 / 255, 249 / 255, 0, 1],
    GOLD: [1, 203 / 255, 0, 1],
    ORANGE: [1, 161 / 255, 0, 1],
    PINK: [1, 109 / 255, 194 / 255, 1],
    RED: [230 / 255, 41 / 255, 55 / 255, 1],
    MAROON: [190 / 255, 33 / 255, 55 / 255, 1],
    GREEN: [0, 228 / 255, 48 / 255, 1],
    LIME: [0, 158 / 255, 47 / 255, 1],
    DARKGREEN: [0, 117 / 255, 44 / 255, 1],
    SKYBLUE: [102 / 255, 191 / 255, 1, 1],
    BLUE: [0, 121 / 255, 241 / 255, 1],
    DARKBLUE: [0, 82 / 255, 172 / 255, 1],
    PURPLE: [200 / 255, 122 / 255, 1, 1],
    VIOLET: [135 / 255, 60 / 255, 190 / 255, 1],
    DARKPURPLE: [112 / 255, 31 / 255, 126 / 255, 1],
    BEIGE: [211 / 255, 176 / 255, 131 / 255, 1],
    BROWN: [127 / 255, 106 / 255, 79 / 255, 1],
    DARKBROWN: [76 / 255, 63 / 255, 47 / 255, 1],
    WHITE: [1, 1, 1, 1],
    BLACK: [0, 0, 0, 1],
    BLANK: [0, 0, 0, 0],
    MAGENTA: [1, 0, 1, 1],
    RAYWHITE: [245 / 255, 245 / 255, 245 / 255, 1],
  };
  return colors[name] ?? null;
}

function shouldPreservePrivateDottedName(pythonName: string): boolean {
  return pythonName.startsWith('self.');
}

function tsMemberNameForPythonName(pythonName: string): string {
  if (pythonName.startsWith('__') && pythonName.endsWith('__')) {
    return pythonName;
  }
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
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
    .map((operator, index) => translateComparisonClause(parts[index], operator, parts[index + 1], arrayNames))
    .join(' && ');
}

function translateComparisonClause(left: string, operator: string, right: string, arrayNames: ReadonlySet<string>): string {
  const leftOperand = parenthesizeComparisonOperand(left);
  const rightOperand = parenthesizeComparisonOperand(right);
  if ((operator === '==' || operator === '!=') && comparisonNeedsPythonEquality(left, right, arrayNames)) {
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

function tsComparisonOperator(operator: string): string {
  if (operator === '==') {
    return '===';
  }
  if (operator === '!=') {
    return '!==';
  }
  return operator;
}

function comparisonNeedsPythonEquality(left: string, right: string, arrayNames: ReadonlySet<string>): boolean {
  return /\bnew [A-Z][A-Za-z0-9_$]*\(/.test(left)
    || /\bnew [A-Z][A-Za-z0-9_$]*\(/.test(right)
    || arrayNames.has(objectNameMarker(left))
    || arrayNames.has(objectNameMarker(right));
}

export function translateMapKeyExpression(mapName: string, keyExpression: string): string {
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
    const generatorArg = args.find((arg) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg));
    if (generatorArg === undefined) {
      continue;
    }
    const generator = parseSimpleGeneratorExpression(generatorArg);
    if (generator === null) {
      continue;
    }
    const itemName = tsExportNameForPythonName(generator.itemName);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(generator.itemName, itemName);
    const values = `Array.from(${translateExpression(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames)}, (${itemName}) => ${translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    const defaultArg = args
      .map((arg) => /^default=(.+)$/.exec(arg))
      .find((match): match is RegExpExecArray => match !== null);
    if (defaultArg === undefined) {
      return `${tsName}(...${values})`;
    }
    const defaultValue = translateExpression(defaultArg[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `(() => { const values = ${values}; return values.length === 0 ? ${defaultValue} : ${tsName}(...values); })()`;
  }
  return null;
}

function parseTopLevelConditionalExpression(
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

function parseSimpleGeneratorExpression(pythonExpression: string): { expression: string; itemName: string; iterable: string } | null {
  const trimmed = stripBalancedOuterParens(pythonExpression.trim());
  const generator = /^(.+?)(?:,)? for ([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec(trimmed);
  if (generator === null) {
    return null;
  }
  return {
    expression: generator[1],
    itemName: generator[2],
    iterable: generator[3],
  };
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
    return `${iterable}.sort((left, right) => left < right ? ${reverse ? 1 : -1} : left > right ? ${reverse ? -1 : 1} : 0)`;
  }

  const lambda = /^key=lambda ([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(keyPart);
  if (lambda === null) {
    return null;
  }

  const leftNameMap = new Map(nameMap);
  leftNameMap.set(lambda[1], 'left');
  const rightNameMap = new Map(nameMap);
  rightNameMap.set(lambda[1], 'right');
  const leftKey = translateExpression(lambda[2], leftNameMap, arrayNames, validatedTypeAliases, mapNames);
  const rightKey = translateExpression(lambda[2], rightNameMap, arrayNames, validatedTypeAliases, mapNames);
  const less = reverse ? 1 : -1;
  const greater = reverse ? -1 : 1;
  return `${iterable}.sort((left, right) => ${leftKey} < ${rightKey} ? ${less} : ${leftKey} > ${rightKey} ? ${greater} : 0)`;
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
  const setDifference = topLevelSetDifference(pythonExpression);
  if (setDifference !== null) {
    const left = translateExpression(setDifference.left, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const right = translateExpression(setDifference.right, nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `Array.from(${left}).filter((item) => !${right}.has(item))`;
  }
  const iterable = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (mapNames.has(iterable)) {
    return `Array.from(${iterable}.keys())`;
  }
  if (arrayNames.has(objectNameMarker(pythonExpression)) || arrayNames.has(objectNameMarker(iterable))) {
    return `Object.keys(${iterable})`;
  }
  return `Array.from(${iterable})`;
}

function topLevelSetDifference(pythonExpression: string): { left: string; right: string } | null {
  const additive = splitTopLevelAdditive(pythonExpression);
  if (additive === null || additive.parts.length !== 2 || additive.operators[0] !== '-') {
    return null;
  }
  return { left: additive.parts[0], right: additive.parts[1] };
}

function translateBooleanCast(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  if (pythonExpression.includes(' or ')) {
    return pythonExpression
      .split(' or ')
      .map((part) => translatePythonTruthy(part, nameMap, arrayNames, validatedTypeAliases, mapNames))
      .join(' || ');
  }
  if (pythonExpression.includes(' and ')) {
    return pythonExpression
      .split(' and ')
      .map((part) => translatePythonTruthy(part, nameMap, arrayNames, validatedTypeAliases, mapNames))
      .join(' && ');
  }
  return translatePythonTruthy(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
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
  if (mapNames.has(translated)) {
    return `${translated}.size > 0`;
  }
  if (arrayNames.has(trimmed) || arrayNames.has(translated)) {
    return `${translated}.length > 0`;
  }
  if (expressionLooksBoolean(translated) || expressionLooksSimpleValueReference(translated)) {
    return translated;
  }
  return expressionLooksCallResult(translated) ? `pythonTruthy(${translated})` : translated;
}

function expressionLooksBoolean(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  return trimmed === 'true'
    || trimmed === 'false'
    || /^!/.test(trimmed)
    || /(?:===|!==|<=|>=|<|>|&&|\|\||\binstanceof\b)/.test(trimmed)
    || /^typeof\b/.test(trimmed)
    || /^(?:Array\.isArray|Number\.is(?:Finite|Integer|NaN))\(/.test(trimmed)
    || /\.(?:has|includes|startsWith|endsWith)\(/.test(trimmed);
}

function expressionLooksSimpleValueReference(tsExpression: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(tsExpression.trim());
}

function expressionLooksCallResult(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\(.*\)$/.test(trimmed)
    || /^new [A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\(.*\)$/.test(trimmed);
}

function replaceTranslatedRaylibConstructors(value: string): string {
  let output = '';
  let index = 0;
  const constructorPattern = /(r[dl]|wgl)\.(Color|Vector2|Rectangle)\(/g;
  while (index < value.length) {
    constructorPattern.lastIndex = index;
    const match = constructorPattern.exec(value);
    if (match === null) {
      output += value.slice(index);
      break;
    }

    const argsStart = constructorPattern.lastIndex;
    const closeIndex = matchingCloseParen(value, argsStart - 1);
    if (closeIndex === null) {
      output += value.slice(index);
      break;
    }

    output += value.slice(index, match.index);
    const args = splitTopLevelComma(value.slice(argsStart, closeIndex));
    if (match[2] === 'Color' && args.length === 4) {
      output += `${match[1]}.makeColor(${args.map((arg) => /\.[rgba]$/.test(arg.trim()) ? arg.trim() : `${arg.trim()} / 255`).join(', ')})`;
    } else if (match[2] === 'Vector2' && args.length === 2) {
      output += `${match[1]}.makeVector2(${args.map((arg) => arg.trim()).join(', ')})`;
    } else if (match[2] === 'Rectangle' && args.length === 4) {
      output += `${match[1]}.makeRectangle(${args.map((arg) => arg.trim()).join(', ')})`;
    } else {
      output += value.slice(match.index, closeIndex + 1);
    }
    index = closeIndex + 1;
  }
  return output;
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

function parseBytesLiteral(value: string): number[] | null {
  const literal = /^b(["'])([\s\S]*)\1$/.exec(value);
  if (literal === null) {
    return null;
  }
  const bytes: number[] = [];
  const content = literal[2];
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char !== '\\') {
      bytes.push(content.charCodeAt(index));
      continue;
    }
    const next = content[index + 1];
    if (next === 'x') {
      const hex = content.slice(index + 2, index + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        return null;
      }
      bytes.push(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    if (next === '0') {
      bytes.push(0);
      index += 1;
      continue;
    }
    if (next === 'n') {
      bytes.push(10);
      index += 1;
      continue;
    }
    if (next === 'r') {
      bytes.push(13);
      index += 1;
      continue;
    }
    if (next === 't') {
      bytes.push(9);
      index += 1;
      continue;
    }
    if (next === '\\' || next === '"' || next === "'") {
      bytes.push(next.charCodeAt(0));
      index += 1;
      continue;
    }
    return null;
  }
  return bytes;
}

function parseConstructFieldExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const field = /^(.+) \/ (.+)$/.exec(pythonExpression);
  if (field === null) {
    return null;
  }
  const name = parsePythonStringExpression(field[1]);
  if (name === null) {
    return null;
  }
  return `constructField(${tsStringLiteral(JSON.stringify(name.content))}, ${translateExpression(field[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
}

function translateConstructExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  if (pythonExpression === 'Int32ul') {
    return 'constructInt32ul()';
  }
  const cStringCall = parseCallPrefix(pythonExpression, 'CString');
  if (cStringCall !== null && cStringCall.rest === '') {
    return `constructCString(${translateExpression(cStringCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  const bytesCall = parseCallPrefix(pythonExpression, 'Bytes');
  if (bytesCall !== null && bytesCall.rest === '') {
    const sizeLambda = /^lambda ([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(bytesCall.argsText.trim());
    if (sizeLambda !== null) {
      const lambdaNameMap = new Map(nameMap);
      const argName = tsExportNameForPythonName(sizeLambda[1]);
      lambdaNameMap.set(sizeLambda[1], argName);
      return `constructBytes((${argName}) => ${translateExpression(sizeLambda[2], lambdaNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
    return `constructBytes(${translateExpression(bytesCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  const constCall = parseCallPrefix(pythonExpression, 'Const');
  if (constCall !== null && constCall.rest === '') {
    return `constructConst(${translateExpression(constCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  const greedyRangeCall = parseCallPrefix(pythonExpression, 'GreedyRange');
  if (greedyRangeCall !== null && greedyRangeCall.rest === '') {
    return `constructGreedyRange(${translateExpression(greedyRangeCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }
  const structCall = parseCallPrefix(pythonExpression, 'Struct');
  if (structCall !== null && structCall.rest === '') {
    const fields = splitTopLevelComma(structCall.argsText)
      .map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames));
    return `constructStruct([${fields.join(', ')}])`;
  }
  return null;
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
      keywordParts.push(`${tsExportNameForPythonName(keyword[1])}: ${translateExpression(keyword[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}`);
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
  return `${translateExpression(call[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}(${[...positionalParts, ...optsArg].join(', ')})`;
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

function stripPrimitiveCallWrappers(value: string): string {
  let output = value;
  let changed = true;
  while (changed) {
    changed = false;
    let nextOutput = '';
    let index = 0;
    while (index < output.length) {
      const match = /^(float|str|bool)\(/.exec(output.slice(index));
      const previous = index === 0 ? '' : output[index - 1];
      if (match === null || /[A-Za-z0-9_]/.test(previous)) {
        nextOutput += output[index];
        index += 1;
        continue;
      }
      const openIndex = index + match[1].length;
      const closeIndex = matchingCloseParen(output, openIndex);
      if (closeIndex === null || output[closeIndex + 1] === '.') {
        nextOutput += output[index];
        index += 1;
        continue;
      }
      const inner = normalizedPrimitiveWrapperInner(output.slice(openIndex + 1, closeIndex));
      nextOutput += primitiveWrapperNeedsParens(inner) ? `(${inner})` : inner;
      index = closeIndex + 1;
      changed = true;
    }
    output = nextOutput;
  }
  return output;
}

function normalizedPrimitiveWrapperInner(inner: string): string {
  const parts = splitTopLevelComma(inner);
  return parts.length === 1 && inner.trim().endsWith(',') ? parts[0] : inner;
}

function primitiveWrapperNeedsParens(inner: string): boolean {
  return splitTopLevelAdditive(inner) !== null || / [|&^] | << | >> /.test(inner);
}

function expressionIsVectorScale(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
): boolean {
  const scale = splitTopLevelMultiplicative(pythonExpression);
  return scale !== null && expressionIsKnownVector(scale.left, nameMap, arrayNames);
}

function expressionIsKnownVector(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
): boolean {
  const trimmed = stripBalancedOuterParens(pythonExpression);
  if (trimmed.startsWith('Vec2.') || trimmed.startsWith('Vec2(')) {
    return true;
  }
  if (/\.(?:aim|pos|vel|[A-Za-z0-9_]*(?:_pos|_offset))$/.test(trimmed)) {
    return true;
  }
  const translated = translateIdentifierName(trimmed, nameMap);
  if (/\.(?:aim|pos|vel|[A-Za-z0-9_$]*(?:Pos|Offset))$/.test(translated)) {
    return true;
  }
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(trimmed);
  if (identifier !== null) {
    return arrayNames.has(vectorNameMarker(identifier[0])) || arrayNames.has(vectorNameMarker(translated));
  }
  return translatedExpressionLooksVector(trimmed);
}

function finalVectorMethodCall(tsExpression: string): boolean {
  const vectorMethods = new Set(['add', 'sub', 'mul', 'rotated', 'mulComponents', 'divComponents', 'mul_components', 'div_components']);
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

function parseParenthesizedVectorMethodCall(value: string): { receiver: string; method: string; args: string[] } | null {
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

function splitTopLevelMultiplicative(value: string): { left: string; right: string } | null {
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

function splitTopLevelModulo(value: string): { left: string; right: string } | null {
  return splitTopLevelSpacedOperator(value, '%');
}

function splitTopLevelFloorDivision(value: string): { left: string; right: string } | null {
  return splitTopLevelSpacedOperator(value, '//');
}

function splitTopLevelSpacedOperator(value: string, operator: string): { left: string; right: string } | null {
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

function splitTopLevelPathJoin(value: string): { parts: string[] } | null {
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
      depth -= 1;
      continue;
    }
    if (
      depth === 0
      && char === '/'
      && value[index - 1] === ' '
      && value[index + 1] === ' '
    ) {
      parts.push(value.slice(start, index - 1).trim());
      start = index + 2;
    }
  }
  if (parts.length === 0) {
    return null;
  }
  parts.push(value.slice(start).trim());
  return { parts };
}

function parenthesizeForLogicalAnd(value: string): string {
  return value.includes(' || ') && matchingCloseParen(value, 0) !== value.length - 1 ? `(${value})` : value;
}

function parenthesizeForLogicalOr(value: string): string {
  return value.includes(' && ') && matchingCloseParen(value, 0) !== value.length - 1 ? `(${value})` : value;
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

function parenthesizeForMultiplicative(value: string): string {
  return value.includes(' ? ') ? `(${value})` : value;
}

function stripBalancedOuterParens(value: string): string {
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

function splitTopLevelAdditive(value: string): { parts: string[]; operators: string[] } | null {
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

function joinTranslatedAdditive(
  additive: { parts: string[]; operators: string[] },
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  let output = translateExpression(additive.parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames);
  for (let index = 0; index < additive.operators.length; index += 1) {
    output += ` ${additive.operators[index]} ${translateExpression(additive.parts[index + 1], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }
  return output;
}

function splitTopLevelComparisonOperators(value: string): { parts: string[]; operators: string[] } | null {
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

function matchingCloseParen(value: string, openIndex: number): number | null {
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

function translateMixedKeywordCall(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
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
    keywordParts.push(`${tsExportNameForPythonName(keyword[1])}: ${translateExpression(keyword[2], nameMap, arrayNames, validatedTypeAliases)}`);
  }
  if (keywordParts.length === 0) {
    return null;
  }
  const callee = translateExpression(call[1], nameMap, arrayNames, validatedTypeAliases);
  const callPrefix = /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
  if (positionalParts.length === 0) {
    return `${callPrefix}({ ${keywordParts.join(', ')} })`;
  }

  return `${callPrefix}(${[
    ...positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases)),
    `{ ${keywordParts.join(', ')} }`,
  ].join(', ')})`;
}

function translateMixedKeywordCallWithRest(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string> = new Set(),
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
  );
  if (translatedCall === null) {
    return null;
  }
  return `${translatedCall}${translateAttributeRest(rest)}`;
}

function translateAttributeRest(rest: string): string {
  return rest.replaceAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, tsExportNameForPythonName);
}

function pythonContainsExpression(containerExpression: string, valueExpression: string): string {
  return `((container: unknown, value: unknown) => container instanceof Set || container instanceof Map ? container.has(value) : Array.isArray(container) ? container.includes(value) : typeof container === 'string' ? container.includes(String(value)) : container !== null && typeof container === 'object' ? Object.prototype.hasOwnProperty.call(container, String(value)) : false)(${containerExpression}, ${valueExpression})`;
}

function parseCallPrefix(expression: string, callee: string): { argsText: string; rest: string } | null {
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

function tsPropertyAccessBase(expression: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^\]]+\])*$/.test(expression)
    ? expression
    : `(${expression})`;
}
