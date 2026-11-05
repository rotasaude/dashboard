// Linha do tempo só do CAPS (F-31.8; P18): `GET /psychosocial/enrollments/:id/timeline` em páginas `{ items, next_before }` (R13). O api
// manda um kind só, `psychosocial` (ação com o nome SIGTAP, "PTS versão N", "Acolhimento noturno", documento), mais o marcador
// `psychosocial_link`; nenhum traz evolução, CID ou PTS, e nenhum abre detalhe aqui. Lida só ao abrir a aba (o api grava a trilha), com
// `NOMINAL_QUERY` e o id do CAPS na chave: o portão apaga `PSY_DETAIL_KEY` na troca de CAPS. Sem polling.
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, getPsyEnrollmentTimeline, type TimelineEntry } from "../../lib/api";
import { NOMINAL_QUERY, PSY_DETAIL_KEY, psyError } from "../../lib/psychosocial";
import { entryWhen, mergePages, statusLabel, timelineKindLabel } from "../../lib/timeline";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { EntryWhere } from "../timeline/EntryWhere";
import { alert, muted, stack } from "../exams/styles";

export const CAPS_ONLY_NOTE = "Só a equipe do CAPS vê esta linha do tempo.";
export const NO_TIMELINE_ENTRIES = "nenhum registro nesta matrícula";

export function CapsTimeline({ enrollmentId, unitId }: { enrollmentId: string; unitId: string }) {
  const queryClient = useQueryClient();
  const queryKey = [ PSY_DETAIL_KEY, unitId, "timeline", enrollmentId ];
  const [ notice, setNotice ] = useState<string | null>(null);
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => getPsyEnrollmentTimeline(enrollmentId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  const entries = mergePages((query.data?.pages ?? []).map((p) => ({ entries: p.items })));
  // A lista mudou enquanto se rolava (`invalid_cursor`): a frase, e relê do começo (molde do ActionsPanel).
  const cursorLost = query.isFetchNextPageError && errorCode(query.error) === "invalid_cursor";
  useEffect(() => {
    if (!cursorLost) return;
    setNotice(psyError(query.error));
    void queryClient.resetQueries({ queryKey, exact: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ cursorLost ]);

  return (
    <div style={stack}>
      <p style={muted}>{CAPS_ONLY_NOTE}</p>
      {query.isPending && <p className="mono" style={muted}>carregando…</p>}
      {notice && <p role="alert" style={alert}>{notice}</p>}
      {query.isError && !cursorLost && <p role="alert" style={alert}>{psyError(query.error)}</p>}
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
            { label: "Onde e quem", w: "1.4fr", render: (e) => <EntryWhere entry={e} /> }
          ]}
          rows={entries}
          rowKey={(e) => e.id}
          empty={NO_TIMELINE_ENTRIES}
        />
      )}
      {query.hasNextPage && (
        <div>
          <button type="button" disabled={query.isFetchingNextPage} style={query.isFetchingNextPage ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => { setNotice(null); void query.fetchNextPage(); }}>
            Carregar mais
          </button>
        </div>
      )}
    </div>
  );
}
