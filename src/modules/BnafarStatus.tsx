// "Envio à BNAFAR" (módulo 27b; contrato §3, §7; Q8, Q32, Q40, Q42; F-05, F-06, F-13, F-14, F-23, F-26): a faixa do alerta, o ambiente,
// a última remessa concluída e a lista das remessas por dia e assunto, com o detalhe dos registros, "Reenviar recusados" e "Corrigir".
// Abre com o `bnafar` LIGADO (Q40): com a credencial recusada a faixa aparece. O `room_lead` lê (Q32), mas é papel de sala e não vem na
// sessão: o portão deixa passar e o 403 `missing_role` do api vira a frase do papel. Tudo sem pessoa: leitura ao abrir, depois de cada
// escrita e no "Atualizar"; nenhum polling.
import { useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { errorCode, getBnafarStatus, listBnafarSubmissions, type BnafarSubmission, type BnafarSubmissionStatus, type BnafarSubject } from "../lib/api";
import {
  BNAFAR_NO_ROLE, BNAFAR_STATUS_KEY, BNAFAR_SUBMISSIONS_KEY, STATIC_QUERY, bnafarError, environmentLabel, subjectLabel, submissionStatusLabel,
  submissionStatusTone
} from "../lib/bnafar";
import { fmtDay } from "../lib/exams";
import { fmtDateTime } from "../lib/format";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { KeyValue } from "../components/KeyValue";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, grid, muted, row, stack } from "./exams/styles";
import { AlertBand } from "./bnafar/AlertBand";
import { BnafarGate, type BnafarRoles } from "./bnafar/BnafarGate";
import { SubmissionDetail } from "./bnafar/SubmissionDetail";

const SUBJECTS: BnafarSubject[] = [ "position", "exit" ];
const STATUSES: BnafarSubmissionStatus[] = [ "building", "queued", "sending", "processing", "finished", "failed", "lost" ];
type Filters = { from: string; to: string; subject: "" | BnafarSubject; status: "" | BnafarSubmissionStatus };
const NO_FILTERS: Filters = { from: "", to: "", subject: "", status: "" };

// Só as contagens que não são zero; o perdido conta também (F-05).
function countsText(c: BnafarSubmission["counts"]): string {
  const parts = [
    [ c.accepted, "aceito", "aceitos" ], [ c.rejected, "recusado", "recusados" ], [ c.pending, "aguardando", "aguardando" ], [ c.lost, "perdido", "perdidos" ]
  ] as const;
  const text = parts.filter(([ n ]) => n > 0).map(([ n, one, many ]) => `${n} ${n === 1 ? one : many}`).join(" · ");
  return text || "nenhum registro";
}

export function BnafarStatus({ onGoToSecurity }: {
  onGoToSecurity?: () => void; onGoToLocations?: () => void; onGoToColdChain?: () => void; onGoToVectorProducts?: () => void; onGoToAdjustments?: () => void;
}) {
  return (
    <BnafarGate title="Envio à BNAFAR" sub="situação de cada dia, recusas e prazo de correção" needs="bnafar" allow={() => true}>
      {(roles) => <StatusBody roles={roles} onGoToSecurity={onGoToSecurity} />}
    </BnafarGate>
  );
}

function StatusBody({ roles, onGoToSecurity }: { roles: BnafarRoles; onGoToSecurity?: () => void }) {
  const [ draft, setDraft ] = useState<Filters>(NO_FILTERS);
  const [ applied, setApplied ] = useState<Filters>(NO_FILTERS);
  const [ open, setOpen ] = useState<string | null>(null);

  const status = useQuery({ queryKey: [ BNAFAR_STATUS_KEY ], queryFn: getBnafarStatus, ...STATIC_QUERY });
  const list = useInfiniteQuery({
    queryKey: [ BNAFAR_SUBMISSIONS_KEY, applied ],
    queryFn: ({ pageParam }) => listBnafarSubmissions({
      from: applied.from || undefined, to: applied.to || undefined, subject: applied.subject || undefined, status: applied.status || undefined,
      before: pageParam
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });

  if ([ status.error, list.error ].some((e) => errorCode(e) === "missing_role")) return <EmptyState title={BNAFAR_NO_ROLE} />;

  const rows = (list.data?.pages ?? []).flatMap((p) => p.items);
  const apply = (e: FormEvent) => { e.preventDefault(); setApplied(draft); };
  const refresh = () => { void status.refetch(); void list.refetch(); };
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div style={stack}>
      {status.data && <AlertBand alert={status.data.alert} />}
      {status.isError && <p role="alert" style={alert}>{bnafarError(status.error)}</p>}
      <div style={{ ...row, justifyContent: "space-between", alignItems: "flex-end" }}>
        {status.data ? (
          <div style={grid}>
            <KeyValue k="Ambiente" v={environmentLabel(status.data.environment)} />
            <KeyValue k="Última remessa concluída" v={status.data.alert.last_finished_on ? fmtDay(status.data.alert.last_finished_on) : "nenhuma ainda"} />
          </div>
        ) : status.isPending ? <p className="mono" style={muted}>carregando…</p> : <span />}
        <button type="button" style={secondaryButtonStyle} onClick={refresh}>Atualizar</button>
      </div>

      <Panel title="Remessas" sub="uma por dia e assunto; os últimos dias primeiro">
        <div style={{ ...stack, padding: 16 }}>
          <form aria-label="filtros das remessas" onSubmit={apply} style={{ ...row, alignItems: "flex-end" }}>
            <label style={fieldLabel}>
              De
              <input type="date" value={draft.from} style={inputStyle} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label style={fieldLabel}>
              Até
              <input type="date" value={draft.to} style={inputStyle} onChange={(e) => set({ to: e.target.value })} />
            </label>
            <label style={fieldLabel}>
              Assunto
              <select value={draft.subject} style={inputStyle} onChange={(e) => set({ subject: e.target.value as Filters["subject"] })}>
                <option value="">todos</option>
                {SUBJECTS.map((s) => <option key={s} value={s}>{subjectLabel(s)}</option>)}
              </select>
            </label>
            <label style={fieldLabel}>
              Situação
              <select value={draft.status} style={inputStyle} onChange={(e) => set({ status: e.target.value as Filters["status"] })}>
                <option value="">todas</option>
                {STATUSES.map((s) => <option key={s} value={s}>{submissionStatusLabel(s)}</option>)}
              </select>
            </label>
            <button type="submit" style={buttonStyle}>Filtrar</button>
          </form>

          {list.isPending && <p className="mono" style={muted}>carregando…</p>}
          {list.isError && !list.data && <p role="alert" style={alert}>{bnafarError(list.error)}</p>}
          {list.data && (
            <DataTable<BnafarSubmission>
              label="Remessas à BNAFAR"
              cols={[
                { label: "Dia", w: "0.8fr", card: "title", render: (s) => <span className="mono">{fmtDay(s.reference_on)}</span> },
                { label: "Assunto", w: "1fr", render: (s) => subjectLabel(s.subject) },
                { label: "Situação", w: "1fr", card: "pair", render: (s) => <Tag tone={submissionStatusTone(s.status)}>{submissionStatusLabel(s.status)}</Tag> },
                { label: "Registros", w: "1.4fr", render: (s) => countsText(s.counts) },
                // F-26: quando a remessa foi ENVIADA; nunca "recebida" nem "aceita".
                { label: "Enviada em", w: "1fr", render: (s) => <span className="mono">{fmtDateTime(s.sent_at)}</span> },
                { label: "", w: "auto", card: "actions", render: (s) => (
                  <button type="button" style={secondaryButtonStyle} aria-label={`Ver registros — ${fmtDay(s.reference_on)} ${subjectLabel(s.subject)}`}
                    onClick={() => setOpen(s.id)}>
                    Ver registros
                  </button>
                ) }
              ]}
              rows={rows} rowKey={(s) => s.id} empty="nenhuma remessa no período"
            />
          )}
          {list.data && list.hasNextPage && (
            <div style={row}>
              <button type="button" style={buttonStyle} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
              </button>
            </div>
          )}
        </div>
      </Panel>

      {open && (
        <Panel title="Detalhe da remessa">
          <div style={{ padding: 16 }}>
            <SubmissionDetail key={open} id={open} admin={roles.admin} onGoToSecurity={onGoToSecurity} onClose={() => setOpen(null)} />
          </div>
        </Panel>
      )}
    </div>
  );
}
