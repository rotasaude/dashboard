// Internação no destino (módulo 30, F-30.5): só em `scheduled`/`travelling` (quem mostra decide). "Internado desde" vai do dia
// anterior ao primeiro trecho de ida vivo (ou ao dia do envio) até hoje; "Alta em" é opcional, entre o início e hoje. Com uma
// estada aberta, o formulário já vem com o início dela: mandar a alta a fecha. O api pede segundo fator (SensitiveAction) e
// recusa `inpatient_open` / `inpatient_overlap`.
import { useState, type FormEvent } from "react";
import { setTfdInpatient, type TfdCase } from "../../lib/api";
import { inpatientProblems } from "../../lib/tfd";
import { cityIsoDate } from "../../lib/format";
import { fmtIsoDay } from "../../lib/transport";
import type { Problem } from "../../lib/pharmacy";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";
import { useTfdRefusalText } from "./stepUpText";

export const NO_ALLOWANCE_WHILE_INPATIENT = "Sem diária enquanto o paciente está internado no destino.";

type Body = { from: string; to?: string };

function dayBefore(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`) - 24 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(0, 10);
}

// O mesmo piso do api: o trecho de ida vivo mais antigo, senão o dia (na cidade) do envio; menos um dia.
export function inpatientFloor(c: TfdCase): string | null {
  const outbound = c.legs.filter((l) => l.direction === "outbound" && !l.voided).map((l) => l.date).sort();
  const base = outbound[0] ?? (c.submitted_at ? cityIsoDate(new Date(c.submitted_at)) : null);
  return base ? dayBefore(base) : null;
}

export function InpatientForm({ tfdCase, today = cityIsoDate(), onSaved, onCancel, onGoToSecurity }: {
  tfdCase: TfdCase; today?: string; onSaved(c: TfdCase): void; onCancel?(): void; onGoToSecurity?(): void;
}) {
  const refusalText = useTfdRefusalText();
  const open = tfdCase.inpatient.find((s) => s.to === null);
  const [ from, setFrom ] = useState(open?.from ?? "");
  const [ to, setTo ] = useState("");
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ pending, setPending ] = useState<Body | null>(null);
  const floor = inpatientFloor(tfdCase);

  function submit(e: FormEvent) {
    e.preventDefault();
    const found = inpatientProblems(from, to, today);
    // Com estada aberta, o único registro possível é a alta dela (outra abriria `inpatient_open`).
    if (open && to === "" && !found.some((p) => p.path === "to")) found.push({ path: "to", text: "informe a alta para fechar a internação aberta" });
    if (floor && /^\d{4}-\d{2}-\d{2}$/.test(from) && from < floor && !found.some((p) => p.path === "from")) {
      found.unshift({ path: "from", text: `o início da internação não pode ser antes de ${fmtIsoDay(floor)}` });
    }
    setProblems(found);
    if (found.length > 0) { setPending(null); return; }
    setPending({ from, ...(to ? { to } : {}) });
  }

  const fromProblem = problems.find((p) => p.path === "from");
  const toProblem = problems.find((p) => p.path === "to");
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setPending(null); };

  return (
    <div style={form}>
      <form aria-label="Internação no destino" onSubmit={submit} style={form} noValidate>
        <p style={muted}>{NO_ALLOWANCE_WHILE_INPATIENT}</p>
        {open && <p style={muted}>{`Há uma internação aberta desde ${fmtIsoDay(open.from)}: informe a alta para fechá-la.`}</p>}
        <label style={fieldLabel}>
          Internado desde
          <input type="date" value={from} min={floor ?? undefined} max={today} disabled={pending !== null}
            aria-invalid={fromProblem ? true : undefined} style={inputStyle} onChange={edit(setFrom)} />
        </label>
        {fromProblem && <p role="alert" style={alert}>{fromProblem.text}</p>}
        <label style={fieldLabel}>
          Alta em
          <input type="date" value={to} min={from || undefined} max={today} disabled={pending !== null}
            aria-invalid={toProblem ? true : undefined} style={inputStyle} onChange={edit(setTo)} />
        </label>
        {toProblem && <p role="alert" style={alert}>{toProblem.text}</p>}
        {!pending && (
          <div style={row}>
            <button type="submit" style={buttonStyle}>Salvar internação</button>
            {onCancel && <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Fechar</button>}
          </div>
        )}
      </form>
      {pending && (
        <SensitiveAction title="Confirmar internação" requiresStepUp onGoToSecurity={onGoToSecurity}
          description="A internação fica registrada no processo; enquanto ela durar, não há diária."
          translateError={refusalText}
          run={async () => { onSaved(await setTfdInpatient(tfdCase.id, pending)); }}
          onDone={() => setPending(null)} onCancel={() => setPending(null)} />
      )}
    </div>
  );
}
