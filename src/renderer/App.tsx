import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Dock } from "./components/layout/Dock";
import { StorePage } from "./pages/StorePage";
import { LibraryPage } from "./pages/LibraryPage";
import { DownloadsPage } from "./pages/DownloadsPage";
import { GameDetailPage } from "./pages/GameDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { useAuthStore } from "./store/auth.store";
import { SettingsLayout } from "./pages/settings/SettingsLayout";
import { SettingsHomePage } from "./pages/settings/SettingsHomePage";
import { SystemInfoPage } from "./pages/settings/SystemInfoPage";
import { SettingsPlaceholderPage } from "./pages/settings/SettingsPlaceholderPage";
import { AccountSettingsPage } from "./pages/settings/AccountSettingsPage";
import { StorageSettingsPage } from "./pages/settings/StorageSettingsPage";
import { AdminPage } from "./pages/settings/AdminPage";
import { ImportEditorPage } from "./pages/settings/ImportEditorPage";
import { ServerSettingsPage } from "./pages/settings/ServerSettingsPage";
import { RequireAdmin } from "./components/auth/RequireAdmin";
import { VantaCloudsBackground } from "./components/background/VantaCloudsBackground";
import { AFrameDepthBackground } from "./components/background/AFrameDepthBackground";
import { GameCacheHydration } from "./components/GameCacheHydration";
import { WindowChrome } from "./components/layout/WindowChrome";
import { useStoredSession } from "./hooks/useStoredSession";
import { useServerStatus } from "./hooks/useServerStatus";
import { useLibraryMode } from "./hooks/useLibraryMode";
import { useAccessRevokedWatcher } from "./hooks/useAccessRevoked";
import { invoke } from "./lib/ipc";
import { IpcChannel, type UserPublic } from "@shared/schemas";

function AppShell() {
  const { isRemote } = useLibraryMode();
  const { data: serverStatus, isFetched } = useServerStatus();
  const accessRevoked = useAuthStore((s) => s.accessRevoked);
  useAccessRevokedWatcher();
  /** Red cast only when a configured server is unreachable — never in local mode. */
  const serverOffline =
    isFetched && serverStatus != null && serverStatus.serverState === "offline";

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <WindowChrome />
      <div className="pointer-events-none absolute inset-0 z-0 isolate">
        {/* Vanta first (bottom); A-Frame above clouds or pillars are invisible under the shader */}
        <VantaCloudsBackground />
        <AFrameDepthBackground />
        <div className="app-bg-layer app-bg-gradient opacity-[0.84]" aria-hidden />
        {serverOffline && (
          <div
            className="app-bg-layer app-bg-offline transition-opacity duration-500"
            aria-hidden
          />
        )}
      </div>
      {/* Spacer matches WindowChrome (h-8) so routes can use -mt-8 to bleed under the drag region */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden">
        <div className="shrink-0 h-8" aria-hidden />
        {accessRevoked && (
          <div className="mx-4 mb-1 rounded-lg border border-[#5c3d3d] bg-[#2a1a1a]/80 px-4 py-2 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c88]">
              Access revoked — contact your administrator
            </p>
            <p className="mt-0.5 text-[10px] text-[#a88]">
              You can still browse, but downloads from this server are disabled.
            </p>
          </div>
        )}
        <GameCacheHydration />
        <main className="flex min-h-0 flex-1 flex-col overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Navigate to={isRemote ? "/store" : "/library"} replace />} />
            <Route path="/store" element={isRemote ? <StorePage /> : <Navigate to="/library" replace />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route path="/settings" element={<SettingsLayout />}>
              <Route index element={<SettingsHomePage />} />
              <Route path="account" element={<AccountSettingsPage />} />
              <Route path="theme" element={<Navigate to="/settings" replace />} />
              <Route path="storage" element={<StorageSettingsPage />} />
              <Route path="system" element={<SystemInfoPage />} />
              <Route path="server" element={<ServerSettingsPage />} />
              <Route path="scripts" element={<SettingsPlaceholderPage />} />
              <Route
                path="admin"
                element={
                  <RequireAdmin>
                    <AdminPage />
                  </RequireAdmin>
                }
              />
              <Route
                path="admin/import/:id"
                element={
                  <RequireAdmin>
                    <ImportEditorPage />
                  </RequireAdmin>
                }
              />
              <Route path="*" element={<Navigate to="/settings" replace />} />
            </Route>
            <Route path="/game/:id" element={<GameDetailPage />} />
            <Route path="*" element={<Navigate to="/store" replace />} />
          </Routes>
        </main>
        <Dock />
      </div>
    </div>
  );
}

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setAuth = useAuthStore((s) => s.setAuth);
  const { isRemote, needsSetup, loading: modeLoading } = useLibraryMode();
  const { data: session, isLoading: sessionLoading } = useStoredSession();
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      setBootstrapped(true);
      return;
    }
    const user: UserPublic = {
      id: session.userId,
      username: session.username,
      role: session.role,
      createdAt: session.createdAt,
      ...(session.avatarUrl ? { avatarUrl: session.avatarUrl } : {}),
    };
    void (async () => {
      try {
        await invoke(IpcChannel.AUTH_RESTORE, { user, token: session.token });
        setAuth(user, session.token);
      } finally {
        setBootstrapped(true);
      }
    })();
  }, [sessionLoading, session?.userId, session?.token, session?.avatarUrl, setAuth]);

  if (!bootstrapped || sessionLoading || modeLoading) {
    return (
      <div className="relative h-screen overflow-hidden bg-[#141414]">
        <WindowChrome />
        <div className="flex h-full flex-col items-center justify-center pt-8">
          <p className="text-[12px] text-[#555]">Loading…</p>
        </div>
      </div>
    );
  }

  // needsSetup first — a restored session must not skip the gate. Only remote needs a login.
  if (needsSetup || (isRemote && !isAuthenticated)) {
    return (
      <div className="relative h-screen overflow-hidden">
        <WindowChrome />
        <div className="h-full min-h-0 overflow-hidden">
          <LoginPage />
        </div>
      </div>
    );
  }

  return <AppShell />;
}
