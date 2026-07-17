import type { AppErrorCode } from "@shared/schemas";

const CODE_LABEL: Partial<Record<AppErrorCode, string>> = {
  NETWORK: "Network",
  STORE_UNAVAILABLE: "Store unavailable",
  LIBRARY_UNAVAILABLE: "Library unavailable",
  AUTH: "Authentication",
  VALIDATION: "Validation",
  UNKNOWN: "Unknown",
};

type Props = {
  code?: AppErrorCode;
  message: string;
  detail?: string;
};

export function UnknownErrorPanel({ code = "UNKNOWN", message, detail }: Props) {
  return (
    <div
      className="rounded-lg border border-[#333] bg-[#222] px-4 py-3 text-center"
      role="alert"
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-[#666]">
        {CODE_LABEL[code] ?? code}
      </p>
      <p className="mt-2 text-[13px] text-[#c8c8c8]">{message}</p>
      {detail && <p className="mt-1.5 text-[11px] text-[#666]">{detail}</p>}
    </div>
  );
}
