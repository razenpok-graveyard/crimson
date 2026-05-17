import type { StructModule } from '../../model.js';
import {
  functionBodyAssignsName,
} from '../functions.js';

export function keywordMethodOverload(
  method: StructModule['classes'][number]['methods'][number],
  generator: boolean,
  returnType: string,
): string[] | null {
  if (
    method.static === true
    || generator
    || method.optsParams.length > 0
    || method.parameters.length === 0
    || method.name.includes(' ')
    || method.typeParams !== undefined && method.typeParams.length > 0
  ) {
    return null;
  }
  const firstParam = method.parameters[0];
  if (/^(?:Record|Map|ReadonlyMap|Set|ReadonlySet|Array|ReadonlyArray|[A-Z][A-Za-z0-9_$]*)[<\[]?/.test(firstParam.typeExpression.trim())) {
    return null;
  }
  const prefix = `${method.async === true ? 'async ' : ''}${method.name}`;
  const optsType = inlineMethodKeywordOptsType(method.parameters);
  const positionalParams = method.parameters.map(renderOverloadParameter).join(', ');
  const firstImplName = `${firstParam.name}OrOpts`;
  const firstDefault = firstParam.defaultValue === undefined || firstParam.defaultValue === null ? '' : ` = ${firstParam.defaultValue}`;
  const implementationParams = [
    `${firstImplName}: ${firstParam.typeExpression} | ${optsType}${firstDefault}`,
    ...method.parameters.slice(1).map((param) => `${param.name}Arg: ${param.typeExpression} | undefined = undefined`),
  ];
  const optsCondition = `typeof ${firstImplName} === 'object' && ${firstImplName} !== null && '${methodKeywordOptionName(firstParam.name)}' in ${firstImplName}`;
  const lines = [
    `  ${prefix}(opts: ${optsType})${returnType};`,
    `  ${prefix}(${positionalParams})${returnType};`,
    `  ${prefix}(${implementationParams.join(', ')})${returnType} {`,
  ];
  for (let index = 0; index < method.parameters.length; index += 1) {
    const param = method.parameters[index];
    const declaration = functionBodyAssignsName(method.statements, param.name) ? 'let' : 'const';
    const optionName = methodKeywordOptionName(param.name);
    const positionalExpression = index === 0 ? firstImplName : `${param.name}Arg`;
    const optionExpression = `${firstImplName}.${optionName}`;
    const valueExpression = param.defaultValue === undefined || param.defaultValue === null
      ? `${optsCondition} ? ${optionExpression} : ${positionalExpression} as ${param.typeExpression}`
      : `${optsCondition} ? ${optionExpression} ?? ${param.defaultValue} : ${positionalExpression} ?? ${param.defaultValue}`;
    lines.push(`    ${declaration} ${param.name}: ${param.typeExpression} = ${valueExpression};`);
  }
  return lines;
}

function renderOverloadParameter(param: StructModule['classes'][number]['methods'][number]['parameters'][number]): string {
  return `${param.name}${param.defaultValue === undefined || param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`;
}

function inlineMethodKeywordOptsType(parameters: StructModule['classes'][number]['methods'][number]['parameters']): string {
  return `{ ${parameters.map((param) => `${methodKeywordOptionName(param.name)}${param.defaultValue === undefined || param.defaultValue === null ? '' : '?'}: ${param.typeExpression}`).join('; ')} }`;
}

function methodKeywordOptionName(parameterName: string): string {
  return parameterName.startsWith('_') ? parameterName.slice(1) : parameterName;
}
