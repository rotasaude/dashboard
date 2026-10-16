// Digitação do resultado (spec §5.6; contrato §5). A faixa de referência já
// vem escolhida pelo api (sexo e idade na data da coleta); a tela só mostra a
// prévia da marca, bloqueia fora de entry_min/entry_max e converte a vírgula.
// Calculado (formula) não se digita: o api preenche ao salvar. Toda gravação
// cria linha nova (repetição); o valor que vale é o `effective` (B30).
// Nada aqui vai para log, console ou storage: valores e etiqueta só na tela.
import { useId, useState } from "react";
import { enterLabResults, errorCode, type LabAnalyteEntry, type LabEntryItem, type LabResultRow } from "../../lib/api";
import { entryProblem, flagLabel, flagTone, labError, normalizeNumber, previewFlag } from "../../lib/lab";
import { fmtDay } from "../../lib/exams";
import { fmtDateTime } from "../../lib/format";
import { ActionButton } from "../../components/ActionButton";
import { Tag } from "../../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, list, muted, okText, row, title } from "../exams/styles";

const n = (v: number) => String(v).replace(".", ",");
const SEX: Record<string, string> = { female: "feminino", male: "masculino" };

export function referenceText(a: LabAnalyteEntry): string {
  const parts: string[] = [];
  const ref = a.reference;
  if (ref && (ref.low !== null || ref.high !== null)) {
    const unit = a.unit ? ` ${a.unit}` : "";
    if (ref.low !== null && ref.high !== null) parts.push(`referência ${n(ref.low)} a ${n(ref.high)}${unit}`);
    else if (ref.low !== null) parts.push(`referência ≥ ${n(ref.low)}${unit}`);
    else parts.push(`referência ≤ ${n(ref.high as number)}${unit}`);
  } else if (ref?.text) {
    parts.push(`referência ${ref.text}`);
  }
  if (a.entry_min !== null || a.entry_max !== null) {
    parts.push(`limite de digitação ${a.entry_min === null ? "—" : n(a.entry_min)} a ${a.entry_max === null ? "—" : n(a.entry_max)}`);
  }
  return parts.join(" · ");
}

function rowText(r: LabResultRow): string {
  const who = r.source === "hl7" ? "aparelho" : `digitado${r.entered_by ? ` por ${r.entered_by}` : ""}`;
  return `${r.value}${r.unit ? ` ${r.unit}` : ""} · ${who} · ${fmtDateTime(r.entered_at)}`;
}

export function ResultEntryForm({ item, onSaved, onStale, onClose }: { item: LabEntryItem; onSaved(): void; onStale?(): void; onClose(): void }) {
  const [ values, setValues ] = useState<Record<string, string>>({});
  const [ fieldErrors, setFieldErrors ] = useState<Record<string, string>>({});
  const [ error, setError ] = useState<string | null>(null);
  const [ saved, setSaved ] = useState(false);
  const baseId = useId();
  const typed = item.analytes.filter((a) => !a.formula);

  async function save() {
    setSaved(false);
    const errors: Record<string, string> = {};
    const out: { analyte_key: string; value: string }[] = [];
    for (const a of typed) {
      const raw = values[a.key] ?? "";
      if (raw.trim() === "") continue;
      const problem = entryProblem(a, raw);
      if (problem) { errors[a.key] = problem; continue; }
      out.push({ analyte_key: a.key, value: a.value_type === "numeric" ? (normalizeNumber(raw) as string) : raw.trim() });
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) { setError("corrija os valores marcados"); return; }
    if (out.length === 0) { setError("digite ao menos um valor"); return; }
    setError(null);
    try {
      await enterLabResults({ item_id: item.item_id, values: out });
    } catch (err) {
      setError(labError(err));
      const body = (err as { body?: { analyte_key?: unknown } }).body;
      if (errorCode(err) === "out_of_entry_range" && typeof body?.analyte_key === "string") {
        setFieldErrors({ [body.analyte_key]: "fora do limite de digitação da versão atual — confira" });
      }
      if (errorCode(err) === "invalid_values" && typeof body?.analyte_key === "string") {
        setFieldErrors({ [body.analyte_key]: "falta um valor da conta deste componente — digite os componentes juntos" });
      }
      // nada foi gravado: quem chama relê o exame com mensagem neutra
      if (errorCode(err) === "invalid_transition" || errorCode(err) === "unknown_analyte") safely(onStale ?? onSaved);
      return;
    }
    // gravou: a releitura é de quem chama e a falha dela não desfaz o salvar
    setValues({});
    setSaved(true);
    safely(onSaved);
  }

  return (
    <section aria-label={`Digitação de ${item.label}`} style={{ ...box, maxWidth: 720 }}>
      <div style={row}>
        <h3 style={title}>{item.label}</h3>
        <Tag>{`v${item.version}`}</Tag>
        <span className="mono" style={muted}>{`${item.requisition_number} · ${item.barcode}`}</span>
      </div>
      <p style={muted}>{`${item.patient.display_name} · ${SEX[item.patient.biological_sex] ?? item.patient.biological_sex} · nascimento ${fmtDay(item.patient.birth_date)}`}</p>
      {item.restriction_note && <p style={alert}>{`amostra aceita com restrição: ${item.restriction_note}`}</p>}
      {item.status === "released" && <p style={alert}>laudo já liberado — o valor novo só entra numa retificação</p>}
      <div style={form}>
        {item.analytes.map((a) => {
          const id = `${baseId}-${a.key}`;
          const history = item.results.filter((r) => r.analyte_key === a.key);
          const preview = previewFlag(a, values[a.key] ?? "");
          return (
            <div key={a.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {a.formula ? (
                <p style={muted}>{`${a.name} · calculado ao salvar`}</p>
              ) : (
                <label htmlFor={id} style={fieldLabel}>{`${a.name}${a.unit ? ` (${a.unit})` : ""}`}</label>
              )}
              {!a.formula && a.value_type === "choice" && (
                <select id={id} value={values[a.key] ?? ""} style={inputStyle}
                  onChange={(e) => setValues((v) => ({ ...v, [a.key]: e.target.value }))}>
                  <option value="">—</option>
                  {(a.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {!a.formula && a.value_type !== "choice" && (
                <div style={row}>
                  <input id={id} value={values[a.key] ?? ""} autoComplete="off" inputMode={a.value_type === "numeric" ? "decimal" : "text"}
                    style={inputStyle} aria-describedby={fieldErrors[a.key] ? `${id}-err` : undefined}
                    onChange={(e) => setValues((v) => ({ ...v, [a.key]: e.target.value }))} />
                  {preview && preview !== "normal" && <Tag tone={flagTone(preview)}>{flagLabel(preview)}</Tag>}
                </div>
              )}
              {referenceText(a) && <p style={muted}>{referenceText(a)}</p>}
              {fieldErrors[a.key] && <p id={`${id}-err`} style={alert}>{fieldErrors[a.key]}</p>}
              {history.length > 0 && (
                <ul aria-label={`valores de ${a.name}`} style={list}>
                  {history.map((r) => (
                    <li key={r.id}>
                      {rowText(r)}
                      {r.flag !== "normal" && <> <Tag tone={flagTone(r.flag)}>{flagLabel(r.flag)}</Tag></>}
                      {r.effective && <> <Tag tone="ok">vale</Tag></>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
      {saved && <p role="status" style={okText}>Resultado salvo.</p>}
      <div style={row}>
        <ActionButton onClick={save}>Salvar resultado</ActionButton>
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
      </div>
    </section>
  );
}

function safely(fn: () => void) {
  try { fn(); } catch { /* a releitura falhar não desfaz o resultado já gravado */ }
}
