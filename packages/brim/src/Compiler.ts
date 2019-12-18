import { StreamID, FunctionID, Node, FunctionDefinitionNode, TreeFunctionDefinitionNode, StreamExpressionNode, NodeKind, isFunctionDefinitionNode, isStreamExpressionNode, SignatureNode, streamExprReturnedId, functionExprId } from './Tree';
import { CompiledDefinition, ConstStreamSpec, LocalFunctionDefinition, AppSpec } from './CompiledDefinition';
import Environment from './Environment';
import { visitChildren } from './Traversal';

export class CompilationError extends Error {
};

// A stream id can be defined by either a stream expression or a parameter. If a stream id was
// created by a parameter, then it maps to null (because we don't need to traverse from the param).
type CompilationStreamEnvironment = Environment<StreamID, StreamExpressionNode | null>;
type CompilationFunctionEnvironment = Environment<FunctionID, FunctionDefinitionNode>;

function compileTreeDefinition(definition: TreeFunctionDefinitionNode, outerStreamEnvironment: CompilationStreamEnvironment, outerFunctionEnvironment: CompilationFunctionEnvironment): [CompiledDefinition, Set<StreamID>] {
  const streamEnvironment: CompilationStreamEnvironment = new Environment(outerStreamEnvironment);
  const functionEnvironment: CompilationFunctionEnvironment = new Environment(outerFunctionEnvironment);
  const localStreamIds: Set<StreamID> = new Set();
  const localFunctionIds: Set<FunctionID> = new Set();

  // Identify locally defined stream and function ids
  definition.sig.streamParams.forEach((_sparam, idx) => {
    const spid = definition.spids[idx];

    if (streamEnvironment.has(spid)) {
      throw new Error('must be unique');
    }
    streamEnvironment.set(spid, null);
    localStreamIds.add(spid);
  });

  /*
  definition.sig.funcParams.forEach((fparam, idx) => {
    const fpid = definition.fpids[idx];
    if (functionEnvironment.has(fpid)) {
      throw new Error('must be unique');
    }
    functionEnvironment.set(fpid, fparam.sig);
    localFunctionIds.add(fpid);
  });
  */

  const visitToFindLocals = (node: Node): void => {
    if (isStreamExpressionNode(node)) {
      switch (node.kind) {
        case NodeKind.UndefinedLiteral:
        case NodeKind.NumberLiteral:
        case NodeKind.ArrayLiteral:
        case NodeKind.StreamIndirection:
          if (streamEnvironment.has(node.sid)) {
            throw new Error('must be unique');
          }
          streamEnvironment.set(node.sid, node);
          localStreamIds.add(node.sid);
          break;

        case NodeKind.StreamReference:
          // ignore because it doesn't define a stream id
          break;

        case NodeKind.Application:
          node.sids.forEach(sid => {
            if (streamEnvironment.has(sid)) {
              throw new Error('must be unique');
            }
            streamEnvironment.set(sid, node);
            localStreamIds.add(sid);
          });
          break;

        default: {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const exhaustive: never = node; // this will cause a type error if we haven't handled all cases
          throw new Error();
        }
      }
    } else if (isFunctionDefinitionNode(node)) {
      // A local definition
      if (functionEnvironment.has(node.fid)) {
        throw new Error('must be unique');
      }
      functionEnvironment.set(node.fid, node);
      localFunctionIds.add(node.fid);
    }

    if (!isFunctionDefinitionNode(node)) {
      // Don't traverse into definitions, we want to stay local
      visitChildren(node, visitToFindLocals);
    }
  };
  visitChildren(definition.body, visitToFindLocals);

  const constStreams: Array<ConstStreamSpec> = [];
  const apps: Array<AppSpec> = [];
  const localDefs: Array<LocalFunctionDefinition> = [];
  const yieldIds: Array<StreamID> = [];
  const externalReferencedStreamIds: Set<StreamID> = new Set();

  // Compile local tree function definitions
  for (const fid of localFunctionIds) {
    const funcDef = functionEnvironment.get(fid);
    if (!funcDef) {
      throw new Error();
    }
    if (funcDef.kind === NodeKind.TreeFunctionDefinition) {
      const [innerCompiledDef, innerExternalReferencedStreamIds] = compileTreeDefinition(funcDef, streamEnvironment, functionEnvironment);
      localDefs.push({fid, def: innerCompiledDef});
    }
  }

  // Using terminology from https://en.wikipedia.org/wiki/Topological_sorting#Depth-first_search
  const temporaryMarked: Set<StreamExpressionNode> = new Set();
  const permanentMarked: Set<StreamExpressionNode> = new Set();

  function traverseStreamExpr(node: StreamExpressionNode): void {
    if (permanentMarked.has(node)) {
      return;
    }

    if (temporaryMarked.has(node)) {
      throw new CompilationError('graph cycle');
    }

    switch (node.kind) {
      case NodeKind.UndefinedLiteral:
        constStreams.push({sid: node.sid, val: undefined});
        break;

      case NodeKind.NumberLiteral:
        constStreams.push({sid: node.sid, val: node.val});
        break;

      case NodeKind.ArrayLiteral: {
        const elemStreamIds: Array<StreamID> = [];

        temporaryMarked.add(node);
        for (const elem of node.elems) {
          traverseStreamExpr(elem);
          const elemRetSid = streamExprReturnedId(elem);
          if (!elemRetSid) {
            throw new Error();
          }
          elemStreamIds.push(elemRetSid);
        }
        temporaryMarked.delete(node);

        apps.push({
          sids: [node.sid],
          appId: node.sid, // NOTE: this is a hack, but safe
          funcId: 'Array_of',
          sargIds: elemStreamIds,
          fargIds: [],
        });
        break;
      }

      case NodeKind.StreamIndirection:
        temporaryMarked.add(node);
        traverseStreamExpr(node.expr);
        temporaryMarked.delete(node);

        const exprRetSid = streamExprReturnedId(node.expr);
        if (!exprRetSid) {
          throw new Error();
        }

        apps.push({
          sids: [node.sid],
          appId: node.sid, // NOTE: this is a hack, but safe
          funcId: 'id',
          sargIds: [exprRetSid],
          fargIds: [],
        });
        break;

      case NodeKind.StreamReference:
        if (localStreamIds.has(node.ref)) {
          const targetExpressionNode = streamEnvironment.get(node.ref);
          if (targetExpressionNode === null) {
            // The reference is to a parameter, so we don't need to traverse
          } else if (targetExpressionNode === undefined) {
            throw Error();
          } else {
            temporaryMarked.add(node); // not really necessary to mark node here but might as well
            traverseStreamExpr(targetExpressionNode);
            temporaryMarked.delete(node);
          }
        } else {
          if (!streamEnvironment.has(node.ref)) {
            throw new CompilationError();
          }
          externalReferencedStreamIds.add(node.ref);
        }
        break;

      case NodeKind.Application:
        const functionNode = functionEnvironment.get(functionExprId(node.func));
        if (!functionNode) {
          throw new CompilationError();
        }

        // TODO: make sure that sargs, fargs, yields all match signature

        const streamArgIds: Array<StreamID> = [];
        const funcArgIds: Array<FunctionID> = [];

        temporaryMarked.add(node);

        for (const sarg of node.sargs) {
          traverseStreamExpr(sarg);
          const sargRetSid = streamExprReturnedId(sarg);
          if (!sargRetSid) {
            throw new Error();
          }
          streamArgIds.push(sargRetSid);
        }

        for (const farg of node.fargs) {
          const fid = functionExprId(farg);
          const funcDef = functionEnvironment.get(fid);
          if (!funcDef) {
            throw new Error();
          }

          /*
          if (funcDef.kind === NodeKind.TreeFunctionDefinition) {
            const compiledContainedDef = compileTreeDefinition(funcDef, streamEnvironment, functionEnvironment);

            compiledContainedDef.externalReferencedStreamIds.forEach((sid) => {
              compiledDefinition.externalReferencedStreamIds.add(sid);
            });

            // An application needs to traverse from its function-arguments out to any streams (in this exact scope)
            // that it refers to (outer-scope references), because these are dependencies. So this would be an invalid cycle:
            // x = map(v => x, [1,2,3])
            compiledContainedDef.externalReferencedStreamIds.forEach((sid) => {
              if (localStreamIds.has(sid)) {
                const depLocalExprNode = streamEnvironment.get(sid);
                if (depLocalExprNode === undefined) {
                  throw new Error();
                }
                traverseFromStreamCreation(depLocalExprNode, context);
              }
            });

            compiledDefinition.containedFunctionDefinitions.push({
              id: argument.id,
              definition: compiledContainedDef,
            });
          }
          */

          funcArgIds.push(fid);
        }

        temporaryMarked.delete(node);

        apps.push({
          sids: node.sids,
          appId: node.aid,
          funcId: functionExprId(node.func),
          sargIds: streamArgIds,
          fargIds: funcArgIds,
        });
        break;

      default: {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const exhaustive: never = node; // this will cause a type error if we haven't handled all cases
        throw new Error();
      }
    }

    permanentMarked.add(node);
  }

  for (const node of definition.body.exprs) {
    if (node.kind === NodeKind.YieldExpression) {
      traverseStreamExpr(node.expr);

      const exprRetSid = streamExprReturnedId(node.expr);
      if (!exprRetSid) {
        throw new Error();
      }
      yieldIds[node.idx] = exprRetSid;
    } else if (isStreamExpressionNode(node)) {
      traverseStreamExpr(node);
    } else {
      // TODO: this could also be a function expression
      throw new Error();
    }
  }

  // TODO: verify that yieldIds doesn't have any "holes" and matches signature

  const compiledDefinition: CompiledDefinition = {
    streamParamIds: definition.spids,
    funcParamIds: definition.fpids,
    constStreams,
    apps,
    localDefs,
    yieldIds,
  };

  return [compiledDefinition, externalReferencedStreamIds];
}

export function compileGlobalTreeDefinition(definition: TreeFunctionDefinitionNode, globalFunctionEnvironment: Environment<FunctionID, FunctionDefinitionNode>): CompiledDefinition {
  const streamEnv: CompilationStreamEnvironment = new Environment();

  const compGlobalFuncEnv: CompilationFunctionEnvironment = new Environment();
  globalFunctionEnvironment.forEach((defNode, fid) => {
    compGlobalFuncEnv.set(fid, defNode);
  });
  const funcEnv: CompilationFunctionEnvironment = new Environment(compGlobalFuncEnv);

  const [compiledDefinition, externalReferencedStreamIds] = compileTreeDefinition(definition, streamEnv, funcEnv);

  if (externalReferencedStreamIds.size > 0) {
    throw new Error();
  }

  return compiledDefinition;
}
