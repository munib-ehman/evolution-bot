import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  /** Called once when the primary avatar fails and we switch to the fallback. */
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
}

/**
 * Catches failures from loading the Ready Player Me GLB (bad URL, network,
 * decode error) and renders the procedural fallback avatar instead, so the 3D
 * scene never crashes the whole app.
 */
export class AvatarErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.warn("[avatar] Falling back to procedural avatar:", error);
    this.props.onError?.(error);
  }

  render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
