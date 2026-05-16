import { translateExpression } from '../expression.js';

export function parseExceptClause(statement: string): { name: string | null; types: string[] } | null {
  const typeNamePattern = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*';
  const identifierNamePattern = '[A-Za-z_][A-Za-z0-9_]*';
  const clause = new RegExp(`^except (?:(` + typeNamePattern + `)|\\((${typeNamePattern}(?:, ${typeNamePattern})+),?\\))(?: as (${identifierNamePattern}))?:$`).exec(statement);
  if (clause === null) {
    return null;
  }
  return {
    name: clause[3] ?? null,
    types: (clause[1] ?? clause[2]).split(',').map((typeName) => typeName.trim()),
  };
}

export function tsExceptGuardExpression(
  pythonTypes: string[],
  catchName: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): string | null {
  const guards: string[] = [];
  for (const pythonType of pythonTypes) {
    const translatedType = translateExpression(pythonType, nameMap, arrayNames, validatedTypeAliases, mapNames);
    if (!tsExceptionTypeIsGuardable(translatedType)) {
      return null;
    }
    guards.push(`${catchName} instanceof ${translatedType}`);
  }
  return guards.length === 0 ? null : guards.join(' || ');
}

function tsExceptionTypeIsGuardable(tsType: string): boolean {
  if (!/^[A-Z][A-Za-z0-9_$]*$/.test(tsType)) {
    return false;
  }
  return !new Set(['Exception', 'RuntimeError', 'ValueError', 'KeyError', 'OSError', 'FileNotFoundError']).has(tsType);
}
