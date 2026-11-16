"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback: (error: Error) => ReactNode;
  /** Changing this value clears a previous error, so a fixed input gets another try. */
  resetKey?: unknown;
  onError?: (error: Error) => void;
};

type State = { error: Error | null; resetKey: unknown };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  render() {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}
