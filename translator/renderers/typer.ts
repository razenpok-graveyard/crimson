import type { TyperCliModule } from '../model.js';

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
