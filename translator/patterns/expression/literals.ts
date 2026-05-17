export function parseBytesLiteral(value: string): number[] | null {
  const literal = /^b(["'])([\s\S]*)\1$/.exec(value);
  if (literal === null) {
    return null;
  }
  const bytes: number[] = [];
  const content = literal[2];
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char !== '\\') {
      bytes.push(content.charCodeAt(index));
      continue;
    }
    const next = content[index + 1];
    if (next === 'x') {
      const hex = content.slice(index + 2, index + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        return null;
      }
      bytes.push(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    if (next === '0') {
      bytes.push(0);
      index += 1;
      continue;
    }
    if (next === 'n') {
      bytes.push(10);
      index += 1;
      continue;
    }
    if (next === 'r') {
      bytes.push(13);
      index += 1;
      continue;
    }
    if (next === 't') {
      bytes.push(9);
      index += 1;
      continue;
    }
    if (next === '\\' || next === '"' || next === "'") {
      bytes.push(next.charCodeAt(0));
      index += 1;
      continue;
    }
    return null;
  }
  return bytes;
}
