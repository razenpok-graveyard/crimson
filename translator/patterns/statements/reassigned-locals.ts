import { splitTopLevelComma } from '../common.js';

export function reassignedLocalNames(lines: string[], startIndex: number): Set<string> {
  const counts = new Map<string, number>();
  let firstStatementIndex = startIndex;
  while (firstStatementIndex < lines.length && lines[firstStatementIndex].trim() === '') {
    firstStatementIndex += 1;
  }
  const baseIndent = /^(\s+)/.exec(lines[firstStatementIndex] ?? '')?.[1] ?? null;
  if (baseIndent === null) {
    return new Set();
  }

  let index = firstStatementIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() !== '' && !line.startsWith(baseIndent)) {
      break;
    }
    const functionDefinition = /^(\s*)def ([A-Za-z_][A-Za-z0-9_]*)\(/.exec(line);
    if (functionDefinition !== null && line.startsWith(baseIndent)) {
      counts.set(functionDefinition[2], (counts.get(functionDefinition[2]) ?? 0) + 1);
      const blockIndent = `${functionDefinition[1]}    `;
      const blockEnd = skipIndentedBlock(lines, index + 1, blockIndent);
      countNonlocalAssignments(lines, index + 1, blockEnd, blockIndent, counts);
      index = blockEnd;
      continue;
    }
    const assignment = /^\s+([A-Za-z_][A-Za-z0-9_]*) (?:\/\/=|\+=|-=|\*=|\/=|\|=|&=|\^=|=) /.exec(line);
    if (assignment !== null) {
      counts.set(assignment[1], (counts.get(assignment[1]) ?? 0) + 1);
    }
    const annotatedAssignment = /^\s+([A-Za-z_][A-Za-z0-9_]*): .+ = /.exec(line);
    if (annotatedAssignment !== null) {
      counts.set(annotatedAssignment[1], (counts.get(annotatedAssignment[1]) ?? 0) + 1);
    }
    const tupleAssignment = /^\s+([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) = /.exec(line);
    if (tupleAssignment !== null) {
      for (const name of tupleAssignment[1].split(', ')) {
        if (name !== '_') {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    const mixedTupleAssignment = /^\s+(.+,.+) = /.exec(line);
    if (mixedTupleAssignment !== null) {
      const targets = splitTopLevelComma(mixedTupleAssignment[1]);
      if (!targets.some((target) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target.trim()))) {
        index += 1;
        continue;
      }
      for (const target of targets) {
        const name = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(target.trim())?.[1] ?? null;
        if (name !== null && name !== '_') {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    index += 1;
  }
  return new Set(
    [...counts.entries()]
      .filter((entry) => entry[1] > 1)
      .map((entry) => entry[0]),
  );
}

function skipIndentedBlock(lines: string[], index: number, blockIndent: string): number {
  let nextIndex = index;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? '';
    if (line.trim() !== '' && !line.startsWith(blockIndent)) {
      break;
    }
    nextIndex += 1;
  }
  return nextIndex;
}

function countNonlocalAssignments(
  lines: string[],
  startIndex: number,
  endIndex: number,
  blockIndent: string,
  counts: Map<string, number>,
): void {
  const names = new Set<string>();
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = lines[index] ?? '';
    if (!line.startsWith(blockIndent)) {
      continue;
    }
    const rest = line.slice(blockIndent.length);
    if (rest.startsWith(' ')) {
      continue;
    }
    const nonlocal = /^nonlocal ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(rest.trim());
    if (nonlocal !== null) {
      for (const name of nonlocal[1].split(', ')) {
        names.add(name);
      }
    }
  }
  if (names.size === 0) {
    return;
  }
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = lines[index] ?? '';
    const assignment = /^\s+([A-Za-z_][A-Za-z0-9_]*) (?:\/\/=|\+=|-=|\*=|\/=|\|=|&=|\^=|=) /.exec(line);
    if (assignment !== null && names.has(assignment[1])) {
      counts.set(assignment[1], (counts.get(assignment[1]) ?? 0) + 1);
    }
    const annotatedAssignment = /^\s+([A-Za-z_][A-Za-z0-9_]*): .+ = /.exec(line);
    if (annotatedAssignment !== null && names.has(annotatedAssignment[1])) {
      counts.set(annotatedAssignment[1], (counts.get(annotatedAssignment[1]) ?? 0) + 1);
    }
    const tupleAssignment = /^\s+([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) = /.exec(line);
    if (tupleAssignment !== null) {
      for (const name of tupleAssignment[1].split(', ')) {
        if (names.has(name)) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
    const mixedTupleAssignment = /^\s+(.+,.+) = /.exec(line);
    if (mixedTupleAssignment !== null) {
      const targets = splitTopLevelComma(mixedTupleAssignment[1]);
      if (!targets.some((target) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target.trim()))) {
        continue;
      }
      for (const target of targets) {
        const name = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(target.trim())?.[1] ?? null;
        if (name !== null && names.has(name)) {
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
  }
}

export function nullableLocalNames(lines: string[], startIndex: number): Set<string> {
  const names = new Set<string>();
  let firstStatementIndex = startIndex;
  while (firstStatementIndex < lines.length && lines[firstStatementIndex].trim() === '') {
    firstStatementIndex += 1;
  }
  const baseIndent = /^(\s+)/.exec(lines[firstStatementIndex] ?? '')?.[1] ?? null;
  if (baseIndent === null) {
    return names;
  }

  let index = firstStatementIndex;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() !== '' && !line.startsWith(baseIndent)) {
      break;
    }
    const assignment = /^\s+([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(line);
    if (assignment !== null && assignmentMayBeNull(assignment[2])) {
      names.add(assignment[1]);
    }
    const annotatedAssignment = /^\s+([A-Za-z_][A-Za-z0-9_]*): .+ = (.+)$/.exec(line);
    if (annotatedAssignment !== null && assignmentMayBeNull(annotatedAssignment[2])) {
      names.add(annotatedAssignment[1]);
    }
    index += 1;
  }
  return names;
}

function assignmentMayBeNull(pythonExpression: string): boolean {
  const trimmed = pythonExpression.trim();
  if (trimmed === 'None') {
    return true;
  }
  const dictGet = /^.+\.get\((.*)\)$/.exec(trimmed);
  if (dictGet === null) {
    return false;
  }
  return splitTopLevelComma(dictGet[1]).length === 1;
}
