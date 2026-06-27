import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import { App } from "./App";
import { Login } from "./modules/Login";
import { AuthProvider, useAuth } from "./lib/auth";
import { ApiError } from "./lib/api";
import "./theme/global.css";

function AppRoot() {
  const auth = useAuth();
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

  if (auth.state.kind === "loading") return <Splash />;
  if (auth.state.kind === "anonymous") return <Login />;
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
