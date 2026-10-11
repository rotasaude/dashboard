// src/modules/SncrCallback.tsx
// Retorno do login do SNCR (módulo 19d, F-19.25; spec §3; contrato §4; plano
// do api, D1/D2). O serviço de login da Anvisa faz o gov.br do prescritor e
// devolve a pessoa a /dashboard/sncr/callback?session_id= (ou error=), sem o
// nosso `state`: ele ficou no sessionStorage desta aba na ida. O api troca o
// session_id pelo token (30 s, nunca guardado) e pede o bloco no mesmo fluxo.
// Tudo roda UMA vez (um ref sobrevive ao StrictMode) e a URL é limpa ANTES do
// POST, como no SignatureCallback do 19b. `state` e `session_id` só vão no
// corpo do POST: nada de console, storage (o state sai do sessionStorage na
// leitura) ou URL. Sem step-up.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, completeSncrOAuth } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  SNCR_SIMULATED_NOTICE, SNCR_STOCK_KEY, controlledError, sncrCallbackLanding, sncrCallbackSummary, sncrOauthErrorPhrase,
  takeSncrState, usesSimulatedSncr, type SncrCallbackParams
} from "../lib/controlled";
import { clearSignatureCallbackFromUrl } from "../lib/signature";
import { errorReturnTo } from "../lib/oauthReturn";
import { labelFor, moduleFromPath, type ModuleId } from "../shell/modules";
import { buttonStyle } from "../components/formStyles";
import { Tag } from "../components/Tag";

type View =
  | { kind: "working" }
  | { kind: "done"; text: string; landing: ModuleId }
  | { kind: "failed"; text: string; landing: ModuleId };

interface Props {
  params: SncrCallbackParams;
  onDone(landing: ModuleId): void;
  clearUrl?(): void;
  takeState?(): string | null;
}

function landingFromError(err: unknown): ModuleId {
  const returnTo = err instanceof ApiError ? errorReturnTo(err) : null;
  return moduleFromPath(sncrCallbackLanding({ return_to: returnTo })) ?? "sncr";
}

export function SncrCallback({ params, onDone, clearUrl = clearSignatureCallbackFromUrl, takeState = takeSncrState }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const started = useRef(false);
  const [ view, setView ] = useState<View>({ kind: "working" });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    clearUrl();
    const stored = takeState();
    const state = params.state ?? stored;
    const { sessionId, error } = params;
    // Recusa no gov.br COM state vai ao api como { state, error }: ele consome
    // o state e devolve 403 authorization_denied com o return_to.
    if (error && state) {
      void (async () => {
        let landing: ModuleId = "sncr";
        try {
          landing = moduleFromPath(sncrCallbackLanding(await completeSncrOAuth(state, { error }))) ?? "sncr";
        } catch (err) {
          landing = landingFromError(err);
        }
        setView({ kind: "failed", text: sncrOauthErrorPhrase(error), landing });
      })();
      return;
    }
    if (error || !state || !sessionId) {
      setView({ kind: "failed", text: sncrOauthErrorPhrase(error), landing: "sncr" });
      return;
    }
    void (async () => {
      try {
        const result = await completeSncrOAuth(state, sessionId);
        void queryClient.invalidateQueries({ queryKey: [ SNCR_STOCK_KEY ] });
        setView({ kind: "done", text: sncrCallbackSummary(result), landing: moduleFromPath(sncrCallbackLanding(result)) ?? "sncr" });
      } catch (err) {
        setView({ kind: "failed", text: controlledError(err), landing: landingFromError(err) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={page}>
      <section aria-label="Retorno do gov.br — números do SNCR" style={panel}>
        <strong>Números do SNCR</strong>
        {usesSimulatedSncr(user) && <div><Tag tone="warn" mono={false}>{SNCR_SIMULATED_NOTICE}</Tag></div>}
        {view.kind === "working" && <p style={text}>pedindo os números ao SNCR…</p>}
        {view.kind === "done" && (
          <>
            <p role="status" style={text}>{view.text}</p>
            <div><button type="button" style={buttonStyle} onClick={() => onDone(view.landing)}>Continuar</button></div>
          </>
        )}
        {view.kind === "failed" && (
          <>
            <p role="alert" style={alert}>{view.text}</p>
            <div><button type="button" style={buttonStyle} onClick={() => onDone(view.landing)}>
              {view.landing === "overview" ? "Voltar ao painel" : `Voltar a ${labelFor(view.landing)}`}
            </button></div>
          </>
        )}
      </section>
    </div>
  );
}

const page: CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 };
const panel: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 12, padding: 20, width: "100%", maxWidth: 440,
  border: "1px solid var(--rule)", borderRadius: 10, background: "var(--panel)"
};
const text: CSSProperties = { margin: 0, fontSize: 13 };
const alert: CSSProperties = { margin: 0, fontSize: 13, color: "var(--down)" };
