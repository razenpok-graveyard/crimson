import type {
  StructModule,
  TypeAlias,
} from '../model.js';
import {
  arrayRemoveHelperStatements,
  mapGetOrInitHelperStatements,
  mapGetOrThrowHelperStatements,
  pythonEqualsHelperStatements,
  pythonCompareKeysHelperStatements,
  pythonRoundHelperStatements,
  tupleKeyHelperStatements,
} from '../patterns/runtime-helpers.js';
import { renderSimpleModuleFunctions } from './functions.js';
import { isCallableProtocol, renderProtocolDefinition } from './protocols.js';
import { renderStructClasses } from './struct-classes.js';

export { renderPlainClasses } from './plain-classes.js';
export { renderSimpleModuleFunctions } from './functions.js';
export { renderStructClasses } from './struct-classes.js';

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

  renderStructTypeAliases(lines, module.typeAliases, module.classes);
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

export function renderStructTypeAliases(
  lines: string[],
  typeAliases: readonly TypeAlias[],
  classes: readonly StructModule['classes'][number][] = [],
  valueText = '',
): void {
  for (const alias of typeAliases) {
    lines.push(`${alias.exported === false ? '' : 'export '}type ${alias.name} = ${alias.typeExpression};`);
  }
  const taggedUnionConstructors = taggedUnionTypeAliasConstructors(typeAliases, classes, valueText);
  if (taggedUnionConstructors.length > 0) {
    if (typeAliases.length > 0) {
      lines.push('');
    }
    lines.push(...taggedUnionConstructors);
  }
}

function taggedUnionTypeAliasConstructors(
  typeAliases: readonly TypeAlias[],
  classes: readonly StructModule['classes'][number][],
  valueText: string,
): string[] {
  const classByName = new Map(classes.map((structClass) => [structClass.name, structClass]));
  const statements: string[] = [];
  for (const alias of typeAliases) {
    if (!typeAliasHasValueUsage(alias.name, valueText)) {
      continue;
    }
    const members = alias.typeExpression.split('|').map((part) => part.trim());
    if (members.length < 2) {
      continue;
    }
    const memberClasses = members.map((member) => classByName.get(member));
    if (memberClasses.some((structClass) => structClass === undefined || !structClass.tagged)) {
      continue;
    }
    statements.push(`const ${alias.name} = function ${alias.name}TaggedUnion(opts: Record<string, unknown>) {`);
    statements.push(`  const tag = String(${tagLookupExpression(memberClasses)});`);
    statements.push('  switch (tag) {');
    for (const structClass of memberClasses) {
      if (structClass === undefined) {
        continue;
      }
      statements.push(`    case ${JSON.stringify(structClass.tagValue ?? structClass.name)}:`);
      statements.push(`      return new ${structClass.name}(opts as ConstructorParameters<typeof ${structClass.name}>[0]);`);
    }
    statements.push('    default:');
    statements.push(`      throw new Error(\`unsupported ${alias.name} tag: \${tag}\`);`);
    statements.push('  }');
    statements.push(`} as unknown as new (opts: Record<string, unknown>) => ${alias.name};`);
    statements.push('');
  }
  if (statements[statements.length - 1] === '') {
    statements.pop();
  }
  return statements;
}

function typeAliasHasValueUsage(aliasName: string, valueText: string): boolean {
  const escaped = aliasName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`\\btype\\s*:\\s*${escaped}\\b`),
    new RegExp(`\\bnew\\s+${escaped}\\s*\\(`),
    new RegExp(`(^|[^A-Za-z0-9_.$])${escaped}\\s*\\(`),
    new RegExp(`=\\s*${escaped}\\b`),
    new RegExp(`\\breturn\\s+${escaped}\\b`),
  ].some((pattern) => pattern.test(valueText));
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
  if (moduleText.includes('mapGetOrThrow(')) {
    pushHelper(mapGetOrThrowHelperStatements());
  }
  if (moduleText.includes('arrayRemove(')) {
    pushHelper(arrayRemoveHelperStatements());
  }
  if (moduleText.includes('pythonEquals(')) {
    pushHelper(pythonEqualsHelperStatements());
  }
  if (moduleText.includes('pythonCompareKeys(')) {
    pushHelper(pythonCompareKeysHelperStatements());
  }
  if (moduleText.includes('pyRound(')) {
    pushHelper(pythonRoundHelperStatements());
  }
  return helpers;
}

function tagLookupExpression(memberClasses: readonly (StructModule['classes'][number] | undefined)[]): string {
  const tagFields = new Set(memberClasses.map((structClass) => structClass?.tagField ?? 'tag'));
  const lookups = Array.from(tagFields)
    .sort((left, right) => left === 'tag' ? 1 : right === 'tag' ? -1 : left.localeCompare(right))
    .map((field) => `opts[${JSON.stringify(field)}]`);
  if (!tagFields.has('tag')) {
    lookups.push(`opts['tag']`);
  }
  lookups.push(`''`);
  return lookups.join(' ?? ');
}
