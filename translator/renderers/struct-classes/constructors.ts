import type { StructModule } from '../../model.js';

export function fieldsAssignedByPostInit(statements: readonly string[]): Set<string> {
  const fields = new Set<string>();
  for (const statement of statements) {
    const assignment = /^this\.([A-Za-z_$][A-Za-z0-9_$]*) = /.exec(statement);
    if (assignment !== null) {
      fields.add(assignment[1]);
    }
  }
  return fields;
}

export function shouldRenderPositionalConstructor(structClass: StructModule['classes'][number]): boolean {
  return structClass.positionalConstructor === true
    && structClass.extendsName === undefined
    && structClass.fields.length > 0
    && structClass.postInitStatements.length === 0
    && allStructFieldsHaveDefaults(structClass)
    && ['number', 'string', 'boolean'].includes(structClass.fields[0].typeExpression);
}

export function renderPositionalStructConstructor(lines: string[], structClass: StructModule['classes'][number]): void {
  const optsType = inlineStructConstructorOptsType(structClass);
  const firstField = structClass.fields[0];
  const firstParamName = `optsOr${firstField.name[0].toUpperCase()}${firstField.name.slice(1)}`;
  const positionalParams = structClass.fields
    .map((field) => `${field.name}?: ${field.typeExpression}`)
    .join(', ');
  const implementationParams = [
    `${firstParamName}: ${optsType} | ${firstField.typeExpression} = {}`,
    ...structClass.fields.slice(1).map((field) => `${field.name}: ${field.typeExpression} = ${field.defaultValue}`),
  ];
  lines.push(`  constructor(opts?: ${optsType});`);
  lines.push(`  constructor(${positionalParams});`);
  lines.push(`  constructor(${implementationParams.join(', ')}) {`);
  lines.push(`    if (typeof ${firstParamName} === 'object' && ${firstParamName} !== null) {`);
  for (const field of structClass.fields) {
    lines.push(`      this.${field.name} = ${defaultedOptionExpression(`${firstParamName}.${field.name}`, field.typeExpression, field.defaultValue!)};`);
  }
  lines.push('      return;');
  lines.push('    }');
  lines.push(`    this.${firstField.name} = ${firstParamName} ?? ${firstField.defaultValue};`);
  for (const field of structClass.fields.slice(1)) {
    lines.push(`    this.${field.name} = ${field.name};`);
  }
  lines.push('  }');
}

export function structConstructorOptsType(structClass: StructModule['classes'][number]): string {
  const ownFields = [
    '{',
    ...structClass.fields.map((field) => `    ${field.name}${field.defaultValue === null ? '' : '?'}: ${field.typeExpression};`),
    '  }',
  ].join('\n');
  return structClass.extendsName === undefined
    ? ownFields
    : `${ownFields} & ConstructorParameters<typeof ${structClass.extendsName}>[0]`;
}

export function allStructFieldsHaveDefaults(structClass: StructModule['classes'][number]): boolean {
  return structClass.fields.every((field) => field.defaultValue !== null);
}

export function defaultedOptionExpression(optionExpression: string, typeExpression: string, defaultValue: string): string {
  if (typeExpression.startsWith('readonly ') && typeExpression.endsWith('[]')) {
    return `Array.from(${optionExpression} ?? ${defaultValue})`;
  }
  return typeExpression.includes('null') && defaultValue !== 'null'
    ? `${optionExpression} !== undefined ? ${optionExpression} : ${defaultValue}`
    : `${optionExpression} ?? ${defaultValue}`;
}

function inlineStructConstructorOptsType(structClass: StructModule['classes'][number]): string {
  return `{ ${structClass.fields.map((field) => `${field.name}${field.defaultValue === null ? '' : '?'}: ${field.typeExpression}`).join('; ')} }`;
}
