// Equipamento da cadeia de frio (módulo 29; F-29.6; contrato §8; §15 V14): criar e editar, só do `room_lead` (sala) ou `stock_keeper`
// (rede de frio) — o api confere. Nome de 3 a 120 caracteres (recusado, nunca cortado: sem maxLength), tipo, mínima e máxima (padrão
// +2 e +8 °C; uma casa, vírgula ou ponto; mínima < máxima) e ativo. Nunca se apaga: desativa-se. A tela confere tudo de uma vez e mostra
// todas as recusas do api, cada uma no seu campo.
import { useEffect, useId, useRef, useState } from "react";
import { createEquipment, updateEquipment, type ColdChainEquipment, type EquipmentInput } from "../../lib/api";
import { type Problem } from "../../lib/pharmacy";
import { equipmentKindLabel, parseCelsius, vaccinationRefusals } from "../../lib/vaccination";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, form, row } from "../exams/styles";

const KINDS = [ "refrigerator", "chamber", "freezer" ];

interface Draft { name: string; kind: string; min: string; max: string; active: boolean }

const text = (n: number) => String(n).replace(".", ",");

export function equipmentProblems(d: Draft): Problem[] {
  const out: Problem[] = [];
  const n = d.name.trim().length;
  if (n < 3 || n > 120) out.push({ path: "name", text: "o nome precisa ter de 3 a 120 caracteres" });
  if (!KINDS.includes(d.kind)) out.push({ path: "kind", text: "escolha o tipo do equipamento" });
  const min = parseCelsius(d.min);
  const max = parseCelsius(d.max);
  if (min === null) out.push({ path: "min_c", text: "informe a temperatura mínima da faixa (ex.: 2)" });
  if (max === null) out.push({ path: "max_c", text: "informe a temperatura máxima da faixa (ex.: 8)" });
  if (min !== null && max !== null && min >= max) out.push({ path: "max_c", text: "a máxima precisa ser maior que a mínima" });
  return out;
}

export function EquipmentForm({ locationId, initial, onSaved, onCancel }: {
  locationId: string; initial: ColdChainEquipment | null; onSaved(saved: ColdChainEquipment): void; onCancel(): void;
}) {
  const uid = useId();
  const [ draft, setDraft ] = useState<Draft>(() => initial
    ? { name: initial.name, kind: initial.kind, min: text(initial.min_c), max: text(initial.max_c), active: initial.active }
    : { name: "", kind: "", min: "2", max: "8", active: true });
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ busy, setBusy ] = useState(false);
  const firstInvalid = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (firstInvalid.current) document.getElementById(`${uid}-${firstInvalid.current}`)?.focus();
    firstInvalid.current = null;
  }, [ problems, uid ]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((d) => ({ ...d, [key]: value })); setProblems([]); };

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy) return;
    const found = equipmentProblems(draft);
    if (found.length > 0) { firstInvalid.current = found[0].path; setProblems(found); return; }
    const input: EquipmentInput = {
      location_id: locationId, name: draft.name.trim(), kind: draft.kind, min_c: parseCelsius(draft.min) as number,
      max_c: parseCelsius(draft.max) as number, active: draft.active
    };
    setBusy(true);
    try {
      const saved = initial ? await updateEquipment(initial.id, input) : await createEquipment(input);
      if (alive.current) onSaved(saved);
    } catch (err) {
      if (!alive.current) return;
      const refusals = vaccinationRefusals(err).map((r) => ({ path: r.path, text: r.text }));
      firstInvalid.current = refusals.find((r) => r.path)?.path ?? null;
      setProblems(refusals);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const known = new Set([ "name", "kind", "min_c", "max_c", "active" ]);
  const byPath = (path: string) => problems.filter((p) => p.path === path);
  const ariaFor = (path: string) => (byPath(path).length > 0 ? { "aria-invalid": true, "aria-describedby": `${uid}-${path}-err` } : {});
  const errorsFor = (path: string) => {
    const errs = byPath(path);
    return errs.length > 0 ? <div id={`${uid}-${path}-err`}>{errs.map((p) => <p key={p.text} role="alert" style={alert}>{p.text}</p>)}</div> : null;
  };

  return (
    <form aria-label={initial ? `Editar equipamento — ${initial.name}` : "Novo equipamento"} style={form} onSubmit={(e) => void submit(e)} noValidate>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-name`}>Nome</label>
        <input id={`${uid}-name`} style={inputStyle} value={draft.name} onChange={(e) => set("name", e.target.value)} {...ariaFor("name")} />
        {errorsFor("name")}
      </div>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-kind`}>Tipo</label>
        <select id={`${uid}-kind`} style={inputStyle} value={draft.kind} onChange={(e) => set("kind", e.target.value)} {...ariaFor("kind")}>
          <option value="">escolha o tipo</option>
          {KINDS.map((k) => <option key={k} value={k}>{equipmentKindLabel(k)}</option>)}
        </select>
        {errorsFor("kind")}
      </div>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-min_c`}>Mínima da faixa (°C)</label>
        <input id={`${uid}-min_c`} inputMode="decimal" style={inputStyle} value={draft.min} onChange={(e) => set("min", e.target.value)} {...ariaFor("min_c")} />
        {errorsFor("min_c")}
      </div>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-max_c`}>Máxima da faixa (°C)</label>
        <input id={`${uid}-max_c`} inputMode="decimal" style={inputStyle} value={draft.max} onChange={(e) => set("max", e.target.value)} {...ariaFor("max_c")} />
        {errorsFor("max_c")}
      </div>
      <label style={checkLabel}>
        <input id={`${uid}-active`} type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} />
        Ativo
      </label>
      {errorsFor("active")}
      {problems.filter((p) => !known.has(p.path)).map((p) => <p key={`${p.path}-${p.text}`} role="alert" style={alert}>{p.text}</p>)}
      <div style={row}>
        <button type="submit" style={buttonStyle} disabled={busy}>Salvar equipamento</button>
        <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
