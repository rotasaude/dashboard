// Entrada de imunobiológico por nota ou doação e inventário inicial (módulo 29; F-29.5; rotas do 27a; V4, V19).
// Uma linha por lote, em FRASCOS fechados: vacina, fabricante (só os do catálogo daquela vacina, pela `key`), lote, validade e frascos,
// com a conta "= N doses" (frascos × doses por frasco do catálogo) ao lado. O envio é único e confere TODAS as linhas antes
// (vaccineReceiptProblems); a recusa do api com `problems` mostra cada uma na linha dela (`items[i]` é a linha i enviada) e o formulário
// fica como estava — nada é reenviado sozinho. A sala não lança nota (o api dá 403): quem chama só oferece `receipt` na rede de frio.
// "Hoje" é lido na hora do envio quando não vem por prop. Nada em URL, log ou storage.
import { useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { recordVaccineOpening, recordVaccineReceipt, type StockReceipt, type VaccinationCatalog, type VaccineLocation } from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import { PH_POSITIONS_KEY, problemItemIndex } from "../../lib/pharmacy";
import {
  newVaccineReceiptLine, receiptRefusalText, vaccinationRefusals, vaccineLineDoses, vaccineReceiptItems, vaccineReceiptProblems,
  type VaccineReceiptLine
} from "../../lib/vaccination";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row } from "../exams/styles";

type Shown = { key: string; text: string };
type Kind = "invoice" | "donation";

export function VaccineReceiptForm({ location, catalog, mode, today, onStart, onDone }: {
  location: VaccineLocation; catalog: VaccinationCatalog; mode: "receipt" | "opening"; today?: string; onStart?(): void; onDone(r: StockReceipt): void;
}) {
  const queryClient = useQueryClient();
  const [ lines, setLines ] = useState<VaccineReceiptLine[]>([]);
  const [ counter, setCounter ] = useState(0);
  const [ kind, setKind ] = useState<Kind>("invoice");
  const [ number, setNumber ] = useState("");
  const [ supplier, setSupplier ] = useState("");
  const [ shown, setShown ] = useState<Shown[]>([]);
  const [ busy, setBusy ] = useState(false);
  const opening = mode === "opening";
  const many = lines.length > 1;
  const flagged = new Set(shown.map((s) => s.key));
  const productName = (code: string) => catalog.immunobiologicals.find((i) => i.code === code)?.name ?? null;

  const add = () => {
    setLines((cur) => [ ...cur, newVaccineReceiptLine(`line-${counter}`) ]);
    setCounter((n) => n + 1);
  };
  const patch = (key: string, over: Partial<VaccineReceiptLine>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...over } : l)));
  const remove = (key: string) => setLines((cur) => cur.filter((l) => l.key !== key));

  function fromApi(err: unknown, sent: VaccineReceiptLine[]): Shown[] {
    return vaccinationRefusals(err).map((r) => {
      const i = problemItemIndex(r.path);
      const line = i === null ? undefined : sent[i];
      const text = receiptRefusalText(r);
      return line ? { key: line.key, text: `${productName(line.immunobiologicalCode) ?? "lote"}: ${text}` } : { key: r.path, text };
    });
  }

  async function submit() {
    if (busy) return;
    onStart?.();
    const doc = { kind: opening ? ("opening" as const) : kind, number, supplier };
    const local = vaccineReceiptProblems(lines, { catalog, today: today ?? todayInCity(), doc });
    if (local.length > 0) { setShown(local.map((p) => ({ key: p.path, text: p.text }))); return; }
    setShown([]); setBusy(true);
    const sent = lines;
    try {
      const items = vaccineReceiptItems(sent, catalog);
      const result = opening
        ? await recordVaccineOpening({ location_id: location.id, items })
        : await recordVaccineReceipt({ location_id: location.id, document: { kind, number: number.trim(), supplier: supplier.trim() }, items });
      setLines([]); setNumber(""); setSupplier("");
      void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] });
      onDone(result);
    } catch (err) {
      setShown(fromApi(err, sent));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label={opening ? "Inventário inicial" : "Entrada por nota ou doação"} style={{ display: "flex", flexDirection: "column", gap: 12 }}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {opening ? (
        <p style={muted}>Inventário inicial: o saldo de cada vacina neste local, em frascos fechados, uma vez por vacina. Depois disso, corrija por ajuste.</p>
      ) : (
        <div style={box}>
          <div style={row}>
            <label style={fieldLabel}>
              Tipo de entrada
              <select value={kind} style={inputStyle} disabled={busy} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="invoice">Nota fiscal</option>
                <option value="donation">Doação</option>
              </select>
            </label>
            <label style={fieldLabel}>
              Número do documento
              <input value={number} style={{ ...inputStyle, ...(flagged.has("document.number") ? flaggedStyle : null) }} disabled={busy}
                onChange={(e) => setNumber(e.target.value)} />
            </label>
            <label style={fieldLabel}>
              Fornecedor ou doador
              <input value={supplier} style={{ ...inputStyle, ...(flagged.has("document.supplier") ? flaggedStyle : null) }} disabled={busy}
                onChange={(e) => setSupplier(e.target.value)} />
            </label>
          </div>
        </div>
      )}

      {lines.map((l, index) => {
        const product = catalog.immunobiologicals.find((i) => i.code === l.immunobiologicalCode);
        const doses = vaccineLineDoses(l, catalog);
        const named = (base: string) => (many ? `${base} — lote ${index + 1}` : base);
        return (
          <div key={l.key} style={{ ...box, ...(flagged.has(l.key) ? flaggedStyle : null) }}>
            <div style={row}>
              <strong>{product?.name ?? `Lote ${index + 1}`}</strong>
              <button type="button" style={secondaryButtonStyle} disabled={busy} aria-label={named("Remover")} onClick={() => remove(l.key)}>
                Remover
              </button>
            </div>
            <div style={row}>
              <label style={fieldLabel}>
                Vacina
                <select value={l.immunobiologicalCode} style={inputStyle} aria-label={named("Vacina")} disabled={busy}
                  onChange={(e) => patch(l.key, { immunobiologicalCode: e.target.value, manufacturerKey: "" })}>
                  <option value="">Escolha a vacina</option>
                  {catalog.immunobiologicals.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                Fabricante
                <select value={l.manufacturerKey} style={inputStyle} aria-label={named("Fabricante")} disabled={busy || !product}
                  onChange={(e) => patch(l.key, { manufacturerKey: e.target.value })}>
                  <option value="">{product ? "Escolha o fabricante" : "escolha a vacina antes"}</option>
                  {(product?.manufacturers ?? []).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                </select>
              </label>
            </div>
            <div style={row}>
              <label style={fieldLabel}>
                Lote
                <input value={l.lotNumber} style={inputStyle} aria-label={named("Lote")} disabled={busy}
                  onChange={(e) => patch(l.key, { lotNumber: e.target.value })} />
              </label>
              <label style={fieldLabel}>
                Validade
                <input type="date" value={l.expiresOn} style={inputStyle} aria-label={named("Validade")} disabled={busy}
                  onChange={(e) => patch(l.key, { expiresOn: e.target.value })} />
              </label>
              <label style={fieldLabel}>
                {product ? `Frascos (${product.doses_per_vial} ${product.doses_per_vial === 1 ? "dose" : "doses"} cada)` : "Frascos"}
                <input value={l.vials} inputMode="numeric" style={inputStyle} aria-label={named("Frascos")} disabled={busy}
                  onChange={(e) => patch(l.key, { vials: e.target.value })} />
              </label>
              {doses !== null && <small className="mono" style={muted}>{`= ${doses} ${doses === 1 ? "dose" : "doses"}`}</small>}
            </div>
          </div>
        );
      })}

      <div style={row}>
        <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={add}>Acrescentar lote</button>
      </div>
      {shown.length > 0 && (
        <div role="alert" style={alert}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{shown.map((s, i) => <li key={`${s.key}-${i}`}>{s.text}</li>)}</ul>
        </div>
      )}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>
          {opening ? "Registrar inventário inicial" : "Registrar entrada"}
        </button>
      </div>
    </form>
  );
}

const flaggedStyle: CSSProperties = { borderColor: "var(--down)" };
