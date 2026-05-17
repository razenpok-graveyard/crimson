import type { ImportDefinition } from '../../model.js';

export function pushImportDefinition(imports: ImportDefinition[], importDefinition: ImportDefinition): void {
  const existing = imports.find((candidate) => (
    candidate.modulePath === importDefinition.modulePath
    && candidate.typeOnly === importDefinition.typeOnly
  ));
  if (existing === undefined) {
    imports.push(importDefinition);
    return;
  }
  for (const name of importDefinition.names) {
    if (!existing.names.includes(name)) {
      existing.names.push(name);
    }
  }
}

export function operatorIsAssignment(operator: string): boolean {
  return operator === '=';
}

export function appendTrailingCommentToResult<T extends { statements: string[]; nextIndex: number }>(
  result: T,
  comment: string | null,
): T {
  if (comment === null || result.statements.length === 0) {
    return result;
  }
  const statements = [...result.statements];
  if (statements.length === 1 && !statements[0].endsWith('{') && !statements[0].endsWith('}')) {
    statements[0] = `${statements[0]} // ${comment}`;
  } else {
    statements.push(`// ${comment}`);
  }
  return { ...result, statements };
}

export function collectMultilineParenthesizedExpression(
  lines: string[],
  index: number,
  initialExpression: string,
): { expression: string; nextIndex: number } | null {
  const expressionLines = [initialExpression];
  let balance = parenthesisDelta(initialExpression);
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const trimmed = lines[nextIndex].trim();
    if (trimmed !== '') {
      expressionLines.push(trimmed);
      balance += parenthesisDelta(trimmed);
      if (balance <= 0) {
        return {
          expression: expressionLines.join(' '),
          nextIndex: nextIndex + 1,
        };
      }
    }
    nextIndex += 1;
  }
  return null;
}

export function parenthesisDelta(line: string): number {
  let quote: string | null = null;
  let delta = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === quote && line[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      delta += 1;
    } else if (char === ')') {
      delta -= 1;
    }
  }
  return delta;
}

export function caseBodyStops(statements: string[]): boolean {
  for (let index = statements.length - 1; index >= 0; index -= 1) {
    const trimmed = statements[index].trim();
    if (trimmed === '') {
      continue;
    }
    return /^(?:return|throw|break|continue)\b/.test(trimmed);
  }
  return false;
}

export function addMutableName(names: ReadonlySet<string>, name: string): void {
  if (names instanceof Set) {
    names.add(name);
  }
}

export function lineStartsAtIndent(line: string, indent: string): boolean {
  return line.startsWith(indent) && !line.slice(indent.length).startsWith(' ');
}

export function hoistTryBlockDeclarations(statements: string[]): { declarations: string[]; statements: string[] } {
  const declarations: string[] = [];
  const rewritten = statements.map((statement) => {
    const destructuringDeclaration = /^(\s*)const \[([A-Za-z_$][A-Za-z0-9_$]*(?:, [A-Za-z_$][A-Za-z0-9_$]*)*)\] = (.+);$/.exec(statement);
    if (destructuringDeclaration !== null && destructuringDeclaration[1].length > 2) {
      return statement;
    }
    if (destructuringDeclaration !== null) {
      const typeExpression = tsTypeForAssignedExpression(destructuringDeclaration[3]);
      if (typeExpression !== null) {
        const names = destructuringDeclaration[2].split(', ');
        names.forEach((name, nameIndex) => {
          declarations.push(`let ${name}: ${typeExpression}[${nameIndex}];`);
        });
        return `${destructuringDeclaration[1]}[${destructuringDeclaration[2]}] = ${destructuringDeclaration[3]};`;
      }
    }
    const typedDeclaration = /^(\s*)(?:const|let) ([A-Za-z_$][A-Za-z0-9_$]*): ([^=]+) = (.+);$/.exec(statement);
    if (typedDeclaration !== null && typedDeclaration[1].length > 2) {
      return statement;
    }
    if (typedDeclaration !== null) {
      declarations.push(`let ${typedDeclaration[2]}: ${typedDeclaration[3].trim()};`);
      return `${typedDeclaration[1]}${typedDeclaration[2]} = ${typedDeclaration[4]};`;
    }
    const declaration = /^(\s*)(?:const|let) ([A-Za-z_$][A-Za-z0-9_$]*) = (.+);$/.exec(statement);
    if (declaration !== null && declaration[1].length > 2) {
      return statement;
    }
    if (declaration === null) {
      return statement;
    }
    const typeExpression = tsTypeForAssignedExpression(declaration[3]);
    if (typeExpression === null) {
      return statement;
    }
    declarations.push(`let ${declaration[2]}: ${typeExpression};`);
    return `${declaration[1]}${declaration[2]} = ${declaration[3]};`;
  });
  return { declarations, statements: rewritten };
}

function tsTypeForAssignedExpression(expression: string): string | null {
  const trimmed = expression.trim();
  const awaited = /^await (.+)$/.exec(trimmed);
  if (awaited !== null) {
    const innerType = tsTypeForAssignedExpression(awaited[1]);
    return innerType === null ? null : `Awaited<${innerType}>`;
  }
  if (/^new TextDecoder\(.+\)\.decode\(/.test(trimmed) || /\.trim\(\)$/.test(trimmed)) {
    return 'string';
  }
  const enumValidation = /\bObject\.values\(([A-Z][A-Za-z0-9_]*Mode)\)\.includes/.exec(trimmed);
  if (enumValidation !== null) {
    return enumValidation[1];
  }
  const constructor = /^new ([A-Za-z_$][A-Za-z0-9_$]*)\(/.exec(trimmed);
  if (constructor !== null) {
    if (constructor[1] === 'Set') {
      return 'Set<any>';
    }
    if (constructor[1] === 'Map') {
      return 'Map<any, any>';
    }
    return constructor[1];
  }
  const enumMode = /^([A-Z][A-Za-z0-9_]*Mode)(?:\.[A-Z0-9_]+)?$/.exec(trimmed);
  if (enumMode !== null) {
    return enumMode[1];
  }
  const strictMapGet = /^mapGetOrThrow\(([A-Za-z_$][A-Za-z0-9_.$]*),/.exec(trimmed);
  if (strictMapGet !== null) {
    return `NonNullable<ReturnType<typeof ${strictMapGet[1]}.get>>`;
  }
  const call = /^([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\(/.exec(trimmed);
  if (call !== null) {
    return `ReturnType<typeof ${call[1]}>`;
  }
  if (/^(?:true|false)$/.test(trimmed)) {
    return 'boolean';
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return 'number';
  }
  if (/^(?:"[^"]*"|'[^']*'|`[^`]*`)$/.test(trimmed)) {
    return 'string';
  }
  return null;
}
