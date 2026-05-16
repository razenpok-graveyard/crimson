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
  const finalType = parseGenericTypeArgs(trimmed, 'Final');
  if (finalType !== null && finalType.length === 1) {
    const innerType = finalType[0].trim();
    const dictType = parseGenericTypeArgs(innerType, 'dict');
    if (dictType !== null && dictType.length === 2) {
      return `ReadonlyMap<${tsMapKeyTypeExpression(dictType[0])}, ${tsTypeExpression(dictType[1])}>`;
    }
    const orderedDictType = parseGenericTypeArgs(innerType, 'OrderedDict');
    if (orderedDictType !== null && orderedDictType.length === 2) {
      return `ReadonlyMap<${tsMapKeyTypeExpression(orderedDictType[0])}, ${tsTypeExpression(orderedDictType[1])}>`;
    }
    return tsTypeExpression(innerType);
  }
  const dictType = parseGenericTypeArgs(trimmed, 'dict');
  if (dictType !== null && dictType.length === 2) {
    if (dictType[0].trim() === 'str' && dictType[1].trim() === 'object') {
      return 'Record<string, unknown>';
    }
    if (dictType[0].trim() === 'str' && dictType[1].trim() === 'BuiltinValue') {
      return '{ [key: string]: BuiltinValue }';
    }
    return `Map<${tsMapKeyTypeExpression(dictType[0])}, ${tsTypeExpression(dictType[1])}>`;
  }
  const defaultDictType = parseGenericTypeArgs(trimmed, 'defaultdict');
  if (defaultDictType !== null && defaultDictType.length === 2) {
    return `Map<${tsMapKeyTypeExpression(defaultDictType[0])}, ${tsTypeExpression(defaultDictType[1])}>`;
  }
  const orderedDictType = parseGenericTypeArgs(trimmed, 'OrderedDict');
  if (orderedDictType !== null && orderedDictType.length === 2) {
    return `Map<${tsMapKeyTypeExpression(orderedDictType[0])}, ${tsTypeExpression(orderedDictType[1])}>`;
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
    return `[${splitTopLevelComma(fixedTupleType[1]).map(tsTypeExpression).join(', ')}]`;
  }
  const variadicTupleType = /^tuple\[(.+), \.\.\.\]$/.exec(trimmed);
  if (variadicTupleType !== null) {
    return `readonly ${tsTypeExpression(variadicTupleType[1])}[]`;
  }
  const listType = /^list\[(.+)\]$/.exec(trimmed);
  if (listType !== null) {
    return `${tsArrayElementTypeExpression(listType[1])}[]`;
  }
  const sequenceType = /^Sequence\[(.+)\]$/.exec(trimmed);
  if (sequenceType !== null) {
    return `readonly ${tsArrayElementTypeExpression(sequenceType[1])}[]`;
  }
  const mutableSequenceType = /^MutableSequence\[(.+)\]$/.exec(trimmed);
  if (mutableSequenceType !== null) {
    return `${tsArrayElementTypeExpression(mutableSequenceType[1])}[]`;
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
    return `${tsExportNameForPythonName(genericType[1])}<${splitTopLevelComma(genericType[2]).map(tsTypeExpression).join(', ')}>`;
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
  if (/^[A-Z][A-Za-z0-9_]*Flags$/.test(trimmed)) {
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
  if (trimmed === 'Exception' || trimmed === 'BaseException') {
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

function tsMapKeyTypeExpression(pythonType: string): string {
  return pythonType.trim().startsWith('tuple[')
    ? 'string'
    : tsTypeExpression(pythonType);
}

function tsArrayElementTypeExpression(pythonType: string): string {
  const elementType = tsTypeExpression(pythonType);
  return elementType.includes(' | ') ? `(${elementType})` : elementType;
}

function parseGenericTypeArgs(typeText: string, typeName: string): string[] | null {
  const prefix = `${typeName}[`;
  if (!typeText.startsWith(prefix) || !typeText.endsWith(']')) {
    return null;
  }
  return splitTopLevelComma(typeText.slice(prefix.length, -1));
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

function splitTopLevelComma(text: string): string[] {
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
    if (depth === 0 && char === ',') {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter((part) => part !== '');
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
