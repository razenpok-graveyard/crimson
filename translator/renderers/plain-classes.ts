import type {
  FunctionParameter,
  StraightLineModule,
} from '../model.js';

function renderParameter(param: FunctionParameter): string {
  const defaultValue = param.defaultValue === undefined || param.defaultValue === null ? '' : ` = ${param.defaultValue}`;
  return `${param.name}: ${param.typeExpression}${defaultValue}`;
}

export function renderPlainClasses(lines: string[], classes: StraightLineModule['plainClasses']): void {
  for (let index = 0; index < classes.length; index += 1) {
    const plainClass = classes[index];
    if (plainClass.docstring !== null) {
      for (const line of plainClass.docstring.split(/\r?\n/)) {
        lines.push(line === '' ? '//' : `// ${line}`);
      }
    }
    lines.push(`export class ${plainClass.name}${plainClass.extendsName === undefined ? '' : ` extends ${plainClass.extendsName}`} {`);
    for (const field of plainClass.fields) {
      lines.push(`  ${field.private ? 'private ' : ''}${field.readonly ? 'readonly ' : ''}${field.name}: ${field.typeExpression};`);
    }
    const shouldRenderConstructor = (
      plainClass.fields.length > 0
      || plainClass.constructorDefinition.parameters.length > 0
      || plainClass.constructorDefinition.optsParams.length > 0
      || plainClass.constructorDefinition.statements.length > 0
    );
    if (shouldRenderConstructor) {
      lines.push('');
    }
    const constructorParams = plainClass.constructorDefinition.parameters.map(renderParameter);
    if (plainClass.constructorDefinition.optsParams.length > 0) {
      const optsType = plainClass.constructorDefinition.optsParams
        .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
        .join('; ');
      const allOptsHaveDefaults = plainClass.constructorDefinition.optsParams.every((param) => param.defaultValue !== null);
      constructorParams.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
    }
    if (shouldRenderConstructor) {
      lines.push(`  constructor(${constructorParams.join(', ')}) {`);
      for (const param of plainClass.constructorDefinition.optsParams) {
        const declaration = functionBodyAssignsName(plainClass.constructorDefinition.statements, param.name) ? 'let' : 'const';
        if (param.defaultValue === null) {
          lines.push(`    ${declaration} ${param.name} = opts.${param.name};`);
        } else {
          lines.push(`    ${declaration} ${param.name} = opts.${param.name} ?? ${param.defaultValue};`);
        }
      }
      for (const statement of plainClass.constructorDefinition.statements) {
        lines.push(statement === '' ? '' : `    ${statement}`);
      }
      lines.push('  }');
    }
    for (const method of plainClass.methods) {
      lines.push('');
      const params = method.parameters.map(renderParameter);
      if (method.optsParams.length > 0) {
        const optsType = method.optsParams
          .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
          .join('; ');
        const allOptsHaveDefaults = method.optsParams.every((param) => param.defaultValue !== null);
        params.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
      }
      lines.push(`  ${method.static === true ? 'static ' : ''}${method.async === true ? 'async ' : ''}${method.name}(${params.join(', ')}): ${renderFunctionReturnType(method)} {`);
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

function renderFunctionReturnType(fn: { async?: boolean; returnType: string }): string {
  return fn.async === true ? `Promise<${fn.returnType}>` : fn.returnType;
}

function functionBodyAssignsName(statements: string[], name: string): boolean {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (?:\\+=|-=|\\*=|/=|=) `);
  const destructuringPattern = new RegExp(`^\\[[^\\]]*\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^\\]]*\\] = `);
  return statements.some((statement) => {
    const trimmed = statement.trim();
    return pattern.test(trimmed) || destructuringPattern.test(trimmed);
  });
}
