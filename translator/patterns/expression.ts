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
  constructUppercase = false,
): string {
  const callee = translateCallCalleeExpression(pythonCallee, nameMap, arrayNames, validatedTypeAliases);
  const args = positionalParts.map((part) => translateCallArgumentExpression(part, nameMap, arrayNames, validatedTypeAliases));
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
): string {
  return translateBoundMethodReference(pythonExpression, nameMap, arrayNames, validatedTypeAliases)
    ?? translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases);
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
  const reference = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){2,})$/.exec(pythonExpression.trim());
  if (reference === null) {
    return null;
  }
  const parts = reference[1].split('.');
  const translatedRoot = nameMap.get(parts[0]) ?? tsExportNameForPythonName(parts[0]);
  if (translatedRoot !== 'this') {
    return null;
  }
  const receiver = translateExpression(parts.slice(0, -1).join('.'), nameMap, arrayNames, validatedTypeAliases);
  const method = tsExportNameForPythonName(parts[parts.length - 1]);
  return `${receiver}.${method}.bind(${receiver})`;
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

export function setNameMarker(name: string): string {
  return `__set__:${name}`;
}

export function objectNameMarker(name: string): string {
  return `__object__:${name}`;
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

  const colorChannel = /^([A-Za-z_][A-Za-z0-9_]*)\.([rgba])$/.exec(trimmed);
  if (colorChannel !== null) {
    const translatedName = translateExpression(colorChannel[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (arrayNames.has(colorNameMarker(colorChannel[1])) || arrayNames.has(colorNameMarker(translatedName))) {
      return `${translatedName}.${colorChannel[2]} * 255`;
    }
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

  const dictComprehension = /^\{(.+): (.+) for ([A-Za-z_][A-Za-z0-9_]*) in (.+)\}$/.exec(trimmed);
  if (dictComprehension !== null) {
    const itemName = tsExportNameForPythonName(dictComprehension[3]);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(dictComprehension[3], itemName);
    return `new Map(Array.from(${translateExpression(dictComprehension[4], nameMap, arrayNames, validatedTypeAliases, mapNames)}, (${itemName}) => [${translateExpression(dictComprehension[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(dictComprehension[2], itemNameMap, arrayNames, validatedTypeAliases, mapNames)}] as const))`;
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

  const listComprehension = /^\[(.+) for ([A-Za-z_][A-Za-z0-9_]*) in (.+)\]$/.exec(trimmed);
  if (listComprehension !== null) {
    const itemName = tsExportNameForPythonName(listComprehension[2]);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(listComprehension[2], itemName);
    return `${translateExpression(listComprehension[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}.map((${itemName}) => ${translateExpression(listComprehension[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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

  const mapMembership = /^(.+) in ([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
  if (mapMembership !== null) {
    const mapName = translateExpression(mapMembership[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      const key = translateMapKeyExpression(mapName, translateExpression(mapMembership[1], nameMap, arrayNames, validatedTypeAliases, mapNames));
      return `${mapName}.has(${key})`;
    }
  }

  const mapItemsCall = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.items\(\)$/.exec(trimmed);
  if (mapItemsCall !== null) {
    const mapName = translateExpression(mapItemsCall[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      return `${mapName}.entries()`;
    }
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

  for (const primitiveName of ['float', 'str']) {
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

  const multiplicativeWithFloorDivision = splitTopLevelMultiplicative(trimmed);
  if (
    multiplicativeWithFloorDivision !== null
    && (multiplicativeWithFloorDivision.left.includes(' // ') || multiplicativeWithFloorDivision.right.includes(' // '))
  ) {
    return `${translateExpression(stripBalancedOuterParens(multiplicativeWithFloorDivision.left), nameMap, arrayNames, validatedTypeAliases, mapNames)} * ${translateExpression(stripBalancedOuterParens(multiplicativeWithFloorDivision.right), nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
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

  const conditionalExpression = /^(.+) if (.+) else (.+)$/.exec(trimmed);
  if (conditionalExpression !== null) {
    return [
      translateExpression(conditionalExpression[2], nameMap, arrayNames, validatedTypeAliases, mapNames),
      '?',
      translateExpression(conditionalExpression[1], nameMap, arrayNames, validatedTypeAliases, mapNames),
      ':',
      translateExpression(conditionalExpression[3], nameMap, arrayNames, validatedTypeAliases, mapNames),
    ].join(' ');
  }

  if (trimmed.startsWith('(') && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner.includes(',') && (inner.includes(' and ') || inner.includes(' or '))) {
      return `(${translateExpression(inner, nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
  }

  if (trimmed.includes(' and ')) {
    return trimmed
      .split(' and ')
      .map((part) => parenthesizeForLogicalAnd(translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)))
      .join(' && ');
  }

  if (trimmed.includes(' or ')) {
    return trimmed
      .split(' or ')
      .map((part) => parenthesizeForLogicalOr(translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)))
      .join(' || ');
  }

  const parenthesizedNotExpression = /^\((not .*)\)$/.exec(trimmed);
  if (parenthesizedNotExpression !== null && matchingCloseParen(trimmed, 0) === trimmed.length - 1) {
    return translateExpression(parenthesizedNotExpression[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const notIdentifier = /^not ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (notIdentifier !== null) {
    const value = translateExpression(notIdentifier[1], nameMap, arrayNames, validatedTypeAliases);
    return arrayNames.has(notIdentifier[1]) ? `!${value}.length` : `!${value}`;
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

  const additiveWithHighPrecedenceOperator = splitTopLevelAdditive(trimmed);
  if (
    additiveWithHighPrecedenceOperator !== null
    && additiveWithHighPrecedenceOperator.parts.some((part) => part.includes(' // ') || part.includes(' >> '))
  ) {
    return joinTranslatedAdditive(additiveWithHighPrecedenceOperator, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const withoutOuterParens = stripBalancedOuterParens(trimmed);
  if (withoutOuterParens !== trimmed && withoutOuterParens.includes(' >> ')) {
    return translateExpression(withoutOuterParens, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const rightShift = /^(.+) >> (.+)$/.exec(trimmed);
  if (rightShift !== null) {
    return `Math.floor(${translateExpression(rightShift[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} / (2 ** ${translateExpression(rightShift[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}))`;
  }

  const additiveWithFloorDivision = /^(.+?) ([+-]) (.+ \/\/ .+)$/.exec(trimmed);
  if (additiveWithFloorDivision !== null) {
    return `${translateExpression(additiveWithFloorDivision[1], nameMap, arrayNames, validatedTypeAliases, mapNames)} ${additiveWithFloorDivision[2]} ${translateExpression(additiveWithFloorDivision[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}`;
  }

  const floorDivision = /^(.+) \/\/ (.+)$/.exec(trimmed);
  if (floorDivision !== null) {
    return `Math.floor(${translateExpression(floorDivision[1], nameMap, arrayNames, validatedTypeAliases)} / ${translateExpression(floorDivision[2], nameMap, arrayNames, validatedTypeAliases)})`;
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
    if ((binaryComparison[2] === '==' || binaryComparison[2] === '!=') && comparisonNeedsPythonEquality(left, right, arrayNames)) {
      const equality = `pythonEquals(${left}, ${right})`;
      return binaryComparison[2] === '==' ? equality : `!${equality}`;
    }
    const operator = binaryComparison[2] === '=='
      ? '==='
      : binaryComparison[2] === '!='
        ? '!=='
        : binaryComparison[2];
    return `${left} ${operator} ${right}`;
  }

  const prefixSlice = /^(.+)\[:(.+)\]$/.exec(trimmed);
  if (prefixSlice !== null) {
    return `${translateExpression(prefixSlice[1], nameMap, arrayNames, validatedTypeAliases)}.slice(0, ${translateExpression(prefixSlice[2], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const openEndedSlice = /^(.+)\[(\d+):\]$/.exec(trimmed);
  if (openEndedSlice !== null) {
    return `${translateExpression(openEndedSlice[1], nameMap, arrayNames, validatedTypeAliases)}.slice(${openEndedSlice[2]})`;
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
      return `new ${tsExportNameForPythonName(positionalConstructor[1])}(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
  }

  const tupleLiteral = /^\((.*)\)$/.exec(trimmed);
  if (tupleLiteral !== null && tupleLiteral[1].includes(',')) {
    const values = tupleLiteral[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases));
    return `[${values.join(', ')}]`;
  }

  const topLevelTupleParts = splitTopLevelComma(trimmed);
  if (topLevelTupleParts.length > 1) {
    return `[${topLevelTupleParts.map((part) => translateExpression(part, nameMap, arrayNames, validatedTypeAliases, mapNames)).join(', ')}]`;
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
  return replaceTranslatedRaylibConstructors(translated)
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
    .replaceAll(/\.TEXTURE_WRAP_CLAMP\b/g, '.CLAMP');
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
  if (arrayNames.has(trimmed) || arrayNames.has(translated)) {
    return `${translated}.length > 0`;
  }
  return translated;
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
    const renderedKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key.content)
      ? key.content
      : `[${tsStringLiteral(JSON.stringify(key.content))}]`;
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
      const inner = output.slice(openIndex + 1, closeIndex);
      nextOutput += primitiveWrapperNeedsParens(inner) ? `(${inner})` : inner;
      index = closeIndex + 1;
      changed = true;
    }
    output = nextOutput;
  }
  return output;
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
  if (trimmed.startsWith('Vec2.')) {
    return true;
  }
  if (/\.(?:aim|pos|vel)$/.test(trimmed)) {
    return true;
  }
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(trimmed);
  if (identifier !== null) {
    const translated = translateIdentifierName(identifier[0], nameMap);
    return arrayNames.has(vectorNameMarker(identifier[0])) || arrayNames.has(vectorNameMarker(translated));
  }
  return translatedExpressionLooksVector(trimmed);
}

function finalVectorMethodCall(tsExpression: string): boolean {
  const vectorMethods = new Set(['add', 'sub', 'mul', 'rotated']);
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

function parenthesizeForLogicalAnd(value: string): string {
  return value.includes(' || ') && matchingCloseParen(value, 0) !== value.length - 1 ? `(${value})` : value;
}

function parenthesizeForLogicalOr(value: string): string {
  return value.includes(' && ') && matchingCloseParen(value, 0) !== value.length - 1 ? `(${value})` : value;
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
    return positionalParts.some((part) => part.includes('='))
      ? translatePositionalCallExpression(call[1], positionalParts, nameMap, arrayNames, validatedTypeAliases)
      : null;
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
