import type { StructModule } from '../model.js';
import {
  functionBodyAssignsName,
  renderFunctionReturnType,
  renderParameter,
  renderTypeParameters,
} from './functions.js';

export function renderStructClasses(lines: string[], classes: StructModule['classes']): void {
  for (let index = 0; index < classes.length; index += 1) {
    const structClass = classes[index];
    if (structClass.docstring !== null) {
      for (const line of structClass.docstring.split(/\r?\n/)) {
        lines.push(line === '' ? '//' : `// ${line}`);
      }
    }
    const typeParams = structClass.typeParams === undefined || structClass.typeParams.length === 0
      ? ''
      : `<${structClass.typeParams.join(', ')}>`;
    const extendsClause = structClass.extendsName === undefined ? '' : ` extends ${structClass.extendsName}`;
    lines.push(`export class ${structClass.name}${typeParams}${extendsClause} {`);
    if (structClass.tagged) {
      lines.push(`  readonly ${structClass.tagField ?? 'tag'} = '${structClass.tagValue ?? structClass.name}';`);
    }
    const postInitAssignedFields = fieldsAssignedByPostInit(structClass.postInitStatements);
    for (const field of structClass.fields) {
      for (const comment of field.leadingComments ?? []) {
        lines.push(`  // ${comment}`);
      }
      const trailingComment = field.trailingComment === undefined ? '' : ` // ${field.trailingComment}`;
      lines.push(`  ${structClass.readonlyFields ? 'readonly ' : ''}${field.name}: ${field.typeExpression};${trailingComment}`);
    }
    const shouldRenderConstructor = structClass.fields.length > 0 || structClass.postInitStatements.length > 0;
    if (shouldRenderConstructor) {
      if (structClass.tagged || structClass.fields.length > 0) {
        lines.push('');
      }
      if (shouldRenderPositionalConstructor(structClass)) {
        renderPositionalStructConstructor(lines, structClass);
      } else if (structClass.fields.length > 0) {
        lines.push(`  constructor(opts: ${structConstructorOptsType(structClass)}${allStructFieldsHaveDefaults(structClass) ? ' = {}' : ''}) {`);
        if (structClass.extendsName !== undefined) {
          lines.push('    super(opts);');
        }
        for (const field of structClass.fields) {
          if (field.defaultValue === null) {
            lines.push(`    this.${field.name} = opts.${field.name};`);
          } else if (field.defaultValue === 'undefined!' && postInitAssignedFields.has(field.name)) {
            continue;
          } else {
            lines.push(`    this.${field.name} = ${defaultedOptionExpression(`opts.${field.name}`, field.typeExpression, field.defaultValue)};`);
          }
        }
      } else {
        lines.push('  constructor() {');
        if (structClass.extendsName !== undefined) {
          lines.push('    super();');
        }
      }
      for (const statement of structClass.postInitStatements) {
        lines.push(statement === '' ? '' : `    ${statement}`);
      }
      if (!shouldRenderPositionalConstructor(structClass)) {
        lines.push('  }');
      }
    }
    const methods = structClass.methods.filter((method) => method.name !== `get ${structClass.tagField ?? 'tag'}`);
    for (const method of methods) {
      lines.push('');
      const generator = method.statements.some((statement) => /^\s*yield\*? /.test(statement));
      const params = method.parameters.map(renderParameter);
      if (method.optsParams.length > 0) {
        const optsType = method.optsParams
          .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
          .join('; ');
        const allOptsHaveDefaults = method.optsParams.every((param) => param.defaultValue !== null);
        params.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
      }
      const returnType = method.name.startsWith('set ') ? '' : `: ${renderFunctionReturnType(method)}`;
      lines.push(`  ${method.static === true ? 'static ' : ''}${method.async === true ? 'async ' : ''}${generator ? '*' : ''}${method.name}${renderTypeParameters(method)}(${params.join(', ')})${returnType} {`);
      for (const param of method.optsParams) {
        const declaration = functionBodyAssignsName(method.statements, param.name) ? 'let' : 'const';
        if (param.defaultValue === null) {
          lines.push(`    ${declaration} ${param.name} = opts.${param.name};`);
        } else {
          lines.push(`    ${declaration} ${param.name} = opts.${param.name} ?? ${param.defaultValue};`);
        }
      }
      for (const statement of method.statements) {
        lines.push(statement === '' ? '' : `    ${statement}`);
      }
      lines.push('  }');
    }
    lines.push('}');
    if (index < classes.length - 1) {
      lines.push('');
    }
  }
}

function shouldRenderPositionalConstructor(structClass: StructModule['classes'][number]): boolean {
  return structClass.positionalConstructor === true
    && structClass.extendsName === undefined
    && structClass.fields.length > 0
    && structClass.postInitStatements.length === 0
    && allStructFieldsHaveDefaults(structClass)
    && ['number', 'string', 'boolean'].includes(structClass.fields[0].typeExpression);
}

function renderPositionalStructConstructor(lines: string[], structClass: StructModule['classes'][number]): void {
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

function inlineStructConstructorOptsType(structClass: StructModule['classes'][number]): string {
  return `{ ${structClass.fields.map((field) => `${field.name}${field.defaultValue === null ? '' : '?'}: ${field.typeExpression}`).join('; ')} }`;
}

function fieldsAssignedByPostInit(statements: readonly string[]): Set<string> {
  const fields = new Set<string>();
  for (const statement of statements) {
    const assignment = /^this\.([A-Za-z_$][A-Za-z0-9_$]*) = /.exec(statement);
    if (assignment !== null) {
      fields.add(assignment[1]);
    }
  }
  return fields;
}

function structConstructorOptsType(structClass: StructModule['classes'][number]): string {
  const ownFields = [
    '{',
    ...structClass.fields.map((field) => `    ${field.name}${field.defaultValue === null ? '' : '?'}: ${field.typeExpression};`),
    '  }',
  ].join('\n');
  return structClass.extendsName === undefined
    ? ownFields
    : `${ownFields} & ConstructorParameters<typeof ${structClass.extendsName}>[0]`;
}

function allStructFieldsHaveDefaults(structClass: StructModule['classes'][number]): boolean {
  return structClass.fields.every((field) => field.defaultValue !== null);
}

function defaultedOptionExpression(optionExpression: string, typeExpression: string, defaultValue: string): string {
  if (typeExpression.startsWith('readonly ') && typeExpression.endsWith('[]')) {
    return `Array.from(${optionExpression} ?? ${defaultValue})`;
  }
  return typeExpression.includes('null') && defaultValue !== 'null'
    ? `${optionExpression} !== undefined ? ${optionExpression} : ${defaultValue}`
    : `${optionExpression} ?? ${defaultValue}`;
}
