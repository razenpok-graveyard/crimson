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
  const forwardReference = /^(["'])(.+)\1$/.exec(trimmed);
  if (forwardReference !== null) {
    return tsTypeExpression(forwardReference[2]);
  }
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
  const unionParts = splitTopLevelUnion(trimmed);
  if (unionParts.length > 1) {
    const parts = unionParts
      .map((part) => {
        const typeExpression = part === 'None' ? 'null' : tsTypeExpression(part);
        return typeExpression.includes('=>') ? `(${typeExpression})` : typeExpression;
      });
    return [...new Set(parts)].join(' | ');
  }
  const dictType = /^dict\[([^,\]]+), (.+)\]$/.exec(trimmed);
  if (dictType !== null) {
    if (dictType[1].trim() === 'str' && dictType[2].trim() === 'object') {
      return 'Record<string, unknown>';
    }
    if (dictType[1].trim() === 'str' && dictType[2].trim() === 'BuiltinValue') {
      return '{ [key: string]: BuiltinValue }';
    }
    return `Map<${tsTypeExpression(dictType[1])}, ${tsTypeExpression(dictType[2])}>`;
  }
  const orderedDictType = /^OrderedDict\[([^,\]]+), (.+)\]$/.exec(trimmed);
  if (orderedDictType !== null) {
    return `Map<${tsTypeExpression(orderedDictType[1])}, ${tsTypeExpression(orderedDictType[2])}>`;
  }
  const runtimeType = /^type\[(.+)\]$/.exec(trimmed);
  if (runtimeType !== null) {
    return `new (...args: any[]) => ${tsTypeExpression(runtimeType[1])}`;
  }
  const setType = /^set\[(.+)\]$/.exec(trimmed);
  if (setType !== null) {
    return `Set<${tsTypeExpression(setType[1])}>`;
  }
  const frozenSetType = /^frozenset\[(.+)\]$/.exec(trimmed);
  if (frozenSetType !== null) {
    return `ReadonlySet<${tsTypeExpression(frozenSetType[1])}>`;
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
  const iterableType = /^Iterable\[(.+)\]$/.exec(trimmed);
  if (iterableType !== null) {
    return `Iterable<${tsTypeExpression(iterableType[1])}>`;
  }
  const iteratorType = /^Iterator\[(.+)\]$/.exec(trimmed);
  if (iteratorType !== null) {
    return `IterableIterator<${tsTypeExpression(iteratorType[1])}>`;
  }
  const genericType = /^([A-Z][A-Za-z0-9_]*)\[(.+)\]$/.exec(trimmed);
  if (genericType !== null) {
    return `${tsExportNameForPythonName(genericType[1])}<${genericType[2].split(topLevelCommaPattern()).map(tsTypeExpression).join(', ')}>`;
  }
  if (trimmed === 'None') {
    return 'void';
  }
  if (trimmed === 'bytes') {
    return 'Uint8Array';
  }
  if (trimmed === 'memoryview') {
    return 'ArrayBufferView';
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
  if (trimmed === 'dt.date' || trimmed === 'datetime.date') {
    return 'Date';
  }
  if (trimmed === 'bool') {
    return 'boolean';
  }
  if (trimmed === 'Any') {
    return 'unknown';
  }
  if (trimmed === 'object') {
    return 'unknown';
  }
  if (trimmed === 'msgspec.msgpack.Encoder') {
    return 'MsgpackEncoder';
  }
  if (trimmed === 'msgspec.msgpack.Decoder') {
    return 'MsgpackDecoder<any>';
  }
  if (/^_+[A-Z][A-Z0-9_]*$/.test(trimmed)) {
    return tsPublicNameForPythonName(trimmed);
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

function splitTopLevelUnion(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '[' || char === '(' || char === '{') {
      depth += 1;
      continue;
    }
    if (char === ']' || char === ')' || char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && text.slice(index, index + 3) === ' | ') {
      parts.push(text.slice(start, index));
      start = index + 3;
      index += 2;
    }
  }
  if (parts.length === 0) {
    return [text];
  }
  parts.push(text.slice(start));
  return parts;
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
