// Detalhe de uma remessa à BNAFAR (módulo 27b; contrato §3, §7; Q8, Q16, Q25, Q42, Q44; F-06, F-07, F-23, F-26, F-34): os protocolos
// por operação, os registros paginados (50, `before`, "Carregar mais") com o filtro de situação, o motivo de cada recusa e o prazo do api.
// "Reenviar recusados" (só o admin, step-up) depende das contagens da remessa, não da página (F-23); o 409 decide a janela. Nenhuma conta de
// prazo aqui: `retry_until` e `correct_until` aparecem como vieram, só formatados.
import { useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBnafarDomains, getBnafarSubmission, retryBnafarSubmission, type BnafarRecord } from "../../lib/api";
import {
  BNAFAR_DOMAINS_KEY, BNAFAR_STATUS_KEY, BNAFAR_SUBMISSIONS_KEY, BNAFAR_SUBMISSION_KEY, STATIC_QUERY, bnafarError, bnafarErrorText,
  bnafarErrorTexts, canResend, isStale, recordStatusLabel, recordStatusTone, subjectLabel, submissionStatusLabel, submissionStatusTone
} from "../../lib/bnafar";
import { fmtDay } from "../../lib/exams";
import { fmtDateTime } from "../../lib/format";
import { DataTable } from "../../components/DataTable";
import { KeyValue } from "../../components/KeyValue";
import { SensitiveAction } from "../../components/SensitiveAction";
import { Tag } from "../../components/Tag";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, grid, list, muted, okText, row, stack, title } from "../exams/styles";
import { CORRECTION_SENT, CorrectionForm } from "./CorrectionForm";

// Frases (proposta).
const RESEND_DESCRIPTION = "Remonta e reenvia só os registros recusados desta remessa, com os dados corrigidos.";
const RESEND_STALE = [ "retry_window_closed", "nothing_to_retry" ];
const resentText = (n: number): string => n === 1 ? "1 registro recusado reenviado à BNAFAR." : `${n} registros recusados reenviados à BNAFAR.`;
const OPERATION: Record<string, string> = { post: "envio", put: "correção", delete: "exclusão" };
const operationLabel = (op: string): string => OPERATION[op] ?? op;
type RecordFilter = "" | "pending" | "accepted" | "rejected";

// Q8/Q44: só a saída externa aceita, não excluída, dentro do prazo do api e com a saída apontada.
export const isCorrectable = (r: BnafarRecord): boolean =>
  !!r.stock_external_exit_id && r.status === "accepted" && !r.lost && !r.deleted && !!r.correct_until;

// Perdido: o `lost_reason` na frente (o primeiro código que não é a MSG47, ou `not_sent`); senão os códigos do registro, sem repetir a frase.
const reasonTexts = (r: BnafarRecord): string[] =>
  bnafarErrorTexts(r.lost && r.lost_reason ? [ r.lost_reason, ...r.error_codes ] : r.error_codes);

function deadline(r: BnafarRecord): string {
  if (r.status === "rejected" && !r.lost && r.retry_until) return `reenviar até ${fmtDateTime(r.retry_until)}`;
  if (r.correct_until) return `corrigir até ${fmtDateTime(r.correct_until)}`;
  return "—";
}

export function SubmissionDetail({ id, admin, onGoToSecurity, onClose }: {
  id: string; admin: boolean; onGoToSecurity?(): void; onClose(): void;
}) {
  const client = useQueryClient();
  const [ filter, setFilter ] = useState<RecordFilter>("");
  const [ resending, setResending ] = useState(false);
  const [ editing, setEditing ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ stale, setStale ] = useState<string | null>(null);
  const retried = useRef(0);

  const detail = useInfiniteQuery({
    queryKey: [ BNAFAR_SUBMISSION_KEY, id, filter ],
    queryFn: ({ pageParam }) => getBnafarSubmission(id, { status: filter || undefined, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const pages = detail.data?.pages ?? [];
  const head = pages[0];
  const records = pages.flatMap((p) => p.records);
  const anyCorrectable = admin && records.some(isCorrectable);
  const domains = useQuery({ queryKey: [ BNAFAR_DOMAINS_KEY ], queryFn: getBnafarDomains, enabled: anyCorrectable, ...STATIC_QUERY });
  const editRecord = editing ? records.find((r) => r.id === editing && isCorrectable(r)) ?? null : null;

  // Depois de cada escrita (ou do 409): uma releitura do detalhe, da lista e do status.
  const reread = () => {
    void client.invalidateQueries({ queryKey: [ BNAFAR_SUBMISSION_KEY, id ] });
    void client.invalidateQueries({ queryKey: [ BNAFAR_SUBMISSIONS_KEY ] });
    void client.invalidateQueries({ queryKey: [ BNAFAR_STATUS_KEY ] });
  };
  const clear = () => { setNotice(null); setStale(null); };

  async function resend() {
    try {
      retried.current = (await retryBnafarSubmission(id)).retried;
    } catch (err) {
      const code = RESEND_STALE.find((c) => isStale(err, c));
      if (code) { setResending(false); setStale(bnafarErrorText(code)); reread(); }
      throw err;
    }
  }

  if (detail.isPending) return <p className="mono" style={muted}>carregando a remessa…</p>;
  if (detail.isError || !head) return <p role="alert" style={alert}>{bnafarError(detail.error)}</p>;

  const showResend = canResend(head, admin);
  return (
    <section aria-label={`Remessa ${fmtDay(head.reference_on)} ${subjectLabel(head.subject)}`} style={stack}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <h3 style={title}>{`Remessa de ${fmtDay(head.reference_on)} — ${subjectLabel(head.subject)}`}</h3>
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar remessa</button>
      </div>
      <div style={grid}>
        <KeyValue k="Situação" v={<Tag tone={submissionStatusTone(head.status)}>{submissionStatusLabel(head.status)}</Tag>} />
        <KeyValue k="Enviada em" v={fmtDateTime(head.sent_at)} />
        <KeyValue k="Concluída em" v={fmtDateTime(head.finished_at)} />
        <KeyValue k="Tentativas" v={String(head.attempts)} />
        {head.last_error && <KeyValue k="Último erro" mono={false} v={bnafarErrorText(head.last_error)} />}
        {showResend && <KeyValue k="Prazo do reenvio" v={fmtDateTime(head.retry_until)} />}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={muted}>Protocolos</span>
        {head.batches.length === 0 ? <p style={muted}>nenhum protocolo ainda</p> : (
          <ul style={list}>
            {head.batches.map((b, i) => (
              <li key={`${b.operation}-${b.protocol ?? i}`}>
                {`${operationLabel(b.operation)} · ${submissionStatusLabel(b.status)} · `}
                {b.protocol ? <span className="mono">{b.protocol}</span> : <span>sem protocolo ainda</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {notice && <p role="status" style={okText}>{notice}</p>}
      {stale && <p role="alert" style={alert}>{stale}</p>}

      {showResend && !resending && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => { clear(); setEditing(null); setResending(true); }}>Reenviar recusados</button>
        </div>
      )}
      {showResend && resending && (
        <SensitiveAction
          title="Reenviar recusados"
          description={RESEND_DESCRIPTION}
          requiresStepUp
          confirmLabel="Confirmar reenvio"
          run={resend}
          onDone={() => { setResending(false); setNotice(resentText(retried.current)); reread(); }}
          onCancel={() => setResending(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => bnafarError(err, { write: true })}
        />
      )}

      {editRecord && (
        <CorrectionForm key={editRecord.id} record={editRecord} domains={domains.data} onGoToSecurity={onGoToSecurity}
          onCancel={() => setEditing(null)}
          onDone={() => { setEditing(null); setStale(null); setNotice(CORRECTION_SENT); reread(); }}
          onStale={(text) => { setNotice(null); setStale(text); reread(); }} />
      )}

      <label style={{ ...fieldLabel, maxWidth: 240 }}>
        Registros da remessa
        <select value={filter} style={inputStyle} onChange={(e) => setFilter(e.target.value as RecordFilter)}>
          <option value="">todos</option>
          <option value="rejected">só recusados</option>
          <option value="accepted">só aceitos</option>
          <option value="pending">só aguardando</option>
        </select>
      </label>
      <DataTable<BnafarRecord>
        label="Registros"
        cols={[
          { label: "Local", w: "1.2fr", render: (r) => r.location_name },
          { label: "Item", w: "1.4fr", card: "title", render: (r) => r.item_label },
          { label: "Situação", w: "1fr", card: "pair", render: (r) => <Tag tone={recordStatusTone(r)}>{recordStatusLabel(r)}</Tag> },
          { label: "Motivo", w: "2fr", render: (r) => {
            const texts = reasonTexts(r);
            return texts.length === 0 ? "—" : <ul style={list}>{texts.map((t) => <li key={t}>{t}</li>)}</ul>;
          } },
          { label: "Prazo", w: "1.2fr", render: (r) => <span className="mono">{deadline(r)}</span> },
          { label: "", w: "auto", card: "actions", render: (r) => (admin && isCorrectable(r) ? (
            <button type="button" style={secondaryButtonStyle} aria-label={`Corrigir — ${r.item_label}`}
              onClick={() => { clear(); setResending(false); setEditing(r.id); }}>
              Corrigir
            </button>
          ) : null) }
        ]}
        rows={records} rowKey={(r) => r.id} empty="nenhum registro nesta remessa"
      />
      {detail.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={detail.isFetchingNextPage} aria-label="Carregar mais registros"
            onClick={() => void detail.fetchNextPage()}>
            {detail.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </section>
  );
}
