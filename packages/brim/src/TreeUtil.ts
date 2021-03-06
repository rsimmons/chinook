import { NodeKind, StreamID, StreamExpressionNode } from './Tree';

export function streamExprReturnedId(node: StreamExpressionNode): StreamID | undefined {
  switch (node.kind) {
    case NodeKind.UndefinedLiteral:
    case NodeKind.NumberLiteral:
    case NodeKind.TextLiteral:
    case NodeKind.BooleanLiteral:
      return node.sid;

    case NodeKind.StreamReference:
      return node.ref;

    case NodeKind.Application:
      // NOTE: This is hacky, but works.
      //  We could be more robust by looking up the function definition and checking its signature.
      //  That would require having the environment available.
      for (const out of node.outs) {
        if (!out.name) {
          return out.sid;
        }
      }
      return undefined;

    default: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const exhaustive: never = node; // this will cause a type error if we haven't handled all cases
      throw new Error();
    }
  }
}
