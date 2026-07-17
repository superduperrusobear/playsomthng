import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Transparent shell so the global app background (Vanta / depth field) shows through.
 * `fillHeight`: stretch to fill parent height (settings home); rows inside can use flex-1.
 */
export function SettingsSurface({
  children,
  className,
  fillHeight = false,
}: {
  children: ReactNode;
  className?: string;
  fillHeight?: boolean;
}) {
  return (
    <div className={cn("w-full min-w-0 bg-transparent", fillHeight && "flex min-h-0 flex-1 flex-col", className)}>
      <div
        className={cn(
          "divide-y divide-white/[0.06]",
          fillHeight && "flex min-h-0 flex-1 flex-col"
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SettingsSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-5 py-4 first:pt-5 last:pb-5", className)}>{children}</div>
  );
}
