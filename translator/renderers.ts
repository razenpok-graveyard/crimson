import type {
  ConstantsModule,
  FunctionDefinition,
  GuardedAttributeModule,
  InitReexports,
  LazyWrapperModule,
  NamespaceReexport,
  ProtocolDefinition,
  SimpleExportModule,
  StraightLineModule,
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
    lines.push(`  ${method.name}(opts${method.optsOptional ? '?' : ''}: { ${optsType} }): ${method.returnType};`);
  }
  lines.push('}');
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

export function renderStraightLineModule(relativePath: string, module: StraightLineModule): string {
  const lines = [`// Port of ${relativePath}`, ''];
  for (const importDefinition of module.imports) {
    lines.push(
      `import ${importDefinition.typeOnly ? 'type ' : ''}{ ${importDefinition.names.join(', ')} } from '${importDefinition.modulePath}';`,
    );
  }
  lines.push('');

  for (const fn of module.functions) {
    const params = fn.parameters.map((param) => `${param.name}: ${param.typeExpression}`).join(', ');
    lines.push(`function ${fn.name}(${params}): ${fn.returnType} {`);
    for (const statement of fn.statements) {
      lines.push(`  ${statement}`);
    }
    lines.push('}');
    lines.push('');
  }

  for (const assignment of module.assignments) {
    if (assignment.valueLines.length === 1) {
      lines.push(`export const ${assignment.name} = ${assignment.valueLines[0]};`);
      continue;
    }

    lines.push(`export const ${assignment.name} = ${assignment.valueLines[0]}`);
    for (const valueLine of assignment.valueLines.slice(1, -1)) {
      lines.push(valueLine);
    }
    lines.push(`${assignment.valueLines.at(-1)};`);
  }
  lines.push('');
  return lines.join('\n');
}

export function renderPackageVersionModule(relativePath: string, version: string): string {
  return `// Port of ${relativePath}\n\nexport const VERSION = '${version}';\n`;
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
