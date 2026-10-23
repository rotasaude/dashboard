// src/modules/careLines/CareAppointment.tsx
// Atalho para agendar (contrato §5 e §11 T4; Divergência D7): pede ao api o
// pedido de agendamento do módulo 17 da pessoa na unidade da equipe (o
// aberto, ou um novo) e, SÓ com `can_book`, abre o BookPanel do módulo 17
// com ele — a marcação é a mesma da recepção (vagas, encaixe, prazos). Sem
// `can_book` o pedido apenas aguarda a recepção; pedido aberto de OUTRO tipo
// (reaproveitado) nunca é apresentado como pedido da linha. Só no clique (é
// uma escrita).
import { useState } from "react";
import { openCareAppointment, type CareAppointmentTarget } from "../../lib/api";
import { requestKindLabel } from "../../lib/scheduling";
import { fmtDay } from "../../lib/careLines";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, muted, row, stack } from "../exams/styles";
import { BookPanel } from "../attendance/BookPanel";
import { useCareSubmit } from "./useCareSubmit";

export function CareAppointment({ enrollmentId, onBooked, onStale }: {
  enrollmentId: string; onBooked(): void; onStale(message: string): void;
}) {
  const [ target, setTarget ] = useState<CareAppointmentTarget | null>(null);
  const { busy, error, submit } = useCareSubmit();

  async function open() {
    const got: { target?: CareAppointmentTarget } = {};
    const ok = await submit(async () => { got.target = await openCareAppointment(enrollmentId); }, onStale);
    if (ok && got.target) setTarget(got.target);
  }

  if (target) {
    const { request, unit } = target;
    const back = () => setTarget(null);
    const ownRequest = request.kind === "care_line" && request.origin === "care_line";
    if (!ownRequest || !target.can_book) {
      const summary = `${request.appointment_type_name} · ${unit.name} · prazo ${fmtDay(request.due_on)}`;
      return (
        <section aria-label="Pedido de agendamento" style={box}>
          <strong>{ownRequest ? "Pedido enviado à recepção da unidade" : `já há pedido aberto (${requestKindLabel(request)})`}</strong>
          <p style={muted}>{summary}</p>
          {!ownRequest && (
            <p style={muted}>{target.can_book ? "Marque pela fila da recepção da unidade." : "A recepção da unidade marca o horário desse pedido."}</p>
          )}
          <div style={row}><button type="button" style={secondaryButtonStyle} onClick={back}>Voltar</button></div>
        </section>
      );
    }
    return (
      <section aria-label="Marcar horário" style={stack}>
        <BookPanel row={{ ...request, note: null }} unit={unit} onCancel={back} onDone={() => { back(); onBooked(); }} />
      </section>
    );
  }
  return (
    <div style={stack}>
      <div><button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void open()}>Agendar</button></div>
      {error && <p role="alert" style={alert}>{error}</p>}
    </div>
  );
}
