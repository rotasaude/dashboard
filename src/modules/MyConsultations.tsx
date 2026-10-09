// Minhas consultas (módulo 19a, rodada 2): a autora lista as consultas que
// finalizou e as abre a qualquer momento, sem atendimento aberto nem abertura.
// Só `health_professional` com `clinical_record`. Nome do paciente só na tela;
// a leitura clínica não fica em cache (gcTime 0).
import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getConsultationOptions, listMyConsultations, type ConsultationListItem } from "../lib/api";
import { useAuth } from "../lib/auth";
import { hasFeature } from "../lib/features";
import { MY_CONSULTATIONS_KEY, OPTIONS_KEY, consultationError } from "../lib/consultation";
import { fmtDateTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { ConsultationLoader } from "./consultation/ConsultationView";

export function MyConsultations() {
  const { user } = useAuth();
  const [ from, setFrom ] = useState("");
  const [ to, setTo ] = useState("");
  const [ params, setParams ] = useState({ from: "", to: "" });
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ viewing, setViewing ] = useState<string | null>(null);
  const allowed = !!user && !user.operator && hasFeature(user, "clinical_record")
    && user.memberships.some((m) => m.role === "health_professional");
  const query = useQuery({
    queryKey: [ MY_CONSULTATIONS_KEY, params.from, params.to ],
    queryFn: () => listMyConsultations({ ...(params.from && { from: params.from }), ...(params.to && { to: params.to }) }),
    enabled: allowed, gcTime: 0, retry: false
  });
  const options = useQuery({
    queryKey: [ OPTIONS_KEY, user?.id ?? null ], queryFn: getConsultationOptions, staleTime: 5 * 60_000, enabled: allowed
  });

  if (!user) return null;
  if (!hasFeature(user, "clinical_record")) return <Frame><EmptyState title="o prontuário está desligado nesta cidade" /></Frame>;
  if (!allowed) return <Frame><EmptyState title="seu papel não permite ver consultas" /></Frame>;

  function apply() {
    if (from && to && from > to) { setProblem("a data inicial precisa ser igual ou anterior à final"); return; }
    setProblem(null);
    setParams({ from, to });
  }

  return (
    <Frame>
      {viewing ? (
        <ConsultationLoader key={viewing} id={viewing} options={options.data ?? null} patientProblems={[]}
          onClose={() => setViewing(null)} />
      ) : (
        <Panel title="Consultas finalizadas" sub="as que você escreveu">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={labelStyle}>De<input type="date" value={from} style={inputStyle} onChange={(e) => setFrom(e.target.value)} /></label>
              <label style={labelStyle}>Até<input type="date" value={to} style={inputStyle} onChange={(e) => setTo(e.target.value)} /></label>
              <button type="button" style={buttonStyle} onClick={apply}>Buscar</button>
            </div>
            {problem && <p role="alert" style={alert}>{problem}</p>}
            {query.isError && <p role="alert" style={alert}>{consultationError(query.error)}</p>}
            {query.isPending && <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>}
            {query.isSuccess && (query.data.length === 0 ? <EmptyState title="nenhuma consulta finalizada no período" /> : (
              <DataTable<ConsultationListItem>
                cols={[
                  { label: "Quando", w: "1fr", render: (r) => fmtDateTime(r.finalized_at) },
                  { label: "Paciente", w: "1.4fr", render: (r) => r.patient.display_name },
                  { label: "Tipo", w: "1fr", render: (r) => r.care_type_label ?? "—" },
                  { label: "Unidade", w: "1.2fr", render: (r) => r.health_unit.name },
                  { label: "", w: "1fr", render: (r) => (
                    <button type="button" style={secondaryButtonStyle} aria-label={`Abrir consulta de ${fmtDateTime(r.finalized_at)}`}
                      onClick={() => setViewing(r.id)}>Abrir</button>
                  ) }
                ]}
                rows={query.data}
                rowKey={(r) => r.id}
              />
            ))}
          </div>
        </Panel>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Minhas consultas" sub="consultas que você finalizou" />
      {children}
    </div>
  );
}

const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
