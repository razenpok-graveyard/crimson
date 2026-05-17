import { tsPropertyAccessBase } from './scanners.js';

type ExpressionTranslator = (
  pythonExpression: string,
  nameMap?: Map<string, string>,
  arrayNames?: Set<string>,
  validatedTypeAliases?: ReadonlySet<string>,
  mapNames?: ReadonlySet<string>,
) => string;

export function tsRegExpExpression(
  pythonLiteral: string,
  translateExpression: ExpressionTranslator,
): string {
  const literal = /^([rRfF]{0,2})(["'])([\s\S]*)\2$/.exec(pythonLiteral);
  if (literal === null) {
    return `new RegExp(${translateExpression(pythonLiteral)})`;
  }

  const prefix = literal[1].toLowerCase();
  const content = literal[3];
  if (prefix.includes('f')) {
    return `new RegExp(\`${tsFStringTemplateContent(content, translateExpression)}\`)`;
  }

  return `new RegExp(${JSON.stringify(content)})`;
}

export function tsRegExpSourceExpression(
  pythonExpression: string,
  translateExpression: ExpressionTranslator,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string {
  const literal = /^([rRfF]{0,2})(["'])([\s\S]*)\2$/.exec(pythonExpression.trim());
  if (literal === null) {
    return translateExpression(pythonExpression, nameMap, arrayNames, validatedTypeAliases, mapNames);
  }

  const prefix = literal[1].toLowerCase();
  const content = literal[3];
  return prefix.includes('f')
    ? `\`${tsFStringTemplateContent(content, translateExpression, nameMap, arrayNames, validatedTypeAliases, mapNames)}\``
    : JSON.stringify(content);
}

export function tsRegExpFlagsExpression(pythonExpression: string | undefined): string {
  if (pythonExpression === undefined) {
    return '';
  }
  const flags = [
    pythonExpression.includes('re.IGNORECASE') ? 'i' : '',
    pythonExpression.includes('re.MULTILINE') ? 'm' : '',
    pythonExpression.includes('re.DOTALL') ? 's' : '',
  ].join('');
  return [...new Set(flags.split(''))].join('');
}

export function tsFStringTemplateContent(
  content: string,
  translateExpression: ExpressionTranslator,
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
      const closeIndex = findFStringFieldClose(content, index);
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
        const zeroPaddedInteger = format === null ? null : /^0(\d+)([dXx])$/.exec(format);
        if (zeroPaddedInteger !== null) {
          const formatted = zeroPaddedInteger[2] === 'x' || zeroPaddedInteger[2] === 'X'
            ? `Math.trunc(${translatedExpression}).toString(16)${zeroPaddedInteger[2] === 'X' ? '.toUpperCase()' : ''}`
            : `String(${translatedExpression})`;
          translated += `\${${formatted}.padStart(${zeroPaddedInteger[1]}, '0')}`;
        } else {
          const paddedInteger = /^([<>]?)(\d+)d$/.exec(format ?? '');
          if (paddedInteger !== null) {
            const value = `String(${translatedExpression})`;
            const method = paddedInteger[1] === '<' ? 'padEnd' : 'padStart';
            translated += `\${${value}.${method}(${paddedInteger[2]}, ' ')}`;
            index = closeIndex;
            continue;
          }
          const fixedFloat = /^(\d+)?\.(\d+)f$/.exec(format ?? '');
          if (fixedFloat !== null) {
            const width = fixedFloat[1] ?? null;
            const digits = fixedFloat[2];
            const fixed = `${tsPropertyAccessBase(translatedExpression)}.toFixed(${digits})`;
            translated += width === null ? `\${${fixed}}` : `\${${fixed}.padStart(${width}, ' ')}`;
          } else {
            const dynamicFixedFloat = /^(\d+)?\.\{(.+)\}f$/.exec(format ?? '');
            if (dynamicFixedFloat !== null) {
              const width = dynamicFixedFloat[1] ?? null;
              const digits = translateExpression(dynamicFixedFloat[2], nameMap, arrayNames, validatedTypeAliases, mapNames);
              const fixed = `${tsPropertyAccessBase(translatedExpression)}.toFixed(${digits})`;
              translated += width === null ? `\${${fixed}}` : `\${${fixed}.padStart(${width}, ' ')}`;
            } else {
              translated += `\${${translatedExpression}}`;
            }
          }
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

function findFStringFieldClose(content: string, openIndex: number): number {
  let nestedBraceDepth = 0;
  let quote: string | null = null;
  for (let index = openIndex + 1; index < content.length; index += 1) {
    const char = content[index];
    if (quote !== null) {
      if (char === quote && content[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') {
      nestedBraceDepth += 1;
      continue;
    }
    if (char !== '}') {
      continue;
    }
    if (nestedBraceDepth === 0) {
      return index;
    }
    nestedBraceDepth -= 1;
  }
  return -1;
}
