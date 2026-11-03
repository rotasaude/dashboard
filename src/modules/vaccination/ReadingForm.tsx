// Leitura de temperatura de um equipamento da cadeia de frio (módulo 29; F-29.6; contrato §8; §15 V14). Qualquer pessoa da equipe do
// local registra. "Hora da leitura" (padrão agora, na hora de parede da cidade), atual, mínima e máxima com vírgula ou ponto e uma casa
// (RF5). A tela confere tudo de uma vez (readingProblems, com o relógio lido no clique) e, fora da faixa do equipamento, avisa ANTES de
// enviar que os lotes do local ficam bloqueados até a conduta. A resposta vai inteira a quem chamou (excursion_id, blocked_lots). Nada
// em URL, log ou storage.
import { useEffect, useId, useRef, useState } from "react";
import { recordReading, type ColdChainEquipment, type ReadingResult } from "../../lib/api";
import { type Problem } from "../../lib/pharmacy";
import {
  cityLocalInput, outOfRange, parseCelsius, readingBody, readingProblems, vaccinationRefusals, type ReadingDraft
} from "../../lib/vaccination";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, row } from "../exams/styles";

// "+2 a +8 °C" (sinal explícito; vírgula decimal).
export function fmtRange(eq: Pick<ColdChainEquipment, "min_c" | "max_c">): string {
  const s = (n: number) => `${n > 0 ? "+" : ""}${String(n).replace(".", ",")}`;
  return `${s(eq.min_c)} a ${s(eq.max_c)} °C`;
}

export const outOfRangeWarning = (eq: Pick<ColdChainEquipment, "min_c" | "max_c">): string =>
  `Fora de ${fmtRange(eq)}: ao salvar, os lotes deste local ficam bloqueados até a conduta.`;

const FIELDS: { key: keyof ReadingDraft; path: string; label: string }[] = [
  { key: "current", path: "current_c", label: "Temperatura atual" },
  { key: "min", path: "min_c", label: "Mínima" },
  { key: "max", path: "max_c", label: "Máxima" }
];

export function ReadingForm({ equipment, now, onSaved, onCancel }: {
  equipment: ColdChainEquipment; now?: Date; onSaved(result: ReadingResult): void; onCancel(): void;
}) {
  const uid = useId();
  const [ draft, setDraft ] = useState<ReadingDraft>(() => ({ readAt: cityLocalInput(now ?? new Date()), current: "", min: "", max: "" }));
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ busy, setBusy ] = useState(false);
  const firstInvalid = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (firstInvalid.current) document.getElementById(`${uid}-${firstInvalid.current}`)?.focus();
    firstInvalid.current = null;
  }, [ problems, uid ]);

  const set = (key: keyof ReadingDraft, value: string) => { setDraft((d) => ({ ...d, [key]: value })); setProblems([]); };

  // O aviso só depende das três temperaturas válidas (a hora não muda a faixa).
  const temps = [ draft.current, draft.min, draft.max ].map(parseCelsius);
  const warn = temps.every((t) => t !== null)
    && outOfRange({ read_at: "", current_c: temps[0] as number, min_c: temps[1] as number, max_c: temps[2] as number }, equipment);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy) return;
    const found = readingProblems(draft, now ?? new Date());
    if (found.length > 0) { firstInvalid.current = found[0].path; setProblems(found); return; }
    setProblems([]); setBusy(true);
    try {
      const result = await recordReading(equipment.id, readingBody(draft));
      if (alive.current) onSaved(result);
    } catch (err) {
      if (!alive.current) return;
      const refusals = vaccinationRefusals(err).map((r) => ({ path: r.path, text: r.text }));
      firstInvalid.current = refusals.find((r) => r.path)?.path ?? null;
      setProblems(refusals);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const byPath = (path: string) => problems.filter((p) => p.path === path);
  const known = new Set([ "read_at", ...FIELDS.map((f) => f.path) ]);
  const general = problems.filter((p) => !known.has(p.path));

  const ariaFor = (path: string) => (byPath(path).length > 0 ? { "aria-invalid": true, "aria-describedby": `${uid}-${path}-err` } : {});
  const errorsFor = (path: string) => {
    const errs = byPath(path);
    return errs.length > 0 ? <div id={`${uid}-${path}-err`}>{errs.map((p) => <p key={p.text} role="alert" style={alert}>{p.text}</p>)}</div> : null;
  };

  return (
    <form aria-label={`Leitura — ${equipment.name}`} style={form} onSubmit={(e) => void submit(e)} noValidate>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-read_at`}>Hora da leitura</label>
        <input id={`${uid}-read_at`} type="datetime-local" style={inputStyle} value={draft.readAt} onChange={(e) => set("readAt", e.target.value)}
          {...ariaFor("read_at")} />
        {errorsFor("read_at")}
      </div>
      {FIELDS.map((f) => (
        <div key={f.path} style={fieldLabel}>
          <label htmlFor={`${uid}-${f.path}`}>{f.label}</label>
          <input id={`${uid}-${f.path}`} inputMode="decimal" style={inputStyle} value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)}
            {...ariaFor(f.path)} />
          {errorsFor(f.path)}
        </div>
      ))}
      {general.map((p) => <p key={`${p.path}-${p.text}`} role="alert" style={alert}>{p.text}</p>)}
      {warn && <p role="alert" style={alert}>{outOfRangeWarning(equipment)}</p>}
      <div style={row}>
        <button type="submit" style={buttonStyle} disabled={busy}>{warn ? "Salvar e bloquear os lotes" : "Salvar leitura"}</button>
        <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
