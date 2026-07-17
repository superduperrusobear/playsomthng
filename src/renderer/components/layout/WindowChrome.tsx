import { send } from "../../lib/ipc";
import { IpcChannel } from "@shared/schemas";

/** Keep in sync with `pt-*` under the shell in App.tsx */
const CHROME_H = "h-8";

/**
 * Frameless window controls overlaid on content (no reserved strip).
 * Drag the top area (left of buttons) to move; double-click to maximize.
 */
export function WindowChrome() {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 z-[200] flex ${CHROME_H} items-stretch justify-end`}
    >
      <div
        className="drag-region pointer-events-auto flex min-h-0 flex-1"
        onDoubleClick={() => send(IpcChannel.APP_MAXIMIZE)}
        aria-hidden
      />
      <div className="no-drag pointer-events-auto flex items-center gap-0.5 pr-1.5">
        <button
          type="button"
          className="flex h-9 w-11 items-center justify-center rounded-md text-[#6a6a6a] transition hover:bg-white/[0.07] hover:text-[#c8c8c8]"
          aria-label="Minimize"
          onClick={() => send(IpcChannel.APP_MINIMIZE)}
        >
          <MinIcon />
        </button>
        <button
          type="button"
          className="flex h-9 w-11 items-center justify-center rounded-md text-[#6a6a6a] transition hover:bg-white/[0.07] hover:text-[#c8c8c8]"
          aria-label="Maximize"
          onClick={() => send(IpcChannel.APP_MAXIMIZE)}
        >
          <MaxIcon />
        </button>
        <button
          type="button"
          className="flex h-9 w-11 items-center justify-center rounded-md text-[#6a6a6a] transition hover:bg-red-500/15 hover:text-red-400"
          aria-label="Close"
          onClick={() => send(IpcChannel.APP_CLOSE)}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

function MinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M1 5h8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function MaxIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="7" height="7" rx="0.5" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}
