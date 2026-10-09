// Consultas por profissional (módulo 19a, rodada 2): o municipal_admin lê, só
// leitura, as consultas finalizadas de um profissional. Cada busca e cada
// abertura passa por step-up. Os resultados vivem só no estado do componente
// (nada em cache do react-query) e somem ao fechar ou desmontar.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  errorCode, getAdministrativeConsultation, getConsultationOptions, listProfessionalConsultations, listProfessionals,
  type Consultation, type ConsultationListItem, type ConsultationOptions
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { hasFeature } from "../lib/features";
import { OPTIONS_KEY, consultationError } from "../lib/consultation";
import { fmtDateTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { ConsultationView } from "./consultation/ConsultationView";

type Result = { professional: { id: string; name: string }; consultations: ConsultationListItem[] };
type Pending = { kind: "search" } | { kind: "open"; id: string; label: string; item: ConsultationListItem };

const NOT_FOUND = "profissional não encontrado nesta cidade";
const OWN = new Set([ "invalid_period", "missing_role", "feature_disabled" ]);

export function ProfessionalConsultations({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const { user } = useAuth();
  const [ userId, setUserId ] = useState("");
  const [ from, setFrom ] = useState("");
  const [ to, setTo ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ pending, setPending ] = useState<Pending | null>(null);
  const [ result, setResult ] = useState<Result | null>(null);
  const [ consultation, setConsultation ] = useState<Consultation | null>(null);
  const [ opened, setOpened ] = useState<ConsultationListItem | null>(null);
  const got = useRef<Result | Consultation | null>(null);
  const allowed = !!user && !user.operator && hasFeature(user, "clinical_record")
    && user.memberships.some((m) => m.role === "municipal_admin");
  const professionals = useQuery({ queryKey: [ "professionals" ], queryFn: listProfessionals, enabled: allowed });
  // Catálogo não clínico: o api responde 200 também ao admin puro; um api antigo
  // responde 403 e a tela cai no fallback local, sem erro e sem nova tentativa.
  const options = useQuery({
    queryKey: [ OPTIONS_KEY, user?.id ?? null ], queryFn: getConsultationOptions, staleTime: 5 * 60_000,
    enabled: allowed, retry: false
  });

  if (!user) return null;
  if (!hasFeature(user, "clinical_record")) return <Frame><EmptyState title="o prontuário está desligado nesta cidade" /></Frame>;
  if (!allowed) return <Frame><EmptyState title="seu papel não permite ver consultas" /></Frame>;

  // Sem as opções do api, o tipo vem do item da lista; condutas ficam pelo código.
  const viewOptions: ConsultationOptions | null = options.data
    ?? (opened?.care_type && opened.care_type_label
      ? { care_types: [ { code: opened.care_type, label: opened.care_type_label } ], conducts: [], cid10_allowed_for_cbo: false }
      : null);

  function ask() {
    if (!userId) { setProblem("escolha o profissional"); return; }
    if (from && to && from > to) { setProblem("a data inicial precisa ser igual ou anterior à final"); return; }
    setProblem(null);
    setResult(null);
    setPending({ kind: "search" });
  }

  function translate(err: unknown): string | null {
    const code = errorCode(err) ?? "";
    if (code === "not_found") return pending?.kind === "open" ? "consulta não encontrada" : NOT_FOUND;
    return OWN.has(code) ? consultationError(err) : null;
  }

  function sensitive(p: Pending) {
    const isSearch = p.kind === "search";
    return (
      <SensitiveAction
        title={isSearch ? "Buscar consultas do profissional" : "Abrir consulta"}
        description={isSearch
          ? "A leitura administrativa exige verificação em duas etapas."
          : `Consulta de ${p.kind === "open" ? p.label : ""}. A leitura fica registrada no relatório de aberturas.`}
        requiresStepUp
        confirmLabel={isSearch ? "Buscar consultas" : "Abrir consulta"}
        run={async () => {
          got.current = p.kind === "search"
            ? await listProfessionalConsultations(userId, { ...(from && { from }), ...(to && { to }) })
            : await getAdministrativeConsultation(p.id);
        }}
        onDone={() => {
          if (p.kind === "search") setResult(got.current as Result);
          else { setConsultation(got.current as Consultation); setOpened(p.item); }
          got.current = null;
          setPending(null);
        }}
        onCancel={() => setPending(null)}
        onGoToSecurity={onGoToSecurity}
        translateError={translate}
      />
    );
  }

  return (
    <Frame>
      {consultation ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={notice}>Leitura administrativa, só para consulta: fica registrada no relatório de aberturas.</p>
          <ConsultationView consultation={consultation} options={viewOptions} patientProblems={[]} readOnly
            onAddendumAdded={() => {}} onClose={() => { setConsultation(null); setOpened(null); }} />
        </div>
      ) : (
        <Panel title="Consultas finalizadas" sub="escolha o profissional e, se quiser, o período">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={labelStyle}>Profissional
                <select value={userId} style={inputStyle} onChange={(e) => { setUserId(e.target.value); setResult(null); }}>
                  <option value="">—</option>
                  {(professionals.data ?? []).map((p) => <option key={p.user_id} value={p.user_id}>{p.professional_name}</option>)}
                </select>
              </label>
              <label style={labelStyle}>De<input type="date" value={from} style={inputStyle} onChange={(e) => { setFrom(e.target.value); setResult(null); }} /></label>
              <label style={labelStyle}>Até<input type="date" value={to} style={inputStyle} onChange={(e) => { setTo(e.target.value); setResult(null); }} /></label>
              <button type="button" style={buttonStyle} onClick={ask}>Buscar</button>
            </div>
            {problem && <p role="alert" style={alert}>{problem}</p>}
            {professionals.isError && <p role="alert" style={alert}>{consultationError(professionals.error)}</p>}
            {pending && sensitive(pending)}
            {result && !pending && (
              <>
                <strong style={{ fontSize: 13 }}>{result.professional.name}</strong>
                {result.consultations.length === 0 ? <EmptyState title="nenhuma consulta finalizada no período" /> : (
                  <DataTable<ConsultationListItem>
                    cols={[
                      { label: "Quando", w: "1fr", render: (r) => fmtDateTime(r.finalized_at) },
                      { label: "Paciente", w: "1.4fr", render: (r) => r.patient.display_name },
                      { label: "Tipo", w: "1fr", render: (r) => r.care_type_label ?? "—" },
                      { label: "Unidade", w: "1.2fr", render: (r) => r.health_unit.name },
                      { label: "", w: "1fr", render: (r) => (
                        <button type="button" style={secondaryButtonStyle} aria-label={`Abrir consulta de ${fmtDateTime(r.finalized_at)}`}
                          onClick={() => setPending({ kind: "open", id: r.id, label: fmtDateTime(r.finalized_at), item: r })}>Abrir</button>
                      ) }
                    ]}
                    rows={result.consultations}
                    rowKey={(r) => r.id}
                  />
                )}
              </>
            )}
          </div>
        </Panel>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Consultas por profissional" sub="leitura administrativa, só para consulta" />
      {children}
    </div>
  );
}

const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const notice: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
