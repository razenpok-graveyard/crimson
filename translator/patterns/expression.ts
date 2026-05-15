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
  const reorderedArgs = callee === 'rl.rlSetBlendFactorsSeparate' && args.length === 6
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
    .replace(/\.append$/, '.push');
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
export function translateExpression(
  pythonExpression: string,
  nameMap: Map<string, string> = new Map(),
  arrayNames: Set<string> = new Set(),
  validatedTypeAliases: ReadonlySet<string> = new Set(),
  mapNames: ReadonlySet<string> = new Set(),
): string {
  const trimmed = pythonExpression.trim();
  const mathIsFinite = /^math\.isfinite\((.+)\)$/.exec(trimmed);
  if (mathIsFinite !== null) {
    return `Number.isFinite(${translateExpression(mathIsFinite[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
  }

  const listComprehension = /^\[(.+) for ([A-Za-z_][A-Za-z0-9_]*) in (.+)\]$/.exec(trimmed);
  if (listComprehension !== null) {
    const itemName = tsExportNameForPythonName(listComprehension[2]);
    const itemNameMap = new Map(nameMap);
    itemNameMap.set(listComprehension[2], itemName);
    return `${translateExpression(listComprehension[3], nameMap, arrayNames, validatedTypeAliases, mapNames)}.map((${itemName}) => ${translateExpression(listComprehension[1], itemNameMap, arrayNames, validatedTypeAliases, mapNames)})`;
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

  const mapMembership = /^(.+) in ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (mapMembership !== null) {
    const mapName = translateExpression(mapMembership[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (mapNames.has(mapName)) {
      const key = translateMapKeyExpression(mapName, translateExpression(mapMembership[1], nameMap, arrayNames, validatedTypeAliases, mapNames));
      return `${mapName}.has(${key})`;
    }
  }

  const mapSubscript = /^([A-Za-z_][A-Za-z0-9_]*)\[(.+)\]$/.exec(trimmed);
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
      const generator = /^(.+) for ([A-Za-z_][A-Za-z0-9_]*) in (.+)$/.exec(argsText);
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

  for (const primitiveName of ['float', 'str', 'bool']) {
    const primitiveCall = parseCallPrefix(trimmed, primitiveName);
    if (primitiveCall !== null && primitiveCall.rest === '') {
      return translateExpression(primitiveCall.argsText, nameMap, arrayNames, validatedTypeAliases);
    }
  }

  const pathCall = parseCallPrefix(trimmed, 'Path');
  if (pathCall !== null && pathCall.rest === '') {
    return translateExpression(pathCall.argsText, nameMap, arrayNames, validatedTypeAliases);
  }

  const raylibConstructor = /^rl\.(Color|Vector2|Rectangle)\((.*)\)$/.exec(trimmed);
  if (raylibConstructor !== null) {
    const args = splitTopLevelComma(raylibConstructor[2]);
    if (raylibConstructor[1] === 'Color' && args.length === 4) {
      return `rl.makeColor(${args.map((arg) => translateRaylibColorArg(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
    if (raylibConstructor[1] === 'Vector2' && args.length === 2) {
      return `rl.makeVector2(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
    }
    if (raylibConstructor[1] === 'Rectangle' && args.length === 1 && args[0].trim().startsWith('*')) {
      return translateExpression(args[0].trim().slice(1), nameMap, arrayNames, validatedTypeAliases);
    }
    if (raylibConstructor[1] === 'Rectangle' && args.length === 4) {
      return `rl.makeRectangle(${args.map((arg) => translateExpression(arg, nameMap, arrayNames, validatedTypeAliases)).join(', ')})`;
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

  const dictGet = /^(.+)\.get\((.*)\)$/.exec(trimmed);
  if (dictGet !== null) {
    const parts = splitTopLevelComma(dictGet[2]);
    if (parts.length === 1 || parts.length === 2) {
      const inlineMap = translateInlineDictMapExpression(dictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const mapName = inlineMap ?? translateExpression(dictGet[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      const key = translateMapKeyExpression(mapName, translateExpression(parts[0], nameMap, arrayNames, validatedTypeAliases, mapNames));
      const value = `${mapName}.get(${key})`;
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

  const vectorSubMethod = /^\((.+) - (.+)\)\.to_heading\(\)$/.exec(trimmed);
  if (vectorSubMethod !== null) {
    return `${translateExpression(vectorSubMethod[1], nameMap, arrayNames, validatedTypeAliases, mapNames)}.sub(${translateExpression(vectorSubMethod[2], nameMap, arrayNames, validatedTypeAliases, mapNames)}).toHeading()`;
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
      translateExpression(conditionalExpression[2], nameMap, arrayNames, validatedTypeAliases),
      '?',
      translateExpression(conditionalExpression[1], nameMap, arrayNames, validatedTypeAliases),
      ':',
      translateExpression(conditionalExpression[3], nameMap, arrayNames, validatedTypeAliases),
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
    const value = translateExpression(stripBalancedOuterParens(notExpression[1]), nameMap, arrayNames, validatedTypeAliases);
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
    return `${translateExpression(identityComparison[1], nameMap, arrayNames, validatedTypeAliases)} ${identityComparison[2] === undefined ? '===' : '!=='} ${translateExpression(identityComparison[3], nameMap, arrayNames, validatedTypeAliases)}`;
  }

  const binaryComparison = /^(.+?) (<=|>=|<|>|==|!=) (.+)$/.exec(trimmed);
  if (binaryComparison !== null) {
    const operator = binaryComparison[2] === '=='
      ? '==='
      : binaryComparison[2] === '!='
        ? '!=='
        : binaryComparison[2];
    return `${translateExpression(binaryComparison[1], nameMap, arrayNames, validatedTypeAliases)} ${operator} ${translateExpression(binaryComparison[3], nameMap, arrayNames, validatedTypeAliases)}`;
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
    .replaceAll(/\blen\(([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)/g, '$1.length')
    .replaceAll(/\.append\(/g, '.push(')
    .replaceAll(/\.strip\(\)/g, '.trim()')
    .replaceAll(/\.lower\(\)/g, '.toLowerCase()')
    .replaceAll(/\bmath\.pi\b/g, 'Math.PI')
    .replaceAll(/\bmath\.trunc\(/g, 'Math.trunc(')
    .replaceAll(/\bmath\.cos\(/g, 'Math.cos(')
    .replaceAll(/\bmath\.sin\(/g, 'Math.sin(')
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
    .replaceAll(/\.BLEND_NONE\b/g, '.NONE');
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
    return `${iterable}.sort(${reverse ? '(left, right) => left < right ? 1 : left > right ? -1 : 0' : ''})`;
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
  const iterable = translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  return `Array.from(${iterable})`;
}

function replaceTranslatedRaylibConstructors(value: string): string {
  let output = '';
  let index = 0;
  const constructorPattern = /rl\.(Color|Vector2|Rectangle)\(/g;
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
    if (match[1] === 'Color' && args.length === 4) {
      output += `rl.makeColor(${args.map((arg) => /\.[rgba]$/.test(arg.trim()) ? arg.trim() : `${arg.trim()} / 255`).join(', ')})`;
    } else if (match[1] === 'Vector2' && args.length === 2) {
      output += `rl.makeVector2(${args.map((arg) => arg.trim()).join(', ')})`;
    } else if (match[1] === 'Rectangle' && args.length === 4) {
      output += `rl.makeRectangle(${args.map((arg) => arg.trim()).join(', ')})`;
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
      nextOutput += output.slice(openIndex + 1, closeIndex);
      index = closeIndex + 1;
      changed = true;
    }
    output = nextOutput;
  }
  return output;
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
