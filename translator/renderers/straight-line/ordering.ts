import type { StraightLineModule } from '../../model.js';

export function partitionLeadingAssignmentsByEnumReference(module: StraightLineModule): {
  beforeEnums: StraightLineModule['leadingAssignments'];
  afterEnums: StraightLineModule['leadingAssignments'];
} {
  if (module.enums.length === 0 || module.leadingAssignments.length === 0) {
    return { beforeEnums: module.leadingAssignments, afterEnums: [] };
  }

  const enumPatterns = module.enums.map((enumDefinition) => identifierPattern(enumDefinition.name));
  const afterEnumAssignmentNames = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of module.leadingAssignments) {
      if (afterEnumAssignmentNames.has(assignment.name)) {
        continue;
      }
      const referenceText = [
        assignment.typeExpression ?? '',
        ...assignment.valueLines,
      ].join('\n');
      const referencesEnum = enumPatterns.some((pattern) => pattern.test(referenceText));
      const referencesAfterEnumAssignment = [...afterEnumAssignmentNames]
        .some((name) => identifierPattern(name).test(referenceText));
      if (referencesEnum || referencesAfterEnumAssignment) {
        afterEnumAssignmentNames.add(assignment.name);
        changed = true;
      }
    }
  }

  const beforeEnums: StraightLineModule['leadingAssignments'] = [];
  const afterEnums: StraightLineModule['leadingAssignments'] = [];
  for (const assignment of module.leadingAssignments) {
    (afterEnumAssignmentNames.has(assignment.name) ? afterEnums : beforeEnums).push(assignment);
  }
  return { beforeEnums, afterEnums };
}

export function leadingAssignmentsReferenceClass(module: StraightLineModule): boolean {
  if (module.classes.length === 0 || module.leadingAssignments.length === 0) {
    return false;
  }
  const assignmentText = module.leadingAssignments.flatMap((assignment) => assignment.valueLines).join('\n');
  return module.classes.some((structClass) => identifierPattern(structClass.name).test(assignmentText));
}

export function leadingAssignmentsReferenceLeadingStatementClass(module: StraightLineModule): boolean {
  if (module.leadingStatements.length === 0 || module.leadingAssignments.length === 0) {
    return false;
  }
  const classNames = new Set<string>();
  for (const statement of module.leadingStatements) {
    const classDeclaration = /^class ([A-Za-z_][A-Za-z0-9_]*)\b/.exec(statement);
    if (classDeclaration !== null) {
      classNames.add(classDeclaration[1]);
    }
  }
  if (classNames.size === 0) {
    return false;
  }
  const assignmentText = module.leadingAssignments.flatMap((assignment) => assignment.valueLines).join('\n');
  return [...classNames].some((className) => identifierPattern(className).test(assignmentText));
}

function identifierPattern(identifier: string): RegExp {
  return new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}
