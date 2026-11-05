// Encerramento da matrícula (F-31.2; §4, P37, P41): destino do usuário (`options.destinations`; "00" é permanência e não encerra) e
// data de conclusão (padrão hoje; nunca futura nem antes do início) — os dois conferidos de uma vez antes de enviar. Mês fechado
// (`month_closed` em `closed_on`) e permanência aberta no leito (409 `night_stay_open`) vêm do api com a frase; `already_closed` diz
// que a tela estava velha (`onStale`). Sem duplo envio (`busy` + ref).
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { closePsyEnrollment, errorCode, type PsyEnrollment, type PsyOptions } from "../../lib/api";
import { CLOSE_NOTE, closeProblems, isStale, psyRefusals } from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";

const OWN = [ "destination", "closed_on" ];

export function CloseEnrollment({ enrollment: e, options, today, onClosed, onCancel, onStale }: {
  enrollment: PsyEnrollment; options: PsyOptions; today: string; onClosed(e: PsyEnrollment): void; onCancel(): void; onStale(text: string): void;
}) {
  const uid = useId();
  const [ destination, setDestination ] = useState("");
  const [ closedOn, setClosedOn ] = useState(today);
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ busy, setBusy ] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const focusNext = useRef(false);
  const ref = useRef<HTMLFormElement | null>(null);
  const title = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    alive.current = true;
    title.current?.focus();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    ref.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-general='true']")?.focus();
  }, [ problems ]);

  const show = (list: Problem[]) => { focusNext.current = true; setProblems(list); };
  const clear = (path: string) => setProblems((ps) => ps.filter((p) => p.path !== path));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (sending.current) return;
    const local = closeProblems({ destination, closedOn }, today, e.started_on);
    if (local.length > 0) { show(local); return; }
    sending.current = true;
    setBusy(true);
    setProblems([]);
    try {
      const closed = await closePsyEnrollment(e.id, { destination, closed_on: closedOn });
      if (alive.current) onClosed(closed);
    } catch (err) {
      if (!alive.current) return;
      const refusals = psyRefusals(err);
      if (isStale(err) || errorCode(err) === "already_closed") { onStale(refusals[0].text); return; }
      show(refusals.map((r) => ({ path: r.path, text: r.text })));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const textOf = (path: string) => problems.find((p) => p.path === path)?.text ?? null;
  const fid = (path: string) => `${uid}-${path}`;
  const aria = (path: string) => (textOf(path) ? { "aria-invalid": true as const, "aria-describedby": `${fid(path)}-err` } : {});
  const errNode = (path: string) => {
    const t = textOf(path);
    return t ? <p id={`${fid(path)}-err`} role="alert" style={alert}>{t}</p> : null;
  };
  const top = [ ...new Set(problems.filter((p) => !OWN.includes(p.path)).map((p) => p.text)) ];

  return (
    <form ref={ref} aria-label="Encerrar matrícula" style={form} onSubmit={(ev) => { void submit(ev); }} noValidate>
      <p ref={title} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Encerrar matrícula</p>
      <p style={muted}>{CLOSE_NOTE}</p>
      {top.map((t) => <p key={t} role="alert" tabIndex={-1} data-general="true" style={alert}>{t}</p>)}
      <div style={row}>
        <label style={fieldLabel}>
          Destino do usuário
          <select value={destination} style={inputStyle} {...aria("destination")}
            onChange={(ev) => { clear("destination"); setDestination(ev.target.value); }}>
            <option value="">Escolha o destino</option>
            {options.destinations.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Data de conclusão
          <input type="date" value={closedOn} min={e.started_on} max={today} style={inputStyle} {...aria("closed_on")}
            onChange={(ev) => { clear("closed_on"); setClosedOn(ev.target.value); }} />
        </label>
      </div>
      {errNode("destination")}{errNode("closed_on")}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Confirmar encerramento</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
