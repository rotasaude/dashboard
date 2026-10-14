// src/modules/exams/ProviderOrderPanel.tsx
// Uma guia no portal do prestador (spec §6; contrato §2 `<provider_order>` e
// §6): só nome, nascimento e o final do CPF; agendar (o prestador é o do
// usuário — D9), registrar coleta e resultado com a marca "crítico". Guia
// que mudou ou não é mais dele (409/404) explica e relê a lista.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorCode, providerCollect, providerResult, providerSchedule, type ProviderOrder } from "../../lib/api";
import { cpfTail, examError, examStatusLabel, examStatusTone, fmtDay, refreshExams, scheduleWhen } from "../../lib/exams";
import { cityIsoDate, fmtDateTime } from "../../lib/format";
import { ConfirmButton } from "../../components/ConfirmButton";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { ResultForm } from "./ResultForm";
import { ScheduleForm } from "./ScheduleForm";
import { alert, grid, panel, row, title } from "./styles";

const STALE = new Set([ "invalid_transition", "not_found" ]);

export function ProviderOrderPanel({ order, onDone, onClose }: { order: ProviderOrder; onDone(text: string): void; onClose(): void }) {
  const queryClient = useQueryClient();
  const [ mode, setMode ] = useState<null | "schedule" | "result">(null);
  const [ error, setError ] = useState<string | null>(null);

  async function act(run: () => Promise<void>, okText: string): Promise<void> {
    setError(null);
    try {
      await run();
    } catch (err) {
      if (!STALE.has(errorCode(err) ?? "")) throw err;
      setMode(null);
      setError(examError(err));
      await refreshExams(queryClient);
      return;
    }
    await refreshExams(queryClient);
    onDone(okText);
  }

  return (
    <section aria-label={`Guia ${order.short_code}`} style={panel}>
      <div style={row}>
        <h3 style={title}>{order.label}</h3>
        <Tag tone={examStatusTone(order.status)}>{examStatusLabel(order.status)}</Tag>
        {order.priority === "urgent" && <Tag tone="urgent">urgente</Tag>}
      </div>
      <div style={grid}>
        <KeyValue k="Paciente" v={order.patient.name} mono={false} />
        <KeyValue k="Nascimento" v={fmtDay(order.patient.birth_date)} />
        <KeyValue k="CPF" v={cpfTail(order.patient.cpf_last3)} mono={false} />
        <KeyValue k="SIGTAP" v={order.sigtap_code} />
        <KeyValue k="Agendado" v={order.scheduled_at ? `${fmtDateTime(order.scheduled_at)} · ${order.scheduled_place ?? ""}` : "—"} mono={false} />
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
      {mode === null && (
        <div style={row}>
          {(order.status === "awaiting_schedule" || order.status === "scheduled") && (
            <button type="button" style={secondaryButtonStyle} onClick={() => setMode("schedule")}>
              {order.status === "scheduled" ? "Reagendar" : "Agendar"}
            </button>
          )}
          {order.status === "scheduled" && (
            <ConfirmButton label="Registrar coleta" question="Confirmar que o material foi coletado?"
              onConfirm={() => act(() => providerCollect(order.id), "Coleta registrada.").catch((err) => setError(examError(err)))} />
          )}
          {(order.status === "scheduled" || order.status === "collected") && (
            <button type="button" style={secondaryButtonStyle} onClick={() => setMode("result")}>Registrar resultado</button>
          )}
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
        </div>
      )}
      {mode === "schedule" && (
        <ScheduleForm providers={null} onCancel={() => setMode(null)}
          onSubmit={(d) => act(() => providerSchedule(order.id, scheduleWhen(d)), "Guia agendada.")} />
      )}
      {mode === "result" && (
        <ResultForm fields={order.result_fields ?? []} today={cityIsoDate()} submitLabel="Registrar resultado" onCancel={() => setMode(null)}
          onSubmit={(input) => act(() => providerResult(order.id, input), "Resultado registrado.")} />
      )}
    </section>
  );
}
