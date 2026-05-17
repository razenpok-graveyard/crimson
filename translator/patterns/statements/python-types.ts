import { splitTopLevelComma } from '../common.js';

export function pythonListTypeIsNumeric(pythonType: string): boolean {
  return /^list\[(?:int|float)\]$/.test(pythonType.trim());
}

function pythonMapTypeArgs(pythonType: string): string[] | null {
  const mapType = /^(?:dict|OrderedDict|defaultdict)\[(.+)\]$/.exec(pythonType.trim());
  if (mapType !== null) {
    return splitTopLevelComma(mapType[1]);
  }
  const counterType = /^Counter\[(.+)\]$/.exec(pythonType.trim());
  return counterType === null ? null : [counterType[1], 'int'];
}

export function pythonMapTypeHasTupleKey(pythonType: string): boolean {
  return pythonMapTypeArgs(pythonType)?.[0]?.trim().startsWith('tuple[') === true;
}

export function pythonMapValueIsList(pythonType: string): boolean {
  const valueType = pythonMapTypeArgs(pythonType)?.[1]?.trim();
  return valueType?.startsWith('list[') === true || valueType?.startsWith('tuple[') === true;
}

export function pythonMapValueIsMap(pythonType: string): boolean {
  return pythonMapTypeArgs(pythonType)?.[1]?.trim().startsWith('dict[') === true;
}
