import type { StraightLineModule, TypeAlias } from '../model.js';
import { renderEnumDefinition } from './enums.js';
import { renderProtocolDefinition } from './protocols.js';
import {
  renderPlainClasses,
  renderSimpleModuleFunctions,
  renderStructClasses,
} from './structs.js';

export function renderStraightLineModule(relativePath: string, module: StraightLineModule): string {
  const lines = [`// Port of ${relativePath}`, ''];
  if (module.docstring !== null) {
    for (const line of module.docstring.split(/\r?\n/)) {
      lines.push(line === '' ? '//' : `// ${line}`);
    }
    lines.push('');
  }

  for (const importDefinition of module.imports) {
    lines.push(
      `import ${importDefinition.typeOnly ? 'type ' : ''}{ ${importDefinition.names.join(', ')} } from '${importDefinition.modulePath}';`,
    );
  }
  for (const namespaceImport of module.namespaceImports) {
    lines.push(`import * as ${namespaceImport.alias} from '${namespaceImport.modulePath}';`);
  }
  for (const reexport of module.reexports) {
    lines.push(`export { ${reexport.names.join(', ')} } from '${reexport.modulePath}';`);
  }
  if (module.imports.length + module.namespaceImports.length + module.reexports.length > 0) {
    lines.push('');
  }

  for (const alias of module.typeAliases) {
    lines.push(`${alias.exported === false ? '' : 'export '}type ${alias.name} = ${alias.typeExpression};`);
  }
  const validatedAliases = module.typeAliases.filter((alias) => alias.validation !== undefined);
  if (validatedAliases.length > 0) {
    lines.push('');
    for (let index = 0; index < validatedAliases.length; index += 1) {
      renderTypeAliasValidator(lines, validatedAliases[index]);
      if (index < validatedAliases.length - 1) {
        lines.push('');
      }
    }
  }
  if (module.typeAliases.length > 0 && module.protocols.length + module.enums.length + module.leadingAssignments.length + module.leadingStatements.length + module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  for (let index = 0; index < module.protocols.length; index += 1) {
    renderProtocolDefinition(lines, module.protocols[index]);
    if (index < module.protocols.length - 1) {
      lines.push('');
    }
  }
  if (module.protocols.length > 0 && module.enums.length + module.leadingAssignments.length + module.leadingStatements.length + module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  const renderClassesBeforeLeadingAssignments = leadingAssignmentsReferenceClass(module);
  if (renderClassesBeforeLeadingAssignments) {
    renderStructClasses(lines, module.classes);
    if (module.classes.length > 0 && module.leadingAssignments.length + module.leadingStatements.length + module.enums.length + module.plainClasses.length + module.functions.length + module.assignments.length > 0) {
      lines.push('');
    }
  }

  renderStraightLineAssignments(lines, module.leadingAssignments);
  if (module.leadingAssignments.length > 0 && module.leadingStatements.length + module.enums.length + (renderClassesBeforeLeadingAssignments ? 0 : module.classes.length) + module.plainClasses.length + module.functions.length + module.assignments.length > 0) {
    lines.push('');
  }

  for (const statement of module.leadingStatements) {
    lines.push(statement);
  }
  if (module.leadingStatements.length > 0 && module.enums.length + module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  for (let index = 0; index < module.enums.length; index += 1) {
    renderEnumDefinition(lines, module.enums[index]);
    if (index < module.enums.length - 1) {
      lines.push('');
    }
  }
  if (module.enums.length > 0 && module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  if (!renderClassesBeforeLeadingAssignments) {
    renderStructClasses(lines, module.classes);
    if (module.classes.length > 0 && module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
      lines.push('');
    }
  }

  renderPlainClasses(lines, module.plainClasses);
  if (module.plainClasses.length > 0 && module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  renderSimpleModuleFunctions(lines, module.functions, module.trailingStatements.length + module.assignments.length > 0);

  for (const statement of module.trailingStatements) {
    lines.push(statement);
  }
  if (module.trailingStatements.length > 0 && module.assignments.length > 0) {
    lines.push('');
  }

  renderStraightLineAssignments(lines, module.assignments);
  if (lines.at(-1) !== '') {
    lines.push('');
  }
  return lines.join('\n');
}

function leadingAssignmentsReferenceClass(module: StraightLineModule): boolean {
  if (module.classes.length === 0 || module.leadingAssignments.length === 0) {
    return false;
  }
  const assignmentText = module.leadingAssignments.flatMap((assignment) => assignment.valueLines).join('\n');
  return module.classes.some((structClass) => identifierPattern(structClass.name).test(assignmentText));
}

function identifierPattern(identifier: string): RegExp {
  return new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

function renderTypeAliasValidator(lines: string[], alias: TypeAlias): void {
  const checks: string[] = [];
  if (alias.validation?.minLength !== undefined) {
    checks.push(`value.length < ${alias.validation.minLength}`);
  }
  if (alias.validation?.maxLength !== undefined) {
    checks.push(`value.length > ${alias.validation.maxLength}`);
  }
  if (alias.validation?.pattern !== undefined) {
    checks.push(`!${alias.validation.pattern}.test(value)`);
  }
  if (alias.validation?.ge !== undefined) {
    checks.push(`value < ${alias.validation.ge}`);
  }
  if (alias.validation?.le !== undefined) {
    checks.push(`value > ${alias.validation.le}`);
  }

  lines.push(`function validate${alias.name}(value: ${alias.typeExpression}): ${alias.name} {`);
  if (checks.length > 0) {
    lines.push(`  if (${checks.join(' || ')}) {`);
    lines.push(`    throw new Error('invalid ${alias.name}');`);
    lines.push('  }');
  }
  lines.push('  return value;');
  lines.push('}');
}

function renderStraightLineAssignments(lines: string[], assignments: StraightLineModule['assignments']): void {
  for (const assignment of assignments) {
    for (const comment of assignment.comments ?? []) {
      lines.push(`// ${comment}`);
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
