import React, { useState, useEffect, useRef } from 'react';
import './ExpressionChooser.css';
import { generateStreamId, Node, FunctionDefinitionNode, NodeKind, isStreamExpressionNode, SignatureStreamParameterNode, ApplicationNode, SignatureFunctionParameterNode, generateFunctionId, StreamID, ArrayLiteralNode, UndefinedLiteralNode } from './Tree';
import { fuzzy_match } from './vendor/fts_fuzzy_match';
import { EnvironmentLookups, StreamDefinition } from './EditReducer';

interface UndefinedChoice {
  readonly type: 'undefined';
}

interface NumberChoice {
  readonly type: 'number';
  readonly value: number;
}

interface StreamRefChoice {
  readonly type: 'streamref';
  readonly sid: StreamID;
  readonly desc: string;
}

interface StreamIndChoice {
  readonly type: 'streamind';
  readonly text: string;
}

interface AppChoice {
  readonly type: 'app';
  readonly funcDefNode: FunctionDefinitionNode;
}

type Choice = UndefinedChoice | StreamRefChoice | StreamIndChoice | NumberChoice | AppChoice;

interface SearchResult<T> {
  score: number;
  formattedStr: string;
  name: string;
  data: T;
}
function fuzzySearch<T>(query: string, items: ReadonlyArray<[string, T]>): Array<SearchResult<T>> {
  const results: Array<SearchResult<T>> = [];

  for (const [name, data] of items) {
    const [hit, score, formattedStr] = fuzzy_match(query, name);
    if (typeof score !== 'number') {
      throw new Error();
    }
    if (typeof formattedStr !== 'string') {
      throw new Error();
    }
    if (hit) {
      results.push({
        score,
        formattedStr,
        name,
        data,
      });
    }
  }
  if (query !== '') { // TODO: this is a hack, if query is empty, scoring is dumb
    results.sort((a, b) => (b.score - a.score));
  }
  return results;
}

const FLOAT_REGEX = /^[-+]?(?:\d*\.?\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?$/;

interface ChoiceProps {
  choice: Choice;
}
function Choice({ choice }: ChoiceProps) {
  switch (choice.type) {
    case 'undefined':
      return <em>undefined</em>

    case 'number':
      return <span>{choice.value}</span>

    case 'streamref':
      return <span><em>S</em> {choice.desc} <small>(id {choice.sid})</small></span>

    case 'streamind':
      return <span><em>I</em> {choice.text}</span>

    case 'app':
      return <span><em>F</em> {choice.funcDefNode.desc && choice.funcDefNode.desc.text} {/*choice.node.signature.parameters.map(param => (param.name.startsWith('_') ? '\u25A1' : param.name)).join(', ')*/}</span>

    default:
      throw new Error();
  }
}

interface DropdownState {
  choices: ReadonlyArray<Choice>;
  index: number;
}

const ExpressionChooser: React.FC<{initNode: Node, envLookups: EnvironmentLookups, dispatch: (action: any) => void}> = ({ initNode, envLookups, dispatch }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current && inputRef.current.select();
  }, []);

  const selectedListElem = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selectedListElem.current) {
      selectedListElem.current.scrollIntoView({block: 'nearest', inline: 'nearest'});
    }
  });

  const [text, setText] = useState(() => {
    // Initialize text based on node
    switch (initNode.kind) {
      case NodeKind.UndefinedLiteral:
        return '';

      case NodeKind.NumberLiteral:
        return initNode.val.toString();

      case NodeKind.StreamReference:
      case NodeKind.Application:
        return ''; // Don't prefill with text

      default:
        throw new Error();
    }
  });

  const generateChoices = (text: string): ReadonlyArray<Choice> => {
    const choices: Array<Choice> = [];

    // If there is no text, put this first as a sort of default
    if (text === '') {
      choices.push({
        type: 'undefined',
      });
    }

    if (FLOAT_REGEX.test(text)) {
      choices.push({
        type: 'number',
        value: Number(text),
      });
    }

    const nearestDef = envLookups.nodeToNearestTreeDef.get(initNode);
    if (!nearestDef) {
      throw new Error();
    }
    const streamEnv = envLookups.treeDefToStreamEnv.get(nearestDef);
    if (!streamEnv) {
      throw new Error();
    }
    const functionEnv = envLookups.treeDefToFunctionEnv.get(nearestDef);
    if (!functionEnv) {
      throw new Error();
    }

    const namedStreams: Array<[string, StreamDefinition]> = [];
    streamEnv.forEach((sdef, ) => {
      if (sdef.desc) {
        namedStreams.push([sdef.desc.text, sdef]);
      }
    });

    const streamSearchResults = fuzzySearch(text, namedStreams);
    for (const result of streamSearchResults) {
      choices.push({
        type: 'streamref',
        sid: result.data.sid,
        desc: result.name,
      });
    }

    const namedFunctions: Array<[string, FunctionDefinitionNode]> = [];
    functionEnv.forEach((defNode, ) => {
      if (defNode.desc) {
        namedFunctions.push([defNode.desc.text, defNode]);
      }
    });
    const functionSearchResults = fuzzySearch(text, namedFunctions);
    for (const result of functionSearchResults) {
      choices.push({
        type: 'app',
        funcDefNode: result.data,
      });
    }

    if (text.trim() !== '') {
      choices.push({
        type: 'streamind',
        text: text.trim(),
      });
    }

    if (choices.length === 0) {
      choices.push({
        type: 'undefined',
      });
    }

    return choices;
  }

  // Update the expression node to reflect the current choice
  const realizeChoice = (state: DropdownState): void => {
    const choice = state.choices[state.index];

    if (isStreamExpressionNode(initNode)) {
      let newNode: Node;
      switch (choice.type) {
        case 'undefined':
          newNode = {
            kind: NodeKind.UndefinedLiteral,
            sid: generateStreamId(),
          }
          break;

        case 'number':
          newNode = {
            kind: NodeKind.NumberLiteral,
            sid: generateStreamId(),
            val: choice.value,
          }
          break;

        case 'streamref':
          newNode = {
            kind: NodeKind.StreamReference,
            ref: choice.sid,
          };
          break;

        case 'streamind':
          newNode = {
            kind: NodeKind.StreamIndirection,
            sid: generateStreamId(),
            desc: {kind: NodeKind.Description, text: choice.text},
            expr: {
              kind: NodeKind.UndefinedLiteral,
              sid: generateStreamId(),
            },
          };
          break;

        case 'app':
          const n: ApplicationNode = {
            kind: NodeKind.Application,
            sids: choice.funcDefNode.sig.yields.map(() => generateStreamId()),
            func: {
              kind: NodeKind.FunctionReference,
              ref: choice.funcDefNode.fid,
            },
            sargs: choice.funcDefNode.sig.streamParams.map((param: SignatureStreamParameterNode) => ({
              kind: NodeKind.UndefinedLiteral,
              desc: null,
              sid: generateStreamId(),
            })),
            fargs: choice.funcDefNode.sig.funcParams.map((param: SignatureFunctionParameterNode) => {
              return {
                kind: NodeKind.TreeFunctionDefinition,
                fid: generateFunctionId(),
                sig: param.sig,
                spids: param.sig.streamParams.map(() => generateStreamId()),
                fpids: param.sig.funcParams.map(() => generateFunctionId()),
                body: {
                  kind: NodeKind.TreeFunctionBody,
                  exprs: param.sig.yields.map((y, idx) => ({
                    kind: NodeKind.YieldExpression,
                    idx,
                    expr: {
                      kind: NodeKind.UndefinedLiteral,
                      desc: null,
                      sid: generateStreamId(),
                    },
                  })),
                },
              }
            }),
          }
          newNode = n;
          break;

        default:
          throw new Error();
      }

      dispatch({type: 'UPDATE_EDITING_NODE', newNode});
    }
  };

  const recomputeDropdownChoices = (text: string): DropdownState => {
    const newState: DropdownState = {
      choices: generateChoices(text),
      index: 0, // reset index to 0
    };
    realizeChoice(newState);
    return newState;
  };

  const adjustDropdownIndex = (amount: number): void => {
    setDropdownState(oldState => {
      const newState = {
        ...oldState,
        index: (oldState.index + amount + oldState.choices.length) % oldState.choices.length,
      };
      realizeChoice(newState);
      return newState;
    });
  };

  const [dropdownState, setDropdownState] = useState<DropdownState>(() => recomputeDropdownChoices(text));

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;

    if (newText === '[') {
      // This is a special case, we bypass the normal dropdown/choice stuff
      const initElemNode: UndefinedLiteralNode = {
        kind: NodeKind.UndefinedLiteral,
        sid: generateStreamId(),
      };
      const newArrNode: ArrayLiteralNode = {
        kind: NodeKind.ArrayLiteral,
        sid: generateStreamId(),
        elems: [initElemNode],
      };
      dispatch({type: 'UPDATE_EDITING_NODE', newNode: newArrNode});
      dispatch({type: 'TOGGLE_EDIT'});
      dispatch({type: 'SET_SELECTED_NODE', newNode: initElemNode});
      dispatch({type: 'TOGGLE_EDIT'});
    } else {
      setText(newText);
      setDropdownState(recomputeDropdownChoices(newText));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault(); // we don't want the default behavior of moving the cursor
        adjustDropdownIndex(-1);
        break;

      case 'ArrowDown':
        e.preventDefault(); // we don't want the default behavior of moving the cursor
        adjustDropdownIndex(1);
        break;

      default:
        // do nothing
        break;
    }
  };

  return (
    <div>
      <input className="ExpressionChooser-input" value={text} onChange={onChange} onKeyDown={onKeyDown} ref={inputRef} autoFocus />
      <ul className="ExpressionChooser-dropdown">
        {dropdownState.choices.map((choice, idx) =>
          <li key={idx} className={(idx === dropdownState.index) ? 'ExpressionChooser-dropdown-selected' : ''} ref={(idx === dropdownState.index) ? selectedListElem : undefined}><Choice choice={choice} /></li>
        )}
      </ul>
    </div>
  );
}
export default ExpressionChooser;
