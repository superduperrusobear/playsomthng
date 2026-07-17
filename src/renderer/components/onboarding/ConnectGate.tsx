import { useState } from "react";
import { useLibraryMode, probeServerUrl } from "../../hooks/useLibraryMode";
import { CapsButton } from "../ui/CapsButton";
import { cn } from "../../lib/cn";
import appLogo from "../../assets/app-logo.svg";

type Choice = null | "remote";

interface Props {
  /** Shown when reached from Settings rather than first run. */
  onCancel?: () => void;
}

export function ConnectGate({ onCancel }: Props) {
  const { useLocal, useRemote, serverUrl } = useLibraryMode();
  const [choice, setChoice] = useState<Choice>(null);
  const [url, setUrl] = useState(serverUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await probeServerUrl(url);
      if (status.serverState === "offline") {
        setError(status.error ?? "Could not reach that server.");
        return;
      }
      // Persist with the same scheme defaulting the probe used (https unless typed).
      const trimmed = url.trim().replace(/\/+$/, "");
      const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      await useRemote(withScheme);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach that server.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLocal() {
    if (busy) return;
    setBusy(true);
    try {
      await useLocal();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full max-w-[320px] flex-col items-center">
      <div className="mb-8 flex h-[88px] w-[88px] items-center justify-center">
        <img src={appLogo} alt="" className="h-full w-full object-contain opacity-95" draggable={false} />
      </div>

      {choice === null ? (
        <div className="flex w-full flex-col items-center text-center">
          <div className="flex w-full flex-col items-center gap-2">
            <CapsButton label="Connect to a server" disabled={busy} onClick={() => setChoice("remote")} />
            <CapsButton label="Skip" variant="muted" disabled={busy} onClick={() => void handleLocal()} />
          </div>

          <p className="mt-5 text-[10px] text-[#444]">Can be configured later</p>

          {onCancel && (
            <CapsButton label="Cancel" variant="muted" className="mt-4" onClick={onCancel} />
          )}
        </div>
      ) : (
        <div className="flex w-full flex-col items-center gap-5">
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleConnect();
            }}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder="games.example.com"
            className={cn(
              "h-10 w-full border bg-[#222] px-3 text-center font-mono text-[12px] text-[#e0e0e0]",
              "placeholder-[#444] outline-none transition-colors",
              error ? "border-[#5c3d3d]" : "border-[#333] focus:border-[#555] focus:bg-[#262626]",
            )}
          />

          {error && <p className="text-center text-[11px] text-[#a07070]">{error}</p>}

          <div className="flex flex-col items-center gap-1">
            <CapsButton
              label={busy ? "Checking…" : "Connect"}
              disabled={busy || !url.trim()}
              onClick={() => void handleConnect()}
            />
            <CapsButton
              label="Back"
              variant="muted"
              disabled={busy}
              onClick={() => {
                setChoice(null);
                setError(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
