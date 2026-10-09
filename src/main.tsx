import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import { App } from "./App";
import { Login } from "./modules/Login";
import { ResetPassword } from "./modules/ResetPassword";
import { AcceptInvitation } from "./modules/AcceptInvitation";
import { SignatureCallback } from "./modules/SignatureCallback";
import { AuthProvider, useAuth } from "./lib/auth";
import { useSessionQueryClient } from "./lib/sessionQueryClient";
import { clearEntryFromUrl, readEntryFromUrl, type Entry } from "./lib/entry";
import { useGrantEntry } from "./lib/use_grant_entry";
import { readSignatureCallback, type SignatureCallbackParams } from "./lib/signature";
import type { ModuleId } from "./shell/modules";
import "./theme/global.css";

function AppRoot() {
  const auth = useAuth();
  const [ entry, setEntry ] = useState<Entry | null>(() => readEntryFromUrl());
  // Módulo 19b: retorno do prestador de assinatura. Lido uma vez (puro); a
  // tela de retorno limpa a URL e troca o código depois do login.
  const [ signatureReturn, setSignatureReturn ] = useState<SignatureCallbackParams | null>(() => readSignatureCallback());
  const [ landing, setLanding ] = useState<ModuleId | undefined>(undefined);
  const queryClient = useSessionQueryClient(
    auth.state.kind === "authenticated" ? auth.state.user.id : null,
    () => { void auth.reload(); }
  );

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
      {signatureReturn
        ? <SignatureCallback params={signatureReturn} onDone={(next) => { setSignatureReturn(null); setLanding(next); }} />
        : <App initialModule={landing} />}
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
