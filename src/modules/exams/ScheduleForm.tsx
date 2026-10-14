// src/modules/exams/ScheduleForm.tsx
// Agendamento (contrato §3 "schedule" e §6): data e hora na hora da cidade
// e o local. `providers` null = o prestador já está definido (autorizado pela
// regulação, ou é o próprio prestador no portal); lista = a unidade escolhe.
import { useState, type FormEvent } from "react";
import type { ExamProviderRef } from "../../lib/api";
import { examError, scheduleProblem, type ScheduleDraft } from "../../lib/exams";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, row } from "./styles";

export function ScheduleForm({ providers, onSubmit, onCancel }: {
  providers: ExamProviderRef[] | null; onSubmit(d: ScheduleDraft): Promise<void>; onCancel(): void;
}) {
  const [ draft, setDraft ] = useState<ScheduleDraft>({ providerId: "", at: "", place: "" });
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const set = (patch: Partial<ScheduleDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = scheduleProblem(draft, providers !== null);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try { await onSubmit(draft); } catch (err) { setError(examError(err)); } finally { setBusy(false); }
  }

  return (
    <form aria-label="Agendar exame" onSubmit={submit} noValidate style={form}>
      {providers !== null && providers.length === 0 && (
        <p role="alert" style={alert}>nenhum prestador ativo faz este exame — cadastre em Catálogo e prestadores</p>
      )}
      {providers !== null && providers.length > 0 && (
        <label style={fieldLabel}>
          Prestador
          <select value={draft.providerId} style={inputStyle} onChange={(e) => set({ providerId: e.target.value })}>
            <option value="">escolha…</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <label style={fieldLabel}>
        Data e hora
        <input type="datetime-local" value={draft.at} style={inputStyle} onChange={(e) => set({ at: e.target.value })} />
      </label>
      <label style={fieldLabel}>
        Local
        <input value={draft.place} placeholder="endereço ou nome do posto de coleta" style={inputStyle} onChange={(e) => set({ place: e.target.value })} />
      </label>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Confirmar agendamento</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar</button>
      </div>
    </form>
  );
}
