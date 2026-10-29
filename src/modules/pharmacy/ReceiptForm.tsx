// Entrada por nota ou doação e inventário de abertura (módulo 27a; F-27.2; contrato §4, H12).
// Uma linha por lote: item do catálogo, lote, validade, fabricante e a quantidade — direto (na unidade de dispensação) ou por
// embalagem ("Unidades por embalagem" × "Embalagens", com a conta mostrada antes de enviar). O envio é único e confere TODAS as
// linhas antes (receiptProblems); a recusa do api com `problems` mostra cada uma na linha dela (`items[i]` é o índice do corpo
// enviado = a linha i da tela) e o formulário fica como estava. Depois do sucesso limpa linhas e documento, mantém o tipo de
// entrada e relê as posições. Nada em URL, log ou storage.
import { useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { recordOpening, recordReceipt, type PharmacyLocation, type StockItem, type StockReceipt } from "../../lib/api";
import {
  PH_POSITIONS_KEY, errorPath, fmtQuantity, lineQuantity, newReceiptLine, pharmacyError, pharmacyProblems, problemItemIndex,
  receiptItems, receiptProblems, type ReceiptLine
} from "../../lib/pharmacy";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ItemSearch } from "./ItemSearch";
import { alert, box, checkLabel, fieldLabel, muted, row } from "../exams/styles";

type Shown = { key: string; text: string };
type Kind = "invoice" | "donation";

export function ReceiptForm({ location, mode, today, delayMs, onStart, onDone }: {
  location: PharmacyLocation; mode: "receipt" | "opening"; today: string; delayMs?: number; onStart?(): void; onDone(r: StockReceipt): void;
}) {
  const queryClient = useQueryClient();
  const [ lines, setLines ] = useState<ReceiptLine[]>([]);
  const [ counter, setCounter ] = useState(0);
  const [ kind, setKind ] = useState<Kind>("invoice");
  const [ number, setNumber ] = useState("");
  const [ supplier, setSupplier ] = useState("");
  const [ shown, setShown ] = useState<Shown[]>([]);
  const [ busy, setBusy ] = useState(false);
  const opening = mode === "opening";
  const many = lines.length > 1;
  const flagged = new Set(shown.map((s) => s.key));

  const add = (item: StockItem) => {
    setLines((cur) => [ ...cur, { ...newReceiptLine(`line-${counter}`), item } ]);
    setCounter((n) => n + 1);
  };
  const patch = (key: string, over: Partial<ReceiptLine>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...over } : l)));
  const remove = (key: string) => setLines((cur) => cur.filter((l) => l.key !== key));

  // Recusa do api → linhas da tela: com `problems`, todas; só com `path`, a do item; sem índice, a frase solta.
  function fromApi(err: unknown, sent: ReceiptLine[]): Shown[] {
    const list = pharmacyProblems(err);
    const raw = list.length > 0 ? list : [ { path: errorPath(err) ?? "", text: pharmacyError(err) } ];
    return raw.map((p) => {
      const i = problemItemIndex(p.path);
      const line = i === null ? undefined : sent[i];
      return line ? { key: line.key, text: `${line.item?.name ?? "item"}: ${p.text}` } : { key: p.path, text: p.text };
    });
  }

  async function submit() {
    if (busy) return;
    onStart?.();
    const doc = { kind: opening ? ("opening" as const) : kind, number, supplier };
    const local = receiptProblems(lines, today, doc);
    if (local.length > 0) { setShown(local.map((p) => ({ key: p.path, text: p.text }))); return; }
    setShown([]); setBusy(true);
    const sent = lines;
    try {
      const items = receiptItems(sent);
      const result = opening
        ? await recordOpening({ location_id: location.id, items })
        : await recordReceipt({ location_id: location.id, document: { kind, number: number.trim(), supplier: supplier.trim() }, items });
      setLines([]); setNumber(""); setSupplier("");
      void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] });
      onDone(result);
    } catch (err) {
      setShown(fromApi(err, sent));
    } finally {
      setBusy(false);
    }
  }

  const named = (base: string, l: ReceiptLine) => (many ? `${base} — ${l.item?.name ?? "item"}` : base);

  return (
    <form style={{ display: "flex", flexDirection: "column", gap: 12 }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p style={muted}>Local: <strong>{location.name}</strong></p>
      {opening ? (
        <p style={muted}>Inventário de abertura: o saldo inicial de cada item neste local, uma vez por item. Depois disso, corrija por ajuste.</p>
      ) : (
        <div style={box}>
          <div style={row}>
            <label style={fieldLabel}>
              Tipo de entrada
              <select value={kind} style={inputStyle} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="invoice">Nota fiscal</option>
                <option value="donation">Doação</option>
              </select>
            </label>
            <label style={fieldLabel}>
              Número do documento
              <input value={number} style={inputStyle} onChange={(e) => setNumber(e.target.value)} />
            </label>
            <label style={fieldLabel}>
              Fornecedor ou doador
              <input value={supplier} style={inputStyle} onChange={(e) => setSupplier(e.target.value)} />
            </label>
          </div>
        </div>
      )}
      <ItemSearch label="Buscar medicamento" onPick={add} delayMs={delayMs} disabled={busy} />
      {lines.map((l) => {
        const item = l.item;
        const unit = item?.dispensing_unit ?? "";
        const total = lineQuantity(l);
        return (
          <div key={l.key} style={{ ...box, ...(flagged.has(l.key) ? flaggedStyle : null) }}>
            <div style={row}>
              <strong>{item?.name}</strong>
              {item?.controlled && <Tag tone="warn">{`controlado · lista ${item.controlled_list ?? "—"}`}</Tag>}
              <button type="button" style={secondaryButtonStyle} disabled={busy} aria-label={many ? `Remover — ${item?.name ?? "item"}` : "Remover"}
                onClick={() => remove(l.key)}>
                Remover
              </button>
            </div>
            <div style={row}>
              <label style={fieldLabel}>
                Lote
                <input value={l.lotNumber} style={inputStyle} aria-label={named("Lote", l)} onChange={(e) => patch(l.key, { lotNumber: e.target.value })} />
              </label>
              <label style={fieldLabel}>
                Validade
                <input type="date" value={l.expiresOn} style={inputStyle} aria-label={named("Validade", l)}
                  onChange={(e) => patch(l.key, { expiresOn: e.target.value })} />
              </label>
              <label style={fieldLabel}>
                Fabricante (opcional)
                <input value={l.manufacturer} style={inputStyle} aria-label={named("Fabricante (opcional)", l)}
                  onChange={(e) => patch(l.key, { manufacturer: e.target.value })} />
              </label>
            </div>
            <label style={checkLabel}>
              <input type="checkbox" checked={l.byPackage} aria-label={named("Por embalagem", l)} onChange={(e) => patch(l.key, { byPackage: e.target.checked })} />
              Por embalagem
            </label>
            {l.byPackage ? (
              <div style={row}>
                <label style={fieldLabel}>
                  Unidades por embalagem
                  <input value={l.unitsPerPackage} inputMode="numeric" style={inputStyle} aria-label={named("Unidades por embalagem", l)}
                    onChange={(e) => patch(l.key, { unitsPerPackage: e.target.value })} />
                </label>
                <label style={fieldLabel}>
                  Embalagens
                  <input value={l.packages} inputMode="numeric" style={inputStyle} aria-label={named("Embalagens", l)}
                    onChange={(e) => patch(l.key, { packages: e.target.value })} />
                </label>
                {total !== null && <small className="mono" style={muted}>{`= ${fmtQuantity(total)} ${unit}`}</small>}
              </div>
            ) : (
              <label style={fieldLabel}>
                {`Quantidade (${unit})`}
                <input value={l.quantity} inputMode="decimal" style={inputStyle} aria-label={named(`Quantidade (${unit})`, l)}
                  onChange={(e) => patch(l.key, { quantity: e.target.value })} />
              </label>
            )}
          </div>
        );
      })}
      {shown.length > 0 && (
        <div role="alert" style={alert}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{shown.map((s, i) => <li key={`${s.key}-${i}`}>{s.text}</li>)}</ul>
        </div>
      )}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>
          {opening ? "Registrar abertura" : "Registrar entrada"}
        </button>
      </div>
    </form>
  );
}

const flaggedStyle: CSSProperties = { borderColor: "var(--down)" };
