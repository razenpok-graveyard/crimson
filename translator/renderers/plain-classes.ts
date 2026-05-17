import type {
  FunctionParameter,
  StraightLineModule,
} from '../model.js';
import { tsExportNameForPythonName } from '../naming.js';

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
    const classIsAbstract = plainClass.methods.some((method) => method.abstract === true);
    const abstractPrefix = classIsAbstract ? 'abstract ' : '';
    lines.push(`export ${abstractPrefix}class ${plainClass.name}${plainClass.extendsName === undefined ? '' : ` extends ${plainClass.extendsName}`} {`);
    for (const field of plainClass.fields) {
      const assignmentAssertion = field.defaultValueLines === undefined && field.definiteAssignment === true ? '!' : '';
      const prefix = `  ${field.private ? 'protected ' : ''}${field.readonly ? 'readonly ' : ''}${field.name}${assignmentAssertion}: ${field.typeExpression}`;
      if (field.defaultValueLines === undefined) {
        lines.push(`${prefix};`);
      } else if (field.defaultValueLines.length === 1) {
        lines.push(`${prefix} = ${field.defaultValueLines[0]};`);
      } else {
        lines.push(`${prefix} = ${field.defaultValueLines[0]}`);
        for (const valueLine of field.defaultValueLines.slice(1, -1)) {
          lines.push(`  ${valueLine}`);
        }
        lines.push(`  ${field.defaultValueLines.at(-1)};`);
      }
    }
    const methodNames = new Set(plainClass.methods.map((method) => method.name));
    const accessorFields = plainClass.fields
      .filter((field) => field.private)
      .map((field) => ({
        field,
        accessorName: publicAccessorNameForPrivateField(field.name),
      }))
      .filter((entry) => (
        entry.accessorName !== null
        && !plainClass.fields.some((field) => field.name === entry.accessorName)
        && !methodNames.has(entry.accessorName)
        && !methodNames.has(`get ${entry.accessorName}`)
        && !methodNames.has(`set ${entry.accessorName}`)
      ));
    if (accessorFields.length > 0) {
      lines.push('');
      for (const { field, accessorName } of accessorFields) {
        lines.push(`  get ${accessorName}(): ${field.typeExpression} {`);
        lines.push(`    return this.${field.name};`);
        lines.push('  }');
      }
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
    let optsType: string | null = null;
    if (plainClass.constructorDefinition.optsParams.length > 0) {
      optsType = plainClass.constructorDefinition.optsParams
        .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
        .join('; ');
      const allOptsHaveDefaults = plainClass.constructorDefinition.optsParams.every((param) => param.defaultValue !== null);
      constructorParams.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
    }
    if (shouldRenderConstructor) {
      const gameplayContextParam = plainClass.extendsName === 'BaseGameplayMode'
        && plainClass.constructorDefinition.parameters.length === 1
        && plainClass.constructorDefinition.parameters[0].typeExpression === 'ViewContext'
        && optsType !== null
        ? plainClass.constructorDefinition.parameters[0]
        : null;
      if (gameplayContextParam === null) {
        lines.push(`  constructor(${constructorParams.join(', ')}) {`);
      } else {
        const optsObjectType = `{ ${optsType} }`;
        const legacyOptsType = `${optsObjectType} & { assetsUrl?: string; baseDir?: string; preserveBugs?: boolean }`;
        const implementationParam = `${gameplayContextParam.name}OrOpts`;
        lines.push(`  constructor(${renderParameter(gameplayContextParam)}, opts: ${optsObjectType});`);
        lines.push(`  constructor(opts: ${legacyOptsType});`);
        lines.push(`  constructor(${implementationParam}: ${gameplayContextParam.typeExpression} | ${legacyOptsType}, maybeOpts?: ${optsObjectType}) {`);
        lines.push(`    const ${gameplayContextParam.name} = maybeOpts === undefined ? { assetsDir: (${implementationParam} as { assetsUrl?: string }).assetsUrl ?? '', preserveBugs: (${implementationParam} as { preserveBugs?: boolean }).preserveBugs ?? false } as ${gameplayContextParam.typeExpression} : ${implementationParam} as ${gameplayContextParam.typeExpression};`);
        lines.push(`    const opts = maybeOpts ?? (${implementationParam} as ${legacyOptsType});`);
      }
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
      for (const comment of method.leadingComments ?? []) {
        lines.push(comment === '' ? '  //' : `  // ${comment}`);
      }
      const params = method.parameters.map(renderParameter);
      if (method.optsParams.length > 0) {
        const optsType = method.optsParams
          .map((param) => `${param.name}${param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`)
          .join('; ');
        const allOptsHaveDefaults = method.optsParams.every((param) => param.defaultValue !== null);
        params.push(`opts: { ${optsType} }${allOptsHaveDefaults ? ' = {}' : ''}`);
      }
      const returnType = method.name.startsWith('set ') ? '' : `: ${renderFunctionReturnType(method)}`;
      const accessModifier = method.name.startsWith('_') && plainClass.name !== 'MenuView' ? 'protected ' : '';
      if (method.abstract === true) {
        lines.push(`  ${accessModifier}abstract ${method.name}(${params.join(', ')})${returnType};`);
        continue;
      }
      lines.push(`  ${accessModifier}${method.static === true ? 'static ' : ''}${method.async === true ? 'async ' : ''}${method.name}(${params.join(', ')})${returnType} {`);
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

function publicAccessorNameForPrivateField(fieldName: string): string | null {
  if (!fieldName.startsWith('_') || /^__.*__$/.test(fieldName)) {
    return null;
  }
  const stripped = fieldName.replace(/^_+/, '');
  return stripped === '' ? null : tsExportNameForPythonName(stripped);
}

function functionBodyAssignsName(statements: string[], name: string): boolean {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (?:\\+=|-=|\\*=|/=|=) `);
  const destructuringPattern = new RegExp(`^\\[[^\\]]*\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^\\]]*\\] = `);
  return statements.some((statement) => {
    const trimmed = statement.trim();
    return pattern.test(trimmed) || destructuringPattern.test(trimmed);
  });
}
