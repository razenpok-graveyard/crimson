import fs from 'node:fs';
import path from 'node:path';
import { tsTargetRoot } from '../paths.js';
import { splitTopLevelComma } from './common.js';
import { functionReturnTypeMarker, instanceMethodSignatureMarker } from './expression.js';

export function recordImportedInstanceMethodSignatures(
  modulePath: string,
  names: { importedName: string; localName: string }[],
  relativePath: string,
  moduleNameMap: Map<string, string>,
): void {
  for (const name of names) {
    const classSource = importedClassSource(modulePath, name.importedName, relativePath);
    if (classSource === null) {
      continue;
    }
    for (const signature of importedInstanceMethodSignatures(classSource)) {
      moduleNameMap.set(
        instanceMethodSignatureMarker(name.localName, signature.methodName),
        JSON.stringify({ positional: signature.positional }),
      );
    }
  }
}

export function recordImportedStructConstructorFields(
  modulePath: string,
  names: { importedName: string; localName: string }[],
  relativePath: string,
  structConstructorFields: Map<string, string[]>,
): void {
  for (const name of names) {
    const classSource = importedClassSource(modulePath, name.importedName, relativePath);
    if (classSource === null) {
      continue;
    }
    const constructor = /constructor\(opts: \{([\s\S]*?)\}\s*=?.*?\)/.exec(classSource);
    if (constructor === null) {
      continue;
    }
    const fields = [...constructor[1].matchAll(/(?:^|[;\n])\s*([A-Za-z_$][A-Za-z0-9_$]*)\??:/g)]
      .map((match) => match[1]);
    if (fields.length > 0) {
      structConstructorFields.set(name.localName, fields);
    }
  }
}

export function recordImportedFunctionReturnTypes(
  modulePath: string,
  names: { importedName: string; localName: string }[],
  relativePath: string,
  moduleNameMap: Map<string, string>,
): void {
  for (const name of names) {
    const returnType = importedFunctionReturnType(modulePath, name.importedName, relativePath);
    if (returnType === null) {
      continue;
    }
    moduleNameMap.set(functionReturnTypeMarker(name.localName), `ReturnType<typeof ${name.localName}>`);
    moduleNameMap.set(functionReturnTypeMarker(name.importedName), `ReturnType<typeof ${name.importedName}>`);
  }
}

function importedInstanceMethodSignatures(classSource: string): { methodName: string; positional: string[] }[] {
  const signatures: { methodName: string; positional: string[] }[] = [];
  const methodStart = /^\s+(?!(?:constructor|static|get|set)\b)(?:(?:public|private|protected)\s+)?(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>\n]+>)?\(/gm;
  for (const match of classSource.matchAll(methodStart)) {
    const openIndex = classSource.indexOf('(', match.index);
    const closeIndex = matchingCloseParen(classSource, openIndex);
    if (openIndex === -1 || closeIndex === null || !/^\s*:/.test(classSource.slice(closeIndex + 1))) {
      continue;
    }
    const positional = splitTopLevelComma(classSource.slice(openIndex + 1, closeIndex))
      .map((parameter) => /^(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\??(?:\s*:|\s*=)/.exec(parameter.trim())?.[1] ?? null)
      .filter((name): name is string => name !== null && name !== 'opts');
    signatures.push({
      methodName: match[1],
      positional,
    });
  }
  return signatures;
}

function importedFunctionReturnType(modulePath: string, functionName: string, relativePath: string): string | null {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  if (sourcePath === null || !fs.existsSync(sourcePath)) {
    return null;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const functionStart = source.search(new RegExp(`export\\s+(?:async\\s+)?function\\s+${escapedName}\\b(?:<[^\\n(]+>)?\\s*\\(`));
  if (functionStart === -1) {
    return null;
  }
  const openIndex = source.indexOf('(', functionStart);
  const closeIndex = openIndex === -1 ? null : matchingCloseParen(source, openIndex);
  if (closeIndex === null) {
    return null;
  }
  const returnType = /^\s*:\s*([^{};=\n]+)\s*\{/.exec(source.slice(closeIndex + 1))?.[1]?.trim();
  return returnType === undefined || returnType === '' ? null : returnType;
}

function matchingCloseParen(source: string, openIndex: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (char === quote && source[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
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

function importedClassSource(modulePath: string, className: string, relativePath: string): string | null {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  if (sourcePath === null || !fs.existsSync(sourcePath)) {
    return null;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  const escapedName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const classStart = source.search(new RegExp(`export\\s+class\\s+${escapedName}\\b`));
  if (classStart === -1) {
    return null;
  }
  const nextExport = source.slice(classStart + 1).search(/\nexport\s+/);
  return nextExport === -1
    ? source.slice(classStart)
    : source.slice(classStart, classStart + 1 + nextExport);
}

function tsSourcePathForImportPath(modulePath: string, relativePath: string): string | null {
  if (modulePath.startsWith('@crimson/')) {
    return path.join(tsTargetRoot, 'crimson', modulePath.slice('@crimson/'.length));
  }
  if (modulePath.startsWith('@grim/')) {
    return path.join(tsTargetRoot, 'grim', modulePath.slice('@grim/'.length));
  }
  if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
    return path.resolve(tsTargetRoot, path.dirname(relativePath), modulePath);
  }
  return null;
}
