// src/modules/LabRelease.tsx
// Liberação de laudos (spec §5.7; contrato §5): críticos sem aviso, fila de
// liberação e a conferência. Leitura só ao abrir e depois de cada ação —
// nenhuma releitura automática (as rotas gravam trilha); o contador do menu
// é a rota /count (Task 3).
import { useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { listLabRequisitions, listReleases, listUnnotifiedCriticals, type LabCriticalRow, type LabReleaseRequisition, type LabReportSummary } from "../lib/api";
import { LAB_CRITICALS_KEY, LAB_RELEASES_KEY, flagLabel, isCritical, labError, lookupKind, refreshLab } from "../lib/lab";
import { fmtDateTime } from "../lib/format";
import { PENDING_KEY } from "../lib/signature";
import type { ModuleId } from "../shell/modules";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabScope } from "./lab/LabScope";
import { CriticalNoticeForm } from "./lab/CriticalNoticeForm";
import { ReleaseReview } from "./lab/ReleaseReview";
import { useLabContext } from "./lab/useLabContext";
import { alert, fieldLabel, muted, okText, row, stack } from "./exams/styles";

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
  const criticals = useInfiniteQuery({
    queryKey: [ LAB_CRITICALS_KEY ], queryFn: ({ pageParam }) => listUnnotifiedCriticals({ after: pageParam }),
    initialPageParam: null as string | null, getNextPageParam: (last) => last.next_after ?? undefined,
    gcTime: 0, staleTime: 0, retry: false, refetchOnReconnect: false, refetchOnWindowFocus: false
  });
  // Sem repetidos entre páginas (a lista pode andar entre uma busca e outra).
  const criticalRows = [ ...new Map((criticals.data?.pages.flatMap((p) => p.criticals) ?? []).map((c) => [ c.result_id, c ])).values() ];
  const loadingMore = useRef(false);
  async function loadMoreCriticals() {
    if (loadingMore.current) return;
    loadingMore.current = true;
    try { await criticals.fetchNextPage(); } finally { loadingMore.current = false; }
  }
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ noticeFor, setNoticeFor ] = useState<LabCriticalRow | null>(null);
  const [ message, setMessage ] = useState<{ kind: "ok" | "error"; text: string; pending?: boolean } | null>(null);

  const [ number, setNumber ] = useState("");
  const [ searchError, setSearchError ] = useState<string | null>(null);
  const searching = useRef(false);

  // Busca pelo número (8 dígitos) ou pela etiqueta (10) — B16. Cada leitura grava trilha: uma por vez.
  async function findReleased() {
    if (searching.current) return;
    const text = number.trim();
    const kind = lookupKind(text);
    if (!kind) { setSearchError("informe o número da requisição (8 dígitos) ou o código de barras (10 dígitos)"); return; }
    searching.current = true;
    setSearchError(null);
    try {
      const page = await listLabRequisitions({ providerId, [kind]: text, before: null });
      const found = page.requisitions[0];
      if (!found) { setSearchError("nenhuma requisição com este número neste laboratório"); return; }
      setMessage(null);
      setOpenId(found.id);
    } catch (err) {
      setSearchError(labError(err));
    } finally { searching.current = false; }
  }

  async function after() {
    await refreshLab(queryClient);
  }

  function released(rep: LabReportSummary) {
    setOpenId(null);
    const what = rep.replaces_report_id ? "Laudo retificado" : "Laudo";
    setMessage(rep.status === "pending_signature"
      ? { kind: "ok", text: `${what} enviado para assinatura ICP — assine em Pendentes de assinatura.`, pending: true }
      : { kind: "ok", text: `${what} liberado com assinatura eletrônica avançada.` });
    // O laudo ICP entra em Pendentes de assinatura: lista e contador do menu releem.
    if (rep.status === "pending_signature") void queryClient.invalidateQueries({ queryKey: [ PENDING_KEY ] });
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
        {criticals.isError && !criticals.data ? <p role="alert" style={alert}>{labError(criticals.error)}</p> : (
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
            rows={criticalRows} rowKey={(c) => c.result_id} empty={criticals.isPending ? "carregando…" : "nenhum crítico sem aviso"}
          />
        )}
        {criticals.isError && criticals.data && <p role="alert" style={alert}>{labError(criticals.error)}</p>}
        {criticals.hasNextPage && (
          <div><button type="button" style={secondaryButtonStyle} disabled={criticals.isFetchingNextPage} onClick={() => void loadMoreCriticals()}>Carregar mais</button></div>
        )}
        {noticeFor && (
          <CriticalNoticeForm key={noticeFor.result_id} resultId={noticeFor.result_id} label={noticeFor.analyte_name} onCancel={() => setNoticeFor(null)}
            onDone={() => { setNoticeFor(null); setMessage({ kind: "ok", text: "Aviso registrado." }); void after(); }} />
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
      <Panel title="Laudo já liberado" sub="abrir os laudos de uma requisição para ver ou retificar">
        <div style={{ ...row, alignItems: "flex-end" }}>
          <label style={fieldLabel}>
            Número da requisição
            <input value={number} inputMode="numeric" style={inputStyle} onChange={(e) => { setNumber(e.target.value); setSearchError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void findReleased(); } }} />
          </label>
          <button type="button" style={secondaryButtonStyle} onClick={() => void findReleased()}>Abrir</button>
        </div>
        {searchError && <p role="alert" style={alert}>{searchError}</p>}
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
