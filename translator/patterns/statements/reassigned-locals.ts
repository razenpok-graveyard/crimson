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
    if (lines[index].trim() !== '' && !lines[index].startsWith(baseIndent)) {
      break;
    }
    const assignment = /^\s+([A-Za-z_][A-Za-z0-9_]*) (?:\/\/=|\+=|-=|\*=|\/=|\|=|&=|\^=|=) /.exec(lines[index]);
    if (assignment !== null) {
      counts.set(assignment[1], (counts.get(assignment[1]) ?? 0) + 1);
    }
    const annotatedAssignment = /^\s+([A-Za-z_][A-Za-z0-9_]*): .+ = /.exec(lines[index]);
    if (annotatedAssignment !== null) {
      counts.set(annotatedAssignment[1], (counts.get(annotatedAssignment[1]) ?? 0) + 1);
    }
    const tupleAssignment = /^\s+([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+) = /.exec(lines[index]);
    if (tupleAssignment !== null) {
      for (const name of tupleAssignment[1].split(', ')) {
        if (name !== '_') {
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
