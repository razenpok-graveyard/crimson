import {
  matchingCloseParen,
  splitTopLevelComma,
} from '../common.js';

export function rewriteStructPositionalConstructors(
  statement: string,
  structConstructorFields: ReadonlyMap<string, string[]>,
  structMapConstructorFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): string {
  if (structConstructorFields.size === 0) {
    return statement;
  }

  let output = '';
  let index = 0;
  const constructorPattern = /new ([A-Za-z_$][A-Za-z0-9_$]*)\(/g;
  while (index < statement.length) {
    constructorPattern.lastIndex = index;
    const match = constructorPattern.exec(statement);
    if (match === null) {
      output += statement.slice(index);
      break;
    }

    const fields = structConstructorFields.get(match[1]);
    const argsStart = constructorPattern.lastIndex;
    const closeIndex = matchingCloseParen(statement, argsStart - 1);
    if (fields === undefined || closeIndex === null) {
      output += statement.slice(index, constructorPattern.lastIndex);
      index = constructorPattern.lastIndex;
      continue;
    }

    const argsText = statement.slice(argsStart, closeIndex);
    const args = splitTopLevelComma(argsText);
    if (argsText.trim() === '') {
      output += statement.slice(index, closeIndex + 1);
      index = closeIndex + 1;
      continue;
    }
    if (args.length === 1 && args[0]?.trim().startsWith('{') === true) {
      const rewrittenMapConstructor = rewriteObjectConstructorMapFields(match[1], args[0], structMapConstructorFields.get(match[1]));
      if (rewrittenMapConstructor !== null) {
        output += statement.slice(index, match.index);
        output += rewrittenMapConstructor;
        index = closeIndex + 1;
        continue;
      }
      const rewrittenObjectConstructor = rewriteObjectConstructorWithExtraFields(match[1], args[0], fields);
      if (rewrittenObjectConstructor !== null) {
        output += statement.slice(index, match.index);
        output += rewrittenObjectConstructor;
        index = closeIndex + 1;
        continue;
      }
    }
    if (args.length > fields.length || args[0]?.trim().startsWith('{') === true) {
      output += statement.slice(index, closeIndex + 1);
      index = closeIndex + 1;
      continue;
    }

    const lastArg = args.at(-1)?.trim() ?? '';
    const keywordObject = /^\{ (.+) \}$/.exec(lastArg);
    const positionalArgs = keywordObject === null ? args : args.slice(0, -1);
    if (positionalArgs.length > fields.length) {
      output += statement.slice(index, closeIndex + 1);
      index = closeIndex + 1;
      continue;
    }

    const fieldAssignments = fields
      .slice(0, positionalArgs.length)
      .map((field, argIndex) => `${field}: ${positionalArgs[argIndex]}`);
    if (keywordObject !== null) {
      fieldAssignments.push(keywordObject[1]);
    }

    output += statement.slice(index, match.index);
    output += `new ${match[1]}({ ${fieldAssignments.join(', ')} })`;
    index = closeIndex + 1;
  }
  return output;
}

function rewriteObjectConstructorMapFields(
  className: string,
  objectArg: string,
  mapFields: ReadonlySet<string> | undefined,
): string | null {
  if (mapFields === undefined || mapFields.size === 0) {
    return null;
  }
  const objectLiteral = /^\{ (.*) \}$/.exec(objectArg.trim());
  if (objectLiteral === null) {
    return null;
  }
  const properties = splitTopLevelComma(objectLiteral[1])
    .map((part) => parseObjectConstructorProperty(part.trim()));
  if (properties.some((property) => property === null)) {
    return null;
  }
  let changed = false;
  const propertyText = properties
    .filter((property): property is { name: string; value: string } => property !== null)
    .map((property) => {
      const value = mapFields.has(property.name)
        ? mapFromObjectFromEntriesExpression(property.value) ?? property.value
        : property.value;
      if (value !== property.value) {
        changed = true;
      }
      return property.name === value ? property.name : `${property.name}: ${value}`;
    });
  return changed ? `new ${className}({ ${propertyText.join(', ')} })` : null;
}

function mapFromObjectFromEntriesExpression(value: string): string | null {
  const prefix = 'Object.fromEntries(';
  return value.startsWith(prefix) && value.endsWith(')')
    ? `new Map(${value.slice(prefix.length, -1)})`
    : null;
}

function rewriteObjectConstructorWithExtraFields(
  className: string,
  objectArg: string,
  constructorFields: string[],
): string | null {
  const objectLiteral = /^\{ (.*) \}$/.exec(objectArg.trim());
  if (objectLiteral === null) {
    return null;
  }
  const properties = splitTopLevelComma(objectLiteral[1])
    .map((part) => parseObjectConstructorProperty(part.trim()));
  if (properties.some((property) => property === null)) {
    return null;
  }
  const parsedProperties = properties.filter((property): property is { name: string; value: string } => property !== null);
  const constructorFieldSet = new Set(constructorFields);
  const constructorProperties = parsedProperties.filter((property) => constructorFieldSet.has(property.name));
  const extraProperties = parsedProperties.filter((property) => !constructorFieldSet.has(property.name));
  if (
    extraProperties.length === 0
    || constructorProperties.length !== constructorFields.length
  ) {
    return null;
  }
  const constructorText = constructorProperties
    .map((property) => `${property.name}: ${property.value}`)
    .join(', ');
  const assignments = extraProperties
    .map((property) => `value.${property.name} = ${property.value};`)
    .join(' ');
  return `(() => { const value = new ${className}({ ${constructorText} }); ${assignments} return value; })()`;
}

function parseObjectConstructorProperty(part: string): { name: string; value: string } | null {
  const explicit = /^([A-Za-z_$][A-Za-z0-9_$]*): (.+)$/.exec(part);
  if (explicit !== null) {
    return { name: explicit[1], value: explicit[2] };
  }
  const shorthand = /^([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(part);
  if (shorthand !== null) {
    return { name: shorthand[1], value: shorthand[1] };
  }
  return null;
}
