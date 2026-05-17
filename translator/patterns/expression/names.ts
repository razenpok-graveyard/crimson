import { tsExportNameForPythonName } from '../../naming.js';
import {
  classFieldTypeMarker,
  receiverTypeNameMarker,
} from './markers.js';

export function translateIdentifierName(name: string, nameMap: Map<string, string>): string {
  if (!name.includes('.')) {
    return nameMap.get(name) ?? tsExportNameForPythonName(name);
  }
  const parts = name.split('.');
  const root = nameMap.get(parts[0]) ?? tsExportNameForPythonName(parts[0]);
  let pythonReceiver = parts[0];
  let tsReceiver = root;
  const translated = [root];
  for (const part of parts.slice(1)) {
    const member = translatedMemberNameForReceiver(part, pythonReceiver, tsReceiver, nameMap);
    translated.push(member);
    pythonReceiver = `${pythonReceiver}.${part}`;
    tsReceiver = `${tsReceiver}.${member}`;
  }
  return translated.join('.');
}

export function translateIdentifierNamePreservingPrivateMembers(name: string, nameMap: Map<string, string>): string {
  if (!name.includes('.')) {
    return nameMap.get(name) ?? tsExportNameForPythonName(name);
  }
  const parts = name.split('.');
  const root = nameMap.get(parts[0]) ?? tsExportNameForPythonName(parts[0]);
  let pythonReceiver = parts[0];
  let tsReceiver = root;
  const translated = [root];
  for (const part of parts.slice(1)) {
    const member = translatedMemberNameForReceiver(part, pythonReceiver, tsReceiver, nameMap);
    translated.push(member);
    pythonReceiver = `${pythonReceiver}.${part}`;
    tsReceiver = `${tsReceiver}.${member}`;
  }
  return translated.join('.');
}

function translatedMemberNameForReceiver(
  pythonMember: string,
  pythonReceiver: string,
  tsReceiver: string,
  nameMap: Map<string, string>,
): string {
  const publicMember = pythonMember.startsWith('_')
    ? tsExportNameForPythonName(pythonMember.replace(/^_+/, ''))
    : null;
  const directMember = tsMemberNameForPythonName(pythonMember);
  const receiverType = nameMap.get(receiverTypeNameMarker(pythonReceiver)) ?? nameMap.get(receiverTypeNameMarker(tsReceiver));
  const ownReceiver = pythonReceiver === 'self' || tsReceiver === 'this';
  if (
    publicMember !== null
    && receiverType !== undefined
    && !ownReceiver
    && nameMap.has(classFieldTypeMarker(receiverType, publicMember))
  ) {
    return publicMember;
  }
  if (
    receiverType !== undefined
    && nameMap.has(classFieldTypeMarker(receiverType, directMember))
  ) {
    return directMember;
  }
  if (
    publicMember !== null
    && receiverType !== undefined
    && nameMap.has(classFieldTypeMarker(receiverType, publicMember))
  ) {
    return publicMember;
  }
  return directMember;
}

export function translatedDottedTokenMember(
  fullText: string,
  offset: number,
  name: string,
  nameMap: Map<string, string>,
): string | null {
  const beforeMember = fullText.slice(0, offset - 1);
  const receiverMatch = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.exec(beforeMember);
  if (receiverMatch === null) {
    return null;
  }
  const pythonReceiver = receiverMatch[0];
  const tsReceiver = translateIdentifierNamePreservingPrivateMembers(pythonReceiver, nameMap);
  return translatedMemberNameForReceiver(name, pythonReceiver, tsReceiver, nameMap);
}

export function tsMemberNameForPythonName(pythonName: string): string {
  if (pythonName.startsWith('__') && pythonName.endsWith('__')) {
    return pythonName;
  }
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
}

export function translateAttributeRest(rest: string): string {
  return rest.replaceAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, tsExportNameForPythonName);
}
