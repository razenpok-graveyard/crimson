import type {
  FunctionParameter,
  SimpleModuleFunction,
  StructModule,
} from '../model.js';
import {
  arrayRemoveHelperStatements,
  mapGetOrInitHelperStatements,
  pythonEqualsHelperStatements,
  pythonRoundHelperStatements,
  tupleKeyHelperStatements,
} from '../patterns/runtime-helpers.js';
import { isCallableProtocol, renderProtocolDefinition } from './protocols.js';

export { renderPlainClasses } from './plain-classes.js';

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
  for (const namespaceImport of module.namespaceImports) {
    lines.push(`import * as ${namespaceImport.alias} from '${namespaceImport.modulePath}';`);
  }
  for (const reexport of module.reexports) {
    lines.push(`export { ${reexport.names.join(', ')} } from '${reexport.modulePath}';`);
  }
  if (module.imports.length + module.namespaceImports.length + module.reexports.length > 0) {
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

  const helperStatements = structModuleHelperStatements(module);
  if (helperStatements.length > 0) {
    lines.push(...helperStatements);
    if (module.functions.length + module.classes.length + interfaceProtocols.length > 0) {
      lines.push('');
    }
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

function structModuleHelperStatements(module: StructModule): string[] {
  const moduleText = JSON.stringify({
    functions: module.functions,
    classes: module.classes,
  });
  const helpers: string[] = [];
  const pushHelper = (statements: string[]): void => {
    if (helpers.length > 0) {
      helpers.push('');
    }
    helpers.push(...statements);
  };
  if (moduleText.includes('tupleKey(')) {
    pushHelper(tupleKeyHelperStatements());
  }
  if (moduleText.includes('mapGetOrInit(')) {
    pushHelper(mapGetOrInitHelperStatements());
  }
  if (moduleText.includes('arrayRemove(')) {
    pushHelper(arrayRemoveHelperStatements());
  }
  if (moduleText.includes('pythonEquals(')) {
    pushHelper(pythonEqualsHelperStatements());
  }
  if (moduleText.includes('pyRound(')) {
    pushHelper(pythonRoundHelperStatements());
  }
  return helpers;
}

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
      lines.push(`  readonly tag = '${structClass.tagValue ?? structClass.name}';`);
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
      if (structClass.fields.length > 0) {
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
      lines.push('  }');
    }
    for (const method of structClass.methods) {
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

function renderFunctionReturnType(fn: { async?: boolean; returnType: string }): string {
  return fn.async === true ? `Promise<${fn.returnType}>` : fn.returnType;
}

function defaultedOptionExpression(optionExpression: string, typeExpression: string, defaultValue: string): string {
  if (typeExpression.startsWith('readonly ') && typeExpression.endsWith('[]')) {
    return `Array.from(${optionExpression} ?? ${defaultValue})`;
  }
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
    const generator = fn.statements.some((statement) => /^\s*yield\*? /.test(statement));
    const params = fn.parameters.map(renderParameter);
    if (fn.optsParams.length > 0) {
      const optsType = fn.optsParams
        .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
        .join('; ');
      const allOptsHaveDefaults = fn.optsParams.every((param) => param.defaultValue !== null);
      params.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
    }
    lines.push(`${fn.exported ? 'export ' : ''}${fn.async === true ? 'async ' : ''}function${generator ? '*' : ''} ${fn.name}${renderTypeParameters(fn)}(${params.join(', ')}): ${renderFunctionReturnType(fn)} {`);
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

function renderTypeParameters(fn: SimpleModuleFunction): string {
  return fn.typeParams === undefined || fn.typeParams.length === 0 ? '' : `<${fn.typeParams.join(', ')}>`;
}

function functionBodyAssignsName(statements: string[], name: string): boolean {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (?:\\+=|-=|\\*=|/=|=) `);
  const destructuringPattern = new RegExp(`^\\[[^\\]]*\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^\\]]*\\] = `);
  return statements.some((statement) => {
    const trimmed = statement.trim();
    return pattern.test(trimmed) || destructuringPattern.test(trimmed);
  });
}
