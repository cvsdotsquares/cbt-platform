'use client';

import * as React from 'react';
import type { ToastProps } from '@radix-ui/react-toast';

const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 4000;

type ToasterToast = ToastProps & {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'success';
};

type Action =
  | { type: 'ADD_TOAST'; toast: ToasterToast }
  | { type: 'UPDATE_TOAST'; toast: Partial<ToasterToast> }
  | { type: 'DISMISS_TOAST'; toastId?: string }
  | { type: 'REMOVE_TOAST'; toastId?: string };

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const listeners: Array<(state: State) => void> = [];
let memoryState: State = { toasts: [] };

interface State {
  toasts: ToasterToast[];
}

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => listener(memoryState));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_TOAST':
      return { ...state, toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) };
    case 'DISMISS_TOAST':
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toastId || action.toastId === undefined ? { ...t, open: false } : t,
        ),
      };
    case 'REMOVE_TOAST':
      return {
        ...state,
        toasts: action.toastId === undefined ? [] : state.toasts.filter((t) => t.id !== action.toastId),
      };
    default:
      return state;
  }
}

function withFullStop(text: string | undefined, apply: boolean): string | undefined {
  if (!apply || text == null || text === '') return text;
  const trimmed = text.trimEnd();
  if (!trimmed || /[.!?…]$/.test(trimmed)) return text;
  return `${trimmed}.`;
}

function isErrorToastTitle(title?: string): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  return (
    t.startsWith('could not') ||
    t.startsWith('cannot ') ||
    t.includes(' failed') ||
    t.startsWith('failed') ||
    t.startsWith('unable ') ||
    t.startsWith('error') ||
    t.startsWith('upload failed') ||
    t.startsWith('save failed') ||
    t.startsWith('delete failed') ||
    t.startsWith('cleanup failed') ||
    t.startsWith('action failed') ||
    t.startsWith('remove failed') ||
    t.startsWith('update failed') ||
    t.startsWith('copy failed') ||
    t.startsWith('export failed') ||
    t.startsWith('publish failed') ||
    t.startsWith('re-index failed') ||
    t.startsWith('intervention failed') ||
    t.startsWith('generation failed') ||
    t.startsWith('rank calculation failed')
  );
}

function toast({ title, description, variant }: Omit<ToasterToast, 'id'>) {
  const infoLike = variant === 'default' || variant === undefined;
  const successLike = variant === 'success';
  const warningLike = variant === 'destructive' && !isErrorToastTitle(title);
  const punctuate = infoLike || successLike || warningLike;
  const finalTitle = withFullStop(title, punctuate);
  const finalDescription = withFullStop(description, punctuate);
  const id = genId();
  dispatch({
    type: 'ADD_TOAST',
    toast: { id, title: finalTitle, description: finalDescription, variant, open: true },
  });
  const timeout = setTimeout(() => {
    dispatch({ type: 'DISMISS_TOAST', toastId: id });
    setTimeout(() => dispatch({ type: 'REMOVE_TOAST', toastId: id }), 300);
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(id, timeout);
  return { id, dismiss: () => dispatch({ type: 'DISMISS_TOAST', toastId: id }) };
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState);
  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);
  return { ...state, toast, dismiss: (toastId?: string) => dispatch({ type: 'DISMISS_TOAST', toastId }) };
}

export { useToast, toast };
