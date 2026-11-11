// Atendimento médico na UPA (módulo 32a, F-32.4; contrato §7, §14 Q10): o painel que o médico abre ao chamar ("Chamar",
// "Chamar próximo") ou com "Atender" em quem já está em atendimento. Em cima, o resumo do encontro (cor vigente e critério); no
// meio, a consulta do 19a com `kind: "urgency"` (documentos, exames, notificação, adendos e assinatura como no 19a); embaixo, o
// desfecho da urgência. Finalizar a consulta não encerra o atendimento: o desfecho encerra, e então o painel fecha, a mesa relê a
// fila e mostra o aviso (sem texto clínico). O detalhe é lido pelo id do encontro (nunca vai na URL) e sai do cache ao fechar.
// Cada leitura do detalhe grava trilha: lido ao abrir, ao finalizar e quando o api recusa o desfecho por estado desatualizado.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUrgencyEncounter, type HealthUnit, type UrgencyInCareRow } from "../../lib/api";
import { NOMINAL_QUERY, URGENCY_DETAIL_KEY, URGENCY_ERRORS, urgencyError } from "../../lib/urgency";
import { useReveal } from "../../lib/useReveal";
import { ActionButton } from "../../components/ActionButton";
import { Panel } from "../../components/Panel";
import { ConsultationWorkspace } from "../consultation/ConsultationWorkspace";
import { EncounterSummary } from "./EncounterSummary";
import { OutcomeForm } from "./OutcomeForm";
import { MedicationPanel } from "./MedicationPanel";
import { PrescriptionPanel } from "./PrescriptionPanel";

export const FINALIZED_NOTICE = "Consulta finalizada. Registre o desfecho da urgência.";

export interface UrgencyCareProps {
  row: UrgencyInCareRow;
  unit: HealthUnit;
  units: HealthUnit[];
  // Fecha o painel; com o desfecho registrado, `notice` é o aviso para a mesa.
  onClosed(notice?: string): void;
  onGoToSecurity?(): void;
}

export function UrgencyCare({ row, unit, units, onClosed, onGoToSecurity }: UrgencyCareProps) {
  const ref = useReveal<HTMLDivElement>(true);
  const detail = useQuery({
    // Cada leitura grava trilha: nada de nova tentativa, foco ou reconexão (NOMINAL_QUERY); só a releitura pedida.
    queryKey: [ URGENCY_DETAIL_KEY, row.encounter_id ], queryFn: () => getUrgencyEncounter(row.encounter_id), ...NOMINAL_QUERY
  });
  // Finalizada nesta tela: o desfecho já libera os tipos que esperam a consulta, mesmo antes de o detalhe relido chegar.
  const [ finalizedHere, setFinalizedHere ] = useState(false);
  const encounter = detail.data;
  // A medicação lê o aprazamento (grava trilha): só quando a pessoa abre.
  const [ medicationOpen, setMedicationOpen ] = useState(false);
  const medicationButton = useRef<HTMLSpanElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !medicationOpen) medicationButton.current?.querySelector("button")?.focus();
    wasOpen.current = medicationOpen;
  }, [ medicationOpen ]);
  const target = encounter && (finalizedHere ? { ...encounter, consultation_status: "finalized" as const } : encounter);

  return (
    <div ref={ref}>
      <Panel title={`Atendimento — ${row.ticket ?? "sem senha"}`} sub="consulta de urgência · desfecho">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {detail.isPending && <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>}
          {detail.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{urgencyError(detail.error)}</p>}
          {encounter && <EncounterSummary encounter={encounter} />}
          <ConsultationWorkspace attendanceId={row.attendance_id} unit={unit} units={units} urgency onGoToSecurity={onGoToSecurity}
            onClose={() => onClosed()}
            onFinalized={() => { setFinalizedHere(true); void detail.refetch(); }} />
          {finalizedHere && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{FINALIZED_NOTICE}</p>}
          {/* A prescrição interna (32b): a chave só vem com acesso clínico (Q9); sem ela, a tela é a do 32a. */}
          {target && target.prescription !== undefined && (
            <PrescriptionPanel encounter={target} unit={unit} onChanged={() => void detail.refetch()}
              onEncounterClosed={() => onClosed(URGENCY_ERRORS.encounter_closed)}
              consultationStarted={target.consultation_id !== null && target.consultation_status !== "discarded"} />
          )}
          {target?.prescription?.status === "active" && (medicationOpen ? (
            <MedicationPanel target={{ encounterId: row.encounter_id, ticket: row.ticket, patientName: row.patient.name ?? "sem nome" }}
              prescribedAt={target.prescription.prescribed_at} onClose={() => setMedicationOpen(false)} onEncounterClosed={() => onClosed(URGENCY_ERRORS.encounter_closed)} />
          ) : (
            <span ref={medicationButton}><ActionButton variant="secondary" onClick={() => setMedicationOpen(true)}>Abrir medicação</ActionButton></span>
          ))}
          {target && (
            <OutcomeForm encounter={target} doctor onRecorded={(_e, notice) => onClosed(notice)}
              onStale={() => void detail.refetch()} onEncounterClosed={() => onClosed(URGENCY_ERRORS.encounter_closed)} />
          )}
        </div>
      </Panel>
    </div>
  );
}
