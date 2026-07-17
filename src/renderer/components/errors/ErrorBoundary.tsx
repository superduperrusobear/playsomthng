import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "../../lib/ipc";
import { IpcChannel } from "@shared/schemas";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const message = `${error.message}\n${info.componentStack ?? ""}`;
    invoke(IpcChannel.APP_LOG_ERROR, { message }).catch(() => {});
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[#141414] px-6 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#666]">
          Something went wrong
        </p>
        <p className="max-w-sm text-[13px] text-[#c8c8c8]">{error.message}</p>
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a09080] hover:text-white transition-colors"
          >
            Try again
          </button>
          <span className="text-[#2a2a2a]">|</span>
          <button
            type="button"
            onClick={() => invoke(IpcChannel.APP_OPEN_LOGS)}
            className="text-[10px] uppercase tracking-[0.12em] text-[#555] hover:text-[#999] transition-colors"
          >
            Open logs
          </button>
        </div>
      </div>
    );
  }
}
