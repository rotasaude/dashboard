// src/modules/SncrAccount.tsx
// Conta → SNCR (módulo 19d, F-19.25; spec §4 e §7; contrato §4): o estoque
// pessoal de números do SNCR por tipo (RCE, RET), os pedidos do mês (até 3,
// blocos de 1.000) e "Obter números do SNCR", que leva ao login da Anvisa com
// o gov.br do próprio prescritor. O token e o pedido ao SNCR são do api (30 s);
// a tela guarda o `state` nesta aba (a volta não o traz; plano do api, D2) e
// segue o authorize_url. Sem número, as receitas saem em papel.
import { useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorCode, getSncrStock, requestSncrNumbers, type SncrKind } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtNumber } from "../lib/format";
import { goToProvider } from "../lib/signature";
import { CONTROLLED_DISABLED } from "../lib/clinicalDocuments";
import {
  MONTHLY_REQUEST_LIMIT, SNCR_RETURN_TO, SNCR_SIMULATED_NOTICE, SNCR_STOCK_KEY, canRequestSncr, controlledError,
  controlledOn, rememberSncrState, stockRows, usesSimulatedSncr
} from "../lib/controlled";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { KeyValue } from "../components/KeyValue";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, disabledButtonStyle } from "../components/formStyles";
import { toneColor } from "../theme/tokens";

const HOW_IT_WORKS =
  "Você entra no login do SNCR da Anvisa com a sua conta gov.br e o Rota Saúde pede, em seu nome, um bloco de 1.000 números do tipo escolhido " +
  "(até 3 pedidos por mês). Cada receita digital de controle especial ou de antimicrobiano usa um número; sem número, a receita sai em papel.";

interface Props { redirect?(url: string): void }

export function SncrAccount({ redirect = goToProvider }: Props) {
  const { user } = useAuth();
  const allowed = canRequestSncr(user);
  const query = useQuery({ queryKey: [ SNCR_STOCK_KEY, user?.id ?? null ], queryFn: getSncrStock, enabled: allowed, retry: false });
  const [ asking, setAsking ] = useState<SncrKind | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const askingRef = useRef(false);

  if (!allowed) {
    return (
      <div style={page}>
        <PageHeader title="SNCR" sub="conta · números de receita da Anvisa" />
        <EmptyState title={controlledOn(user) ? "só profissionais de saúde pedem números do SNCR" : CONTROLLED_DISABLED} />
      </div>
    );
  }

  async function ask(kind: SncrKind) {
    if (askingRef.current) return;
    askingRef.current = true;
    setAsking(kind); setError(null);
    try {
      const { authorize_url, state } = await requestSncrNumbers(kind, SNCR_RETURN_TO);
      rememberSncrState(state);
      redirect(authorize_url);
    } catch (err) {
      setError(controlledError(err));
      if (errorCode(err) === "monthly_limit_reached") void query.refetch();
      askingRef.current = false;
      setAsking(null);
    }
  }

  const simulated = usesSimulatedSncr(user) || query.data?.simulated === true;

  return (
    <div style={page}>
      <PageHeader title="SNCR" sub="conta · números de receita da Anvisa" />
      <Panel title="Números do SNCR" sub="estoque pessoal para a receita digital de controle especial e de antimicrobiano">
        <div style={body}>
          {simulated && <div><Tag tone="warn" mono={false}>{SNCR_SIMULATED_NOTICE}</Tag></div>}
          <p style={muted}>{HOW_IT_WORKS}</p>
          {query.isPending && <p style={muted}>carregando…</p>}
          {query.isError && <p role="alert" style={alert}>{controlledError(query.error)}</p>}
          {error && <p role="alert" style={alert}>{error}</p>}
          {query.data && stockRows(query.data).map((row) => (
            <section key={row.kind} aria-label={row.label} style={kindBox}>
              <strong style={{ fontSize: 13 }}>{row.label}</strong>
              <div style={grid}>
                <KeyValue k="Livres" v={fmtNumber(row.free)} />
                <KeyValue k="Usados" v={fmtNumber(row.used)} />
                <KeyValue k="Anulados" v={fmtNumber(row.voided)} />
                <KeyValue k="Pedidos no mês" v={`${row.requests} de ${MONTHLY_REQUEST_LIMIT}`} />
              </div>
              {row.notice && <p role="status" style={{ ...text, color: toneColor(row.notice.tone).fg }}>{row.notice.text}</p>}
              {row.limitReached ? (
                <p style={muted}>{`limite de ${MONTHLY_REQUEST_LIMIT} pedidos por mês atingido — o próximo pedido fica para o mês que vem`}</p>
              ) : (
                <div>
                  <button type="button" aria-label={`Obter números do SNCR: ${row.label}`} disabled={asking !== null}
                    style={asking !== null ? disabledButtonStyle : buttonStyle} onClick={() => void ask(row.kind)}>
                    Obter números do SNCR
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>
      </Panel>
    </div>
  );
}

const page: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const kindBox: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 };
const text: CSSProperties = { margin: 0, fontSize: 13 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
