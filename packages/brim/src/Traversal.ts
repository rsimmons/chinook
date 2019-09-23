import { Path, pathIsPrefix } from './State';
import { Node, isUserFunctionDefinitionNode } from './Tree';
import { FunctionID } from './Identifier';

type TraversalVisitor = (node: Node, path: Path) => [boolean, Node];

interface TraversalOptions {
  onlyWithinFunctionId?: FunctionID; // so as to not traverse into contained function definitions
  alongPath?: Path;
}

// Returns [exit, newNode]. exit indicates an early end to traversal. newNode returns replacement node, which may be the same node
function recursiveTraverseTree(node: Node, path: Path, options: TraversalOptions, visit: TraversalVisitor): [boolean, Node] {
  if (options.alongPath && !pathIsPrefix(path, options.alongPath)) {
    return [false, node];
  }

  let newNode: Node = node;

  // Recurse
  if (!(options.onlyWithinFunctionId && (isUserFunctionDefinitionNode(node) && (node.id !== options.onlyWithinFunctionId)))) {
    let exited = false;

    let newChildren: Array<Node> = [];
    let anyNewChildren = false;

    newNode.children.forEach((child: Node, idx: number) => {
      if (exited) {
        newChildren.push(child);
      } else {
        const [exit, newChild] = recursiveTraverseTree(child, path.concat([idx]), options, visit);
        if (exit) exited = true;
        newChildren.push(newChild);
        if (newChild !== child) {
          anyNewChildren = true;
        }
      }
    });

    if (anyNewChildren) {
      newNode = {
        ...newNode,
        children: newChildren,
      } as Node;
    }

    if (exited) {
      return [exited, newNode];
    }
  }

  return visit(newNode, path);
}

// Post-order traversal. Avoids returning new node unless something has changed.
export function traverseTree(node: Node, options: TraversalOptions, visit: TraversalVisitor): Node {
  const [, newNode] = recursiveTraverseTree(node, [], options, visit);
  return newNode;
}