import type { EnumDefinition } from '../model.js';

export function renderIntEnumModule(relativePath: string, enumDefinition: EnumDefinition): string {
  const lines = [`// Port of ${relativePath}`, ''];
  renderEnumDefinition(lines, enumDefinition);
  if (enumDefinition.valueFunction !== undefined) {
    const fn = enumDefinition.valueFunction;
    const fallback = fn.fallbackMember;
    const caseMembers = [
      ...enumDefinition.members.filter((member) => member.name !== fallback),
      ...enumDefinition.members.filter((member) => member.name === fallback),
    ];
    lines.push('');
    lines.push(`export function ${fn.name}(`);
    lines.push(`  ${fn.parameterName}: number,`);
    lines.push(`): ${enumDefinition.name} {`);
    if (fn.rejectsOverflow) {
      lines.push(`  if (!Number.isFinite(${fn.parameterName})) {`);
      lines.push(`    return ${enumDefinition.name}.${fallback};`);
      lines.push('  }');
    }
    lines.push(`  switch (int(${fn.parameterName})) {`);
    for (const member of caseMembers) {
      lines.push(`    case ${enumDefinition.name}.${member.name}:`);
      lines.push(`      return ${enumDefinition.name}.${member.name};`);
    }
    lines.push('    default:');
    lines.push(`      return ${enumDefinition.name}.${fallback};`);
    lines.push('  }');
    lines.push('}');
  }
  lines.push('');
  return lines.join('\n');
}

export function renderEnumDefinition(lines: string[], enumDefinition: EnumDefinition): void {
  if (enumDefinition.docstring !== null) {
    for (const line of enumDefinition.docstring.split(/\r?\n/)) {
      lines.push(line === '' ? '//' : `// ${line}`);
    }
  }

  lines.push(`export enum ${enumDefinition.name} {`);
  for (const member of enumDefinition.members) {
    lines.push(`  ${member.name} = ${member.value},${member.trailingComment === undefined ? '' : ` // ${member.trailingComment}`}`);
  }
  lines.push('}');
}
