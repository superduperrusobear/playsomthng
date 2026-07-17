import type { ReactNode } from "react";

/** Shared shell for main app pages — padding; canvas is the global layer in App.tsx. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-hidden bg-transparent px-6 pb-6 pt-5 sm:px-8">
      {children}
    </div>
  );
}
