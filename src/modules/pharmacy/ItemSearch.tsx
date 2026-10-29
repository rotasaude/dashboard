// Busca de medicamento no catálogo da farmácia (módulo 27a; molde do MedicationSearch do 19c, pelo api da farmácia, D3).
// O termo vai no corpo de um POST, de 3 a 60 caracteres, e o cache sai da memória quando a tela fecha (gcTime: 0).
// Cada resultado é um botão "<nome> · <unidade de dispensação>" (nunca a concentração `unit`); controlado leva a marca ao lado.
// Escolher entrega o item a quem chama e limpa o campo.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchPharmacyItems, type StockItem } from "../../lib/api";
import { PH_ITEMS_KEY, pharmacyError } from "../../lib/pharmacy";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { Tag } from "../../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted, row } from "../exams/styles";

export const ITEM_SEARCH_MIN = 3;
export const ITEM_SEARCH_MAX = 60;

export function ItemSearch({ label, onPick, delayMs = 300, disabled = false }: {
  label: string; onPick(item: StockItem): void; delayMs?: number; disabled?: boolean;
}) {
  const [ text, setText ] = useState("");
  const typed = text.trim();
  const term = useDebouncedValue(typed, delayMs);
  const valid = (t: string) => t.length >= ITEM_SEARCH_MIN && t.length <= ITEM_SEARCH_MAX;
  const query = useQuery({
    queryKey: [ PH_ITEMS_KEY, term ], queryFn: () => searchPharmacyItems(term), enabled: valid(term), gcTime: 0
  });
  // Depois de escolher o campo limpa na hora; o termo atrasado não mantém a lista velha na tela.
  const show = valid(term) && valid(typed);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={fieldLabel}>
        {label}
        <input value={text} disabled={disabled} style={inputStyle} onChange={(e) => setText(e.target.value)} />
      </label>
      {typed.length > 0 && typed.length < ITEM_SEARCH_MIN && <small style={muted}>digite pelo menos {ITEM_SEARCH_MIN} caracteres</small>}
      {typed.length > ITEM_SEARCH_MAX && <small style={muted}>a busca tem no máximo {ITEM_SEARCH_MAX} caracteres</small>}
      {show && query.isPending && <small className="mono" style={muted}>buscando…</small>}
      {show && query.isError && <p role="alert" style={alert}>{pharmacyError(query.error)}</p>}
      {show && query.isSuccess && query.data.length === 0 && <small style={muted}>nenhum medicamento encontrado</small>}
      {show && query.isSuccess && query.data.length > 0 && (
        <div role="group" aria-label={`resultados: ${label}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {query.data.map((item) => (
            <div key={item.catalog_item_id} style={row}>
              <button type="button" disabled={disabled} style={{ ...secondaryButtonStyle, flex: 1, textAlign: "left" }}
                onClick={() => { onPick(item); setText(""); }}>
                {`${item.name} · ${item.dispensing_unit}`}
              </button>
              {item.controlled && <Tag tone="warn">{`controlado · lista ${item.controlled_list ?? "—"}`}</Tag>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
