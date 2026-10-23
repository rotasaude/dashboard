// src/modules/careLines/EndEnrollmentForm.tsx
// Encerrar a inscrição com motivo (contrato §1 e §4): alta, óbito, mudança,
// fim da gestação ou outro (com nota). O encerramento não apaga nada: a
// inscrição e os contatos ficam (documento clínico, api#84). Nota até 500,
// só no corpo; vazia não vai. Óbito e mudança fecham também o pedido de
// agendamento aberto PELA linha (P16/M4): a tela avisa antes.
import { useState } from "react";
import { endCareEnrollment, type EndReason } from "../../lib/api";
import { EMPTY_END, END_REASONS, NOTE_MAX, endProblem, type EndDraft } from "../../lib/careLines";
import { dangerButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, row } from "../exams/styles";
import { useCareSubmit } from "./useCareSubmit";

export const CLOSES_REQUEST_WARNING = "Se houver pedido de agendamento aberto por esta linha, ele também será fechado, e o horário marcado nele, cancelado.";
const CLOSES_REQUEST: EndReason[] = [ "death", "moved" ];

export function EndEnrollmentForm({ enrollmentId, person, initialReason, onEnded, onStale, onCancel }: {
  enrollmentId: string; person: string; initialReason?: EndReason; onEnded(message: string): void; onStale(message: string): void; onCancel(): void;
}) {
  const [ d, setD ] = useState<EndDraft>({ ...EMPTY_END, reason: initialReason ?? "" });
  const { busy, error, setError, submit } = useCareSubmit();
  const set = (patch: Partial<EndDraft>) => { setError(null); setD((x) => ({ ...x, ...patch })); };

  async function end() {
    const problem = endProblem(d);
    if (problem) { setError(problem); return; }
    const ok = await submit(() => endCareEnrollment(enrollmentId, d.reason as EndReason, d.note), onStale);
    if (ok) onEnded(`Inscrição de ${person} encerrada.`);
  }

  return (
    <section aria-label={`Encerrar a inscrição de ${person}`} style={box}>
      <div style={form}>
        <label style={fieldLabel}>
          Motivo do encerramento
          <select value={d.reason} style={inputStyle} onChange={(e) => set({ reason: e.target.value as EndDraft["reason"] })}>
            <option value="">escolha</option>
            {END_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        {d.reason !== "" && CLOSES_REQUEST.includes(d.reason) && <p role="note" style={muted}>{CLOSES_REQUEST_WARNING}</p>}
        <label style={fieldLabel}>
          Nota
          <textarea rows={2} value={d.note} style={inputStyle} onChange={(e) => set({ note: e.target.value })} />
        </label>
        <p style={muted}>obrigatória em “outro motivo”; até {NOTE_MAX} caracteres. O histórico da pessoa não é apagado.</p>
        {error && <p role="alert" style={alert}>{error}</p>}
        <div style={row}>
          <button type="button" style={dangerButtonStyle} disabled={busy} onClick={() => void end()}>Encerrar inscrição</button>
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}
