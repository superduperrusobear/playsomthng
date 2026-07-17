import { Link } from "react-router-dom";

export function SettingsBackLink() {
  return (
    <div className="mb-4 px-5">
      <Link
        to="/settings"
        className="inline-block text-[11px] font-medium uppercase tracking-[0.2em] text-[#7a7a7a] transition-colors hover:text-[#b8b8b8]"
      >
        ← Settings
      </Link>
    </div>
  );
}
