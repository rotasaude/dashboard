import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { Login } from "./modules/Login";
import { ResetPassword } from "./modules/ResetPassword";
import { AcceptInvitation } from "./modules/AcceptInvitation";
import { SignatureCallback } from "./modules/SignatureCallback";
import { SncrCallback } from "./modules/SncrCallback";
import { AuthProvider, useAuth } from "./lib/auth";
import { useSessionQueryClient } from "./lib/sessionQueryClient";
import { clearEntryFromUrl, readEntryFromUrl, type Entry } from "./lib/entry";
import { useGrantEntry } from "./lib/use_grant_entry";
import { readSignatureCallback, type SignatureCallbackParams } from "./lib/signature";
import { readSncrCallback, type SncrCallbackParams } from "./lib/controlled";
import type { ModuleId } from "./shell/modules";
import "./theme/global.css";

function AppRoot() {
  const auth = useAuth();
  const [ entry, setEntry ] = useState<Entry | null>(() => readEntryFromUrl());
  // Módulo 19b: retorno do prestador de assinatura. Lido uma vez (puro); a
  // tela de retorno limpa a URL e troca o código depois do login.
  const [ signatureReturn, setSignatureReturn ] = useState<SignatureCallbackParams | null>(() => readSignatureCallback());
  // Módulo 19d: volta do login do SNCR. Lido uma vez e puro (só a URL); a tela
  // de retorno limpa a URL, tira o state do sessionStorage e troca o session_id.
  const [ sncrReturn, setSncrReturn ] = useState<SncrCallbackParams | null>(() => readSncrCallback());
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
        : sncrReturn
          ? <SncrCallback params={sncrReturn} onDone={(next) => { setSncrReturn(null); setLanding(next); }} />
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
