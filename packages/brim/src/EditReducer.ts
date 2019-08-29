import { State, Path, StreamID, FunctionID, Node, isProgramNode, ExpressionNode, isExpressionNode, IdentifierNode, ArrayLiteralNode, isArrayLiteralNode, FunctionSignature, FunctionNode, isApplicationNode, UserFunctionNode, isUserFunctionNode, ProgramNode, NodeEditState, UndefinedExpressionNode, isIdentifierNode, isFunctionNode, ParameterNode } from './State';
import genuid from './uid';
import { compileUserDefinition, CompilationError, CompiledDefinition } from './Compiler';
import { createNullaryVoidRootExecutionContext, beginBatch, endBatch } from 'riv-runtime';
import { createLiveFunction, Environment } from './LiveFunction';
const { showString, animationTime, mouseDown, changeCount, streamMap, audioDriver, random, mouseClickEvts } = require('riv-demo-lib');

const REALIZE_TENTATIVE_EXPRESSION_EDITS = false;
const REALIZE_TENTATIVE_IDENTIFIER_EDITS = true;

// We don't make a discriminated union of specific actions, but maybe we could
interface Action {
  type: string;
  char?: string;
  newNode?: Node;
  newPath?: Path;
}

interface HandlerArgs {
  node: Node,
  subpath: Path,
  editingSelected: NodeEditState,
  action: Action;
}
type HandlerResult = (undefined | [Node, Path, NodeEditState]);
type Handler = [string, string[], (args: HandlerArgs) => HandlerResult];

// TODO: If we want to include other classes in the lists, generate an expansion over the closure
// TODO: Instead of this, we could have handlers provide predicate functions, and use isExpressionNode, etc.
const SCHEMA_CLASSES: {[nodeType: string]: string[]} = {
  Expression: ['UndefinedExpression', 'IntegerLiteral', 'ArrayLiteral', 'StreamReference', 'Application', 'Parameter'],
  Any: ['Program', 'Identifier', 'UndefinedExpression', 'IntegerLiteral', 'ArrayLiteral', 'StreamReference', 'Application', 'NativeFunction', 'UserFunction'],
}

export function nodeFromPath(root: Node, path: Path): Node {
  let cur: any = root;
  for (const seg of path) {
    cur = cur[seg];
  }
  return cur;
}

function nodeSplitPath(node: Node, root: Node, path: Path): [Path, Path] {
  let cur: any = root;
  let idx = 0;
  for (const seg of path) {
    if (node === cur) {
      return [path.slice(0, idx), path.slice(idx)];
    }
    cur = cur[seg];
    idx++;
  }

  if (node === cur) {
    return [path.slice(0, idx), path.slice(idx)];
  } else {
    throw new Error('node was not in path');
  }
}

function pathIsPrefix(a: Path, b: Path): boolean {
  if (a.length > b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

type TraversalVisitor = (node: Node, path: Path) => [boolean, Node];

interface TraversalOptions {
  onlyLocal?: true; // do not traverse into contained function definitions
  alongPath?: Path;
}

// Returns [exit, newNode]. exit indicates an early end to traversal. newNode returns replacement node, which may be the same node
// Warning: This is a juicy-ass function that demands respect.
function recursiveTraverseTree(node: Node, path: Path, options: TraversalOptions, visit: TraversalVisitor): [boolean, Node] {
  if (options.alongPath && !pathIsPrefix(path, options.alongPath)) {
    return [false, node];
  }

  // Recurse
  let exited = false;
  let newNode: Node = node;

  if ((isExpressionNode(newNode) || isFunctionNode(newNode)) && newNode.identifier) {
    const [exit, newIdentifier] = recursiveTraverseTree(newNode.identifier, path.concat(['identifier']), options, visit);
    if (exit) exited = true;
    if (newIdentifier !== newNode.identifier) {
      newNode = {
        ...newNode,
        identifier: newIdentifier,
      } as Node;
    };
  }

  switch (newNode.type) {
    case 'Program': {
      const [exit, newMainDefinition] = recursiveTraverseTree(newNode.mainDefinition, path.concat(['mainDefinition']), options, visit);
      if (exit) exited = true;
      if (newMainDefinition !== newNode.mainDefinition) {
        newNode = {
          ...newNode,
          mainDefinition: newMainDefinition as UserFunctionNode,
        };
      }
      break;
    }

    case 'UserFunction': {
      const newParameters: Array<ParameterNode> = [];
      const newExpressions: Array<ExpressionNode> = [];
      let anyNewChildren = false;

      newNode.parameters.forEach((parameter, idx) => {
        if (exited) {
          newParameters.push(parameter);
        } else {
          const [exit, newParameter] = recursiveTraverseTree(parameter, path.concat(['parameters', idx]), options, visit);
          if (exit) exited = true;
          newParameters.push(newParameter as ParameterNode);
          if (newParameter !== parameter) anyNewChildren = true;
        }
      });

      newNode.expressions.forEach((expression, idx) => {
        if (exited) {
          newExpressions.push(expression);
        } else {
          const [exit, newExpression] = recursiveTraverseTree(expression, path.concat(['expressions', idx]), options, visit);
          if (exit) exited = true;
          newExpressions.push(newExpression as ExpressionNode);
          if (newExpression !== expression) anyNewChildren = true;
        }
      });

      if (anyNewChildren) {
        newNode = {
          ...newNode,
          parameters: newParameters,
          expressions: newExpressions,
        };
      }
      break;
    }

    case 'Application': {
      const newArguments: Array<ExpressionNode> = [];
      const newFunctionArguments: Array<UserFunctionNode> = [];
      let anyNewChildren = false;

      newNode.arguments.forEach((argument, idx) => {
        if (exited) {
          newArguments.push(argument);
        } else {
          const [exit, newArgument] = recursiveTraverseTree(argument, path.concat(['arguments', idx]), options, visit);
          if (exit) exited = true;
          newArguments.push(newArgument as ExpressionNode);
          if (newArgument !== argument) anyNewChildren = true;
        }
      });

      newNode.functionArguments.forEach((functionArgument, idx) => {
        if (exited || options.onlyLocal) {
          newFunctionArguments.push(functionArgument);
        } else {
          const [exit, newFunctionArgument] = recursiveTraverseTree(functionArgument, path.concat(['functionArguments', idx]), options, visit);
          if (exit) exited = true;
          newFunctionArguments.push(newFunctionArgument as UserFunctionNode);
          if (newFunctionArgument !== functionArgument) anyNewChildren = true;
        }
      });

      if (anyNewChildren) {
        newNode = {
          ...newNode,
          arguments: newArguments,
          functionArguments: newFunctionArguments,
        };
      }
      break;
    }

    case 'ArrayLiteral': {
      let newItems: Array<ExpressionNode> = [];
      let anyNewChildren = false;

      newNode.items.forEach((item, idx) => {
        if (exited) {
          newItems.push(item);
        } else {
          const [exit, newItem] = recursiveTraverseTree(item, path.concat(['items', idx]), options, visit);
          if (exit) exited = true;
          newItems.push(newItem as ExpressionNode);
          if (newItem !== item) anyNewChildren = true;
        }
      });

      if (anyNewChildren) {
        newNode = {
          ...newNode,
          items: newItems,
        };
      }
      break;
    }

    case 'Identifier':
    case 'IntegerLiteral':
    case 'StreamReference':
    case 'UndefinedExpression':
    case 'Parameter':
      // Nothing else to recurse into
      break;

    default:
      throw new Error();
  }

  if (exited) {
    return [exited, newNode];
  }

  return visit(newNode, path);
}

// Post-order traversal. Avoids returning new node unless something has changed.
function traverseTree(node: Node, options: TraversalOptions, visit: TraversalVisitor): Node {
  const [, newNode] = recursiveTraverseTree(node, [], options, visit);
  return newNode;
}

export function addExpressionLocalEnvironment(expr: ExpressionNode, namedStreams: Array<[string, ExpressionNode]>, namedFunctions: Array<[string, FunctionNode]>) {
  if (expr.identifier) {
    namedStreams.push([expr.identifier.name, expr]);
  }

  switch (expr.type) {
    case 'Application':
      for (const sarg of expr.arguments) {
        addExpressionLocalEnvironment(sarg, namedStreams, namedFunctions);
      }
      for (const farg of expr.functionArguments) {
        // NOTE: We don't recurse into the function-argument since we only want the local scope
        if (farg.identifier) {
          namedFunctions.push([farg.identifier.name, farg]);
        }
      }
      break;

    case 'ArrayLiteral':
      for (const item of expr.items) {
        addExpressionLocalEnvironment(item, namedStreams, namedFunctions);
      }
      break;

    case 'StreamReference':
    case 'IntegerLiteral':
    case 'UndefinedExpression':
      // nothing to do
      break;

    default:
      throw new Error();
  }
}

export function addUserFunctionLocalEnvironment(func: UserFunctionNode, namedStreams: Array<[string, ExpressionNode]>, namedFunctions: Array<[string, FunctionNode]>) {
  for (const param of func.parameters) {
    if (param.identifier) {
      namedStreams.push([param.identifier.name, param]);
    }
  }

  for (const exp of func.expressions) {
    addExpressionLocalEnvironment(exp, namedStreams, namedFunctions);
  }
}

export function addEnvironmentAlongPath(root: Node, path: Path, namedStreams: Array<[string, ExpressionNode]>, namedFunctions: Array<[string, FunctionNode]>) {
  let cur: Node = root;
  for (const seg of path) {
    if (cur.type === 'UserFunction') {
      addUserFunctionLocalEnvironment(cur, namedStreams, namedFunctions);
    }
    cur = (cur as any)[seg];
  }
}

export function environmentForSelectedNode(state: State) {
  const namedStreams: Array<[string, ExpressionNode]> = [];
  const namedFunctions: Array<[string, FunctionNode]> = [];

  for (const extFunc of state.nativeFunctions) {
    if (extFunc.identifier) {
      namedFunctions.push([extFunc.identifier.name, extFunc]);
    }
  }

  addEnvironmentAlongPath(state.program, state.selectionPath, namedStreams, namedFunctions);

  return {
    namedStreams,
    namedFunctions,
  }
}

const equiv = (a: any, b: any): boolean => JSON.stringify(a) === JSON.stringify(b);

function deleteDefinitionExpression(node: UserFunctionNode, removeIdx: number): [UserFunctionNode, Path, NodeEditState] {
  // TODO: Handle case where we delete all expressions
  if (typeof(removeIdx) !== 'number') {
    throw new Error();
  }
  const newNode = {
    ...node,
    expressions: [
      ...node.expressions.slice(0, removeIdx),
      ...node.expressions.slice(removeIdx+1),
    ],
  };

  if (newNode.expressions.length) {
    let newIdx = removeIdx-1;
    newIdx = Math.max(newIdx, 0);
    newIdx = Math.min(newIdx, node.expressions.length-1);
    return [newNode, ['expressions', newIdx], null];
  } else {
    // We've deleted all expressions, so make a single empty one.
    const n: Node = {
      type: 'UndefinedExpression',
      streamId: genuid(),
      identifier: null,
    };
    newNode.expressions.push(n);
    return [newNode, ['expressions', 0], {originalNode: n, tentativeNode: n}];
  }
}

function endEdit({node, subpath, editingSelected}: HandlerArgs, confirm: boolean): HandlerResult {
  if (!editingSelected) {
    throw new Error(); // sanity check
  }

  if (isIdentifierNode(node)) {
    // Ignore this so that it gets handled by its parent
    return;
  }

  if (subpath.length !== 0) {
    if (!isExpressionNode(node) || !equiv(subpath, ['identifier'])) {
      throw new Error(); // sanity check
    }

    // Ending an edit on the identifier that is the child of this expression
    if (!node.identifier) {
      throw new Error();
    }

    let newIdName;
    if (confirm) {
      newIdName = node.identifier.name.trim();
    } else {
      newIdName = (editingSelected.originalNode as IdentifierNode).name;
    }

    let newIdNode: IdentifierNode | null = newIdName ? {
      type: 'Identifier',
      name: newIdName,
    } : null;

    return [{
      ...node,
      identifier: newIdNode,
    }, [], null];
  }

  const newNode = confirm ? editingSelected.tentativeNode : editingSelected.originalNode;

  let newSubpath: Path = subpath;
  let newEditingSelected = null;
  if (confirm) {
    const hit = firstUndefinedNode(newNode);
    if (hit) {
      const [hitNode, hitPath] = hit;
      newSubpath = hitPath;
      newEditingSelected = {originalNode: hitNode, tentativeNode: hitNode};
    }
  }

  return [newNode, newSubpath, newEditingSelected];
}

function recursiveFirstUndefinedNode(node: Node, path: Path, after: Path | undefined, passed: [boolean]): [Node, Path] | undefined {
  if (after && equiv(path, after)) {
    passed[0] = true;
  }

  switch (node.type) {
    case 'Program':
      return recursiveFirstUndefinedNode(node.mainDefinition, path.concat(['mainDefinition']), after, passed);

    case 'UserFunction': {
      let idx = 0;
      for (const expression of node.expressions) {
        const result = recursiveFirstUndefinedNode(expression, path.concat(['expressions', idx]), after, passed);
        if (result) { return result; }
        idx++;
      }
      break;
    }

    case 'Application': {
      let idx = 0;
      for (const arg of node.arguments) {
        const result = recursiveFirstUndefinedNode(arg, path.concat(['arguments', idx]), after, passed);
        if (result) { return result; }
        idx++;
      }

      idx = 0; // so ghetto
      for (const farg of node.functionArguments) {
        const result = recursiveFirstUndefinedNode(farg, path.concat(['functionArguments', idx]), after, passed);
        if (result) { return result; }
        idx++;
      }
      break;
    }

    case 'ArrayLiteral': {
      let idx = 0;
      for (const item of node.items) {
        const result = recursiveFirstUndefinedNode(item, path.concat(['items', idx]), after, passed);
        if (result) { return result; }
        idx++;
      }
      break;
    }

    case 'Identifier':
    case 'IntegerLiteral':
    case 'StreamReference':
      // NOTE: nothing to recurse into
      break;

    case 'UndefinedExpression':
      if (!after || passed[0]) {
        return [node, path];
      }
      break;

    default:
      throw new Error();
  }
}

function firstUndefinedNode(node: Node, after: Path | undefined = undefined): [Node, Path] | undefined {
  const passed: [boolean] = [false]; // have we passed the "after" path?
  return recursiveFirstUndefinedNode(node, [], after, passed);
}

const HANDLERS: Handler[] = [
  ['UserFunction', ['MOVE_UP', 'MOVE_DOWN'], ({node, subpath, action}) => {
    if (!isUserFunctionNode(node)) {
      throw new Error();
    }

    // NOTE: This assumes that selection is on/in one of the expressions
    const newExpressionIdx = () => {
      const idx = subpath[1];
      if (typeof idx !== 'number') {
        throw new Error();
      }
      let newIdx = idx + ((action.type === 'MOVE_UP') ? -1 : 1);
      newIdx = Math.max(newIdx, 0);
      newIdx = Math.min(newIdx, node.expressions.length-1);
      return newIdx;
    }

    if ((subpath.length === 2) && (subpath[0] === 'expressions')) {
      return [node, ['expressions', newExpressionIdx()], null];
    }
  }],

  ['UserFunction', ['DELETE'], ({node, subpath}) => {
    if (!isUserFunctionNode(node)) {
      throw new Error();
    }
    if ((subpath.length === 2) && (subpath[0] === 'expressions')) {
      const removeIdx = subpath[1];
      if (typeof(removeIdx) !== 'number') {
        throw new Error();
      }
      return deleteDefinitionExpression(node, removeIdx);
    }
  }],

  ['UserFunction', ['ZOOM_IN', 'MOVE_RIGHT'], ({node, subpath}) => {
    if (!isUserFunctionNode(node)) {
      throw new Error();
    }
    if (subpath.length === 0) {
      return [node, ['expressions', 0], null];
    }
  }],

  ['Any', ['TOGGLE_EDIT'], (args) => {
    const {node, subpath, editingSelected} = args;

    if (editingSelected) {
      return endEdit(args, true);
    } else {
      if (subpath.length !== 0) {
        throw new Error();
      }

      switch (node.type) {
        case 'IntegerLiteral':
        case 'UndefinedExpression':
        case 'StreamReference':
        case 'Application':
          return [node, subpath, {originalNode: node, tentativeNode: node}];

        case 'ArrayLiteral':
          // Can't directly edit
          break;

        default:
          throw new Error();
      }
    }
  }],

  ['Any', ['ABORT_EDIT'], (args) => {
    const {editingSelected} = args;

    if (editingSelected) {
      return endEdit(args, false);
    }
  }],

  ['Any', ['CONFIRM_EDIT'], (args) => {
    const {editingSelected} = args;

    if (editingSelected) {
      return endEdit(args, true);
    }
  }],

  ['Expression', ['BEGIN_IDENTIFIER_EDIT'], ({node, subpath}) => {
    if (!isExpressionNode(node)) {
      throw new Error();
    }
    if (equiv(subpath, [])) {
      const idNode = node.identifier || {
        type: 'Identifier',
        name: '',
      };

      return [{
        ...node,
        identifier: idNode,
      }, ['identifier'], {originalNode: idNode, tentativeNode: idNode}];
    }
  }],

  ['Expression', ['BEGIN_OVERWRITE_EDIT'], ({node, subpath}) => {
    if (!isExpressionNode(node)) {
      throw new Error();
    }
    const newNode: Node = {
      type: 'UndefinedExpression',
      streamId: node.streamId,
      identifier: node.identifier,
    };
    return [node, subpath, {originalNode: node, tentativeNode: newNode}];
  }],

  ['Any', ['UPDATE_EDITING_TENTATIVE_NODE'], ({node, subpath, action, editingSelected}) => {
    if (!action.newNode) {
      throw new Error();
    }
    if (!editingSelected) {
      throw new Error();
    }
    if (subpath.length === 0) {
      let newNode: Node;
      if (isIdentifierNode(node)) {
        newNode = REALIZE_TENTATIVE_IDENTIFIER_EDITS ? action.newNode : node;
      } else if (isExpressionNode(node)) {
        newNode = REALIZE_TENTATIVE_EXPRESSION_EDITS ? action.newNode : node;
      } else {
        throw new Error();
      }
      return [newNode, subpath, {...editingSelected, tentativeNode: action.newNode}];
    }
  }],

  ['UserFunction', ['EDIT_AFTER'], ({node, subpath}) => {
    if (!isUserFunctionNode(node)) {
      throw new Error();
    }
    if ((subpath.length >= 2) && (subpath[0] === 'expressions')) {
      const afterIdx = subpath[1];
      if (typeof(afterIdx) !== 'number') {
        throw new Error();
      }
      const insertingExprNode: UndefinedExpressionNode = {
        type: 'UndefinedExpression',
        streamId: genuid(),
        identifier: null,
      };
      const newNode: UserFunctionNode = {
        ...node,
        expressions: [
          ...node.expressions.slice(0, afterIdx+1),
          insertingExprNode,
          ...node.expressions.slice(afterIdx+1),
        ],
      };
      return [newNode, ['expressions', afterIdx+1], {originalNode: insertingExprNode, tentativeNode: insertingExprNode}];
    }
  }],

  // NOTE: We only allow MOVE_LEFT to act as ZOOM_OUT here because we know array is displayed vertically for now
  ['ArrayLiteral', ['ZOOM_OUT', 'MOVE_LEFT'], ({node, subpath}) => {
    if (subpath.length === 2) {
      if ((subpath[0] !== 'items') || (typeof(subpath[1]) !== 'number')) {
        throw Error();
      }
      return [node, [], null];
    }
  }],

  // NOTE: We only allow MOVE_RIGHT to act as ZOOM_IN here because we know it will be in a vertical-list container
  ['ArrayLiteral', ['ZOOM_IN', 'MOVE_RIGHT'], ({node, subpath}) => {
    if (!isArrayLiteralNode(node)) {
      throw new Error();
    }
    if (subpath.length === 0) {
      // We do a special thing here: If the array is empty, we create a single undefined item.
      // This gives us a way to add a new element to an empty array.
      if (node.items.length === 0) {
        const newExprNode: UndefinedExpressionNode = {
          type: 'UndefinedExpression',
          streamId: genuid(),
          identifier: null,
        };
        return [{
          ...node,
          items: [newExprNode],
        }, ['items', 0], {originalNode: newExprNode, tentativeNode: newExprNode}];
      } else {
        return [node, ['items', 0], null];
      }
    }
  }],

  ['ArrayLiteral', ['MOVE_UP', 'MOVE_DOWN'], ({node, subpath, action}) => {
    if (!isArrayLiteralNode(node)) {
      throw new Error();
    }

    if ((subpath.length === 2) && (subpath[0] === 'items')) {
      const idx = subpath[1];
      if (typeof idx !== 'number') {
        throw new Error();
      }
      const newIdx = idx + ((action.type === 'MOVE_UP') ? -1 : 1);

      if ((newIdx < 0) || (newIdx >= node.items.length)) {
        return [node, [], null];
      } else {
        return [node, ['items', newIdx], null];
      }
    }
  }],

  ['ArrayLiteral', ['EDIT_AFTER'], ({node, subpath}) => {
    if (!isArrayLiteralNode(node)) {
      throw new Error();
    }
    if ((subpath.length === 2) && (subpath[0] === 'items')) {
      const afterIdx = subpath[1];
      if (typeof(afterIdx) !== 'number') {
        throw new Error();
      }
      const insertingExprNode: UndefinedExpressionNode = {
        type: 'UndefinedExpression',
        streamId: genuid(),
        identifier: null,
      };
      const newNode: ArrayLiteralNode = {
        ...node,
        items: [
          ...node.items.slice(0, afterIdx+1),
          insertingExprNode,
          ...node.items.slice(afterIdx+1),
        ],
      };
      return [newNode, ['items', afterIdx+1], {originalNode: insertingExprNode, tentativeNode: insertingExprNode}];
    }
  }],

  ['ArrayLiteral', ['DELETE'], ({node, subpath}) => {
    if (!isArrayLiteralNode(node)) {
      throw new Error();
    }
    if (subpath.length === 2) {
      if (node.items.length === 0) {
        throw new Error();
      }

      const removeIdx = subpath[1];
      if (typeof(removeIdx) !== 'number') {
        throw new Error();
      }
      const newNode = {
        ...node,
        items: [
          ...node.items.slice(0, removeIdx),
          ...node.items.slice(removeIdx+1),
        ],
      };

      if (newNode.items.length > 0) {
        let newIdx = removeIdx-1;
        newIdx = Math.max(newIdx, 0);
        newIdx = Math.min(newIdx, node.items.length-1);
        return [newNode, ['items', newIdx], null];
      } else {
        return [newNode, [], null];
      }
    }
  }],

  ['Expression', ['CREATE_ARRAY'], ({node, subpath}) => {
    if (!isExpressionNode(node)) {
      throw new Error();
    }

    if (subpath.length === 0) {
      const newExprNode: UndefinedExpressionNode = {
        type: 'UndefinedExpression',
        streamId: genuid(),
        identifier: null,
      };
    return [{
        type: 'ArrayLiteral',
        streamId: node.streamId,
        identifier: node.identifier,
        items: [newExprNode],
      }, ['items', 0], {originalNode: newExprNode, tentativeNode: newExprNode}];
    }
  }],

  // NOTE: We only allow MOVE_LEFT to act as ZOOM_OUT here because we know arguments are displayed vertically for now
  ['Application', ['ZOOM_OUT', 'MOVE_LEFT'], ({node, subpath}) => {
    if (!isApplicationNode(node)) {
      throw new Error();
    }
    if (subpath.length === 2) {
      if ((subpath[0] === 'arguments') && (typeof(subpath[1]) === 'number')) {
        return [node, [], null];
      } else if ((subpath[0] === 'functionArguments') && (typeof(subpath[1]) === 'number')) {
        return [node, [], null];
      } else {
        throw new Error();
      }
    } else if ((subpath.length >= 3) && (subpath[0] === 'functionArguments') && (typeof(subpath[1]) === 'number')) {
      // We handle this here (slightly unusual) so that user can't zoom out to main function definition
      return [node, subpath.slice(0, 2), null];
    }
  }],

  // NOTE: We only allow MOVE_RIGHT to act as ZOOM_IN here because we know arguments are displayed vertically for now
  ['Application', ['ZOOM_IN', 'MOVE_RIGHT'], ({node, subpath}) => {
    if (!isApplicationNode(node)) {
      throw new Error();
    }
    if (subpath.length === 0) {
      if (node.arguments.length > 0) {
        return [node, ['arguments', 0], null];
      } else if (node.functionArguments.length > 0) {
        return [node, ['functionArguments', 0], null];
      }
    }
  }],

  ['Application', ['MOVE_UP', 'MOVE_DOWN'], ({node, subpath, action}) => {
    if (!isApplicationNode(node)) {
      throw new Error();
    }

    if ((subpath.length === 2) && (subpath[0] === 'arguments')) {
      const idx = subpath[1];
      if (typeof idx !== 'number') {
        throw new Error();
      }
      const newIdx = idx + ((action.type === 'MOVE_UP') ? -1 : 1);

      if ((newIdx >= node.arguments.length) && node.functionArguments.length) {
        return [node, ['functionArguments', 0], null];
      } else if ((newIdx < 0) || (newIdx >= node.arguments.length)) {
        return [node, [], null];
      } else {
        return [node, ['arguments', newIdx], null];
      }
    } else if ((subpath.length === 2) && (subpath[0] === 'functionArguments')) {
      const idx = subpath[1];
      if (typeof idx !== 'number') {
        throw new Error();
      }
      const newIdx = idx + ((action.type === 'MOVE_UP') ? -1 : 1);

      if ((newIdx < 0) && node.arguments.length) {
        return [node, ['arguments', node.arguments.length-1], null];
      } else if ((newIdx < 0) || (newIdx >= node.arguments.length)) {
        return [node, [], null];
      } else {
        return [node, ['functionArguments', newIdx], null];
      }
    }
  }],

  ['Application', ['DELETE'], ({node, subpath, action}) => {
    if (!isApplicationNode(node)) {
      throw new Error();
    }

    if ((subpath.length === 2) && (subpath[0] === 'arguments')) {
      const idx = subpath[1];
      if (typeof idx !== 'number') {
        throw new Error();
      }

      const newArguments = node.arguments.slice();
      newArguments[idx] = {
        type: 'UndefinedExpression',
        streamId: node.arguments[idx].streamId,
        identifier: node.arguments[idx].identifier,
      };

      return [{
        ...node,
        arguments: newArguments,
      }, ['arguments', idx], null];
    }
  }],
];

function applyActionToProgram(state: State, action: Action): (null | [Node, Path, NodeEditState]) {
  let handled = false;
  let newSelectionPath: Path | undefined;
  let newEditingSelected: NodeEditState | undefined;

  const newTree = traverseTree(state.program, {alongPath: state.selectionPath}, (node, path) => {
    for (const [nt, acts, hfunc] of HANDLERS) {
      const matchingTypes = SCHEMA_CLASSES[nt] ? SCHEMA_CLASSES[nt] : [nt];
      if (matchingTypes.includes(node.type) && acts.includes(action.type)) {
        const [pathBefore, pathAfter] = nodeSplitPath(node, state.program, state.selectionPath);
        const handlerResult = hfunc({
          node,
          subpath: pathAfter,
          editingSelected: state.editingSelected,
          action,
        });
        if (handlerResult) {
          // console.log('action handled, with result', handlerResult);
          handled = true;
          const [handlerNewNode, handlerNewSubpath, handlerNewEditingSelected] = handlerResult;

          newSelectionPath = pathBefore.concat(handlerNewSubpath);
          newEditingSelected = handlerNewEditingSelected;
          return [true, handlerNewNode];
        }
      }
    }

    return [false, node];
  });

  if (handled) {
    if ((newSelectionPath === undefined) || (newEditingSelected === undefined)) {
      throw new Error();
    }
    return [newTree, newSelectionPath, newEditingSelected];
  } else {
    if (newTree !== state.program) {
      throw new Error();
    }
    return null;
  }
}

function recursiveBuildIdMaps(node: Node, streamIdToNode: Map<StreamID, Node>, functionIdToNode: Map<FunctionID, FunctionNode>): void {
  if (isExpressionNode(node)) {
    if (streamIdToNode.has(node.streamId)) {
      throw new Error('stream ids must be unique');
    }
    streamIdToNode.set(node.streamId, node);
  }

  switch (node.type) {
    case 'Program':
      recursiveBuildIdMaps(node.mainDefinition, streamIdToNode, functionIdToNode);
      break;

    case 'UserFunction':
      if (functionIdToNode.has(node.functionId)) {
        throw new Error('function ids must be unique');
      }
      functionIdToNode.set(node.functionId, node);

      for (const param of node.parameters) {
        if (streamIdToNode.has(param.streamId)) {
          throw new Error('stream ids must be unique');
        }
        streamIdToNode.set(param.streamId, param);
      }

      node.expressions.forEach((expression, idx) => {
        recursiveBuildIdMaps(expression, streamIdToNode, functionIdToNode);
      });
      break;

    case 'Application':
      node.arguments.forEach((arg, idx) => {
        recursiveBuildIdMaps(arg, streamIdToNode, functionIdToNode);
      });
      node.functionArguments.forEach((farg, idx) => {
        recursiveBuildIdMaps(farg, streamIdToNode, functionIdToNode);
      });
      break;

    case 'ArrayLiteral':
      node.items.forEach((item, idx) => {
        recursiveBuildIdMaps(item, streamIdToNode, functionIdToNode);
      })
      break;

    case 'IntegerLiteral':
    case 'UndefinedExpression':
    case 'StreamReference':
      // NOTE: nothing to recurse into
      break;

    default:
      throw new Error();
  }
}

function addStateIdLookups(state: State): State {
  const streamIdToNode: Map<StreamID, ExpressionNode> = new Map();
  const functionIdToNode: Map<FunctionID, FunctionNode> = new Map();
  const nodeToPath: Map<Node, Path> = new Map();

  for (const extFunc of state.nativeFunctions) {
    functionIdToNode.set(extFunc.functionId, extFunc);
  }

  recursiveBuildIdMaps(state.program, streamIdToNode, functionIdToNode);

  return {
    ...state,
    derivedLookups: {
      streamIdToNode,
      functionIdToNode,
      nodeToPath,
    },
  };
}

function recursiveBuildPathMap(node: Node, path: Path, nodeToPath: Map<Node, Path>): void {
  nodeToPath.set(node, path);

  if (isExpressionNode(node)) {
    if (node.identifier) {
      recursiveBuildPathMap(node.identifier, path.concat(['identifier']), nodeToPath)
    }
  }

  switch (node.type) {
    case 'Program':
      recursiveBuildPathMap(node.mainDefinition, path.concat(['mainDefinition']), nodeToPath);
      break;

    case 'UserFunction':
      node.expressions.forEach((expression, idx) => {
        recursiveBuildPathMap(expression, path.concat(['expressions', idx]), nodeToPath);
      });
      break;

    case 'Application':
      node.arguments.forEach((arg, idx) => {
        recursiveBuildPathMap(arg, path.concat(['arguments', idx]), nodeToPath);
      });
      node.functionArguments.forEach((farg, idx) => {
        recursiveBuildPathMap(farg, path.concat(['functionArguments', idx]), nodeToPath);
      });
      break;

    case 'ArrayLiteral':
      node.items.forEach((item, idx) => {
        recursiveBuildPathMap(item, path.concat(['items', idx]), nodeToPath);
      })
      break;

    case 'Identifier':
    case 'IntegerLiteral':
    case 'UndefinedExpression':
    case 'StreamReference':
      // NOTE: nothing to recurse into
      break;

    default:
      throw new Error();
  }
}

function addStatePathLookup(state: State): State {
  const nodeToPath: Map<Node, Path> = new Map();

  recursiveBuildPathMap(state.program, [], nodeToPath);

  return {
    ...state,
    derivedLookups: {
      ...state.derivedLookups,
      nodeToPath,
    },
  };
}

function undefineDanglingStreamRefs(state: State): State {
  const newProgram = traverseTree(state.program, {}, (node, ) => {
    if (node.type === 'StreamReference') {
      return [false, state.derivedLookups.streamIdToNode!.has(node.targetStreamId) ? node : {
        type: 'UndefinedExpression',
        streamId: genuid(),
        identifier: node.identifier,
      }];
    } else {
      return [false, node];
    }
  });

  return (newProgram === state.program) ? state : {
    ...state,
    program: newProgram as ProgramNode,
  }
}

function addStateCompiled(oldState: State | undefined, newState: State): State {
  // We initialize with an "empty" definition, which we fall back on if compilation fails
  let newCompiledDefinition: CompiledDefinition = {
    parameterStreams: [],
    literalStreamValues: [],
    applications: [],
    containedDefinitions: [],
    yieldStream: null,
  };

  try {
    newCompiledDefinition = compileUserDefinition(newState.program.mainDefinition, newState);
    // console.log('compiled to', newCompiledDefinition);
  } catch (e) {
    if (e instanceof CompilationError) {
      console.log('COMPILATION ERROR', e.message);
    } else {
      throw e;
    }
  }

  let newLiveMain;

  if (oldState) {
    const { context, updateCompiledDefinition } = oldState.liveMain!;

    // console.log('updating compiled definition to', newCompiledDefinition);
    beginBatch(); // batch thing is not necessary yet, but will be in the future
    updateCompiledDefinition(newCompiledDefinition);
    endBatch();

    newLiveMain = {
      context,
      updateCompiledDefinition,
      compiledDefinition: newCompiledDefinition,
    };
  } else {
    // There is no old state, so we need to create the long-lived stuff
    // console.log('initializing compiled definition to', newCompiledDefinition);
    const [liveStreamFunc, updateCompiledDefinition] = createLiveFunction(newCompiledDefinition, new Environment(), nativeFunctionEnvironment);
    const context = createNullaryVoidRootExecutionContext(liveStreamFunc);

    context.update(); // first update that generally kicks off further async updates

    newLiveMain = {
      context,
      updateCompiledDefinition,
      compiledDefinition: newCompiledDefinition,
    };
  }

  return {
    ...newState,
    liveMain: newLiveMain,
  };
}

function addDerivedState(oldState: State | undefined, newState: State): State {
  // undefineDanglingStreamRefs needs up-to-date id lookups
  const danglingRemovedState = undefineDanglingStreamRefs(addStateIdLookups(newState));

  return addStateCompiled(oldState, addStatePathLookup(addStateIdLookups(danglingRemovedState)));
}

export function reducer(state: State, action: Action): State {
  // console.log('action', action.type);

  let newCore: (null | [Node, Path, NodeEditState]) = null;

  if (action.type === 'SET_PATH') {
    const newPath: Path = action.newPath!;
    const newSelectedNode = nodeFromPath(state.program, newPath);
    const beginEdit = (newSelectedNode.type === 'Identifier');
    const newEditingSelected: NodeEditState = beginEdit ? {originalNode: newSelectedNode, tentativeNode: newSelectedNode} : null;
    newCore = [state.program, newPath, newEditingSelected];
  } else if (action.type === 'EDIT_NEXT_UNDEFINED') {
    const confirmedResult = applyActionToProgram(state, {type: 'CONFIRM_EDIT'});
    const [confirmedProgram, confirmedPath] = confirmedResult ? [confirmedResult[0], confirmedResult[1]] : [state.program, state.selectionPath];

    const hit = firstUndefinedNode(confirmedProgram, confirmedPath);
    if (hit) {
      const [hitNode, hitPath] = hit;
      newCore = [confirmedProgram, hitPath, {originalNode: hitNode, tentativeNode: hitNode}];
    } else {
      newCore = [confirmedProgram, confirmedPath, null];
    }
  } else {
    newCore = applyActionToProgram(state, action);
  }

  if (newCore) {
    // console.log('handled');
    const [newProgram, newSelectionPath, newEditingSelected] = newCore;
    // console.log('new selectionPath is', newSelectionPath, 'newEditingSelected is', newEditingSelected);
    // console.log('new prog', newProgram);

    if (!isProgramNode(newProgram)) {
      throw new Error();
    }

    return addDerivedState(state, {
      program: newProgram,
      selectionPath: newSelectionPath,
      editingSelected: newEditingSelected,
      nativeFunctions: state.nativeFunctions,
      derivedLookups: {
        streamIdToNode: null,
        functionIdToNode: null,
        nodeToPath: null,
      },
      liveMain: null,
    });
  } else {
    // console.log('not handled');
    return state;
  }
}

const nativeFunctions: Array<[string, Array<string>, Array<[string, FunctionSignature]>, Function]> = [
  ['add', ['_a', '_b'], [], (a: number, b: number) => a + b],
  ['multiply', ['_a', '_b'], [], (a: number, b: number) => a * b],
  ['show value', ['_v'], [], showString],
  ['animation time', [], [], animationTime],
  ['is mouse down', [], [], mouseDown],
  ['change count', ['_stream'], [], changeCount],
  ['map', ['_array'], [['_func', {parameters: ['value'], functionParameters: []}]], (arr: Array<any>, f: (v: any) => any) => streamMap(f, arr)],
  ['if', ['cond', 'then', 'else'], [], (cond: any, _then: any, _else: any) => (cond ? _then : _else)],
  ['audio driver', [], [['_func', {parameters: ['audio time', 'next frame', 'sample rate'], functionParameters: []}]], audioDriver],
  ['cosine', ['_v'], [], Math.cos],
  ['random', ['repick'], [], random],
  ['mouse click', [], [], mouseClickEvts],
];

const nativeFunctionEnvironment: Environment<Function> = new Environment();
nativeFunctionEnvironment.set('id', (x: any) => x);
nativeFunctionEnvironment.set('Array_of', Array.of);
nativeFunctions.forEach(([name, , , jsFunc]) => {
  nativeFunctionEnvironment.set(name, jsFunc);
});

const mdId = genuid();
export const initialState: State = addDerivedState(undefined, {
  program: {
    type: 'Program',
    mainDefinition: {
      type: 'UserFunction',
      functionId: genuid(),
      identifier: null,
      signature: {
        parameters: [],
        functionParameters: [],
      },
      parameters: [],
      functionParameterFunctionIds: [],
      expressions: [
        {
          type: 'Application',
          streamId: mdId,
          identifier: {
            type: 'Identifier',
            name: 'md',
          },
          functionId: 'is mouse down',
          arguments: [],
          functionArguments: [],
        },
        {
          type: 'Application',
          streamId: genuid(),
          identifier: null,
          functionId: 'show value',
          arguments: [
            {
              type: 'Application',
              streamId: genuid(),
              identifier: null,
              functionId: 'if',
              arguments: [
                {
                  type: 'StreamReference',
                  streamId: genuid(),
                  identifier: null,
                  targetStreamId: mdId,
                },
                {
                  type: 'IntegerLiteral',
                  streamId: genuid(),
                  identifier: null,
                  value: 10,
                },
                {
                  type: 'IntegerLiteral',
                  streamId: genuid(),
                  identifier: null,
                  value: 20,
                },
              ],
              functionArguments: [],
            },
          ],
          functionArguments: [],
        },
      ],
    },
  },
  selectionPath: ['mainDefinition', 'expressions', 0],
  editingSelected: null,
  nativeFunctions: nativeFunctions.map(([name, paramNames, funcParams, ]) => ({
    type: 'NativeFunction',
    functionId: name,
    identifier: {
      type: 'Identifier',
      name: name,
    },
    signature: {
      parameters: paramNames,
      functionParameters: funcParams,
    },
  })),
  derivedLookups: {
    streamIdToNode: null,
    functionIdToNode: null,
    nodeToPath: null,
  },
  liveMain: null,
});
