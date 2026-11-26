// "Aberturas deste local" em "Entradas e abertura" (módulo 27b; Q13, F-20): as aberturas do local, com o autor normal (o
// `recorded_by.name`, "—" sem perfil), a marca da planilha (`from_import`) e a da abertura desfeita (`reverted`). Sem polling: relida ao
// abrir, no "Atualizar" e depois de registrar uma abertura (quem registra invalida a chave).
import { useInfiniteQuery } from "@tanstack/react-query";
import { listStockOpenings, type LocationRef, type StockOpening } from "../../lib/api";
import { PH_OPENINGS_KEY, STATIC_QUERY, bnafarError } from "../../lib/bnafar";
import { fmtDateTime } from "../../lib/format";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, row, stack, title } from "../exams/styles";

export const openingsKey = (locationId: string) => [ PH_OPENINGS_KEY, locationId ] as const;

export function OpeningsPanel({ location }: { location: LocationRef }) {
  const list = useInfiniteQuery({
    queryKey: openingsKey(location.id),
    queryFn: ({ pageParam }) => listStockOpenings(location.id, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const rows = (list.data?.pages ?? []).flatMap((p) => p.items);
  return (
    <section aria-label="Aberturas deste local" style={stack}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <h3 style={title}>Aberturas deste local</h3>
        <button type="button" style={secondaryButtonStyle} disabled={list.isFetching} onClick={() => void list.refetch()}>Atualizar</button>
      </div>
      {list.isPending && <p className="mono" style={muted}>carregando…</p>}
      {list.isError && !list.data && <p role="alert" style={alert}>{bnafarError(list.error)}</p>}
      {list.data && (
        <DataTable<StockOpening>
          label="Aberturas deste local"
          cols={[
            { label: "Data", w: "1fr", card: "title", render: (o) => <span className="mono">{fmtDateTime(o.created_at)}</span> },
            { label: "Itens", w: "0.5fr", align: "right", render: (o) => <span className="mono">{o.lots.length}</span> },
            { label: "Por", w: "1.2fr", render: (o) => o.recorded_by?.name || "—" },
            { label: "Marca", w: "1.2fr", render: (o) => (
              <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {o.from_import && <Tag tone="info">importada pela planilha</Tag>}
                {o.reverted && <Tag tone="warn">desfeita</Tag>}
              </span>
            ) }
          ]}
          rows={rows} rowKey={(o) => o.stock_entry_id} empty="nenhuma abertura registrada neste local"
        />
      )}
      {list.data && list.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {list.isFetchingNextPage ? "Carregando…" : "Carregar mais aberturas"}
          </button>
        </div>
      )}
    </section>
  );
}
