import genuid from './uid';
import { FunctionInterface, DynamicInterfaceEditAction, DynamicInterfaceChange } from './FunctionInterface';

/**
 * IDS
 */
export type StreamID = string;
export type FunctionID = string;
export type ApplicationID = string;

const STREAM_ID_PREFIX = 'S-';
export function generateStreamId(): StreamID {
  return STREAM_ID_PREFIX + genuid();
}
export function validStreamId(s: string): s is StreamID {
  return s.startsWith(STREAM_ID_PREFIX);
}

const FUNCTION_ID_PREFIX = 'F-';
export function generateFunctionId(): FunctionID {
  return FUNCTION_ID_PREFIX + genuid();
}
export function validFunctionId(s: string): s is FunctionID {
  return s.startsWith(FUNCTION_ID_PREFIX);
}

const APPLICATION_ID_PREFIX = 'A-';
export function generateApplicationId(): ApplicationID {
  return APPLICATION_ID_PREFIX + genuid();
}
export function validApplicationId(s: string): s is ApplicationID {
  return s.startsWith(APPLICATION_ID_PREFIX);
}

/**
 * NODE KINDS
 */
export enum NodeKind {
  Name = 'name',
  UndefinedLiteral = 'und',
  NumberLiteral = 'num',
  TextLiteral = 'str',
  BooleanLiteral = 'bool',
  StreamReference = 'sref',
  Application = 'app',
  NativeFunctionDefinition = 'nfdef',
  YieldExpression = 'yield',
  ValueTypeApp = 'vtyapp',
  ValueTypeVar = 'vtyvar',
  FIText = 'fitext',
  FIStreamParam = 'fisparam',
  FIFunctionParam = 'fifparam',
  FIOut = 'fiout',
  FIBreak = 'fibreak',
  FINothing = 'finothing',
  StaticFunctionInterface = 'sfi',
  DynamicFunctionInterface = 'dfi',
  TreeFunctionDefinition = 'tfdef',
}

/**
 * COMMON NODES
 */
export interface NameNode {
  readonly kind: NodeKind.Name;
  readonly text: string;
}

/**
 * STREAM NODES
 */
export interface UndefinedLiteralNode {
  readonly kind: NodeKind.UndefinedLiteral;
  readonly sid: StreamID;
}

export interface NumberLiteralNode {
  readonly kind: NodeKind.NumberLiteral;
  readonly sid: StreamID;
  readonly val: number;
}

export interface TextLiteralNode {
  readonly kind: NodeKind.TextLiteral;
  readonly sid: StreamID;
  readonly val: string;
}

export interface BooleanLiteralNode {
  readonly kind: NodeKind.BooleanLiteral;
  readonly sid: StreamID;
  readonly val: boolean;
}

export type SimpleLiteralNode = UndefinedLiteralNode | NumberLiteralNode | TextLiteralNode | BooleanLiteralNode;
export function isSimpleLiteralNode(node: Node): node is SimpleLiteralNode {
  return (node.kind === NodeKind.UndefinedLiteral) || (node.kind === NodeKind.NumberLiteral) || (node.kind === NodeKind.TextLiteral) || (node.kind === NodeKind.BooleanLiteral);
}

export interface StreamReferenceNode {
  readonly kind: NodeKind.StreamReference;
  readonly ref: StreamID; // the stream id we are referencing
}

export interface ApplicationOut {
  readonly sid: StreamID;
  readonly name: NameNode | null; // if this output was given a local name
}

export type ApplicationSettings = any;

export interface ApplicationNode {
  readonly kind: NodeKind.Application;
  readonly aid: ApplicationID;
  readonly outs: ReadonlyArray<ApplicationOut>; // array since there can be multiple yields
  readonly fid: FunctionID; // function being applied
  readonly sargs: ReadonlyArray<StreamExpressionNode>;
  readonly fargs: ReadonlyArray<FunctionDefinitionNode>;
  readonly settings?: ApplicationSettings;
}

// Stream parameter definitions (on the "inside" of a function def) are _not_ expressions.
export type StreamExpressionNode = SimpleLiteralNode | StreamReferenceNode | ApplicationNode;
export function isStreamExpressionNode(node: Node): node is StreamExpressionNode {
  return isSimpleLiteralNode(node) || (node.kind === NodeKind.StreamReference) || (node.kind === NodeKind.Application);
}

/**
 * TYPE DECLARATION NODES
 */

/*
export interface ValueTypeAppNode {
  readonly kind: NodeKind.ValueTypeApp;
  readonly ctor: string;
  readonly args: ReadonlyArray<ValueTypeNode>;
}

export interface ValueTypeVarNode {
  readonly kind: NodeKind.ValueTypeVar;
}

export type ValueTypeNode = ValueTypeAppNode | ValueTypeVarNode;
*/

/**
 * FUNCTION INTERFACE NODES
 */

export interface FITextNode {
  readonly kind: NodeKind.FIText;
  readonly text: string;
}

export interface FIStreamParamNode {
  readonly kind: NodeKind.FIStreamParam;
  readonly idx: number;
  readonly name: NameNode;
  // readonly type: ValueTypeNode;
}

export interface FIOutNode {
  readonly kind: NodeKind.FIOut;
  readonly idx: number;
  readonly name: NameNode;
  // readonly type: ValueTypeNode;
}

export interface FIFunctionParamNode {
  readonly kind: NodeKind.FIFunctionParam;
  readonly idx: number;
  readonly iface: StaticFunctionInterfaceNode;
}

export interface FIBreakNode {
  readonly kind: NodeKind.FIBreak;
}

export type FITmplSegNode = FITextNode | FIStreamParamNode | FIOutNode | FIFunctionParamNode | FIBreakNode;
export function isFITmplSegNode(node: Node): node is FITmplSegNode {
  return (node.kind === NodeKind.FIText) || (node.kind === NodeKind.FIStreamParam) || (node.kind === NodeKind.FIOut) || (node.kind === NodeKind.FIFunctionParam) || (node.kind === NodeKind.FIBreak);
}

// this is like "void"
export interface FINothingNode {
  readonly kind: NodeKind.FINothing;
}

export interface StaticFunctionInterfaceNode {
  readonly kind: NodeKind.StaticFunctionInterface;
  readonly segs: ReadonlyArray<FITmplSegNode>;
  readonly ret: FIOutNode | FINothingNode;
}

export interface DynamicFunctionInterfaceNode {
  readonly kind: NodeKind.DynamicFunctionInterface;
  // TODO: these funcs should be in a JS code string, props on one object, so we can store them?
  readonly getIface: (settings: ApplicationSettings) => FunctionInterface;
  readonly onEdit?: (action: DynamicInterfaceEditAction, groupId: number, settings: ApplicationSettings) => DynamicInterfaceChange;
  readonly createCustomUI?: (underNode: HTMLElement, settings: ApplicationSettings, onChange: (change: DynamicInterfaceChange) => void) => (() => void); // returns "shutdown" closure
}

export type FunctionInterfaceNode = StaticFunctionInterfaceNode | DynamicFunctionInterfaceNode;
export function isFunctionInterfaceNode(node: Node): node is FunctionInterfaceNode {
  return (node.kind === NodeKind.StaticFunctionInterface) || (node.kind === NodeKind.DynamicFunctionInterface);
}


/**
 * FUNCTION NODES
 */


export interface NativeFunctionDefinitionNode {
  readonly kind: NodeKind.NativeFunctionDefinition;
  readonly fid: FunctionID;
  readonly iface: FunctionInterfaceNode;

  // TODO: JS code as string?
  readonly impl: Function;
}

export interface YieldExpressionNode {
  readonly kind: NodeKind.YieldExpression;
  readonly idx: number;
  readonly expr: StreamExpressionNode;
}

export type BodyExpressionNode = StreamExpressionNode | FunctionDefinitionNode | YieldExpressionNode;
export function isBodyExpressionNode(node: Node): node is BodyExpressionNode {
  return isStreamExpressionNode(node) || isFunctionDefinitionNode(node) || (node.kind === NodeKind.YieldExpression);
}

export interface TreeFunctionDefinitionNode {
  readonly kind: NodeKind.TreeFunctionDefinition;
  readonly fid: FunctionID;
  readonly iface: FunctionInterfaceNode;

  readonly spids: ReadonlyArray<StreamID>;
  readonly fpids: ReadonlyArray<FunctionID>;
  readonly bodyExprs: ReadonlyArray<BodyExpressionNode>;
}

export type FunctionDefinitionNode = NativeFunctionDefinitionNode | TreeFunctionDefinitionNode;
export function isFunctionDefinitionNode(node: Node): node is FunctionDefinitionNode {
  return (node.kind === NodeKind.NativeFunctionDefinition) || (node.kind === NodeKind.TreeFunctionDefinition);
}

export type Node = NameNode | BodyExpressionNode | FunctionInterfaceNode | FITmplSegNode | FINothingNode;
