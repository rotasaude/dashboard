// Os exames pedidos na consulta com a situação de cada um (módulo 21a; spec
// §9 "status dos exames na consulta"; Divergência D6: filtro consultation_id).
// O pedido sem exame acompanhado (rastreamento ligado depois, ou exame
// cancelado e trocado) aparece "sem acompanhamento".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listExamOrders, type ExamRequest } from "../../lib/api";
import { EXAM_ORDERS_KEY, examError, examStatusLabel, examStatusTone } from "../../lib/exams";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { ExamOrderDetail } from "./ExamOrderDetail";
import { alert, list, row } from "./styles";

export function ConsultationExamStatus({ consultationId, requests }: { consultationId: string; requests: ExamRequest[] }) {
  const query = useQuery({
    queryKey: [ EXAM_ORDERS_KEY, "consultation", consultationId ],
    queryFn: () => listExamOrders({ consultationId }),
    gcTime: 0, staleTime: 0, retry: false
  });
  const [ open, setOpen ] = useState<string | null>(null);
  const byCode = new Map((query.data?.orders ?? []).map((o) => [ o.sigtap_code, o ]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ul aria-label="exames solicitados" style={list}>
        {requests.map((e) => {
          const order = byCode.get(e.sigtap_code);
          return (
            <li key={e.sigtap_code} style={row}>
              <span>{`${e.sigtap_code} — ${e.label}${e.cid10_justification ? ` · CID-10 ${e.cid10_justification}` : ""}`}</span>
              {e.priority === "urgent" && <Tag tone="urgent">urgente</Tag>}
              {order && <Tag tone={examStatusTone(order.status)}>{examStatusLabel(order.status)}</Tag>}
              {!order && query.isSuccess && <Tag>sem acompanhamento</Tag>}
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
