// Detalhe do pedido (contratos §4.1, §9): o único lugar com a nota livre do
// cidadão. Lido só quando a recepção abre (spec §8).
import { useQuery } from "@tanstack/react-query";
import { getRequest } from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { PERIOD_LABEL, PRIORITY_LABEL, REASON_CODE_LABEL, fmtDueOn, requestKindLabel } from "../../lib/scheduling";
import { KeyValue } from "../../components/KeyValue";
import { secondaryButtonStyle } from "../../components/formStyles";

export function RequestDetailPanel({ requestId, onClose }: { requestId: string; onClose(): void }) {
  const query = useQuery({ queryKey: [ "requestDetail", requestId ], queryFn: () => getRequest(requestId) });
  const d = query.data;
  return (
    <section aria-label="Detalhe do pedido" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16,
      border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Detalhe do pedido</strong>
      {query.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{attendanceError(query.error)}</p>}
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
          <KeyValue k="Nota do cidadão" v={d.reschedule_note ?? "—"} />
        </div>
      )}
      <div><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar detalhes</button></div>
    </section>
  );
}
