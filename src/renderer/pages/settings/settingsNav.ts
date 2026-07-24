import accountIcon from "../../assets/icons/account-settings-svgrepo-com.svg";
import storageIcon from "../../assets/icons/storage-1-svgrepo-com.svg";
import computerIcon from "../../assets/icons/computer-svgrepo-com.svg";
import adminIcon from "../../assets/icons/back-backward-development-svgrepo-com.svg";
import serverIcon from "../../assets/icons/settings-svgrepo-com.svg";

export type SettingsLinkMeta = {
  path: string;
  label: string;
  icon: string;
  /** When true, only shown to users with role `admin`. */
  adminOnly?: boolean;
};

/** Ordered by importance on the settings home screen. */
export const SETTINGS_LINKS: SettingsLinkMeta[] = [
  {
    path: "/settings/account",
    label: "Account",
    icon: accountIcon,
  },
  {
    path: "/settings/storage",
    label: "Storage",
    icon: storageIcon,
  },
  {
    path: "/settings/system",
    label: "System info",
    icon: computerIcon,
  },
  {
    path: "/settings/server",
    label: "Server",
    icon: serverIcon,
  },
  {
    path: "/settings/admin",
    label: "Admin panel",
    icon: adminIcon,
    adminOnly: true,
  },
];

export function settingsMetaForPath(pathname: string): SettingsLinkMeta | undefined {
  return SETTINGS_LINKS.find((l) => l.path === pathname);
}
