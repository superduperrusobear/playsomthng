import { CapsButton } from "../ui/CapsButton";
import { invoke } from "../../lib/ipc";
import { IpcChannel } from "@shared/schemas";
import appLogo from "../../assets/app-logo.svg";

/** Shown when a configured server does not answer. Never on first run. */
export function ServerUnreachable({
  url,
  retrying,
  onRetry,
  onChangeServer,
}: {
  url: string;
  retrying: boolean;
  onRetry: () => void;
  onChangeServer: () => void;
}) {
  return (
    <div className="w-full max-w-[320px]">
      <div className="mx-auto mb-8 flex h-[88px] w-[88px] items-center justify-center">
        <img src={appLogo} alt="" className="h-full w-full object-contain opacity-95" draggable={false} />
      </div>

      <div className="flex flex-col items-center gap-5 text-center">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8a6a6a]">
            Can&apos;t reach the server
          </p>
          <p className="mt-1.5 break-all font-mono text-[10px] text-[#555]">{url}</p>
        </div>

        <div className="flex flex-col items-center gap-1">
          <CapsButton
            label={retrying ? "Checking…" : "Try again"}
            disabled={retrying}
            onClick={onRetry}
          />
          <CapsButton label="Change server" variant="muted" onClick={onChangeServer} />
          <CapsButton
            label="Open logs"
            variant="muted"
            onClick={() => void invoke(IpcChannel.APP_OPEN_LOGS)}
          />
        </div>
      </div>
    </div>
  );
}
