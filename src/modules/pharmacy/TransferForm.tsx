// Envio de transferência do almoxarifado central à farmácia de uma unidade (módulo 27a; F-27.3; contrato §5, H12).
// Só o almoxarife do central (quem chama decide; o api recusa de novo). O destino são os locais `unit` ativos da lista da pessoa (D1).
// Cada linha é um item do central com o lote que vence primeiro já escolhido e marcado "(sugerido)"; a quantidade é até o saldo do lote.
// O envio confere TODAS as linhas antes (transferProblems); a recusa do api com `problems` mostra cada uma na linha dela (`items[i]` é o
// índice do corpo enviado = a linha i da tela) e o formulário fica como estava — nada é reenviado sozinho. A posição de cada linha é lida
// do cache, que é relido depois de cada escrita (saldo mudou: a tela mostra o saldo novo). Nada em URL, log ou storage.
import { useState, type CSSProperties } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { listMyPharmacyLocations, listPositions, sendTransfer, type PharmacyLocation, type StockPosition, type StockTransfer } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  PH_LOCATIONS_KEY, PH_POSITIONS_KEY, PH_TRANSFERS_KEY, STATIC_QUERY, availableLots, errorPath, locationKindLabel, lotOptionLabel,
  pharmacyError, pharmacyProblems, problemItemIndex, suggestedLotId, toApiQuantity, transferProblems, type TransferLine
} from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row, title } from "../exams/styles";

export const TRANSFER_SENT_TEXT = "Transferência enviada: fica em trânsito até a unidade receber.";
const DESTINATION_TEXT = "escolha o destino da transferência";

interface Line { key: string; snapshot: StockPosition; lotId: string; quantity: string }
type Shown = { key: string; text: string };

export function TransferForm({ central, today, onStart, onDone }: {
  central: PharmacyLocation; today: string; onStart?(): void; onDone(t: StockTransfer): void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const locations = useQuery({ queryKey: [ PH_LOCATIONS_KEY, user?.id ?? null ], queryFn: listMyPharmacyLocations, enabled: !!user, ...STATIC_QUERY });
  const positions = useInfiniteQuery({
    queryKey: [ PH_POSITIONS_KEY, central.id, "transfer" ],
    queryFn: ({ pageParam }) => listPositions({ locationId: central.id, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const [ destination, setDestination ] = useState("");
  const [ lines, setLines ] = useState<Line[]>([]);
  const [ counter, setCounter ] = useState(0);
  const [ shown, setShown ] = useState<Shown[]>([]);
  const [ busy, setBusy ] = useState(false);

  const destinations = (locations.data ?? []).filter((l) => l.kind === "unit" && l.active && l.id !== central.id);
  const all = (positions.data?.pages ?? []).flatMap((p) => p.positions);
  const offered = all.filter((p) => availableLots(p, today).length > 0);
  const current = (l: Line): StockPosition => all.find((p) => p.item.catalog_item_id === l.snapshot.item.catalog_item_id) ?? l.snapshot;
  const toLine = (l: Line): TransferLine => ({ key: l.key, position: current(l), lotId: l.lotId, quantity: l.quantity });
  const flagged = new Set(shown.map((s) => s.key));
  const many = lines.length > 1;

  const add = (p: StockPosition) => {
    setLines((cur) => [ ...cur, { key: `line-${counter}`, snapshot: p, lotId: suggestedLotId(p, today), quantity: "" } ]);
    setCounter((n) => n + 1);
  };
  const patch = (key: string, over: Partial<Line>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...over } : l)));
  const remove = (key: string) => setLines((cur) => cur.filter((l) => l.key !== key));
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ PH_TRANSFERS_KEY ] });
  };

  function fromApi(err: unknown, sent: Line[]): Shown[] {
    const list = pharmacyProblems(err);
    const raw = list.length > 0 ? list : [ { path: errorPath(err) ?? "", text: pharmacyError(err) } ];
    return raw.map((p) => {
      const i = problemItemIndex(p.path);
      const line = i === null ? undefined : sent[i];
      return line ? { key: line.key, text: `${line.snapshot.item.name}: ${p.text}` } : { key: p.path, text: p.text };
    });
  }

  async function submit() {
    if (busy) return;
    onStart?.();
    const local: Shown[] = [];
    if (destination === "") local.push({ key: "destination", text: DESTINATION_TEXT });
    for (const p of transferProblems(lines.map(toLine), today)) local.push({ key: p.path, text: p.text });
    if (local.length > 0) { setShown(local); return; }
    setShown([]); setBusy(true);
    const sent = lines;
    try {
      const result = await sendTransfer({
        to_location_id: destination,
        items: sent.map((l) => ({ lot_id: l.lotId, quantity: toApiQuantity(l.quantity) }))
      });
      setLines([]);
      reread();
      onDone(result);
    } catch (err) {
      setShown(fromApi(err, sent));
      reread();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form style={{ display: "flex", flexDirection: "column", gap: 12 }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3 style={title}>{`Enviar de ${central.name}`}</h3>
      <label style={{ ...fieldLabel, maxWidth: 360 }}>
        Destino
        <select value={destination} style={{ ...inputStyle, ...(flagged.has("destination") ? flaggedStyle : null) }} disabled={busy}
          onChange={(e) => setDestination(e.target.value)}>
          <option value="">Escolha a farmácia de destino</option>
          {destinations.map((l) => <option key={l.id} value={l.id}>{l.name} — {locationKindLabel(l.kind)}</option>)}
        </select>
      </label>
      {locations.isError && !locations.data && <p role="alert" style={alert}>{pharmacyError(locations.error)}</p>}

      <div style={box}>
        <strong style={{ fontSize: 12.5 }}>Medicamentos com saldo no almoxarifado</strong>
        {positions.isPending && <p className="mono" style={muted}>carregando…</p>}
        {positions.isError && !positions.data && <p role="alert" style={alert}>{pharmacyError(positions.error)}</p>}
        {positions.data && offered.length === 0 && <p style={muted}>nenhum medicamento com lote disponível para enviar</p>}
        <div style={row}>
          {offered.map((p) => (
            <button key={p.item.catalog_item_id} type="button" style={secondaryButtonStyle} disabled={busy} aria-label={`Acrescentar ${p.item.name}`}
              onClick={() => add(p)}>
              {`+ ${p.item.name}`}
            </button>
          ))}
        </div>
        {positions.hasNextPage && (
          <div style={row}>
            <button type="button" style={secondaryButtonStyle} disabled={positions.isFetchingNextPage} onClick={() => void positions.fetchNextPage()}>
              {positions.isFetchingNextPage ? "Carregando…" : "Carregar mais medicamentos"}
            </button>
          </div>
        )}
      </div>

      {lines.map((l) => {
        const p = current(l);
        const lots = availableLots(p, today);
        const suggested = lots[0]?.lot.id;
        const named = (base: string) => (many ? `${base} — ${p.item.name}` : base);
        return (
          <div key={l.key} style={{ ...box, ...(flagged.has(l.key) ? flaggedStyle : null) }}>
            <div style={row}>
              <strong>{p.item.name}</strong>
              <button type="button" style={secondaryButtonStyle} disabled={busy} aria-label={many ? `Remover — ${p.item.name}` : "Remover"}
                onClick={() => remove(l.key)}>
                Remover
              </button>
            </div>
            <div style={row}>
              <label style={fieldLabel}>
                Lote
                <select value={lots.some((b) => b.lot.id === l.lotId) ? l.lotId : ""} style={inputStyle} aria-label={named("Lote")} disabled={busy}
                  onChange={(e) => patch(l.key, { lotId: e.target.value })}>
                  {!lots.some((b) => b.lot.id === l.lotId) && <option value="">Escolha o lote</option>}
                  {lots.map((b) => <option key={b.lot.id} value={b.lot.id}>{lotOptionLabel(b, b.lot.id === suggested)}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                {`Quantidade (${p.item.dispensing_unit})`}
                <input value={l.quantity} inputMode="decimal" style={inputStyle} aria-label={named("Quantidade")} disabled={busy}
                  onChange={(e) => patch(l.key, { quantity: e.target.value })} />
              </label>
            </div>
          </div>
        );
      })}

      {shown.length > 0 && (
        <div role="alert" style={alert}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{shown.map((s, i) => <li key={`${s.key}-${i}`}>{s.text}</li>)}</ul>
        </div>
      )}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Enviar transferência</button>
      </div>
    </form>
  );
}

const flaggedStyle: CSSProperties = { borderColor: "var(--down)" };
