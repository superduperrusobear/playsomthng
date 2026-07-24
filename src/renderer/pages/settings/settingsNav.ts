import accountIcon from "../../assets/icons/account-settings-svgrepo-com.svg";
import storageIcon from "../../assets/icons/storage-1-svgrepo-com.svg";
import computerIcon from "../../assets/icons/computer-svgrepo-com.svg";
import adminIcon from "../../assets/icons/back-backward-development-svgrepo-com.svg";
import serverIcon from "../../assets/icons/settings-svgrepo-com.svg";

export type SettingsLinkMeta = {
  path: string;
  label: string;
  description: string;
  icon: string;
  /** When true, only shown to users with role `admin`. */
  adminOnly?: boolean;
};

/** Ordered by importance; used on the home list and for placeholder subtitles. */
export const SETTINGS_LINKS: SettingsLinkMeta[] = [
  {
    path: "/settings/account",
    label: "Account",
    description: "Profile photo and name.",
    icon: accountIcon,
  },
  {
    path: "/settings/storage",
    label: "Storage",
    description: "Installed games, where they live, space used, and removal.",
    icon: storageIcon,
  },
  {
    path: "/settings/system",
    label: "System info",
    description: "A clean overview of this computer's hardware and operating system.",
    icon: computerIcon,
  },
  {
    path: "/settings/server",
    label: "Server",
    description: "Library server address and connection status.",
    icon: serverIcon,
  },
  {
    path: "/settings/admin",
    label: "Admin panel",
    description: "Publish games, manage users, and view logs.",
    icon: adminIcon,
    adminOnly: true,
  },
];

export function settingsMetaForPath(pathname: string): SettingsLinkMeta | undefined {
  return SETTINGS_LINKS.find((l) => l.path === pathname);
}
