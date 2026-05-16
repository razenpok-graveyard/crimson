import type { FunctionParameter, ProtocolDefinition } from '../model.js';

function renderParameter(param: FunctionParameter): string {
  const defaultValue = param.defaultValue === undefined || param.defaultValue === null ? '' : ` = ${param.defaultValue}`;
  return `${param.name}: ${param.typeExpression}${defaultValue}`;
}

export function renderProtocolModule(relativePath: string, protocol: ProtocolDefinition): string {
  const lines = [`// Port of ${relativePath}`, ''];
  renderProtocolDefinition(lines, protocol);
  lines.push('');
  return lines.join('\n');
}
export function renderProtocolDefinition(lines: string[], protocol: ProtocolDefinition): void {
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

  const extendsText = protocol.extendsNames === undefined || protocol.extendsNames.length === 0
    ? ''
    : ` extends ${protocol.extendsNames.join(', ')}`;
  lines.push(`export interface ${protocol.name}${extendsText} {`);
  for (const method of protocol.methods) {
    if (method.property === true) {
      const readonlyPrefix = method.readonly === false ? '' : 'readonly ';
      lines.push(`  ${readonlyPrefix}${method.name}: ${method.returnType};`);
      continue;
    }
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

export function isCallableProtocol(protocol: ProtocolDefinition): boolean {
  return (protocol.extendsNames === undefined || protocol.extendsNames.length === 0)
    && protocol.methods.length === 1
    && protocol.methods[0].name === '__call__';
}

function renderProtocolOptsParam(param: { name: string; typeExpression: string; defaultValue?: string | null }, optional = false): string {
  const hasDefault = 'defaultValue' in param && param.defaultValue !== null;
  return `${param.name}${optional || hasDefault ? '?' : ''}: ${param.typeExpression}`;
}
