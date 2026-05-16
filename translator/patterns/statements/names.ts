import { tsExportNameForPythonName } from '../../naming.js';

export function tsLocalFunctionNameForPythonName(pythonName: string): string {
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
}

export function tsLocalImportNameForPythonName(pythonName: string): string {
  return pythonName === '__version__' ? 'VERSION' : tsExportNameForPythonName(pythonName);
}

export function tsLocalDeclarationNameForAssignment(tsName: string, assignedRight: string): string {
  if (!new RegExp(`(^|[^.A-Za-z0-9_$])${escapeRegExp(tsName)}\\s*\\(`).test(assignedRight)) {
    return tsName;
  }
  return `${tsName}Value`;
}

export function tsLocalNameForPythonParameter(pythonName: string): string {
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
}

export function tsAttributeNameForPythonName(pythonName: string): string {
  return pythonName.startsWith('_')
    ? `_${tsExportNameForPythonName(pythonName)}`
    : tsExportNameForPythonName(pythonName);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
