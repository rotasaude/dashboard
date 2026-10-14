// src/modules/ExamRegulation.tsx
// Fila de regulação (módulo 21a; spec §5 etapa 2; contrato §4): exames que
// exigem autorização, na ordem do api (urgente primeiro, depois o mais
// antigo). Autorizar exige o prestador; negar exige o motivo e fecha o exame
// (quem pediu vê no Início). Se outro regulador decidiu antes, 409
// invalid_transition fecha a decisão e relê a fila.
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authorizeExam, denyExam, errorCode, listEnabledProviders, listRegulationQueue, type ExamOrder } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  EXAMS_DISABLED, EXAMS_NO_ROLE, EXAM_PROVIDER_REFS_KEY, EXAM_REGULATION_KEY, PRIORITY_LABEL, canUseExams, examError, examRoles,
  overdueLabel, refreshExams
} from "../lib/exams";
import { fmtDateTime } from "../lib/format";
import { useExamOrderPages } from "../hooks/useExamOrderPages";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { KeyValue } from "../components/KeyValue";
import { ActionButton } from "../components/ActionButton";
import { Tag } from "../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { ReasonForm } from "./exams/ReasonForm";
import { alert, box, fieldLabel, grid, muted, okText, row, stack } from "./exams/styles";

export function ExamRegulation() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const roles = examRoles(user);
  const allowed = canUseExams(user) && (roles.regulator || roles.admin);
  const { query, orders } = useExamOrderPages([ EXAM_REGULATION_KEY ], (before) => listRegulationQueue(before), allowed);
  const [ deciding, setDeciding ] = useState<ExamOrder | null>(null);
  const [ hidden, setHidden ] = useState<ReadonlySet<string>>(new Set());
  const [ notice, setNotice ] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (!user) return null;
  if (!canUseExams(user)) return <Frame><EmptyState title={EXAMS_DISABLED} /></Frame>;
  if (!allowed) return <Frame><EmptyState title={EXAMS_NO_ROLE} /></Frame>;

  function finish(next: { kind: "ok" | "error"; text: string }) {
    // Some da lista já, sem esperar a releitura (a fila antiga fica em cache durante o refetch).
    if (deciding) setHidden((prev) => new Set(prev).add(deciding.id));
    setDeciding(null);
    setNotice(next);
    void refreshExams(queryClient);
  }

  return (
    <Frame>
      {notice && <p role={notice.kind === "ok" ? "status" : "alert"} style={notice.kind === "ok" ? okText : alert}>{notice.text}</p>}
      {deciding && (
        <Decision key={deciding.id} order={deciding} onCancel={() => setDeciding(null)}
          onDone={(text) => finish({ kind: "ok", text })} onStale={(text) => finish({ kind: "error", text })} />
      )}
      <Panel title="Fila de regulação" sub="por prioridade e ordem de chegada">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {query.isPending && <p className="mono" style={muted}>carregando…</p>}
          {query.isError && <p role="alert" style={alert}>{examError(query.error)}</p>}
          {query.isSuccess && (
            <DataTable<ExamOrder>
              cols={[
                { label: "Prioridade", w: "0.8fr", render: (o) => <Tag tone={o.priority === "urgent" ? "urgent" : undefined}>{PRIORITY_LABEL[o.priority] ?? o.priority}</Tag> },
                { label: "Exame", w: "1.6fr", card: "title", render: (o) => o.label },
                { label: "Paciente", w: "1.3fr", render: (o) => o.patient.display_name },
                { label: "Solicitante", w: "1.2fr", render: (o) => o.requester.name },
                { label: "Unidade", w: "1.1fr", render: (o) => o.unit.name },
                { label: "Desde", w: "1fr", render: (o) => fmtDateTime(o.status_changed_at) },
                { label: "Prazo", w: "1.1fr", render: (o) => overdueLabel(o.overdue) },
                { label: "", w: "auto", align: "right", card: "actions", render: (o) => (
                  <button type="button" aria-label={`Decidir ${o.label} de ${o.patient.display_name}`} style={secondaryButtonStyle}
                    onClick={() => { setNotice(null); setDeciding(o); }}>Decidir</button>
                ) }
              ]}
              rows={orders.filter((o) => !hidden.has(o.id))} rowKey={(o) => o.id} empty="nenhum exame aguardando autorização"
            />
          )}
          {query.hasNextPage && (
            <div><button type="button" style={secondaryButtonStyle} onClick={() => void query.fetchNextPage()}>Carregar mais</button></div>
          )}
        </div>
      </Panel>
    </Frame>
  );
}

function Decision({ order, onDone, onStale, onCancel }: {
  order: ExamOrder; onDone(text: string): void; onStale(text: string): void; onCancel(): void;
}) {
  const providers = useQuery({
    queryKey: [ EXAM_PROVIDER_REFS_KEY, order.sigtap_code ], queryFn: () => listEnabledProviders(order.sigtap_code), retry: false, gcTime: 0, staleTime: 0
  });
  const queryClient = useQueryClient();
  const [ providerId, setProviderId ] = useState("");
  const [ denying, setDenying ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  async function authorize() {
    if (!providerId) { setError("escolha o prestador"); return; }
    setError(null);
    try {
      await authorizeExam(order.id, providerId);
    } catch (err) {
      if (isStale(err)) { onStale(examError(err)); return; }
      if (errorCode(err) === "provider_not_enabled_for_exam") void queryClient.invalidateQueries({ queryKey: [ EXAM_PROVIDER_REFS_KEY ] });
      setError(examError(err));
      return;
    }
    const name = providers.data?.find((p) => p.id === providerId)?.name ?? "o prestador";
    onDone(`Exame autorizado para ${name}.`);
  }

  async function deny(reason: string) {
    try {
      await denyExam(order.id, reason);
    } catch (err) {
      if (isStale(err)) { onStale(examError(err)); return; }
      throw err;
    }
    onDone("Exame negado. Quem pediu vê o aviso no início do painel.");
  }

  return (
    <section aria-label={`Decidir: ${order.label} de ${order.patient.display_name}`} style={box}>
      <strong>{`${order.label} · ${order.sigtap_code}`}</strong>
      <div style={grid}>
        <KeyValue k="Paciente" v={order.patient.display_name} mono={false} />
        <KeyValue k="Prioridade" v={PRIORITY_LABEL[order.priority] ?? order.priority} mono={false} />
        <KeyValue k="CID-10" v={order.cid10_justification ?? "—"} />
        <KeyValue k="Solicitante" v={order.requester.name} mono={false} />
        <KeyValue k="Unidade" v={order.unit.name} mono={false} />
      </div>
      {!denying && (
        <>
          {providers.isPending && <p className="mono" style={muted}>carregando prestadores…</p>}
          {providers.isError && <p role="alert" style={alert}>{examError(providers.error)}</p>}
          {providers.isSuccess && providers.data.length === 0 && (
            <p role="alert" style={alert}>nenhum prestador ativo faz este exame — cadastre em Catálogo e prestadores</p>
          )}
          {providers.isSuccess && providers.data.length > 0 && (
            <label style={fieldLabel}>
              Prestador
              <select value={providerId} style={inputStyle} onChange={(e) => setProviderId(e.target.value)}>
                <option value="">escolha…</option>
                {providers.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {error && <p role="alert" style={alert}>{error}</p>}
          <div style={row}>
            <ActionButton onClick={authorize}>Autorizar</ActionButton>
            <ActionButton variant="danger" onClick={() => setDenying(true)}>Negar</ActionButton>
            <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar</button>
          </div>
        </>
      )}
      {denying && <ReasonForm label="Motivo da negativa" submitLabel="Negar exame" onCancel={() => setDenying(false)} onSubmit={deny} />}
    </section>
  );
}

// Outro regulador decidiu antes (409) ou o exame sumiu (404): fecha, explica e relê.
function isStale(err: unknown): boolean {
  const code = errorCode(err);
  return code === "invalid_transition" || code === "not_found";
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={stack}>
      <PageHeader title="Fila de regulação" sub="exames que exigem autorização" />
      {children}
    </div>
  );
}
