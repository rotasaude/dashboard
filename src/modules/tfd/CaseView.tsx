// Processo de TFD aberto pela comissão (módulo 30, F-30.5). Vem de uma leitura com trilha (POST /tfd/cases/:id/read) e fica só na
// memória da tela. O laudo e os eventos reusam TfdReportView/TfdEvents (Task 12). Ações por situação, todas com segundo fator:
// decisão (`submitted`), atendimento no destino (`submitted|authorized|scheduled`), internação (`scheduled|travelling`) e
// cancelamento (`submitted|returned|authorized|scheduled|travelling`). Toda escrita devolve o processo inteiro, que substitui o
// aberto (onChanged). `children` recebe os painéis de trechos e dinheiro (Task 14), de `authorized` em diante.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { cancelTfdCase, getTfdOptions, type TfdCase } from "../../lib/api";
import { TFD_OPTIONS_KEY, tfdError, tfdStatusLabel, tfdStatusTone } from "../../lib/tfd";
import { STATIC_QUERY } from "../../lib/careLines";
import { fmtIsoDay } from "../../lib/transport";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { dangerButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, list, muted, row, title } from "../exams/styles";
import { TfdEvents, TfdReportView } from "./TfdReportView";
import { DecisionPanel } from "./DecisionPanel";
import { AppointmentForm } from "./AppointmentForm";
import { InpatientForm } from "./InpatientForm";
import { LocalRefusal, refusalText } from "./stepUpText";

const APPOINTMENT_STATUSES = [ "submitted", "authorized", "scheduled" ];
const INPATIENT_STATUSES = [ "scheduled", "travelling" ];
const CANCEL_STATUSES = [ "submitted", "returned", "authorized", "scheduled", "travelling" ];
const MONEY_STATUSES = [ "authorized", "scheduled", "travelling", "completed", "cancelled" ];

const DECIDED_TEXT: Record<string, string> = {
  authorized: "Processo autorizado.", returned: "Pedido devolvido ao médico para complementar.", denied: "Processo recusado."
};

type Mode = "appointment" | "inpatient" | "cancel" | null;

const nameOf = (c: TfdCase) => c.patient.display_name ?? "paciente";

export function CaseView({ tfdCase: c, now, today, onChanged, onGoToSecurity, children }: {
  tfdCase: TfdCase; now: Date; today: string; onChanged(c: TfdCase, text: string): void; onGoToSecurity?(): void; children?: ReactNode;
}) {
  const [ mode, setMode ] = useState<Mode>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const appointmentButton = useRef<HTMLButtonElement>(null);
  // Prestadores só quando o formulário do atendimento abre.
  const options = useQuery({ queryKey: [ TFD_OPTIONS_KEY ], queryFn: getTfdOptions, enabled: mode === "appointment", ...STATIC_QUERY });

  useEffect(() => { heading.current?.focus(); setMode(null); }, [ c.id ]);

  const changed = (next: TfdCase, text: string) => { setMode(null); onChanged(next, text); };
  const canAppointment = APPOINTMENT_STATUSES.includes(c.status);
  const canInpatient = INPATIENT_STATUSES.includes(c.status);
  const canCancel = CANCEL_STATUSES.includes(c.status);
  const toggle = (m: Exclude<Mode, null>) => setMode((prev) => (prev === m ? null : m));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={row}>
        <h3 ref={heading} tabIndex={-1} style={title}>{`Laudo de ${nameOf(c)}`}</h3>
        <Tag tone={tfdStatusTone(c.status)}>{tfdStatusLabel(c.status)}</Tag>
      </div>
      <p style={muted}>
        {[ c.patient.birth_date ? `nascimento ${fmtIsoDay(c.patient.birth_date)}` : null, `pedido por ${c.requested_by.name} (CBO ${c.requested_by.cbo})` ]
          .filter(Boolean).join(" · ")}
      </p>
      <TfdReportView c={c} />

      <section aria-label="Internações no destino" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <strong style={{ fontSize: 12.5 }}>Internações no destino</strong>
        {c.inpatient.length === 0 ? <p style={muted}>nenhuma internação registrada</p> : (
          <ul style={list}>
            {c.inpatient.map((s) => <li key={s.from}>{`${fmtIsoDay(s.from)} — ${s.to ? fmtIsoDay(s.to) : "em aberto"}`}</li>)}
          </ul>
        )}
      </section>

      <section aria-label="Histórico do processo" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <strong style={{ fontSize: 12.5 }}>Histórico</strong>
        <TfdEvents events={c.events} />
      </section>

      {c.status === "submitted" && (
        <DecisionPanel tfdCase={c} now={now} onGoToSecurity={onGoToSecurity}
          onDecided={(next) => changed(next, DECIDED_TEXT[next.status] ?? "Decisão registrada.")}
          onNeedAppointment={() => { setMode(null); appointmentButton.current?.focus(); }} />
      )}

      {(canAppointment || canInpatient || canCancel) && (
        <div style={row}>
          {canAppointment && (
            <button ref={appointmentButton} type="button" aria-expanded={mode === "appointment"} style={secondaryButtonStyle}
              onClick={() => toggle("appointment")}>Marcar atendimento</button>
          )}
          {canInpatient && (
            <button type="button" aria-expanded={mode === "inpatient"} style={secondaryButtonStyle} onClick={() => toggle("inpatient")}>Registrar internação</button>
          )}
          {canCancel && (
            <button type="button" aria-expanded={mode === "cancel"} style={dangerButtonStyle} onClick={() => toggle("cancel")}>Cancelar processo</button>
          )}
        </div>
      )}

      {mode === "appointment" && canAppointment && (
        options.isError ? <p role="alert" style={alert}>{tfdError(options.error)}</p> : options.isPending ? <p style={muted}>carregando prestadores…</p> : (
          <AppointmentForm tfdCase={c} providers={options.data?.providers ?? []} now={now} onGoToSecurity={onGoToSecurity}
            onSaved={(next) => changed(next, "Atendimento no destino marcado.")} onCancel={() => setMode(null)} />
        )
      )}
      {mode === "inpatient" && canInpatient && (
        <InpatientForm tfdCase={c} today={today} onGoToSecurity={onGoToSecurity}
          onSaved={(next) => changed(next, "Internação registrada.")} onCancel={() => setMode(null)} />
      )}
      {mode === "cancel" && canCancel && (
        <SensitiveAction title="Cancelar processo" requiresStepUp onGoToSecurity={onGoToSecurity}
          description="O processo é encerrado como cancelado; trechos e pagamentos já registrados continuam no histórico."
          fields={[ { name: "reason", label: "Motivo", required: true, multiline: true } ]}
          translateError={refusalText}
          run={async (values) => {
            const reason = (values.reason ?? "").trim();
            if (reason.length < 10 || reason.length > 500) throw new LocalRefusal("o motivo tem de 10 a 500 caracteres");
            changed(await cancelTfdCase(c.id, reason), "Processo cancelado.");
          }}
          onDone={() => setMode(null)} onCancel={() => setMode(null)} />
      )}

      {children && MONEY_STATUSES.includes(c.status) && children}
    </div>
  );
}
