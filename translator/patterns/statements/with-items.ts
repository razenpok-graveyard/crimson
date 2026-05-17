import { tsExportNameForPythonName } from '../../naming.js';
import { splitTopLevelComma } from '../common.js';
import {
  functionReturnTypeMarker,
  translateExpression,
} from '../expression.js';

export type WithItem = {
  pythonName: string;
  name: string;
  expression: string;
  close: true;
  iterator?: boolean;
} | {
  expression: string;
  close: false;
};

export function parseWithItems(
  itemsText: string,
  nameMap: Map<string, string>,
  arrayNames: Set<string>,
  validatedTypeAliases: ReadonlySet<string>,
  mapNames: ReadonlySet<string>,
): WithItem[] | null {
  const items: WithItem[] = [];
  for (const itemText of splitTopLevelComma(itemsText)) {
    const item = /^(.+) as ([A-Za-z_][A-Za-z0-9_]*)$/.exec(itemText);
    if (item !== null) {
      const expression = translateExpression(item[1], nameMap, arrayNames, validatedTypeAliases, mapNames);
      items.push({
        pythonName: item[2],
        name: tsExportNameForPythonName(item[2]),
        expression,
        close: true,
        iterator: withItemExpressionIsIterator(expression, nameMap),
      });
      continue;
    }
    items.push({
      expression: translateExpression(itemText, nameMap, arrayNames, validatedTypeAliases, mapNames),
      close: false,
    });
  }
  return items.length === 0 ? null : items;
}

export function withItemExpressionIsIterator(expression: string, nameMap: ReadonlyMap<string, string>): boolean {
  const call = /^([A-Za-z_$][A-Za-z0-9_.$]*)\(/.exec(expression.trim());
  if (call === null) {
    return false;
  }
  const returnType = nameMap.get(functionReturnTypeMarker(call[1]));
  return returnType?.startsWith('IterableIterator<') === true || returnType?.startsWith('Generator<') === true;
}
