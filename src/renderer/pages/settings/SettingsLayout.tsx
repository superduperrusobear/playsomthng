import { Outlet } from "react-router-dom";

/** Full-height canvas; outlet fills height so settings home can stretch rows with the window. */
export function SettingsLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden pt-5 pb-6 pl-6 pr-8 [scrollbar-gutter:stable]">
        <Outlet />
      </div>
    </div>
  );
}
