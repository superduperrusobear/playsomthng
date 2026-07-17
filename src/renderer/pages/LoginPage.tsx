import { useState } from "react";
import { useLogin, useCommitLoginSession } from "../hooks/useAuth";
import { useServerStatus } from "../hooks/useServerStatus";
import { useLibraryMode } from "../hooks/useLibraryMode";
import { VantaCloudsBackground } from "../components/background/VantaCloudsBackground";
import { AFrameDepthBackground } from "../components/background/AFrameDepthBackground";
import { ConnectGate } from "../components/onboarding/ConnectGate";
import { ServerUnreachable } from "../components/onboarding/ServerUnreachable";
import { UserStep, CodeStep, AvatarStep, type OnboardStep } from "../components/onboarding/OnboardingFlow";
import { invoke } from "../lib/ipc";
import { IpcChannel, type AuthResponse } from "@shared/schemas";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Server rejections arrive wrapped in Electron IPC noise — pull out the useful part. */
function cleanError(raw: string): string {
  // Same hardware, different key (OS reinstall): the admin must re-invite this machine.
  if (raw.includes("BAD_SIGNATURE") || raw.includes("SIGNATURE_REQUIRED")) {
    return "This machine's key doesn't match its enrollment. Ask the admin for a new invite code.";
  }
  const tail = raw.match(/Error:\s+(.+)$/);
  return tail?.[1]?.trim() || raw;
}

export function LoginPage() {
  const [step, setStep] = useState<OnboardStep>("user");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [userError, setUserError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingAuth, setPendingAuth] = useState<AuthResponse | null>(null);

  const login = useLogin();
  const commitSession = useCommitLoginSession();
  const server = useServerStatus();
  const { needsSetup, serverUrl, reopenGate } = useLibraryMode();

  const status = server.data;
  const checking = server.isLoading || server.isFetching;
  const serverDown = !checking && status != null && status.serverState === "offline";

  /** Probe with username only — an enrolled machine goes straight in, a new one needs its code. */
  function handleUser() {
    setBusy(true);
    setUserError(null);
    login.mutate(
      { username: username.trim(), scikde: "" },
      {
        onSuccess: async (data) => {
          // Machine already enrolled — existing member, no code, no re-onboarding.
          await commitSession(data);
        },
        onError: (err) => {
          const raw = err instanceof Error ? err.message : String(err);
          if (raw.includes("UNKNOWN_USERNAME")) {
            setUserError("That username was not found.");
          } else if (raw.includes("SETUP_KEY_REQUIRED") || raw.includes("Invalid username")) {
            setCode("");
            setCodeError(null);
            setStep("code");
            login.reset();
          } else {
            setUserError(cleanError(raw));
          }
          setBusy(false);
        },
      },
    );
  }

  /** Enrolls this machine: code is consumed server-side, fingerprint + hostname stored. */
  function handleCode() {
    setBusy(true);
    setCodeError(null);
    login.mutate(
      { username: username.trim(), scikde: code.trim() },
      {
        onSuccess: (data) => {
          setPendingAuth(data);
          setStep("avatar");
          setBusy(false);
        },
        onError: (err) => {
          const raw = err instanceof Error ? err.message : String(err);
          // Username was verified in step 1, so a rejection here is the code.
          setCodeError(
            raw.includes("Invalid username") ? "Incorrect invite code." : cleanError(raw),
          );
          setBusy(false);
        },
      },
    );
  }

  async function handlePickAvatar(file: File) {
    setBusy(true);
    setAvatarError(null);
    try {
      const imageBase64 = await fileToBase64(file);
      const { avatarUrl: url } = await invoke<{ avatarUrl: string }>(
        IpcChannel.AUTH_AVATAR_UPLOAD,
        { imageBase64, contentType: file.type || "image/jpeg" },
      );
      setAvatarUrl(url);
      setAvatarPreview(URL.createObjectURL(file));
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinish() {
    if (!pendingAuth) return;
    setBusy(true);
    setAvatarError(null);
    try {
      await commitSession({
        ...pendingAuth,
        user: {
          ...pendingAuth.user,
          ...(avatarUrl ? { avatarUrl } : {}),
        },
      });
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Could not continue.");
      setBusy(false);
    }
  }

  function body() {
    if (needsSetup) return <ConnectGate />;

    if (serverDown) {
      return (
        <ServerUnreachable
          url={serverUrl}
          error={status?.error}
          retrying={server.isFetching}
          onRetry={() => void server.refetch()}
          onChangeServer={() => void reopenGate()}
        />
      );
    }

    if (step === "user") {
      return (
        <UserStep
          value={username}
          onChange={(v) => {
            setUsername(v);
            setUserError(null);
          }}
          onSubmit={handleUser}
          onBack={() => void reopenGate()}
          busy={busy || login.isPending}
          error={userError}
        />
      );
    }

    if (step === "code") {
      return (
        <CodeStep
          value={code}
          onChange={(v) => {
            setCode(v);
            setCodeError(null);
          }}
          onSubmit={handleCode}
          onBack={() => {
            setStep("user");
            setCodeError(null);
            login.reset();
          }}
          busy={busy || login.isPending}
          error={codeError}
        />
      );
    }

    return (
      <AvatarStep
        onPick={(f) => void handlePickAvatar(f)}
        onFinish={() => void handleFinish()}
        busy={busy}
        error={avatarError}
        previewUrl={avatarPreview}
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 select-none flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0 isolate">
        <VantaCloudsBackground />
        <AFrameDepthBackground />
        <div className="app-bg-layer app-bg-gradient opacity-[0.84]" aria-hidden />
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-6">{body()}</div>
      </div>
    </div>
  );
}
