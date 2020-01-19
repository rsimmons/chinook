import React, { useReducer, useRef, useEffect, useMemo } from 'react';
import { HotKeys, ObserveKeys } from "react-hotkeys";
import { initialState, reducer, computeEnvironmentLookups, computeParentLookup, getReferentOfSelected } from './EditReducer';
import { StoragePanel } from './StoragePanel';
import './Editor.css';
import { TreeFunctionDefinitionView, TreeViewContextProvider, TreeViewContextData } from './TreeView';
import { Node, TreeFunctionDefinitionNode } from './Tree';
import { ProgramInfo } from './State';

const keyMap = {
  TOGGLE_EDIT: 'enter',
  ABORT_EDIT: 'escape',

  INSERT_BEFORE: 'shift+up',
  INSERT_AFTER: 'shift+down',

  DELETE_SUBTREE: 'backspace',

  EDIT_NEXT_UNDEFINED: 'tab',

  UNDO: 'command+z',

  CUT: 'command+x',
  PASTE: 'command+v',
};

// These are "normal" character keys that we use as commands. We identify them because we don't want
// them to begin a "overwrite edit".
const COMMAND_CHARS = new Set([
  '=',
  ',',
]);

// By default, if an input element is focused, keys will be ignored. But we want some
// of them to be processed even when an input is focused, and those ones are listed here.
// Note that react-hotkeys only lets us list the individual keys here not "combinations"
// as we would want.
const CATCH_IN_INPUTS = [
  'Enter',
  'Shift',
  'Escape',
  'Tab',
  '=',
  ',',
];

const Editor: React.FC<{autoFocus: boolean}> = ({ autoFocus }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const editorElem = useRef<HTMLDivElement>(null);

  const firstRender = useRef(true);
  useEffect(() => {
    firstRender.current = false;
  }, []);

  // TODO: memoize generation of this
  const handlers: {[key: string]: (keyEvent?: KeyboardEvent | undefined) => void} = {};
  for (const k of Object.keys(keyMap)) {
    handlers[k] = (() => (e: KeyboardEvent | undefined) => {
      if (e) {
        e.preventDefault(); // If we attempted to handle this, prevent default (scrolling window, entering character, etc.)
      }
      dispatch({type: k});
    })(); // IIFE to bind k
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // TODO: This is not a robust check, but the spec is complicated
    // (https://www.w3.org/TR/uievents-key/#keys-whitespace)
    if (((e.target as Element).tagName.toLowerCase() !== 'input') && ([...e.key].length === 1) && !e.altKey && !e.ctrlKey && !e.metaKey && !COMMAND_CHARS.has(e.key)) {
      // Interestingly, the key here will still end up going into the input element, which is what we want.
      dispatch({type: 'BEGIN_EDIT'});
    }
  };

  const handleChangeProgramName = (newName: string) => {
    dispatch({type: 'SET_PROGRAM_NAME', newName});
  };

  const handleLoadProgram = (info: ProgramInfo, mainDefinition: TreeFunctionDefinitionNode) => {
    dispatch({type: 'LOAD_PROGRAM', newProgram: {info: info, mainDefinition}});
  };

  const displayedSelTree = state.editing ? state.editing.curSelTree : state.stableSelTree;
  const editing = !!state.editing;

  const envLookups = useMemo(() => computeEnvironmentLookups(displayedSelTree.mainDefinition, state.nativeFunctions), [displayedSelTree.mainDefinition, state.nativeFunctions]);
  const parentLookup = useMemo(() => computeParentLookup(displayedSelTree.mainDefinition), [displayedSelTree.mainDefinition]);

  const referentNode = getReferentOfSelected(displayedSelTree, envLookups);

  const treeViewCtxData: TreeViewContextData = {
    markedNodes: {
      selected: displayedSelTree.selectedNode,
      referent: referentNode,
    },
    editing,
    compileError: state.editing ? state.editing.compileError : undefined,
    // clipboardTopNode: (state.clipboardStack.length > 0) ? state.derivedLookups.streamIdToNode!.get(state.clipboardStack[state.clipboardStack.length-1].streamId) : null,
    // clipboardRestNodes: state.clipboardStack.slice(0, -1).map(frame => state.derivedLookups.streamIdToNode!.get(frame.streamId)),
    envLookups,
    parentLookup,
    dispatch,
    onSelectNode: (node: Node) => {
      dispatch({
        type: 'SET_SELECTED_NODE',
        newNode: node,
      });
    },
    focusSelected: !editing && (autoFocus || !firstRender.current),
  };

  return (
    <div className="Editor">
      <div className="Editor-storage-panel-container Editor-panel">
        <StoragePanel programInfo={state.programInfo} mainDefinition={state.stableSelTree.mainDefinition} onChangeName={handleChangeProgramName} onLoadProgram={handleLoadProgram} />
      </div>
      <HotKeys keyMap={keyMap} handlers={handlers}>
        <ObserveKeys only={CATCH_IN_INPUTS}>
          <div className="Editor-workspace" onKeyDown={onKeyDown} tabIndex={0} ref={editorElem}>
            <TreeViewContextProvider value={treeViewCtxData}>
              <TreeFunctionDefinitionView node={displayedSelTree.mainDefinition} />
            </TreeViewContextProvider>
          </div>
        </ObserveKeys>
      </HotKeys>
    </div>
  );
}
export default Editor;
