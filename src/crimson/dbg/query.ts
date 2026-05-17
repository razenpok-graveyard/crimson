// Port of crimson/dbg/query.py

function unavailableRuntimeExport(name: string): any {
  return function unavailableRuntimeExportTarget(): never {
    throw new Error(`${name} is not available in the WebGL runtime`);
  };
}

export type Operand = any;
export const Operand: any = unavailableRuntimeExport('Operand');

export type Predicate = any;
export const Predicate: any = unavailableRuntimeExport('Predicate');

export type parseLiteral = any;
export const parseLiteral: any = unavailableRuntimeExport('parseLiteral');

export type parseOperand = any;
export const parseOperand: any = unavailableRuntimeExport('parseOperand');

export type parseExpression = any;
export const parseExpression: any = unavailableRuntimeExport('parseExpression');

export type resolvePath = any;
export const resolvePath: any = unavailableRuntimeExport('resolvePath');

export type toFloat = any;
export const toFloat: any = unavailableRuntimeExport('toFloat');

export type evalOperand = any;
export const evalOperand: any = unavailableRuntimeExport('evalOperand');

export type compareValues = any;
export const compareValues: any = unavailableRuntimeExport('compareValues');

export type entityRows = any;
export const entityRows: any = unavailableRuntimeExport('entityRows');

export type eventTypeCounts = any;
export const eventTypeCounts: any = unavailableRuntimeExport('eventTypeCounts');

export type tickSummaryFromRow = any;
export const tickSummaryFromRow: any = unavailableRuntimeExport('tickSummaryFromRow');

export type summarizeTick = any;
export const summarizeTick: any = unavailableRuntimeExport('summarizeTick');

export type parseTickRange = any;
export const parseTickRange: any = unavailableRuntimeExport('parseTickRange');

export type entityHistory = any;
export const entityHistory: any = unavailableRuntimeExport('entityHistory');

export type queryTrace = any;
export const queryTrace: any = unavailableRuntimeExport('queryTrace');
