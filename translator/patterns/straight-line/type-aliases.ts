import type { TypeAlias } from '../../model.js';
import {
  tsExportNameForPythonName,
  tsTypeExpression,
} from '../../naming.js';
import { parseTypeAliasValidation } from '../basic.js';
import { isBareTypeAliasExpression } from '../common.js';

export function parseTypeAliasStatement(
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

  const parenthesizedAlias = /^([A-Za-z_][A-Za-z0-9_]*): TypeAlias = \($/.exec(lines[index]?.trim() ?? '');
  if (parenthesizedAlias !== null) {
    const parts: string[] = [];
    let nextIndex = index + 1;
    while (nextIndex < lines.length) {
      const trimmed = lines[nextIndex].trim();
      if (trimmed === ')') {
        const expression = parts.join(' ');
        if (!isBareTypeAliasExpression(expression)) {
          return null;
        }
        return {
          alias: { name: tsExportNameForPythonName(parenthesizedAlias[1]), typeExpression: tsTypeExpression(expression) },
          nextIndex: nextIndex + 1,
        };
      }
      if (trimmed === '' || !lines[nextIndex].startsWith('    ')) {
        return null;
      }
      parts.push(trimmed);
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
