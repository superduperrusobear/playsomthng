import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ErrorBoundary } from "./components/errors/ErrorBoundary";
import "./styles/globals.css";
import { gameQueryDefaults } from "./lib/gameQueryCache";
import { IpcChannel } from "@shared/schemas";
import { useStoreUpdateStore } from "./store/storeUpdate.store";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
    },
  },
});

queryClient.setQueryDefaults(["game"], gameQueryDefaults);

window.api.on(IpcChannel.LIBRARY_CATALOG_REVISION, () => {
  useStoreUpdateStore.getState().markUpdate();
  void queryClient.invalidateQueries({ queryKey: ["library"], refetchType: "all" });
  void queryClient.invalidateQueries({ queryKey: ["game"], refetchType: "all" });
});

const root = document.getElementById("root")!;

createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
