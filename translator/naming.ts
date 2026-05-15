export function tsExportNameForPythonName(pythonName: string): string {
  if (!pythonName.includes('_') || /^[A-Z0-9_]+$/.test(pythonName)) {
    return pythonName;
  }

  const withoutLeadingPrivateMarker = pythonName.replace(/^_+/, '');
  return withoutLeadingPrivateMarker.replaceAll(
    /_([a-zA-Z0-9])/g,
    (_match, letter: string) => letter.toUpperCase(),
  );
}

export function tsPublicNameForPythonName(pythonName: string): string {
  return tsExportNameForPythonName(pythonName.replace(/^_+/, ''));
}

export function tsMutableNameForPythonName(pythonName: string): string {
  return tsExportNameForPythonName(pythonName.replace(/^_+/, '').toLowerCase());
}

export function tsTypeExpression(pythonType: string): string {
  const trimmed = pythonType.trim();
  const variadicCallable = /^Callable\[\.\.\., (.+)\]$/.exec(trimmed);
  if (variadicCallable !== null) {
    return `(...args: any[]) => ${tsTypeExpression(variadicCallable[1])}`;
  }
  const callable = /^Callable\[\[(.*)\], (.+)\]$/.exec(trimmed);
  if (callable !== null) {
    return tsCallableType(callable[1], callable[2]);
  }
  const literalType = /^Literal\[(.+)\]$/.exec(trimmed);
  if (literalType !== null) {
    return literalType[1]
      .split(topLevelCommaPattern())
      .map(tsLiteralExpression)
      .join(' | ');
  }
  if (trimmed.includes(' | ')) {
    return trimmed
      .split(' | ')
      .map((part) => {
        const typeExpression = part === 'None' ? 'null' : tsTypeExpression(part);
        return typeExpression.includes('=>') ? `(${typeExpression})` : typeExpression;
      })
      .join(' | ');
  }
  const dictType = /^dict\[([^,\]]+), (.+)\]$/.exec(trimmed);
  if (dictType !== null) {
    return `Map<${tsTypeExpression(dictType[1])}, ${tsTypeExpression(dictType[2])}>`;
  }
  const fixedTupleType = /^tuple\[(.+)\]$/.exec(trimmed);
  if (fixedTupleType !== null && !fixedTupleType[1].endsWith(', ...')) {
    return `[${fixedTupleType[1].split(topLevelCommaPattern()).map(tsTypeExpression).join(', ')}]`;
  }
  const variadicTupleType = /^tuple\[(.+), \.\.\.\]$/.exec(trimmed);
  if (variadicTupleType !== null) {
    return `readonly ${tsTypeExpression(variadicTupleType[1])}[]`;
  }
  const listType = /^list\[(.+)\]$/.exec(trimmed);
  if (listType !== null) {
    return `${tsTypeExpression(listType[1])}[]`;
  }
  const sequenceType = /^Sequence\[(.+)\]$/.exec(trimmed);
  if (sequenceType !== null) {
    return `readonly ${tsTypeExpression(sequenceType[1])}[]`;
  }
  if (trimmed === 'None') {
    return 'void';
  }
  if (trimmed === 'float' || trimmed === 'int') {
    return 'number';
  }
  if (trimmed === 'str') {
    return 'string';
  }
  if (trimmed === 'Path') {
    return 'string';
  }
  if (trimmed === 'bool') {
    return 'boolean';
  }
  return tsExportNameForPythonName(trimmed);
}

export function tsCallableType(argsText: string, returnText: string): string {
  const args = argsText.trim();
  const params = args === ''
    ? ''
    : args
      .split(topLevelCommaPattern())
      .map((arg, index) => `arg${index}: ${tsTypeExpression(arg)}`)
      .join(', ');
  return `(${params}) => ${tsTypeExpression(returnText)}`;
}

function topLevelCommaPattern(): RegExp {
  return /, (?![^\[]*\])/;
}

export function tsLiteralExpression(pythonValue: string): string {
  const trimmed = pythonValue.trim();
  if (trimmed === 'True') {
    return 'true';
  }
  if (trimmed === 'False') {
    return 'false';
  }
  if (trimmed === 'None') {
    return 'null';
  }
  return trimmed;
}
