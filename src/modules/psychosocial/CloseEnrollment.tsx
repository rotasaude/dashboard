// Encerramento da matrícula (F-31.2; §4, P37, P41): destino do usuário (`options.destinations`; "00" é permanência e não encerra) e
// data de conclusão (padrão hoje; nunca futura nem antes do início) — os dois conferidos de uma vez antes de enviar. Mês fechado
// (`month_closed` em `closed_on`) e permanência aberta no leito (409 `night_stay_open`) vêm do api com a frase; `already_closed` diz
// que a tela estava velha (`onStale`). Sem duplo envio (`busy` + ref).
import { useState } from "react";
import { closePsyEnrollment, type PsyEnrollment, type PsyOptions } from "../../lib/api";
import { CLOSE_NOTE, closeProblems } from "../../lib/psychosocial";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { fieldLabel, form, muted, row } from "../exams/styles";
import { useFormProblems } from "./useFormProblems";

const OWN = [ "destination", "closed_on" ];

export function CloseEnrollment({ enrollment: e, options, today, onClosed, onCancel, onStale }: {
  enrollment: PsyEnrollment; options: PsyOptions; today: string; onClosed(e: PsyEnrollment): void; onCancel(): void; onStale(text: string): void;
}) {
  const f = useFormProblems();
  const [ destination, setDestination ] = useState("");
  const [ closedOn, setClosedOn ] = useState(today);
  const { aria, errNode, busy } = f;

  return (
    <form ref={f.formRef} aria-label="Encerrar matrícula" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => closeProblems({ destination, closedOn }, today, e.started_on),
        call: () => closePsyEnrollment(e.id, { destination, closed_on: closedOn }), ok: onClosed, stale: onStale
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Encerrar matrícula</p>
      <p style={muted}>{CLOSE_NOTE}</p>
      {f.top((path) => OWN.includes(path))}
      <div style={row}>
        <label style={fieldLabel}>
          Destino do usuário
          <select value={destination} style={inputStyle} {...aria("destination")}
            onChange={(ev) => { f.clear("destination"); setDestination(ev.target.value); }}>
            <option value="">Escolha o destino</option>
            {options.destinations.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Data de conclusão
          <input type="date" value={closedOn} min={e.started_on} max={today} style={inputStyle} {...aria("closed_on")}
            onChange={(ev) => { f.clear("closed_on"); setClosedOn(ev.target.value); }} />
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
