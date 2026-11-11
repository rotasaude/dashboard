// Um item da prescrição interna da urgência (módulo 32b, F-32.8; api-shapes §3 e §5). A busca do medicamento é a da urgência
// (`POST /urgency/medication_search`, que não exige `clinical_documents`): o `MedicationSearch` do 19c chama outra rota, então
// aqui há uma busca local com o mesmo comportamento (termo só no corpo, a partir de 2 caracteres, fora da memória com a tela).
// Controlado de qualquer lista é aceito, com a marca (P1). Os problemas do item aparecem junto dele.
import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchUrgencyMedication, URGENCY_DOSE_UNITS, type UrgencyDoseUnit, type UrgencyMedicationHit } from "../../lib/api";
import { ROUTES, ROUTE_LABEL } from "../../lib/clinicalDocuments";
import { fmtHourMinute } from "../../lib/format";
import { urgencyError } from "../../lib/urgency";
import type { ItemDraft } from "../../lib/urgencyObservation";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { Problem } from "../../lib/pharmacy";
import { Tag } from "../../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";

const MIN_CHARS = 2;
export const hitLabel = (h: UrgencyMedicationHit): string => [ h.name, h.strength, h.dosage_form ].filter(Boolean).join(" ");
export const controlledText = (list: string | null | undefined): string | null => (list ? `controlado · lista ${list}` : null);

// `YYYY-MM-DDTHH:MM` na hora do navegador, que é o que o `datetime-local` entende; ISO com fuso vira hora local.
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");
export function toLocalInput(value: string): string {
  if (value === "" || LOCAL.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MedicationPicker({ label, unitId, onPick }: { label: string; unitId: string; onPick(h: UrgencyMedicationHit): void }) {
  const [ text, setText ] = useState("");
  const typed = text.trim();
  const term = useDebouncedValue(typed, 300);
  const enabled = term.length >= MIN_CHARS;
  // gcTime: 0 — o termo pode dizer o que a pessoa toma; sai da memória com a tela.
  const query = useQuery({ queryKey: [ "urgencyMedicationSearch", unitId, term ], queryFn: () => searchUrgencyMedication(term), enabled, gcTime: 0, retry: false });
  const show = enabled && typed.length >= MIN_CHARS;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={labelStyle}>
        {label}
        <input value={text} maxLength={60} style={inputStyle} onChange={(e) => setText(e.target.value)} />
      </label>
      {typed.length > 0 && typed.length < MIN_CHARS && <small style={hint}>digite pelo menos {MIN_CHARS} caracteres</small>}
      {show && query.isPending && <small className="mono" style={hint}>buscando…</small>}
      {show && query.isError && <p role="alert" style={alert}>{urgencyError(query.error)}</p>}
      {show && query.isSuccess && query.data.length === 0 && <small style={hint}>nenhum medicamento encontrado</small>}
      {show && query.isSuccess && query.data.length > 0 && (
        <ul aria-label={`resultados: ${label}`} style={list}>
          {query.data.map((h) => (
            <li key={h.catalog_item_id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button type="button" aria-label={hitLabel(h)} style={{ ...secondaryButtonStyle, flex: 1, textAlign: "left" }}
                onClick={() => { onPick(h); setText(""); }}>{hitLabel(h)}</button>
              {controlledText(h.controlled_list) && <Tag tone="warn" mono={false}>{controlledText(h.controlled_list)}</Tag>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface PrescriptionItemFieldsProps {
  index: number;
  draft: ItemDraft;
  onChange(patch: Partial<ItemDraft>): void;
  // Sem a função, o item não pode sair (o único item da prescrição).
  onRemove?(): void;
  problems: Problem[];
  unitId: string;
  // Item mantido da ativa: a primeira dose que vai ao api ("" = agora). Só para mostrar; o envio recalcula.
  keptAt?: string;
}

export function PrescriptionItemFields({ index, draft, onChange, onRemove, problems, unitId, keptAt }: PrescriptionItemFieldsProps) {
  const n = index + 1;
  const field = (label: string, input: ReactNode) => <label style={labelStyle}>{label}{input}</label>;
  const marks = controlledText(draft.item?.controlled_list);
  return (
    <fieldset aria-label={`Item ${n}`} style={fieldset}>
      <legend style={legend}>Item {n}</legend>
      {draft.item ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <strong style={{ fontSize: 13 }}>{draft.item.name}</strong>
          {marks && <Tag tone="warn" mono={false}>{marks}</Tag>}
          <button type="button" style={secondaryButtonStyle} aria-label={`Trocar o medicamento do item ${n}`}
            onClick={() => onChange({ item: null })}>Trocar</button>
        </div>
      ) : (
        <MedicationPicker label={`Medicamento do item ${n}`} unitId={unitId}
          onPick={(h) => onChange({ item: { catalog_item_id: h.catalog_item_id, name: hitLabel(h), ...(h.controlled_list ? { controlled_list: h.controlled_list } : {}) } })} />
      )}
      <div style={row}>
        {field(`Dose do item ${n}`, <input value={draft.dose} inputMode="decimal" style={{ ...inputStyle, maxWidth: 110 }} onChange={(e) => onChange({ dose: e.target.value })} />)}
        {field(`Unidade da dose do item ${n}`, (
          <select value={draft.doseUnit} style={inputStyle} onChange={(e) => onChange({ doseUnit: e.target.value as UrgencyDoseUnit | "" })}>
            <option value="">escolha</option>
            {URGENCY_DOSE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        ))}
        {field(`Via do item ${n}`, (
          <select value={draft.route} style={inputStyle} onChange={(e) => onChange({ route: e.target.value as ItemDraft["route"] })}>
            {ROUTES.map((r) => <option key={r} value={r}>{ROUTE_LABEL[r]}</option>)}
          </select>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div role="radiogroup" aria-label={`Frequência do item ${n}`} style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {([ [ "once", "Dose única" ], [ "interval", "De tantas em tantas horas" ], [ "if_needed", "Se necessário" ] ] as const).map(([ kind, text ]) => (
            <label key={kind} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
              <input type="radio" name={`freq-${unitId}-${index}`} aria-label={`${text} (item ${n})`} checked={draft.kind === kind}
                onChange={() => onChange({ kind })} />
              {text}
            </label>
          ))}
        </div>
        {draft.kind === "interval" && field(`Intervalo em horas do item ${n}`,
          <input value={draft.intervalHours} inputMode="numeric" style={{ ...inputStyle, maxWidth: 110 }} onChange={(e) => onChange({ intervalHours: e.target.value })} />)}
        {draft.kind === "if_needed" && field(`Máximo por dia do item ${n}`,
          <input value={draft.maxPerDay} inputMode="numeric" style={{ ...inputStyle, maxWidth: 110 }} onChange={(e) => onChange({ maxPerDay: e.target.value })} />)}
      </div>
      {keptAt === undefined ? (
        <>
          {field(`Primeira dose (opcional) do item ${n}`,
            <input type="datetime-local" value={toLocalInput(draft.firstDoseAt)} style={{ ...inputStyle, maxWidth: 240 }} onChange={(e) => onChange({ firstDoseAt: e.target.value })} />)}
          <small style={hint}>Vazio = agora. Vai de 1 hora atrás até 24 horas à frente.</small>
        </>
      ) : (
        <small style={hint}>{keptAt === "" ? "Primeira dose: agora." : `Mantém a grade: próxima ${fmtHourMinute(keptAt)}.`}</small>
      )}
      {field(`Orientação (opcional) do item ${n}`,
        <textarea value={draft.instructions} rows={2} maxLength={500} style={inputStyle} onChange={(e) => onChange({ instructions: e.target.value })} />)}
      {field(`Quantidade do estoque por dose do item ${n}`,
        <input value={draft.quantityPerDose} inputMode="decimal" style={{ ...inputStyle, maxWidth: 110 }} onChange={(e) => onChange({ quantityPerDose: e.target.value })} />)}
      <small style={hint}>{draft.item?.stock_unit ? `Em ${draft.item.stock_unit}. ` : ""}Usada só quando a baixa de estoque estiver ligada.</small>
      {problems.length > 0 && (
        <ul aria-label={`o que impede o item ${n}`} style={{ margin: 0, paddingLeft: 18 }}>
          {problems.map((p) => <li key={`${p.path}-${p.text}`} role="alert" style={alert}>{p.text}</li>)}
        </ul>
      )}
      {onRemove && <div><button type="button" style={secondaryButtonStyle} aria-label={`Remover item ${n}`} onClick={onRemove}>Remover item</button></div>}
    </fieldset>
  );
}

const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid var(--rule2)", borderRadius: 8, margin: 0, minWidth: 0 };
const legend: CSSProperties = { padding: "0 4px", fontSize: 12.5, fontWeight: 600, color: "var(--ink)" };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 12 };
