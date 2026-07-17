import { useRef, FormEvent } from "react";
import { CapsButton } from "../ui/CapsButton";
import { cn } from "../../lib/cn";
import appLogo from "../../assets/app-logo.svg";

export type OnboardStep = "user" | "code" | "avatar";

const inputClass = (invalid?: boolean) =>
  cn(
    "h-10 w-full border bg-[#222] px-3 text-center text-[13px] text-[#e0e0e0]",
    "outline-none transition-colors placeholder-[#444]",
    invalid ? "border-[#5c3d3d]" : "border-[#333] focus:border-[#555] focus:bg-[#262626]",
  );

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[320px]">
      <div className="mx-auto mb-8 flex h-[88px] w-[88px] items-center justify-center">
        <img src={appLogo} alt="" className="h-full w-full object-contain opacity-95" draggable={false} />
      </div>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-center text-[10px] font-medium uppercase tracking-[0.15em] text-[#7a7a7a]">
      {children}
    </label>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return <p className="text-center text-[11px] text-[#a07070]">{children}</p>;
}

/** Step 2 — the invite code. Typed once; consumed on enrollment, never asked again on this machine. */
export function CodeStep({
  value,
  onChange,
  onSubmit,
  onBack,
  busy,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  busy: boolean;
  error: string | null;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !busy) onSubmit();
  };

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <FieldLabel>Invite code</FieldLabel>
          <input
            type="text"
            name="invite-code"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(inputClass(!!error), "font-mono")}
          />
        </div>

        {error && <ErrorLine>{error}</ErrorLine>}

        <div className="flex flex-col items-center gap-1">
          <CapsButton
            type="submit"
            label={busy ? "Checking…" : "Continue"}
            disabled={busy || !value.trim()}
          />
          <CapsButton label="Back" variant="muted" disabled={busy} onClick={onBack} />
        </div>
      </form>
    </Shell>
  );
}

/** Step 1 — username. Known machines go straight in; new machines continue to the code. */
export function UserStep({
  value,
  onChange,
  onSubmit,
  onBack,
  busy,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  busy: boolean;
  error: string | null;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && !busy) onSubmit();
  };

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <FieldLabel>Username</FieldLabel>
          <input
            type="text"
            name="username"
            autoComplete="username"
            maxLength={32}
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass(!!error)}
          />
        </div>

        {error && <ErrorLine>{error}</ErrorLine>}

        <div className="flex flex-col items-center gap-1">
          <CapsButton
            type="submit"
            label={busy ? "…" : "Continue"}
            disabled={busy || !value.trim()}
          />
          <CapsButton label="Back" variant="muted" disabled={busy} onClick={onBack} />
        </div>
      </form>
    </Shell>
  );
}

/** Step 3 — optional picture, then done. */
export function AvatarStep({
  onPick,
  onFinish,
  busy,
  error,
  previewUrl,
}: {
  onPick: (file: File) => void;
  onFinish: () => void;
  busy: boolean;
  error: string | null;
  previewUrl: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Shell>
      <div className="space-y-6">
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex h-24 w-24 items-center justify-center overflow-hidden rounded-2xl border border-[#333] bg-[#222]",
              "text-[10px] uppercase tracking-[0.15em] text-[#555] transition-colors",
              "hover:border-[#555] hover:text-[#888] disabled:opacity-50",
            )}
          >
            {previewUrl ? (
              <img src={previewUrl} alt="" className="h-full w-full object-cover" />
            ) : busy ? (
              "…"
            ) : (
              "Add photo"
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onPick(f);
            }}
          />
        </div>

        {error && <ErrorLine>{error}</ErrorLine>}

        <div className="flex justify-center">
          <CapsButton
            label={busy ? "…" : previewUrl ? "Finish" : "Skip"}
            variant={previewUrl ? "default" : "muted"}
            disabled={busy}
            onClick={onFinish}
          />
        </div>
      </div>
    </Shell>
  );
}
