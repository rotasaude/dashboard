// Linha do tempo só do CAPS (F-31.8; P18): `GET /psychosocial/enrollments/:id/timeline` em páginas `{ items, next_before }` (R13). O api
// manda um kind só, `psychosocial` (ação com o nome SIGTAP, "PTS versão N", "Acolhimento noturno", documento), mais o marcador
// `psychosocial_link`; nenhum traz evolução, CID ou PTS, e nenhum abre detalhe aqui. Lida só ao abrir a aba (o api grava a trilha), com
// `NOMINAL_QUERY` e o id do CAPS na chave: o portão apaga `PSY_DETAIL_KEY` na troca de CAPS. Sem polling.
import { useInfiniteQuery } from "@tanstack/react-query";
import { getPsyEnrollmentTimeline, type TimelineEntry } from "../../lib/api";
import { NOMINAL_QUERY, PSY_DETAIL_KEY, psyError } from "../../lib/psychosocial";
import { entryWhen, entryWhere, mergePages, statusLabel, timelineKindLabel } from "../../lib/timeline";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, stack } from "../exams/styles";

export const CAPS_ONLY_NOTE = "Só a equipe do CAPS vê esta linha do tempo.";
export const NO_TIMELINE_ENTRIES = "nenhum registro nesta matrícula";

export function CapsTimeline({ enrollmentId, unitId }: { enrollmentId: string; unitId: string }) {
  const query = useInfiniteQuery({
    queryKey: [ PSY_DETAIL_KEY, unitId, "timeline", enrollmentId ],
    queryFn: ({ pageParam }) => getPsyEnrollmentTimeline(enrollmentId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  const entries = mergePages((query.data?.pages ?? []).map((p) => ({ entries: p.items })));

  return (
    <div style={stack}>
      <p style={muted}>{CAPS_ONLY_NOTE}</p>
      {query.isPending && <p className="mono" style={muted}>carregando…</p>}
      {query.isError && <p role="alert" style={alert}>{psyError(query.error)}</p>}
      {query.data && (
        <DataTable<TimelineEntry>
          cols={[
            { label: "Quando", w: "1fr", render: (e) => entryWhen(e) },
            { label: "Tipo", w: "0.7fr", render: (e) => <Tag>{timelineKindLabel(e.kind)}</Tag> },
            {
              label: "Registro", w: "2fr", card: "title", render: (e) => (
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span>{e.title}</span>
                  {e.summary && <span style={muted}>{e.summary}</span>}
                </span>
              )
            },
            { label: "Situação", w: "0.8fr", render: (e) => statusLabel(e.status, e.status_label) },
            {
              label: "Onde e quem", w: "1.4fr", render: (e) => {
                const w = entryWhere(e);
                if (!w.unit && !w.person) return "—";
                return (
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    {w.unit ?? "—"}{w.person && <span style={{ color: "var(--ink2)" }}>{w.person}</span>}
                  </span>
                );
              }
            }
          ]}
          rows={entries}
          rowKey={(e) => e.id}
          empty={NO_TIMELINE_ENTRIES}
        />
      )}
      {query.hasNextPage && (
        <div>
          <button type="button" disabled={query.isFetchingNextPage} style={query.isFetchingNextPage ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => void query.fetchNextPage()}>
            Carregar mais
          </button>
        </div>
      )}
    </div>
  );
}
