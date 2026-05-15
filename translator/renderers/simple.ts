import type {
  ConstantsModule,
  FunctionDefinition,
  GuardedAttributeModule,
  SimpleExportModule,
  TypeAlias,
} from '../model.js';

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
