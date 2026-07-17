import type { ReactNode } from "react";

export function GameDetailSidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-[min(380px,92vw)] flex-col border-l border-white/10 bg-[#0c0c0d]/98 backdrop-blur-md">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="font-title text-[12px] uppercase tracking-[0.2em] text-white/90">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[18px] leading-none text-[#888] transition hover:bg-white/10 hover:text-white"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
    </div>
  );
}
