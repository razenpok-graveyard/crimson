import { tsTypeExpression } from '../naming.js';

export function functionSignatureMarker(pythonName: string): string {
  return `__function_signature__:${pythonName}`;
}

export function parseStraightLineFunctionHeader(
  lines: string[],
  index: number,
): { name: string; parametersText: string; returnType: string; nextIndex: number } | null {
  const oneLine = /^def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\) -> ([^:]+):$/.exec(lines[index] ?? '');
  if (oneLine !== null) {
    return {
      name: oneLine[1],
      parametersText: oneLine[2],
      returnType: oneLine[3],
      nextIndex: index + 1,
    };
  }
  const oneLineWithoutReturn = /^def ([A-Za-z_][A-Za-z0-9_]*)\((.*)\):$/.exec(lines[index] ?? '');
  if (oneLineWithoutReturn !== null) {
    return {
      name: oneLineWithoutReturn[1],
      parametersText: oneLineWithoutReturn[2],
      returnType: 'any',
      nextIndex: index + 1,
    };
  }

  const start = /^def ([A-Za-z_][A-Za-z0-9_]*)\($/.exec(lines[index] ?? '');
  if (start === null) {
    return null;
  }

  const parameterLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const close = /^\) -> ([^:]+):$/.exec(lines[nextIndex] ?? '');
    if (close !== null) {
      return {
        name: start[1],
        parametersText: parameterLines.join(', '),
        returnType: close[1],
        nextIndex: nextIndex + 1,
      };
    }

    const multilineReturnStart = /^\) -> (.+)$/.exec(lines[nextIndex] ?? '');
    if (multilineReturnStart !== null) {
      const returnTypeLines = [multilineReturnStart[1]];
      nextIndex += 1;
      while (nextIndex < lines.length) {
        const returnLine = lines[nextIndex] ?? '';
        const trimmed = returnLine.trim();
        const returnTypeClose = /^(.*):$/.exec(trimmed);
        if (returnTypeClose !== null) {
          returnTypeLines.push(returnTypeClose[1]);
          return {
            name: start[1],
            parametersText: parameterLines.join(', '),
            returnType: normalizeMultilineTypeExpression(returnTypeLines),
            nextIndex: nextIndex + 1,
          };
        }
        if (trimmed === '') {
          return null;
        }
        returnTypeLines.push(trimmed);
        nextIndex += 1;
      }
      return null;
    }

    const parameterLine = /^    (.+),$/.exec(lines[nextIndex] ?? '');
    if (parameterLine === null) {
      return null;
    }
    parameterLines.push(parameterLine[1]);
    nextIndex += 1;
  }

  return null;
}

export function tsFunctionReturnTypeExpression(pythonType: string): string {
  const typeExpression = tsTypeExpression(pythonType);
  return pythonType.includes('tuple[') ? typeExpression.replace(/\breadonly /g, '') : typeExpression;
}

function normalizeMultilineTypeExpression(lines: string[]): string {
  return lines
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\[\s+/g, '[')
    .replace(/\s+]/g, ']')
    .replace(/,\s*]/g, ']')
    .trim();
}
