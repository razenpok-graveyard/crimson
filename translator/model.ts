export interface TranslationJob {
  index: number;
  relativePath: string;
  sourcePath: string;
  targetPath: string;
  python: string;
}

export interface Reexport {
  names: string[];
  modulePath: string;
}

export interface NamespaceReexport {
  alias: string;
  modulePath: string;
}

export interface TypeAlias {
  name: string;
  typeExpression: string;
}

export interface ConstantDefinition {
  name: string;
  value: string;
}

export interface ConstantsModule {
  docstring: string | null;
  constants: ConstantDefinition[];
}

export interface FunctionParameter {
  name: string;
  typeExpression: string;
}

export interface FunctionDefinition {
  name: string;
  optsParams: FunctionParameter[];
  returnType: string;
  ignoredParam: string | null;
  returnExpression: string;
}

export interface LazyWrapperModule {
  typeName: string;
  typeModulePath: string;
  functionName: string;
  parameter: FunctionParameter;
  runtimeModulePath: string;
  runtimeFunctionName: string;
  comments: string[];
}

export interface ProtocolMethod {
  name: string;
  optsParams: FunctionParameter[];
  optsOptional: boolean;
  returnType: string;
}

export interface ProtocolDefinition {
  name: string;
  methods: ProtocolMethod[];
}

export interface InitReexports {
  docstring: string | null;
  namespaceReexports: NamespaceReexport[];
  reexports: Reexport[];
}
