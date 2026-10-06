// Detalhe do pedido (contratos §4.1, §9): o único lugar com a nota livre do
// cidadão. Lido só quando a recepção abre (spec §8).
import { useQuery } from "@tanstack/react-query";
import { ApiError, getRequest } from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { PERIOD_LABEL, PRIORITY_LABEL, REASON_CODE_LABEL, fmtDueOn, requestKindLabel } from "../../lib/scheduling";
import { KeyValue } from "../../components/KeyValue";
import { secondaryButtonStyle } from "../../components/formStyles";

// 404 aqui é sempre o pedido (sumiu entre a fila e o clique); o texto
// genérico do attendanceError não diria o que fazer. Fica local para não
// rotular de "pedido" os outros 404 do atendimento.
function detailError(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return "pedido não encontrado — atualize a fila";
  return attendanceError(err);
}

export function RequestDetailPanel({ requestId, onClose }: { requestId: string; onClose(): void }) {
  const query = useQuery({ queryKey: [ "requestDetail", requestId ], queryFn: () => getRequest(requestId) });
  const d = query.data;
  return (
    <section aria-label="Detalhe do pedido" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16,
      border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Detalhe do pedido</strong>
      {query.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{detailError(query.error)}</p>}
      {query.isPending && <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>}
      {d && (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <KeyValue k="Pedido" v={requestKindLabel(d)} />
          <KeyValue k="Atendimento" v={d.appointment_type_name} />
          <KeyValue k="Prazo" v={fmtDueOn(d.due_on)} />
          <KeyValue k="Prioridade" v={PRIORITY_LABEL[d.priority]} />
          <KeyValue k="Pediu outro horário" v={d.reschedule_count === 1 ? "1 vez" : `${d.reschedule_count} vezes`} />
          {d.reschedule_reason_code && <KeyValue k="Motivo" v={REASON_CODE_LABEL[d.reschedule_reason_code]} />}
          {d.preferred_period && <KeyValue k="Período preferido" v={PERIOD_LABEL[d.preferred_period]} />}
        </div>
      )}
      {d && (
        // Fora do KeyValue (uma linha com reticências): a nota só existe aqui e
        // precisa aparecer inteira.
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: 0.4 }}>
            Nota do cidadão
          </span>
          <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{d.reschedule_note ?? "—"}</p>
        </div>
      )}
      <div><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar detalhes</button></div>
    </section>
  );
}
