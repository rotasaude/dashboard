// Revisões (spec §5.6; contrato §3; C-E4/C-E21/C-E22): itens liberados desde a
// última corrida aprovada do aparelho e analito, inclusive laudos ainda
// pendentes de assinatura. Só o RT ou o substituto mantém ou marca para
// retificar, com step-up (C-E39). "Retificar" abre aqui a conferência da
// requisição do 21b (pela `requisition_id`: a lista não traz o laudo), onde a
// retificação acontece. Sem nome de paciente na lista; sem polling.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { decideQcReview, errorCode, listQcReviews, type LabReportSummary, type QcReview } from "../../lib/api";
import { QC_REVIEWS_KEY, RT_ONLY, TEXT_MAX, qcError, refreshQc } from "../../lib/qc";
import { refreshLab } from "../../lib/lab";
import { fmtDateTime } from "../../lib/format";
import type { ModuleId } from "../../shell/modules";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ReleaseReview } from "../lab/ReleaseReview";
import { useLabContext } from "../lab/useLabContext";
import { alert, fieldLabel, muted, okText, row, stack } from "../exams/styles";

type Decision = "kept" | "rectify";

export function ReviewsPanel({ providerId, lead, analyte, instrument, onNavigate, onGoToSecurity }: {
  providerId: string; lead: boolean; analyte(key: string): string; instrument(id: string): string;
  onNavigate(id: ModuleId): void; onGoToSecurity?(): void;
}) {
  const queryClient = useQueryClient();
  const context = useLabContext(true);
  const reviews = useQuery({
    queryKey: [ QC_REVIEWS_KEY, providerId ], queryFn: () => listQcReviews(providerId), gcTime: 0, staleTime: 0, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false
  });
  const [ deciding, setDeciding ] = useState<{ review: QcReview; decision: Decision } | null>(null);
  const [ note, setNote ] = useState("");
  const [ confirming, setConfirming ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ rectifyFor, setRectifyFor ] = useState<string | null>(null);
  const rows = reviews.data ?? [];
  const refresh = () => { void refreshQc(queryClient).catch(() => undefined); };

  function start(review: QcReview, decision: Decision) {
    setDeciding({ review, decision });
    setNote("");
    setConfirming(false);
    setError(null);
    setNotice(null);
  }

  function review() {
    if (note.trim().length > TEXT_MAX) { setError(`a nota: no máximo ${TEXT_MAX} caracteres`); return; }
    setError(null);
    setConfirming(true);
  }

  const failed = (err: unknown) => {
    const code = errorCode(err);
    if (code === "not_found" || code === "invalid_transition") {
      refresh(); setDeciding(null); setConfirming(false);
      setError(qcError(err)); // o painel fecha, então a frase fica aqui
    }
    return qcError(err);
  };

  function decided() {
    if (!deciding) return;
    if (deciding.decision === "rectify" && deciding.review.released_at === null) {
      // C-E22: laudo ainda pendente de assinatura; não há laudo liberado para retificar.
      setNotice(`Marcado para retificar — o laudo da requisição ${deciding.review.requisition_number} ainda aguarda assinatura; retifique depois que ele for assinado e liberado.`);
    } else if (deciding.decision === "rectify") {
      setRectifyFor(deciding.review.requisition_id);
      setNotice(`Marcado para retificar — a conferência da requisição ${deciding.review.requisition_number} abriu abaixo.`);
    } else {
      setNotice("Resultado mantido.");
    }
    setDeciding(null);
    setConfirming(false);
    setNote("");
    refresh();
  }

  function rectified(rep: LabReportSummary) {
    setRectifyFor(null);
    setNotice(rep.status === "pending_signature"
      ? "Laudo retificado enviado para assinatura ICP — assine em Pendentes de assinatura."
      : "Laudo retificado liberado.");
    void refreshLab(queryClient).catch(() => undefined);
  }

  const verb = deciding?.decision === "kept" ? "manter" : "retificar";

  return (
    <Panel title="Revisões pendentes" sub="liberados desde a última corrida aprovada do aparelho e analito reprovados">
      <div style={stack}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {reviews.isError ? <p role="alert" style={alert}>{qcError(reviews.error)}</p> : (
          <DataTable<QcReview>
            cols={[
              { label: "Requisição", w: "1fr", card: "title", render: (r) => <span className="mono">{r.requisition_number}</span> },
              { label: "Exame", w: "1.2fr", render: (r) => r.exam_label },
              { label: "Aparelho · analito", w: "1.4fr", render: (r) => `${instrument(r.instrument_id)} · ${analyte(r.analyte_key)}` },
              { label: "Liberado", w: "1fr", render: (r) => fmtDateTime(r.released_at) },
              { label: "", w: "auto", card: "actions", render: (r) => (lead ? (
                <div style={row}>
                  <button type="button" style={secondaryButtonStyle} onClick={() => start(r, "kept")}>Manter</button>
                  <button type="button" style={secondaryButtonStyle} onClick={() => start(r, "rectify")}>Retificar</button>
                </div>
              ) : null) }
            ]}
            rows={rows} rowKey={(r) => r.id} empty={reviews.isPending ? "carregando…" : "nenhuma revisão pendente"}
          />
        )}
        {!lead && rows.length > 0 && <p style={muted}>{RT_ONLY}</p>}
        {deciding && (
          <div style={stack}>
            <p style={muted}>{`Requisição ${deciding.review.requisition_number} · ${deciding.review.exam_label}`}</p>
            <fieldset disabled={confirming} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <label style={fieldLabel}>Nota (opcional)
                <textarea value={note} rows={2} style={inputStyle} onChange={(e) => setNote(e.target.value)} />
              </label>
            </fieldset>
            {error && <p role="alert" style={alert}>{error}</p>}
            {!confirming && (
              <div style={row}>
                <button type="button" style={buttonStyle} onClick={review}>{`Revisar e ${verb}`}</button>
                <button type="button" style={secondaryButtonStyle} onClick={() => setDeciding(null)}>Cancelar</button>
              </div>
            )}
            {confirming && (
              <SensitiveAction title={deciding.decision === "kept" ? "Manter o resultado liberado" : "Marcar para retificar"}
                description={deciding.decision === "kept"
                  ? "O resultado liberado fica como está e a revisão é encerrada."
                  : "A revisão é encerrada e a conferência da requisição abre para retificar o laudo."}
                requiresStepUp confirmLabel={`Confirmar: ${verb}`}
                run={async () => {
                  const trimmed = note.trim();
                  await decideQcReview(deciding.review.id, { decision: deciding.decision, ...(trimmed ? { note: trimmed } : {}) });
                }}
                onDone={decided} onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={failed} />
            )}
          </div>
        )}
        {!deciding && error && <p role="alert" style={alert}>{error}</p>}
        {rectifyFor && !context.isPending && (
          <ReleaseReview key={rectifyFor} requisitionId={rectifyFor} council={context.data?.council ?? null} onNavigate={onNavigate}
            onClose={() => setRectifyFor(null)} onReleased={rectified} onConflict={(text) => { setRectifyFor(null); setNotice(null); setError(text); }} />
        )}
      </div>
    </Panel>
  );
}
