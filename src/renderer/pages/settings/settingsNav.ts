import accountIcon from "../../assets/icons/account-settings-svgrepo-com.svg";
import storageIcon from "../../assets/icons/storage-1-svgrepo-com.svg";
import computerIcon from "../../assets/icons/computer-svgrepo-com.svg";
import scriptIcon from "../../assets/icons/script-svgrepo-com.svg";
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
    description: "CPU, RAM, drives, displays, and OS details.",
    icon: computerIcon,
  },
  {
    path: "/settings/server",
    label: "Server",
    description: "Library server URL — connect to your Proxmox machine.",
    icon: serverIcon,
  },
  {
    path: "/settings/scripts",
    label: "Scripts",
    description: "One-click helpers and troubleshooting shortcuts.",
    icon: scriptIcon,
  },
  {
    path: "/settings/admin",
    label: "Admin panel",
    description: "Sources, import editor, metadata, IGDB, and publish controls.",
    icon: adminIcon,
    adminOnly: true,
  },
];

export function settingsMetaForPath(pathname: string): SettingsLinkMeta | undefined {
  return SETTINGS_LINKS.find((l) => l.path === pathname);
}
