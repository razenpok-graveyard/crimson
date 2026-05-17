import { tsExportNameForPythonName } from '../../naming.js';
import {
  inferPythonExpressionType,
  isIndentedBlockLine,
  matchingCloseParen,
  splitTopLevelComma,
} from '../common.js';
import {
  booleanNameMarker,
  classFieldTypeMarker,
  functionReturnTypeMarker,
  mapValueTypeMarker,
  numberNameMarker,
  receiverTypeNameMarker,
  stringNameMarker,
  vectorNameMarker,
} from '../expression.js';
import { nullableTypeExpressionBase } from '../expression/types.js';
import { splitTopLevelAdditive } from '../expression/scanners.js';
import { reassignedLocalTypeAnnotation } from './local-declarations.js';
import { tsAttributeNameForPythonName } from './names.js';
import { lineStartsAtIndent } from './utils.js';

export function predeclareIfBranchAssignments(
  lines: string[],
  index: number,
  indent: string,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string> = new Set(),
  bodyStartIndex = index + 1,
): string[] {
  const innerIndent = `${indent}    `;
  const assignedTypes = new Map<string, { directTypes: Set<string>; nestedTypes: Set<string>; definiteAssignment: boolean }>();
  const localTypes = new Map<string, string>();
  const recordAssignedType = (name: string, type: string, nested: boolean, definiteAssignment: boolean): void => {
    const entry = assignedTypes.get(name) ?? { directTypes: new Set<string>(), nestedTypes: new Set<string>(), definiteAssignment: false };
    if (nested) {
      entry.nestedTypes.add(type);
    } else {
      entry.directTypes.add(type);
    }
    entry.definiteAssignment = entry.definiteAssignment || definiteAssignment;
    assignedTypes.set(name, entry);
    if (type !== 'any' && type !== 'unknown') {
      localTypes.set(name, type);
      localTypes.set(tsExportNameForPythonName(name), type);
    }
  };
  let nextIndex = bodyStartIndex;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(innerIndent)) {
      const lineIndent = /^(\s*)/.exec(line)?.[1] ?? innerIndent;
      const rest = line.slice(lineIndent.length);
      if (/^(?:class|def) [A-Za-z_][A-Za-z0-9_]*/.test(rest)) {
        nextIndex = indentedBlockEndIndex(lines, nextIndex + 1, `${lineIndent}    `);
        continue;
      }
      const assignment = rest.startsWith(' ') ? null : /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(rest);
      if (assignment !== null && !declaredNames.has(assignment[1])) {
        if (!reassignedNames.has(assignment[1]) && lineIndent !== innerIndent) {
          nextIndex += 1;
          continue;
        }
        const referencedAfterBlock = nameReferencedAfterBlock(lines, blockEndIndexForBranch(lines, nextIndex, indent), indent, assignment[1]);
        if (!reassignedNames.has(assignment[1]) && !referencedAfterBlock) {
          nextIndex += 1;
          continue;
        }
        recordAssignedType(
          assignment[1],
          inferPredeclaredAssignmentType(lines, nextIndex, lineIndent, assignment[2], nameMap, arrayNames, declaredNames, localTypes),
          lineIndent !== innerIndent,
          !reassignedNames.has(assignment[1]),
        );
      }
      const tupleAssignment = rest.startsWith(' ') ? null : /^([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) = (.+)$/.exec(rest);
      if (tupleAssignment !== null) {
        for (const [nameIndex, name] of tupleAssignment[1].split(', ').entries()) {
          if (name === '_' || !reassignedNames.has(name) || declaredNames.has(name)) {
            continue;
          }
          recordAssignedType(name, inferTupleElementAssignmentType(lines, nextIndex, lineIndent, tupleAssignment[2], nameIndex, nameMap, arrayNames, localTypes), lineIndent !== innerIndent, false);
        }
      }
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(indent) && (/^elif .+:$/.test(trimmed) || trimmed === 'else:')) {
      nextIndex += 1;
      continue;
    }
    break;
  }

  const blockEndIndex = nextIndex;
  const bodyStartedAfterConditionContinuation = bodyStartIndex !== index + 1;
  const declarations: string[] = [];
  for (const [name, { directTypes, nestedTypes, definiteAssignment }] of assignedTypes) {
    const referencedAfterBlock = nameReferencedAfterBlock(lines, blockEndIndex, indent, name);
    if (bodyStartedAfterConditionContinuation && !referencedAfterBlock) {
      continue;
    }
    if (reassignedNames.has(name)) {
      recordSubsequentSameBlockAssignmentTypes(
        lines,
        blockEndIndex,
        indent,
        name,
        nameMap,
        arrayNames,
        declaredNames,
        localTypes,
        (type) => directTypes.add(type),
      );
    }
    const types = new Set(directTypes);
    if (referencedAfterBlock) {
      for (const type of nestedTypes) {
        types.add(type);
      }
    }
    if (types.size === 0) {
      continue;
    }
    const type = reassignedLocalTypeAnnotation(reassignedNames, name) ?? predeclaredTypeExpression(types);
    declarations.push(`let ${tsExportNameForPythonName(name)}${definiteAssignment ? '!' : ''}: ${type};`);
    declaredNames.add(name);
  }
  return declarations;
}

function recordSubsequentSameBlockAssignmentTypes(
  lines: string[],
  startIndex: number,
  indent: string,
  name: string,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string>,
  declaredNames: ReadonlySet<string>,
  localTypes: Map<string, string>,
  recordType: (type: string) => void,
): void {
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith(indent)) {
      break;
    }
    const lineIndent = /^(\s*)/.exec(line)?.[1] ?? '';
    if (lineIndent.length < indent.length) {
      break;
    }
    if (lineIndent !== indent) {
      nextIndex += 1;
      continue;
    }
    const assignment = new RegExp(`^${name} = (.+)$`).exec(trimmed);
    if (assignment !== null) {
      const type = inferPredeclaredAssignmentType(lines, nextIndex, lineIndent, assignment[1], nameMap, arrayNames, declaredNames, localTypes);
      recordType(type);
      if (type !== 'any' && type !== 'unknown') {
        localTypes.set(name, type);
        localTypes.set(tsExportNameForPythonName(name), type);
      }
    }
    nextIndex += 1;
  }
}

function inferTupleElementAssignmentType(
  lines: string[],
  index: number,
  indent: string,
  assignedExpression: string,
  elementIndex: number,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string> = new Set(),
  localTypes: ReadonlyMap<string, string> = new Map(),
): string {
  const trimmed = assignedExpression.trim();
  const parts = splitTopLevelComma(trimmed);
  if (parts.length > 1 && parts.length > elementIndex) {
    return inferPredeclaredAssignmentType(lines, index, indent, parts[elementIndex], nameMap, arrayNames, new Set(), localTypes);
  }
  if (/\.normalized_with_length\(\)$/.test(trimmed) || /\.normalizedWithLength\(\)$/.test(trimmed)) {
    return elementIndex === 0 ? 'Vec2' : 'number';
  }
  const inferredType = inferPredeclaredAssignmentType(lines, index, indent, assignedExpression, nameMap, arrayNames, new Set(), localTypes);
  const tupleType = /^\[([\s\S]+)\]$/.exec(inferredType);
  if (tupleType !== null) {
    return splitTopLevelComma(tupleType[1])[elementIndex]?.trim() ?? 'any';
  }
  if (inferredType.startsWith('ReturnType<typeof ')) {
    return `${inferredType}[${elementIndex}]`;
  }
  return inferredType;
}

export function predeclareLoopBlockAssignments(
  lines: string[],
  index: number,
  indent: string,
  declaredNames: Set<string>,
  nameMap: ReadonlyMap<string, string>,
): string[] {
  const innerIndent = `${indent}    `;
  let blockEnd = index + 1;
  while (blockEnd < lines.length) {
    const line = lines[blockEnd] ?? '';
    if (line.trim() !== '' && !line.startsWith(innerIndent)) {
      break;
    }
    blockEnd += 1;
  }

  const assignedTypes = new Map<string, Set<string>>();
  for (let nextIndex = index + 1; nextIndex < blockEnd; nextIndex += 1) {
    const line = lines[nextIndex] ?? '';
    if (line.trim() === '' || !line.startsWith(innerIndent)) {
      continue;
    }
    const assignment = /^\s*([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(line);
    if (assignment === null || declaredNames.has(assignment[1]) || !nameReferencedAfterBlock(lines, blockEnd, indent, assignment[1])) {
      continue;
    }
    const types = assignedTypes.get(assignment[1]) ?? new Set<string>();
    types.add(inferPredeclaredAssignmentType(lines, nextIndex, /^(\s*)/.exec(line)?.[1] ?? innerIndent, assignment[2], nameMap, new Set(), declaredNames));
    assignedTypes.set(assignment[1], types);
  }

  const declarations: string[] = [];
  for (const [name, types] of assignedTypes) {
    const type = predeclaredTypeExpression(types);
    declarations.push(`let ${tsExportNameForPythonName(name)}: ${type};`);
    declaredNames.add(name);
  }
  return declarations;
}

export function predeclareMatchCaseAssignments(
  lines: string[],
  index: number,
  indent: string,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string> = new Set(),
): string[] {
  const caseIndent = `${indent}    `;
  const bodyIndent = `${caseIndent}    `;
  const assignedTypes = new Map<string, Set<string>>();
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (!line.startsWith(caseIndent)) {
      break;
    }
    if (/^case .+:$/.test(line.slice(caseIndent.length))) {
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(bodyIndent)) {
      const rest = line.slice(bodyIndent.length);
      const assignment = rest.startsWith(' ') ? null : /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(rest);
      if (assignment !== null && reassignedNames.has(assignment[1]) && !declaredNames.has(assignment[1])) {
        const types = assignedTypes.get(assignment[1]) ?? new Set<string>();
        types.add(inferPredeclaredAssignmentType(lines, nextIndex, bodyIndent, assignment[2], nameMap, arrayNames, declaredNames));
        assignedTypes.set(assignment[1], types);
      }
      nextIndex += 1;
      continue;
    }
    return [];
  }

  const declarations: string[] = [];
  addFollowingAssignmentTypes(lines, nextIndex, indent, assignedTypes, nameMap, arrayNames, declaredNames);
  for (const [name, types] of assignedTypes) {
    const allTypes = flattenUnionTypes(types);
    const concreteTypes = allTypes.filter((type) => type !== 'any');
    const candidateTypes = concreteTypes.length > 0 ? concreteTypes : allTypes;
    const uniqueTypes = [...new Set(candidateTypes)];
    const type = uniqueTypes.length === 1 ? uniqueTypes[0] : uniqueTypes.join(' | ');
    declarations.push(`let ${tsExportNameForPythonName(name)}: ${type};`);
    declaredNames.add(name);
  }
  return declarations;
}

export function predeclareTryFinallyAssignments(
  lines: string[],
  index: number,
  indent: string,
  declaredNames: Set<string>,
  reassignedNames: ReadonlySet<string>,
  nameMap: ReadonlyMap<string, string>,
): string[] {
  const innerIndent = `${indent}    `;
  const tryEndIndex = indentedBlockEndIndex(lines, index + 1, innerIndent);
  const firstClauseIndex = firstNonBlankIndex(lines, tryEndIndex);
  const firstClause = (lines[firstClauseIndex] ?? '').trim();
  const predeclareAllReferencedTryAssignments = firstClause === 'finally:';
  const afterTryIndex = tryStatementEndIndex(lines, firstClauseIndex, indent, innerIndent);
  if (afterTryIndex === null) {
    return [];
  }
  const assignedTypes = new Map<string, Set<string>>();
  for (let lineIndex = index + 1; lineIndex < tryEndIndex; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    if (!lineStartsAtIndent(line, innerIndent)) {
      continue;
    }
    const statement = line.slice(innerIndent.length);
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(statement);
    if (assignment === null || declaredNames.has(assignment[1])) {
      continue;
    }
    if (!predeclareAllReferencedTryAssignments && !reassignedNames.has(assignment[1])) {
      continue;
    }
    if (!nameReferencedAfterBlock(lines, afterTryIndex, indent, assignment[1])) {
      continue;
    }
    const types = assignedTypes.get(assignment[1]) ?? new Set<string>();
    types.add(inferPredeclaredAssignmentType(lines, lineIndex, innerIndent, assignment[2], nameMap, new Set(), declaredNames));
    assignedTypes.set(assignment[1], types);
  }

  const declarations: string[] = [];
  for (const [name, types] of assignedTypes) {
    declarations.push(`let ${tsExportNameForPythonName(name)}: ${predeclaredTypeExpression(types)};`);
    declaredNames.add(name);
  }
  return declarations;
}

function tryStatementEndIndex(
  lines: string[],
  firstClauseIndex: number,
  indent: string,
  innerIndent: string,
): number | null {
  let index = firstNonBlankIndex(lines, firstClauseIndex);
  const firstLine = lines[index] ?? '';
  if (!lineStartsAtIndent(firstLine, indent)) {
    return null;
  }
  if (firstLine.trim() === 'finally:') {
    return indentedBlockEndIndex(lines, index + 1, innerIndent);
  }
  if (!/^except\b.*:/.test(firstLine.trim())) {
    return null;
  }
  while (index < lines.length) {
    index = firstNonBlankIndex(lines, index);
    const line = lines[index] ?? '';
    if (!lineStartsAtIndent(line, indent)) {
      break;
    }
    const trimmed = line.trim();
    if (/^except\b.*:/.test(trimmed) || trimmed === 'else:' || trimmed === 'finally:') {
      index = indentedBlockEndIndex(lines, index + 1, innerIndent);
      continue;
    }
    break;
  }
  return index;
}

function firstNonBlankIndex(lines: string[], startIndex: number): number {
  let index = startIndex;
  while (index < lines.length && (lines[index] ?? '').trim() === '') {
    index += 1;
  }
  return index;
}

function predeclaredTypeExpression(types: Iterable<string>): string {
  const allTypes = flattenUnionTypes(types);
  const concreteTypes = allTypes.filter((type) => (
    type !== 'any'
    && type !== 'unknown'
    && !/^ReturnType<typeof [A-Za-z_$][A-Za-z0-9_$]*>\[\d+\]$/.test(type)
  ));
  const candidateTypes = concreteTypes.length > 0 ? concreteTypes : allTypes;
  const uniqueTypes = [...new Set(candidateTypes)];
  return uniqueTypes.length === 1 ? uniqueTypes[0] : uniqueTypes.join(' | ');
}

function flattenUnionTypes(types: Iterable<string>): string[] {
  return [...types].flatMap((type) => type.split('|').map((part) => part.trim()).filter((part) => part !== ''));
}

function nameReferencedAfterBlock(lines: string[], startIndex: number, indent: string, name: string): boolean {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const referencePattern = new RegExp(`\\b${escapedName}\\b`);
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() !== '' && !line.startsWith(indent)) {
      break;
    }
    const lineIndent = /^(\s*)/.exec(line)?.[1] ?? '';
    const trimmed = line.trim();
    if (new RegExp(`^for\\s+${escapedName}\\s+in\\b`).test(trimmed)) {
      index = indentedBlockEndIndex(lines, index + 1, `${lineIndent}    `);
      continue;
    }
    const code = line
      .replace(/#.*/, '')
      .replace(new RegExp(`\\b${escapedName}\\s*=`, 'g'), '')
      .replace(new RegExp(`\\bfor\\s+${escapedName}\\s+in\\b`, 'g'), 'for  in')
      .replace(new RegExp(`\\bas\\s+${escapedName}\\b`, 'g'), 'as ');
    if (referencePattern.test(code)) {
      return true;
    }
    index += 1;
  }
  return false;
}

function blockEndIndexForBranch(lines: string[], startIndex: number, indent: string): number {
  const innerIndent = `${indent}    `;
  let nextIndex = startIndex;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(innerIndent)) {
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(indent) && (/^elif .+:$/.test(trimmed) || trimmed === 'else:')) {
      nextIndex += 1;
      continue;
    }
    break;
  }
  return nextIndex;
}

function indentedBlockEndIndex(lines: string[], startIndex: number, indent: string): number {
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() !== '' && !isIndentedBlockLine(lines, index, indent)) {
      break;
    }
    index += 1;
  }
  return index;
}

function inferPredeclaredAssignmentType(
  lines: string[],
  index: number,
  indent: string,
  assignedExpression: string,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string> = new Set(),
  declaredNames: ReadonlySet<string> = new Set(),
  localTypes: ReadonlyMap<string, string> = new Map(),
): string {
  const localReference = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(assignedExpression.trim());
  if (localReference !== null) {
    const name = localReference[0];
    const localType = localTypes.get(name) ?? localTypes.get(tsExportNameForPythonName(name));
    if (localType !== undefined) {
      return localType;
    }
    if (arrayNames.has(numberNameMarker(name))) {
      return 'number';
    }
    if (arrayNames.has(booleanNameMarker(name))) {
      return 'boolean';
    }
    if (arrayNames.has(stringNameMarker(name))) {
      return 'string';
    }
    if (arrayNames.has(vectorNameMarker(name))) {
      return 'Vec2';
    }
    if (declaredNames.has(name)) {
      return `typeof ${nameMap.get(name) ?? tsExportNameForPythonName(name)}`;
    }
  }
  const additive = splitTopLevelAdditive(assignedExpression.trim());
  if (
    additive !== null
    && additive.parts.length === 2
    && (additive.operators[0] === '+' || additive.operators[0] === '-')
    && additive.parts.some((part) => predeclaredExpressionLooksVector(part, nameMap, arrayNames))
  ) {
    return 'Vec2';
  }
  const mapSubscript = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\[.+\]$/.exec(assignedExpression.trim());
  if (mapSubscript !== null) {
    const mapName = nameMap.get(mapSubscript[1]) ?? tsExportNameForPythonName(mapSubscript[1]);
    const valueType = nameMap.get(mapValueTypeMarker(mapSubscript[1])) ?? nameMap.get(mapValueTypeMarker(mapName));
    if (valueType !== undefined) {
      return valueType;
    }
  }
  const callExpression = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(/.exec(assignedExpression.trim());
  const trimmedAssignedExpression = assignedExpression.trim();
  const callCloseParen = callExpression === null ? null : matchingCloseParen(trimmedAssignedExpression, callExpression[0].length - 1);
  const callIsWholeAssignment = callCloseParen === trimmedAssignedExpression.length - 1 || trimmedAssignedExpression.endsWith('(');
  if (callExpression !== null && callIsWholeAssignment) {
    if (/^[A-Z][A-Za-z0-9_]*(?:Id|Type|Flags)$/.test(callExpression[1])) {
      return tsExportNameForPythonName(callExpression[1]);
    }
    const methodReturnType = predeclaredMethodCallReturnType(callExpression[1], nameMap, localTypes);
    if (methodReturnType !== null) {
      return methodReturnType;
    }
    const translatedCallee = nameMap.get(callExpression[1]) ?? tsExportNameForPythonName(callExpression[1]);
    const returnType = nameMap.get(functionReturnTypeMarker(translatedCallee))
      ?? nameMap.get(functionReturnTypeMarker(callExpression[1]));
    if (returnType !== undefined) {
      return returnType;
    }
    const inferredType = inferPredeclaredFallbackType(assignedExpression);
    if (inferredType !== 'any') {
      return inferredType;
    }
    const fallbackReturnType = fallbackCallReturnType(callExpression[1], translatedCallee);
    if (fallbackReturnType !== null) {
      return fallbackReturnType;
    }
  }
  const dottedField = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(assignedExpression.trim());
  if (dottedField !== null) {
    const dottedType = predeclaredDottedExpressionType(assignedExpression.trim(), nameMap, localTypes);
    if (dottedType !== null) {
      return dottedType;
    }
    const receiver = nameMap.get(dottedField[1]) ?? tsExportNameForPythonName(dottedField[1]);
    const receiverType = nullableTypeExpressionBase(
      localTypes.get(dottedField[1])
        ?? localTypes.get(receiver)
        ?? nameMap.get(receiverTypeNameMarker(dottedField[1]))
        ?? nameMap.get(receiverTypeNameMarker(receiver))
        ?? null,
    );
    const fieldType = receiverType === undefined ? undefined : nameMap.get(classFieldTypeMarker(receiverType, tsAttributeNameForPythonName(dottedField[2])));
    if (fieldType !== undefined) {
      return fieldType;
    }
    if (dottedField[1] === 'self' || dottedField[1].startsWith('self.')) {
      return `typeof ${translateDottedTypeQueryExpression(assignedExpression.trim(), nameMap)}`;
    }
  }
  if (assignedExpression !== '(') {
    return inferPredeclaredFallbackType(assignedExpression);
  }
  const expressionLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (lineStartsAtIndent(line, indent) && trimmed === ')') {
      return expressionLines.length === 0
        ? 'any'
        : inferPredeclaredAssignmentType(lines, index, indent, expressionLines.join(' '), nameMap, arrayNames, declaredNames, localTypes);
    }
    if (trimmed !== '') {
      expressionLines.push(trimmed);
    }
    nextIndex += 1;
  }
  return 'any';
}

function addFollowingAssignmentTypes(
  lines: string[],
  startIndex: number,
  indent: string,
  assignedTypes: Map<string, Set<string>>,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string>,
  declaredNames: ReadonlySet<string>,
): void {
  const names = new Set(assignedTypes.keys());
  if (names.size === 0) {
    return;
  }
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (trimmed !== '' && !line.startsWith(indent)) {
      break;
    }
    if (trimmed === '') {
      index += 1;
      continue;
    }
    const lineIndent = /^(\s*)/.exec(line)?.[1] ?? '';
    const rest = line.slice(lineIndent.length);
    if (/^(?:class|def) [A-Za-z_][A-Za-z0-9_]*/.test(rest)) {
      index = indentedBlockEndIndex(lines, index + 1, `${lineIndent}    `);
      continue;
    }
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(rest);
    if (assignment !== null && names.has(assignment[1])) {
      const types = assignedTypes.get(assignment[1]);
      types?.add(inferPredeclaredAssignmentType(lines, index, lineIndent, assignment[2], nameMap, arrayNames, declaredNames));
    }
    index += 1;
  }
}

function predeclaredExpressionLooksVector(
  expression: string,
  nameMap: ReadonlyMap<string, string>,
  arrayNames: ReadonlySet<string>,
): boolean {
  const trimmed = expression.trim();
  if (/^(?:Vec2|new Vec2)\(/.test(trimmed)) {
    return true;
  }
  const localReference = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(trimmed);
  if (localReference !== null && localNameLooksVector(localReference[0])) {
    return true;
  }
  if (localReference !== null && arrayNames.has(vectorNameMarker(localReference[0]))) {
    return true;
  }
  const dottedField = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (dottedField === null) {
    return false;
  }
  const receiver = nameMap.get(dottedField[1]) ?? tsExportNameForPythonName(dottedField[1]);
  const receiverType = nullableTypeExpressionBase(
    nameMap.get(receiverTypeNameMarker(dottedField[1])) ?? nameMap.get(receiverTypeNameMarker(receiver)) ?? null,
  );
  return receiverType !== undefined && nameMap.get(classFieldTypeMarker(receiverType, tsAttributeNameForPythonName(dottedField[2]))) === 'Vec2';
}

function predeclaredMethodCallReturnType(
  callee: string,
  nameMap: ReadonlyMap<string, string>,
  localTypes: ReadonlyMap<string, string>,
): string | null {
  const dotted = /^(.+)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(callee);
  if (dotted === null) {
    return null;
  }
  const receiver = nameMap.get(dotted[1]) ?? tsExportNameForPythonName(dotted[1]);
  const methodName = tsAttributeNameForPythonName(dotted[2]);
  const receiverType = nullableTypeExpressionBase(
    localTypes.get(dotted[1])
      ?? localTypes.get(receiver)
      ?? nameMap.get(receiverTypeNameMarker(dotted[1]))
      ?? nameMap.get(receiverTypeNameMarker(receiver))
      ?? predeclaredDottedExpressionType(dotted[1], nameMap, localTypes)
      ?? null,
  );
  if (receiverType === undefined) {
    return null;
  }
  const declaredReturnType = nameMap.get(functionReturnTypeMarker(`${receiverType}.${methodName}`));
  if (declaredReturnType !== undefined) {
    return declaredReturnType;
  }
  if (receiverType === 'Vec2' || receiverType === 'wgl.Vector2') {
    return vectorMethodReturnType(methodName);
  }
  if (receiverType === 'Rect' && methodName === 'offset') {
    return 'Rect';
  }
  return null;
}

function predeclaredDottedExpressionType(
  expression: string,
  nameMap: ReadonlyMap<string, string>,
  localTypes: ReadonlyMap<string, string>,
): string | null {
  const parts = expression.split('.');
  if (parts.length < 2 || parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part))) {
    return null;
  }
  const root = parts[0];
  const rootName = nameMap.get(root) ?? tsExportNameForPythonName(root);
  let receiverType = nullableTypeExpressionBase(
    localTypes.get(root)
      ?? localTypes.get(rootName)
      ?? nameMap.get(receiverTypeNameMarker(root))
      ?? nameMap.get(receiverTypeNameMarker(rootName))
      ?? null,
  );
  if (receiverType === undefined) {
    return null;
  }
  let fieldType: string | undefined;
  for (const part of parts.slice(1)) {
    fieldType = nameMap.get(classFieldTypeMarker(receiverType, tsAttributeNameForPythonName(part)));
    receiverType = nullableTypeExpressionBase(fieldType ?? null);
    if (receiverType === undefined) {
      return fieldType ?? null;
    }
  }
  return fieldType ?? null;
}

function inferPredeclaredFallbackType(assignedExpression: string): string {
  const inferredType = inferPythonExpressionType(assignedExpression);
  return /^typeof [A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(inferredType)
    ? 'any'
    : inferredType;
}

function localNameLooksVector(name: string): boolean {
  return name.includes('_') && /(?:^|_)(?:pos|size|step|center|offset)(?:_|$)/.test(name);
}

function vectorMethodReturnType(methodName: string): string | null {
  return new Set([
    'add',
    'sub',
    'offset',
    'mul',
    'div',
    'rotated',
    'normalized',
    'perpLeft',
    'perpRight',
    'mulComponents',
    'divComponents',
    'directionTo',
  ]).has(methodName) ? 'Vec2' : null;
}

function fallbackCallReturnType(pythonCallee: string, translatedCallee: string): string | null {
  if (pythonCallee.includes('.')) {
    return null;
  }
  const pythonRoot = pythonCallee.split('.')[0] ?? pythonCallee;
  if (pythonBuiltinCallableNames.has(pythonRoot)) {
    return null;
  }
  const lastPart = translatedCallee.split('.').at(-1) ?? translatedCallee;
  if (/^[A-Z]/.test(lastPart)) {
    return null;
  }
  return `ReturnType<typeof ${translatedCallee}>`;
}

const pythonBuiltinCallableNames = new Set([
  'abs',
  'all',
  'any',
  'bool',
  'bytes',
  'bytearray',
  'cast',
  'chr',
  'dict',
  'enumerate',
  'filter',
  'float',
  'int',
  'isinstance',
  'len',
  'list',
  'map',
  'max',
  'min',
  'range',
  'repr',
  'reversed',
  'round',
  'set',
  'sorted',
  'str',
  'sum',
  'tuple',
  'zip',
]);

function translateDottedTypeQueryExpression(
  pythonExpression: string,
  nameMap: ReadonlyMap<string, string>,
): string {
  const parts = pythonExpression.split('.');
  const root = nameMap.get(parts[0]) ?? tsExportNameForPythonName(parts[0]);
  return [
    root,
    ...parts.slice(1).map(tsAttributeNameForPythonName),
  ].join('.');
}
