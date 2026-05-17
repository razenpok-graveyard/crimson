import type { TypeAlias } from '../../model.js';

export function renderTypeAliasValidator(lines: string[], alias: TypeAlias): void {
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
