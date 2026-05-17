export function splitInlineComment(line: string): { code: string; comment: string | null } {
  const trimmedStart = line.trimStart();
  if (trimmedStart.startsWith('#')) {
    return {
      code: '',
      comment: trimmedStart.slice(1).trim(),
    };
  }
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === quote && line[index - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && /\s/.test(line[index - 1] ?? '')) {
      return {
        code: line.slice(0, index).trimEnd(),
        comment: line.slice(index + 1).trim(),
      };
    }
  }
  return { code: line, comment: null };
}
