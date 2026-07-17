/**
 * Shown at top of LibraryPage when there are paused/incomplete downloads.
 * Lets users resume all at once.
 */
import { useInstallList, useResumeInstall } from "../../hooks/useInstall";

export function ResumeBanner() {
  const { data: sessions = [] } = useInstallList();
  const resume = useResumeInstall();

  const paused = sessions.filter((s) => s.state === "paused" || s.state === "error");
  if (paused.length === 0) return null;

  const handleResumeAll = () => {
    paused.forEach((s) => resume.mutate(s.gameId));
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-[#2a3a5c] bg-[#111e36] px-4 py-2.5">
      <span className="text-[11px] text-[#7a9cf0]">
        {paused.length} download{paused.length !== 1 ? "s" : ""} paused
      </span>
      <button
        onClick={handleResumeAll}
        disabled={resume.isPending}
        className="text-[11px] font-semibold text-[#3a67f0] transition hover:text-[#6090ff] disabled:opacity-40"
      >
        Resume all
      </button>
    </div>
  );
}
