import type {
  InitReexports,
  LazyWrapperModule,
  NamespaceReexport,
  PlatformDirsModule,
} from '../model.js';

export function renderEmptyModule(relativePath: string): string {
  return `// Port of ${relativePath}\n`;
}

export function renderExcludedRuntimeModule(relativePath: string, exportNames: readonly string[]): string {
  const lines = [`// Port of ${relativePath}`, ''];
  const uniqueExportNames = [...new Set(exportNames)];
  if (uniqueExportNames.length === 0) {
    lines.push('export {};');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('function unavailableRuntimeExport(name: string): any {');
  lines.push('  return function unavailableRuntimeExportTarget(): never {');
  lines.push('    throw new Error(`${name} is not available in the WebGL runtime`);');
  lines.push('  };');
  lines.push('}');
  lines.push('');
  for (const name of uniqueExportNames) {
    lines.push(`export type ${name} = any;`);
    lines.push(`export const ${name}: any = unavailableRuntimeExport('${name}');`);
    lines.push('');
  }
  return lines.join('\n');
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
