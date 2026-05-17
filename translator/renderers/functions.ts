import type {
  FunctionParameter,
  SimpleModuleFunction,
} from '../model.js';

export function renderParameter(param: FunctionParameter): string {
  const defaultValue = param.defaultValue === undefined || param.defaultValue === null ? '' : ` = ${param.defaultValue}`;
  return `${param.name}: ${param.typeExpression}${defaultValue}`;
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
    const decorators = fn.decorators ?? [];
    const decoratorPrefix = decorators.length === 0
      ? ''
      : `const ${fn.name} = ${decorators.map((decorator) => `${decorator}(`).join('')}`;
    lines.push(`${fn.exported ? 'export ' : ''}${decoratorPrefix}${fn.async === true ? 'async ' : ''}function${generator ? '*' : ''} ${fn.name}${renderTypeParameters(fn)}(${params.join(', ')}): ${renderFunctionReturnType(fn)} {`);
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
    lines.push(`}${decorators.length === 0 ? '' : `${')'.repeat(decorators.length)};`}`);
    if (index < functions.length - 1 || hasFollowingContent) {
      lines.push('');
    }
  }
}

export function renderFunctionReturnType(fn: { async?: boolean; returnType: string }): string {
  return fn.async === true ? `Promise<${fn.returnType}>` : fn.returnType;
}

export function renderTypeParameters(fn: SimpleModuleFunction): string {
  return fn.typeParams === undefined || fn.typeParams.length === 0 ? '' : `<${fn.typeParams.join(', ')}>`;
}

export function functionBodyAssignsName(statements: string[], name: string): boolean {
  const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (?:\\+=|-=|\\*=|/=|=) `);
  const destructuringPattern = new RegExp(`^\\[[^\\]]*\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^\\]]*\\] = `);
  return statements.some((statement) => {
    const trimmed = statement.trim();
    return pattern.test(trimmed) || destructuringPattern.test(trimmed);
  });
}
