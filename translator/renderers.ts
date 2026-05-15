import type {
  ConstantsModule,
  EnumDefinition,
  FunctionDefinition,
  GuardedAttributeModule,
  InitReexports,
  LazyWrapperModule,
  NamespaceReexport,
  PlatformDirsModule,
  ProtocolDefinition,
  SimpleExportModule,
  StraightLineModule,
  StructModule,
  TypeAlias,
} from './model.js';

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
    `import type { ${module.typeName} } from '${module.typeModulePath}';`,
    '',
    `export type { ${module.typeName} };`,
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
  const lines = [`// Port of ${relativePath}`, '', `export interface ${protocol.name} {`];
  for (const method of protocol.methods) {
    const optsType = method.optsParams
      .map((param) => `${param.name}${method.optsOptional ? '?' : ''}: ${param.typeExpression}`)
      .join('; ');
    const params = method.parameters.map((param) => `${param.name}: ${param.typeExpression}`);
    if (method.optsParams.length > 0) {
      params.push(`opts${method.optsOptional ? '?' : ''}: { ${optsType} }`);
    }
    lines.push(`  ${method.name}(${params.join(', ')}): ${method.returnType};`);
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

export function renderIntEnumModule(relativePath: string, enumDefinition: EnumDefinition): string {
  const lines = [`// Port of ${relativePath}`, ''];
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

export function renderTypeAliases(relativePath: string, aliases: TypeAlias[]): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const alias of aliases) {
    lines.push(`export type ${alias.name} = ${alias.typeExpression};`);
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

  for (const alias of module.typeAliases) {
    lines.push(`export type ${alias.name} = ${alias.typeExpression};`);
  }
  if (module.typeAliases.length > 0 && module.classes.length + module.protocols.length > 0) {
    lines.push('');
  }

  for (let index = 0; index < module.classes.length; index += 1) {
    const structClass = module.classes[index];
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
    lines.push('  }');
    lines.push('}');
    if (index < module.classes.length - 1) {
      lines.push('');
    }
  }
  if (module.classes.length > 0 && module.protocols.length > 0) {
    lines.push('');
  }
  for (let index = 0; index < module.protocols.length; index += 1) {
    const protocol = module.protocols[index];
    lines.push(`export interface ${protocol.name} {`);
    for (const method of protocol.methods) {
      const params = method.parameters.map((param) => `${param.name}: ${param.typeExpression}`);
      lines.push(`  ${method.name}(${params.join(', ')}): ${method.returnType};`);
    }
    lines.push('}');
    if (index < module.protocols.length - 1) {
      lines.push('');
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function renderStraightLineModule(relativePath: string, module: StraightLineModule): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const importDefinition of module.imports) {
    lines.push(
      `import ${importDefinition.typeOnly ? 'type ' : ''}{ ${importDefinition.names.join(', ')} } from '${importDefinition.modulePath}';`,
    );
  }
  for (const reexport of module.reexports) {
    lines.push(`export { ${reexport.names.join(', ')} } from '${reexport.modulePath}';`);
  }
  if (module.imports.length + module.reexports.length > 0) {
    lines.push('');
  }

  renderStraightLineAssignments(lines, module.leadingAssignments);
  if (module.leadingAssignments.length > 0 && module.functions.length + module.assignments.length > 0) {
    lines.push('');
  }

  for (let index = 0; index < module.functions.length; index += 1) {
    const fn = module.functions[index];
    const params = fn.parameters.map((param) => `${param.name}: ${param.typeExpression}`);
    if (fn.optsParams.length > 0) {
      const optsType = fn.optsParams
        .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
        .join('; ');
      const allOptsHaveDefaults = fn.optsParams.every((param) => param.defaultValue !== null);
      params.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
    }
    lines.push(`${fn.exported ? 'export ' : ''}function ${fn.name}(${params.join(', ')}): ${fn.returnType} {`);
    for (const param of fn.optsParams) {
      if (param.defaultValue === null) {
        lines.push(`  const ${param.name} = opts.${param.name};`);
      } else {
        lines.push(`  const ${param.name} = opts.${param.name} ?? ${param.defaultValue};`);
      }
    }
    for (const statement of fn.statements) {
      lines.push(statement === '' ? '' : `  ${statement}`);
    }
    lines.push('}');
    if (index < module.functions.length - 1 || module.assignments.length > 0) {
      lines.push('');
    }
  }

  renderStraightLineAssignments(lines, module.assignments);
  if (lines.at(-1) !== '') {
    lines.push('');
  }
  return lines.join('\n');
}

function renderStraightLineAssignments(lines: string[], assignments: StraightLineModule['assignments']): void {
  for (const assignment of assignments) {
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
