import type {
  EnumDefinition,
  FunctionParameter,
  ImportDefinition,
  NamespaceImportDefinition,
  OptionalFunctionParameter,
  PlainClassDefinition,
  Reexport,
  SimpleModuleAssignment,
  SimpleModuleFunction,
  StraightLineModule,
  StructModule,
  TyperCliModule,
  TypeAlias,
} from '../model.js';
import {
  tsExportNameForPythonName,
  tsMutableNameForPythonName,
  tsPublicNameForPythonName,
  tsTypeExpression,
} from '../naming.js';
import { tsImportPathForPythonImport } from '../paths.js';
import {
  flattenFromImportBlocks,
  isOneLineAllAssignment,
  splitLeadingModuleDocstring,
} from '../python-utils.js';
import { parseProtocolClass, parseTypeAliasValidation } from './basic.js';
import {
  identifierPattern,
  isBareTypeAliasExpression,
  isCollectionsAbcTypeImport,
  isIndentedBlockLine,
  isTypingOnlyImport,
  parseIndentedDocstring,
  parseOneLineAllNames,
  parseTypeCheckingImports,
  splitTopLevelComma,
  stripTypeOnlyStatementSyntax,
} from './common.js';
import { parseStringEnumClass } from './enums.js';
import { translateExpression } from './expression.js';
import { parseFunctionParameterText, pythonParameterNames } from './parameters.js';
import {
  parseStraightLineFunctionHeader,
  parseTopLevelAssignment,
  reassignedLocalNames,
  translateStraightLineStatement,
} from './statements.js';
import { parsePlainClass, parseStructClass } from './structs.js';

export function parseStraightLineModule(trimmedPython: string, relativePath: string): StraightLineModule | null {
  const moduleDocstring = splitLeadingModuleDocstring(trimmedPython);
  const lines = flattenFromImportBlocks((moduleDocstring?.remainder.trim() ?? trimmedPython).split(/\r?\n/));
  const imports: ImportDefinition[] = [];
  const namespaceImports: NamespaceImportDefinition[] = [];
  const leadingAssignments: SimpleModuleAssignment[] = [];
  const leadingStatements: string[] = [];
  const trailingStatements: string[] = [];
  const typeAliases: TypeAlias[] = [];
  const protocols: StraightLineModule['protocols'] = [];
  const enums: EnumDefinition[] = [];
  const validatedTypeAliases = new Set<string>();
  const classes: StructModule['classes'] = [];
  const plainClasses: PlainClassDefinition[] = [];
  const functions: SimpleModuleFunction[] = [];
  const assignments: SimpleModuleAssignment[] = [];
  const allNames: string[] = [];
  const moduleNameMap = new Map<string, string>();
  const mapNames = new Set<string>();
  const pendingAssignmentComments: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    if (trimmed.startsWith('#')) {
      pendingAssignmentComments.push(trimmed.replace(/^# ?/, ''));
      index += 1;
      continue;
    }
    if (trimmed.startsWith('def ')) {
      break;
    }
    if (trimmed.startsWith('__all__ = ')) {
      const allAssignment = parseAllAssignment(lines, index);
      if (allAssignment === null) {
        return null;
      }
      allNames.push(...allAssignment.names);
      index = allAssignment.nextIndex;
      continue;
    }
    if (trimmed === 'import os') {
      index += 1;
      continue;
    }
    if (trimmed === 'import math') {
      index += 1;
      continue;
    }
    if (
      isCollectionsAbcTypeImport(trimmed)
      || isTypingOnlyImport(trimmed)
      || trimmed === 'from enum import Enum'
      || trimmed === 'from enum import IntEnum'
      || trimmed === 'from dataclasses import dataclass'
      || trimmed === 'from pathlib import Path'
      || trimmed === 'import msgspec'
      || trimmed === 'import tempfile'
      || trimmed === 'import typer'
      || trimmed === 'import warnings'
    ) {
      index += 1;
      continue;
    }
    if (trimmed === 'if TYPE_CHECKING:') {
      const typeCheckingImports = parseTypeCheckingImports(lines, index, relativePath);
      if (typeCheckingImports === null) {
        return null;
      }
      imports.push(...typeCheckingImports.imports);
      index = typeCheckingImports.nextIndex;
      continue;
    }

    const typeAlias = parseTypeAliasStatement(lines, index);
    if (typeAlias !== null) {
      typeAliases.push(typeAlias.alias);
      if (typeAlias.alias.validation !== undefined) {
        validatedTypeAliases.add(typeAlias.alias.name);
      }
      index = typeAlias.nextIndex;
      continue;
    }

    const stringEnumClass = parseStringEnumClass(lines, index);
    if (stringEnumClass !== null) {
      enums.push(stringEnumClass.enumDefinition);
      moduleNameMap.set(stringEnumClass.enumDefinition.name, stringEnumClass.enumDefinition.name);
      index = stringEnumClass.nextIndex;
      continue;
    }

    const protocolClass = parseProtocolClass(lines, index);
    if (protocolClass !== null) {
      protocols.push(protocolClass.protocol);
      index = protocolClass.nextIndex;
      continue;
    }

    const structClass = parseStructClass(lines, index);
    if (structClass !== null) {
      classes.push(structClass.structClass);
      index = structClass.nextIndex;
      continue;
    }

    const plainClass = parsePlainClass(lines, index);
    if (plainClass !== null) {
      plainClasses.push(plainClass.plainClass);
      index = plainClass.nextIndex;
      continue;
    }

    const exceptionClass = parseSimpleExceptionClass(lines, index);
    if (exceptionClass !== null) {
      leadingStatements.push(...exceptionClass.statements);
      moduleNameMap.set(exceptionClass.name, exceptionClass.name);
      index = exceptionClass.nextIndex;
      continue;
    }

    const aliasedFromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*) as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (aliasedFromImport !== null) {
      const importedName = tsExportNameForPythonName(aliasedFromImport[2]);
      const aliasName = tsExportNameForPythonName(aliasedFromImport[3]);
      imports.push({
        modulePath: tsImportPathForPythonImport(aliasedFromImport[1], relativePath),
        names: [`${importedName} as ${aliasName}`],
      });
      moduleNameMap.set(aliasedFromImport[3], aliasName);
      index += 1;
      continue;
    }

    const fromImport = /^from (\.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*) import ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)*)$/.exec(trimmed);
    if (fromImport !== null) {
      const names = fromImport[2].split(', ').map(tsExportNameForPythonName);
      imports.push({
        modulePath: tsImportPathForPythonImport(fromImport[1], relativePath),
        names,
      });
      index += 1;
      continue;
    }

    const namespaceImport = /^from (\.+) import ([A-Za-z_][A-Za-z0-9_]*) as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed);
    if (namespaceImport !== null) {
      const alias = tsExportNameForPythonName(namespaceImport[3]);
      namespaceImports.push({
        alias,
        modulePath: tsImportPathForPythonImport(`${namespaceImport[1]}${namespaceImport[2]}`, relativePath),
      });
      moduleNameMap.set(namespaceImport[3], alias);
      index += 1;
      continue;
    }

    const assignment = parseTopLevelAssignment(lines, index);
    if (assignment === null) {
      const topLevelStatement = translateStraightLineStatement(
        lines,
        index,
        '',
        moduleNameMap,
        new Set(),
        new Set(),
        new Set(),
        validatedTypeAliases,
        relativePath,
        mapNames,
      );
      if (topLevelStatement === null) {
        return null;
      }
      leadingStatements.push(...topLevelStatement.statements);
      index = topLevelStatement.nextIndex;
      continue;
    }
    attachPendingAssignmentComments(assignment.assignment, pendingAssignmentComments);
    avoidImportedPrivateNameCollision(assignment.assignment, imports);
    leadingAssignments.push(assignment.assignment);
    const namedAssignment = /^([A-Za-z_][A-Za-z0-9_]*)(?:: .+?)? = /.exec(lines[index] ?? '');
    if (namedAssignment !== null) {
      moduleNameMap.set(namedAssignment[1], assignment.assignment.name);
      if (assignment.assignment.typeExpression?.startsWith('Map<') === true) {
        mapNames.add(assignment.assignment.name);
      }
    }
    index = assignment.nextIndex;
  }

  while (index < lines.length) {
    while (index < lines.length && lines[index].trim() === '') {
      index += 1;
    }
    if ((lines[index] ?? '').trim().startsWith('__all__ = ')) {
      break;
    }

    const interleavedAssignment = parseTopLevelAssignment(lines, index);
    if (interleavedAssignment !== null) {
      attachPendingAssignmentComments(interleavedAssignment.assignment, pendingAssignmentComments);
      avoidImportedPrivateNameCollision(interleavedAssignment.assignment, imports);
      assignments.push(interleavedAssignment.assignment);
      const namedAssignment = /^([A-Za-z_][A-Za-z0-9_]*)(?:: .+?)? = /.exec(lines[index] ?? '');
      if (namedAssignment !== null) {
        moduleNameMap.set(namedAssignment[1], interleavedAssignment.assignment.name);
        if (interleavedAssignment.assignment.typeExpression?.startsWith('Map<') === true) {
          mapNames.add(interleavedAssignment.assignment.name);
        }
      }
      index = interleavedAssignment.nextIndex;
      continue;
    }

    if (!(lines[index] ?? '').startsWith('def ')) {
      const protocolClass = parseProtocolClass(lines, index);
      if (protocolClass !== null) {
        protocols.push(protocolClass.protocol);
        index = protocolClass.nextIndex;
        continue;
      }

      const structClass = parseStructClass(lines, index);
      if (structClass !== null) {
        classes.push(structClass.structClass);
        index = structClass.nextIndex;
        continue;
      }

      const plainClass = parsePlainClass(lines, index);
      if (plainClass !== null) {
        plainClasses.push(plainClass.plainClass);
        index = plainClass.nextIndex;
        continue;
      }

      const exceptionClass = parseSimpleExceptionClass(lines, index);
      if (exceptionClass !== null) {
        trailingStatements.push(...exceptionClass.statements);
        moduleNameMap.set(exceptionClass.name, exceptionClass.name);
        index = exceptionClass.nextIndex;
        continue;
      }

      break;
    }

    const header = parseStraightLineFunctionHeader(lines, index);
    if (header === null) {
      return null;
    }
    index = header.nextIndex;

    const parameters: FunctionParameter[] = [];
    const optsParams: OptionalFunctionParameter[] = [];
    const arrayNames = new Set<string>();
    let keywordOnly = false;
    if (header.parametersText !== '') {
      for (const parameterText of splitTopLevelComma(header.parametersText)) {
        if (parameterText === '*') {
          keywordOnly = true;
          continue;
        }
        const parameter = parseFunctionParameterText(parameterText, arrayNames);
        if (parameter === null) {
          return null;
        }
        if (keywordOnly) {
          optsParams.push({
            name: parameter.name,
            typeExpression: parameter.typeExpression,
            defaultValue: parameter.defaultValue === undefined ? null : parameter.defaultValue,
          });
        } else {
          parameters.push(parameter);
        }
      }
    }

    const statements: string[] = [];
    const nameMap = new Map(moduleNameMap);
    const declaredNames = new Set<string>(pythonParameterNames(header.parametersText));
    const docstring = parseIndentedDocstring(lines, index);
    if (docstring !== null) {
      for (const line of docstring.value.split('\n')) {
        statements.push(line === '' ? '//' : `// ${line}`);
      }
      index = docstring.nextIndex;
    }
    const reassignedNames = reassignedLocalNames(lines, index);
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '') {
        if ((lines[index + 1] ?? '').startsWith('    ')) {
          if (statements.length > 0 && statements.at(-1) !== '') {
            statements.push('');
          }
          index += 1;
          continue;
        }
        index += 1;
        break;
      }
      if (!isIndentedBlockLine(lines, index, '    ')) {
        break;
      }
      const statement = translateStraightLineStatement(
        lines,
        index,
        '    ',
        nameMap,
        declaredNames,
        reassignedNames,
        arrayNames,
        validatedTypeAliases,
        relativePath,
        mapNames,
        imports,
      );
      if (statement === null) {
        return null;
      }
      statements.push(...statement.statements);
      index = statement.nextIndex;
    }

    functions.push({
      name: tsExportNameForPythonName(header.name),
      exported: !header.name.startsWith('_'),
      async: statements.some((statement) => statement.includes('await ')),
      parameters,
      optsParams,
      returnType: tsTypeExpression(header.returnType),
      statements,
    });
    moduleNameMap.set(header.name, tsExportNameForPythonName(header.name));
  }

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('__all__ = ')) {
      const allAssignment = parseAllAssignment(lines, index);
      if (allAssignment === null) {
        return null;
      }
      allNames.push(...allAssignment.names);
      index = allAssignment.nextIndex;
      continue;
    }

    const assignment = parseTopLevelAssignment(lines, index);
    if (assignment === null) {
      const trailingStatement = translateStraightLineStatement(
        lines,
        index,
        '',
        moduleNameMap,
        new Set(),
        new Set(),
        new Set(),
        validatedTypeAliases,
        relativePath,
        mapNames,
      );
      if (trailingStatement === null) {
        return null;
      }
      trailingStatements.push(...trailingStatement.statements);
      index = trailingStatement.nextIndex;
      continue;
    }
    attachPendingAssignmentComments(assignment.assignment, pendingAssignmentComments);
    avoidImportedPrivateNameCollision(assignment.assignment, imports);
    assignments.push(assignment.assignment);
    if (assignment.assignment.typeExpression?.startsWith('Map<') === true) {
      mapNames.add(assignment.assignment.name);
    }
    index = assignment.nextIndex;
  }

  if (allNames.length === 0 && functions.length > 0 && functions.every((fn) => !fn.exported)) {
    for (const fn of functions) {
      fn.exported = true;
    }
  }

  const reexports = reexportsForAllNames(imports, allNames);
  markTypeOnlyImports(imports, typeAliases, protocols, classes, plainClasses, [...leadingStatements, ...trailingStatements], functions, [...leadingAssignments, ...assignments]);
  if (allNames.length > 0) {
    const exportedNames = new Set(allNames.map(tsPublicNameForPythonName));
    for (const alias of typeAliases) {
      alias.exported = exportedNames.has(alias.name);
    }
    for (const fn of functions) {
      fn.exported = exportedNames.has(fn.name);
    }
    for (const assignment of [...leadingAssignments, ...assignments]) {
      const publicName = tsPublicNameForPythonName(assignment.pythonName ?? assignment.name);
      assignment.exported = exportedNames.has(publicName);
      if (assignment.exported) {
        assignment.name = publicName;
      }
    }
  }

  return typeAliases.length + protocols.length + enums.length + leadingAssignments.length + leadingStatements.length + classes.length + plainClasses.length + functions.length + trailingStatements.length + assignments.length + reexports.length > 0
    ? { docstring: moduleDocstring?.value ?? null, imports, namespaceImports, reexports, typeAliases, protocols, enums, leadingAssignments, leadingStatements, classes, plainClasses, functions, trailingStatements, assignments }
    : null;
}

export function parseTyperCliModule(trimmedPython: string): TyperCliModule | null {
  const lines = flattenFromImportBlocks(trimmedPython.split(/\r?\n/));
  let sawTyperImport = false;
  let appName: string | null = null;
  const commands: TyperCliModule['commands'] = [];
  let index = 0;

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }
    if (trimmed === 'import typer') {
      sawTyperImport = true;
      index += 1;
      continue;
    }
    if (trimmed === 'from pathlib import Path') {
      index += 1;
      continue;
    }
    const fromImport = /^from \.*[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)* import .+$/.exec(trimmed);
    if (fromImport !== null) {
      index += 1;
      continue;
    }
    const appAssignment = /^([A-Za-z_][A-Za-z0-9_]*) = typer\.Typer\(.+\)$/.exec(trimmed);
    if (appAssignment === null) {
      return null;
    }
    appName = tsPublicNameForPythonName(appAssignment[1]);
    index += 1;
    break;
  }

  if (!sawTyperImport || appName === null) {
    return null;
  }

  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === '') {
      index += 1;
      continue;
    }

    const commandDecorator = new RegExp(`^@${appName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}\\.command\\("([^"]+)"\\)$`).exec(trimmed)
      ?? new RegExp(`^@${appName}\\.command\\("([^"]+)"\\)$`).exec(trimmed);
    if (commandDecorator === null) {
      return null;
    }

    const header = parseTyperCliFunctionHeader(lines, index + 1);
    if (header === null) {
      return null;
    }

    const optsParams = parseTyperCliParameters(header.parametersText);
    if (optsParams === null) {
      return null;
    }
    commands.push({
      name: tsExportNameForPythonName(header.name),
      commandName: commandDecorator[1],
      optsParams,
    });

    index = header.nextIndex;
    while (index < lines.length && isIndentedBlockLine(lines, index, '    ')) {
      index += 1;
    }
  }

  return commands.length > 0 ? { appName, commands } : null;
}

function parseTyperCliFunctionHeader(
  lines: string[],
  index: number,
): { name: string; parametersText: string; nextIndex: number } | null {
  const start = /^def ([A-Za-z_][A-Za-z0-9_]*)\($/.exec(lines[index] ?? '');
  if (start === null) {
    return null;
  }

  const parameterLines: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    if (/^\) -> [^:]+:$/.test(lines[nextIndex] ?? '')) {
      return {
        name: start[1],
        parametersText: parameterLines.join(' '),
        nextIndex: nextIndex + 1,
      };
    }
    const line = lines[nextIndex];
    if (line === undefined || (!line.startsWith('    ') && line.trim() !== '')) {
      return null;
    }
    if (line.trim() !== '') {
      parameterLines.push(line.trim());
    }
    nextIndex += 1;
  }
  return null;
}

function parseTyperCliParameters(parametersText: string): TyperCliModule['commands'][number]['optsParams'] | null {
  if (parametersText === '') {
    return [];
  }
  const params: TyperCliModule['commands'][number]['optsParams'] = [];
  for (const parameterText of splitTopLevelComma(parametersText)) {
    const parameter = /^([A-Za-z_][A-Za-z0-9_]*): ([^=]+?)(?: = (.+))?$/.exec(parameterText);
    if (parameter === null) {
      return null;
    }
    params.push({
      name: tsExportNameForPythonName(parameter[1]),
      typeExpression: tsTypeExpression(parameter[2]),
      optional: parameter[3] !== undefined,
    });
  }
  return params;
}

function parseAllAssignment(
  lines: string[],
  index: number,
): { names: string[]; nextIndex: number } | null {
  const trimmed = lines[index]?.trim() ?? '';
  const oneLineNames = parseOneLineAllNames(trimmed);
  if (oneLineNames !== null) {
    return { names: oneLineNames, nextIndex: index + 1 };
  }
  if (trimmed !== '__all__ = [') {
    return null;
  }

  const names: string[] = [];
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const inner = lines[nextIndex].trim();
    if (inner === ']') {
      return { names, nextIndex: nextIndex + 1 };
    }
    const name = /^"([A-Za-z_][A-Za-z0-9_]*)",?$/.exec(inner);
    if (name === null) {
      return null;
    }
    names.push(name[1]);
    nextIndex += 1;
  }

  return null;
}

function parseSimpleExceptionClass(
  lines: string[],
  index: number,
): { name: string; statements: string[]; nextIndex: number } | null {
  const header = /^class ([A-Za-z_][A-Za-z0-9_]*)\((ValueError|UserWarning|Exception|RuntimeError)\):$/.exec(lines[index] ?? '');
  if (header === null) {
    return null;
  }

  const statements: string[] = [];
  let nextIndex = index + 1;
  const docstring = parseIndentedDocstring(lines, nextIndex);
  if (docstring !== null) {
    for (const line of docstring.value.split('\n')) {
      statements.push(line === '' ? '//' : `// ${line}`);
    }
    nextIndex = docstring.nextIndex;
  }
  while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
    nextIndex += 1;
  }
  if ((lines[nextIndex] ?? '').trim() === 'pass') {
    nextIndex += 1;
  }
  if ((lines[nextIndex] ?? '').startsWith('    ')) {
    return null;
  }

  statements.push(`export class ${header[1]} extends Error {`);
  statements.push('  constructor(message?: string) {');
  statements.push('    super(message);');
  statements.push(`    this.name = '${header[1]}';`);
  statements.push('  }');
  statements.push('}');
  statements.push('');
  return { name: header[1], statements, nextIndex };
}

function parseTypeAliasStatement(
  lines: string[],
  index: number,
): { alias: TypeAlias; nextIndex: number } | null {
  const oneLineAnnotated = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = Annotated\[(.+?), msgspec\.Meta\((.+)\)\]$/.exec(lines[index]?.trim() ?? '');
  if (oneLineAnnotated !== null) {
    return {
      alias: {
        name: tsExportNameForPythonName(oneLineAnnotated[1]),
        typeExpression: tsTypeExpression(oneLineAnnotated[2]),
        validation: parseTypeAliasValidation(oneLineAnnotated[3]),
      },
      nextIndex: index + 1,
    };
  }

  const start = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = Annotated\[$/.exec(lines[index]?.trim() ?? '');
  if (start !== null) {
    const baseType = /^    (.+),$/.exec(lines[index + 1] ?? '');
    if (baseType === null) {
      return null;
    }
    let nextIndex = index + 2;
    while (nextIndex < lines.length) {
      if (lines[nextIndex].trim() === ']') {
        const metadataBlock = lines.slice(index + 2, nextIndex).join('\n').trim();
        const metadata = /^msgspec\.Meta\(([\s\S]*)\)\s*,?$/.exec(metadataBlock);
        return {
          alias: {
            name: tsExportNameForPythonName(start[1]),
            typeExpression: tsTypeExpression(baseType[1]),
            validation: metadata === null ? undefined : parseTypeAliasValidation(metadata[1]),
          },
          nextIndex: nextIndex + 1,
        };
      }
      nextIndex += 1;
    }
    return null;
  }

  const plainAlias = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = (.+)$/.exec(lines[index]?.trim() ?? '');
  if (plainAlias !== null) {
    return {
      alias: { name: tsExportNameForPythonName(plainAlias[1]), typeExpression: tsTypeExpression(plainAlias[2]) },
      nextIndex: index + 1,
    };
  }

  const typeStatement = /^type ([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(lines[index]?.trim() ?? '');
  if (typeStatement !== null) {
    return {
      alias: { name: tsExportNameForPythonName(typeStatement[1]), typeExpression: tsTypeExpression(typeStatement[2]) },
      nextIndex: index + 1,
    };
  }

  const plainTypeAlias = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(lines[index]?.trim() ?? '');
  if (plainTypeAlias !== null && isBareTypeAliasExpression(plainTypeAlias[2])) {
    return {
      alias: { name: tsExportNameForPythonName(plainTypeAlias[1]), typeExpression: tsTypeExpression(plainTypeAlias[2]) },
      nextIndex: index + 1,
    };
  }
  return null;
}

function reexportsForAllNames(imports: ImportDefinition[], allNames: string[]): Reexport[] {
  if (allNames.length === 0) {
    return [];
  }

  const exportedNames = new Set(allNames.map(tsPublicNameForPythonName));
  const byModule = new Map<string, string[]>();
  for (const importDefinition of imports) {
    const names = importDefinition.names.filter((name) => exportedNames.has(name));
    if (names.length === 0) {
      continue;
    }
    const existing = byModule.get(importDefinition.modulePath) ?? [];
    for (const name of names) {
      if (!existing.includes(name)) {
        existing.push(name);
      }
    }
    byModule.set(importDefinition.modulePath, existing);
  }

  return [...byModule.entries()].map(([modulePath, names]) => ({ modulePath, names }));
}
function attachPendingAssignmentComments(assignment: SimpleModuleAssignment, pendingComments: string[]): void {
  if (pendingComments.length === 0) {
    return;
  }
  assignment.comments = [...pendingComments];
  pendingComments.length = 0;
}

function avoidImportedPrivateNameCollision(assignment: SimpleModuleAssignment, imports: ImportDefinition[]): void {
  if (!(assignment.pythonName?.startsWith('_') ?? false)) {
    return;
  }
  const importedNames = new Set(imports.flatMap((importDefinition) => importDefinition.names.map(importedBindingName)));
  if (importedNames.has(assignment.name)) {
    assignment.name = `_${assignment.name}`;
  }
}
function markTypeOnlyImports(
  imports: ImportDefinition[],
  typeAliases: TypeAlias[],
  protocols: StraightLineModule['protocols'],
  classes: StructModule['classes'],
  plainClasses: PlainClassDefinition[],
  leadingStatements: string[],
  functions: SimpleModuleFunction[],
  assignments: SimpleModuleAssignment[],
): void {
  const valueText = stripTypeOnlyStatementSyntax([
    ...typeAliases.flatMap((alias) => [
      alias.validation?.minLength ?? '',
      alias.validation?.maxLength ?? '',
      alias.validation?.pattern ?? '',
      alias.validation?.ge ?? '',
      alias.validation?.le ?? '',
    ]),
    ...classes.flatMap((structClass) => structClass.fields.map((field) => field.defaultValue ?? '')),
    ...classes.flatMap((structClass) => structClass.methods.flatMap((method) => method.statements)),
    ...protocols.flatMap((protocol) => protocol.methods.flatMap((method) => [
      ...method.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...method.optsParams.map((parameter) => parameter.defaultValue ?? ''),
    ])),
    ...plainClasses.flatMap((plainClass) => plainClass.constructorDefinition.statements),
    ...plainClasses.flatMap((plainClass) => plainClass.methods.flatMap((method) => method.statements)),
    ...leadingStatements,
    ...functions.flatMap((fn) => fn.statements),
    ...functions.flatMap((fn) => [
      ...fn.parameters.map((parameter) => parameter.defaultValue ?? ''),
      ...fn.optsParams.map((parameter) => parameter.defaultValue ?? ''),
    ]),
    ...assignments.flatMap((assignment) => assignment.valueLines),
  ].join('\n'));
  const typeText = [
    ...typeAliases.map((alias) => alias.typeExpression),
    ...protocols.flatMap((protocol) => protocol.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
    ])),
    ...classes.flatMap((structClass) => structClass.fields.map((field) => field.typeExpression)),
    ...classes.flatMap((structClass) => structClass.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
    ])),
    ...plainClasses.flatMap((plainClass) => plainClass.fields.map((field) => field.typeExpression)),
    ...plainClasses.flatMap((plainClass) => [
      ...plainClass.constructorDefinition.parameters.map((parameter) => parameter.typeExpression),
      ...plainClass.constructorDefinition.optsParams.map((parameter) => parameter.typeExpression),
    ]),
    ...plainClasses.flatMap((plainClass) => plainClass.methods.flatMap((method) => [
      method.returnType,
      ...method.parameters.map((parameter) => parameter.typeExpression),
      ...method.optsParams.map((parameter) => parameter.typeExpression),
    ])),
    ...functions.flatMap((fn) => [
      fn.returnType,
      ...fn.parameters.map((parameter) => parameter.typeExpression),
      ...fn.optsParams.map((parameter) => parameter.typeExpression),
    ]),
    ...assignments.flatMap((assignment) => assignment.typeExpression ?? []),
  ].join('\n');

  for (let index = 0; index < imports.length; index += 1) {
    const importDefinition = imports[index];
    const valueNames = importDefinition.names.filter((name) => identifierPattern(importedBindingName(name)).test(valueText));
    const typeOnlyNames = importDefinition.names.filter((name) => (
      !identifierPattern(importedBindingName(name)).test(valueText) && identifierPattern(importedBindingName(name)).test(typeText)
    ));
    if (valueNames.length + typeOnlyNames.length === 0) {
      imports.splice(index, 1);
      index -= 1;
      continue;
    }
    if (valueNames.length === 0) {
      importDefinition.names = typeOnlyNames;
      importDefinition.typeOnly = true;
      continue;
    }
    if (typeOnlyNames.length === 0) {
      importDefinition.names = valueNames;
      importDefinition.typeOnly = false;
      continue;
    }
    imports.splice(
      index,
      1,
      { ...importDefinition, names: typeOnlyNames, typeOnly: true },
      { ...importDefinition, names: valueNames, typeOnly: false },
    );
    index += 1;
  }
}

function importedBindingName(importName: string): string {
  return /^.+ as ([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(importName)?.[1] ?? importName;
}
