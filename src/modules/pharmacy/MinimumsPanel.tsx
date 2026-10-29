// Estoque mínimo do local (módulo 27a; F-27.7; contrato §6): só o `stock_keeper` DO LOCAL (quem chama decide pelo `locationRoles`;
// o api recusa de novo). A lista é inteira: o PUT substitui o que há. Mínimo na unidade de dispensação ("Mínimo (cápsula)"); zero vale.
// Linha com problema não deixa salvar e a frase diz o item. Sem trilha, sem polling, sem storage.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMinimums, putMinimums, type PharmacyLocation, type StockItem, type StockMinimum } from "../../lib/api";
import { PH_MINIMUMS_KEY, PH_POSITIONS_KEY, STATIC_QUERY, errorPath, fmtQuantity, pharmacyError, quantityProblem, toApiQuantity } from "../../lib/pharmacy";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, list, muted, okText, row, title } from "../exams/styles";
import { ItemSearch } from "./ItemSearch";

interface MinRow { item: StockItem; value: string }

const toRows = (list: StockMinimum[]): MinRow[] =>
  list.flatMap((m) => (m.item ? [ { item: m.item, value: fmtQuantity(m.minimum) } ] : []));

export function MinimumsPanel({ location }: { location: PharmacyLocation }) {
  const minimums = useQuery({
    queryKey: [ PH_MINIMUMS_KEY, location.id ], queryFn: () => getMinimums(location.id), ...STATIC_QUERY
  });
  return (
    <section aria-label={`Estoque mínimo de ${location.name}`} style={box}>
      <h3 style={title}>{`Estoque mínimo — ${location.name}`}</h3>
      {minimums.isPending && <p className="mono" style={muted}>carregando…</p>}
      {minimums.isError && !minimums.data && <p role="alert" style={alert}>{pharmacyError(minimums.error)}</p>}
      {minimums.data && <MinimumsForm location={location} initial={toRows(minimums.data)} />}
    </section>
  );
}

function MinimumsForm({ location, initial }: { location: PharmacyLocation; initial: MinRow[] }) {
  const queryClient = useQueryClient();
  const [ rows, setRows ] = useState<MinRow[]>(initial);
  const [ problems, setProblems ] = useState<string[]>([]);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ hint, setHint ] = useState<string | null>(null);
  const [ saving, setSaving ] = useState(false);

  const touch = () => { setNotice(null); setProblems([]); setError(null); };
  const edit = (id: string, value: string) => { touch(); setRows((rs) => rs.map((r) => (r.item.catalog_item_id === id ? { ...r, value } : r))); };
  const remove = (id: string) => { touch(); setHint(null); setRows((rs) => rs.filter((r) => r.item.catalog_item_id !== id)); };
  function add(item: StockItem) {
    touch();
    if (rows.some((r) => r.item.catalog_item_id === item.catalog_item_id)) { setHint(`${item.name} já está na lista`); return; }
    setHint(null);
    setRows((rs) => [ ...rs, { item, value: "" } ]);
  }

  async function save() {
    if (saving) return;
    setNotice(null); setError(null);
    const found = rows.flatMap((r) => {
      const p = quantityProblem(r.value, "o mínimo", { allowZero: true });
      return p ? [ `${r.item.name}: ${p}` ] : [];
    });
    setProblems(found);
    if (found.length > 0) return;
    const sent = rows.map((r) => ({ catalog_item_id: r.item.catalog_item_id, minimum: toApiQuantity(r.value) }));
    setSaving(true);
    try {
      const saved = await putMinimums(location.id, sent);
      queryClient.setQueryData([ PH_MINIMUMS_KEY, location.id ], saved);
      void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] });
      setRows(toRows(saved));
      setNotice("Mínimos salvos.");
    } catch (err) {
      // `minimums[i]` é o índice do corpo enviado (a ordem da tela).
      const m = /^minimums\[(\d+)\]/.exec(errorPath(err) ?? "");
      const name = m ? rows[Number(m[1])]?.item.name : undefined;
      setError(name ? `${name}: ${pharmacyError(err)}` : pharmacyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.length === 0 ? <p style={muted}>nenhum mínimo definido neste local</p> : (
        <ul style={{ ...list, listStyle: "none", paddingLeft: 0, gap: 8 }}>
          {rows.map((r) => (
            <li key={r.item.catalog_item_id} style={row}>
              <span style={{ flex: "1 1 14ch" }}>{r.item.name}</span>
              <label style={{ ...fieldLabel, flex: "0 1 16ch" }}>
                {`Mínimo (${r.item.dispensing_unit})`}
                <input value={r.value} inputMode="decimal" aria-label={`Mínimo de ${r.item.name} (${r.item.dispensing_unit})`} style={inputStyle}
                  onChange={(e) => edit(r.item.catalog_item_id, e.target.value)} />
              </label>
              <button type="button" style={secondaryButtonStyle} aria-label={`Remover ${r.item.name}`} onClick={() => remove(r.item.catalog_item_id)}>Remover</button>
            </li>
          ))}
        </ul>
      )}
      <ItemSearch label="Acrescentar medicamento" onPick={add} />
      {hint && <small style={muted}>{hint}</small>}
      {problems.length > 0 && (
        <div role="alert" style={alert}>
          {problems.length === 1 ? problems[0] : <ul style={list}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
      {notice && <p role="status" style={okText}>{notice}</p>}
      <div style={row}>
        <button type="button" style={buttonStyle} disabled={saving} onClick={() => void save()}>Salvar mínimos</button>
      </div>
    </div>
  );
}
