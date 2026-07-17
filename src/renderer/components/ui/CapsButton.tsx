import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  variant?: "default" | "muted";
};

/** Caps text button. Underline and lift appear on hover only. */
export function CapsButton({
  label,
  variant = "default",
  className,
  disabled,
  type = "button",
  ...props
}: Props) {
  const muted = variant === "muted";

  return (
    <button
      type={type}
      disabled={disabled}
      className={cn("group px-2 py-2.5 disabled:cursor-not-allowed disabled:opacity-40", className)}
      {...props}
    >
      <span
        className={cn(
          "relative inline-block text-[12px] font-medium uppercase tracking-[0.12em]",
          "transition-[transform,color] duration-200 group-hover:-translate-y-0.5",
          muted ? "text-[#666] group-hover:text-[#aaa]" : "text-[#c8c8c8] group-hover:text-white",
        )}
      >
        {label}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -bottom-1 left-0 right-0 h-px origin-center scale-x-0 bg-current",
            "opacity-0 transition-[transform,opacity] duration-200",
            "group-hover:scale-x-100 group-hover:opacity-60 group-disabled:scale-x-0",
          )}
        />
      </span>
    </button>
  );
}
