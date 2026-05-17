import type { StraightLineModule } from '../../model.js';

export function renderLeadingStatements(lines: string[], statements: string[]): void {
  for (const statement of statements) {
    lines.push(statement);
  }
}

export function renderStraightLineAssignments(lines: string[], assignments: StraightLineModule['assignments']): void {
  for (const assignment of assignments) {
    for (const comment of assignment.comments ?? []) {
      lines.push(comment === '' ? '//' : `// ${comment}`);
    }
    const exportPrefix = assignment.exported ? 'export ' : '';
    const typeSuffix = assignment.typeExpression === undefined ? '' : `: ${assignment.typeExpression}`;
    if (assignment.valueLines.length === 1) {
      const trailingComment = assignment.trailingComment === undefined ? '' : ` // ${assignment.trailingComment}`;
      lines.push(`${exportPrefix}${assignment.declaration} ${assignment.name}${typeSuffix} = ${assignment.valueLines[0]};${trailingComment}`);
      continue;
    }

    lines.push(`${exportPrefix}${assignment.declaration} ${assignment.name}${typeSuffix} = ${assignment.valueLines[0]}`);
    for (const valueLine of assignment.valueLines.slice(1, -1)) {
      lines.push(valueLine);
    }
    lines.push(`${assignment.valueLines.at(-1)};`);
  }
}
