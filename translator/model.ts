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
  exported?: boolean;
  validation?: TypeAliasValidation;
}

export interface TypeAliasValidation {
  minLength?: string;
  maxLength?: string;
  pattern?: string;
  ge?: string;
  le?: string;
}

export interface EnumMember {
  name: string;
  value: string;
}

export interface EnumDefinition {
  name: string;
  docstring: string | null;
  members: EnumMember[];
  valueFunction?: EnumValueFunction;
}

export interface EnumValueFunction {
  name: string;
  parameterName: string;
  fallbackMember: string;
  rejectsOverflow: boolean;
}

export interface ConstantDefinition {
  name: string;
  value: string;
  exported?: boolean;
}

export interface ConstantsModule {
  docstring: string | null;
  constants: ConstantDefinition[];
}

export interface FunctionParameter {
  name: string;
  typeExpression: string;
}

export interface OptionalFunctionParameter extends FunctionParameter {
  defaultValue: string | null;
}

export interface FunctionDefinition {
  name: string;
  optsParams: FunctionParameter[];
  returnType: string;
  ignoredParam: string | null;
  returnExpression: string;
}

export interface ImportDefinition {
  modulePath: string;
  names: string[];
  typeOnly?: boolean;
}

export interface GuardedAttributeFunction {
  name: string;
  parameter: FunctionParameter;
  returnType: string;
  attributeName: string;
  errorMessage: string;
}

export interface GuardedAttributeModule {
  imports: ImportDefinition[];
  functionDefinition: GuardedAttributeFunction;
}

export interface SimpleFunctionParameter extends FunctionParameter {
  ignored: boolean;
}

export interface SimpleFunctionDefinition {
  name: string;
  parameters: SimpleFunctionParameter[];
  returnType: string;
  returnExpression: string;
  comments: string[];
  exported: boolean;
}

export interface SimpleExportModule {
  imports: ImportDefinition[];
  constants: ConstantDefinition[];
  functions: SimpleFunctionDefinition[];
}

export interface StructModule {
  imports: ImportDefinition[];
  typeAliases: TypeAlias[];
  classes: StructClassDefinition[];
  protocols: ProtocolDefinition[];
}

export interface StructClassDefinition {
  name: string;
  docstring: string | null;
  readonlyFields: boolean;
  fields: StructFieldDefinition[];
  methods: SimpleModuleFunction[];
}

export interface StructFieldDefinition {
  name: string;
  typeExpression: string;
  defaultValue: string | null;
}

export interface PackageVersionModule {
  packageName: string;
}

export interface PlatformDirsModule {
  appName: string;
  functionName: string;
  docstring: string;
  primaryEnvName: string;
  fallbackEnvName: string;
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
  parameters: FunctionParameter[];
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

export interface SimpleModuleFunction {
  name: string;
  exported: boolean;
  parameters: FunctionParameter[];
  optsParams: OptionalFunctionParameter[];
  returnType: string;
  statements: string[];
}

export interface SimpleModuleAssignment {
  pythonName?: string;
  name: string;
  declaration: 'const' | 'let';
  exported: boolean;
  typeExpression?: string;
  valueLines: string[];
}

export interface StraightLineModule {
  imports: ImportDefinition[];
  reexports: Reexport[];
  typeAliases: TypeAlias[];
  leadingAssignments: SimpleModuleAssignment[];
  classes: StructClassDefinition[];
  functions: SimpleModuleFunction[];
  assignments: SimpleModuleAssignment[];
}
