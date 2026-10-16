// src/modules/LabRelease.tsx
// Liberação de laudos (spec §5.7; contrato §5): críticos sem aviso, fila de
// liberação e a conferência. Leitura só ao abrir e depois de cada ação —
// nenhuma releitura automática (as rotas gravam trilha); o contador do menu
// é a rota /count (Task 3).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listReleases, listUnnotifiedCriticals, type LabCriticalRow, type LabReleaseRequisition, type LabReportSummary } from "../lib/api";
import { LAB_CRITICALS_KEY, LAB_RELEASES_KEY, flagLabel, isCritical, labError, refreshLab } from "../lib/lab";
import { fmtDateTime } from "../lib/format";
import type { ModuleId } from "../shell/modules";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { secondaryButtonStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabScope } from "./lab/LabScope";
import { CriticalNoticeForm } from "./lab/CriticalNoticeForm";
import { ReleaseReview } from "./lab/ReleaseReview";
import { useLabContext } from "./lab/useLabContext";
import { alert, muted, okText, row, stack } from "./exams/styles";

export function LabRelease({ onNavigate }: { onNavigate(id: ModuleId): void }) {
  return (
    <LabGate title="Liberação de laudos" sub="laboratório municipal · conferir, assinar e liberar" allow={(r) => r.releaser}>
      {(roles) => <LabScope roles={roles}>{(scope) => <ReleaseBody providerId={scope.providerId} onNavigate={onNavigate} />}</LabScope>}
    </LabGate>
  );
}

function ReleaseBody({ providerId, onNavigate }: { providerId: string; onNavigate(id: ModuleId): void }) {
  const queryClient = useQueryClient();
  const context = useLabContext(true);
  const council = context.data?.council ?? null;
  const queue = useQuery({ queryKey: [ LAB_RELEASES_KEY, providerId ], queryFn: () => listReleases(providerId), gcTime: 0, staleTime: 0, retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false });
  const criticals = useQuery({ queryKey: [ LAB_CRITICALS_KEY ], queryFn: listUnnotifiedCriticals, gcTime: 0, staleTime: 0, retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false });
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ noticeFor, setNoticeFor ] = useState<LabCriticalRow | null>(null);
  const [ message, setMessage ] = useState<{ kind: "ok" | "error"; text: string; pending?: boolean } | null>(null);

  async function after() {
    await refreshLab(queryClient);
  }

  function released(rep: LabReportSummary) {
    setOpenId(null);
    setMessage(rep.status === "pending_signature"
      ? { kind: "ok", text: "Laudo enviado para assinatura ICP — assine em Pendentes de assinatura.", pending: true }
      : { kind: "ok", text: "Laudo liberado com assinatura eletrônica avançada." });
    void after();
  }

  return (
    <div style={stack}>
      {message && (
        <div style={row}>
          <p role={message.kind === "error" ? "alert" : "status"} style={message.kind === "error" ? alert : okText}>{message.text}</p>
          {message.pending && (
            <button type="button" style={secondaryButtonStyle} onClick={() => onNavigate("signature-pending")}>Ir para Pendentes de assinatura</button>
          )}
        </div>
      )}
      <Panel title="Críticos sem aviso" sub="liberados sem o registro de quem foi avisado — registre o aviso">
        {criticals.isError ? <p role="alert" style={alert}>{labError(criticals.error)}</p> : (
          <DataTable<LabCriticalRow>
            cols={[
              { label: "Requisição", w: "1fr", card: "title", render: (c) => <span className="mono">{c.requisition_number}</span> },
              { label: "Paciente", w: "1.4fr", render: (c) => c.patient_display_name },
              { label: "Componente", w: "1.2fr", render: (c) => <>{c.analyte_name} <Tag tone="down">{flagLabel(c.flag)}</Tag></> },
              { label: "Liberado", w: "1fr", render: (c) => fmtDateTime(c.released_at) },
              { label: "Ação", w: "auto", card: "actions", render: (c) => (
                <button type="button" style={secondaryButtonStyle} onClick={() => setNoticeFor(c)}>Registrar aviso</button>
              ) }
            ]}
            rows={criticals.data ?? []} rowKey={(c) => c.result_id} empty={criticals.isPending ? "carregando…" : "nenhum crítico sem aviso"}
          />
        )}
        {noticeFor && (
          <CriticalNoticeForm resultId={noticeFor.result_id} label={noticeFor.analyte_name} onCancel={() => setNoticeFor(null)}
            onDone={() => { setNoticeFor(null); setMessage({ kind: "ok", text: "Aviso registrado." }); void criticals.refetch(); void after(); }} />
        )}
      </Panel>
      <Panel title="Fila de liberação" sub="exames digitados ou recebidos do aparelho, esperando conferência">
        {queue.isError ? <p role="alert" style={alert}>{labError(queue.error)}</p> : (
          <DataTable<LabReleaseRequisition>
            cols={[
              { label: "Requisição", w: "1fr", card: "title", render: (q) => <span className="mono">{q.number}</span> },
              { label: "Paciente", w: "1.6fr", render: (q) => q.patient.display_name },
              { label: "Exames", w: "0.8fr", align: "right", render: (q) => String(q.items.length) },
              { label: "Marcas", w: "1fr", render: (q) => <>{q.urgent && <Tag tone="urgent">urgente</Tag>}{q.items.some((i) => i.results.some((x) => x.effective && isCritical(x.flag))) && <> <Tag tone="down">crítico</Tag></>}</> },
              { label: "Ação", w: "auto", card: "actions", render: (q) => (
                <button type="button" style={secondaryButtonStyle} onClick={() => { setMessage(null); setOpenId(q.id); }}>Conferir</button>
              ) }
            ]}
            rows={queue.data ?? []} rowKey={(q) => q.id} empty={queue.isPending ? "carregando…" : "nada esperando liberação"}
          />
        )}
      </Panel>
      {context.isError && <p role="alert" style={alert}>{labError(context.error)}</p>}
      {openId && !context.isPending && (
        <ReleaseReview key={openId} requisitionId={openId} council={council} onNavigate={onNavigate} onClose={() => setOpenId(null)}
          onReleased={released}
          onConflict={(text) => { setOpenId(null); setMessage({ kind: "error", text }); void queue.refetch(); }} />
      )}
      {!openId && <p style={muted}>abra uma requisição da fila para conferir os valores e liberar o laudo</p>}
    </div>
  );
}
