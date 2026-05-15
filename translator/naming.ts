export function tsExportNameForPythonName(pythonName: string): string {
  if (!pythonName.includes('_') || /^[A-Z0-9_]+$/.test(pythonName)) {
    return pythonName;
  }

  return pythonName.replaceAll(/_([a-zA-Z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

export function tsTypeExpression(pythonType: string): string {
  const trimmed = pythonType.trim();
  if (trimmed === 'None') {
    return 'void';
  }
  if (trimmed === 'float' || trimmed === 'int') {
    return 'number';
  }
  if (trimmed === 'str') {
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
      .split(', ')
      .map((arg, index) => `arg${index}: ${tsTypeExpression(arg)}`)
      .join(', ');
  return `(${params}) => ${tsTypeExpression(returnText)}`;
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
