// Fila do acolhimento (módulo 18; spec §4; contratos §3): atendimentos que
// aguardam e precisam de escuta pelo escopo da unidade, por chegada, com a
// prioridade da triagem digital só como sinal. Quem tem vínculo com a unidade
// e CBO permitido inicia ou retoma a escuta; o api é quem confere os dois.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorCode, getScreening, listAppointmentTypes, listScreeningQueue, startScreening,
  type HealthUnit, type Screening, type ScreeningQueueItem
} from "../../lib/api";
import { ATTENDANCE_REFETCH_MS } from "../../lib/attendance";
import { COLOR_LABEL, screeningError, waitLabel, waitedMinutes } from "../../lib/screening";
import { fmtHourMinute } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { APPOINTMENT_TYPES_KEY } from "../professionals/AppointmentTypes";
import { ScreeningForm } from "./ScreeningForm";

export const SCREENING_QUEUE_KEY = "screeningQueue";
// Quem não faz escuta nesta unidade: a fila some e fica a frase. A leitura da
// fila responde 403 `forbidden`; os demais códigos vêm da rota de início.
const NOT_FOR_YOU = new Set([ "forbidden", "cbo_not_allowed", "missing_link", "missing_role" ]);
// Outro profissional mexeu primeiro: recarrega e avisa.
const STALE = new Set([ "already_screening", "not_waiting", "screening_not_required", "not_in_progress" ]);

interface Open { item: ScreeningQueueItem; screening: Screening }

export function ScreeningQueue({ unit, units, now = () => new Date() }: { unit: HealthUnit; units: HealthUnit[]; now?(): Date }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ SCREENING_QUEUE_KEY, unit.id ], queryFn: () => listScreeningQueue(unit.id),
    refetchInterval: ATTENDANCE_REFETCH_MS });
  const types = useQuery({ queryKey: APPOINTMENT_TYPES_KEY, queryFn: listAppointmentTypes });
  const [ open, setOpen ] = useState<Open | null>(null);
  const [ rowBusy, setRowBusy ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ actionError, setActionError ] = useState<string | null>(null);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [ SCREENING_QUEUE_KEY, unit.id ] });
    void queryClient.invalidateQueries({ queryKey: [ "unitQueue", unit.id ] });
  }

  async function begin(item: ScreeningQueueItem) {
    if (rowBusy || open) return;
    setRowBusy(item.attendance_id); setNotice(null); setActionError(null);
    try {
      const resuming = item.screening?.status === "in_progress";
      const screening = resuming ? await getScreening(item.screening!.id) : await startScreening(item.attendance_id);
      setOpen({ item, screening });
    } catch (err) {
      const code = errorCode(err);
      if (code && STALE.has(code)) { refresh(); setNotice(screeningError(err)); return; }
      setActionError(screeningError(err));
    } finally {
      setRowBusy(null);
    }
  }

  const blockedCode = query.isError ? errorCode(query.error) : undefined;
  if (blockedCode && NOT_FOR_YOU.has(blockedCode)) {
    return (
      <Panel title="Acolhimento" sub="escuta inicial">
        <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{screeningError(query.error)}</p>
      </Panel>
    );
  }

  const items = query.data ?? [];
  const at = now();

  return (
    <Panel title="Acolhimento" sub="escuta inicial · por ordem de chegada">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {notice && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{notice}</p>}
        {actionError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{actionError}</p>}
        {query.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{screeningError(query.error)}</p>}

        {open ? (
          <ScreeningForm
            key={open.screening.id}
            mode="complete"
            screening={open.screening}
            citizenLabel={`${open.item.citizen.cpf_masked} · chegou às ${fmtHourMinute(open.item.checked_in_at)}`}
            unit={unit}
            units={units}
            types={types.isSuccess ? types.data : null}
            onDone={(result) => {
              setOpen(null);
              refresh();
              if (result.destination === "schedule") void queryClient.invalidateQueries({ queryKey: [ "unitRequests" ] });
              setNotice(doneMessage(result));
            }}
            onClosed={(message) => { setOpen(null); refresh(); setNotice(message); }}
            onCancel={() => setOpen(null)}
          />
        ) : query.isPending ? (
          <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
        ) : items.length === 0 ? (
          <EmptyState title="Ninguém aguardando escuta" />
        ) : (
          <DataTable<ScreeningQueueItem>
            cols={[
              { label: "CPF", w: "1.5fr", render: (r) => r.citizen.cpf_masked },
              { label: "Chegada", w: "0.8fr", render: (r) => fmtHourMinute(r.checked_in_at) },
              { label: "Espera", w: "0.8fr", render: (r) => waitLabel(waitedMinutes(r.checked_in_at, at)) },
              { label: "Triagem digital", w: "1fr", render: (r) => (r.triage_priority === null ? "—" : `prioridade ${r.triage_priority}`) },
              { label: "Situação", w: "1.6fr", render: (r) => situation(r) },
              {
                label: "", w: "auto", align: "right", render: (r) => (
                  <button type="button" disabled={rowBusy === r.attendance_id}
                    style={rowBusy === r.attendance_id ? disabledButtonStyle : secondaryButtonStyle}
                    onClick={() => void begin(r)}>
                    {r.screening?.status === "in_progress" ? "Retomar escuta" : "Iniciar escuta"}
                  </button>
                )
              }
            ]}
            rows={items}
            rowKey={(r) => r.attendance_id}
          />
        )}
      </div>
    </Panel>
  );
}

function situation(r: ScreeningQueueItem): string {
  if (!r.screening) return "aguardando escuta";
  if (r.screening.status === "in_progress") return `em escuta com ${r.screening.started_by_name}`;
  return "escuta abandonada — aguardando de novo";
}

function doneMessage(s: Screening): string {
  const color = s.current_revision ? COLOR_LABEL[s.current_revision.final_color] : null;
  switch (s.destination) {
    case "same_day": return `Escuta concluída${color ? ` (${color})` : ""}: segue na fila do profissional.`;
    case "schedule": return "Escuta concluída: pedido de agendamento criado e atendimento encerrado.";
    case "oriented": return "Escuta concluída: orientação registrada e atendimento encerrado.";
    case "referred": return "Escuta concluída: encaminhamento registrado e atendimento encerrado.";
    default: return "Escuta concluída.";
  }
}
