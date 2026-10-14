// Os exames pedidos na consulta com a situação de cada um (módulo 21a; spec
// §9 "status dos exames na consulta"; Divergência D6: filtro consultation_id).
// O pedido sem exame acompanhado (rastreamento ligado depois, ou exame
// cancelado e trocado) aparece "sem acompanhamento".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listExamOrders, type ExamOrder, type ExamRequest } from "../../lib/api";
import { EXAM_ORDERS_KEY, examError, examStatusLabel, examStatusTone } from "../../lib/exams";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { ExamOrderDetail } from "./ExamOrderDetail";
import { alert, list, muted, row } from "./styles";

// Um mesmo código pode ter mais de uma ordem (cancelada e pedida de novo por adendo):
// vale a não cancelada; entre várias, a de mudança de situação mais recente.
function pickOrders(orders: ExamOrder[]): Map<string, ExamOrder> {
  const best = new Map<string, ExamOrder>();
  const rank = (o: ExamOrder) => (o.status === "cancelled" ? 0 : 1);
  for (const o of orders) {
    const cur = best.get(o.sigtap_code);
    if (!cur || rank(o) > rank(cur) || (rank(o) === rank(cur) && Date.parse(o.status_changed_at) > Date.parse(cur.status_changed_at))) best.set(o.sigtap_code, o);
  }
  return best;
}

export function ConsultationExamStatus({ consultationId, requests }: { consultationId: string; requests: ExamRequest[] }) {
  const query = useQuery({
    queryKey: [ EXAM_ORDERS_KEY, "consultation", consultationId ],
    queryFn: () => listExamOrders({ consultationId }),
    gcTime: 0, staleTime: 0, retry: false
  });
  const [ open, setOpen ] = useState<string | null>(null);
  const orders = query.data?.orders ?? [];
  const claimed = new Set(requests.map((r) => r.id).filter(Boolean));
  const byCode = pickOrders(orders.filter((o) => !o.consultation_exam_request_id || !claimed.has(o.consultation_exam_request_id)));
  // Pedido com id: a ordem ligada a ele. Sem id (exame de adendo): heurística por código.
  const orderFor = (e: ExamRequest) => (e.id ? orders.find((o) => o.consultation_exam_request_id === e.id) : byCode.get(e.sigtap_code));
  const truncated = query.data?.next_before != null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ul aria-label="exames solicitados" style={list}>
        {requests.map((e, i) => {
          const order = orderFor(e);
          return (
            <li key={e.id ?? `${e.sigtap_code}-${i}`} style={row}>
              <span>{`${e.sigtap_code} — ${e.label}${e.cid10_justification ? ` · CID-10 ${e.cid10_justification}` : ""}`}</span>
              {e.priority === "urgent" && <Tag tone="urgent">urgente</Tag>}
              {order && <Tag tone={examStatusTone(order.status)}>{examStatusLabel(order.status)}</Tag>}
              {!order && query.isSuccess && !truncated && <Tag>sem acompanhamento</Tag>}
              {!order && query.isSuccess && truncated && <small style={muted}>veja na tela Exames</small>}
              {order && (
                <button type="button" aria-label={`Acompanhar ${e.label}`} style={secondaryButtonStyle} onClick={() => setOpen(order.id)}>
                  Acompanhar
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {query.isError && <p role="alert" style={alert}>{examError(query.error)}</p>}
      {open && <ExamOrderDetail key={open} id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
