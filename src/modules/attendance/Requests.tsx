import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dismissRequest, errorCode, listUnitRequests, type HealthUnit, type RequestRow } from "../../lib/api";
import { ATTENDANCE_REFETCH_MS, attendanceError } from "../../lib/attendance";
import { PRIORITY_LABEL, fmtDueOn, requestKindLabel, requestMarks } from "../../lib/scheduling";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { RequestDetailPanel } from "./RequestDetailPanel";
import { BookPanel, availabilityKey } from "./BookPanel";

// Requests (Task 8) — pedidos de agendamento abertos da unidade (spec §6
// "Pedidos de agendamento"). "Marcar horário" abre o BookPanel (vagas por dia e
// profissional; marcação livre só em dia sem turno).
// `request_not_open` em qualquer uma das duas ações (outro atendente já
// marcou/encerrou o pedido) recarrega a lista em vez de mostrar erro parado.
// A fila vem na ordem do api (atrasados, prazo, prioridade; módulo 17) e a tela
// não reordena. Pedido já marcado que precisa remarcar (`appointment` não nulo)
// não oferece "Encerrar pedido": o api recusa com request_not_open e a linha
// voltaria igual.
interface Props {
  unit: HealthUnit;
}

export function Requests({ unit }: Props) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ "unitRequests", unit.id ], queryFn: () => listUnitRequests(unit.id),
    refetchInterval: ATTENDANCE_REFETCH_MS
  });
  const [ scheduling, setScheduling ] = useState<RequestRow | null>(null);
  const [ dismissing, setDismissing ] = useState<RequestRow | null>(null);
  const [ detail, setDetail ] = useState<RequestRow | null>(null);

  function invalidateRequests() {
    void queryClient.invalidateQueries({ queryKey: [ "unitRequests", unit.id ] });
  }
  function invalidateAll() {
    invalidateRequests();
    void queryClient.invalidateQueries({ queryKey: [ "unitAgenda", unit.id ] });
    void queryClient.invalidateQueries({ queryKey: availabilityKey(unit.id) });
  }

  const rows = query.data ?? [];

  return (
    <Panel title="Pedidos de agendamento">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {query.isError && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{attendanceError(query.error)}</p>
        )}

        {!query.isError && (
          query.isPending ? (
            <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
          ) : rows.length === 0 ? (
            <EmptyState title="nenhum pedido aberto" />
          ) : (
            <DataTable<RequestRow>
              cols={[
                { label: "Pedido", w: "1.5fr", render: (r) => requestKindLabel(r) },
                { label: "Atendimento", w: "1.5fr", render: (r) => r.appointment_type_name },
                { label: "CPF", w: "1.5fr", render: (r) => r.cpf_masked },
                { label: "Prazo", w: "1fr", render: (r) => fmtDueOn(r.due_on) },
                { label: "Prioridade", w: "1fr", render: (r) =>
                  <Tag tone={r.priority === "priority" ? "warn" : "neutral"}>{PRIORITY_LABEL[r.priority]}</Tag> },
                { label: "Nota", w: "2fr", render: (r) => r.note ?? "—" },
                { label: "Marcas", w: "2fr", render: (r) => {
                  const marks = requestMarks(r);
                  if (marks.length === 0) return "—";
                  return (
                    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {marks.map((m) => <Tag key={m.label} tone={m.tone}>{m.label}</Tag>)}
                    </span>
                  );
                } },
                {
                  label: "", w: "auto", align: "right", render: (r) => (
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button type="button" style={secondaryButtonStyle} onClick={() => setDetail(r)}>Detalhes</button>
                      <button type="button" style={secondaryButtonStyle} onClick={() => setScheduling(r)}>
                        Marcar horário
                      </button>
                      {r.appointment === null && (
                        <button type="button" style={secondaryButtonStyle} onClick={() => setDismissing(r)}>
                          Encerrar pedido
                        </button>
                      )}
                    </div>
                  )
                }
              ]}
              rows={rows}
              rowKey={(r) => r.id}
            />
          )
        )}

        {detail && <RequestDetailPanel key={detail.id} requestId={detail.id} onClose={() => setDetail(null)} />}

        {scheduling && (
          <BookPanel
            key={`s-${scheduling.id}`}
            row={scheduling}
            unit={unit}
            onCancel={() => setScheduling(null)}
            onDone={() => { setScheduling(null); invalidateAll(); }}
          />
        )}

        {dismissing && (
          <DismissPanel
            key={`d-${dismissing.id}`}
            row={dismissing}
            unit={unit}
            onCancel={() => setDismissing(null)}
            onDone={() => { setDismissing(null); invalidateRequests(); }}
          />
        )}
      </div>
    </Panel>
  );
}

function DismissPanel(
  { row, unit, onCancel, onDone }: { row: RequestRow; unit: HealthUnit; onCancel(): void; onDone(): void }
) {
  const [ reason, setReason ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const valid = reason.trim().length >= 10;

  async function confirm() {
    if (busy || !valid) return;
    setBusy(true); setError(null);
    try {
      await dismissRequest(row.id, reason, unit.id);
      onDone();
    } catch (err) {
      if (errorCode(err) === "request_not_open") { onDone(); return; }
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Encerrar pedido</strong>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <label style={labelStyle}>
        Justificativa
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 60 }}
          aria-describedby="dismiss-reason-notice" />
      </label>
      <FrozenTextNotice id="dismiss-reason-notice" />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void confirm()}
          style={(!valid || busy) ? disabledButtonStyle : buttonStyle}
        >
          Confirmar encerramento
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
