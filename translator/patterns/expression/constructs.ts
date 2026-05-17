import { tsExportNameForPythonName } from '../../naming.js';
import {
  parsePythonStringExpression,
  splitTopLevelComma,
  tsStringLiteral,
} from '../common.js';
import { parseCallPrefix } from './scanners.js';

type ExpressionTranslator = (
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
) => string;

export function translateConstructFieldExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
  translateExpression: ExpressionTranslator,
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

export function translateConstructExpression(
  pythonExpression: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
  translateExpression: ExpressionTranslator,
): string | null {
  if (pythonExpression === 'Byte') {
    return 'constructByte()';
  }
  if (pythonExpression === 'Int32sl') {
    return 'constructInt32sl()';
  }
  if (pythonExpression === 'Int32ul') {
    return 'constructInt32ul()';
  }
  if (pythonExpression === 'Float32l') {
    return 'constructFloat32l()';
  }
  const arrayCall = parseCallPrefix(pythonExpression, 'Array');
  if (arrayCall !== null && arrayCall.rest === '') {
    const args = splitTopLevelComma(arrayCall.argsText);
    if (args.length === 2) {
      return `constructArray(${translateExpression(args[0], nameMap, arrayNames, validatedTypeAliases, mapNames)}, ${translateExpression(args[1], nameMap, arrayNames, validatedTypeAliases, mapNames)})`;
    }
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

export function looksLikeNumericByteLengthExpression(value: string): boolean {
  const atom = String.raw`(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?|[A-Z][A-Z0-9_]*)`;
  return new RegExp(String.raw`^${atom}(?:\s*(?:[+\-*]|//|>>|<<)\s*${atom})*$`).test(value);
}
