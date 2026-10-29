// Extrato de um lote num local (módulo 27a; F-27.7; contrato §6). Leitura sem trilha e sem releitura sozinha: o extrato não traz
// dado pessoal (a dispensação aparece só pelo tipo; nunca o nome do paciente). O `reason` vem no corpo e aparece só aqui.
// "Carregar mais" segue o cursor do api (`next_before`, repassado como veio).
import { useInfiniteQuery } from "@tanstack/react-query";
import { listLotMovements, type StockMovement } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { PH_MOVEMENTS_KEY, STATIC_QUERY, fmtSigned, movementDocument, movementLabel, pharmacyError } from "../../lib/pharmacy";
import { DataTable } from "../../components/DataTable";
import { buttonStyle } from "../../components/formStyles";
import { alert, box, muted, row, title } from "../exams/styles";

export function LotStatement({ lotId, locationId, lotNumber }: { lotId: string; locationId: string; lotNumber: string }) {
  const statement = useInfiniteQuery({
    queryKey: [ PH_MOVEMENTS_KEY, lotId, locationId ],
    queryFn: ({ pageParam }) => listLotMovements(lotId, locationId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const movements = (statement.data?.pages ?? []).flatMap((p) => p.movements);

  return (
    <section aria-label={`Extrato do lote ${lotNumber}`} style={box}>
      <h3 style={title}>{`Extrato do lote ${lotNumber}`}</h3>
      {statement.isPending && <p className="mono" style={muted}>carregando…</p>}
      {statement.isError && <p role="alert" style={alert}>{pharmacyError(statement.error)}</p>}
      {statement.data && (
        <DataTable<StockMovement>
          cols={[
            { label: "Quando", w: "1fr", card: "title", render: (m) => fmtDateTime(m.at) },
            { label: "Movimento", w: "1.2fr", render: (m) => movementLabel(m.kind) },
            { label: "Quantidade", w: "0.7fr", align: "right", render: (m) => <span className="mono">{fmtSigned(m.quantity)}</span> },
            { label: "Documento", w: "1fr", render: (m) => movementDocument(m.document) },
            { label: "Motivo", w: "1.4fr", render: (m) => m.reason || "—" },
            { label: "Por", w: "1fr", render: (m) => m.by?.name ?? "—" }
          ]}
          rows={movements} rowKey={(m) => m.id} empty="nenhum movimento neste lote"
        />
      )}
      {statement.data && statement.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={statement.isFetchingNextPage} onClick={() => void statement.fetchNextPage()}>
            {statement.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </section>
  );
}
