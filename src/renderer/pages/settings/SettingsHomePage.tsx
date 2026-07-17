import { Link } from "react-router-dom";
import { useLogout } from "../../hooks/useAuth";
import { SettingsSection, SettingsSurface } from "../../components/layout/SettingsPanel";
import { cn } from "../../lib/cn";
import { SETTINGS_LINKS } from "./settingsNav";
import { useAuthStore } from "../../store/auth.store";
import logoutIcon from "../../assets/icons/logout-svgrepo-com.svg";

const iconClass = "h-5 w-5 shrink-0 object-contain invert opacity-75";

const rowBase =
  "flex min-h-[clamp(3.25rem,6vh,4.5rem)] w-full flex-1 items-center gap-3 px-[clamp(1rem,4vw,1.75rem)] py-2 text-left transition-colors hover:bg-black/10";

export function SettingsHomePage() {
  const logout = useLogout();
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  const links = SETTINGS_LINKS.filter((l) => !l.adminOnly || isAdmin);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SettingsSurface fillHeight className="min-h-0 flex-1">
        <SettingsSection className="flex min-h-0 flex-1 flex-col !p-0">
          <nav
            className="flex min-h-0 flex-1 flex-col divide-y divide-[#2c2c2c]/90 pt-5"
            aria-label="Settings sections"
          >
            {links.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={cn(rowBase, "text-inherit no-underline")}
              >
                <img src={item.icon} alt="" className={iconClass} draggable={false} />
                <div className="min-w-0 flex-1">
                  <div className="text-[clamp(10px,1.35vmin,12px)] font-medium uppercase tracking-[0.16em] text-[#d0d0d0]">
                    {item.label}
                  </div>
                  <p className="mt-0.5 text-[clamp(11px,1.2vmin,12px)] font-normal normal-case leading-snug tracking-normal text-[#7a7a7a]">
                    {item.description}
                  </p>
                </div>
              </Link>
            ))}

            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className={cn(
                rowBase,
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              <img src={logoutIcon} alt="" className={iconClass} draggable={false} />
              <div className="min-w-0 flex-1">
                <div className="text-[clamp(10px,1.35vmin,12px)] font-medium uppercase tracking-[0.16em] text-[#d0d0d0]">
                  {logout.isPending ? "Signing out…" : "Logout"}
                </div>
                <p className="mt-0.5 text-[clamp(11px,1.2vmin,12px)] font-normal normal-case leading-snug tracking-normal text-[#7a7a7a]">
                  {logout.isPending ? "Please wait." : "Sign out of this session."}
                </p>
              </div>
            </button>
          </nav>
        </SettingsSection>
      </SettingsSurface>
    </div>
  );
}
