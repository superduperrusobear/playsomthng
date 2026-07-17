import { useLocation } from "react-router-dom";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { SettingsBackLink } from "./SettingsBackLink";
import { settingsMetaForPath } from "./settingsNav";

const iconClass = "h-6 w-6 shrink-0 object-contain invert opacity-75";

export function SettingsPlaceholderPage() {
  const { pathname } = useLocation();
  const meta = settingsMetaForPath(pathname);

  return (
    <div className="min-h-0 flex-1 space-y-0 overflow-y-auto">
      <SettingsBackLink />
      <SettingsSurface>
        <SettingsSection>
          {meta ? (
            <div className="flex gap-4">
              <img src={meta.icon} alt="" className={iconClass} draggable={false} />
              <div className="min-w-0 flex-1">
                <h1 className="text-[13px] font-medium uppercase tracking-[0.14em] text-[#d0d0d0]">
                  {meta.label}
                </h1>
                <p className="mt-1 text-[12px] leading-relaxed text-[#7a7a7a]">{meta.description}</p>
                <p className="mt-4 text-[13px] leading-relaxed text-[#9a9a9a]">
                  This section is not wired up yet — you’ll configure it here soon.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-[#b8b8b8]">This section is empty for now.</p>
          )}
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
