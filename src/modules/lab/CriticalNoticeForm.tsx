// src/modules/lab/CriticalNoticeForm.tsx
// Registro da comunicação do valor crítico (spec §5.7; contrato §5): quem foi
// avisado, a função, o canal e a hora (padrão: agora, na hora da cidade).
import { useState } from "react";
import { recordCriticalNotice } from "../../lib/api";
import { CHANNEL_OPTIONS, EMPTY_CRITICAL, criticalBody, criticalProblem, labError, type CriticalDraft } from "../../lib/lab";
import { cityIsoDate, fmtHourMinute } from "../../lib/format";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, row } from "../exams/styles";

export function cityNowLocal(): string {
  return `${cityIsoDate()}T${fmtHourMinute(new Date().toISOString())}`;
}

export function CriticalNoticeForm({ resultId, label, onDone, onCancel }: { resultId: string; label: string; onDone(): void; onCancel(): void }) {
  const [ draft, setDraft ] = useState<CriticalDraft>(() => ({ ...EMPTY_CRITICAL, at: cityNowLocal() }));
  const [ error, setError ] = useState<string | null>(null);
  const set = (patch: Partial<CriticalDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    const problem = criticalProblem(draft, new Date().toISOString());
    if (problem) { setError(problem); return; }
    setError(null);
    try {
      await recordCriticalNotice(criticalBody(resultId, draft));
      onDone();
    } catch (err) {
      setError(labError(err));
    }
  }

  return (
    <section aria-label={`Aviso do valor crítico — ${label}`} style={box}>
      <label style={fieldLabel}>Quem foi avisado<input value={draft.person} maxLength={120} style={inputStyle} onChange={(e) => set({ person: e.target.value })} /></label>
      <label style={fieldLabel}>Função<input value={draft.role} maxLength={60} style={inputStyle} onChange={(e) => set({ role: e.target.value })} /></label>
      <label style={fieldLabel}>
        Como
        <select value={draft.channel} style={inputStyle} onChange={(e) => set({ channel: e.target.value as CriticalDraft["channel"] })}>
          <option value="">—</option>
          {CHANNEL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      <label style={fieldLabel}>Quando<input type="datetime-local" value={draft.at} style={inputStyle} onChange={(e) => set({ at: e.target.value })} /></label>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <ActionButton onClick={save}>Registrar aviso</ActionButton>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  );
}
