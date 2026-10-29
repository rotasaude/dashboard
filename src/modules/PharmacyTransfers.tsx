// PharmacyTransfers — envio do almoxarifado e recebimento conferido na unidade (módulo 27a; F-27.3; contrato §5).
// Por local: o almoxarife do CENTRAL envia (o api recusa de novo); o destino recebe — almoxarife, farmacêutico ou auxiliar daquele local —
// uma transferência em trânsito, conferindo lote a lote. Em qualquer local a lista mostra as transferências em que ele é origem ou
// destino (sem dado pessoal: leitura ao abrir e depois de cada escrita, sem polling). As frases de sucesso e de "já recebida" ficam
// aqui, fora dos formulários que se fecham ou se limpam.
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listTransfers, type PharmacyLocation, type StockTransfer, type TransferItem } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime } from "../lib/format";
import {
  PH_TRANSFERS_KEY, STATIC_QUERY, fmtQuantity, locationRoles, pharmacyError, transferStatusLabel, transferStatusTone
} from "../lib/pharmacy";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, okText, row, stack, title } from "./exams/styles";
import { LocationPick } from "./pharmacy/LocationPick";
import { PharmacyGate } from "./pharmacy/PharmacyGate";
import { ReceiveForm, receivedText } from "./pharmacy/ReceiveForm";
import { TRANSFER_SENT_TEXT, TransferForm } from "./pharmacy/TransferForm";

function itemText(i: TransferItem): string {
  const unit = i.lot.item.dispensing_unit;
  const base = `${i.lot.item.name} · lote ${i.lot.lot_number} · enviado ${fmtQuantity(i.quantity_sent)} ${unit}`;
  if (i.quantity_received === null) return base;
  // O api manda enviado − recebido (nunca negativo): é o que faltou chegar.
  const diff = i.difference !== null && Number(i.difference) !== 0 ? ` (faltaram ${fmtQuantity(i.difference)} ${unit})` : "";
  return `${base} · recebido ${fmtQuantity(i.quantity_received)} ${unit}${diff}`;
}

export function PharmacyTransfers({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <PharmacyGate title="Transferências" sub="envio do almoxarifado e recebimento conferido na unidade" allow={(r) => r.pharmacist || r.assistant || r.keeper}>
      {() => (
        <LocationPick allow={(r) => r.pharmacist || r.assistant || r.keeper}>
          {(loc) => <Body location={loc} today={today} />}
        </LocationPick>
      )}
    </PharmacyGate>
  );
}

function Body({ location, today }: { location: PharmacyLocation; today: string }) {
  const roles = locationRoles(location);
  const canSend = location.kind === "central" && roles.keeper;
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ stale, setStale ] = useState<string | null>(null);
  const [ receiving, setReceiving ] = useState<StockTransfer | null>(null);

  const transfers = useInfiniteQuery({
    queryKey: [ PH_TRANSFERS_KEY, location.id ],
    queryFn: ({ pageParam }) => listTransfers({ locationId: location.id, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const rows = (transfers.data?.pages ?? []).flatMap((p) => p.transfers);
  const clear = () => { setNotice(null); setStale(null); };
  // O formulário aberto sobre uma transferência que já mudou não vale mais.
  const open = receiving && rows.find((t) => t.id === receiving.id)?.status === "sent" ? receiving : null;

  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {stale && <p role="alert" style={alert}>{stale}</p>}

      {canSend && <TransferForm central={location} today={today} onStart={clear} onDone={() => { clear(); setNotice(TRANSFER_SENT_TEXT); }} />}

      {open && (
        <ReceiveForm key={open.id} transfer={open} onStart={clear} onCancel={() => setReceiving(null)}
          onDone={(t) => { setReceiving(null); setStale(null); setNotice(receivedText(t.status)); }}
          onStale={(text) => { setReceiving(null); setNotice(null); setStale(text); }} />
      )}

      <h3 style={title}>Transferências do local</h3>
      {transfers.isPending && <p className="mono" style={muted}>carregando…</p>}
      {transfers.isError && !transfers.data && <p role="alert" style={alert}>{pharmacyError(transfers.error)}</p>}
      {transfers.data && (
        <DataTable<StockTransfer>
          cols={[
            { label: "Origem", w: "1fr", card: "title", render: (t) => t.from.name },
            { label: "Destino", w: "1fr", render: (t) => t.to.name },
            { label: "Enviada em", w: "1fr", render: (t) => <span className="mono">{fmtDateTime(t.sent_at)}</span> },
            { label: "Itens", w: "2fr", render: (t) => (
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5 }}>{t.items.map((i) => <li key={i.lot.id}>{itemText(i)}</li>)}</ul>
            ) },
            { label: "Situação", w: "1fr", card: "pair", render: (t) => <Tag tone={transferStatusTone(t.status)}>{transferStatusLabel(t.status)}</Tag> },
            { label: "", w: "auto", card: "actions", render: (t) => (t.status === "sent" && t.to.id === location.id ? (
              <button type="button" style={secondaryButtonStyle} aria-label={`Receber transferência de ${t.from.name}`}
                onClick={() => { clear(); setReceiving(t); }}>
                Receber
              </button>
            ) : null) }
          ]}
          rows={rows} rowKey={(t) => t.id} empty="nenhuma transferência neste local"
        />
      )}
      {transfers.data && transfers.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={transfers.isFetchingNextPage} onClick={() => void transfers.fetchNextPage()}>
            {transfers.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}
