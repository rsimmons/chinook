import { StreamID, FunctionID, ApplicationID } from './Tree';

export interface ConstStreamSpec {
  readonly sid: StreamID;
  readonly val: any;
}

export interface AppSpec {
  readonly sids: ReadonlyArray<StreamID>;
  readonly appId: ApplicationID;
  readonly funcId: FunctionID;
  readonly sargIds: ReadonlyArray<StreamID>;
  readonly fargIds: ReadonlyArray<FunctionID>;
}

export interface LocalFunctionDefinition {
  readonly fid: FunctionID;
  readonly def: CompiledDefinition;
}

export interface CompiledDefinition {
  readonly streamParamIds: ReadonlyArray<StreamID>;
  readonly funcParamIds: ReadonlyArray<FunctionID>;
  readonly constStreams: ReadonlyArray<ConstStreamSpec>;
  readonly apps: ReadonlyArray<AppSpec>;
  readonly localDefs: ReadonlyArray<LocalFunctionDefinition>;
  readonly yieldIds: ReadonlyArray<StreamID>;
}
