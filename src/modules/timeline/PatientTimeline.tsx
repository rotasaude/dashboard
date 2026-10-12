// src/modules/timeline/PatientTimeline.tsx
// Linha do tempo da pessoa no painel da cidade (módulo 20, F-20.3; spec §4,
// §5 e §8; contrato §2–§3). Lista cronológica na ordem do api, filtros por
// tipo e período, "Carregar mais" pelo cursor e o detalhe nas telas que já
// existem. Toda leitura gera trilha no api; aqui nada fica guardado
// (gcTime: 0). Pela abertura justificada, opening_required (e out_of_context)
// encerra a leitura em quem chamou.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getTimeline, type TimelineEntry, type TimelineFilters, type TimelineSubject } from "../../lib/api";
import {
  ALL_FILTERS, EMPTY_DRAFT, PARTIAL_NOTICE, TIMELINE_EMPTY, TIMELINE_KEY, TIMELINE_KINDS, detailTarget, endsOpening, entryWhen,
  entryWhere, filterProblem, filtersFrom, mergePages, openLabel, statusLabel, subjectKey, timelineError, timelineKindLabel,
  toggleKind, type DetailTarget, type FilterDraft
} from "../../lib/timeline";
import { useAuth } from "../../lib/auth";
import { VERIFIER_ROLE } from "../../lib/team";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { TimelineDetail } from "./TimelineDetail";
import { TIMELINE_DOCUMENT_KEY } from "./DocumentDetail";

interface Props {
  subject: TimelineSubject;
  endOnOutOfContext?: boolean;
  onOpeningRequired?(): void;
  searchDelayMs?: number;
}

export function PatientTimeline({ subject, endOnOutOfContext = false, onOpeningRequired, searchDelayMs }: Props) {
  const [ draft, setDraft ] = useState<FilterDraft>(EMPTY_DRAFT);
  const [ filters, setFilters ] = useState<TimelineFilters>(ALL_FILTERS);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ open, setOpen ] = useState<DetailTarget | null>(null);
  // Pela abertura justificada (fora de contexto) só a consulta abre (contrato §9).
  const inContext = !("openingId" in subject);
  // O pedido de agendamento só abre para quem tem citizen_verifier (a rota exige o papel).
  const { user } = useAuth();
  const canOpenRequests = !!user?.memberships.some((m) => m.role === VERIFIER_ROLE);
  const key = subjectKey(subject);
  const queryClient = useQueryClient();
  // Fim da abertura (403 opening_required, ou out_of_context pela abertura):
  // a lista sai da tela e do cache, e quem chamou é avisado uma vez só.
  const [ closedFor, setClosedFor ] = useState<string | null>(null);
  const closed = closedFor === key;
  const endedFor = useRef<string | null>(null);

  const queryKey = [ TIMELINE_KEY, key, filters ];
  const query = useInfiniteQuery({
    queryKey,
    enabled: !closed,
    queryFn: ({ pageParam }) => getTimeline(subject, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    gcTime: 0, staleTime: 0, retry: false
  });

  function endOpening() {
    if (endedFor.current === key) return;
    endedFor.current = key;
    setClosedFor(key);
    setOpen(null);
    queryClient.removeQueries({ queryKey: [ TIMELINE_KEY, key ] });
    queryClient.removeQueries({ queryKey: [ TIMELINE_DOCUMENT_KEY ] });
    onOpeningRequired?.();
  }

  const ended = query.isError && endsOpening(query.error, endOnOutOfContext);
  useEffect(() => { if (ended) endOpening(); });

  const pages = closed || ended ? [] : query.data?.pages ?? [];
  const person = pages[0]?.person ?? null;
  const entries = mergePages(pages);

  function apply() {
    const p = filterProblem(draft);
    setProblem(p);
    if (p) return;
    setOpen(null);
    setFilters(filtersFrom(draft));
  }

  function clear() {
    setDraft(EMPTY_DRAFT); setProblem(null); setOpen(null); setFilters(ALL_FILTERS);
  }

  return (
    <section aria-label="Linha do tempo" style={panel}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <strong style={{ flex: 1 }}>{person ? `Linha do tempo de ${person.display_name}` : "Linha do tempo"}</strong>
        <button type="button" style={secondaryButtonStyle} onClick={() => void queryClient.resetQueries({ queryKey, exact: true })}>Atualizar</button>
      </div>
      {person?.partial && <p role="note" aria-label="histórico parcial" style={note}>{PARTIAL_NOTICE}</p>}

      <fieldset aria-label="filtros da linha do tempo" style={fieldset}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {TIMELINE_KINDS.map((k) => (
            <label key={k.key} style={check}>
              <input type="checkbox" checked={draft.kinds.includes(k.key)} onChange={() => setDraft(toggleKind(draft, k.key))} />
              {k.label}
            </label>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={labelStyle}>
            De
            <input type="date" value={draft.from} style={inputStyle} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </label>
          <label style={labelStyle}>
            Até
            <input type="date" value={draft.to} style={inputStyle} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </label>
          <button type="button" style={secondaryButtonStyle} onClick={apply}>Filtrar</button>
          <button type="button" style={secondaryButtonStyle} onClick={clear}>Limpar filtros</button>
        </div>
        {problem && <p role="alert" style={alert}>{problem}</p>}
      </fieldset>

      {closed && <p role="alert" style={alert}>{OPENING_ENDED}</p>}
      {!closed && query.isPending && <p className="mono" style={loading}>carregando a linha do tempo…</p>}
      {!closed && query.isError && !ended && <p role="alert" style={alert}>{timelineError(query.error)}</p>}
      {!closed && !ended && query.data && (
        <DataTable<TimelineEntry>
          cols={[
            { label: "Quando", w: "1fr", render: (e) => entryWhen(e) },
            { label: "Tipo", w: "0.9fr", render: (e) => <Tag>{timelineKindLabel(e.kind)}</Tag> },
            {
              label: "Registro", w: "2.2fr", render: (e) => (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span>{e.title}</span>
                  {e.summary && <span style={muted}>{e.summary}</span>}
                </div>
              )
            },
            { label: "Situação", w: "0.9fr", render: (e) => statusLabel(e.status) },
            { label: "Onde e quem", w: "1.6fr", render: (e) => entryWhere(e) },
            {
              label: "", w: "auto", align: "right", render: (e) => {
                const target = detailTarget(e, inContext, canOpenRequests);
                return target ? (
                  <button type="button" aria-label={openLabel(e)} style={secondaryButtonStyle} onClick={() => setOpen(target)}>
                    Abrir
                  </button>
                ) : null;
              }
            }
          ]}
          rows={entries}
          rowKey={(e) => e.id}
          empty={TIMELINE_EMPTY}
        />
      )}
      {!closed && !ended && query.hasNextPage && (
        <div>
          <button type="button" disabled={query.isFetchingNextPage}
            style={query.isFetchingNextPage ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => void query.fetchNextPage()}>
            Carregar mais
          </button>
        </div>
      )}
      {!closed && open && (
        <TimelineDetail key={`${open.type}:${open.id}`} target={open} onClose={() => setOpen(null)}
          endOnOutOfContext={endOnOutOfContext} onOpeningRequired={endOpening} searchDelayMs={searchDelayMs} />
      )}
    </section>
  );
}

const OPENING_ENDED = "a abertura justificada terminou — abra de novo com o motivo";
const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 10, border: "1px solid var(--rule)", borderRadius: 8 };
const check: CSSProperties = { display: "flex", gap: 4, alignItems: "center", fontSize: 12.5 };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const note: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600, color: "var(--warn)" };
const muted: CSSProperties = { fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const loading: CSSProperties = { margin: 0, fontSize: 10.5, color: "var(--ink3)" };
