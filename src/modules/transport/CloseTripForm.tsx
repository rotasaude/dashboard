// Fechamento da viagem pelo motorista (módulo 30, F-30.4): odômetro, abastecimentos e despesas. A tela confere tudo antes
// (`closeProblems`, inclusive presença pendente) e mostra cada problema; a recusa do api vem traduzida, todas de uma vez
// (caminhos pontuados `fuel.0.liters`, `attendance_pending` em `passengers`). Sem duplo envio.
import { useRef, useState, type FormEvent } from "react";
import { closeMyTrip, type Trip } from "../../lib/api";
import { closeBody, closeProblems, expenseKindLabel, transportRefusals, type CloseDraft } from "../../lib/transport";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, legend, list, row, stack } from "../exams/styles";

const EMPTY: CloseDraft = { odometerStart: "", odometerEnd: "", fuel: [], expenses: [] };
const EXPENSE_KINDS = [ "toll", "parking", "meal", "other" ];
const TARGET = { minHeight: 44 };

export function CloseTripForm({ trip, onClosed, onCancel, onRefused }: {
  trip: Trip; onClosed(t: Trip): void; onCancel?(): void; onRefused?(err: unknown): void;
}) {
  const [ draft, setDraft ] = useState<CloseDraft>(EMPTY);
  const [ problems, setProblems ] = useState<{ path: string; text: string }[]>([]);
  const [ busy, setBusy ] = useState(false);
  const inFlight = useRef(false);

  const bad = new Set(problems.map((p) => p.path));
  const invalid = (path: string) => (bad.has(path) ? true : undefined);
  const set = (patch: Partial<CloseDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setFuel = (i: number, patch: Partial<CloseDraft["fuel"][number]>) =>
    setDraft((d) => ({ ...d, fuel: d.fuel.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const setExpense = (i: number, patch: Partial<CloseDraft["expenses"][number]>) =>
    setDraft((d) => ({ ...d, expenses: d.expenses.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const local = closeProblems(draft, trip);
    if (local.length > 0) { setProblems(local); return; }
    inFlight.current = true;
    setProblems([]); setBusy(true);
    try {
      const t = await closeMyTrip(trip.id, closeBody(draft));
      onClosed(t);
    } catch (err) {
      setProblems(transportRefusals(err).map((r) => ({ path: r.path, text: r.text })));
      onRefused?.(err);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const texts = [ ...new Set(problems.map((p) => p.text)) ];
  const field = (id: string, label: string, value: string, onChange: (v: string) => void, path: string, inputMode: "numeric" | "decimal" | "text" = "text") => (
    <div style={fieldLabel}>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} inputMode={inputMode} aria-invalid={invalid(path)} style={{ ...inputStyle, ...TARGET }}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
  const base = `close-${trip.id}`;

  return (
    <form aria-label="Fechamento da viagem" style={stack} onSubmit={(e) => { void submit(e); }} noValidate>
      {texts.length > 0 && (
        <ul aria-label="Problemas do fechamento" style={{ ...list, color: "var(--down)" }}>
          {texts.map((t) => <li key={t} role="alert" style={alert}>{t}</li>)}
        </ul>
      )}
      {field(`${base}-start`, "Odômetro na saída", draft.odometerStart, (v) => set({ odometerStart: v }), "odometer_start", "numeric")}
      {field(`${base}-end`, "Odômetro na chegada", draft.odometerEnd, (v) => set({ odometerEnd: v }), "odometer_end", "numeric")}

      <fieldset style={fieldset}>
        <legend style={legend}>Abastecimentos</legend>
        {draft.fuel.map((f, i) => (
          <div key={i} style={stack}>
            {field(`${base}-fuel-${i}-liters`, `Litros ${i + 1}`, f.liters, (v) => setFuel(i, { liters: v }), `fuel.${i}.liters`, "decimal")}
            {field(`${base}-fuel-${i}-amount`, `Valor ${i + 1}`, f.amount, (v) => setFuel(i, { amount: v }), `fuel.${i}.amount_cents`, "decimal")}
            {field(`${base}-fuel-${i}-station`, `Posto ${i + 1}`, f.station, (v) => setFuel(i, { station: v }), `fuel.${i}.station`)}
            <button type="button" style={{ ...secondaryButtonStyle, ...TARGET }}
              onClick={() => setDraft((d) => ({ ...d, fuel: d.fuel.filter((_, j) => j !== i) }))}>{`Remover abastecimento ${i + 1}`}</button>
          </div>
        ))}
        <button type="button" style={{ ...secondaryButtonStyle, ...TARGET }}
          onClick={() => setDraft((d) => ({ ...d, fuel: [ ...d.fuel, { liters: "", amount: "", station: "" } ] }))}>Adicionar abastecimento</button>
      </fieldset>

      <fieldset style={fieldset}>
        <legend style={legend}>Despesas</legend>
        {draft.expenses.map((x, i) => (
          <div key={i} style={stack}>
            <div style={fieldLabel}>
              <label htmlFor={`${base}-exp-${i}-kind`}>{`Tipo da despesa ${i + 1}`}</label>
              <select id={`${base}-exp-${i}-kind`} value={x.kind} aria-invalid={invalid(`expenses.${i}.kind`)} style={{ ...inputStyle, ...TARGET }}
                onChange={(e) => setExpense(i, { kind: e.target.value })}>
                <option value="">escolha</option>
                {EXPENSE_KINDS.map((k) => <option key={k} value={k}>{expenseKindLabel(k)}</option>)}
              </select>
            </div>
            {field(`${base}-exp-${i}-amount`, `Valor da despesa ${i + 1}`, x.amount, (v) => setExpense(i, { amount: v }), `expenses.${i}.amount_cents`, "decimal")}
            {field(`${base}-exp-${i}-note`, `Observação da despesa ${i + 1}`, x.note, (v) => setExpense(i, { note: v }), `expenses.${i}.note`)}
            <button type="button" style={{ ...secondaryButtonStyle, ...TARGET }}
              onClick={() => setDraft((d) => ({ ...d, expenses: d.expenses.filter((_, j) => j !== i) }))}>{`Remover despesa ${i + 1}`}</button>
          </div>
        ))}
        <button type="button" style={{ ...secondaryButtonStyle, ...TARGET }}
          onClick={() => setDraft((d) => ({ ...d, expenses: [ ...d.expenses, { kind: "", amount: "", note: "" } ] }))}>Adicionar despesa</button>
      </fieldset>

      <div style={row}>
        <button type="submit" disabled={busy} style={{ ...(busy ? disabledButtonStyle : buttonStyle), ...TARGET }}>Confirmar fechamento</button>
        {onCancel && <button type="button" disabled={busy} style={{ ...secondaryButtonStyle, ...TARGET }} onClick={onCancel}>Voltar</button>}
      </div>
    </form>
  );
}
