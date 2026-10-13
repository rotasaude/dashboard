// src/modules/documents/CancelDocument.tsx
// Cancelar um documento clínico (módulo 19c; spec §6; contrato §3): só a
// autora, motivo de 10 a 500 caracteres (contados como o api conta), step-up
// (o SensitiveAction é o único que conhece o código). O motivo vai no corpo do
// POST. O documento fica no histórico como cancelado e a página de conferência
// passa a dizer "cancelado"; a assinatura pendente sai da fila no api.
// 409 already_cancelled = outra aba já cancelou: quem chama relê e fecha.
// Módulo 19d: receita com número SNCR avisa que o SNCR não cancela (o número
// fica anulado); o registro da Notificação de papel também leva o aviso da receita.
import { useRef } from "react";
import { cancelDocument, errorCode, type ClinicalDocument } from "../../lib/api";
import { CANCEL_WARNING, cancelReasonProblem, documentError, kindLabel } from "../../lib/clinicalDocuments";
import { SNCR_NO_CANCEL_NOTE, documentSncr } from "../../lib/controlled";
import { fmtDateTime } from "../../lib/format";
import { SensitiveAction } from "../../components/SensitiveAction";

// A lista de declarações (api#59) só tem metadados: id, tipo e emissão bastam.
type CancelTarget = Pick<ClinicalDocument, "id" | "kind" | "issued_at"> & Partial<ClinicalDocument>;

interface Props {
  doc: CancelTarget;
  // api#59: a recepção cancela declarações da unidade escolhida no seletor.
  healthUnitId?: string;
  reissue: boolean;
  onDone(cancelled: ClinicalDocument): void;
  // Recebe a frase da recusa (o painel fecha; quem chama a mostra e relê).
  onStale(message: string): void;
  onCancel(): void;
  onGoToSecurity?(): void;
}

// Recusa local (motivo fora da faixa): nada vai ao servidor.
class ReasonProblem extends Error {}

export function CancelDocument({ doc, healthUnitId, reissue, onDone, onStale, onCancel, onGoToSecurity }: Props) {
  const result = useRef<ClinicalDocument | null>(null);
  const inFlight = useRef(false);
  return (
    <SensitiveAction
      title={`${reissue ? "Cancelar e emitir outro" : "Cancelar"}: ${kindLabel(doc.kind)} de ${fmtDateTime(doc.issued_at)}`}
      description={(
        <>
          <p style={text}>
            O documento fica no histórico como cancelado e a página de conferência passa a dizer "cancelado". Se a assinatura digital
            ainda estiver na fila, ela sai da fila.
          </p>
          {(doc.kind === "prescription" || doc.kind === "controlled_notification_record") && (
            <p style={{ ...text, fontWeight: 600 }}>{CANCEL_WARNING}</p>
          )}
          {doc.content && documentSncr(doc as ClinicalDocument) && <p style={{ ...text, fontWeight: 600 }}>{SNCR_NO_CANCEL_NOTE}</p>}
          {reissue && <p style={text}>Depois do cancelamento, um documento novo abre preenchido com os mesmos dados, para você conferir e emitir.</p>}
        </>
      )}
      requiresStepUp
      fields={[ { name: "reason", label: "Motivo do cancelamento", required: true } ]}
      confirmLabel={reissue ? "Cancelar e abrir o novo" : "Confirmar cancelamento"}
      run={async (values) => {
        // Duplo envio: o segundo não chama o api (e o onDone dele não faz nada).
        if (inFlight.current) return;
        const problem = cancelReasonProblem(values.reason);
        if (problem) throw new ReasonProblem(problem);
        inFlight.current = true;
        try {
          result.current = await cancelDocument(doc.id, values.reason.trim(), ...(healthUnitId ? [ healthUnitId ] : []));
        } finally {
          inFlight.current = false;
        }
      }}
      onDone={() => { if (result.current) onDone(result.current); }}
      onCancel={onCancel}
      onGoToSecurity={onGoToSecurity}
      translateError={(err) => {
        if (err instanceof ReasonProblem) return err.message;
        const code = errorCode(err);
        if (code === "already_cancelled") onStale(documentError(err));
        return code ? documentError(err) : null;
      }}
    />
  );
}

const text = { margin: 0 };
