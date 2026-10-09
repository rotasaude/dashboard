// src/modules/clinicalRecord/OpeningsReport.tsx
// Relatório das aberturas fora de contexto (módulo 19; spec §5; contratos §3):
// para o municipal_admin, quem abriu prontuário fora do atendimento, quando,
// de qual CPF (mascarado pelo api) e por quê. A nota da abertura nunca vem.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { listMemberships, listOpenings, type OpeningRow } from "../../lib/api";
import { OPENINGS_REPORT_LIMIT, OPENING_KIND_LABEL, reasonLabel } from "../../lib/clinicalRecord";
import { consultationError } from "../../lib/consultation";
import { addDays, todayInCity } from "../../lib/campaigns";
import { fmtDateTime, fmtHourMinute } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { buttonStyle, inputStyle } from "../../components/formStyles";

export const OPENINGS_KEY = "clinicalOpenings";
const DEFAULT_DAYS = 30;

export function OpeningsReport({ today = todayInCity() }: { today?: string }) {
  const [ from, setFrom ] = useState(() => addDays(today, -DEFAULT_DAYS));
  const [ to, setTo ] = useState(today);
  const [ userId, setUserId ] = useState("");
  const [ params, setParams ] = useState(() => ({ from: addDays(today, -DEFAULT_DAYS), to: today, userId: "" }));
  const [ problem, setProblem ] = useState<string | null>(null);
  const members = useQuery({ queryKey: [ "memberships" ], queryFn: listMemberships, staleTime: 60_000 });
  const query = useQuery({
    queryKey: [ OPENINGS_KEY, params.from, params.to, params.userId ], queryFn: () => listOpenings(params), gcTime: 0
  });

  // Uma linha por papel em /setup/memberships: cada pessoa aparece uma vez.
  const users = Array.from(new Map((members.data ?? []).map((row) => [ row.user.id, row.user.email_address ])))
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));

  function apply() {
    if (from > to) { setProblem("a data inicial precisa ser igual ou anterior à final"); return; }
    setProblem(null);
    setParams({ from, to, userId });
  }

  return (
    <Panel title="Aberturas fora de contexto" sub="quem abriu prontuário fora do atendimento, e por quê">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={labelStyle}>De<input type="date" value={from} max={today} style={inputStyle} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={labelStyle}>Até<input type="date" value={to} max={today} style={inputStyle} onChange={(e) => setTo(e.target.value)} /></label>
          <label style={{ ...labelStyle, minWidth: 220 }}>
            Profissional
            <select value={userId} style={inputStyle} onChange={(e) => setUserId(e.target.value)}>
              <option value="">todos</option>
              {users.map(([ id, email ]) => <option key={id} value={id}>{email}</option>)}
            </select>
          </label>
          <button type="button" style={buttonStyle} onClick={apply}>Buscar</button>
        </div>
        {problem && <p role="alert" style={alert}>{problem}</p>}
        {query.isError && <p role="alert" style={alert}>{consultationError(query.error)}</p>}
        {query.isPending && <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>}
        {query.isSuccess && query.data.length >= OPENINGS_REPORT_LIMIT && (
          <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
            mostrando as {OPENINGS_REPORT_LIMIT} mais recentes; refine o período
          </p>
        )}
        {query.isSuccess && (query.data.length === 0 ? <EmptyState title="nenhuma abertura no período" /> : (
          <DataTable<OpeningRow>
            cols={[
              { label: "Quando", w: "1fr", render: (r) => fmtDateTime(r.created_at) },
              { label: "Quem", w: "1.4fr", render: (r) => r.user_name },
              { label: "CPF", w: "1fr", render: (r) => <span className="mono">{r.cpf_masked}</span> },
              { label: "Tipo", w: "1.2fr", render: (r) => OPENING_KIND_LABEL[r.kind] ?? r.kind },
              { label: "Motivo", w: "1.2fr", render: (r) => reasonLabel(r.reason_code) },
              { label: "Válida até", w: "0.8fr", render: (r) => (r.expires_at ? fmtHourMinute(r.expires_at) : "—") }
            ]}
            rows={query.data}
            rowKey={(r) => `${r.kind}:${r.id}`}
          />
        ))}
      </div>
    </Panel>
  );
}

const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
