// src/modules/SignatureCallback.tsx
// Retorno do prestador de assinatura (módulo 19b; spec §5; contrato §4, §13).
// O prestador devolve a pessoa a /dashboard/signature/callback?state=&code=
// (ou error=). O `state` é de USO ÚNICO: a troca roda uma vez só — um ref
// sobrevive ao ciclo monta/desmonta/monta do StrictMode, como no
// useGrantEntry — e a URL é limpa ANTES do POST, para o `code` não ficar no
// histórico nem ser trocado de novo num recarregar. `state` e `code` só vão
// no corpo do POST: nada de console, storage ou URL.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, completeSignatureOAuth, type BatchResult } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  CERTIFICATE_KEY, PENDING_KEY, SESSION_KEY, SIMULATED_NOTICE, callbackLanding, callbackSummary,
  clearSignatureCallbackFromUrl, isSimulatedProvider, oauthErrorPhrase, reasonLabel, signatureError, usesSimulatedPsc,
  type SignatureCallbackParams
} from "../lib/signature";
import { labelFor, moduleFromPath, type ModuleId } from "../shell/modules";
import { buttonStyle } from "../components/formStyles";
import { Tag } from "../components/Tag";

type View =
  | { kind: "working" }
  | { kind: "done"; text: string; failed: BatchResult["failed"]; landing: ModuleId; simulated: boolean }
  | { kind: "failed"; text: string; landing: ModuleId };

interface Props {
  params: SignatureCallbackParams;
  onDone(landing: ModuleId): void;
  clearUrl?(): void;
}

// O api devolve o return_to guardado com o state também nas recusas depois de
// achar o state do próprio usuário (ex.: 409 authorization_expired).
function landingFromError(err: unknown): ModuleId {
  const returnTo = err instanceof ApiError ? (err.body as { return_to?: unknown } | null | undefined)?.return_to : undefined;
  return (typeof returnTo === "string" ? moduleFromPath(returnTo) : null) ?? "overview";
}

export function SignatureCallback({ params, onDone, clearUrl = clearSignatureCallbackFromUrl }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const started = useRef(false);
  const [ view, setView ] = useState<View>({ kind: "working" });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    clearUrl();
    const { state, code, error } = params;
    // Ruling R11 (contrato §13): erro do prestador COM state vai ao api como
    // { state, error } — ele consome o state e devolve 403 authorization_denied
    // com o return_to. Sem state não há o que avisar.
    if (error && state) {
      void (async () => {
        let landing: ModuleId = "overview";
        try {
          landing = moduleFromPath(callbackLanding(await completeSignatureOAuth(state, { error }))) ?? "overview";
        } catch (err) {
          landing = landingFromError(err);
        }
        setView({ kind: "failed", text: oauthErrorPhrase(error), landing });
      })();
      return;
    }
    if (error || !state || !code) {
      setView({ kind: "failed", text: oauthErrorPhrase(error), landing: "overview" });
      return;
    }
    void (async () => {
      try {
        const result = await completeSignatureOAuth(state, code);
        for (const key of [ CERTIFICATE_KEY, SESSION_KEY, PENDING_KEY ]) void queryClient.invalidateQueries({ queryKey: [ key ] });
        setView({
          kind: "done",
          text: callbackSummary(result),
          failed: result.purpose === "batch" ? result.result.failed : [],
          landing: moduleFromPath(callbackLanding(result)) ?? "overview",
          simulated: result.purpose === "link" && isSimulatedProvider(result.result.provider)
        });
      } catch (err) {
        setView({ kind: "failed", text: signatureError(err), landing: landingFromError(err) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const simulated = usesSimulatedPsc(user) || (view.kind === "done" && view.simulated);

  return (
    <div style={page}>
      <section aria-label="Retorno do prestador de assinatura" style={panel}>
        <strong>Assinatura digital</strong>
        {simulated && <div><Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag></div>}
        {view.kind === "working" && <p style={text}>concluindo a autorização…</p>}
        {view.kind === "done" && (
          <>
            <p role="status" style={text}>{view.text}</p>
            {view.failed.length > 0 && (
              <ul aria-label="não assinados" style={list}>
                {view.failed.map((f) => <li key={f.request_id}>{reasonLabel(f.reason_code)}</li>)}
              </ul>
            )}
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
const list: CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 12.5 };
const text: CSSProperties = { margin: 0, fontSize: 13 };
const alert: CSSProperties = { margin: 0, fontSize: 13, color: "var(--down)" };
