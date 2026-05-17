import { tsExportNameForPythonName } from '../../naming.js';
import {
  inferPythonExpressionType,
  isIndentedBlockLine,
} from '../common.js';
import {
  classFieldTypeMarker,
  functionReturnTypeMarker,
  receiverTypeNameMarker,
} from '../expression.js';
import { tsAttributeNameForPythonName } from './names.js';
import { lineStartsAtIndent } from './utils.js';

export function predeclareIfBranchAssignments(
  lines: string[],
  index: number,
  indent: string,
  declaredNames: Set<string>,
  reassignedNames: Set<string>,
  nameMap: ReadonlyMap<string, string>,
): string[] {
  const innerIndent = `${indent}    `;
  const assignedTypes = new Map<string, Set<string>>();
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      nextIndex += 1;
      continue;
    }
    if (line.startsWith(innerIndent)) {
      const rest = line.slice(innerIndent.length);
      const assignment = rest.startsWith(' ') ? null : /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(rest);
      if (assignment !== null && reassignedNames.has(assignment[1]) && !declaredNames.has(assignment[1])) {
        const types = assignedTypes.get(assignment[1]) ?? new Set<string>();
        types.add(inferPredeclaredAssignmentType(lines, nextIndex, innerIndent, assignment[2], nameMap));
        assignedTypes.set(assignment[1], types);
      }
      const tupleAssignment = rest.startsWith(' ') ? null : /^([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) = (.+)$/.exec(rest);
      if (tupleAssignment !== null) {
        for (const name of tupleAssignment[1].split(', ')) {
          if (name === '_' || !reassignedNames.has(name) || declaredNames.has(name)) {
            continue;
          }
          const types = assignedTypes.get(name) ?? new Set<string>();
          types.add(inferPythonExpressionType(tupleAssignment[2]));
          assignedTypes.set(name, types);
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

  const declarations: string[] = [];
  for (const [name, types] of assignedTypes) {
    const concreteTypes = [...types].filter((type) => type !== 'any');
    const candidateTypes = concreteTypes.length > 0 ? concreteTypes : [...types];
    const uniqueTypes = [...new Set(candidateTypes)];
    const type = uniqueTypes.length === 1 ? uniqueTypes[0] : uniqueTypes.join(' | ');
    declarations.push(`let ${tsExportNameForPythonName(name)}: ${type};`);
    declaredNames.add(name);
  }
  return declarations;
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
    types.add(inferPredeclaredAssignmentType(lines, nextIndex, /^(\s*)/.exec(line)?.[1] ?? innerIndent, assignment[2], nameMap));
    assignedTypes.set(assignment[1], types);
  }

  const declarations: string[] = [];
  for (const [name, types] of assignedTypes) {
    const concreteTypes = [...types].filter((type) => type !== 'any');
    const candidateTypes = concreteTypes.length > 0 ? concreteTypes : [...types];
    const uniqueTypes = [...new Set(candidateTypes)];
    const type = uniqueTypes.length === 1 ? uniqueTypes[0] : uniqueTypes.join(' | ');
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
        types.add(inferPredeclaredAssignmentType(lines, nextIndex, bodyIndent, assignment[2], nameMap));
        assignedTypes.set(assignment[1], types);
      }
      nextIndex += 1;
      continue;
    }
    return [];
  }

  const declarations: string[] = [];
  for (const [name, types] of assignedTypes) {
    const concreteTypes = [...types].filter((type) => type !== 'any');
    const candidateTypes = concreteTypes.length > 0 ? concreteTypes : [...types];
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
  nameMap: ReadonlyMap<string, string>,
): string[] {
  const innerIndent = `${indent}    `;
  const tryEndIndex = indentedBlockEndIndex(lines, index + 1, innerIndent);
  const finallyLine = lines[tryEndIndex] ?? '';
  if (!lineStartsAtIndent(finallyLine, indent) || finallyLine.trim() !== 'finally:') {
    return [];
  }
  const afterFinallyIndex = indentedBlockEndIndex(lines, tryEndIndex + 1, innerIndent);
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
    if (!nameReferencedAfterBlock(lines, afterFinallyIndex, indent, assignment[1])) {
      continue;
    }
    const types = assignedTypes.get(assignment[1]) ?? new Set<string>();
    types.add(inferPredeclaredAssignmentType(lines, lineIndex, innerIndent, assignment[2], nameMap));
    assignedTypes.set(assignment[1], types);
  }

  const declarations: string[] = [];
  for (const [name, types] of assignedTypes) {
    const concreteTypes = [...types].filter((type) => type !== 'any');
    const candidateTypes = concreteTypes.length > 0 ? concreteTypes : [...types];
    const uniqueTypes = [...new Set(candidateTypes)];
    declarations.push(`let ${tsExportNameForPythonName(name)}: ${uniqueTypes.length === 1 ? uniqueTypes[0] : uniqueTypes.join(' | ')};`);
    declaredNames.add(name);
  }
  return declarations;
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
    if (referencePattern.test(line.replace(/#.*/, ''))) {
      return true;
    }
    index += 1;
  }
  return false;
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
): string {
  const callExpression = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\(/.exec(assignedExpression.trim());
  if (callExpression !== null) {
    if (/^[A-Z][A-Za-z0-9_]*(?:Id|Type|Flags)$/.test(callExpression[1])) {
      return tsExportNameForPythonName(callExpression[1]);
    }
    const translatedCallee = nameMap.get(callExpression[1]) ?? tsExportNameForPythonName(callExpression[1]);
    const returnType = nameMap.get(functionReturnTypeMarker(translatedCallee))
      ?? nameMap.get(functionReturnTypeMarker(callExpression[1]));
    if (returnType !== undefined) {
      return returnType;
    }
  }
  const dottedField = /^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(assignedExpression.trim());
  if (dottedField !== null) {
    const receiver = nameMap.get(dottedField[1]) ?? tsExportNameForPythonName(dottedField[1]);
    const receiverType = nameMap.get(receiverTypeNameMarker(dottedField[1])) ?? nameMap.get(receiverTypeNameMarker(receiver));
    const fieldType = receiverType === undefined ? undefined : nameMap.get(classFieldTypeMarker(receiverType, tsAttributeNameForPythonName(dottedField[2])));
    if (fieldType !== undefined) {
      return fieldType;
    }
    if (dottedField[1] === 'self' || dottedField[1].startsWith('self.')) {
      return `typeof ${translateDottedTypeQueryExpression(assignedExpression.trim(), nameMap)}`;
    }
  }
  if (assignedExpression !== '(') {
    return inferPythonExpressionType(assignedExpression);
  }
  const expressionLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    const trimmed = line.trim();
    if (lineStartsAtIndent(line, indent) && trimmed === ')') {
      return expressionLines.length === 0
        ? 'any'
        : inferPredeclaredAssignmentType(lines, index, indent, expressionLines.join(' '), nameMap);
    }
    if (trimmed !== '') {
      expressionLines.push(trimmed);
    }
    nextIndex += 1;
  }
  return 'any';
}

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
