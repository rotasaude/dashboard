import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import { App } from "./App";
import { Login } from "./modules/Login";
import { ResetPassword } from "./modules/ResetPassword";
import { AcceptInvitation } from "./modules/AcceptInvitation";
import { AuthProvider, useAuth } from "./lib/auth";
import { ApiError } from "./lib/api";
import { clearEntryFromUrl, readEntryFromUrl, type Entry } from "./lib/entry";
import { useGrantEntry } from "./lib/use_grant_entry";
import "./theme/global.css";

function AppRoot() {
  const auth = useAuth();
  const [ entry, setEntry ] = useState<Entry | null>(() => readEntryFromUrl());
  const [ queryClient ] = useState(() => new QueryClient({
    queryCache: new QueryCache({
      onError(err) {
        if (err instanceof ApiError && err.status === 401) void auth.reload();
      }
    }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return false;
          return count < 1;
        },
        staleTime: 30_000
      }
    }
  }));

  // Grant vale 60 s e uso único: consome na montagem, antes de qualquer tela.
  const grantError = useGrantEntry(entry, (ok) => {
    void (async () => {
      if (ok) await auth.reload();
      clearEntryFromUrl();
      setEntry(null);
    })();
  });

  if (entry?.kind === "reset") return <ResetPassword token={entry.token} />;
  if (entry?.kind === "grant") return <Splash />;
  if (entry?.kind === "invite" && auth.state.kind !== "authenticated") {
    return <AcceptInvitation token={entry.token} onDone={() => { clearEntryFromUrl(); setEntry(null); }} />;
  }

  if (auth.state.kind === "loading") return <Splash />;
  if (auth.state.kind === "anonymous") return <Login expiredGrant={grantError} />;
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

function Splash() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--ink3, #888)", fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>…</div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AppRoot />
    </AuthProvider>
  </StrictMode>
);
