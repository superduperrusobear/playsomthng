import { NavLink } from "react-router-dom";
import { cn } from "../../lib/cn";
import { useLibraryMode } from "../../hooks/useLibraryMode";
import storeIcon from "../../assets/icons/store-svgrepo-com.svg";
import libraryIcon from "../../assets/icons/library-svgrepo-com.svg";
import downloadIcon from "../../assets/icons/download-svgrepo-com.svg";
import settingsIcon from "../../assets/icons/settings-1390-svgrepo-com.svg";

const items = [
  { to: "/store", icon: storeIcon, label: "Store", offlineHidden: true },
  { to: "/library", icon: libraryIcon, label: "Library", offlineHidden: false },
  { to: "/downloads", icon: downloadIcon, label: "Downloads", offlineHidden: false },
  { to: "/settings", icon: settingsIcon, label: "Settings", offlineHidden: false },
] as const;

export function Dock() {
  const { isRemote } = useLibraryMode();

  return (
    <nav
      className="relative flex shrink-0 items-center justify-center bg-transparent px-8 pb-4 pt-5"
      aria-label="Main"
    >
      <div className="flex items-center justify-center gap-14">
        {items.map(({ to, icon, label, offlineHidden }, i) => {
          if (!isRemote && offlineHidden) {
            return (
              <div
                key={to}
                title="Connect to a server in Settings to use the Store"
                style={{ animationDelay: `${i * 0.35}s` }}
                className="dock-breathe relative flex h-[4.25rem] w-[4.25rem] cursor-not-allowed items-center justify-center rounded-2xl opacity-15"
              >
                <img
                  src={icon}
                  alt=""
                  className="h-10 w-10 object-contain invert"
                  draggable={false}
                />
              </div>
            );
          }

          return (
            <NavLink
              key={to}
              to={to}
              end={to === "/store"}
              title={label}
              aria-label={label}
              style={{ animationDelay: `${i * 0.35}s` }}
              className={({ isActive }) =>
                cn(
                  "dock-breathe group relative flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-2xl transition-[opacity,transform] duration-200 will-change-transform",
                  isActive ? "opacity-100" : "opacity-40 hover:opacity-75"
                )
              }
            >
              {({ isActive }) => (
                <img
                  src={icon}
                  alt=""
                  className={cn(
                    "h-10 w-10 object-contain invert transition-transform duration-200",
                    isActive ? "scale-105 opacity-100" : "opacity-85 group-hover:scale-105"
                  )}
                  draggable={false}
                />
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
