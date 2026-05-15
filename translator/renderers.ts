import type {
  ConstantsModule,
  EnumDefinition,
  FunctionParameter,
  FunctionDefinition,
  GuardedAttributeModule,
  InitReexports,
  LazyWrapperModule,
  NamespaceReexport,
  PlatformDirsModule,
  ProtocolDefinition,
  SimpleExportModule,
  SimpleModuleFunction,
  StraightLineModule,
  StructModule,
  TyperCliModule,
  TypeAlias,
} from './model.js';

function renderParameter(param: FunctionParameter): string {
  const defaultValue = param.defaultValue === undefined || param.defaultValue === null ? '' : ` = ${param.defaultValue}`;
  return `${param.name}: ${param.typeExpression}${defaultValue}`;
}

export function renderEmptyModule(relativePath: string): string {
  return `// Port of ${relativePath}\n`;
}

export function renderModuleDocOnly(relativePath: string, docstring: string): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const line of docstring.split(/\r?\n/)) {
    lines.push(line === '' ? '//' : `// ${line}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderNamespaceReexports(relativePath: string, reexports: NamespaceReexport[]): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const reexport of reexports) {
    lines.push(`export * as ${reexport.alias} from '${reexport.modulePath}';`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderLazyWrapperModule(relativePath: string, module: LazyWrapperModule): string {
  const runtimeAlias = `${module.runtimeFunctionName}Runtime`;
  const lines = [
    `// Port of ${relativePath}`,
    '',
    `import { ${module.typeName} } from '${module.typeModulePath}';`,
    '',
    `export { ${module.typeName} };`,
    '',
    `export function ${module.functionName}(${module.parameter.name}: ${module.parameter.typeExpression}): void {`,
  ];

  for (const comment of module.comments) {
    lines.push(`  // ${comment}`);
  }
  lines.push(`  void import('${module.runtimeModulePath}').then(({ ${module.runtimeFunctionName}: ${runtimeAlias} }) => {`);
  lines.push(`    ${runtimeAlias}(${module.parameter.name});`);
  lines.push('  });');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

export function renderProtocolModule(relativePath: string, protocol: ProtocolDefinition): string {
  const lines = [`// Port of ${relativePath}`, ''];
  renderProtocolDefinition(lines, protocol);
  lines.push('');
  return lines.join('\n');
}

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

function renderEnumDefinition(lines: string[], enumDefinition: EnumDefinition): void {
  if (enumDefinition.docstring !== null) {
    for (const line of enumDefinition.docstring.split(/\r?\n/)) {
      lines.push(line === '' ? '//' : `// ${line}`);
    }
  }

  lines.push(`export enum ${enumDefinition.name} {`);
  for (const member of enumDefinition.members) {
    lines.push(`  ${member.name} = ${member.value},`);
  }
  lines.push('}');
}

export function renderTypeAliases(relativePath: string, aliases: TypeAlias[]): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const alias of aliases) {
    lines.push(`${alias.exported === false ? '' : 'export '}type ${alias.name} = ${alias.typeExpression};`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderConstantsModule(relativePath: string, constantsModule: ConstantsModule): string {
  const lines = [`// Port of ${relativePath}`, ''];
  if (constantsModule.docstring !== null) {
    for (const line of constantsModule.docstring.split(/\r?\n/)) {
      lines.push(line === '' ? '//' : `// ${line}`);
    }
    lines.push('');
  }

  for (const constant of constantsModule.constants) {
    lines.push(`export const ${constant.name} = ${constant.value};`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderFunctionsModule(relativePath: string, functions: FunctionDefinition[]): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const fn of functions) {
    const optsType = fn.optsParams.map((param) => `${param.name}: ${param.typeExpression}`).join('; ');
    lines.push(`export function ${fn.name}(`);
    lines.push(`  opts: { ${optsType} },`);
    lines.push(`): ${fn.returnType} {`);
    if (fn.ignoredParam !== null) {
      lines.push(`  const _ = opts.${fn.ignoredParam};`);
    }
    lines.push(`  return ${fn.returnExpression};`);
    lines.push('}');
  }
  lines.push('');
  return lines.join('\n');
}

export function renderGuardedAttributeModule(relativePath: string, module: GuardedAttributeModule): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const importDefinition of module.imports) {
    lines.push(`import type { ${importDefinition.names.join(', ')} } from '${importDefinition.modulePath}';`);
  }
  lines.push('');

  const fn = module.functionDefinition;
  lines.push(`export function ${fn.name}(${fn.parameter.name}: ${fn.parameter.typeExpression}): ${fn.returnType} {`);
  lines.push(`  if (${fn.parameter.name}.${fn.attributeName} === null) {`);
  lines.push(`    throw new Error('${fn.errorMessage}');`);
  lines.push('  }');
  lines.push(`  return ${fn.parameter.name}.${fn.attributeName};`);
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

export function renderSimpleExportModule(relativePath: string, module: SimpleExportModule): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const importDefinition of module.imports) {
    lines.push(`import type { ${importDefinition.names.join(', ')} } from '${importDefinition.modulePath}';`);
  }
  if (module.imports.length > 0) {
    lines.push('');
  }

  for (const constant of module.constants) {
    lines.push(`${constant.exported ? 'export ' : ''}const ${constant.name} = ${constant.value};`);
  }
  if (module.constants.length > 0 && module.functions.length > 0) {
    lines.push('');
  }

  for (const fn of module.functions) {
    for (const comment of fn.comments) {
      lines.push(`// ${comment}`);
    }
    const params = fn.parameters
      .map((param) => `${param.ignored ? '_' : ''}${param.name}: ${param.typeExpression}`)
      .join(', ');
    lines.push(`${fn.exported ? 'export ' : ''}function ${fn.name}(${params}): ${fn.returnType} {`);
    for (const param of fn.parameters) {
      if (param.ignored) {
        lines.push(`  void _${param.name};`);
      }
    }
    lines.push(`  return ${fn.returnExpression};`);
    lines.push('}');
  }
  lines.push('');
  return lines.join('\n');
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

function renderProtocolDefinition(lines: string[], protocol: ProtocolDefinition): void {
  if (isCallableProtocol(protocol)) {
    const method = protocol.methods[0];
    const params = method.parameters.map(renderParameter);
    if (method.optsParams.length > 0) {
      if (method.parameters.length === 0 && method.optsParams.length > 2) {
        lines.push(`export type ${protocol.name} = (opts: {`);
        for (const param of method.optsParams) {
          lines.push(`  ${renderProtocolOptsParam(param)};`);
        }
        lines.push(`}) => ${method.returnType};`);
        return;
      }
      const optsType = method.optsParams
        .map((param) => renderProtocolOptsParam(param))
        .join('; ');
      params.push(`opts: { ${optsType} }`);
    }
    lines.push(`export type ${protocol.name} = (${params.join(', ')}) => ${method.returnType};`);
    return;
  }

  lines.push(`export interface ${protocol.name} {`);
  for (const method of protocol.methods) {
    const params = method.parameters.map(renderParameter);
    if (method.optsParams.length > 0) {
      const optsType = method.optsParams
        .map((param) => renderProtocolOptsParam(param, method.optsOptional))
        .join('; ');
      params.push(`opts${method.optsOptional ? '?' : ''}: { ${optsType} }`);
    }
    lines.push(`  ${method.name}(${params.join(', ')}): ${method.returnType};`);
  }
  lines.push('}');
}

function isCallableProtocol(protocol: ProtocolDefinition): boolean {
  return protocol.methods.length === 1 && protocol.methods[0].name === '__call__';
}

function renderProtocolOptsParam(param: { name: string; typeExpression: string; defaultValue?: string | null }, optional = false): string {
  const hasDefault = 'defaultValue' in param && param.defaultValue !== null;
  return `${param.name}${optional || hasDefault ? '?' : ''}: ${param.typeExpression}`;
}

function renderStructClasses(lines: string[], classes: StructModule['classes']): void {
  for (let index = 0; index < classes.length; index += 1) {
    const structClass = classes[index];
    if (structClass.docstring !== null) {
      for (const line of structClass.docstring.split(/\r?\n/)) {
        lines.push(line === '' ? '//' : `// ${line}`);
      }
    }
    lines.push(`export class ${structClass.name} {`);
    for (const field of structClass.fields) {
      lines.push(`  ${structClass.readonlyFields ? 'readonly ' : ''}${field.name}: ${field.typeExpression};`);
    }
    lines.push('');
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
        lines.push(`    this.${field.name} = opts.${field.name} ?? ${field.defaultValue};`);
      }
    }
    for (const statement of structClass.postInitStatements) {
      lines.push(statement === '' ? '' : `    ${statement}`);
    }
    lines.push('  }');
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

function renderPlainClasses(lines: string[], classes: StraightLineModule['plainClasses']): void {
  for (let index = 0; index < classes.length; index += 1) {
    const plainClass = classes[index];
    lines.push(`export class ${plainClass.name} {`);
    for (const field of plainClass.fields) {
      lines.push(`  ${field.private ? 'private ' : ''}${field.readonly ? 'readonly ' : ''}${field.name}: ${field.typeExpression};`);
    }
    lines.push('');
    const constructorParams = plainClass.constructorDefinition.parameters.map(renderParameter);
    if (plainClass.constructorDefinition.optsParams.length > 0) {
      const optsType = plainClass.constructorDefinition.optsParams
        .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
        .join('; ');
      const allOptsHaveDefaults = plainClass.constructorDefinition.optsParams.every((param) => param.defaultValue !== null);
      constructorParams.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
    }
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

function renderSimpleModuleFunctions(
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
      if (param.defaultValue === null) {
        lines.push(`  const ${param.name} = opts.${param.name};`);
      } else {
        lines.push(`  const ${param.name} = opts.${param.name} ?? ${param.defaultValue};`);
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

  for (const alias of module.typeAliases) {
    lines.push(`${alias.exported === false ? '' : 'export '}type ${alias.name} = ${alias.typeExpression};`);
  }
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
  if (module.typeAliases.length > 0 && module.enums.length + module.leadingAssignments.length + module.leadingStatements.length + module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  renderStraightLineAssignments(lines, module.leadingAssignments);
  if (module.leadingAssignments.length > 0 && module.leadingStatements.length + module.enums.length + module.classes.length + module.plainClasses.length + module.functions.length + module.assignments.length > 0) {
    lines.push('');
  }

  for (const statement of module.leadingStatements) {
    lines.push(statement);
  }
  if (module.leadingStatements.length > 0 && module.enums.length + module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  for (let index = 0; index < module.enums.length; index += 1) {
    renderEnumDefinition(lines, module.enums[index]);
    if (index < module.enums.length - 1) {
      lines.push('');
    }
  }
  if (module.enums.length > 0 && module.classes.length + module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  renderStructClasses(lines, module.classes);
  if (module.classes.length > 0 && module.plainClasses.length + module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
    lines.push('');
  }

  renderPlainClasses(lines, module.plainClasses);
  if (module.plainClasses.length > 0 && module.functions.length + module.trailingStatements.length + module.assignments.length > 0) {
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

export function renderTyperCliModule(relativePath: string, module: TyperCliModule): string {
  const lines = [
    `// Port of ${relativePath}`,
    '',
    "import { DesktopCliUnavailableError } from './root.ts';",
    '',
    `export const ${module.appName} = {`,
    "  command(_name: string): (_fn: (...args: never[]) => void) => void {",
    '    return (_fn) => {',
    '      void _fn;',
    '    };',
    '  },',
    '};',
  ];

  for (const command of module.commands) {
    lines.push('');
    const optsType = command.optsParams.length === 0
      ? 'object'
      : `{ ${command.optsParams.map((param) => `${param.name}${param.optional ? '?' : ''}: ${param.typeExpression}`).join('; ')} }`;
    const allOptional = command.optsParams.every((param) => param.optional);
    lines.push(`export function ${command.name}(_opts: ${optsType}${allOptional ? ' = {}' : ''}): void {`);
    lines.push('  void _opts;');
    lines.push(`  throw new DesktopCliUnavailableError('${module.appName.replace(/App$/, '')} ${command.commandName}');`);
    lines.push('}');
  }
  lines.push('');
  return lines.join('\n');
}

function renderTypeAliasValidator(lines: string[], alias: TypeAlias): void {
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

function renderStraightLineAssignments(lines: string[], assignments: StraightLineModule['assignments']): void {
  for (const assignment of assignments) {
    for (const comment of assignment.comments ?? []) {
      lines.push(`// ${comment}`);
    }
    const exportPrefix = assignment.exported ? 'export ' : '';
    const typeSuffix = assignment.typeExpression === undefined ? '' : `: ${assignment.typeExpression}`;
    if (assignment.valueLines.length === 1) {
      lines.push(`${exportPrefix}${assignment.declaration} ${assignment.name}${typeSuffix} = ${assignment.valueLines[0]};`);
      continue;
    }

    lines.push(`${exportPrefix}${assignment.declaration} ${assignment.name}${typeSuffix} = ${assignment.valueLines[0]}`);
    for (const valueLine of assignment.valueLines.slice(1, -1)) {
      lines.push(valueLine);
    }
    lines.push(`${assignment.valueLines.at(-1)};`);
  }
}

export function renderPackageVersionModule(relativePath: string, version: string): string {
  return `// Port of ${relativePath}\n\nexport const VERSION = '${version}';\n`;
}

export function renderPlatformDirsModule(relativePath: string, module: PlatformDirsModule): string {
  const lines = [
    `// Port of ${relativePath}`,
    '',
    `export const APP_NAME = '${module.appName}';`,
    '',
    'function _expandUser(path: string, env: Record<string, string | undefined> | undefined): string {',
    '  const home = env?.HOME ?? env?.USERPROFILE;',
    "  if (path === '~') {",
    '    return home ?? path;',
    '  }',
    "  if (path.startsWith('~/')) {",
    '    if (home !== undefined) {',
    '      return `${home}${path.slice(1)}`;',
    '    }',
    '  }',
    '  return path;',
    '}',
    '',
    'function _platformDirsUserDataPath(appname: string, env: Record<string, string | undefined> | undefined): string {',
    "  const platform = globalThis.process?.platform ?? '';",
    "  if (platform === 'win32') {",
    '    const base = env?.LOCALAPPDATA ?? env?.APPDATA ?? env?.USERPROFILE;',
    '    if (base !== undefined) {',
    "      return `${base.replace(/[\\\\/]+$/g, '')}\\\\${appname.replace(/\\//g, '\\\\')}`;",
    '    }',
    '  }',
    "  if (platform === 'darwin') {",
    '    const home = env?.HOME;',
    '    if (home !== undefined) {',
    "      return `${home.replace(/\\/+$/g, '')}/Library/Application Support/${appname}`;",
    '    }',
    '  }',
    '  const xdgDataHome = env?.XDG_DATA_HOME;',
    '  if (xdgDataHome !== undefined) {',
    "    return `${xdgDataHome.replace(/\\/+$/g, '')}/${appname}`;",
    '  }',
    '  const home = env?.HOME;',
    '  if (home !== undefined) {',
    "    return `${home.replace(/\\/+$/g, '')}/.local/share/${appname}`;",
    '  }',
    '  // PlatformDirs is not available in the WebGL runtime.',
    '  return appname;',
    '}',
    '',
    `export function ${module.functionName}(): string {`,
  ];
  for (const line of module.docstring.split(/\r?\n/)) {
    lines.push(line === '' ? '  //' : `  // ${line}`);
  }
  lines.push('');
  lines.push("  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;");
  lines.push(`  const override = env?.${module.primaryEnvName} || env?.${module.fallbackEnvName};`);
  lines.push('  if (override) {');
  lines.push('    return _expandUser(override, env);');
  lines.push('  }');
  lines.push('');
  lines.push('  return _platformDirsUserDataPath(APP_NAME, env);');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

export function renderInitReexports(relativePath: string, initReexports: InitReexports): string {
  const lines = [`// Port of ${relativePath}`, ''];
  if (initReexports.docstring !== null) {
    for (const line of initReexports.docstring.split(/\r?\n/)) {
      lines.push(line === '' ? '//' : `// ${line}`);
    }
    lines.push('');
  }

  for (const reexport of initReexports.namespaceReexports) {
    lines.push(`export * as ${reexport.alias} from '${reexport.modulePath}';`);
  }
  if (initReexports.namespaceReexports.length > 0 && initReexports.reexports.length > 0) {
    lines.push('');
  }

  for (const reexport of initReexports.reexports) {
    lines.push(`export { ${reexport.names.join(', ')} } from '${reexport.modulePath}';`);
  }
  lines.push('');
  return lines.join('\n');
}
