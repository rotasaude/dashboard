// Posição de imunobiológicos de um local (módulo 29; F-29.5; GET /pharmacy/positions com `location_id` — sem ele o api só lista
// medicamento). Em doses, um lote por linha: vacina, lote, fabricante, validade, saldo e as etiquetas "bloqueado — aguarda a conduta"
// (excursão de temperatura aberta), "vencido" e "vence em breve" — sempre com texto, nunca só cor. "Extrato — <lote>" abre o extrato
// do 27a. Sem dado pessoal: lê ao abrir e depois de cada escrita (STATIC_QUERY), sem polling.
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listPositions, type LotBalance, type StockPosition, type VaccineLocation } from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import { fmtDay } from "../../lib/exams";
import { PH_POSITIONS_KEY, STATIC_QUERY, fmtQuantity, itemKey } from "../../lib/pharmacy";
import { vaccinationError } from "../../lib/vaccination";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, row, stack } from "../exams/styles";
import { LotStatement } from "../pharmacy/LotStatement";

type Row = { position: StockPosition; lot: LotBalance };

export function lotTags(b: LotBalance, today: string): { text: string; tone: string }[] {
  const tags: { text: string; tone: string }[] = [];
  const expired = b.expired || b.lot.expires_on < today;
  if (b.blocked) tags.push({ text: "bloqueado — aguarda a conduta", tone: "down" });
  if (expired) tags.push({ text: "vencido", tone: "down" });
  else if (b.expiring_soon) tags.push({ text: "vence em breve", tone: "warn" });
  return tags;
}

export function VaccinePositions({ location, today, onStatement }: {
  location: VaccineLocation; today?: string; onStatement?(lot: LotBalance): void;
}) {
  const day = today ?? todayInCity();
  const positions = useInfiniteQuery({
    queryKey: [ PH_POSITIONS_KEY, location.id, "vaccine" ],
    queryFn: ({ pageParam }) => listPositions({ locationId: location.id, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const [ statement, setStatement ] = useState<LotBalance | null>(null);
  const rows: Row[] = (positions.data?.pages ?? []).flatMap((p) => p.positions).flatMap((position) => position.lots.map((lot) => ({ position, lot })));

  function open(b: LotBalance) {
    if (onStatement) { onStatement(b); return; }
    setStatement(b);
  }

  return (
    <div style={stack}>
      {positions.isPending && <p className="mono" style={muted}>carregando…</p>}
      {positions.isError && !positions.data && <p role="alert" style={alert}>{vaccinationError(positions.error)}</p>}
      {positions.data && (
        <DataTable<Row>
          cols={[
            { label: "Vacina", w: "1.4fr", card: "title", render: (r) => r.position.item.name },
            { label: "Lote", w: "1fr", render: (r) => <span className="mono">{r.lot.lot.lot_number}</span> },
            { label: "Fabricante", w: "1.2fr", render: (r) => r.lot.lot.manufacturer ?? "—" },
            { label: "Validade", w: "0.8fr", render: (r) => <span className="mono">{fmtDay(r.lot.lot.expires_on)}</span> },
            { label: "Saldo", w: "0.8fr", align: "right", render: (r) => (
              <span className="mono">{`${fmtQuantity(r.lot.balance)} ${r.lot.lot.item.dispensing_unit}`}</span>
            ) },
            { label: "Situação", w: "1.4fr", card: "pair", render: (r) => (
              <span style={row}>{lotTags(r.lot, day).map((t) => <Tag key={t.text} tone={t.tone}>{t.text}</Tag>)}</span>
            ) },
            { label: "", w: "auto", card: "actions", render: (r) => (
              <button type="button" style={secondaryButtonStyle} onClick={() => open(r.lot)}>{`Extrato — ${r.lot.lot.lot_number}`}</button>
            ) }
          ]}
          rows={rows} rowKey={(r) => `${itemKey(r.position.item)}-${r.lot.lot.id}`} empty="nenhuma vacina com saldo neste local"
        />
      )}
      {positions.data && positions.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={positions.isFetchingNextPage} onClick={() => void positions.fetchNextPage()}>
            {positions.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
      {!onStatement && statement && (
        <LotStatement key={statement.lot.id} lotId={statement.lot.id} locationId={location.id} lotNumber={statement.lot.lot_number} />
      )}
    </div>
  );
}
