import { useCallback, useReducer } from "react";

const MAX_HISTORY = 200;

type State = { past: string[]; present: string; future: string[]; lastEdit: number };

type Action =
  | { type: "set"; value: string; now: number; checkpoint: boolean; groupMs: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; value: string };

export function historyReducer(state: State, action: Action): State {
  switch (action.type) {
    case "set": {
      if (action.value === state.present) return state;
      const grouped = !action.checkpoint && state.past.length > 0 && action.now - state.lastEdit < action.groupMs;
      const past = grouped ? state.past : [...state.past, state.present].slice(-MAX_HISTORY);
      return { past, present: action.value, future: [], lastEdit: action.now };
    }
    case "undo": {
      if (state.past.length === 0) return state;
      return { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [...state.future, state.present], lastEdit: 0 };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      return { past: [...state.past, state.present], present: state.future[state.future.length - 1], future: state.future.slice(0, -1), lastEdit: 0 };
    }
    case "reset":
      return { past: [], present: action.value, future: [], lastEdit: 0 };
  }
}

/** Text state with undo/redo; edits made within `groupMs` of each other share one undo step. */
export function useUndoableText(initial: string, groupMs = 700) {
  const [state, dispatch] = useReducer(historyReducer, { past: [], present: initial, future: [], lastEdit: 0 });

  const set = useCallback(
    (value: string, options?: { checkpoint?: boolean }) => dispatch({ type: "set", value, now: Date.now(), checkpoint: options?.checkpoint ?? false, groupMs }),
    [groupMs],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const reset = useCallback((value: string) => dispatch({ type: "reset", value }), []);

  return { value: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
