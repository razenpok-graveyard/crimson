import type {
  FunctionParameter,
  SimpleModuleFunction,
  StraightLineModule,
  StructModule,
} from '../model.js';
import { isCallableProtocol, renderProtocolDefinition } from './protocols.js';

function renderParameter(param: FunctionParameter): string {
  const defaultValue = param.defaultValue === undefined || param.defaultValue === null ? '' : ` = ${param.defaultValue}`;
  return `${param.name}: ${param.typeExpression}${defaultValue}`;
}
export function renderMsgspecStructModule(relativePath: string, module: StructModule): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const importDefinition of module.imports) {
    lines.push(
      `import ${importDefinition.typeOnly ? 'type ' : ''}{ ${importDefinition.names.join(', ')} } from '${importDefinition.modulePath}';`,
    );
  }
  if (module.imports.length > 0) {
    lines.push('');
  }

  const callableProtocols = module.protocols.filter(isCallableProtocol);
  const interfaceProtocols = module.protocols.filter((protocol) => !isCallableProtocol(protocol));

  for (let index = 0; index < callableProtocols.length; index += 1) {
    const protocol = callableProtocols[index];
    renderProtocolDefinition(lines, protocol);
    if (index < callableProtocols.length - 1) {
      lines.push('');
    }
  }
  if (callableProtocols.length > 0 && module.typeAliases.length + module.functions.length + module.classes.length + interfaceProtocols.length > 0) {
    lines.push('');
  }

  for (const alias of module.typeAliases) {
    lines.push(`${alias.exported === false ? '' : 'export '}type ${alias.name} = ${alias.typeExpression};`);
  }
  if (module.typeAliases.length > 0 && module.functions.length + module.classes.length + interfaceProtocols.length > 0) {
    lines.push('');
  }

  renderSimpleModuleFunctions(lines, module.functions, module.classes.length + interfaceProtocols.length > 0);

  renderStructClasses(lines, module.classes);
  if (module.classes.length > 0 && interfaceProtocols.length > 0) {
    lines.push('');
  }
  for (let index = 0; index < interfaceProtocols.length; index += 1) {
    const protocol = interfaceProtocols[index];
    renderProtocolDefinition(lines, protocol);
    if (index < interfaceProtocols.length - 1) {
      lines.push('');
    }
  }
  lines.push('');
  return lines.join('\n');
}
export function renderStructClasses(lines: string[], classes: StructModule['classes']): void {
  for (let index = 0; index < classes.length; index += 1) {
    const structClass = classes[index];
    if (structClass.docstring !== null) {
      for (const line of structClass.docstring.split(/\r?\n/)) {
        lines.push(line === '' ? '//' : `// ${line}`);
      }
    }
    lines.push(`export class ${structClass.name} {`);
    if (structClass.tagged) {
      lines.push(`  readonly tag = '${structClass.name}';`);
    }
    for (const field of structClass.fields) {
      lines.push(`  ${structClass.readonlyFields ? 'readonly ' : ''}${field.name}: ${field.typeExpression};`);
    }
    const shouldRenderConstructor = structClass.fields.length > 0 || structClass.postInitStatements.length > 0;
    if (shouldRenderConstructor) {
      if (structClass.tagged || structClass.fields.length > 0) {
        lines.push('');
      }
      if (structClass.fields.length > 0) {
        lines.push('  constructor(opts: {');
        for (const field of structClass.fields) {
          lines.push(`    ${field.name}${field.defaultValue === null ? '' : '?'}: ${field.typeExpression};`);
        }
        const allFieldsHaveDefaults = structClass.fields.every((field) => field.defaultValue !== null);
        lines.push(`  }${allFieldsHaveDefaults ? ' = {}' : ''}) {`);
        for (const field of structClass.fields) {
          if (field.defaultValue === null) {
            lines.push(`    this.${field.name} = opts.${field.name};`);
          } else {
            lines.push(`    this.${field.name} = ${defaultedOptionExpression(`opts.${field.name}`, field.typeExpression, field.defaultValue)};`);
          }
        }
      } else {
        lines.push('  constructor() {');
      }
      for (const statement of structClass.postInitStatements) {
        lines.push(statement === '' ? '' : `    ${statement}`);
      }
      lines.push('  }');
    }
    for (const method of structClass.methods) {
      lines.push('');
      const params = method.parameters.map(renderParameter);
      if (method.optsParams.length > 0) {
        const optsType = method.optsParams
          .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
          .join('; ');
        const allOptsHaveDefaults = method.optsParams.every((param) => param.defaultValue !== null);
        params.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
      }
      lines.push(`  ${method.async === true ? 'async ' : ''}${method.name}(${params.join(', ')}): ${renderFunctionReturnType(method)} {`);
      for (const param of method.optsParams) {
        if (param.defaultValue === null) {
          lines.push(`    const ${param.name} = opts.${param.name};`);
        } else {
          lines.push(`    const ${param.name} = opts.${param.name} ?? ${param.defaultValue};`);
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

export function renderPlainClasses(lines: string[], classes: StraightLineModule['plainClasses']): void {
  for (let index = 0; index < classes.length; index += 1) {
    const plainClass = classes[index];
    if (plainClass.docstring !== null) {
      for (const line of plainClass.docstring.split(/\r?\n/)) {
        lines.push(line === '' ? '//' : `// ${line}`);
      }
    }
    lines.push(`export class ${plainClass.name} {`);
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
        if (param.defaultValue === null) {
          lines.push(`    const ${param.name} = opts.${param.name};`);
        } else {
          lines.push(`    const ${param.name} = opts.${param.name} ?? ${param.defaultValue};`);
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
      lines.push(`  ${method.async === true ? 'async ' : ''}${method.name}(${params.join(', ')}): ${renderFunctionReturnType(method)} {`);
      for (const param of method.optsParams) {
        if (param.defaultValue === null) {
          lines.push(`    const ${param.name} = opts.${param.name};`);
        } else {
          lines.push(`    const ${param.name} = opts.${param.name} ?? ${param.defaultValue};`);
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

function defaultedOptionExpression(optionExpression: string, typeExpression: string, defaultValue: string): string {
  return typeExpression.includes('null') && defaultValue !== 'null'
    ? `${optionExpression} !== undefined ? ${optionExpression} : ${defaultValue}`
    : `${optionExpression} ?? ${defaultValue}`;
}

export function renderSimpleModuleFunctions(
  lines: string[],
  functions: SimpleModuleFunction[],
  hasFollowingContent: boolean,
): void {
  for (let index = 0; index < functions.length; index += 1) {
    const fn = functions[index];
    const params = fn.parameters.map(renderParameter);
    if (fn.optsParams.length > 0) {
      const optsType = fn.optsParams
        .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
        .join('; ');
      const allOptsHaveDefaults = fn.optsParams.every((param) => param.defaultValue !== null);
      params.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
    }
    lines.push(`${fn.exported ? 'export ' : ''}${fn.async === true ? 'async ' : ''}function ${fn.name}(${params.join(', ')}): ${renderFunctionReturnType(fn)} {`);
    let statementIndex = 0;
    while (
      statementIndex < fn.statements.length
      && (fn.statements[statementIndex] === '' || fn.statements[statementIndex].startsWith('//'))
    ) {
      const statement = fn.statements[statementIndex];
      lines.push(statement === '' ? '' : `  ${statement}`);
      statementIndex += 1;
    }
    for (const param of fn.optsParams) {
      const declaration = functionBodyAssignsName(fn.statements, param.name) ? 'let' : 'const';
      if (param.defaultValue === null) {
        lines.push(`  ${declaration} ${param.name} = opts.${param.name};`);
      } else {
        lines.push(`  ${declaration} ${param.name} = opts.${param.name} ?? ${param.defaultValue};`);
      }
    }
    for (const statement of fn.statements.slice(statementIndex)) {
      lines.push(statement === '' ? '' : `  ${statement}`);
    }
    lines.push('}');
    if (index < functions.length - 1 || hasFollowingContent) {
      lines.push('');
    }
  }
}

function functionBodyAssignsName(statements: string[], name: string): boolean {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (?:\\+=|-=|\\*=|/=|=) `);
  return statements.some((statement) => pattern.test(statement.trim()));
}
