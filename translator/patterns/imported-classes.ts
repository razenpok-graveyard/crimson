import fs from 'node:fs';
import path from 'node:path';
import { tsTargetRoot } from '../paths.js';
import { splitTopLevelComma } from './common.js';
import { functionSignatureMarker } from './function-headers.js';
import { classFieldTypeMarker, functionReturnTypeMarker, instanceMethodSignatureMarker } from './expression.js';

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
    const fields = importedStructConstructorFields(modulePath, name.importedName, relativePath);
    if (fields.length > 0) {
      structConstructorFields.set(name.localName, fields);
    }
  }
}

export function recordImportedClassFieldTypes(
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
    for (const field of importedClassFieldTypes(classSource)) {
      moduleNameMap.set(classFieldTypeMarker(name.localName, field.name), field.typeExpression);
      moduleNameMap.set(classFieldTypeMarker(name.importedName, field.name), field.typeExpression);
    }
  }
}

export function recordImportedTupleTypeAliases(
  modulePath: string,
  names: { importedName: string; localName: string }[],
  relativePath: string,
  tupleTypeAliases: Set<string>,
): void {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  if (sourcePath === null || !fs.existsSync(sourcePath)) {
    return;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const name of names) {
    if (exportedTypeAliasLooksTuple(source, name.importedName)) {
      tupleTypeAliases.add(name.localName);
    }
  }
}

export function recordImportedMapNames(
  modulePath: string,
  names: { importedName: string; localName: string }[],
  relativePath: string,
  mapNames: Set<string>,
): void {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  if (sourcePath === null || !fs.existsSync(sourcePath)) {
    return;
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const name of names) {
    if (exportedConstLooksMap(source, name.importedName)) {
      mapNames.add(name.localName);
      mapNames.add(name.importedName);
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
    const signature = importedFunctionSignature(modulePath, name.importedName, relativePath);
    if (signature === null) {
      continue;
    }
    if (signature.returnType !== null) {
      moduleNameMap.set(functionReturnTypeMarker(name.localName), `ReturnType<typeof ${name.localName}>`);
      moduleNameMap.set(functionReturnTypeMarker(name.importedName), `ReturnType<typeof ${name.importedName}>`);
    }
    const signatureJson = JSON.stringify({
      positional: signature.positional,
      returnTupleMarkers: signature.returnTupleMarkers,
    });
    moduleNameMap.set(functionSignatureMarker(name.localName), signatureJson);
    moduleNameMap.set(functionSignatureMarker(name.importedName), signatureJson);
  }
}

function importedInstanceMethodSignatures(classSource: string): { methodName: string; positional: string[] }[] {
  const signatures: { methodName: string; positional: string[] }[] = [];
  const methodStart = /^\s+(?!(?:constructor|static|get|set)\b)(?:(?:public|private|protected)\s+)?(?:(?:abstract|async)\s+)*(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>\n]+>)?\(/gm;
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

function importedClassFieldTypes(classSource: string): { name: string; typeExpression: string }[] {
  const fields: { name: string; typeExpression: string }[] = [
    ...[...classSource.matchAll(/^\s+(?:(?:public|private|protected)\s+)?(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\??:\s*([^;=\n]+)\s*(?:[;=])/gm)]
      .map((match) => ({
        name: match[1],
        typeExpression: match[2].trim(),
      })),
    ...[...classSource.matchAll(/^\s+get ([A-Za-z_$][A-Za-z0-9_$]*)\(\):\s*([^{\n]+)\s+\{/gm)]
      .map((match) => ({
        name: match[1],
        typeExpression: match[2].trim(),
      })),
  ];
  const seen = new Set(fields.map((field) => field.name));
  for (const match of classSource.matchAll(/^\s+(?:(?:public|private|protected)\s+)?(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([^;\n]+)\s*;/gm)) {
    const typeExpression = inferredClassFieldInitializerType(match[2]);
    if (typeExpression === null || seen.has(match[1])) {
      continue;
    }
    fields.push({
      name: match[1],
      typeExpression,
    });
    seen.add(match[1]);
  }
  return fields;
}

function inferredClassFieldInitializerType(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === 'true' || trimmed === 'false') {
    return 'boolean';
  }
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return 'number';
  }
  if (/^(?:'[^']*'|"[^"]*"|`[^`]*`)$/.test(trimmed)) {
    return 'string';
  }
  return null;
}

function importedStructConstructorFields(
  modulePath: string,
  className: string,
  relativePath: string,
  seen: Set<string> = new Set(),
): string[] {
  const sourcePath = tsSourcePathForImportPath(modulePath, relativePath);
  if (sourcePath === null || !fs.existsSync(sourcePath)) {
    return [];
  }
  const source = fs.readFileSync(sourcePath, 'utf8');
  return structConstructorFieldsFromSource(source, sourcePath, className, seen);
}

function structConstructorFieldsFromSource(
  source: string,
  sourcePath: string,
  className: string,
  seen: Set<string>,
): string[] {
  const seenKey = `${sourcePath}:${className}`;
  if (seen.has(seenKey)) {
    return [];
  }
  seen.add(seenKey);

  const classSource = exportedClassSource(source, className);
  if (classSource === null) {
    return [];
  }

  const inheritedFields = inheritedStructConstructorFields(source, sourcePath, classSource, seen);
  const ownFields = structConstructorFieldsFromClassSource(classSource);
  return uniqueFieldNames([...inheritedFields, ...ownFields]);
}

function structConstructorFieldsFromClassSource(classSource: string): string[] {
  const constructor = /constructor\(opts: \{([\s\S]*?)\}\s*=?.*?\)/.exec(classSource);
  if (constructor === null) {
    return [];
  }
  return [...constructor[1].matchAll(/(?:^|[;\n])\s*([A-Za-z_$][A-Za-z0-9_$]*)\??:/g)]
    .map((match) => match[1]);
}

function inheritedStructConstructorFields(
  source: string,
  sourcePath: string,
  classSource: string,
  seen: Set<string>,
): string[] {
  const inheritedClass = /^export\s+(?:abstract\s+)?class\s+[A-Za-z_$][A-Za-z0-9_$]*(?:<[^>{]+>)?\s+extends\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/m.exec(classSource);
  if (inheritedClass === null) {
    return [];
  }

  const baseName = inheritedClass[1];
  const importedBase = importedClassBinding(source, baseName);
  if (importedBase !== null) {
    return importedStructConstructorFields(
      importedBase.modulePath,
      importedBase.importedName,
      path.relative(tsTargetRoot, sourcePath),
      seen,
    );
  }
  return structConstructorFieldsFromSource(source, sourcePath, baseName, seen);
}

function importedClassBinding(source: string, localName: string): { importedName: string; modulePath: string } | null {
  for (const match of source.matchAll(/import(?:\s+type)?\s+\{([\s\S]*?)\}\s+from\s+'([^']+)'/g)) {
    for (const part of splitTopLevelComma(match[1])) {
      const binding = /^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/.exec(part.trim());
      if (binding !== null && (binding[2] ?? binding[1]) === localName) {
        return { importedName: binding[1], modulePath: match[2] };
      }
    }
  }
  return null;
}

function uniqueFieldNames(fields: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const field of fields) {
    if (!seen.has(field)) {
      seen.add(field);
      unique.push(field);
    }
  }
  return unique;
}

type ImportedFunctionSignature = {
  returnType: string | null;
  positional: string[];
  returnTupleMarkers?: ('array' | 'map' | 'object' | 'rectangle' | 'set' | 'string' | 'vector' | null)[];
};

function importedFunctionSignature(
  modulePath: string,
  functionName: string,
  relativePath: string,
): ImportedFunctionSignature | null {
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
  const positional = splitTopLevelComma(source.slice(openIndex + 1, closeIndex))
    .map((parameter) => /^(?:readonly\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\??(?:\s*:|\s*=)/.exec(parameter.trim())?.[1] ?? null)
    .filter((name): name is string => name !== null && name !== 'opts');
  const returnType = /^\s*:\s*([^{};=\n]+)\s*\{/.exec(source.slice(closeIndex + 1))?.[1]?.trim();
  return {
    returnType: returnType === undefined || returnType === '' ? null : returnType,
    positional,
    returnTupleMarkers: returnType === undefined ? undefined : returnTupleMarkersForTsType(returnType),
  };
}

function returnTupleMarkersForTsType(
  typeExpression: string,
): ('array' | 'map' | 'object' | 'rectangle' | 'set' | 'string' | 'vector' | null)[] | undefined {
  const tupleType = /^(?:readonly\s+)?\[([\s\S]+)\]$/.exec(typeExpression.trim());
  if (tupleType === null) {
    return undefined;
  }
  return splitTopLevelComma(tupleType[1]).map(returnMarkerForTsType);
}

function returnMarkerForTsType(typeExpression: string): 'array' | 'map' | 'object' | 'rectangle' | 'set' | 'string' | 'vector' | null {
  const trimmed = typeExpression.trim();
  if (/^(?:r[dl]|wgl)\.Rectangle$/.test(trimmed)) {
    return 'rectangle';
  }
  if (trimmed === 'Vec2' || /^(?:r[dl]|wgl)\.Vector2$/.test(trimmed)) {
    return 'vector';
  }
  if (trimmed === 'string') {
    return 'string';
  }
  if (trimmed.endsWith('[]') || /^readonly\s+/.test(trimmed)) {
    return 'array';
  }
  if (/^(?:Map|ReadonlyMap)</.test(trimmed)) {
    return 'map';
  }
  if (/^(?:Set|ReadonlySet)</.test(trimmed)) {
    return 'set';
  }
  if (/^(?:Record|BuiltinObject)\b/.test(trimmed)) {
    return 'object';
  }
  return null;
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
  return exportedClassSource(source, className);
}

function exportedClassSource(source: string, className: string): string | null {
  const escapedName = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const classStart = source.search(new RegExp(`export\\s+(?:abstract\\s+)?class\\s+${escapedName}\\b`));
  if (classStart === -1) {
    return null;
  }
  const nextExport = source.slice(classStart + 1).search(/\nexport\s+/);
  return nextExport === -1
    ? source.slice(classStart)
    : source.slice(classStart, classStart + 1 + nextExport);
}

function exportedTypeAliasLooksTuple(source: string, typeName: string): boolean {
  const escapedName = typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`export\\s+type\\s+${escapedName}\\s*=\\s*(?:readonly\\s+)?\\[`).test(source);
}

function exportedConstLooksMap(source: string, constName: string): boolean {
  const escapedName = constName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`export\\s+const\\s+${escapedName}(?::[^=]+)?\\s*=\\s*new\\s+Map\\b`).test(source);
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
