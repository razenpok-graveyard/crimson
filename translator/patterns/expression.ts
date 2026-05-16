import { tsExportNameForPythonName, tsTypeExpression } from '../naming.js';
import {
  combinePythonStringExpressions,
  parsePythonStringExpression,
  splitTopLevelComma,
  tsStringLiteral,
} from './common.js';
import {
  colorNameMarker,
  dateNameMarker,
  instanceMethodSignatureMarker,
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
  vectorArrayNameMarker,
  vectorNameMarker,
} from './expression/markers.js';
import {
  raylibKeyboardKeyCode,
  raylibNamedColor,
} from './expression/raylib.js';

export {
  arrayValueMapNameMarker,
  colorNameMarker,
  dateNameMarker,
  instanceMethodSignatureMarker,
  nullableNameMarker,
  numberArrayNameMarker,
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
  mapNames: ReadonlySet<string> = new Set(),
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
        const baseExpression = translateExpression(expressionText, nameMap, arrayNames, validatedTypeAliases, mapNames);
        const translatedExpression = conversion?.[2] === 'r' || conversion?.[2] === 'a'
          ? `pythonRepr(${baseExpression})`
          : baseExpression === 'exc'
            ? 'exc instanceof Error ? exc.message : String(exc)'
            : baseExpression;
        const zeroPaddedInteger = format === null ? null : /^0(\d+)([dx])$/.exec(format);
        if (zeroPaddedInteger !== null) {
          const formatted = zeroPaddedInteger[2] === 'x'
            ? `Math.trunc(${translatedExpression}).toString(16)`
            : `String(${translatedExpression})`;
          translated += `\${${formatted}.padStart(${zeroPaddedInteger[1]}, '0')}`;
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

function translateConditionalTestExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const trimmed = pythonExpression.trim();
  const translated = translateExpression(trimmed, nameMap, arrayNames, validatedTypeAliases, mapNames);
  if (mapNames.has(translated)) {
    return `${translated}.size > 0`;
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

type FunctionCallSignature = {
  positional: string[];
};

function parseFunctionCallSignature(signatureText: string | undefined): FunctionCallSignature | null {
  if (signatureText === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(signatureText) as Partial<FunctionCallSignature>;
    if (!Array.isArray(parsed.positional) || !parsed.positional.every((name) => typeof name === 'string')) {
      return null;
    }
    return {
      positional: parsed.positional,
    };
  } catch {
    return null;
  }
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
  const methodName = tsExportNameForPythonName(dotted[2]);
  const staticMethod = nameMap.get(staticClassMethodNameMarker(receiverType, methodName));
  return staticMethod === undefined ? null : `${receiverType}.${staticMethod}`;
}

export function translatedExpressionLooksVector(tsExpression: string): boolean {
  const trimmed = tsExpression.trim();
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

  if (trimmed === 'int.from_bytes(os.urandom(4), "little")' || trimmed === "int.from_bytes(os.urandom(4), 'little')") {
    return 'globalThis.crypto.getRandomValues(new Uint32Array(1))[0]';
  }

  const secretsTokenHexCall = parseCallPrefix(trimmed, 'secrets.token_hex');
  if (secretsTokenHexCall !== null && secretsTokenHexCall.rest === '') {
    return `secretsTokenHex(${translateExpression(secretsTokenHexCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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

  for (const method of ['floor', 'ceil', 'trunc', 'sqrt', 'pow', 'cos', 'sin', 'atan2'] as const) {
    const mathCall = parseCallPrefix(trimmed, `math.${method}`);
    if (mathCall !== null && mathCall.rest === '') {
      return `Math.${method}(${splitTopLevelComma(mathCall.argsText).map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')})`;
    }
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

  const bytesJoinCall = /^(b(["'])(?:\\.|(?!\2)[\s\S])*\2)\.join\((.+)\)$/.exec(trimmed);
  if (bytesJoinCall !== null) {
    const separator = parseBytesLiteral(bytesJoinCall[1]);
    if (separator !== null && separator.length === 0) {
      const generatorArray = generatorExpressionToArray(bytesJoinCall[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const chunks = generatorArray ?? translateExpression(bytesJoinCall[3], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `concatBytes(${chunks})`;
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

  const listComprehension = parseSimpleListComprehension(trimmed);
  if (listComprehension !== null) {
    const itemName = tsExportNameForPythonName(listComprehension.itemName);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(listComprehension.itemName, itemName);
    const translatedIterable = translateExpression(listComprehension.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
    const iterable = mapNames.has(translatedIterable)
      ? `Array.from(${translatedIterable}.keys())`
      : arrayNames.has(objectNameMarker(listComprehension.iterable)) || arrayNames.has(objectNameMarker(translatedIterable))
        ? `Object.keys(${translatedIterable})`
        : arrayNames.has(setNameMarker(listComprehension.iterable)) || arrayNames.has(setNameMarker(translatedIterable))
          ? `Array.from(${translatedIterable})`
          : translatedIterable;
    const translatedItem = translateExpression(listComprehension.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames);
    const filtered = listComprehension.condition === null
      ? iterable
      : `${iterable}.filter((${itemName}) => ${translateExpression(listComprehension.condition!, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    return listComprehension.condition !== null && translatedItem === itemName
      ? filtered
      : `${filtered}.map((${itemName}) => ${translatedItem})`;
  }

  const listLiteral = /^\[([\s\S]*)\]$/.exec(trimmed);
  if (listLiteral !== null) {
    const items = splitTopLevelComma(listLiteral[1]).filter((item) => item.trim() !== '');
    return `[${items.map((item) => {
      const stripped = item.trim();
      return stripped.startsWith('*')
        ? `...${translateExpression(stripped.slice(1), nameMap, arrayNames, validatedTypeAliases, mapNames)}`
        : translateExpression(stripped, nameMap, arrayNames, validatedTypeAliases, mapNames);
    }).join(', ')}]`;
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
    if (mapNames.has(mapName)) {
      const key = translateMapKeyExpression(mapName, value, mapNames);
      return `!${mapName}.has(${key})`;
    }
    return `!${pythonContainsExpression(mapName, value)}`;
  }

  const mapMembership = /^(.+) in ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
  if (mapMembership !== null && !hasTopLevelLogicalOperator) {
    const mapName = translateExpression(mapMembership[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const value = translateExpression(mapMembership[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      const key = translateMapKeyExpression(mapName, value, mapNames);
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

  const mapKeysCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.keys\(\)$/.exec(trimmed);
  if (mapKeysCall !== null) {
    const mapName = translateExpression(mapKeysCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(pythonMappingNameMarker(mapKeysCall[1])) || arrayNames.has(pythonMappingNameMarker(mapName))) {
      return `pythonMappingKeys(${mapName})`;
    }
    if (mapNames.has(mapName)) {
      return `${mapName}.keys()`;
    }
    if (arrayNames.has(objectNameMarker(mapKeysCall[1])) || arrayNames.has(objectNameMarker(mapName))) {
      return `Object.keys(${mapName})`;
    }
  }

  const mappingConstantSubscript = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(trimmed);
  if (mappingConstantSubscript !== null && looksLikeMappingConstantName(mappingConstantSubscript[1])) {
    const mapName = translateExpression(mappingConstantSubscript[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    const key = translateMapKeyExpression(mapName, translateExpression(mappingConstantSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
    return `${mapName}.get(${key})!`;
  }

  const mapSubscript = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(trimmed);
  if (mapSubscript !== null) {
    const mapName = translateExpression(mapSubscript[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(pythonMappingNameMarker(mapSubscript[1])) || arrayNames.has(pythonMappingNameMarker(mapName))) {
      const key = translateExpression(mapSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
      return `pythonMappingGet(${mapName}, ${key})`;
    }
    if (mapNames.has(mapName)) {
      const key = translateMapKeyExpression(mapName, translateExpression(mapSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
      return `${mapName}.get(${key})!`;
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
        const iterable = iterableExpressionForIteration(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
        const filtered = generator.condition === null
          ? iterable
          : `${iterable}.filter((${itemName}) => ${translateExpression(generator.condition!, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
        return `${filtered}.map((${itemName}) => ${translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
      }
      return `Array.from(${translateExpression(argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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

  const msgspecToBuiltinsCall = parseCallPrefix(trimmed, 'msgspec.to_builtins');
  if (msgspecToBuiltinsCall !== null && msgspecToBuiltinsCall.rest === '') {
    return `structuredClone(${translateExpression(msgspecToBuiltinsCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
      return castType === 'PythonMapping' || castType === 'PythonSequence' ? `(${translated} as ${castType})` : translated;
    }
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
    return `int(${translateExpression(intCall.argsText, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
      return mapNames.has(iterable) ? `new Set(${iterable}.keys())` : `new Set(${iterable})`;
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
      const key = translateMapKeyExpression(mapName, translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
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
    return `new MsgpackDecoder({ type: ${typeExpression} })`;
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
      return `new MsgpackDecoder({ type: ${typeExpression} }).decode(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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

  const dictGet = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|\{[\s\S]+\})\.get\((.*)\)$/.exec(trimmed);
  if (dictGet !== null) {
    const parts = splitTopLevelComma(dictGet[2]);
    if (parts.length === 1 || parts.length === 2) {
      const inlineMap = translateInlineDictMapExpression(dictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const mapName = inlineMap ?? translateExpression(dictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const key = translateMapKeyExpression(mapName, translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames), mapNames);
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
  if (
    vectorScale !== null
    && (
      translateAggregateGeneratorCall(vectorScale.left, nameMap, arrayNames, validatedTypeAliases, mapNames) !== null
      || translateAggregateGeneratorCall(vectorScale.right, nameMap, arrayNames, validatedTypeAliases, mapNames) !== null
    )
  ) {
    return `${translateExpression(vectorScale.left, nameMap, arrayNames, validatedTypeAliases, mapNames)} * ${translateExpression(vectorScale.right, nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }
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
  const divisionWithConditional = splitTopLevelDivision(trimmed);
  if (
    divisionWithConditional !== null
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
      translateConditionalTestExpression(conditionalExpression.condition, nameMap, arrayNames, validatedTypeAliases, mapNames),
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
    if (mapNames.has(value)) {
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

  const negativeIndex = /^(.+)\[-(\d+)\]$/.exec(trimmed);
  if (negativeIndex !== null) {
    const receiver = translateExpression(negativeIndex[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    return `${receiver}[${receiver}.length - ${negativeIndex[2]}]`;
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

  const simpleSubscript = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[(.+)\]$/.exec(trimmed);
  if (simpleSubscript !== null) {
    return `${translateExpression(simpleSubscript[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}[${translateExpression(simpleSubscript[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}]`;
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
      if (mapNames.has(translatedName)) {
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
      if (name.startsWith('_') && shouldPreservePrivateDottedToken(fullText, offset, name)) {
        return tsMemberNameForPythonName(name);
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
    ...parts.slice(1).map((part) => nameMap.get(part) ?? tsMemberNameForPythonName(part)),
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

function shouldPreservePrivateDottedName(pythonName: string): boolean {
  return pythonName.startsWith('self.');
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
  const leftSubscript = /^([A-Za-z_$][A-Za-z0-9_.$]*)\[.+\]$/.exec(left);
  const rightSubscript = /^([A-Za-z_$][A-Za-z0-9_.$]*)\[.+\]$/.exec(right);
  return /\bnew [A-Z][A-Za-z0-9_$]*\(/.test(left)
    || /\bnew [A-Z][A-Za-z0-9_$]*\(/.test(right)
    || arrayNames.has(left)
    || arrayNames.has(right)
    || (leftSubscript !== null && arrayNames.has(tupleElementArrayNameMarker(leftSubscript[1])))
    || (rightSubscript !== null && arrayNames.has(tupleElementArrayNameMarker(rightSubscript[1])))
    || arrayNames.has(objectNameMarker(left))
    || arrayNames.has(objectNameMarker(right));
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

function parseSimpleGeneratorExpression(pythonExpression: string): { expression: string; itemName: string; iterable: string; condition: string | null } | null {
  const trimmed = stripBalancedOuterParens(pythonExpression.trim());
  const generator = /^(.+?)(?:,)? for ([A-Za-z_][A-Za-z0-9_]*) in (.+?)(?: if (.+))?$/.exec(trimmed);
  if (generator === null) {
    return null;
  }
  return {
    expression: generator[1],
    itemName: generator[2],
    iterable: generator[3],
    condition: generator[4] ?? null,
  };
}

function parseTupleTargetGeneratorExpression(
  pythonExpression: string,
): { expression: string; targetNames: string[]; iterable: string; condition: string | null } | null {
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

function tupleTargetGeneratorExpressionToArray(
  generator: { expression: string; targetNames: string[]; iterable: string; condition: string | null },
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
  const iterable = iterableExpressionForIteration(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
  const filtered = generator.condition === null
    ? iterable
    : `${iterable}.filter((${mapParameter}) => ${translateExpression(generator.condition, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  return `${filtered}.map((${mapParameter}) => ${translateExpression(generator.expression, itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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
  const iterable = iterableExpressionForIteration(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
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
  const generator = parseSimpleGeneratorExpression(pythonExpression);
  if (generator !== null) {
    const itemName = tsExportNameForPythonName(generator.itemName);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(generator.itemName, itemName);
    const iterable = iterableExpressionForIteration(generator.iterable, nameMap, arrayNames, validatedTypeAliases, mapNames);
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
  if (mapNames.has(iterable)) {
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
  if (mapNames.has(iterable)) {
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
  if (/^(?:camera|focus|screen_size|screenSize)$/.test(trimmed)) {
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
  const indexedIdentifier = /^([A-Za-z_][A-Za-z0-9_]*)\[.+\]$/.exec(trimmed);
  if (indexedIdentifier !== null) {
    const translatedBase = translateIdentifierName(indexedIdentifier[1], nameMap);
    return arrayNames.has(vectorArrayNameMarker(indexedIdentifier[1])) || arrayNames.has(vectorArrayNameMarker(translatedBase));
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

function splitTopLevelDivision(value: string): { left: string; right: string } | null {
  return splitTopLevelSpacedOperator(value, '/');
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

function expressionLooksPathJoinPart(value: string): boolean {
  const trimmed = value.trim();
  return parsePythonStringExpression(trimmed) !== null
    || /^f["']/.test(trimmed)
    || parseCallPrefix(trimmed, 'Path') !== null;
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
      expression: translateExpression(keyword[2], nameMap, arrayNames, validatedTypeAliases),
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
  );
  if (knownSignatureCall !== null) {
    return knownSignatureCall;
  }
  const callee = translateStaticMethodCalleeIfKnown(call[1], nameMap)
    ?? translateExpression(call[1], nameMap, arrayNames, validatedTypeAliases);
  const callPrefix = /^[A-Z][A-Za-z0-9_]*$/.test(callee) ? `new ${callee}` : callee;
  const optsExpression = `{ ${keywordParts.map((part) => `${part.tsName}: ${part.expression}`).join(', ')} }`;
  if (positionalParts.length === 0) {
    return `${callPrefix}(${optsExpression})`;
  }

  return `${callPrefix}(${[
    ...positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases)),
    optsExpression,
  ].join(', ')})`;
}

function translateMixedKeywordCallWithKnownInstanceSignature(
  pythonCallee: string,
  positionalParts: string[],
  keywordParts: { pythonName: string; tsName: string; expression: string }[],
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
): string | null {
  const knownMethod = knownInstanceMethodCall(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  if (knownMethod === null) {
    return null;
  }
  const consumedKeywords = new Set<string>();
  const args = positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases));
  for (const positionalName of knownMethod.signature.positional.slice(args.length)) {
    const keywordPart = keywordParts.find((part) => (
      !consumedKeywords.has(part.pythonName)
      && (part.pythonName === positionalName || part.tsName === positionalName)
    ));
    if (keywordPart === undefined) {
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
  const receiverType = nameMap.get(receiverTypeNameMarker(dotted[1])) ?? nameMap.get(receiverTypeNameMarker(receiver));
  if (receiverType === undefined) {
    return null;
  }
  const methodName = tsMemberNameForPythonName(dotted[2]);
  const signature = parseFunctionCallSignature(nameMap.get(instanceMethodSignatureMarker(receiverType, methodName)));
  return signature === null
    ? null
    : { callee: `${receiver}.${methodName}`, signature };
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
