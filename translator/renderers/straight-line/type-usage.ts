import type { StraightLineModule } from '../../model.js';

export function typeAliasValueUsageText(module: StraightLineModule): string {
  return [
    ...module.leadingAssignments.flatMap((assignment) => assignment.valueLines),
    ...module.assignments.flatMap((assignment) => assignment.valueLines),
    ...module.leadingStatements,
    ...module.trailingStatements,
    ...module.functions.flatMap((fn) => fn.statements),
    ...module.classes.flatMap((structClass) => [
      ...structClass.postInitStatements,
      ...structClass.methods.flatMap((method) => method.statements),
    ]),
    ...module.plainClasses.flatMap((plainClass) => [
      ...plainClass.constructorDefinition.statements,
      ...plainClass.methods.flatMap((method) => method.statements),
    ]),
  ].join('\n');
}
