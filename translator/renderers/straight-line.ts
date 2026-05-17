import type { StraightLineModule } from '../model.js';
import { renderEnumDefinition } from './enums.js';
import { renderProtocolDefinition } from './protocols.js';
import {
  renderPlainClasses,
  renderSimpleModuleFunctions,
  renderStructClasses,
  renderStructTypeAliases,
} from './structs.js';
import {
  renderLeadingStatements,
  renderStraightLineAssignments,
} from './straight-line/assignments.js';
import {
  leadingAssignmentsReferenceClass,
  leadingAssignmentsReferenceLeadingStatementClass,
  partitionLeadingAssignmentsByEnumReference,
} from './straight-line/ordering.js';
import { renderTypeAliasValidator } from './straight-line/type-aliases.js';
import { menuViewHelperExports } from './straight-line/menu-view.js';
import { typeAliasValueUsageText } from './straight-line/type-usage.js';

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

  renderStructTypeAliases(lines, module.typeAliases, module.classes, typeAliasValueUsageText(module));
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

  const leadingAssignments = partitionLeadingAssignmentsByEnumReference(module);
  const renderClassesBeforeLeadingAssignments = leadingAssignmentsReferenceClass(module);
  const renderLeadingStatementsBeforeLeadingAssignments = leadingAssignmentsReferenceLeadingStatementClass(module);
  if (renderClassesBeforeLeadingAssignments) {
    renderStructClasses(lines, module.classes);
    if (module.classes.length > 0 && module.leadingAssignments.length + module.leadingStatements.length + module.enums.length + module.plainClasses.length + module.functions.length + module.assignments.length > 0) {
      lines.push('');
    }
  }

  if (renderLeadingStatementsBeforeLeadingAssignments) {
    renderLeadingStatements(lines, module.leadingStatements);
    if (module.leadingStatements.length > 0 && module.enums.length + module.leadingAssignments.length + (renderClassesBeforeLeadingAssignments ? 0 : module.classes.length) + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
      lines.push('');
    }
  }

  renderStraightLineAssignments(lines, leadingAssignments.beforeEnums);
  if (leadingAssignments.beforeEnums.length > 0 && (renderLeadingStatementsBeforeLeadingAssignments ? 0 : module.leadingStatements.length) + module.enums.length + leadingAssignments.afterEnums.length + (renderClassesBeforeLeadingAssignments ? 0 : module.classes.length) + module.plainClasses.length + module.functions.length + module.assignments.length > 0) {
    lines.push('');
  }

  if (!renderLeadingStatementsBeforeLeadingAssignments) {
    renderLeadingStatements(lines, module.leadingStatements);
    if (module.leadingStatements.length > 0 && module.enums.length + leadingAssignments.afterEnums.length + module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
      lines.push('');
    }
  }

  for (let index = 0; index < module.enums.length; index += 1) {
    renderEnumDefinition(lines, module.enums[index]);
    if (index < module.enums.length - 1) {
      lines.push('');
    }
  }
  if (module.enums.length > 0 && leadingAssignments.afterEnums.length + module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  renderStraightLineAssignments(lines, leadingAssignments.afterEnums);
  if (leadingAssignments.afterEnums.length > 0 && module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  if (!renderClassesBeforeLeadingAssignments) {
    renderStructClasses(lines, module.classes);
    if (module.classes.length > 0 && module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
      lines.push('');
    }
  }

  renderPlainClasses(lines, module.plainClasses);
  const menuHelperExports = menuViewHelperExports(relativePath, module);
  if (module.plainClasses.length > 0 && menuHelperExports.length > 0) {
    lines.push('');
  }
  lines.push(...menuHelperExports);
  if ((module.plainClasses.length > 0 || menuHelperExports.length > 0) && module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
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
